/**
 * The periodic auto-pull loop.
 *
 * Ported from OpenHuman's `composio/periodic.rs`. A single global tick
 * (`TICK_SECONDS`, default 1200 = 20 min) drives every connection:
 *
 *   1. list active connections (direct-mode Composio)
 *   2. for each connection whose toolkit has a registered adapter AND whose
 *      per-provider `syncIntervalSecs` has elapsed since its last sync,
 *   3. load {@link SyncState}, honor the daily budget, run `adapter.pull`,
 *   4. dedup items against `syncedIds`, hand the new ones to the {@link IngestSink},
 *   5. advance the cursor, mark synced, record the request budget, save state,
 *   6. record the in-process last-sync timestamp so the next tick respects it.
 *
 * Errors are logged and swallowed per connection — a failing provider never
 * stops the loop, and a failed pull does NOT advance last-sync (so the next
 * tick retries immediately), exactly like the Rust original.
 */

import type { ComposioClient, Connection } from '../composio/types.ts';
import type { IngestItem, IngestSink, SyncReason } from '../sink/ingest-sink.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { SyncStateStore } from './state-store.ts';

/** Default tick cadence — 20 minutes, matching OpenHuman's `TICK_SECONDS`. */
export const TICK_SECONDS = 1200;

export interface PullerDeps {
  client: ComposioClient;
  registry: ProviderRegistry;
  sink: IngestSink;
  stateStore: SyncStateStore;
  tickSeconds?: number;
  /** Injectable clock (ms) for deterministic tests. */
  now?: () => number;
  logger?: { debug: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; info: (...a: unknown[]) => void };
}

export interface ConnectionReport {
  toolkit: string;
  connectionId: string;
  status: 'synced' | 'skipped_not_due' | 'skipped_no_adapter' | 'skipped_inactive' | 'budget_exhausted' | 'error';
  itemsIngested?: number;
  error?: string;
}

export interface TickReport {
  considered: number;
  fired: number;
  connections: ConnectionReport[];
}

const noopLogger = { debug: () => {}, warn: () => {}, info: () => {} };

export class Puller {
  private readonly deps: Required<Pick<PullerDeps, 'client' | 'registry' | 'sink' | 'stateStore'>> &
    Pick<PullerDeps, never>;
  private readonly tickSeconds: number;
  private readonly now: () => number;
  private readonly logger: NonNullable<PullerDeps['logger']>;
  /** In-process `(toolkit, connectionId) → lastSyncMs`, mirrors `LAST_SYNC_AT`. */
  private readonly lastSyncAt = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private started = false;

  constructor(deps: PullerDeps) {
    this.deps = { client: deps.client, registry: deps.registry, sink: deps.sink, stateStore: deps.stateStore };
    this.tickSeconds = deps.tickSeconds ?? TICK_SECONDS;
    this.now = deps.now ?? Date.now;
    this.logger = deps.logger ?? noopLogger;
  }

  private key(toolkit: string, connectionId: string): string {
    return `${toolkit}:${connectionId}`;
  }

  /** Record a successful sync so the next tick respects the interval. */
  recordSyncSuccess(toolkit: string, connectionId: string): void {
    this.lastSyncAt.set(this.key(toolkit, connectionId), this.now());
  }

  /**
   * Start the background loop. Idempotent (OnceLock-equivalent): the first call
   * spawns the interval; subsequent calls are no-ops. The immediate-fire tick
   * is skipped so startup isn't slammed.
   */
  start(): void {
    if (this.started) {
      this.logger.debug('[contextbridge:puller] already running, skipping start');
      return;
    }
    this.started = true;
    this.logger.info(`[contextbridge:puller] scheduler starting (tick=${this.tickSeconds}s)`);
    this.timer = setInterval(() => {
      void this.runOneTick().catch((e) => this.logger.warn('[contextbridge:puller] tick failed (continuing)', e));
    }, this.tickSeconds * 1000);
    // Don't keep the process alive solely for the timer (Node/Bun).
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Stop the background loop. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.started = false;
  }

  /** Run a single scheduler tick. Public so products / tests can drive it. */
  async runOneTick(reason: SyncReason = 'periodic'): Promise<TickReport> {
    const report: TickReport = { considered: 0, fired: 0, connections: [] };

    let connections: Connection[];
    try {
      connections = await this.deps.client.listConnections();
    } catch (e) {
      // No client / not signed in / no key → skip the tick silently (Ok).
      this.logger.debug('[contextbridge:puller] listConnections failed, skipping tick', e);
      return report;
    }

    for (const conn of connections) {
      report.considered += 1;
      const result = await this.syncConnection(conn, reason);
      report.connections.push(result);
      if (result.status === 'synced') report.fired += 1;
    }

    this.logger.debug(`[contextbridge:puller] tick complete considered=${report.considered} fired=${report.fired}`);
    return report;
  }

  /** Sync (or skip) one connection. Never throws — errors land in the report. */
  private async syncConnection(conn: Connection, reason: SyncReason): Promise<ConnectionReport> {
    const base = { toolkit: conn.toolkit, connectionId: conn.id };

    if (conn.status !== 'active') return { ...base, status: 'skipped_inactive' };

    const adapter = this.deps.registry.get(conn.toolkit);
    if (!adapter) return { ...base, status: 'skipped_no_adapter' };

    const interval = adapter.syncIntervalSecs();
    if (interval == null) return { ...base, status: 'skipped_no_adapter' };

    // Due-check against the in-process last-sync map (None => fire immediately).
    const last = this.lastSyncAt.get(this.key(conn.toolkit, conn.id));
    const due = last == null || this.now() - last >= interval * 1000;
    if (!due) return { ...base, status: 'skipped_not_due' };

    try {
      const state = await this.deps.stateStore.load(conn.toolkit, conn.id);
      const nowDate = new Date(this.now());
      if (state.budgetExhausted(nowDate)) {
        this.logger.debug(`[contextbridge:puller] ${conn.toolkit}:${conn.id} budget exhausted, deferring`);
        return { ...base, status: 'budget_exhausted' };
      }

      const pull = await adapter.pull({
        client: this.deps.client,
        connectionId: conn.id,
        state,
        reason,
        maxRequests: state.budgetRemaining(nowDate),
      });

      // Dedup against the synced set; collect only fresh items.
      const fresh: IngestItem[] = [];
      for (const item of pull.items) {
        if (state.isSynced(item.externalId)) continue;
        fresh.push(item);
      }

      if (fresh.length > 0) {
        await this.deps.sink.writeBatch(fresh, { toolkit: conn.toolkit, connectionId: conn.id, reason });
        for (const item of fresh) state.markSynced(item.externalId);
      }

      // Advance cursor + budget regardless of whether items were fresh — the
      // request was spent and the watermark moved.
      if (pull.nextCursor) state.advanceCursor(pull.nextCursor);
      state.recordRequests(pull.requestsUsed, nowDate);
      state.setLastSyncAtMs(this.now());
      if (pull.items[0]) state.setLastSeenId(pull.items[0].externalId);
      await this.deps.stateStore.save(state);

      this.recordSyncSuccess(conn.toolkit, conn.id);
      this.logger.debug(`[contextbridge:puller] ${conn.toolkit}:${conn.id} sync ok items=${fresh.length}`);
      return { ...base, status: 'synced', itemsIngested: fresh.length };
    } catch (e) {
      // Do NOT record last-sync on failure → next tick retries immediately.
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`[contextbridge:puller] ${conn.toolkit}:${conn.id} sync failed (will retry next tick)`, msg);
      return { ...base, status: 'error', error: msg };
    }
  }
}
