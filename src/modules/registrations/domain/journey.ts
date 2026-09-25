import type { RegistrationStatus } from "@/db/schema/registrations";

/**
 * Where one registration stands, as six steps a person can read (`DECISIONS.md` §145).
 *
 * The owner: "I wanna see as a workflow what step each participant is in, if he signed the
 * declaration, if he checked in and picked up his bib" — and, on the order, "there should be
 * a 'place reserved' first, then declaration signed and then 'place confirmed'". That is the
 * lifecycle of AGENTS.md §10.5 read forwards: the form, the email link, a place held (the
 * club's hold (§377), the participation window, or a waiting-list offer), the declaration, the
 * confirmation, the desk.
 *
 * Pure: one row in, six steps out, no clock and no catalogue. Every word is a key, and the
 * UI (`ui/StaffJourney.tsx`) turns keys into the reader's language; the list and the detail
 * page derive the same journey from the same columns, so they can never disagree about a
 * person.
 *
 * The row is reused on a restart (`db/schema/registrations.ts`: "timestamps are historical
 * facts, not a mirror of the current status"), and nothing is cleared: a confirmation, an
 * offer or a check-in from an earlier cycle stays on the row. `cycleStartedAt` is the one
 * column every restart rewrites (`privacy_acknowledged_at`, set to the moment the form was
 * submitted this time), so a timestamp older than it belongs to an earlier cycle and is read
 * as absent. Within the cycle, the *status* decides how far an active registration has come
 * and the timestamps only date the steps; a terminal row — cancelled or expired — is read
 * from its timestamps, because there the status says where it ended and not how far it got.
 */
export const JOURNEY_STEPS = [
  "submitted",
  "emailVerified",
  "placeHeld",
  "declarationSigned",
  "confirmed",
  "checkedIn",
] as const;

export type JourneyStepKey = (typeof JOURNEY_STEPS)[number];

export type JourneyStepState = "done" | "current" | "pending" | "skipped";

/**
 * What a step has to add beyond its name:
 * - `held`: the place is held until `until` (the hold or the participation window).
 * - `offered`: a waiting-list offer, open until `until`.
 * - `waitlisted`: no place yet — the reservation step is where the person is waiting.
 * - `bib`: the confirmation carries a race number.
 * - `pickedUp`: checked in with a number, which is what "picked up the bib" means here —
 *   there is no separate pickup event: the number is handed over at the desk where the
 *   person is marked present (BR-REQ-037-08), so the check-in is the pickup.
 */
export type JourneyStepDetail = "held" | "offered" | "waitlisted" | "bib" | "pickedUp";

export type JourneyStep = {
  key: JourneyStepKey;
  state: JourneyStepState;
  /** When the step was done, when the row knows; null when it does not. */
  at: Date | null;
  /** A deadline the detail refers to (the hold, the offer). */
  until?: Date | null;
  detail?: JourneyStepDetail;
};

export type JourneyOutcome = "cancelled" | "expired";

export type Journey = {
  steps: readonly JourneyStep[];
  /** Set on a terminal row: the journey ended before, or after, its last step. */
  outcome?: JourneyOutcome;
  outcomeAt?: Date | null;
  /** How many steps are done, out of `JOURNEY_STEPS.length`: the list's "3/6". */
  done: number;
  /** The last step that is done — what the list's cell names, because it is always a fact. */
  reached: JourneyStepKey;
  /** The step the person is at, when there is one. */
  current?: JourneyStepKey;
};

export type JourneyInput = {
  status: RegistrationStatus;
  submittedAt: Date;
  /**
   * `registrations.privacy_acknowledged_at`: rewritten on every restart and set at insert, so
   * it is when the current cycle began. Anything dated before it happened in an earlier one.
   */
  cycleStartedAt: Date;
  /** `participants.email_verified_at`: the participant's own click, on any event. */
  emailVerifiedAt: Date | null;
  /** `registrations.email_confirmed_at`: staff vouched for the address at the desk. */
  emailConfirmedAt: Date | null;
  waitlistedAt: Date | null;
  offerCreatedAt: Date | null;
  holdExpiresAt: Date | null;
  /** The latest declaration acceptance's `accepted_at`, online or on paper; null when none. */
  declarationAcceptedAt: Date | null;
  confirmedAt: Date | null;
  bibNumber: number | null;
  /** The number held before the settle (§214); the journey does not care which column. */
  provisionalBibNumber?: number | null;
  checkedInAt: Date | null;
  cancelledAt: Date | null;
  expiredAt: Date | null;
  expiryReason: string | null;
};

const TOTAL = JOURNEY_STEPS.length;

/** A timestamp of this cycle, or null when it was left behind by an earlier one. */
function inCycle(value: Date | null, input: JourneyInput): Date | null {
  // A restart's own writes share the instant of the marker, so "not before" rather than "after".
  return value !== null && value >= input.cycleStartedAt ? value : null;
}

/** When this cycle's form was submitted: the row's submission, or the restart that reused it. */
function submittedDate(input: JourneyInput): Date {
  return input.cycleStartedAt > input.submittedAt ? input.cycleStartedAt : input.submittedAt;
}

/**
 * When the email step was done for this registration. The participant's own click is one
 * per person, on whichever event came first: an address verified months ago is what let this
 * registration skip the step, so the step is dated at this submission, never before it — the
 * list is read as a chronology. A staff attestation is per registration, and counts only
 * when it was given in this cycle.
 */
function emailDate(input: JourneyInput): Date | null {
  if (input.emailVerifiedAt) {
    const submitted = submittedDate(input);
    return input.emailVerifiedAt < submitted ? submitted : input.emailVerifiedAt;
  }
  return inCycle(input.emailConfirmedAt, input);
}

function bibDetail(input: JourneyInput): JourneyStepDetail | undefined {
  // Either column (§214): the chip says "nr. 42", and before registration closes the 42 is
  // the provisional one. Whether it can still move is the column's business, not the chip's.
  return input.bibNumber !== null || (input.provisionalBibNumber ?? null) !== null ? "bib" : undefined;
}

/**
 * How many steps a *terminal* row reached, read from what this cycle left behind. A ladder,
 * not a lookup: each rung needs the one below it, because a stale deadline or an address
 * verified on another event after this row ended must not lift a row past where it stopped.
 */
function reachedBeforeEnd(input: JourneyInput): number {
  if (input.status === "EXPIRED") {
    // The reason says exactly where it ended (AGENTS.md §10.5), and it is written with the
    // expiry — unlike an old `confirmed_at` a restart may have left on the same row.
    switch (input.expiryReason) {
      case "EMAIL_CONFIRMATION_LAPSED":
        return 1;
      case "EVENT_STARTED":
        return 2;
      case "DECLARATION_HOLD_LAPSED":
      case "WAITLIST_OFFER_LAPSED":
        return 3;
    }
  }
  // The participant may have verified on another event after this row ended at the email
  // step; that click did not move this registration.
  const ended = input.status === "CANCELLED" ? input.cancelledAt : input.expiredAt;
  const verified = ended && input.emailVerifiedAt && input.emailVerifiedAt > ended ? null : emailDate(input);
  if (!verified) return 1;
  if (inCycle(input.checkedInAt, input)) return 6;
  if (inCycle(input.confirmedAt, input)) return 5;
  if (inCycle(input.declarationAcceptedAt, input)) return 4;
  if (inCycle(input.offerCreatedAt, input)) return 3;
  // Waiting, and never offered: no place was held this cycle, whatever deadline an earlier
  // cycle's hold left on the row.
  if (inCycle(input.waitlistedAt, input)) return 2;
  // A direct hold leaves only its deadline, which is after the cycle's start by construction.
  if (inCycle(input.holdExpiresAt, input)) return 3;
  return 2;
}

/** The dates a done step carries, by step. */
function dateOf(step: JourneyStepKey, input: JourneyInput): Date | null {
  switch (step) {
    case "submitted":
      return submittedDate(input);
    case "emailVerified":
      return emailDate(input);
    case "placeHeld":
      // An offer has its own timestamp. A direct hold has none, but it is placed in the same
      // transaction as the email step — `confirmEmail`, the desk's attestation, or a restart
      // of a verified participant — so that step's instant is the hold's too.
      return inCycle(input.offerCreatedAt, input) ?? emailDate(input);
    case "declarationSigned":
      return inCycle(input.declarationAcceptedAt, input) ?? inCycle(input.confirmedAt, input);
    case "confirmed":
      return inCycle(input.confirmedAt, input);
    case "checkedIn":
      return inCycle(input.checkedInAt, input);
  }
}

export function journeyOf(input: JourneyInput): Journey {
  const steps: JourneyStep[] = JOURNEY_STEPS.map((key) => ({ key, state: "pending", at: null }));
  const markDone = (upTo: number) => {
    for (let index = 0; index < upTo; index += 1) {
      steps[index] = { ...steps[index], state: "done", at: dateOf(steps[index].key, input) };
    }
  };
  const markCurrent = (index: number, extra: Partial<JourneyStep> = {}) => {
    steps[index] = { ...steps[index], state: "current", ...extra };
  };

  switch (input.status) {
    case "PENDING_EMAIL_CONFIRMATION":
      markDone(1);
      markCurrent(1);
      break;
    case "WAITLISTED":
      markDone(2);
      markCurrent(2, { detail: "waitlisted", at: inCycle(input.waitlistedAt, input) });
      break;
    case "PENDING_DECLARATION":
      markDone(3);
      steps[2] = { ...steps[2], detail: "held", until: input.holdExpiresAt };
      markCurrent(3);
      break;
    case "WAITLIST_OFFERED":
      markDone(3);
      steps[2] = { ...steps[2], detail: "offered", until: input.holdExpiresAt };
      markCurrent(3);
      break;
    case "CONFIRMED":
      markDone(5);
      steps[4] = { ...steps[4], detail: bibDetail(input) };
      if (inCycle(input.checkedInAt, input)) {
        markDone(6);
        steps[5] = { ...steps[5], detail: input.bibNumber !== null ? "pickedUp" : undefined };
      } else {
        markCurrent(5);
      }
      break;
    case "CANCELLED":
    case "EXPIRED": {
      const reached = reachedBeforeEnd(input);
      markDone(reached);
      for (let index = reached; index < TOTAL; index += 1) {
        steps[index] = { ...steps[index], state: "skipped" };
      }
      if (reached >= 5) steps[4] = { ...steps[4], detail: bibDetail(input) };
      if (reached >= 6) steps[5] = { ...steps[5], detail: input.bibNumber !== null ? "pickedUp" : undefined };
      if (reached === 3 && input.status === "EXPIRED") {
        steps[2] = { ...steps[2], detail: input.expiryReason === "WAITLIST_OFFER_LAPSED" ? "offered" : "held", until: input.holdExpiresAt };
      }
      break;
    }
  }

  const done = steps.filter((step) => step.state === "done").length;
  const current = steps.find((step) => step.state === "current")?.key;
  const journey: Journey = { steps, done, reached: JOURNEY_STEPS[done - 1], current };
  if (input.status === "CANCELLED") {
    journey.outcome = "cancelled";
    journey.outcomeAt = input.cancelledAt;
  } else if (input.status === "EXPIRED") {
    journey.outcome = "expired";
    journey.outcomeAt = input.expiredAt;
  }
  return journey;
}
