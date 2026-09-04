/**
 * The capacity formula of AGENTS.md §10.6, as pure functions over counts a caller has already
 * queried. No database access here: the concurrency test asserts this arithmetic directly, and
 * separately asserts that the transaction around it holds under real concurrent load — two
 * different properties, two different kinds of test.
 */

export type OccupiedCounts = {
  confirmed: number;
  /** PENDING_DECLARATION rows whose hold_expires_at is still in the future. */
  unexpiredPendingDeclarationHolds: number;
  /** WAITLIST_OFFERED rows whose hold_expires_at is still in the future. */
  unexpiredWaitlistOfferedHolds: number;
};

export function computeOccupied(counts: OccupiedCounts): number {
  return (
    counts.confirmed + counts.unexpiredPendingDeclarationHolds + counts.unexpiredWaitlistOfferedHolds
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
