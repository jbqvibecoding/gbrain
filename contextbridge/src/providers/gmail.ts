/**
 * Gmail provider adapter.
 *
 * Drives `GMAIL_FETCH_EMAILS` and maps each message into an {@link IngestItem}.
 * Cursor = internal-date (epoch ms) of the newest synced message; the next pass
 * asks Gmail for messages `newer_than` that watermark. Body HTML is reduced to
 * text; participant emails are surfaced for downstream bucketing/enrichment.
 *
 * Routing: Gmail threads with multiple human participants are best refined by
 * GBrain's `meeting-ingestion` skill (attendee enrichment + timeline); the
 * `oauth-ingest` router falls back to `webhook-transforms` for single-party
 * mail. We tag `meeting-ingestion` as the default suggestion.
 */

import { extractItemId, type SyncState } from '../puller/sync-state.ts';
import type { IngestItem } from '../sink/ingest-sink.ts';
import { htmlToText } from './html-text.ts';
import type { CuratedTool, ProviderAdapter, PullArgs, PullResult } from './types.ts';

const FETCH_ACTION = 'GMAIL_FETCH_EMAILS';
const ID_PATHS = ['messageId', 'message_id', 'id', 'data.messageId'];
const SYNC_INTERVAL_SECS = 15 * 60; // 15 min, matching OpenHuman's GmailProvider
const PAGE_SIZE = 25;

const CURATED: CuratedTool[] = [
  { slug: 'GMAIL_FETCH_EMAILS', description: 'Fetch recent emails', scope: 'read' },
  { slug: 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', description: 'Fetch one message', scope: 'read' },
  { slug: 'GMAIL_LIST_THREADS', description: 'List threads', scope: 'read' },
  { slug: 'GMAIL_SEND_EMAIL', description: 'Send an email', scope: 'write' },
  { slug: 'GMAIL_CREATE_EMAIL_DRAFT', description: 'Create a draft', scope: 'write' },
  { slug: 'GMAIL_DELETE_MESSAGE', description: 'Delete a message', scope: 'admin' },
];

function asArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  return [];
}

/** Pull the messages array out of whatever envelope Composio returned. */
function extractMessages(data: unknown): Record<string, unknown>[] {
  if (data == null || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  return (
    asArray(d.messages).length
      ? asArray(d.messages)
      : asArray((d.data as Record<string, unknown>)?.messages) ||
        asArray(d.response_data) ||
        asArray(d.items)
  );
}

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function parseParticipants(msg: Record<string, unknown>): string[] {
  const emails = new Set<string>();
  const header = (msg.payload as Record<string, unknown>) ?? msg;
  for (const key of ['from', 'to', 'sender', 'recipient', 'cc']) {
    const v = pickStr(msg, key) ?? pickStr(header, key);
    if (!v) continue;
    for (const m of v.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) emails.add(m[0].toLowerCase());
  }
  return [...emails];
}

function messageBody(msg: Record<string, unknown>): string {
  const raw =
    pickStr(msg, 'messageText', 'message_text', 'body', 'snippet', 'text') ??
    pickStr((msg.payload as Record<string, unknown>) ?? {}, 'body', 'html') ??
    '';
  // If it looks like HTML, reduce it.
  return /<[a-z][\s\S]*>/i.test(raw) ? htmlToText(raw) : raw;
}

function internalDateMs(msg: Record<string, unknown>): number | undefined {
  const v = msg.internalDate ?? msg.internal_date ?? msg.messageTimestamp;
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

export class GmailAdapter implements ProviderAdapter {
  readonly toolkit = 'gmail';
  readonly suggestedSkill = 'meeting-ingestion';
  readonly curatedTools = CURATED;

  syncIntervalSecs(): number | null {
    return SYNC_INTERVAL_SECS;
  }

  async pull(args: PullArgs): Promise<PullResult> {
    const { client, connectionId, state } = args;
    if (args.maxRequests < 1) return { items: [], requestsUsed: 0 };

    // Build the incremental query from the cursor watermark (epoch ms).
    const query: Record<string, unknown> = { max_results: PAGE_SIZE };
    if (state.cursor) {
      const afterSecs = Math.floor(Number(state.cursor) / 1000);
      if (Number.isFinite(afterSecs) && afterSecs > 0) query.query = `after:${afterSecs}`;
    }

    const res = await client.execute({ tool: FETCH_ACTION, connectionId, arguments: query });
    const requestsUsed = 1;
    if (!res.successful) {
      throw new Error(`[contextbridge:gmail] ${FETCH_ACTION} failed: ${res.error ?? 'unknown error'}`);
    }

    const messages = extractMessages(res.data);
    const items: IngestItem[] = [];
    let newestMs = state.cursor ? Number(state.cursor) : 0;

    for (const msg of messages) {
      const externalId = extractItemId(msg, ID_PATHS);
      if (!externalId) continue;
      const occurredAt = internalDateMs(msg);
      if (occurredAt && occurredAt > newestMs) newestMs = occurredAt;

      const subject = pickStr(msg, 'subject') ?? pickStr((msg.payload as Record<string, unknown>) ?? {}, 'subject') ?? '(no subject)';
      const participants = parseParticipants(msg);
      items.push({
        toolkit: this.toolkit,
        connectionId,
        externalId,
        kind: 'email',
        title: subject,
        body: messageBody(msg),
        occurredAt,
        participants,
        sourceUri: externalId,
        suggestedSkill: participants.length > 2 ? 'meeting-ingestion' : 'webhook-transforms',
        raw: msg,
      });
    }

    const nextCursor = newestMs > 0 ? String(newestMs) : state.cursor;
    return { items, nextCursor, requestsUsed };
  }
}
