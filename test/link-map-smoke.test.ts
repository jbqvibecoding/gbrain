import { describe, test, expect } from 'bun:test';
import { generateLinkMapHtml } from '../src/commands/link-map.ts';
import { loadLinkmapJs } from '../src/assets/linkmap/linkmap-embedded.ts';
import { buildLinkMapData, type LinkMapPageInput, type LinkMapEdgeInput } from '../src/core/link-map-data.ts';

const pages: LinkMapPageInput[] = [
  { slug: 'companies/acme-example', type: 'company', title: 'Acme Example' },
  { slug: 'people/alice-example', type: 'person', title: 'Alice Example' },
];
const edges: LinkMapEdgeInput[] = [
  { from_slug: 'people/alice-example', to_slug: 'companies/acme-example', link_type: 'works_at' },
];
const data = buildLinkMapData(pages, edges, { source: 'host', now: new Date('2026-06-04T00:00:00Z') });

describe('generateLinkMapHtml', () => {
  const html = generateLinkMapHtml(data, 'var GbrainLinkMap={render:function(){}};');

  test('produces a non-empty, well-formed HTML document', () => {
    expect(html.length).toBeGreaterThan(200);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  test('embeds the renderer global and the render call', () => {
    expect(html).toContain('GbrainLinkMap');
    expect(html).toContain('GbrainLinkMap.render(');
    expect(html).toContain('id="gblm-app"');
  });

  test('embeds the graph data', () => {
    expect(html).toContain('companies/acme-example');
    expect(html).toContain('window.__LINKMAP__');
    // The embedded JSON round-trips.
    const m = html.match(/var data = (\{[\s\S]*?\});\s*\n\s*window\.__LINKMAP__/);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(m![1].replace(/\\u003c/g, '<'));
    expect(parsed.nodes.length).toBe(2);
    expect(parsed.edges.length).toBe(1);
  });

  test('escapes </script> in untrusted data to prevent breakout', () => {
    const evil = buildLinkMapData(
      [{ slug: 'notes/x', type: 'note', title: '</script><img src=x>' }],
      [],
      { source: 'host' },
    );
    const out = generateLinkMapHtml(evil, '/* js */');
    // The literal closing tag from the title must not appear unescaped in the data script.
    expect(out).not.toContain('</script><img src=x>');
    expect(out).toContain('\\u003c/script>');
  });
});

describe('vendored renderer bundle', () => {
  test('loadLinkmapJs returns the real Cytoscape-based bundle', () => {
    const js = loadLinkmapJs();
    expect(js.length).toBeGreaterThan(100000);
    expect(js).toContain('GbrainLinkMap');
    expect(js).toContain('cytoscape');
  });
});
