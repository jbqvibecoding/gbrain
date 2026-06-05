/**
 * link-map-data.ts — pure shaper for the `gbrain link-map` command.
 *
 * Turns a list of pages + a list of typed links into the `{ nodes, edges,
 * topics, relationships, meta }` JSON consumed by the standalone renderer
 * (vendored from juggl: src/assets/linkmap/gbrain-linkmap.umd.js). No fs, no
 * engine, no DB — so it is fully unit-testable (test/link-map-data.test.ts).
 *
 * Topic grouping: a node's topic comes from its top-level slug folder
 * (`companies/acme` → "companies"), falling back to the page `type` when the
 * slug has no folder. Every distinct topic present is surfaced (per the user's
 * choice), with stable colors for the well-known groups and a deterministic
 * hashed hue for the rest.
 */

export interface LinkMapPageInput {
  slug: string;
  type: string;
  title: string;
  emotional_weight?: number | null;
}

export interface LinkMapEdgeInput {
  from_slug: string;
  to_slug: string;
  link_type: string;
}

export interface LinkMapNode {
  id: string;
  label: string;
  type: string;
  topic: string;
  topicKey: string;
  color: string;
  degree: number;
  inDegree: number;
  outDegree: number;
  backlinks: number;
  salience: number;
}

export interface LinkMapEdge {
  id: string;
  source: string;
  target: string;
  link_type: string;
}

export interface LinkMapData {
  nodes: LinkMapNode[];
  edges: LinkMapEdge[];
  topics: { key: string; label: string; color: string; count: number }[];
  relationships: { link_type: string; count: number }[];
  meta: {
    generated_at: string;
    source: string;
    asset_count: number;
    link_count: number;
    topic_count: number;
    title: string;
  };
}

export interface BuildLinkMapOpts {
  source: string;
  /** Drop nodes whose total degree is below this (default 0 = keep all). */
  minDegree?: number;
  /** Human title for the sidebar/page (default `<source> · Link Map`). */
  title?: string;
  /** Override the generated-at stamp (tests); default now() in UTC. */
  now?: Date;
}

// Stable colors for the well-known topic groups (matches the mockups). Keyed by
// a canonical group so both the folder form (`companies`) and the type form
// (`company`) resolve to the same swatch.
const GROUP_COLORS: Record<string, string> = {
  people: '#4C7FE0',
  companies: '#3FB950',
  meetings: '#2AA6A0',
  concepts: '#8B5CF6',
  deals: '#E8923A',
  media: '#E0588B',
  projects: '#64748B',
  notes: '#94A3B8',
};

// Folder/type → canonical color group (singular + plural + close synonyms).
const GROUP_SYNONYMS: Record<string, string> = {
  people: 'people', person: 'people', persons: 'people', contacts: 'people',
  companies: 'companies', company: 'companies', orgs: 'companies', org: 'companies', organizations: 'companies',
  meetings: 'meetings', meeting: 'meetings', calls: 'meetings', call: 'meetings', sync: 'meetings', syncs: 'meetings',
  concepts: 'concepts', concept: 'concepts', ideas: 'concepts', idea: 'concepts',
  deals: 'deals', deal: 'deals', investments: 'deals', investment: 'deals',
  media: 'media', article: 'media', articles: 'media', tweet: 'media', tweets: 'media',
  essay: 'media', essays: 'media', writing: 'media', source: 'media', sources: 'media', analysis: 'media',
  projects: 'projects', project: 'projects', initiatives: 'projects',
  notes: 'notes', note: 'notes', atom: 'notes', atoms: 'notes',
};

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Color for a topic key, stable for well-known groups, hashed otherwise. */
export function topicColor(topicKey: string): string {
  const group = GROUP_SYNONYMS[topicKey];
  if (group && GROUP_COLORS[group]) return GROUP_COLORS[group];
  return `hsl(${hashHue(topicKey)}, 55%, 55%)`;
}

function titleCase(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

/** A node's topic key: top-level slug folder, else the page type. */
export function topicKeyFor(slug: string, type: string): string {
  const slash = slug.indexOf('/');
  const raw = slash > 0 ? slug.slice(0, slash) : (type || 'note');
  return raw.toLowerCase().trim() || 'note';
}

export function buildLinkMapData(
  pages: LinkMapPageInput[],
  edges: LinkMapEdgeInput[],
  opts: BuildLinkMapOpts,
): LinkMapData {
  const minDegree = Math.max(0, opts.minDegree ?? 0);

  // Node set keyed by slug (pages only — edges to missing pages are dropped).
  const present = new Set(pages.map((p) => p.slug));

  // Degree accounting over edges whose BOTH endpoints are real pages.
  const inDeg: Record<string, number> = {};
  const outDeg: Record<string, number> = {};
  for (const p of pages) { inDeg[p.slug] = 0; outDeg[p.slug] = 0; }
  const validEdges: LinkMapEdgeInput[] = [];
  for (const e of edges) {
    if (!present.has(e.from_slug) || !present.has(e.to_slug)) continue;
    if (e.from_slug === e.to_slug) continue; // drop self-loops (renderer hides them)
    validEdges.push(e);
    outDeg[e.from_slug]++;
    inDeg[e.to_slug]++;
  }

  // Apply min-degree filter on the full-graph degree, then recompute on survivors.
  const keep = new Set(
    pages
      .filter((p) => (inDeg[p.slug] + outDeg[p.slug]) >= minDegree)
      .map((p) => p.slug),
  );
  const keptPages = pages.filter((p) => keep.has(p.slug));
  const keptEdges = validEdges.filter((e) => keep.has(e.from_slug) && keep.has(e.to_slug));

  const fInDeg: Record<string, number> = {};
  const fOutDeg: Record<string, number> = {};
  for (const p of keptPages) { fInDeg[p.slug] = 0; fOutDeg[p.slug] = 0; }
  for (const e of keptEdges) { fOutDeg[e.from_slug]++; fInDeg[e.to_slug]++; }

  let maxDegree = 1;
  for (const p of keptPages) maxDegree = Math.max(maxDegree, fInDeg[p.slug] + fOutDeg[p.slug]);

  const nodes: LinkMapNode[] = keptPages.map((p) => {
    const inD = fInDeg[p.slug];
    const outD = fOutDeg[p.slug];
    const degree = inD + outD;
    const tKey = topicKeyFor(p.slug, p.type);
    const ew = (typeof p.emotional_weight === 'number' && p.emotional_weight > 0)
      ? p.emotional_weight
      : degree / maxDegree;
    return {
      id: p.slug,
      label: p.title || p.slug,
      type: p.type || '',
      topic: titleCase(tKey),
      topicKey: tKey,
      color: topicColor(tKey),
      degree,
      inDegree: inD,
      outDegree: outD,
      backlinks: inD,
      salience: Math.max(0, Math.min(1, ew)),
    };
  });

  const outEdges: LinkMapEdge[] = keptEdges.map((e, i) => ({
    id: `e${i}`,
    source: e.from_slug,
    target: e.to_slug,
    link_type: e.link_type || '',
  }));

  // Topic + relationship rollups for the sidebar.
  const topicAgg = new Map<string, { key: string; label: string; color: string; count: number }>();
  for (const n of nodes) {
    const cur = topicAgg.get(n.topicKey);
    if (cur) cur.count++;
    else topicAgg.set(n.topicKey, { key: n.topicKey, label: n.topic, color: n.color, count: 1 });
  }
  const topics = [...topicAgg.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const relAgg = new Map<string, number>();
  for (const e of outEdges) {
    const lt = e.link_type || 'links to';
    relAgg.set(lt, (relAgg.get(lt) ?? 0) + 1);
  }
  const relationships = [...relAgg.entries()]
    .map(([link_type, count]) => ({ link_type, count }))
    .sort((a, b) => b.count - a.count || a.link_type.localeCompare(b.link_type));

  const now = opts.now ?? new Date();
  return {
    nodes,
    edges: outEdges,
    topics,
    relationships,
    meta: {
      generated_at: now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'),
      source: opts.source,
      asset_count: nodes.length,
      link_count: outEdges.length,
      topic_count: topics.length,
      title: opts.title ?? `${opts.source} · Link Map`,
    },
  };
}
