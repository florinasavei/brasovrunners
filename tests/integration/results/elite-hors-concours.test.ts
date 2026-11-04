import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventResults } from "@/db/schema/event-results";
import type { StaffUser } from "@/db/schema/staff-users";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { addEliteEntry, deleteEliteEntry, setEliteEntryTick } from "@/modules/registrations/elite-list";
import { setRegistrationElite, setRegistrationEliteTick } from "@/modules/registrations/elite-mark";
import { exportEventResults, readEventResults, readPublicEventResults, saveEventResults, setResultsPublished } from "@/modules/results/results";
import type { PostedResultRow } from "@/modules/results/rows";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { AFTER_THE_RACE, approveResultsTexts, createRace, person, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * «Apare în clasament» (§NNN; the owner, 2026-11-04: per elite, «Apare în clasament» and «Apare pe site»; BR-REQ-050-02,
 * BR-REQ-039-01, BR-REQ-060-01) — on real PostgreSQL. Unticked, an elite runs hors concours: its result stays on «Clasament», marked,
 * and is left out of the public results and of everybody's positions — the stored ones, ranked again in the tick's own transaction,
 * and the ones every read ranks from the live answers. A registered elite is recognised by its registration; a separate-list elite by
 * the line's number, or, for a line with none, by its name on exactly one typed row. «Apare pe site» unticked on a registered elite
 * reads its own tick as not given — «Participant #bib» in the results — and never names one who did not tick.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
const revalidate = vi.hoisted(() => vi.fn());
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()), revalidatePublicContent: revalidate }));

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
let admin: StaffUser;
let organizer: StaffUser;
let tehnic: StaffUser;
const NOW = AFTER_THE_RACE;
const PUBLIC = { now: AFTER_THE_RACE, deadlines: DEFAULT_DEADLINES, noticeDescribes: true, termsDescribe: true, firstResultsNoticeVersion: 1 as number | null, firstResultsNameAskNoticeVersion: null };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  revalidate.mockClear();
  admin = await person(db, "ADMIN", "Ana Admin");
  organizer = await person(db, "MODERATOR", "Oana Organizator");
  tehnic = await person(db, "DEV", "Tudor Tehnic");
  raceId = (await createRace(db)).id;
});

const line = (bib: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `r[${bib}]`, bib: String(bib), name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });
const typed = (index: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `n[${index}]`, bib: "", name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });
const save = (rows: PostedResultRow[]) => saveEventResults(db, admin, { eventId: raceId, rows }, NOW);
/** The stored positions, by number: what the last save, or a tick, wrote. */
const storedPositions = async () =>
  Object.fromEntries((await db.select().from(eventResults).where(eq(eventResults.eventId, raceId))).map((row) => [row.bibNumber, [row.positionOverall, row.positionSex, row.positionCategory]]));
const publicRows = async () => (await readPublicEventResults(db, raceId, PUBLIC))?.rows.map((row) => [row.bibNumber, row.name, row.positionOverall]);

/** Three men and a woman, all thirty-something, all ticked: Dan the fastest. */
async function field() {
  const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1993-05-01" });
  const ben = await registerRunner(db, raceId, { name: "Ben Marin", bibNumber: 102, sex: "MALE", birthDate: "1992-03-10" });
  const dan = await registerRunner(db, raceId, { name: "Dan Ionescu", bibNumber: 103, sex: "MALE", birthDate: "1991-11-21" });
  await approveResultsTexts(db);
  await setResultsPublished(db, admin, raceId, true, NOW);
  return { ana, ben, dan };
}

describe("§NNN a registered elite out of the ranking", () => {
  it("leaves the public results and everybody's positions, stored and read, and comes back with the tick", async () => {
    const { dan } = await field();
    await save([line(101, { time: "44:00" }), line(102, { time: "42:00" }), line(103, { time: "38:00" })]);
    await setRegistrationElite(db, admin, dan.id, true, NOW);
    expect(await storedPositions()).toMatchObject({ 103: [1, 1, 1], 102: [2, 2, 2], 101: [3, 1, 1] });

    await setRegistrationEliteTick(db, admin, dan.id, "inResults", false, NOW);
    // Stored: ranked again in the tick's own transaction, as if Dan had not run.
    expect(await storedPositions()).toMatchObject({ 103: [null, null, null], 102: [1, 1, 1], 101: [2, 1, 1] });
    // Public: not a row at all — not a name, not «Participant #103», not a time.
    expect(await publicRows()).toEqual([
      [102, "Ben Marin", 1],
      [101, "Ana Popescu", 2],
    ]);
    // «Clasament» keeps the line, marked, with its time and no position.
    const view = await readEventResults(db, admin, raceId);
    expect(view.registered.find((runner) => runner.bibNumber === 103)).toMatchObject({ outOfRanking: true, result: { gunTimeMs: 38 * 60_000, positionOverall: null } });
    expect(view.registered.filter((runner) => runner.outOfRanking).map((runner) => runner.bibNumber)).toEqual([103]);
    // The club's own file: the finishers by position, then the elite among the finishers, marked.
    const file = await exportEventResults(db, admin, raceId, NOW);
    expect(file.rows.map((row) => [row.bibNumber, row.positionOverall, row.outOfRanking])).toEqual([
      [102, 1, false],
      [101, 2, false],
      [103, null, true],
    ]);

    // Ticked again: back in the ranking, stored and public.
    await setRegistrationEliteTick(db, admin, dan.id, "inResults", true, NOW);
    expect(await storedPositions()).toMatchObject({ 103: [1, 1, 1], 102: [2, 2, 2] });
    expect((await publicRows())?.[0]).toEqual([103, "Dan Ionescu", 1]);
  });

  it("counts the tick only under the mark: taking the mark off ranks the runner again, putting it back leaves them out again", async () => {
    const { dan } = await field();
    await save([line(102, { time: "42:00" }), line(103, { time: "38:00" })]);
    await setRegistrationElite(db, admin, dan.id, true, NOW);
    await setRegistrationEliteTick(db, admin, dan.id, "inResults", false, NOW);
    await setRegistrationElite(db, admin, dan.id, false, NOW);
    expect(await storedPositions()).toMatchObject({ 103: [1, 1, 1], 102: [2, 2, 2] });
    await setRegistrationElite(db, admin, dan.id, true, NOW);
    expect(await storedPositions()).toMatchObject({ 103: [null, null, null], 102: [1, 1, 1] });
  });

  it("drawn «în afara clasamentului» before any result is typed, and a save ranks the others without it", async () => {
    const { dan } = await field();
    await setRegistrationElite(db, admin, dan.id, true, NOW);
    await setRegistrationEliteTick(db, admin, dan.id, "inResults", false, NOW);
    expect((await readEventResults(db, admin, raceId)).registered.find((runner) => runner.bibNumber === 103)).toMatchObject({ outOfRanking: true, result: null });
    await save([line(102, { time: "42:00" }), line(103, { time: "38:00" })]);
    expect(await storedPositions()).toMatchObject({ 103: [null, null, null], 102: [1, 1, 1] });
  });
});

describe("§NNN a separate-list elite out of the ranking, by its number or its name", () => {
  it("by the line's number: the typed row on it, whatever name it was typed with", async () => {
    await field();
    const line7 = await addEliteEntry(db, admin, raceId, { name: "Eliud Kipchoge", bibNumber: "7" }, NOW);
    await save([line(102, { time: "42:00" }), typed(0, { bib: "7", name: "E. Kipchoge", sex: "male", time: "35:00" })]);
    // The typed row has no birth date, so no category: Ben is first of his.
    expect(await storedPositions()).toMatchObject({ 7: [1, 1, null], 102: [2, 2, 1] });

    await setEliteEntryTick(db, admin, line7.id, "inResults", false, NOW);
    expect(await storedPositions()).toMatchObject({ 7: [null, null, null], 102: [1, 1, 1] });
    expect((await publicRows())?.map(([bib]) => bib)).toEqual([102]);
    const view = await readEventResults(db, admin, raceId);
    expect(view.typed.map((runner) => [runner.bibNumber, runner.outOfRanking])).toEqual([[7, true]]);
  });

  it("by the name, for a line with no number: the one typed row carrying it — folded — and none while two rows carry it", async () => {
    await field();
    const faith = await addEliteEntry(db, admin, raceId, { name: "Faith Kipyegon", bibNumber: "" }, NOW);
    await save([line(101, { time: "44:00" }), typed(0, { bib: "900", name: "faith  KIPYEGON", sex: "female", time: "40:00" }), typed(1, { bib: "901", name: "Maria Pop", sex: "female", time: "46:00" })]);
    await setEliteEntryTick(db, admin, faith.id, "inResults", false, NOW);
    expect(await storedPositions()).toMatchObject({ 900: [null, null, null], 101: [1, 1, 1], 901: [2, 2, null] });

    // A second typed row with that name: the rule cannot tell them apart, so neither leaves the ranking.
    await save([line(101, { time: "44:00" }), typed(0, { bib: "900", name: "faith  KIPYEGON", sex: "female", time: "40:00" }), typed(1, { bib: "901", name: "Faith Kipyegon", sex: "female", time: "46:00" })]);
    expect(await storedPositions()).toMatchObject({ 900: [1, 1, null], 101: [2, 2, 1], 901: [3, 3, null] });
  });

  it("deleting a line out of the ranking puts its result back, in the same transaction", async () => {
    await field();
    const line7 = await addEliteEntry(db, admin, raceId, { name: "Eliud Kipchoge", bibNumber: "7" }, NOW);
    await save([line(102, { time: "42:00" }), typed(0, { bib: "7", name: "Eliud Kipchoge", sex: "male", time: "35:00" })]);
    await setEliteEntryTick(db, admin, line7.id, "inResults", false, NOW);
    await deleteEliteEntry(db, admin, line7.id, NOW);
    expect(await storedPositions()).toMatchObject({ 7: [1, 1, null], 102: [2, 2, 1] });
  });
});

describe("§NNN «Apare pe site» on a registered elite only hides", () => {
  it("unticked, the runner is «Participant #bib» in the public results, still ranked; ticked, their own tick decides", async () => {
    const { ben } = await field();
    await save([line(101, { time: "44:00" }), line(102, { time: "42:00" })]);
    await setRegistrationElite(db, admin, ben.id, true, NOW);
    await setRegistrationEliteTick(db, admin, ben.id, "onSite", false, NOW);
    expect(await publicRows()).toEqual([
      [102, null, 1],
      [101, "Ana Popescu", 2],
    ]);
    expect((await readEventResults(db, admin, raceId)).registered.find((runner) => runner.bibNumber === 102)).toMatchObject({ named: false, outOfRanking: false });
    await setRegistrationEliteTick(db, admin, ben.id, "onSite", true, NOW);
    expect((await publicRows())?.[0]).toEqual([102, "Ben Marin", 1]);
  });

  it("never names a runner who did not tick, whatever the club's tick says", async () => {
    await approveResultsTexts(db);
    await setResultsPublished(db, admin, raceId, true, NOW);
    const shy = await registerRunner(db, raceId, { name: "Ion Discret", bibNumber: 110, sex: "MALE", birthDate: "1990-01-01", ticked: false });
    await save([line(110, { time: "40:00" })]);
    await setRegistrationElite(db, admin, shy.id, true, NOW);
    // «Apare pe site» stands ticked by default: no override at all, the person's own «no» stays a no.
    expect(await publicRows()).toEqual([[110, null, 1]]);
    expect(JSON.stringify(await readPublicEventResults(db, raceId, PUBLIC))).not.toContain("Discret");
  });
});

describe("§NNN who may tick, and the trail (BR-REQ-060-01)", () => {
  it("refuses the Organizer and Tehnic on both kinds of elite, writing nothing", async () => {
    const { dan } = await field();
    const line7 = await addEliteEntry(db, admin, raceId, { name: "Eliud Kipchoge", bibNumber: "7" }, NOW);
    await setRegistrationElite(db, admin, dan.id, true, NOW);
    const before = (await db.select().from(auditLogs)).length;
    for (const actor of [organizer, tehnic]) {
      await expect(setEliteEntryTick(db, actor, line7.id, "inResults", false, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(setEliteEntryTick(db, actor, line7.id, "onSite", true, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(setRegistrationEliteTick(db, actor, dan.id, "inResults", false, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(setRegistrationEliteTick(db, actor, dan.id, "onSite", false, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await db.select().from(auditLogs)).toHaveLength(before);
  });

  it("writes one audit row per change, ids and the new value only; a press that finds the tick as asked writes nothing", async () => {
    const { dan } = await field();
    const line7 = await addEliteEntry(db, admin, raceId, { name: "Eliud Kipchoge", bibNumber: "7" }, NOW);
    await setRegistrationElite(db, admin, dan.id, true, NOW);
    const start = (await db.select().from(auditLogs)).length;
    await setEliteEntryTick(db, admin, line7.id, "inResults", false, NOW);
    await setEliteEntryTick(db, admin, line7.id, "onSite", true, NOW);
    await setRegistrationEliteTick(db, admin, dan.id, "inResults", false, NOW);
    await setRegistrationEliteTick(db, admin, dan.id, "onSite", false, NOW);
    // The same presses again: nothing changes, nothing is written.
    expect(await setEliteEntryTick(db, admin, line7.id, "inResults", false, NOW)).toMatchObject({ changed: false });
    expect(await setRegistrationEliteTick(db, admin, dan.id, "onSite", false, NOW)).toMatchObject({ changed: false });
    const trail = (await db.select().from(auditLogs)).slice(start).map((row) => [row.action, row.entityType, row.entityId, row.actorStaffUserId, row.metadataJson]);
    expect(trail).toEqual([
      ["event_elite.out_of_results", "event", raceId, admin.id, { entryId: line7.id, inResults: false }],
      ["event_elite.on_site", "event", raceId, admin.id, { entryId: line7.id, onSite: true }],
      ["registration.elite_out_of_results", "registration", dan.id, admin.id, { inResults: false }],
      ["registration.elite_off_site", "registration", dan.id, admin.id, { onSite: false }],
    ]);
    // Never a name in the trail.
    expect(JSON.stringify(trail)).not.toMatch(/Kipchoge|Ionescu/);
  });

  it("refuses the ticks of a registration no longer marked «Elită», and tells the public pages only after a change", async () => {
    const { dan } = await field();
    revalidate.mockClear();
    await expect(setRegistrationEliteTick(db, admin, dan.id, "inResults", false, NOW)).rejects.toMatchObject({ code: "ELITE_NOT_MARKED" });
    expect(revalidate).not.toHaveBeenCalled();
    await setRegistrationElite(db, admin, dan.id, true, NOW);
    revalidate.mockClear();
    await setRegistrationEliteTick(db, admin, dan.id, "inResults", false, NOW);
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledWith("events", "places");
    revalidate.mockClear();
    await setRegistrationEliteTick(db, admin, dan.id, "inResults", false, NOW);
    expect(revalidate).not.toHaveBeenCalled();
  });
});
