/**
 * ContextBridge — the top-level facade.
 *
 * Wires the four sub-APIs (connections, tools, puller, sink) into one object.
 * A product constructs a {@link ContextBridge} with a Composio client (direct
 * mode, BYO key) and a sink (default: GbrainSink), then:
 *
 *   - `bridge.connections.authorize('gmail')` → one-click OAuth
 *   - `bridge.tools.listTools({ maxScope: 'read' })` → typed tools for an agent
 *   - `bridge.puller.start()` → the 20-minute auto-pull into the sink
 */

import { ConnectionsApi } from './composio/connections.ts';
import type { ComposioClient } from './composio/types.ts';
import { HttpComposioClient, type HttpComposioClientConfig } from './composio/client.ts';
import { ProviderRegistry } from './providers/registry.ts';
import { Puller, type PullerDeps, TICK_SECONDS } from './puller/loop.ts';
import { FileSyncStateStore, type SyncStateStore } from './puller/state-store.ts';
import type { IngestSink } from './sink/ingest-sink.ts';
import { ToolsApi } from './tools/typed-tools.ts';

export interface ContextBridgeConfig {
  /** Composio access. Either a ready client, or a direct-mode key to build one. */
  composio: ComposioClient | HttpComposioClientConfig;
  /** Where pulled context-memory lands. */
  sink: IngestSink;
  /** Persistence for per-connection sync state. Default: file-backed. */
  stateStore?: SyncStateStore;
  /** Provider adapters. Default: the bundled registry (Gmail + generics). */
  registry?: ProviderRegistry;
  /** Auto-pull cadence in seconds. Default 1200 (20 min). */
  tickSeconds?: number;
  /** Injectable clock + logger (tests). */
  now?: () => number;
  logger?: PullerDeps['logger'];
}

function isComposioClient(v: ContextBridgeConfig['composio']): v is ComposioClient {
  return typeof (v as ComposioClient).listConnections === 'function';
}

export class ContextBridge {
  readonly client: ComposioClient;
  readonly registry: ProviderRegistry;
  readonly connections: ConnectionsApi;
  readonly tools: ToolsApi;
  readonly puller: Puller;

  constructor(config: ContextBridgeConfig) {
    this.client = isComposioClient(config.composio)
      ? config.composio
      : new HttpComposioClient(config.composio);
    this.registry = config.registry ?? ProviderRegistry.default();
    this.connections = new ConnectionsApi(this.client);
    this.tools = new ToolsApi(this.client, this.registry);
    this.puller = new Puller({
      client: this.client,
      registry: this.registry,
      sink: config.sink,
      stateStore: config.stateStore ?? new FileSyncStateStore(),
      tickSeconds: config.tickSeconds ?? TICK_SECONDS,
      now: config.now,
      logger: config.logger,
    });
  }
}
