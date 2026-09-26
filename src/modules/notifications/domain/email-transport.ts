import { z } from "zod";
import type { EmailMessageType } from "@/db/schema/email-outbox";

/**
 * Which road each email leaves by — Mailgun, or the club's own Gmail over SMTP (§NNN).
 *
 * The owner, 2026-09-26: "we must keep Mailgun's cost down, so the club's Gmail should carry as
 * much as it can and Mailgun only what it must — but that has to be a setting; Google blocks an
 * account that sends too much in bulk or looks automated." So the choice is the club's, per
 * **group** of messages rather than per message (twenty-five types is a form nobody reads), with
 * Gmail's daily cap and its pace as numbers beside it.
 *
 * Pure: the groups, the setting's shape, its defaults, and the one decision the sender makes per
 * message. The worker (`outbox.ts`) asks `preferredTransport` for a row; the sender
 * (`infrastructure/email/delivery.ts`) decides whether Gmail may actually take it now.
 */

export const EMAIL_TRANSPORTS = ["mailgun", "gmail"] as const;
export type EmailTransport = (typeof EMAIL_TRANSPORTS)[number];

/**
 * The four groups, in the order the panel lists them.
 *
 * - **links** — a single-use action link the participant must act on (confirm the address, sign,
 *   take a freed place, manage a registration). Late or in spam, a place is lost.
 * - **confirmations** — the answers to a runner's own step: confirmed, on the waiting list,
 *   cancelled, an offer that lapsed, a number given, the signed copy.
 * - **event** — what goes to many runners at once: the reminder, the update notice, the
 *   cancellation, the organizer's message, the thank-you, "registration is open". Bulk is exactly
 *   what Google flags on a personal account.
 * - **club** — mail to the club's own mailboxes: the club's copies, the declaration archive, "somebody
 *   confirmed", a colleague's invitation. Low volume, to people who know the sender: Gmail's case.
 */
export const EMAIL_GROUPS = ["links", "confirmations", "event", "club"] as const;
export type EmailGroup = (typeof EMAIL_GROUPS)[number];

/**
 * Every message type in exactly one group. A `Record` over the enum, so a type added tomorrow
 * does not compile until somebody decides which road it takes.
 */
export const EMAIL_GROUP_OF: Readonly<Record<EmailMessageType, EmailGroup>> = {
  VERIFY_REGISTRATION_EMAIL: "links",
  COMPLETE_DECLARATION: "links",
  WAITLIST_SPOT_OFFER: "links",
  REGISTRATION_MANAGE_LINK: "links",
  PROFILE_MANAGE_LINK: "links",
  REGISTER_ANOTHER_PERSON: "links",
  REGISTRATION_CONFIRMED: "confirmations",
  WAITLIST_JOINED: "confirmations",
  REGISTRATION_CANCELLED: "confirmations",
  WAITLIST_OFFER_EXPIRED: "confirmations",
  REGISTRATION_STATE_NOTICE: "confirmations",
  BIB_ASSIGNED: "confirmations",
  DECLARATION_SIGNED: "confirmations",
  GROUP_RUN_DECLARATION_SIGNED: "confirmations",
  EVENT_REMINDER: "event",
  EVENT_THANKS: "event",
  EVENT_UPDATE_NOTICE: "event",
  EVENT_CANCELLED: "event",
  ORGANIZER_MESSAGE: "event",
  REGISTRATION_OPENED: "event",
  DECLARATION_ARCHIVE: "club",
  GROUP_RUN_DECLARATION_ARCHIVE: "club",
  CLUB_CONFIRMATION_NOTICE: "club",
  STAFF_INVITATION: "club",
};

/**
 * The group of one outbox row. A club copy of a participant's message (§320) is the club's mail,
 * whatever the message it copies: it goes to the club's own mailbox and carries no link to act on.
 */
export function emailGroupOf(messageType: EmailMessageType, clubCopy: boolean): EmailGroup {
  return clubCopy ? "club" : EMAIL_GROUP_OF[messageType];
}

/**
 * Gmail's own ceiling for a personal account is 500 recipients in a rolling day, and the club's
 * people send from the same account by hand; the setting may not go above it.
 */
export const GMAIL_DAILY_CAP_MAX = 500;
/** Ten seconds between two Gmail sends at most: a batch must still finish inside a function's life. */
export const GMAIL_PACE_SECONDS_MAX = 10;

export const emailTransportSettingSchema = z
  .object({
    groups: z
      .object({
        links: z.enum(EMAIL_TRANSPORTS),
        confirmations: z.enum(EMAIL_TRANSPORTS),
        event: z.enum(EMAIL_TRANSPORTS),
        club: z.enum(EMAIL_TRANSPORTS),
      })
      .strict(),
    /** Messages Gmail may carry in any rolling 24 hours; past it, Mailgun carries the rest. */
    gmailDailyCap: z.number().int().min(1).max(GMAIL_DAILY_CAP_MAX),
    /** The least time between two Gmail sends, in seconds. */
    gmailPaceSeconds: z.number().int().min(0).max(GMAIL_PACE_SECONDS_MAX),
    /**
     * When Mailgun refuses because the plan's allowance is spent (§40), Gmail takes the message —
     * inside its own cap — instead of the message waiting for the reset.
     */
    overflowToGmail: z.boolean(),
  })
  .strict();

export type EmailTransportSetting = z.infer<typeof emailTransportSettingSchema>;

/**
 * The club's own mail through Gmail, everything a participant must act on or is told through
 * Mailgun, and Gmail as the spill-over when Mailgun's day is spent.
 *
 * - **club → Gmail**: copies, archive, notices and invitations are the largest share of what the
 *   club itself costs the allowance (four copies per registration per address, §320), they go to
 *   mailboxes that expect the club, and none carries a link a runner loses a place over.
 * - **participants → Mailgun**: a sending domain with SPF, DKIM and a bounce webhook (§16.5);
 *   Gmail has none of the webhook, and a personal account sending hundreds of near-identical
 *   messages to strangers is what Google suspends.
 * - **250 a day, 3 seconds apart**: half of Gmail's published 500, because the contact form and
 *   the people answering by hand spend the same account.
 * - **overflow on**: a confirmation link sent through Gmail today is better than one Mailgun
 *   sends tomorrow; it applies only while Gmail is configured and under its cap.
 */
export const DEFAULT_EMAIL_TRANSPORT: EmailTransportSetting = {
  groups: { links: "mailgun", confirmations: "mailgun", event: "mailgun", club: "gmail" },
  gmailDailyCap: 250,
  gmailPaceSeconds: 3,
  overflowToGmail: true,
};

/** The road the club chose for one outbox row. Whether Gmail can take it *now* is the sender's call. */
export function preferredTransport(
  setting: EmailTransportSetting,
  messageType: EmailMessageType,
  clubCopy: boolean,
): EmailTransport {
  return setting.groups[emailGroupOf(messageType, clubCopy)];
}

/**
 * The road every participant message type takes as things stand — the club's choice for its group,
 * or Mailgun wherever Gmail is not configured — for the pages that say it (the forecast, §383).
 * Gmail's cap is not in it: that is a moment's fact, and the panel beside it says it.
 */
export function roadsByMessageType(
  setting: EmailTransportSetting,
  gmailConfigured: boolean,
): Record<EmailMessageType, EmailTransport> {
  const entries = (Object.keys(EMAIL_GROUP_OF) as EmailMessageType[]).map(
    (type) => [type, gmailConfigured ? preferredTransport(setting, type, false) : "mailgun"] as const,
  );
  return Object.fromEntries(entries) as Record<EmailMessageType, EmailTransport>;
}

/**
 * Gmail's state as the sender sees it before a message: configured or not, how many it carried in
 * the last 24 hours, and when it last sent.
 */
export type GmailUsage = {
  configured: boolean;
  sentLastDay: number;
  lastSentAt: Date | null;
};

/**
 * Whether Gmail may take one more message now, and how long to wait first for the pace.
 *
 * - not configured → no (Mailgun carries it, as it did before this setting);
 * - at the cap → no (Mailgun carries it: delivery first, and an account over Google's limit is
 *   locked for a day, the contact form with it);
 * - otherwise yes, after `waitMs` — zero when the last Gmail send is at least the pace ago.
 */
export function gmailAdmission(
  usage: GmailUsage,
  setting: Pick<EmailTransportSetting, "gmailDailyCap" | "gmailPaceSeconds">,
  now: Date,
): { admitted: false; reason: "unconfigured" | "cap" } | { admitted: true; waitMs: number } {
  if (!usage.configured) return { admitted: false, reason: "unconfigured" };
  if (usage.sentLastDay >= setting.gmailDailyCap) return { admitted: false, reason: "cap" };
  const paceMs = setting.gmailPaceSeconds * 1000;
  const since = usage.lastSentAt ? now.getTime() - usage.lastSentAt.getTime() : Number.POSITIVE_INFINITY;
  return { admitted: true, waitMs: Math.max(0, Math.min(paceMs, paceMs - since)) };
}

/**
 * The share of one completed registration's messages that Mailgun carries, given the club's
 * choice — the figure every "how many more registrations fit today" sentence divides by.
 *
 * The same decomposition `volume.ts#messagesPerCompletedRegistration` states in its comment:
 * the runner's five (two links, the confirmation plus one more answer, the reminder), the club's
 * copies of four of them per address, the club's confirmation notice and, when named, the archive.
 * With Gmail unconfigured every one of them is Mailgun's, whatever the setting says.
 */
export function mailgunMessagesPerCompletedRegistration(
  setting: EmailTransportSetting,
  gmailConfigured: boolean,
  input: { archiveConfigured: boolean; participantBccCount: number },
): number {
  const copies = Math.max(0, Math.floor(input.participantBccCount));
  const perGroup: Record<EmailGroup, number> = {
    links: 2,
    confirmations: 2,
    event: 1,
    club: 4 * copies + 1 + (input.archiveConfigured ? 1 : 0),
  };
  return EMAIL_GROUPS.reduce(
    (total, group) => total + (gmailConfigured && setting.groups[group] === "gmail" ? 0 : perGroup[group]),
    0,
  );
}
