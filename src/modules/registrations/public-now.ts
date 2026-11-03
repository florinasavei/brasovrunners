import { eq } from "drizzle-orm";
import { events } from "@/db/schema/events";
import type { Database } from "@/db/types";
import { registrationCta } from "@/modules/events/domain/registration-cta";
import { publicNow, type PublicNow } from "./domain/public-now";
import { publicEntryQueues } from "./domain/waitlist";
import { readPublicPlaces } from "./service";

/** «Pe site acum» (§NNN) for one event, and the tick it may be changed with. */
export type PublicDoor = {
  now: PublicNow;
  /** «Înscrieri publice deschise» as it stands on the row. */
  open: boolean;
  /** Whether the event takes its registration on this site at all: the tick means nothing otherwise. */
  internal: boolean;
  /**
   * «Locurile libere le dau doar eu» in force (§NNN): ticked, on an event of this site with a capacity — the
   * allocator's own rule (`publicEntryQueues`). Then no place goes out by itself either (`offersOnItsOwn`), and the
   * line says so under its sentence: every free place is the staff's to give.
   */
  offersOnly: boolean;
};

/**
 * What a visitor meets on the event's page this minute (§NNN), read the way the page reads it: the event's own
 * window, switches and counts through `registrationCta` — the public card's one predicate — over the allocator's
 * own public count (`readPublicPlaces`). Live, never the public cache, so the Administrator reads the row he just
 * changed; the page may lag it by the cache's expiry, which every save asks for at once (§333). Null for an event
 * that does not exist.
 */
export async function readPublicDoor<T extends Record<string, unknown>>(db: Database<T>, eventId: string, now: Date): Promise<PublicDoor | null> {
  const [event] = await db
    .select({
      registrationMode: events.registrationMode,
      eventStatus: events.eventStatus,
      startsAt: events.startsAt,
      dateToBeAnnounced: events.dateToBeAnnounced,
      timeToBeAnnounced: events.timeToBeAnnounced,
      registrationOpensAt: events.registrationOpensAt,
      registrationOpensSoon: events.registrationOpensSoon,
      registrationClosesAt: events.registrationClosesAt,
      publishedAt: events.publishedAt,
      externalRegistrationUrl: events.externalRegistrationUrl,
      externalProvider: events.externalProvider,
      capacity: events.capacity,
      waitlistCapacity: events.waitlistCapacity,
      publicRegistrationOpen: events.publicRegistrationOpen,
      freePlacesByOfferOnly: events.freePlacesByOfferOnly,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return null;
  const places = await readPublicPlaces(db, { id: eventId, capacity: event.capacity, waitlistCapacity: event.waitlistCapacity }, now);
  const cta = registrationCta(
    {
      ...event,
      availablePlaces: places.availablePlaces,
      waitlistRoom: places.waitlistRoom,
      waiting: places.waiting,
      offered: places.offered,
      waitlisted: places.waitlisted,
    },
    now,
  );
  const internal = event.registrationMode === "INTERNAL";
  return {
    now: publicNow(cta, { waiting: places.waiting, waitlistCapacity: event.capacity === null ? null : event.waitlistCapacity }),
    open: event.publicRegistrationOpen,
    internal,
    offersOnly: internal && publicEntryQueues({ freePlacesByOfferOnly: event.freePlacesByOfferOnly, channel: "public", capacity: event.capacity }),
  };
}
