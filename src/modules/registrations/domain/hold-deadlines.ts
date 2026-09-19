/**
 * Hold deadlines (AGENTS.md §10.5, §15.1-§15.3; BR-REQ-033-01 criterion 4, BR-REQ-035-02
 * criterion 3): a hold's natural length, capped at the earlier of registration close or event
 * start — never handed out for longer than registration itself remains meaningful.
 */

/** BR-REQ-033-01 criterion 1: a declaration hold lasts 30 minutes. */
export const DECLARATION_HOLD_MINUTES = 30;

/** BR-REQ-035-02 criterion 2: a waiting-list offer's default deadline is 24 hours. */
export const WAITLIST_OFFER_HOLD_HOURS = 24;

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
 * The participation window of an event (`DECISIONS.md` §104): the confirmation — signing the
 * declaration — is asked a week before the race and owed two days before it, so a free race
 * is confirmed by the people who are still coming rather than by everyone who once clicked.
 *
 * Null when the event has no window: `opensDaysBefore` is zero (switched off), or the two
 * numbers are in the wrong order (a deadline before or at the opening is no window), or the
 * fields are absent — a caller built from a partial row keeps the pilot's thirty minutes.
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
 * When a hold on a place lapses unsigned.
 *
 * Thirty minutes, as in the pilot — unless the event has a participation window that has not
 * opened yet (§104): then the place is the runner's until the window's deadline, and the
 * signature is the confirmation asked a week before. Inside the window, and on an event
 * without one, the thirty minutes stand: the place is scarce now and the person is present.
 * The deadline is not capped by the registration close: registration may close ten days
 * before while the confirmation is owed two days before, and that is the point of the window.
 */
export function computeDeclarationHoldExpiry(params: {
  now: Date;
  registrationClosesAt: Date | null;
  eventStartsAt: Date;
  window?: { opensAt: Date; deadline: Date } | null;
}): Date {
  const window = params.window ?? null;
  if (window && params.now.getTime() < window.opensAt.getTime()) {
    return new Date(Math.min(window.deadline.getTime(), params.eventStartsAt.getTime()));
  }
  return capHoldExpiry({
    naiveExpiresAt: new Date(params.now.getTime() + DECLARATION_HOLD_MINUTES * 60_000),
    registrationClosesAt: params.registrationClosesAt,
    eventStartsAt: params.eventStartsAt,
  });
}

export function computeWaitlistOfferExpiry(params: {
  now: Date;
  registrationClosesAt: Date | null;
  eventStartsAt: Date;
}): Date {
  return capHoldExpiry({
    naiveExpiresAt: new Date(params.now.getTime() + WAITLIST_OFFER_HOLD_HOURS * 60 * 60_000),
    registrationClosesAt: params.registrationClosesAt,
    eventStartsAt: params.eventStartsAt,
  });
}
