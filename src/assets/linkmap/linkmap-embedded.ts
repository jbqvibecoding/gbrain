// Embeds the vendored gbrain Link Map renderer so it can be inlined into the
// self-contained HTML produced by `gbrain link-map`.
//
// `gbrain-linkmap.umd.js` is BUILT IN THE juggl REPO and vendored here. To
// refresh it after changing the renderer:
//
//   cd ../juggl && npm run build:standalone
//   cp dist/gbrain-linkmap.umd.js ../gbrain/src/assets/linkmap/gbrain-linkmap.umd.js
//   bash scripts/check-linkmap-embedded.sh   # integrity guard
//
// We use Bun's `with { type: 'file' }` import (same mechanism as
// src/admin-embedded.ts): it resolves to a path that works at runtime even
// inside a compiled binary (`bun build --compile`), which a plain
// `node_modules` read would not.

import { readFileSync } from 'fs';

// @ts-ignore — type: 'file' is Bun ESM, not in lib.d.ts (see src/admin-embedded.ts)
import LINKMAP_JS_FILE from './gbrain-linkmap.umd.js' with { type: 'file' };

/** Absolute path (binary-safe) to the vendored renderer bundle. */
export const LINKMAP_JS_PATH = LINKMAP_JS_FILE as unknown as string;

let _cached: string | null = null;

/** The renderer bundle's JavaScript source, for inlining into a `<script>`. */
export function loadLinkmapJs(): string {
  if (_cached === null) {
    _cached = readFileSync(LINKMAP_JS_PATH, 'utf8');
  }
  return _cached;
}
