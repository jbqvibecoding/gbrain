/**
 * Direct-mode Composio v3 HTTP client (BYO API key).
 *
 * This is the standalone seam that decouples ContextBridge from OpenHuman's
 * backend proxy. OpenHuman's `create_composio_client` resolves a `Direct`
 * variant from a stored Composio API key and hand-rolls the same v3 REST calls
 * (`src/openhuman/composio/client.rs`). ContextBridge does the equivalent in
 * TypeScript so it needs nothing but a Composio API key.
 *
 * Direct mode is **sync-only**: Composio trigger webhooks are HMAC-verified by
 * a backend and never reach a direct client. ContextBridge therefore ships only
 * the periodic pull loop — exactly the "every 20 minutes" feature.
 *
 * Endpoints follow Composio v3 (`/api/v3/...`). The exact response envelopes
 * vary by Composio release; {@link normalizeConnection} / {@link normalizeToolkit}
 * isolate the parsing so a schema drift is a one-function fix.
 */

import type {
  AuthorizeOpts,
  AuthorizeResult,
  ComposioClient,
  ComposioToolSchema,
  Connection,
  ConnectionStatus,
  ExecuteArgs,
  ExecuteResult,
  ToolkitInfo,
} from './types.ts';

export interface HttpComposioClientConfig {
  apiKey: string;
  /** Default `https://backend.composio.dev`. */
  baseUrl?: string;
  /** Composio entity / user id the connections belong to. Default `"default"`. */
  entityId?: string;
  /** Injectable fetch for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://backend.composio.dev';

/** Normalize Composio's many status strings into our three-state enum. */
export function normalizeStatus(raw: unknown): ConnectionStatus {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'ACTIVE' || s === 'CONNECTED' || s === 'ENABLED') return 'active';
  if (s === 'FAILED' || s === 'ERROR' || s === 'EXPIRED' || s === 'DISABLED') return 'failed';
  return 'pending';
}

export function normalizeToolkitSlug(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

export class HttpComposioClient implements ComposioClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly entityId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: HttpComposioClientConfig) {
    if (!cfg.apiKey || !cfg.apiKey.trim()) {
      throw new Error('[contextbridge:composio] direct mode requires a Composio API key');
    }
    this.apiKey = cfg.apiKey.trim();
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.entityId = cfg.entityId ?? 'default';
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        'x-api-key': this.apiKey,
        'content-type': 'application/json',
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Anchor the message so a product's observability can classify provider
      // user-state errors (401 "reconnect needed") vs real failures, mirroring
      // OpenHuman's `[composio-direct]` anchor.
      throw new Error(`[composio-direct] ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async listToolkits(): Promise<ToolkitInfo[]> {
    const data = await this.req<{ items?: unknown[]; toolkits?: unknown[] }>('GET', '/api/v3/toolkits');
    const items = (data.items ?? data.toolkits ?? []) as Record<string, unknown>[];
    return items.map((t) => normalizeToolkit(t));
  }

  async authorize(toolkit: string, opts?: AuthorizeOpts): Promise<AuthorizeResult> {
    const slug = normalizeToolkitSlug(toolkit);
    const body: Record<string, unknown> = {
      toolkit_slug: slug,
      user_id: this.entityId,
    };
    if (opts?.redirectUrl) body.callback_url = opts.redirectUrl;
    if (opts?.extraParams && Object.keys(opts.extraParams).length > 0) {
      body.connection_data = opts.extraParams;
    }
    const data = await this.req<Record<string, unknown>>('POST', '/api/v3/connected_accounts', body);
    const connectUrl =
      (data.redirect_url as string) ??
      (data.redirectUrl as string) ??
      ((data.connectionData as Record<string, unknown>)?.redirectUrl as string) ??
      '';
    const connectionId =
      (data.id as string) ?? (data.connectionId as string) ?? (data.nano_id as string) ?? '';
    if (!connectionId) {
      throw new Error(`[composio-direct] authorize(${slug}) returned no connection id`);
    }
    return { connectUrl, connectionId };
  }

  async listConnections(): Promise<Connection[]> {
    const data = await this.req<{ items?: unknown[]; connected_accounts?: unknown[] }>(
      'GET',
      `/api/v3/connected_accounts?user_ids=${encodeURIComponent(this.entityId)}`,
    );
    const items = (data.items ?? data.connected_accounts ?? []) as Record<string, unknown>[];
    return items.map((c) => normalizeConnection(c));
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await this.req<void>('DELETE', `/api/v3/connected_accounts/${encodeURIComponent(connectionId)}`);
  }

  async listTools(opts?: { toolkits?: string[]; connectionId?: string }): Promise<ComposioToolSchema[]> {
    const qs = new URLSearchParams();
    if (opts?.toolkits?.length) qs.set('toolkit_slugs', opts.toolkits.map(normalizeToolkitSlug).join(','));
    const data = await this.req<{ items?: unknown[]; tools?: unknown[] }>(
      'GET',
      `/api/v3/tools${qs.toString() ? `?${qs.toString()}` : ''}`,
    );
    const items = (data.items ?? data.tools ?? []) as Record<string, unknown>[];
    return items.map((t) => normalizeToolSchema(t));
  }

  async execute(args: ExecuteArgs): Promise<ExecuteResult> {
    const body = {
      user_id: this.entityId,
      connected_account_id: args.connectionId,
      arguments: args.arguments ?? {},
    };
    const data = await this.req<Record<string, unknown>>(
      'POST',
      `/api/v3/tools/execute/${encodeURIComponent(args.tool)}`,
      body,
    );
    return {
      successful: Boolean(data.successful ?? data.success ?? true),
      data: data.data ?? data.response_data ?? data,
      error: (data.error as string) ?? undefined,
      costUsd: (data.cost as number) ?? undefined,
    };
  }
}

// ── Envelope normalizers (isolate Composio schema drift) ──────────────────

export function normalizeToolkit(raw: Record<string, unknown>): ToolkitInfo {
  const slug = normalizeToolkitSlug(raw.slug ?? raw.key ?? raw.name);
  return {
    slug,
    name: String(raw.name ?? raw.display_name ?? slug),
    description: (raw.description as string) ?? undefined,
    categories: (raw.categories as string[]) ?? undefined,
  };
}

export function normalizeConnection(raw: Record<string, unknown>): Connection {
  const toolkit = normalizeToolkitSlug(
    (raw.toolkit_slug as string) ??
      ((raw.toolkit as Record<string, unknown>)?.slug as string) ??
      (raw.appName as string) ??
      (raw.toolkit as string),
  );
  const createdRaw = raw.created_at ?? raw.createdAt;
  const createdAt =
    typeof createdRaw === 'string' ? Date.parse(createdRaw) : (createdRaw as number | undefined);
  return {
    id: String(raw.id ?? raw.nano_id ?? raw.connectionId ?? ''),
    toolkit,
    status: normalizeStatus(raw.status),
    createdAt: Number.isFinite(createdAt) ? createdAt : undefined,
    account: (raw.data as Record<string, unknown>) ?? (raw.metadata as Record<string, unknown>) ?? undefined,
  };
}

export function normalizeToolSchema(raw: Record<string, unknown>): ComposioToolSchema {
  const name = String(raw.slug ?? raw.name ?? '');
  const input = (raw.input_parameters ?? raw.parameters ?? raw.inputParameters ?? {}) as Record<
    string,
    unknown
  >;
  return {
    name,
    description: String(raw.description ?? ''),
    parametersSchema: input as ComposioToolSchema['parametersSchema'],
    toolkit: normalizeToolkitSlug(
      (raw.toolkit_slug as string) ?? ((raw.toolkit as Record<string, unknown>)?.slug as string),
    ),
  };
}
