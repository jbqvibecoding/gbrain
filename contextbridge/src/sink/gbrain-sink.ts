/**
 * The default sink: land pulled context-memory as GBrain brainpages.
 *
 * `GbrainSink` depends only on a NARROW {@link GbrainOps} interface (not on
 * gbrain's package internals) so it is unit-testable with a fake. The real
 * binding lives in `src/gbrain/adapter.ts`, which wires gbrain's
 * `operationsByName` + a `BrainEngine` in-process with `remote: false`.
 *
 * `remote: false` is load-bearing: it is the ONLY path under which gbrain's
 * `put_page` honors the supplied `source_kind` / `source_uri` / `ingested_via`
 * provenance (remote callers get them server-stamped to `mcp:put_page`). See
 * gbrain `src/core/operations.ts` lines ~622–656.
 */

import type { IngestItem, IngestSink, SinkBatchContext, SinkResult } from './ingest-sink.ts';
import { renderFrontmatterMarkdown } from './render.ts';
import { slugFor } from './slug.ts';

/** Params for gbrain's `put_page` op (the subset ContextBridge sets). */
export interface PutPageParams {
  slug: string;
  content: string;
  source_kind?: string;
  source_uri?: string;
  ingested_via?: string;
}

/** Params for gbrain's `log_ingest` op. */
export interface LogIngestParams {
  source_type: string;
  source_ref: string;
  pages_updated: string[];
  summary: string;
}

/** Params for gbrain's `extract_facts` op. */
export interface ExtractFactsParams {
  turn_text: string;
  entity_hints?: string[];
  visibility?: string;
}

/**
 * The narrow GBrain surface the sink needs. Each method is a trusted
 * (`remote:false`) invocation of the corresponding gbrain operation, already
 * bound to an engine + sourceId by the adapter.
 */
export interface GbrainOps {
  putPage(params: PutPageParams): Promise<unknown>;
  logIngest(params: LogIngestParams): Promise<unknown>;
  extractFacts?(params: ExtractFactsParams): Promise<unknown>;
}

export interface GbrainSinkOptions {
  /**
   * Toolkits whose short, high-signal bodies should ALSO go through
   * `extract_facts` (Slack messages, calendar invites). Page bodies already run
   * gbrain's facts backstop via `put_page`, so this is opt-in per provider.
   */
  extractFactsToolkits?: string[];
}

export class GbrainSink implements IngestSink {
  private readonly extractFactsToolkits: Set<string>;

  constructor(
    private readonly ops: GbrainOps,
    options: GbrainSinkOptions = {},
  ) {
    this.extractFactsToolkits = new Set(options.extractFactsToolkits ?? []);
  }

  async writeBatch(items: IngestItem[], ctx: SinkBatchContext): Promise<SinkResult> {
    const pages: string[] = [];
    for (const item of items) {
      const slug = slugFor(item);
      await this.ops.putPage({
        slug,
        content: renderFrontmatterMarkdown(item),
        source_kind: 'oauth-pull',
        source_uri: item.sourceUri ?? `${item.toolkit}:${item.externalId}`,
        ingested_via: `contextbridge:${item.toolkit}`,
      });
      pages.push(slug);

      // Opt-in hot-memory extraction for high-signal short bodies.
      if (this.ops.extractFacts && this.extractFactsToolkits.has(item.toolkit) && item.body.trim()) {
        await this.ops.extractFacts({
          turn_text: item.body.slice(0, 4000),
          entity_hints: item.participants,
          visibility: 'world',
        });
      }
    }

    await this.ops.logIngest({
      source_type: `oauth:${ctx.toolkit}`,
      source_ref: ctx.connectionId,
      pages_updated: pages,
      summary: `${ctx.reason} pull: ${pages.length} ${ctx.toolkit} items`,
    });

    return { pagesUpserted: pages, summary: `${pages.length} pages upserted to gbrain` };
  }
}
