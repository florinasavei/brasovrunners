/**
 * «Anunță-mă când rămân N locuri» (§NNN; the owner, 2026-11-03: «cumva trebuie să pot controla mai bine»):
 * when an event's free places drop to N or fewer, and again when they reach 0, the Administrators are
 * emailed — each crossing once. Pure: the event's setting, the free places counted under the lock, and
 * what was already sent for the current crossing in; what to send now and what to remember out.
 *
 * - `LOW` — the free places dropped to N or fewer (and are still above 0): «Mai sunt N locuri».
 * - `FULL` — they reached 0: «Toate locurile s-au ocupat». A drop straight from above N to 0 sends this
 *   one alone: it says both.
 * - Re-armed only when the free places climb back **above** N: a place freed and taken again near the
 *   end sends nothing more, so a busy last hour is not a stream of emails. `FULL` stays remembered while
 *   the places are between 1 and N.
 * - The setting off (null) forgets what was sent, so switching it on again starts a fresh crossing.
 *
 * The free places are the capacity less the allocator's occupied count (`computeOccupied`) — the number
 * «Locuri» says first on the registrations page — never below 0.
 */
export type PlacesAlertSent = "LOW" | "FULL";

export const PLACES_ALERT_STAGES = ["LOW", "FULL"] as const satisfies readonly PlacesAlertSent[];

export type PlacesAlertStep = {
  /** The email to queue now, or null. */
  send: PlacesAlertSent | null;
  /** What the event remembers after this check (`events.places_alert_sent`). */
  sent: PlacesAlertSent | null;
};

export function placesAlertStep(input: { alertAt: number | null; free: number; sent: PlacesAlertSent | null }): PlacesAlertStep {
  if (input.alertAt === null) return { send: null, sent: null };
  const free = Math.max(input.free, 0);
  if (free > input.alertAt) return { send: null, sent: null };
  if (free === 0) return input.sent === "FULL" ? { send: null, sent: "FULL" } : { send: "FULL", sent: "FULL" };
  return input.sent === null ? { send: "LOW", sent: "LOW" } : { send: null, sent: input.sent };
}

/** The column's text read back: anything but the two stages is nothing sent. */
export function placesAlertSentOf(value: string | null | undefined): PlacesAlertSent | null {
  return value === "LOW" || value === "FULL" ? value : null;
}
