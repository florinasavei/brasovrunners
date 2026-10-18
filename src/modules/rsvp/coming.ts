import type { Database } from "@/db/types";
import { noticeDescribesRsvp } from "@/modules/legal-documents/repository";
import { countRsvpsForEvents } from "./counts";
import { type RsvpGateInput, rsvpOffered } from "./domain/offered";

/**
 * Which events say «Vin!» outside their own page, and how many come to each (§812, «Vin!» part 2): the calendar's feed, the
 * `.ics` files, the emails' calendar attachment and the listing's cards all ask this, so none of them can draw the gate
 * differently from the page's «Vii?» card (`rsvpOffered`, §811 — the one rule).
 *
 * **A map from id to count, and absence is the answer "not offered".** An event is in the map exactly when the page would draw the
 * card — published, scheduled, no registration, ahead, ticked, and the notice in force describing «Vin!» — with the number of
 * confirmed answers (0 included: the calendar says «Fii primul care spune că vine»). A caller never evaluates the gate again.
 *
 * **Nothing is read for an event that cannot be offered.** The cheap columns decide first (`couldBeOffered`), so a feed or a listing
 * with no ticked turn-up event asks neither the notice nor the counts — the pages that have nothing to say cost what they cost
 * before this existed. The reads are the caller's (`ComingReads`): the public pages pass the cached ones, the outbox renderer — which
 * has a database and no request — passes the uncached twins (`readComingFromDb`).
 */
export type ComingEvent = RsvpGateInput & {
  id: string;
  /** «Doar pentru membrii BVR» (§552): the page draws no «Vii?» on a members' event (its box is a public form), so no surface links one. */
  membersOnly?: boolean | null;
};

export type ComingReads = {
  /** Whether the privacy notice in force describes «Vin!» in every language (`noticeDescribesRsvp`, or its cached twin). */
  described: (now: Date) => Promise<boolean>;
  /** The confirmed answers of these events; every id asked for is a key. */
  counts: (eventIds: readonly string[]) => Promise<Record<string, number>>;
};

/** The columns that rule an event out before any read: ticked, no registration, not a members' event, a start still ahead. */
export function couldBeOffered(event: ComingEvent, now: Date): boolean {
  return (
    event.rsvpEnabled === true &&
    event.registrationMode === "NONE" &&
    event.membersOnly !== true &&
    event.startsAt !== null &&
    event.startsAt.getTime() > now.getTime()
  );
}

export async function readComing(events: readonly ComingEvent[], now: Date, reads: ComingReads): Promise<ReadonlyMap<string, number>> {
  const candidates = events.filter((event) => couldBeOffered(event, now));
  if (candidates.length === 0) return new Map();
  if (!(await reads.described(now))) return new Map();
  const offered = candidates.filter((event) => rsvpOffered(event, now, true));
  if (offered.length === 0) return new Map();
  const counts = await reads.counts(offered.map((event) => event.id));
  return new Map(offered.map((event) => [event.id, counts[event.id] ?? 0]));
}

/** `readComing` over the database itself, never the public cache: the outbox renderer's (§812), which runs without a request. */
export function readComingFromDb<T extends Record<string, unknown>>(db: Database<T>, events: readonly ComingEvent[], now: Date): Promise<ReadonlyMap<string, number>> {
  return readComing(events, now, {
    described: (at) => noticeDescribesRsvp(db, at),
    counts: (ids) => countRsvpsForEvents(db, ids),
  });
}
