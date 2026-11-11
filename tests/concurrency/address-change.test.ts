import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { platformSettings } from "@/db/schema/platform-settings";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { forgetCachedAddressCap } from "@/modules/registrations/address-cap-memo";
import { ADDRESS_CAP_SETTING_KEY } from "@/modules/registrations/address-cap";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { ADDRESS_AT_CAP, ALREADY_ON_ADDRESS } from "@/modules/registrations/domain/family";
import { ADDRESS_CHANGED_MEANWHILE } from "@/modules/registrations/domain/address-change";
import { deleteRegistrationByStaff } from "@/modules/registrations/admin-service";
import { changeRegistrationAddressByStaff, type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { approveNotices, removeApprovedNotices } from "./legal-fixture";

/**
 * «Schimbă adresa» under real concurrency (BR-REQ-037-03, BR-REQ-034-02). The move reads the new address's rows under
 * the event's lock — the lock every entry takes before it reads an address (§389) — so two moves onto one address cannot
 * both find room under the club's limit, and a move racing a public form of the same runner on the new address never
 * reaches the database's unique index as a raw failure: one of the two wins, the other is answered in words.
 * An erase of a row that holds no place takes no event lock: the move's row lock (`FOR NO KEY UPDATE`, before the row's
 * links and mail) makes it wait for the move instead of meeting it in a lock cycle; a cycle that remains is answered
 * «press again» (`ADDRESS_CHANGED_MEANWHILE`), never raw.
 * PGlite cannot express these races (`tests/helpers/db.ts`); this runs against the real server `yarn test:concurrency` uses.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("«Schimbă adresa» under real concurrency", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
  const db = drizzle(pool);
  const NOW = new Date("2026-09-25T10:00:00.000Z");
  const createdEventIds: string[] = [];
  const noticeIds: string[] = [];
  const emails: string[] = [];
  let previousCap: unknown = undefined;
  let adminId = "";
  const stamp = Date.now();

  beforeAll(async () => {
    noticeIds.push(...(await approveNotices(db, ["PRIVACY_NOTICE", "TERMS"], NOW)));
    const [kept] = await db.select().from(platformSettings).where(eq(platformSettings.key, ADDRESS_CAP_SETTING_KEY));
    previousCap = kept?.value;
    const [admin] = await db.insert(staffUsers).values({ email: `address-change-${stamp}@dev.test`, displayName: "Admin", role: "ADMIN" }).returning();
    adminId = admin.id;
  });

  afterAll(async () => {
    const rows = createdEventIds.length > 0 ? await db.select({ id: registrations.id }).from(registrations).where(inArray(registrations.eventId, createdEventIds)) : [];
    const registrationIds = rows.map((row) => row.id);
    if (registrationIds.length > 0) {
      await db.delete(emailOutbox).where(inArray(emailOutbox.registrationId, registrationIds));
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, registrationIds));
    }
    if (createdEventIds.length > 0) {
      await db.delete(registrations).where(inArray(registrations.eventId, createdEventIds));
      await db.delete(events).where(inArray(events.id, createdEventIds));
    }
    const canonical = emails.map((email) => canonicalizeEmail(email).canonicalEmail);
    if (canonical.length > 0) {
      const people = await db.select({ id: participants.id }).from(participants).where(inArray(participants.canonicalEmail, canonical));
      const ids = people.map((person) => person.id);
      if (ids.length > 0) {
        await db.delete(emailOutbox).where(inArray(emailOutbox.participantId, ids));
        await db.delete(auditLogs).where(inArray(auditLogs.participantId, ids));
        await db.delete(participants).where(inArray(participants.id, ids));
      }
    }
    await db.delete(auditLogs).where(eq(auditLogs.actorStaffUserId, adminId));
    await db.delete(staffUsers).where(eq(staffUsers.id, adminId));
    await db.delete(platformSettings).where(eq(platformSettings.key, ADDRESS_CAP_SETTING_KEY));
    if (previousCap !== undefined) await db.insert(platformSettings).values({ key: ADDRESS_CAP_SETTING_KEY, value: previousCap, updatedAt: NOW });
    forgetCachedAddressCap();
    await removeApprovedNotices(db, noticeIds);
    await pool.end();
  });

  async function createEvent(): Promise<EventForRegistration> {
    const [event] = await db
      .insert(events)
      .values({ type: "MEETUP", startsAt: new Date("2026-12-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: 50 })
      .returning();
    createdEventIds.push(event.id);
    return { id: event.id, eventStatus: event.eventStatus, registrationMode: "INTERNAL", startsAt: event.startsAt, registrationOpensAt: null, registrationClosesAt: null, capacity: event.capacity, raceId: null, publishedAt: NOW };
  }

  const address = (who: string) => {
    const email = `address.${who}.${stamp}@example.ro`;
    emails.push(email);
    return email;
  };
  const BIRTH_DATES: Record<string, string> = { Ana: "1985-03-02", Elena: "1990-07-11" };
  const submission = (email: string, firstName: string) => ({
    firstName,
    lastName: "Pop",
    birthDate: BIRTH_DATES[firstName] ?? "1985-03-02",
    city: "Brașov",
    sex: "FEMALE",
    phone: "+40711111111",
    emergencyContactName: "Ion Vecinul",
    emergencyContactPhone: "+40722222222",
    nationality: "RO",
    country: "RO",
    email,
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    termsAccepted: true,
    rulesAcknowledged: true,
    resultsNameConsent: false,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(NOW.getTime() - 30_000).toISOString(),
  });
  const registrationOn = async (eventId: string, email: string) =>
    db
      .select({ id: registrations.id, participantId: registrations.participantId, registeredName: registrations.registeredName })
      .from(registrations)
      .innerJoin(participants, eq(participants.id, registrations.participantId))
      .where(and(eq(registrations.eventId, eventId), eq(participants.canonicalEmail, canonicalizeEmail(email).canonicalEmail)));

  it("two moves onto one address at once, at a limit of one: exactly one succeeds, the other is told the limit", async () => {
    await db.delete(platformSettings).where(eq(platformSettings.key, ADDRESS_CAP_SETTING_KEY));
    await db.insert(platformSettings).values({ key: ADDRESS_CAP_SETTING_KEY, value: { registrationsPerAddress: 1 }, updatedAt: NOW });
    forgetCachedAddressCap();
    const event = await createEvent();
    const ana = address("ana");
    const elena = address("elena");
    const target = address("target");
    await submitRegistration(db, event, submission(ana, "Ana"), NOW);
    await submitRegistration(db, event, submission(elena, "Elena"), NOW);
    const [anaRow] = await registrationOn(event.id, ana);
    const [elenaRow] = await registrationOn(event.id, elena);
    const actor = { id: adminId, role: "ADMIN" as const };

    const results = await Promise.allSettled([
      changeRegistrationAddressByStaff(db, actor, anaRow.id, target, new Date(NOW.getTime() + 60_000)),
      changeRegistrationAddressByStaff(db, actor, elenaRow.id, target, new Date(NOW.getTime() + 60_000)),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [refused] = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(isDomainError(refused.reason) && refused.reason.fields).toContain(ADDRESS_AT_CAP);
    expect(await registrationOn(event.id, target)).toHaveLength(1);
    await db.delete(platformSettings).where(eq(platformSettings.key, ADDRESS_CAP_SETTING_KEY));
    forgetCachedAddressCap();
  });

  it("a move racing a public form of the same runner on the new address: one wins, never a raw unique violation", async () => {
    const event = await createEvent();
    const ana = address("ana2");
    const target = address("target2");
    await submitRegistration(db, event, submission(ana, "Ana"), NOW);
    const [anaRow] = await registrationOn(event.id, ana);
    const actor = { id: adminId, role: "ADMIN" as const };

    const results = await Promise.allSettled([
      changeRegistrationAddressByStaff(db, actor, anaRow.id, target, new Date(NOW.getTime() + 60_000)),
      submitRegistration(db, event, submission(target, "Ana"), new Date(NOW.getTime() + 60_000)),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        // Answered in words: the same runner on the new address, never PostgreSQL's 23505.
        expect(isDomainError(result.reason), String(result.reason)).toBe(true);
        expect((result.reason as { fields: string[] }).fields).toContain(ALREADY_ON_ADDRESS);
      }
    }
    // One «Ana Pop» on the new address at the event, whichever press came first.
    expect((await registrationOn(event.id, target)).filter((row) => row.registeredName === "Ana Pop")).toHaveLength(1);
  });

  it("an erase racing the move of a cancelled row: both calls end, the move moves, is NOT_FOUND or says «press again», never raw; the row gone", { timeout: 30_000 }, async () => {
    const event = await createEvent();
    const actor = { id: adminId, role: "ADMIN" as const };
    for (let round = 0; round < 5; round++) {
      const ana = address(`ana-erased-${round}`);
      const target = address(`target-erased-${round}`);
      await submitRegistration(db, event, submission(ana, "Ana"), NOW);
      const [anaRow] = await registrationOn(event.id, ana);
      // A cancelled row holds no place: its erase takes no event lock, and its move is allowed.
      await db.update(registrations).set({ status: "CANCELLED", cancelledAt: NOW, cancellationSource: "ADMIN" }).where(eq(registrations.id, anaRow.id));
      const later = new Date(NOW.getTime() + 60_000);
      const [move, erase] = await Promise.allSettled([
        changeRegistrationAddressByStaff(db, actor, anaRow.id, target, later),
        deleteRegistrationByStaff(db, actor, anaRow.id, "cerere de ștergere", later),
      ]);
      if (move.status === "rejected") {
        // The three endings: moved (fulfilled), gone before the lock, or a lock cycle broken and answered in words.
        const ending = isDomainError(move.reason) ? (move.reason.fields.includes(ADDRESS_CHANGED_MEANWHILE) ? "TRY_AGAIN" : move.reason.code) : String(move.reason);
        expect(["NOT_FOUND", "TRY_AGAIN"], String(move.reason)).toContain(ending);
      }
      if (erase.status === "rejected") {
        expect(isDomainError(erase.reason) && erase.reason.code, String(erase.reason)).toBe("NOT_FOUND");
      }
      expect(await db.select({ id: registrations.id }).from(registrations).where(eq(registrations.id, anaRow.id))).toEqual([]);
    }
  });
});
