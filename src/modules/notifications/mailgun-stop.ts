import { and, eq, gt, type SQL, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import type { Database } from "@/db/types";
import { ALLOWANCE_DEFERRED_ERROR_PREFIX, type MailgunStop, stopInForce } from "./domain/mailgun-stop";
import { RATE_PAUSE_ERROR_PREFIX } from "./domain/hourly-pace";

/**
 * Whether Mailgun's road is closed now, and until when (§622, `domain/mailgun-stop.ts`).
 *
 * Two witnesses, read in **one query**:
 *
 * - **the rows** — a waiting Mailgun-road row carrying the pause mark (§605) or the allowance mark,
 *   its turn still ahead: what BR-V2.53's claim already read for the pause;
 * - **the stop record** — `platform_settings.mailgunStop`, written by the outbox the moment Mailgun
 *   refused (`recordMailgunStop`). It is what keeps the road closed once the refused row itself has
 *   left on Gmail's road: the row's mark goes with it, and without the record the next claim would
 *   read an open road and knock on Mailgun during the pause it asked for.
 *
 * `mailgunRoad` narrows the rows to Mailgun's road when Gmail carries some of the mail (`outbox.ts`):
 * a Gmail row's mark, were one ever written, never closes Mailgun's road.
 */
export const MAILGUN_STOP_KEY = "mailgunStop";

/** The waiting rows a provider's stop holds, as SQL: marked, not yet due. */
export function heldByMailgunCondition(): SQL {
  return sql`(${emailOutbox.lastError} LIKE ${`${RATE_PAUSE_ERROR_PREFIX}%`} OR ${emailOutbox.lastError} LIKE ${`${ALLOWANCE_DEFERRED_ERROR_PREFIX}%`})`;
}

/**
 * A row no family sitting may move (§622, the review of BR-V2.53): one that carries a provider's
 * stop. Holding it to the sitting's window would stretch the pause it marks; releasing it at «Gata»
 * would end the pause early. So the sitting's hold and release statements leave its turn alone. The
 * replace may delete it: the stop is recorded apart from the row (`recordMailgunStop`), so its going
 * ends no pause, and keeping it would send the person both messages.
 */
export function notHeldByMailgun(): SQL {
  return sql`(${emailOutbox.lastError} IS NULL OR NOT ${heldByMailgunCondition()})`;
}

function dateOf(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const at = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(at.getTime()) ? null : at;
}

export async function readMailgunStop<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  mailgunRoad?: SQL,
): Promise<MailgunStop | null> {
  const ahead = and(eq(emailOutbox.status, "PENDING"), gt(emailOutbox.nextAttemptAt, now), mailgunRoad) as SQL;
  const paused = and(ahead, sql`${emailOutbox.lastError} LIKE ${`${RATE_PAUSE_ERROR_PREFIX}%`}`) as SQL;
  const allowance = and(ahead, sql`${emailOutbox.lastError} LIKE ${`${ALLOWANCE_DEFERRED_ERROR_PREFIX}%`}`) as SQL;
  const [row] = await db
    .select({
      pausedUntil: sql<unknown>`max(case when ${paused} then ${emailOutbox.nextAttemptAt} end)`,
      allowanceUntil: sql<unknown>`max(case when ${allowance} then ${emailOutbox.nextAttemptAt} end)`,
      // The record, by primary key, in the same round trip.
      record: sql<unknown>`(select ${platformSettings.value} from ${platformSettings} where ${platformSettings.key} = ${MAILGUN_STOP_KEY})`,
    })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, "PENDING"), gt(emailOutbox.nextAttemptAt, now), heldByMailgunCondition(), mailgunRoad));
  const record = readRecord(row?.record);
  const later = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));
  return stopInForce(
    {
      pausedUntil: later(dateOf(row?.pausedUntil), record?.kind === "paused" ? record.until : null),
      allowanceUntil: later(dateOf(row?.allowanceUntil), record?.kind === "allowance" ? record.until : null),
    },
    now,
  );
}

function readRecord(value: unknown): MailgunStop | null {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (!parsed || typeof parsed !== "object") return null;
  const { kind, until } = parsed as { kind?: unknown; until?: unknown };
  const at = dateOf(until);
  return (kind === "paused" || kind === "allowance") && at ? { kind, until: at } : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Write the stop Mailgun just announced (§622). One upsert, keeping whichever stop ends later — an
 * allowance spent until midnight is not shortened by a fifteen-minute pause met on the way, and a
 * pause is not written over a longer one of its own kind — and replacing one that has already ended.
 */
export async function recordMailgunStop<T extends Record<string, unknown>>(db: Database<T>, stop: MailgunStop, at: Date): Promise<void> {
  const value = { kind: stop.kind, until: stop.until.toISOString(), at: at.toISOString() };
  await db
    .insert(platformSettings)
    .values({ key: MAILGUN_STOP_KEY, value, updatedAt: at, updatedByStaffUserId: null })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: {
        value: sql`case when (${platformSettings.value} ->> 'until')::timestamptz > ${stop.until.toISOString()}::timestamptz then ${platformSettings.value} else excluded.value end`,
        updatedAt: at,
        updatedByStaffUserId: null,
      },
    });
}
