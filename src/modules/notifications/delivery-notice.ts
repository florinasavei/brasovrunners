import type { EmailDeliveryMode } from "@/shared/config/env-enums";

/**
 * What a participant is told about email on an environment that does not deliver it.
 *
 * Two testers registered on QA and waited for a message that was never going to arrive: QA
 * transmits through the allowlist (`AGENTS.md` §16.4, `DECISIONS.md` §37), a laptop captures
 * everything, and the form said "check your email" to both as if it were production. The rule
 * that only production sends `live` is the one email rule that has never bent, so the honest
 * thing is not to bend it but to say it where the person is standing — on the form, before
 * they type, and on the screen that tells them to open an inbox.
 *
 * A key into `Registration.deliveryNotice.*`, or `null` on `live`: production shows nothing,
 * because there is nothing to say. The caller hands in the environment rather than this module
 * reading `process.env` (`AGENTS.md` §7.1), which is also what makes the three modes testable
 * without booting one.
 *
 * `allowlist` stays one notice whether or not the list carries the star of §163. With the star
 * the application transmits to anyone, but QA's sending domain is Mailgun's sandbox, which
 * delivers to its authorized recipients and nobody else — so "only the addresses the club
 * authorized receive mail" is what actually happens either way, and a sentence that changed
 * with the list would have to know the provider's rule to stay true.
 */
export type EmailDeliveryNoticeKey = "deliveryNotice.capture" | "deliveryNotice.allowlist";

export function emailDeliveryNotice(env: { EMAIL_DELIVERY_MODE: EmailDeliveryMode }): EmailDeliveryNoticeKey | null {
  switch (env.EMAIL_DELIVERY_MODE) {
    case "live":
      return null;
    case "capture":
      return "deliveryNotice.capture";
    case "allowlist":
      return "deliveryNotice.allowlist";
  }
}
