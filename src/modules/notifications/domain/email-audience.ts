import type { EmailMessageType } from "@/db/schema/email-outbox";

/**
 * Whom each message type is written for (§670; amending §320's exclusion set): the one map every
 * question about "is this the participant's own mail" is answered from.
 *
 * - **participant** — a message to the person registered (or about to be), at their own address: the
 *   ones the club gets a copy of (§320), the ones that carry the privacy line (§323), and the only ones
 *   whose refusal says anything about that person's address — «Email respins», the automatic re-send's
 *   refusal (§653) and the registration's email state read these alone.
 * - **club** — the club's own mailboxes: the declaration's archive copy (§99, §393) and «somebody has
 *   confirmed» (§245). They carry the participant's id and registration, and a club mailbox that bounces
 *   them is the club's problem, never the runner's.
 * - **staff** — a colleague or a member's account (§141, §524, §639, §657): Echipa's people.
 * - **public** — an address left by somebody who is not registered: the newsletter (§445), «registration
 *   is open» (§146), an invitation (§647).
 *
 * A `Record` over the enum, not an exclusion set: a message type added to `email_message_type` does not
 * compile until somebody chooses its audience, so nothing can become a participant's message by
 * forgetting to name it somewhere.
 */
export type EmailAudience = "participant" | "club" | "staff" | "public";

export const EMAIL_AUDIENCE = {
  VERIFY_REGISTRATION_EMAIL: "participant",
  COMPLETE_DECLARATION: "participant",
  WAITLIST_JOINED: "participant",
  WAITLIST_SPOT_OFFER: "participant",
  REGISTRATION_CONFIRMED: "participant",
  REGISTRATION_CANCELLED: "participant",
  WAITLIST_OFFER_EXPIRED: "participant",
  REGISTRATION_MANAGE_LINK: "participant",
  PROFILE_MANAGE_LINK: "participant",
  REGISTRATION_STATE_NOTICE: "participant",
  EVENT_REMINDER: "participant",
  EVENT_THANKS: "participant",
  DECLARATION_SIGNED: "participant",
  DECLARATION_ARCHIVE: "club",
  BIB_ASSIGNED: "participant",
  STAFF_INVITATION: "staff",
  REGISTRATION_OPENED: "public",
  CLUB_CONFIRMATION_NOTICE: "club",
  EVENT_UPDATE_NOTICE: "participant",
  EVENT_CANCELLED: "participant",
  ORGANIZER_MESSAGE: "participant",
  // The signer's own copy (§393): to the person who signed, though no registration is behind it.
  GROUP_RUN_DECLARATION_SIGNED: "participant",
  GROUP_RUN_DECLARATION_ARCHIVE: "club",
  REGISTER_ANOTHER_PERSON: "participant",
  NEWSLETTER_CONFIRM: "public",
  NEWSLETTER: "public",
  NEW_EVENT_ALERT: "public",
  MEMBER_INVITATION: "staff",
  DECLARATION_HOLD_EXPIRED: "participant",
  LEGAL_TEMPLATES_CHANGED: "staff",
  EVENT_INVITATION: "public",
  UNREACHABLE_WINDOW_OPENED: "staff",
  UNREACHABLE_WINDOW_CLOSED: "staff",
  // The members' shop (§683): to a member's account, and to the club's mailbox for orders — Echipa's
  // people and the club, about no registration: never a participant's message.
  SHOP_ORDER_PLACED: "staff",
  SHOP_ORDER_PAID: "staff",
  SHOP_ORDER_CLUB_NOTICE: "staff",
} as const satisfies Record<EmailMessageType, EmailAudience>;

export function audienceOf(messageType: EmailMessageType): EmailAudience {
  return EMAIL_AUDIENCE[messageType];
}

/** Every message type written for this audience, in the enum map's order. */
export function messageTypesFor(audience: EmailAudience): EmailMessageType[] {
  return (Object.keys(EMAIL_AUDIENCE) as EmailMessageType[]).filter((type) => EMAIL_AUDIENCE[type] === audience);
}

/** The participant's own messages: the only rows whose refusal is about a participant's address. */
export const PARTICIPANT_MESSAGE_TYPES: readonly EmailMessageType[] = messageTypesFor("participant");

/** The club's own mailboxes' messages (§99, §245, §393) — a club copy of a participant's message is the club's too. */
export const CLUB_MAILBOX_MESSAGE_TYPES: readonly EmailMessageType[] = messageTypesFor("club");

/**
 * Whom one outbox row was for, by role and never by address (§670): the participant; the club's archive
 * copy of a declaration (§99, §393) or its «somebody has confirmed» notice (§245) — the club's audience,
 * told apart because the club fixes them in two different settings; a club copy of a participant's
 * message (§320, the `clubCopy` flag); or a colleague's or the public's. From the audience map, so a type
 * added tomorrow has a role the day it has an audience.
 */
export type RecipientRole = "participant" | "archive" | "notice" | "copy" | "staff" | "public";

export function recipientRoleOf(messageType: EmailMessageType, clubCopy: boolean): RecipientRole {
  if (clubCopy) return "copy";
  const audience = audienceOf(messageType);
  if (audience === "club") return messageType === "CLUB_CONFIRMATION_NOTICE" ? "notice" : "archive";
  return audience;
}
