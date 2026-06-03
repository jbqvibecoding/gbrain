/**
 * Smoketest for `scripts/check-vis-embedded.sh`. Compiled with `bun build
 * --compile`, it loads the vendored vis-network asset through the same
 * `with { type: 'file' }` embed path the `gbrain map` command uses, and prints
 * a JSON shape the guard asserts on. Proves the asset survives --compile and
 * reads back intact (no silent fall-through to an empty bundle).
 */
import { loadVisNetworkJs } from '../src/core/map/assets.ts';

const js = await loadVisNetworkJs();
console.log(JSON.stringify({
  bytes: js.length,
  has_banner: js.includes('vis-network'),
  has_network_ctor: js.includes('Network'),
  no_script_close: !js.includes('</script'),
}, null, 2));
