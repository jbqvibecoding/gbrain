/**
 * Gmail adapter mapping, html→text, slug conventions, and frontmatter render.
 */

import { describe, expect, test } from 'bun:test';
import { GmailAdapter } from '../src/providers/gmail.ts';
import { htmlToText } from '../src/providers/html-text.ts';
import { SyncState } from '../src/puller/sync-state.ts';
import { slugFor } from '../src/sink/slug.ts';
import { renderFrontmatterMarkdown } from '../src/sink/render.ts';
import type { IngestItem } from '../src/sink/ingest-sink.ts';
import { FakeComposioClient } from './fixtures/fake-composio.ts';

describe('GmailAdapter.pull', () => {
  test('maps GMAIL_FETCH_EMAILS messages to IngestItems with participants + cursor', async () => {
    const client = new FakeComposioClient();
    client.executeResponses.set('GMAIL_FETCH_EMAILS', {
      successful: true,
      data: {
        messages: [
          {
            messageId: 'm1',
            subject: 'Sync up',
            from: 'alice@x.com',
            to: 'bob@y.com, carol@z.com',
            messageText: '<p>Hello <b>team</b></p>',
            internalDate: String(Date.parse('2026-06-04T10:00:00Z')),
          },
        ],
      },
    });
    const adapter = new GmailAdapter();
    const state = SyncState.fresh('gmail', 'conn_gmail');
    const res = await adapter.pull({ client, connectionId: 'conn_gmail', state, reason: 'periodic', maxRequests: 100 });

    expect(res.items.length).toBe(1);
    const item = res.items[0]!;
    expect(item.externalId).toBe('m1');
    expect(item.title).toBe('Sync up');
    expect(item.body).toBe('Hello team');
    expect(item.participants?.sort()).toEqual(['alice@x.com', 'bob@y.com', 'carol@z.com']);
    expect(item.suggestedSkill).toBe('meeting-ingestion'); // 3 participants
    expect(res.nextCursor).toBe(String(Date.parse('2026-06-04T10:00:00Z')));
    expect(res.requestsUsed).toBe(1);
  });

  test('builds an incremental after: query from the cursor', async () => {
    const client = new FakeComposioClient();
    client.executeResponses.set('GMAIL_FETCH_EMAILS', { successful: true, data: { messages: [] } });
    const adapter = new GmailAdapter();
    const state = SyncState.fresh('gmail', 'c');
    state.advanceCursor(String(Date.parse('2026-06-01T00:00:00Z')));
    await adapter.pull({ client, connectionId: 'c', state, reason: 'periodic', maxRequests: 100 });
    const args = client.executeCalls[0]?.arguments as Record<string, unknown>;
    expect(String(args.query)).toMatch(/^after:\d+$/);
  });
});

describe('htmlToText', () => {
  test('strips tags, drops scripts, decodes entities', () => {
    const html = '<style>x{}</style><p>Hi&nbsp;there &amp; welcome</p><script>evil()</script><div>Line 2</div>';
    const text = htmlToText(html);
    expect(text).not.toContain('<');
    expect(text).not.toContain('evil');
    expect(text).toContain('Hi there & welcome');
    expect(text).toContain('Line 2');
  });
});

describe('slugFor', () => {
  test('routes per toolkit deterministically', () => {
    const at = Date.parse('2026-06-04T10:00:00Z');
    expect(slugFor({ toolkit: 'gmail', externalId: 'm1', occurredAt: at } as IngestItem)).toBe('emails/2026-06/m1');
    expect(slugFor({ toolkit: 'slack', externalId: '171.99' } as IngestItem)).toBe('messages/slack/171-99');
    expect(slugFor({ toolkit: 'googlecalendar', externalId: 'evt1', occurredAt: at } as IngestItem)).toBe(
      'meetings/2026-06-04/evt1',
    );
    expect(slugFor({ toolkit: 'github', externalId: '42' } as IngestItem)).toBe('issues/github/42');
    expect(slugFor({ toolkit: 'airtable', externalId: 'rec1' } as IngestItem)).toBe('airtable/rec1');
  });
});

describe('renderFrontmatterMarkdown', () => {
  test('emits oauth-raw frontmatter with routing + provenance hints', () => {
    const md = renderFrontmatterMarkdown({
      toolkit: 'gmail',
      connectionId: 'c',
      externalId: 'm1',
      kind: 'email',
      title: 'Hello',
      body: 'Body text',
      occurredAt: Date.parse('2026-06-04T10:00:00Z'),
      participants: ['alice@x.com'],
      sourceUri: '<m1@mail>',
      suggestedSkill: 'meeting-ingestion',
      raw: {},
    });
    expect(md).toContain('type: oauth-raw');
    expect(md).toContain('provider: gmail');
    expect(md).toContain('suggested_skill: meeting-ingestion');
    expect(md).toContain('source_uri:');
    expect(md).toContain('# Hello');
    expect(md).toContain('Body text');
  });
});
