import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { events } from "@/db/schema/events";
import type { Database } from "@/db/types";
import { checkGpx, cleanGpxName, type GpxRefusal, readRouteGpx, type RouteGpx, routeGpxHeaders, routeGpxKey } from "@/modules/events/domain/route-gpx";
import type { Storage } from "@/modules/media/storage";

/**
 * The GPX of «Traseul» in the store (§718): put on upload, deleted when no event names it.
 *
 * The upload writes the object at once and answers what the row will store; the event's save
 * writes the row (the editor posts it with everything else), so a series edit and a duplicate carry
 * the file like the route (§49, §130). A file uploaded and never saved stays in the store unread — a
 * few hundred kilobytes, and the price of not holding the upload inside the save's request.
 */

/** Refused bytes, said in the words the editor shows. */
export class GpxRefusedError extends Error {
  constructor(readonly reason: GpxRefusal) {
    super(`not a GPX file: ${reason}`);
    this.name = "GpxRefusedError";
  }
}

/** Check the bytes and put them under a new key; answers the row's value. Nothing is written for a refusal. */
export async function storeRouteGpx(
  storage: Storage,
  input: { bytes: Buffer; name: string; environment: string; now: Date },
): Promise<RouteGpx> {
  const verdict = checkGpx(input.bytes);
  if (!verdict.ok) throw new GpxRefusedError(verdict.reason);
  const name = cleanGpxName(input.name);
  const key = routeGpxKey(input.environment, randomUUID(), name);
  const headers = routeGpxHeaders(key);
  // As given: the site keeps the file the club uploaded, byte for byte.
  await storage.put(key, input.bytes, headers.contentType, { contentDisposition: headers.contentDisposition });
  return { key, name, size: input.bytes.byteLength, uploadedAt: input.now.toISOString() };
}

/** How many event rows name this key — a series and its duplicates share one object. */
export async function countRouteGpxUses<T extends Record<string, unknown>>(db: Database<T>, key: string): Promise<number> {
  const [row] = await db
    .select({ uses: sql<number>`count(*)::int` })
    .from(events)
    .where(sql`${events.routeGpx} ->> 'key' = ${key}`);
  return row?.uses ?? 0;
}

/**
 * The objects among `keys` no event row names any more, deleted — after the save that let go of
 * them has committed. Best effort: a store having a bad minute leaves a file nobody links to,
 * never a page linking to a file that is gone.
 */
export async function releaseRouteGpx<T extends Record<string, unknown>>(
  db: Database<T>,
  storage: Storage,
  keys: readonly (string | null | undefined)[],
): Promise<number> {
  let deleted = 0;
  for (const key of new Set(keys.filter((key): key is string => typeof key === "string"))) {
    if ((await countRouteGpxUses(db, key)) > 0) continue;
    await storage.delete(key).catch(() => undefined);
    deleted += 1;
  }
  return deleted;
}

/** The key a stored column names, or null. */
export const routeGpxKeyOf = (stored: unknown): string | null => readRouteGpx(stored)?.key ?? null;
