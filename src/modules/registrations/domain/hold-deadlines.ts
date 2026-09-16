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

export function computeDeclarationHoldExpiry(params: {
  now: Date;
  registrationClosesAt: Date | null;
  eventStartsAt: Date;
}): Date {
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
