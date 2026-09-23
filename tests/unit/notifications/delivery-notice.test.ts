import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { emailDeliveryNotice } from "@/modules/notifications/delivery-notice";
import { EMAIL_DELIVERY_MODES, type EmailDeliveryMode } from "@/shared/config/env-enums";

/**
 * `AGENTS.md` §16.4 — the delivery modes, told to the person about to wait for an email. Two
 * testers registered on QA and waited for a message that was never coming; the rule that only
 * production sends `live` did not bend, the screen did.
 *
 * Titled by the rule it reads, not by BR-REQ-080-03: that requirement states the modes and the
 * startup refusal (`notifications/modes.test.ts`) and none of its criteria names a notice to the
 * participant, so a suite carrying its number would claim a coverage it does not ask for. The
 * criterion belongs to the docs pass that records this screen.
 *
 * Pure: the helper is handed the environment, so all three modes are stated here without
 * booting one, and the two keys it can return are checked against both catalogues — the page
 * renders `t(key)` with a variable, which the static i18n check cannot see.
 */
describe("AGENTS.md §16.4 the email delivery notice", () => {
  const listed = ["tester@example.org"];

  it("says nothing on production, where the mode is live", () => {
    expect(emailDeliveryNotice({ EMAIL_DELIVERY_MODE: "live", EMAIL_ALLOWLIST: [] })).toBeNull();
  });

  it("names the capture mode a laptop and the test run are in", () => {
    expect(emailDeliveryNotice({ EMAIL_DELIVERY_MODE: "capture", EMAIL_ALLOWLIST: [] })).toBe("deliveryNotice.capture");
  });

  it("names an allowlist of addresses: only those receive mail", () => {
    expect(emailDeliveryNotice({ EMAIL_DELIVERY_MODE: "allowlist", EMAIL_ALLOWLIST: listed })).toBe("deliveryNotice.allowlist");
  });

  // §307: QA sends through the club's domain with the star of §163, so the mail is real — the
  // old "you will receive nothing" would have told a tester to stop waiting for a message that
  // was already in their inbox.
  it("says the mail is real, the registration is not, when the allowlist carries the star", () => {
    expect(emailDeliveryNotice({ EMAIL_DELIVERY_MODE: "allowlist", EMAIL_ALLOWLIST: ["*"] })).toBe("deliveryNotice.everyone");
    expect(emailDeliveryNotice({ EMAIL_DELIVERY_MODE: "allowlist", EMAIL_ALLOWLIST: [...listed, "*"] })).toBe("deliveryNotice.everyone");
  });

  it("returns a key that resolves in both catalogues for every mode that is not live", () => {
    const registration = (messages: unknown) =>
      (messages as { Registration: { deliveryNotice: Record<string, string> } }).Registration.deliveryNotice;
    const cases: { mode: EmailDeliveryMode; list: string[] }[] = EMAIL_DELIVERY_MODES.flatMap((mode): { mode: EmailDeliveryMode; list: string[] }[] =>
      mode === "allowlist" ? [{ mode, list: listed }, { mode, list: ["*"] }] : [{ mode, list: [] }],
    );
    for (const { mode, list } of cases) {
      const key = emailDeliveryNotice({ EMAIL_DELIVERY_MODE: mode, EMAIL_ALLOWLIST: list });
      if (mode === "live") {
        expect(key).toBeNull();
        continue;
      }
      expect(key, `a key for ${mode}`).not.toBeNull();
      const leaf = (key as string).replace(/^deliveryNotice\./, "");
      expect(registration(ro)[leaf], `ro copy for ${mode}`).toBeTruthy();
      expect(registration(en)[leaf], `en copy for ${mode}`).toBeTruthy();
    }
  });
});
