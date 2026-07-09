/* Country Radar — Cloudflare Worker.
 *
 * POST /api/radar { countries: ["US","IT",...] } -> per-country trending searches.
 * Data source: Google Trends' free "Trending Now" RSS feed per country
 * (https://trends.google.com/trending/rss?geo=XX) — no API key, no provider,
 * no cost. The Worker fetches + parses it server-side. Stateless.
 */

const RATE = { max: 30, windowMs: 10 * 60 * 1000 };
const MAX_COUNTRIES = 10;
const TIMEOUT_MS = 15000;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...CORS } });

const NAMES = { US: "United States", GB: "United Kingdom", CA: "Canada", AU: "Australia", IE: "Ireland", IN: "India", IT: "Italy", DE: "Germany", FR: "France", ES: "Spain", PT: "Portugal", NL: "Netherlands", BE: "Belgium", CH: "Switzerland", AT: "Austria", SE: "Sweden", NO: "Norway", DK: "Denmark", PL: "Poland", BR: "Brazil", MX: "Mexico", AR: "Argentina", JP: "Japan", KR: "South Korea", ZA: "South Africa", AE: "UAE", TR: "Turkey", ID: "Indonesia" };
function flag(cc) { return [...cc.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join(""); }

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < RATE.windowMs);
  if (arr.length >= RATE.max) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}

function decode(s) {
  return (s || "")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
}
function parseTraffic(s) {
  if (!s) return 0;
  const m = String(s).replace(/[,+\s]/g, "").match(/([\d.]+)([KkMm]?)/);
  if (!m) return 0;
  const mult = m[2].toLowerCase() === "m" ? 1e6 : m[2].toLowerCase() === "k" ? 1e3 : 1;
  return Math.round(parseFloat(m[1]) * mult);
}
function parseRss(xml) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
  return items.map(it => {
    const t = (it.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const tr = (it.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/) || [])[1];
    const n = (it.match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/) || [])[1];
    return { q: decode(t).trim(), v: parseTraffic(tr), cat: null, news: decode(n) || null };
  }).filter(x => x.q);
}

async function fetchCountry(code) {
  const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(code)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const base = { code, name: NAMES[code] || code, flag: flag(code) };
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; CountryRadar/1.0)" },
      signal: ctrl.signal,
      cf: { cacheTtl: 600, cacheEverything: true }, // cache the feed ~10 min
    });
    if (!r.ok) return { ...base, trends: [] };
    const xml = await r.text();
    return { ...base, trends: parseRss(xml).slice(0, 15) };
  } catch {
    return { ...base, trends: [] };
  } finally { clearTimeout(timer); }
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname !== "/api/radar" || request.method !== "POST") return json({ error: "not found" }, 404);

    const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
    if (rateLimited(ip)) return json({ error: "rate_limited" }, 429);

    let body; try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
    let codes = Array.isArray(body.countries) ? body.countries.map(c => String(c).toUpperCase().slice(0, 2)) : [];
    codes = [...new Set(codes)].slice(0, MAX_COUNTRIES);
    if (!codes.length) return json({ error: "countries_required" }, 400);

    const countries = await Promise.all(codes.map(fetchCountry));
    return json({ countries });
  },
};
