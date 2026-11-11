import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type EmailMessageType, emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { RATE_PAUSE_ERROR_PREFIX } from "@/modules/notifications/domain/hourly-pace";
import { nextAllowanceResetAt } from "@/modules/notifications/domain/retry";
import { EMAIL_PLAN_SETTING_KEY } from "@/modules/notifications/email-plan";
import { checkEmailHealth } from "@/modules/notifications/health";
import { readMailgunStop, recordMailgunStop } from "@/modules/notifications/mailgun-stop";
import { claimOutboxBatch, type OutboxRoads, type OutboxRow, processOutboxBatch } from "@/modules/notifications/outbox";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-080-02 — «Cere reconfirmarea», part two (the decision «Cere reconfirmarea»): a send of two hundred never holds the
 * registrations' own emails, by the order alone. On each road the outbox claims, each step oldest first and in the room
 * the steps before it left: (1) a registration's own messages, (2) «Detalii actualizate», (3) the automatic reminder, (4) the
 * organizers' message (`SEND_TO_MANY_MESSAGE_TYPES`, a club copy with its type), (5) the bulk ones under their cap. No
 * reserve, no hold and no mark for steps 2–4: so a provider's pause on one of their rows never outlives the pause, and
 * `/api/health` reads a send draining at the queue's pace as `ok`. PGlite is one connection: the order and the caps are what
 * is proven here, never `SKIP LOCKED` (see `outbox.test.ts`).
 */
// 10:00 in Brașov (UTC+2 in November): a day hour, the pinger every fifteen minutes.
const NOW = new Date("2026-11-12T08:00:00.000Z");
const MINUTE = 60_000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

async function render(row: OutboxRow): Promise<OutgoingEmail> {
  return { to: row.recipientEmail, subject: `test-${row.messageType}`, html: "<p>x</p>", text: row.messageType, locale: row.locale, idempotencyKey: row.idempotencyKey };
}

function recordingSender(result: SendResult = { outcome: "sent", providerMessageId: "provider:x" }): EmailSender & { calls: OutgoingEmail[] } {
  const calls: OutgoingEmail[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      return result;
    },
  };
}

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
});

/** One row, queued `createdAt`: a made-up address, the type's own key. */
async function queue(messageType: EmailMessageType, createdAt: Date, extra: Partial<typeof emailOutbox.$inferInsert> = {}) {
  serial += 1;
  const [row] = await db
    .insert(emailOutbox)
    .values({
      participantId: null,
      registrationId: null,
      messageType,
      locale: "ro",
      recipientEmail: `person${serial}@example.test`,
      payloadJson: {},
      idempotencyKey: `tier-test:${messageType}:${serial}`,
      createdAt,
      ...extra,
    })
    .returning();
  return row;
}

/** A burst of `count` rows of one send to many, a millisecond apart, starting at `from` — one press, or one job. */
async function burst(count: number, from: Date, messageType: EmailMessageType = "ORGANIZER_MESSAGE", extra: Partial<typeof emailOutbox.$inferInsert> = {}) {
  const values = Array.from({ length: count }, (_, index) => {
    serial += 1;
    return {
      participantId: null,
      registrationId: null,
      messageType,
      locale: "ro" as const,
      recipientEmail: `runner${serial}@example.test`,
      payloadJson: messageType === "ORGANIZER_MESSAGE" ? { subject: { ro: "a", en: "b" }, body: { ro: "c", en: "d" }, askReconfirm: true } : {},
      idempotencyKey: `burst:${messageType}:registration:${serial}`,
      createdAt: new Date(from.getTime() + index),
      ...extra,
    };
  });
  await db.insert(emailOutbox).values(values);
}

/** The plan the club says it is on, and Mailgun's hour; no row is the default (Free, 100 a day, 100 an hour). */
async function plan(value: Record<string, unknown>) {
  await db.insert(platformSettings).values({ key: EMAIL_PLAN_SETTING_KEY, value: { note: "", ...value } });
}
const noCeiling = () => plan({ plan: "CUSTOM", dailyAllowance: null, monthlyAllowance: null, hourlyAllowance: null });
/**
 * Basic, the plan docs/OWNER-TODO.md names for the race month, its hourly pace cleared: with a pace of 100 the hour's own
 * evidence (`paceHolds`) already reads a tail at 80 an hour as paced, so only without one does the probe show the false
 * «stalled» the review measured — from 11:45 here, before this change.
 */
const monthly = () => plan({ plan: "BASIC", dailyAllowance: null, monthlyAllowance: null, hourlyAllowance: null });

/** What Mailgun already carried today, three hours before NOW — out of the hour's window, in the day's count. */
async function sentToday(count: number) {
  const sentAt = at(-180);
  await db.insert(emailOutbox).values(
    Array.from({ length: count }, () => {
      serial += 1;
      return {
        participantId: null,
        registrationId: null,
        messageType: "STAFF_INVITATION" as const,
        locale: "ro" as const,
        recipientEmail: `sent${serial}@example.test`,
        payloadJson: {},
        idempotencyKey: `sent:${serial}`,
        status: "SENT" as const,
        sentAt,
        createdAt: sentAt,
      };
    }),
  );
}

describe("BR-REQ-080-02 the claim's five steps", () => {
  it("claims a verification queued after a burst of 200 before the burst's remaining rows, and the burst drains completely, none sent twice", async () => {
    await noCeiling();
    await burst(200, at(-1));
    const verification = await queue("VERIFY_REGISTRATION_EMAIL", new Date(NOW.getTime() - 1_000));

    const first = recordingSender();
    const summary = await processOutboxBatch(db, { sender: first, render, now: NOW });
    expect(summary.claimed).toBe(20);
    // The verification leaves first, though two hundred were queued before it.
    expect(first.calls[0].idempotencyKey).toBe(verification.idempotencyKey);
    expect(first.calls.slice(1).every((call) => call.subject === "test-ORGANIZER_MESSAGE")).toBe(true);

    // Another one, queued mid-burst, goes ahead of the rest again.
    const later = await queue("REGISTRATION_CONFIRMED", new Date(NOW.getTime() + 1_000));
    const second = recordingSender();
    await processOutboxBatch(db, { sender: second, render, now: new Date(NOW.getTime() + 2_000) });
    expect(second.calls[0].idempotencyKey).toBe(later.idempotencyKey);

    // And the burst drains, batch after batch, to the last row: every key once.
    const keys = [...first.calls, ...second.calls].map((call) => call.idempotencyKey);
    let clock = NOW.getTime() + 3_000;
    for (let pass = 0; pass < 20; pass += 1) {
      const sender = recordingSender();
      const { claimed } = await processOutboxBatch(db, { sender, render, now: new Date((clock += 1_000)) });
      keys.push(...sender.calls.map((call) => call.idempotencyKey));
      if (claimed === 0) break;
    }
    expect(keys).toHaveLength(202);
    expect(new Set(keys).size).toBe(202);
    const rows = await db.select({ status: emailOutbox.status }).from(emailOutbox).where(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"));
    expect(rows).toHaveLength(200);
    expect(rows.every((row) => row.status === "SENT")).toBe(true);
  });

  it("puts a registration's own first, then «Detalii actualizate», the reminder, the organizers' message with its club copy, and the bulk last under its cap", async () => {
    await noCeiling();
    const newsletter = await queue("NEWSLETTER", at(-60));
    const alert = await queue("NEW_EVENT_ALERT", at(-59));
    const rsvp = await queue("RSVP_ASK", at(-58));
    const copy = await queue("ORGANIZER_MESSAGE", at(-50), { payloadJson: { clubCopy: true, recipients: 3 } });
    const reminder = await queue("EVENT_REMINDER", at(-45));
    const message = await queue("ORGANIZER_MESSAGE", at(-40));
    const notice = await queue("EVENT_UPDATE_NOTICE", at(-30));
    const cancelled = await queue("EVENT_CANCELLED", at(-10));
    const offer = await queue("WAITLIST_SPOT_OFFER", at(-5));

    const claimed = await claimOutboxBatch(db, { now: NOW, batchSize: 20, bulkLimit: 2 });
    // The batch handed to the worker is in the claim's order; the bulk takes two of its three, oldest first.
    expect(claimed.map((row) => row.id)).toEqual([cancelled.id, offer.id, notice.id, reminder.id, copy.id, message.id, newsletter.id, alert.id]);
    const [left] = await db.select({ status: emailOutbox.status }).from(emailOutbox).where(eq(emailOutbox.id, rsvp.id));
    expect(left.status).toBe("PENDING");
  });

  it("lets an EVENT_UPDATE_NOTICE queued after a burst leave before the burst's rest", async () => {
    await noCeiling();
    await burst(200, at(-1));
    const notice = await queue("EVENT_UPDATE_NOTICE", new Date(NOW.getTime() - 1_000));
    const sender = recordingSender();
    await processOutboxBatch(db, { sender, render, now: NOW });
    expect(sender.calls[0].idempotencyKey).toBe(notice.idempotencyKey);
    expect(sender.calls).toHaveLength(20);
  });

  it("does not hold a waiting-list offer queued after the reminder's 200 rows: the job's burst is step three, the offer step one", async () => {
    await noCeiling();
    await burst(200, at(-1), "EVENT_REMINDER");
    const offer = await queue("WAITLIST_SPOT_OFFER", new Date(NOW.getTime() - 1_000));
    const sender = recordingSender();
    await processOutboxBatch(db, { sender, render, now: NOW });
    expect(sender.calls[0].idempotencyKey).toBe(offer.idempotencyKey);
    expect(sender.calls.slice(1).every((call) => call.subject === "test-EVENT_REMINDER")).toBe(true);
  });

  it("keeps the same order in the carried path: Gmail carrying for a stopped Mailgun takes the verification before the burst", async () => {
    await noCeiling();
    await burst(30, at(-1));
    const verification = await queue("VERIFY_REGISTRATION_EMAIL", new Date(NOW.getTime() - 1_000));
    await recordMailgunStop(db, { kind: "paused", until: at(15) }, NOW);
    const roads: OutboxRoads = { gmailMessageTypes: [], gmailClubCopies: false, gmailBatchSize: 4, fallbackToGmail: true };
    const claimed = await claimOutboxBatch(db, { now: NOW, batchSize: 20, roads });
    expect(claimed).toHaveLength(4);
    expect(claimed[0].id).toBe(verification.id);
    expect(claimed.slice(1).every((row) => row.messageType === "ORGANIZER_MESSAGE")).toBe(true);
  });

  it("leaves «Trimite acum» as it was: only the press's own rows, past the verification due beside them", async () => {
    await sentToday(85);
    await burst(8, at(-1));
    const verification = await queue("VERIFY_REGISTRATION_EMAIL", new Date(NOW.getTime() - 1_000));
    const ids = (await db.select({ id: emailOutbox.id }).from(emailOutbox).where(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"))).map((row) => row.id);
    const sender = recordingSender();
    await processOutboxBatch(db, { sender, render, now: NOW, ids, recordRun: false });
    expect(sender.calls).toHaveLength(8);
    expect(sender.calls.every((call) => call.subject === "test-ORGANIZER_MESSAGE")).toBe(true);
    const [still] = await db.select({ status: emailOutbox.status }).from(emailOutbox).where(eq(emailOutbox.id, verification.id));
    expect(still.status).toBe("PENDING");
  });
});

describe("BR-REQ-080-02 no hold of a send to many can close Mailgun's road (the review of the reserve)", () => {
  it("a step-four row that got a 429 and is due again does not stop Mailgun's road: the stop is null and a verification queued after it is claimed", async () => {
    await noCeiling();
    // Mailgun paused an earlier batch of the send; the pause ended a minute ago.
    await burst(25, at(-30), "ORGANIZER_MESSAGE", { attemptCount: 0, lastError: `${RATE_PAUSE_ERROR_PREFIX}429 too many requests`, nextAttemptAt: at(-1) });
    expect(await readMailgunStop(db, NOW)).toBeNull();
    const verification = await queue("VERIFY_REGISTRATION_EMAIL", new Date(NOW.getTime() - 1_000));
    const sender = recordingSender();
    await processOutboxBatch(db, { sender, render, now: NOW });
    expect(sender.calls[0].idempotencyKey).toBe(verification.idempotencyKey);
    // What the batch had no room for keeps its own turn: never moved to the reset with the pause mark on it.
    const waiting = await db.select().from(emailOutbox).where(rowsOf("PENDING"));
    expect(waiting).toHaveLength(6);
    for (const row of waiting) expect(row.nextAttemptAt?.getTime()).toBe(at(-1).getTime());
    expect(await readMailgunStop(db, NOW)).toBeNull();
  });

  it("and at the moment a daily allowance is spent: the bulk is held for the reset, the send to many is not, and the road stays open", async () => {
    // Free's 100 a day, all of it carried today.
    await sentToday(100);
    await queue("NEWSLETTER", at(-90));
    await burst(25, at(-30), "ORGANIZER_MESSAGE", { lastError: `${RATE_PAUSE_ERROR_PREFIX}429 too many requests`, nextAttemptAt: at(-1) });
    await processOutboxBatch(db, { sender: recordingSender(), render, now: NOW });
    const [newsletter] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "NEWSLETTER"));
    expect(newsletter.nextAttemptAt?.getTime()).toBe(nextAllowanceResetAt(NOW).getTime());
    const rest = await db.select().from(emailOutbox).where(rowsOf("PENDING", "ORGANIZER_MESSAGE"));
    expect(rest.length).toBeGreaterThan(0);
    for (const row of rest) expect(row.nextAttemptAt?.getTime()).toBe(at(-1).getTime());
    expect(await readMailgunStop(db, NOW)).toBeNull();

    const verification = await queue("VERIFY_REGISTRATION_EMAIL", at(1));
    const sender = recordingSender();
    await processOutboxBatch(db, { sender, render, now: at(2) });
    expect(sender.calls[0].idempotencyKey).toBe(verification.idempotencyKey);
  });
});

/** Rows of a status, and of a type when given. */
function rowsOf(status: "PENDING" | "SENT", messageType?: EmailMessageType) {
  return and(eq(emailOutbox.status, status), messageType ? eq(emailOutbox.messageType, messageType) : undefined);
}

describe("BR-REQ-080-02 /api/health while a send to many drains at the queue's pace", () => {
  /**
   * The scheduled passes of a day: one every fifteen minutes from 10:00, a batch each, health read before every pass —
   * so at every hour and every quarter between — until the last row has left. Returns the passes it took.
   */
  async function drain(): Promise<number> {
    for (let pass = 0; pass < 40; pass += 1) {
      const now = at(pass * 15);
      const health = await checkEmailHealth(db, now);
      expect(health.status, `pass ${pass}: ${JSON.stringify({ overdue: health.overdue, deferred: health.deferred, failed: health.failed })}`).toBe("ok");
      const { claimed } = await processOutboxBatch(db, { sender: recordingSender(), render, now });
      if (claimed === 0) return pass;
    }
    throw new Error("the queue never drained");
  }

  it("reads ok at every pass for 201 organizers' messages queued at 10:00 on a monthly plan, until the last leaves (the review measured stalled from 11:30)", async () => {
    await monthly();
    await burst(200, NOW);
    await queue("ORGANIZER_MESSAGE", NOW, { payloadJson: { clubCopy: true, recipients: 200 } });
    const passes = await drain();
    // 201 at twenty a pass: eleven passes, the last at 12:30 — well past the ninety minutes a registration's own email is late at.
    expect(passes).toBe(11);
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.status, "PENDING"))).toHaveLength(0);
  });

  it("reads ok the same way for the reminder's 200 rows", async () => {
    await monthly();
    await burst(200, NOW, "EVENT_REMINDER");
    expect(await drain()).toBe(10);
  });

  it("still reads stalled for a registration's own message whose turn passed by the allowance", async () => {
    await monthly();
    await burst(50, at(-200));
    await queue("VERIFY_REGISTRATION_EMAIL", at(-200));
    const health = await checkEmailHealth(db, NOW);
    expect(health.status).toBe("stalled");
    expect(health.overdue).toBe(1);
  });

  it("still counts a step-four row a provider keeps refusing: retrying past six attempts, and failed", async () => {
    await monthly();
    await queue("ORGANIZER_MESSAGE", at(-30), { attemptCount: 6, lastError: "mailgun 503: try later", nextAttemptAt: at(-5) });
    const retrying = await checkEmailHealth(db, NOW);
    expect(retrying.status).toBe("stalled");
    expect(retrying.retryingLate).toBe(1);
    expect(retrying.lastError).toBe("mailgun 503: try later");

    await resetTables(db);
    await monthly();
    await queue("ORGANIZER_MESSAGE", at(-30), { status: "FAILED", attemptCount: 1, lastError: "mailgun 400: rejected" });
    const failed = await checkEmailHealth(db, NOW);
    expect(failed.status).toBe("stalled");
    expect(failed.failed).toBe(1);
  });
});
