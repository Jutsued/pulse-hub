// ------------------------------------------------------------------
// Creates FAKE data so you can preview the site locally before the
// GitHub Action has run. The real job (fetch-data.mjs) overwrites it.
// Usage:  node scripts/make-sample-data.mjs
// ------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreText } from "./sentiment.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(__dirname, "config.json"), "utf8"));

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const round = (n, d = 2) => Number(n.toFixed(d));

function fakeSeries(start, drift, vol) {
  const out = [];
  let price = start;
  const day = new Date();
  day.setDate(day.getDate() - 365);
  while (out.length < 252) {
    day.setDate(day.getDate() + 1);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    price *= 1 + drift + (rand() - 0.5) * vol;
    out.push({ d: day.toISOString().slice(0, 10), c: round(price, 2) });
  }
  return out;
}

function quote(item, start) {
  const series = fakeSeries(start, 0.0004, 0.04);
  const closes = series.map((p) => p.c);
  const last = closes.at(-1);
  const prev = closes.at(-2);
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  return {
    symbol: item.symbol, name: item.name, price: last, change: round(last - prev),
    changePct: round(((last - prev) / prev) * 100), chg1m: round(((last - closes.at(-22)) / closes.at(-22)) * 100),
    chg3m: round(((last - closes.at(-64)) / closes.at(-64)) * 100), chgYTD: round(((last - closes[40]) / closes[40]) * 100),
    high52: Math.max(...closes), low52: Math.min(...closes), ma50: round(avg(closes.slice(-50))), ma200: round(avg(closes.slice(-200))),
    asOf: series.at(-1).d, history: series, provider: "Sample",
  };
}

const starts = { "^GSPC": 7500, "^IXIC": 25000, "^DJI": 52000, "^RUT": 2800, "^VIX": 22, "^TNX": 4.9 };
const indices = config.indices.map((i) => quote(i, starts[i.symbol]));
const watchlist = config.watchlist.map((w) => quote(w, 20 + rand() * 300));
const sectors = config.sectors.map((s) => quote(s, 30 + rand() * 200));

const sampleTitles = [
  ["News Channels", "CNBC Markets", "Stocks slip as hot inflation report fuels rate hike bets"],
  ["News Channels", "CNBC Markets", "Nvidia stock plunges 5% as CEO probe deepens"],
  ["News Channels", "MarketWatch", "Dow rallies more than 1,000 points after midterm results"],
  ["News Channels", "BBC Business", "Oil prices fall on hopes of Iran peace deal"],
  ["Advisors & Analysts", "Seeking Alpha", "AMD beats estimates, raises outlook on data center strength"],
  ["Advisors & Analysts", "Benzinga", "Analyst downgrades Albemarle on lithium glut fears"],
  ["Advisors & Analysts", "Nasdaq.com", "3 dividend stocks to buy with strong growth"],
  ["Press Releases", "PR Newswire", "Company announces record third quarter results"],
  ["Press Releases", "Federal Reserve", "Federal Reserve issues FOMC statement"],
  ["Global Events", "BBC World", "Earthquake strikes off coast, no tsunami warning"],
  ["City (NYC)", "Gothamist", "NYC unveils new protected bike lanes in Queens"],
];
const headlines = sampleTitles.map(([category, source, title], i) => ({
  title, link: "https://example.com", date: new Date(Date.now() - i * 3600e3).toISOString(),
  source, category, score: scoreText(title).score,
  tickers: config.watchlist.filter((w) => title.toLowerCase().includes(w.name.toLowerCase())).map((w) => w.symbol),
}));

const byCat = {};
for (const h of headlines) (byCat[h.category] ||= []).push(h.score);
const summarize = (groups) =>
  Object.fromEntries(Object.entries(groups).map(([k, s]) => [k, {
    avg: round(s.reduce((a, b) => a + b, 0) / s.length, 3), count: s.length,
    positive: s.filter((x) => x > 0.05).length, negative: s.filter((x) => x < -0.05).length,
    neutral: s.filter((x) => Math.abs(x) <= 0.05).length,
  }]));
const bySrc = {};
for (const h of headlines) (bySrc[h.source] ||= []).push(h.score);

const days = (n) => [...Array(n)].map((_, i) => new Date(Date.now() - (n - 1 - i) * 864e5).toISOString().slice(0, 10));

const latest = {
  sample: true,
  generatedAt: new Date().toISOString(),
  date: new Date().toISOString().slice(0, 10),
  pulse: {
    score: 38.4, label: "Fear",
    components: [
      { key: "momentum", label: "S&P 500 vs 50-day average", raw: -1.8, score: 32, explain: "Above its 50-day average = greedier. ±5% maps to 0–100." },
      { key: "volatility", label: "VIX fear gauge", raw: 22, score: 56.5, explain: "VIX 12 or lower = 100 (calm). VIX 35+ = 0 (panic)." },
      { key: "breadth", label: "Stocks & sectors up today", raw: 40, score: 40, explain: "Share of the watchlist + sector ETFs that rose today." },
      { key: "news", label: "Headline sentiment (news + advisors)", raw: -0.08, score: 36.7, explain: "Average headline score from −0.3 (gloomy) to +0.3 (upbeat)." },
      { key: "cnn", label: "CNN Fear & Greed", raw: null, score: null, explain: "CNN's own 0–100 index, when it's reachable." },
    ],
  },
  indices, watchlist, sectors,
  crypto: [
    { id: "bitcoin", symbol: "BTC", name: "Bitcoin", price: 76100, changePct: 1.2, chg7d: -3.1, chg30d: -8, sparkline: fakeSeries(76000, 0, 0.02).slice(-42).map((p) => p.c) },
    { id: "ethereum", symbol: "ETH", name: "Ethereum", price: 2950, changePct: -0.6, chg7d: 2.2, chg30d: -4, sparkline: fakeSeries(2900, 0, 0.03).slice(-42).map((p) => p.c) },
  ],
  fearGreed: {
    cnn: null,
    crypto: { score: 31, rating: "Fear", history: days(60).map((d) => ({ d, v: Math.round(25 + rand() * 40) })) },
  },
  treasury: {
    date: days(1)[0], spread2s10s: 0.42,
    curve: ["1 Mo", "3 Mo", "6 Mo", "1 Yr", "2 Yr", "5 Yr", "10 Yr", "30 Yr"].map((m, i) => ({ maturity: m, now: round(4.3 + i * 0.09, 2), monthAgo: round(4.2 + i * 0.07, 2) })),
    tenYearHistory: [],
  },
  sentiment: { byCategory: summarize(byCat), bySource: summarize(bySrc) },
  mentions: config.watchlist.map((w) => ({ symbol: w.symbol, name: w.name, "News Channels": Math.floor(rand() * 6), "Advisors & Analysts": Math.floor(rand() * 4), "Reddit mentions": Math.floor(rand() * 400) })),
  headlines,
  global: {
    toneTimeline: days(30).map((d) => ({ d, v: round(-2.5 + rand() * 1.5, 2) })),
    articles: headlines.slice(0, 4).map((h) => ({ ...h, country: "United States" })),
    earthquakes: [{ place: "Sample — 120 km S of Somewhere", mag: 6.1, time: new Date().toISOString(), link: "https://earthquake.usgs.gov", tsunami: false }],
  },
  city: {
    city: "New York City", total: 412,
    byBorough: [{ label: "Manhattan", count: 180 }, { label: "Brooklyn", count: 110 }, { label: "Queens", count: 70 }, { label: "Bronx", count: 32 }, { label: "Staten Island", count: 20 }],
    byType: [{ label: "Street Event", count: 120 }, { label: "Parade", count: 12 }, { label: "Special Event", count: 80 }],
    upcoming: [{ name: "Sample Street Fair", type: "Street Event", borough: "Manhattan", location: "Broadway between W 50 St and W 57 St", start: new Date(Date.now() + 864e5).toISOString() }],
  },
  social: {
    reddit: watchlist.slice(0, 8).map((q, i) => ({ rank: i + 1, ticker: q.symbol, name: q.name, mentions: Math.round(500 / (i + 1)), mentions24hAgo: Math.round(400 / (i + 1)), upvotes: 100, rank24hAgo: i + 2 })),
    stocktwits: [],
  },
  sources: [{ name: "Sample data", ok: true, detail: "Generated locally — not real", checkedAt: new Date().toISOString() }],
};

const history = days(14).map((d) => ({
  date: d, pulse: round(30 + rand() * 40, 1),
  sentiment: Object.fromEntries(Object.keys(byCat).map((k) => [k, round(-0.2 + rand() * 0.3, 3)])),
}));

await writeFile(path.join(__dirname, "..", "data", "latest.json"), JSON.stringify(latest));
await writeFile(path.join(__dirname, "..", "data", "history.json"), JSON.stringify(history, null, 1));
console.log("Sample data written to data/latest.json and data/history.json");
