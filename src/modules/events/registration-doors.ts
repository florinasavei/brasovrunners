import { unstable_rethrow } from "next/navigation";
import { cachedPublicAvailability } from "@/modules/public-cache/reads";
import { doorNeedsAvailability, registrationDoorOpen, type RegistrationDoorEvent } from "./domain/listing-filter";

/**
 * Which of these events' pages has a registration door right now — the «Înscrieri deschise» box
 * (§NNN), answered the way the event page answers it (`RegistrationCta`), never by the window alone.
 *
 * **What it costs.** Only an open internal event needs its free places, and those come from
 * `cachedPublicAvailability` — the data-cache entry the event page's own door reads (§333), expired
 * by every registration that moves it. So a listing or a calendar month pays one cached read per
 * open internal event on it (the club's race, during its window) and nothing for any other row; the
 * reads run side by side. Every other event's door is decided off its own columns.
 *
 * **When the count cannot be read** (§281) the event is not counted as open: its page would show
 * "could not count" rather than a button, and a filter for "where can I register" should not send
 * a reader to that. The failure is logged; the rest of the page stands.
 */
export async function readRegistrationDoors<T extends RegistrationDoorEvent & { id: string }>(
  events: readonly T[],
  now: Date,
): Promise<(event: T) => boolean> {
  const doors = new Map<string, boolean>();
  await Promise.all(
    events.map(async (event) => {
      if (doors.has(event.id)) return;
      if (!doorNeedsAvailability(event, now)) {
        doors.set(event.id, registrationDoorOpen(event, null, now));
        return;
      }
      try {
        doors.set(event.id, registrationDoorOpen(event, await cachedPublicAvailability(event.id, now), now));
      } catch (error) {
        unstable_rethrow(error);
        console.error("[registration-doors] could not read the availability", error);
        doors.set(event.id, false);
      }
    }),
  );
  return (event) => doors.get(event.id) ?? false;
}
