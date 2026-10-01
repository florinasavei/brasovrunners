import { gt, inArray, or, sql } from "drizzle-orm";
import { emailOutbox, type EmailMessageType } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { governorEffects } from "@/modules/diagnostics/domain/neon-budget";
import { peekNeonBudgetLevel } from "@/modules/diagnostics/budget-level";
import { readJobCadence } from "@/modules/jobs/cadence";
import { pingerCadenceMinutes } from "@/modules/jobs/quiet-hours";
import { FAMILY_HELD, FAMILY_HELD_UNTIL, SITTING_HELD } from "@/modules/registrations/domain/family-sitting";
import { env } from "@/shared/config/env";
import { isBulkMessage } from "./domain/bulk";
import { CLUB_COPY_FLAG } from "./domain/club-notices";
import { type EmailDelay, type EmailDelayFacts, isWaitedFor, judgeEmailDelay } from "./domain/email-delay";
import { DEFAULT_EMAIL_PLAN, emailPlanSettingSchema } from "./domain/email-plan";
import { defaultEmailTransportFor, emailTransportSettingSchema } from "./domain/email-transport";
import { emailWaitMinutes } from "./domain/email-wait";
import { hourlyRoom, PACE_EVIDENCE_MS, PACE_WINDOW_MS, paceHolds, RATE_PAUSE_ERROR_PREFIX } from "./domain/hourly-pace";
import { PROCESSING_LOCK_TIMEOUT_MS } from "./domain/retry";
import { readDeliveryTiming } from "./delivery-timing";
import { EMAIL_PLAN_SETTING_KEY } from "./email-plan";
import { EMAIL_TRANSPORT_SETTING_KEY, gmailIsConfigured } from "./email-transport";
import { carriedByMailgunApi } from "./hourly-pace";
import type { OutboxRoads } from "./outbox";
import { fallbackNoticeForOutbox, outboxRoadsFor } from "./outbox-roads";

/**
 * «Emailurile noastre întârzie acum» (§NNN): the outbox as a public page reads it — how many messages
 * people wait for, since when, and whether Mailgun's road is stopped. The judgement is pure
 * (`domain/email-delay.ts`); this is the read, and the public pages ask it through the data cache
 * (`cachedEmailDelay`, a minute), never directly.
 *
 * **One query.** A public read is paid for in Neon's wakes (§333), so the facts come in a single
 * statement: the outbox grouped by message type and club-copy flag — the two things the roads and the
 * "waited for" rule are decided by — with the email plan and the transport setting as two scalar
 * sub-selects beside them. The groups are classified here, in memory: a handful of rows. The scan is
 * the rows not yet sent and the ones sent in the last ninety minutes, the same ranges
 * `/api/health` and the claim already read through their indexes (§98, §605).
 */

/** A row more than this far in the future, put off by a provider, is waiting for its allowance's reset (`health.ts`'s `DEFERRED_BEYOND_MS`). */
const DEFERRED_BEYOND_MS = 60 * 60_000;

/** One group of the query: a message type, club copy or not. */
type FactsGroup = {
  messageType: EmailMessageType;
  clubCopy: boolean;
  waiting: number;
  waitingSince: unknown;
  deferredUntil: unknown;
  pausedUntil: unknown;
  oldestSentInHour: unknown;
  inFlight: number;
  sentLastHour: number;
  carriedRecently: number;
  planValue: unknown;
  transportValue: unknown;
};

/** The outbox's facts for the judgement (`EmailDelayFacts`), in one statement. */
export async function readEmailDelayFacts<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<EmailDelayFacts> {
  const at = (ms: number) => sql`${new Date(now.getTime() + ms).toISOString()}::timestamptz`;
  const nowSql = at(0);
  // The flag as a literal (a code constant), so the select and the GROUP BY are the same expression.
  const clubCopy = sql<boolean>`coalesce(${emailOutbox.payloadJson} -> ${sql.raw(`'${CLUB_COPY_FLAG}'`)} = 'true'::jsonb, false)`;
  /*
    The club's own hold, told by its markers and nothing else (§519, §540): a row a family's sitting
    holds says so in its payload — `sittingHeld` on a verification email, `familyHeld` on any other
    message, as the queue panel reads them (`queue.ts`) — and a family's one confirmation is the
    `REGISTRATION_CONFIRMED` that names its sitting (`familySittingId`, `queueFamilyConfirmed`). Club
    copies carry their participant's payload, and so the same marks. While such a row's not-before is
    ahead and no provider gave it a reason, the family's screen already named the hour it leaves.
    Never inferred from a row's shape: a row Gmail's pace or Mailgun's pause handed to a later run
    looks the same — a future `next_attempt_at`, no reason — and is waiting, not held.
  */
  const familyMark = sql`coalesce((${emailOutbox.payloadJson} ->> ${SITTING_HELD}::text) = 'true' OR (${emailOutbox.payloadJson} ->> ${FAMILY_HELD}::text) = 'true' OR (${emailOutbox.messageType} = 'REGISTRATION_CONFIRMED' AND (${emailOutbox.payloadJson} ->> 'familySittingId') IS NOT NULL), false)`;
  // `coalesce`: a row never touched has no `next_attempt_at`, and NOT of a NULL comparison is NULL, not true.
  const clubHold = sql`coalesce(${emailOutbox.status} = 'PENDING' AND ${emailOutbox.nextAttemptAt} > ${nowSql} AND ${emailOutbox.lastError} IS NULL AND ${familyMark}, false)`;
  // Waiting: not sent yet — due, being sent, or handed to a later run (a pace, a pause, a deferral, a retry).
  const waiting = sql`(${emailOutbox.status} IN ('PENDING', 'PROCESSING') AND NOT ${clubHold})`;
  /*
    Since its creation — a hand-off to a later run never restarts the wait. A family's row, its hold
    over, from the instant it was let go: the person was told that hour. That instant is the one the
    family's path wrote into the payload with the not-before (`heldUntil`: the window's end, the
    wizard's half hour, or «Gata»), never `next_attempt_at` itself — a failed attempt rewrites that to
    the retry's turn, usually ahead, and the wait would read nothing while the family waited on. A
    marked row queued before `heldUntil` was written keeps the earlier rule — its not-before while no
    provider gave it a reason, else its creation — which over-reports a failed one's wait by at most
    one hold window, and only for rows already in the queue when this deployed.
  */
  const releasedAt = sql`(${emailOutbox.payloadJson} ->> ${FAMILY_HELD_UNTIL}::text)::timestamptz`;
  const waitedSince = sql`(CASE
    WHEN ${familyMark} AND (${emailOutbox.payloadJson} ->> ${FAMILY_HELD_UNTIL}::text) IS NOT NULL THEN greatest(${emailOutbox.createdAt}, ${releasedAt})
    WHEN ${familyMark} AND ${emailOutbox.lastError} IS NULL AND ${emailOutbox.nextAttemptAt} > ${emailOutbox.createdAt} THEN ${emailOutbox.nextAttemptAt}
    ELSE ${emailOutbox.createdAt} END)`;
  // Put off by a provider, with its reason, past the hour: an allowance's reset.
  const deferred = sql`(${emailOutbox.status} = 'PENDING' AND ${emailOutbox.lastError} IS NOT NULL AND ${emailOutbox.nextAttemptAt} > ${at(DEFERRED_BEYOND_MS)})`;
  // The mark only the row Mailgun refused carries (`outbox.ts`, `releaseForPause`), its pause not over.
  const pausedRow = sql`(${emailOutbox.status} = 'PENDING' AND ${emailOutbox.lastError} LIKE ${`${RATE_PAUSE_ERROR_PREFIX}%`} AND ${emailOutbox.nextAttemptAt} > ${nowSql})`;
  // Claimed and still held: leaving now, so already spent from the hour (`countMailgunHour`).
  const held = sql`(${emailOutbox.status} = 'PROCESSING' AND ${emailOutbox.lockedAt} > ${at(-PROCESSING_LOCK_TIMEOUT_MS)})`;
  const sentSince = (ms: number) =>
    sql<number>`coalesce(sum(coalesce(${emailOutbox.recipientCount}, 1)) FILTER (WHERE ${emailOutbox.sentAt} > ${at(-ms)} AND ${carriedByMailgunApi}), 0)::int`;

  const groups: FactsGroup[] = await db
    .select({
      messageType: emailOutbox.messageType,
      clubCopy,
      waiting: sql<number>`(count(*) FILTER (WHERE ${waiting}))::int`,
      waitingSince: sql<unknown>`min(${waitedSince}) FILTER (WHERE ${waiting})`,
      deferredUntil: sql<unknown>`min(${emailOutbox.nextAttemptAt}) FILTER (WHERE ${waiting} AND ${deferred})`,
      pausedUntil: sql<unknown>`max(${emailOutbox.nextAttemptAt}) FILTER (WHERE ${pausedRow})`,
      // When Mailgun's hour frees its first place: the oldest send still inside the window.
      oldestSentInHour: sql<unknown>`min(${emailOutbox.sentAt}) FILTER (WHERE ${emailOutbox.sentAt} > ${at(-PACE_WINDOW_MS)} AND ${carriedByMailgunApi})`,
      inFlight: sql<number>`(count(*) FILTER (WHERE ${held}))::int`,
      sentLastHour: sentSince(PACE_WINDOW_MS),
      carriedRecently: sentSince(PACE_EVIDENCE_MS),
      planValue: sql<unknown>`(SELECT value FROM platform_settings WHERE key = ${EMAIL_PLAN_SETTING_KEY})`,
      transportValue: sql<unknown>`(SELECT value FROM platform_settings WHERE key = ${EMAIL_TRANSPORT_SETTING_KEY})`,
    })
    .from(emailOutbox)
    .where(or(inArray(emailOutbox.status, ["PENDING", "PROCESSING"]), gt(emailOutbox.sentAt, new Date(now.getTime() - PACE_EVIDENCE_MS))))
    .groupBy(emailOutbox.messageType, clubCopy);

  // The Gmail takeover (§622) carries a stop only once the notice in force names it: the outbox's own
  // reader, asked only when the switch could act — so a stop Gmail carries is not read as a stop here.
  const transport = emailTransportSettingSchema.safeParse(groups[0]?.transportValue);
  const transportSetting = transport.success ? transport.data : defaultEmailTransportFor(env.APP_ENV);
  const noticeNamesFallback = await fallbackNoticeForOutbox(db, transportSetting, gmailIsConfigured(), now);
  return factsFromGroups(groups, noticeNamesFallback);
}

/** The groups, classified: the roads from the transport setting, the pace from the plan — as `readEmailPlan` and `readOutboxRoads` read them. */
function factsFromGroups(groups: readonly FactsGroup[], noticeNamesFallback: boolean): EmailDelayFacts {
  const settings = groups[0];
  const plan = emailPlanSettingSchema.safeParse(settings?.planValue);
  const hourlyAllowance = plan.success ? plan.data.hourlyAllowance : DEFAULT_EMAIL_PLAN.hourlyAllowance;
  const transport = emailTransportSettingSchema.safeParse(settings?.transportValue);
  const roads = outboxRoadsFor(transport.success ? transport.data : defaultEmailTransportFor(env.APP_ENV), gmailIsConfigured(), noticeNamesFallback);

  const facts: EmailDelayFacts = {
    queued: 0,
    queuedOnMailgun: 0,
    aheadOnMailgun: 0,
    oldestWaitingSince: null,
    hourFreesAt: null,
    deferredUntil: null,
    pausedUntil: null,
    hourlyAllowance,
    hourlyRemaining: null,
    paceBinding: false,
  };
  let sentLastHour = 0;
  let inFlight = 0;
  let carriedRecently = 0;
  for (const group of groups) {
    // Every row Mailgun's API took counts against its hour, whatever road it was meant for (`carriedByMailgunApi`).
    sentLastHour += group.sentLastHour;
    carriedRecently += group.carriedRecently;
    const oldestSent = asDate(group.oldestSentInHour);
    facts.hourFreesAt = earliest(facts.hourFreesAt, oldestSent === null ? null : new Date(oldestSent.getTime() + PACE_WINDOW_MS));
    const mailgun = !onGmailRoad(group, roads);
    if (mailgun) {
      inFlight += group.inFlight;
      facts.pausedUntil = latest(facts.pausedUntil, asDate(group.pausedUntil));
      if (!isBulkMessage(group.messageType)) facts.aheadOnMailgun += group.waiting;
    }
    if (!isWaitedFor(group.messageType, group.clubCopy) || group.waiting === 0) continue;
    facts.queued += group.waiting;
    if (mailgun) facts.queuedOnMailgun += group.waiting;
    facts.oldestWaitingSince = earliest(facts.oldestWaitingSince, asDate(group.waitingSince));
    facts.deferredUntil = earliest(facts.deferredUntil, asDate(group.deferredUntil));
  }
  facts.hourlyRemaining = hourlyRoom(hourlyAllowance, sentLastHour + inFlight);
  facts.paceBinding = paceHolds({ hourlyAllowance, carriedRecently, inFlight });
  return facts;
}

/** `outbox.ts`'s rule for one row, for a group: a club copy rides the club copies' road, any other row its type's. */
function onGmailRoad(group: Pick<FactsGroup, "messageType" | "clubCopy">, roads: OutboxRoads | undefined): boolean {
  if (!roads) return false;
  return group.clubCopy ? roads.gmailClubCopies : roads.gmailMessageTypes.includes(group.messageType);
}

/** A timestamp as the driver returns an aggregate of one: a Date, a string, or null. */
function asDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function earliest(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * The wait the platform promises a message queued now (`emailWaitMinutes`, §513), from the two
 * settings themselves — for a caller with no data cache. The public pages pass the cached one.
 */
async function promisedWaitMinutes<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number | null> {
  const [{ timing }, { minutes }] = await Promise.all([readDeliveryTiming(db), readJobCadence(db)]);
  return emailWaitMinutes({
    timing,
    pingerMinutes: pingerCadenceMinutes(now),
    intervalMinutes: minutes,
    governorFloorMinutes: governorEffects(peekNeonBudgetLevel(now)).jobFloorMinutes,
  });
}

/**
 * Whether the club's emails are late now (§NNN): the facts, judged against the wait the platform
 * promises. `promisedWait` is that wait when the caller already has it (`cachedEmailWaitMinutes`);
 * absent, it is read from the settings.
 */
export async function readEmailDelay<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  promisedWait?: number | null,
): Promise<EmailDelay> {
  const [facts, promised] = await Promise.all([
    readEmailDelayFacts(db, now),
    promisedWait !== undefined ? Promise.resolve(promisedWait) : promisedWaitMinutes(db, now),
  ]);
  return judgeEmailDelay(facts, promised, now);
}
