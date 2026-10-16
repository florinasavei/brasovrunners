import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events } from "@/db/schema/events";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { familyPlaceHolds } from "@/db/schema/family-entries";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import { participants } from "@/db/schema/participants";
import { registrationNotes } from "@/db/schema/registration-notes";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import { LARGEST_TABLES, readDatabaseSizes, sizeQueries, tableRows } from "@/modules/diagnostics/domain/db-sizes";
import { readDatabaseSizesForPage, readDatabaseSizesFrom } from "@/modules/diagnostics/db-sizes";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

// `readOrWhileAway` reaches Next's cache for a page's lifetime; outside a request it does nothing.
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), unstable_cache: vi.fn() }));

/**
 * §NNN — the database's size and growth, on PGlite: the queries `/devs` and `yarn db:sizes` share.
 * Sizes present and ordered; the thirty-day counts right on seeded rows; the registrations per
 * state and the age of their event; a table missing from a database one release behind skipped
 * rather than aborting the reading; the page's reader answering null instead of throwing.
 */
const NOW = new Date("2026-10-16T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const monthsAgo = (months: number) => {
  const date = new Date(NOW.getTime());
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
};

describe("the database's size and growth", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  let counter = 0;
  async function participant() {
    counter += 1;
    const identity = canonicalizeEmail(`runner${counter}@example.ro`);
    const [row] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: "Ana Pop",
      })
      .returning();
    return row;
  }

  async function event(startsAt: Date) {
    const [row] = await db.insert(events).values({ type: "GROUP_RUN", startsAt, registrationMode: "INTERNAL" }).returning();
    return row;
  }

  async function register(eventId: string, status: RegistrationStatus, createdAt = NOW) {
    const person = await participant();
    const [row] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: person.id,
        status,
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: "Ana P.",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
        createdAt,
      })
      .returning();
    return { registration: row, participant: person };
  }

  it("reports the database's size and the largest tables, biggest first, with the table and index split adding up", async () => {
    const sizes = await readDatabaseSizesFrom(db, NOW);

    expect(sizes.databaseBytes).toBeGreaterThan(0);
    expect(sizes.tables.length).toBeGreaterThan(0);
    expect(sizes.tables.length).toBeLessThanOrEqual(LARGEST_TABLES);
    const totals = sizes.tables.map((table) => table.totalBytes);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    for (const table of sizes.tables) {
      expect(table.totalBytes, table.name).toBeGreaterThan(0);
      expect(table.tableBytes + table.indexBytes, table.name).toBe(table.totalBytes);
      // A small table is counted exactly: the number is the count, not the planner's guess.
      expect(table.rows, table.name).not.toBeNull();
      expect(tableRows(table)?.exact, table.name).toBe(true);
    }
    expect(sizes.measuredAt).toEqual(NOW);
  });

  it("counts a table's rows exactly and the thirty days' growth right, at the edge of the window", async () => {
    await db.insert(auditLogs).values([
      { action: "registration.created", entityType: "registration", createdAt: daysAgo(1) },
      { action: "registration.created", entityType: "registration", createdAt: daysAgo(29) },
      { action: "registration.created", entityType: "registration", createdAt: daysAgo(31) },
    ]);
    const sizes = await readDatabaseSizesFrom(db, NOW);

    const audit = sizes.growth.find((entry) => entry.table === "audit_logs");
    expect(audit).toEqual({ table: "audit_logs", total: 3, last30Days: 2, settled: null });
    const table = sizes.tables.find((entry) => entry.name === "audit_logs");
    expect(table?.rows).toBe(3);
  });

  it("counts the outbox, the notes and the tokens, and says how many tokens can no longer be used", async () => {
    const past = await event(monthsAgo(1));
    const { registration, participant: person } = await register(past.id, "CONFIRMED", daysAgo(2));
    await db.insert(emailOutbox).values([
      { participantId: person.id, registrationId: registration.id, messageType: "REGISTRATION_CONFIRMED", locale: "ro", recipientEmail: "a@example.ro", payloadJson: {}, idempotencyKey: "recent", status: "SENT", sentAt: daysAgo(2), createdAt: daysAgo(2) },
      { participantId: person.id, registrationId: registration.id, messageType: "REGISTRATION_CONFIRMED", locale: "ro", recipientEmail: "a@example.ro", payloadJson: {}, idempotencyKey: "old", status: "SENT", sentAt: daysAgo(60), createdAt: daysAgo(60) },
    ]);
    await db.insert(registrationNotes).values([
      { registrationId: registration.id, body: "recent", createdAt: daysAgo(3) },
      { registrationId: registration.id, body: "old", createdAt: daysAgo(90) },
    ]);
    const inAMonth = new Date(NOW.getTime() + 30 * 86_400_000);
    // One active token per registration and purpose: each of the three lives on its own registration.
    const second = await register(past.id, "CONFIRMED", daysAgo(2));
    const third = await register(past.id, "CONFIRMED", daysAgo(2));
    await db.insert(emailActionTokens).values([
      // Used: settled whatever its expiry.
      { participantId: person.id, registrationId: registration.id, purpose: "MANAGE_REGISTRATION", tokenHash: "a".repeat(64), createdAt: daysAgo(5), expiresAt: inAMonth, usedAt: daysAgo(4) },
      // Expired a week ago: settled.
      { participantId: second.participant.id, registrationId: second.registration.id, purpose: "MANAGE_REGISTRATION", tokenHash: "b".repeat(64), createdAt: daysAgo(40), expiresAt: daysAgo(7) },
      // Live: not settled.
      { participantId: third.participant.id, registrationId: third.registration.id, purpose: "MANAGE_REGISTRATION", tokenHash: "c".repeat(64), createdAt: daysAgo(1), expiresAt: inAMonth },
    ]);

    // A family's holds: one past its expiry (settled), one still ahead.
    await db.insert(familyPlaceHolds).values([
      { eventId: past.id, sittingKey: crypto.randomUUID(), slot: "a", expiresAt: daysAgo(3), createdAt: daysAgo(4) },
      { eventId: past.id, sittingKey: crypto.randomUUID(), slot: "b", expiresAt: inAMonth, createdAt: daysAgo(1) },
    ]);

    const sizes = await readDatabaseSizesFrom(db, NOW);
    const of = (table: string) => sizes.growth.find((entry) => entry.table === table);
    expect(of("family_place_holds")).toEqual({ table: "family_place_holds", total: 2, last30Days: 2, settled: 1 });

    expect(of("email_outbox")).toMatchObject({ total: 2, last30Days: 1 });
    expect(of("registration_notes")).toMatchObject({ total: 2, last30Days: 1 });
    expect(of("email_action_tokens")).toEqual({ table: "email_action_tokens", total: 3, last30Days: 2, settled: 2 });
    expect(of("registrations")).toMatchObject({ total: 3, last30Days: 3 });
  });

  it("counts the volunteers, the race's signed declarations and the group runs' signatures, in and out of the thirty days", async () => {
    const past = await event(monthsAgo(1));
    const { registration } = await register(past.id, "CONFIRMED", daysAgo(2));
    const volunteer = (stamp: Date, n: number) => ({
      eventId: past.id,
      name: "Vlad V",
      email: `v${n}@example.test`,
      canonicalEmail: `v${n}@example.test`,
      canonicalizationVersion: 1,
      phone: "+40712345678",
      source: "PUBLIC" as const,
      createdAt: stamp,
    });
    await db.insert(eventVolunteers).values([volunteer(daysAgo(3), 1), volunteer(daysAgo(40), 2)]);

    const translations = [
      { locale: "ro" as const, title: "Declarație", body: { sections: [{ paragraphs: ["text"] }] } },
      { locale: "en" as const, title: "Declaration", body: { sections: [{ paragraphs: ["text"] }] } },
    ];
    const version = await insertLegalDocumentVersion(db, {
      key: "EVENT_DECLARATION",
      version: 1,
      effectiveAt: NOW,
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
    const signed = { legalDocumentId: version, declarationVersion: 1, contentSha256: computeContentHash(translations), locale: "ro" as const, typedName: "Ana Pop", acceptedAt: NOW };
    // One registration carries one declaration: the second, older one belongs to another.
    const other = await register(past.id, "CONFIRMED", daysAgo(50));
    await db.insert(declarationAcceptances).values([
      { ...signed, registrationId: registration.id, createdAt: daysAgo(2) },
      { ...signed, registrationId: other.registration.id, createdAt: daysAgo(50) },
    ]);
    await db.insert(groupRunDeclarations).values([
      { ...signed, eventId: past.id, email: "g1@example.test", createdAt: daysAgo(5) },
      { ...signed, eventId: past.id, email: "g2@example.test", signerKey: "second", createdAt: daysAgo(45) },
      { ...signed, eventId: past.id, email: "g3@example.test", signerKey: "third", createdAt: daysAgo(100) },
    ]);

    const sizes = await readDatabaseSizesFrom(db, NOW);
    const of = (table: string) => sizes.growth.find((entry) => entry.table === table);
    expect(of("event_volunteers")).toEqual({ table: "event_volunteers", total: 2, last30Days: 1, settled: null });
    expect(of("declaration_acceptances")).toEqual({ table: "declaration_acceptances", total: 2, last30Days: 1, settled: null });
    expect(of("group_run_declarations")).toEqual({ table: "group_run_declarations", total: 3, last30Days: 1, settled: null });
  });

  it("measures the past-event ages by calendar month: at a month's end the threshold is the month's last day, not the next month's first", async () => {
    const endOfOctober = new Date("2026-10-31T12:00:00.000Z");
    // Six months before 31 October is 30 April (April has no 31st); twelve is 31 October 2025.
    const justInside = await event(new Date("2026-04-30T23:00:00.000Z"));
    const justPast = await event(new Date("2026-04-30T11:00:00.000Z"));
    const yearInside = await event(new Date("2025-10-31T13:00:00.000Z"));
    const yearPast = await event(new Date("2025-10-31T11:00:00.000Z"));
    for (const target of [justInside, justPast, yearInside, yearPast]) await register(target.id, "CONFIRMED");

    const sizes = await readDatabaseSizesFrom(db, endOfOctober);
    expect(sizes.registrations).toEqual([{ status: "CONFIRMED", total: 4, pastSixMonths: 3, pastTwelveMonths: 1 }]);
  });

  it("counts registrations per state, and how many belong to an event more than six and twelve months past", async () => {
    const recent = await event(daysAgo(10));
    const eightMonths = await event(monthsAgo(8));
    const fifteenMonths = await event(monthsAgo(15));
    await register(recent.id, "CONFIRMED");
    await register(eightMonths.id, "CONFIRMED");
    await register(eightMonths.id, "CONFIRMED");
    await register(fifteenMonths.id, "CONFIRMED");
    await register(fifteenMonths.id, "CANCELLED");
    await register(recent.id, "WAITLISTED");

    const sizes = await readDatabaseSizesFrom(db, NOW);
    const byStatus = Object.fromEntries(sizes.registrations.map((entry) => [entry.status, entry]));

    expect(byStatus.CONFIRMED).toEqual({ status: "CONFIRMED", total: 4, pastSixMonths: 3, pastTwelveMonths: 1 });
    expect(byStatus.CANCELLED).toEqual({ status: "CANCELLED", total: 1, pastSixMonths: 1, pastTwelveMonths: 1 });
    expect(byStatus.WAITLISTED).toEqual({ status: "WAITLISTED", total: 1, pastSixMonths: 0, pastTwelveMonths: 0 });
    expect(Object.keys(byStatus).sort()).toEqual(["CANCELLED", "CONFIRMED", "WAITLISTED"]);
  });

  it("skips a growth table a database one release behind does not have, and still reads the rest", async () => {
    await db.insert(auditLogs).values({ action: "registration.created", entityType: "registration", createdAt: daysAgo(1) });
    const run = async (text: string) => {
      const rows = ((await db.execute(sql.raw(text))) as unknown as { rows: Record<string, unknown>[] }).rows;
      // The catalogue says the table is not there: the reading must not ask for it.
      return text === sizeQueries(NOW).existing ? rows.filter((row) => row.name !== "family_place_holds") : rows;
    };
    const sizes = await readDatabaseSizes(run, NOW);

    expect(sizes.growth.map((entry) => entry.table)).not.toContain("family_place_holds");
    expect(sizes.growth.find((entry) => entry.table === "audit_logs")?.total).toBe(1);
  });

  it("refuses to put anything but a plain table name into a count", () => {
    const q = sizeQueries(NOW);
    expect(q.count("audit_logs")).toBe('SELECT count(*)::bigint AS n FROM "audit_logs"');
    expect(() => q.count('audit_logs"; DROP TABLE events; --')).toThrow();
    expect(() => q.count("Events")).toThrow();
  });

  it("answers null from the page's reader when the database cannot be asked, instead of throwing", async () => {
    const broken = { execute: async () => { throw new Error("the connection is gone"); } } as unknown as TestDatabase;
    await expect(readDatabaseSizesForPage(broken, NOW)).resolves.toBeNull();
    const reading = await readDatabaseSizesForPage(db, NOW);
    expect(reading?.databaseBytes).toBeGreaterThan(0);
  });
});
