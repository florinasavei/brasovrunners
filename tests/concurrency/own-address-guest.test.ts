import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { platformSettings } from "@/db/schema/platform-settings";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { ADDRESS_CAP_SETTING_KEY } from "@/modules/registrations/address-cap";
import { forgetCachedAddressCap } from "@/modules/registrations/address-cap-memo";
import { familyRegistrationOpen } from "@/modules/registrations/family-gate";
import { moveReserveEntryToOwnAddress } from "@/modules/registrations/reserve-list";
import { approveNotices, removeApprovedNotices } from "./legal-fixture";

/**
 * «Pe adresa mea, invitat special» × the club's limit per address, under real concurrency (the decision «A line of the
 * internal list on the Administrator's own address, as a special guest»; BR-REQ-034-02).
 *
 * Every press takes the event row's lock first (`lockEventForCapacity`, the lock every allocation takes, `AGENTS.md`
 * §10.6) and reads which runners the address holds only under it (§389), so three presses at once for three people on
 * one Administrator's address one below the limit run one after another: the first takes the last slot, the other two
 * find the address at the limit and are refused `ADDRESS_AT_CAP`, each writing nothing — their lines stay. PGlite has
 * one connection and cannot express the race (`tests/helpers/db.ts`); this runs against the real server.
 *
 * Needs the contract release (`0073`, the one-per-address constraint gone), as every migrated database has it.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("«Pe adresa mea, invitat special» pressed at once on one address one below the club's limit", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
  const db = drizzle(pool);
  const NOW = new Date("2026-09-25T10:00:00.000Z");
  const ADDRESS = `own.address.${Date.now()}@example.ro`;
  let adminId = "";
  let eventId = "";
  const noticeIds: string[] = [];
  let previousCap: unknown = undefined;

  beforeAll(async () => {
    noticeIds.push(...(await approveNotices(db, ["PRIVACY_NOTICE"], NOW)));
    const [kept] = await db.select().from(platformSettings).where(eq(platformSettings.key, ADDRESS_CAP_SETTING_KEY));
    previousCap = kept?.value;
    const [admin] = await db.insert(staffUsers).values({ email: ADDRESS, displayName: "Admin concurență", role: "ADMIN" }).returning();
    adminId = admin.id;
  });

  afterAll(async () => {
    const rows = eventId ? await db.select({ id: registrations.id, participantId: registrations.participantId }).from(registrations).where(eq(registrations.eventId, eventId)) : [];
    const participantIds = [...new Set(rows.map((row) => row.participantId))];
    if (rows.length > 0) await db.delete(emailOutbox).where(inArray(emailOutbox.registrationId, rows.map((row) => row.id)));
    await db.delete(auditLogs).where(eq(auditLogs.actorStaffUserId, adminId));
    if (eventId) {
      await db.delete(registrations).where(eq(registrations.eventId, eventId));
      await db.delete(events).where(eq(events.id, eventId));
    }
    if (participantIds.length > 0) {
      await db.delete(emailOutbox).where(inArray(emailOutbox.participantId, participantIds));
      await db.delete(auditLogs).where(inArray(auditLogs.participantId, participantIds));
      await db.delete(participants).where(inArray(participants.id, participantIds));
    }
    await db.delete(staffUsers).where(eq(staffUsers.id, adminId));
    await db.delete(platformSettings).where(eq(platformSettings.key, ADDRESS_CAP_SETTING_KEY));
    if (previousCap !== undefined) await db.insert(platformSettings).values({ key: ADDRESS_CAP_SETTING_KEY, value: previousCap, updatedAt: NOW });
    forgetCachedAddressCap();
    await removeApprovedNotices(db, noticeIds);
    await pool.end();
  });

  it("serialises on the event lock: exactly one takes the last slot, the others are refused ADDRESS_AT_CAP and their lines stay", async () => {
    expect(await familyRegistrationOpen(db)).toBe(true);
    await db
      .insert(platformSettings)
      .values({ key: ADDRESS_CAP_SETTING_KEY, value: { registrationsPerAddress: 2 }, updatedAt: NOW })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: { registrationsPerAddress: 2 }, updatedAt: NOW } });
    forgetCachedAddressCap();
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-12-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: 1, waitlistCapacity: 0, hiddenListEnabled: true })
      .returning();
    eventId = event.id;
    const actor = { id: adminId, role: "ADMIN" as const };
    const line = async (firstName: string) =>
      (await db.insert(eventReserveEntries).values({ eventId, firstName, lastName: "Neagu", email: null, note: null, createdByStaffUserId: adminId, createdAt: NOW, updatedAt: NOW }).returning())[0].id;
    const input = { relayedByParticipantRequest: true, locale: "ro" as const };

    // One person already on the address: one slot left.
    await moveReserveEntryToOwnAddress(db, actor, await line("Ilinca"), input, NOW);
    const racing = await Promise.all(["Sorina", "Teodora", "Viorica"].map(line));
    const results = await Promise.allSettled(racing.map((entryId) => moveReserveEntryToOwnAddress(db, actor, entryId, input, NOW)));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(refused).toHaveLength(2);
    for (const failure of refused) expect((failure.reason as { fields?: string[] }).fields).toEqual(["email", "addressAtCap"]);

    const rows = await db.select().from(registrations).where(eq(registrations.eventId, eventId));
    expect(rows).toHaveLength(2);
    // Both outside the places, on a race of one place and no waiting list: no counted place, no line.
    expect(rows.map((row) => [row.status, row.outsideCapacity])).toEqual([
      ["PENDING_DECLARATION", true],
      ["PENDING_DECLARATION", true],
    ]);
    expect(await db.select().from(eventReserveEntries).where(eq(eventReserveEntries.eventId, eventId))).toHaveLength(2);
  });
});
