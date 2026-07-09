# Deploying Country Radar

Static frontend (already live on GitHub Pages, demo mode) + a Cloudflare Worker
that holds your Apify token and fetches live trending searches.

## 1. Get an Apify token
- Sign up at [apify.com](https://apify.com/) (free tier ≈ $5/mo credit).
- **Settings → Integrations → API tokens** → copy your Personal API token (`apify_api_…`).

## 2. Pick the trending-searches actor
The Worker calls an Apify actor that returns Google **"trending searches"** per
country (no keyword). Set `ACTOR_ID` in [`worker/worker.js`](worker/worker.js) to
the chosen actor (e.g. one of the Google-Trends "trending now" actors on Apify),
and adjust the actor `input` + the `mapTrend()` mapper to that actor's fields.

> The mapper already handles common field names (`query`/`title`, `traffic`
> as `200K+`/number, `articles[0].title`). Test one country and tweak if needed.

## 3. Deploy the Worker
```bash
npm install -g wrangler
cd worker
wrangler login
wrangler secret put APIFY_TOKEN     # paste your apify_api_… token
wrangler deploy                     # prints https://country-radar.<subdomain>.workers.dev
```
Test:
```bash
curl -X POST https://country-radar.<subdomain>.workers.dev/api/radar \
  -H 'content-type: application/json' -d '{"countries":["US","IT"]}'
```

## 4. Point the frontend at your Worker
In [`app.js`](app.js), set:
```js
const API_BASE = "https://country-radar.<subdomain>.workers.dev";
```
Commit + push → GitHub Pages redeploys and the site goes live.

> Leave `API_BASE = ""` to keep the public site in demo mode (sample data, no cost).

## Run the frontend locally
```bash
python3 -m http.server 8080   # http://localhost:8080
```

## Knobs (in `worker/worker.js`)
- `RATE` — per-IP rate limit (default 30 / 10 min).
- `MAX_COUNTRIES` — cap per request (default 10).
- `TIMEOUT_MS` — Apify runs can be slow (cold starts); default 55s.
