/**
 * End-to-end: a pull tick → GbrainSink → real PGLite gbrain → brainpages.
 *
 * This is the Phase-4 gate from the plan. It opens a throwaway PGLite brain,
 * runs one Puller tick over a fake Composio Gmail connection, and asserts the
 * `pages` + `ingest_log` rows landed with honest `oauth-pull` provenance and
 * deterministic slugs — and that re-running is idempotent (upsert, no dupes).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Puller } from '../src/puller/loop.ts';
import { MemorySyncStateStore } from '../src/puller/state-store.ts';
import { ProviderRegistry } from '../src/providers/registry.ts';
import { openGbrainSink } from '../src/gbrain/adapter.ts';
import { FakeComposioClient } from './fixtures/fake-composio.ts';

const TIMEOUT = 60_000;
const tmpDirs: string[] = [];

afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

async function freshBrain() {
  const dir = await mkdtemp(join(tmpdir(), 'cb-pglite-'));
  tmpDirs.push(dir);
  // sourceId 'default' is seeded by initSchema, so no sources_add needed.
  const opened = await openGbrainSink({ engine: 'pglite', databasePath: dir, sourceId: 'default' });
  return opened;
}

function gmailClient(messageId = 'm1') {
  const client = new FakeComposioClient();
  client.connections = [{ id: 'conn_gmail', toolkit: 'gmail', status: 'active' }];
  client.executeResponses.set('GMAIL_FETCH_EMAILS', {
    successful: true,
    data: {
      messages: [
        {
          messageId,
          subject: 'Project status update',
          from: 'alice@example.com',
          to: 'bob@example.com, carol@example.com',
          messageText: '<p>Alice says the project is <b>80%</b> done. Bob is tech lead.</p>',
          internalDate: String(Date.parse('2026-06-04T10:00:00Z')),
        },
      ],
    },
  });
  return client;
}

describe('integration: Gmail pull → gbrain brainpage', () => {
  test(
    'one tick lands a page with oauth-pull provenance + an ingest_log row',
    async () => {
      const { sink, engine, close } = await freshBrain();
      try {
        const client = gmailClient('m1');
        const puller = new Puller({
          client,
          registry: ProviderRegistry.default(),
          sink,
          stateStore: new MemorySyncStateStore(),
        });

        const report = await puller.runOneTick();
        expect(report.fired).toBe(1);
        expect(report.connections[0]?.itemsIngested).toBe(1);

        const eng = engine as { executeRaw<T>(sql: string, params?: unknown[]): Promise<T[]> };
        const pages = await eng.executeRaw<{ slug: string; source_kind: string; source_uri: string; type: string }>(
          `SELECT slug, source_kind, source_uri, type FROM pages WHERE slug = $1`,
          ['emails/2026-06/m1'],
        );
        expect(pages.length).toBe(1);
        expect(pages[0]?.source_kind).toBe('oauth-pull');
        expect(pages[0]?.source_uri).toBe('m1');
        expect(pages[0]?.type).toBe('oauth-raw');

        const logs = await eng.executeRaw<{ source_type: string; pages_updated: unknown }>(
          `SELECT source_type, pages_updated FROM ingest_log WHERE source_type = $1`,
          ['oauth:gmail'],
        );
        expect(logs.length).toBeGreaterThanOrEqual(1);
      } finally {
        await close();
      }
    },
    TIMEOUT,
  );

  test(
    're-pulling the same item is idempotent (no duplicate page)',
    async () => {
      const { sink, engine, close } = await freshBrain();
      try {
        const registry = ProviderRegistry.default();
        const store = new MemorySyncStateStore();
        let t = Date.now();
        const puller = new Puller({ client: gmailClient('m1'), registry, sink, stateStore: store, now: () => t });

        await puller.runOneTick();
        // Advance past the interval and pull again — the dedup set must prevent
        // a second sink write, and put_page's (source_id, slug) upsert means the
        // row count stays at 1 regardless.
        t += 3600 * 1000;
        puller.recordSyncSuccess; // (no-op reference to keep intent explicit)
        const second = new Puller({ client: gmailClient('m1'), registry, sink, stateStore: store, now: () => t });
        await second.runOneTick();

        const eng = engine as { executeRaw<T>(sql: string, params?: unknown[]): Promise<T[]> };
        const rows = await eng.executeRaw<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM pages WHERE slug = $1`,
          ['emails/2026-06/m1'],
        );
        expect(rows[0]?.n).toBe(1);
      } finally {
        await close();
      }
    },
    TIMEOUT,
  );
});
