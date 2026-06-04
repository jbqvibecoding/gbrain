/**
 * In-memory fake {@link ComposioClient} for tests. Scriptable connections,
 * tool schemas, and per-action execute responses.
 */

import type {
  AuthorizeOpts,
  AuthorizeResult,
  ComposioClient,
  ComposioToolSchema,
  Connection,
  ExecuteArgs,
  ExecuteResult,
  ToolkitInfo,
} from '../../src/composio/types.ts';

export class FakeComposioClient implements ComposioClient {
  toolkits: ToolkitInfo[] = [];
  connections: Connection[] = [];
  tools: ComposioToolSchema[] = [];
  /** Map of action slug → response (or a function for dynamic responses). */
  executeResponses = new Map<string, ExecuteResult | ((args: ExecuteArgs) => ExecuteResult)>();
  /** Call log for assertions. */
  executeCalls: ExecuteArgs[] = [];
  authorizeCalls: { toolkit: string; opts?: AuthorizeOpts }[] = [];
  deleteCalls: string[] = [];

  async listToolkits(): Promise<ToolkitInfo[]> {
    return this.toolkits;
  }

  async authorize(toolkit: string, opts?: AuthorizeOpts): Promise<AuthorizeResult> {
    this.authorizeCalls.push({ toolkit, opts });
    return { connectUrl: `https://composio.dev/oauth/${toolkit}`, connectionId: `conn_${toolkit}` };
  }

  async listConnections(): Promise<Connection[]> {
    return this.connections;
  }

  async deleteConnection(connectionId: string): Promise<void> {
    this.deleteCalls.push(connectionId);
    this.connections = this.connections.filter((c) => c.id !== connectionId);
  }

  async listTools(opts?: { toolkits?: string[] }): Promise<ComposioToolSchema[]> {
    if (!opts?.toolkits?.length) return this.tools;
    const set = new Set(opts.toolkits.map((t) => t.toLowerCase()));
    return this.tools.filter((t) => set.has(t.toolkit));
  }

  async execute(args: ExecuteArgs): Promise<ExecuteResult> {
    this.executeCalls.push(args);
    const r = this.executeResponses.get(args.tool);
    if (typeof r === 'function') return r(args);
    return r ?? { successful: true, data: {} };
  }
}
