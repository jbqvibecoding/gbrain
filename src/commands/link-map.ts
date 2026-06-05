/**
 * gbrain link-map — Generate a standalone, interactive Obsidian-style graph of
 * the brain's wiki-link relationships, as a single self-contained HTML file.
 *
 * Deterministic, zero LLM calls. Reuses the juggl Cytoscape renderer (built in
 * the juggl repo, vendored at src/assets/linkmap/gbrain-linkmap.umd.js) inlined
 * into one HTML file — the same self-contained pattern `gbrain publish` uses for
 * marked.js. Data is shaped by src/core/link-map-data.ts.
 *
 * Usage:
 *   gbrain link-map                              # whole brain → ./brain-linkmap.html
 *   gbrain link-map --out /tmp/map.html          # custom output path
 *   gbrain link-map --source wiki                # scope to one source
 *   gbrain link-map --type person                # only one page type
 *   gbrain link-map --min-degree 1               # drop unconnected pages
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { BrainEngine } from '../core/engine.ts';
import { resolveSourceId } from '../core/source-resolver.ts';
import { createProgress, startHeartbeat } from '../core/progress.ts';
import { getCliOptions, cliOptsToProgressOptions } from '../core/cli-options.ts';
import {
  buildLinkMapData,
  type LinkMapPageInput,
  type LinkMapEdgeInput,
  type LinkMapData,
} from '../core/link-map-data.ts';
import { loadLinkmapJs } from '../assets/linkmap/linkmap-embedded.ts';

const LARGE_BRAIN_WARN = 2500;

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

/** Query every page in the source (optionally one type). Source-scoped; falls
 *  back to unscoped on pre-source brains (mirrors graph-query.ts fail-open). */
async function fetchPages(
  engine: BrainEngine,
  sourceId: string,
  type: string | undefined,
): Promise<LinkMapPageInput[]> {
  const cols = `slug, type, title, emotional_weight`;
  try {
    const params: unknown[] = [sourceId];
    let sql = `SELECT ${cols} FROM pages WHERE source_id = $1 AND deleted_at IS NULL`;
    if (type) { sql += ` AND type = $2`; params.push(type); }
    return await engine.executeRaw<LinkMapPageInput>(sql, params);
  } catch {
    const params: unknown[] = [];
    let sql = `SELECT ${cols} FROM pages WHERE deleted_at IS NULL`;
    if (type) { sql += ` AND type = $1`; params.push(type); }
    return await engine.executeRaw<LinkMapPageInput>(sql, params);
  }
}

/** Every typed link with both endpoints in the source. One join, no N+1. */
async function fetchEdges(engine: BrainEngine, sourceId: string): Promise<LinkMapEdgeInput[]> {
  const sql = `
    SELECT fp.slug AS from_slug, tp.slug AS to_slug, l.link_type
      FROM links l
      JOIN pages fp ON l.from_page_id = fp.id
      JOIN pages tp ON l.to_page_id   = tp.id
     WHERE fp.source_id = $1 AND tp.source_id = $1
       AND fp.deleted_at IS NULL AND tp.deleted_at IS NULL`;
  try {
    return await engine.executeRaw<LinkMapEdgeInput>(sql, [sourceId]);
  } catch {
    const fallback = `
      SELECT fp.slug AS from_slug, tp.slug AS to_slug, l.link_type
        FROM links l
        JOIN pages fp ON l.from_page_id = fp.id
        JOIN pages tp ON l.to_page_id   = tp.id
       WHERE fp.deleted_at IS NULL AND tp.deleted_at IS NULL`;
    return await engine.executeRaw<LinkMapEdgeInput>(fallback, []);
  }
}

/** Build the self-contained HTML. The renderer bundle (`js`) is trusted; only
 *  the data JSON (page titles/slugs) is escaped against `</script>` injection. */
export function generateLinkMapHtml(data: LinkMapData, js: string): string {
  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');
  const title = data.meta.title || 'gbrain · Link Map';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string))}</title>
<style>html,body{margin:0;padding:0;height:100%;background:#f4f1ea}#gblm-app{position:fixed;inset:0}</style>
</head>
<body>
<div id="gblm-app"></div>
<script>${js}</script>
<script>
(function(){
  var data = ${dataJson};
  window.__LINKMAP__ = data;
  try {
    GbrainLinkMap.render(document.getElementById('gblm-app'), data);
  } catch (e) {
    document.getElementById('gblm-app').innerHTML =
      '<pre style="padding:24px;font:13px ui-monospace,monospace;color:#b91c1c">Link Map failed to render: ' +
      String(e && e.message || e) + '</pre>';
    console.error(e);
  }
})();
</script>
</body>
</html>`;
}

export async function runLinkMap(engine: BrainEngine, args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.error('Usage: gbrain link-map [--out path] [--source id] [--type t] [--min-degree n]');
    console.error('');
    console.error('  Generates a standalone interactive HTML graph of the brain\'s wiki-link');
    console.error('  relationships (Obsidian-style). Self-contained — open it in any browser.');
    console.error('');
    console.error('  --out path         Output HTML file (default: ./brain-linkmap.html)');
    console.error('  --source id        Scope to one source (default: resolved default source)');
    console.error('  --type t           Only include pages of this type');
    console.error('  --min-degree n     Drop pages with fewer than n links (default: 0)');
    return;
  }

  const out = flagValue(args, '--out') || './brain-linkmap.html';
  const sourceFlag = flagValue(args, '--source') || null;
  const typeFilter = flagValue(args, '--type');
  const minDegreeRaw = flagValue(args, '--min-degree');
  const minDegree = minDegreeRaw ? Math.max(0, parseInt(minDegreeRaw, 10) || 0) : 0;

  const sourceId = await resolveSourceId(engine, sourceFlag);

  // Heartbeat on stderr so agents see liveness; stdout stays clean for the path.
  const progress = createProgress(cliOptsToProgressOptions(getCliOptions()));
  const stop = startHeartbeat(progress, 'link-map.query');
  let data: LinkMapData;
  try {
    const [pages, edges] = await Promise.all([
      fetchPages(engine, sourceId, typeFilter),
      fetchEdges(engine, sourceId),
    ]);
    data = buildLinkMapData(pages, edges, { source: sourceId, minDegree });
  } finally {
    stop();
  }

  if (data.nodes.length === 0) {
    console.error(`No pages found for source "${sourceId}"${typeFilter ? ` of type "${typeFilter}"` : ''}. Nothing to map.`);
    return;
  }
  if (data.nodes.length > LARGE_BRAIN_WARN) {
    console.error(
      `[link-map] rendering ${data.nodes.length} nodes — large graphs may be slow in the browser.\n` +
      `           Narrow with --type <t> or --min-degree <n> if needed.`,
    );
  }

  const html = generateLinkMapHtml(data, loadLinkmapJs());
  mkdirSync(dirname(out) || '.', { recursive: true });
  writeFileSync(out, html);

  console.log(`Link map: ${out}`);
  console.log(`  ${data.meta.asset_count} assets · ${data.meta.link_count} links · ${data.meta.topic_count} topics`);
}
