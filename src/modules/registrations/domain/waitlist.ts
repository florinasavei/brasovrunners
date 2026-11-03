import { DomainError } from "@/shared/errors/domain-error";

/**
 * How long a waiting list may grow (`DECISIONS.md` §348; the owner: "for the waiting list, I
 * also need to set a queue length"), as pure functions over counts a caller already has.
 *
 * **Not a second capacity formula.** Nothing here decides whether a place is free — that is
 * `capacity.ts`, the allocator's one formula (`AGENTS.md` §10.6). This answers the question that
 * comes after it, and only once the answer to the first is "no place": may this person join the
 * line, or is the line full too? The counts are the ones the allocator has already taken under
 * the event lock (`countOccupied`, `countEligibleWaitlisted`), so asking costs no query.
 *
 * **The line is `WAITLISTED` plus every offer still open.** An offered person holds a place for
 * 24 hours (`computeOccupied` counts it) and has not taken it: they are still somebody the
 * waiting list is carrying and the club still owes an answer, and the queue panel lists them in
 * the line with their deadline (§92). So an offer does not open a slot when it is made; it opens
 * one when it is accepted, declined or lapses — at most a day later. An offer past its deadline
 * is not counted (unless its email is still queued, §520), the same way `countOccupied` stops
 * counting its place, so no decision here
 * waits for the maintenance job either (§10.6). `kind` appears nowhere: a `TEST` row stands in
 * the line exactly as a real one does (`AGENTS.md` §12.6).
 */

export type WaitlistInput = {
  /** `events.waitlist_capacity`: null is no limit, 0 is no waiting list at all. */
  waitlistCapacity: number | null;
  /** `WAITLISTED` rows — `countEligibleWaitlisted`. */
  waitlisted: number;
  /** `WAITLIST_OFFERED` rows whose deadline is ahead or whose email is still queued (§520) — `OccupiedCounts.unexpiredWaitlistOfferedHolds`. */
  openOffers: number;
};

/** How many people the waiting list is carrying: everybody in the line the queue panel shows. */
export function waitlistLength(input: Pick<WaitlistInput, "waitlisted" | "openOffers">): number {
  return input.waitlisted + input.openOffers;
}

/**
 * Whether a newcomer must join the line rather than take a free place (§615): somebody is waiting in
 * it — a `WAITLISTED` row, a person with no place yet. A free place is given from the line while
 * anybody waits there, whether the event offers its places on its own or its organizer hands them
 * out (`events.waitlist_auto_offer`): a newcomer who could take a free place past the people waiting
 * would make a queue nobody can trust.
 *
 * An open offer is not somebody waiting (§160): its holder already has a place, which the offer
 * occupies, and a newcomer taking a *different* free place overtakes nobody. Counting offers here
 * would change what «Da» does — a full line's lapsed hold could no longer go to a newcomer (§160),
 * and a newcomer after a raise past the line would be offered a place instead of holding one — for
 * no one's benefit. `kind` is in no condition (§30): only the count.
 */
export function newcomerJoinsLine(input: Pick<WaitlistInput, "waitlisted"> & OfferOnlyInput): boolean {
  return input.waitlisted > 0 || publicEntryQueues(input);
}

/**
 * How a registration reached the allocator (§NNN): `public` — the public form, its emailed link for another
 * person, a verified runner's restart through it, a family sitting's form, and the address confirmation of a
 * registration the public form wrote — or `staff`: a staff entry (vouched or confirmed by its email), the
 * desk, «Dă-i un loc», «Trimite-i oferta», «Oferă-i un loc acum», an invitation, «Pe lista de invitați
 * speciali», and a late signature keeping the place it was given. Never `kind` (§30).
 */
export type EntryChannel = "public" | "staff";

export type OfferOnlyInput = {
  /** `events.free_places_by_offer_only` («Locurile libere le dau doar eu», §NNN); absent is off. */
  freePlacesByOfferOnly?: boolean;
  /** Who is entering (§NNN); absent is the staff's, which the switch never touches. */
  channel?: EntryChannel;
};

/**
 * «Locurile libere le dau doar eu» (§NNN): a public entry joins the line whatever is free, as it does while
 * anybody waits (§615) — the free places are the staff's to give. A staff entry is never touched. Only who a
 * free place is for: the capacity formula is untouched, so the switch can give fewer places, never more.
 */
export function publicEntryQueues(input: OfferOnlyInput): boolean {
  return input.freePlacesByOfferOnly === true && input.channel === "public";
}

/**
 * Whether the line is offered the free places on its own (§615, §NNN): «Locurile din lista de așteptare se alocă
 * automat» on, and «Locurile libere le dau doar eu» off. The tick wins over «Da»: its words are «only I give the free
 * places», so while it is on no place goes out by itself — not to a newcomer, and not to the first in the line either,
 * who would otherwise be the public entrant the tick sent there a moment ago. Every free place is then the staff's to
 * give («Trimite-i oferta», «Dă-i un loc», «Oferă-i un loc acum»), as with «Nu». Only where places are counted:
 * on an uncapped event the tick means nothing, and a cap lifted while people wait offers them the places as «Da»
 * says (§147). The SQL form for the readers that say it is `repository.ts#lineOffersOnItsOwn`; both read the same
 * three columns.
 */
export function offersOnItsOwn(event: { waitlistAutoOffer: boolean; freePlacesByOfferOnly: boolean; capacity: number | null }): boolean {
  return event.waitlistAutoOffer && !(event.freePlacesByOfferOnly && event.capacity !== null);
}

/**
 * How many more the waiting list takes, or `null` when it has no limit.
 *
 * Never below nought. A limit lowered under the length of the line removes nobody — the people
 * already waiting keep their places in it — so the line may be longer than the limit for a
 * while, and the answer is simply "none" until it is shorter again.
 */
export function waitlistRoom(input: WaitlistInput): number | null {
  if (input.waitlistCapacity === null) return null;
  return Math.max(input.waitlistCapacity - waitlistLength(input), 0);
}

/** Whether one more person may join the waiting list right now. */
export function waitlistHasRoom(input: WaitlistInput): boolean {
  const room = waitlistRoom(input);
  return room === null || room > 0;
}

/**
 * The occupied count a newcomer is measured against — `computeOccupied`'s, less the lapsed
 * declaration holds when the waiting list has no room for them (§160, §348).
 *
 * §160 keeps a hold past its deadline until somebody wants the place, and "somebody" used to be
 * only a person in the line. Where the line has room that is still how it goes: the count says
 * full, the newcomer joins the line, and the kept hold is released and offered to them at once.
 * Where it has none — a limit reached, or a limit of 0 — the newcomer can never be in the line,
 * so the newcomer is the one who wants the place: the allocator releases one lapsed hold for them,
 * the oldest deadline first (`expireStaleHolds`' `wanting`), and gives them the place directly.
 * This is what the door and the event page count with, so they say "a place" exactly when the
 * allocator would give one; the formula itself (`capacity.ts`) is untouched.
 */
export function occupiedForNewcomer(input: WaitlistInput & { occupied: number; lapsedDeclarationHolds: number }): number {
  return waitlistHasRoom(input) ? input.occupied : input.occupied - input.lapsedDeclarationHolds;
}

/**
 * The marker a refusal carries when the places are gone and the waiting list is full too — the
 * public form's «Locurile s-au ocupat și lista de așteptare e plină — ne pare rău.» (§587). Not a field of any form: a rule
 * about the event, like the throttle's marker, read by the page from the refusal's field list.
 */
export const WAITLIST_FULL = "waitlistFull";

/**
 * The marker for an event with no waiting list at all (a limit of 0): the places are gone and
 * registration is closed as full — said without mentioning a waiting list nobody could join.
 */
export const NO_WAITLIST = "noWaitlist";

export type WaitlistRefusal = typeof WAITLIST_FULL | typeof NO_WAITLIST;

/**
 * The marker on the desk walk-in's refusal when the row was entered but its confirmation, a
 * moment later and in a transaction of its own, found the last place and the last slot in the
 * line gone (§348). Unlike the two above, something *was* written — an unconfirmed row, and the
 * audit entry that says who entered it — so the desk is told that, not "nothing changed".
 */
export const WALK_IN_LEFT_UNCONFIRMED = "walkInLeftUnconfirmed";

/**
 * The one refusal every door gives when a registration would join a full waiting list: the
 * public form, the email confirmation, a restart, a staff entry, the desk, a batch of test rows.
 *
 * `VALIDATION_ERROR`, like the throttle's refusal, rather than a code of its own: every boundary
 * already turns that code into a sentence, and the marker says which one. The message's prefix
 * is for the logs; nothing renders it.
 */
export function waitlistFullError(waitlistCapacity: number | null): DomainError {
  const marker: WaitlistRefusal = waitlistCapacity === 0 ? NO_WAITLIST : WAITLIST_FULL;
  return new DomainError(
    "VALIDATION_ERROR",
    waitlistCapacity === 0
      ? "WAITLIST_FULL: the event is full and takes no waiting list"
      : `WAITLIST_FULL: the event is full and its waiting list holds its limit of ${waitlistCapacity}`,
    [marker],
  );
}

/** Which of the two refusals an error is, or null for any other error — for the pages that say it. */
export function waitlistRefusalOf(error: unknown): WaitlistRefusal | null {
  if (!(error instanceof DomainError) || error.code !== "VALIDATION_ERROR") return null;
  if (error.fields.includes(NO_WAITLIST)) return NO_WAITLIST;
  if (error.fields.includes(WAITLIST_FULL)) return WAITLIST_FULL;
  return null;
}

/**
 * The walk-in's refusal when its row was entered and its confirmation was refused
 * (`WALK_IN_LEFT_UNCONFIRMED`). Not one of the two public refusals — `waitlistRefusalOf` answers
 * null for it — because no public door enters a row and then confirms it in two steps.
 */
export function walkInLeftUnconfirmedError(refused: DomainError): DomainError {
  return new DomainError("VALIDATION_ERROR", `${refused.message} (the walk-in was entered and left unconfirmed)`, [WALK_IN_LEFT_UNCONFIRMED]);
}

/**
 * The backoffice's word for each refusal — `Admin.errors.WAITLIST_FULL` / `NO_WAITLIST`, and
 * `WALK_IN_LEFT_UNCONFIRMED` for the walk-in above — so a volunteer at the desk reads why, rather
 * than the generic "check what you entered" about a form that is correct. Null for any other
 * error, which keeps its own code.
 */
export function waitlistRefusalCode(error: unknown): "WAITLIST_FULL" | "NO_WAITLIST" | "WALK_IN_LEFT_UNCONFIRMED" | null {
  if (error instanceof DomainError && error.code === "VALIDATION_ERROR" && error.fields.includes(WALK_IN_LEFT_UNCONFIRMED)) {
    return "WALK_IN_LEFT_UNCONFIRMED";
  }
  const refusal = waitlistRefusalOf(error);
  return refusal === null ? null : refusal === NO_WAITLIST ? "NO_WAITLIST" : "WAITLIST_FULL";
}

/*
  `OFFER_AFTER_CLOSE` (§615) is retired (§642): «Trimite-i oferta» was its one thrower, and its offer is
  now capped by the start alone, so it is never refused after the close. The automatic offers never
  threw it — after the close they simply make none (`fillAvailableSpots`).
*/

/**
 * The order the queue panel lists the people waiting in (§627; the owner: the club hands places
 * out by hand, in the order the forms were sent): a pure choice over `events.waitlist_auto_offer`,
 * so the panel and its reader cannot disagree about it.
 *
 * - `SUBMITTED` — when the current form was sent: the journey's `formSentAt`, the later of
 *   `submitted_at` and `privacy_acknowledged_at` (a restart rewrites only the second), the criterion
 *   a club that hands places out by hand follows (`waitlist_auto_offer` false).
 * - `LINE` — `waitlisted_at`, when the person joined the line: `lockOldestWaitlisted`'s own order,
 *   the one every automatic offer follows (`waitlist_auto_offer` true), so the panel never shows an
 *   order the allocator will not honour.
 *
 * Display only: the allocator, the capacity formula and every automatic offer keep `waitlisted_at`,
 * and `kind` is in no condition (§30).
 */
export type QueueOrder = "SUBMITTED" | "LINE";

export function queueOrderFor(waitlistAutoOffer: boolean): QueueOrder {
  return waitlistAutoOffer ? "LINE" : "SUBMITTED";
}
