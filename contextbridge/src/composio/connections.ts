/**
 * Connection management API — the "one-click OAuth" surface.
 *
 * Thin orchestration over a {@link ComposioClient}: catalog, authorize (OAuth
 * handoff → connect URL), list, delete, and a poll helper that waits for a
 * freshly-authorized connection to flip to `active` (mirrors OpenHuman's
 * ComposioConnectModal polling).
 */

import { withAdapterFlags } from './catalog.ts';
import type {
  AuthorizeOpts,
  AuthorizeResult,
  ComposioClient,
  Connection,
  ToolkitInfo,
} from './types.ts';

export class ConnectionsApi {
  constructor(private readonly client: ComposioClient) {}

  /** The catalog (118+), stamped with `hasAdapter`. */
  async listToolkits(): Promise<ToolkitInfo[]> {
    return withAdapterFlags(await this.client.listToolkits());
  }

  /** Initiate OAuth for a toolkit → `{ connectUrl, connectionId }`. */
  async authorize(toolkit: string, opts?: AuthorizeOpts): Promise<AuthorizeResult> {
    return this.client.authorize(toolkit, opts);
  }

  /** All connections for the configured entity. */
  async listConnections(): Promise<Connection[]> {
    return this.client.listConnections();
  }

  /** Only the live (active) connections. */
  async listActiveConnections(): Promise<Connection[]> {
    return (await this.client.listConnections()).filter((c) => c.status === 'active');
  }

  /** Revoke a connection. */
  async deleteConnection(connectionId: string): Promise<void> {
    await this.client.deleteConnection(connectionId);
  }

  /**
   * Poll until a connection becomes `active` (or fails / times out). Used after
   * `authorize` once the user has completed the OAuth handoff in their browser.
   */
  async waitForActive(
    connectionId: string,
    opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ): Promise<Connection> {
    const timeoutMs = opts.timeoutMs ?? 60_000; // matches OpenHuman's 60s window
    const intervalMs = opts.intervalMs ?? 1_500;
    const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const deadline = Date.now() + timeoutMs;
    let last: Connection | undefined;
    while (Date.now() < deadline) {
      const conns = await this.client.listConnections();
      last = conns.find((c) => c.id === connectionId);
      if (last?.status === 'active') return last;
      if (last?.status === 'failed') {
        throw new Error(`[contextbridge:connections] connection ${connectionId} failed during OAuth`);
      }
      await sleep(intervalMs);
    }
    throw new Error(
      `[contextbridge:connections] timed out after ${timeoutMs}ms waiting for ${connectionId} to activate (last status: ${last?.status ?? 'unknown'})`,
    );
  }
}
