import type { EmailMessageType } from "@/db/schema/email-outbox";
import type { RegistrationStatus } from "@/db/schema/registrations";
import { ACTIVE_REGISTRATION_STATUSES } from "@/db/schema/registrations";

/**
 * «Nu mai pot ajunge» / "I can't make it any more" in every email about a live registration (§558,
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
 * Whether the button goes on this send (§558): a message of the list, to the registration's own
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

/**
 * «Vin» / "I'm coming" (the decision «Cere reconfirmarea»): the states a send that ticked
 * «Cere reconfirmarea» asks — a confirmed registration, one owed its declaration, one waiting. A waiting-list offer is
 * not asked: its own email already asks for the declaration. The send writes an ask only for these (the table of asks,
 * which this module never reads), the renderer draws the button only for these, and the manage page accepts the answer
 * only from these. Answering is optional: nothing reads it but the backoffice and the person's own manage page.
 */
export const RECONFIRM_STATUSES = ["CONFIRMED", "PENDING_DECLARATION", "WAITLISTED"] as const satisfies readonly RegistrationStatus[];

export function isReconfirmStatus(status: RegistrationStatus): boolean {
  return (RECONFIRM_STATUSES as readonly RegistrationStatus[]).includes(status);
}

/**
 * Whether «Vin» goes on this email: an organizer's message whose own row carries the ask's flag (the send sets it only on
 * the rows it wrote an ask for), where «Nu mai pot ajunge» goes too (`cannotComeApplies`: the registration's own address,
 * active, the event still ahead and running), and the registration still in one of `RECONFIRM_STATUSES` when it renders.
 * Never on a club copy.
 */
export function reconfirmApplies(params: Parameters<typeof cannotComeApplies>[0] & { askReconfirm: boolean }): boolean {
  if (!params.askReconfirm || params.messageType !== "ORGANIZER_MESSAGE") return false;
  if (!cannotComeApplies(params)) return false;
  return params.registration ? isReconfirmStatus(params.registration.status) : false;
}

/**
 * «Vin»'s glyph: the manage page's «Da, vin la cursă» glyph (`EventAvailable`) in white on the filled button, rasterised
 * by `scripts/brand-assets.mjs` from `public/brand/email-reconfirm.svg` and served from `APP_BASE_URL`, as the cancel's.
 */
export const RECONFIRM_GLYPH_PATH = "/brand/email-reconfirm.png";

/** Where «Vin» lands: the same manage page, the question at its own person's `#reconfirm` — the same token as the cancel. */
export function reconfirmUrlOf(manageUrl: string): string {
  return `${manageUrl}#reconfirm`;
}
