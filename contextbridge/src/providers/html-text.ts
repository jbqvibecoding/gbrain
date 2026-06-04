/**
 * Bounded HTML → text. The one piece of post-processing worth keeping from
 * OpenHuman's `gmail/post_process.rs`: email bodies arrive as HTML and are
 * unusable as brainpage content raw. Everything richer (entity extraction,
 * summarization) is GBrain's job downstream.
 */

const MAX_LEN = 50_000;

export function htmlToText(html: string): string {
  if (!html) return '';
  let s = html.slice(0, MAX_LEN * 4); // bound work before we even start
  // Drop script/style blocks entirely.
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  // Block-level tags → newlines so structure survives.
  s = s.replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, ' ');
  // Decode the handful of entities that actually matter.
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  // Collapse whitespace.
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return s.slice(0, MAX_LEN);
}
