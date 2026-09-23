import { ALLOW_EVERY_RECIPIENT, type EmailDeliveryMode } from "@/shared/config/env-enums";

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
 * `allowlist` is two notices since 2026-09-23 (`DECISIONS.md` §307). Until then QA sent through
 * Mailgun's sandbox, which delivers to five authorized recipients and nobody else, so "only the
 * addresses the club authorized receive mail" was what happened whether or not the list carried
 * the star of §163. QA now sends through the club's own domain with its own key, and with the star
 * the mail really reaches anyone — tagged `[QA]` in the subject (`QA_SUBJECT_PREFIX`). Telling
 * that person "you will receive nothing" would be the §37 failure in reverse, so the star picks
 * `everyone`: the mail is real, the registration is not. A list without the star keeps the old
 * sentence, which is still exactly true for it.
 */
export type EmailDeliveryNoticeKey = "deliveryNotice.capture" | "deliveryNotice.allowlist" | "deliveryNotice.everyone";

export function emailDeliveryNotice(env: {
  EMAIL_DELIVERY_MODE: EmailDeliveryMode;
  EMAIL_ALLOWLIST: readonly string[];
}): EmailDeliveryNoticeKey | null {
  switch (env.EMAIL_DELIVERY_MODE) {
    case "live":
      return null;
    case "capture":
      return "deliveryNotice.capture";
    case "allowlist":
      return env.EMAIL_ALLOWLIST.includes(ALLOW_EVERY_RECIPIENT) ? "deliveryNotice.everyone" : "deliveryNotice.allowlist";
  }
}
