# 🛰️ Country Radar

### What is the world searching, right now? Pick up to 10 countries and watch their trends surface as bubble charts.

![Live demo](https://img.shields.io/badge/▶%20Live-Demo-22d3ee?style=for-the-badge)
![Cloudflare Worker](https://img.shields.io/badge/edge-Cloudflare%20Worker-F38020?logo=cloudflare&logoColor=white)
![Google Trends](https://img.shields.io/badge/data-Google%20Trends%20(free)-4285F4?logo=google&logoColor=white)
![No accounts](https://img.shields.io/badge/no%20login-no%20storage-64748b)

Select up to **10 countries** and hit scan. Each country becomes a **bubble
chart** of its **trending searches** — the bigger the bubble, the bigger the
surge — and the tool highlights what's trending **everywhere** (a global wave)
vs. what's spiking **only locally** (a national pulse).

### 👉 **[Open the live demo →](https://growthwithjoseph-bot.github.io/country-radar/)**

---

## 💡 Why it matters (the business value)

Trends are a **leading indicator of attention** — and attention moves markets,
content calendars, and campaigns. Country Radar reads that pulse across borders
in one glance:

- 🌍 **Spot a global wave early** — a topic trending in 6 countries at once is a
  moment you can ride *now*, not next week.
- 📍 **Find the local angle** — what's spiking in Italy but nowhere else tells you
  where a market-specific play (or risk) is.
- 🗺️ **Prioritise markets** — see at a glance which countries are buzzing about
  your category and which are quiet.
- ⚡ **Move faster than the newsroom** — trending searches surface interest hours
  before it hits mainstream coverage.

**Who it's for:** 📣 marketers & social teams riding real-time moments · 📰
newsrooms & creators · 🚀 founders reading demand across markets · 🏢 agencies
briefing clients on "what's hot where."

---

## ✨ What you get

- 🫧 **A bubble chart per country** — trending searches sized by traffic.
- 🌍 **Shared-vs-unique highlighting** — gold = trending in several countries, green = a local-only spike.
- 📊 **"Trending in multiple countries"** strip — the cross-border waves at a glance.
- 🔎 **Hover any bubble** — search term, traffic, category, and a related headline.
- 🔒 **No accounts, no database, no API key** — live data on demand, straight from a free public feed.

---

## ⚙️ How it works

```
Browser (this SPA)  ──POST /api/radar { countries }──▶  Cloudflare Worker  ──▶  Google Trends "Trending Now" RSS
   renders bubble charts              (rate-limits, parses RSS, shapes JSON)            (free public feed, per country)
```

- **Frontend:** one static HTML/JS page — no build. Bubble charts are inline SVG with a lightweight circle-packing layout.
- **Worker:** stateless Cloudflare Worker; fetches the per-country feed, parses it, and shapes the response (edge-cached ~10 min).
- **Data:** Google Trends' free **"Trending Now" RSS** (`trends.google.com/trending/rss?geo=XX`) — trending queries per country, *without* a seed keyword and *without* an API key (DataForSEO's Trends is keyword-based, so it can't do this).

> **Demo mode** (`API_BASE = ""`): a bundled sample renders the full experience with no Worker at all.

---

## 🚀 Run / deploy

The live demo works with zero setup. For **real** data, deploy the free Worker
(no API key needed) and point the frontend at it — see **[DEPLOY.md](DEPLOY.md)**.

---

## 🧩 Part of a small toolkit for understanding markets

- 🛰️ **Country Radar** *(this repo)* — what's trending, per country, compared
- 🌊 **[Demand River](https://growthwithjoseph-bot.github.io/demand-river/)** — the questions a market asks, sized by search volume
- 🕸️ **[Topic Coverage](https://github.com/growthwithjoseph-bot/topic-coverage)** — who covers which topics across a site
- 🔤 **[Homepage Language Match](https://github.com/growthwithjoseph-bot/homepage-language-match)** — is your messaging differentiated?
- 💬 **[Anatomy of a Brand Conversation](https://growthwithjoseph-bot.github.io/hubspot-brand-conversation/)** — how people talk about a brand

---

<sub>Made with Trendible · trending data from Google Trends (free). Demo data is illustrative.</sub>
