import { and, count, gte, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";

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
 * Three, from §16.3's message list, for a registration that completes normally:
 * `VERIFY_REGISTRATION_EMAIL`, `COMPLETE_DECLARATION`, `REGISTRATION_CONFIRMED`.
 *
 * An entrant who lands on the waiting list costs more (`WAITLIST_JOINED`, then
 * `WAITLIST_SPOT_OFFER`), and one who cancels costs another. So three is the *floor* for a
 * completed registration and the projection below understates a busy day rather than crying
 * wolf — which is the right direction for a number somebody uses to decide whether to upgrade.
 */
export const MESSAGES_PER_COMPLETED_REGISTRATION = 3;

/**
 * Mailgun Free: 100 messages a day (`docs/PLATFORM.md`, limit 1 of the four that bite).
 *
 * A constant and not configuration, deliberately. It is a fact about the plan the club is on,
 * it changes when somebody upgrades — at which point Basic removes the daily limit entirely and
 * this number stops meaning anything — and an environment variable would invite it being set to
 * whatever makes the page look calm. The day the club is on Basic, this becomes a decision to
 * record in `docs/PLATFORM.md` and not a value to edit in a dashboard.
 */
export const MAILGUN_FREE_DAILY_MESSAGES = 100;

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
  /** Outbox rows actually transmitted today. What the allowance has actually paid for. */
  sentMessages: number;
  allowance: number;
  /** `allowance − sent`, never below zero. What is left of today. */
  remaining: number;
};

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

  const realRegistrations = registrationCounts?.real ?? 0;
  const testRegistrations = registrationCounts?.test ?? 0;
  const sentMessages = sent?.value ?? 0;

  return {
    realRegistrations,
    testRegistrations,
    projectedMessages:
      (realRegistrations + testRegistrations) * MESSAGES_PER_COMPLETED_REGISTRATION,
    queuedMessages: queued?.value ?? 0,
    sentMessages,
    allowance: MAILGUN_FREE_DAILY_MESSAGES,
    remaining: Math.max(0, MAILGUN_FREE_DAILY_MESSAGES - sentMessages),
  };
}
