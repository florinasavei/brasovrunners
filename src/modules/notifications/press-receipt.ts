import { eq, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { peekNeonBudgetLevel } from "@/modules/diagnostics/budget-level";
import { governorEffects } from "@/modules/diagnostics/domain/neon-budget";
import { bulkBudget, isBulkMessage } from "./domain/bulk";
import { CLUB_COPY_FLAG } from "./domain/club-notices";
import { receiptValues, type ReceiptRow, summarizeReceipt } from "./domain/press-receipt";
import { SENT_NOW_FLAG } from "./domain/send-at-once";
import { gmailRoadCondition } from "./outbox";
import { readOutboxDelivery } from "./outbox-delivery";
import { readOutboxRoads } from "./outbox-roads";
import type { EmailPress } from "./press";
import { departureContextOf } from "./ui/departure-words";
import { readEmailVolumeToday } from "./volume";

/**
 * The toast's half of a press (the design «telling the owner about every email a staff press sends», 2026-11-03,
 * slice 2): what the press queued, read back by its `press_id` once its transaction committed, and told as the flash's
 * values — `flashOutcome` merges them into the press's toast (`shared/feedback/flash.ts`).
 *
 * One read of the press's rows (the type, the flags the departure needs, the test mark — never an address the flash
 * would carry), and, when there are any, the queue's own context for when each leaves: the delivery timing and the next
 * tick (`outbox-delivery.ts`), Mailgun's stop and the day's room (`volume.ts`), the same the queue panel and «Emailuri
 * azi» read (`ui/departure-words.ts#departureContextOf`), so the toast says the time they say. The governor's floor is
 * the level this instance last heard (`budget-level.ts`), never a request to Neon from inside a press. A press that
 * queued nothing reads nothing more, and the toast says nothing about email.
 *
 * The values are tokens, counts and instants: an email's type by its name in the code, how many, when — never a name or
 * an address (§384's cookie rule, amended to carry them).
 */
export async function pressMailValues<T extends Record<string, unknown>>(
  db: Database<T>,
  press: EmailPress,
  extras: { road?: "mailgun" | "gmail" | null; zitadel?: boolean },
  now: Date,
): Promise<Record<string, string>> {
  // Most presses of a busy day queue nothing (a save, a note): one look by the press's index, and nothing more read.
  const [any] = await db.select({ id: emailOutbox.id }).from(emailOutbox).where(eq(emailOutbox.pressId, press.id)).limit(1);
  if (!any) return {};
  const roads = await readOutboxRoads(db, now);
  const read = await db
    .select({
      messageType: emailOutbox.messageType,
      status: emailOutbox.status,
      attemptCount: emailOutbox.attemptCount,
      nextAttemptAt: emailOutbox.nextAttemptAt,
      createdAt: emailOutbox.createdAt,
      lastError: emailOutbox.lastError,
      // The payload's flags only — a family's hold (§519), a press's «now» (§540), a club copy (§320) — never its words.
      familyHeld: sql<boolean>`coalesce((${emailOutbox.payloadJson} ->> 'sittingHeld') = 'true' or (${emailOutbox.payloadJson} ->> 'familyHeld') = 'true', false)`,
      sentNow: sql<boolean>`coalesce((${emailOutbox.payloadJson} ->> ${SENT_NOW_FLAG}::text) = 'true', false)`,
      onMailgunRoad: roads ? sql<boolean>`not coalesce((${gmailRoadCondition(roads)}), false)` : sql<boolean>`true`,
      clubCopy: sql<boolean>`coalesce((${emailOutbox.payloadJson} ->> ${CLUB_COPY_FLAG}::text) = 'true', false)`,
      test: sql<boolean>`coalesce(${registrations.kind} = 'TEST', false)`,
    })
    .from(emailOutbox)
    .leftJoin(registrations, eq(registrations.id, emailOutbox.registrationId))
    .where(eq(emailOutbox.pressId, press.id));
  if (read.length === 0) return {};

  const rows: ReceiptRow[] = read.map((row) => ({
    ...row,
    familyHeld: Boolean(row.familyHeld),
    sentNow: Boolean(row.sentNow),
    onMailgunRoad: Boolean(row.onMailgunRoad),
    clubCopy: Boolean(row.clubCopy),
    test: Boolean(row.test),
  }));
  const [volume, delivery] = await Promise.all([
    readEmailVolumeToday(db, now),
    readOutboxDelivery(db, now, governorEffects(peekNeonBudgetLevel(now)).jobFloorMinutes),
  ]);
  // Today's room for a newsletter (§445): what the plan leaves past the reserve, less the bulk rows already waiting ahead.
  const room = bulkBudget(volume);
  const ours = rows.filter((row) => isBulkMessage(row.messageType)).length;
  const bulkRoom = room === null ? null : Math.max(0, room - Math.max(0, volume.bulkWaitingMessages - ours));
  const receipt = summarizeReceipt(press.cause, rows, departureContextOf({ now, delivery, volume }), bulkRoom);
  return receiptValues(receipt, now, extras);
}
