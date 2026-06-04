/**
 * Map palette — topic/page-type → color, and link-type → edge style.
 *
 * Pure module: no engine, no fs, no DOM. Drives `gbrain map`'s node coloring
 * (by topic) and typed-edge styling. Kept dependency-free so it unit-tests in
 * isolation and the HTML builder stays a pure string function.
 *
 * Coloring is "by topic": a node's category is derived from its slug's
 * top-level folder (people/, companies/, meetings/, concepts/, deals/, …) when
 * recognizable, else from its canonical page `type` (gbrain-base-v2). Both
 * axes normalize to the same canonical category key so `people/` and a
 * `type: person` page share one color + one legend chip.
 */

/** Canonical category keys, in stable legend order (topics first). */
export const CATEGORY_ORDER = [
  'person', 'company', 'meeting', 'concept', 'deal', 'media', 'tweet',
  'social-digest', 'analysis', 'atom', 'source', 'email', 'slack',
  'writing', 'project', 'note', 'other',
] as const;

export type Category = typeof CATEGORY_ORDER[number];

/**
 * Color per category. Tuned for contrast on the cream canvas (#FAF7F0): the
 * five primary topics (person/company/meeting/concept/deal) get vivid, mutually
 * distinct hues; rarer types get earthier tones. Derived from a Tableau-style
 * qualitative set (the same family graphify uses for communities), re-keyed to
 * gbrain's topic taxonomy.
 */
export const CATEGORY_COLORS: Record<Category, string> = {
  person: '#3E6DB0',          // blue
  company: '#4F9D69',         // green
  meeting: '#E0871C',         // orange
  concept: '#8A57AE',         // purple
  deal: '#CB477F',            // pink
  media: '#1C9AA0',           // teal
  tweet: '#5FA8D8',           // sky
  'social-digest': '#8C93A6', // slate
  analysis: '#B5642E',        // rust
  atom: '#6E8B3D',            // olive
  source: '#8A7E6B',          // taupe
  email: '#D2A33C',           // gold
  slack: '#A65BB8',           // violet
  writing: '#C2604F',         // terracotta
  project: '#5A4FB0',         // indigo
  note: '#9B9488',            // muted gray
  other: '#B0AA9E',           // light taupe
};

/** Plural, human-friendly legend labels (match the folder mental model). */
export const CATEGORY_LABELS: Record<Category, string> = {
  person: 'People',
  company: 'Companies',
  meeting: 'Meetings',
  concept: 'Concepts',
  deal: 'Deals',
  media: 'Media',
  tweet: 'Tweets',
  'social-digest': 'Social digests',
  analysis: 'Analysis',
  atom: 'Atoms',
  source: 'Sources',
  email: 'Email',
  slack: 'Slack',
  writing: 'Writing',
  project: 'Projects',
  note: 'Notes',
  other: 'Other',
};

/**
 * Normalize a slug-folder OR a canonical page type to a category key. Plural
 * folder names, subtype folders, and canonical singular types all collapse to
 * one key so a topic never splits across two colors.
 */
const ALIAS: Record<string, Category> = {
  // person
  people: 'person', person: 'person', persons: 'person', folks: 'person',
  // company (orgs + products live under the same topic color)
  companies: 'company', company: 'company', orgs: 'company', org: 'company',
  products: 'company', product: 'company',
  // meeting
  meetings: 'meeting', meeting: 'meeting',
  // concept
  concepts: 'concept', concept: 'concept', ideas: 'concept', idea: 'concept',
  // deal
  deals: 'deal', deal: 'deal',
  // media (subtype folders fold in)
  media: 'media', videos: 'media', video: 'media', articles: 'media',
  article: 'media', essays: 'media', essay: 'media', books: 'media',
  book: 'media', podcasts: 'media', podcast: 'media', blog: 'media', blogs: 'media',
  // tweet
  tweets: 'tweet', tweet: 'tweet', twitter: 'tweet',
  // social-digest
  'social-digest': 'social-digest', digests: 'social-digest', digest: 'social-digest',
  // analysis
  analysis: 'analysis', analyses: 'analysis',
  // atom
  atoms: 'atom', atom: 'atom',
  // source
  sources: 'source', source: 'source', transcripts: 'source', transcript: 'source',
  // email
  email: 'email', emails: 'email',
  // slack
  slack: 'slack',
  // writing
  writing: 'writing', writings: 'writing',
  // project
  projects: 'project', project: 'project',
  // note
  notes: 'note', note: 'note',
};

/**
 * Derive a node's category from its slug (topic folder) first, then its
 * canonical page type, falling back to 'other'. Slug folder wins because the
 * user's mental model is the topic directory (a `meetings/…` page filed as
 * type `source` should still read as a "meeting").
 */
export function categoryFor(slug: string, type: string | null | undefined): Category {
  const prefix = (slug.split('/')[0] || '').toLowerCase();
  if (ALIAS[prefix]) return ALIAS[prefix];
  const t = (type || '').toLowerCase();
  if (ALIAS[t]) return ALIAS[t];
  return 'other';
}

export function colorForCategory(cat: Category): string {
  return CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.other;
}

// --- edges ------------------------------------------------------------------

/**
 * Color per link type. Muted relative to node fills so edges read as connective
 * tissue, not foreground. Unknown link types fall back to a neutral gray.
 */
export const LINK_COLORS: Record<string, string> = {
  works_at: '#4F9D69',
  invested_in: '#CB477F',
  founded: '#E0871C',
  attended: '#8A57AE',
  partner_of: '#1C9AA0',
  authored: '#C2604F',
  attributed_to: '#5A4FB0',
  discusses: '#8C93A6',
  relates_to: '#A9A296',
  mentions: '#BDB6A8',
  sourced_from: '#8A7E6B',
  derived_from: '#77808E',
  supersedes: '#B5642E',
  redirects_to: '#C4BDB0',
};

export const LINK_FALLBACK_COLOR = '#9AA0A6';

export function colorForLinkType(linkType: string | null | undefined): string {
  if (!linkType) return LINK_FALLBACK_COLOR;
  return LINK_COLORS[linkType] ?? LINK_FALLBACK_COLOR;
}

/** Humanize a link type for display: `works_at` → `works at`. */
export function humanizeLinkType(linkType: string | null | undefined): string {
  if (!linkType) return 'link';
  return String(linkType).replace(/_/g, ' ');
}

/**
 * Weak, inferred edges render dashed (the analog of graphify's
 * confidence≠EXTRACTED → dashes). Body-text mentions and bare-wikilink
 * resolutions are the weak provenances; markdown/manual/frontmatter are solid.
 */
export function edgeIsDashed(linkSource: string | null | undefined): boolean {
  return linkSource === 'mentions' || linkSource === 'wikilink-resolved';
}

// --- color math -------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h;
  const int = parseInt(n, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Darken a hex color by `frac` (0..1). Used for node borders/rings. */
export function darken(hex: string, frac = 0.18): string {
  const [r, g, b] = hexToRgb(hex);
  const k = 1 - frac;
  return rgbToHex(r * k, g * k, b * k);
}

/** Lighten a hex color by `frac` (0..1) toward white. Node-gradient centers. */
export function lighten(hex: string, frac = 0.3): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * frac, g + (255 - g) * frac, b + (255 - b) * frac);
}

/** `rgba()` string of `hex` at `alpha` — soft glow/halo fills. */
export function glowRgba(hex: string, alpha = 0.28): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Radial-fill + ring stops for a premium "orb" node from one topic color. */
export function gradientStops(hex: string): { center: string; edge: string; ring: string } {
  return { center: lighten(hex, 0.3), edge: hex, ring: darken(hex, 0.22) };
}

/**
 * Relative luminance (WCAG-ish, 0..1). Exposed so tests can assert palette
 * colors have enough contrast against the cream canvas to be readable.
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
