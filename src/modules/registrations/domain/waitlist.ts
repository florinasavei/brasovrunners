import { DomainError } from "@/shared/errors/domain-error";

/**
 * How long a waiting list may grow (`DECISIONS.md` §NNN; the owner: "for the waiting list, I
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
 * is not counted, the same way `countOccupied` stops counting its place, so no decision here
 * waits for the maintenance job either (§10.6). `kind` appears nowhere: a `TEST` row stands in
 * the line exactly as a real one does (`AGENTS.md` §12.6).
 */

export type WaitlistInput = {
  /** `events.waitlist_capacity`: null is no limit, 0 is no waiting list at all. */
  waitlistCapacity: number | null;
  /** `WAITLISTED` rows — `countEligibleWaitlisted`. */
  waitlisted: number;
  /** `WAITLIST_OFFERED` rows whose deadline is ahead — `OccupiedCounts.unexpiredWaitlistOfferedHolds`. */
  openOffers: number;
};

/** How many people the waiting list is carrying: everybody in the line the queue panel shows. */
export function waitlistLength(input: Pick<WaitlistInput, "waitlisted" | "openOffers">): number {
  return input.waitlisted + input.openOffers;
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
 * The marker a refusal carries when the places are gone and the waiting list is full too — the
 * public form's "Locurile și lista de așteptare sunt pline." Not a field of any form: a rule
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
 * The backoffice's word for each refusal — `Admin.errors.WAITLIST_FULL` / `NO_WAITLIST` — so a
 * volunteer at the desk reads why, rather than the generic "check what you entered" about a
 * form that is correct. Null for any other error, which keeps its own code.
 */
export function waitlistRefusalCode(error: unknown): "WAITLIST_FULL" | "NO_WAITLIST" | null {
  const refusal = waitlistRefusalOf(error);
  return refusal === null ? null : refusal === NO_WAITLIST ? "NO_WAITLIST" : "WAITLIST_FULL";
}
