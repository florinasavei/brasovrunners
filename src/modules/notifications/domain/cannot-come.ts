import type { EmailMessageType } from "@/db/schema/email-outbox";
import type { RegistrationStatus } from "@/db/schema/registrations";
import { ACTIVE_REGISTRATION_STATUSES } from "@/db/schema/registrations";

/**
 * «Nu mai pot ajunge» / "I can't make it any more" in every email about a live registration (§NNN,
 * amending §81 and §419; the owner, 2026-09-29: «în fiecare mail trebuie să fie clar butonul de
 * „Nu mai pot ajunge”»).
 *
 * The messages that carry the button: every one a participant receives, at the registration's own
 * address, while the registration can still be given up — the address to confirm, the declaration
 * to sign, the waiting list and its offer, the confirmation (one person's or a family's), the
 * number, the reminder, the organizer's update notice and message, the manage link, the signed
 * declaration, and the family's links. The rest are after the fact (the cancellations, the
 * thank-you), about nobody's registration (the newsletter, «Anunță-mă», the invitations), to the
 * club (the archive, the club's notice), a declaration that registers nobody (the group run's), the
 * address's own page of every registration («Înscrierile mele», whose one button already lists each
 * person's cancel), or the resend for a cancelled or expired registration, which AGENTS.md §16.3
 * says creates no token.
 *
 * One list, read by the renderer (which mints the link), the template (which draws the button only
 * for these, and never on a club copy, §320) and the preview on «Setări» → «Emailuri»; the render
 * test names every message type against it.
 */
export const CANNOT_COME_MESSAGES: ReadonlySet<EmailMessageType> = new Set<EmailMessageType>([
  "VERIFY_REGISTRATION_EMAIL",
  "COMPLETE_DECLARATION",
  "WAITLIST_JOINED",
  "WAITLIST_SPOT_OFFER",
  "REGISTRATION_CONFIRMED",
  "WAITLIST_OFFER_EXPIRED",
  "REGISTRATION_MANAGE_LINK",
  "EVENT_REMINDER",
  "DECLARATION_SIGNED",
  "BIB_ASSIGNED",
  "EVENT_UPDATE_NOTICE",
  "ORGANIZER_MESSAGE",
  "REGISTER_ANOTHER_PERSON",
]);

/**
 * Whether the button goes on this send (§NNN): a message of the list, to the registration's own
 * address, while the registration is active and its event is still ahead and not cancelled or over.
 * After the start the manage page refuses a participant's cancellation (AGENTS.md §10.5 rule 9), so
 * a button then would promise what the page cannot do.
 */
export function cannotComeApplies(params: {
  messageType: EmailMessageType;
  clubCopy: boolean;
  /** The outbox row's participant: the address the message goes to. */
  recipientParticipantId: string | null;
  registration: { participantId: string; status: RegistrationStatus } | null | undefined;
  event: { startsAt: Date; eventStatus: string } | null | undefined;
  now: Date;
}): boolean {
  const { messageType, clubCopy, recipientParticipantId, registration, event, now } = params;
  if (clubCopy || !CANNOT_COME_MESSAGES.has(messageType)) return false;
  if (!registration || !recipientParticipantId || registration.participantId !== recipientParticipantId) return false;
  if (!ACTIVE_REGISTRATION_STATUSES.includes(registration.status)) return false;
  if (!event || event.eventStatus !== "SCHEDULED") return false;
  return event.startsAt.getTime() > now.getTime();
}

/**
 * The button's glyph (§521: a glyph before the words on every button): the manage page's own
 * cancel glyph (`EventBusy`), rasterised by `scripts/brand-assets.mjs` from `public/brand/email-cannot-come.svg`
 * — many mail clients refuse an SVG — and served from `APP_BASE_URL` like the letterhead (AGENTS.md §8).
 */
export const CANNOT_COME_GLYPH_PATH = "/brand/email-cannot-come.png";

/** Where the button lands: the manage page's own person's cancel, which asks first (§547, §384). */
export function cannotComeUrlOf(manageUrl: string): string {
  return `${manageUrl}#cancel`;
}
