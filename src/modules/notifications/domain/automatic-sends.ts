import { type Deadlines, reminderHoursFor, reminderOpensAt } from "@/modules/deadlines/domain/deadlines";
import {
  registrationState,
  type RegistrationWindowInput,
} from "@/modules/events/domain/registration-window";
import { confirmationWindow } from "@/modules/registrations/domain/hold-deadlines";

/**
 * When the platform emails a participant on its own (§383; the owner, 2026-09-24: "I need to know
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
  // The number a confirmation before §548 was shown as «provizoriu», told once when it was kept (`bibs.ts#releaseLegacyHeldNumbers`).
  bibs: (registrationId: string) => `registration:${registrationId}:bib-settled`,
  /**
   * The verification email re-sent by itself (§NNN): `n` is how many verification emails the address
   * already got for the event — the attempt this one follows — so each nudge has its own key, a run
   * repeated or overlapping queues nothing twice, and the count only grows.
   */
  confirmationRetry: (registrationId: string, attempt: number) => `registration:${registrationId}:verify-retry:${attempt}`,
} as const;

/** The payload key that marks a verification email the job re-sent by itself (§NNN): the renderer adds its one sentence. */
export const CONFIRMATION_RETRY = "confirmationRetry";

/** Whether a queued row's payload is a verification email the job re-sent by itself. */
export function isConfirmationRetry(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && (payload as Record<string, unknown>)[CONFIRMATION_RETRY] === true;
}

// --- The verification email re-sent by itself (§NNN) -------------------------------------------

const HOUR = 60 * 60_000;

/**
 * The least time the link must still have for a re-sent email to go: an hour. Not a setting — the
 * email states the deadline and the hours left, and one that would say «under an hour» is withdrawn
 * at the send rather than sent (`render.ts`); the plan stops at the same instant.
 */
export const CONFIRMATION_RETRY_LEAST_LEFT_MS = HOUR;

/**
 * At most this many re-sent emails are queued by one run, oldest due first (§NNN): at a launch they
 * would otherwise compete in one batch with the first emails of people registering right now. The
 * rest go at the next run.
 */
export const CONFIRMATION_RETRY_RUN_CAP = 50;

/** A registration still waiting for its address at a scheduled event with internal registration. */
export type ConfirmationRetryCandidate = {
  registrationId: string;
  participantId: string;
  eventId: string;
  /** When its link lapses (`emailLinkLapseSql`): after it, nothing can be confirmed. */
  linkExpiresAt: Date;
  startsAt: Date;
};

/**
 * A participant's own `VERIFY_REGISTRATION_EMAIL` row (never a club copy) for the address and the
 * event of a candidate — the candidate's own, or another person's on the same address, whose link
 * confirms everybody waiting there (§588).
 */
export type VerificationEmailRow = {
  id: string;
  registrationId: string;
  participantId: string;
  eventId: string;
  status: "PENDING" | "PROCESSING" | "SENT" | "FAILED" | "BOUNCED" | "COMPLAINED";
  sentAt: Date | null;
  createdAt: Date;
  /** The email that started its link's deadline (`startsDeadline`, §513): the first of a round. */
  startsDeadline: boolean;
};

export type ConfirmationRetryPlan = {
  registrationId: string;
  participantId: string;
  eventId: string;
  /** How many verification emails the address got for the event: the key's `n` (`AUTOMATIC_SEND_KEYS.confirmationRetry`). */
  attempt: number;
  /** The first instant it is due: the club's hours after the last email the address got for the event. */
  at: Date;
  /** The last instant it may still go: an hour before the link lapses, and before the start. */
  latest: Date;
};

/**
 * Who is owed the verification email once more, and from when to when (§NNN). One formula for the
 * job, its plan (`jobs/next-work.ts`) and the forecast on «Emailuri» (§383); the instant is a
 * question the caller asks (`isConfirmationRetryDue`), never answered here.
 *
 * Nobody, at 0 times. Otherwise, per address and event (one person's link confirms everybody
 * waiting there, §588, so a family gets one email, not one each):
 * - **every** verification email that left (`SENT`) for the address and the event since the email
 *   that started the link's current deadline counts — the first, each one re-sent by the job, the
 *   person's own «Retrimite» and a staff resend — and the plan stands only while that count is under
 *   one plus the club's number: a resend uses up an attempt, and nobody is nudged twice by one;
 * - nothing for the address and the event is waiting to leave (`PENDING`, `PROCESSING`): an email
 *   still queued is no email yet, nobody can have missed it, and a link on its way says it already;
 * - the address never bounced or complained, for any message (`refused`, §76, §83): a nudge to an
 *   address that refused mail harms the sending domain and reaches nobody.
 *
 * It is due the club's hours after the **last** email the address got for the event, and only while
 * the link still has an hour and the event has not started. A plan whose window is empty is left out.
 */
export function planConfirmationRetries(
  candidates: readonly ConfirmationRetryCandidate[],
  rows: readonly VerificationEmailRow[],
  deadlines: Pick<Deadlines, "verificationRetryHours" | "verificationRetries">,
  refused: ReadonlySet<string> = new Set(),
): ConfirmationRetryPlan[] {
  if (deadlines.verificationRetries <= 0) return [];
  const groupOf = (participantId: string, eventId: string) => `${participantId}|${eventId}`;
  const byGroup = new Map<string, VerificationEmailRow[]>();
  for (const row of rows) {
    const key = groupOf(row.participantId, row.eventId);
    byGroup.set(key, [...(byGroup.get(key) ?? []), row]);
  }
  const plans: ConfirmationRetryPlan[] = [];
  for (const candidate of candidates) {
    if (refused.has(candidate.participantId)) continue;
    const group = byGroup.get(groupOf(candidate.participantId, candidate.eventId)) ?? [];
    if (group.some((row) => row.status === "PENDING" || row.status === "PROCESSING")) continue;
    if (group.some((row) => row.status === "BOUNCED" || row.status === "COMPLAINED")) continue;
    const sent = group.filter((row): row is VerificationEmailRow & { sentAt: Date } => row.status === "SENT" && row.sentAt !== null);
    if (sent.length === 0) continue;
    // The round: from the newest email that started a deadline (a restarted registration's first email) on.
    const roundStart = Math.max(
      Number.NEGATIVE_INFINITY,
      ...group.filter((row) => row.startsDeadline).map((row) => (row.sentAt ?? row.createdAt).getTime()),
    );
    const inRound = sent.filter((row) => row.sentAt.getTime() >= roundStart);
    if (inRound.length === 0 || inRound.length >= 1 + deadlines.verificationRetries) continue;
    const lastSent = Math.max(...sent.map((row) => row.sentAt.getTime()));
    const at = lastSent + deadlines.verificationRetryHours * HOUR;
    const latest = Math.min(candidate.linkExpiresAt.getTime() - CONFIRMATION_RETRY_LEAST_LEFT_MS, candidate.startsAt.getTime() - 1);
    if (at > latest) continue;
    plans.push({
      registrationId: candidate.registrationId,
      participantId: candidate.participantId,
      eventId: candidate.eventId,
      // Every email the address ever got for the event, so a restarted round never reuses a key.
      attempt: sent.length,
      at: new Date(at),
      latest: new Date(latest),
    });
  }
  return plans;
}

/** Whether the job, running at `now`, queues this email. */
export function isConfirmationRetryDue(plan: Pick<ConfirmationRetryPlan, "at" | "latest">, now: Date): boolean {
  return plan.at.getTime() <= now.getTime() && now.getTime() <= plan.latest.getTime();
}

/**
 * The plans one run queues: those due at `now`, one per address and event, oldest due first (then by
 * registration), at most `CONFIRMATION_RETRY_RUN_CAP`.
 */
export function dueConfirmationRetries(plans: readonly ConfirmationRetryPlan[], now: Date, cap = CONFIRMATION_RETRY_RUN_CAP): ConfirmationRetryPlan[] {
  return onePerAddress(plans.filter((plan) => isConfirmationRetryDue(plan, now))).slice(0, cap);
}

/** One plan per address and event: the earliest, then by registration — and in that order. */
export function onePerAddress(plans: readonly ConfirmationRetryPlan[]): ConfirmationRetryPlan[] {
  const seen = new Set<string>();
  return [...plans]
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.registrationId.localeCompare(b.registrationId))
    .filter((plan) => {
      const key = `${plan.participantId}|${plan.eventId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

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

export type InterestEvent = RegistrationWindowInput & {
  editorialStatus: string;
  /**
   * «Doar pentru membrii BVR» (§552): the addresses were left on a public page, and the page is the
   * members' alone now — they wait, as for a page taken off the site, and are told if it comes back.
   */
  membersOnly?: boolean;
};

/**
 * What the job does with the addresses left on an event's page, at `now`: `wait` while the window
 * is ahead (or open on a page taken off the site), `announce` once it is open and published, and
 * `drop` when it can no longer open — cancelled, completed, started, closed, another form.
 */
export function interestAction(event: InterestEvent, now: Date): "wait" | "announce" | "drop" {
  const state = registrationState(event, now);
  if (state === "NOT_YET_OPEN") return "wait";
  if (state === "OPEN") return event.editorialStatus === "PUBLISHED" && event.membersOnly !== true ? "announce" : "wait";
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
 *
 * This is a *different* formula from `wantedLapsedHoldReleases` in `registrations/domain/
 * capacity.ts`, which is what the job itself uses (`repository.ts#lapsedDeclarationHoldsToRelease`,
 * oldest deadline first) — that one reads how many places are already free without touching a
 * hold, a count the forecast has no query for at a moment nothing has lapsed yet. `forecast.ts`
 * uses *this* function on the same lapses instead, to know which ones are spoken for before a
 * "last call to sign" row is built for them (`DECISIONS.md` §160). The two agree whenever free is
 * 0, which holds wherever a lapse is released to a queue at all: nobody is offered a place that
 * was already free.
 *
 * These are the *releases*: a lapse the job gives to the queue, which is what spends a person
 * waiting and what keeps a released hold from being owed a last call. Whether the release is also
 * an *offer* — an email — is `nextInLineOffers` below.
 */
export function nextInLineReleases(input: { lapses: Date[]; waiting: number; startsAt: Date; now: Date }): { at: Date; count: number }[] {
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

/**
 * The offers the releases above turn into: only those made while an offer can still live (§420).
 * `fillAvailableSpots` makes no offer once its own deadline — the club's offer window capped by
 * the close and the start (BR-REQ-035-02 criterion 3) — would be born at or behind the run's
 * instant, so a lapse at or after `min(registrationClosesAt, startsAt)` frees the place and emails
 * nobody: the person stays on the waiting list for the desk. The forecast lists what the job sends.
 */
export function nextInLineOffers(input: {
  lapses: Date[];
  waiting: number;
  startsAt: Date;
  registrationClosesAt: Date | null;
  now: Date;
}): { at: Date; count: number }[] {
  const lastOfferBefore = Math.min(input.registrationClosesAt?.getTime() ?? Number.POSITIVE_INFINITY, input.startsAt.getTime());
  return nextInLineReleases(input).filter((release) => release.at.getTime() < lastOfferBefore);
}

