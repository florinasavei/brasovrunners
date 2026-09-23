import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { emailDeliveryNotice } from "@/modules/notifications/delivery-notice";
import { EMAIL_DELIVERY_MODES } from "@/shared/config/env-enums";

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
  it("says nothing on production, where the mode is live", () => {
    expect(emailDeliveryNotice({ EMAIL_DELIVERY_MODE: "live" })).toBeNull();
  });

  it("names the capture mode a laptop and the test run are in", () => {
    expect(emailDeliveryNotice({ EMAIL_DELIVERY_MODE: "capture" })).toBe("deliveryNotice.capture");
  });

  it("names the allowlist mode QA is in", () => {
    expect(emailDeliveryNotice({ EMAIL_DELIVERY_MODE: "allowlist" })).toBe("deliveryNotice.allowlist");
  });

  it("returns a key that resolves in both catalogues for every mode that is not live", () => {
    const registration = (messages: unknown) =>
      (messages as { Registration: { deliveryNotice: Record<string, string> } }).Registration.deliveryNotice;
    for (const mode of EMAIL_DELIVERY_MODES) {
      const key = emailDeliveryNotice({ EMAIL_DELIVERY_MODE: mode });
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
