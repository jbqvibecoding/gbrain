/**
 * Configurable provider adapter for toolkits that don't need bespoke logic.
 *
 * Slack / Notion / GitHub / Linear / Calendar all follow the same shape: call
 * one fetch action, walk a result array, extract id/title/body/date via
 * configured paths. Bespoke providers (Gmail) implement {@link ProviderAdapter}
 * directly; everything else is a {@link GenericAdapter} instance.
 */

import { extractItemId, type SyncState } from '../puller/sync-state.ts';
import type { ComposioClient } from '../composio/types.ts';
import type { IngestItem } from '../sink/ingest-sink.ts';
import { htmlToText } from './html-text.ts';
import type { CuratedTool, ProviderAdapter, PullArgs, PullResult } from './types.ts';

export interface GenericAdapterConfig {
  toolkit: string;
  suggestedSkill: string;
  fetchAction: string;
  /** Candidate dotted paths to the item id. */
  idPaths: string[];
  /** Candidate keys for the title. */
  titleKeys: string[];
  /** Candidate keys for the body. */
  bodyKeys: string[];
  /** Candidate keys for the occurrence timestamp (ISO or epoch). */
  dateKeys?: string[];
  kind: string;
  syncIntervalSecs: number | null;
  /** Candidate keys holding the result array within the execute payload. */
  resultArrayKeys?: string[];
  /** Static fetch args (page size, etc.). */
  fetchArgs?: Record<string, unknown>;
  /** Map cursor → incremental fetch args. */
  cursorArgs?: (cursor: string) => Record<string, unknown>;
  curatedTools?: CuratedTool[];
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

function pickArray(data: unknown, keys: string[]): Record<string, unknown>[] {
  if (data == null || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  for (const k of keys) {
    if (Array.isArray(d[k])) return d[k] as Record<string, unknown>[];
    const nested = (d.data as Record<string, unknown>)?.[k];
    if (Array.isArray(nested)) return nested as Record<string, unknown>[];
  }
  // Last resort: the payload itself is the array.
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return [];
}

function toMs(v: unknown): number | undefined {
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000; // sec vs ms heuristic
  if (typeof v === 'string') {
    if (/^\d+(\.\d+)?$/.test(v)) {
      const n = Number(v);
      return n > 1e12 ? n : n * 1000;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

export class GenericAdapter implements ProviderAdapter {
  readonly toolkit: string;
  readonly suggestedSkill: string;
  readonly curatedTools?: CuratedTool[];
  private readonly cfg: GenericAdapterConfig;

  constructor(cfg: GenericAdapterConfig) {
    this.cfg = cfg;
    this.toolkit = cfg.toolkit;
    this.suggestedSkill = cfg.suggestedSkill;
    this.curatedTools = cfg.curatedTools;
  }

  syncIntervalSecs(): number | null {
    return this.cfg.syncIntervalSecs;
  }

  async pull(args: PullArgs): Promise<PullResult> {
    const { client, connectionId, state } = args;
    if (args.maxRequests < 1) return { items: [], requestsUsed: 0 };

    const fetchArgs: Record<string, unknown> = { ...(this.cfg.fetchArgs ?? {}) };
    if (state.cursor && this.cfg.cursorArgs) Object.assign(fetchArgs, this.cfg.cursorArgs(state.cursor));

    const res = await client.execute({
      tool: this.cfg.fetchAction,
      connectionId,
      arguments: fetchArgs,
    });
    if (!res.successful) {
      throw new Error(
        `[contextbridge:${this.toolkit}] ${this.cfg.fetchAction} failed: ${res.error ?? 'unknown error'}`,
      );
    }

    const rows = pickArray(res.data, this.cfg.resultArrayKeys ?? ['items', 'results', 'data', 'messages']);
    const items: IngestItem[] = [];
    let newestMs = state.cursor ? toMs(state.cursor) ?? 0 : 0;

    for (const row of rows) {
      const externalId = extractItemId(row, this.cfg.idPaths);
      if (!externalId) continue;
      const occurredAt = this.cfg.dateKeys ? toMs(pickStr(row, this.cfg.dateKeys)) : undefined;
      if (occurredAt && occurredAt > newestMs) newestMs = occurredAt;
      const rawBody = pickStr(row, this.cfg.bodyKeys) ?? '';
      const body = /<[a-z][\s\S]*>/i.test(rawBody) ? htmlToText(rawBody) : rawBody;
      items.push({
        toolkit: this.toolkit,
        connectionId,
        externalId,
        kind: this.cfg.kind,
        title: pickStr(row, this.cfg.titleKeys) ?? `${this.cfg.kind} ${externalId}`,
        body,
        occurredAt,
        sourceUri: externalId,
        suggestedSkill: this.suggestedSkill,
        raw: row,
      });
    }

    const nextCursor = newestMs > 0 ? new Date(newestMs).toISOString() : state.cursor;
    return { items, nextCursor, requestsUsed: 1 };
  }
}

/** Build the bundled non-Gmail adapters. */
export function buildGenericAdapters(): ProviderAdapter[] {
  return [
    new GenericAdapter({
      toolkit: 'slack',
      suggestedSkill: 'signal-detector',
      fetchAction: 'SLACK_FETCH_CONVERSATION_HISTORY',
      idPaths: ['ts', 'client_msg_id', 'id'],
      titleKeys: ['text', 'subject'],
      bodyKeys: ['text', 'message'],
      dateKeys: ['ts', 'timestamp', 'event_ts'],
      kind: 'message',
      syncIntervalSecs: 15 * 60,
      resultArrayKeys: ['messages', 'items'],
      cursorArgs: (c) => ({ oldest: Math.floor((toMs(c) ?? 0) / 1000) }),
      curatedTools: [
        { slug: 'SLACK_FETCH_CONVERSATION_HISTORY', scope: 'read' },
        { slug: 'SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL', scope: 'write' },
      ],
    }),
    new GenericAdapter({
      toolkit: 'notion',
      suggestedSkill: 'media-ingest',
      fetchAction: 'NOTION_SEARCH_NOTION_PAGE',
      idPaths: ['id', 'page_id'],
      titleKeys: ['title', 'name'],
      bodyKeys: ['content', 'plain_text', 'text'],
      dateKeys: ['last_edited_time', 'created_time'],
      kind: 'page',
      syncIntervalSecs: 30 * 60,
      resultArrayKeys: ['results', 'items'],
      cursorArgs: (c) => ({ start_cursor: c }),
      curatedTools: [
        { slug: 'NOTION_SEARCH_NOTION_PAGE', scope: 'read' },
        { slug: 'NOTION_FETCH_DATA', scope: 'read' },
        { slug: 'NOTION_CREATE_NOTION_PAGE', scope: 'write' },
      ],
    }),
    new GenericAdapter({
      toolkit: 'github',
      suggestedSkill: 'webhook-transforms',
      fetchAction: 'GITHUB_LIST_REPOSITORY_ISSUES',
      idPaths: ['id', 'number', 'node_id'],
      titleKeys: ['title'],
      bodyKeys: ['body'],
      dateKeys: ['updated_at', 'created_at'],
      kind: 'issue',
      syncIntervalSecs: 30 * 60,
      resultArrayKeys: ['items', 'issues'],
      cursorArgs: (c) => ({ since: c }),
      curatedTools: [
        { slug: 'GITHUB_LIST_REPOSITORY_ISSUES', scope: 'read' },
        { slug: 'GITHUB_CREATE_AN_ISSUE', scope: 'write' },
      ],
    }),
    new GenericAdapter({
      toolkit: 'linear',
      suggestedSkill: 'webhook-transforms',
      fetchAction: 'LINEAR_LIST_LINEAR_ISSUES',
      idPaths: ['id', 'identifier'],
      titleKeys: ['title'],
      bodyKeys: ['description'],
      dateKeys: ['updatedAt', 'createdAt'],
      kind: 'issue',
      syncIntervalSecs: 30 * 60,
      resultArrayKeys: ['issues', 'items', 'nodes'],
      curatedTools: [
        { slug: 'LINEAR_LIST_LINEAR_ISSUES', scope: 'read' },
        { slug: 'LINEAR_CREATE_LINEAR_ISSUE', scope: 'write' },
      ],
    }),
    new GenericAdapter({
      toolkit: 'googlecalendar',
      suggestedSkill: 'meeting-ingestion',
      fetchAction: 'GOOGLECALENDAR_EVENTS_LIST',
      idPaths: ['id', 'iCalUID'],
      titleKeys: ['summary', 'title'],
      bodyKeys: ['description'],
      dateKeys: ['updated', 'created'],
      kind: 'event',
      syncIntervalSecs: 30 * 60,
      resultArrayKeys: ['items', 'events'],
      cursorArgs: (c) => ({ updatedMin: c }),
      curatedTools: [
        { slug: 'GOOGLECALENDAR_EVENTS_LIST', scope: 'read' },
        { slug: 'GOOGLECALENDAR_CREATE_EVENT', scope: 'write' },
      ],
    }),
  ];
}
