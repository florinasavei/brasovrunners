import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { ELITE_NAME_MAX, eventEliteEntries } from "@/db/schema/event-elite-entries";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { countKits, readPlaceOutlook, summariseRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { assignBibNumbers, bibNumberInUse, countBibs, listBibs, suggestFreeBibNumbers } from "@/modules/registrations/bibs";
import { pruneExpiredRows } from "@/modules/jobs/retention";
import { addEliteEntry, deleteEliteEntry, listEliteEntries, parseEliteEntry } from "@/modules/registrations/elite-list";
import { resolveDisplayName } from "@/modules/registrations/names";
import { countOccupied } from "@/modules/registrations/repository";
import { canManageRegistrations, canReadRegistrations, STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Elită — doar numele pe BIB» (§895; BR-REQ-038-01, BR-REQ-060-01) — the owner, 2026-11-03, «Listă separată»: the
 * race's elite runners as names printed on bibs, the name where the number goes. Not registrations: nothing here
 * registers anybody, emails anybody or reaches any count. Read from a real database (PGlite, the same migrations as Neon).
 */
const NOW = new Date("2026-11-03T10:00:00.000Z");
const later = (n: number) => new Date(NOW.getTime() + n * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => resetTables(db));

async function createRace(startsAt = new Date("2099-11-21T08:00:00.000Z")): Promise<string> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      capacity: 10,
      kitShirt: true,
    })
    .returning();
  return event.id;
}

async function staff(role: StaffRole): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

/** A confirmed runner with a number (or none yet, for «Alocă numerele»), so every count below has something real to say. */
async function confirmedRunner(eventId: string, email: string, bibNumber: number | null): Promise<void> {
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: "Ana Pop", preferredLocale: "ro" })
    .returning();
  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    kind: "REAL",
    locale: "ro",
    registeredName: "Ana Pop",
    displayName: resolveDisplayName({ legalName: "Ana Pop" }),
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    status: "CONFIRMED",
    confirmedAt: NOW,
    bibNumber,
  });
}

async function failureOf(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    if (isDomainError(error)) return error;
    throw error;
  }
  throw new Error("expected a DomainError");
}

describe("§895 the race's elite list", () => {
  it("keeps names in the order typed, with an optional number, and registers, emails and tells nobody", async () => {
    const race = await createRace();
    const admin = await staff("ADMIN");
    await addEliteEntry(db, admin, race, { name: "  Eliud   Kipchoge ", bibNumber: "" }, NOW);
    await addEliteEntry(db, admin, race, { name: "Faith Kipyegon", bibNumber: " 2 " }, later(1));

    const rows = await listEliteEntries(db, admin, race);
    expect(rows.map((row) => [row.name, row.bibNumber])).toEqual([
      ["Eliud Kipchoge", null],
      ["Faith Kipyegon", 2],
    ]);
    expect(await db.select().from(registrations)).toHaveLength(0);
    expect(await db.select().from(participants)).toHaveLength(0);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it("is written by the Administrator and read by the Organizer and above — never by Tehnic or a volunteer", async () => {
    const race = await createRace();
    // One line first, so every reader below has something to read.
    const [seed] = await db.insert(staffUsers).values({ email: "seed@dev.test", displayName: "Seed", role: "ADMIN" }).returning();
    await addEliteEntry(db, seed, race, { name: "Eliud Kipchoge", bibNumber: "" }, NOW);
    for (const role of STAFF_ROLES) {
      const actor = await staff(role);
      if (canManageRegistrations(role)) {
        await addEliteEntry(db, actor, race, { name: `Elite ${role}`, bibNumber: "" }, NOW);
      } else {
        expect((await failureOf(addEliteEntry(db, actor, race, { name: "Elite", bibNumber: "" }, NOW))).code, role).toBe("FORBIDDEN");
      }
      if (canReadRegistrations(role)) {
        expect((await listEliteEntries(db, actor, race)).length, role).toBeGreaterThan(0);
      } else {
        expect((await failureOf(listEliteEntries(db, actor, race))).code, role).toBe("FORBIDDEN");
      }
    }
    // The two the brief names: the Organizer reads and cannot write; Tehnic does neither.
    const [organizer] = await db.select().from(staffUsers).where(eq(staffUsers.role, "MODERATOR"));
    const [tehnic] = await db.select().from(staffUsers).where(eq(staffUsers.role, "DEV"));
    expect(canReadRegistrations("MODERATOR") && !canManageRegistrations("MODERATOR")).toBe(true);
    expect(canReadRegistrations("DEV") || canManageRegistrations("DEV")).toBe(false);
    const [line] = await db.select().from(eventEliteEntries).limit(1);
    expect((await failureOf(deleteEliteEntry(db, organizer, line.id, NOW))).code).toBe("FORBIDDEN");
    expect((await failureOf(deleteEliteEntry(db, tehnic, line.id, NOW))).code).toBe("FORBIDDEN");
    expect((await failureOf(listEliteEntries(db, tehnic, race))).code).toBe("FORBIDDEN");
    // The Organizer reads the whole list; nothing she pressed changed it.
    expect((await listEliteEntries(db, organizer, race)).map((row) => row.name).sort()).toEqual(["Elite ADMIN", "Elite SUPERADMIN", "Eliud Kipchoge"]);
  });

  it("refuses a missing or too long name and a number that is not a whole one from 1 to 99999, naming the box", async () => {
    const race = await createRace();
    const admin = await staff("ADMIN");
    const fields = async (name: string, bibNumber: string) => (await failureOf(addEliteEntry(db, admin, race, { name, bibNumber }, NOW))).fields;
    expect(await fields("   ", "")).toEqual(["name"]);
    expect(await fields("x".repeat(ELITE_NAME_MAX + 1), "")).toEqual(["name"]);
    for (const number of ["0", "-3", "1.5", "abc", "100000"]) expect(await fields("Ana", number), number).toEqual(["bibNumber"]);
    expect(await fields("", "abc")).toEqual(["name", "bibNumber"]);
    expect(await db.select().from(eventEliteEntries)).toHaveLength(0);
    // The longest name passes, inner spaces collapsed first; a number with spaces round it is read.
    expect(parseEliteEntry({ name: `${"x".repeat(ELITE_NAME_MAX)}`, bibNumber: " 99999 " })).toEqual({ name: "x".repeat(ELITE_NAME_MAX), bibNumber: 99999 });
    expect(parseEliteEntry({ name: "a  \t b", bibNumber: null })).toEqual({ name: "a b", bibNumber: null });
  });

  it("deletes a line, and the trail names the line and never the name or its number", async () => {
    const race = await createRace();
    const admin = await staff("ADMIN");
    const { id } = await addEliteEntry(db, admin, race, { name: "Eliud Kipchoge", bibNumber: "4321" }, NOW);
    expect(await deleteEliteEntry(db, admin, id, later(1))).toEqual({ eventId: race });
    expect(await db.select().from(eventEliteEntries)).toHaveLength(0);
    // A second press finds it gone.
    expect((await failureOf(deleteEliteEntry(db, admin, id, later(2)))).code).toBe("NOT_FOUND");

    const trail = await db.select().from(auditLogs);
    expect(trail.map((row) => [row.action, row.entityType, row.entityId, row.metadataJson])).toEqual([
      ["event_elite.added", "event", race, { entryId: id }],
      ["event_elite.deleted", "event", race, { entryId: id }],
    ]);
    // Without the rows' own ids: they are random hex, and one run in a few hundred draws one that holds «4321» (CI, 2026-11-11).
    const words = JSON.stringify(trail).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>");
    for (const typed of ["Eliud", "Kipchoge", "4321"]) expect(words).not.toContain(typed);
  });

  it("goes with its event, and a line of an event that is not there is refused", async () => {
    const race = await createRace();
    const admin = await staff("ADMIN");
    await addEliteEntry(db, admin, race, { name: "Eliud Kipchoge", bibNumber: "" }, NOW);
    await db.delete(events).where(eq(events.id, race));
    expect(await db.select().from(eventEliteEntries)).toHaveLength(0);
    expect((await failureOf(addEliteEntry(db, admin, race, { name: "Eliud Kipchoge", bibNumber: "" }, NOW))).code).toBe("NOT_FOUND");
  });

  it("is in no count and no other list: places, «Locuri», kits, the registrations' summary and the numbers stay as they were", async () => {
    const race = await createRace();
    const admin = await staff("ADMIN");
    await confirmedRunner(race, "ana@example.org", 1);

    const counts = async () => ({
      occupied: await countOccupied(db, race, NOW),
      kits: await countKits(db, race, NOW),
      summary: await summariseRegistrationsForAdmin(db, { eventId: race }),
      places: await readPlaceOutlook(db, race, NOW),
      bibs: await countBibs(db, race),
      sheet: await listBibs(db, race, {}),
      registrations: (await db.select().from(registrations)).length,
    });
    const before = await counts();
    expect(before.summary.real).toBe(1);

    for (let index = 0; index < 5; index += 1) {
      // Numbers nobody at the race has: the runner wears 1, and a number is one person's (below).
      await addEliteEntry(db, admin, race, { name: `Elită ${index + 1}`, bibNumber: String(index + 101) }, later(index));
    }
    expect(await db.select().from(eventEliteEntries)).toHaveLength(5);
    expect(await counts()).toEqual(before);
  });

  it("never shares a number: refused when somebody at the race has it or it is a desk spare, and skipped by every later draw", async () => {
    const race = await createRace();
    const admin = await staff("ADMIN");
    await confirmedRunner(race, "ana@example.org", 1);
    // The desk's spares, 50 to 54 (§444): printed blank, for a walk-in.
    await db.update(events).set({ walkInBibStart: 50, walkInBibCount: 5 }).where(eq(events.id, race));
    await addEliteEntry(db, admin, race, { name: "Faith Kipyegon", bibNumber: "2" }, NOW);

    // A registration's number, another elite line's and a desk spare: each refused on the number's box, nothing written.
    for (const number of ["1", "2", "52"]) {
      const refusal = await failureOf(addEliteEntry(db, admin, race, { name: "Eliud Kipchoge", bibNumber: number }, later(1)));
      expect([refusal.code, refusal.fields], number).toEqual(["CONFLICT", ["bibNumber"]]);
    }
    // Without a number the same name goes in: only the number is one person's.
    await addEliteEntry(db, admin, race, { name: "Eliud Kipchoge", bibNumber: "" }, later(2));
    expect((await listEliteEntries(db, admin, race)).map((row) => row.bibNumber)).toEqual([2, null]);
    expect((await db.select().from(auditLogs)).map((row) => row.action)).toEqual(["event_elite.added", "event_elite.added"]);

    // The other way round: a confirmed runner with no number yet, then «Alocă numerele» — 2 is the elite runner's, so 3.
    await confirmedRunner(race, "ion@example.org", null);
    expect(await assignBibNumbers(db, { actor: admin, eventId: race, now: later(3) })).toMatchObject({ assigned: 1 });
    const worn = (await db.select({ number: registrations.bibNumber }).from(registrations)).map((row) => row.number);
    expect(worn.sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 3]);
    // The desk's box and its suggestions say the same.
    expect(await bibNumberInUse(db, { eventId: race, number: 2 })).toBe(true);
    expect(await suggestFreeBibNumbers(db, race, 1, 2)).toEqual([4, 5]);

    // Deleted, the line's number is nobody's again.
    const [faith] = await db.select().from(eventEliteEntries).where(eq(eventEliteEntries.bibNumber, 2));
    await deleteEliteEntry(db, admin, faith.id, later(4));
    expect(await bibNumberInUse(db, { eventId: race, number: 2 })).toBe(false);
  });

  it("goes three years after the race, with its registrations; a race still ahead keeps its names, and the events stay", async () => {
    const admin = await staff("ADMIN");
    const old = await createRace(new Date("2026-11-21T08:00:00.000Z"));
    const ahead = await createRace();
    await addEliteEntry(db, admin, old, { name: "Eliud Kipchoge", bibNumber: "7" }, NOW);
    await addEliteEntry(db, admin, ahead, { name: "Faith Kipyegon", bibNumber: "" }, NOW);

    // Two years and a half after the old race: nothing goes yet.
    expect((await pruneExpiredRows(db, new Date("2029-05-21T08:00:00.000Z"))).eliteEntries).toBe(0);
    const swept = await pruneExpiredRows(db, new Date("2029-11-22T08:00:00.000Z"));
    expect(swept.failures).toEqual([]);
    expect(swept.eliteEntries).toBe(1);
    expect((await db.select().from(eventEliteEntries)).map((row) => [row.eventId, row.name])).toEqual([[ahead, "Faith Kipyegon"]]);
    expect(await db.select({ id: events.id }).from(events)).toHaveLength(2);
  });
});
