#!/usr/bin/env bash
# CI guard: verify that bun --compile binaries ship with the embedded
# vis-network bundle that `gbrain map` inlines into its HTML output.
#
# Two regressions this catches:
#   1. The vendored asset picks up a literal </script> (would break the inline
#      <script> embedding and silently corrupt every generated map).
#   2. The `with { type: 'file' }` import attribute or asset path drifts, so the
#      compiled binary can't read the bundle back — `gbrain map` would emit a
#      blank-canvas HTML file with no error.
#
# Mirrors scripts/check-wasm-embedded.sh. Runs as part of `bun test`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ASSET="src/assets/vis/vis-network.min.js"

# 1. Inline-safety invariant: the asset is injected raw between <script> tags,
#    so it must not contain a literal </script>.
if [ ! -f "$ASSET" ]; then
  echo "[check-vis-embedded] FAIL: vendored asset $ASSET is missing." >&2
  exit 1
fi
if grep -q "</script" "$ASSET"; then
  echo "[check-vis-embedded] FAIL: $ASSET contains </script> — unsafe to inline raw." >&2
  exit 1
fi

# 2. Build a minimal smoketest binary that loads the embedded asset, then run
#    it and assert the bundle read back intact.
OUT_BIN="$(mktemp /tmp/gbrain-vis-check.XXXXXX)"
trap 'rm -f "$OUT_BIN"' EXIT
bun build --compile --outfile "$OUT_BIN" scripts/map-asset-smoketest.ts >/dev/null 2>&1

OUTPUT="$("$OUT_BIN" 2>&1)"

if ! echo "$OUTPUT" | grep -q '"has_banner": true'; then
  echo "[check-vis-embedded] FAIL: compiled binary did not load the vendored vis-network asset." >&2
  echo "[check-vis-embedded] Output was:" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

if ! echo "$OUTPUT" | grep -q '"no_script_close": true'; then
  echo "[check-vis-embedded] FAIL: embedded asset contains </script>." >&2
  echo "[check-vis-embedded] Output was:" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

BYTES="$(echo "$OUTPUT" | grep -oE '"bytes": [0-9]+' | grep -oE '[0-9]+' || true)"
if [ -z "$BYTES" ] || [ "$BYTES" -lt 300000 ]; then
  echo "[check-vis-embedded] FAIL: embedded vis-network too small (${BYTES:-0} bytes) — asset not bundled?" >&2
  echo "[check-vis-embedded] Output was:" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

echo "[check-vis-embedded] OK — vendored vis-network (${BYTES} bytes) embeds and reads back from the compiled binary."
