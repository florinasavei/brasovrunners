import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventResults } from "@/db/schema/event-results";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { importResultsCsv, ResultRowError, deleteEventResult, exportEventResults, readEventResults, readPublicEventResults, saveEventResults, setResultsPublished } from "@/modules/results/results";
import type { PostedResultRow } from "@/modules/results/rows";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { A_YEAR_AFTER, AFTER_THE_RACE, approvePrivacyNotice, createRace, person, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §NNN — a race's results, through the service on real PostgreSQL (BR-REQ-050-02, BR-REQ-039-01, BR-REQ-053-01, BR-REQ-060-01): the table
 * of migration 0166 and its constraints, the one save (created, changed, unchanged, deleted, refused on the first bad row, refused on a stale
 * form), the rankings it stores, the audit rows that never name a runner, the roles asserted by the service, the publish gate on the notice, the
 * import matched by bib, the delete, the export, and what the public read shows — a name only for a registered runner who ticked.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
// What the service tells the public cache: one call after a write, never from inside the transaction, none for a save that changed nothing.
const revalidate = vi.hoisted(() => vi.fn());
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()), revalidatePublicContent: revalidate }));

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
const NOW = AFTER_THE_RACE;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  for (const [role, name] of [["ADMIN", "Ana Admin"], ["MODERATOR", "Oana Organizator"], ["DEV", "Tudor Tehnic"], ["CONTRIBUTOR", "Vlad Voluntar"], ["COPYWRITER", "Radu Redactor"], ["MEMBER", "Membru Club"]] as const) {
    staff[role] = await person(db, role, name);
  }
  raceId = (await createRace(db)).id;
});

/** A registered runner's line as the form posts it. */
const line = (bib: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `r[${bib}]`, bib: String(bib), name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });
/** A typed runner's line. */
const typed = (index: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `n[${index}]`, bib: "", name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });

/** Each call a second later than the last: the trail is ordered by its moment, so a test reads the rows one call added in the order they were written. */
let ticks = 0;
const clock = () => new Date(NOW.getTime() + ++ticks * 1000);
const save = (rows: PostedResultRow[], fingerprint?: string | null, actor: StaffUser = staff.ADMIN!) => saveEventResults(db, actor, { eventId: raceId, rows, fingerprint }, clock());
const stored = () => db.select().from(eventResults).where(eq(eventResults.eventId, raceId)).orderBy(eventResults.bibNumber);
const byBib = async (bib: number) => (await stored()).find((row) => row.bibNumber === bib);
const trail = () => db.select().from(auditLogs).where(eq(auditLogs.entityId, raceId)).orderBy(auditLogs.createdAt, auditLogs.id);
const trailActions = async () => (await trail()).map((row) => row.action);
const resultsTrail = async () => (await trail()).filter((row) => row.action.startsWith("event_result."));

/** Four runners: two women (30 and 41), two men (30 and no birth date). */
async function field() {
  const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01", checkedInAt: NOW });
  const bia = await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, sex: "FEMALE", birthDate: "1985-03-10", checkedInAt: NOW });
  const dan = await registerRunner(db, raceId, { name: "Dan Ionescu", bibNumber: 103, sex: "MALE", birthDate: "1996-11-21", ticked: false });
  const eli = await registerRunner(db, raceId, { name: "Eli Vasile", bibNumber: 104, sex: "MALE", birthDate: null });
  return { ana, bia, dan, eli };
}

describe("§NNN the table (migration 0166)", () => {
  it("holds a result per race number and per registration, cascades from the event and leaves the row nameless when the registration goes", async () => {
    const { ana } = await field();
    await save([line(101, { time: "45:12" })]);
    const [row] = await stored();
    expect(row).toMatchObject({ bibNumber: 101, registrationId: ana.id, status: "FINISHED", gunTimeMs: 45 * 60_000 + 12_000, displayName: null });

    // One row per race number, and one per registration.
    await expect(db.insert(eventResults).values({ eventId: raceId, bibNumber: 101, status: "DNS", displayName: "Ion" })).rejects.toThrow();
    await expect(db.insert(eventResults).values({ eventId: raceId, bibNumber: 900, registrationId: ana.id, status: "DNS" })).rejects.toThrow();

    // The registration erased: the result stays, nameless (`ON DELETE SET NULL`), and nothing of the person with it.
    await db.delete(registrations).where(eq(registrations.id, ana.id));
    const [left] = await stored();
    expect(left).toMatchObject({ bibNumber: 101, registrationId: null, displayName: null, sex: null, birthDate: null, gunTimeMs: 45 * 60_000 + 12_000 });

    // The event goes with its registrations (the erase screen's order), and its results with it (`ON DELETE CASCADE`).
    await db.delete(registrations).where(eq(registrations.eventId, raceId));
    await db.delete(events).where(eq(events.id, raceId));
    expect(await db.select().from(eventResults)).toEqual([]);
  });

  it("refuses at the database a finisher with no time, a time with no finish, positions on a runner who did not finish, a bad number and an over-long note", async () => {
    const insert = (values: Partial<typeof eventResults.$inferInsert>) => db.insert(eventResults).values({ eventId: raceId, bibNumber: 1, status: "DNS", ...values });
    await expect(insert({ status: "FINISHED" })).rejects.toThrow();
    await expect(insert({ status: "DNF", gunTimeMs: 1000 })).rejects.toThrow();
    await expect(insert({ status: "DNS", positionOverall: 1 })).rejects.toThrow();
    await expect(insert({ bibNumber: 0 })).rejects.toThrow();
    await expect(insert({ status: "FINISHED", gunTimeMs: 0 })).rejects.toThrow();
    await expect(insert({ status: "DNS", chipTimeMs: 1000 })).rejects.toThrow();
    await expect(insert({ note: "x".repeat(201) })).rejects.toThrow();
    await expect(insert({ displayName: "   " })).rejects.toThrow();
    await insert({ status: "FINISHED", gunTimeMs: 1000, note: "x".repeat(200), displayName: "Ion" });
  });

  it("gives an event no published results by default", async () => {
    const [event] = await db.select({ published: events.resultsPublished, at: events.resultsPublishedAt }).from(events).where(eq(events.id, raceId));
    expect(event).toEqual({ published: false, at: null });
  });
});

describe("§NNN the save: created, ranked, audited", () => {
  it("writes a result for every line with a value, by race number, linked to the registration, and ranks overall, by sex and by category", async () => {
    const { ana, bia, dan } = await field();
    const outcome = await save([line(101, { time: "50:00" }), line(102, { time: "45:00" }), line(103, { time: "40:00" }), line(104, { status: "DNF" })]);
    expect(outcome).toMatchObject({ changed: true, created: 4, updated: 0, deleted: 0, ranked: 3 });
    const rows = await stored();
    expect(rows.map((row) => [row.bibNumber, row.status, row.positionOverall, row.positionSex, row.positionCategory, row.categoryKey])).toEqual([
      [101, "FINISHED", 3, 2, 1, "FEMALE:from30"],
      [102, "FINISHED", 2, 1, 1, "FEMALE:from40"],
      [103, "FINISHED", 1, 1, 1, "MALE:from30"],
      [104, "DNF", null, null, null, null],
    ]);
    expect(rows.map((row) => row.registrationId)).toEqual([ana.id, bia.id, dan.id, expect.any(String)]);
    // A registered runner's name, sex and birth date are the registration's: nothing of them is copied.
    for (const row of rows) expect(row).toMatchObject({ displayName: null, sex: null, birthDate: null, updatedByStaffUserId: staff.ADMIN!.id });
  });

  it("counts the age on the race's own day: the birthday that is the race's day makes the runner that age, the day after does not", async () => {
    // The race is on 21 November 2026: born that day in 1996 she turns thirty that morning, born the next day she is still twenty-nine.
    await registerRunner(db, raceId, { name: "Fata Treizeci", bibNumber: 201, sex: "FEMALE", birthDate: "1996-11-21" });
    await registerRunner(db, raceId, { name: "Fata Douazeci", bibNumber: 202, sex: "FEMALE", birthDate: "1996-11-22" });
    await registerRunner(db, raceId, { name: "Fata Veche", bibNumber: 203, sex: "FEMALE", birthDate: "1996-11-20" });
    await save([line(201, { time: "50:00" }), line(202, { time: "51:00" }), line(203, { time: "52:00" })]);
    expect((await byBib(201))?.categoryKey).toBe("FEMALE:from30");
    expect((await byBib(202))?.categoryKey).toBe("FEMALE:from18");
    expect((await byBib(203))?.categoryKey).toBe("FEMALE:from30");
    // The two thirty-year-olds are ranked together in their category, the twenty-nine-year-old alone in hers.
    expect((await stored()).map((row) => row.positionCategory)).toEqual([1, 1, 2]);
  });

  it("shares a position between equal times and skips the next", async () => {
    await field();
    await save([line(101, { time: "45:00" }), line(102, { time: "45:00" }), line(103, { time: "50:00" })]);
    expect((await stored()).map((row) => row.positionOverall)).toEqual([1, 1, 3]);
  });

  it("takes a time with its status, the chip time and the note, and parses every shape into milliseconds", async () => {
    await field();
    await save([line(101, { time: "1:23:45", chip: "1:23:40.5", note: "  a venit cu bastoane  " }), line(102, { time: "45:12.3" }), line(103, { time: "9:05,25" })]);
    expect(await byBib(101)).toMatchObject({ gunTimeMs: 5_025_000, chipTimeMs: 5_020_500, note: "a venit cu bastoane" });
    expect((await byBib(102))?.gunTimeMs).toBe(2_712_300);
    expect((await byBib(103))?.gunTimeMs).toBe(545_250);
  });

  it("audits one row per result created, naming the number, the state and the times — never a runner's name", async () => {
    await field();
    await save([line(101, { time: "50:00", note: "Ana Popescu a căzut" }), line(104, { status: "DNS" })]);
    const rows = await resultsTrail();
    expect(rows.map((row) => row.action)).toEqual(["event_result.created", "event_result.created"]);
    expect(rows[0]).toMatchObject({ entityType: "event", entityId: raceId, actorStaffUserId: staff.ADMIN!.id });
    // One call's rows share a moment, so each is found by its number rather than by its place.
    expect(rows.find((row) => (row.metadataJson as { bibNumber: number }).bibNumber === 101)?.metadataJson).toEqual({ bibNumber: 101, status: "FINISHED", gunTimeMs: 3_000_000, chipTimeMs: null });
    expect(rows.find((row) => (row.metadataJson as { bibNumber: number }).bibNumber === 104)?.metadataJson).toEqual({ bibNumber: 104, status: "DNS", gunTimeMs: null, chipTimeMs: null });
    const everything = JSON.stringify(await trail());
    for (const word of ["Ana", "Popescu", "căzut", "Eli"]) expect(everything, word).not.toContain(word);
  });

  it("tells the public cache once after a save that changed something, and not after one that changed nothing", async () => {
    revalidate.mockClear();
    await field();
    await save([line(101, { time: "50:00" }), line(102, { time: "45:00" })]);
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledWith("events", "places");
    await save([line(101, { time: "50:00" }), line(102, { time: "45:00" })]);
    expect(revalidate).toHaveBeenCalledTimes(1);
  });
});

describe("§NNN the save: changed, unchanged, deleted", () => {
  it("writes only the rows that changed, audits each with the names of the boxes, and re-ranks the others silently", async () => {
    await field();
    await save([line(101, { time: "50:00" }), line(102, { time: "45:00" }), line(103, { time: "40:00" })]);
    const before = await trail();
    // Ana gets faster: only her row changed; Bia's and Dan's positions follow, with no audit row of their own.
    const outcome = await save([line(101, { time: "44:00" }), line(102, { time: "45:00" }), line(103, { time: "40:00" })]);
    expect(outcome).toMatchObject({ changed: true, created: 0, updated: 1, deleted: 0, rewritten: 1 });
    const added = (await trail()).slice(before.length);
    expect(added.map((row) => row.action)).toEqual(["event_result.updated"]);
    expect(added[0].metadataJson).toEqual({ bibNumber: 101, status: "FINISHED", gunTimeMs: 2_640_000, chipTimeMs: null, changed: ["time"] });
    expect((await stored()).map((row) => row.positionOverall)).toEqual([2, 3, 1]);
  });

  it("writes and records nothing for a save that changes nothing", async () => {
    await field();
    const rows = [line(101, { time: "50:00" }), line(102, { time: "45:00" })];
    await save(rows);
    const before = await stored();
    const trailBefore = await trail();
    const outcome = await save(rows);
    expect(outcome).toMatchObject({ changed: false, created: 0, updated: 0, deleted: 0, rewritten: 0 });
    expect(await stored()).toEqual(before);
    expect(await trail()).toHaveLength(trailBefore.length);
  });

  it("treats a blank line as no result: a line the club never touched is not stored", async () => {
    await field();
    await save([line(101, { time: "50:00" }), line(102), line(103), line(104)]);
    expect((await stored()).map((row) => row.bibNumber)).toEqual([101]);
  });

  it("deletes a result the club left out of the list (or emptied), audited with its number and state", async () => {
    await field();
    await save([line(101, { time: "50:00" }), line(102, { time: "45:00" }), line(103, { status: "DNS" })]);
    const outcome = await save([line(101, { time: "50:00" }), line(102, { time: "" })]);
    expect(outcome).toMatchObject({ changed: true, created: 0, updated: 0, deleted: 2 });
    expect((await stored()).map((row) => row.bibNumber)).toEqual([101]);
    const deleted = (await resultsTrail()).filter((row) => row.action === "event_result.deleted");
    expect(deleted.map((row) => row.metadataJson)).toEqual(expect.arrayContaining([{ bibNumber: 102, status: "FINISHED" }, { bibNumber: 103, status: "DNS" }]));
    // The one left is the only finisher now.
    expect((await byBib(101))?.positionOverall).toBe(1);
  });

  it("rewrites the positions silently when a registration's answer was corrected, and records nothing", async () => {
    const { eli } = await field();
    await save([line(101, { time: "50:00" }), line(104, { time: "55:00" })]);
    expect(await byBib(104)).toMatchObject({ positionSex: 1, positionCategory: null, categoryKey: null });
    const trailBefore = await trail();
    await db.update(registrations).set({ birthDate: "1990-01-01" }).where(eq(registrations.id, eli.id));
    const outcome = await save([line(101, { time: "50:00" }), line(104, { time: "55:00" })]);
    expect(outcome).toMatchObject({ changed: false, rewritten: 1 });
    expect(await byBib(104)).toMatchObject({ categoryKey: "MALE:from30", positionCategory: 1 });
    expect(await trail()).toHaveLength(trailBefore.length);
  });
});

describe("§NNN the save: a runner the club types by hand", () => {
  it("keeps a name, a sex and a birth date for a number no registration holds, and ranks it by them", async () => {
    await field();
    await save([line(101, { time: "50:00" }), typed(0, { bib: "900", name: "  Ion Vasile  ", sex: "male", birthDate: "05.03.1985", time: "49:00" })]);
    expect(await byBib(900)).toMatchObject({ registrationId: null, displayName: "Ion Vasile", sex: "MALE", birthDate: "1985-03-05", categoryKey: "MALE:from40", positionOverall: 1, positionSex: 1, positionCategory: 1 });
    expect((await byBib(101))?.positionOverall).toBe(2);
  });

  it("refuses a typed number with no name, naming the box", async () => {
    await expect(save([typed(0, { bib: "900", time: "49:00" })])).rejects.toMatchObject({ code: "RESULT_ROW_INVALID", problem: "nameMissing", fields: ["n[0].name"], bibNumber: 900 });
    expect(await stored()).toEqual([]);
  });

  it("reads a typed row whose number a registration holds as that registration's, and ignores the name typed", async () => {
    const { ana } = await field();
    await save([typed(0, { bib: "101", name: "Altcineva", sex: "male", birthDate: "01.01.2000", time: "49:00" })]);
    expect(await byBib(101)).toMatchObject({ registrationId: ana.id, displayName: null, sex: null, birthDate: null, categoryKey: "FEMALE:from30" });
  });

  it("lets a nameless row stay nameless — the one an erased registration left — and refuses it as a new typed row", async () => {
    const { ana } = await field();
    await save([line(101, { time: "50:00" })]);
    await db.delete(registrations).where(eq(registrations.id, ana.id));
    // The page draws it as a typed row with an empty name; saving it as it is keeps it, with no name.
    await save([typed(0, { bib: "101", time: "50:00" })]);
    expect(await byBib(101)).toMatchObject({ registrationId: null, displayName: null, gunTimeMs: 3_000_000 });
    // Another number, never stored, is a new typed row and needs its name.
    await expect(save([typed(0, { bib: "101", time: "50:00" }), typed(1, { bib: "777", time: "51:00" })])).rejects.toMatchObject({ problem: "nameMissing", fields: ["n[1].name"] });
  });
});

describe("§NNN the save: the first bad row refuses everything, naming it", () => {
  it("writes nothing when the second of three rows is bad, whatever the first and the third said", async () => {
    await field();
    const error = await save([line(101, { time: "50:00" }), line(102, { time: "soon" }), line(103, { time: "40:00" })]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ResultRowError);
    expect(error).toMatchObject({ code: "RESULT_ROW_INVALID", problem: "time", fields: ["r[102].time"], bibNumber: 102, runnerName: "Bia Marin" });
    expect(await stored()).toEqual([]);
    expect(await resultsTrail()).toEqual([]);
  });

  it("names each problem and its box", async () => {
    await field();
    const cases: Array<[PostedResultRow[], string, string[]]> = [
      [[line(101, { status: "ALTCEVA", time: "50:00" })], "status", ["r[101].status"]],
      [[line(101, { status: "FINISHED" })], "timeMissing", ["r[101].time"]],
      [[line(101, { status: "DNF", time: "50:00" })], "timeWithStatus", ["r[101].time"]],
      [[line(101, { time: "50:00", chip: "x" })], "chip", ["r[101].chip"]],
      [[line(101, { time: "50:00", note: "x".repeat(201) })], "note", ["r[101].note"]],
      [[line(101, { time: "50:00" }), typed(0, { bib: "101", time: "51:00" })], "bibDuplicate", ["n[0].bib"]],
      [[typed(0, { bib: "abc", name: "Ion", time: "50:00" })], "bib", ["n[0].bib"]],
      [[typed(0, { bib: "900", name: "Ion", sex: "x", time: "50:00" })], "sex", ["n[0].sex"]],
      [[typed(0, { bib: "900", name: "Ion", birthDate: "31.02.1990", time: "50:00" })], "birthDate", ["n[0].birthDate"]],
      [[typed(0, { bib: "900", name: "x".repeat(121), time: "50:00" })], "nameLong", ["n[0].name"]],
    ];
    for (const [rows, problem, fields] of cases) {
      await expect(save(rows), problem).rejects.toMatchObject({ code: "RESULT_ROW_INVALID", problem, fields });
    }
    expect(await stored()).toEqual([]);
  });

  it("refuses a form drawn before another session saved, with CONFLICT, and writes nothing", async () => {
    await field();
    const first = await readEventResults(db, staff.ADMIN!, raceId);
    await save([line(101, { time: "50:00" })], first.fingerprint);
    // The form still holds the fingerprint of the empty list: it would delete the row the other session wrote.
    await expect(save([line(102, { time: "45:00" })], first.fingerprint)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await stored()).map((row) => row.bibNumber)).toEqual([101]);
    // A form drawn after it goes through.
    const second = await readEventResults(db, staff.ADMIN!, raceId);
    await save([line(101, { time: "50:00" }), line(102, { time: "45:00" })], second.fingerprint);
    expect((await stored()).map((row) => row.bibNumber)).toEqual([101, 102]);
  });

  it("refuses a malformed event id as an unknown one, not a database error", async () => {
    await expect(saveEventResults(db, staff.ADMIN!, { eventId: "x", rows: [] }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(readEventResults(db, staff.ADMIN!, "x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("§NNN the roles are asserted by the service (BR-REQ-060-01)", () => {
  it("lets the Organizer and the Administrators enter, read, import, export and delete; refuses everyone else", async () => {
    await field();
    for (const role of ["ADMIN", "MODERATOR"] as const) {
      await save([line(101, { time: "50:00" })], undefined, staff[role]);
      await readEventResults(db, staff[role]!, raceId);
      await importResultsCsv(db, staff[role]!, raceId, "101,50:00");
      await exportEventResults(db, staff[role]!, raceId, NOW);
    }
    for (const role of ["DEV", "CONTRIBUTOR", "COPYWRITER", "MEMBER"] as const) {
      const actor = staff[role]!;
      await expect(save([line(101, { time: "40:00" })], undefined, actor), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(readEventResults(db, actor, raceId), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(importResultsCsv(db, actor, raceId, "101,50:00"), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(exportEventResults(db, actor, raceId, NOW), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(deleteEventResult(db, actor, { eventId: raceId, bibNumber: 101 }, NOW), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await byBib(101))?.gunTimeMs).toBe(3_000_000);
  });

  it("lets only the Administrators publish: the Organizer enters the results and cannot make them public", async () => {
    await approvePrivacyNotice(db, { results: true });
    for (const role of ["MODERATOR", "DEV", "CONTRIBUTOR", "COPYWRITER", "MEMBER"] as const) {
      await expect(setResultsPublished(db, staff[role]!, raceId, true, NOW), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(setResultsPublished(db, staff.ADMIN!, raceId, true, NOW)).resolves.toEqual({ changed: true });
  });

  it("takes results only for a race: a group run's save, import and publish are refused", async () => {
    const group = await createRace(db, { type: "GROUP_RUN" });
    await approvePrivacyNotice(db, { results: true });
    await expect(saveEventResults(db, staff.ADMIN!, { eventId: group.id, rows: [line(1, { time: "10:00" })] }, NOW)).rejects.toMatchObject({ code: "RESULTS_NOT_OPEN" });
    await expect(importResultsCsv(db, staff.ADMIN!, group.id, "1,10:00")).rejects.toMatchObject({ code: "RESULTS_NOT_OPEN" });
    await expect(setResultsPublished(db, staff.ADMIN!, group.id, true, NOW)).rejects.toMatchObject({ code: "RESULTS_NOT_OPEN" });
    // The page can still read it, to say a group run has none.
    expect((await readEventResults(db, staff.ADMIN!, group.id)).event.type).toBe("GROUP_RUN");
  });
});

describe("§NNN the publish gate", () => {
  it("refuses to make the results public while no privacy notice describes them, whatever is in force", async () => {
    await expect(setResultsPublished(db, staff.ADMIN!, raceId, true, NOW)).rejects.toMatchObject({ code: "RESULTS_NOTICE" });
    await approvePrivacyNotice(db, { results: false });
    await expect(setResultsPublished(db, staff.ADMIN!, raceId, true, NOW)).rejects.toMatchObject({ code: "RESULTS_NOTICE" });
    const [event] = await db.select({ published: events.resultsPublished }).from(events).where(eq(events.id, raceId));
    expect(event.published).toBe(false);
    expect(await trailActions()).not.toContain("event_results.published");
  });

  it("accepts it under a notice from the platform's template, records the moment and the audit row, and takes it off again without the notice", async () => {
    await approvePrivacyNotice(db, { results: true });
    await expect(setResultsPublished(db, staff.ADMIN!, raceId, true, NOW)).resolves.toEqual({ changed: true });
    expect((await db.select().from(events).where(eq(events.id, raceId)))[0]).toMatchObject({ resultsPublished: true, resultsPublishedAt: NOW });
    // A second press that changes nothing writes nothing.
    await expect(setResultsPublished(db, staff.ADMIN!, raceId, true, NOW)).resolves.toEqual({ changed: false });
    // A newer notice that does not describe them: turning it off is never refused.
    await approvePrivacyNotice(db, { results: false });
    await expect(setResultsPublished(db, staff.ADMIN!, raceId, false, clock())).resolves.toEqual({ changed: true });
    expect((await db.select().from(events).where(eq(events.id, raceId)))[0]).toMatchObject({ resultsPublished: false, resultsPublishedAt: null });
    expect((await trailActions()).filter((action) => action.startsWith("event_results."))).toEqual(["event_results.published", "event_results.unpublished"]);
  });

  it("needs the notice in both languages: one language's notice that names it is not enough", async () => {
    const { privacyNoticeRo } = await import("@/modules/legal-documents/templates/privacy-notice");
    const { computeContentHash } = await import("@/modules/legal-documents/domain/content-hash");
    const { insertLegalDocumentVersion } = await import("@/modules/legal-documents/repository");
    const strip = (text: string) => JSON.parse(text.split("{{results}}").join(""));
    const translations = [
      { locale: "ro" as const, title: "Nota", body: privacyNoticeRo },
      { locale: "en" as const, title: "Notice", body: strip(JSON.stringify(privacyNoticeRo)) },
    ];
    await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-10-01T10:00:00Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
    await expect(setResultsPublished(db, staff.ADMIN!, raceId, true, NOW)).rejects.toMatchObject({ code: "RESULTS_NOTICE" });
  });
});

describe("§NNN the public read: a name only for a registered runner who ticked", () => {
  const options = { now: AFTER_THE_RACE, deadlines: DEFAULT_DEADLINES, noticeDescribes: true };

  async function published() {
    await field();
    await registerRunner(db, raceId, { name: "Fost Inscris", bibNumber: 105, sex: "MALE", birthDate: "1990-01-01" });
    await save([line(101, { time: "50:00", note: "secret" }), line(102, { time: "45:00" }), line(103, { time: "40:00" }), line(104, { status: "DNF" }), line(105, { time: "55:00" }), typed(0, { bib: "900", name: "Ion Vasile", sex: "male", time: "42:00" })]);
    await approvePrivacyNotice(db, { results: true });
    await setResultsPublished(db, staff.ADMIN!, raceId, true, NOW);
  }

  it("shows nothing while the results are not published", async () => {
    await field();
    await save([line(101, { time: "50:00" })]);
    expect(await readPublicEventResults(db, raceId, options)).toBeNull();
  });

  it("shows the rows in the sheet's order with a name only for those who ticked, and «Participant #bib» (a null name) for everyone else", async () => {
    await published();
    const result = await readPublicEventResults(db, raceId, options);
    expect(result?.rows.map((row) => [row.bibNumber, row.name, row.positionOverall, row.status])).toEqual([
      [103, null, 1, "FINISHED"], // Dan did not tick
      [900, null, 2, "FINISHED"], // typed by hand: no tick, so no name
      [102, "Bia Marin", 3, "FINISHED"],
      [101, "Ana Popescu", 4, "FINISHED"],
      [105, "Fost Inscris", 5, "FINISHED"],
      [104, "Eli Vasile", null, "DNF"], // ticked too: the rule is the same whatever the state
    ]);
    expect(result?.rows.find((row) => row.bibNumber === 102)).toMatchObject({ sex: "FEMALE", categoryKey: "FEMALE:from40", positionSex: 1, positionCategory: 1 });
    expect(result?.rows.find((row) => row.bibNumber === 900)?.sex).toBe("MALE");
  });

  it("carries no note, no registration id, no address, no phone, no document — the select names its columns", async () => {
    await published();
    const result = await readPublicEventResults(db, raceId, options);
    const keys = new Set(result?.rows.flatMap((row) => Object.keys(row)));
    expect([...keys].sort()).toEqual(["bibNumber", "categoryKey", "chipTimeMs", "gunTimeMs", "name", "positionCategory", "positionOverall", "positionSex", "sex", "status"]);
    expect(JSON.stringify(result)).not.toMatch(/secret|example\.org|@|registrationId|note/i);
  });

  it("follows the runner's tick at once: withdrawing it takes the name off the next read", async () => {
    await published();
    await db.update(registrations).set({ listOptOut: true }).where(and(eq(registrations.eventId, raceId), eq(registrations.bibNumber, 102)));
    const result = await readPublicEventResults(db, raceId, options);
    expect(result?.rows.find((row) => row.bibNumber === 102)?.name).toBeNull();
  });

  it("shows a result whose registration was erased as nameless, and never a test registration's name", async () => {
    await published();
    await db.delete(registrations).where(and(eq(registrations.eventId, raceId), eq(registrations.bibNumber, 101)));
    const test = await registerRunner(db, raceId, { name: "Persoana De Proba", bibNumber: 170, kind: "TEST" });
    await db.insert(eventResults).values({ eventId: raceId, registrationId: test.id, bibNumber: 170, status: "FINISHED", gunTimeMs: 3_600_000 });
    const result = await readPublicEventResults(db, raceId, options);
    expect(result?.rows.find((row) => row.bibNumber === 101)).toMatchObject({ name: null, positionOverall: 4 });
    expect(result?.rows.find((row) => row.bibNumber === 170)?.name).toBeNull();
    expect(JSON.stringify(result)).not.toContain("Proba");
  });

  it("shows nothing when the notice in force no longer describes the results, or the public list's period has passed", async () => {
    await published();
    expect(await readPublicEventResults(db, raceId, { ...options, noticeDescribes: false })).toBeNull();
    expect(await readPublicEventResults(db, raceId, { ...options, now: A_YEAR_AFTER })).toBeNull();
    const open = await readPublicEventResults(db, raceId, options);
    expect(open?.closesAt.getTime()).toBe(new Date("2026-11-21T07:00:00.000Z").getTime() + 30 * 24 * 60 * 60 * 1000);
  });

  it("answers null for an unknown event, a malformed id and a group run", async () => {
    expect(await readPublicEventResults(db, "7b2c1f0e-3d4a-4b5c-8d6e-0f1a2b3c4d5e", options)).toBeNull();
    expect(await readPublicEventResults(db, "x", options)).toBeNull();
    const group = await createRace(db, { type: "GROUP_RUN", resultsPublished: true });
    expect(await readPublicEventResults(db, group.id, options)).toBeNull();
  });
});

describe("§NNN the import, matched by bib", () => {
  it("matches a number to the event's registrations (any state, never a test row) and says which numbers need a name", async () => {
    await field();
    await registerRunner(db, raceId, { name: "Anulat", bibNumber: 150, status: "CANCELLED" });
    await registerRunner(db, raceId, { name: "De proba", bibNumber: 151, kind: "TEST" });
    const rows = await importResultsCsv(db, staff.MODERATOR!, raceId, "Nr;Timp;Status\n101;45:12;\n102;;DNF\n150;50:00;\n151;51:00;\n999;52:00;");
    expect(rows.map((row) => [row.bibNumber, row.matched, row.name, row.status])).toEqual([
      [101, true, "Ana Popescu", "FINISHED"],
      [102, true, "Bia Marin", "DNF"],
      [150, true, "Anulat", "FINISHED"],
      [151, false, null, "FINISHED"],
      [999, false, null, "FINISHED"],
    ]);
  });

  it("writes nothing by itself", async () => {
    await field();
    await importResultsCsv(db, staff.ADMIN!, raceId, "101,45:12");
    expect(await stored()).toEqual([]);
    expect(await resultsTrail()).toEqual([]);
  });

  it("refuses a file with a bad line, naming it", async () => {
    await expect(importResultsCsv(db, staff.ADMIN!, raceId, "101,45:12\n102,nope")).rejects.toMatchObject({ code: "RESULTS_IMPORT_INVALID", line: 2, problem: "time" });
  });
});

describe("§NNN the delete and the export", () => {
  it("deletes one result, recomputes the others' positions and audits it; a second press finds nothing", async () => {
    await field();
    await save([line(101, { time: "50:00" }), line(102, { time: "45:00" }), line(103, { time: "40:00" })]);
    await deleteEventResult(db, staff.MODERATOR!, { eventId: raceId, bibNumber: 103 }, clock());
    expect((await stored()).map((row) => [row.bibNumber, row.positionOverall])).toEqual([[101, 2], [102, 1]]);
    expect((await resultsTrail()).at(-1)).toMatchObject({ action: "event_result.deleted", metadataJson: { bibNumber: 103, status: "FINISHED" }, actorStaffUserId: staff.MODERATOR!.id });
    await expect(deleteEventResult(db, staff.ADMIN!, { eventId: raceId, bibNumber: 103 }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("exports the finishers by position then the others, with the names the backoffice sees, and records the download without a name", async () => {
    await field();
    await save([line(101, { time: "50:00" }), line(102, { time: "45:00" }), line(103, { status: "DSQ" }), line(104, { status: "DNS" }), typed(0, { bib: "900", name: "Ion Vasile", time: "40:00" })]);
    const { rows } = await exportEventResults(db, staff.MODERATOR!, raceId, NOW);
    expect(rows.map((row) => [row.bibNumber, row.name, row.positionOverall, row.status])).toEqual([
      [900, "Ion Vasile", 1, "FINISHED"],
      [102, "Bia Marin", 2, "FINISHED"],
      [101, "Ana Popescu", 3, "FINISHED"],
      [103, "Dan Ionescu", null, "DSQ"],
      [104, "Eli Vasile", null, "DNS"],
    ]);
    const exported = (await trail()).filter((row) => row.action === "event_results.exported");
    expect(exported).toHaveLength(1);
    expect(exported[0].metadataJson).toEqual({ rows: 5 });
  });

  it("reads the page's data: registered runners checked-in first, typed rows apart, counts by state", async () => {
    await field();
    await registerRunner(db, raceId, { name: "In asteptare", bibNumber: 160, status: "PENDING_DECLARATION" });
    await save([line(101, { time: "50:00" }), line(103, { status: "DNF" }), typed(0, { bib: "900", name: "Ion Vasile", time: "40:00" })]);
    const view = await readEventResults(db, staff.ADMIN!, raceId);
    // Checked-in first (101, 102), then by number; the pending one holds a bib but no result and is not confirmed: not drawn.
    expect(view.registered.map((runner) => [runner.bibNumber, runner.checkedIn])).toEqual([[101, true], [102, true], [103, false], [104, false]]);
    expect(view.typed.map((runner) => [runner.bibNumber, runner.name])).toEqual([[900, "Ion Vasile"]]);
    expect(view.counts).toEqual({ FINISHED: 2, DNF: 1, DNS: 0, DSQ: 0 });
    expect(view.registered[0].result).toMatchObject({ status: "FINISHED", positionOverall: 2 });
    expect(view.registered[1].result).toBeNull();
    // The fingerprint is a short hash, never the rows.
    expect(view.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});
