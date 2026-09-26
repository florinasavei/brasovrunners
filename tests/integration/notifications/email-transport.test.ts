import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { createEmailSender, GMAIL_PACE_BUDGET_MS, type GmailRoad } from "@/infrastructure/email/delivery";
import { isClubCopy } from "@/modules/notifications/domain/club-notices";
import {
  DEFAULT_EMAIL_TRANSPORT,
  GMAIL_WINDOW_MS,
  gmailClaimSize,
  gmailRoadRows,
  NON_PRODUCTION_GMAIL_DAILY_CAP,
  preferredTransport,
} from "@/modules/notifications/domain/email-transport";
import {
  createGmailLedger,
  readEmailTransport,
  readGmailLastFailure,
  readGmailUsage,
  recordGmailFailure,
  updateEmailTransport,
} from "@/modules/notifications/email-transport";
import { checkEmailHealth } from "@/modules/notifications/health";
import { type OutboxRoads, type OutboxRow, processOutboxBatch } from "@/modules/notifications/outbox";
import { nextAllowanceResetAt } from "@/modules/notifications/domain/retry";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §443 — the road each email takes is the club's setting per group, and the outbox records which
 * road carried it: Gmail's cap is counted from that column, and Mailgun's allowance no longer
 * counts what Gmail carried.
 */
const NOW = new Date("2026-10-08T10:00:00.000Z");
const HOUR = 60 * 60 * 1000;

async function render(row: OutboxRow): Promise<OutgoingEmail> {
  return { to: row.recipientEmail, subject: "s", html: "<p>h</p>", text: "t", locale: row.locale, idempotencyKey: row.idempotencyKey };
}

/** A sender that carries a message by the road it asks for — the adapters' answer, recorded. */
function roadSender(answer?: (message: OutgoingEmail) => SendResult): EmailSender & { calls: OutgoingEmail[] } {
  const calls: OutgoingEmail[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      return answer?.(message) ?? { outcome: "sent", providerMessageId: `id:${message.idempotencyKey}`, transport: message.transport ?? "mailgun" };
    },
  };
}

describe("§443 email transport setting and the outbox's road", () => {
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
    [organizer] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
  });

  const row = (i: number, extra: Partial<typeof emailOutbox.$inferInsert> = {}) => ({
    participantId: null,
    registrationId: null,
    messageType: "CLUB_CONFIRMATION_NOTICE" as const,
    locale: "ro" as const,
    recipientEmail: `club${i}@example.com`,
    payloadJson: {},
    idempotencyKey: `row:${i}`,
    status: "PENDING" as const,
    createdAt: new Date(NOW.getTime() - 60_000),
    ...extra,
  });

  it("is the default until an Administrator changes it, audited, and refused to anybody else", async () => {
    // Not production: the smaller share of the one Gmail account production also uses.
    expect(await readEmailTransport(db)).toMatchObject({ ...DEFAULT_EMAIL_TRANSPORT, gmailDailyCap: NON_PRODUCTION_GMAIL_DAILY_CAP, updatedAt: null });

    const next = {
      groups: { links: "mailgun", confirmations: "gmail", reminders: "mailgun", announcements: "gmail", club: "gmail", newsletter: "gmail" },
      gmailDailyCap: 120,
      gmailPaceSeconds: 5,
      atGmailCap: "mailgun",
      overflowToGmail: true,
    };
    await expect(updateEmailTransport(db, organizer, next, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateEmailTransport(db, admin, { ...next, gmailDailyCap: 900 }, NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["gmailDailyCap"],
    });

    await updateEmailTransport(db, admin, next, NOW);
    expect(await readEmailTransport(db)).toMatchObject({ ...next, updatedAt: NOW });
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "email_transport.changed"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.metadataJson).toMatchObject({
      from: { gmailDailyCap: NON_PRODUCTION_GMAIL_DAILY_CAP, atGmailCap: "defer", overflowToGmail: false },
      to: { gmailDailyCap: 120, atGmailCap: "mailgun", overflowToGmail: true },
    });
  });

  it("records which road carried each message, and hands a paced message back without spending an attempt", async () => {
    await db.insert(emailOutbox).values([
      row(1),
      row(2, { messageType: "REGISTRATION_CONFIRMED", recipientEmail: "ana@example.com", idempotencyKey: "row:2" }),
      row(3, { idempotencyKey: "row:3" }),
    ]);
    const sender = roadSender((message) =>
      message.to === "club3@example.com"
        ? { outcome: "throttled", error: "gmail pace", retryAfter: new Date(NOW.getTime() + 3_000), paced: true }
        : { outcome: "sent", providerMessageId: `id:${message.to}`, transport: message.transport ?? "mailgun" },
    );
    const route = (candidate: OutboxRow) => preferredTransport(DEFAULT_EMAIL_TRANSPORT, candidate.messageType, false);

    const summary = await processOutboxBatch(db, { sender, render, now: NOW, route });
    expect(summary).toMatchObject({ claimed: 3, sent: 2, retrying: 1, deferred: 0 });
    expect(Object.fromEntries(sender.calls.map((call) => [call.to, call.transport]))).toEqual({
      "club1@example.com": "gmail",
      "ana@example.com": "mailgun",
      "club3@example.com": "gmail",
    });

    const rows = Object.fromEntries((await db.select().from(emailOutbox)).map((r) => [r.idempotencyKey, r]));
    expect(rows["row:1"]).toMatchObject({ status: "SENT", transport: "gmail", recipientCount: null });
    expect(rows["row:2"]).toMatchObject({ status: "SENT", transport: "mailgun" });
    expect(rows["row:3"]).toMatchObject({ status: "PENDING", transport: null, attemptCount: 0, nextAttemptAt: new Date(NOW.getTime() + 3_000) });
  });

  it("asks Mailgun for every row when no route is given", async () => {
    await db.insert(emailOutbox).values([row(1)]);
    const sender = roadSender();
    await processOutboxBatch(db, { sender, render, now: NOW });
    expect(sender.calls[0]?.transport).toBeUndefined();
    const [stored] = await db.select().from(emailOutbox);
    expect(stored?.transport).toBe("mailgun");
  });

  it("counts Gmail's last 24 hours in recipients from its own rows, leaves captured rows out, and keeps them out of Mailgun's allowance", async () => {
    const sent = (i: number, transport: "gmail" | "mailgun" | null, at: Date, recipientCount: number | null = 1) =>
      row(i, { idempotencyKey: `sent:${i}`, status: "SENT", sentAt: at, createdAt: at, transport, recipientCount });
    await db.insert(emailOutbox).values([
      sent(1, "gmail", new Date(NOW.getTime() - 1 * HOUR)),
      // The address and two hidden copies: three of Google's recipients.
      sent(2, "gmail", new Date(NOW.getTime() - 2 * HOUR), 3),
      // Captured on QA: reached nobody.
      sent(6, "gmail", new Date(NOW.getTime() - 4 * HOUR), 0),
      // Yesterday morning, outside the rolling day.
      sent(3, "gmail", new Date(NOW.getTime() - 25 * HOUR)),
      sent(4, "mailgun", new Date(NOW.getTime() - 1 * HOUR)),
      // Sent before the column existed: Mailgun's.
      sent(5, null, new Date(NOW.getTime() - 3 * HOUR), null),
    ]);

    const usage = await readGmailUsage(db, NOW, true);
    expect(usage).toEqual({
      configured: true,
      sentLastDay: 4,
      lastSentAt: new Date(NOW.getTime() - 1 * HOUR),
      oldestInWindowAt: new Date(NOW.getTime() - 2 * HOUR),
    });

    const volume = await readEmailVolumeToday(db, NOW);
    expect(volume.sentMessages).toBe(2);
    expect(volume.sentThisMonth).toBe(2);
    expect(volume.gmailLastFailure).toBeNull();
    // No Gmail account in the test environment: every message of a registration is Mailgun's.
    expect(volume.gmailConfigured).toBe(false);
    expect(volume.messagesPerRegistration).toBe(volume.allMessagesPerRegistration);
  });

  it("defers a Gmail row at the cap to the moment the oldest send leaves the rolling day, never discarding it or spending Mailgun", async () => {
    const oldestAt = new Date(NOW.getTime() - 20 * HOUR);
    await db.insert(emailOutbox).values([
      row(9, { idempotencyKey: "sent:9", status: "SENT", sentAt: oldestAt, createdAt: oldestAt, transport: "gmail", recipientCount: 2 }),
      row(1),
    ]);
    const mailgun: OutgoingEmail[] = [];
    const gmail: OutgoingEmail[] = [];
    const sender = createEmailSender({
      appEnv: "production",
      mode: "live",
      allowlist: [],
      capture: { name: "capture", send: async () => ({ outcome: "sent", providerMessageId: "capture:1" }) },
      live: () => ({
        name: "mailgun",
        send: async (m) => {
          mailgun.push(m);
          return { outcome: "sent", providerMessageId: "mg:1" };
        },
      }),
      gmail: {
        adapter: () => ({
          name: "gmail",
          send: async (m) => {
            gmail.push(m);
            return { outcome: "sent", providerMessageId: "gm:1" };
          },
        }),
        ledger: createGmailLedger(db),
        dailyCap: 2,
        paceSeconds: 0,
        atGmailCap: "defer",
        overflowToGmail: false,
        now: () => NOW,
      },
    });
    const route = (candidate: OutboxRow) => preferredTransport(DEFAULT_EMAIL_TRANSPORT, candidate.messageType, false);

    const summary = await processOutboxBatch(db, { sender, render, now: NOW, route });
    expect(summary).toMatchObject({ claimed: 1, sent: 0, deferred: 1 });
    expect(mailgun).toHaveLength(0);
    expect(gmail).toHaveLength(0);
    const [deferred] = await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, "row:1"));
    expect(deferred).toMatchObject({
      status: "PENDING",
      nextAttemptAt: new Date(oldestAt.getTime() + GMAIL_WINDOW_MS),
      lastError: "gmail daily cap: deferred",
    });
  });

  it("keeps the last Gmail failure for /admin/emails and /api/health, without changing the health status", async () => {
    await recordGmailFailure(db, "gmail: smtp EAUTH", NOW);
    expect(await readGmailLastFailure(db)).toEqual({ at: NOW, error: "gmail: smtp EAUTH" });
    const later = new Date(NOW.getTime() + HOUR);
    await recordGmailFailure(db, "gmail: smtp ECONNECTION", later);
    expect(await readGmailLastFailure(db)).toEqual({ at: later, error: "gmail: smtp ECONNECTION" });

    const health = await checkEmailHealth(db, later);
    expect(health.status).toBe("ok");
    expect(health.gmail).toMatchObject({ lastFailure: "gmail: smtp ECONNECTION", lastFailureAt: later.toISOString(), cap: NON_PRODUCTION_GMAIL_DAILY_CAP });

    const volume = await readEmailVolumeToday(db, later);
    expect(volume.gmailLastFailure).toEqual({ at: later, error: "gmail: smtp ECONNECTION" });
    expect(volume.gmailFailedLastDay).toBe(true);
  });

  /** The default setting's roads, as `outbox-sender.ts` builds them. */
  const defaultRoads = (gmailBatchSize = gmailClaimSize(DEFAULT_EMAIL_TRANSPORT.gmailPaceSeconds, GMAIL_PACE_BUDGET_MS, 20)): OutboxRoads => {
    const gmail = gmailRoadRows(DEFAULT_EMAIL_TRANSPORT);
    return { gmailMessageTypes: gmail.messageTypes, gmailClubCopies: gmail.clubCopies, gmailBatchSize };
  };
  const defaultRoute = (candidate: OutboxRow) =>
    preferredTransport(DEFAULT_EMAIL_TRANSPORT, candidate.messageType, isClubCopy(candidate.payloadJson));

  it("claims Gmail's rows apart: 25 due club messages never keep a newer runner's link from the first drain (§443 review)", async () => {
    const older = (i: number) => new Date(NOW.getTime() - (60 - i) * 60_000);
    await db.insert(emailOutbox).values([
      // The club's copies of a runner's confirmation: a participant type, the club's mail.
      ...Array.from({ length: 5 }, (_, i) =>
        row(100 + i, {
          messageType: "REGISTRATION_CONFIRMED",
          recipientEmail: `copy${i}@example.com`,
          payloadJson: { clubCopy: true },
          idempotencyKey: `copy:${i}`,
          createdAt: older(i),
        }),
      ),
      ...Array.from({ length: 20 }, (_, i) => row(200 + i, { idempotencyKey: `club:${i}`, createdAt: older(5 + i) })),
      // The newest of all: a runner's link to confirm the address, Mailgun's road.
      row(300, { messageType: "VERIFY_REGISTRATION_EMAIL", recipientEmail: "ana@example.com", idempotencyKey: "verify:ana", createdAt: new Date(NOW.getTime() - 1_000) }),
    ]);
    const sender = roadSender();

    const summary = await processOutboxBatch(db, { sender, render, now: NOW, route: defaultRoute, roads: defaultRoads() });

    // Four of Gmail's (what six seconds apart fits in twenty seconds of waiting), and the runner's link.
    expect(summary).toMatchObject({ claimed: 5, sent: 5 });
    const [verify] = await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, "verify:ana"));
    expect(verify).toMatchObject({ status: "SENT", transport: "mailgun" });
    expect(sender.calls.filter((call) => call.transport === "gmail").map((call) => call.to)).toEqual([
      "copy0@example.com",
      "copy1@example.com",
      "copy2@example.com",
      "copy3@example.com",
    ]);
    const pending = await db.select().from(emailOutbox).where(eq(emailOutbox.status, "PENDING"));
    expect(pending).toHaveLength(21);
  });

  it("holds a newsletter to Mailgun's reserve only on Mailgun's road: by Gmail it goes, by Mailgun it waits for the reset (§445)", async () => {
    // Free's hundred a day, sixty spent by Mailgun: forty left, under the reserve of fifty, so no
    // newsletter may take Mailgun today. Gmail's own rows are not in that count.
    await db.insert(emailOutbox).values([
      ...Array.from({ length: 60 }, (_, i) =>
        row(400 + i, { idempotencyKey: `spent:${i}`, status: "SENT", sentAt: new Date(NOW.getTime() - HOUR), transport: "mailgun" }),
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        row(500 + i, { idempotencyKey: `gmail-spent:${i}`, status: "SENT", sentAt: new Date(NOW.getTime() - HOUR), transport: "gmail" }),
      ),
      row(600, { messageType: "NEWSLETTER", recipientEmail: "sub@example.com", idempotencyKey: "newsletter:sub" }),
    ]);
    const newsletterRow = async () => (await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, "newsletter:sub")))[0];

    // Mailgun alone (no roads): the reserve holds it, untouched, until the allowance comes back.
    const mailgunOnly = roadSender();
    expect(await processOutboxBatch(db, { sender: mailgunOnly, render, now: NOW })).toMatchObject({ claimed: 0 });
    expect(await newsletterRow()).toMatchObject({ status: "PENDING", attemptCount: 0, nextAttemptAt: nextAllowanceResetAt(NOW) });

    // The club's setting sends the newsletter group by Gmail: Mailgun's reserve is not Gmail's, so it goes.
    await db.update(emailOutbox).set({ nextAttemptAt: null }).where(eq(emailOutbox.idempotencyKey, "newsletter:sub"));
    const sender = roadSender();
    expect(await processOutboxBatch(db, { sender, render, now: NOW, route: defaultRoute, roads: defaultRoads() })).toMatchObject({ claimed: 1, sent: 1 });
    expect(sender.calls.map((call) => [call.to, call.transport])).toEqual([["sub@example.com", "gmail"]]);
    expect(await newsletterRow()).toMatchObject({ status: "SENT", transport: "gmail" });
  });

  /** A Gmail road over this database's ledger, with an adapter that notes when it was handed each message. */
  function gmailSender(overrides: Partial<GmailRoad>, sentAt: number[]) {
    return createEmailSender({
      appEnv: "production",
      mode: "live",
      allowlist: [],
      capture: { name: "capture", send: async () => ({ outcome: "sent", providerMessageId: "capture:1" }) },
      live: () => ({ name: "mailgun", send: async () => ({ outcome: "sent", providerMessageId: "mg:1" }) }),
      gmail: {
        adapter: () => ({
          name: "gmail",
          send: async (m) => {
            sentAt.push((overrides.now?.() ?? new Date()).getTime());
            return { outcome: "sent", providerMessageId: `gm:${m.idempotencyKey}` };
          },
        }),
        ledger: createGmailLedger(db),
        dailyCap: 100,
        paceSeconds: 6,
        atGmailCap: "defer",
        overflowToGmail: false,
        random: () => 0,
        ...overrides,
      },
    });
  }

  it("keeps Gmail's pace between two senders taking turns on one database, and records the moment Gmail took each (§443 review)", async () => {
    await db.insert(emailOutbox).values(
      Array.from({ length: 4 }, (_, i) => row(i, { idempotencyKey: `club:${i}`, createdAt: new Date(NOW.getTime() - (10 - i) * 1_000) })),
    );
    let clock = NOW.getTime();
    const sentAt: number[] = [];
    const virtual = {
      now: () => new Date(clock),
      sleep: async (ms: number) => {
        clock += ms;
      },
    };
    // Two instances: each its own sender, its own batch — the drain after a response and the pinger.
    const first = gmailSender(virtual, sentAt);
    const second = gmailSender(virtual, sentAt);
    const roads = defaultRoads(1);

    for (const sender of [first, second, first, second]) {
      await processOutboxBatch(db, { sender, render, now: new Date(clock), route: defaultRoute, roads });
      // A second passes between the two instances' batches.
      clock += 1_000;
    }

    expect(sentAt).toHaveLength(4);
    for (let i = 1; i < sentAt.length; i += 1) expect(sentAt[i]! - sentAt[i - 1]!).toBeGreaterThanOrEqual(6_000);
    // Each row's `sent_at` is the moment Gmail took it, not its batch's start.
    const stored = (await db.select().from(emailOutbox)).map((r) => r.sentAt?.getTime() ?? 0).sort((x, y) => x - y);
    expect(stored).toEqual([...sentAt].sort((x, y) => x - y));
  });

  it("keeps Gmail's pace between two senders sending at the same time on one database (§443 review)", { timeout: 20_000 }, async () => {
    await db.insert(emailOutbox).values(
      Array.from({ length: 4 }, (_, i) => row(i, { idempotencyKey: `club:${i}`, createdAt: new Date(Date.now() - (10 - i) * 1_000) })),
    );
    const sentAt: number[] = [];
    const road = { paceSeconds: 1 };
    const [a, b] = [gmailSender(road, sentAt), gmailSender(road, sentAt)];
    const roads = defaultRoads(2);

    const now = new Date();
    const [one, two] = await Promise.all([
      processOutboxBatch(db, { sender: a, render, now, route: defaultRoute, roads }),
      processOutboxBatch(db, { sender: b, render, now, route: defaultRoute, roads }),
    ]);

    expect(one.sent + two.sent).toBe(4);
    const times = [...sentAt].sort((x, y) => x - y);
    /*
      Real timers: each sender sends at its slot, and a slot is a pace after the one before it —
      exact on the virtual clock above. Here a timer wakes within the operating system's timer
      granularity of its slot (about 16 ms on Windows), and nothing closer than the pace beyond that.
    */
    for (let i = 1; i < times.length; i += 1) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(1_000 - 20);
  });
});
