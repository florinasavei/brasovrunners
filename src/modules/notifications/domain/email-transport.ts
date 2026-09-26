import { z } from "zod";
import type { EmailMessageType } from "@/db/schema/email-outbox";

/**
 * Which road each email leaves by — Mailgun, or the club's own Gmail over SMTP (§NNN).
 *
 * The owner, 2026-09-26: "we must keep Mailgun's cost down, so the club's Gmail should carry as
 * much as it can and Mailgun only what it must — but that has to be a setting; Google blocks an
 * account that sends too much in bulk or looks automated." So the choice is the club's, per
 * **group** of messages rather than per message (twenty-five types is a form nobody reads), with
 * Gmail's daily cap, its pace and what happens at the cap as numbers and choices beside it.
 *
 * Pure: the groups, the setting's shape, its defaults, and the one decision the sender makes per
 * message. The worker (`outbox.ts`) asks `preferredTransport` for a row; the sender
 * (`infrastructure/email/delivery.ts`) decides whether Gmail may actually take it now.
 */

export const EMAIL_TRANSPORTS = ["mailgun", "gmail"] as const;
export type EmailTransport = (typeof EMAIL_TRANSPORTS)[number];

/**
 * The six groups, in the order the panel lists them — the brief's A–F, with F (the contact form)
 * outside the outbox: it already leaves through the club's Gmail (§149) and has no row to route.
 *
 * - **links** (A) — a single-use action link the participant must act on (confirm the address,
 *   sign, take a freed place, manage a registration). Late or in spam, a place is lost.
 * - **reminders** (B) — the reminder before the start and the thank-you after: one per runner of
 *   an event, all at the job's hour — the burst Google flags on a personal account.
 * - **announcements** (C) — what the organizers decide to say: the update notice, the
 *   cancellation, the organizer's message, "registration is open". Rare, and paced.
 * - **confirmations** — the answers to a runner's own step: confirmed, on the waiting list,
 *   cancelled, an offer that lapsed, a number given, the signed copy.
 * - **club** (D) — mail to the club's own mailboxes: the club's copies, the declaration archive,
 *   "somebody confirmed", a colleague's invitation. To people who know the sender: Gmail's case.
 * - **newsletter** (E) — nothing yet: the newsletter's own menu is being built on its own branch;
 *   the group is here so its road is decided before its first message is queued.
 */
export const EMAIL_GROUPS = ["links", "confirmations", "reminders", "announcements", "club", "newsletter"] as const;
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
  EVENT_REMINDER: "reminders",
  EVENT_THANKS: "reminders",
  EVENT_UPDATE_NOTICE: "announcements",
  EVENT_CANCELLED: "announcements",
  ORGANIZER_MESSAGE: "announcements",
  REGISTRATION_OPENED: "announcements",
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
 * Google's own ceiling for a personal Gmail account: "more than 500 recipients in a single email
 * and or more than 500 emails sent in a day" gets the account's sending suspended — Gmail Help,
 * "Limits for sending & getting mail" (article 22839; the address is in the §NNN decision, read
 * 2026-09-26). Google counts **recipients** in a rolling day, so the cap here counts recipients too
 * (the address and every copy: `email_outbox.recipient_count`). The club's people send from the
 * same account by hand, and QA and production share it (one `CONTACT_SMTP_USER`), so the setting
 * may not go above it and the two environments' defaults add up to half of it.
 */
export const GMAIL_DAILY_CAP_MAX = 500;
/** Ten seconds between two Gmail sends at most: a batch must still finish inside a function's life. */
export const GMAIL_PACE_SECONDS_MAX = 10;

export const GMAIL_AT_CAP = ["defer", "mailgun"] as const;
export type GmailAtCap = (typeof GMAIL_AT_CAP)[number];

export const emailTransportSettingSchema = z
  .object({
    groups: z
      .object({
        links: z.enum(EMAIL_TRANSPORTS),
        confirmations: z.enum(EMAIL_TRANSPORTS),
        reminders: z.enum(EMAIL_TRANSPORTS),
        announcements: z.enum(EMAIL_TRANSPORTS),
        club: z.enum(EMAIL_TRANSPORTS),
        newsletter: z.enum(EMAIL_TRANSPORTS),
      })
      .strict(),
    /** Recipients Gmail may reach in any rolling 24 hours. */
    gmailDailyCap: z.number().int().min(1).max(GMAIL_DAILY_CAP_MAX),
    /** The least time between two Gmail sends, in seconds; a small random jitter is added on top. */
    gmailPaceSeconds: z.number().int().min(0).max(GMAIL_PACE_SECONDS_MAX),
    /**
     * At Gmail's cap, a message whose group goes through Gmail either waits until the rolling day
     * frees room («amână până mâine», the default — Mailgun's allowance untouched) or goes through
     * Mailgun at once.
     */
    atGmailCap: z.enum(GMAIL_AT_CAP),
    /**
     * When Mailgun refuses because the plan's allowance is spent (§40), Gmail takes the message —
     * inside its own cap — instead of the message waiting for the reset.
     */
    overflowToGmail: z.boolean(),
  })
  .strict();

export type EmailTransportSetting = z.infer<typeof emailTransportSettingSchema>;

/**
 * The club's own mail and the (future) newsletter through Gmail; everything a participant gets
 * through Mailgun, until the privacy notice names Gmail as a road for it.
 *
 * - **club, newsletter → Gmail**: copies, archive, notices and invitations are the largest share of
 *   what the club itself costs the allowance (four copies per registration per address, §320), they
 *   go to mailboxes that expect the club, and the notice in force already says the club's copies
 *   reach its Gmail mailbox (section 6).
 * - **participants → Mailgun**: the notice lists Mailgun as the one that sends email and Gmail only
 *   as the club's mailbox; a participant's name, token links and signed PDF leaving through Google
 *   is a processor the notice does not name (§418 made that list accurate). An Administrator may
 *   switch announcements (C) or any other group once a notice naming it is approved.
 * - **defer at the cap**: the owner asked to spend Mailgun as little as possible; a club copy a day
 *   late costs nothing, and a runner's message is Mailgun's by default anyway.
 * - **6 seconds apart** (ten a minute, jittered): an account that sends like a script is what Google
 *   suspends.
 * - **overflow off**: the same notice question as the participant groups.
 * - **200 a day on production, 50 elsewhere**: one Gmail account serves both environments and the
 *   people answering by hand; 250 of Google's 500 leaves them the rest.
 */
export const DEFAULT_EMAIL_TRANSPORT: EmailTransportSetting = {
  groups: {
    links: "mailgun",
    confirmations: "mailgun",
    reminders: "mailgun",
    announcements: "mailgun",
    club: "gmail",
    newsletter: "gmail",
  },
  gmailDailyCap: 200,
  gmailPaceSeconds: 6,
  atGmailCap: "defer",
  overflowToGmail: false,
};

/** Every environment but production shares production's Gmail account, and gets a smaller share of it. */
export const NON_PRODUCTION_GMAIL_DAILY_CAP = 50;

/** The default for one environment: production's, with a smaller cap everywhere else. */
export function defaultEmailTransportFor(appEnv: string): EmailTransportSetting {
  return appEnv === "production" ? DEFAULT_EMAIL_TRANSPORT : { ...DEFAULT_EMAIL_TRANSPORT, gmailDailyCap: NON_PRODUCTION_GMAIL_DAILY_CAP };
}

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
 * Gmail's state as the sender sees it before a message: configured or not, how many recipients it
 * reached in the last 24 hours, when it last sent, and when the oldest send still inside the
 * rolling day was — the moment that send leaves the window and frees its room.
 */
export type GmailUsage = {
  configured: boolean;
  sentLastDay: number;
  lastSentAt: Date | null;
  oldestInWindowAt: Date | null;
};

export const GMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * At most this much random wait on top of the pace: two seconds, or half the pace when it is
 * shorter — enough that the sends are not a metronome, never enough to double the pace.
 */
export function gmailJitterCeilingMs(paceSeconds: number): number {
  return Math.min(2_000, Math.floor((paceSeconds * 1000) / 2));
}

export type GmailAdmission =
  | { admitted: false; reason: "unconfigured" | "too-many-recipients" }
  | { admitted: false; reason: "cap"; roomAt: Date }
  | { admitted: true; waitMs: number };

/**
 * Whether Gmail may take one more message of `recipients` recipients now, and how long to wait
 * first for the pace.
 *
 * - not configured → no (Mailgun carries it, as it did before this setting);
 * - more recipients than the whole cap → no, ever (Mailgun carries it; waiting would never help);
 * - over the cap → no, with `roomAt` — when the oldest send inside the rolling day leaves it — for
 *   the sender to defer to, or Mailgun at once, as the club chose;
 * - otherwise yes, after `waitMs` — the rest of the pace since the last Gmail send, plus `jitterMs`.
 */
export function gmailAdmission(
  usage: GmailUsage,
  setting: Pick<EmailTransportSetting, "gmailDailyCap" | "gmailPaceSeconds">,
  now: Date,
  recipients = 1,
  jitterMs = 0,
): GmailAdmission {
  if (!usage.configured) return { admitted: false, reason: "unconfigured" };
  if (recipients > setting.gmailDailyCap) return { admitted: false, reason: "too-many-recipients" };
  if (usage.sentLastDay + recipients > setting.gmailDailyCap) {
    const oldest = usage.oldestInWindowAt ?? now;
    return { admitted: false, reason: "cap", roomAt: new Date(Math.max(now.getTime(), oldest.getTime() + GMAIL_WINDOW_MS)) };
  }
  const paceMs = setting.gmailPaceSeconds * 1000;
  if (!usage.lastSentAt) return { admitted: true, waitMs: 0 };
  /*
    Not clamped at one pace: `lastSentAt` may be a slot another sender holds a few seconds ahead
    (`notifications/email-transport.ts#createGmailLedger`), and the pace runs from that slot.
  */
  const since = now.getTime() - usage.lastSentAt.getTime();
  const rest = Math.max(0, paceMs - since);
  return { admitted: true, waitMs: rest > 0 ? rest + Math.max(0, jitterMs) : 0 };
}

/**
 * What one sender asks Gmail's ledger before a message (§NNN): the message's recipients, the
 * sender's clock — read by the ledger once it has its turn, not before — the jitter drawn for it,
 * the club's cap and pace, and how long the sender may still wait on the pace in this batch.
 */
export type GmailSlotRequest = {
  recipients: number;
  clock: () => Date;
  jitterMs: number;
  maxWaitMs: number;
  dailyCap: number;
  paceSeconds: number;
};

/**
 * Gmail's usage as every sender shares it (§NNN review) — the drain after a response, the pinger's
 * job and "Trimite acum", in one instance or several.
 *
 * - `admit` reads the usage afresh and decides in one step; an admission whose wait fits
 *   `maxWaitMs` also **holds** its slot (`slotAt`, now plus the wait), so the next sender, wherever
 *   it runs, paces from that slot rather than from a send it cannot see yet — and the sender sends
 *   at its slot, not merely after its wait. An admission that does not fit holds nothing: the
 *   sender hands the message back.
 * - `accepted` is told when Gmail took the message, at the moment it did.
 */
export type GmailLedger = {
  admit(request: GmailSlotRequest): Promise<GmailAdmission & { slotAt?: Date }>;
  accepted(recipients: number, at: Date): Promise<void>;
};

/**
 * The outbox rows the club sends through Gmail, as the claim can select them (§NNN review): the
 * message types whose group the club put on Gmail, and whether the club's copies are Gmail's too.
 * The same answer `preferredTransport` gives row by row, so the claim and the route cannot differ.
 */
export function gmailRoadRows(setting: EmailTransportSetting): { messageTypes: EmailMessageType[]; clubCopies: boolean } {
  return {
    messageTypes: (Object.keys(EMAIL_GROUP_OF) as EmailMessageType[]).filter((type) => preferredTransport(setting, type, false) === "gmail"),
    clubCopies: setting.groups.club === "gmail",
  };
}

/**
 * How many Gmail-road rows one batch claims (§NNN review): what the pace lets one sender send in
 * the waiting it may spend — the first at once, then one per pace — never more than the batch.
 * Claimed apart from the Mailgun rows, so a queue of club copies waiting on Gmail's pace never
 * stands in front of a runner's link.
 */
export function gmailClaimSize(paceSeconds: number, budgetMs: number, batchSize: number): number {
  if (paceSeconds <= 0) return batchSize;
  return Math.max(1, Math.min(batchSize, Math.floor(budgetMs / (paceSeconds * 1000)) + 1));
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
    reminders: 1,
    announcements: 0,
    club: 4 * copies + 1 + (input.archiveConfigured ? 1 : 0),
    newsletter: 0,
  };
  return EMAIL_GROUPS.reduce(
    (total, group) => total + (gmailConfigured && setting.groups[group] === "gmail" ? 0 : perGroup[group]),
    0,
  );
}

/**
 * The sentence under the Mailgun plan's forecast about the club's copies (§320), which must agree
 * with the figure beside it: the hidden copies counted in Mailgun's cost while the club's mail goes
 * through Mailgun, or the messages Gmail carries instead once any group goes through Gmail — never
 * "8 of 5 are copies" (§NNN review).
 */
export function forecastCopiesNote(input: {
  participantBccCount: number;
  copiedMessagesPerRegistration: number;
  allMessagesPerRegistration: number;
  messagesPerRegistration: number;
}): { kind: "bcc"; bcc: number; extra: number } | { kind: "gmail"; count: number } | null {
  const viaGmail = input.allMessagesPerRegistration - input.messagesPerRegistration;
  if (viaGmail > 0) return { kind: "gmail", count: viaGmail };
  if (input.participantBccCount > 0) {
    return { kind: "bcc", bcc: input.participantBccCount, extra: input.participantBccCount * input.copiedMessagesPerRegistration };
  }
  return null;
}
