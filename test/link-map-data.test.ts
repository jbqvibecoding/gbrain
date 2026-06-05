import { describe, test, expect } from 'bun:test';
import {
  buildLinkMapData,
  topicKeyFor,
  topicColor,
  type LinkMapPageInput,
  type LinkMapEdgeInput,
} from '../src/core/link-map-data.ts';

const pages: LinkMapPageInput[] = [
  { slug: 'companies/acme-example', type: 'company', title: 'Acme Example', emotional_weight: 0.8 },
  { slug: 'people/alice-example', type: 'person', title: 'Alice Example', emotional_weight: 0.4 },
  { slug: 'people/carol-example', type: 'person', title: 'Carol Example' },
  { slug: 'deals/acme-seed', type: 'deal', title: 'Acme Seed' },
  { slug: 'concepts/retrieval', type: 'concept', title: 'Retrieval' },
  // An island page with no links.
  { slug: 'notes/lonely', type: 'note', title: 'Lonely Note' },
];

const edges: LinkMapEdgeInput[] = [
  { from_slug: 'people/alice-example', to_slug: 'companies/acme-example', link_type: 'works_at' },
  { from_slug: 'people/carol-example', to_slug: 'companies/acme-example', link_type: 'works_at' },
  { from_slug: 'companies/acme-example', to_slug: 'deals/acme-seed', link_type: 'relates_to' },
  { from_slug: 'companies/acme-example', to_slug: 'concepts/retrieval', link_type: 'discusses' },
  // Edge to a non-existent page — must be dropped.
  { from_slug: 'people/alice-example', to_slug: 'people/ghost', link_type: 'mentions' },
  // Self-loop — must be dropped.
  { from_slug: 'concepts/retrieval', to_slug: 'concepts/retrieval', link_type: 'relates_to' },
];

describe('topicKeyFor', () => {
  test('uses top-level slug folder', () => {
    expect(topicKeyFor('companies/acme', 'company')).toBe('companies');
    expect(topicKeyFor('people/alice', 'person')).toBe('people');
  });
  test('falls back to type when no folder', () => {
    expect(topicKeyFor('acme', 'company')).toBe('company');
    expect(topicKeyFor('loose', '')).toBe('note');
  });
});

describe('topicColor', () => {
  test('stable colors for well-known groups (singular + plural)', () => {
    expect(topicColor('companies')).toBe(topicColor('company'));
    expect(topicColor('people')).toBe(topicColor('person'));
    expect(topicColor('companies')).toMatch(/^#/);
  });
  test('deterministic hashed hue for unknown groups', () => {
    const a = topicColor('widgets');
    expect(a).toBe(topicColor('widgets'));
    expect(a).toMatch(/^hsl\(/);
  });
});

describe('buildLinkMapData', () => {
  const data = buildLinkMapData(pages, edges, { source: 'host', now: new Date('2026-06-04T09:51:00Z') });

  test('keeps all pages as nodes', () => {
    expect(data.nodes.length).toBe(6);
  });

  test('drops edges to missing pages and self-loops', () => {
    // 4 valid edges survive (ghost + self-loop dropped).
    expect(data.edges.length).toBe(4);
  });

  test('computes in/out degree and backlinks', () => {
    const acme = data.nodes.find((n) => n.id === 'companies/acme-example')!;
    expect(acme.inDegree).toBe(2); // alice + carol work_at
    expect(acme.outDegree).toBe(2); // relates_to deal + discusses concept
    expect(acme.degree).toBe(4);
    expect(acme.backlinks).toBe(2);
  });

  test('maps topic + color from slug folder', () => {
    const acme = data.nodes.find((n) => n.id === 'companies/acme-example')!;
    expect(acme.topicKey).toBe('companies');
    expect(acme.topic).toBe('Companies');
    expect(acme.color).toBe(topicColor('companies'));
  });

  test('salience uses emotional_weight when present, degree fallback otherwise', () => {
    const acme = data.nodes.find((n) => n.id === 'companies/acme-example')!;
    expect(acme.salience).toBeCloseTo(0.8, 5);
    const carol = data.nodes.find((n) => n.id === 'people/carol-example')!;
    // No emotional_weight → normalized degree (1 link / max degree 4).
    expect(carol.salience).toBeGreaterThan(0);
    expect(carol.salience).toBeLessThanOrEqual(1);
  });

  test('topics rollup with counts', () => {
    const companies = data.topics.find((t) => t.key === 'companies')!;
    expect(companies.count).toBe(1);
    const people = data.topics.find((t) => t.key === 'people')!;
    expect(people.count).toBe(2);
    expect(data.meta.topic_count).toBe(data.topics.length);
  });

  test('relationships rollup with counts', () => {
    const worksAt = data.relationships.find((r) => r.link_type === 'works_at')!;
    expect(worksAt.count).toBe(2);
    const total = data.relationships.reduce((s, r) => s + r.count, 0);
    expect(total).toBe(data.edges.length);
  });

  test('meta reflects the graph', () => {
    expect(data.meta.source).toBe('host');
    expect(data.meta.asset_count).toBe(6);
    expect(data.meta.link_count).toBe(4);
    expect(data.meta.generated_at).toContain('2026-06-04');
    expect(data.meta.title).toBe('host · Link Map');
  });

  test('--min-degree drops unconnected nodes and recomputes', () => {
    const filtered = buildLinkMapData(pages, edges, { source: 'host', minDegree: 1 });
    expect(filtered.nodes.find((n) => n.id === 'notes/lonely')).toBeUndefined();
    expect(filtered.nodes.length).toBe(5);
    // edges unchanged (all surviving nodes still connected)
    expect(filtered.edges.length).toBe(4);
  });

  test('empty brain yields empty graph, not a crash', () => {
    const empty = buildLinkMapData([], [], { source: 'host' });
    expect(empty.nodes.length).toBe(0);
    expect(empty.edges.length).toBe(0);
    expect(empty.topics.length).toBe(0);
  });
});
