/**
 * Pure unit tests for the map HTML builder: structural completeness, safe
 * escaped-JSON injection (no `</script>` breakout), and the inline-vs-CDN asset
 * switch. No engine, no fs, no DOM.
 */
import { describe, test, expect } from 'bun:test';
import { buildMapHtml } from '../src/core/map/html-template.ts';
import type { GraphModel } from '../src/core/map/graph-data.ts';

function sampleModel(overrides: Partial<GraphModel> = {}): GraphModel {
  return {
    nodes: [
      { id: 1, slug: 'people/alice', type: 'person', title: 'Alice', category: 'person', color: '#3E6DB0', border: '#31578d', size: 30, labelVisible: true, degree: 2, inDegree: 0, outDegree: 2, salience: 0.8, href: null },
      { id: 2, slug: 'companies/acme', type: 'company', title: 'Acme', category: 'company', color: '#4F9D69', border: '#3f7d54', size: 20, labelVisible: true, degree: 1, inDegree: 1, outDegree: 0, salience: 0.1, href: 'file:///tmp/companies/acme.md' },
    ],
    edges: [{ from: 1, to: 2, linkType: 'works_at', linkSource: 'markdown', color: '#4F9D69', dashed: false }],
    legend: [
      { key: 'person', label: 'People', color: '#3E6DB0', count: 1 },
      { key: 'company', label: 'Companies', color: '#4F9D69', count: 1 },
    ],
    relKey: [{ linkType: 'works_at', label: 'works at', color: '#4F9D69', count: 1 }],
    stats: { nodes: 2, edges: 1, sources: 1 },
    sourceId: 'default',
    allSources: false,
    weightBy: 'degree',
    ...overrides,
  };
}

const SENTINEL = '/*__VIS_BUNDLE_SENTINEL__*/var vis={};';

describe('buildMapHtml', () => {
  test('emits a structurally complete self-contained document', () => {
    const html = buildMapHtml(sampleModel(), { inlineAssets: true, visJs: SENTINEL });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('id="graph"');
    expect(html).toContain('id="sidebar"');
    expect(html).toContain('id="search"');
    expect(html).toContain('id="legend"');
    expect(html).toContain('id="relkey"');
    expect(html).toContain('id="inspector"');
    expect(html).toContain('Local HTML map');
    // data made it into the inline JSON
    expect(html).toContain('people/alice');
    expect(html).toContain('companies/acme');
    expect(html).toContain('works_at');
    // inline asset present
    expect(html).toContain('__VIS_BUNDLE_SENTINEL__');
  });

  test('escapes < in injected data so </script> cannot break out', () => {
    const m = sampleModel();
    m.nodes[0].title = '</script><img src=x onerror=alert(1)>';
    const html = buildMapHtml(m, { inlineAssets: true, visJs: SENTINEL });
    // the malicious title survives only in escaped form...
    expect(html).toContain('\\u003c/script');
    // ...and never as a raw breakout sequence.
    expect(html.includes('</script><img src=x onerror=alert(1)>')).toBe(false);
  });

  test('cdn mode references the CDN + SRI and omits the inline bundle', () => {
    const html = buildMapHtml(sampleModel(), { inlineAssets: false });
    expect(html).toContain('cdn.jsdelivr.net/npm/vis-network');
    expect(html).toContain('integrity="sha384-');
    expect(html).not.toContain('__VIS_BUNDLE_SENTINEL__');
  });

  test('inlineAssets true but no visJs falls back to CDN', () => {
    const html = buildMapHtml(sampleModel(), { inlineAssets: true });
    expect(html).toContain('cdn.jsdelivr.net/npm/vis-network');
  });

  test('scope + sizing surface in the footer', () => {
    const all = buildMapHtml(sampleModel({ allSources: true, sourceId: null }), { inlineAssets: false });
    expect(all).toContain('all sources');
    const sal = buildMapHtml(sampleModel({ weightBy: 'salience' }), { inlineAssets: false });
    expect(sal).toContain('sized by salience');
  });

  test('escapes the document title', () => {
    const html = buildMapHtml(sampleModel(), { title: '<b>x</b>', inlineAssets: false });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<title>gbrain - <b>x</b>');
  });
});
