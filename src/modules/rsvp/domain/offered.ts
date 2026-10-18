import { startHeldBack } from "@/modules/events/domain/dated";

/**
 * Whether «Vin!» is offered on an event page (§811, «Vin!» part 1) — **the one rule**, asked by the page, by the
 * action that takes an answer, by the one-tap island's server action and by every surface that later links to the
 * answer (the calendar's feed, the listing card, the «Vii?» message), so no two of them can draw it differently.
 *
 * Every condition, and nothing else:
 *
 *   - the event is published (the translation the visitor reads has a publication moment);
 *   - it is not cancelled and not completed (`eventStatus` SCHEDULED);
 *   - it asks for no registration (`registrationMode` NONE) — «Vin!» is the turn-up events' answer; an event with a
 *     registration has its own list, its own places and its own declaration;
 *   - its start is announced and still ahead;
 *   - the club ticked «Acceptă răspunsuri „Vin!"» (`rsvpEnabled`);
 *   - the privacy notice in force describes «Vin!» (`{{rsvp}}`, `describesRsvp`, in every language): an answer takes an
 *     address and may publish a name, and a disclosure is not made before the notice that describes it (§143, §396).
 *
 * Otherwise the page shows nothing — no box, no count, no sentence. Pure; `now` is an argument (AGENTS.md §1.5).
 */
export type RsvpGateInput = {
  /** The moment this language's translation was published, or null while it is a draft. */
  publishedAt: Date | null;
  eventStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  registrationMode: "NONE" | "INTERNAL" | "EXTERNAL";
  /** Null while the date is to be announced (§533): a public read withholds it in SQL. */
  startsAt: Date | null;
  dateToBeAnnounced?: boolean | null;
  timeToBeAnnounced?: boolean | null;
  rsvpEnabled: boolean | null | undefined;
};

export function rsvpOffered(event: RsvpGateInput, now: Date, noticeDescribes: boolean): boolean {
  if (!noticeDescribes) return false;
  if (event.publishedAt === null) return false;
  if (event.eventStatus !== "SCHEDULED") return false;
  if (event.registrationMode !== "NONE") return false;
  if (event.rsvpEnabled !== true) return false;
  if (startHeldBack(event) || event.startsAt === null) return false;
  return event.startsAt.getTime() > now.getTime();
}
