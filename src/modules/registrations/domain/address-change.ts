import type { EmailMessageType } from "@/db/schema/email-outbox";
import type { RegistrationStatus } from "@/db/schema/registrations";
import { deriveAllowedResendMessageType } from "./resend";

/**
 * «Schimbă adresa» (the owner, 2026-11-11: «aparent nu pot modifica mailul unei persoane???», choosing «Orice adresă,
 * oricând»): an Administrator moves one registration to another address. What is pure about it lives here — the two
 * refusals of its own, which message the new address is sent, how a running deadline is kept, and how the trail tells a
 * signature given after the move. The move itself is `service.ts#changeRegistrationAddressByStaff`.
 */

/** A family form waits on this registration — an open family sitting or a kept form names it. Nothing is written. */
export const ADDRESS_FAMILY_FORM_PENDING = "addressFamilyFormPending";
/** The new address has an open invitation to this event: withdraw it first, or it would be adopted by surprise. */
export const ADDRESS_INVITED = "addressInvited";

/** The least a running hold or offer keeps after a move: a day from the change, so the new address has time to act. */
export const ADDRESS_CHANGE_MIN_REMAINING_MS = 24 * 60 * 60_000;

/**
 * The deadline a hold or an offer keeps on a move (decided for the owner): the one it had, unless less than a day remains
 * — then a day from the change, capped by the event's start. Lengthened only when `mayLengthen`: the caller says no for a
 * counted place while somebody waits for one, so the move never passes over a person on the waiting list. A deadline
 * already passed, or none at all, is kept as it is: the allocator's own rules decide what happens to it.
 */
export function deadlineKeptOnMove(input: {
  holdExpiresAt: Date | null;
  now: Date;
  eventStartsAt: Date;
  mayLengthen: boolean;
}): Date | null {
  const { holdExpiresAt, now, eventStartsAt, mayLengthen } = input;
  if (holdExpiresAt === null || holdExpiresAt.getTime() <= now.getTime()) return holdExpiresAt;
  if (!mayLengthen) return holdExpiresAt;
  const floor = Math.min(now.getTime() + ADDRESS_CHANGE_MIN_REMAINING_MS, eventStartsAt.getTime());
  return floor > holdExpiresAt.getTime() ? new Date(floor) : holdExpiresAt;
}

/**
 * Whether the event is over for the move's emails: cancelled, completed, or past its end (its start when it has no end).
 * Over, the move sends the two notices alone — there is no step left to take from a link.
 */
export function eventOverForMove(event: { eventStatus: string; startsAt: Date; endsAt: Date | null }, now: Date): boolean {
  if (event.eventStatus !== "SCHEDULED") return true;
  return (event.endsAt ?? event.startsAt).getTime() <= now.getTime();
}

/**
 * The state's own message the new address is sent after a move, or null: a verification, the waiting list, the offer, the
 * declaration or the confirmation — never for a cancelled or lapsed registration, nor once the event is over.
 */
export function stateMessageOnMove(status: RegistrationStatus, eventOver: boolean): EmailMessageType | null {
  if (eventOver) return null;
  const message = deriveAllowedResendMessageType(status);
  return message === "REGISTRATION_STATE_NOTICE" ? null : message;
}

/**
 * A declaration signed from an emailed link after the registration's address was set by staff: shown in the trail as
 * signed from the link sent to the address the club changed. Still the person's signature — never a staff one; this only
 * makes the order of the two facts visible, so «no staff-signed declaration» stays checkable.
 */
export function signedAfterStaffAddressChange(
  acceptance: { method: "EMAIL_LINK" | "PAPER"; acceptedAt: Date },
  addressChangedAt: Date | null,
): boolean {
  return acceptance.method === "EMAIL_LINK" && addressChangedAt !== null && acceptance.acceptedAt.getTime() > addressChangedAt.getTime();
}
