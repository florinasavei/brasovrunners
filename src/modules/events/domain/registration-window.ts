/**
 * When registration is open for an event.
 *
 * Pure, and takes `now` as an argument rather than reading the clock. AGENTS.md §1.5 requires
 * that of every time-dependent rule: a function that calls `new Date()` internally cannot be
 * tested for the boundary cases that matter, and those boundaries are where this will be wrong.
 */

export type RegistrationMode = "NONE" | "INTERNAL" | "EXTERNAL";

export type RegistrationWindowInput = {
  registrationMode: RegistrationMode;
  eventStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  startsAt: Date;
  registrationOpensAt: Date | null;
  /** BR-REQ-011-01 criterion 3: absent means registration closes when the event starts. */
  registrationClosesAt: Date | null;
  /** The moment this locale's translation was published, or null while it is a draft. */
  publishedAt: Date | null;
};

export type RegistrationState =
  | "NOT_APPLICABLE"
  | "EXTERNAL"
  | "NOT_YET_OPEN"
  | "OPEN"
  | "CLOSED"
  | "EVENT_CANCELLED";

export function registrationState(event: RegistrationWindowInput, now: Date): RegistrationState {
  // A cancelled or completed event never accepts registration, whatever the window says
  // (AGENTS.md §10.1, BR-REQ-020-01 criterion 3). Checked first so a cancelled event does not
  // advertise an open window.
  if (event.eventStatus !== "SCHEDULED") return "EVENT_CANCELLED";

  if (event.registrationMode === "NONE") return "NOT_APPLICABLE";
  if (event.registrationMode === "EXTERNAL") return "EXTERNAL";

  // BR-REQ-011-01 criterion 4: absent opening means registration opens when the event is
  // published in this locale. An unpublished translation has no public page at all, so this
  // only matters for the brief window between publication and the event.
  const opensAt = event.registrationOpensAt ?? event.publishedAt;
  if (opensAt && now < opensAt) return "NOT_YET_OPEN";

  // BR-REQ-011-01 criterion 3: absent closing means the event start.
  const closesAt = event.registrationClosesAt ?? event.startsAt;
  if (now >= closesAt) return "CLOSED";

  return "OPEN";
}
