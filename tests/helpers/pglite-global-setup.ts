import { ensureSnapshot } from "./pglite-snapshot";

/**
 * Vitest's `globalSetup`: build the migrated-database snapshot once, before any worker starts, so the first test
 * files do not each build it (`tests/helpers/pglite-snapshot.ts`). Runs in the main process, once per `vitest run`.
 */
export default async function setup(): Promise<void> {
  const started = performance.now();
  const file = await ensureSnapshot();
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (Number(seconds) >= 1) console.log(`pglite snapshot: built ${file} in ${seconds}s`);
}
