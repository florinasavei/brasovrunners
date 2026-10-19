import { holdPageUntil } from "@/modules/public-cache/page-lifetime";
import { cachedFirstRsvpNoticeVersion, cachedPublicRsvps, cachedRsvpCounts, cachedRsvpDescribed } from "@/modules/public-cache/reads";
import { type ComingEvent, readComing } from "./coming";
import type { PublicRsvps } from "./rsvp";

/**
 * What the public pages ask of «Vin!» beyond the event's own page (§815): the calendar's feed, the event's `.ics`
 * and the listing's «N vin» chip, through the public cache — `readComing` with the cached reads (`public-cache/reads.ts`), asked
 * once per request however many cards or entries need them, and nothing at all for events none of which could be offered.
 *
 * **The page is held until the first offered event starts** (`holdPageUntil`, §549): that is the instant the line and the chip go away
 * (`rsvpOffered` wants a start still ahead), and the listing is otherwise kept until an event *ends*. A confirmation or a
 * withdrawal expires the counts (`revalidatePublicContent("places")`, §812), and with them the static response filed under their
 * tag — once per write, never per poll.
 */
export async function readPublicComing(events: readonly ComingEvent[], now: Date): Promise<ReadonlyMap<string, number>> {
  const coming = await readComing(events, now, { described: cachedRsvpDescribed, counts: cachedRsvpCounts });
  await holdPageUntil(events.filter((event) => coming.has(event.id)).map((event) => event.startsAt), now);
  return coming;
}

/**
 * The answers of several events at once, for a page that draws more than one «Cine vine» (§715 amended: the members' zone, §143, §812):
 * the notice's first version is asked once and each event's cached read (`cachedPublicRsvps`, filed under "places", so a confirmation
 * or a withdrawal expires it at once) is asked once, in parallel — one gathering for the page, never a read per card. The names are
 * exactly what the event page's own read gives (`readPublicRsvps`): a confirmed answer whose person ticked, under a notice that describes
 * «Vin!». An id appears once however many times it is asked. The caller wraps it in `readOrWhileAway`: a count that cannot be asked is not zero.
 */
export async function readPublicRsvpsFor(eventIds: readonly string[]): Promise<ReadonlyMap<string, PublicRsvps>> {
  const ids = [...new Set(eventIds)];
  if (ids.length === 0) return new Map();
  const firstNotice = await cachedFirstRsvpNoticeVersion();
  const read = await Promise.all(ids.map(async (id) => [id, await cachedPublicRsvps(id, firstNotice)] as const));
  return new Map(read);
}
