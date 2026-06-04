/**
 * The pluggable destination for pulled context-memory.
 *
 * This is THE seam that replaces OpenHuman's hard-wired `memory_tree` write
 * (`providers/gmail/ingest.rs` → `ingest_email`). A ProviderAdapter normalizes
 * raw Composio action results into {@link IngestItem}s; the puller hands a batch
 * to an {@link IngestSink}. The default {@link GbrainSink} writes brainpages,
 * but any product can supply its own sink.
 */

/** Why a sync ran — surfaced to the sink for logging / heuristics. */
export type SyncReason = 'initial' | 'periodic' | 'manual';

/**
 * One normalized unit handed to the sink. The puller does only LIGHT
 * structural normalization (e.g. HTML→text for email bodies); enrichment
 * (entity resolution, summarization) is the sink/skill's job downstream.
 */
export interface IngestItem {
  /** Toolkit slug, e.g. `"gmail"`. */
  toolkit: string;
  /** Owning connection id. */
  connectionId: string;
  /** Provider-native id — the dedup key. */
  externalId: string;
  /** Coarse kind: `"email" | "message" | "event" | "page" | "issue" | "doc"…`. */
  kind: string;
  /** Display title. */
  title: string;
  /** Body as light markdown / plain text. */
  body: string;
  /** When the item occurred (epoch ms), if known. */
  occurredAt?: number;
  /** Participants (emails / handles) for downstream bucketing + enrichment. */
  participants?: string[];
  /** Original URI / message-id / permalink → becomes `source_uri` provenance. */
  sourceUri?: string;
  /** Which GBrain skill should refine this raw page (frontmatter hint). */
  suggestedSkill?: string;
  /** Untouched provider payload (for optional raw retention / replay). */
  raw: unknown;
}

export interface SinkBatchContext {
  toolkit: string;
  connectionId: string;
  reason: SyncReason;
}

export interface SinkResult {
  /** Page identifiers (slugs) the sink upserted. */
  pagesUpserted: string[];
  summary: string;
}

export interface IngestSink {
  writeBatch(items: IngestItem[], ctx: SinkBatchContext): Promise<SinkResult>;
}

/**
 * No-op recording sink. Captures everything in memory — used by tests and by
 * the pull loop in phases before a real sink is wired.
 */
export class RecordingSink implements IngestSink {
  readonly batches: { items: IngestItem[]; ctx: SinkBatchContext }[] = [];

  get items(): IngestItem[] {
    return this.batches.flatMap((b) => b.items);
  }

  async writeBatch(items: IngestItem[], ctx: SinkBatchContext): Promise<SinkResult> {
    this.batches.push({ items, ctx });
    return {
      pagesUpserted: items.map((i) => `${i.toolkit}:${i.externalId}`),
      summary: `recorded ${items.length} ${ctx.toolkit} items`,
    };
  }
}
