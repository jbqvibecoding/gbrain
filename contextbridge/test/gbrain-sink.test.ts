/**
 * GbrainSink maps pulled items → put_page + log_ingest with honest provenance,
 * and gates extract_facts per-toolkit. Uses a fake GbrainOps (no real engine).
 */

import { describe, expect, test } from 'bun:test';
import { GbrainSink, type GbrainOps } from '../src/sink/gbrain-sink.ts';
import type { IngestItem } from '../src/sink/ingest-sink.ts';

function fakeOps() {
  const putPageCalls: unknown[] = [];
  const logIngestCalls: unknown[] = [];
  const extractFactsCalls: unknown[] = [];
  const ops: GbrainOps = {
    putPage: async (p) => {
      putPageCalls.push(p);
      return { status: 'ok', slug: p.slug };
    },
    logIngest: async (p) => {
      logIngestCalls.push(p);
      return { status: 'ok' };
    },
    extractFacts: async (p) => {
      extractFactsCalls.push(p);
      return { inserted: 1 };
    },
  };
  return { ops, putPageCalls, logIngestCalls, extractFactsCalls };
}

function gmailItem(id: string, participants: string[] = ['alice@x.com', 'bob@y.com']): IngestItem {
  return {
    toolkit: 'gmail',
    connectionId: 'conn_gmail',
    externalId: id,
    kind: 'email',
    title: 'Project update',
    body: 'Alice says the project is 80% done.',
    occurredAt: Date.parse('2026-06-04T10:00:00Z'),
    participants,
    sourceUri: `<${id}@mail.gmail.com>`,
    suggestedSkill: 'meeting-ingestion',
    raw: { id },
  };
}

describe('GbrainSink', () => {
  test('writes one put_page per item with oauth-pull provenance + one log_ingest', async () => {
    const { ops, putPageCalls, logIngestCalls } = fakeOps();
    const sink = new GbrainSink(ops);

    const res = await sink.writeBatch([gmailItem('m1'), gmailItem('m2')], {
      toolkit: 'gmail',
      connectionId: 'conn_gmail',
      reason: 'periodic',
    });

    expect(putPageCalls.length).toBe(2);
    const first = putPageCalls[0] as Record<string, unknown>;
    expect(first.source_kind).toBe('oauth-pull');
    expect(first.source_uri).toBe('<m1@mail.gmail.com>');
    expect(first.ingested_via).toBe('contextbridge:gmail');
    expect(String(first.slug)).toBe('emails/2026-06/m1');
    expect(String(first.content)).toContain('type: oauth-raw');
    expect(String(first.content)).toContain('suggested_skill: meeting-ingestion');

    expect(logIngestCalls.length).toBe(1);
    const log = logIngestCalls[0] as Record<string, unknown>;
    expect(log.source_type).toBe('oauth:gmail');
    expect(log.source_ref).toBe('conn_gmail');
    expect((log.pages_updated as string[]).length).toBe(2);

    expect(res.pagesUpserted).toEqual(['emails/2026-06/m1', 'emails/2026-06/m2']);
  });

  test('does NOT call extract_facts unless the toolkit opts in', async () => {
    const { ops, extractFactsCalls } = fakeOps();
    const sink = new GbrainSink(ops); // no extractFactsToolkits
    await sink.writeBatch([gmailItem('m1')], { toolkit: 'gmail', connectionId: 'c', reason: 'periodic' });
    expect(extractFactsCalls.length).toBe(0);
  });

  test('calls extract_facts for opted-in toolkits with participant hints', async () => {
    const { ops, extractFactsCalls } = fakeOps();
    const sink = new GbrainSink(ops, { extractFactsToolkits: ['gmail'] });
    await sink.writeBatch([gmailItem('m1')], { toolkit: 'gmail', connectionId: 'c', reason: 'periodic' });
    expect(extractFactsCalls.length).toBe(1);
    const fc = extractFactsCalls[0] as Record<string, unknown>;
    expect(fc.entity_hints).toEqual(['alice@x.com', 'bob@y.com']);
    expect(fc.visibility).toBe('world');
  });
});
