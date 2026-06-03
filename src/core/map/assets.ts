/**
 * Vendored vis-network asset (embedded into the compiled binary).
 *
 * Mirrors the tree-sitter WASM embed pattern in `src/core/chunkers/code.ts`:
 * `with { type: 'file' }` resolves to a path string at runtime; `bun build
 * --compile` bundles the referenced file into the binary, and in dev/test the
 * path resolves to the source-tree file. `Bun.file(path).text()` then reads the
 * bytes back as a string for inlining into the generated HTML.
 *
 * We vendor the *built* standalone UMD (self-contained: bundles vis-data etc.)
 * rather than depending on the `vis-network` npm package — zero new runtime
 * dependencies. The vendored file is the source of truth; the CDN constants
 * below are only used by `gbrain map --cdn` (smaller HTML, needs network).
 */

// @ts-ignore — the 'file' import attribute is valid Bun syntax, not in lib.d.ts
import VIS_NETWORK_JS_PATH from '../../assets/vis/vis-network.min.js' with { type: 'file' };

let cachedJs: string | null = null;

/** Read the vendored vis-network UMD bundle as a string (cached). */
export async function loadVisNetworkJs(): Promise<string> {
  if (cachedJs == null) {
    cachedJs = await Bun.file(VIS_NETWORK_JS_PATH).text();
  }
  return cachedJs;
}

/**
 * CDN fallback for `gbrain map --cdn`. The SRI hash is the sha384 of the
 * vendored 10.1.0 standalone UMD — jsDelivr serves the byte-identical npm file
 * for the same version, so the integrity check validates. Refresh both when
 * re-vendoring a new vis-network version.
 */
export const VIS_NETWORK_VERSION = '10.1.0';
export const VIS_NETWORK_CDN_URL =
  `https://cdn.jsdelivr.net/npm/vis-network@${VIS_NETWORK_VERSION}/standalone/umd/vis-network.min.js`;
export const VIS_NETWORK_SRI =
  'sha384-Kp7cMaDnHOrgpE8FT6l7tUuGIo7kBcBVcttockpXN/whrsQBcy9ZcpKmr/1a/nMo';
