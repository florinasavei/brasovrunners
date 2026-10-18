import { and, count, inArray, isNotNull } from "drizzle-orm";
import { eventRsvps } from "@/db/schema/event-rsvps";
import type { Database } from "@/db/types";

/**
 * How many confirmed «Vin!» answers each of these events has, in one query (§NNN): what the calendar's feed,
 * the `.ics` files, the emails' attachment and the listing's cards say, for every event they hold at once — never one query
 * per event, never per card. The same count `countRsvps` gives for one (`isNotNull(confirmedAt)`: an answer waiting for its
 * emailed link is not counted), as a plain object so the public cache can store it as JSON.
 *
 * An event with no confirmed answer is absent from the rows and present here as 0, so a caller reads `counts[id]` without
 * asking whether it was asked for.
 */
export async function countRsvpsForEvents<T extends Record<string, unknown>>(db: Database<T>, eventIds: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = Object.fromEntries(eventIds.map((id) => [id, 0]));
  if (eventIds.length === 0) return counts;
  const rows = await db
    .select({ eventId: eventRsvps.eventId, n: count() })
    .from(eventRsvps)
    .where(and(inArray(eventRsvps.eventId, [...eventIds]), isNotNull(eventRsvps.confirmedAt)))
    .groupBy(eventRsvps.eventId);
  for (const row of rows) counts[row.eventId] = row.n;
  return counts;
}
