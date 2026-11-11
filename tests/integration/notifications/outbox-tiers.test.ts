import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type EmailMessageType, emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { STAFF_RESERVE_HELD_ERROR } from "@/modules/notifications/domain/bulk";
import { nextAllowanceResetAt } from "@/modules/notifications/domain/retry";
import { EMAIL_PLAN_SETTING_KEY } from "@/modules/notifications/email-plan";
import { checkEmailHealth } from "@/modules/notifications/health";
import { claimOutboxBatch, type OutboxRow, processOutboxBatch } from "@/modules/notifications/outbox";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-080-02 — «Cere reconfirmarea», part two (the decision «Cere reconfirmarea»): a send of two hundred never holds the
 * registrations' own emails. The outbox claims in three tiers — a registration's own messages, then the staff sends to many
 * (`BULK_CLUB_COPY_MESSAGES`, their club copy with them), then the bulk ones — and a staff send keeps `max(10, 10%)` of the
 * day's allowance for the first tier; rows held for it wait for the reset, marked, and `/api/health` reads them as the reserve
 * working. «Trimite acum» and the batch size are unchanged. PGlite is one connection: the order and the caps are what is
 * proven here, never `SKIP LOCKED` (see `outbox.test.ts`).
 */
const NOW = new Date("2026-11-11T10:00:00.000Z");

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

describe("BR-REQ-080-02 the outbox's three tiers and the staff sends' reserve", () => {
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

  /** One row, queued `at`: a made-up address, the type's own key. */
  async function queue(messageType: EmailMessageType, at: Date, extra: Partial<typeof emailOutbox.$inferInsert> = {}) {
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
        createdAt: at,
        ...extra,
      })
      .returning();
    return row;
  }

  /** A burst of `count` organizer's messages, a millisecond apart, starting at `from`. */
  async function burst(count: number, from: Date) {
    const values = Array.from({ length: count }, (_, index) => {
      serial += 1;
      return {
        participantId: null,
        registrationId: null,
        messageType: "ORGANIZER_MESSAGE" as const,
        locale: "ro" as const,
        recipientEmail: `runner${serial}@example.test`,
        payloadJson: { subject: { ro: "a", en: "b" }, body: { ro: "c", en: "d" }, askReconfirm: true },
        idempotencyKey: `organizer-message:burst:registration:${serial}`,
        createdAt: new Date(from.getTime() + index),
      };
    });
    await db.insert(emailOutbox).values(values);
  }

  /** No ceiling and no pace: only the tiers decide. */
  async function noCeiling() {
    await db.insert(platformSettings).values({ key: EMAIL_PLAN_SETTING_KEY, value: { plan: "CUSTOM", dailyAllowance: null, monthlyAllowance: null, hourlyAllowance: null, note: "" } });
  }

  /** What Mailgun already carried today, three hours ago — out of the hour's window, in the day's count. */
  async function sentToday(count: number) {
    const at = new Date(NOW.getTime() - 3 * 60 * 60_000);
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
          sentAt: at,
          createdAt: at,
        };
      }),
    );
  }

  it("claims a verification queued after a burst of 200 before the burst's remaining rows, and the burst still drains completely", async () => {
    await noCeiling();
    await burst(200, new Date(NOW.getTime() - 60_000));
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

    // And the burst drains, batch after batch, to the last row.
    let at = NOW.getTime() + 3_000;
    for (let pass = 0; pass < 20; pass += 1) {
      const { claimed } = await processOutboxBatch(db, { sender: recordingSender(), render, now: new Date((at += 1_000)) });
      if (claimed === 0) break;
    }
    const left = await db.select({ status: emailOutbox.status }).from(emailOutbox).where(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"));
    expect(left).toHaveLength(200);
    expect(left.every((row) => row.status === "SENT")).toBe(true);
  });

  it("puts the registrations' own first, the staff sends and their club copy second, the bulk ones last", async () => {
    await noCeiling();
    const newsletter = await queue("NEWSLETTER", new Date(NOW.getTime() - 50_000));
    const copy = await queue("ORGANIZER_MESSAGE", new Date(NOW.getTime() - 40_000), { payloadJson: { clubCopy: true, recipients: 3 } });
    const notice = await queue("EVENT_UPDATE_NOTICE", new Date(NOW.getTime() - 30_000));
    const message = await queue("ORGANIZER_MESSAGE", new Date(NOW.getTime() - 20_000));
    const cancelled = await queue("EVENT_CANCELLED", new Date(NOW.getTime() - 10_000));
    const offer = await queue("WAITLIST_SPOT_OFFER", new Date(NOW.getTime() - 5_000));

    const claimed = await claimOutboxBatch(db, { now: NOW, batchSize: 20 });
    expect(claimed.map((row) => row.id)).toEqual([cancelled.id, offer.id, copy.id, notice.id, message.id, newsletter.id]);
  });

  it("caps the staff tier at its limit and leaves the room to nobody else's harm", async () => {
    await noCeiling();
    await burst(10, new Date(NOW.getTime() - 60_000));
    const own = await queue("COMPLETE_DECLARATION", new Date(NOW.getTime() - 1_000));
    const claimed = await claimOutboxBatch(db, { now: NOW, batchSize: 20, staffLimit: 4 });
    expect(claimed[0].id).toBe(own.id);
    expect(claimed.filter((row) => row.messageType === "ORGANIZER_MESSAGE")).toHaveLength(4);
  });

  it("keeps max(10, 10%) of Free's day for the registrations' own: with 15 left, at most 5 staff rows go, the rest wait for the reset — and health stays ok", async () => {
    await sentToday(85);
    await burst(30, new Date(NOW.getTime() - 60_000));
    for (let index = 0; index < 3; index += 1) await queue("REGISTRATION_CONFIRMED", new Date(NOW.getTime() - 1_000 + index));

    const sender = recordingSender();
    await processOutboxBatch(db, { sender, render, now: NOW });
    const kinds = sender.calls.map((call) => call.subject);
    expect(kinds.filter((kind) => kind === "test-REGISTRATION_CONFIRMED")).toHaveLength(3);
    expect(kinds.filter((kind) => kind === "test-ORGANIZER_MESSAGE")).toHaveLength(5);

    const waiting = await db.select().from(emailOutbox).where(inArray(emailOutbox.status, ["PENDING"]));
    expect(waiting).toHaveLength(25);
    for (const row of waiting) {
      expect(row.messageType).toBe("ORGANIZER_MESSAGE");
      expect(row.attemptCount).toBe(0);
      expect(row.nextAttemptAt?.getTime()).toBe(nextAllowanceResetAt(NOW).getTime());
      expect(row.lastError).toBe(STAFF_RESERVE_HELD_ERROR);
    }
    // The reserve working is not a stalled outbox: waiting, never deferred, never a fault.
    const health = await checkEmailHealth(db, NOW);
    expect(health.status).toBe("ok");
    expect(health.waiting).toBe(25);

    // A verification later today still has its room.
    const verification = await queue("VERIFY_REGISTRATION_EMAIL", new Date(NOW.getTime() + 60_000));
    const after = recordingSender();
    await processOutboxBatch(db, { sender: after, render, now: new Date(NOW.getTime() + 120_000) });
    expect(after.calls.map((call) => call.idempotencyKey)).toEqual([verification.idempotencyKey]);

    // The next day the allowance is back, and the send goes on — its mark cleared as each row leaves.
    const tomorrow = new Date(nextAllowanceResetAt(NOW).getTime() + 60_000);
    const next = recordingSender();
    await processOutboxBatch(db, { sender: next, render, now: tomorrow });
    expect(next.calls).toHaveLength(20);
    const sent = await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, next.calls[0].idempotencyKey));
    expect(sent[0].status).toBe("SENT");
    expect(sent[0].lastError).toBeNull();
  });

  it("keeps a real provider's error on a staff row the reserve holds: the mark replaces only no error or its own", async () => {
    await sentToday(85);
    await burst(30, new Date(NOW.getTime() - 60_000));
    const retrying = await queue("ORGANIZER_MESSAGE", new Date(NOW.getTime() - 30_000), { attemptCount: 1, lastError: "mailgun 503: try later", nextAttemptAt: new Date(NOW.getTime() - 1_000) });
    await processOutboxBatch(db, { sender: recordingSender(), render, now: NOW });
    const [kept] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, retrying.id));
    expect(kept.status).toBe("PENDING");
    expect(kept.lastError).toBe("mailgun 503: try later");
    expect(kept.nextAttemptAt?.getTime()).toBe(nextAllowanceResetAt(NOW).getTime());
    const held = await db.select().from(emailOutbox).where(eq(emailOutbox.lastError, STAFF_RESERVE_HELD_ERROR));
    expect(held.length).toBeGreaterThan(0);
  });

  it("holds nothing when a press sends its own rows now: «Trimite acum» is as it was", async () => {
    await sentToday(85);
    await burst(8, new Date(NOW.getTime() - 60_000));
    const ids = (await db.select({ id: emailOutbox.id }).from(emailOutbox).where(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"))).map((row) => row.id);
    const sender = recordingSender();
    await processOutboxBatch(db, { sender, render, now: NOW, ids, recordRun: false });
    expect(sender.calls).toHaveLength(8);
    const held = await db.select().from(emailOutbox).where(eq(emailOutbox.lastError, STAFF_RESERVE_HELD_ERROR));
    expect(held).toHaveLength(0);
  });
});
