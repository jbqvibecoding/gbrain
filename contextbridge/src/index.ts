/**
 * @contextbridge/core — public API.
 *
 * Standalone OAuth-integrations + 20-minute auto-pull module. One-click OAuth
 * into 118+ services via Composio (direct mode), each connection exposed to an
 * agent as typed tools, with a periodic pull loop that lands new data into a
 * pluggable sink. The default sink writes GBrain brainpages.
 *
 * NOTE: the GBrain binding lives at `@contextbridge/core/sink/gbrain` so this
 * entry point stays free of any GBrain dependency — products that use a
 * different sink never load gbrain.
 */

// Facade
export { ContextBridge, type ContextBridgeConfig } from './contextbridge.ts';

// Composio
export {
  HttpComposioClient,
  normalizeStatus,
  normalizeToolkitSlug,
  type HttpComposioClientConfig,
} from './composio/client.ts';
export { ConnectionsApi } from './composio/connections.ts';
export { ADAPTER_TOOLKITS, CURATED_CATALOG, hasAdapter, withAdapterFlags } from './composio/catalog.ts';
export type {
  AuthorizeOpts,
  AuthorizeResult,
  ComposioClient,
  ComposioToolSchema,
  Connection,
  ConnectionStatus,
  ExecuteArgs,
  ExecuteResult,
  JSONSchema,
  ToolkitInfo,
} from './composio/types.ts';

// Puller
export { Puller, TICK_SECONDS, type ConnectionReport, type TickReport, type PullerDeps } from './puller/loop.ts';
export {
  DEFAULT_DAILY_REQUEST_LIMIT,
  DailyBudget,
  SyncState,
  extractItemId,
  todayStr,
  type SyncStateBlob,
} from './puller/sync-state.ts';
export {
  FileSyncStateStore,
  MemorySyncStateStore,
  STATE_NAMESPACE,
  type SyncStateStore,
} from './puller/state-store.ts';

// Providers
export { ProviderRegistry } from './providers/registry.ts';
export { GmailAdapter } from './providers/gmail.ts';
export { GenericAdapter, buildGenericAdapters, type GenericAdapterConfig } from './providers/generic.ts';
export { htmlToText } from './providers/html-text.ts';
export type { CuratedTool, ProviderAdapter, PullArgs, PullResult } from './providers/types.ts';

// Sink
export {
  RecordingSink,
  type IngestItem,
  type IngestSink,
  type SinkBatchContext,
  type SinkResult,
  type SyncReason,
} from './sink/ingest-sink.ts';
export { GbrainSink, type GbrainOps, type GbrainSinkOptions } from './sink/gbrain-sink.ts';
export { renderFrontmatterMarkdown } from './sink/render.ts';
export { slugFor, slugSegment } from './sink/slug.ts';

// Tools
export { ToolsApi, type TypedTool, type ListToolsOptions } from './tools/typed-tools.ts';
export { heuristicScope, scopeAllows, type ToolScope } from './tools/tool-scope.ts';
