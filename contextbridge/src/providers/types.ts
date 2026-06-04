/**
 * Provider adapter abstraction.
 *
 * Shrunk from OpenHuman's `ComposioProvider` trait: in the ContextBridge
 * architecture GBrain does the enrichment, so an adapter's job is just to drive
 * one fetch pass and map raw Composio action results into normalized
 * {@link IngestItem}s. Dedup, budget accounting, cursor persistence, and the
 * sink write all live in the generic puller loop.
 */

import type { ComposioClient } from '../composio/types.ts';
import type { IngestItem, SyncReason } from '../sink/ingest-sink.ts';
import type { SyncState } from '../puller/sync-state.ts';
import type { ToolScope } from '../tools/tool-scope.ts';

/** A curated, hand-classified action a toolkit exposes as a typed tool. */
export interface CuratedTool {
  slug: string;
  description?: string;
  scope: ToolScope;
}

export interface PullArgs {
  client: ComposioClient;
  connectionId: string;
  state: SyncState;
  reason: SyncReason;
  /** Upper bound on API requests this pass may consume (budget-derived). */
  maxRequests: number;
}

export interface PullResult {
  /** Normalized items (PRE-dedup — the loop dedups against state.syncedIds). */
  items: IngestItem[];
  /** New cursor watermark, if the pass advanced it. */
  nextCursor?: string;
  /** Number of API requests actually consumed (charged to the daily budget). */
  requestsUsed: number;
}

export interface ProviderAdapter {
  /** Normalized toolkit slug, e.g. `"gmail"`. */
  readonly toolkit: string;
  /** GBrain skill that should refine this provider's raw pages. */
  readonly suggestedSkill: string;
  /** Minimum seconds between syncs; `null` opts out of the periodic loop. */
  syncIntervalSecs(): number | null;
  /** Curated typed-tool catalog (scope-gated), if any. */
  readonly curatedTools?: CuratedTool[];
  /** Drive one fetch pass for one connection. */
  pull(args: PullArgs): Promise<PullResult>;
}
