/**
 * Map graph data — read brainpages + links from the engine and shape them into
 * a render-ready model for the HTML builder.
 *
 * Source isolation: queries scope to a single resolved `sourceId` by default
 * (the trusted local-CLI scalar), exactly like every other read path. `--all-
 * sources` (local-only) drops the filter for a full-brain map. We require BOTH
 * edge endpoints in scope so a scoped map never leaks a cross-source target.
 *
 * Engine-agnostic: uses only `executeRaw`, which both PGLite and Postgres
 * implement — no new per-engine method, so the engine-parity surface doesn't
 * grow.
 */

import type { BrainEngine } from '../engine.ts';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type Category,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  categoryFor,
  colorForCategory,
  colorForLinkType,
  humanizeLinkType,
  edgeIsDashed,
  darken,
} from './palette.ts';

export interface MapNode {
  id: number;
  slug: string;
  type: string;
  title: string;
  category: Category;
  color: string;        // fill
  border: string;       // darker shade of fill
  size: number;         // 10..40
  labelVisible: boolean;
  degree: number;       // in + out
  inDegree: number;
  outDegree: number;
  salience: number;     // 0..1 (emotional_weight)
  href: string | null;  // file:// link to the page when an on-disk path is known
}

export interface MapEdge {
  from: number;
  to: number;
  linkType: string;
  linkSource: string | null;
  color: string;
  dashed: boolean;
}

export interface LegendItem { key: Category; label: string; color: string; count: number; }
export interface RelKeyItem { linkType: string; label: string; color: string; count: number; }

export interface GraphModel {
  nodes: MapNode[];
  edges: MapEdge[];
  legend: LegendItem[];
  relKey: RelKeyItem[];
  stats: { nodes: number; edges: number; sources: number };
  sourceId: string | null;
  allSources: boolean;
  weightBy: 'degree' | 'salience';
}

export interface FetchGraphOpts {
  sourceId?: string | null;
  allSources?: boolean;
  types?: string[];
  minDegree?: number;
  weightBy?: 'degree' | 'salience';
  repoPath?: string | null;
}

function fileHref(repoPath: string, slug: string): string | null {
  try {
    return pathToFileURL(join(repoPath, slug + '.md')).href;
  } catch {
    return null;
  }
}

/** Threshold below which we show every label (small graphs read better fully labeled). */
const SHOW_ALL_LABELS_MAX = 60;

export async function fetchGraph(engine: BrainEngine, opts: FetchGraphOpts = {}): Promise<GraphModel> {
  const allSources = opts.allSources === true;
  const sourceId = allSources ? null : (opts.sourceId ?? null);
  const weightBy: 'degree' | 'salience' = opts.weightBy === 'salience' ? 'salience' : 'degree';

  const params: string[] = [];
  let nodeWhere = `deleted_at IS NULL AND page_kind = 'markdown'`;
  let edgeWhere =
    `fp.deleted_at IS NULL AND tp.deleted_at IS NULL ` +
    `AND fp.page_kind = 'markdown' AND tp.page_kind = 'markdown'`;
  if (!allSources && sourceId) {
    params.push(sourceId);
    nodeWhere += ` AND source_id = $1`;
    edgeWhere += ` AND fp.source_id = $1 AND tp.source_id = $1`;
  }

  const pageRows = await engine.executeRaw<{
    id: number; source_id: string; slug: string; type: string; title: string; emotional_weight: number;
  }>(
    `SELECT id, source_id, slug, type, title, emotional_weight
       FROM pages
      WHERE ${nodeWhere}
      ORDER BY id`,
    params,
  );

  const linkRows = await engine.executeRaw<{
    from_id: number; to_id: number; link_type: string; link_source: string | null;
  }>(
    `SELECT l.from_page_id AS from_id, l.to_page_id AS to_id, l.link_type, l.link_source
       FROM links l
       JOIN pages fp ON l.from_page_id = fp.id
       JOIN pages tp ON l.to_page_id = tp.id
      WHERE ${edgeWhere}
      ORDER BY l.from_page_id, l.to_page_id, l.link_type`,
    params,
  );

  // Degree is computed on the full in-scope markdown graph (self-loops dropped),
  // so hub prominence stays stable regardless of the --type / --min-degree view.
  const nodeIds = new Set<number>(pageRows.map((r) => r.id));
  const validEdges = linkRows.filter(
    (e) => e.from_id !== e.to_id && nodeIds.has(e.from_id) && nodeIds.has(e.to_id),
  );
  const inDeg = new Map<number, number>();
  const outDeg = new Map<number, number>();
  for (const e of validEdges) {
    outDeg.set(e.from_id, (outDeg.get(e.from_id) || 0) + 1);
    inDeg.set(e.to_id, (inDeg.get(e.to_id) || 0) + 1);
  }
  let maxDeg = 1;
  for (const r of pageRows) {
    const d = (inDeg.get(r.id) || 0) + (outDeg.get(r.id) || 0);
    if (d > maxDeg) maxDeg = d;
  }

  const typeFilter = opts.types && opts.types.length
    ? new Set(opts.types.map((t) => t.toLowerCase()))
    : null;
  const minDegree = Math.max(0, opts.minDegree || 0);
  const showAllLabels = pageRows.length <= SHOW_ALL_LABELS_MAX;

  const nodes: MapNode[] = [];
  for (const r of pageRows) {
    if (typeFilter && !typeFilter.has((r.type || '').toLowerCase())) continue;
    const deg = (inDeg.get(r.id) || 0) + (outDeg.get(r.id) || 0);
    if (deg < minDegree) continue;
    const category = categoryFor(r.slug, r.type);
    const color = colorForCategory(category);
    const salience = Math.max(0, Math.min(1, Number(r.emotional_weight) || 0));
    const size = weightBy === 'salience'
      ? 10 + 30 * salience
      : 10 + 30 * (deg / maxDeg);
    nodes.push({
      id: r.id,
      slug: r.slug,
      type: r.type,
      title: r.title || r.slug,
      category,
      color,
      border: darken(color, 0.2),
      size: Math.round(size * 10) / 10,
      labelVisible: showAllLabels || deg >= maxDeg * 0.15,
      degree: deg,
      inDegree: inDeg.get(r.id) || 0,
      outDegree: outDeg.get(r.id) || 0,
      salience,
      href: opts.repoPath ? fileHref(opts.repoPath, r.slug) : null,
    });
  }

  const keptIds = new Set<number>(nodes.map((n) => n.id));
  const edges: MapEdge[] = validEdges
    .filter((e) => keptIds.has(e.from_id) && keptIds.has(e.to_id))
    .map((e) => ({
      from: e.from_id,
      to: e.to_id,
      linkType: e.link_type || '',
      linkSource: e.link_source,
      color: colorForLinkType(e.link_type),
      dashed: edgeIsDashed(e.link_source),
    }));

  // Legend: categories present, in canonical order.
  const catCount = new Map<Category, number>();
  for (const n of nodes) catCount.set(n.category, (catCount.get(n.category) || 0) + 1);
  const legend: LegendItem[] = CATEGORY_ORDER
    .filter((c) => catCount.has(c))
    .map((c) => ({ key: c, label: CATEGORY_LABELS[c], color: CATEGORY_COLORS[c], count: catCount.get(c)! }));

  // Relationship key: only the link types actually present, busiest first.
  const ltCount = new Map<string, number>();
  for (const e of edges) {
    const k = e.linkType || 'link';
    ltCount.set(k, (ltCount.get(k) || 0) + 1);
  }
  const relKey: RelKeyItem[] = [...ltCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([lt, count]) => ({ linkType: lt, label: humanizeLinkType(lt), color: colorForLinkType(lt), count }));

  const sources = allSources
    ? new Set(pageRows.map((r) => r.source_id)).size
    : 1;

  return {
    nodes,
    edges,
    legend,
    relKey,
    stats: { nodes: nodes.length, edges: edges.length, sources },
    sourceId,
    allSources,
    weightBy,
  };
}
