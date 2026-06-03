/**
 * Pure unit tests for the map palette: every page type maps to a color, slug
 * prefixes win over type, colors are distinct and readable on the cream canvas,
 * and the link helpers behave. No engine, no fs.
 */
import { describe, test, expect } from 'bun:test';
import {
  CATEGORY_ORDER,
  CATEGORY_COLORS,
  categoryFor,
  colorForCategory,
  colorForLinkType,
  humanizeLinkType,
  edgeIsDashed,
  darken,
  relativeLuminance,
} from '../src/core/map/palette.ts';

describe('map palette', () => {
  test('every category has a valid hex color', () => {
    for (const c of CATEGORY_ORDER) {
      expect(CATEGORY_COLORS[c]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(colorForCategory(c)).toBe(CATEGORY_COLORS[c]);
    }
  });

  test('categoryFor: slug folder wins over page type', () => {
    expect(categoryFor('people/alice', 'source')).toBe('person');
    expect(categoryFor('companies/acme', 'note')).toBe('company');
    expect(categoryFor('meetings/2026-04-03', 'source')).toBe('meeting');
    expect(categoryFor('concepts/retrieval', 'note')).toBe('concept');
    expect(categoryFor('deals/widget-series-a', 'note')).toBe('deal');
    // subtype folders fold into their parent topic
    expect(categoryFor('products/widget', 'note')).toBe('company');
    expect(categoryFor('videos/talk', 'note')).toBe('media');
  });

  test('categoryFor: falls back to canonical type, then other', () => {
    expect(categoryFor('random/x', 'person')).toBe('person');
    expect(categoryFor('inbox/y', 'company')).toBe('company');
    expect(categoryFor('foo/bar', 'widget')).toBe('other');
    expect(categoryFor('', '')).toBe('other');
  });

  test('category colors are mutually distinct', () => {
    const vals = CATEGORY_ORDER.map((c) => CATEGORY_COLORS[c]);
    expect(new Set(vals).size).toBe(vals.length);
  });

  test('every category color has contrast against the cream canvas', () => {
    const bg = relativeLuminance('#FAF7F0');
    for (const c of CATEGORY_ORDER) {
      expect(bg - relativeLuminance(CATEGORY_COLORS[c])).toBeGreaterThan(0.08);
    }
  });

  test('darken produces a darker, valid hex', () => {
    const d = darken('#4F9D69', 0.2);
    expect(d).toMatch(/^#[0-9a-f]{6}$/);
    expect(relativeLuminance(d)).toBeLessThan(relativeLuminance('#4F9D69'));
  });

  test('link helpers', () => {
    expect(humanizeLinkType('works_at')).toBe('works at');
    expect(humanizeLinkType('invested_in')).toBe('invested in');
    expect(humanizeLinkType(null)).toBe('link');
    expect(edgeIsDashed('mentions')).toBe(true);
    expect(edgeIsDashed('wikilink-resolved')).toBe(true);
    expect(edgeIsDashed('markdown')).toBe(false);
    expect(edgeIsDashed('manual')).toBe(false);
    expect(colorForLinkType('works_at')).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(colorForLinkType('nonexistent_type')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
