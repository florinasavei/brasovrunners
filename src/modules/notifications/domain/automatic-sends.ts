import { type Deadlines, reminderHoursFor, reminderOpensAt } from "@/modules/deadlines/domain/deadlines";
import {
  registrationClosingInstant,
  registrationState,
  type RegistrationWindowInput,
} from "@/modules/events/domain/registration-window";
import { confirmationWindow } from "@/modules/registrations/domain/hold-deadlines";

/**
 * When the platform emails a participant on its own (§NNN; the owner, 2026-09-24: "I need to know
 * each time a participant will be emailed!").
 *
 * The maintenance job decides, at each run, which registrations a message is due for. These are
 * those decisions as pure functions of a registration, its event and an instant — so the job asks
 * "is it due *now*?" and `/admin/emails` asks "*when* will it be due?" of the same formula
 * (`forecast.ts`). A second copy written for the page is how a page ends up promising a reminder
 * the job never sends, so the job calls these too: `event-mail.ts` for the reminder, the last
 * call to sign and the participation confirmation, `interest.ts` for "registration is open",
 * `next-work.ts` for the instant it plans to wake at.
 *
 * Pure and client-safe: no database, no clock. What a query still decides is *state* — confirmed,
 * scheduled, internal — which is the same `where` for the job and the forecast
 * (`event-mail.ts#selectReminderCandidates`, `#selectDeclarationCandidates`).
 */

const DAY = 24 * 60 * 60_000;

/** The one idempotency key per registration and send (§16.1), shared by the job that writes it and the page that looks for it. */
export const AUTOMATIC_SEND_KEYS = {
  reminder: (registrationId: string) => `registration:${registrationId}:reminder`,
  lastCall: (registrationId: string) => `registration:${registrationId}:sign-reminder`,
  participation: (registrationId: string) => `registration:${registrationId}:confirm-participation`,
  bibs: (registrationId: string) => `registration:${registrationId}:bib-settled`,
} as const;

// --- The reminder (§81, §126, §377) ------------------------------------------------------------

export type ReminderCandidate = {
  startsAt: Date;
  /** The event's own lead (`events.reminder_hours_before`): null is the club's, 0 is none. */
  reminderHoursBefore: number | null;
  /** When the registration was confirmed; null on rows older than the column (long ago). */
  confirmedAt: Date | null;
};

/**
 * The first instant a confirmed registration is owed its reminder, or null when it gets none: the
 * event's lead before the start (§377) — or, for somebody confirmed less than a day before that,
 * a day after their confirmation (§126: the confirmation they just got carries the same facts) —
 * as long as that is still before the start.
 */
export function eventReminderDueAt(candidate: ReminderCandidate, deadlines: Pick<Deadlines, "reminderHours">): Date | null {
  const opens = reminderOpensAt(candidate.startsAt, reminderHoursFor(candidate, deadlines));
  if (!opens) return null;
  const at = candidate.confirmedAt ? Math.max(opens.getTime(), candidate.confirmedAt.getTime() + DAY) : opens.getTime();
  return at < candidate.startsAt.getTime() ? new Date(at) : null;
}

/** Whether the job, running at `now`, queues the reminder for this registration. */
export function isEventReminderDue(candidate: ReminderCandidate, now: Date, deadlines: Pick<Deadlines, "reminderHours">): boolean {
  const at = eventReminderDueAt(candidate, deadlines);
  return at !== null && at.getTime() <= now.getTime() && now.getTime() < candidate.startsAt.getTime();
}

// --- The last call to sign (§160, §377) --------------------------------------------------------

export type LastCallCandidate = Pick<ReminderCandidate, "startsAt" | "reminderHoursBefore">;

/** When a registration still owing its signature gets the declaration once more: the reminder's lead; none without a reminder. */
export function declarationLastCallDueAt(candidate: LastCallCandidate, deadlines: Pick<Deadlines, "reminderHours">): Date | null {
  return reminderOpensAt(candidate.startsAt, reminderHoursFor(candidate, deadlines));
}

export function isDeclarationLastCallDue(candidate: LastCallCandidate, now: Date, deadlines: Pick<Deadlines, "reminderHours">): boolean {
  const at = declarationLastCallDueAt(candidate, deadlines);
  return at !== null && at.getTime() <= now.getTime() && now.getTime() < candidate.startsAt.getTime();
}

// --- "Confirm your participation" (§104) -------------------------------------------------------

export type ParticipationCandidate = {
  startsAt: Date;
  confirmationOpensDaysBefore: number | null;
  confirmationDeadlineDaysBefore: number | null;
  holdExpiresAt: Date | null;
};

/**
 * Whether the job, running at `now`, asks this registration again to confirm: the event's window
 * (the allocator's own `confirmationWindow`) is open and its deadline ahead, and the hold is one
 * the window gave — more than a day left. The club's short hold taken inside the window is a
 * person signing right now, not somebody to remind a week later.
 */
export function isParticipationConfirmationDue(candidate: ParticipationCandidate, now: Date): boolean {
  const window = confirmationWindow(candidate);
  if (!window || !candidate.holdExpiresAt) return false;
  const at = now.getTime();
  return at >= window.opensAt.getTime() && at < window.deadline.getTime() && candidate.holdExpiresAt.getTime() - at > DAY;
}

/**
 * The first instant at or after `from` the job asks this registration to confirm, or null. The
 * window's opening — or `from` itself when the window is already open and the ask still owed.
 */
export function participationConfirmationDueAt(candidate: ParticipationCandidate, from: Date): Date | null {
  const window = confirmationWindow(candidate);
  if (!window) return null;
  const at = new Date(Math.max(window.opensAt.getTime(), from.getTime()));
  return isParticipationConfirmationDue(candidate, at) ? at : null;
}

// --- "Registration is open" (§146) --------------------------------------------------------------

export type InterestEvent = RegistrationWindowInput & { editorialStatus: string };

/**
 * What the job does with the addresses left on an event's page, at `now`: `wait` while the window
 * is ahead (or open on a page taken off the site), `announce` once it is open and published, and
 * `drop` when it can no longer open — cancelled, completed, started, closed, another form.
 */
export function interestAction(event: InterestEvent, now: Date): "wait" | "announce" | "drop" {
  const state = registrationState(event, now);
  if (state === "NOT_YET_OPEN") return "wait";
  if (state === "OPEN") return event.editorialStatus === "PUBLISHED" ? "announce" : "wait";
  return "drop";
}

/** The instant the announcement goes: the window's opening, or `from` when it is already owed; null when it will not. */
export function registrationOpenedDueAt(event: InterestEvent, from: Date): Date | null {
  const opensAt = event.registrationOpensAt ?? event.publishedAt;
  const at = new Date(Math.max(opensAt?.getTime() ?? from.getTime(), from.getTime()));
  return interestAction(event, at) === "announce" ? at : null;
}

// --- The offer to the next in line (§160, AGENTS.md §10.5) ---------------------------------------

/**
 * The offers a lapse will make: each hold that lapses before the start — a waiting-list offer at
 * its deadline, a declaration hold at its own — frees one place for the next person waiting, as
 * long as anybody waits (`expireStaleHolds` then `fillAvailableSpots`, both comparing the stored
 * `hold_expires_at` with the run's instant). A lapse already behind is the job's next run, `now`.
 * The lapse of an offer made *then* is not foreseen: whether that person signs is not known.
 */
export function nextInLineOffers(input: { lapses: Date[]; waiting: number; startsAt: Date; now: Date }): { at: Date; count: number }[] {
  const instants = input.lapses
    .map((lapse) => Math.max(lapse.getTime(), input.now.getTime()))
    .filter((at) => at < input.startsAt.getTime())
    .sort((a, b) => a - b);
  const offers: { at: Date; count: number }[] = [];
  let left = input.waiting;
  for (const at of instants) {
    if (left <= 0) break;
    left -= 1;
    const last = offers[offers.length - 1];
    if (last && last.at.getTime() === at) last.count += 1;
    else offers.push({ at: new Date(at), count: 1 });
  }
  return offers;
}

// --- Race numbers settle (§214) -----------------------------------------------------------------

/**
 * The instant an event's numbers settle and "here is your race number" goes — the instant
 * `registrationHasClosed`, which the job asks, turns true.
 */
export const bibsSettleAt = registrationClosingInstant;
