import { and, count, gte, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { env } from "@/shared/config/env";
import { type EmailPlanId, EMAIL_PLANS, emailCeilings, emailHeadroom } from "./domain/email-plan";
import { readEmailPlan } from "./email-plan";

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
 * 2026-09-18, and the reminder made it four. `DECLARATION_SIGNED` was counted as a fifth, but
 * since §126 the signed PDF rides on the confirmation and nothing enqueues that type (§171), so
 * five over-projected every headroom and cost figure on `/devs` and `/admin/tasks` by a quarter
 * (§177).
 *
 * An entrant who lands on the waiting list costs more (`WAITLIST_JOINED`, then
 * `WAITLIST_SPOT_OFFER`), and one who cancels costs another. So four is the *floor* for a
 * completed registration and the projection below understates a busy day rather than crying
 * wolf — which is the right direction for a number somebody uses to decide whether to upgrade.
 */
export const MESSAGES_PER_COMPLETED_REGISTRATION = 4;

/**
 * Six when the club's archive mailbox is named (`DECLARATIONS_ARCHIVE_TO`, §99): the archive
 * copy of the declaration is one more message on the same allowance. What the projections
 * below and the task board use; the constant above is the floor without it.
 */
export function messagesPerCompletedRegistration(archiveConfigured: boolean): number {
  return MESSAGES_PER_COMPLETED_REGISTRATION + (archiveConfigured ? 1 : 0);
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
  /** Outbox rows actually transmitted today. What the allowance has actually paid for. */
  sentMessages: number;
  /** Transmitted since the first of the month (UTC): what a monthly plan counts against. */
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
};

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
    .where(and(gte(emailOutbox.sentAt, since), sql`${emailOutbox.sentAt} IS NOT NULL`));

  const [waiting] = await db
    .select({ value: count() })
    .from(emailOutbox)
    .where(sql`${emailOutbox.status} IN ('PENDING', 'PROCESSING')`);

  const [sentMonth] = await db
    .select({ value: count() })
    .from(emailOutbox)
    .where(and(gte(emailOutbox.sentAt, startOfUtcMonth(now)), sql`${emailOutbox.sentAt} IS NOT NULL`));

  const realRegistrations = registrationCounts?.real ?? 0;
  const testRegistrations = registrationCounts?.test ?? 0;
  const sentMessages = sent?.value ?? 0;
  const sentThisMonth = sentMonth?.value ?? 0;

  const setting = await readEmailPlan(db);
  const ceilings = emailCeilings(setting);
  const headroom = emailHeadroom(ceilings, sentMessages, sentThisMonth);

  return {
    realRegistrations,
    testRegistrations,
    projectedMessages:
      (realRegistrations + testRegistrations) *
      messagesPerCompletedRegistration(Boolean(env.DECLARATIONS_ARCHIVE_TO)),
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
