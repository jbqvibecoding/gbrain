/**
 * Typed tools exposed to an agent.
 *
 * "Each connection exposed to the agent as typed tools." Assembles
 * {@link TypedTool}s from Composio's action schemas, scope-gated so a product
 * grants only the scopes it wants (default: read-only). Mirrors OpenHuman's
 * `ComposioActionTool` + `evaluate_tool_visibility`.
 *
 * Framework adapters (`toAnthropicTools`, `toMcpToolDefinitions`) are
 * dependency-free shapes any agent runtime can consume.
 */

import type { ComposioClient, ComposioToolSchema, JSONSchema } from '../composio/types.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { heuristicScope, scopeAllows, type ToolScope } from './tool-scope.ts';

export interface TypedTool {
  name: string;
  description: string;
  parametersSchema: JSONSchema;
  scope: ToolScope;
  toolkit: string;
  /** Execute against a specific connection. */
  execute(connectionId: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface ListToolsOptions {
  /** Restrict to specific toolkits. */
  toolkits?: string[];
  /** Maximum scope to expose. Default `'read'` (safe — pulling, not mutating). */
  maxScope?: ToolScope;
  /** Resolve schemas for this connection's toolkit only. */
  connectionId?: string;
}

export class ToolsApi {
  constructor(
    private readonly client: ComposioClient,
    private readonly registry: ProviderRegistry,
  ) {}

  /** Resolve the scope for an action: curated classification first, else heuristic. */
  private scopeFor(schema: ComposioToolSchema): ToolScope {
    const adapter = this.registry.get(schema.toolkit);
    const curated = adapter?.curatedTools?.find((t) => t.slug === schema.name);
    return curated?.scope ?? heuristicScope(schema.name);
  }

  /** List typed tools, scope-gated. */
  async listTools(opts: ListToolsOptions = {}): Promise<TypedTool[]> {
    const maxScope = opts.maxScope ?? 'read';
    const schemas = await this.client.listTools({
      toolkits: opts.toolkits,
      connectionId: opts.connectionId,
    });
    const out: TypedTool[] = [];
    for (const schema of schemas) {
      const scope = this.scopeFor(schema);
      if (!scopeAllows(maxScope, scope)) continue; // hidden above the granted scope
      out.push({
        name: schema.name,
        description: schema.description,
        parametersSchema: schema.parametersSchema,
        scope,
        toolkit: schema.toolkit,
        execute: async (connectionId: string, args: Record<string, unknown>) => {
          const res = await this.client.execute({ tool: schema.name, connectionId, arguments: args });
          if (!res.successful) {
            throw new Error(`[contextbridge:tools] ${schema.name} failed: ${res.error ?? 'unknown error'}`);
          }
          return res.data;
        },
      });
    }
    return out;
  }

  /** Anthropic tool-use definitions ({ name, description, input_schema }). */
  async toAnthropicTools(opts: ListToolsOptions = {}): Promise<
    { name: string; description: string; input_schema: JSONSchema }[]
  > {
    const tools = await this.listTools(opts);
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parametersSchema,
    }));
  }

  /** MCP tool definitions ({ name, description, inputSchema }). */
  async toMcpToolDefinitions(opts: ListToolsOptions = {}): Promise<
    { name: string; description: string; inputSchema: JSONSchema }[]
  > {
    const tools = await this.listTools(opts);
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parametersSchema,
    }));
  }
}
