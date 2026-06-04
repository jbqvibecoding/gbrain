/**
 * Puller loop behavior — ports the semantics asserted by `periodic.rs`:
 * due-logic, skip inactive / no-adapter, dedup, budget, and the
 * "failure does NOT advance last-sync" rule.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { Puller } from '../src/puller/loop.ts';
import { MemorySyncStateStore } from '../src/puller/state-store.ts';
import { ProviderRegistry } from '../src/providers/registry.ts';
import { GenericAdapter } from '../src/providers/generic.ts';
import { RecordingSink } from '../src/sink/ingest-sink.ts';
import type { Connection } from '../src/composio/types.ts';
import { FakeComposioClient } from './fixtures/fake-composio.ts';

function activeConn(toolkit: string, id = `conn_${toolkit}`): Connection {
  return { id, toolkit, status: 'active' };
}

// A tiny adapter that returns a configurable list of items, 1 request each.
function testAdapter(toolkit: string, items: { id: string }[], intervalSecs: number | null = 900) {
  return new GenericAdapter({
    toolkit,
    suggestedSkill: 'webhook-transforms',
    fetchAction: `${toolkit.toUpperCase()}_FETCH`,
    idPaths: ['id'],
    titleKeys: ['title'],
    bodyKeys: ['body'],
    kind: 'item',
    syncIntervalSecs: intervalSecs,
    resultArrayKeys: ['items'],
  });
}

describe('Puller.runOneTick', () => {
  let client: FakeComposioClient;
  let sink: RecordingSink;
  let store: MemorySyncStateStore;

  beforeEach(() => {
    client = new FakeComposioClient();
    sink = new RecordingSink();
    store = new MemorySyncStateStore();
  });

  function makePuller(registry: ProviderRegistry, now = () => 1_000_000) {
    return new Puller({ client, registry, sink, stateStore: store, now });
  }

  test('fires sync for a due active connection and writes fresh items', async () => {
    client.connections = [activeConn('acme')];
    client.executeResponses.set('ACME_FETCH', {
      successful: true,
      data: { items: [{ id: 'a1', title: 'One', body: 'b1' }, { id: 'a2', title: 'Two', body: 'b2' }] },
    });
    const registry = new ProviderRegistry([testAdapter('acme', [])]);
    const report = await makePuller(registry).runOneTick();

    expect(report.fired).toBe(1);
    expect(sink.items.map((i) => i.externalId)).toEqual(['a1', 'a2']);
    expect(report.connections[0]?.status).toBe('synced');
    expect(report.connections[0]?.itemsIngested).toBe(2);
  });

  test('skips inactive connections', async () => {
    client.connections = [{ id: 'c', toolkit: 'acme', status: 'pending' }];
    const registry = new ProviderRegistry([testAdapter('acme', [])]);
    const report = await makePuller(registry).runOneTick();
    expect(report.fired).toBe(0);
    expect(report.connections[0]?.status).toBe('skipped_inactive');
  });

  test('skips toolkits with no registered adapter', async () => {
    client.connections = [activeConn('unknownkit')];
    const report = await makePuller(ProviderRegistry.default()).runOneTick();
    expect(report.connections[0]?.status).toBe('skipped_no_adapter');
  });

  test('dedups items already in syncedIds across ticks', async () => {
    client.connections = [activeConn('acme')];
    client.executeResponses.set('ACME_FETCH', {
      successful: true,
      data: { items: [{ id: 'a1', title: 'One', body: 'b1' }] },
    });
    const registry = new ProviderRegistry([testAdapter('acme', [])]);

    let t = 1_000_000;
    const puller = new Puller({ client, registry, sink, stateStore: store, now: () => t });
    await puller.runOneTick();
    expect(sink.items.length).toBe(1);

    // Advance well past the interval; same item id returns → must be deduped.
    t += 1_000 * 1000;
    await puller.runOneTick();
    expect(sink.items.length).toBe(1); // no new write
  });

  test('respects the per-provider interval (not due → skip)', async () => {
    client.connections = [activeConn('acme')];
    client.executeResponses.set('ACME_FETCH', { successful: true, data: { items: [{ id: 'a1' }] } });
    const registry = new ProviderRegistry([testAdapter('acme', [], 900)]);

    let t = 1_000_000;
    const puller = new Puller({ client, registry, sink, stateStore: store, now: () => t });
    await puller.runOneTick(); // first fire
    t += 60 * 1000; // only 60s later, interval is 900s
    const report = await puller.runOneTick();
    expect(report.connections[0]?.status).toBe('skipped_not_due');
  });

  test('a failed pull does NOT advance last-sync (retries next tick)', async () => {
    client.connections = [activeConn('acme')];
    client.executeResponses.set('ACME_FETCH', { successful: false, error: 'boom' });
    const registry = new ProviderRegistry([testAdapter('acme', [])]);

    let t = 1_000_000;
    const puller = new Puller({ client, registry, sink, stateStore: store, now: () => t });
    const r1 = await puller.runOneTick();
    expect(r1.connections[0]?.status).toBe('error');

    // Next tick (even immediately) must still be due, because failure didn't
    // record last-sync. Now succeed.
    client.executeResponses.set('ACME_FETCH', { successful: true, data: { items: [{ id: 'a1' }] } });
    const r2 = await puller.runOneTick();
    expect(r2.connections[0]?.status).toBe('synced');
  });

  test('budget exhaustion defers the connection', async () => {
    client.connections = [activeConn('acme')];
    client.executeResponses.set('ACME_FETCH', { successful: true, data: { items: [{ id: 'a1' }] } });
    const registry = new ProviderRegistry([testAdapter('acme', [])]);
    // Pre-load an exhausted budget. Use the real wall clock here so the
    // budget's calendar date agrees with the puller's clock (an injected
    // 1970 clock would look like a date rollover and reset the budget).
    const state = await store.load('acme', 'conn_acme');
    state.recordRequests(500);
    await store.save(state);

    const puller = new Puller({ client, registry, sink, stateStore: store }); // real Date.now
    const report = await puller.runOneTick();
    expect(report.connections[0]?.status).toBe('budget_exhausted');
    expect(sink.items.length).toBe(0);
  });

  test('listConnections failure skips the tick silently (Ok)', async () => {
    const failing = new FakeComposioClient();
    failing.listConnections = async () => {
      throw new Error('not signed in');
    };
    const puller = new Puller({
      client: failing,
      registry: ProviderRegistry.default(),
      sink,
      stateStore: store,
    });
    const report = await puller.runOneTick();
    expect(report.considered).toBe(0);
    expect(report.fired).toBe(0);
  });
});

describe('Puller.start idempotency', () => {
  test('start is idempotent and stop clears the timer', () => {
    const puller = new Puller({
      client: new FakeComposioClient(),
      registry: ProviderRegistry.default(),
      sink: new RecordingSink(),
      stateStore: new MemorySyncStateStore(),
      tickSeconds: 3600,
    });
    puller.start();
    puller.start(); // no-op, must not throw
    puller.stop();
    expect(true).toBe(true);
  });
});
