// ------------------------------------------------------------------
// Pulse Hub — daily data collector
// ------------------------------------------------------------------
// Runs once a day inside GitHub Actions (see .github/workflows/update-data.yml).
// It calls free, no-key APIs and RSS feeds, scores headline sentiment,
// and writes two files the website reads:
//
//   data/latest.json   -> everything for "today"
//   data/history.json  -> one small summary row per day (for trend charts)
//
// No npm packages needed: Node 20+ has fetch() built in.
// Every source is wrapped in try/catch, so if one API is down
// the rest of the dashboard still updates. Failures are listed in
// latest.json -> sources so the site can show a "source status" table.
// ------------------------------------------------------------------

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { scoreText } from "./sentiment.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

const config = JSON.parse(await readFile(path.join(__dirname, "config.json"), "utf8"));

// A browser-like User-Agent: some sites refuse requests without one.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
// SEC asks automated tools to identify themselves.
const SEC_UA = "PulseHub/1.0 (github.com/Jutsued/pulse-hub; contact via GitHub)";

// Keeps track of which sources worked, for the "Source status" panel.
const sourceStatus = [];

function logStatus(name, ok, detail = "") {
  sourceStatus.push({ name, ok, detail, checkedAt: new Date().toISOString() });
  console.log(`${ok ? "OK  " : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch() with a timeout, friendly errors, and retries.
// Busy free APIs often answer 429 ("too many requests") or 5xx ("try later"),
// so we wait and try again a couple of times before giving up.
async function getText(url, { headers = {}, timeout = 25000, retries = 2, retryWait = 8000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "*/*", ...headers },
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.retryable = res.status === 429 || res.status >= 500;
        throw err;
      }
      return await res.text();
    } catch (err) {
      const retryable = err.retryable || err.name === "AbortError" || err.message === "fetch failed";
      if (!retryable || attempt >= retries) throw err;
      await sleep(retryWait * (attempt + 1)); // wait longer each time
    } finally {
      clearTimeout(timer);
    }
  }
}

async function getJSON(url, options) {
  const text = await getText(url, options);
  return JSON.parse(text);
}

const round = (n, digits = 2) =>
  n === null || n === undefined || Number.isNaN(n) ? null : Number(n.toFixed(digits));

const pct = (now, then) => (now && then ? ((now - then) / then) * 100 : null);

const average = (arr) => {
  const nums = arr.filter((n) => typeof n === "number" && !Number.isNaN(n));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};

// ------------------------------------------------------------------
// 1) STOCK PRICES — Yahoo Finance chart API, Stooq CSV as a backup
// ------------------------------------------------------------------

// Turns a list of {d: "YYYY-MM-DD", c: close} into the numbers we show.
function summarizeSeries(symbol, name, series, extra = {}) {
  const closes = series.map((p) => p.c);
  const last = closes.at(-1);
  const prev = closes.at(-2);
  const priceAt = (daysBack) => closes.at(-1 - daysBack) ?? closes[0];
  const yearStart = series.find((p) => p.d >= `${new Date().getUTCFullYear()}-01-01`);
  const lastYearClose = series.filter((p) => p.d < `${new Date().getUTCFullYear()}-01-01`).at(-1);

  return {
    symbol,
    name,
    price: round(last),
    change: round(last - prev),
    changePct: round(pct(last, prev)),
    chg1m: round(pct(last, priceAt(21))),
    chg3m: round(pct(last, priceAt(63))),
    chgYTD: round(pct(last, (lastYearClose || yearStart)?.c)),
    high52: round(Math.max(...closes.slice(-252))),
    low52: round(Math.min(...closes.slice(-252))),
    ma50: round(average(closes.slice(-50))),
    ma200: round(average(closes.slice(-200))),
    asOf: series.at(-1)?.d,
    history: series.slice(-252), // about one year of trading days
    ...extra,
  };
}

async function fromYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=1y&interval=1d&includePrePost=false`;
  const json = await getJSON(url);
  const result = json.chart?.result?.[0];
  if (!result) throw new Error("empty chart result");
  const times = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const series = [];
  times.forEach((t, i) => {
    if (closes[i] !== null && closes[i] !== undefined) {
      series.push({ d: new Date(t * 1000).toISOString().slice(0, 10), c: round(closes[i], 4) });
    }
  });
  // Yahoo's "regularMarketPrice" is fresher than the last daily bar during market hours.
  const live = result.meta?.regularMarketPrice;
  if (live && series.length) series.at(-1).c = round(live, 4);
  if (series.length < 30) throw new Error("not enough data");
  return series;
}

async function fromStooq(stooqSymbol) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;
  const csv = await getText(url);
  const rows = csv.trim().split("\n").slice(1); // skip header: Date,Open,High,Low,Close,Volume
  const series = rows
    .map((line) => line.split(","))
    .filter((cols) => cols.length >= 5 && !Number.isNaN(Number(cols[4])))
    .map((cols) => ({ d: cols[0], c: Number(cols[4]) }))
    .slice(-260);
  if (series.length < 30) throw new Error("not enough data");
  return series;
}

async function getQuote({ symbol, name, stooq }) {
  try {
    const series = await fromYahoo(symbol);
    return summarizeSeries(symbol, name, series, { provider: "Yahoo" });
  } catch (yahooErr) {
    // Backup: Stooq uses symbols like "nvda.us" for US stocks.
    const stooqSymbol = stooq === undefined ? `${symbol.toLowerCase()}.us` : stooq;
    if (!stooqSymbol) throw yahooErr;
    const series = await fromStooq(stooqSymbol);
    return summarizeSeries(symbol, name, series, { provider: "Stooq" });
  }
}

async function getQuotes(list, label) {
  const out = [];
  let failed = [];
  for (const item of list) {
    try {
      out.push(await getQuote(item));
    } catch (err) {
      failed.push(`${item.symbol} (${err.message})`);
    }
    await sleep(300); // be polite to the free APIs
  }
  logStatus(
    `Prices: ${label}`,
    out.length > 0,
    `${out.length}/${list.length} loaded${failed.length ? "; failed: " + failed.join(", ") : ""}`
  );
  return out;
}

// ------------------------------------------------------------------
// 2) RSS / ATOM FEEDS — tiny parser, no libraries
// ------------------------------------------------------------------

function decodeEntities(str = "") {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ") // strip any HTML tags inside titles
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function parseFeed(xml) {
  const items = [];
  // RSS uses <item>, Atom uses <entry>.
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const block of blocks) {
    const title = pickTag(block, "title");
    let link = pickTag(block, "link");
    if (!link) {
      const href = block.match(/<link[^>]*href="([^"]+)"/i);
      link = href ? href[1] : "";
    }
    const dateText = pickTag(block, "pubDate") || pickTag(block, "updated") || pickTag(block, "published") || pickTag(block, "dc:date");
    const date = dateText && !Number.isNaN(Date.parse(dateText)) ? new Date(dateText).toISOString() : null;
    if (title) items.push({ title, link, date });
  }
  return items;
}

async function getFeeds(feeds, watchlist) {
  const headlines = [];
  for (const feed of feeds) {
    try {
      // Government sites (SEC, BLS) ask automated tools to identify themselves.
      const headers = /sec\.gov|bls\.gov/.test(feed.url) ? { "User-Agent": SEC_UA } : {};
      const xml = await getText(feed.url, { headers, retries: 1, retryWait: 4000 });
      const items = parseFeed(xml).slice(0, 25);
      if (!items.length) throw new Error("no items found");
      for (const item of items) {
        const sentiment = scoreText(item.title);
        headlines.push({
          ...item,
          source: feed.source,
          category: feed.category,
          score: sentiment.score,
          tickers: findTickers(item.title, watchlist),
        });
      }
      logStatus(`Feed: ${feed.source}`, true, `${items.length} headlines`);
    } catch (err) {
      logStatus(`Feed: ${feed.source}`, false, err.message);
    }
    await sleep(200);
  }
  return headlines;
}

// Finds which watchlist companies a headline mentions.
function findTickers(text, watchlist) {
  const lower = ` ${text.toLowerCase()} `;
  const found = [];
  for (const stock of watchlist) {
    const symbolHit = new RegExp(`(^|[^A-Za-z])\\$?${stock.symbol}([^A-Za-z]|$)`).test(text);
    const nameHit = [stock.name.toLowerCase(), ...(stock.keywords || [])].some((k) =>
      new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(lower)
    );
    if (symbolHit || nameHit) found.push(stock.symbol);
  }
  return found;
}

// ------------------------------------------------------------------
// 3) SENTIMENT GAUGES — CNN Fear & Greed, Crypto Fear & Greed
// ------------------------------------------------------------------

async function getCnnFearGreed() {
  try {
    const json = await getJSON("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
      headers: { Referer: "https://www.cnn.com/", Origin: "https://www.cnn.com" },
    });
    const fg = json.fear_and_greed;
    const history = (json.fear_and_greed_historical?.data || [])
      .slice(-120)
      .map((p) => ({ d: new Date(p.x).toISOString().slice(0, 10), v: round(p.y, 1) }));
    logStatus("CNN Fear & Greed", true, `${round(fg.score, 0)} (${fg.rating})`);
    return {
      score: round(fg.score, 1),
      rating: fg.rating,
      previousWeek: round(fg.previous_1_week, 1),
      previousMonth: round(fg.previous_1_month, 1),
      history,
    };
  } catch (err) {
    logStatus("CNN Fear & Greed", false, err.message);
    return null;
  }
}

async function getCryptoFearGreed() {
  try {
    const json = await getJSON("https://api.alternative.me/fng/?limit=60");
    const data = json.data.map((p) => ({
      d: new Date(Number(p.timestamp) * 1000).toISOString().slice(0, 10),
      v: Number(p.value),
      label: p.value_classification,
    }));
    logStatus("Crypto Fear & Greed", true, `${data[0].v} (${data[0].label})`);
    return { score: data[0].v, rating: data[0].label, history: data.reverse() };
  } catch (err) {
    logStatus("Crypto Fear & Greed", false, err.message);
    return null;
  }
}

// ------------------------------------------------------------------
// 4) CRYPTO PRICES — CoinGecko (free, no key)
// ------------------------------------------------------------------

async function getCrypto(ids) {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(
      ","
    )}&sparkline=true&price_change_percentage=24h,7d,30d`;
    const json = await getJSON(url);
    const coins = json.map((c) => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      price: c.current_price,
      changePct: round(c.price_change_percentage_24h_in_currency),
      chg7d: round(c.price_change_percentage_7d_in_currency),
      chg30d: round(c.price_change_percentage_30d_in_currency),
      marketCap: c.market_cap,
      sparkline: (c.sparkline_in_7d?.price || []).filter((_, i) => i % 4 === 0).map((v) => round(v, 2)),
    }));
    logStatus("CoinGecko crypto", true, `${coins.length} coins`);
    return coins;
  } catch (err) {
    logStatus("CoinGecko crypto", false, err.message);
    return [];
  }
}

// ------------------------------------------------------------------
// 5) US TREASURY YIELD CURVE — treasury.gov CSV (free, no key)
// ------------------------------------------------------------------

async function getTreasuryYields() {
  try {
    const year = new Date().getUTCFullYear();
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
    const csv = await getText(url);
    const lines = csv.trim().split("\n");
    const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
    const rows = lines.slice(1).map((line) => {
      const cols = line.split(",").map((c) => c.replace(/"/g, "").trim());
      const row = {};
      header.forEach((h, i) => (row[h] = i === 0 ? cols[i] : Number(cols[i]) || null));
      return row;
    });
    // Rows come newest-first.
    const latest = rows[0];
    const monthAgo = rows[Math.min(21, rows.length - 1)];
    const maturities = header.slice(1);
    const curve = maturities.map((m) => ({ maturity: m, now: latest[m], monthAgo: monthAgo[m] }));
    const spread = latest["10 Yr"] && latest["2 Yr"] ? round(latest["10 Yr"] - latest["2 Yr"]) : null;
    const tenYearHistory = rows
      .slice(0, 130)
      .reverse()
      .map((r) => ({ d: toIsoDate(r.Date), v: r["10 Yr"] }));
    logStatus("US Treasury yields", true, `10Y ${latest["10 Yr"]}% on ${latest.Date}`);
    return { date: toIsoDate(latest.Date), curve, spread2s10s: spread, tenYearHistory };
  } catch (err) {
    logStatus("US Treasury yields", false, err.message);
    return null;
  }
}

// Treasury dates look like 11/10/2026.
function toIsoDate(mdY) {
  const [m, d, y] = String(mdY).split("/");
  return y ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : mdY;
}

// ------------------------------------------------------------------
// 6) GLOBAL NEWS TONE — GDELT (free, no key; max 1 request / 5 sec)
// ------------------------------------------------------------------

async function getGdelt(query) {
  const base = "https://api.gdeltproject.org/api/v2/doc/doc";
  const result = { toneTimeline: [], articles: [] };
  try {
    const tone = await getJSON(
      `${base}?query=${encodeURIComponent(query)}&mode=timelinetone&timespan=30d&format=json`,
      { retries: 3, retryWait: 15000 }
    );
    result.toneTimeline = (tone.timeline?.[0]?.data || []).map((p) => ({
      d: `${p.date.slice(0, 4)}-${p.date.slice(4, 6)}-${p.date.slice(6, 8)}`,
      v: round(p.value, 2),
    }));
    // GDELT returns several points per day; keep one average per day.
    result.toneTimeline = groupDaily(result.toneTimeline);
    logStatus("GDELT global tone", true, `${result.toneTimeline.length} days`);
  } catch (err) {
    logStatus("GDELT global tone", false, err.message);
  }

  await sleep(6000); // GDELT asks for at least 5 seconds between calls

  try {
    const list = await getJSON(
      `${base}?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=40&sort=datedesc&timespan=1d&format=json`,
      { retries: 3, retryWait: 15000 }
    );
    result.articles = (list.articles || []).map((a) => ({
      title: decodeEntities(a.title),
      link: a.url,
      source: a.domain,
      country: a.sourcecountry,
      date: a.seendate
        ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}T${a.seendate.slice(9, 11)}:${a.seendate.slice(11, 13)}:00Z`
        : null,
      score: scoreText(a.title).score,
    }));
    logStatus("GDELT articles", true, `${result.articles.length} articles`);
  } catch (err) {
    logStatus("GDELT articles", false, err.message);
  }
  return result;
}

function groupDaily(points) {
  const byDay = {};
  for (const p of points) (byDay[p.d] ||= []).push(p.v);
  return Object.entries(byDay).map(([d, vals]) => ({ d, v: round(average(vals), 2) }));
}

// ------------------------------------------------------------------
// 7) EARTHQUAKES — USGS (free, no key)
// ------------------------------------------------------------------

async function getEarthquakes() {
  try {
    const json = await getJSON(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson"
    );
    const quakes = json.features
      .map((f) => ({
        place: f.properties.place,
        mag: f.properties.mag,
        time: new Date(f.properties.time).toISOString(),
        link: f.properties.url,
        tsunami: f.properties.tsunami === 1,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      }))
      .sort((a, b) => b.mag - a.mag);
    logStatus("USGS earthquakes", true, `${quakes.length} quakes M4.5+ this week`);
    return quakes;
  } catch (err) {
    logStatus("USGS earthquakes", false, err.message);
    return [];
  }
}

// ------------------------------------------------------------------
// 8) CITY EVENTS — NYC Open Data permitted events (free, no key)
// ------------------------------------------------------------------

async function getCityEvents(city) {
  try {
    const start = new Date();
    const end = new Date(Date.now() + city.daysAhead * 86400000);
    const fmt = (d) => d.toISOString().slice(0, 19);
    const where = `start_date_time >= '${fmt(start)}' AND start_date_time < '${fmt(end)}'`;
    const url = `${city.eventsUrl}?$where=${encodeURIComponent(where)}&$order=start_date_time&$limit=1000`;
    let rows;
    try {
      rows = await getJSON(url, { retries: 3, retryWait: 10000 });
    } catch {
      // Backup: ask for the newest events without a date filter, then filter here.
      const all = await getJSON(`${city.eventsUrl}?$order=start_date_time DESC&$limit=3000`, { retries: 2, retryWait: 10000 });
      rows = all
        .filter((r) => r.start_date_time >= fmt(start) && r.start_date_time < fmt(end))
        .sort((a, b) => a.start_date_time.localeCompare(b.start_date_time));
    }
    const events = rows.map((r) => ({
      name: r.event_name,
      type: r.event_type,
      borough: r.event_borough,
      location: r.event_location,
      agency: r.event_agency,
      start: r.start_date_time,
      end: r.end_date_time,
    }));
    const countBy = (key) =>
      Object.entries(
        events.reduce((acc, e) => {
          const k = e[key] || "Unknown";
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {})
      )
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);
    logStatus(`City events: ${city.name}`, true, `${events.length} permitted events next ${city.daysAhead} days`);
    return {
      city: city.name,
      total: events.length,
      byBorough: countBy("borough"),
      byType: countBy("type").slice(0, 10),
      // Skip routine items (e.g. weekly street-closure permits) so the list is interesting.
      upcoming: events.filter((e) => !/^(Sport - Youth|Sport - Adult|Production Event|Construction)/i.test(e.type || "")).slice(0, 60),
    };
  } catch (err) {
    logStatus(`City events: ${city.name}`, false, err.message);
    return null;
  }
}

// ------------------------------------------------------------------
// 9) SOCIAL MEDIA BUZZ — ApeWisdom (Reddit mentions), Stocktwits trending
// ------------------------------------------------------------------

async function getRedditBuzz() {
  try {
    const json = await getJSON("https://apewisdom.io/api/v1.0/filter/all-stocks/page/1");
    const rows = json.results.slice(0, 50).map((r) => ({
      rank: Number(r.rank),
      ticker: r.ticker,
      name: decodeEntities(r.name),
      mentions: Number(r.mentions),
      mentions24hAgo: Number(r.mentions_24h_ago),
      upvotes: Number(r.upvotes),
      rank24hAgo: Number(r.rank_24h_ago),
    }));
    logStatus("Reddit buzz (ApeWisdom)", true, `${rows.length} tickers`);
    return rows;
  } catch (err) {
    logStatus("Reddit buzz (ApeWisdom)", false, err.message);
    return [];
  }
}

async function getStocktwitsTrending() {
  try {
    const json = await getJSON("https://api.stocktwits.com/api/2/trending/symbols.json");
    const rows = (json.symbols || []).slice(0, 30).map((s) => ({
      ticker: s.symbol,
      name: s.title,
      watchers: s.watchlist_count,
    }));
    logStatus("Stocktwits trending", true, `${rows.length} symbols`);
    return rows;
  } catch (err) {
    logStatus("Stocktwits trending", false, err.message);
    return [];
  }
}

// ------------------------------------------------------------------
// 10) PULSE SCORE — a simple homemade 0–100 market mood indicator
// ------------------------------------------------------------------
// Each part is turned into a 0–100 number, then we average the parts
// that loaded. 0 = extreme fear, 100 = extreme greed.

const scale = (value, low, high) =>
  value === null || value === undefined ? null : Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));

function buildPulse({ indices, watchlist, sectors, sentimentByCategory, cnn }) {
  const spx = indices.find((q) => q.symbol === "^GSPC");
  const vix = indices.find((q) => q.symbol === "^VIX");
  const everything = [...watchlist, ...sectors];
  const upCount = everything.filter((q) => q.changePct > 0).length;

  const components = [
    {
      key: "momentum",
      label: "S&P 500 vs 50-day average",
      raw: spx ? round(pct(spx.price, spx.ma50)) : null,
      score: spx ? scale(pct(spx.price, spx.ma50), -5, 5) : null,
      explain: "Above its 50-day average = greedier. ±5% maps to 0–100.",
    },
    {
      key: "volatility",
      label: "VIX fear gauge",
      raw: vix ? vix.price : null,
      score: vix ? scale(vix.price, 35, 12) : null, // reversed: low VIX = calm/greedy
      explain: "VIX 12 or lower = 100 (calm). VIX 35+ = 0 (panic).",
    },
    {
      key: "breadth",
      label: "Stocks & sectors up today",
      raw: everything.length ? round((upCount / everything.length) * 100, 0) : null,
      score: everything.length ? (upCount / everything.length) * 100 : null,
      explain: "Share of the watchlist + sector ETFs that rose today.",
    },
    {
      key: "news",
      label: "Headline sentiment (news + advisors)",
      raw: round(average([sentimentByCategory["News Channels"]?.avg, sentimentByCategory["Advisors & Analysts"]?.avg]), 3),
      score: scale(
        average([sentimentByCategory["News Channels"]?.avg, sentimentByCategory["Advisors & Analysts"]?.avg]),
        -0.3,
        0.3
      ),
      explain: "Average headline score from −0.3 (gloomy) to +0.3 (upbeat).",
    },
    {
      key: "cnn",
      label: "CNN Fear & Greed",
      raw: cnn?.score ?? null,
      score: cnn?.score ?? null,
      explain: "CNN's own 0–100 index, when it's reachable.",
    },
  ].map((c) => ({ ...c, score: round(c.score, 1) }));

  const score = round(average(components.map((c) => c.score)), 1);
  return { score, label: moodLabel(score), components };
}

function moodLabel(score) {
  if (score === null) return "Unknown";
  if (score < 25) return "Extreme Fear";
  if (score < 45) return "Fear";
  if (score <= 55) return "Neutral";
  if (score <= 75) return "Greed";
  return "Extreme Greed";
}

// ------------------------------------------------------------------
// 11) SENTIMENT COMPARISON — by category and by source
// ------------------------------------------------------------------

function summarizeSentiment(items, key) {
  const groups = {};
  for (const item of items) (groups[item[key]] ||= []).push(item.score);
  const out = {};
  for (const [name, scores] of Object.entries(groups)) {
    out[name] = {
      avg: round(average(scores), 3),
      count: scores.length,
      positive: scores.filter((s) => s > 0.05).length,
      negative: scores.filter((s) => s < -0.05).length,
      neutral: scores.filter((s) => s >= -0.05 && s <= 0.05).length,
    };
  }
  return out;
}

// How often each watchlist company is mentioned, per source category.
function buildMentionMatrix(headlines, gdeltArticles, reddit, watchlist) {
  return watchlist.map((stock) => {
    const row = { symbol: stock.symbol, name: stock.name };
    for (const h of headlines) {
      if (h.tickers.includes(stock.symbol)) row[h.category] = (row[h.category] || 0) + 1;
    }
    row["Global News (GDELT)"] = gdeltArticles.filter((a) => findTickers(a.title, [stock]).length).length;
    row["Reddit mentions"] = reddit.find((r) => r.ticker === stock.symbol)?.mentions || 0;
    return row;
  });
}

// ------------------------------------------------------------------
// MAIN
// ------------------------------------------------------------------

async function main() {
  console.log(`Pulse Hub update starting ${new Date().toISOString()}\n`);
  await mkdir(DATA_DIR, { recursive: true });

  const indices = await getQuotes(config.indices, "indices");
  const watchlist = await getQuotes(config.watchlist, "watchlist");
  const sectors = await getQuotes(config.sectors, "sector ETFs");

  const [cnn, cryptoFG, crypto, treasury, quakes, cityEvents, reddit, stocktwits] = await Promise.all([
    getCnnFearGreed(),
    getCryptoFearGreed(),
    getCrypto(config.crypto),
    getTreasuryYields(),
    getEarthquakes(),
    getCityEvents(config.city),
    getRedditBuzz(),
    getStocktwitsTrending(),
  ]);

  const headlines = await getFeeds(config.feeds, config.watchlist);
  const gdelt = await getGdelt(config.gdeltQuery);

  // Put GDELT articles into the comparison as their own category.
  const allScored = [
    ...headlines,
    ...gdelt.articles.map((a) => ({ ...a, category: "Global News (GDELT)", source: a.source })),
  ];
  const sentimentByCategory = summarizeSentiment(allScored, "category");
  const sentimentBySource = summarizeSentiment(headlines, "source");

  const pulse = buildPulse({ indices, watchlist, sectors, sentimentByCategory, cnn });
  const mentions = buildMentionMatrix(headlines, gdelt.articles, reddit, config.watchlist);

  const today = new Date().toISOString().slice(0, 10);
  const latest = {
    generatedAt: new Date().toISOString(),
    date: today,
    pulse,
    indices,
    watchlist,
    sectors,
    crypto,
    fearGreed: { cnn, crypto: cryptoFG },
    treasury,
    sentiment: { byCategory: sentimentByCategory, bySource: sentimentBySource },
    mentions,
    headlines: headlines.sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    global: { toneTimeline: gdelt.toneTimeline, articles: gdelt.articles, earthquakes: quakes },
    city: cityEvents,
    social: { reddit, stocktwits },
    sources: sourceStatus,
  };

  await writeFile(path.join(DATA_DIR, "latest.json"), JSON.stringify(latest));
  await updateHistory(latest);

  const ok = sourceStatus.filter((s) => s.ok).length;
  console.log(`\nDone: ${ok}/${sourceStatus.length} sources OK. Pulse score ${pulse.score} (${pulse.label}).`);
}

// One summary row per day, newest last. Re-running on the same day replaces that day's row.
async function updateHistory(latest) {
  const file = path.join(DATA_DIR, "history.json");
  let history = [];
  try {
    history = JSON.parse(await readFile(file, "utf8"));
  } catch {
    // first run: no history yet
  }
  const close = (list, symbol) => list.find((q) => q.symbol === symbol)?.price ?? null;
  const row = {
    date: latest.date,
    pulse: latest.pulse.score,
    pulseParts: Object.fromEntries(latest.pulse.components.map((c) => [c.key, c.score])),
    sentiment: Object.fromEntries(Object.entries(latest.sentiment.byCategory).map(([k, v]) => [k, v.avg])),
    spx: close(latest.indices, "^GSPC"),
    nasdaq: close(latest.indices, "^IXIC"),
    vix: close(latest.indices, "^VIX"),
    tenYear: latest.treasury?.curve?.find((c) => c.maturity === "10 Yr")?.now ?? null,
    cnnFearGreed: latest.fearGreed.cnn?.score ?? null,
    cryptoFearGreed: latest.fearGreed.crypto?.score ?? null,
    gdeltTone: latest.global.toneTimeline.at(-1)?.v ?? null,
  };
  history = history.filter((h) => h.date !== row.date);
  history.push(row);
  history.sort((a, b) => a.date.localeCompare(b.date));
  history = history.slice(-730); // keep two years
  await writeFile(file, JSON.stringify(history, null, 1));
}

main().catch((err) => {
  console.error("Update failed:", err);
  process.exit(1);
});
