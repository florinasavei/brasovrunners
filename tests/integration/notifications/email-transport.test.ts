import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { DEFAULT_EMAIL_TRANSPORT, preferredTransport } from "@/modules/notifications/domain/email-transport";
import { readEmailTransport, readGmailUsage, updateEmailTransport } from "@/modules/notifications/email-transport";
import { type OutboxRow, processOutboxBatch } from "@/modules/notifications/outbox";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the road each email takes is the club's setting per group, and the outbox records which
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

describe("§NNN email transport setting and the outbox's road", () => {
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
    expect(await readEmailTransport(db)).toMatchObject({ ...DEFAULT_EMAIL_TRANSPORT, updatedAt: null });

    const next = {
      groups: { links: "mailgun", confirmations: "gmail", event: "mailgun", club: "gmail" },
      gmailDailyCap: 120,
      gmailPaceSeconds: 5,
      overflowToGmail: false,
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
    expect(audit.metadataJson).toMatchObject({ from: { gmailDailyCap: 250, overflowToGmail: true }, to: { gmailDailyCap: 120, overflowToGmail: false } });
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
    expect(rows["row:1"]).toMatchObject({ status: "SENT", transport: "gmail" });
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

  it("counts Gmail's last 24 hours from its own rows, and keeps them out of Mailgun's allowance", async () => {
    const sent = (i: number, transport: "gmail" | "mailgun" | null, at: Date) =>
      row(i, { idempotencyKey: `sent:${i}`, status: "SENT", sentAt: at, createdAt: at, transport });
    await db.insert(emailOutbox).values([
      sent(1, "gmail", new Date(NOW.getTime() - 1 * HOUR)),
      sent(2, "gmail", new Date(NOW.getTime() - 2 * HOUR)),
      // Yesterday morning, outside the rolling day.
      sent(3, "gmail", new Date(NOW.getTime() - 25 * HOUR)),
      sent(4, "mailgun", new Date(NOW.getTime() - 1 * HOUR)),
      // Sent before the column existed: Mailgun's.
      sent(5, null, new Date(NOW.getTime() - 3 * HOUR)),
    ]);

    const usage = await readGmailUsage(db, NOW, true);
    expect(usage).toEqual({ configured: true, sentLastDay: 2, lastSentAt: new Date(NOW.getTime() - 1 * HOUR) });

    const volume = await readEmailVolumeToday(db, NOW);
    expect(volume.sentMessages).toBe(2);
    expect(volume.sentThisMonth).toBe(2);
    // No Gmail account in the test environment: every message of a registration is Mailgun's.
    expect(volume.gmailConfigured).toBe(false);
    expect(volume.messagesPerRegistration).toBe(volume.allMessagesPerRegistration);
  });
});
