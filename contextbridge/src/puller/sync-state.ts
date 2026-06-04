/**
 * Persistent sync state for a single `(toolkit, connectionId)` pair.
 *
 * Ported 1:1 from OpenHuman's Rust
 * `src/openhuman/composio/providers/sync_state.rs`. The state tracks:
 *
 *   - **cursor** — a provider-specific watermark (timestamp / page token) so
 *     the next sync skips items already seen.
 *   - **syncedIds** — a set of item identifiers already written to the sink.
 *     Items in this set are skipped even if they reappear in an API response
 *     (deduplication).
 *   - **dailyBudget** — a rolling counter keyed by calendar date (`YYYY-MM-DD`)
 *     that caps the number of `execute` calls a provider makes per day; resets
 *     automatically when the date rolls over.
 *
 * Persistence is delegated to a pluggable {@link SyncStateStore} (default:
 * a file-backed store) so state survives process restarts.
 */

/**
 * Maximum API requests a single provider connection may make per calendar day.
 * Covers the initial-backfill case (thousands of unsynced items): after this
 * many requests the provider yields and continues the next day.
 */
export const DEFAULT_DAILY_REQUEST_LIMIT = 500;

/** Today's date as `YYYY-MM-DD` in UTC. Mirrors Rust `today_str()`. */
export function todayStr(now: Date = new Date()): string {
  // toISOString() is always UTC; take the date half. Matches chrono's
  // `Utc::now().format("%Y-%m-%d")`.
  return now.toISOString().slice(0, 10);
}

/** Serialized shape of {@link DailyBudget} (what lands in the state store). */
export interface DailyBudgetBlob {
  date: string;
  requests_used: number;
  limit: number;
}

/**
 * Tracks the number of API requests made on a given calendar day.
 * Automatically resets when the date rolls over.
 */
export class DailyBudget {
  date: string;
  requestsUsed: number;
  limit: number;

  constructor(
    date: string = todayStr(),
    requestsUsed = 0,
    limit: number = DEFAULT_DAILY_REQUEST_LIMIT,
  ) {
    this.date = date;
    this.requestsUsed = requestsUsed;
    this.limit = limit;
  }

  /**
   * Remaining requests available today. If the stored date is stale (a
   * previous day), returns the full limit because the budget resets on the
   * next {@link recordRequest} call.
   */
  remaining(now: Date = new Date()): number {
    if (this.date !== todayStr(now)) return this.limit;
    return Math.max(0, this.limit - this.requestsUsed);
  }

  /** True when today's budget is exhausted. */
  isExhausted(now: Date = new Date()): boolean {
    return this.remaining(now) === 0;
  }

  /** Record `n` API requests. Resets the counter first if the date rolled over. */
  recordRequests(n: number, now: Date = new Date()): void {
    const today = todayStr(now);
    if (this.date !== today) {
      this.date = today;
      this.requestsUsed = 0;
    }
    // Saturating add (u32 semantics in Rust; here we just clamp at limit-aware
    // remaining() so overflow never under-reports exhaustion).
    this.requestsUsed = this.requestsUsed + Math.max(0, n);
  }

  /** Record a single API request. */
  recordRequest(now: Date = new Date()): void {
    this.recordRequests(1, now);
  }

  toBlob(): DailyBudgetBlob {
    return { date: this.date, requests_used: this.requestsUsed, limit: this.limit };
  }

  static fromBlob(blob: Partial<DailyBudgetBlob> | undefined): DailyBudget {
    if (!blob) return new DailyBudget();
    return new DailyBudget(
      blob.date ?? todayStr(),
      blob.requests_used ?? 0,
      blob.limit ?? DEFAULT_DAILY_REQUEST_LIMIT,
    );
  }
}

/**
 * Serialized shape of {@link SyncState}. snake_case keys match the Rust serde
 * representation byte-for-byte so an OpenHuman-written blob (or a legacy blob
 * predating the `last_seen_id` / `last_sync_at_ms` fields) deserializes
 * cleanly. `syncedIds` is stored as an array (JSON has no Set).
 */
export interface SyncStateBlob {
  toolkit: string;
  connection_id: string;
  cursor?: string | null;
  synced_ids?: string[];
  daily_budget?: DailyBudgetBlob;
  last_seen_id?: string | null;
  last_sync_at_ms?: number | null;
}

/** Persistent sync state for one `(toolkit, connectionId)` pair. */
export class SyncState {
  toolkit: string;
  connectionId: string;
  /** Provider-specific watermark. `undefined` => "never synced — start fresh". */
  cursor?: string;
  /** Item IDs already persisted to the sink (dedup set). */
  syncedIds: Set<string>;
  /** Rolling daily request budget. */
  dailyBudget: DailyBudget;
  /** Freshest item id observed — short-circuits a tick when nothing changed. */
  lastSeenId?: string;
  /** Unix ms of the last successful sync that wrote into the sink. */
  lastSyncAtMs?: number;

  constructor(toolkit: string, connectionId: string) {
    this.toolkit = toolkit;
    this.connectionId = connectionId;
    this.cursor = undefined;
    this.syncedIds = new Set();
    this.dailyBudget = new DailyBudget();
    this.lastSeenId = undefined;
    this.lastSyncAtMs = undefined;
  }

  /** Fresh state for a never-synced connection. */
  static fresh(toolkit: string, connectionId: string): SyncState {
    return new SyncState(toolkit, connectionId);
  }

  /** Record the freshest item id observed on a successful sync (idempotent). */
  setLastSeenId(itemId: string): void {
    this.lastSeenId = itemId;
  }

  /** Record the wall-clock time (unix ms) of a successful sync. */
  setLastSyncAtMs(ms: number): void {
    this.lastSyncAtMs = ms;
  }

  /** Whether today's request budget is exhausted. */
  budgetExhausted(now: Date = new Date()): boolean {
    return this.dailyBudget.isExhausted(now);
  }

  /** Remaining API requests for today. */
  budgetRemaining(now: Date = new Date()): number {
    return this.dailyBudget.remaining(now);
  }

  /** Record API requests made. */
  recordRequests(n: number, now: Date = new Date()): void {
    this.dailyBudget.recordRequests(n, now);
  }

  /** Whether an item ID has already been synced. */
  isSynced(itemId: string): boolean {
    return this.syncedIds.has(itemId);
  }

  /** Mark an item ID as synced. */
  markSynced(itemId: string): void {
    this.syncedIds.add(itemId);
  }

  /** Advance the cursor watermark. */
  advanceCursor(cursor: string): void {
    this.cursor = cursor;
  }

  /** Deterministic KV key so load + save are symmetric. */
  kvKey(): string {
    return `${this.toolkit}:${this.connectionId}`;
  }

  toBlob(): SyncStateBlob {
    return {
      toolkit: this.toolkit,
      connection_id: this.connectionId,
      cursor: this.cursor ?? null,
      synced_ids: [...this.syncedIds],
      daily_budget: this.dailyBudget.toBlob(),
      last_seen_id: this.lastSeenId ?? null,
      last_sync_at_ms: this.lastSyncAtMs ?? null,
    };
  }

  /**
   * Rehydrate from a stored blob. Tolerant of legacy blobs that predate the
   * `last_seen_id` / `last_sync_at_ms` fields (they deserialize to undefined),
   * and rolls the daily budget over if the stored date is stale — exactly like
   * the Rust `load()`.
   */
  static fromBlob(blob: SyncStateBlob, now: Date = new Date()): SyncState {
    const s = new SyncState(blob.toolkit, blob.connection_id);
    s.cursor = blob.cursor ?? undefined;
    s.syncedIds = new Set(blob.synced_ids ?? []);
    s.dailyBudget = DailyBudget.fromBlob(blob.daily_budget);
    s.lastSeenId = blob.last_seen_id ?? undefined;
    s.lastSyncAtMs = blob.last_sync_at_ms ?? undefined;
    // Roll the budget over if the persisted date is stale.
    if (s.dailyBudget.date !== todayStr(now)) {
      s.dailyBudget.date = todayStr(now);
      s.dailyBudget.requestsUsed = 0;
    }
    return s;
  }
}

/**
 * Extract an ID string from a JSON value, trying multiple dotted candidate
 * paths in order. Returns the first non-empty trimmed string found.
 * Mirrors Rust `extract_item_id`.
 */
export function extractItemId(item: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    let cur: unknown = item;
    let ok = true;
    for (const segment of path.split('.')) {
      if (cur != null && typeof cur === 'object' && segment in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[segment];
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (typeof cur === 'string') {
      const trimmed = cur.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
}
