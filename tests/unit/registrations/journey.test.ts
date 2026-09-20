import { describe, expect, it } from "vitest";
import { JOURNEY_STEPS, journeyOf, type JourneyInput } from "@/modules/registrations/domain/journey";

/**
 * `DECISIONS.md` §145 — the backoffice shows each registration's journey: six steps derived
 * from the row, the same for the list and the detail page. BR-REQ-037-03 criterion 5.
 */
const T = {
  submitted: new Date("2026-09-01T10:00:00.000Z"),
  verified: new Date("2026-09-01T10:05:00.000Z"),
  waitlisted: new Date("2026-09-01T10:05:01.000Z"),
  offered: new Date("2026-09-02T08:00:00.000Z"),
  holdEnd: new Date("2026-09-03T08:00:00.000Z"),
  signed: new Date("2026-09-02T09:00:00.000Z"),
  checkedIn: new Date("2026-10-11T07:30:00.000Z"),
  ended: new Date("2026-09-05T12:00:00.000Z"),
  // A second cycle on the same row: registered again after the first one ended.
  restarted: new Date("2026-09-10T10:00:00.000Z"),
  restartHoldEnd: new Date("2026-09-10T10:30:00.000Z"),
  endedAgain: new Date("2026-09-10T10:20:00.000Z"),
};

function row(overrides: Partial<JourneyInput> = {}): JourneyInput {
  return {
    status: "PENDING_EMAIL_CONFIRMATION",
    submittedAt: T.submitted,
    cycleStartedAt: T.submitted,
    emailVerifiedAt: null,
    emailConfirmedAt: null,
    waitlistedAt: null,
    offerCreatedAt: null,
    holdExpiresAt: null,
    declarationAcceptedAt: null,
    confirmedAt: null,
    bibNumber: null,
    checkedInAt: null,
    cancelledAt: null,
    expiredAt: null,
    expiryReason: null,
    ...overrides,
  };
}

const states = (input: JourneyInput) => journeyOf(input).steps.map((step) => step.state);

describe("journeyOf — every status", () => {
  it("has six steps in the lifecycle's order", () => {
    expect(JOURNEY_STEPS).toEqual(["submitted", "emailVerified", "placeHeld", "declarationSigned", "confirmed", "checkedIn"]);
    expect(journeyOf(row()).steps.map((step) => step.key)).toEqual([...JOURNEY_STEPS]);
  });

  it("PENDING_EMAIL_CONFIRMATION: submitted, waiting for the email", () => {
    const journey = journeyOf(row());
    expect(states(row())).toEqual(["done", "current", "pending", "pending", "pending", "pending"]);
    expect(journey.steps[0].at).toEqual(T.submitted);
    expect(journey.done).toBe(1);
    expect(journey.current).toBe("emailVerified");
    expect(journey.outcome).toBeUndefined();
  });

  it("PENDING_DECLARATION: the place is held until the deadline, the declaration is owed", () => {
    const journey = journeyOf(row({ status: "PENDING_DECLARATION", emailVerifiedAt: T.verified, holdExpiresAt: T.holdEnd }));
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "done", "current", "pending", "pending"]);
    expect(journey.steps[1].at).toEqual(T.verified);
    // A direct hold is placed in the same transaction as the email step, so it is dated with it.
    expect(journey.steps[2]).toMatchObject({ detail: "held", at: T.verified, until: T.holdEnd });
    expect(journey.done).toBe(3);
    expect(journey.current).toBe("declarationSigned");
  });

  it("a participant verified on an earlier event: the email step is dated at this submission", () => {
    // `participants.email_verified_at` is one click per person, months before this form; the
    // list is a chronology and the second step cannot predate the first.
    const earlier = new Date("2026-03-03T09:00:00.000Z");
    const journey = journeyOf(row({ status: "PENDING_DECLARATION", emailVerifiedAt: earlier, holdExpiresAt: T.holdEnd }));
    expect(journey.steps[0].at).toEqual(T.submitted);
    expect(journey.steps[1].at).toEqual(T.submitted);
    expect(journey.steps[2].at).toEqual(T.submitted);
  });

  it("PENDING_DECLARATION vouched at the desk: the staff attestation dates the email step", () => {
    const journey = journeyOf(row({ status: "PENDING_DECLARATION", emailConfirmedAt: T.verified, holdExpiresAt: T.holdEnd }));
    expect(journey.steps[1]).toMatchObject({ state: "done", at: T.verified });
  });

  it("WAITLISTED: the reservation step is where they wait, nothing after it moves", () => {
    const journey = journeyOf(row({ status: "WAITLISTED", emailVerifiedAt: T.verified, waitlistedAt: T.waitlisted }));
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "current", "pending", "pending", "pending"]);
    expect(journey.steps[2]).toMatchObject({ detail: "waitlisted", at: T.waitlisted });
    expect(journey.done).toBe(2);
    expect(journey.current).toBe("placeHeld");
  });

  it("WAITLIST_OFFERED: the offer is the reservation, open until its deadline", () => {
    const journey = journeyOf(
      row({ status: "WAITLIST_OFFERED", emailVerifiedAt: T.verified, waitlistedAt: T.waitlisted, offerCreatedAt: T.offered, holdExpiresAt: T.holdEnd }),
    );
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "done", "current", "pending", "pending"]);
    expect(journey.steps[2]).toMatchObject({ detail: "offered", at: T.offered, until: T.holdEnd });
    expect(journey.current).toBe("declarationSigned");
  });

  it("CONFIRMED without a number: five done, the desk is next", () => {
    const journey = journeyOf(
      row({ status: "CONFIRMED", emailVerifiedAt: T.verified, declarationAcceptedAt: T.signed, confirmedAt: T.signed }),
    );
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "done", "done", "done", "current"]);
    expect(journey.steps[3].at).toEqual(T.signed);
    expect(journey.steps[4]).toMatchObject({ at: T.signed });
    expect(journey.steps[4].detail).toBeUndefined();
    expect(journey.done).toBe(5);
    expect(journey.reached).toBe("confirmed");
    expect(journey.current).toBe("checkedIn");
  });

  it("names the last done step, never the one being waited on", () => {
    // The list's cell prints `reached` after the count: "3/6 · Loc rezervat" on a row that is
    // waiting for the declaration — never "Declarație semnată", which would say the opposite.
    const waiting = journeyOf(row({ status: "PENDING_DECLARATION", emailVerifiedAt: T.verified, holdExpiresAt: T.holdEnd }));
    expect(waiting.reached).toBe("placeHeld");
    expect(waiting.reached).not.toBe(waiting.current);
    const waitlisted = journeyOf(row({ status: "WAITLISTED", emailVerifiedAt: T.verified, waitlistedAt: T.waitlisted }));
    expect(waitlisted.reached).toBe("emailVerified");
    const submitted = journeyOf(row());
    expect(submitted.reached).toBe("submitted");
  });

  it("CONFIRMED with a number: the confirmation carries the bib", () => {
    const journey = journeyOf(
      row({ status: "CONFIRMED", emailVerifiedAt: T.verified, declarationAcceptedAt: T.signed, confirmedAt: T.signed, bibNumber: 42 }),
    );
    expect(journey.steps[4]).toMatchObject({ state: "done", detail: "bib" });
  });

  it("CONFIRMED and checked in with a number: present, and the bib was picked up", () => {
    const journey = journeyOf(
      row({ status: "CONFIRMED", emailVerifiedAt: T.verified, declarationAcceptedAt: T.signed, confirmedAt: T.signed, bibNumber: 42, checkedInAt: T.checkedIn }),
    );
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "done", "done", "done", "done"]);
    expect(journey.steps[5]).toMatchObject({ at: T.checkedIn, detail: "pickedUp" });
    expect(journey.done).toBe(6);
    expect(journey.reached).toBe("checkedIn");
    expect(journey.current).toBeUndefined();
  });

  it("CONFIRMED and checked in without a number: present, nothing to pick up", () => {
    const journey = journeyOf(
      row({ status: "CONFIRMED", emailVerifiedAt: T.verified, declarationAcceptedAt: T.signed, confirmedAt: T.signed, checkedInAt: T.checkedIn }),
    );
    expect(journey.steps[5]).toMatchObject({ state: "done", at: T.checkedIn });
    expect(journey.steps[5].detail).toBeUndefined();
  });

  it("a declaration signed on paper at the desk counts exactly like an online one", () => {
    // The desk's paper acceptance is a declaration_acceptances row too (BR-REQ-037-07); the
    // journey reads the acceptance, not the method.
    const journey = journeyOf(row({ status: "CONFIRMED", emailConfirmedAt: T.verified, declarationAcceptedAt: T.signed, confirmedAt: T.signed }));
    expect(journey.steps[3]).toMatchObject({ state: "done", at: T.signed });
  });
});

describe("journeyOf — the terminal branches", () => {
  it("CANCELLED from the hold: three done, the rest skipped, cancelled at the date", () => {
    const journey = journeyOf(
      row({ status: "CANCELLED", emailVerifiedAt: T.verified, holdExpiresAt: T.holdEnd, cancelledAt: T.ended }),
    );
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "done", "skipped", "skipped", "skipped"]);
    expect(journey.outcome).toBe("cancelled");
    expect(journey.outcomeAt).toEqual(T.ended);
    expect(journey.done).toBe(3);
    expect(journey.current).toBeUndefined();
  });

  it("CANCELLED from the waiting list: two done, no place was ever held", () => {
    const journey = journeyOf(
      row({ status: "CANCELLED", emailVerifiedAt: T.verified, waitlistedAt: T.waitlisted, cancelledAt: T.ended }),
    );
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "skipped", "skipped", "skipped", "skipped"]);
  });

  it("CANCELLED after confirmation: five done, the desk skipped, the bib still named", () => {
    const journey = journeyOf(
      row({ status: "CANCELLED", emailVerifiedAt: T.verified, declarationAcceptedAt: T.signed, confirmedAt: T.signed, bibNumber: 7, cancelledAt: T.ended }),
    );
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "done", "done", "done", "skipped"]);
    expect(journey.steps[4].detail).toBe("bib");
    expect(journey.outcome).toBe("cancelled");
  });

  it("CANCELLED after check-in: every step stays done, and the outcome is still cancelled", () => {
    const journey = journeyOf(
      row({ status: "CANCELLED", emailVerifiedAt: T.verified, declarationAcceptedAt: T.signed, confirmedAt: T.signed, bibNumber: 7, checkedInAt: T.checkedIn, cancelledAt: T.ended }),
    );
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "done", "done", "done", "done"]);
    expect(journey.steps[5].detail).toBe("pickedUp");
    expect(journey.done).toBe(6);
    expect(journey.outcome).toBe("cancelled");
    expect(journey.outcomeAt).toEqual(T.ended);
  });

  it("EXPIRED because the email link lapsed: only the submission is done", () => {
    const journey = journeyOf(row({ status: "EXPIRED", expiredAt: T.ended, expiryReason: "EMAIL_CONFIRMATION_LAPSED" }));
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "skipped", "skipped", "skipped", "skipped", "skipped"]);
    expect(journey.outcome).toBe("expired");
    expect(journey.outcomeAt).toEqual(T.ended);
  });

  it("EXPIRED because the hold lapsed: the reservation is where it ended", () => {
    const journey = journeyOf(
      row({ status: "EXPIRED", emailVerifiedAt: T.verified, holdExpiresAt: T.holdEnd, expiredAt: T.holdEnd, expiryReason: "DECLARATION_HOLD_LAPSED" }),
    );
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "done", "skipped", "skipped", "skipped"]);
    expect(journey.steps[2]).toMatchObject({ detail: "held", until: T.holdEnd });
  });

  it("EXPIRED because the offer lapsed: the offer is where it ended", () => {
    const journey = journeyOf(
      row({ status: "EXPIRED", emailVerifiedAt: T.verified, waitlistedAt: T.waitlisted, offerCreatedAt: T.offered, holdExpiresAt: T.holdEnd, expiredAt: T.holdEnd, expiryReason: "WAITLIST_OFFER_LAPSED" }),
    );
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "done", "skipped", "skipped", "skipped"]);
    expect(journey.steps[2]).toMatchObject({ detail: "offered", at: T.offered, until: T.holdEnd });
  });

  it("EXPIRED because the event started while waitlisted: no place was held", () => {
    const journey = journeyOf(
      row({ status: "EXPIRED", emailVerifiedAt: T.verified, waitlistedAt: T.waitlisted, expiredAt: T.ended, expiryReason: "EVENT_STARTED" }),
    );
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "skipped", "skipped", "skipped", "skipped"]);
  });

  it("the expiry reason wins over a confirmation an earlier restart left on the row", () => {
    // The same row is reused when somebody registers again (unique event × participant):
    // confirmed once, cancelled, re-registered, and this time the hold lapsed.
    const journey = journeyOf(
      row({ status: "EXPIRED", emailVerifiedAt: T.verified, confirmedAt: T.signed, holdExpiresAt: T.holdEnd, expiredAt: T.holdEnd, expiryReason: "DECLARATION_HOLD_LAPSED" }),
    );
    expect(journey.done).toBe(3);
  });

  it("an active status ignores the timestamps a restart left behind", () => {
    // Confirmed once, cancelled, registered again: the row is back at the hold, and the old
    // confirmation must not show the declaration as signed.
    const journey = journeyOf(
      row({ status: "PENDING_DECLARATION", emailVerifiedAt: T.verified, confirmedAt: T.signed, cancelledAt: T.ended, holdExpiresAt: T.holdEnd }),
    );
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "done", "current", "pending", "pending"]);
    expect(journey.outcome).toBeUndefined();
  });
});

describe("journeyOf — a restarted row reads only its current cycle", () => {
  // The row is reused on a restart and nothing on it is cleared; `cycleStartedAt` is the
  // restart's own instant, and every timestamp before it belongs to the cycle that ended.
  const firstCycleConfirmed = {
    emailVerifiedAt: T.verified,
    declarationAcceptedAt: T.signed,
    confirmedAt: T.signed,
    bibNumber: 42,
    cancelledAt: T.ended,
  };

  it("CANCELLED from the waiting list after an earlier confirmed cycle: two done, no bib", () => {
    const journey = journeyOf(
      row({
        ...firstCycleConfirmed,
        status: "CANCELLED",
        cycleStartedAt: T.restarted,
        waitlistedAt: T.restarted,
        cancelledAt: T.endedAgain,
      }),
    );
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "skipped", "skipped", "skipped", "skipped"]);
    expect(journey.done).toBe(2);
    expect(journey.steps[4].detail).toBeUndefined();
    expect(journey.outcomeAt).toEqual(T.endedAgain);
  });

  it("CANCELLED from the waiting list while an earlier cycle's hold deadline is still ahead: two done", () => {
    // Held, cancelled and registered again inside one participation window (§104): the old
    // deadline outlives the restart, but a waiting-list entry holds no place.
    const journey = journeyOf(
      row({
        status: "CANCELLED",
        emailVerifiedAt: T.verified,
        holdExpiresAt: new Date("2026-09-20T10:00:00.000Z"),
        cycleStartedAt: T.restarted,
        waitlistedAt: T.restarted,
        cancelledAt: T.endedAgain,
      }),
    );
    expect(journey.done).toBe(2);
  });

  it("CANCELLED from this cycle's hold after an earlier confirmed cycle: three done", () => {
    const journey = journeyOf(
      row({
        ...firstCycleConfirmed,
        status: "CANCELLED",
        cycleStartedAt: T.restarted,
        holdExpiresAt: T.restartHoldEnd,
        cancelledAt: T.endedAgain,
      }),
    );
    expect(journey.done).toBe(3);
    expect(journey.steps[2].at).toEqual(T.restarted);
  });

  it("CANCELLED before the email link, after a cycle the desk had vouched for: one done", () => {
    // Staff attested the address on the first cycle (per registration, not per participant);
    // the restart went back to the email step and was cancelled there.
    const journey = journeyOf(
      row({
        status: "CANCELLED",
        emailConfirmedAt: T.verified,
        holdExpiresAt: new Date("2026-09-20T10:00:00.000Z"),
        cancelledAt: T.endedAgain,
        cycleStartedAt: T.restarted,
      }),
    );
    expect(journey.done).toBe(1);
  });

  it("a click on another event after this row ended at the email step does not move it", () => {
    const journey = journeyOf(
      row({ status: "CANCELLED", cancelledAt: T.ended, emailVerifiedAt: new Date("2026-09-06T12:00:00.000Z") }),
    );
    expect(journey.done).toBe(1);
  });

  it("an earlier cycle's offer does not date this cycle's direct hold", () => {
    // Waitlisted, offered, declined; registered again and held directly this time.
    const journey = journeyOf(
      row({
        status: "PENDING_DECLARATION",
        emailVerifiedAt: T.verified,
        waitlistedAt: T.waitlisted,
        offerCreatedAt: T.offered,
        cancelledAt: T.ended,
        cycleStartedAt: T.restarted,
        holdExpiresAt: T.restartHoldEnd,
      }),
    );
    expect(journey.steps[2]).toMatchObject({ state: "done", detail: "held", at: T.restarted, until: T.restartHoldEnd });
  });

  it("a restart dates the submission at the restart, and an old check-in is not this cycle's", () => {
    const journey = journeyOf(
      row({
        ...firstCycleConfirmed,
        status: "CONFIRMED",
        checkedInAt: T.ended,
        cycleStartedAt: T.restarted,
        declarationAcceptedAt: T.restarted,
        confirmedAt: T.restarted,
      }),
    );
    expect(journey.steps[0].at).toEqual(T.restarted);
    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "done", "done", "done", "current"]);
    expect(journey.steps[3].at).toEqual(T.restarted);
  });
});
