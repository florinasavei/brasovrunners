import { and, count, gte, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { env } from "@/shared/config/env";
import { readClubNotices } from "./club-notices";
import { declarationArchiveIsConfigured, participantMessageBcc } from "./domain/club-notices";
import { type EmailPlanId, EMAIL_PLANS, emailCeilings, emailHeadroom } from "./domain/email-plan";
import { readEmailPlan } from "./email-plan";
import { mailgunMessagesPerCompletedRegistration } from "./domain/email-transport";
import { readEmailTransport, readGmailUsage } from "./email-transport";

/**
 * How much email today is going to cost, before the day proves it (AGENTS.md §16, §19).
 *
 * `docs/PLATFORM.md` has said since `BR-V1.19` that Mailgun Free's 100 messages a day is the
 * limit that binds on registration day, and that this application sends three per completed
 * registration. Saying it in a document is not the same as somebody being able to *see* it, and
 * the check that mattered — "is there headroom for the window I am about to open?" — could only
 * be done by opening the Mailgun dashboard and doing the arithmetic by hand. This is that
 * arithmetic, on `/devs`, next to everything else about the deployment.
 *
 * It is a forecast, not a bill. The authority on what has actually been sent is Mailgun.
 */

/**
 * Four, from §16.3's message list, for a registration that completes normally and is
 * reminded: `VERIFY_REGISTRATION_EMAIL`, `COMPLETE_DECLARATION`, `REGISTRATION_CONFIRMED`,
 * and `EVENT_REMINDER` two days before the start (`DECISIONS.md` §81) — three since
 * 2026-09-18, and the reminder made it four.
 *
 * The fifth was `DECLARATION_SIGNED` (§95), and since §126 the signed PDF rides on the
 * confirmation instead, so nothing enqueues that type (§171). The number stayed **five** anyway,
 * and deliberately: an entrant who lands on the waiting list costs two more
 * (`WAITLIST_JOINED`, then `WAITLIST_SPOT_OFFER`) and one who cancels costs another, so five
 * was a realistic floor once a race fills.
 *
 * **Six since §245**: the club is told when somebody confirms, and that notice is a message on
 * the same allowance — one per confirmed registration, to the mailbox the club named on
 * `/admin/emails`. A club that has named none sends five, and the forecast is then one high,
 * which is the safe direction for a number whose job is to answer "is there headroom?".
 * `docs/PLATFORM.md` states the arithmetic in prose and
 * `tests/unit/diagnostics/platform-plans.test.ts` holds the two to each other — changing it is
 * a documentation change, not a constant edit.
 *
 * Split in two since 2026-09-22, because the club can now ask for a hidden copy of every message
 * a participant receives and the copy is priced per *participant* message: the five the runner
 * gets, and the one the club gets, which is not copied again.
 */
export const PARTICIPANT_MESSAGES_PER_COMPLETED_REGISTRATION = 5;
export const CLUB_MESSAGES_PER_COMPLETED_REGISTRATION = 1;
export const MESSAGES_PER_COMPLETED_REGISTRATION =
  PARTICIPANT_MESSAGES_PER_COMPLETED_REGISTRATION + CLUB_MESSAGES_PER_COMPLETED_REGISTRATION;
/**
 * Of the runner's five, the ones the club's hidden copy reaches: four. `VERIFY_REGISTRATION_EMAIL`
 * goes to an address nobody has confirmed yet and is never copied (`isCopiedPerMessage`, §419).
 */
export const COPIED_PARTICIPANT_MESSAGES_PER_COMPLETED_REGISTRATION = PARTICIPANT_MESSAGES_PER_COMPLETED_REGISTRATION - 1;

/**
 * What one registration that completes costs, given what the club has switched on — the one
 * pure function behind every forecast on `/admin/emails` and `/admin/tasks`.
 *
 * - **Seven when the club's archive mailbox is named** (`DECLARATIONS_ARCHIVE_TO` or the setting,
 *   §99, §244): the archive copy of the declaration is one more message on the same allowance.
 * - **Plus one per hidden-copy address per participant message** (2026-09-22): each address
 *   receives a club copy of its own (one outbox row each since §320, where it was one Bcc on the
 *   participant's envelope before — Mailgun billed each recipient as a message either way), so two
 *   addresses under "copie ascunsă la emailurile către participanți" turn a runner's five
 *   messages into thirteen — the address-confirmation link is never copied (§419). The
 *   arithmetic is here so the panel that sets the list and the board that forecasts the day
 *   cannot disagree about what it costs.
 *
 * The constant above is the floor with neither.
 */
export function messagesPerCompletedRegistration(input: {
  archiveConfigured: boolean;
  /** How many addresses receive a hidden copy of each participant message. */
  participantBccCount: number;
}): number {
  const copies = Math.max(0, Math.floor(input.participantBccCount));
  return (
    PARTICIPANT_MESSAGES_PER_COMPLETED_REGISTRATION +
    COPIED_PARTICIPANT_MESSAGES_PER_COMPLETED_REGISTRATION * copies +
    CLUB_MESSAGES_PER_COMPLETED_REGISTRATION +
    (input.archiveConfigured ? 1 : 0)
  );
}

/**
 * Mailgun Free: 100 messages a day (`docs/PLATFORM.md`, limit 1 of the four that bite).
 *
 * The floor, and the default. Until `DECISIONS.md` §100 this was "a constant and not
 * configuration, deliberately", on the argument that a variable invites being set to whatever
 * makes the page look calm. The owner's counter-argument won: the club *will* pay for a month
 * of Basic around a race, and the day it does, every page that says "100 a day" is wrong until
 * a developer deploys. The plan is a setting now (`email-plan.ts`), changed by an
 * Administrator with an audit row, and shown next to the counts that would expose a wrong one.
 */
export const MAILGUN_FREE_DAILY_MESSAGES = EMAIL_PLANS.FREE.dailyAllowance ?? 100;

export type EmailVolumeToday = {
  /** Real registrations created today. The club's own number. */
  realRegistrations: number;
  /**
   * Test registrations created today (`registrations.kind = 'TEST'`, §12.6).
   *
   * Counted, and counted **separately**. §12.6 keeps test rows out of every count the club is
   * given, and this is not one of those: it is an operator's forecast of what will hit the
   * provider, and a synthetic participant on an `@test.invalid` address consumes the allowance
   * exactly like a real one. Hiding it here would make the only number that matters wrong.
   */
  testRegistrations: number;
  /** `(real + test) × 3` — the floor, not the ceiling. See the constant above. */
  projectedMessages: number;
  /** Outbox rows created today, whatever their status. What has actually been asked for. */
  queuedMessages: number;
  /** Rows not yet delivered — pending or mid-flight — whatever day they were queued. */
  waitingMessages: number;
  /**
   * Outbox rows Mailgun transmitted today. What the allowance has actually paid for — the rows the
   * club's Gmail carried (§NNN) are not in it: they cost Mailgun nothing.
   */
  sentMessages: number;
  /** Mailgun's since the first of the month (UTC): what a monthly plan counts against. */
  sentThisMonth: number;
  /** The plan the club says it is on (§100), and its name for the pages. */
  plan: EmailPlanId;
  planName: string;
  /** Which ceiling binds: Free's day, a paid plan's month, or none at all. */
  period: "day" | "month" | "none";
  /** The ceiling that binds, in messages; null when nothing does. */
  allowance: number | null;
  /** `allowance − sent` over the binding period, never below zero; null when nothing binds. */
  remaining: number | null;
  /** Whether a signed declaration also reaches the club, which is the sixth message's seventh (§244). */
  archiveConfigured: boolean;
  /** How many club addresses receive a hidden copy of every participant message (2026-09-22). */
  participantBccCount: number;
  /**
   * What one completed registration costs **Mailgun** today: `messagesPerCompletedRegistration` of
   * the two above, less the groups the club sends through its Gmail (§NNN). The allowance is
   * Mailgun's, so this is the figure every "how many more fit" divides by.
   */
  messagesPerRegistration: number;
  /** Every message one completed registration causes, whichever road it takes. */
  allMessagesPerRegistration: number;
  /** Whether the club's Gmail is configured on this deployment, so any group can take its road (§NNN). */
  gmailConfigured: boolean;
  /** Messages the club's Gmail carried in the last 24 hours, and the club's cap on them (§NNN). */
  gmailSentLastDay: number;
  gmailDailyCap: number;
};

/**
 * A row Mailgun carried: every sent row but the club's Gmail's (§NNN). A null `transport` is a row
 * sent before the column existed, and Mailgun carried all of those.
 */
const carriedByMailgun = sql`(${emailOutbox.transport} IS NULL OR ${emailOutbox.transport} <> 'gmail')`;

/** The first of the month, UTC, matching the day boundary below. */
function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Midnight UTC, matching `nextAllowanceResetAt` in `domain/retry.ts`. */
function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Four counts and some arithmetic, in one round trip.
 *
 * `now` is a parameter rather than a clock read inside, like every other time-dependent
 * function here (§1.5) — the day boundary is precisely the thing a test needs to move.
 */
export async function readEmailVolumeToday<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<EmailVolumeToday> {
  const since = startOfUtcDay(now);

  const [registrationCounts] = await db
    .select({
      real: count(sql`CASE WHEN ${registrations.kind} = 'REAL' THEN 1 END`),
      test: count(sql`CASE WHEN ${registrations.kind} = 'TEST' THEN 1 END`),
    })
    .from(registrations)
    .where(gte(registrations.createdAt, since));

  const [queued] = await db
    .select({ value: count() })
    .from(emailOutbox)
    .where(gte(emailOutbox.createdAt, since));

  const [sent] = await db
    .select({ value: count() })
    .from(emailOutbox)
    .where(and(gte(emailOutbox.sentAt, since), sql`${emailOutbox.sentAt} IS NOT NULL`, carriedByMailgun));

  const [waiting] = await db
    .select({ value: count() })
    .from(emailOutbox)
    .where(sql`${emailOutbox.status} IN ('PENDING', 'PROCESSING')`);

  const [sentMonth] = await db
    .select({ value: count() })
    .from(emailOutbox)
    .where(and(gte(emailOutbox.sentAt, startOfUtcMonth(now)), sql`${emailOutbox.sentAt} IS NOT NULL`, carriedByMailgun));

  const realRegistrations = registrationCounts?.real ?? 0;
  const testRegistrations = registrationCounts?.test ?? 0;
  const sentMessages = sent?.value ?? 0;
  const sentThisMonth = sentMonth?.value ?? 0;

  const setting = await readEmailPlan(db);
  // One row by primary key, on a table with a handful of rows: the archive mailbox may be a
  // setting now (§244), and the forecast would otherwise still be reading the environment. The
  // same row says how many hidden copies each participant message carries.
  const notices = await readClubNotices(db);
  const archiveConfigured = declarationArchiveIsConfigured(notices, env.DECLARATIONS_ARCHIVE_TO);
  const participantBccCount = participantMessageBcc(notices).length;
  const allMessagesPerRegistration = messagesPerCompletedRegistration({ archiveConfigured, participantBccCount });
  // What of it Mailgun carries, by the club's roads (§NNN), and Gmail's own last day beside it.
  const [transport, gmail] = await Promise.all([readEmailTransport(db), readGmailUsage(db, now)]);
  const messagesPerRegistration = mailgunMessagesPerCompletedRegistration(transport, gmail.configured, {
    archiveConfigured,
    participantBccCount,
  });
  const ceilings = emailCeilings(setting);
  const headroom = emailHeadroom(ceilings, sentMessages, sentThisMonth);

  return {
    realRegistrations,
    testRegistrations,
    projectedMessages: (realRegistrations + testRegistrations) * messagesPerRegistration,
    archiveConfigured,
    participantBccCount,
    messagesPerRegistration,
    allMessagesPerRegistration,
    gmailConfigured: gmail.configured,
    gmailSentLastDay: gmail.sentLastDay,
    gmailDailyCap: transport.gmailDailyCap,
    queuedMessages: queued?.value ?? 0,
    waitingMessages: waiting?.value ?? 0,
    sentMessages,
    sentThisMonth,
    plan: setting.plan,
    planName: ceilings.planName,
    period: headroom.period,
    allowance: headroom.allowance,
    remaining: headroom.remaining,
  };
}
