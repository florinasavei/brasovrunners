import { describe, expect, it } from "vitest";
import type { RegistrationStatus } from "@/db/schema/registrations";
import { deriveAllowedResendMessageType } from "@/modules/registrations/domain/resend";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/** AGENTS.md §15.8 — "derive allowed message type from state"; "refuse meaningless resend." */
describe("admin resend message derivation", () => {
  const expected: Record<RegistrationStatus, string | null> = {
    PENDING_EMAIL_CONFIRMATION: "VERIFY_REGISTRATION_EMAIL",
    PENDING_DECLARATION: "COMPLETE_DECLARATION",
    // The waiting list's own email (§NNN): where the person stands, read when it is sent.
    WAITLISTED: "WAITLIST_JOINED",
    WAITLIST_OFFERED: "WAITLIST_SPOT_OFFER",
    CONFIRMED: "REGISTRATION_CONFIRMED",
    CANCELLED: "REGISTRATION_STATE_NOTICE",
    EXPIRED: "REGISTRATION_STATE_NOTICE",
  };

  for (const [status, messageType] of Object.entries(expected) as [RegistrationStatus, string | null][]) {
    it(`${status} -> ${messageType ?? "nothing to resend"}`, () => {
      expect(deriveAllowedResendMessageType(status)).toBe(messageType);
    });
  }
});

/**
 * §NNN — the confirmation of «Retrimite emailul» says which email the press sends, one sentence per
 * state, in both languages, so the Administrator knows what leaves before it does.
 */
describe("the resend dialog's words", () => {
  const statuses: RegistrationStatus[] = ["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION", "WAITLISTED", "WAITLIST_OFFERED", "CONFIRMED", "CANCELLED", "EXPIRED"];

  for (const [locale, catalogue] of [["ro", ro], ["en", en]] as const) {
    const words = (catalogue as unknown as { Admin: { confirm: { resendWhat: Record<string, string> } } }).Admin.confirm.resendWhat;

    it(`${locale}: every state has a sentence that names the person and stays under 200 characters`, () => {
      expect(Object.keys(words).sort()).toEqual([...statuses].sort());
      for (const status of statuses) {
        expect(words[status], status).toContain("{name}");
        expect(words[status].length, status).toBeLessThanOrEqual(200);
      }
    });

    it(`${locale}: a link that is minted again says the old one stops working, and the others do not`, () => {
      const stops = (status: string) => /(nu mai merge|stops working)/.test(words[status]);
      for (const status of ["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION", "WAITLIST_OFFERED", "CONFIRMED"]) expect(stops(status), status).toBe(true);
      // The waiting list's email and the state notice carry no link of theirs (the renderer mints none for them).
      for (const status of ["WAITLISTED", "CANCELLED", "EXPIRED"]) expect(stops(status), status).toBe(false);
    });
  }
});
