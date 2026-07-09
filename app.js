/* Country Radar — client renderer.
 *
 * Live mode: set API_BASE to your deployed Cloudflare Worker; the app POSTs
 * {countries:[isoCodes]} to `${API_BASE}/api/radar`.
 * Demo mode (default, GitHub Pages): loads public/sample-radar.json.
 */
const API_BASE = "https://country-radar.trendible.workers.dev"; // "" = demo mode (sample data)
const MAX_COUNTRIES = 10;

const COUNTRIES = [
  ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["AU", "Australia"],
  ["IE", "Ireland"], ["IN", "India"], ["IT", "Italy"], ["DE", "Germany"], ["FR", "France"],
  ["ES", "Spain"], ["PT", "Portugal"], ["NL", "Netherlands"], ["BE", "Belgium"],
  ["CH", "Switzerland"], ["AT", "Austria"], ["SE", "Sweden"], ["NO", "Norway"],
  ["DK", "Denmark"], ["PL", "Poland"], ["BR", "Brazil"], ["MX", "Mexico"],
  ["AR", "Argentina"], ["JP", "Japan"], ["KR", "South Korea"], ["ZA", "South Africa"],
  ["AE", "UAE"], ["TR", "Turkey"], ["ID", "Indonesia"],
];
const CAT_COLORS = {
  Sports: "#34d399", Games: "#a78bfa", Shopping: "#f472b6", Entertainment: "#fb923c",
  Food: "#facc15", News: "#60a5fa", Weather: "#38bdf8", Tech: "#22d3ee",
};

const $ = (id) => document.getElementById(id);
const grid = $("grid"), hero = $("hero"), tooltip = $("tooltip");
const selected = new Set();

function flag(cc) {
  return [...cc.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join("");
}
function fmt(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "K";
  return String(n);
}
function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); }
const normQ = (q) => (q || "").toLowerCase().trim();

// --- country chips ---
function renderChips() {
  const el = $("countryChips");
  el.innerHTML = COUNTRIES.map(([code, name]) =>
    `<span class="chip" data-code="${code}" role="button" tabindex="0">
      <span class="fl">${flag(code)}</span>${esc(name)}</span>`).join("");
  el.querySelectorAll(".chip").forEach(chip => {
    const toggle = () => {
      const code = chip.dataset.code;
      if (selected.has(code)) { selected.delete(code); chip.classList.remove("on"); }
      else {
        if (selected.size >= MAX_COUNTRIES) return;
        selected.add(code); chip.classList.add("on");
      }
      updateControls();
    };
    chip.addEventListener("click", toggle);
    chip.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  });
}
function updateControls() {
  $("counter").textContent = `${selected.size} selected`;
  $("scanBtn").disabled = selected.size === 0;
  $("countryChips").querySelectorAll(".chip").forEach(c =>
    c.classList.toggle("disabled", !selected.has(c.dataset.code) && selected.size >= MAX_COUNTRIES));
}

// --- greedy spiral bubble packing (no external libs) ---
function pack(bubbles, W, H) {
  const cx = W / 2, cy = H / 2, placed = [];
  bubbles.forEach(b => {
    if (!placed.length) { b.x = cx; b.y = cy; placed.push(b); return; }
    for (let a = 0; a < 3000; a++) {
      const ang = a * 0.35, rad = 3 + 2.4 * ang;
      const x = cx + rad * Math.cos(ang), y = cy + rad * Math.sin(ang);
      if (x - b.r < 3 || x + b.r > W - 3 || y - b.r < 3 || y + b.r > H - 3) continue;
      let ok = true;
      for (const p of placed) { if (Math.hypot(x - p.x, y - p.y) < b.r + p.r + 2) { ok = false; break; } }
      if (ok) { b.x = x; b.y = y; placed.push(b); return; }
    }
    b.x = cx; b.y = cy; placed.push(b); // fallback (rare)
  });
  return placed;
}

// --- render ---
function renderRadar(data) {
  hero.hidden = true;
  const countries = data.countries || [];
  if (!countries.length) { grid.innerHTML = `<div class="loading">No trending data.</div>`; return; }

  // shared detection: normalised query -> set of country codes
  const seenIn = {};
  countries.forEach(c => (c.trends || []).forEach(t => {
    const k = normQ(t.q); (seenIn[k] = seenIn[k] || new Set()).add(c.code);
  }));
  const sharedCount = k => (seenIn[k] ? seenIn[k].size : 0);
  const globalMax = Math.max(1, ...countries.flatMap(c => (c.trends || []).map(t => t.v || 0)));

  // "trending everywhere" strip: queries in the most countries
  const sharedQ = Object.entries(seenIn).filter(([, s]) => s.size >= 2)
    .sort((a, b) => b[1].size - a[1].size).slice(0, 8);
  const strip = $("shared");
  if (sharedQ.length) {
    strip.hidden = false;
    strip.innerHTML = `<h3>🌍 Trending in multiple countries</h3>` +
      sharedQ.map(([q, s]) => `<span class="pill">${esc(q)} <b>${s.size}×</b></span>`).join("");
  } else strip.hidden = true;

  grid.innerHTML = countries.map(c => card(c, sharedCount, globalMax)).join("");
  wireTooltips();
}

function card(c, sharedCount, globalMax) {
  const W = 340, H = 300;
  const trends = (c.trends || []).slice(0, 12).map(t => {
    const shared = sharedCount(normQ(t.q)) >= 2;
    const r = 15 + 30 * Math.sqrt((t.v || 0) / globalMax);
    return { ...t, r, shared };
  }).sort((a, b) => b.r - a.r);
  pack(trends, W, H);

  let defs = "", circles = "";
  trends.forEach((b, i) => {
    const col = b.shared ? "#ffcf5c" : (CAT_COLORS[b.cat] || "#34d399");
    defs += `<radialGradient id="${c.code}-${i}" cx="0.35" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#fff" stop-opacity=".9"/>
      <stop offset="0.4" stop-color="${col}" stop-opacity=".95"/>
      <stop offset="1" stop-color="${col}" stop-opacity=".55"/></radialGradient>`;
    const showLabel = b.r >= 20;
    const fs = Math.max(8.5, Math.min(13, b.r / 2.7));
    const maxch = Math.max(4, Math.floor(b.r / 3.3));
    const lab = (b.q || "").length > maxch ? b.q.slice(0, maxch - 1) + "…" : b.q;
    circles += `<g class="bubble" data-q="${esc(b.q)}" data-v="${b.v}" data-cat="${esc(b.cat || "")}"
        data-news="${esc(b.news || "")}" data-shared="${b.shared ? sharedCount(normQ(b.q)) : 0}">
      <circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="${b.r.toFixed(1)}"
        fill="url(#${c.code}-${i})" stroke="${b.shared ? "#ffcf5c" : "rgba(255,255,255,.25)"}"
        stroke-width="${b.shared ? 1.6 : 1}"/>
      ${showLabel ? `<text class="bubble-label" x="${b.x.toFixed(1)}" y="${(b.y - 1).toFixed(1)}"
        text-anchor="middle" font-size="${fs.toFixed(1)}" fill="#06121a">${esc(lab)}</text>
      <text class="bubble-label" x="${b.x.toFixed(1)}" y="${(b.y + fs).toFixed(1)}"
        text-anchor="middle" font-size="${(fs * 0.8).toFixed(1)}" fill="#06121a" opacity=".7">${fmt(b.v)}</text>` : ""}
    </g>`;
  });

  const total = (c.trends || []).reduce((s, t) => s + (t.v || 0), 0);
  return `<div class="ctry-card">
    <h3><span class="fl">${c.flag || flag(c.code)}</span>${esc(c.name || c.code)}</h3>
    <p class="sub">${(c.trends || []).length} trending · ${fmt(total)} searches</p>
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${circles}</svg>
  </div>`;
}

// --- tooltips ---
function wireTooltips() {
  grid.querySelectorAll(".bubble").forEach(b => {
    b.addEventListener("mousemove", e => {
      const d = b.dataset;
      const sh = +d.shared;
      tooltip.innerHTML = `<div class="t-q">${esc(d.q)}</div>
        <div class="t-row"><b>${fmt(+d.v)}</b> searches${d.cat ? ` · ${esc(d.cat)}` : ""}</div>
        ${d.news ? `<div class="t-news">📰 ${esc(d.news)}</div>` : ""}
        ${sh >= 2 ? `<div class="t-shared">🌍 trending in ${sh} countries</div>` : ""}`;
      tooltip.hidden = false;
      tooltip.style.left = Math.min(e.clientX + 14, window.innerWidth - 290) + "px";
      tooltip.style.top = (e.clientY + 14) + "px";
    });
    b.addEventListener("mouseleave", () => tooltip.hidden = true);
  });
}

// --- fetch ---
async function getRadar(codes) {
  if (API_BASE) {
    const r = await fetch(`${API_BASE}/api/radar`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ countries: codes }),
    });
    if (!r.ok) throw new Error(r.status === 429 ? "Rate limit — try again shortly." : `Error ${r.status}.`);
    return r.json();
  }
  const data = await (await fetch("public/sample-radar.json")).json();
  data.demo = true;
  return data;
}

function showLoading(n) {
  hero.hidden = true; $("shared").hidden = true;
  grid.innerHTML = `<div class="loading" style="grid-column:1/-1"><div class="ring"></div>
    Scanning ${n} ${n === 1 ? "country" : "countries"}…</div>`;
}
function banner(msg, err) { const b = $("banner"); b.textContent = msg; b.hidden = false; b.classList.toggle("error", !!err); }

async function scan() {
  const codes = [...selected];
  showLoading(codes.length || 5);
  $("scanBtn").disabled = true;
  try {
    const data = await getRadar(codes);
    renderRadar(data);
    if (data.demo) banner("🎬 Demo mode — sample trending data. Deploy the free Worker (Google Trends RSS) for live data on any country (see README).");
    else $("banner").hidden = true;
  } catch (e) {
    grid.innerHTML = ""; banner(e.message || "Something went wrong.", true);
  } finally {
    $("scanBtn").disabled = selected.size === 0;
  }
}

// --- boot ---
renderChips();
$("scanBtn").addEventListener("click", scan);
$("tryDemo").addEventListener("click", () => {
  // preselect a few for the demo
  ["US", "GB", "IT", "DE", "FR", "ES", "PL"].forEach(c => { selected.add(c); });
  renderChips();
  selected.forEach(c => $("countryChips").querySelector(`[data-code="${c}"]`)?.classList.add("on"));
  updateControls();
  scan();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") tooltip.hidden = true; });
