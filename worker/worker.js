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

/* Optional AI layer: turn every (foreign-language) trend + its news headline
 * into a short English explanation, so a non-local reader can understand what's
 * actually trending. Provider-agnostic OpenAI-compatible chat API (Groq free
 * tier by default).
 *
 * ONE call for the whole scan — deliberately not per-country and not parallel:
 * a free-tier key rate-limits a concurrent burst (3+ simultaneous calls) to
 * zero, and a single sequential request is one hit against the limit. We give
 * it a high token ceiling and, if the JSON still comes back truncated, salvage
 * every complete {"i","en"} pair from the partial text so you get most of them
 * instead of none. If no key is set or the call fails, there are simply no
 * explanations — the tool never breaks on it. */
const AI_TIMEOUT_MS = 20000;
const AI_SYS = "You explain trending Google searches to someone who doesn't speak the local language. " +
  "For each item, write a SHORT English explanation (about 8-11 words, no more) of what it is and, if the headline shows it, why it's trending. " +
  "Use the news headline as context. Be factual; if unsure, give the most likely meaning of the term. " +
  'Return ONLY JSON: {"items":[{"i":<index>,"en":"..."}]} — one per input index, keep each "en" brief.';

async function interpret(countries, env, diag) {
  const key = env && env.LLM_API_KEY;
  if (!key) { if (diag) diag.reason = "no_key"; return; }
  const base = (env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = env.LLM_MODEL || "llama-3.3-70b-versatile";

  const flat = [];
  countries.forEach(c => (c.trends || []).forEach(t => flat.push(t)));
  if (!flat.length) return;
  // Order by volume (biggest bubbles first) and cap the batch to stay within
  // free-tier TPM (6000). If the model's output still overruns, it truncates
  // from the tail — i.e. the smallest, least-hovered trends — and salvage keeps
  // everything that did come back. Cap at 90 so input+output has headroom.
  const MAX_ITEMS = 90;
  const order = flat.map((_, i) => i).sort((a, b) => (flat[b].v || 0) - (flat[a].v || 0)).slice(0, MAX_ITEMS);
  const payload = order.map(i => ({ i, q: flat[i].q, news: (flat[i].news || "").slice(0, 40) }));
  const userContent = JSON.stringify({ items: payload });

  // Groq free tier caps at 6000 tokens/min and counts (input + max_tokens)
  // toward it. Estimate input tokens (~1 per 3.4 chars), then size max_tokens so
  // the whole request stays under the cap while leaving as much room as possible
  // for output. If the output still overflows, JSON mode returns a 400 with the
  // partial in error.failed_generation — we salvage complete pairs from it below.
  const estIn = Math.ceil((userContent.length + AI_SYS.length) / 2.9) + 120;
  const maxTok = Math.max(700, Math.min(3000, 5600 - estIn));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    // NOTE: deliberately NOT using response_format:json_object. Strict JSON mode
    // turns any minor malformation (one unescaped quote) into a 400 with the
    // whole output buried in error.failed_generation. Plain mode returns 200 and
    // we parse/salvage it ourselves — far more robust for a small local model.
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model, temperature: 0.2, max_tokens: maxTok,
        messages: [{ role: "system", content: AI_SYS }, { role: "user", content: userContent }],
      }),
    });
    const raw = await r.text();
    if (diag) { diag.sent = payload.length; diag.status = r.status; }
    // On success the text is in choices[].message.content. If a request ever
    // overruns and Groq returns a 400 with the partial output in
    // error.failed_generation, that's salvageable the same way.
    let content = "";
    try {
      const j = JSON.parse(raw);
      content = j.choices?.[0]?.message?.content || j.error?.failed_generation || "";
    } catch { /* leave content empty */ }
    if (!content) return;

    const byI = {};
    const clean = content.replace(/```json\s*|\s*```/g, "").trim(); // strip markdown fences if any
    let parsed = null;
    try { parsed = JSON.parse(clean); } catch { /* salvage below */ }
    if (parsed && Array.isArray(parsed.items)) {
      parsed.items.forEach(o => { if (typeof o.i === "number" && o.en) byI[o.i] = String(o.en).trim(); });
    }
    // Always run the tolerant salvage too (fills anything the strict parse missed
    // and rescues malformed items like {"i":2,"en:"..."} — small models drop the
    // closing quote). Resyncs on each "i":<n>, so one bad item can't break the rest.
    const re = /"i"\s*:\s*(\d+)\s*,\s*"?en"?\s*:\s*"([^"]*)"/g;
    let m; while ((m = re.exec(clean))) { const en = m[2].replace(/\\"/g, '"').replace(/\\n/g, " ").trim(); if (en && !byI[+m[1]]) byI[+m[1]] = en; }

    flat.forEach((t, i) => { if (byI[i]) t.en = byI[i]; });
    if (diag) diag.matched = Object.keys(byI).length;
  } catch (e) { if (diag) diag.reason = "exception:" + (e && e.name); }
  finally { clearTimeout(timer); }
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
    return { ...base, trends: parseRss(xml).slice(0, 10) };
  } catch {
    return { ...base, trends: [] };
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

    const countries = await Promise.all(codes.map(fetchCountry));
    const diag = url.searchParams.get("aidebug") ? {} : null;
    await interpret(countries, env, diag); // optional English explanations (no-op without a key)
    return json(diag ? { countries, _ai: diag } : { countries });
  },
};
