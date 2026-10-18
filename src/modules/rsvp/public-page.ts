import { holdPageUntil } from "@/modules/public-cache/page-lifetime";
import { cachedRsvpCounts, cachedRsvpDescribed } from "@/modules/public-cache/reads";
import { type ComingEvent, readComing } from "./coming";

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
