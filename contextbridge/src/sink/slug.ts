/**
 * Deterministic slug conventions for pulled items.
 *
 * Determinism gives free idempotency: GBrain's page key is `(source_id, slug)`,
 * so re-pulling the same item upserts instead of duplicating. Mirrors the slug
 * namespaces in the approved plan.
 */

import type { IngestItem } from './ingest-sink.ts';

/** `YYYY-MM` from an epoch-ms timestamp (UTC), or `unknown-date`. */
function yearMonth(occurredAt?: number): string {
  if (!occurredAt || !Number.isFinite(occurredAt)) return 'unknown-date';
  return new Date(occurredAt).toISOString().slice(0, 7);
}

/** `YYYY-MM-DD` from an epoch-ms timestamp (UTC), or `unknown-date`. */
function isoDate(occurredAt?: number): string {
  if (!occurredAt || !Number.isFinite(occurredAt)) return 'unknown-date';
  return new Date(occurredAt).toISOString().slice(0, 10);
}

/** Make any string safe for a slug segment. */
export function slugSegment(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

/**
 * Compute the deterministic GBrain slug for an item. Routing by toolkit, with a
 * stable fallback (`{toolkit}/{externalId}`) for anything without a bespoke
 * namespace.
 */
export function slugFor(item: IngestItem): string {
  const id = slugSegment(item.externalId);
  switch (item.toolkit) {
    case 'gmail':
      return `emails/${yearMonth(item.occurredAt)}/${id}`;
    case 'slack':
      return `messages/slack/${id}`;
    case 'googlecalendar':
      return `meetings/${isoDate(item.occurredAt)}/${id}`;
    case 'notion':
      return `notion/${id}`;
    case 'googledrive':
      return `docs/${id}`;
    case 'github':
    case 'linear':
    case 'jira':
      return `issues/${slugSegment(item.toolkit)}/${id}`;
    case 'stripe':
      return `stripe/${id}`;
    default:
      return `${slugSegment(item.toolkit)}/${id}`;
  }
}
