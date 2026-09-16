import { describe, expect, it } from "vitest";
import type { EmailActionTokenPurpose } from "@/db/schema/email-action-tokens";
import {
  type EvaluatedToken,
  evaluateActionToken,
} from "@/modules/action-tokens/domain/token-state";

/**
 * BR-REQ-036-02 criteria 2 and 3, as pure rules.
 *
 * AGENTS.md §20.2 lists "action token expiry/purpose/scope" as a unit concern. The integration
 * test proves the same rules hold when the database is the one enforcing them; here they can
 * be read as a table.
 */
const NOW = new Date("2026-09-03T10:00:00.000Z");

function token(overrides: Partial<EvaluatedToken> = {}): EvaluatedToken {
  return {
    purpose: "MANAGE_REGISTRATION",
    expiresAt: new Date("2026-09-05T10:00:00.000Z"),
    usedAt: null,
    invalidatedAt: null,
    ...overrides,
  };
}

describe("BR-REQ-036-02 when an action token may be acted on", () => {
  it("accepts a live token used for the purpose it was issued for", () => {
    expect(evaluateActionToken(token(), "MANAGE_REGISTRATION", NOW)).toEqual({ ok: true });
  });

  describe("criterion 2 — a token used for another purpose is rejected", () => {
    const purposes: EmailActionTokenPurpose[] = [
      "VERIFY_REGISTRATION_EMAIL",
      "COMPLETE_DECLARATION",
      "WAITLIST_OFFER",
      "MANAGE_PROFILE",
    ];

    for (const purpose of purposes) {
      it(`rejects a MANAGE_REGISTRATION token presented as ${purpose}`, () => {
        expect(evaluateActionToken(token(), purpose, NOW)).toEqual({
          ok: false,
          code: "TOKEN_INVALID",
          reason: "PURPOSE_MISMATCH",
        });
      });
    }

    it("reports a purpose mismatch before anything else, so nothing confirms the token exists", () => {
      const expiredAndUsedElsewhere = token({
        expiresAt: new Date("2026-09-01T10:00:00.000Z"),
        usedAt: new Date("2026-09-01T09:00:00.000Z"),
      });

      // Not TOKEN_EXPIRED: an attacker replaying a link against the wrong endpoint learns
      // nothing about whether the value is a real token.
      expect(evaluateActionToken(expiredAndUsedElsewhere, "WAITLIST_OFFER", NOW)).toEqual({
        ok: false,
        code: "TOKEN_INVALID",
        reason: "PURPOSE_MISMATCH",
      });
    });
  });

  describe("criterion 3 — expired, used or invalidated is rejected", () => {
    it("rejects a token that has been used", () => {
      expect(
        evaluateActionToken(token({ usedAt: new Date("2026-09-02T10:00:00.000Z") }), "MANAGE_REGISTRATION", NOW),
      ).toEqual({ ok: false, code: "TOKEN_INVALID", reason: "ALREADY_USED" });
    });

    it("rejects a token that a newer one superseded", () => {
      expect(
        evaluateActionToken(
          token({ invalidatedAt: new Date("2026-09-02T10:00:00.000Z") }),
          "MANAGE_REGISTRATION",
          NOW,
        ),
      ).toEqual({ ok: false, code: "TOKEN_INVALID", reason: "INVALIDATED" });
    });

    it("rejects a token past its expiry, with the one code the participant can act on", () => {
      expect(
        evaluateActionToken(
          token({ expiresAt: new Date("2026-09-03T09:59:59.999Z") }),
          "MANAGE_REGISTRATION",
          NOW,
        ),
      ).toEqual({ ok: false, code: "TOKEN_EXPIRED", reason: "EXPIRED" });
    });

    it("treats the expiry instant itself as expired", () => {
      const evaluation = evaluateActionToken(token({ expiresAt: NOW }), "MANAGE_REGISTRATION", NOW);

      expect(evaluation).toEqual({ ok: false, code: "TOKEN_EXPIRED", reason: "EXPIRED" });
    });

    it("accepts a token one millisecond before its expiry", () => {
      const expiresAt = new Date(NOW.getTime() + 1);

      expect(evaluateActionToken(token({ expiresAt }), "MANAGE_REGISTRATION", NOW)).toEqual({
        ok: true,
      });
    });

    it("reports a superseded token as invalidated rather than used", () => {
      const both = token({
        usedAt: new Date("2026-09-02T11:00:00.000Z"),
        invalidatedAt: new Date("2026-09-02T10:00:00.000Z"),
      });

      expect(evaluateActionToken(both, "MANAGE_REGISTRATION", NOW)).toEqual({
        ok: false,
        code: "TOKEN_INVALID",
        reason: "INVALIDATED",
      });
    });

    it("reports a used token as used rather than expired", () => {
      const both = token({
        usedAt: new Date("2026-09-02T11:00:00.000Z"),
        expiresAt: new Date("2026-09-02T12:00:00.000Z"),
      });

      // Both are dead ends; the reason reaches the log, so it should name the thing that
      // happened first from the participant's point of view.
      expect(evaluateActionToken(both, "MANAGE_REGISTRATION", NOW)).toEqual({
        ok: false,
        code: "TOKEN_INVALID",
        reason: "ALREADY_USED",
      });
    });
  });
});
