/**
 * Whether a registration is a club member's, as the backoffice says it (§NNN, amending §650 and §524).
 *
 * - `verified`: the participant's canonical address is one of the club's member accounts — a live
 *   row on «Echipa» (`member-ticks.ts#memberCanonicalEmails`) — whatever the person ticked. Adding the
 *   person to «Echipa» is the verification; removing them ends it from that moment on.
 * - `declared`: the person ticked «Sunt membru al grupului {club}» and no account matches.
 * - `null`: neither. An unticked box is "did not say", never "not a member" (§650).
 *
 * Derived at read time from the tick and the match, never stored: there is nothing to migrate and
 * nothing to keep in sync when an account is added or removed.
 */
export type Membership = "verified" | "declared";

export function membershipOf({ declared, verified }: { declared: boolean; verified: boolean }): Membership | null {
  if (verified) return "verified";
  return declared ? "declared" : null;
}

/** The export's «Club member» cell (CSV and spreadsheet alike): the kind in the export's own words, empty for none. */
export const MEMBERSHIP_EXPORT_WORDS: Record<Membership, string> = {
  verified: "verified",
  declared: "declared",
};
