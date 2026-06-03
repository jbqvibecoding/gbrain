/**
 * E2E: `gbrain map` against a seeded PGLite brain.
 *
 * Exercises the full path — source-scoped engine queries (fetchGraph) and the
 * file-writing command (runMap) including the in-binary vis-network asset load
 * — on the canonical in-memory PGLite engine. No DATABASE_URL.
 *
 * The command uses only executeRaw + the shared source-resolver, so it adds no
 * new engine-parity method; PGLite coverage here plus the parity test pins both
 * engines.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { existsSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGLiteEngine } from '../../src/core/pglite-engine.ts';
import { resetPgliteState } from '../helpers/reset-pglite.ts';
import { fetchGraph } from '../../src/core/map/graph-data.ts';
import { runMap } from '../../src/commands/map.ts';

let engine: PGLiteEngine;
let tmp: string;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
  tmp = mkdtempSync(join(tmpdir(), 'gbrain-map-'));
});

afterAll(async () => {
  await engine.disconnect();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(async () => {
  await resetPgliteState(engine);
});

async function seedBasic() {
  await engine.executeRaw(
    `INSERT INTO pages (slug, type, title, emotional_weight) VALUES ('people/alice', 'person', 'Alice', 0.8)`,
  );
  await engine.executeRaw(
    `INSERT INTO pages (slug, type, title) VALUES ('companies/acme', 'company', 'Acme')`,
  );
  // A meeting filed under type 'source' — proves slug-folder coloring beats type.
  await engine.executeRaw(
    `INSERT INTO pages (slug, type, title) VALUES ('meetings/2026-04-03', 'source', 'Sync 2026-04-03')`,
  );
  await engine.executeRaw(
    `INSERT INTO links (from_page_id, to_page_id, link_type, link_source)
       SELECT a.id, b.id, 'works_at', 'markdown' FROM pages a, pages b
        WHERE a.slug = $1 AND b.slug = $2`,
    ['people/alice', 'companies/acme'],
  );
  await engine.executeRaw(
    `INSERT INTO links (from_page_id, to_page_id, link_type, link_source)
       SELECT a.id, b.id, 'attended', 'mentions' FROM pages a, pages b
        WHERE a.slug = $1 AND b.slug = $2`,
    ['people/alice', 'meetings/2026-04-03'],
  );
}

describe('fetchGraph (PGLite)', () => {
  test('builds nodes, edges, legend, and relationship key', async () => {
    await seedBasic();
    const g = await fetchGraph(engine, { sourceId: 'default' });

    expect(g.nodes.length).toBe(3);
    expect(g.edges.length).toBe(2);

    const alice = g.nodes.find((n) => n.slug === 'people/alice')!;
    const acme = g.nodes.find((n) => n.slug === 'companies/acme')!;
    const meeting = g.nodes.find((n) => n.slug === 'meetings/2026-04-03')!;
    expect(alice.category).toBe('person');
    expect(acme.category).toBe('company');
    expect(meeting.category).toBe('meeting');     // slug folder wins over type 'source'
    expect(alice.degree).toBe(2);
    expect(alice.salience).toBeCloseTo(0.8, 5);

    // edge provenance → solidity
    const worksAt = g.edges.find((e) => e.linkType === 'works_at')!;
    const attended = g.edges.find((e) => e.linkType === 'attended')!;
    expect(worksAt.dashed).toBe(false);            // markdown → solid
    expect(attended.dashed).toBe(true);            // mentions → dashed

    const relTypes = g.relKey.map((r) => r.linkType).sort();
    expect(relTypes).toEqual(['attended', 'works_at']);
    const legendKeys = g.legend.map((l) => l.key);
    expect(legendKeys).toContain('person');
    expect(legendKeys).toContain('company');
    expect(legendKeys).toContain('meeting');
  });

  test('--min-degree filters low-connectivity nodes and dangling edges', async () => {
    await seedBasic();
    // acme has degree 1, meeting degree 1, alice degree 2.
    const g = await fetchGraph(engine, { sourceId: 'default', minDegree: 2 });
    expect(g.nodes.map((n) => n.slug)).toEqual(['people/alice']);
    expect(g.edges.length).toBe(0); // both endpoints required; neighbors dropped
  });

  test('source scoping: scalar source hides other sources; --all-sources includes them', async () => {
    await seedBasic();
    await engine.executeRaw(
      `INSERT INTO sources (id, name, config, created_at)
         VALUES ('repo-b', 'repo-b', '{}'::jsonb, NOW()) ON CONFLICT (id) DO NOTHING`,
    );
    await engine.executeRaw(
      `INSERT INTO pages (source_id, slug, type, title) VALUES ('repo-b', 'people/bob', 'person', 'Bob')`,
    );

    const scoped = await fetchGraph(engine, { sourceId: 'default' });
    expect(scoped.nodes.some((n) => n.slug === 'people/bob')).toBe(false);

    const all = await fetchGraph(engine, { allSources: true });
    expect(all.nodes.some((n) => n.slug === 'people/bob')).toBe(true);
    expect(all.stats.sources).toBeGreaterThanOrEqual(2);
  });

  test('excludes soft-deleted and non-markdown pages', async () => {
    await engine.executeRaw(
      `INSERT INTO pages (slug, type, title, deleted_at) VALUES ('people/ghost', 'person', 'Ghost', NOW())`,
    );
    await engine.executeRaw(
      `INSERT INTO pages (slug, type, title, page_kind) VALUES ('code/util.ts', 'source', 'util.ts', 'code')`,
    );
    await engine.executeRaw(
      `INSERT INTO pages (slug, type, title) VALUES ('people/real', 'person', 'Real')`,
    );
    const g = await fetchGraph(engine, { sourceId: 'default' });
    expect(g.nodes.map((n) => n.slug)).toEqual(['people/real']);
  });
});

describe('runMap (PGLite)', () => {
  test('writes a self-contained HTML file with the vis bundle inlined', async () => {
    await seedBasic();
    const out = join(tmp, 'map.html');
    await runMap(engine, ['--out', out]);

    expect(existsSync(out)).toBe(true);
    const html = readFileSync(out, 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('people/alice');
    expect(html).toContain('companies/acme');
    expect(html).toContain('works_at');
    // inlined vis-network bundle ⇒ a large, fully offline file
    expect(statSync(out).size).toBeGreaterThan(500_000);
  });

  test('--cdn writes a small file that references the CDN instead of inlining', async () => {
    await seedBasic();
    const out = join(tmp, 'map-cdn.html');
    await runMap(engine, ['--out', out, '--cdn']);

    const html = readFileSync(out, 'utf8');
    expect(html).toContain('cdn.jsdelivr.net/npm/vis-network');
    expect(statSync(out).size).toBeLessThan(200_000);
  });

  test('empty scope writes nothing and reports cleanly', async () => {
    const out = join(tmp, 'empty.html');
    await runMap(engine, ['--out', out]);
    expect(existsSync(out)).toBe(false);
  });
});
