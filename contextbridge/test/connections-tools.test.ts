/**
 * ConnectionsApi (authorize/list/delete/waitForActive/catalog) and ToolsApi
 * (scope gating + execute dispatch) against the fake Composio client.
 */

import { describe, expect, test } from 'bun:test';
import { ConnectionsApi } from '../src/composio/connections.ts';
import { ToolsApi } from '../src/tools/typed-tools.ts';
import { ProviderRegistry } from '../src/providers/registry.ts';
import { FakeComposioClient } from './fixtures/fake-composio.ts';

describe('ConnectionsApi', () => {
  test('listToolkits stamps hasAdapter', async () => {
    const client = new FakeComposioClient();
    client.toolkits = [
      { slug: 'gmail', name: 'Gmail' },
      { slug: 'airtable', name: 'Airtable' },
    ];
    const api = new ConnectionsApi(client);
    const toolkits = await api.listToolkits();
    expect(toolkits.find((t) => t.slug === 'gmail')?.hasAdapter).toBe(true);
    expect(toolkits.find((t) => t.slug === 'airtable')?.hasAdapter).toBe(false);
  });

  test('authorize round-trips to connectUrl + connectionId', async () => {
    const client = new FakeComposioClient();
    const api = new ConnectionsApi(client);
    const res = await api.authorize('gmail');
    expect(res.connectionId).toBe('conn_gmail');
    expect(res.connectUrl).toContain('gmail');
  });

  test('listActiveConnections filters by status', async () => {
    const client = new FakeComposioClient();
    client.connections = [
      { id: 'a', toolkit: 'gmail', status: 'active' },
      { id: 'b', toolkit: 'slack', status: 'pending' },
    ];
    const api = new ConnectionsApi(client);
    expect((await api.listActiveConnections()).map((c) => c.id)).toEqual(['a']);
  });

  test('waitForActive resolves once a connection flips to active', async () => {
    const client = new FakeComposioClient();
    client.connections = [{ id: 'x', toolkit: 'gmail', status: 'pending' }];
    const api = new ConnectionsApi(client);
    // Flip to active on the second poll.
    let polls = 0;
    const orig = client.listConnections.bind(client);
    client.listConnections = async () => {
      polls += 1;
      if (polls >= 2) client.connections = [{ id: 'x', toolkit: 'gmail', status: 'active' }];
      return orig();
    };
    const conn = await api.waitForActive('x', { intervalMs: 1, timeoutMs: 1000, sleep: async () => {} });
    expect(conn.status).toBe('active');
  });

  test('waitForActive throws on failed status', async () => {
    const client = new FakeComposioClient();
    client.connections = [{ id: 'x', toolkit: 'gmail', status: 'failed' }];
    const api = new ConnectionsApi(client);
    await expect(api.waitForActive('x', { sleep: async () => {} })).rejects.toThrow(/failed/);
  });

  test('deleteConnection removes it', async () => {
    const client = new FakeComposioClient();
    client.connections = [{ id: 'x', toolkit: 'gmail', status: 'active' }];
    const api = new ConnectionsApi(client);
    await api.deleteConnection('x');
    expect(client.deleteCalls).toEqual(['x']);
    expect(await api.listConnections()).toEqual([]);
  });
});

describe('ToolsApi scope gating', () => {
  function clientWithGmailTools() {
    const client = new FakeComposioClient();
    client.tools = [
      { name: 'GMAIL_FETCH_EMAILS', description: 'fetch', parametersSchema: { type: 'object' }, toolkit: 'gmail' },
      { name: 'GMAIL_SEND_EMAIL', description: 'send', parametersSchema: { type: 'object' }, toolkit: 'gmail' },
      { name: 'GMAIL_DELETE_MESSAGE', description: 'delete', parametersSchema: { type: 'object' }, toolkit: 'gmail' },
    ];
    return client;
  }

  test('default maxScope=read hides write + admin tools', async () => {
    const client = clientWithGmailTools();
    const api = new ToolsApi(client, ProviderRegistry.default());
    const tools = await api.listTools();
    expect(tools.map((t) => t.name)).toEqual(['GMAIL_FETCH_EMAILS']);
  });

  test('maxScope=write exposes read + write but not admin', async () => {
    const client = clientWithGmailTools();
    const api = new ToolsApi(client, ProviderRegistry.default());
    const tools = await api.listTools({ maxScope: 'write' });
    expect(tools.map((t) => t.name).sort()).toEqual(['GMAIL_FETCH_EMAILS', 'GMAIL_SEND_EMAIL']);
  });

  test('execute dispatches to the client and unwraps data', async () => {
    const client = clientWithGmailTools();
    client.executeResponses.set('GMAIL_FETCH_EMAILS', { successful: true, data: { messages: [] } });
    const api = new ToolsApi(client, ProviderRegistry.default());
    const [fetchTool] = await api.listTools();
    const out = await fetchTool!.execute('conn_gmail', { max_results: 5 });
    expect(out).toEqual({ messages: [] });
    expect(client.executeCalls[0]?.tool).toBe('GMAIL_FETCH_EMAILS');
  });

  test('toAnthropicTools shape', async () => {
    const client = clientWithGmailTools();
    const api = new ToolsApi(client, ProviderRegistry.default());
    const defs = await api.toAnthropicTools();
    expect(defs[0]).toHaveProperty('input_schema');
    expect(defs[0]?.name).toBe('GMAIL_FETCH_EMAILS');
  });
});
