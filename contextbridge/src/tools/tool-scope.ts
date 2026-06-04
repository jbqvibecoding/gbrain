/**
 * Tool scope classification + gating.
 *
 * Ported from OpenHuman's `providers/tool_scope.rs`. Every action exposed to an
 * agent is classified Read / Write / Admin. A product picks the maximum scope it
 * wants to grant; tools above that scope are hidden. The default is Read-only —
 * pulling context is safe; mutating a user's Gmail is not, until explicitly
 * unlocked.
 */

export type ToolScope = 'read' | 'write' | 'admin';

const SCOPE_RANK: Record<ToolScope, number> = { read: 0, write: 1, admin: 2 };

/** True when `have` is sufficient to expose a tool requiring `need`. */
export function scopeAllows(have: ToolScope, need: ToolScope): boolean {
  return SCOPE_RANK[have] >= SCOPE_RANK[need];
}

/**
 * Heuristic scope for an un-curated action slug. Mirrors the Rust heuristic:
 * fetch/get/list/search/read → Read; delete/remove/admin → Admin; everything
 * else that mutates (send/create/update/post) → Write.
 */
export function heuristicScope(slug: string): ToolScope {
  const s = slug.toLowerCase();
  if (/(delete|remove|revoke|admin|deactivate|drop)/.test(s)) return 'admin';
  if (/(fetch|get|list|search|read|find|retrieve|view|download)/.test(s)) return 'read';
  if (/(send|create|update|post|add|write|reply|move|patch|put|set|upload|archive|trash)/.test(s)) {
    return 'write';
  }
  // Unknown verbs default to write (fail-safe: never silently treat an unknown
  // action as read-only).
  return 'write';
}
