import { getStorage, isStorageConfigured } from "@/modules/media/storage";
import { parseGpxWaypoints, type GpxWaypoints } from "./domain/gpx-waypoints";

/**
 * The waypoints of an event's route file, read from the site's store (§NNN) — the one place that
 * fetches the GPX for the checkpoints (the bib's profile has its own reader, `bib-extras.ts`, of the
 * same object).
 *
 * The answer is kept by the file's store key: a new upload gets a new key (`events/domain/route-gpx.ts`),
 * so an entry never goes stale, and what is kept is the few placed waypoints, never the file (up to
 * 4 MB). Only an answer is kept — a file that was read, with or without waypoints in it — never a
 * failed read, which may be the store's bad moment. A store that is not set up, slow or empty is
 * `null`: the editor then draws no «Ia punctele din GPX», and a save is measured against the typed
 * distance alone — never a failed page.
 */
const CACHE_SIZE = 16;
const cache = new Map<string, GpxWaypoints>();

/** Forgets every kept answer — for the tests, which count the store's reads. */
export function clearGpxWaypointsCache(): void {
  cache.clear();
}

export async function loadGpxWaypoints(key: string | null | undefined): Promise<GpxWaypoints | null> {
  if (!key) return null;
  const kept = cache.get(key);
  if (kept) {
    // Most recently used goes last.
    cache.delete(key);
    cache.set(key, kept);
    return kept;
  }
  if (!isStorageConfigured()) return null;
  try {
    const bytes = await getStorage().get(key);
    if (!bytes) return null;
    const parsed = parseGpxWaypoints(new TextDecoder().decode(bytes));
    cache.set(key, parsed);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    return parsed;
  } catch {
    return null;
  }
}
