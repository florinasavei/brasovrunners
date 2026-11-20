import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventVolunteerRoleAssignments, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { bibNumberInUse, pickBibNumber } from "@/modules/registrations/bibs";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { buildVolunteersCsv } from "@/modules/volunteers/csv";
import { volunteerExport, volunteerExportHeader, volunteerSheetWords } from "@/modules/volunteers/export";
import { readRaffleRoster } from "@/modules/volunteers/raffle-list";
import { highestVolunteerNumber, numberWaitingVolunteers } from "@/modules/volunteers/volunteer-numbers";
import { changeVolunteer, exportVolunteers, listVolunteers } from "@/modules/volunteers/volunteers";
import { buildVolunteersWorkbook } from "@/modules/volunteers/workbook";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { readSheet } from "../../helpers/xlsx";

/**
 * §1023, amending §948 — every volunteer's number is V001, V002, … by itself (the owner, 2026-11-20: «vreau sa le dai numar de
 * voluntar V001 V002 la toti voluntarii automat!»). BR-REQ-050-02.
 *
 * What is protected, on real PostgreSQL (PGlite):
 * - every event numbers its volunteers 1, 2, 3, … — written «V001» — the moment the organizers confirm each, in the order they are
 *   confirmed, with nothing to set first; a person confirmed again keeps theirs; nobody draws twice;
 * - a number is never given again: a cancelled volunteer keeps theirs, retired, and a deleted one's stays retired through the
 *   trail (`volunteer.deleted`, `volunteerNumber`);
 * - its own series: a runner's draw reads no V number and a volunteer's draw reads no race number, an elite line or a spare —
 *   V001 and race number 1 are two people; a number of the old series (`bib_number`) stays on its row, untouched, still worn for
 *   the runners' draw, and the row draws its V number like everybody;
 * - the table refuses one V number twice at an event, and nought;
 * - the maintenance job gives a V number to a confirmed volunteer who has none — in the order they were first confirmed, after
 *   the event's highest — audited with a count and never a person, and writes nothing on the next run;
 * - the volunteers' CSV and Excel write «V001» under their «Număr» column.
 */
const NOW = new Date("2026-11-20T09:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let eventId: string;
let roleId: string;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  admin = await staff("ADMIN");
  ({ eventId, roleId } = await race("Crosul"));
});

async function staff(role: "ADMIN" | "MODERATOR"): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

/** A race of 150 places whose runners' numbers start at 1 — and nothing about the volunteers' numbers to set. */
async function race(title: string) {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW, capacity: 150, bibStartNumber: 1, locationName: "Start", acceptsVolunteers: true })
    .returning({ id: events.id });
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `cros-${serial}`, title },
    { eventId: event.id, locale: "en", slug: `cross-${serial}`, title: `${title} (en)` },
  ]);
  const [role] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Punct de apă", nameEn: "Water point", needed: 5, position: 0 }).returning({ id: eventVolunteerRoles.id });
  return { eventId: event.id, roleId: role.id };
}

/** A volunteer as the card writes one, in the state given, added at `minute`; `more` sets other columns (an old-series number, a V number). */
async function volunteer(name: string, volunteerState: "REGISTERED" | "CONFIRMED" | "CANCELLED", minute: number, more: Partial<typeof eventVolunteers.$inferInsert> = {}, where = { eventId, roleId }): Promise<string> {
  serial += 1;
  const email = `volunteer-${serial}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId: where.eventId, name, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", state: volunteerState, source: "STAFF", roleId: where.roleId, createdAt: at(minute), updatedAt: at(minute), ...more })
    .returning({ id: eventVolunteers.id });
  await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: row.id, roleId: where.roleId, createdAt: at(minute) });
  return row.id;
}

/** A runner of the race wearing `bibNumber`. */
async function runner(name: string, bibNumber: number | null): Promise<string> {
  serial += 1;
  const email = `runner-${serial}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning({ id: participants.id });
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: name,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      confirmedAt: NOW,
      bibNumber,
    })
    .returning({ id: registrations.id });
  return row.id;
}

const numberOf = async (id: string) => (await db.select({ number: eventVolunteers.volunteerNumber }).from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0]?.number ?? null;
const oldNumberOf = async (id: string) => (await db.select({ number: eventVolunteers.bibNumber }).from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0]?.number ?? null;
const trailOf = (action: string, of = eventId) => db.select().from(auditLogs).where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, of))).orderBy(asc(auditLogs.createdAt));
const confirm = (id: string, minute = 60, of = eventId) => changeVolunteer(db, admin, { kind: "setState", eventId: of, id, state: "CONFIRMED" }, at(minute), { sendEmail: false });
const setState = (id: string, next: "REGISTERED" | "CANCELLED", minute = 70) => changeVolunteer(db, admin, { kind: "setState", eventId, id, state: next }, at(minute), { sendEmail: false });
/** A confirmation as the trail of the release before wrote it: what the migration and the job read the order from. */
const confirmedInTrail = (id: string, minute: number) =>
  db.insert(auditLogs).values({ actorStaffUserId: admin.id, action: "volunteer.state_changed", entityType: "event", entityId: eventId, metadataJson: { volunteerId: id, from: "REGISTERED", to: "CONFIRMED" }, createdAt: at(minute) });

describe("§1023 BR-REQ-050-02 a volunteer's V number: drawn by itself at the confirmation, in order, once", () => {
  it("gives every event's volunteers 1, 2, 3 … in the order the organizers confirm them — with nothing to set — and says it in the trail", async () => {
    const ana = await volunteer("Ana Pop", "REGISTERED", 1);
    const dan = await volunteer("Dan Ene", "REGISTERED", 2);
    const eva = await volunteer("Eva Radu", "REGISTERED", 3);
    expect([await numberOf(ana), await numberOf(dan), await numberOf(eva)]).toEqual([null, null, null]);
    // Confirmed in another order than they were added: the number follows the confirmation, as a runner's does (§173).
    await confirm(dan, 60);
    await confirm(eva, 61);
    await confirm(ana, 62);
    expect([await numberOf(dan), await numberOf(eva), await numberOf(ana)]).toEqual([1, 2, 3]);
    const states = await trailOf("volunteer.state_changed");
    expect(states.map((row) => (row.metadataJson as { volunteerNumber?: number }).volunteerNumber)).toEqual([1, 2, 3]);
    // The trail names the number, never the old series' column, and never the person.
    expect(states.every((row) => !("bibNumber" in (row.metadataJson as object)))).toBe(true);
    expect(JSON.stringify(states)).not.toContain("Ana");
    expect((await listVolunteers(db, eventId)).map((person) => [person.name, person.volunteerNumber])).toEqual([
      ["Ana Pop", 3],
      ["Dan Ene", 1],
      ["Eva Radu", 2],
    ]);
  });

  it("numbers every event's volunteers from 1, a series of its own per event", async () => {
    const other = await race("Alt cros");
    const ana = await volunteer("Ana Pop", "REGISTERED", 1);
    const ion = await volunteer("Ion Lupu", "REGISTERED", 2, {}, other);
    await confirm(ana);
    await confirm(ion, 61, other.eventId);
    expect([await numberOf(ana), await numberOf(ion)]).toEqual([1, 1]);
  });

  it("keeps the number through a cancellation and a reopening, never draws a second one, and gives nobody a cancelled person's", async () => {
    const ana = await volunteer("Ana Pop", "REGISTERED", 1);
    await confirm(ana);
    expect(await numberOf(ana)).toBe(1);
    await setState(ana, "CANCELLED");
    expect(await numberOf(ana)).toBe(1);
    // Somebody confirmed meanwhile never gets the cancelled person's number: the highest the event gave is the cancelled row's.
    const dan = await volunteer("Dan Ene", "REGISTERED", 2);
    await confirm(dan, 80);
    expect(await numberOf(dan)).toBe(2);
    await confirm(ana, 90);
    expect(await numberOf(ana)).toBe(1);
    await setState(ana, "REGISTERED", 100);
    await confirm(ana, 110);
    expect(await numberOf(ana)).toBe(1);
    // The reopenings drew nothing: one number each in the trail.
    expect((await trailOf("volunteer.state_changed")).flatMap((row) => (row.metadataJson as { volunteerNumber?: number }).volunteerNumber ?? [])).toEqual([1, 2]);
  });

  it("a cancelled volunteer holding the highest number keeps it retired: the next confirmation draws above it", async () => {
    const ana = await volunteer("Ana Pop", "REGISTERED", 1);
    const dan = await volunteer("Dan Ene", "REGISTERED", 2);
    await confirm(ana, 60);
    await confirm(dan, 61);
    await setState(dan, "CANCELLED", 62);
    const eva = await volunteer("Eva Radu", "REGISTERED", 3);
    await confirm(eva, 63);
    expect(await numberOf(eva)).toBe(3);
  });

  it("a deleted volunteer's number is never given again: the trail keeps it retired — and a person deleted before they had one leaves none", async () => {
    const ana = await volunteer("Ana Pop", "REGISTERED", 1);
    const dan = await volunteer("Dan Ene", "REGISTERED", 2);
    await confirm(ana, 60);
    await confirm(dan, 61);
    await changeVolunteer(db, admin, { kind: "delete", eventId, id: dan }, at(70));
    const [deleted] = await trailOf("volunteer.deleted");
    expect(deleted.metadataJson).toMatchObject({ volunteerNumber: 2 });
    expect(deleted.metadataJson).not.toHaveProperty("bibNumber");
    expect(await highestVolunteerNumber(db, eventId)).toBe(2);
    const eva = await volunteer("Eva Radu", "REGISTERED", 3);
    await confirm(eva, 80);
    expect(await numberOf(eva)).toBe(3);
    const ion = await volunteer("Ion Lupu", "REGISTERED", 4);
    await changeVolunteer(db, admin, { kind: "delete", eventId, id: ion }, at(90));
    expect((await trailOf("volunteer.deleted")).at(-1)?.metadataJson).not.toHaveProperty("volunteerNumber");
    // A trail row of another event's deletion is not this event's: its numbers are its own.
    const other = await race("Alt cros");
    await db.insert(auditLogs).values({ actorStaffUserId: admin.id, action: "volunteer.deleted", entityType: "event", entityId: other.eventId, metadataJson: { volunteerId: "x", volunteerNumber: 40 }, createdAt: NOW });
    expect(await highestVolunteerNumber(db, eventId)).toBe(3);
  });

  it("a row that holds a number of the old series keeps it untouched, and draws its V number at the confirmation like everybody", async () => {
    const ana = await volunteer("Ana Pop", "REGISTERED", 1, { bibNumber: 500 });
    await confirm(ana);
    expect([await numberOf(ana), await oldNumberOf(ana)]).toEqual([1, 500]);
    // Deleted, both are kept in its trail row: the old one for the runners' draw, the V one for the volunteers'.
    await changeVolunteer(db, admin, { kind: "delete", eventId, id: ana }, at(70));
    expect((await trailOf("volunteer.deleted"))[0].metadataJson).toMatchObject({ volunteerNumber: 1, bibNumber: 500 });
  });

  it("a person who already holds a V number keeps it at the confirmation", async () => {
    const ana = await volunteer("Ana Pop", "REGISTERED", 1, { volunteerNumber: 7 });
    await confirm(ana);
    expect(await numberOf(ana)).toBe(7);
    const dan = await volunteer("Dan Ene", "REGISTERED", 2);
    await confirm(dan, 61);
    expect(await numberOf(dan)).toBe(8);
  });

  it("the table itself refuses one V number on two volunteers of an event, and nought — and takes the same number at another event", async () => {
    await volunteer("Ana Pop", "CONFIRMED", 1, { volunteerNumber: 1 });
    await expect(volunteer("Dan Ene", "CONFIRMED", 2, { volunteerNumber: 1 })).rejects.toThrow();
    await expect(volunteer("Eva Radu", "CONFIRMED", 3, { volunteerNumber: 0 })).rejects.toThrow();
    const other = await race("Alt cros");
    await volunteer("Ion Lupu", "CONFIRMED", 4, { volunteerNumber: 1 }, other);
  });
});

describe("§1023 BR-REQ-050-02 a series of their own: the runners' and the volunteers' numbers never meet", () => {
  it("a volunteer's draw reads no race number, no elite line and no desk spare: V001 beside race number 1", async () => {
    await runner("Ion Ionescu", 1);
    await runner("Mara Dima", 2);
    await db.insert(eventEliteEntries).values({ eventId, name: "Eliud K.", bibNumber: 3 });
    await db.update(events).set({ walkInBibStart: 4, walkInBibCount: 3 }).where(eq(events.id, eventId));
    const ana = await volunteer("Ana Pop", "REGISTERED", 1);
    await confirm(ana);
    expect(await numberOf(ana)).toBe(1);
  });

  it("a runner's draw reads no V number: the race's first free number is still its first", async () => {
    for (const [index, name] of ["Ana Pop", "Dan Ene", "Eva Radu"].entries()) await confirm(await volunteer(name, "REGISTERED", index), 60 + index);
    expect(await pickBibNumber(db, eventId)).toBe(1);
    expect(await bibNumberInUse(db, { eventId, number: 1 })).toBe(false);
  });

  it("a number of the old series still counts as worn for the runners' draw — harmless, and nothing draws into it any more", async () => {
    await volunteer("Ana Pop", "CONFIRMED", 1, { bibNumber: 1 });
    await volunteer("Dan Ene", "CANCELLED", 2, { bibNumber: 2 });
    expect(await pickBibNumber(db, eventId)).toBe(3);
    expect(await bibNumberInUse(db, { eventId, number: 1 })).toBe(true);
    // A confirmation writes the V number and leaves the old column alone.
    const eva = await volunteer("Eva Radu", "REGISTERED", 3);
    await confirm(eva);
    expect([await numberOf(eva), await oldNumberOf(eva)]).toEqual([1, null]);
  });
});

describe("§1023 BR-REQ-050-02 the confirmed volunteers who have none are numbered by themselves", () => {
  it("the maintenance job numbers them after the event's highest, in the order they were first confirmed, then added — audited with a count, never a person", async () => {
    // V001 held, V002 deleted (in the trail): the next is 3.
    await volunteer("Held One", "CONFIRMED", 1, { volunteerNumber: 1 });
    await db.insert(auditLogs).values({ actorStaffUserId: admin.id, action: "volunteer.deleted", entityType: "event", entityId: eventId, metadataJson: { volunteerId: "gone", volunteerNumber: 2 }, createdAt: NOW });
    // Confirmed by the code serving during the migration, which wrote no V number: first confirmed in the order Dan, Ana; Eva has
    // no trail row (written straight into the table), so she comes after both; Zoe was confirmed twice — her first one counts.
    const ana = await volunteer("Ana Pop", "CONFIRMED", 1);
    const dan = await volunteer("Dan Ene", "CONFIRMED", 2);
    const eva = await volunteer("Eva Radu", "CONFIRMED", 0);
    const zoe = await volunteer("Zoe Lupu", "CONFIRMED", 3);
    await confirmedInTrail(ana, 20);
    await confirmedInTrail(dan, 10);
    await confirmedInTrail(zoe, 15);
    await confirmedInTrail(zoe, 30);
    // Waiting or cancelled: never numbered by the job.
    const waiting = await volunteer("Vlad Waiting", "REGISTERED", 4);
    const cancelled = await volunteer("Cora Cancelled", "CANCELLED", 5);

    expect(await numberWaitingVolunteers(db, at(100))).toEqual({ events: 1, given: 4 });
    expect([await numberOf(dan), await numberOf(zoe), await numberOf(ana), await numberOf(eva)]).toEqual([3, 4, 5, 6]);
    expect([await numberOf(waiting), await numberOf(cancelled)]).toEqual([null, null]);
    const [row, ...more] = await trailOf("event.volunteer_numbers_given");
    expect(more).toEqual([]);
    expect(row).toMatchObject({ actorStaffUserId: null, entityType: "event", entityId: eventId, createdAt: at(100) });
    expect(row.metadataJson).toEqual({ given: 4, from: 3, to: 6 });
    expect(JSON.stringify(row)).not.toMatch(/Ana|Dan|Eva|Zoe|example\.test/);

    // Idempotent: nobody left, nothing written.
    expect(await numberWaitingVolunteers(db, at(101))).toEqual({ events: 0, given: 0 });
    expect(await trailOf("event.volunteer_numbers_given")).toHaveLength(1);
  });

  it("leaves no confirmed volunteer out of the raffle for want of a number: once numbered, the raffle counts every one of them", async () => {
    await db.update(events).set({ hasRaffle: true }).where(eq(events.id, eventId));
    await volunteer("Ana Pop", "CONFIRMED", 1);
    await volunteer("Dan Ene", "CONFIRMED", 2);
    await volunteer("Vlad Waiting", "REGISTERED", 3);
    const organizer = await staff("MODERATOR");
    // Before: confirmed with no number — «fără număr», out of the draw.
    expect((await readRaffleRoster(db, organizer, eventId, at(100)))?.counts.in.VOLUNTEER).toBe(0);
    await numberWaitingVolunteers(db, at(100));
    const roster = await readRaffleRoster(db, organizer, eventId, at(101));
    expect(roster?.counts.in.VOLUNTEER).toBe(2);
    expect(roster?.rows.filter((row) => row.kind === "VOLUNTEER").map((row) => [row.label, row.reason])).toEqual([
      ["V001", "in"],
      ["V002", "in"],
      [null, "notConfirmed"],
    ]);
  });

  it("is a step of the maintenance run, which says how many it gave — none on the next run", async () => {
    await volunteer("Ana Pop", "CONFIRMED", 1);
    const run = await runRegistrationMaintenance(db, at(100));
    expect(run.volunteerNumbersGiven).toBe(1);
    expect((await listVolunteers(db, eventId)).map((person) => person.volunteerNumber)).toEqual([1]);
    expect((await runRegistrationMaintenance(db, at(120))).volunteerNumbersGiven).toBe(0);
  });
});

describe("§1023 the V number in the volunteers' files", () => {
  const words = (catalogue: typeof ro) => (key: string) => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], catalogue.Admin) as string;

  it("is the CSV's last column, «V001», under its heading «Număr» unchanged — empty for a person without one — in both languages", async () => {
    const ana = await volunteer("Ana Pop", "REGISTERED", 1);
    await volunteer("Dan Ene", "REGISTERED", 2);
    await confirm(ana);
    const data = await exportVolunteers(db, admin, eventId, at(120));
    const csv = buildVolunteersCsv(volunteerExportHeader(words(ro)), volunteerExport(data, "ro", words(ro), new Map()).rows);
    const lines = csv.split("\r\n");
    expect(lines[0].endsWith(",Număr")).toBe(true);
    expect(lines.find((line) => line.includes("Ana Pop"))?.endsWith(",V001")).toBe(true);
    expect(lines.find((line) => line.includes("Dan Ene"))?.endsWith(",")).toBe(true);
    expect(volunteerExportHeader(words(en as unknown as typeof ro)).bibNumber).toBe("Number");
  });

  it("is a text cell «V001» in the Excel file, under the same heading", async () => {
    const ana = await volunteer("Ana Pop", "REGISTERED", 1);
    await confirm(ana);
    const data = await exportVolunteers(db, admin, eventId, at(120));
    const exported = volunteerExport(data, "ro", words(ro), new Map());
    const buffer = await buildVolunteersWorkbook(volunteerExportHeader(words(ro)), [{ label: "Crosul", rows: exported.rows, roles: exported.roles }], volunteerSheetWords(words(ro)));
    const { rows } = readSheet(buffer);
    const column = rows[0].indexOf("Număr");
    expect(column).toBeGreaterThan(-1);
    expect(rows[1][column]).toBe("V001");
  });
});
