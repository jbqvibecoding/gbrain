/**
 * Ported 1:1 from OpenHuman's `sync_state.rs` `#[cfg(test)]` block, plus the
 * TS-specific blob round-trip / legacy-tolerance assertions.
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_DAILY_REQUEST_LIMIT,
  DailyBudget,
  SyncState,
  extractItemId,
  todayStr,
  type SyncStateBlob,
} from '../src/puller/sync-state.ts';

describe('DailyBudget', () => {
  test('defaults to full', () => {
    const b = new DailyBudget();
    expect(b.remaining()).toBe(DEFAULT_DAILY_REQUEST_LIMIT);
    expect(b.isExhausted()).toBe(false);
  });

  test('tracks requests', () => {
    const b = new DailyBudget();
    b.recordRequests(100);
    expect(b.remaining()).toBe(DEFAULT_DAILY_REQUEST_LIMIT - 100);
    expect(b.isExhausted()).toBe(false);
  });

  test('exhaustion', () => {
    const b = new DailyBudget();
    b.recordRequests(DEFAULT_DAILY_REQUEST_LIMIT);
    expect(b.remaining()).toBe(0);
    expect(b.isExhausted()).toBe(true);
  });

  test('saturates on overflow', () => {
    const b = new DailyBudget();
    b.recordRequests(DEFAULT_DAILY_REQUEST_LIMIT + 100);
    expect(b.remaining()).toBe(0);
  });

  test('resets on date change', () => {
    const b = new DailyBudget('2025-01-01', 499, DEFAULT_DAILY_REQUEST_LIMIT);
    // remaining() with a stale date returns the full limit.
    expect(b.remaining()).toBe(DEFAULT_DAILY_REQUEST_LIMIT);
    // recording a request resets the counter to today.
    b.recordRequest();
    expect(b.date).toBe(todayStr());
    expect(b.requestsUsed).toBe(1);
  });
});

describe('SyncState', () => {
  test('deduplication', () => {
    const s = SyncState.fresh('gmail', 'conn_1');
    expect(s.isSynced('msg_abc')).toBe(false);
    s.markSynced('msg_abc');
    expect(s.isSynced('msg_abc')).toBe(true);
    expect(s.isSynced('msg_xyz')).toBe(false);
  });

  test('cursor advancement', () => {
    const s = SyncState.fresh('notion', 'conn_2');
    expect(s.cursor).toBeUndefined();
    s.advanceCursor('2026-04-01T00:00:00Z');
    expect(s.cursor).toBe('2026-04-01T00:00:00Z');
    s.advanceCursor('2026-04-10T00:00:00Z');
    expect(s.cursor).toBe('2026-04-10T00:00:00Z');
  });

  test('serialization round-trip', () => {
    const s = SyncState.fresh('gmail', 'conn_test');
    s.advanceCursor('12345');
    s.markSynced('item_a');
    s.markSynced('item_b');
    s.dailyBudget.recordRequests(42);
    s.setLastSeenId('msg_top');
    s.setLastSyncAtMs(1_700_000_000_000);

    const blob = s.toBlob();
    const restored = SyncState.fromBlob(JSON.parse(JSON.stringify(blob)) as SyncStateBlob);

    expect(restored.toolkit).toBe('gmail');
    expect(restored.connectionId).toBe('conn_test');
    expect(restored.cursor).toBe('12345');
    expect(restored.isSynced('item_a')).toBe(true);
    expect(restored.isSynced('item_b')).toBe(true);
    expect(restored.syncedIds.size).toBe(2);
    expect(restored.dailyBudget.requestsUsed).toBe(42);
    expect(restored.lastSeenId).toBe('msg_top');
    expect(restored.lastSyncAtMs).toBe(1_700_000_000_000);
  });

  test('deserializes legacy blob without new fields', () => {
    const legacy: SyncStateBlob = {
      toolkit: 'gmail',
      connection_id: 'conn_old',
      cursor: '1699000000000',
      synced_ids: ['m1', 'm2'],
      daily_budget: { date: todayStr(), requests_used: 7, limit: 500 },
    };
    const restored = SyncState.fromBlob(legacy);
    expect(restored.cursor).toBe('1699000000000');
    expect(restored.syncedIds.size).toBe(2);
    expect(restored.lastSeenId).toBeUndefined();
    expect(restored.lastSyncAtMs).toBeUndefined();
  });

  test('fromBlob rolls a stale budget over to today', () => {
    const blob: SyncStateBlob = {
      toolkit: 'gmail',
      connection_id: 'c',
      daily_budget: { date: '2025-01-01', requests_used: 499, limit: 500 },
    };
    const restored = SyncState.fromBlob(blob);
    expect(restored.dailyBudget.date).toBe(todayStr());
    expect(restored.dailyBudget.requestsUsed).toBe(0);
  });

  test('setLastSeenId overwrites previous value', () => {
    const s = SyncState.fresh('gmail', 'c');
    s.setLastSeenId('a');
    s.setLastSeenId('b');
    expect(s.lastSeenId).toBe('b');
  });

  test('setLastSyncAtMs records value', () => {
    const s = SyncState.fresh('gmail', 'c');
    s.setLastSyncAtMs(123);
    s.setLastSyncAtMs(456);
    expect(s.lastSyncAtMs).toBe(456);
  });

  test('kvKey is deterministic', () => {
    const s1 = SyncState.fresh('gmail', 'conn_x');
    const s2 = SyncState.fresh('gmail', 'conn_x');
    expect(s1.kvKey()).toBe(s2.kvKey());
    expect(s1.kvKey()).toBe('gmail:conn_x');
  });
});

describe('extractItemId', () => {
  test('walks paths in order', () => {
    const item = { id: 'top_level', data: { id: 'nested' } };
    expect(extractItemId(item, ['data.id', 'id'])).toBe('nested');
    expect(extractItemId(item, ['missing', 'id'])).toBe('top_level');
    expect(extractItemId(item, ['nope'])).toBeUndefined();
  });

  test('skips empty / whitespace strings', () => {
    const item = { a: '   ', b: 'real' };
    expect(extractItemId(item, ['a', 'b'])).toBe('real');
  });
});
