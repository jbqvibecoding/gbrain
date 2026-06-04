/**
 * Render an {@link IngestItem} into the markdown+frontmatter body GBrain's
 * `put_page` expects.
 *
 * The page is intentionally a `type: oauth-raw` page: it carries enough
 * structured frontmatter for the `oauth-ingest` GBrain skill to route it to the
 * right refining skill (meeting-ingestion, signal-detector, …) without the
 * puller doing any LLM-shaped work itself.
 */

import type { IngestItem } from './ingest-sink.ts';

/** Minimal YAML-scalar escaping for frontmatter values. */
function yamlScalar(v: string): string {
  if (v === '') return "''";
  // Quote if it contains a char that would confuse a YAML parser, OR starts
  // with an indicator char (`-`, `?`, space) / ends with a space. Internal
  // hyphens (e.g. `meeting-ingestion`) are safe and stay unquoted.
  const needsQuote =
    /[:#\[\]{}&*!|>'"%@`\n,]/.test(v) || /^[\s\-?]/.test(v) || /\s$/.test(v);
  if (needsQuote) return `'${v.replace(/'/g, "''")}'`;
  return v;
}

function yamlList(items: string[]): string {
  if (items.length === 0) return '[]';
  return `[${items.map(yamlScalar).join(', ')}]`;
}

/**
 * Build `---\nfrontmatter\n---\n\n# Title\n\nbody`. The frontmatter names the
 * `suggested_skill` so `oauth-ingest` can dispatch deterministically.
 */
export function renderFrontmatterMarkdown(item: IngestItem): string {
  const fm: string[] = [
    'type: oauth-raw',
    `provider: ${yamlScalar(item.toolkit)}`,
    `kind: ${yamlScalar(item.kind)}`,
    `external_id: ${yamlScalar(item.externalId)}`,
  ];
  if (item.suggestedSkill) fm.push(`suggested_skill: ${yamlScalar(item.suggestedSkill)}`);
  if (item.sourceUri) fm.push(`source_uri: ${yamlScalar(item.sourceUri)}`);
  if (item.occurredAt && Number.isFinite(item.occurredAt)) {
    fm.push(`occurred_at: ${yamlScalar(new Date(item.occurredAt).toISOString())}`);
  }
  if (item.participants && item.participants.length > 0) {
    fm.push(`participants: ${yamlList(item.participants)}`);
  }

  const heading = item.title.trim() ? `# ${item.title.trim()}\n\n` : '';
  return `---\n${fm.join('\n')}\n---\n\n${heading}${item.body.trim()}\n`;
}
