# Deploying Country Radar

Static frontend (GitHub Pages) + a small Cloudflare Worker that fetches and
shapes **Google Trends' free "Trending Now" RSS** per country. **No API key, no
provider account, no cost** — the feed is public.

## 1. Deploy the Worker
```bash
npm install -g wrangler
cd worker
wrangler login
wrangler deploy          # prints https://country-radar.<subdomain>.workers.dev
```
There are **no secrets to set** — the data source is a public RSS feed.

Test:
```bash
curl -X POST https://country-radar.<subdomain>.workers.dev/api/radar \
  -H 'content-type: application/json' -d '{"countries":["US","IT"]}'
```

## 2. Point the frontend at your Worker
In [`app.js`](app.js), set:
```js
const API_BASE = "https://country-radar.<subdomain>.workers.dev";
```
Commit + push → GitHub Pages redeploys and the site goes live.

> Leave `API_BASE = ""` to keep the public site in demo mode (sample data).

## Run the frontend locally
```bash
python3 -m http.server 8080   # http://localhost:8080
```

## How the data works
The Worker fetches `https://trends.google.com/trending/rss?geo=XX` (XX = ISO
country code) and parses each `<item>` for:
- `<title>` → the trending search term
- `<ht:approx_traffic>` (`500+`, `200K+`, `2M+`) → an approximate volume
- `<ht:news_item_title>` → a related headline

The feed is edge-cached ~10 min (`cf.cacheTtl`), so repeat scans are instant and
cheap.

## Knobs (in `worker/worker.js`)
- `RATE` — per-IP rate limit (default 30 / 10 min).
- `MAX_COUNTRIES` — cap per request (default 10).
- `TIMEOUT_MS` — per-country fetch timeout (default 15s).
