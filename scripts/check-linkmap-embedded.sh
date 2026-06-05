#!/usr/bin/env bash
# CI gate: the vendored gbrain Link Map renderer must be present and valid.
#
# `src/assets/linkmap/gbrain-linkmap.umd.js` is BUILT IN THE juggl REPO
# (`npm run build:standalone`) and vendored here. gbrain can't rebuild it
# (separate repo), so this guard verifies the committed bundle is a real,
# non-truncated renderer and that the embedded loader still references it —
# catching accidental corruption, truncation, or an empty copy.
#
# Refresh the bundle with:
#   cd ../juggl && npm run build:standalone
#   cp dist/gbrain-linkmap.umd.js ../gbrain/src/assets/linkmap/gbrain-linkmap.umd.js

set -euo pipefail

cd "$(dirname "$0")/.."

ASSET="src/assets/linkmap/gbrain-linkmap.umd.js"
LOADER="src/assets/linkmap/linkmap-embedded.ts"

fail() { echo "[check:linkmap-embedded] $1"; exit 1; }

[ -f "$ASSET" ]  || fail "missing $ASSET (build it in juggl: npm run build:standalone)"
[ -f "$LOADER" ] || fail "missing $LOADER"

# Non-trivial size (a real bundle is hundreds of KB; cytoscape alone is ~400KB).
BYTES=$(wc -c < "$ASSET")
if [ "$BYTES" -lt 100000 ]; then
  fail "$ASSET is only ${BYTES} bytes — looks truncated/empty (expected a full bundle)"
fi

# Must expose the renderer global + the render entry point.
grep -q "GbrainLinkMap" "$ASSET" || fail "$ASSET does not define the GbrainLinkMap global"
grep -q "cytoscape"     "$ASSET" || fail "$ASSET does not appear to bundle cytoscape"

# The loader must point at the vendored file.
grep -q "gbrain-linkmap.umd.js" "$LOADER" || fail "$LOADER does not reference the vendored bundle"

echo "[check:linkmap-embedded] OK (${BYTES} bytes)"
