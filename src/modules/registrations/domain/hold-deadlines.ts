import { declarationHoldEndsAt, type Deadlines, offerEndsAt } from "@/modules/deadlines/domain/deadlines";

/**
 * Hold deadlines (AGENTS.md §10.5, §15.1-§15.3; BR-REQ-033-01 criterion 4, BR-REQ-035-02
 * criterion 3): a hold's natural length, capped at the earlier of registration close or event
 * start — never handed out for longer than registration itself remains meaningful.
 *
 * The natural lengths are the club's (§377, "Termene" on `/admin/emails`): a declaration hold
 * thirty minutes and a waiting-list offer twenty-four hours until an Administrator says
 * otherwise (BR-REQ-033-01 criterion 1, BR-REQ-035-02 criterion 2). Every caller hands in the
 * setting it read; nothing here has a number of its own, so a hold cannot be given a length the
 * club did not choose. The deadline is computed once, when the hold is created, and stored on the
 * row — a later change of the setting never moves it.
 */

export function capHoldExpiry(params: {
  naiveExpiresAt: Date;
  registrationClosesAt: Date | null;
  eventStartsAt: Date;
}): Date {
  const candidates = [params.naiveExpiresAt.getTime(), params.eventStartsAt.getTime()];
  if (params.registrationClosesAt) candidates.push(params.registrationClosesAt.getTime());
  return new Date(Math.min(...candidates));
}

/**
 * An event's participation window when the organizer sets nothing (§104): the confirmation is
 * asked this many days before the start and owed that many. The column defaults
 * (`events.confirmation_opens_days_before`, `events.confirmation_deadline_days_before`) say the
 * same numbers — a unit test holds them together — and the editor and the email preview read these.
 */
export const DEFAULT_CONFIRMATION_OPENS_DAYS = 7;
export const DEFAULT_CONFIRMATION_DEADLINE_DAYS = 2;

/**
 * The participation window of an event (`DECISIONS.md` §104): the confirmation — signing the
 * declaration — is asked a week before the race and owed two days before it, so a free race
 * is confirmed by the people who are still coming rather than by everyone who once clicked.
 *
 * Null when the event has no window: `opensDaysBefore` is zero (switched off), or the two
 * numbers are in the wrong order (a deadline before or at the opening is no window), or the
 * fields are absent — a caller built from a partial row keeps the club's hold (§377).
 */
export function confirmationWindow(event: {
  startsAt: Date;
  confirmationOpensDaysBefore?: number | null;
  confirmationDeadlineDaysBefore?: number | null;
}): { opensAt: Date; deadline: Date } | null {
  const opens = event.confirmationOpensDaysBefore ?? null;
  const deadlineDays = event.confirmationDeadlineDaysBefore ?? null;
  if (opens === null || deadlineDays === null || opens <= 0 || deadlineDays < 0 || opens <= deadlineDays) return null;
  const day = 24 * 60 * 60_000;
  return {
    opensAt: new Date(event.startsAt.getTime() - opens * day),
    deadline: new Date(event.startsAt.getTime() - deadlineDays * day),
  };
}

/**
 * Whether an event's participation window (§104) has opened by `now` — the start is within its
 * `opensDaysBefore` days. False for an event with no window (zero or absent). The declaration
 * email reads it: once the window is open the message is itself the reminder, so it no longer
 * promises one (§377).
 */
export function participationWindowOpen(startsAt: Date, opensDaysBefore: number | null | undefined, now: Date): boolean {
  if (!opensDaysBefore || opensDaysBefore <= 0) return false;
  return now.getTime() >= startsAt.getTime() - opensDaysBefore * 24 * 60 * 60_000;
}

/**
 * When a hold on a place lapses unsigned.
 *
 * The club's declaration hold (§377) — unless the event has a
 * participation window that has not opened yet (§104): then the place is the runner's until the
 * window's deadline, and the signature is the confirmation asked a week before. Inside the
 * window, and on an event without one, the club's minutes stand: the place is scarce now and the
 * person is present. The deadline is not capped by the registration close: registration may
 * close ten days before while the confirmation is owed two days before, and that is the point of
 * the window.
 */
export function computeDeclarationHoldExpiry(params: {
  now: Date;
  registrationClosesAt: Date | null;
  eventStartsAt: Date;
  window?: { opensAt: Date; deadline: Date } | null;
  deadlines: Pick<Deadlines, "holdMinutes">;
}): Date {
  const window = params.window ?? null;
  if (window && params.now.getTime() < window.opensAt.getTime()) {
    return new Date(Math.min(window.deadline.getTime(), params.eventStartsAt.getTime()));
  }
  return capHoldExpiry({
    naiveExpiresAt: declarationHoldEndsAt(params.now, params.deadlines),
    registrationClosesAt: params.registrationClosesAt,
    eventStartsAt: params.eventStartsAt,
  });
}

/** When a waiting-list offer made now lapses: the club's offer window, capped by the close and the start. */
export function computeWaitlistOfferExpiry(params: {
  now: Date;
  registrationClosesAt: Date | null;
  eventStartsAt: Date;
  deadlines: Pick<Deadlines, "offerHours">;
}): Date {
  return capHoldExpiry({
    naiveExpiresAt: offerEndsAt(params.now, params.deadlines),
    registrationClosesAt: params.registrationClosesAt,
    eventStartsAt: params.eventStartsAt,
  });
}
