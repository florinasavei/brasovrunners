import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { createRegistrationByStaff, handedBibRefusalCode } from "@/modules/registrations/admin-service";

/**
 * §NNN × BR-REQ-037-07 — two volunteers handing the same desk spare at once, on two connections.
 *
 * The desk checks the number before the entry is written, outside the event's lock, so two walk-ins
 * entered together with the same spare both pass that check. The confirmation that writes the
 * number runs under the lock and checks again: exactly one runner wears the spare, and the other
 * entry stands unconfirmed with `WALK_IN_BIB_TAKEN`, so the desk confirms it with another spare.
 *
 * A third connection holds the event row while both requests queue on it — the way
 * `desk-race.test.ts` orders its two — so both pre-checks have certainly passed before either
 * writes anything: the window, every run.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("§NNN BR-REQ-037-07 two volunteers handing one spare, on two connections", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
  const db = drizzle(pool);
  const NOW = new Date("2026-09-26T08:00:00.000Z");
  const createdEventIds: string[] = [];
  let staffId: string | undefined;

  beforeAll(async () => {
    for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
      const translations: LegalDocumentTranslationInput[] = [
        { locale: "ro", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
        { locale: "en", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
      ];
      // Already there on a database another suite prepared: the one in force is what counts.
      await insertLegalDocumentVersion(db, {
        key,
        version: 1,
        effectiveAt: new Date("2020-01-01T00:00:00.000Z"),
        isApproved: true,
        contentSha256: computeContentHash(translations),
        translations,
        now: NOW,
      }).catch(() => undefined);
    }
    const [staff] = await db
      .insert(staffUsers)
      .values({ email: `spare.race.${Date.now()}@example.ro`, displayName: "Desk", role: "CONTRIBUTOR" })
      .returning();
    staffId = staff.id;
  });

  afterAll(async () => {
    const rows =
      createdEventIds.length > 0
        ? await db
            .select({ id: registrations.id, participantId: registrations.participantId })
            .from(registrations)
            .where(inArray(registrations.eventId, createdEventIds))
        : [];
    const registrationIds = rows.map((row) => row.id);
    const participantIds = [...new Set(rows.map((row) => row.participantId))];
    if (registrationIds.length > 0) {
      await db.delete(emailOutbox).where(inArray(emailOutbox.registrationId, registrationIds));
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, registrationIds));
      await db.delete(declarationAcceptances).where(inArray(declarationAcceptances.registrationId, registrationIds));
    }
    if (createdEventIds.length > 0) {
      await db.delete(registrations).where(inArray(registrations.eventId, createdEventIds));
      await db.delete(events).where(inArray(events.id, createdEventIds));
    }
    if (participantIds.length > 0) {
      await db.delete(emailOutbox).where(inArray(emailOutbox.participantId, participantIds));
      await db.delete(participants).where(inArray(participants.id, participantIds));
    }
    if (staffId) {
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffUserId, staffId));
      await db.delete(staffUsers).where(eq(staffUsers.id, staffId));
    }
    await pool.end();
  });

  /** Waits until `count` backends of this database are queued on a lock — the event row's. */
  async function queuedOnEvent(count: number): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const result = await db.execute(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`);
      if (Number((result.rows[0] as { n: number }).n) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`expected ${count} requests queued on the event's lock`);
  }

  it("one runner wears the spare; the other entry stands unconfirmed and is told why", async () => {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: new Date("2026-12-01T09:00:00.000Z"),
        registrationMode: "INTERNAL",
        capacity: 50,
        bibSpareFrom: 900,
        bibSpareTo: 909,
      })
      .returning();
    createdEventIds.push(event.id);
    const stamp = Date.now();
    const walkIn = (name: string) =>
      createRegistrationByStaff(
        db,
        { id: staffId as string, role: "CONTRIBUTOR" },
        {
          eventId: event.id,
          firstName: name,
          lastName: "Pop",
          email: `spare.${name.toLowerCase()}.${stamp}@example.ro`,
          locale: "ro",
          listOptOut: false,
          relayedByParticipantRequest: true,
          fastTrack: true,
          bibNumber: 900,
        },
        NOW,
      );

    const holder = await pool.connect();
    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [event.id]);
      // Both pre-checks run now and find 900 free; both entries then queue on the event row.
      first = walkIn("Ana");
      await queuedOnEvent(1);
      second = walkIn("Maria");
      await queuedOnEvent(2);
    } finally {
      await holder.query("COMMIT");
      holder.release();
    }

    const results = await Promise.allSettled([first, second]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(handedBibRefusalCode(refused?.reason)).toBe("WALK_IN_BIB_TAKEN");

    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    // Two entries, one number: the spare on exactly one chest, and the other waiting for another.
    expect(rows.filter((row) => row.bibNumber === 900)).toHaveLength(1);
    expect(rows.map((row) => row.status).sort()).toEqual(["CONFIRMED", "PENDING_EMAIL_CONFIRMATION"]);
    const unconfirmed = rows.find((row) => row.status !== "CONFIRMED");
    expect(unconfirmed?.bibNumber).toBeNull();
  });
});
