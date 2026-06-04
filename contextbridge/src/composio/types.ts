/**
 * Composio domain types (direct-mode, v3).
 *
 * Mirrors the shapes OpenHuman's `composio` domain exchanges with Composio,
 * trimmed to what ContextBridge needs: catalog, connections, tool schemas,
 * and execution. Field names follow Composio v3 REST (`connected_accounts`,
 * `toolkits`, `tools`) so the {@link HttpComposioClient} can pass them through.
 */

/** A toolkit in the catalog (Gmail, Slack, Notion, …). The "118+" surface. */
export interface ToolkitInfo {
  /** Normalized lowercase slug, e.g. `"gmail"`. */
  slug: string;
  /** Human label, e.g. `"Gmail"`. */
  name: string;
  description?: string;
  /** Categories from Composio (e.g. `["productivity"]`). */
  categories?: string[];
  /** Whether ContextBridge ships a native ProviderAdapter for this toolkit. */
  hasAdapter?: boolean;
}

/** Connection status, normalized across Composio's status strings. */
export type ConnectionStatus = 'active' | 'pending' | 'failed';

/** An OAuth connection (Composio "connected account"). */
export interface Connection {
  /** Connection id, e.g. `"ca_abc123"`. */
  id: string;
  /** Normalized toolkit slug, e.g. `"gmail"`. */
  toolkit: string;
  status: ConnectionStatus;
  /** Epoch ms when the connection was created, if known. */
  createdAt?: number;
  /** Optional display hints surfaced by the provider (email, workspace, …). */
  account?: Record<string, unknown>;
}

/** Result of initiating an OAuth handoff. */
export interface AuthorizeResult {
  /** URL the user opens to grant consent. */
  connectUrl: string;
  /** The pending connection id to poll for activation. */
  connectionId: string;
}

/** Typed schema for one action a toolkit exposes. */
export interface ComposioToolSchema {
  /** Action slug, e.g. `"GMAIL_FETCH_EMAILS"`. */
  name: string;
  description: string;
  /** JSON Schema for the action's arguments. */
  parametersSchema: JSONSchema;
  /** Owning toolkit slug. */
  toolkit: string;
}

/** Result of executing an action. */
export interface ExecuteResult {
  successful: boolean;
  /** Provider payload on success. */
  data?: unknown;
  error?: string;
  /** Estimated cost in USD, if Composio reports it. */
  costUsd?: number;
}

// Minimal JSON Schema typing — we don't validate, just pass through to agents.
export type JSONSchema = {
  type?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: unknown[];
  description?: string;
  [k: string]: unknown;
};

/**
 * The Composio surface ContextBridge depends on. A real implementation talks
 * to Composio v3 in direct mode (BYO key); tests inject a fake.
 */
export interface ComposioClient {
  /** The full catalog (the "118+ integrations"). */
  listToolkits(): Promise<ToolkitInfo[]>;
  /** Initiate OAuth for a toolkit → connect URL + pending connection id. */
  authorize(toolkit: string, opts?: AuthorizeOpts): Promise<AuthorizeResult>;
  /** Active/pending connections for the configured entity. */
  listConnections(): Promise<Connection[]>;
  /** Delete a connection (revoke). */
  deleteConnection(connectionId: string): Promise<void>;
  /** Typed action schemas, optionally filtered to specific toolkits. */
  listTools(opts?: { toolkits?: string[]; connectionId?: string }): Promise<ComposioToolSchema[]>;
  /** Execute one action against a connection. */
  execute(args: ExecuteArgs): Promise<ExecuteResult>;
}

export interface AuthorizeOpts {
  /** Toolkit-specific required fields (e.g. Jira `subdomain`, WhatsApp `waba_id`). */
  extraParams?: Record<string, string>;
  /** Where Composio should redirect after consent. */
  redirectUrl?: string;
}

export interface ExecuteArgs {
  /** Action slug, e.g. `"GMAIL_FETCH_EMAILS"`. */
  tool: string;
  /** Connection to run against. */
  connectionId: string;
  /** Action arguments (validated by Composio against the action schema). */
  arguments?: Record<string, unknown>;
}
