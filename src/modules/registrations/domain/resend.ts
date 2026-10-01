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

/**
 * «Retrimite declarația tuturor care nu au semnat» (§606): only while a declaration can still be
 * signed — the event still on (`signDeclaration` refuses anything but SCHEDULED) and not started (the
 * link lives until the start, §160). A cancelled, finished or started event has nothing to sign.
 */
export function canResendDeclarationToAll(eventStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED", eventStartsAt: Date, now: Date): boolean {
  return eventStatus === "SCHEDULED" && eventStartsAt.getTime() > now.getTime();
}

/**
 * How long after a declaration email was queued or left the bulk press leaves that registration out
 * (§606): a person who has just been sent the link must not get a second one in the same hour.
 */
export const RECENT_DECLARATION_EMAIL_MS = 60 * 60_000;

/** The counts one bulk press reports, for one kind of registration (§606). */
export type BulkResendCounts = { queued: number; skippedRecent: number; skippedLimited: number };

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
