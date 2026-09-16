import type { RegistrationStatus } from "@/db/schema/registrations";

/**
 * The registration state machine of AGENTS.md §10.5, as data rather than conditionals — the
 * same reasoning `staff-identity/domain/roles.ts` gives for its `TRANSITIONS` table: the
 * interesting property is which moves are *absent*. `PENDING_EMAIL_CONFIRMATION` never reaches
 * `CONFIRMED` directly, so nothing is confirmed without a declaration, and a restart from
 * `CANCELLED`/`EXPIRED` never reaches `CONFIRMED` directly either — it always re-enters at
 * `PENDING_EMAIL_CONFIRMATION`, `PENDING_DECLARATION` or `WAITLISTED`, whichever the capacity
 * transaction decides.
 */
type Transition = { from: RegistrationStatus; to: RegistrationStatus };

export const TRANSITIONS: readonly Transition[] = [
  { from: "PENDING_EMAIL_CONFIRMATION", to: "PENDING_DECLARATION" },
  { from: "PENDING_EMAIL_CONFIRMATION", to: "WAITLISTED" },
  { from: "PENDING_EMAIL_CONFIRMATION", to: "EXPIRED" },
  { from: "PENDING_DECLARATION", to: "CONFIRMED" },
  { from: "PENDING_DECLARATION", to: "WAITLISTED" },
  { from: "PENDING_DECLARATION", to: "CANCELLED" },
  { from: "PENDING_DECLARATION", to: "EXPIRED" },
  { from: "WAITLISTED", to: "WAITLIST_OFFERED" },
  { from: "WAITLISTED", to: "CANCELLED" },
  { from: "WAITLIST_OFFERED", to: "CONFIRMED" },
  { from: "WAITLIST_OFFERED", to: "CANCELLED" },
  { from: "WAITLIST_OFFERED", to: "EXPIRED" },
  { from: "WAITLISTED", to: "EXPIRED" },
  { from: "CONFIRMED", to: "CANCELLED" },
  // Restart of a Cancelled/Expired registration. AGENTS.md §10.5: "may never leapfrog an
  // existing waiting list and may never land directly on CONFIRMED" — enforced by these three
  // destinations existing and CONFIRMED not being among them.
  { from: "CANCELLED", to: "PENDING_EMAIL_CONFIRMATION" },
  { from: "CANCELLED", to: "PENDING_DECLARATION" },
  { from: "CANCELLED", to: "WAITLISTED" },
  { from: "EXPIRED", to: "PENDING_EMAIL_CONFIRMATION" },
  { from: "EXPIRED", to: "PENDING_DECLARATION" },
  { from: "EXPIRED", to: "WAITLISTED" },
] as const;

export function canTransition(from: RegistrationStatus, to: RegistrationStatus): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.to === to);
}

/** Every status a guarded UPDATE may originate from to reach `to`. Used as the WHERE clause. */
export function allowedFromStatuses(to: RegistrationStatus): RegistrationStatus[] {
  return TRANSITIONS.filter((t) => t.to === to).map((t) => t.from);
}

/** AGENTS.md §10.6 rule 6: these statuses hold a place or have priority for one. */
export const ACTIVE_STATUSES: readonly RegistrationStatus[] = [
  "PENDING_EMAIL_CONFIRMATION",
  "PENDING_DECLARATION",
  "WAITLISTED",
  "WAITLIST_OFFERED",
  "CONFIRMED",
];

export function isActiveStatus(status: RegistrationStatus): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}
