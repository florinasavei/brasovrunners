import { describe, expect, it } from "vitest";
import type { EmailActionTokenPurpose } from "@/db/schema/email-action-tokens";
import type { RegistrationStatus } from "@/db/schema/registrations";
import type { TokenRejectionReason } from "@/modules/action-tokens/domain/token-state";
import {
  type ActionLinkView,
  describeActionLink,
  mayReportState,
  stepForSpentLink,
} from "@/modules/registrations/domain/link-status";

/**
 * BR-REQ-036-02 — what an email action link says when it cannot open its form.
 *
 * The rule under test is the amendment to AGENTS.md §13.2: one generic invalid-or-expired
 * answer for every refusal *except* `ALREADY_USED` on a registration-scoped purpose, where the
 * page reports the registration's current state instead. The whole matrix is here — purpose ×
 * token state × registration state — because the security half of it is a single boolean and a
 * table is the only way to see that it never opens by accident.
 */
const PURPOSES: readonly EmailActionTokenPurpose[] = [
  "VERIFY_REGISTRATION_EMAIL",
  "COMPLETE_DECLARATION",
  "MANAGE_REGISTRATION",
  "WAITLIST_OFFER",
  "MANAGE_PROFILE",
];

const REASONS: readonly TokenRejectionReason[] = [
  "NOT_FOUND",
  "PURPOSE_MISMATCH",
  "INVALIDATED",
  "ALREADY_USED",
  "EXPIRED",
];

const STATUSES: readonly RegistrationStatus[] = [
  "PENDING_EMAIL_CONFIRMATION",
  "PENDING_DECLARATION",
  "WAITLISTED",
  "WAITLIST_OFFERED",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
];

/** The four purposes a status page may answer for; `MANAGE_PROFILE` is deliberately not one. */
const REGISTRATION_SCOPED: readonly EmailActionTokenPurpose[] = [
  "VERIFY_REGISTRATION_EMAIL",
  "COMPLETE_DECLARATION",
  "MANAGE_REGISTRATION",
  "WAITLIST_OFFER",
];

describe("BR-REQ-036-02 which refusals may report where the person is", () => {
  it("opens for ALREADY_USED on a registration-scoped purpose, and for nothing else", () => {
    const opened: string[] = [];
    for (const purpose of PURPOSES) {
      for (const reason of REASONS) {
        if (mayReportState(purpose, reason)) opened.push(`${purpose}/${reason}`);
      }
    }

    expect(opened.sort()).toEqual(
      REGISTRATION_SCOPED.map((purpose) => `${purpose}/ALREADY_USED`).sort(),
    );
  });

  /**
   * The four reasons that stay generic, each for its own reason (`link-status.ts` argues them):
   * NOT_FOUND has no state to report; PURPOSE_MISMATCH must stay indistinguishable from it;
   * EXPIRED was never used, so nothing was done; INVALIDATED means either "superseded" or
   * "revoked" in one column, and the strict reading wins.
   */
  it.each(["NOT_FOUND", "PURPOSE_MISMATCH", "INVALIDATED", "EXPIRED"] as const)(
    "keeps %s generic for every purpose and every registration state",
    (reason) => {
      for (const purpose of PURPOSES) {
        for (const status of STATUSES) {
          expect(describeActionLink({ purpose, reason, status })).toEqual({ view: "REFUSED" });
        }
      }
    },
  );

  it("keeps a spent MANAGE_PROFILE link generic: its truthful answer is the list the live link opens", () => {
    for (const status of STATUSES) {
      expect(
        describeActionLink({ purpose: "MANAGE_PROFILE", reason: "ALREADY_USED", status }),
      ).toEqual({ view: "REFUSED" });
    }
  });
});

describe("BR-REQ-036-02 what a spent registration link says", () => {
  it("renders the form while the token is live, whatever the registration is doing", () => {
    for (const purpose of PURPOSES) {
      for (const status of [...STATUSES, null]) {
        expect(describeActionLink({ purpose, reason: null, status })).toEqual({ view: "PROCEED" });
      }
    }
  });

  /**
   * The case that started this. A verify token spent at 19:36, the same email opened at 21:37:
   * the registration is waiting for a declaration, and that is what the page must say.
   */
  it("tells a confirmed-but-undeclared participant that the declaration is next", () => {
    expect(
      describeActionLink({
        purpose: "VERIFY_REGISTRATION_EMAIL",
        reason: "ALREADY_USED",
        status: "PENDING_DECLARATION",
      }),
    ).toEqual({ view: "ALREADY_DONE", message: "SIGN_DECLARATION", next: "RESEND" });
  });

  /**
   * The answer comes from the registration, never from which email was pressed. Every
   * registration-scoped purpose lands on the same sentence for the same state — a token says
   * what was true when it was sent, and the page is opened hours later.
   */
  it.each([
    ["PENDING_EMAIL_CONFIRMATION", "CONFIRM_EMAIL", "RESEND"],
    ["PENDING_DECLARATION", "SIGN_DECLARATION", "RESEND"],
    ["WAITLIST_OFFERED", "SIGN_DECLARATION", "RESEND"],
    ["WAITLISTED", "WAITLISTED", "NONE"],
    ["CONFIRMED", "CONFIRMED", "RESEND"],
    ["CANCELLED", "CANCELLED", "REGISTER_AGAIN"],
    ["EXPIRED", "LAPSED", "REGISTER_AGAIN"],
  ] as const)("reports %s the same way for every purpose", (status, message, next) => {
    for (const purpose of REGISTRATION_SCOPED) {
      expect(describeActionLink({ purpose, reason: "ALREADY_USED", status })).toEqual({
        view: "ALREADY_DONE",
        message,
        next,
      } satisfies ActionLinkView);
    }
  });

  /**
   * Nothing waits on a waitlisted participant, so `deriveAllowedResendMessageType` has nothing
   * to send them. Offering "send it again" would show a success message for an email that is
   * never queued — a worse lie than the one this replaces.
   */
  it("offers no resend to somebody who is simply in the queue", () => {
    const view = describeActionLink({
      purpose: "COMPLETE_DECLARATION",
      reason: "ALREADY_USED",
      status: "WAITLISTED",
    });
    expect(view).toMatchObject({ next: "NONE" });
  });

  /**
   * An erased registration (§67) leaves its tokens behind by cascade order or leaves none at
   * all; either way there is no state to report and the generic answer is the honest one.
   */
  it("falls back to the generic refusal when the registration cannot be read", () => {
    for (const purpose of REGISTRATION_SCOPED) {
      expect(describeActionLink({ purpose, reason: "ALREADY_USED", status: null })).toEqual({
        view: "REFUSED",
      });
    }
  });
});

describe("BR-REQ-036-02 the stepper agrees with the sentence beside it", () => {
  it.each([
    ["CONFIRM_EMAIL", "confirm"],
    ["SIGN_DECLARATION", "declare"],
    ["CONFIRMED", "done"],
  ] as const)("puts %s at the %s step", (message, step) => {
    expect(stepForSpentLink(message)).toBe(step);
  });

  it.each(["CANCELLED", "LAPSED", "WAITLISTED"] as const)("draws no journey for %s", (message) => {
    /*
      WAITLISTED joined these in review (§202). The stepper's last step carries its own
      sentence underneath — "Înscrierea ta este confirmată. Ne vedem la start!" — and somebody
      on the waiting list has no place at all. Saying that to them in the largest text on the
      page is worse than saying nothing, so the stepper says nothing and the message beside it
      says what is true.
    */
    expect(stepForSpentLink(message)).toBeNull();
  });
});
