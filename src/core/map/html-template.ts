/**
 * Map HTML builder — pure string function. Given a GraphModel, emit a single
 * self-contained interactive HTML document (vis-network force graph + editorial
 * sidebar). No engine, no fs, no DOM — unit-testable in isolation.
 *
 * Reuses graphify's proven interaction model (vis.js force layout, search,
 * click-to-inspect, checkbox legend with select-all, forceAtlas2Based physics)
 * reimplemented in TypeScript, restyled to a light editorial theme, and
 * extended with the four refinements: neighborhood focus, rich node inspector,
 * typed/colored edges + relationship key.
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
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    height: 100vh; display: flex; overflow: hidden;
    background: #FAF7F0; color: #2B2620;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .serif { font-family: Georgia, "Iowan Old Style", Palatino, "Times New Roman", serif; }

  /* ---- sidebar ---- */
  #sidebar {
    width: 344px; min-width: 344px; height: 100vh; overflow-y: auto;
    background: #FFFDF8; border-right: 1px solid #E7E0D2;
    box-shadow: 2px 0 22px rgba(70, 56, 30, 0.05);
    display: flex; flex-direction: column;
  }
  .side-pad { padding: 24px 22px 8px; }
  h1.title {
    font-family: Georgia, "Iowan Old Style", Palatino, serif;
    font-size: 27px; font-weight: 700; letter-spacing: -0.012em;
    margin: 0 0 7px; color: #2A2620; line-height: 1.1;
  }
  .subtitle { font-size: 12.5px; color: #877C6B; line-height: 1.55; margin: 0 0 18px; }

  #search {
    width: 100%; padding: 10px 15px; border: 1px solid #E4DBC8; border-radius: 999px;
    background: #FCFAF3; font-size: 13.5px; color: #2B2620; outline: none;
    transition: border-color .15s, box-shadow .15s;
  }
  #search::placeholder { color: #B3A892; }
  #search:focus { border-color: #C8A86A; box-shadow: 0 0 0 3px rgba(200, 168, 106, 0.16); background: #fff; }
  #search-results {
    margin-top: 6px; max-height: 188px; overflow-y: auto; display: none;
    border: 1px solid #ECE4D3; border-radius: 12px; background: #fff;
    box-shadow: 0 8px 24px rgba(70, 56, 30, 0.10);
  }
  .sr-item {
    padding: 8px 12px; cursor: pointer; border-left: 3px solid transparent;
    display: flex; flex-direction: column; gap: 1px;
  }
  .sr-item:hover { background: #FBF6EA; }
  .sr-label { font-size: 13px; color: #2B2620; }
  .sr-slug { font-size: 11px; color: #A99E8B; font-family: ui-monospace, Menlo, monospace; }

  .stats-row { display: flex; gap: 9px; margin: 18px 0 4px; }
  .stat-card {
    flex: 1; background: #FBF7EE; border: 1px solid #ECE4D3; border-radius: 13px;
    padding: 11px 12px;
  }
  .stat-num { font-family: Georgia, serif; font-size: 23px; font-weight: 700; color: #2A2620; line-height: 1; }
  .stat-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; color: #A89D8A; margin-top: 5px; }

  .section-h {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.09em; color: #A0957F;
    margin: 22px 0 11px; font-weight: 600; display: flex; justify-content: space-between; align-items: center;
  }
  .sel-all-wrap { display: flex; align-items: center; gap: 5px; cursor: pointer; text-transform: none; letter-spacing: 0; color: #A89D8A; font-weight: 500; }

  .lg-item, .rk-item {
    display: flex; align-items: center; gap: 9px; padding: 5px 6px; border-radius: 8px;
    cursor: pointer; font-size: 13px; color: #423C32; user-select: none;
  }
  .lg-item:hover { background: #FAF5E9; }
  .lg-item.off { opacity: 0.4; }
  .lg-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 0 1px rgba(0,0,0,.04); }
  .lg-label, .rk-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lg-count, .rk-count { color: #B5AB97; font-size: 11.5px; }
  .lg-cb, #sel-all {
    appearance: none; -webkit-appearance: none; width: 15px; height: 15px; flex-shrink: 0;
    border: 1.5px solid #D6CCB6; border-radius: 4px; background: #fff; cursor: pointer; position: relative;
  }
  .lg-cb:checked, #sel-all:checked { background: #B5773A; border-color: #B5773A; }
  .lg-cb:checked::after, #sel-all:checked::after {
    content: ''; position: absolute; left: 4px; top: 1px; width: 4px; height: 8px;
    border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg);
  }
  #sel-all:indeterminate { background: #B5773A; border-color: #B5773A; }
  #sel-all:indeterminate::after { content: ''; position: absolute; left: 2.5px; top: 6px; width: 8px; height: 2px; background: #fff; }

  .rk-line { width: 18px; height: 0; border-top: 2px solid #ccc; flex-shrink: 0; }

  .foot { margin-top: auto; padding: 14px 22px; font-size: 11px; color: #ABA08D; border-top: 1px solid #EFE8D9; }

  /* ---- graph + overlays ---- */
  #graph-wrap { flex: 1; position: relative; min-width: 0; }
  #graph { position: absolute; inset: 0; }
  .overlay { position: absolute; z-index: 6; font-size: 12px; }
  #gen { top: 16px; left: 18px; color: #A99E88; font-variant-numeric: tabular-nums; }
  #badge {
    top: 16px; right: 18px; background: #F3ECDD; color: #8A7A57; border: 1px solid #E7DCC4;
    padding: 5px 13px; border-radius: 999px; font-weight: 600; letter-spacing: 0.015em;
    box-shadow: 0 1px 5px rgba(70, 56, 30, 0.07);
  }
  #reset-focus {
    bottom: 18px; right: 18px; display: none; cursor: pointer;
    background: #FFFDF8; color: #6E6452; border: 1px solid #E2DAC9;
    padding: 7px 14px; border-radius: 999px; font-size: 12px; font-weight: 600;
    box-shadow: 0 2px 10px rgba(70, 56, 30, 0.10);
  }
  #reset-focus:hover { background: #fff; color: #2B2620; }

  /* ---- inspector ---- */
  #inspector {
    position: absolute; top: 54px; right: 18px; width: 270px; z-index: 7;
    background: #FFFDF8; border: 1px solid #E7E0D2; border-radius: 15px;
    box-shadow: 0 10px 34px rgba(70, 56, 30, 0.16); padding: 17px 17px 15px; display: none;
    max-height: calc(100vh - 90px); overflow-y: auto;
  }
  #inspector.show { display: block; }
  .insp-title { font-family: Georgia, serif; font-size: 17px; font-weight: 700; color: #2A2620; line-height: 1.25; margin-bottom: 7px; }
  .insp-type { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: #6E6452; margin-bottom: 12px; }
  .insp-type .dot { width: 10px; height: 10px; border-radius: 50%; }
  .insp-row { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; color: #6E6452; margin: 6px 0; }
  .insp-k { color: #A0957F; }
  .insp-v { color: #423C32; }
  .sal-wrap { display: flex; align-items: center; gap: 7px; }
  .sal-bar { width: 86px; height: 6px; border-radius: 999px; background: #EEE6D6; overflow: hidden; }
  .sal-fill { height: 100%; background: linear-gradient(90deg, #D9B36A, #B5773A); }
  .sal-num { font-size: 11px; color: #8A7F6C; min-width: 20px; text-align: right; }
  .nb-h { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; color: #B6AC98; margin: 13px 0 5px; }
  .nb {
    border-left: 3px solid #ccc; padding: 4px 8px; margin: 3px 0; border-radius: 5px;
    cursor: pointer; font-size: 12px; color: #423C32; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .nb:hover { background: #FAF5E9; }
  .nb-verb { color: #A0957F; }
  .nb-empty { font-size: 12px; color: #BCB3A1; font-style: italic; padding: 2px 0; }
  .insp-open { margin-top: 14px; }
  .open-link { display: inline-block; font-size: 12.5px; color: #9A6A2E; text-decoration: none; font-weight: 600; }
  .open-link:hover { text-decoration: underline; }
  .slug-row { display: flex; align-items: center; gap: 8px; }
  .slug-row code { font-size: 11px; color: #8A7F6C; background: #F4EEDF; padding: 3px 7px; border-radius: 6px; overflow: hidden; text-overflow: ellipsis; }
  .copy-btn { font-size: 11px; color: #6E6452; background: #fff; border: 1px solid #E2DAC9; border-radius: 6px; padding: 3px 9px; cursor: pointer; }
  .copy-btn:hover { background: #FAF5E9; }
  .empty { color: #BCB3A1; font-style: italic; font-size: 12.5px; }
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
    <h1 class="title">${escHtml(title)}</h1>
    <p class="subtitle">Interactive map of your brain's durable wiki-link graph. Click a node to focus its neighborhood.</p>
    <input id="search" type="text" placeholder="Search title or slug…" autocomplete="off" spellcheck="false">
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
  <div class="overlay" id="gen">Generated ${escHtml(genShort)}</div>
  <div class="overlay" id="badge">Local HTML map</div>
  <button class="overlay" id="reset-focus">Reset focus</button>
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

  var NODE_BY_ID = {}, TITLE_BY_ID = {};
  RAW_NODES.forEach(function(n){ NODE_BY_ID[n.id] = n; TITLE_BY_ID[n.id] = n.label; });

  function esc(s){
    s = (s == null ? '' : String(s));
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function human(lt){ return (lt || 'link').replace(/_/g, ' '); }
  function fontFor(visible){ return { size: visible ? 13 : 0, color: '#3A352C', face: '-apple-system, Segoe UI, sans-serif', strokeWidth: 3, strokeColor: '#FAF7F0', vadjust: 1 }; }

  var visNodes = RAW_NODES.map(function(n){
    return {
      id: n.id, label: n.label, shape: 'dot', size: n.size, borderWidth: 1.5,
      color: { background: n.fill, border: n.border, highlight: { background: '#FFFFFF', border: n.border }, hover: { background: n.fill, border: n.border } },
      font: fontFor(n.lab), opacity: 1, title: esc(n.label) + '  ·  ' + esc(n.slug)
    };
  });
  var visEdges = RAW_EDGES.map(function(e, i){
    return {
      id: i, from: e.f, to: e.t, dashes: !!e.dash, width: 1.2, selectionWidth: 2.2,
      title: esc(TITLE_BY_ID[e.f] || e.f) + '  —' + esc(human(e.lt)) + '→  ' + esc(TITLE_BY_ID[e.t] || e.t),
      color: { color: e.col, opacity: 0.55, highlight: '#6E6452', hover: '#6E6452' },
      arrows: { to: { enabled: true, scaleFactor: 0.42, type: 'arrow' } }
    };
  });

  var nodesDS = new vis.DataSet(visNodes);
  var edgesDS = new vis.DataSet(visEdges);
  var container = document.getElementById('graph');
  var network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, {
    physics: {
      enabled: true, solver: 'forceAtlas2Based',
      forceAtlas2Based: { gravitationalConstant: -58, centralGravity: 0.006, springLength: 130, springConstant: 0.08, damping: 0.45, avoidOverlap: 0.7 },
      stabilization: { iterations: 240, fit: true }
    },
    interaction: { hover: true, tooltipDelay: 130, hideEdgesOnDrag: true, navigationButtons: false, keyboard: false, multiselect: false },
    nodes: { shape: 'dot', borderWidth: 1.5 },
    edges: { smooth: { type: 'continuous', roundness: 0.18 } }
  });
  network.once('stabilizationIterationsDone', function(){ network.setOptions({ physics: { enabled: false } }); });

  // ---- neighborhood focus ----
  var focusedId = null;
  function applyFocus(id){
    var keep = {}; keep[id] = true;
    network.getConnectedNodes(id).forEach(function(k){ keep[k] = true; });
    nodesDS.update(RAW_NODES.map(function(n){
      var on = !!keep[n.id];
      return { id: n.id, opacity: on ? 1 : 0.13, font: fontFor(on ? true : false) };
    }));
    var conn = {}; network.getConnectedEdges(id).forEach(function(ei){ conn[ei] = true; });
    edgesDS.update(RAW_EDGES.map(function(e, i){
      return { id: i, color: { color: conn[i] ? e.col : '#D8D2C4', opacity: conn[i] ? 0.9 : 0.06 } };
    }));
    focusedId = id;
    document.getElementById('reset-focus').style.display = 'inline-block';
  }
  function clearFocus(){
    nodesDS.update(RAW_NODES.map(function(n){ return { id: n.id, opacity: 1, font: fontFor(n.lab) }; }));
    edgesDS.update(RAW_EDGES.map(function(e, i){ return { id: i, color: { color: e.col, opacity: 0.55 } }; }));
    focusedId = null;
    document.getElementById('reset-focus').style.display = 'none';
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
      return '<div class="nb" style="border-left-color:' + esc(o.catColor) + '" onclick="__focusFrom(' + JSON.stringify(otherId) + ')">' +
        '<span class="nb-verb">' + esc(human(e.lt)) + '</span> ' + esc(o.label) + '</div>';
    }).join('');
  }
  function showInspector(id){
    var n = NODE_BY_ID[id]; if (!n) return;
    var outs = [], ins = [];
    RAW_EDGES.forEach(function(e){ if (e.f === id) outs.push(e); else if (e.t === id) ins.push(e); });
    var openBlock = n.href
      ? '<a class="open-link" href="' + esc(n.href) + '" target="_blank" rel="noopener">Open page \\u2197</a>'
      : '<div class="slug-row"><code id="__slug">' + esc(n.slug) + '</code><button class="copy-btn" onclick="__copySlug()">Copy</button></div>';
    document.getElementById('inspector').innerHTML =
      '<div class="insp-title">' + esc(n.label) + '</div>' +
      '<div class="insp-type"><span class="dot" style="background:' + esc(n.catColor) + '"></span>' + esc(n.type || n.cat) + '</div>' +
      '<div class="insp-row"><span class="insp-k">Salience</span><span class="insp-v sal-wrap">' + salBar(n.sal) + '</span></div>' +
      '<div class="insp-row"><span class="insp-k">Connections</span><span class="insp-v">' + n.outd + ' out · ' + n.ind + ' in</span></div>' +
      '<div class="nb-h">Links out</div>' + neighborRows(outs, 'out') +
      '<div class="nb-h">Backlinks (in)</div>' + neighborRows(ins, 'in') +
      '<div class="insp-open">' + openBlock + '</div>';
    document.getElementById('inspector').className = 'show';
  }
  window.__focusFrom = function(id){ network.focus(id, { scale: 1.25, animation: { duration: 380 } }); network.selectNodes([id]); applyFocus(id); showInspector(id); };
  window.__copySlug = function(){ var c = document.getElementById('__slug'); if (c && navigator.clipboard) navigator.clipboard.writeText(c.textContent); };

  // ---- events ----
  network.on('click', function(p){
    if (p.nodes && p.nodes.length){ applyFocus(p.nodes[0]); showInspector(p.nodes[0]); }
    else { clearFocus(); closeInspector(); }
  });
  network.on('doubleClick', function(p){ if (p.nodes && p.nodes.length) network.focus(p.nodes[0], { scale: 1.7, animation: true }); });
  network.on('hoverNode', function(){ container.style.cursor = 'pointer'; });
  network.on('blurNode', function(){ container.style.cursor = 'default'; });

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
      d.onclick = function(){ network.focus(n.id, { scale: 1.3, animation: true }); network.selectNodes([n.id]); applyFocus(n.id); showInspector(n.id); sRes.style.display = 'none'; sIn.value = ''; };
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
    var dot = document.createElement('span'); dot.className = 'lg-dot'; dot.style.background = c.color;
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
