import { DomainError } from "@/shared/errors/domain-error";

/**
 * The capacity formula of AGENTS.md §10.6, as pure functions over counts a caller has already
 * queried. No database access here: the concurrency test asserts this arithmetic directly, and
 * separately asserts that the transaction around it holds under real concurrent load — two
 * different properties, two different kinds of test.
 */

export type OccupiedCounts = {
  confirmed: number;
  /**
   * PENDING_DECLARATION rows, deadline or no deadline: a lapsed hold is kept, and keeps its
   * place, until somebody waits for it or the event starts (`DECISIONS.md` §160).
   */
  pendingDeclarationHolds: number;
  /**
   * WAITLIST_OFFERED rows whose hold_expires_at is still in the future, or whose offer email is
   * still queued (§520): the offer's clock starts when that email leaves, so until then it holds
   * its place whatever the stored deadline says.
   */
  unexpiredWaitlistOfferedHolds: number;
  /**
   * A family's reserved places (§543, amending §446 and §519): `PENDING_EMAIL_CONFIRMATION` rows a
   * family sitting reserved when their form was sent, while the reservation's deadline is ahead or
   * the sitting's one email is still queued. A single registration never reserves: it takes its
   * place when the address is confirmed, as before. Optional, so a caller that counts no family
   * reservation (a hand-built count in a test) reads as none.
   */
  familyReservations?: number;
  /**
   * A family sitting's holds for forms that wrote no registration (§543; §39, AGENTS.md §19.4): a
   * kept form, a person the address already holds, an address at the club's limit — each counted as
   * one reserved place until the sitting's deadline, so the public count drops by one for such a form
   * as it does for a fresh address. Optional, like `familyReservations`.
   */
  familyPlaceHolds?: number;
};

export function computeOccupied(counts: OccupiedCounts): number {
  return (
    counts.confirmed + counts.pendingDeclarationHolds + counts.unexpiredWaitlistOfferedHolds + (counts.familyReservations ?? 0) + (counts.familyPlaceHolds ?? 0)
  );
}

export type AvailabilityInput = {
  /** null means the event is uncapped. */
  capacity: number | null;
  occupied: number;
  /** WAITLISTED rows — they have allocation priority over a later direct registration. */
  eligibleWaitlisted: number;
};

/**
 * The number of places a *new* registrant could receive right now, after active holds and the
 * existing waiting list's priority. `null` for an uncapped event: BR-REQ-034-01 criterion 4
 * says no numeric count is displayed there at all, and `null` is what makes that the type
 * system's problem rather than a magic number a caller could mistake for zero.
 */
export function computePublicAvailability(input: AvailabilityInput): number | null {
  if (input.capacity === null) return null;
  return Math.max(input.capacity - input.occupied - input.eligibleWaitlisted, 0);
}

/** Whether a direct place — as opposed to the waiting list — exists right now. */
export function hasDirectAvailability(input: AvailabilityInput): boolean {
  if (input.capacity === null) return true;
  return input.capacity - input.occupied - input.eligibleWaitlisted > 0;
}

/**
 * `DECISIONS.md` §160: how many lapsed declaration holds a queue actually wants released, given
 * how many have lapsed, how many places the waiting list still wants and how many are free
 * without touching any hold. Never more than have lapsed, never more than the waiting list
 * needs — `repository.ts#lapsedDeclarationHoldsToRelease` releases exactly this many, oldest
 * deadline first.
 *
 * The forecast on «Setări» → «Emailuri» (`/admin/settings/emails`, §516) decides the same question by its own arithmetic instead
 * (`notifications/domain/automatic-sends.ts#nextInLineReleases`: one lapse releases one place while
 * anybody still waits), because at the instant a hold is forecast to lapse the forecast has no
 * "free" count to ask for — nothing has actually lapsed yet for a query to count. The two agree
 * whenever free is 0, which is the case this formula and the forecast both cover: a lapse is only
 * ever released to a queue at all when something is waiting for it.
 */
export function wantedLapsedHoldReleases(input: { lapsed: number; waiting: number; free: number }): number {
  return Math.min(input.lapsed, Math.max(input.waiting - input.free, 0));
}

/**
 * «Dă-i un loc» refused because no place is free (§NNN; §67, BR-REQ-037-07): the allocator's own
 * counts, under the event lock, so the desk reads who holds the places instead of «Verifică datele
 * introduse». Before the close every place that frees up is offered to the head of the queue at
 * once (`fillAvailableSpots`), so while the race is full the press meets this every time — and a
 * place promised to somebody (a declaration to sign, an offer, a family's reservation) is never
 * taken back for it: that would be the overbooking §10.6 forbids. Numbers only, never a name: the
 * counts ride on the redirect's query string.
 */
export const NO_FREE_PLACE = "NO_FREE_PLACE";

export type PlacesTaken = {
  capacity: number;
  confirmed: number;
  declaration: number;
  offered: number;
  family: number;
};

const PLACES_TAKEN_KEYS = ["capacity", "confirmed", "declaration", "offered", "family"] as const satisfies ReadonlyArray<keyof PlacesTaken>;

export class NoFreePlaceError extends DomainError {
  readonly places: PlacesTaken;

  constructor(capacity: number, counts: OccupiedCounts) {
    // VALIDATION_ERROR as before; the marker is what the desk's action turns into its sentence.
    super("VALIDATION_ERROR", "the event is full: no place is free to promote into", [NO_FREE_PLACE]);
    this.name = "NoFreePlaceError";
    this.places = {
      capacity,
      confirmed: counts.confirmed,
      declaration: counts.pendingDeclarationHolds,
      offered: counts.unexpiredWaitlistOfferedHolds,
      family: (counts.familyReservations ?? 0) + (counts.familyPlaceHolds ?? 0),
    };
  }
}

/** The redirect's outcome for that refusal: the code and the five numbers, as strings. */
export function noFreePlaceOutcome(error: unknown): Record<string, string> | null {
  if (!(error instanceof NoFreePlaceError)) return null;
  return { error: NO_FREE_PLACE, ...Object.fromEntries(PLACES_TAKEN_KEYS.map((key) => [key, String(error.places[key])])) };
}

/**
 * The sentence's values, read back from the page's query: whole numbers only (a hand-typed URL
 * says «0», never text of its own), and nothing for any other error.
 */
export function noFreePlaceValues(error: string | undefined, query: Readonly<Record<string, string | string[] | undefined>>): Record<string, string> | undefined {
  if (error !== NO_FREE_PLACE) return undefined;
  return Object.fromEntries(
    PLACES_TAKEN_KEYS.map((key) => {
      const value = query[key];
      return [key, typeof value === "string" && /^\d{1,6}$/.test(value) ? value : "0"];
    }),
  );
}
