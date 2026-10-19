import { and, count, eq, inArray, isNotNull } from "drizzle-orm";
import { eventRsvps } from "@/db/schema/event-rsvps";
import type { Database } from "@/db/types";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";

/**
 * How many confirmed «Vin!» answers each of these events has, in one query (§815): what the calendar's feed,
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

/**
 * Which of these events a signed-in member has a confirmed answer to, in one query (§822): the members' zone's «Tu vii ✓» and its
 * «Nu mai vin», read live for the account on screen — never through the public cache, which is everybody's. The address is matched in
 * its canonical form, the way the service writes it (`canonicalizeEmail`, AGENTS.md §10.4), so the row an account made yesterday is
 * found whatever case or dots the provider spells it with. An answer still waiting for its emailed link (`confirmedAt` empty) is not an
 * answer; an address that cannot be canonicalised answers nothing.
 *
 * A map, not a set (§827): each answered event carries the state of the person's own tick «Numele meu apare la „Cine vine"» — `showName`
 * as it stands (the tick AND a name: a tick with no name shows nothing and is not drawn ticked), and `name`, the name the row holds, which
 * the zone prefills in its box so a stored name is never published unseen (§812). The signed-in account's own answers, never the address.
 */
export type AccountAnswer = { showName: boolean; name: string | null };

export async function answeredByAccount<T extends Record<string, unknown>>(db: Database<T>, email: string, eventIds: readonly string[]): Promise<Map<string, AccountAnswer>> {
  if (eventIds.length === 0) return new Map();
  let canonicalEmail: string;
  try {
    canonicalEmail = canonicalizeEmail(email).canonicalEmail;
  } catch {
    return new Map();
  }
  const rows = await db
    .select({ eventId: eventRsvps.eventId, showName: eventRsvps.showName, displayName: eventRsvps.displayName })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.canonicalEmail, canonicalEmail), inArray(eventRsvps.eventId, [...eventIds]), isNotNull(eventRsvps.confirmedAt)));
  return new Map(rows.map((row) => [row.eventId, { showName: row.showName && row.displayName !== null, name: row.displayName }]));
}
