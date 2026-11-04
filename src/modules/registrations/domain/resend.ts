import type { EmailMessageType } from "@/db/schema/email-outbox";
import type { RegistrationStatus } from "@/db/schema/registrations";
import { type EmailGroup, emailGroupOf } from "@/modules/notifications/domain/email-transport";

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

/**
 * What an Admin resend may send for a given status (AGENTS.md §15.8): "derive allowed message
 * type from state" and "refuse meaningless/unsafe resend." Pure, so the refusal for a status
 * with nothing to resend is a fact about the state machine, not a route's judgment call.
 *
 * `WAITLISTED` resends the message that put the person on the list (§641): there
 * is no link to hand them again, but the email says where they stand and that the club chooses or
 * offers in order (§619, §629), and a person who lost it asks the club for it. Every other
 * message stays the state's own: a declaration link to a confirmed person, or a verification to a
 * waiting one, is refused here (§15.8, "refuse a meaningless resend").
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
      // The confirmation itself, not a bare manage link: it carries the manage link *and* the
      // desk code with its QR, which is what "send it again" means the week of the race
      // (`DECISIONS.md` §79). REGISTRATION_MANAGE_LINK stays in the catalogue, unsent.
      return "REGISTRATION_CONFIRMED";
    case "CANCELLED":
    case "EXPIRED":
      return "REGISTRATION_STATE_NOTICE";
    case "WAITLISTED":
      // Rendered at send time, so it says where the person stands now, not where they stood then (§629).
      return "WAITLIST_JOINED";
    default:
      return null;
  }
}

/**
 * «Retrimite familiei» (§588): which of a family's active registrations the one email is for — the first still to confirm
 * the address (its link confirms them all), else the first with a declaration or an offer to act on (one link signs for
 * all), else the first confirmed (every confirmed person's code in one email); none while everybody waits on the list, which
 * the service refuses. In the order given: the order they registered. Pure, so the service sends for it and the dialog
 * before the press names the same email (`familyResendTypes`).
 */
export function familyResendTarget<R extends { status: RegistrationStatus }>(family: readonly R[]): R | undefined {
  return (
    family.find((row) => row.status === "PENDING_EMAIL_CONFIRMATION") ??
    family.find((row) => row.status === "PENDING_DECLARATION" || row.status === "WAITLIST_OFFERED") ??
    family.find((row) => row.status === "CONFIRMED")
  );
}

/**
 * The email «Retrimite familiei» sends, from the family's states alone (the design «telling the owner about every email a
 * staff press sends», slice 3): what `familyResendTarget` picks, whatever the order — and, where both a declaration and an
 * offer wait and only the order they registered decides, both, as the dialog's «… sau …». `null`: nothing to resend.
 */
export function familyResendTypes(statuses: readonly RegistrationStatus[]): { type: EmailMessageType; or?: EmailMessageType } | null {
  if (statuses.includes("PENDING_EMAIL_CONFIRMATION")) return { type: "VERIFY_REGISTRATION_EMAIL" };
  const declaration = statuses.includes("PENDING_DECLARATION");
  const offer = statuses.includes("WAITLIST_OFFERED");
  if (declaration && offer) return { type: "COMPLETE_DECLARATION", or: "WAITLIST_SPOT_OFFER" };
  if (declaration) return { type: "COMPLETE_DECLARATION" };
  if (offer) return { type: "WAITLIST_SPOT_OFFER" };
  return statuses.includes("CONFIRMED") ? { type: "REGISTRATION_CONFIRMED" } : null;
}

/**
 * The road group of the message a resend sends for this state (§841, the dialog's road line): the
 * links' for an address, a declaration or an offer still to act on, the confirmations' for the rest.
 */
export function resendEmailGroup(status: RegistrationStatus): EmailGroup {
  return emailGroupOf(deriveAllowedResendMessageType(status) ?? "REGISTRATION_STATE_NOTICE", false);
}
