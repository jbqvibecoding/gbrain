/**
 * Toolkit catalog helpers.
 *
 * Composio's live `listToolkits()` returns the full 118+ catalog. This module
 * adds the ContextBridge overlay: which toolkits ship a native ProviderAdapter
 * (so they participate in the auto-pull loop) vs. which are execute-only
 * (typed tools work, but no periodic pull). Mirrors OpenHuman's
 * `capability_matrix()` / `CAPABILITY_TOOLKITS` split.
 */

import type { ToolkitInfo } from './types.ts';

/**
 * Toolkits ContextBridge ships a native pull adapter for. Everything else in
 * the live catalog is still connectable + executable as typed tools, but won't
 * be walked by the 20-minute loop until an adapter is added.
 */
export const ADAPTER_TOOLKITS: readonly string[] = [
  'gmail',
  'googlecalendar',
  'slack',
  'notion',
  'github',
  'linear',
] as const;

/**
 * A small curated catalog used as a fallback when the live Composio catalog is
 * unavailable (offline / no key yet). Not exhaustive — the live call is the
 * source of truth for the full 118+. These are the marquee integrations named
 * in the product copy.
 */
export const CURATED_CATALOG: readonly ToolkitInfo[] = [
  { slug: 'gmail', name: 'Gmail', categories: ['email'] },
  { slug: 'googlecalendar', name: 'Google Calendar', categories: ['calendar'] },
  { slug: 'googledrive', name: 'Google Drive', categories: ['storage'] },
  { slug: 'notion', name: 'Notion', categories: ['productivity'] },
  { slug: 'github', name: 'GitHub', categories: ['developer'] },
  { slug: 'slack', name: 'Slack', categories: ['messaging'] },
  { slug: 'stripe', name: 'Stripe', categories: ['finance'] },
  { slug: 'linear', name: 'Linear', categories: ['productivity'] },
  { slug: 'jira', name: 'Jira', categories: ['productivity'] },
] as const;

/** Whether ContextBridge ships a pull adapter for a toolkit. */
export function hasAdapter(slug: string): boolean {
  return ADAPTER_TOOLKITS.includes(slug.toLowerCase());
}

/** Stamp `hasAdapter` onto a live catalog list. */
export function withAdapterFlags(toolkits: ToolkitInfo[]): ToolkitInfo[] {
  return toolkits.map((t) => ({ ...t, hasAdapter: hasAdapter(t.slug) }));
}
