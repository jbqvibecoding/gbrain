/**
 * Typed binding from {@link GbrainSink} to a real, in-process GBrain engine.
 *
 * Builds a trusted `OperationContext` (`remote: false`, a resolved `sourceId`,
 * a connected `BrainEngine`) and exposes the narrow {@link GbrainOps} the sink
 * needs. This is the wiring the approved plan calls for: pulled OAuth items
 * land as brainpages via `put_page` / `log_ingest` with HONEST provenance,
 * because `remote:false` is the only mode under which gbrain honors a
 * client-supplied `source_kind` / `source_uri`.
 */

import {
  GbrainSink,
  type ExtractFactsParams,
  type GbrainOps,
  type GbrainSinkOptions,
  type LogIngestParams,
  type PutPageParams,
} from '../sink/gbrain-sink.ts';
import { callOp, loadGbrainModules } from './runtime.ts';

/** A connected gbrain engine handle (kept opaque to contextbridge). */
export type GbrainEngineHandle = unknown;

export interface OpenGbrainOptions {
  /** `'pglite'` (default, embedded) or `'postgres'`. */
  engine?: 'pglite' | 'postgres';
  /** PGLite data dir or a Postgres URL override. */
  databasePath?: string;
  databaseUrl?: string;
  /** GBrain source to write into. Default `'oauth'`. Create with `gbrain sources add oauth`. */
  sourceId?: string;
  /** Sink behavior (e.g. which toolkits also run extract_facts). */
  sinkOptions?: GbrainSinkOptions;
  /** Skip `initSchema()` (when the brain is already initialized). Default false. */
  skipInitSchema?: boolean;
}

export interface OpenGbrainResult {
  sink: GbrainSink;
  ops: GbrainOps;
  engine: GbrainEngineHandle;
  /** Disconnect the engine. Call when the puller stops. */
  close(): Promise<void>;
}

/**
 * Build a {@link GbrainOps} bound to an already-connected engine + sourceId.
 * Exposed separately so a product that manages its own gbrain engine can reuse
 * its connection instead of opening a second one.
 */
export function createGbrainOps(
  operationsByName: unknown,
  engine: GbrainEngineHandle,
  config: unknown,
  sourceId: string,
): GbrainOps {
  const ctx = {
    engine,
    config: config ?? { engine: 'pglite' },
    logger: { info: console.log, warn: console.warn, error: console.error },
    dryRun: false,
    // The load-bearing flag — honors supplied provenance (see gbrain
    // operations.ts ~622–656). Local, trusted caller.
    remote: false as const,
    sourceId,
  };
  return {
    putPage: (params: PutPageParams) => callOp(operationsByName, 'put_page', ctx, params),
    logIngest: (params: LogIngestParams) => callOp(operationsByName, 'log_ingest', ctx, params),
    extractFacts: (params: ExtractFactsParams) => callOp(operationsByName, 'extract_facts', ctx, params),
  };
}

/**
 * Open a GBrain engine and return a ready-to-use {@link GbrainSink}. The default
 * end-to-end wiring: `const { sink, close } = await openGbrainSink(...)`.
 */
export async function openGbrainSink(options: OpenGbrainOptions = {}): Promise<OpenGbrainResult> {
  const { operationsByName, createEngine, loadConfig, toEngineConfig } = await loadGbrainModules();

  const engineType = options.engine ?? 'pglite';
  const fileConfig = (loadConfig() as { engine?: string } | null) ?? {};
  const config = { ...fileConfig, engine: engineType };

  const engineConfig = toEngineConfig(config) as Record<string, unknown>;
  if (options.databasePath) engineConfig.database_path = options.databasePath;
  if (options.databaseUrl) engineConfig.database_url = options.databaseUrl;
  engineConfig.engine = engineType;

  const engine = await createEngine(engineConfig);
  await (engine as { connect(c: unknown): Promise<void> }).connect(engineConfig);
  if (!options.skipInitSchema) {
    await (engine as { initSchema(): Promise<void> }).initSchema();
  }

  const sourceId = options.sourceId ?? 'oauth';
  const ops = createGbrainOps(operationsByName, engine, config, sourceId);
  const sink = new GbrainSink(ops, options.sinkOptions);

  return {
    sink,
    ops,
    engine,
    close: async () => {
      await (engine as { disconnect(): Promise<void> }).disconnect();
    },
  };
}
