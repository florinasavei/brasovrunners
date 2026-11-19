import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { assignBibNumbers } from "@/modules/registrations/bibs";
import { addEliteEntry, giveEliteNumbers } from "@/modules/registrations/elite-list";

/**
 * §990 — a line of the race's elite list added with no number draws one by itself (BR-REQ-038-01), on real connections racing:
 * several Administrators adding names at the same instant, and a confirmation's draw («Alocă numerele») beside them, each get a
 * number of their own. Every one of them reads the numbers taken under the event row's lock — the one every draw of a number at
 * an event takes (`AGENTS.md` §10.6) — so none reads a «next free» number another is about to write; nothing else stops two
 * lines sharing a number, since the elite list has no unique index on it. A third connection holds the event row while the
 * presses queue on it, so they all arrive before any of them writes: the overlap is forced every run, not hoped for. PGlite has
 * one connection and cannot show this (`tests/helpers/db.ts`).
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("§990 elite lines numbered by themselves, at once, on real connections", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
  const db = drizzle(pool);
  const NOW = new Date();
  const tag = `elite-numbers-${Date.now()}`;
  const eventIds: string[] = [];
  const participantIds: string[] = [];
  let admin: StaffUser | undefined;

  beforeAll(async () => {
    [admin] = await db.insert(staffUsers).values({ email: `${tag}@example.test`, displayName: "Admin", role: "ADMIN" }).returning();
  });

  afterAll(async () => {
    if (eventIds.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, eventIds));
      await db.delete(registrations).where(inArray(registrations.eventId, eventIds));
      // The event's cascade takes its elite list.
      await db.delete(events).where(inArray(events.id, eventIds));
    }
    if (participantIds.length > 0) await db.delete(participants).where(inArray(participants.id, participantIds));
    if (admin) {
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffUserId, admin.id));
      await db.delete(staffUsers).where(eq(staffUsers.id, admin.id));
    }
    await pool.end();
  });

  async function race(): Promise<string> {
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date(NOW.getTime() + 2 * 24 * 3_600_000), registrationMode: "INTERNAL", capacity: 100, bibStartNumber: 1 })
      .returning();
    eventIds.push(event.id);
    return event.id;
  }

  async function confirmedWithoutNumber(eventId: string, index: number): Promise<void> {
    const email = `${tag}-${eventId.slice(0, 8)}-${index}@example.test`;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: `Alergător ${index}`, preferredLocale: "ro" })
      .returning({ id: participants.id });
    participantIds.push(participant.id);
    await db.insert(registrations).values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: `Alergător ${index}`,
      displayName: `Alergător ${index}`,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      confirmedAt: new Date(NOW.getTime() + index),
      emailConfirmedAt: NOW,
    });
  }

  /** Runs `presses` while a third connection holds the event row, so every one of them queues on the lock before any writes. */
  async function atOnce<T>(eventId: string, presses: () => Array<Promise<T>>): Promise<T[]> {
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      const running = presses();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await holder.query("COMMIT");
      return await Promise.all(running);
    } finally {
      holder.release();
    }
  }

  it("gives eight names added at the same instant eight different numbers, the race's first eight", async () => {
    const eventId = await race();
    const added = await atOnce(eventId, () => Array.from({ length: 8 }, (_, index) => addEliteEntry(db, admin!, eventId, { name: `Elita ${index}`, bibNumber: "" }, NOW)));
    expect(added.map((line) => line.bibNumber).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const stored = await db.select({ number: eventEliteEntries.bibNumber }).from(eventEliteEntries).where(eq(eventEliteEntries.eventId, eventId));
    expect(new Set(stored.map((row) => row.number)).size).toBe(8);
  });

  it("never gives a line and a runner confirmed at the same instant one number, nor two presses of «Dă număr elitelor fără număr»", async () => {
    const eventId = await race();
    for (let index = 0; index < 4; index += 1) await confirmedWithoutNumber(eventId, index);
    // Two lines from before every line drew a number, for the one-press numbering pressed twice at once.
    await db.insert(eventEliteEntries).values([
      { eventId, name: "Ingrid Pop", bibNumber: null, createdAt: NOW },
      { eventId, name: "Paul Stan", bibNumber: null, createdAt: new Date(NOW.getTime() + 1) },
    ]);
    const outcomes = await atOnce<unknown>(eventId, () => [
      assignBibNumbers(db, { actor: admin!, eventId, now: NOW }),
      addEliteEntry(db, admin!, eventId, { name: "Ana Lungu", bibNumber: "" }, NOW),
      addEliteEntry(db, admin!, eventId, { name: "Silviu Dobre", bibNumber: "" }, NOW),
      giveEliteNumbers(db, admin!, eventId, NOW),
      giveEliteNumbers(db, admin!, eventId, NOW),
    ]);
    // One of the two presses numbered both lines, the other found none.
    const presses = outcomes.slice(3) as Array<{ numbered: unknown[] }>;
    expect(presses.map((press) => press.numbered.length).sort()).toEqual([0, 2]);
    const runners = (await db.select({ number: registrations.bibNumber }).from(registrations).where(eq(registrations.eventId, eventId))).map((row) => row.number);
    const lines = (await db.select({ number: eventEliteEntries.bibNumber }).from(eventEliteEntries).where(eq(eventEliteEntries.eventId, eventId))).map((row) => row.number);
    const all = [...runners, ...lines];
    expect(all.every((number) => number !== null)).toBe(true);
    expect(new Set(all).size).toBe(8);
    expect([...all].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
