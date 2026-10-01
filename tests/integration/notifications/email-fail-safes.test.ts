import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { DEFAULT_EMAIL_TRANSPORT, GMAIL_CAP_DEFERRED_ERROR } from "@/modules/notifications/domain/email-transport";
import { RATE_PAUSE_ERROR_PREFIX } from "@/modules/notifications/domain/hourly-pace";
import { ALLOWANCE_DEFERRED_ERROR_PREFIX, FALLBACK_WAITING_ERROR_PREFIX } from "@/modules/notifications/domain/mailgun-stop";
import { MAX_SEND_ATTEMPTS } from "@/modules/notifications/domain/retry";
import { updateEmailTransport } from "@/modules/notifications/email-transport";
import { checkEmailHealth, EMAIL_HEALTH_THRESHOLDS } from "@/modules/notifications/health";
import { readMailgunStop, recordMailgunStop } from "@/modules/notifications/mailgun-stop";
import { claimOutboxBatch, type OutboxRow, processOutboxBatch } from "@/modules/notifications/outbox";
import { createOutboxSender } from "@/modules/notifications/outbox-sender";
import { readOutboxRoads } from "@/modules/notifications/outbox-roads";
import { countRetryableFailed, retryFailedEmails } from "@/modules/notifications/retry-failed";
import { assertRoomToSendNow, SEND_NOW_STOPPED_REFUSALS, SendNowRefused } from "@/modules/notifications/send-at-once";
import { sendOutboxNow } from "@/modules/notifications/send-now";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN (amending §40, §100, §163, §443 and §605) — email fail-safes. BR-REQ-080-02.
 *
 * The day of the probation: Mailgun paused the account, 148 confirmations waited, and the owner
 * released them by SQL from a phone and set Gmail by hand. Now, while Mailgun says stop — a pause it
 * asked for, or its allowance spent — Gmail carries every group when the switch is on; a refusal that
 * is not about the message never marks it FAILED; the failed come back with one press; «Trimite
 * acum» says what it did; health and «Sarcini» name the remedy.
 *
 * This deployment has the club's Gmail (the two variables below, nothing real), so the setting's
 * default switch is on. The sender is a stand-in for both roads: a message the outbox hands to Gmail
 * (`transport: "gmail"`, `gmailOnly` while Gmail carries for Mailgun) goes to `gmail`, anything else
 * to `mailgun`, each answering as the test says.
 */
vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  return { env: { ...actual.env, CONTACT_SMTP_USER: "club@example.test", CONTACT_SMTP_PASSWORD: "not-a-real-app-password" } };
});

type Answer = (message: OutgoingEmail) => SendResult;
const roads = vi.hoisted(() => ({
  mailgun: null as null | ((message: OutgoingEmail) => SendResult),
  gmail: null as null | ((message: OutgoingEmail) => SendResult),
  calls: { mailgun: [] as OutgoingEmail[], gmail: [] as OutgoingEmail[] },
}));
vi.mock("@/modules/notifications/outbox-sender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/notifications/outbox-sender")>();
  return {
    ...actual,
    createOutboxSender: async (...args: Parameters<typeof actual.createOutboxSender>) => {
      const made = await actual.createOutboxSender(...args);
      const sender: EmailSender = {
        async send(message) {
          if (message.gmailOnly || message.transport === "gmail") {
            roads.calls.gmail.push(message);
            return roads.gmail!(message);
          }
          roads.calls.mailgun.push(message);
          return roads.mailgun!(message);
        },
      };
      return { ...made, sender };
    },
  };
});

const NOW = new Date("2026-10-01T09:30:00.000Z");
const MINUTE = 60_000;
const PAUSE_UNTIL = new Date(NOW.getTime() + 14 * MINUTE);
const RESET = new Date("2026-10-02T00:05:00.000Z");

const gmailSent: Answer = () => ({ outcome: "sent", providerMessageId: "gmail", transport: "gmail", recipients: 1, acceptedAt: NOW });
const mailgunSent: Answer = () => ({ outcome: "sent", providerMessageId: "mailgun" });

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  [organizer] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Organizer", role: "MODERATOR" }).returning();
  roads.mailgun = mailgunSent;
  roads.gmail = gmailSent;
});
afterEach(() => {
  roads.calls.mailgun = [];
  roads.calls.gmail = [];
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
    createdAt: new Date(NOW.getTime() - 20 * MINUTE),
    ...overrides,
  };
};

/** A row Mailgun paused for the rate, its attempt given back, as `releaseForPause` leaves it. */
const pausedRow = (overrides: Partial<typeof emailOutbox.$inferInsert> = {}) =>
  row({ lastError: `${RATE_PAUSE_ERROR_PREFIX}mailgun 429: Too Many Requests`, nextAttemptAt: PAUSE_UNTIL, ...overrides });

/** A row deferred to Mailgun's reset for its spent allowance, as the outbox writes it now. */
const deferredRow = (overrides: Partial<typeof emailOutbox.$inferInsert> = {}) =>
  row({ attemptCount: 1, lastError: `${ALLOWANCE_DEFERRED_ERROR_PREFIX}mailgun 420: recipient limit exceeded`, nextAttemptAt: RESET, ...overrides });

async function render(outboxRow: OutboxRow): Promise<OutgoingEmail> {
  return { to: outboxRow.recipientEmail, subject: outboxRow.messageType, html: "<p>x</p>", text: "x", locale: outboxRow.locale, idempotencyKey: outboxRow.idempotencyKey };
}

/** One batch, as the drain runs it: the club's roads and switch, the stand-in sender. */
async function batch(now: Date = NOW) {
  const { sender, route, roads: split } = await createOutboxSender(db);
  return processOutboxBatch(db, { sender, route, ...(split ? { roads: split } : {}), render, now });
}

async function rows() {
  return db.select().from(emailOutbox).orderBy(emailOutbox.createdAt);
}

async function switchOff(groups: Partial<typeof DEFAULT_EMAIL_TRANSPORT.groups> = {}) {
  await updateEmailTransport(db, admin, { ...DEFAULT_EMAIL_TRANSPORT, groups: { ...DEFAULT_EMAIL_TRANSPORT.groups, ...groups }, fallbackToGmail: false }, NOW);
}

/** Gmail's rolling day spent: the non-production cap's fifty recipients an hour ago. */
async function gmailCapSpent() {
  await db.insert(emailOutbox).values(row({ status: "SENT", sentAt: new Date(NOW.getTime() - 60 * MINUTE), transport: "gmail", recipientCount: 50 }));
}

describe("§NNN Gmail takes over while Mailgun is paused, with the switch on", () => {
  it("claims the paused row at once and the fresh ones on Gmail's road, and sends them with transport = gmail", async () => {
    expect((await readOutboxRoads(db))?.fallbackToGmail).toBe(true);
    const [paused] = await db.insert(emailOutbox).values(pausedRow()).returning();
    const fresh = await db.insert(emailOutbox).values([row({ createdAt: NOW }), row({ createdAt: NOW })]).returning();

    const summary = await batch(new Date(NOW.getTime() + MINUTE));

    expect(summary).toMatchObject({ claimed: 3, sent: 3, deferred: 0, failed: 0, bounced: 0 });
    expect(summary.carried).toEqual({ stop: { kind: "paused", until: PAUSE_UNTIL }, viaGmail: 3 });
    expect(roads.calls.mailgun).toHaveLength(0);
    expect(roads.calls.gmail.every((message) => message.gmailOnly === true && message.transport === "gmail")).toBe(true);
    for (const sent of await rows()) {
      expect([paused.id, ...fresh.map((r) => r.id)]).toContain(sent.id);
      expect(sent).toMatchObject({ status: "SENT", transport: "gmail", lastError: null });
    }
  });

  it("keeps Mailgun's road closed after the paused row has left on Gmail's, until the pause ends — the stop is recorded", async () => {
    roads.mailgun = () => ({ outcome: "throttled", error: "mailgun 429: Too Many Requests", paced: true, rateRefused: true, retryAfter: PAUSE_UNTIL });
    await db.insert(emailOutbox).values([row(), row(), row()]);

    // The first knock pauses Mailgun; the rest of the batch goes by Gmail, and nobody knocks again.
    const first = await batch();
    expect(roads.calls.mailgun).toHaveLength(1);
    expect(first).toMatchObject({ claimed: 3, sent: 2, deferred: 1 });
    expect(await readMailgunStop(db, NOW)).toEqual({ kind: "paused", until: PAUSE_UNTIL });

    // The refused row is due at once on Gmail's road; after it has left, the road stays closed.
    const second = await batch(new Date(NOW.getTime() + MINUTE));
    expect(second).toMatchObject({ claimed: 1, sent: 1 });
    expect(roads.calls.mailgun).toHaveLength(1);
    await db.insert(emailOutbox).values(row({ createdAt: new Date(NOW.getTime() + 2 * MINUTE) }));
    await batch(new Date(NOW.getTime() + 3 * MINUTE));
    expect(roads.calls.mailgun).toHaveLength(1);

    // When the pause ends, Mailgun's groups return to Mailgun on their own.
    roads.mailgun = mailgunSent;
    await db.insert(emailOutbox).values(row({ createdAt: new Date(NOW.getTime() + 14 * MINUTE) }));
    await batch(new Date(NOW.getTime() + 15 * MINUTE));
    expect(roads.calls.mailgun).toHaveLength(2);
    expect((await rows()).at(-1)).toMatchObject({ status: "SENT", transport: "mailgun" });
  });
});

describe("§NNN with the switch off, today's behaviour", () => {
  it("moves nothing on Mailgun's road during a pause, and Gmail's own groups still go", async () => {
    await switchOff({ announcements: "gmail" });
    const [paused] = await db.insert(emailOutbox).values(pausedRow()).returning();
    const [fresh] = await db.insert(emailOutbox).values(row({ createdAt: NOW })).returning();
    const [organizer] = await db.insert(emailOutbox).values(row({ messageType: "ORGANIZER_MESSAGE", createdAt: NOW })).returning();

    const summary = await batch(new Date(NOW.getTime() + MINUTE));

    expect(summary).toMatchObject({ claimed: 1, sent: 1 });
    expect(summary.carried).toBeUndefined();
    expect(roads.calls.mailgun).toHaveLength(0);
    const after = await rows();
    expect(after.find((r) => r.id === organizer.id)).toMatchObject({ status: "SENT", transport: "gmail" });
    expect(after.find((r) => r.id === paused.id)).toMatchObject({ status: "PENDING", nextAttemptAt: PAUSE_UNTIL });
    expect(after.find((r) => r.id === fresh.id)).toMatchObject({ status: "PENDING", attemptCount: 0, nextAttemptAt: null });
  });
});

describe("§NNN Mailgun's allowance spent, with the switch on", () => {
  it("sends the rows deferred to the reset on Gmail's road at once", async () => {
    await db.insert(emailOutbox).values([deferredRow(), deferredRow()]);

    const summary = await batch();

    expect(summary).toMatchObject({ claimed: 2, sent: 2 });
    expect(summary.carried?.stop).toEqual({ kind: "allowance", until: RESET });
    expect(roads.calls.mailgun).toHaveLength(0);
    expect((await rows()).every((r) => r.status === "SENT" && r.transport === "gmail")).toBe(true);
  });

  it("marks the refused row, records the stop, and sends the rest of the batch by Gmail", async () => {
    roads.mailgun = () => ({ outcome: "throttled", error: "mailgun 420: recipient limit exceeded" });
    await db.insert(emailOutbox).values([row(), row(), row()]);

    const summary = await batch();

    expect(roads.calls.mailgun).toHaveLength(1);
    expect(summary).toMatchObject({ claimed: 3, sent: 2, deferred: 1 });
    const [refused] = (await rows()).filter((r) => r.status === "PENDING");
    expect(refused.lastError).toBe(`${ALLOWANCE_DEFERRED_ERROR_PREFIX}mailgun 420: recipient limit exceeded`);
    expect(refused.nextAttemptAt?.toISOString()).toBe(RESET.toISOString());
    expect((await readMailgunStop(db, NOW))?.kind).toBe("allowance");

    // The next drain takes it at once, on Gmail's road.
    expect(await batch(new Date(NOW.getTime() + MINUTE))).toMatchObject({ claimed: 1, sent: 1 });
    expect(roads.calls.mailgun).toHaveLength(1);
  });

  it("with the switch off, the allowance holds nothing back — Mailgun's own refusal defers each row, as before", async () => {
    await switchOff();
    await db.insert(emailOutbox).values([deferredRow(), row({ createdAt: NOW })]);
    expect(await batch()).toMatchObject({ claimed: 1, sent: 1 });
    expect(roads.calls.mailgun).toHaveLength(1);
  });
});

describe("§NNN Gmail's cap spent while Mailgun is stopped", () => {
  it("holds the rows for Gmail's room or Mailgun's return, never Mailgun during its stop, with their attempts", async () => {
    roads.gmail = () => ({ outcome: "throttled", error: GMAIL_CAP_DEFERRED_ERROR, retryAfter: new Date(NOW.getTime() + 6 * 60 * MINUTE) });
    await db.insert(emailOutbox).values(pausedRow());
    await db.insert(emailOutbox).values(row({ createdAt: NOW, attemptCount: 2, nextAttemptAt: NOW }));

    const summary = await batch(new Date(NOW.getTime() + MINUTE));

    expect(roads.calls.mailgun).toHaveLength(0);
    expect(summary).toMatchObject({ claimed: 2, sent: 0, deferred: 2 });
    for (const waiting of await rows()) {
      expect(waiting.status).toBe("PENDING");
      expect(waiting.lastError).toBe(`${FALLBACK_WAITING_ERROR_PREFIX}${GMAIL_CAP_DEFERRED_ERROR}`);
      // Gmail's room is six hours away; Mailgun's road opens in thirteen minutes: the sooner.
      expect(waiting.nextAttemptAt?.toISOString()).toBe(PAUSE_UNTIL.toISOString());
    }
    expect((await rows()).map((r) => r.attemptCount).sort()).toEqual([0, 2]);
    // Not taken back at once as a row Mailgun held: it waits for its turn.
    expect(await claimOutboxBatch(db, { now: new Date(NOW.getTime() + 2 * MINUTE), batchSize: 20, roads: await readOutboxRoads(db) })).toHaveLength(0);
  });
});

describe("§NNN the pause holds the road with no pace", () => {
  it("claims nothing from Mailgun's road during a pause when «Limita pe oră» is cleared", async () => {
    await switchOff();
    await db.insert(emailOutbox).values([pausedRow(), row({ createdAt: NOW })]);
    expect(await claimOutboxBatch(db, { now: NOW, batchSize: 20, hourlyAllowance: null })).toHaveLength(0);
  });

  it("holds it on the stop record alone, once no waiting row carries the mark", async () => {
    await switchOff();
    await recordMailgunStop(db, { kind: "paused", until: PAUSE_UNTIL }, NOW);
    // A shorter pause met on the way does not shorten the recorded one.
    await recordMailgunStop(db, { kind: "paused", until: new Date(NOW.getTime() + MINUTE) }, NOW);
    await db.insert(emailOutbox).values(row({ createdAt: NOW }));
    expect(await claimOutboxBatch(db, { now: new Date(NOW.getTime() + 5 * MINUTE), batchSize: 20, hourlyAllowance: null })).toHaveLength(0);
    expect(await claimOutboxBatch(db, { now: PAUSE_UNTIL, batchSize: 20, hourlyAllowance: null })).toHaveLength(1);
  });
});

describe("§NNN no message is lost to a refusal that is not about it", () => {
  it("keeps a transient refusal PENDING past the sixth attempt, retried hourly, its attempts counted", async () => {
    await switchOff();
    roads.mailgun = () => ({ outcome: "transient_failure", error: "mailgun 502: Bad Gateway" });
    await db.insert(emailOutbox).values(row());
    let clock = NOW;
    let last = NOW;
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS + 2; attempt += 1) {
      expect((await batch(clock)).claimed).toBe(1);
      last = clock;
      clock = new Date((await rows())[0].nextAttemptAt!.getTime() + 1000);
    }
    const [kept] = await rows();
    expect(kept).toMatchObject({ status: "PENDING", attemptCount: MAX_SEND_ATTEMPTS + 2, lastError: "mailgun 502: Bad Gateway" });
    // The backoff's own ceiling: an hour after the last try, and every hour after that.
    expect(kept.nextAttemptAt!.getTime() - last.getTime()).toBe(60 * MINUTE);
  });

  it("marks a refusal of the account FAILED and an address problem BOUNCED", async () => {
    await switchOff();
    roads.mailgun = (message) =>
      message.to.startsWith("bad")
        ? { outcome: "permanent_failure", error: "mailgun 400: 'to' parameter is not a valid address" }
        : { outcome: "permanent_failure", error: "mailgun 401: Forbidden", notTheAddress: true };
    await db.insert(emailOutbox).values([row({ recipientEmail: "bad@example.com" }), row()]);
    expect(await batch()).toMatchObject({ failed: 1, bounced: 1 });
    const after = await rows();
    expect(after.find((r) => r.recipientEmail === "bad@example.com")?.status).toBe("BOUNCED");
    expect(after.find((r) => r.recipientEmail !== "bad@example.com")?.status).toBe("FAILED");
  });
});

describe("§NNN «Trimite acum» during a stop says what it did", () => {
  it("sends through Gmail and says how many and why, with the switch on", async () => {
    await db.insert(emailOutbox).values([pausedRow(), row({ createdAt: NOW })]);
    const result = await sendOutboxNow(db, admin, new Date(NOW.getTime() + MINUTE));
    expect(result).toMatchObject({ sent: 2, viaGmail: 2, stop: { kind: "paused", until: PAUSE_UNTIL } });
    expect(roads.calls.mailgun).toHaveLength(0);
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "outbox.sent_by_staff"));
    expect(audit.metadataJson).toMatchObject({ viaGmail: 2, mailgunStop: "paused" });
  });

  it("is refused with its own sentence when the switch is off, and when Gmail's cap is spent", async () => {
    await db.insert(emailOutbox).values([pausedRow(), row({ createdAt: NOW })]);
    await gmailCapSpent();
    const full = await sendOutboxNow(db, admin, NOW).catch((error: unknown) => error);
    expect(full).toBeInstanceOf(SendNowRefused);
    expect((full as SendNowRefused).reason).toBe(SEND_NOW_STOPPED_REFUSALS.gmailCapSpent);
    expect((full as SendNowRefused).until).toEqual(PAUSE_UNTIL);

    await switchOff();
    const off = await sendOutboxNow(db, admin, NOW).catch((error: unknown) => error);
    expect((off as SendNowRefused).reason).toBe(SEND_NOW_STOPPED_REFUSALS.fallbackOff);
    // Nothing moved, and no «0 trimise».
    expect(roads.calls.mailgun.length + roads.calls.gmail.length).toBe(0);
  });

  it("lets a resend's «now» through on Gmail's room, and refuses it with the stop's sentence otherwise", async () => {
    await recordMailgunStop(db, { kind: "allowance", until: RESET }, NOW);
    await expect(assertRoomToSendNow(db, ["REGISTRATION_STATE_NOTICE"], NOW)).resolves.toBeUndefined();
    await gmailCapSpent();
    const refused = await assertRoomToSendNow(db, ["REGISTRATION_STATE_NOTICE"], NOW).catch((error: unknown) => error);
    expect((refused as SendNowRefused).reason).toBe(SEND_NOW_STOPPED_REFUSALS.gmailCapSpent);
    await switchOff();
    const off = await assertRoomToSendNow(db, ["REGISTRATION_STATE_NOTICE"], NOW).catch((error: unknown) => error);
    expect((off as SendNowRefused).reason).toBe(SEND_NOW_STOPPED_REFUSALS.fallbackOff);
  });
});

describe("§NNN «Reîncearcă emailurile eșuate»", () => {
  it("puts the week's FAILED rows back, due now, from the first attempt, their reason kept — BOUNCED untouched — and audits it", async () => {
    const old = new Date(NOW.getTime() - EMAIL_HEALTH_THRESHOLDS.FAILED_WINDOW_MS - MINUTE);
    await db.insert(emailOutbox).values([
      row({ status: "FAILED", attemptCount: 6, lastError: "mailgun 401: Forbidden" }),
      row({ status: "FAILED", attemptCount: 1, lastError: "no template" }),
      row({ status: "FAILED", attemptCount: 6, lastError: "too old", createdAt: old }),
      row({ status: "BOUNCED", attemptCount: 1, lastError: "550 5.1.1" }),
    ]);
    expect(await countRetryableFailed(db, NOW)).toBe(2);

    expect(await retryFailedEmails(db, admin, NOW)).toEqual({ retried: 2 });

    const after = await rows();
    const back = after.filter((r) => r.status === "PENDING");
    expect(back).toHaveLength(2);
    for (const r of back) expect(r).toMatchObject({ attemptCount: 0, nextAttemptAt: NOW });
    expect(back.map((r) => r.lastError).sort()).toEqual(["mailgun 401: Forbidden", "no template"]);
    expect(after.filter((r) => r.status === "BOUNCED")).toHaveLength(1);
    expect(after.filter((r) => r.status === "FAILED").map((r) => r.lastError)).toEqual(["too old"]);
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "email_outbox.retry_failed"));
    expect(audit).toMatchObject({ actorStaffUserId: admin.id, metadataJson: { count: 2, windowDays: 7 } });
    expect(JSON.stringify(audit.metadataJson)).not.toContain("@");
  });

  it("is refused to an Organizer, and past three presses an hour", async () => {
    await expect(retryFailedEmails(db, organizer, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(RATE_LIMITS["admin-retry-failed"].limit).toBe(3);
    for (let i = 0; i < 3; i += 1) await retryFailedEmails(db, admin, NOW);
    await expect(retryFailedEmails(db, admin, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("§NNN health and «Sarcini» name the remedy", () => {
  it("is degraded, not stalled, while Gmail carries Mailgun's groups — a deferral it carries is not a stall", async () => {
    await db.insert(emailOutbox).values([pausedRow(), deferredRow()]);
    const health = await checkEmailHealth(db, NOW);
    expect(health).toMatchObject({ status: "degraded", deferred: 0, overdue: 0, failed: 0, stoppedLong: 0 });
    expect(health.mailgunStop).toEqual({ kind: "paused", until: PAUSE_UNTIL.toISOString(), carriedBy: "gmail", waitReason: null });
  });

  it("is stalled when nothing can carry a row for ninety minutes — Gmail's cap spent — and counts it for «Sarcini»", async () => {
    await gmailCapSpent();
    const late = new Date(NOW.getTime() - EMAIL_HEALTH_THRESHOLDS.OVERDUE_AFTER_MS - 5 * MINUTE);
    await db.insert(emailOutbox).values(pausedRow({ createdAt: late }));
    const health = await checkEmailHealth(db, NOW);
    expect(health.status).toBe("stalled");
    expect(health.overdue).toBe(1);
    expect(health.stoppedLong).toBe(1);
    expect(health.mailgunStop).toMatchObject({ kind: "paused", carriedBy: null, waitReason: "gmailCapSpent" });
  });

  it("counts a row Gmail could not carry, queued past ninety minutes, as overdue", async () => {
    const late = new Date(NOW.getTime() - EMAIL_HEALTH_THRESHOLDS.OVERDUE_AFTER_MS - 5 * MINUTE);
    await db.insert(emailOutbox).values(row({ createdAt: late, lastError: `${FALLBACK_WAITING_ERROR_PREFIX}gmail is not taking messages`, nextAttemptAt: PAUSE_UNTIL }));
    const health = await checkEmailHealth(db, NOW);
    expect(health).toMatchObject({ status: "stalled", overdue: 1, stoppedLong: 1 });
  });
});
