/**
 * gbrain map — generate a self-contained interactive HTML link-map of brainpages.
 *
 * Reads the brain's pages + links (scoped to the resolved source by default),
 * colors nodes by topic/page-type, styles edges by relationship, and writes one
 * self-contained HTML file (vis-network force graph + editorial sidebar with
 * search, topic legend, relationship key, neighborhood focus, and a node
 * inspector). Local-only: it writes a file to disk and optionally opens a
 * browser, so the thin-client guard refuses it (run where the brain lives).
 *
 * Usage:
 *   gbrain map [--source S | --all-sources] [--type T[,T2]] [--out PATH]
 *              [--open] [--weight-by degree|salience] [--min-degree N] [--cdn]
 *
 * Examples:
 *   gbrain map --open
 *   gbrain map --type person,company --weight-by salience --out /tmp/people.html
 *   gbrain map --all-sources --min-degree 1
 *   gbrain map --cdn --out map.html      # tiny file; loads vis-network from a CDN
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import type { BrainEngine } from '../core/engine.ts';
import { resolveSourceId } from '../core/source-resolver.ts';
import { createProgress, startHeartbeat } from '../core/progress.ts';
import { getCliOptions, cliOptsToProgressOptions } from '../core/cli-options.ts';
import { fetchGraph } from '../core/map/graph-data.ts';
import { buildMapHtml } from '../core/map/html-template.ts';
import { loadVisNetworkJs } from '../core/map/assets.ts';

interface Args {
  source?: string;
  allSources: boolean;
  types: string[];
  out: string;
  open: boolean;
  weightBy: 'degree' | 'salience';
  minDegree: number;
  cdn: boolean;
  title?: string;
  showHelp: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    allSources: false, types: [], out: './brain-map.html', open: false,
    weightBy: 'degree', minDegree: 0, cdn: false, showHelp: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source' && i + 1 < argv.length) out.source = argv[++i];
    else if (a === '--all-sources') out.allSources = true;
    else if (a === '--type' && i + 1 < argv.length) {
      for (const t of argv[++i].split(',')) { const s = t.trim(); if (s) out.types.push(s); }
    }
    else if ((a === '--out' || a === '-o') && i + 1 < argv.length) out.out = argv[++i];
    else if (a === '--open') out.open = true;
    else if (a === '--weight-by' && i + 1 < argv.length) {
      out.weightBy = argv[++i] === 'salience' ? 'salience' : 'degree';
    }
    else if (a === '--min-degree' && i + 1 < argv.length) out.minDegree = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--cdn') out.cdn = true;
    else if (a === '--title' && i + 1 < argv.length) out.title = argv[++i];
    else if (a === '--help' || a === '-h') out.showHelp = true;
  }
  return out;
}

function printHelp() {
  console.log(`Usage: gbrain map [options]

Generate a self-contained interactive HTML map of your brainpages: a
force-directed link graph colored by topic (people, companies, meetings,
concepts, deals, …) with search, a topic legend, a relationship key, click-to-
focus neighborhoods, and a node inspector. Opens in any browser, offline.

Options:
  --source <id>          Scope to one source (default: the resolved source).
  --all-sources          Map every source in the brain (full corpus).
  --type <t[,t2]>        Only include these page types (comma-separated, repeatable).
  --out <path>           Output HTML path (default ./brain-map.html).
  --open                 Open the generated file in your browser.
  --weight-by <metric>   Node size by 'degree' (default) or 'salience'.
  --min-degree <N>       Hide nodes with fewer than N connections (default 0).
  --cdn                  Reference vis-network from a CDN instead of inlining it
                         (~30KB file, needs network to render; default inlines
                         for a fully offline, self-contained file).
  --title <text>         Override the map title.
  -h, --help             Show this message.

Examples:
  gbrain map --open
  gbrain map --type person,company --weight-by salience --out /tmp/people.html
  gbrain map --all-sources --min-degree 1
`);
}

async function openInBrowser(path: string): Promise<void> {
  try {
    if (process.platform === 'darwin') {
      Bun.spawn(['open', path], { stdout: 'ignore', stderr: 'ignore' });
    } else if (process.platform === 'win32') {
      Bun.spawn(['cmd', '/c', 'start', '', path], { stdout: 'ignore', stderr: 'ignore' });
    } else {
      Bun.spawn(['xdg-open', path], { stdout: 'ignore', stderr: 'ignore' });
    }
  } catch {
    // non-fatal — the path is already printed to stdout.
  }
}

export async function runMap(engine: BrainEngine, argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.showHelp) { printHelp(); return; }

  const allSources = args.allSources;
  const sourceId = allSources ? null : await resolveSourceId(engine, args.source ?? null);

  // On-disk repo path for the resolved source powers the inspector's
  // "Open page" link. Best-effort: skipped for --all-sources (ambiguous) and
  // when the source has no local_path (DB-only brain).
  let repoPath: string | null = null;
  if (!allSources && sourceId) {
    try {
      const rows = await engine.executeRaw<{ local_path: string | null }>(
        `SELECT local_path FROM sources WHERE id = $1`, [sourceId],
      );
      repoPath = rows[0]?.local_path ?? null;
    } catch { repoPath = null; }
  }

  const progress = createProgress(cliOptsToProgressOptions(getCliOptions()));
  const stop = startHeartbeat(progress, 'map.query');
  let model;
  try {
    model = await fetchGraph(engine, {
      sourceId, allSources, types: args.types, minDegree: args.minDegree,
      weightBy: args.weightBy, repoPath,
    });
  } finally {
    stop();
  }

  if (model.nodes.length === 0) {
    console.error(
      `No markdown brainpages found for scope "${allSources ? 'all sources' : sourceId}"`
      + (args.types.length ? ` and types [${args.types.join(', ')}]` : '')
      + '. Nothing to map.',
    );
    return;
  }

  const visJs = args.cdn ? undefined : await loadVisNetworkJs();
  const html = buildMapHtml(model, {
    title: args.title,
    generatedAt: new Date().toISOString(),
    inlineAssets: !args.cdn,
    visJs,
  });

  const outPath = resolvePath(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);

  console.log(
    `Wrote ${outPath}\n`
    + `  ${model.stats.nodes} nodes · ${model.stats.edges} edges · ${model.legend.length} topics`
    + (args.cdn ? ' · vis-network via CDN' : ' · self-contained'),
  );

  if (args.open) await openInBrowser(outPath);
}
