import type { EmailMessageType } from "@/db/schema/email-outbox";

/**
 * What queued an outbox row: a staff press, or one of the two jobs (the design «telling the owner about every
 * email a staff press sends», 2026-11-03, slice 1).
 *
 * Every press that can queue an email runs inside an email press scope (`../press.ts`), opened with one of these
 * tokens; `enqueueEmail`, the club's copies and the relay stamp it on each row as `email_outbox.cause`. A public
 * flow — the person's own form or link — opens none, and its rows carry no cause («de pe site» on «Emailuri azi»).
 *
 * Each cause names the **main** types it sends to the person the press acts on: the toast after the press tells
 * that email apart from the club's copies and from what reaches other people (an offer to the next in line, a
 * hold lapsing). An empty list is a press that sends the person nothing — an erase, a withdrawal — whose rows,
 * when there are any, are all "others"; a job acts on nobody in particular.
 *
 * Pure, with no server import: the catalogue test reads it, and the words of each cause are
 * `Admin.emails.causes.<area>.<verb>` in both catalogues.
 */
export const PRESS_CAUSES = {
  // «Retrimite emailul» / «Retrimite QR»: the state's own message, whichever it is.
  "registrations.resend": [
    "VERIFY_REGISTRATION_EMAIL",
    "COMPLETE_DECLARATION",
    "WAITLIST_SPOT_OFFER",
    "REGISTRATION_CONFIRMED",
    "WAITLIST_JOINED",
    "REGISTRATION_STATE_NOTICE",
  ],
  "registrations.reminder": ["EVENT_REMINDER"],
  // «Retrimite familiei»: one email for everybody on the address — the verification, the declaration or offer, or the confirmation.
  "registrations.familyResend": ["VERIFY_REGISTRATION_EMAIL", "COMPLETE_DECLARATION", "WAITLIST_SPOT_OFFER", "REGISTRATION_CONFIRMED"],
  "registrations.givePlaceNow": ["COMPLETE_DECLARATION"],
  "registrations.offer": ["WAITLIST_SPOT_OFFER"],
  // «Confirmă pe hârtie»: confirmed, or on the waiting list when no place is free.
  "registrations.confirmPaper": ["REGISTRATION_CONFIRMED", "WAITLIST_JOINED"],
  "registrations.givePlace": ["REGISTRATION_CONFIRMED"],
  "registrations.setBib": ["BIB_ASSIGNED"],
  "registrations.specialGuests": ["COMPLETE_DECLARATION"],
  "registrations.cancel": ["REGISTRATION_CANCELLED"],
  "registrations.bulkCancel": ["REGISTRATION_CANCELLED"],
  "registrations.erase": [],
  "registrations.bulkErase": [],
  // An entry by staff: the verification, or — vouched, restarted or fast-tracked — the state it lands in.
  "registrations.create": ["VERIFY_REGISTRATION_EMAIL", "WAITLIST_JOINED", "COMPLETE_DECLARATION", "REGISTRATION_CONFIRMED"],
  "registrations.waitlistAdd": ["WAITLIST_JOINED", "COMPLETE_DECLARATION"],
  "registrations.offerNow": ["COMPLETE_DECLARATION", "WAITLIST_SPOT_OFFER"],
  "registrations.reserveMove": ["WAITLIST_JOINED", "COMPLETE_DECLARATION", "WAITLIST_SPOT_OFFER"],
  // «Pe adresa mea, invitat special»: the declaration, to the Administrator's own address — never the waiting list's email.
  "registrations.reserveOwnAddress": ["COMPLETE_DECLARATION"],
  // «Schimbă adresa»: the two notices — to the old address and to the new — and the state's own message to the new one.
  "registrations.changeAddress": [
    "REGISTRATION_ADDRESS_REMOVED",
    "REGISTRATION_ADDRESS_ADDED",
    "VERIFY_REGISTRATION_EMAIL",
    "WAITLIST_JOINED",
    "WAITLIST_SPOT_OFFER",
    "COMPLETE_DECLARATION",
    "REGISTRATION_CONFIRMED",
  ],
  "registrations.invite": ["EVENT_INVITATION"],
  "registrations.invitationResend": ["EVENT_INVITATION"],
  "registrations.invitationWithdraw": [],
  // «Șterge» on an ended invitation (§NNN): the invitee is sent nothing; an offer to the next in line, when the sweep makes one, is an other.
  "registrations.invitationDelete": [],
  "registrations.invitationsErase": [],

  // The editor's save: the update or cancel notice to everybody registered; offers and re-sent declarations are others.
  "events.save": ["EVENT_UPDATE_NOTICE", "EVENT_CANCELLED"],
  "events.thanks": ["EVENT_THANKS"],
  "events.declarationResendAll": ["COMPLETE_DECLARATION"],
  "events.participantMessage": ["ORGANIZER_MESSAGE"],
  "events.testRegistrations": ["VERIFY_REGISTRATION_EMAIL", "COMPLETE_DECLARATION", "WAITLIST_JOINED"],
  // Through the editor's own save, never the update notice: the offers and re-sent declarations are others.
  "events.importOver": [],

  "volunteers.add": ["VOLUNTEER_ROLE_ASSIGNED"],
  "volunteers.edit": ["VOLUNTEER_ROLE_ASSIGNED"],
  "volunteers.state": ["VOLUNTEER_ROLE_ASSIGNED"],
  "volunteers.assign": ["VOLUNTEER_ROLE_ASSIGNED"],
  "volunteers.unassign": ["VOLUNTEER_ROLE_ASSIGNED"],
  "volunteers.agreementLink": ["VOLUNTEER_AGREEMENT_REQUEST"],
  "volunteers.agreementPaper": ["VOLUNTEER_AGREEMENT_ACCEPTED"],
  "volunteers.guardianLink": ["VOLUNTEER_GUARDIAN_REQUEST"],
  // The parent's paper: the volunteer's second copy of their agreement, never the parent's.
  "volunteers.guardianPaper": ["VOLUNTEER_AGREEMENT_ACCEPTED"],
  "volunteers.invite": ["VOLUNTEER_INVITATION"],
  "volunteers.invitationResend": ["VOLUNTEER_INVITATION"],

  "club.newsletter": ["NEWSLETTER"],
  "club.staffInvite": ["STAFF_INVITATION", "MEMBER_INVITATION"],
  "club.membersInvite": ["MEMBER_INVITATION"],
  "club.staffReinvite": ["STAFF_INVITATION", "MEMBER_INVITATION"],
  "club.shopPaid": ["SHOP_ORDER_PAID"],
  "club.shopOrderForMember": ["SHOP_ORDER_PLACED", "SHOP_ORDER_PAID"],

  // The two jobs (their routes open the scope, and the drains that do their work early): nobody in particular.
  "job.registrationMaintenance": [],
  // «Eliberează singur locurile nesemnate la termen»: the release's own emails — each person released and the one summary —
  // under their own cause, wherever the release runs (the job, or a press that reached the deadline first).
  "job.deadlineRelease": [],
  "job.emailOutbox": [],
} as const satisfies Record<string, readonly EmailMessageType[]>;

export type PressCause = keyof typeof PRESS_CAUSES;

/** Every cause, in the map's order. */
export const PRESS_CAUSE_NAMES = Object.keys(PRESS_CAUSES) as PressCause[];

/** Whether a stored `cause` is one this code knows — a row's column is plain text. */
export function isPressCause(value: unknown): value is PressCause {
  return typeof value === "string" && Object.hasOwn(PRESS_CAUSES, value);
}

/** A job's cause: no person pressed anything, so no actor stands behind its rows. */
export function isJobCause(cause: PressCause): boolean {
  return cause.startsWith("job.");
}

/** The main types a cause sends to the person it acts on (empty for a press that sends them nothing). */
export function mainTypesOf(cause: PressCause): readonly EmailMessageType[] {
  return PRESS_CAUSES[cause];
}
