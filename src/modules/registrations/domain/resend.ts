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
/**
 * The reminder may be resent by hand while the registration is confirmed and the event is
 * still ahead (`DECISIONS.md` §81): after the start there is nothing to remind anybody of.
 */
export function canResendReminder(status: RegistrationStatus, eventStartsAt: Date, now: Date): boolean {
  return status === "CONFIRMED" && eventStartsAt.getTime() > now.getTime();
}

export function deriveAllowedResendMessageType(status: RegistrationStatus): EmailMessageType | null {
  switch (status) {
    case "PENDING_EMAIL_CONFIRMATION":
      return "VERIFY_REGISTRATION_EMAIL";
    case "PENDING_DECLARATION":
      return "COMPLETE_DECLARATION";
    case "WAITLIST_OFFERED":
      return "WAITLIST_SPOT_OFFER";
    case "CONFIRMED":
      // The confirmation itself, not a bare manage link: it carries the manage link *and* the
      // desk code with its QR, which is what "send it again" means the week of the race
      // (`DECISIONS.md` §79). REGISTRATION_MANAGE_LINK stays in the catalogue, unsent.
      return "REGISTRATION_CONFIRMED";
    case "CANCELLED":
    case "EXPIRED":
      return "REGISTRATION_STATE_NOTICE";
    case "WAITLISTED":
      return null;
    default:
      return null;
  }
}
