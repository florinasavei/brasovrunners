import { startHeldBack } from "@/modules/events/domain/dated";

/**
 * Whether the staff verbs that put a person on a place or on the line ahead of the form — «Dă-i un loc acum»
 * (§637) and «Adaugă pe lista de așteptare» (§872) — can succeed on this event at all: an internal, scheduled
 * event with a date and a time that has not started. The services refuse every other event; this is the same
 * question asked before the press so the button is not drawn where every press is refused (§875). A forecast
 * only — the server decides. Pure, so each refusing event is tested in Node.
 */
export function givePlaceDoorOpen(
  event: {
    registrationMode: string;
    eventStatus: string;
    startsAt: Date;
    dateToBeAnnounced?: boolean | null;
    timeToBeAnnounced?: boolean | null;
  },
  now: Date,
): boolean {
  return event.registrationMode === "INTERNAL" && event.eventStatus === "SCHEDULED" && !startHeldBack(event) && event.startsAt.getTime() > now.getTime();
}
