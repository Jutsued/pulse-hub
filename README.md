# Pulse Hub

A free daily dashboard that reads the market's mood and compares what different kinds of sources are saying: news channels, advisors and analysts, press releases, Reddit, global news, and events around New York City.

**Live site:** https://pulsehubmarkets.com

## How it works

```
 GitHub Action (every weekday after the close + every morning)
        │
        ▼
 scripts/fetch-data.mjs  ──calls──▶  free APIs + RSS feeds (no keys)
        │
        ▼
 data/latest.json   (today's numbers, headlines, events)
 data/history.json  (one summary row per day → trend charts)
        │  committed to the repo
        ▼
 GitHub Pages serves index.html + js/app.js, which read those JSON files
```

The browser never calls the APIs directly. That keeps the site fast, avoids CORS problems, and means no API keys are ever exposed.

## What it collects

| Area | Source | Key needed? |
|---|---|---|
| Index, stock and sector ETF prices (1 year) | Yahoo Finance chart API, Stooq as backup | No |
| CNN Fear & Greed | CNN data endpoint | No |
| Crypto prices and Crypto Fear & Greed | CoinGecko, alternative.me | No |
| Treasury yield curve | U.S. Treasury (home.treasury.gov) | No |
| News channels | CNBC, MarketWatch, WSJ, Yahoo Finance, NYT, BBC (RSS) | No |
| Advisors and analysts | Seeking Alpha, Nasdaq.com, Investing.com, Benzinga (RSS) | No |
| Press releases | PR Newswire, GlobeNewswire, SEC, Federal Reserve (RSS) | No |
| Global events | GDELT news tone + articles, BBC World, Al Jazeera, UN News, GDACS, USGS earthquakes | No |
| Social media buzz | ApeWisdom (Reddit mentions), Stocktwits trending | No |
| City events | NYC Open Data permitted events, Gothamist, NY1 | No |

If a source fails on a given day, everything else still updates. The **Data sources** tab shows what worked on the last run.

## Change what it tracks

Edit `scripts/config.json`: the watchlist, sector ETFs, RSS feeds, crypto coins, and the city events dataset. The next run picks up your changes.

## Run it on your computer

```bash
node scripts/make-sample-data.mjs   # fake data, for designing offline
node scripts/fetch-data.mjs         # real data (needs internet)
npx serve .                         # then open http://localhost:3000
```

Node 20 or newer is required (it has `fetch` built in). There are no npm dependencies.

## Run the update by hand

GitHub → **Actions** → **Update data daily** → **Run workflow**.

## Files

| File | What it does |
|---|---|
| `index.html` | Page layout and tabs |
| `css/styles.css` | All styling |
| `js/app.js` | Loads the JSON and draws each tab |
| `js/charts.js` | Small helpers around Chart.js |
| `js/format.js` | Number, date and color helpers |
| `scripts/fetch-data.mjs` | The daily data collector |
| `scripts/sentiment.mjs` | Headline tone scorer (word lists) |
| `scripts/config.json` | What to track |
| `.github/workflows/update-data.yml` | The schedule |

---

For information only. Not financial advice.
