import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventResults } from "@/db/schema/event-results";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { type FinishOutcome, recordFinish } from "@/modules/results/results";

/**
 * §NNN — «se poate întâmpla și ca mai mulți voluntari să treacă același număr» (BR-REQ-050-02), on real connections: several
 * volunteers press one race number at the same moment. Every press of the finish line takes the event row's lock first
 * (`results.ts#loadEvent`, `FOR NO KEY UPDATE`), so the presses run one after the other: the first writes the row, every later one
 * reads it under the lock and is a duplicate — its own time in the trail, the row untouched — and the unique index on the event and
 * the number stands behind the lock. And one press sent twice at once — two tabs of one phone, a retry racing its first send — is
 * one row and one line of the trail: the second, under the lock, finds the first's id in the trail and is answered as saved.
 *
 * A third connection holds the event row while the presses queue on it, so they all arrive before any of them writes: the overlap
 * is forced every run, not hoped for. PGlite has one connection and cannot show this (`tests/helpers/db.ts`).
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("§NNN one number pressed by several volunteers at once, on real connections", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
  const db = drizzle(pool);
  const GUN = new Date("2026-11-21T07:00:00.000Z");
  const NOW = new Date(GUN.getTime() + 45 * 60_000);
  const tag = `finish-race-${Date.now()}`;
  let eventId = "";
  let participantId = "";
  const volunteers: Array<{ id: string; role: "CONTRIBUTOR" }> = [];

  beforeAll(async () => {
    const [event] = await db.insert(events).values({ type: "RACE", startsAt: GUN, registrationMode: "INTERNAL" }).returning();
    eventId = event.id;
    const email = `${tag}@example.org`;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: "Ana Popescu", preferredLocale: "ro" })
      .returning();
    participantId = participant.id;
    await db.insert(registrations).values({
      eventId,
      participantId,
      status: "CONFIRMED",
      kind: "REAL",
      locale: "ro",
      registeredName: "Ana Popescu",
      displayName: "Ana Popescu",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: GUN,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      confirmedAt: GUN,
      emailConfirmedAt: GUN,
      bibNumber: 101,
    });
    for (let index = 0; index < 6; index += 1) {
      const [staff] = await db.insert(staffUsers).values({ email: `${tag}-${index}@example.test`, displayName: `Voluntar ${index}`, role: "CONTRIBUTOR" }).returning();
      volunteers.push({ id: staff.id, role: "CONTRIBUTOR" });
    }
  });

  afterAll(async () => {
    if (eventId) {
      await db.delete(auditLogs).where(eq(auditLogs.entityId, eventId));
      await db.delete(eventResults).where(eq(eventResults.eventId, eventId));
      await db.delete(registrations).where(eq(registrations.eventId, eventId));
      await db.delete(events).where(eq(events.id, eventId));
    }
    if (participantId) await db.delete(participants).where(eq(participants.id, participantId));
    if (volunteers.length > 0) await db.delete(staffUsers).where(inArray(staffUsers.id, volunteers.map((one) => one.id)));
    await pool.end();
  });

  it("keeps one row — the first press's — and writes every other press to the trail as a duplicate", async () => {
    // A third connection holds the event row: every press queues on it before any of them reads.
    const holder = await pool.connect();
    let outcomes: FinishOutcome[] = [];
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      const presses = volunteers.map((volunteer, index) => recordFinish(db, volunteer, { eventId, bibNumber: 101, claimedAtMs: NOW.getTime() - 10_000 + index * 1000 }, NOW));
      // Let every press reach the lock, then let go.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await holder.query("COMMIT");
      outcomes = await Promise.all(presses);
    } finally {
      holder.release();
    }
    const recorded = outcomes.filter((outcome) => outcome.kind === "recorded");
    const duplicates = outcomes.filter((outcome) => outcome.kind === "duplicate");
    expect(recorded).toHaveLength(1);
    expect(duplicates).toHaveLength(volunteers.length - 1);

    const rows = await db.select().from(eventResults).where(eq(eventResults.eventId, eventId));
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ bibNumber: 101, status: "FINISHED", gunTimeMs: recorded[0].gunTimeMs, createdAt: row.updatedAt });
    for (const duplicate of duplicates) expect(duplicate).toMatchObject({ storedGunTimeMs: row.gunTimeMs, storedBy: expect.stringMatching(/^Voluntar \d$/) });

    const trail = await db
      .select({ action: auditLogs.action, actor: auditLogs.actorStaffUserId })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, eventId), inArray(auditLogs.action, ["event_result.created", "event_result.finish_duplicate"])));
    expect(trail.filter((one) => one.action === "event_result.created")).toEqual([{ action: "event_result.created", actor: row.updatedByStaffUserId }]);
    expect(trail.filter((one) => one.action === "event_result.finish_duplicate")).toHaveLength(volunteers.length - 1);
  });

  it("keeps one press sent four times at once — its own id — as one row and one line of the trail, every other send answered as saved", async () => {
    await db.delete(auditLogs).where(eq(auditLogs.entityId, eventId));
    await db.delete(eventResults).where(eq(eventResults.eventId, eventId));
    const holder = await pool.connect();
    const pressId = "4a7e0c1d-2b3f-4c5d-8e9f-0a1b2c3d4e5f";
    let outcomes: FinishOutcome[] = [];
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      // The same entry of one phone, sent by two tabs and retried: one claim, one id, four connections.
      const sends = [0, 1, 2, 3].map(() => recordFinish(db, volunteers[0], { eventId, bibNumber: 101, claimedAtMs: NOW.getTime() - 6_000, pressId }, NOW));
      await new Promise((resolve) => setTimeout(resolve, 500));
      await holder.query("COMMIT");
      outcomes = await Promise.all(sends);
    } finally {
      holder.release();
    }
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["recorded", "recorded", "recorded", "recorded"]);
    expect(outcomes.filter((outcome) => outcome.kind === "recorded" && !outcome.again)).toHaveLength(1);
    expect(await db.select().from(eventResults).where(eq(eventResults.eventId, eventId))).toHaveLength(1);
    const trail = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, eventId));
    expect(trail).toEqual([{ action: "event_result.created" }]);
  });
});
