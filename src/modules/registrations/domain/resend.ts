import type { EmailMessageType } from "@/db/schema/email-outbox";
import type { RegistrationStatus } from "@/db/schema/registrations";

/**
 * What an Admin resend may send for a given status (AGENTS.md §15.8): "derive allowed message
 * type from state" and "refuse meaningless/unsafe resend." Pure, so the refusal for a status
 * with nothing to resend is a fact about the state machine, not a route's judgment call.
 *
 * `WAITLISTED` has no resend: nothing is waiting on the participant to act — they are simply
 * queued — so there is no link to hand them again.
 */
export function deriveAllowedResendMessageType(status: RegistrationStatus): EmailMessageType | null {
  switch (status) {
    case "PENDING_EMAIL_CONFIRMATION":
      return "VERIFY_REGISTRATION_EMAIL";
    case "PENDING_DECLARATION":
      return "COMPLETE_DECLARATION";
    case "WAITLIST_OFFERED":
      return "WAITLIST_SPOT_OFFER";
    case "CONFIRMED":
      return "REGISTRATION_MANAGE_LINK";
    case "CANCELLED":
    case "EXPIRED":
      return "REGISTRATION_STATE_NOTICE";
    case "WAITLISTED":
      return null;
    default:
      return null;
  }
}
