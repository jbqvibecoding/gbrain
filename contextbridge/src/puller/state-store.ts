/**
 * Pluggable persistence for {@link SyncState}.
 *
 * The OpenHuman original persisted through `MemoryClient`'s KV surface under
 * the `composio-sync-state` namespace. ContextBridge is storage-agnostic: a
 * product can supply any {@link SyncStateStore}. The default
 * {@link FileSyncStateStore} writes one JSON file per `(toolkit, connectionId)`
 * under `~/.contextbridge/state/` (override via constructor).
 */

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { SyncState, type SyncStateBlob } from './sync-state.ts';

/** KV namespace — matches OpenHuman's so blobs are cross-readable if migrated. */
export const STATE_NAMESPACE = 'composio-sync-state';

export interface SyncStateStore {
  /** Load state for a pair, or return a fresh default when none exists. */
  load(toolkit: string, connectionId: string): Promise<SyncState>;
  /** Persist the current state. */
  save(state: SyncState): Promise<void>;
}

/** Sanitize a kv key into a filesystem-safe filename. */
function safeName(toolkit: string, connectionId: string): string {
  return `${toolkit}__${connectionId}`.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** File-backed default store: one JSON blob per pair. */
export class FileSyncStateStore implements SyncStateStore {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? join(homedir(), '.contextbridge', 'state', STATE_NAMESPACE);
  }

  private pathFor(toolkit: string, connectionId: string): string {
    return join(this.dir, `${safeName(toolkit, connectionId)}.json`);
  }

  async load(toolkit: string, connectionId: string): Promise<SyncState> {
    try {
      const raw = await readFile(this.pathFor(toolkit, connectionId), 'utf8');
      const blob = JSON.parse(raw) as SyncStateBlob;
      return SyncState.fromBlob(blob);
    } catch (err) {
      // ENOENT (fresh) or any parse error → start clean. The caller's next
      // save() heals a corrupt file.
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.warn(`[contextbridge:state] load failed for ${toolkit}:${connectionId}, starting fresh:`, err);
      }
      return SyncState.fresh(toolkit, connectionId);
    }
  }

  async save(state: SyncState): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = this.pathFor(state.toolkit, state.connectionId) + '.tmp';
    const final = this.pathFor(state.toolkit, state.connectionId);
    await writeFile(tmp, JSON.stringify(state.toBlob(), null, 2), 'utf8');
    // Atomic-ish replace so a crash mid-write can't leave a half file.
    const { rename } = await import('node:fs/promises');
    await rename(tmp, final);
  }

  /** Test/diagnostic helper: list persisted pairs. */
  async list(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
  }
}

/** In-memory store — handy for tests and ephemeral pull-once runs. */
export class MemorySyncStateStore implements SyncStateStore {
  private readonly map = new Map<string, SyncStateBlob>();

  async load(toolkit: string, connectionId: string): Promise<SyncState> {
    const blob = this.map.get(`${toolkit}:${connectionId}`);
    return blob ? SyncState.fromBlob(blob) : SyncState.fresh(toolkit, connectionId);
  }

  async save(state: SyncState): Promise<void> {
    this.map.set(state.kvKey(), state.toBlob());
  }
}
