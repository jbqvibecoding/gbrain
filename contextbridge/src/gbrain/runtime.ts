// @ts-nocheck
/**
 * The ONE repo-coupling seam.
 *
 * ContextBridge is a standalone module; this file is the single place that
 * reaches into the host GBrain repo's source. It uses relative imports into
 * `gbrain/src/core/*` and is deliberately `@ts-nocheck` so contextbridge's own
 * (stricter) typecheck does not deep-check gbrain's entire source graph. The
 * typed surface lives in `./adapter.ts`.
 *
 * If ContextBridge is ever extracted into its own repo, swap the three relative
 * imports below for the published package subpaths:
 *   `gbrain/operations`, `gbrain/engine-factory`, `gbrain/config`.
 */

export async function loadGbrainModules() {
  // Variable specifiers so the typechecker does NOT pull gbrain's source graph
  // into contextbridge's (stricter) program — the binding is resolved purely at
  // runtime within the host repo.
  const base = '../../../src/core';
  const [operations, engineFactory, config] = await Promise.all([
    import(`${base}/operations.ts`),
    import(`${base}/engine-factory.ts`),
    import(`${base}/config.ts`),
  ]);
  return {
    operationsByName: operations.operationsByName,
    createEngine: engineFactory.createEngine,
    loadConfig: config.loadConfig,
    toEngineConfig: config.toEngineConfig,
  };
}

/** Invoke a single gbrain operation by name with a prebuilt context. */
export async function callOp(operationsByName, name, ctx, params) {
  const op = operationsByName[name];
  if (!op) throw new Error(`[contextbridge:gbrain] unknown gbrain operation: ${name}`);
  return op.handler(ctx, params);
}
