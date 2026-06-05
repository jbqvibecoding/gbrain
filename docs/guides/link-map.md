# Link Map — interactive brain graph

`gbrain link-map` exports your brain's wiki-link graph as a single, self-contained,
interactive HTML file: an Obsidian-style force-directed "Link Map". Open it in any
browser — no server, no CDN, no dependencies.

```bash
gbrain link-map                       # whole brain → ./brain-linkmap.html
gbrain link-map --out /tmp/map.html   # custom output path
gbrain link-map --source wiki         # scope to one source (default: resolved default source)
gbrain link-map --type person         # only include pages of this type
gbrain link-map --min-degree 1        # drop pages with fewer than N links
```

## What you get

- **Nodes** = pages, colored by **topic** and sized by how connected they are
  (degree). Topic comes from the page's top-level slug folder (`people/…` → People,
  `companies/…` → Companies, `meetings/…` → Meetings, …), falling back to the page
  `type` when the slug has no folder. Every topic present in the brain is shown, with
  stable colors for the well-known ones and an auto-assigned color for the rest.
- **Edges** = typed links (`works_at`, `attended`, `invested_in`, `relates_to`, …).
- **Sidebar** — search, asset/link/topic counters, a TOPICS checklist and a
  RELATIONSHIPS checklist (toggle to filter the graph), each with live counts.
- **Click a node** to focus its neighborhood (the rest dims) and open a detail panel:
  salience, connection counts, links-out, backlinks, and the page slug (with copy).
- **Minimap** (bottom-left), **zoom + reset-focus** controls (bottom-right).

## How it's built (reusing Juggl)

The graph renderer is **built in the [juggl](https://github.com/HEmile/juggl) repo**
(`src/standalone/entry.ts`, bundled by `npm run build:standalone` into
`dist/gbrain-linkmap.umd.js`). It reuses Juggl's Cytoscape recipe — the force-layout
physics (`src/viz/layout-settings.ts`), the degree-based node sizing + interaction
styling (`src/viz/stylesheet.ts`), and the click-to-focus neighborhood logic
(`src/viz/local-mode.ts`) — decoupled from the Obsidian runtime so it can run in a
static file.

gbrain **vendors** that built bundle at `src/assets/linkmap/gbrain-linkmap.umd.js` and
inlines it into the generated HTML (the same self-contained pattern `gbrain publish`
uses for marked.js). Data shaping is `src/core/link-map-data.ts`; the command is
`src/commands/link-map.ts`.

### Refreshing the vendored renderer

After changing the renderer in juggl:

```bash
cd ../juggl && npm run build:standalone
cp dist/gbrain-linkmap.umd.js ../gbrain/src/assets/linkmap/gbrain-linkmap.umd.js
cd ../gbrain && bash scripts/check-linkmap-embedded.sh   # integrity guard
```

`scripts/check-linkmap-embedded.sh` (wired into `bun run verify`) fails CI if the
vendored bundle is missing, truncated, or no longer a valid Cytoscape renderer.

## Performance

The default renders the **whole brain**. Force-directed layout in a browser is
comfortable into the low thousands of nodes; above ~2,500 the command prints a
stderr hint to narrow with `--type` or `--min-degree`. It still renders — just
expect a heavier layout pass on very large brains.
