import { getStorage, isStorageConfigured } from "@/modules/media/storage";
import { type ElevationProfileData, parseGpxElevation } from "./parse";

/**
 * The store could not give the GPX: the store failed, or the object the event names is not there. Distinct from a file
 * that was read and has no profile (that is a `null`, and a fact about the file): a failure is the store's bad moment, so
 * the public cache must not keep it for a day (`public-cache/reads.ts#cachedRouteElevation` lets it through uncached).
 */
export class ElevationUnreadable extends Error {
  constructor(cause?: unknown) {
    super("the route's GPX could not be read from the store", cause === undefined ? undefined : { cause });
    this.name = "ElevationUnreadable";
  }
}

/**
 * The answers kept in this process, by the file's store key — a new upload gets a new key (`events/domain/route-gpx.ts`), so an
 * entry never goes stale. What the editor's preview and the draft preview read on every page load must not fetch up to 4 MB
 * from the store each time; the public page has the data cache above this (`cachedRouteElevation`). Only an answer is kept —
 * a file that was read, with or without a profile in it — never a failed read.
 */
const CACHE_SIZE = 16;
const kept = new Map<string, ElevationProfileData | null>();

/** Forgets every kept answer — for the tests, which count the store's reads. */
export function clearElevationCache(): void {
  kept.clear();
}

/**
 * The elevation profile of the route file stored under `key` (§802): the bytes from the site's store, decoded, parsed
 * (`parse.ts`). Null when there is no store to ask or the file has no profile (no altitudes, too short); throws
 * `ElevationUnreadable` when the store fails or the object is missing. Reads the store only — never the database — so a
 * public page that asks for it costs no wake of Neon.
 */
export async function readRouteElevation(key: string): Promise<ElevationProfileData | null> {
  if (kept.has(key)) {
    const answer = kept.get(key) ?? null;
    // Most recently used goes last.
    kept.delete(key);
    kept.set(key, answer);
    return answer;
  }
  if (!isStorageConfigured()) return null;
  let bytes: Buffer | null;
  try {
    bytes = await getStorage().get(key);
  } catch (error) {
    throw new ElevationUnreadable(error);
  }
  if (!bytes) throw new ElevationUnreadable();
  const answer = parseGpxElevation(new TextDecoder().decode(bytes));
  kept.set(key, answer);
  if (kept.size > CACHE_SIZE) kept.delete(kept.keys().next().value as string);
  return answer;
}
