import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { confirmRegistrationByStaff, createRegistrationByStaff, handedBibRefusalCode } from "@/modules/registrations/admin-service";
import { approveNotices, removeApprovedNotices } from "./legal-fixture";

/**
 * §992 × §444 × BR-REQ-038-01 — an invitation's blank bib on two real connections: the confirmation of a registration whose
 * invitation carried «La confirmare primește un BIB gol» reads the lowest free desk spare and writes it under the event row's
 * lock, the one every number at the event is drawn, typed or handed under.
 *
 * - Two ticked confirmations at once take two different spares — never one spare on two chests.
 * - A ticked confirmation and a walk-in handed the same spare at the desk at once: the spare is on exactly one chest; the
 *   invited runner wears a spare either way, and the walk-in is either the one wearing it or stands unconfirmed with
 *   `WALK_IN_BIB_TAKEN`, to be confirmed with another.
 *
 * A third connection holds the event row while the requests queue on it — as `spare-bibs.test.ts` does — so every read
 * outside the lock has certainly happened before either writes anything: the window, every run.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("§992 §444 BR-REQ-038-01 an invitation's blank bib, on two connections", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
  const db = drizzle(pool);
  const NOW = new Date("2026-09-26T08:00:00.000Z");
  const createdEventIds: string[] = [];
  const noticeIds: string[] = [];
  let deskId: string | undefined;
  let adminId: string | undefined;
  let serial = 0;

  beforeAll(async () => {
    // The declaration the desk's paper confirmation binds to (§67), above any seeded version (§881).
    noticeIds.push(...(await approveNotices(db, ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"], NOW)));
    const stamp = Date.now();
    const [desk] = await db.insert(staffUsers).values({ email: `blank.desk.${stamp}@example.ro`, displayName: "Desk", role: "CONTRIBUTOR" }).returning();
    deskId = desk.id;
    const [admin] = await db.insert(staffUsers).values({ email: `blank.admin.${stamp}@example.ro`, displayName: "Admin", role: "ADMIN" }).returning();
    adminId = admin.id;
  });

  afterAll(async () => {
    const rows =
      createdEventIds.length > 0
        ? await db.select({ id: registrations.id, participantId: registrations.participantId }).from(registrations).where(inArray(registrations.eventId, createdEventIds))
        : [];
    const registrationIds = rows.map((row) => row.id);
    const participantIds = [...new Set(rows.map((row) => row.participantId))];
    if (createdEventIds.length > 0) await db.delete(eventInvitations).where(inArray(eventInvitations.eventId, createdEventIds));
    if (registrationIds.length > 0) {
      await db.delete(emailOutbox).where(inArray(emailOutbox.registrationId, registrationIds));
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, registrationIds));
      await db.delete(declarationAcceptances).where(inArray(declarationAcceptances.registrationId, registrationIds));
    }
    if (createdEventIds.length > 0) {
      await db.delete(registrations).where(inArray(registrations.eventId, createdEventIds));
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, createdEventIds));
      await db.delete(events).where(inArray(events.id, createdEventIds));
    }
    if (participantIds.length > 0) {
      await db.delete(emailOutbox).where(inArray(emailOutbox.participantId, participantIds));
      await db.delete(participants).where(inArray(participants.id, participantIds));
    }
    for (const id of [deskId, adminId]) {
      if (!id) continue;
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffUserId, id));
      await db.delete(staffUsers).where(eq(staffUsers.id, id));
    }
    await removeApprovedNotices(db, noticeIds);
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

  async function race(): Promise<string> {
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-12-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: 50, walkInBibStart: 154, walkInBibCount: 5 })
      .returning();
    createdEventIds.push(event.id);
    return event.id;
  }

  /** A registration waiting for its declaration, and the accepted invitation it came from, sent with the blank-bib tick. */
  async function invitedRunner(eventId: string): Promise<string> {
    serial += 1;
    const email = `blank.invited.${serial}.${Date.now()}@example.ro`;
    const name = `Ana Pop ${serial}`;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name, preferredLocale: "ro" })
      .returning();
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: participant.id,
        locale: "ro",
        registeredName: name,
        displayName: name,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        status: "PENDING_DECLARATION",
        emailConfirmedAt: NOW,
        holdExpiresAt: new Date("2026-11-30T09:00:00.000Z"),
      })
      .returning();
    await db.insert(eventInvitations).values({
      eventId,
      participantId: participant.id,
      name,
      email,
      canonicalEmail: email,
      invitedByStaffUserId: adminId as string,
      sentAt: NOW,
      expiresAt: new Date("2026-11-30T09:00:00.000Z"),
      lastSentAt: NOW,
      blankBib: true,
      acceptedAt: NOW,
      acceptedRegistrationId: registration.id,
    });
    return registration.id;
  }

  const desk = () => ({ id: deskId as string, role: "CONTRIBUTOR" as const });

  it("two ticked confirmations at once take two different spares, both printed", async () => {
    const eventId = await race();
    const first = await invitedRunner(eventId);
    const second = await invitedRunner(eventId);

    const holder = await pool.connect();
    const pending: Promise<unknown>[] = [];
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      pending.push(confirmRegistrationByStaff(db, desk(), first, NOW));
      await queuedOnEvent(1);
      pending.push(confirmRegistrationByStaff(db, desk(), second, NOW));
      await queuedOnEvent(2);
    } finally {
      await holder.query("COMMIT");
      holder.release();
    }
    const results = await Promise.allSettled(pending);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);

    const rows = await db.select().from(registrations).where(eq(registrations.eventId, eventId));
    expect(rows.map((row) => row.status)).toEqual(["CONFIRMED", "CONFIRMED"]);
    expect(rows.map((row) => row.bibNumber).sort()).toEqual([154, 155]);
    expect(rows.every((row) => row.bibPrintedAt !== null)).toBe(true);
    const lines = await db.select().from(auditLogs).where(inArray(auditLogs.entityId, [first, second]));
    expect(lines.filter((row) => row.action === "registration.invitation_blank_bib_given")).toHaveLength(2);
  });

  it("a ticked confirmation and a walk-in handed the same spare at once: the spare on one chest only", async () => {
    const eventId = await race();
    const ana = await invitedRunner(eventId);
    const walkIn = () =>
      createRegistrationByStaff(
        db,
        // A walk-in is entered by an organizer or an Administrator since §NNN; the desk's volunteer confirms on paper.
        { id: adminId as string, role: "ADMIN" as const },
        {
          eventId,
          firstName: "Mara",
          lastName: "Pop",
          email: `blank.walkin.${Date.now()}@example.ro`,
          locale: "ro",
          listOptOut: false,
          relayedByParticipantRequest: true,
          fastTrack: true,
          bibNumber: 154,
        },
        NOW,
      );

    const holder = await pool.connect();
    let invitedPress: Promise<unknown> = Promise.resolve();
    let deskPress: Promise<unknown> = Promise.resolve();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      // The walk-in's check outside the lock finds 154 free now; then both queue on the event row.
      invitedPress = confirmRegistrationByStaff(db, desk(), ana, NOW);
      await queuedOnEvent(1);
      deskPress = walkIn();
      await queuedOnEvent(2);
    } finally {
      await holder.query("COMMIT");
      holder.release();
    }
    const [invited, atDesk] = await Promise.allSettled([invitedPress, deskPress]);
    expect(invited.status).toBe("fulfilled");

    const rows = await db.select().from(registrations).where(eq(registrations.eventId, eventId));
    const numbers = rows.flatMap((row) => (row.bibNumber === null ? [] : [row.bibNumber]));
    // No number on two chests, and 154 on exactly one.
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.filter((number) => number === 154)).toHaveLength(1);
    // The invited runner wears a spare, printed, whichever went first.
    const anaRow = rows.find((row) => row.id === ana);
    expect([154, 155]).toContain(anaRow?.bibNumber);
    expect(anaRow?.bibPrintedAt).not.toBeNull();
    // The walk-in either wears 154, or stands unconfirmed with no number and is told the spare is taken.
    const mara = rows.find((row) => row.registeredName === "Mara Pop");
    if (atDesk.status === "rejected") {
      expect(handedBibRefusalCode(atDesk.reason)).toBe("WALK_IN_BIB_TAKEN");
      expect(mara?.bibNumber ?? null).toBeNull();
      expect(anaRow?.bibNumber).toBe(154);
    } else {
      expect(mara?.bibNumber).toBe(154);
      expect(anaRow?.bibNumber).toBe(155);
    }
  });
});
