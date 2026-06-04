/**
 * Map HTML builder — pure string function. Given a GraphModel, emit a single
 * self-contained interactive HTML document (vis-network force graph + editorial
 * sidebar). No engine, no fs, no DOM — unit-testable in isolation.
 *
 * Reuses graphify's proven interaction model (vis.js force layout, search,
 * click-to-inspect, checkbox legend with select-all, forceAtlas2Based physics)
 * reimplemented in TypeScript, restyled to a gallery-grade light editorial
 * theme. The four refinements (neighborhood focus, rich node inspector,
 * typed/colored edges + relationship key) are elevated with custom canvas
 * rendering: glowing depth nodes (radial-gradient orbs + halo), frosted-glass
 * panels, tasteful motion (entrance + salient pulse), and app-like navigation
 * chrome (zoom/fit controls + minimap). All effects are pure canvas/CSS +
 * system fonts + inline SVG — no web fonts, no network, file stays offline.
 *
 * Injection safety: every data blob goes through `jsSafe` (escapes `<` to
 * `<`, so `</script>` and `<!--` cannot break out of the script tag); the
 * vendored vis bundle is trusted code inlined raw (verified to contain no
 * `</script>`). All page-derived text rendered into innerHTML at runtime is
 * `esc()`-escaped client-side.
 */

import type { GraphModel } from './graph-data.ts';
import { VIS_NETWORK_CDN_URL, VIS_NETWORK_SRI } from './assets.ts';

export interface BuildMapHtmlOpts {
  title?: string;
  generatedAt?: string;   // ISO string
  inlineAssets?: boolean; // default true; requires visJs
  visJs?: string;         // the vendored vis-network bundle (when inlining)
}

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON for safe inline-script embedding: neutralize every `<` so no tag can break out. */
function jsSafe(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function styles(): string {
  return `<style>
  :root {
    --bg: #FAF7F0; --bg-2: #F1EBDE;
    --panel: rgba(255, 253, 248, 0.72); --panel-solid: #FFFDF8;
    --ink: #2B2620; --ink-2: #463F34; --muted: #8C8170; --faint: #B3A892;
    --line: rgba(120, 104, 74, 0.14); --line-2: #E7E0D2;
    --accent: #B5773A; --accent-2: #C8A86A; --accent-soft: rgba(200, 168, 106, 0.18);
    --shadow: 0 14px 40px rgba(70, 56, 30, 0.16); --shadow-sm: 0 2px 10px rgba(70, 56, 30, 0.08);
    --radius: 16px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    height: 100vh; display: flex; overflow: hidden;
    background: linear-gradient(135deg, #FBF8F2 0%, #F2ECDF 100%); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  .serif { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; }
  ::-webkit-scrollbar { width: 9px; height: 9px; }
  ::-webkit-scrollbar-thumb { background: rgba(120, 104, 74, 0.22); border-radius: 9px; border: 2px solid transparent; background-clip: padding-box; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(120, 104, 74, 0.36); background-clip: padding-box; }

  /* ---- sidebar (frosted glass) ---- */
  #sidebar {
    width: 348px; min-width: 348px; height: 100vh; overflow-y: auto;
    background: var(--panel); -webkit-backdrop-filter: blur(16px) saturate(1.16); backdrop-filter: blur(16px) saturate(1.16);
    border-right: 1px solid var(--line-2); box-shadow: 3px 0 30px rgba(70, 56, 30, 0.06);
    display: flex; flex-direction: column; position: relative; z-index: 10;
    animation: fadeUp 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .side-pad { padding: 22px 22px 8px; }

  .masthead { display: flex; align-items: center; gap: 11px; margin-bottom: 16px; }
  .masthead .mark { flex-shrink: 0; filter: drop-shadow(0 2px 4px rgba(70, 56, 30, 0.12)); }
  .masthead .word { display: flex; flex-direction: column; line-height: 1.1; }
  .masthead .word b { font-family: "Iowan Old Style", Palatino, Georgia, serif; font-size: 16px; font-weight: 700; color: var(--ink); letter-spacing: 0.01em; }
  .masthead .word small { font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--faint); margin-top: 3px; }

  h1.title {
    font-family: "Iowan Old Style", Palatino, Georgia, serif;
    font-size: 26px; font-weight: 700; letter-spacing: -0.014em;
    margin: 0 0 8px; color: var(--ink); line-height: 1.12;
  }
  .subtitle { font-size: 12.5px; color: var(--muted); line-height: 1.55; margin: 0 0 16px; }
  .rule { height: 1px; background: linear-gradient(90deg, var(--line-2), transparent); margin: 0 0 16px; border: 0; }

  .search-wrap { position: relative; }
  .search-wrap svg { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); pointer-events: none; opacity: 0.5; }
  #search {
    width: 100%; padding: 11px 15px 11px 38px; border: 1px solid var(--line-2); border-radius: 999px;
    background: rgba(252, 250, 243, 0.8); font-size: 13.5px; color: var(--ink); outline: none;
    transition: border-color 0.16s, box-shadow 0.16s, background 0.16s;
  }
  #search::placeholder { color: var(--faint); }
  #search:focus { border-color: var(--accent-2); box-shadow: 0 0 0 3px var(--accent-soft); background: #fff; }
  #search-results {
    margin-top: 7px; max-height: 200px; overflow-y: auto; display: none;
    border: 1px solid var(--line-2); border-radius: 13px; background: var(--panel-solid);
    box-shadow: var(--shadow); overflow: hidden;
  }
  .sr-item {
    padding: 9px 13px; cursor: pointer; border-left: 3px solid transparent;
    display: flex; flex-direction: column; gap: 1px; transition: background 0.12s;
  }
  .sr-item:hover { background: #FBF6EA; }
  .sr-label { font-size: 13px; color: var(--ink); }
  .sr-slug { font-size: 11px; color: var(--faint); font-family: ui-monospace, Menlo, monospace; }

  .stats-row { display: flex; gap: 9px; margin: 18px 0 4px; }
  .stat-card {
    flex: 1; background: rgba(251, 247, 238, 0.7); border: 1px solid var(--line-2); border-radius: 14px;
    padding: 11px 12px; transition: transform 0.18s, box-shadow 0.18s; position: relative; overflow: hidden;
  }
  .stat-card::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent); }
  .stat-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-sm); }
  .stat-num { font-family: "Iowan Old Style", Palatino, Georgia, serif; font-size: 24px; font-weight: 700; color: var(--ink); line-height: 1; font-variant-numeric: tabular-nums; }
  .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--faint); margin-top: 5px; }

  .section-h {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.11em; color: var(--muted);
    margin: 24px 0 11px; font-weight: 600; display: flex; justify-content: space-between; align-items: center;
  }
  .sel-all-wrap { display: flex; align-items: center; gap: 5px; cursor: pointer; text-transform: none; letter-spacing: 0; color: var(--faint); font-weight: 500; }

  .lg-item, .rk-item {
    display: flex; align-items: center; gap: 10px; padding: 6px 7px; border-radius: 9px;
    cursor: pointer; font-size: 13px; color: var(--ink-2); user-select: none; transition: background 0.12s;
  }
  .lg-item:hover { background: #FAF5E9; }
  .lg-item.off { opacity: 0.4; }
  .lg-dot {
    width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0;
    box-shadow: 0 0 0 1px rgba(0,0,0,.05), inset 1px 1px 2px rgba(255,255,255,0.5);
  }
  .lg-label, .rk-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lg-count, .rk-count {
    color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums;
    background: rgba(120, 104, 74, 0.07); padding: 1px 8px; border-radius: 999px;
  }
  .lg-cb, #sel-all {
    appearance: none; -webkit-appearance: none; width: 15px; height: 15px; flex-shrink: 0;
    border: 1.5px solid #D6CCB6; border-radius: 4px; background: #fff; cursor: pointer; position: relative; transition: background 0.12s, border-color 0.12s;
  }
  .lg-cb:checked, #sel-all:checked { background: var(--accent); border-color: var(--accent); }
  .lg-cb:checked::after, #sel-all:checked::after {
    content: ''; position: absolute; left: 4px; top: 1px; width: 4px; height: 8px;
    border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg);
  }
  #sel-all:indeterminate { background: var(--accent); border-color: var(--accent); }
  #sel-all:indeterminate::after { content: ''; position: absolute; left: 2.5px; top: 6px; width: 8px; height: 2px; background: #fff; }

  .rk-line { width: 20px; height: 0; border-top: 2px solid #ccc; flex-shrink: 0; border-radius: 2px; }

  .foot { margin-top: auto; padding: 14px 22px; font-size: 11px; color: var(--faint); border-top: 1px solid var(--line); font-variant-numeric: tabular-nums; }

  /* ---- graph + overlays ---- */
  #graph-wrap { flex: 1; position: relative; min-width: 0; }
  #graph { position: absolute; inset: 0; }
  .overlay { position: absolute; z-index: 6; font-size: 12px; }
  .glass {
    background: var(--panel); -webkit-backdrop-filter: blur(13px) saturate(1.1); backdrop-filter: blur(13px) saturate(1.1);
    border: 1px solid var(--line-2); box-shadow: var(--shadow-sm);
  }
  #gen { top: 16px; left: 18px; color: var(--muted); font-variant-numeric: tabular-nums; padding: 5px 12px; border-radius: 999px; }
  #badge {
    top: 16px; right: 18px; color: var(--accent); padding: 5px 13px 5px 11px; border-radius: 999px;
    font-weight: 600; letter-spacing: 0.015em; display: flex; align-items: center; gap: 7px;
  }
  #badge .live { width: 7px; height: 7px; border-radius: 50%; background: #6FAE6F; box-shadow: 0 0 0 0 rgba(111,174,111,0.5); animation: pulse 2.4s ease-out infinite; }
  #reset-focus {
    bottom: 18px; right: 84px; display: none; cursor: pointer; align-items: center; gap: 6px;
    color: var(--ink-2); padding: 8px 15px; border-radius: 999px; font-size: 12px; font-weight: 600;
    transition: transform 0.15s, box-shadow 0.15s;
  }
  #reset-focus:hover { transform: translateY(-1px); box-shadow: var(--shadow); color: var(--ink); }

  /* ---- navigation chrome ---- */
  #controls { bottom: 18px; right: 18px; display: flex; flex-direction: column; gap: 0; border-radius: 13px; overflow: hidden; }
  #controls button {
    width: 38px; height: 36px; border: none; background: transparent; cursor: pointer;
    font-size: 17px; color: var(--ink-2); display: flex; align-items: center; justify-content: center;
    transition: background 0.12s; border-bottom: 1px solid var(--line);
  }
  #controls button:last-child { border-bottom: none; }
  #controls button:hover { background: #FAF5E9; color: var(--accent); }

  #minimap-wrap { bottom: 18px; left: 18px; padding: 7px; border-radius: 13px; line-height: 0; }
  #minimap { display: block; border-radius: 7px; cursor: crosshair; background: rgba(250, 246, 236, 0.5); }

  /* ---- inspector (frosted glass card) ---- */
  #inspector {
    position: absolute; top: 56px; right: 18px; width: 286px; z-index: 7;
    background: var(--panel); -webkit-backdrop-filter: blur(18px) saturate(1.2); backdrop-filter: blur(18px) saturate(1.2);
    border: 1px solid var(--line-2); border-radius: var(--radius);
    box-shadow: var(--shadow); padding: 18px 18px 16px;
    max-height: calc(100vh - 92px); overflow-y: auto;
    opacity: 0; transform: translateY(8px) scale(0.98); pointer-events: none;
    transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  }
  #inspector.show { opacity: 1; transform: none; pointer-events: auto; }
  .insp-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .mono {
    width: 42px; height: 42px; min-width: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
    font-family: "Iowan Old Style", Palatino, Georgia, serif; font-size: 20px; font-weight: 700; color: #fff;
    box-shadow: 0 4px 12px rgba(70, 56, 30, 0.2), inset 0 1px 2px rgba(255,255,255,0.5); text-shadow: 0 1px 2px rgba(0,0,0,0.18);
  }
  .insp-head-t { min-width: 0; }
  .insp-title { font-family: "Iowan Old Style", Palatino, Georgia, serif; font-size: 17px; font-weight: 700; color: var(--ink); line-height: 1.22; }
  .insp-chip { display: inline-block; margin-top: 5px; font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 999px; letter-spacing: 0.02em; }
  .insp-row { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; color: var(--ink-2); margin: 7px 0; }
  .insp-k { color: var(--faint); }
  .insp-v { color: var(--ink-2); }
  .sal-wrap { display: flex; align-items: center; gap: 8px; }
  .sal-bar { width: 92px; height: 7px; border-radius: 999px; background: rgba(120, 104, 74, 0.12); overflow: hidden; }
  .sal-fill { height: 100%; background: linear-gradient(90deg, var(--accent-2), var(--accent)); border-radius: 999px; }
  .sal-num { font-size: 11px; color: var(--muted); min-width: 20px; text-align: right; font-variant-numeric: tabular-nums; }
  .nb-h { font-size: 10px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--faint); margin: 14px 0 6px; font-weight: 600; }
  .nb {
    display: flex; align-items: center; gap: 7px; padding: 5px 8px; margin: 3px 0; border-radius: 7px;
    cursor: pointer; font-size: 12px; color: var(--ink-2); overflow: hidden; transition: background 0.12s;
  }
  .nb:hover { background: #FAF5E9; }
  .nb-tick { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .nb-verb { color: var(--faint); }
  .nb-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nb-empty { font-size: 12px; color: var(--faint); font-style: italic; padding: 2px 0; }
  .insp-open { margin-top: 16px; }
  .open-link {
    display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #fff; text-decoration: none; font-weight: 600;
    background: linear-gradient(135deg, var(--accent), #9A6429); padding: 8px 15px; border-radius: 999px;
    box-shadow: 0 4px 12px rgba(154, 100, 41, 0.28); transition: transform 0.15s, box-shadow 0.15s;
  }
  .open-link:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(154, 100, 41, 0.36); }
  .open-link .arr { font-size: 13px; }
  .slug-row { display: flex; align-items: center; gap: 8px; }
  .slug-row code { font-size: 11px; color: var(--muted); background: rgba(120, 104, 74, 0.08); padding: 4px 8px; border-radius: 7px; overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .copy-btn { font-size: 11px; color: var(--ink-2); background: var(--panel-solid); border: 1px solid var(--line-2); border-radius: 7px; padding: 4px 10px; cursor: pointer; transition: background 0.12s; }
  .copy-btn:hover { background: #FAF5E9; }

  @keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(111,174,111,0.5); } 70% { box-shadow: 0 0 0 6px rgba(111,174,111,0); } 100% { box-shadow: 0 0 0 0 rgba(111,174,111,0); } }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
</style>`;
}

export function buildMapHtml(model: GraphModel, opts: BuildMapHtmlOpts = {}): string {
  const title = opts.title ?? 'gbrain · Link Map';
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const genShort = generatedAt.replace('T', ' ').slice(0, 16) + ' UTC';
  const scopeLabel = model.allSources ? 'all sources' : (model.sourceId ?? 'default');
  const inline = opts.inlineAssets !== false && !!opts.visJs;

  const clientNodes = model.nodes.map((n) => ({
    id: n.id, label: n.title, slug: n.slug, type: n.type,
    cat: n.category, catColor: n.color, fill: n.color, border: n.border,
    size: n.size, lab: n.labelVisible, sal: n.salience,
    deg: n.degree, ind: n.inDegree, outd: n.outDegree, href: n.href,
  }));
  const clientEdges = model.edges.map((e) => ({ f: e.from, t: e.to, lt: e.linkType, col: e.color, dash: e.dashed }));
  const clientLegend = model.legend.map((l) => ({ key: l.key, label: l.label, color: l.color, count: l.count }));
  const clientRelKey = model.relKey.map((r) => ({ label: r.label, color: r.color, count: r.count }));
  const config = { weightBy: model.weightBy, scope: scopeLabel };

  const visHead = inline
    ? `<script>${opts.visJs}</script>`
    : `<script src="${VIS_NETWORK_CDN_URL}" integrity="${VIS_NETWORK_SRI}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`;

  const dataScript =
    `const RAW_NODES=${jsSafe(clientNodes)};` +
    `const RAW_EDGES=${jsSafe(clientEdges)};` +
    `const LEGEND=${jsSafe(clientLegend)};` +
    `const REL_KEY=${jsSafe(clientRelKey)};` +
    `const CONFIG=${jsSafe(config)};`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
${visHead}
${styles()}
</head>
<body>
<div id="sidebar">
  <div class="side-pad">
    <div class="masthead">
      <svg class="mark" width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
        <line x1="8" y1="22" x2="15" y2="9" stroke="#C8A86A" stroke-width="1.5"/>
        <line x1="15" y1="9" x2="23" y2="19" stroke="#C8A86A" stroke-width="1.5"/>
        <line x1="8" y1="22" x2="23" y2="19" stroke="#E0D6BE" stroke-width="1.3"/>
        <circle cx="15" cy="9" r="4.4" fill="#B5773A"/>
        <circle cx="8" cy="22" r="3.2" fill="#4F9D69"/>
        <circle cx="23" cy="19" r="3.2" fill="#3E6DB0"/>
      </svg>
      <span class="word"><b>gbrain</b><small>Link Map</small></span>
    </div>
    <h1 class="title">${escHtml(title)}</h1>
    <p class="subtitle">An interactive map of your brain's durable wiki-link graph. Click a node to focus its neighborhood.</p>
    <hr class="rule">
    <div class="search-wrap">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="#8C8170" stroke-width="1.6"/><line x1="10.8" y1="10.8" x2="14" y2="14" stroke="#8C8170" stroke-width="1.6" stroke-linecap="round"/></svg>
      <input id="search" type="text" placeholder="Search title or slug…" autocomplete="off" spellcheck="false">
    </div>
    <div id="search-results"></div>
    <div class="stats-row">
      <div class="stat-card"><div class="stat-num">${model.stats.nodes}</div><div class="stat-label">Nodes</div></div>
      <div class="stat-card"><div class="stat-num">${model.stats.edges}</div><div class="stat-label">Edges</div></div>
      <div class="stat-card"><div class="stat-num">${model.legend.length}</div><div class="stat-label">Topics</div></div>
    </div>
    <div class="section-h"><span>Topics</span><label class="sel-all-wrap"><input type="checkbox" id="sel-all" checked> all</label></div>
    <div id="legend"></div>
    <div id="relkey-section">
      <div class="section-h"><span>Relationships</span></div>
      <div id="relkey"></div>
    </div>
  </div>
  <div class="foot">Generated ${escHtml(genShort)} · scope: ${escHtml(scopeLabel)} · sized by ${escHtml(model.weightBy)}</div>
</div>
<div id="graph-wrap">
  <div id="graph"></div>
  <div class="overlay glass" id="gen">Generated ${escHtml(genShort)}</div>
  <div class="overlay glass" id="badge"><span class="live"></span>Local HTML map</div>
  <button class="overlay glass" id="reset-focus">↺ Reset focus</button>
  <div class="overlay glass" id="controls">
    <button id="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
    <button id="zoom-out" title="Zoom out" aria-label="Zoom out">−</button>
    <button id="fit" title="Fit to screen" aria-label="Fit to screen">⤢</button>
  </div>
  <div class="overlay glass" id="minimap-wrap"><canvas id="minimap" width="176" height="120"></canvas></div>
  <div id="inspector"></div>
</div>
<script>
${dataScript}
${CLIENT_JS}
</script>
</body>
</html>`;
}

/**
 * Client-side interaction logic. Written with plain string concatenation (no
 * template literals, no `${`) so the enclosing TS template literal injects only
 * the data blobs above. References the injected globals RAW_NODES/RAW_EDGES/
 * LEGEND/REL_KEY/CONFIG and the `vis` global from the vis-network bundle.
 */
const CLIENT_JS = `
(function(){
  if (typeof vis === 'undefined') {
    document.getElementById('graph').innerHTML =
      '<p style="padding:40px;color:#9A8E78;font-family:sans-serif">vis-network failed to load. If you used --cdn, check your network connection.</p>';
    return;
  }

  // ---- small color helpers (port of palette.ts math) ----
  function hexToRgb(h){ h = String(h || '#888').replace('#',''); if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; var n = parseInt(h, 16); return [(n>>16)&255, (n>>8)&255, n&255]; }
  function clamp255(v){ v = Math.round(v); return v < 0 ? 0 : v > 255 ? 255 : v; }
  function toHex(r,g,b){ function c(v){ return ('0' + clamp255(v).toString(16)).slice(-2); } return '#' + c(r) + c(g) + c(b); }
  function lighten(hex, f){ var a = hexToRgb(hex); return toHex(a[0]+(255-a[0])*f, a[1]+(255-a[1])*f, a[2]+(255-a[2])*f); }
  function darken(hex, f){ var a = hexToRgb(hex), k = 1-f; return toHex(a[0]*k, a[1]*k, a[2]*k); }
  function rgba(hex, al){ var a = hexToRgb(hex); return 'rgba(' + a[0] + ',' + a[1] + ',' + a[2] + ',' + al + ')'; }

  function esc(s){
    s = (s == null ? '' : String(s));
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function human(lt){ return (lt || 'link').replace(/_/g, ' '); }
  function ease3(x){ return 1 - Math.pow(1 - x, 3); }
  function roundRect(ctx, x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

  // ---- derived node data + performance / a11y gates ----
  var NODE_BY_ID = {}, TITLE_BY_ID = {};
  RAW_NODES.forEach(function(n){
    NODE_BY_ID[n.id] = n; TITLE_BY_ID[n.id] = n.label;
    n._light = lighten(n.fill, 0.32); n._ring = darken(n.fill, 0.24);
  });
  var prefersReduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var RICH = RAW_NODES.length <= 600;                              // gradient + glow per node
  var MOTION = !prefersReduce && RAW_NODES.length <= 350;          // entrance + (maybe) pulse
  var pulseSet = {};
  RAW_NODES.filter(function(n){ return n.sal >= 0.6; })
    .sort(function(a,b){ return b.sal - a.sal; }).slice(0, 12)
    .forEach(function(n){ pulseSet[n.id] = n.sal; });
  var PULSE = MOTION && RAW_NODES.length <= 200 && Object.keys(pulseSet).length > 0;

  // ---- animation state read by the custom node renderer ----
  var entrance = MOTION ? 0 : 1;   // 0..1 entrance progress (eased)
  var pulseT = 0;                  // seconds accumulator for the salient pulse
  var keepSet = null;              // focus neighborhood {id:true} or null
  var focusEase = 0;               // 0..1 dim strength while a node is focused
  function dimFor(id){ if (!keepSet) return 1; return keepSet[id] ? 1 : (1 - 0.86 * focusEase); }

  // ---- custom node body (glowing depth orb) ----
  function drawBody(ctx, x, y, r, n, hover, alpha){
    ctx.save();
    ctx.globalAlpha = alpha;
    if (RICH){
      var pulse = (PULSE && pulseSet[n.id]) ? (Math.sin(pulseT * 1.8 + (n.id % 9)) * 0.5 + 0.5) : 0;
      var glowR = r * (hover ? 2.5 : 2.0) * (1 + 0.16 * pulse);
      var g = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowR);
      g.addColorStop(0, rgba(n.fill, (hover ? 0.42 : 0.26) * (1 + 0.3 * pulse)));
      g.addColorStop(1, rgba(n.fill, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, glowR, 0, 6.2832); ctx.fill();
      var bg = ctx.createRadialGradient(x - r*0.35, y - r*0.4, r*0.1, x, y, r);
      bg.addColorStop(0, n._light); bg.addColorStop(1, n.fill);
      ctx.fillStyle = bg;
    } else {
      ctx.fillStyle = n.fill;
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    ctx.lineWidth = hover ? 2.2 : 1.5; ctx.strokeStyle = hover ? darken(n.fill, 0.04) : n._ring;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke();
    if (hover){ ctx.lineWidth = 1; ctx.strokeStyle = rgba(n.fill, 0.45); ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 6.2832); ctx.stroke(); }
    if (RICH){
      ctx.globalAlpha = alpha * 0.5;
      var hl = ctx.createRadialGradient(x - r*0.4, y - r*0.45, 0, x - r*0.4, y - r*0.45, r*0.85);
      hl.addColorStop(0, 'rgba(255,255,255,0.75)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl; ctx.beginPath(); ctx.arc(x - r*0.3, y - r*0.34, r*0.55, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }

  function makeNode(n){
    return {
      id: n.id, shape: 'custom', size: n.size,
      color: { background: n.fill, border: n._ring },
      title: esc(n.label) + '  ·  ' + esc(n.slug),
      ctxRenderer: function(a){
        var ctx = a.ctx, x = a.x, y = a.y, st = a.state || {}, sz = n.size;
        var hover = !!(st.hover || st.selected);
        var dim = dimFor(n.id), ent = entrance;
        var r = sz * (0.45 + 0.55 * ent) * (hover ? 1.16 : 1);
        var alpha = dim * (0.1 + 0.9 * ent);
        return {
          drawNode: function(){ drawBody(ctx, x, y, r, n, hover, alpha); },
          drawExternalLabel: function(){
            var show = n.lab || hover || (keepSet && keepSet[n.id]);
            if (!show || ent < 0.55) return;
            var la = dim * Math.min(1, (ent - 0.55) / 0.45);
            if (la <= 0.02) return;
            ctx.save();
            ctx.globalAlpha = la;
            var fs = hover ? 13 : 12;
            ctx.font = '600 ' + fs + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            var tw = ctx.measureText(n.label).width;
            var padX = 8, bh = fs + 9, bw = tw + padX * 2, by = y + r + 8, bx = x - bw / 2;
            roundRect(ctx, bx, by, bw, bh, bh / 2);
            ctx.fillStyle = 'rgba(255,253,248,0.86)'; ctx.fill();
            ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(120,104,74,0.18)'; ctx.stroke();
            ctx.fillStyle = '#3A352C'; ctx.fillText(n.label, x, by + bh / 2 + 0.5);
            ctx.restore();
          },
          nodeDimensions: { width: sz * 2, height: sz * 2 }
        };
      }
    };
  }

  var nodesDS = new vis.DataSet(RAW_NODES.map(makeNode));
  var edgesDS = new vis.DataSet(RAW_EDGES.map(function(e, i){
    return {
      id: i, from: e.f, to: e.t, dashes: !!e.dash, width: 1.1, selectionWidth: 1.8,
      title: esc(TITLE_BY_ID[e.f] || e.f) + '  —' + esc(human(e.lt)) + '→  ' + esc(TITLE_BY_ID[e.t] || e.t),
      color: { inherit: 'both', opacity: 0.5 },
      arrows: { to: { enabled: true, scaleFactor: 0.38, type: 'arrow' } },
      smooth: { type: 'continuous', roundness: 0.2 }
    };
  }));

  var container = document.getElementById('graph');
  var network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, {
    physics: {
      enabled: true, solver: 'forceAtlas2Based',
      forceAtlas2Based: { gravitationalConstant: -62, centralGravity: 0.006, springLength: 135, springConstant: 0.08, damping: 0.5, avoidOverlap: 0.75 },
      stabilization: { iterations: 260, fit: true }
    },
    interaction: { hover: true, tooltipDelay: 140, hideEdgesOnDrag: true, navigationButtons: false, keyboard: false, multiselect: false },
    nodes: { shape: 'dot' },
    edges: { color: { inherit: 'both', opacity: 0.5 }, smooth: { type: 'continuous', roundness: 0.2 } }
  });

  // ---- gallery background: cached vignette + faint dot grid (screen-fixed) ----
  var bgCanvas = document.createElement('canvas'), bgW = 0, bgH = 0;
  function ensureBg(w, h){
    if (w === bgW && h === bgH) return;
    bgW = w; bgH = h; bgCanvas.width = w; bgCanvas.height = h;
    var c = bgCanvas.getContext('2d');
    var vg = c.createRadialGradient(w*0.5, h*0.4, Math.min(w,h)*0.08, w*0.5, h*0.5, Math.max(w,h)*0.78);
    vg.addColorStop(0, '#FDFBF6'); vg.addColorStop(0.6, '#F8F3E9'); vg.addColorStop(1, '#EFE7D8');
    c.fillStyle = vg; c.fillRect(0, 0, w, h);
    var dpr = window.devicePixelRatio || 1, step = 30 * dpr;
    c.fillStyle = 'rgba(120,104,74,0.05)';
    for (var gx = step; gx < w; gx += step){ for (var gy = step; gy < h; gy += step){ c.beginPath(); c.arc(gx, gy, 1.1 * dpr, 0, 6.2832); c.fill(); } }
  }
  network.on('beforeDrawing', function(ctx){
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ensureBg(ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(bgCanvas, 0, 0);
    ctx.restore();
  });

  // ---- motion loop (entrance ease + salient pulse) ----
  var motionRaf = null, lastTs = 0, entStart = 0;
  function motionTick(ts){
    if (document.hidden){ motionRaf = null; return; }
    if (!entStart) entStart = ts;
    var dt = lastTs ? (ts - lastTs) / 1000 : 0; lastTs = ts;
    if (PULSE) pulseT += dt;
    if (entrance < 1){ entrance = ease3(Math.min(1, (ts - entStart) / 720)); }
    network.redraw();
    if (entrance < 1 || PULSE) motionRaf = requestAnimationFrame(motionTick); else motionRaf = null;
  }
  function startMotion(){ if (motionRaf == null){ lastTs = 0; entStart = 0; motionRaf = requestAnimationFrame(motionTick); } }
  document.addEventListener('visibilitychange', function(){ if (!document.hidden && (entrance < 1 || PULSE)) startMotion(); });

  network.once('stabilizationIterationsDone', function(){
    network.setOptions({ physics: { enabled: false } });
    computeBounds(); drawMinimap();
    if (MOTION){ entrance = 0; startMotion(); } else { entrance = 1; network.redraw(); }
  });

  // ---- neighborhood focus (dim animated through the renderer) ----
  var focusRaf = null;
  function tweenFocus(to, dur){
    if (prefersReduce){ focusEase = to; if (to === 0) keepSet = null; network.redraw(); return; }
    if (focusRaf) cancelAnimationFrame(focusRaf);
    var from = focusEase, st = performance.now();
    function step(t){
      var p = Math.min(1, (t - st) / dur);
      focusEase = from + (to - from) * ease3(p);
      network.redraw();
      if (p < 1) focusRaf = requestAnimationFrame(step);
      else { focusRaf = null; if (to === 0) keepSet = null; network.redraw(); }
    }
    focusRaf = requestAnimationFrame(step);
  }
  function applyFocus(id){
    keepSet = {}; keepSet[id] = true;
    network.getConnectedNodes(id).forEach(function(k){ keepSet[k] = true; });
    var conn = {}; network.getConnectedEdges(id).forEach(function(ei){ conn[ei] = true; });
    edgesDS.update(RAW_EDGES.map(function(e, i){
      return conn[i]
        ? { id: i, color: { color: e.col, opacity: 0.95, inherit: false } }
        : { id: i, color: { inherit: 'both', opacity: 0.05 } };
    }));
    document.getElementById('reset-focus').style.display = 'inline-flex';
    tweenFocus(1, 260);
  }
  function clearFocus(){
    edgesDS.update(RAW_EDGES.map(function(e, i){ return { id: i, color: { inherit: 'both', opacity: 0.5 } }; }));
    document.getElementById('reset-focus').style.display = 'none';
    tweenFocus(0, 220);
  }
  function closeInspector(){ document.getElementById('inspector').className = ''; }
  document.getElementById('reset-focus').addEventListener('click', function(){ clearFocus(); closeInspector(); });

  // ---- inspector ----
  function salBar(p){
    var pct = Math.round((p || 0) * 100);
    return '<div class="sal-bar"><div class="sal-fill" style="width:' + pct + '%"></div></div><span class="sal-num">' + pct + '</span>';
  }
  function neighborRows(list, dir){
    if (!list.length) return '<div class="nb-empty">none</div>';
    return list.slice(0, 50).map(function(e){
      var otherId = dir === 'out' ? e.t : e.f;
      var o = NODE_BY_ID[otherId];
      if (!o) return '';
      return '<div class="nb" onclick="__focusFrom(' + JSON.stringify(otherId) + ')">' +
        '<span class="nb-tick" style="background:' + esc(o.catColor) + '"></span>' +
        '<span class="nb-verb">' + esc(human(e.lt)) + '</span> <span class="nb-name">' + esc(o.label) + '</span></div>';
    }).join('');
  }
  function showInspector(id){
    var n = NODE_BY_ID[id]; if (!n) return;
    var outs = [], ins = [];
    RAW_EDGES.forEach(function(e){ if (e.f === id) outs.push(e); else if (e.t === id) ins.push(e); });
    var initial = ((n.label || '?').replace(/^[^A-Za-z0-9]+/, '').charAt(0) || '•').toUpperCase();
    var openBlock = n.href
      ? '<a class="open-link" href="' + esc(n.href) + '" target="_blank" rel="noopener">Open page <span class="arr">\\u2197</span></a>'
      : '<div class="slug-row"><code id="__slug">' + esc(n.slug) + '</code><button class="copy-btn" onclick="__copySlug()">Copy</button></div>';
    document.getElementById('inspector').innerHTML =
      '<div class="insp-head">' +
        '<div class="mono" style="background:radial-gradient(circle at 32% 30%, ' + esc(lighten(n.fill, 0.36)) + ', ' + esc(n.fill) + ')">' + esc(initial) + '</div>' +
        '<div class="insp-head-t"><div class="insp-title">' + esc(n.label) + '</div>' +
        '<span class="insp-chip" style="background:' + esc(rgba(n.fill, 0.15)) + ';color:' + esc(darken(n.fill, 0.18)) + '">' + esc(n.type || n.cat) + '</span></div>' +
      '</div>' +
      '<div class="insp-row"><span class="insp-k">Salience</span><span class="insp-v sal-wrap">' + salBar(n.sal) + '</span></div>' +
      '<div class="insp-row"><span class="insp-k">Connections</span><span class="insp-v">' + n.outd + ' out · ' + n.ind + ' in</span></div>' +
      '<div class="nb-h">Links out</div>' + neighborRows(outs, 'out') +
      '<div class="nb-h">Backlinks (in)</div>' + neighborRows(ins, 'in') +
      '<div class="insp-open">' + openBlock + '</div>';
    document.getElementById('inspector').className = 'show';
  }
  window.__focusFrom = function(id){ network.focus(id, { scale: 1.3, animation: { duration: 480, easingFunction: 'easeInOutCubic' } }); network.selectNodes([id]); applyFocus(id); showInspector(id); };
  window.__copySlug = function(){ var c = document.getElementById('__slug'); if (c && navigator.clipboard) navigator.clipboard.writeText(c.textContent); };

  // ---- events ----
  network.on('click', function(p){
    if (p.nodes && p.nodes.length){ applyFocus(p.nodes[0]); showInspector(p.nodes[0]); }
    else { clearFocus(); closeInspector(); }
  });
  network.on('doubleClick', function(p){ if (p.nodes && p.nodes.length) network.focus(p.nodes[0], { scale: 1.8, animation: { duration: 520, easingFunction: 'easeInOutCubic' } }); });
  network.on('hoverNode', function(){ container.style.cursor = 'pointer'; network.redraw(); });
  network.on('blurNode', function(){ container.style.cursor = 'default'; network.redraw(); });

  // ---- navigation chrome (zoom / fit) ----
  function zoomBy(f){ network.moveTo({ scale: network.getScale() * f, animation: { duration: 240, easingFunction: 'easeInOutCubic' } }); }
  document.getElementById('zoom-in').addEventListener('click', function(){ zoomBy(1.3); });
  document.getElementById('zoom-out').addEventListener('click', function(){ zoomBy(1 / 1.3); });
  document.getElementById('fit').addEventListener('click', function(){ clearFocus(); closeInspector(); network.fit({ animation: { duration: 480, easingFunction: 'easeInOutCubic' } }); });

  // ---- minimap ----
  var mm = document.getElementById('minimap'), mctx = mm.getContext('2d'), mmBounds = null;
  function computeBounds(){
    var pos = network.getPositions(), xs = [], ys = [];
    for (var k in pos){ xs.push(pos[k].x); ys.push(pos[k].y); }
    if (!xs.length){ mmBounds = null; return; }
    mmBounds = { minX: Math.min.apply(null, xs), maxX: Math.max.apply(null, xs), minY: Math.min.apply(null, ys), maxY: Math.max.apply(null, ys) };
  }
  function mmTransform(){
    var W = mm.width, H = mm.height, pad = 10;
    var bw = (mmBounds.maxX - mmBounds.minX) || 1, bh = (mmBounds.maxY - mmBounds.minY) || 1;
    var s = Math.min((W - 2*pad) / bw, (H - 2*pad) / bh);
    return { s: s, ox: (W - bw*s) / 2 - mmBounds.minX*s, oy: (H - bh*s) / 2 - mmBounds.minY*s };
  }
  function drawMinimap(){
    if (!mmBounds) return;
    var W = mm.width, H = mm.height; mctx.clearRect(0, 0, W, H);
    var t = mmTransform(), pos = network.getPositions();
    RAW_NODES.forEach(function(n){ var p = pos[n.id]; if (!p) return; mctx.fillStyle = n.fill; mctx.globalAlpha = 0.9; mctx.beginPath(); mctx.arc(p.x*t.s + t.ox, p.y*t.s + t.oy, 1.7, 0, 6.2832); mctx.fill(); });
    mctx.globalAlpha = 1;
    var scale = network.getScale(), vc = network.getViewPosition();
    var cw = container.clientWidth / scale, ch = container.clientHeight / scale;
    mctx.strokeStyle = 'rgba(150,110,50,0.85)'; mctx.lineWidth = 1.5;
    mctx.strokeRect((vc.x - cw/2)*t.s + t.ox, (vc.y - ch/2)*t.s + t.oy, cw*t.s, ch*t.s);
  }
  network.on('afterDrawing', function(){ drawMinimap(); });
  mm.addEventListener('click', function(ev){
    if (!mmBounds) return;
    var rect = mm.getBoundingClientRect(), t = mmTransform();
    var mx = (ev.clientX - rect.left) * (mm.width / rect.width), my = (ev.clientY - rect.top) * (mm.height / rect.height);
    network.moveTo({ position: { x: (mx - t.ox) / t.s, y: (my - t.oy) / t.s }, animation: { duration: 320, easingFunction: 'easeInOutCubic' } });
  });

  // ---- search ----
  var sIn = document.getElementById('search'), sRes = document.getElementById('search-results');
  sIn.addEventListener('input', function(){
    var q = sIn.value.toLowerCase().trim(); sRes.innerHTML = '';
    if (!q){ sRes.style.display = 'none'; return; }
    var m = RAW_NODES.filter(function(n){ return n.label.toLowerCase().indexOf(q) >= 0 || n.slug.toLowerCase().indexOf(q) >= 0; }).slice(0, 18);
    if (!m.length){ sRes.style.display = 'none'; return; }
    sRes.style.display = 'block';
    m.forEach(function(n){
      var d = document.createElement('div'); d.className = 'sr-item'; d.style.borderLeftColor = n.catColor;
      d.innerHTML = '<span class="sr-label">' + esc(n.label) + '</span><span class="sr-slug">' + esc(n.slug) + '</span>';
      d.onclick = function(){ network.focus(n.id, { scale: 1.4, animation: { duration: 480, easingFunction: 'easeInOutCubic' } }); network.selectNodes([n.id]); applyFocus(n.id); showInspector(n.id); sRes.style.display = 'none'; sIn.value = ''; };
      sRes.appendChild(d);
    });
  });
  document.addEventListener('click', function(ev){ if (ev.target !== sIn && !sRes.contains(ev.target)) sRes.style.display = 'none'; });

  // ---- legend (topic filters) ----
  var hiddenCats = {};
  var legendEl = document.getElementById('legend');
  LEGEND.forEach(function(c){
    var item = document.createElement('label'); item.className = 'lg-item';
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.className = 'lg-cb';
    cb.addEventListener('change', function(){
      if (cb.checked){ delete hiddenCats[c.key]; item.classList.remove('off'); } else { hiddenCats[c.key] = true; item.classList.add('off'); }
      nodesDS.update(RAW_NODES.filter(function(n){ return n.cat === c.key; }).map(function(n){ return { id: n.id, hidden: !cb.checked }; }));
      syncSelectAll();
    });
    var dot = document.createElement('span'); dot.className = 'lg-dot'; dot.style.background = 'radial-gradient(circle at 32% 30%, ' + lighten(c.color, 0.3) + ', ' + c.color + ')';
    var lab = document.createElement('span'); lab.className = 'lg-label'; lab.textContent = c.label;
    var cnt = document.createElement('span'); cnt.className = 'lg-count'; cnt.textContent = c.count;
    item.appendChild(cb); item.appendChild(dot); item.appendChild(lab); item.appendChild(cnt);
    legendEl.appendChild(item);
  });
  var selAll = document.getElementById('sel-all');
  function syncSelectAll(){
    var hidden = Object.keys(hiddenCats).length;
    selAll.checked = hidden === 0;
    selAll.indeterminate = hidden > 0 && hidden < LEGEND.length;
  }
  selAll.addEventListener('change', function(){
    var hide = !selAll.checked;
    var items = document.querySelectorAll('.lg-item');
    for (var i = 0; i < items.length; i++){ var cb = items[i].querySelector('.lg-cb'); cb.checked = !hide; if (hide) items[i].classList.add('off'); else items[i].classList.remove('off'); }
    hiddenCats = {};
    if (hide) LEGEND.forEach(function(c){ hiddenCats[c.key] = true; });
    nodesDS.update(RAW_NODES.map(function(n){ return { id: n.id, hidden: hide }; }));
    selAll.indeterminate = false;
  });

  // ---- relationship key ----
  var rkEl = document.getElementById('relkey');
  if (!REL_KEY.length){ document.getElementById('relkey-section').style.display = 'none'; }
  REL_KEY.forEach(function(r){
    var row = document.createElement('div'); row.className = 'rk-item';
    row.innerHTML = '<span class="rk-line" style="border-top-color:' + r.color + '"></span><span class="rk-label">' + esc(r.label) + '</span><span class="rk-count">' + r.count + '</span>';
    rkEl.appendChild(row);
  });
})();
`;
