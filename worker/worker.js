/* Country Radar — Cloudflare Worker (stateless proxy to Apify).
 *
 * Holds APIFY_TOKEN as a secret so it never reaches the browser.
 * POST /api/radar { countries: ["US","IT",...] } -> per-country trending searches.
 *
 * NOTE: the exact Apify actor id + input/output shape is finalised once the
 * token is available and the "trending searches" actor is picked/tested. The
 * mapper below (mapCountry) is where you adapt the actor's item shape to ours.
 */

// Apify actor that returns Google "trending searches" for a country (no keyword).
// Set to the chosen actor's id, e.g. "apify~google-trends-scraper".
const ACTOR_ID = "APIFY_ACTOR_ID_TBD";
const RATE = { max: 30, windowMs: 10 * 60 * 1000 };
const MAX_COUNTRIES = 10;
const TIMEOUT_MS = 55000;

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

// Adapt an Apify dataset item to one trend { q, v, cat, news }.
function mapTrend(item) {
  const q = item.query || item.title || item.term || item.keyword || "";
  // traffic can be "200K+", 200000, or a number-ish string
  let v = item.traffic ?? item.searchVolume ?? item.formattedTraffic ?? item.value ?? 0;
  if (typeof v === "string") {
    const m = v.replace(/[, ]/g, "").match(/([\d.]+)\s*([KkMm]?)/);
    v = m ? Math.round(parseFloat(m[1]) * (m[2].toLowerCase() === "m" ? 1e6 : m[2].toLowerCase() === "k" ? 1e3 : 1)) : 0;
  }
  const news = (item.articles && item.articles[0] && (item.articles[0].title || item.articles[0].snippet)) || item.news || item.relatedNews || null;
  const cat = item.category || item.categoryName || null;
  return { q: String(q), v: Number(v) || 0, cat, news };
}

async function fetchCountry(code, token) {
  // run the actor synchronously and read its dataset items
  const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const input = { geo: code, country: code, mode: "trending_searches", maxItems: 15 }; // TBD per actor
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(input), signal: ctrl.signal,
    });
    if (!r.ok) return { code, name: NAMES[code] || code, flag: flag(code), trends: [] };
    const items = await r.json();
    const trends = (Array.isArray(items) ? items : []).map(mapTrend).filter(t => t.q).slice(0, 15);
    return { code, name: NAMES[code] || code, flag: flag(code), trends };
  } catch {
    return { code, name: NAMES[code] || code, flag: flag(code), trends: [] };
  } finally { clearTimeout(timer); }
}

export default {
  async fetch(request, env) {
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
    if (!env.APIFY_TOKEN) return json({ error: "server_not_configured" }, 500);

    const countries = await Promise.all(codes.map(c => fetchCountry(c, env.APIFY_TOKEN)));
    return json({ countries });
  },
};
