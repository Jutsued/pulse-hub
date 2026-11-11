// ------------------------------------------------------------------
// Pulse Hub — main app
// ------------------------------------------------------------------
// 1. Load data/latest.json and data/history.json (made daily by the GitHub Action).
// 2. Fill in the hero and the "Today" tab right away.
// 3. Draw the other tabs the first time someone opens them
//    (charts inside hidden tabs can't measure their size).
// ------------------------------------------------------------------

import {
  COLORS, SERIES_COLORS, money, percent, direction, moodColor, toneColor, toneWord,
  shortDateTime, shortDate, timeAgo, escapeHtml, safeUrl,
} from "./format.js";
import { draw, sparkline, signedBars } from "./charts.js";
import { trackTab } from "./analytics.js";

const state = {
  latest: null,
  history: [],
  renderedTabs: new Set(),
  selectedStocks: ["NVDA"],
  stockRange: 126,
  sortKey: "changePct",
  sortDir: "desc",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

// ------------------------------------------------------------------
// Load data
// ------------------------------------------------------------------

async function loadData() {
  // "?t=" stops the browser from showing yesterday's cached file.
  const stamp = Date.now();
  const [latestRes, historyRes] = await Promise.all([
    fetch(`data/latest.json?t=${stamp}`),
    fetch(`data/history.json?t=${stamp}`),
  ]);
  if (!latestRes.ok) throw new Error(`Couldn't load data/latest.json (HTTP ${latestRes.status})`);
  state.latest = await latestRes.json();
  state.history = historyRes.ok ? await historyRes.json() : [];
}

async function start() {
  try {
    await loadData();
  } catch (err) {
    $("#mood-sentence").textContent = "Today's data isn't available yet.";
    $("#mood-sub").textContent = `${err.message}. The daily GitHub Action creates this file — run it from the repo's Actions tab.`;
    $("#updated").textContent = "";
    return;
  }

  // Wait for Chart.js (loaded with "defer") before drawing.
  if (!window.Chart) await new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));

  renderHeader();
  renderHero();
  setupTabs();
  renderTab("tab-today");
}

// ------------------------------------------------------------------
// Header + hero
// ------------------------------------------------------------------

function renderHeader() {
  const { generatedAt, sample } = state.latest;
  $("#updated").textContent = `Updated ${shortDateTime(generatedAt)} (${timeAgo(generatedAt)})`;
  if (sample) {
    const banner = document.createElement("p");
    banner.className = "banner";
    banner.textContent =
      "You're looking at sample data. Real numbers appear after the daily GitHub Action runs for the first time.";
    $(".hero-text").append(banner);
  }
}

const MOOD_SENTENCES = {
  "Extreme Fear": "Markets are gripped by fear today.",
  Fear: "Markets are leaning fearful today.",
  Neutral: "Markets are holding steady today.",
  Greed: "Markets are feeling confident today.",
  "Extreme Greed": "Markets are running hot today.",
  Unknown: "Not enough data to read the market's mood today.",
};

function renderHero() {
  const { pulse, indices, sentiment, social } = state.latest;
  const color = moodColor(pulse.score);
  document.documentElement.style.setProperty("--mood-color", color);

  $("#mood-sentence").textContent = MOOD_SENTENCES[pulse.label] || MOOD_SENTENCES.Unknown;
  $("#pulse-score").textContent = pulse.score ?? "–";
  $("#pulse-label").textContent = `${pulse.label} · pulse score out of 100`;

  // One plain-language line that ties the numbers together.
  const find = (sym) => indices.find((q) => q.symbol === sym);
  const spx = find("^GSPC");
  const ndx = find("^IXIC");
  const vix = find("^VIX");
  const newsTone = sentiment.byCategory["News Channels"]?.avg;
  const topReddit = social.reddit?.[0];
  const parts = [];
  if (spx) parts.push(`The S&P 500 is ${percent(spx.changePct)} and the Nasdaq ${percent(ndx?.changePct)} on the day`);
  if (vix) parts.push(`the VIX fear gauge sits at ${money(vix.price)}`);
  let sentence = parts.length ? parts.join(", ") + ". " : "";
  if (newsTone !== undefined) sentence += `News headlines read ${toneWord(newsTone)}. `;
  if (topReddit) sentence += `Reddit's most-discussed ticker is ${topReddit.ticker}.`;
  $("#mood-sub").textContent = sentence;

  // The five ingredients of the score.
  $("#pulse-components").innerHTML = pulse.components
    .map((c) => {
      const hasScore = c.score !== null && c.score !== undefined;
      return `<li title="${escapeHtml(c.explain)}">
        <span>${escapeHtml(c.label)}</span>
        <span class="val ${hasScore ? "" : "missing"}">${hasScore ? Math.round(c.score) : "n/a"}</span>
        <span class="bar"><span style="width:${hasScore ? c.score : 0}%;background:${moodColor(c.score)}"></span></span>
      </li>`;
    })
    .join("");

  drawPulseTrace();
}

// The heartbeat line under the hero. Uses the daily pulse history once there is
// enough of it; before that, it shows the S&P 500's past year.
function drawPulseTrace() {
  const days = state.history.filter((h) => h.pulse !== null);
  let labels, values, label;
  if (days.length >= 5) {
    labels = days.map((h) => shortDate(h.date));
    values = days.map((h) => h.pulse);
    label = "Pulse score";
  } else {
    const spx = state.latest.indices.find((q) => q.symbol === "^GSPC");
    labels = (spx?.history || []).map((p) => shortDate(p.d));
    values = (spx?.history || []).map((p) => p.c);
    label = "S&P 500, past year (pulse history builds day by day)";
  }

  draw("pulse-trace", {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label,
          data: values,
          borderColor: moodColor(state.latest.pulse.score),
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.15,
          fill: false,
        },
      ],
    },
    options: {
      animation: { duration: 1400, easing: "easeOutQuart" },
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: true, align: "start", labels: { boxWidth: 0, font: { size: 11 } } },
      },
      scales: {
        x: { display: false },
        y: { display: false },
      },
    },
  });
}

// ------------------------------------------------------------------
// Tabs
// ------------------------------------------------------------------

function setupTabs() {
  const tabs = $$('[role="tab"]');
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => showTab(tab));
    tab.addEventListener("keydown", (e) => {
      // Left/right arrow keys move between tabs (standard tab behaviour).
      const i = tabs.indexOf(tab);
      if (e.key === "ArrowRight") tabs[(i + 1) % tabs.length].focus();
      if (e.key === "ArrowLeft") tabs[(i - 1 + tabs.length) % tabs.length].focus();
    });
  });
  // Open the tab from the URL, e.g. ...#stocks
  const fromHash = tabs.find((t) => t.id === `t-${location.hash.slice(1)}`);
  if (fromHash) showTab(fromHash);
}

function showTab(tab) {
  $$('[role="tab"]').forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
  $$(".tab-panel").forEach((panel) => (panel.hidden = panel.id !== tab.getAttribute("aria-controls")));
  history.replaceState(null, "", `#${tab.id.slice(2)}`);
  trackTab(tab.id.slice(2));
  renderTab(tab.getAttribute("aria-controls"));
}

function renderTab(id) {
  if (state.renderedTabs.has(id)) return;
  state.renderedTabs.add(id);
  const renderers = {
    "tab-today": renderToday,
    "tab-stocks": renderStocks,
    "tab-sentiment": renderSentiment,
    "tab-headlines": renderHeadlines,
    "tab-world": renderWorld,
    "tab-sources": renderSources,
  };
  try {
    renderers[id]?.();
  } catch (err) {
    console.error(`Couldn't draw ${id}:`, err);
  }
}

// ------------------------------------------------------------------
// TODAY tab
// ------------------------------------------------------------------

function renderToday() {
  const { indices, sectors, watchlist, crypto, fearGreed, treasury } = state.latest;

  // Index strip with sparklines.
  $("#index-strip").innerHTML = indices
    .map(
      (q, i) => `<div class="index-cell">
        <div class="index-name">${escapeHtml(q.name)}</div>
        <div class="index-price">${money(q.price)}</div>
        <div class="index-change ${q.symbol === "^VIX" ? direction(-q.changePct) : direction(q.changePct)}">${percent(q.changePct)}</div>
        <canvas id="spark-${i}" width="160" height="36"></canvas>
      </div>`
    )
    .join("");
  indices.forEach((q, i) => {
    const last60 = q.history.slice(-60).map((p) => p.c);
    const rising = last60.at(-1) >= last60[0];
    const good = q.symbol === "^VIX" ? !rising : rising; // a rising VIX is bad news
    sparkline(document.getElementById(`spark-${i}`), last60, good ? COLORS.greed : COLORS.fear);
  });

  // Sector bars with a time-range switch.
  const drawSectors = (key) => {
    const sorted = [...sectors].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
    const narrow = window.innerWidth < 760; // phones: short labels so they fit
    signedBars("sector-chart", sorted.map((s) => (narrow ? s.symbol : `${s.name} (${s.symbol})`)), sorted.map((s) => s[key] ?? 0), { suffix: "%" });
  };
  drawSectors("changePct");
  $$("[data-sector-range]").forEach((btn) =>
    btn.addEventListener("click", () => {
      $$("[data-sector-range]").forEach((b) => b.classList.toggle("on", b === btn));
      drawSectors(btn.dataset.sectorRange);
    })
  );

  // Fear & greed gauges.
  const gauge = (name, g) =>
    g
      ? `<div><div class="gauge-name">${name}</div>
          <div class="gauge-value" style="color:${moodColor(g.score)}">${Math.round(g.score)}</div>
          <div class="gauge-rating">${escapeHtml(capitalize(g.rating))}</div></div>`
      : `<div><div class="gauge-name">${name}</div><div class="empty">Not available today</div></div>`;
  $("#gauges").innerHTML = gauge("CNN stocks index", fearGreed.cnn) + gauge("Crypto index", fearGreed.crypto);

  const fgLines = [];
  if (fearGreed.cnn?.history?.length) fgLines.push({ label: "CNN stocks", points: fearGreed.cnn.history, color: COLORS.accent });
  if (fearGreed.crypto?.history?.length) fgLines.push({ label: "Crypto", points: fearGreed.crypto.history, color: COLORS.neutral });
  drawDateLines("fg-chart", fgLines, { min: 0, max: 100 });

  // Yield curve: today vs a month ago.
  if (treasury?.curve) {
    const curve = treasury.curve.filter((c) => c.now !== null);
    $("#curve-note").textContent =
      `As of ${shortDate(treasury.date)}. 10-year minus 2-year: ${treasury.spread2s10s > 0 ? "+" : ""}${treasury.spread2s10s} points` +
      (treasury.spread2s10s < 0 ? " (inverted — often read as a recession warning)." : ".");
    draw("curve-chart", {
      type: "line",
      data: {
        labels: curve.map((c) => c.maturity.replace(" Mo", "m").replace(" Yr", "y").replace(" Month", "m")),
        datasets: [
          { label: "Today", data: curve.map((c) => c.now), borderColor: COLORS.accent, backgroundColor: COLORS.accent, tension: 0.2 },
          { label: "A month ago", data: curve.map((c) => c.monthAgo), borderColor: COLORS.rule, backgroundColor: COLORS.rule, borderDash: [5, 4], tension: 0.2 },
        ],
      },
      options: { scales: { y: { ticks: { callback: (v) => `${v}%` } } } },
    });
  } else {
    $("#curve-note").textContent = "Treasury data isn't available today.";
  }

  // Crypto with 7-day sparklines.
  $("#crypto-list").innerHTML = crypto.length
    ? crypto
        .map(
          (c, i) => `<div class="crypto-row">
            <span><span class="ticker">${escapeHtml(c.symbol)}</span> <span class="muted">${escapeHtml(c.name)}</span></span>
            <span>$${money(c.price, c.price < 10 ? 3 : 0)} <span class="${direction(c.changePct)}">${percent(c.changePct)}</span></span>
            <canvas id="cspark-${i}" width="300" height="30"></canvas>
          </div>`
        )
        .join("")
    : `<p class="empty">Crypto prices aren't available today.</p>`;
  crypto.forEach((c, i) =>
    sparkline(document.getElementById(`cspark-${i}`), c.sparkline, c.chg7d >= 0 ? COLORS.greed : COLORS.fear)
  );

  // Biggest movers (absolute % change).
  const movers = [...watchlist].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 7);
  $("#movers").innerHTML = movers
    .map(
      (q) => `<li><span class="ticker">${q.symbol}</span><span class="muted">${escapeHtml(q.name)} · $${money(q.price)}</span>
        <span class="${direction(q.changePct)}">${percent(q.changePct)}</span></li>`
    )
    .join("");
}

// Draws one or more date-based lines on a shared x axis.
function drawDateLines(canvasId, lines, { min, max, suffix = "" } = {}) {
  if (!lines.length) return;
  const allDays = [...new Set(lines.flatMap((l) => l.points.map((p) => p.d)))].sort();
  draw(canvasId, {
    type: "line",
    data: {
      labels: allDays.map(shortDate),
      datasets: lines.map((l) => {
        const byDay = Object.fromEntries(l.points.map((p) => [p.d, p.v]));
        return {
          label: l.label,
          data: allDays.map((d) => byDay[d] ?? null),
          borderColor: l.color,
          backgroundColor: l.color,
          pointRadius: 0,
          borderWidth: 2,
          spanGaps: true,
          tension: 0.2,
        };
      }),
    },
    options: {
      interaction: { intersect: false, mode: "index" },
      scales: { y: { min, max, ticks: { callback: (v) => `${v}${suffix}` } }, x: { ticks: { maxTicksLimit: 8 } } },
    },
  });
}

const capitalize = (s = "") => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------
// STOCKS tab
// ------------------------------------------------------------------

function renderStocks() {
  const reddit = state.latest.social.reddit || [];
  // Add a few calculated columns so the table can sort by them.
  state.rows = state.latest.watchlist.map((q) => ({
    ...q,
    fromHigh: q.high52 ? ((q.price - q.high52) / q.high52) * 100 : null,
    vsMa50: q.ma50 ? ((q.price - q.ma50) / q.ma50) * 100 : null,
    buzz: reddit.find((r) => r.ticker === q.symbol)?.mentions ?? 0,
  }));

  $$("#watch-table th[data-sort]").forEach((th) =>
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      state.sortDir = state.sortKey === key && state.sortDir === "desc" ? "asc" : "desc";
      state.sortKey = key;
      drawWatchTable();
    })
  );

  $$("[data-range]").forEach((btn) =>
    btn.addEventListener("click", () => {
      $$("[data-range]").forEach((b) => b.classList.toggle("on", b === btn));
      state.stockRange = Number(btn.dataset.range);
      drawStockChart();
    })
  );

  drawWatchTable();
  drawStockChart();
}

function drawWatchTable() {
  const { sortKey, sortDir } = state;
  const rows = [...state.rows].sort((a, b) => {
    const x = a[sortKey];
    const y = b[sortKey];
    const result = typeof x === "string" ? x.localeCompare(y) : (x ?? -Infinity) - (y ?? -Infinity);
    return sortDir === "desc" ? -result : result;
  });

  $$("#watch-table th[data-sort]").forEach((th) => {
    th.removeAttribute("aria-sort");
    if (th.dataset.sort === sortKey) th.setAttribute("aria-sort", sortDir === "desc" ? "descending" : "ascending");
  });

  $("#watch-table tbody").innerHTML = rows
    .map(
      (q) => `<tr data-symbol="${q.symbol}" tabindex="0" class="${state.selectedStocks.includes(q.symbol) ? "selected" : ""}">
        <td><span class="ticker">${q.symbol}</span> <span class="muted">${escapeHtml(q.name)}</span></td>
        <td class="num">$${money(q.price)}</td>
        <td class="num ${direction(q.changePct)}">${percent(q.changePct)}</td>
        <td class="num ${direction(q.chg1m)}">${percent(q.chg1m, 1)}</td>
        <td class="num ${direction(q.chgYTD)}">${percent(q.chgYTD, 1)}</td>
        <td class="num ${direction(q.fromHigh, 0.5)}">${percent(q.fromHigh, 1)}</td>
        <td class="num ${direction(q.vsMa50)}">${percent(q.vsMa50, 1)}</td>
        <td class="num">${q.buzz || "–"}</td>
      </tr>`
    )
    .join("");

  $$("#watch-table tbody tr").forEach((tr) => {
    const pick = (e) => selectStock(tr.dataset.symbol, e.shiftKey);
    tr.addEventListener("click", pick);
    tr.addEventListener("keydown", (e) => e.key === "Enter" && pick(e));
  });
}

// Click = chart just this stock. Shift-click = add/remove it for comparison.
function selectStock(symbol, addToCompare) {
  if (addToCompare) {
    const has = state.selectedStocks.includes(symbol);
    state.selectedStocks = has ? state.selectedStocks.filter((s) => s !== symbol) : [...state.selectedStocks, symbol];
    if (!state.selectedStocks.length) state.selectedStocks = [symbol];
  } else {
    state.selectedStocks = [symbol];
  }
  drawWatchTable();
  drawStockChart();
}

function drawStockChart() {
  const picked = state.selectedStocks
    .map((s) => state.latest.watchlist.find((q) => q.symbol === s))
    .filter(Boolean);
  const comparing = picked.length > 1;

  $("#stock-chips").innerHTML = picked
    .map((q) => `<button class="chip" data-chip="${q.symbol}" aria-label="Remove ${q.symbol}">${q.symbol}</button>`)
    .join("");
  $$("[data-chip]").forEach((chip) => chip.addEventListener("click", () => selectStock(chip.dataset.chip, true)));

  const days = [...new Set(picked.flatMap((q) => q.history.slice(-state.stockRange).map((p) => p.d)))].sort();
  const datasets = picked.map((q, i) => {
    const slice = q.history.slice(-state.stockRange);
    const base = slice[0]?.c;
    const byDay = Object.fromEntries(slice.map((p) => [p.d, comparing ? ((p.c - base) / base) * 100 : p.c]));
    return {
      label: comparing ? `${q.symbol} % change` : `${q.symbol} price`,
      data: days.map((d) => byDay[d] ?? null),
      borderColor: SERIES_COLORS[i % SERIES_COLORS.length],
      backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length],
      pointRadius: 0,
      borderWidth: 2,
      spanGaps: true,
      tension: 0.1,
    };
  });

  // For a single stock, also show its 50-day average as a dashed line.
  if (!comparing && picked[0]) {
    const all = picked[0].history;
    const ma = all.map((_, i) => (i < 49 ? null : all.slice(i - 49, i + 1).reduce((s, p) => s + p.c, 0) / 50));
    const offset = all.length - state.stockRange;
    datasets.push({
      label: "50-day average",
      data: ma.slice(Math.max(0, offset)),
      borderColor: COLORS.inkSoft,
      borderDash: [5, 4],
      borderWidth: 1.5,
      pointRadius: 0,
    });
  }

  draw("stock-chart", {
    type: "line",
    data: { labels: days.map(shortDate), datasets },
    options: {
      interaction: { intersect: false, mode: "index" },
      scales: {
        x: { ticks: { maxTicksLimit: 10 } },
        y: { ticks: { callback: (v) => (comparing ? `${v}%` : `$${v}`) } },
      },
    },
  });
}

// ------------------------------------------------------------------
// COMPARE SOURCES tab
// ------------------------------------------------------------------

function renderSentiment() {
  const { sentiment, mentions, social, watchlist } = state.latest;

  // 1) Average tone per category.
  const cats = Object.entries(sentiment.byCategory).sort((a, b) => b[1].avg - a[1].avg);
  signedBars(
    "category-chart",
    cats.map(([name, s]) => `${name} (${s.count})`),
    cats.map(([, s]) => s.avg),
    { digits: 3 }
  );

  // 2) Upbeat / neutral / gloomy mix (stacked %).
  draw("mix-chart", {
    type: "bar",
    data: {
      labels: cats.map(([name]) => name),
      datasets: [
        { label: "Upbeat", key: "positive", color: COLORS.greed },
        { label: "Neutral", key: "neutral", color: "#b9c2cf" },
        { label: "Gloomy", key: "negative", color: COLORS.fear },
      ].map((part) => ({
        label: part.label,
        data: cats.map(([, s]) => (s[part.key] / s.count) * 100),
        backgroundColor: part.color,
      })),
    },
    options: {
      indexAxis: "y",
      plugins: { tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(0)}%` } } },
      scales: { x: { stacked: true, max: 100, ticks: { callback: (v) => `${v}%` } }, y: { stacked: true, grid: { display: false } } },
    },
  });

  // 3) Every individual source ranked.
  const sources = Object.entries(sentiment.bySource).sort((a, b) => b[1].avg - a[1].avg);
  signedBars("source-chart", sources.map(([name]) => name), sources.map(([, s]) => s.avg), { digits: 3 });

  // 4) Mention heat map.
  const columns = ["News Channels", "Advisors & Analysts", "Press Releases", "Global Events", "Global News (GDELT)", "Reddit mentions"];
  const maxByColumn = Object.fromEntries(columns.map((c) => [c, Math.max(1, ...mentions.map((m) => m[c] || 0))]));
  $("#mention-table").innerHTML =
    `<thead><tr><th>Stock</th>${columns.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>` +
    mentions
      .map(
        (m) => `<tr><td>${m.symbol}</td>${columns
          .map((c) => {
            const n = m[c] || 0;
            const strength = n / maxByColumn[c];
            const bg = n ? `rgba(46, 74, 158, ${0.12 + strength * 0.75})` : "#eef1f5";
            return `<td style="background:${bg};color:${strength > 0.55 ? "#fff" : COLORS.ink}">${n || "·"}</td>`;
          })
          .join("")}</tr>`
      )
      .join("") +
    "</tbody>";

  // 5) Reddit buzz vs price move (watchlist + any top-Reddit ticker we have prices for).
  const points = watchlist
    .map((q) => ({ q, r: social.reddit.find((r) => r.ticker === q.symbol) }))
    .filter((p) => p.r);
  draw("buzz-chart", {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Watchlist stocks",
          data: points.map((p) => ({ x: p.r.mentions, y: p.q.changePct, label: p.q.symbol })),
          backgroundColor: points.map((p) => (p.q.changePct >= 0 ? COLORS.greed : COLORS.fear)),
          pointRadius: 6,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.raw.label}: ${ctx.raw.x} mentions, ${percent(ctx.raw.y)}` } },
      },
      scales: {
        x: { type: "logarithmic", title: { display: true, text: "Reddit mentions (24h, log scale)" } },
        y: { title: { display: true, text: "Price change today" }, ticks: { callback: (v) => `${v}%` } },
      },
    },
  });
  if (!points.length) $("#buzz-chart").closest(".chart-box").insertAdjacentHTML("beforebegin", `<p class="empty">None of the watchlist stocks are in Reddit's top 50 today.</p>`);

  // 6) Reddit top list with rank change.
  $("#buzz-list").innerHTML = social.reddit.length
    ? social.reddit
        .slice(0, 15)
        .map((r) => {
          const moved = r.rank24hAgo ? r.rank24hAgo - r.rank : 0;
          const change = r.mentions24hAgo ? ((r.mentions - r.mentions24hAgo) / r.mentions24hAgo) * 100 : null;
          return `<li><span class="ticker">${escapeHtml(r.ticker)}</span>
            <span class="muted">${escapeHtml(r.name)}${moved ? ` · ${moved > 0 ? "up" : "down"} ${Math.abs(moved)} spots` : ""}</span>
            <span>${r.mentions} <span class="${direction(change)}">${change === null ? "" : percent(change, 0)}</span></span></li>`;
        })
        .join("")
    : `<li class="empty">Reddit data isn't available today.</li>`;

  // 7) Category sentiment over time (from history.json).
  const days = state.history.filter((h) => h.sentiment);
  $("#history-note").textContent =
    days.length < 2
      ? "This chart fills in as the daily job runs — come back in a few days to see trends."
      : `${days.length} days of history.`;
  const categoryNames = [...new Set(days.flatMap((h) => Object.keys(h.sentiment)))];
  drawDateLines(
    "sentiment-history",
    categoryNames.map((name, i) => ({
      label: name,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      points: days.map((h) => ({ d: h.date, v: h.sentiment[name] ?? null })),
    }))
  );
}

// ------------------------------------------------------------------
// HEADLINES tab
// ------------------------------------------------------------------

function renderHeadlines() {
  const { headlines, watchlist } = state.latest;
  const categories = [...new Set(headlines.map((h) => h.category))];
  $("#filter-category").insertAdjacentHTML("beforeend", categories.map((c) => `<option>${escapeHtml(c)}</option>`).join(""));
  $("#filter-ticker").insertAdjacentHTML(
    "beforeend",
    watchlist.map((q) => `<option value="${q.symbol}">${q.symbol} — ${escapeHtml(q.name)}</option>`).join("")
  );
  ["#filter-category", "#filter-ticker", "#filter-tone"].forEach((sel) => $(sel).addEventListener("change", drawHeadlines));
  $("#filter-search").addEventListener("input", drawHeadlines);
  drawHeadlines();
}

function drawHeadlines() {
  const category = $("#filter-category").value;
  const ticker = $("#filter-ticker").value;
  const tone = $("#filter-tone").value;
  const search = $("#filter-search").value.trim().toLowerCase();

  const list = state.latest.headlines.filter((h) => {
    if (category && h.category !== category) return false;
    if (ticker && !h.tickers.includes(ticker)) return false;
    if (tone === "pos" && !(h.score > 0.05)) return false;
    if (tone === "neg" && !(h.score < -0.05)) return false;
    if (tone === "neu" && Math.abs(h.score) > 0.05) return false;
    if (search && !h.title.toLowerCase().includes(search)) return false;
    return true;
  });

  $("#headline-count").textContent = `${list.length} of ${state.latest.headlines.length} headlines`;
  $("#headline-list").innerHTML = list.length
    ? list.slice(0, 300).map(headlineItem).join("")
    : `<li class="empty">No headlines match. Try clearing a filter.</li>`;
}

function headlineItem(h) {
  const tags = (h.tickers || []).map((t) => `<span class="tag">${t}</span>`).join("");
  return `<li>
    <span class="tone" style="background:${toneColor(h.score)}" title="Tone score ${h.score}"></span>
    <div>
      <a href="${escapeHtml(safeUrl(h.link))}" target="_blank" rel="noopener">${escapeHtml(h.title)}</a>
      <div class="meta">${tags}${escapeHtml(h.source)}${h.category ? ` · ${escapeHtml(h.category)}` : ""}${h.date ? ` · ${timeAgo(h.date)}` : ""}</div>
    </div>
  </li>`;
}

// ------------------------------------------------------------------
// WORLD & NYC tab
// ------------------------------------------------------------------

function renderWorld() {
  const { global, city } = state.latest;

  // GDELT tone line.
  if (global.toneTimeline.length) {
    draw("gdelt-chart", {
      type: "line",
      data: {
        labels: global.toneTimeline.map((p) => shortDate(p.d)),
        datasets: [
          {
            label: "Average tone of world news coverage",
            data: global.toneTimeline.map((p) => p.v),
            borderColor: COLORS.accent,
            backgroundColor: "rgba(46,74,158,0.08)",
            fill: "origin",
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.25,
          },
        ],
      },
      options: { scales: { y: { grid: { color: (ctx) => (ctx.tick.value === 0 ? COLORS.inkSoft : COLORS.rule) } } } },
    });
  } else {
    $("#gdelt-chart").closest(".chart-box").outerHTML = `<p class="empty">GDELT didn't respond today.</p>`;
  }

  $("#gdelt-list").innerHTML = global.articles.length
    ? global.articles.map((a) => headlineItem({ ...a, category: a.country })).join("")
    : `<li class="empty">No world headlines today.</li>`;

  // Earthquakes.
  $("#quake-table").innerHTML = global.earthquakes.length
    ? `<thead><tr><th class="num">Mag.</th><th>Where</th><th>When</th></tr></thead><tbody>` +
      global.earthquakes
        .slice(0, 15)
        .map(
          (q) => `<tr><td class="num ${q.mag >= 6 ? "down" : ""}"><strong>${q.mag.toFixed(1)}</strong></td>
            <td><a href="${escapeHtml(safeUrl(q.link))}" target="_blank" rel="noopener">${escapeHtml(q.place)}</a>${q.tsunami ? " · tsunami alert" : ""}</td>
            <td>${timeAgo(q.time)}</td></tr>`
        )
        .join("") +
      "</tbody>"
    : `<tbody><tr><td class="empty">No earthquake data today.</td></tr></tbody>`;

  // City events.
  if (city) {
    $("#city-title").textContent = `Permitted events in ${city.city}, next 7 days (${city.total})`;
    const bar = (id, rows) =>
      draw(id, {
        type: "bar",
        data: { labels: rows.map((r) => r.label), datasets: [{ data: rows.map((r) => r.count), backgroundColor: COLORS.accent, borderRadius: 3, maxBarThickness: 26 }] },
        options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { y: { grid: { display: false } } } },
      });
    bar("borough-chart", city.byBorough);
    bar("eventtype-chart", city.byType.slice(0, 8));

    $("#event-list").innerHTML = city.upcoming.length
      ? city.upcoming
          .map(
            (e) => `<li><div class="when">${shortDateTime(e.start)} · ${escapeHtml(e.borough || "")}</div>
              <div>${escapeHtml(e.name)}</div>
              <div class="muted">${escapeHtml(e.type || "")}${e.location ? ` — ${escapeHtml(e.location)}` : ""}</div></li>`
          )
          .join("")
      : `<li class="empty">No large events listed for the coming week.</li>`;
  } else {
    $("#event-list").innerHTML = `<li class="empty">NYC Open Data didn't respond today.</li>`;
  }
}

// ------------------------------------------------------------------
// DATA SOURCES tab
// ------------------------------------------------------------------

function renderSources() {
  const { sources, pulse } = state.latest;
  const okCount = sources.filter((s) => s.ok).length;
  $("#source-table").innerHTML =
    `<caption class="note" style="text-align:left">${okCount} of ${sources.length} sources responded on the last run.</caption>` +
    `<thead><tr><th>Source</th><th>Status</th><th>Details</th></tr></thead><tbody>` +
    sources
      .map(
        (s) => `<tr><td>${escapeHtml(s.name)}</td>
          <td class="${s.ok ? "status-ok" : "status-fail"}">${s.ok ? "Working" : "Failed"}</td>
          <td class="muted">${escapeHtml(s.detail)}</td></tr>`
      )
      .join("") +
    "</tbody>";

  $("#method").innerHTML = `
    <p>The pulse score is a homemade 0–100 reading of market mood: 0 is extreme fear, 100 is extreme greed. Each ingredient is turned into a 0–100 number, and the score is the average of the ones that loaded today.</p>
    <ul>${pulse.components.map((c) => `<li><strong>${escapeHtml(c.label)}</strong>: ${escapeHtml(c.explain)}</li>`).join("")}</ul>
    <p>Headline tone uses a fixed list of finance words (for example "rally" and "beat" count as upbeat; "plunge", "probe" and "war" count as gloomy). It ignores sarcasm and context, but because every source is scored the same way, the comparison between sources is fair.</p>`;
}

start();
