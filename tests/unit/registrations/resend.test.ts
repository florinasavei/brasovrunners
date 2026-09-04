import { describe, expect, it } from "vitest";
import type { RegistrationStatus } from "@/db/schema/registrations";
import { deriveAllowedResendMessageType } from "@/modules/registrations/domain/resend";

/** AGENTS.md §15.8 — "derive allowed message type from state"; "refuse meaningless resend." */
describe("admin resend message derivation", () => {
  const expected: Record<RegistrationStatus, string | null> = {
    PENDING_EMAIL_CONFIRMATION: "VERIFY_REGISTRATION_EMAIL",
    PENDING_DECLARATION: "COMPLETE_DECLARATION",
    WAITLISTED: null,
    WAITLIST_OFFERED: "WAITLIST_SPOT_OFFER",
    CONFIRMED: "REGISTRATION_MANAGE_LINK",
    CANCELLED: "REGISTRATION_STATE_NOTICE",
    EXPIRED: "REGISTRATION_STATE_NOTICE",
  };

  for (const [status, messageType] of Object.entries(expected) as [RegistrationStatus, string | null][]) {
    it(`${status} -> ${messageType ?? "nothing to resend"}`, () => {
      expect(deriveAllowedResendMessageType(status)).toBe(messageType);
    });
  }
});
