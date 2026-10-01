import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { RATE_PAUSE_ERROR_PREFIX } from "@/modules/notifications/domain/hourly-pace";
import { MAX_SEND_ATTEMPTS } from "@/modules/notifications/domain/retry";
import { EMAIL_PLAN_SETTING_KEY, readEmailPlan, updateEmailPlan } from "@/modules/notifications/email-plan";
import { checkEmailHealth, EMAIL_HEALTH_THRESHOLDS } from "@/modules/notifications/health";
import { claimOutboxBatch, type OutboxRoads, type OutboxRow, processOutboxBatch } from "@/modules/notifications/outbox";
import { assertRoomToSendNow, SEND_NOW_HOUR_SPENT, SendNowRefused } from "@/modules/notifications/send-at-once";
import { sendOutboxNow } from "@/modules/notifications/send-now";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/*
  The press's sender, swapped by one test for a deployment with the club's Gmail (§443): this
  environment has no Gmail account, so `createOutboxSender` would put every row on Mailgun's road.
*/
const gmailDeployment = vi.hoisted(() => ({ current: null as null | { roads: OutboxRoads; sender: EmailSender } }));
vi.mock("@/modules/notifications/outbox-sender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/notifications/outbox-sender")>();
  return {
    ...actual,
    createOutboxSender: async (...args: Parameters<typeof actual.createOutboxSender>) => {
      const made = await actual.createOutboxSender(...args);
      const swap = gmailDeployment.current;
      return swap ? { ...made, roads: swap.roads, sender: swap.sender, route: () => "gmail" as const } : made;
    },
  };
});
vi.mock("@/modules/notifications/outbox-roads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/notifications/outbox-roads")>();
  return {
    ...actual,
    readOutboxRoads: async (...args: Parameters<typeof actual.readOutboxRoads>) => gmailDeployment.current?.roads ?? actual.readOutboxRoads(...args),
  };
});

/**
 * §NNN (amending §100 and §163) — the outbox paces Mailgun to an hourly allowance, and a rate
 * refusal is a pause, never a loss.
 *
 * Mailgun's probation: a hundred messages an hour per domain on a new or newly paid account, and
 * past that the account is disabled for a while. The claim takes no more of Mailgun's road than the
 * trailing hour leaves; Gmail's road is not held to it; what is not claimed waits untouched; a 429 or
 * the probation's "temporarily disabled" hands the row back with its attempt, however many times.
 */
const NOW = new Date("2026-10-01T09:30:00.000Z");
const MINUTE = 60_000;

/** Gmail carries the organizer's messages here; everything else is Mailgun's. */
const ROADS: OutboxRoads = { gmailMessageTypes: ["ORGANIZER_MESSAGE"], gmailClubCopies: false, gmailBatchSize: 20 };

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
afterEach(() => {
  gmailDeployment.current = null;
});
beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
});

let counter = 0;
const row = (overrides: Partial<typeof emailOutbox.$inferInsert> = {}) => {
  counter += 1;
  return {
    participantId: null,
    registrationId: null,
    messageType: "REGISTRATION_CONFIRMED" as const,
    locale: "ro" as const,
    recipientEmail: `r${counter}@example.com`,
    payloadJson: {},
    idempotencyKey: `row:${counter}`,
    createdAt: new Date(NOW.getTime() - 30 * MINUTE),
    ...overrides,
  };
};

/** `n` messages a road carried at `at`. */
async function sent(n: number, at: Date, transport: "mailgun" | "gmail" = "mailgun") {
  if (n === 0) return;
  await db.insert(emailOutbox).values(
    Array.from({ length: n }, () => row({ status: "SENT", sentAt: at, transport, createdAt: new Date(at.getTime() - MINUTE) })),
  );
}

/** `n` due messages, the first the oldest, a minute apart. */
async function due(n: number, overrides: Partial<typeof emailOutbox.$inferInsert> = {}) {
  const rows = Array.from({ length: n }, (_, i) => row({ createdAt: new Date(NOW.getTime() - (n - i) * MINUTE), ...overrides }));
  return db.insert(emailOutbox).values(rows).returning();
}

async function render(outboxRow: OutboxRow): Promise<OutgoingEmail> {
  return {
    to: outboxRow.recipientEmail,
    subject: outboxRow.messageType,
    html: "<p>x</p>",
    text: "x",
    locale: outboxRow.locale,
    idempotencyKey: outboxRow.idempotencyKey,
  };
}

function sender(answer: () => SendResult): EmailSender & { calls: number } {
  const recorder = {
    calls: 0,
    async send() {
      recorder.calls += 1;
      return answer();
    },
  };
  return recorder;
}

describe("the claim keeps Mailgun's road inside the hour", () => {
  it("takes no Mailgun row when the hour's hundred have left, and Gmail's rows as before", async () => {
    await sent(100, new Date(NOW.getTime() - 10 * MINUTE));
    await due(5);
    await due(3, { messageType: "ORGANIZER_MESSAGE" });

    const claimed = await claimOutboxBatch(db, { now: NOW, batchSize: 20, roads: ROADS, hourlyAllowance: 100 });

    expect(claimed.map((r) => r.messageType)).toEqual(["ORGANIZER_MESSAGE", "ORGANIZER_MESSAGE", "ORGANIZER_MESSAGE"]);
    // What was not claimed is untouched: still PENDING, no attempt, no turn written.
    const waiting = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "REGISTRATION_CONFIRMED"));
    const pending = waiting.filter((r) => r.status === "PENDING");
    expect(pending).toHaveLength(5);
    expect(pending.every((r) => r.attemptCount === 0 && r.nextAttemptAt === null)).toBe(true);
  });

  it("takes the forty the hour still has room for after sixty, oldest first — Gmail's sends not counted", async () => {
    await sent(60, new Date(NOW.getTime() - 59 * MINUTE));
    await sent(50, new Date(NOW.getTime() - 5 * MINUTE), "gmail");
    const queued = await due(45);

    const claimed = await claimOutboxBatch(db, { now: NOW, batchSize: 50, hourlyAllowance: 100 });

    expect(claimed).toHaveLength(40);
    const oldest = [...queued].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, 40);
    expect(claimed.map((r) => r.id)).toEqual(oldest.map((r) => r.id));
  });

  it("counts a two-recipient row as two and a row in flight as one", async () => {
    // The declaration archive's copy: one row, two messages to Mailgun.
    await db.insert(emailOutbox).values(row({ status: "SENT", sentAt: new Date(NOW.getTime() - 10 * MINUTE), transport: "mailgun", recipientCount: 2 }));
    await sent(95, new Date(NOW.getTime() - 10 * MINUTE));
    await db.insert(emailOutbox).values(row({ status: "PROCESSING", lockedAt: new Date(NOW.getTime() - MINUTE), attemptCount: 1 }));
    await due(10);

    // 2 + 95 + 1 in flight = 98: room for two.
    expect(await claimOutboxBatch(db, { now: NOW, batchSize: 20, hourlyAllowance: 100 })).toHaveLength(2);
  });

  it("counts every recipient of a row as a message: copies spend the hour too", async () => {
    await db.insert(emailOutbox).values(row({ status: "SENT", sentAt: new Date(NOW.getTime() - 10 * MINUTE), transport: "mailgun", recipientCount: 3 }));
    await sent(96, new Date(NOW.getTime() - 10 * MINUTE));
    await due(10);

    const claimed = await claimOutboxBatch(db, { now: NOW, batchSize: 20, hourlyAllowance: 100 });

    expect(claimed).toHaveLength(1);
  });

  it("keeps the hundred in the hour for a minute more than Mailgun's sixty, then takes a full batch", async () => {
    await sent(100, new Date(NOW.getTime() - 60.5 * MINUTE));
    await due(25);
    // Sixty and a half minutes ago: past Mailgun's hour by our clock, still inside the window's margin.
    expect(await claimOutboxBatch(db, { now: NOW, batchSize: 20, hourlyAllowance: 100 })).toHaveLength(0);

    expect(await claimOutboxBatch(db, { now: new Date(NOW.getTime() + MINUTE), batchSize: 20, hourlyAllowance: 100 })).toHaveLength(20);
  });

  it("stamps a Mailgun send when Mailgun took it, not when its batch started", async () => {
    await due(3);
    // A provider that takes forty milliseconds a message: the third leaves eighty after the first.
    const slow: EmailSender = {
      async send() {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { outcome: "sent", providerMessageId: "slow" };
      },
    };
    await processOutboxBatch(db, { sender: slow, render, now: NOW });

    const stamps = (await db.select().from(emailOutbox)).map((r) => r.sentAt!.getTime()).sort((a, b) => a - b);
    expect(stamps).toHaveLength(3);
    expect(stamps[0]).toBeGreaterThanOrEqual(NOW.getTime() + 40);
    expect(stamps[2] - stamps[0]).toBeGreaterThanOrEqual(80);
    // On the batch's own clock: `now` moved on by the real time elapsed, never the machine's date.
    expect(stamps[2]).toBeLessThan(NOW.getTime() + 60_000);
  });

  it("counts a batch another worker holds right now, and paces nothing when the pace is cleared", async () => {
    await sent(90, new Date(NOW.getTime() - 20 * MINUTE));
    // Five claimed a minute ago by another drain: leaving, so spent.
    await db.insert(emailOutbox).values(Array.from({ length: 5 }, () => row({ status: "PROCESSING", lockedAt: new Date(NOW.getTime() - MINUTE), attemptCount: 1 })));
    await due(20);

    expect(await claimOutboxBatch(db, { now: NOW, batchSize: 20, hourlyAllowance: 100 })).toHaveLength(5);
    await resetTables(db);
    await sent(500, new Date(NOW.getTime() - 20 * MINUTE));
    await due(20);
    expect(await claimOutboxBatch(db, { now: NOW, batchSize: 20, hourlyAllowance: null })).toHaveLength(20);
  });

  it("reads the setting when the caller names no pace: 100 by default", async () => {
    await sent(95, new Date(NOW.getTime() - 30 * MINUTE));
    await due(10);
    expect(await claimOutboxBatch(db, { now: NOW, batchSize: 20 })).toHaveLength(5);
  });
});

describe("a rate refusal is a pause, never a loss", () => {
  const pause = (minutes: number): SendResult => ({
    outcome: "throttled",
    error: "mailgun 429: Too Many Requests",
    paced: true,
    rateRefused: true,
    retryAfter: new Date(NOW.getTime() + minutes * MINUTE),
  });

  it("hands the row back with its attempt, holds the batch's other Mailgun rows, and claims none of them early", async () => {
    await due(3);
    const refusing = sender(() => pause(14));

    const summary = await processOutboxBatch(db, { sender: refusing, render, now: NOW });

    // One knock, not three: the rest of the batch waits with the first.
    expect(refusing.calls).toBe(1);
    expect(summary).toMatchObject({ claimed: 3, sent: 0, deferred: 3, failed: 0, bounced: 0 });
    const rows = await db.select().from(emailOutbox);
    for (const r of rows) {
      expect(r.status).toBe("PENDING");
      expect(r.attemptCount).toBe(0);
      expect(r.nextAttemptAt?.toISOString()).toBe(new Date(NOW.getTime() + 14 * MINUTE).toISOString());
    }
    // Only the row Mailgun refused carries the reason; its batch-mates are waiting, not refused.
    expect(rows.filter((r) => r.lastError?.startsWith(RATE_PAUSE_ERROR_PREFIX))).toHaveLength(1);
    // While the pause lasts, nothing is claimed.
    expect(await claimOutboxBatch(db, { now: new Date(NOW.getTime() + 5 * MINUTE), batchSize: 20, hourlyAllowance: 100 })).toHaveLength(0);
  });

  it("holds Mailgun's whole road while the pause lasts, not only the batch it happened in; Gmail's road still goes", async () => {
    const [paused] = await due(1);
    await processOutboxBatch(db, { sender: sender(() => pause(14)), render, now: NOW });
    // A fresh registration's confirmation, due now, and an organizer's message on Gmail's road.
    const [fresh] = await db.insert(emailOutbox).values(row({ createdAt: NOW })).returning();
    const [organizer] = await db.insert(emailOutbox).values(row({ messageType: "ORGANIZER_MESSAGE", createdAt: NOW })).returning();

    const during = await claimOutboxBatch(db, { now: new Date(NOW.getTime() + MINUTE), batchSize: 20, roads: ROADS, hourlyAllowance: 100 });
    expect(during.map((r) => r.id)).toEqual([organizer.id]);
    expect((await db.select().from(emailOutbox).where(eq(emailOutbox.id, fresh.id)))[0]).toMatchObject({ status: "PENDING", attemptCount: 0 });

    const after = await claimOutboxBatch(db, { now: new Date(NOW.getTime() + 15 * MINUTE), batchSize: 20, roads: ROADS, hourlyAllowance: 100 });
    // Both of Mailgun's rows (the organizer's message, its lock past the timeout, is Gmail's to retake).
    expect(after.filter((r) => r.messageType !== "ORGANIZER_MESSAGE").map((r) => r.id).sort()).toEqual([paused.id, fresh.id].sort());
  });

  it("never marks a message FAILED, however many times Mailgun pauses it", async () => {
    await due(1);
    let at = NOW;
    for (let i = 0; i < MAX_SEND_ATTEMPTS * 2; i += 1) {
      const summary = await processOutboxBatch(db, { sender: sender(() => ({ ...pause(0), retryAfter: new Date(at.getTime() + 15 * MINUTE) })), render, now: at });
      expect(summary.claimed).toBe(1);
      at = new Date(at.getTime() + 15 * MINUTE);
    }
    const [only] = await db.select().from(emailOutbox);
    expect(only.status).toBe("PENDING");
    expect(only.attemptCount).toBe(0);

    // And when Mailgun takes it, it is sent, the pause's reason gone.
    await processOutboxBatch(db, { sender: sender(() => ({ outcome: "sent", providerMessageId: "ok" })), render, now: at });
    const [after] = await db.select().from(emailOutbox);
    expect(after.status).toBe("SENT");
    expect(after.lastError).toBeNull();
  });
});

describe("«send now» against the hour", () => {
  // A paid plan: no daily ceiling, so the hour is the only stop these tests can meet.
  beforeEach(async () => {
    await updateEmailPlan(db, admin, { plan: "BASIC" }, NOW);
  });

  it("refuses a press the hour has no room for, with the hour's own sentence, and queues nothing", async () => {
    await sent(100, new Date(NOW.getTime() - 10 * MINUTE));
    await due(3);

    const press = await sendOutboxNow(db, admin, NOW).catch((error: unknown) => error);
    expect(press).toBeInstanceOf(SendNowRefused);
    expect((press as SendNowRefused).reason).toBe(SEND_NOW_HOUR_SPENT);

    const resend = await assertRoomToSendNow(db, ["REGISTRATION_STATE_NOTICE"], NOW).catch((error: unknown) => error);
    expect(resend).toBeInstanceOf(SendNowRefused);
    expect((resend as SendNowRefused).reason).toBe(SEND_NOW_HOUR_SPENT);
    expect((await db.select().from(emailOutbox).where(eq(emailOutbox.status, "PENDING")))).toHaveLength(3);
  });

  it("lets a press send Gmail's waiting rows while Mailgun's hour is spent", async () => {
    await sent(100, new Date(NOW.getTime() - 10 * MINUTE));
    const [mailgunRow] = await due(2);
    await due(2, { messageType: "ORGANIZER_MESSAGE" });
    const gmail = sender(() => ({ outcome: "sent", providerMessageId: "gmail", transport: "gmail", recipients: 1 }));
    gmailDeployment.current = { roads: ROADS, sender: gmail };

    const result = await sendOutboxNow(db, admin, NOW);

    expect(result).toMatchObject({ claimed: 2, sent: 2 });
    expect(gmail.calls).toBe(2);
    const organizerRows = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"));
    expect(organizerRows.every((r) => r.status === "SENT" && r.transport === "gmail")).toBe(true);
    // Mailgun's rows wait for the hour, untouched.
    expect((await db.select().from(emailOutbox).where(eq(emailOutbox.id, mailgunRow.id)))[0]).toMatchObject({ status: "PENDING", attemptCount: 0 });
  });

  it("lets a press through while the hour has room, and stops at it", async () => {
    await sent(98, new Date(NOW.getTime() - 10 * MINUTE));
    await due(5);
    await expect(assertRoomToSendNow(db, ["REGISTRATION_STATE_NOTICE", "REGISTRATION_STATE_NOTICE"], NOW)).resolves.toBeUndefined();
    await expect(assertRoomToSendNow(db, ["REGISTRATION_STATE_NOTICE", "REGISTRATION_STATE_NOTICE", "REGISTRATION_STATE_NOTICE"], NOW)).rejects.toBeInstanceOf(SendNowRefused);

    // This environment captures: a captured message never reached Mailgun, so it spends nothing of
    // the hour — the claim takes two a batch, and the hour still has its two afterwards.
    const result = await sendOutboxNow(db, admin, NOW);
    expect(result.sent).toBe(5);
    expect(result.batches).toBe(3);
    expect(await readEmailVolumeToday(db, NOW)).toMatchObject({ sentLastHour: 98, hourRemaining: 2 });
  });
});

describe("health while the pace holds", () => {
  const late = new Date(NOW.getTime() - EMAIL_HEALTH_THRESHOLDS.OVERDUE_AFTER_MS - 10 * MINUTE);

  it("counts Mailgun rows held for the hour as waiting, not overdue, while the hour is full", async () => {
    await sent(100, new Date(NOW.getTime() - 10 * MINUTE));
    await db.insert(emailOutbox).values([row({ createdAt: late }), row({ createdAt: late })]);

    const health = await checkEmailHealth(db, NOW);
    expect(health.status).toBe("ok");
    expect(health.overdue).toBe(0);
    expect(health.hourPaced).toBe(2);
    expect(health.waiting).toBe(2);
  });

  it("calls the same rows overdue when nothing has left in ninety minutes, when the hour has room, or when no pace is set", async () => {
    await db.insert(emailOutbox).values([row({ createdAt: late }), row({ createdAt: late })]);
    expect(await checkEmailHealth(db, NOW)).toMatchObject({ status: "stalled", overdue: 2, hourPaced: 0 });

    // A message or two carried is not the pace: the hour has room, and these were not taken.
    await sent(3, new Date(NOW.getTime() - 10 * MINUTE));
    expect(await checkEmailHealth(db, NOW)).toMatchObject({ status: "stalled", overdue: 2, hourPaced: 0 });

    await sent(10, new Date(NOW.getTime() - 10 * MINUTE));
    await updateEmailPlan(db, admin, { plan: "FREE", hourlyAllowance: null }, NOW);
    expect(await checkEmailHealth(db, NOW)).toMatchObject({ status: "stalled", overdue: 2, hourPaced: 0 });
  });

  it("calls a row Mailgun keeps pausing overdue once it has waited past the allowance, pace or no pace", async () => {
    await sent(100, new Date(NOW.getTime() - 10 * MINUTE));
    const reason = `${RATE_PAUSE_ERROR_PREFIX}mailgun 429: Too Many Requests`;
    await db.insert(emailOutbox).values([
      // Queued long ago, paused again ten minutes from now: a pause that does not end.
      row({ createdAt: late, nextAttemptAt: new Date(NOW.getTime() + 10 * MINUTE), lastError: reason }),
      // Queued half an hour ago and paused: the mechanism working.
      row({ nextAttemptAt: new Date(NOW.getTime() + 10 * MINUTE), lastError: reason }),
    ]);
    const health = await checkEmailHealth(db, NOW);
    expect(health).toMatchObject({ status: "stalled", overdue: 1, hourPaced: 0, lastError: reason });
  });

  it("judges a row whose pause ended long ago as any waiting row: held for a full hour, not overdue", async () => {
    await sent(100, new Date(NOW.getTime() - 10 * MINUTE));
    const reason = `${RATE_PAUSE_ERROR_PREFIX}mailgun 429: Too Many Requests`;
    // Paused once, the pause over for two hours: now only waiting its turn under the pace.
    await db.insert(emailOutbox).values(row({ createdAt: new Date(NOW.getTime() - 4 * 60 * MINUTE), nextAttemptAt: new Date(NOW.getTime() - 120 * MINUTE), lastError: reason }));
    expect(await checkEmailHealth(db, NOW)).toMatchObject({ status: "ok", overdue: 0, hourPaced: 1 });
  });

  it("calls a late Gmail row overdue even while Mailgun's hour is full: the pace does not hold that road", async () => {
    gmailDeployment.current = { roads: ROADS, sender: sender(() => ({ outcome: "sent", providerMessageId: "unused" })) };
    await sent(100, new Date(NOW.getTime() - 10 * MINUTE));
    await db.insert(emailOutbox).values([row({ createdAt: late }), row({ createdAt: late, messageType: "ORGANIZER_MESSAGE" })]);
    expect(await checkEmailHealth(db, NOW)).toMatchObject({ status: "stalled", overdue: 1, hourPaced: 1 });
  });
});

describe("the setting and its figure", () => {
  it("reads 100 with nothing stored and from a value stored before the field existed", async () => {
    expect((await readEmailPlan(db)).hourlyAllowance).toBe(100);
    await db.insert(platformSettings).values({
      key: EMAIL_PLAN_SETTING_KEY,
      value: { plan: "BASIC", dailyAllowance: null, monthlyAllowance: null, note: "October" },
      updatedAt: NOW,
    });
    expect(await readEmailPlan(db)).toMatchObject({ plan: "BASIC", hourlyAllowance: 100 });
  });

  it("round-trips the box with an audit row naming old and new, and clears to no pace", async () => {
    await updateEmailPlan(db, admin, { plan: "BASIC", hourlyAllowance: 250 }, NOW);
    expect((await readEmailPlan(db)).hourlyAllowance).toBe(250);
    await updateEmailPlan(db, admin, { plan: "BASIC", hourlyAllowance: null }, new Date(NOW.getTime() + MINUTE));
    expect((await readEmailPlan(db)).hourlyAllowance).toBeNull();

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "email_plan.changed"));
    const metadata = audits.map((audit) => audit.metadataJson as { from: { hourlyAllowance: number | null }; to: { hourlyAllowance: number | null } });
    expect(metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: expect.objectContaining({ hourlyAllowance: 100 }), to: expect.objectContaining({ hourlyAllowance: 250 }) }),
        expect.objectContaining({ from: expect.objectContaining({ hourlyAllowance: 250 }), to: expect.objectContaining({ hourlyAllowance: null }) }),
      ]),
    );

    await expect(updateEmailPlan(db, admin, { plan: "BASIC", hourlyAllowance: 0 }, NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["hourlyAllowance"],
    });
  });

  it("says on the page what Mailgun carried in the last hour against the pace", async () => {
    await sent(37, new Date(NOW.getTime() - 20 * MINUTE));
    await sent(12, new Date(NOW.getTime() - 20 * MINUTE), "gmail");
    await sent(30, new Date(NOW.getTime() - 70 * MINUTE));

    // 67 carried in ninety minutes: the hour does not bind, so a late row on this page is late.
    expect(await readEmailVolumeToday(db, NOW)).toMatchObject({ hourlyAllowance: 100, sentLastHour: 37, hourRemaining: 63, hourPaceHolds: false });
    await sent(33, new Date(NOW.getTime() - 5 * MINUTE));
    expect(await readEmailVolumeToday(db, NOW)).toMatchObject({ sentLastHour: 70, hourRemaining: 30, hourPaceHolds: true });
  });
});
