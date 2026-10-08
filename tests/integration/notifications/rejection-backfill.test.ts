import { readFileSync } from "node:fs";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox, type EmailMessageType } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { rejectionCause } from "@/modules/notifications/domain/rejection-cause";
import { resolveDisplayName } from "@/modules/registrations/names";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * Migration 0131's backfill (§NNN): the refusals written before the cause was stored get it once, from
 * the two shapes they have — Mailgun's one word from the webhook, or the answer stored at the send — by
 * the same rule `rejectionCause` reads those shapes with. This runs the migration's own statements again,
 * on rows written the way the old code wrote them, and holds the SQL and the TypeScript together on every
 * shape; then the refusals already sent again, and the account's refusals that are over.
 */
const MIGRATION = readFileSync("src/db/migrations/0131_email_delivery_facts.sql", "utf8");
const BACKFILL = MIGRATION.split("--> statement-breakpoint")
  .map((statement) => statement.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
  .filter((statement) => statement.startsWith("UPDATE"));

const T0 = new Date("2026-10-01T08:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

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

async function backfill() {
  expect(BACKFILL).toHaveLength(3);
  for (const statement of BACKFILL) await db.execute(sql.raw(statement));
}

async function legacy(input: {
  status: "BOUNCED" | "COMPLAINED" | "SENT";
  lastError?: string | null;
  sent: boolean;
  participantId?: string | null;
  registrationId?: string | null;
  messageType?: EmailMessageType;
  createdAt?: Date;
  sentAt?: Date;
  transport?: "mailgun" | "gmail" | null;
}) {
  serial += 1;
  const [row] = await db
    .insert(emailOutbox)
    .values({
      participantId: input.participantId ?? null,
      registrationId: input.registrationId ?? null,
      messageType: input.messageType ?? "REGISTRATION_CONFIRMED",
      locale: "ro",
      recipientEmail: "ana@example.org",
      payloadJson: {},
      idempotencyKey: `legacy-${serial}`,
      status: input.status,
      lastError: input.lastError ?? null,
      createdAt: input.createdAt ?? T0,
      sentAt: input.sent ? (input.sentAt ?? input.createdAt ?? T0) : null,
      transport: input.sent ? (input.transport ?? null) : null,
    })
    .returning();
  return row;
}

const SHAPES: Array<{ status: "BOUNCED" | "COMPLAINED"; sent: boolean; lastError: string | null; expected: string }> = [
  // Mailgun's one word, from the webhook.
  { status: "BOUNCED", sent: true, lastError: "bounce", expected: "other" },
  { status: "BOUNCED", sent: true, lastError: "hardfail", expected: "other" },
  { status: "BOUNCED", sent: true, lastError: "generic", expected: "other" },
  { status: "BOUNCED", sent: true, lastError: null, expected: "other" },
  { status: "BOUNCED", sent: true, lastError: "suppress-bounce", expected: "suppressed" },
  { status: "BOUNCED", sent: true, lastError: "suppress-unsubscribe", expected: "unsubscribed" },
  { status: "BOUNCED", sent: true, lastError: "suppress-complaint", expected: "complaint-suppressed" },
  { status: "BOUNCED", sent: true, lastError: "espblock", expected: "blocked" },
  { status: "BOUNCED", sent: true, lastError: "blacklisted", expected: "blocked" },
  { status: "BOUNCED", sent: true, lastError: "old", expected: "gave-up" },
  { status: "BOUNCED", sent: true, lastError: "greylisted", expected: "gave-up" },
  { status: "BOUNCED", sent: true, lastError: "550 5.1.1 mailbox unavailable", expected: "other" },
  { status: "COMPLAINED", sent: true, lastError: null, expected: "complaint" },
  // The answers stored at the send, before §622 made the account's refusals FAILED.
  { status: "BOUNCED", sent: false, lastError: "mailgun 401: Forbidden", expected: "account" },
  { status: "BOUNCED", sent: false, lastError: "mailgun 403: Domain mail.example.org is not allowed to send: domain disabled", expected: "account" },
  { status: "BOUNCED", sent: false, lastError: "mailgun 400: Domain mail.example.org is not allowed to send: recipient limit exceeded", expected: "account" },
  {
    status: "BOUNCED",
    sent: false,
    lastError: "mailgun 400: Domain mail.example.org is not allowed to send: You are sending too fast. Your account is on probation and the account has been temporarily disabled.",
    expected: "account",
  },
  { status: "BOUNCED", sent: false, lastError: "mailgun 429: Too Many Requests", expected: "account" },
  { status: "BOUNCED", sent: false, lastError: "mailgun 400: 'from' parameter is not a valid address. please check documentation", expected: "account" },
  { status: "BOUNCED", sent: false, lastError: "mailgun 400: 'to' parameter is not a valid address. please check documentation", expected: "no-such-address" },
  { status: "BOUNCED", sent: false, lastError: "mailgun 400: <address> is not among the authorized recipients", expected: "other" },
  {
    status: "BOUNCED",
    sent: false,
    lastError: "mailgun 400: Sandbox subdomains are for test purposes only. Please add your own domain or add the address to authorized recipients in Account Settings.",
    expected: "other",
  },
  // A row that left is never the account's, whatever its text.
  { status: "BOUNCED", sent: true, lastError: "mailgun 401: Forbidden", expected: "other" },
  { status: "BOUNCED", sent: false, lastError: "gmail: the address was refused (5.1.1)", expected: "no-such-address" },
  { status: "BOUNCED", sent: false, lastError: "gmail: the address was refused (5xx)", expected: "other" },
];

describe("migration 0131's backfill of the cause", () => {
  it("gives every legacy shape the cause `rejectionCause` reads in it", async () => {
    const rows = [];
    for (const shape of SHAPES) rows.push({ shape, row: await legacy(shape) });
    await backfill();
    for (const { shape, row } of rows) {
      const [after] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, row.id));
      const typescript = rejectionCause({ status: shape.status, sent: shape.sent, reason: shape.lastError });
      expect(after.rejectionCause, shape.lastError ?? "null").toBe(shape.expected);
      expect(typescript, shape.lastError ?? "null").toBe(shape.expected);
    }
  });

  it("leaves a sent row and a cause already stored alone", async () => {
    const sent = await legacy({ status: "SENT", sent: true, lastError: null });
    const stored = await legacy({ status: "BOUNCED", sent: true, lastError: "bounce" });
    await db.update(emailOutbox).set({ rejectionCause: "mailbox-full" }).where(eq(emailOutbox.id, stored.id));
    await backfill();
    const after = await db.select({ id: emailOutbox.id, cause: emailOutbox.rejectionCause }).from(emailOutbox).orderBy(asc(emailOutbox.idempotencyKey));
    expect(after.find((row) => row.id === sent.id)?.cause).toBeNull();
    expect(after.find((row) => row.id === stored.id)?.cause).toBe("mailbox-full");
  });
});

describe("migration 0131's backfill of what came after", () => {
  it("marks a refusal sent again by its latest send and road, and ends the account's refusal with the first", async () => {
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", surface: "ASPHALT", startsAt: new Date("2099-11-21T08:00:00.000Z"), timezone: "Europe/Bucharest", capacity: 150, registrationMode: "INTERNAL" })
      .returning();
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: "ana@example.org", normalizedEmail: "ana@example.org", canonicalEmail: "ana@example.org", canonicalizationVersion: 2, defaultName: "Ana Pop" })
      .returning();
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId: event.id,
        participantId: participant.id,
        kind: "REAL",
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: resolveDisplayName({ legalName: "Ana Pop" }),
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: T0,
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        status: "CONFIRMED",
      })
      .returning();
    const own = { participantId: participant.id, registrationId: registration.id };
    const account = await legacy({ ...own, status: "BOUNCED", sent: false, lastError: "mailgun 401: Forbidden", createdAt: minutes(0) });
    await legacy({ ...own, status: "SENT", sent: true, createdAt: minutes(10), sentAt: minutes(11), transport: "mailgun" });
    await legacy({ ...own, status: "SENT", sent: true, createdAt: minutes(20), sentAt: minutes(21), transport: "gmail" });
    const bounce = await legacy({ ...own, messageType: "BIB_ASSIGNED", status: "BOUNCED", sent: true, lastError: "bounce", createdAt: minutes(30) });
    await legacy({ ...own, messageType: "BIB_ASSIGNED", status: "SENT", sent: true, createdAt: minutes(40), sentAt: minutes(41) });
    const notAgain = await legacy({ ...own, messageType: "EVENT_REMINDER", status: "BOUNCED", sent: true, lastError: "bounce", createdAt: minutes(50) });
    const complaint = await legacy({ ...own, messageType: "ORGANIZER_MESSAGE", status: "COMPLAINED", sent: true, createdAt: minutes(60) });
    await legacy({ ...own, messageType: "ORGANIZER_MESSAGE", status: "SENT", sent: true, createdAt: minutes(70) });
    const archive = await legacy({ ...own, messageType: "DECLARATION_ARCHIVE", status: "BOUNCED", sent: true, lastError: "bounce", createdAt: minutes(80) });
    await legacy({ ...own, messageType: "DECLARATION_ARCHIVE", status: "SENT", sent: true, createdAt: minutes(90) });
    await backfill();

    const read = async (id: string) => (await db.select().from(emailOutbox).where(eq(emailOutbox.id, id)))[0];
    expect(await read(account.id)).toMatchObject({ rejectionCause: "account", retriedAt: minutes(21), retriedVia: "gmail", resolvedAt: minutes(11) });
    expect(await read(bounce.id)).toMatchObject({ retriedAt: minutes(41), retriedVia: "mailgun", resolvedAt: null });
    expect(await read(notAgain.id)).toMatchObject({ retriedAt: null, resolvedAt: null, laterDeliveredAt: null });
    expect(await read(complaint.id)).toMatchObject({ retriedAt: null, resolvedAt: null });
    expect(await read(archive.id)).toMatchObject({ retriedAt: null, resolvedAt: null });
    // No delivery is invented: none was recorded before this release.
    expect((await db.select().from(emailOutbox)).every((row) => row.deliveredAt === null && row.laterDeliveredAt === null && row.rejectedAt === null)).toBe(true);
  });
});
