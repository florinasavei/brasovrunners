import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventResults } from "@/db/schema/event-results";
import type { StaffUser } from "@/db/schema/staff-users";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { setRegistrationAmbassador } from "@/modules/registrations/ambassador-mark";
import { setRegistrationElite, setRegistrationEliteTick } from "@/modules/registrations/elite-mark";
import { awardsOf } from "@/modules/results/domain/awards";
import { exportEventResults, readEventResults, readPublicEventResults, saveEventResults, setResultsPublished } from "@/modules/results/results";
import type { PostedResultRow } from "@/modules/results/rows";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { AFTER_THE_RACE, approveResultsTexts, createRace, person, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * «Apare în clasament» under the ambassador mark (§NNN; the owner, 2026-11-14: «pe lângă Elite, adaugă și categoria de
 * „Ambasadori" ca să putem decide pe cine premiem și pe cine nu»; BR-REQ-050-02, BR-REQ-039-01, BR-REQ-060-01) — on real
 * PostgreSQL. A registration marked «Ambasador» has the elite's pair of ticks (§910): unticked, its result runs hors
 * concours — it stays on the backoffice's «Clasament», marked, and is left out of the public results, of everybody's
 * positions (the stored ones, ranked again in the same transaction, and the ones every read ranks) and so of «Premii».
 * The mark alone moves nothing in the ranking. The backoffice's page says whose result it is — «Elită», «Ambasador» —
 * and the published results never do.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
const revalidate = vi.hoisted(() => vi.fn());
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()), revalidatePublicContent: revalidate }));

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
let admin: StaffUser;
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
  raceId = (await createRace(db)).id;
});

const line = (bib: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `r[${bib}]`, bib: String(bib), name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });
const typed = (index: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `n[${index}]`, bib: "", name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });
const save = (rows: PostedResultRow[]) => saveEventResults(db, admin, { eventId: raceId, rows }, NOW);
/** The stored positions, by number: what the last save, a tick or a mark wrote. */
const storedPositions = async () =>
  Object.fromEntries((await db.select().from(eventResults).where(eq(eventResults.eventId, raceId))).map((row) => [row.bibNumber, [row.positionOverall, row.positionSex, row.positionCategory]]));
const publicRows = async () => (await readPublicEventResults(db, raceId, PUBLIC))?.rows.map((row) => [row.bibNumber, row.name, row.positionOverall]);
/** «Premii», as the page computes it: the men's overall podium, by number. */
async function menPodium(): Promise<number[]> {
  const view = await readEventResults(db, admin, raceId);
  const rows = [...view.registered, ...view.typed].flatMap((runner) =>
    runner.result
      ? [{ bibNumber: runner.bibNumber, name: runner.name, sex: runner.sex, gunTimeMs: runner.result.gunTimeMs, positionSex: runner.result.positionSex, positionCategory: runner.result.positionCategory, categoryKey: runner.result.categoryKey }]
      : [],
  );
  const group = awardsOf(rows, { places: 3, categories: false }).find((candidate) => candidate.kind === "sex" && candidate.sex === "MALE");
  return group?.rows.map((row) => row.bibNumber) ?? [];
}

/** Three men and a woman, all thirty-something, all ticked: Dan the fastest. */
async function field() {
  const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1993-05-01" });
  const ben = await registerRunner(db, raceId, { name: "Ben Marin", bibNumber: 102, sex: "MALE", birthDate: "1992-03-10" });
  const dan = await registerRunner(db, raceId, { name: "Dan Ionescu", bibNumber: 103, sex: "MALE", birthDate: "1991-11-21" });
  const emil = await registerRunner(db, raceId, { name: "Emil Radu", bibNumber: 104, sex: "MALE", birthDate: "1990-02-02" });
  await approveResultsTexts(db);
  await setResultsPublished(db, admin, raceId, true, NOW);
  return { ana, ben, dan, emil };
}
const RESULTS = [line(101, { time: "44:00" }), line(102, { time: "42:00" }), line(103, { time: "38:00" }), line(104, { time: "46:00" })];

describe("§NNN an ambassador out of the ranking, by the registration's own tick", () => {
  it("the mark alone moves nothing: the ambassador is ranked, named and on the podium as before", async () => {
    const { dan } = await field();
    await save(RESULTS);
    const before = { stored: await storedPositions(), public: await publicRows(), podium: await menPodium() };
    expect(before.podium).toEqual([103, 102, 104]);
    revalidate.mockClear();

    await setRegistrationAmbassador(db, admin, dan.id, true, NOW);
    expect({ stored: await storedPositions(), public: await publicRows(), podium: await menPodium() }).toEqual(before);
    // Nothing to tell the public pages: no tick hides anything.
    expect(revalidate).not.toHaveBeenCalledWith("events", "places");
  });

  it("«Apare în clasament» unticked: out of the public results, of everybody's positions — stored and read — and of «Premii»; back with the tick", async () => {
    const { dan } = await field();
    await save(RESULTS);
    await setRegistrationAmbassador(db, admin, dan.id, true, NOW);

    await setRegistrationEliteTick(db, admin, dan.id, "inResults", false, NOW);
    // Stored: ranked again in the tick's own transaction, as if Dan had not run.
    expect(await storedPositions()).toMatchObject({ 103: [null, null, null], 102: [1, 1, 1], 101: [2, 1, 1], 104: [3, 2, 2] });
    // Public: not a row at all — not a name, not «Participant #103», not a time.
    expect(await publicRows()).toEqual([
      [102, "Ben Marin", 1],
      [101, "Ana Popescu", 2],
      [104, "Emil Radu", 3],
    ]);
    // «Premii»: the podium is the others'.
    expect(await menPodium()).toEqual([102, 104]);
    // «Clasament» keeps the line, marked, with its time and no position — and says whose it is.
    const view = await readEventResults(db, admin, raceId);
    expect(view.registered.find((runner) => runner.bibNumber === 103)).toMatchObject({ outOfRanking: true, ambassador: true, elite: false, result: { gunTimeMs: 38 * 60_000, positionOverall: null } });
    expect(view.registered.filter((runner) => runner.outOfRanking).map((runner) => runner.bibNumber)).toEqual([103]);
    // The club's own file: the finishers by position, then the ambassador among the finishers, marked.
    const file = await exportEventResults(db, admin, raceId, NOW);
    expect(file.rows.map((row) => [row.bibNumber, row.positionOverall, row.outOfRanking])).toEqual([
      [102, 1, false],
      [101, 2, false],
      [104, 3, false],
      [103, null, true],
    ]);

    // Ticked again: back in the ranking, stored and public, and back on the podium.
    await setRegistrationEliteTick(db, admin, dan.id, "inResults", true, NOW);
    expect(await storedPositions()).toMatchObject({ 103: [1, 1, 1], 102: [2, 2, 2] });
    expect((await publicRows())?.[0]).toEqual([103, "Dan Ionescu", 1]);
    expect(await menPodium()).toEqual([103, 102, 104]);
  });

  it("counts the tick only under a mark: the mark off ranks the runner again in the same transaction, the mark back leaves them out again", async () => {
    const { dan } = await field();
    await save(RESULTS);
    await setRegistrationAmbassador(db, admin, dan.id, true, NOW);
    await setRegistrationEliteTick(db, admin, dan.id, "inResults", false, NOW);
    revalidate.mockClear();

    await setRegistrationAmbassador(db, admin, dan.id, false, NOW);
    expect(await storedPositions()).toMatchObject({ 103: [1, 1, 1], 102: [2, 2, 2] });
    expect((await publicRows())?.[0]).toEqual([103, "Dan Ionescu", 1]);
    // The public pages are told: what they show changed.
    expect(revalidate).toHaveBeenCalledWith("events", "places");

    await setRegistrationAmbassador(db, admin, dan.id, true, NOW);
    expect(await storedPositions()).toMatchObject({ 103: [null, null, null], 102: [1, 1, 1] });
    expect((await publicRows())?.map(([bib]) => bib)).toEqual([102, 101, 104]);
  });

  it("one pair of ticks for both marks: with the elite's mark and the ambassador's on, either mark off keeps the runner out, both off ranks them", async () => {
    const { dan } = await field();
    await save(RESULTS);
    await setRegistrationElite(db, admin, dan.id, true, NOW);
    await setRegistrationAmbassador(db, admin, dan.id, true, NOW);
    await setRegistrationEliteTick(db, admin, dan.id, "inResults", false, NOW);
    expect(await storedPositions()).toMatchObject({ 103: [null, null, null], 102: [1, 1, 1] });

    await setRegistrationElite(db, admin, dan.id, false, NOW);
    expect(await storedPositions()).toMatchObject({ 103: [null, null, null], 102: [1, 1, 1] });
    await setRegistrationElite(db, admin, dan.id, true, NOW);
    await setRegistrationAmbassador(db, admin, dan.id, false, NOW);
    expect(await storedPositions()).toMatchObject({ 103: [null, null, null], 102: [1, 1, 1] });
    await setRegistrationElite(db, admin, dan.id, false, NOW);
    expect(await storedPositions()).toMatchObject({ 103: [1, 1, 1], 102: [2, 2, 2] });
  });

  it("is drawn «în afara clasamentului» before any result is typed, and a save ranks the others without it", async () => {
    const { dan } = await field();
    await setRegistrationAmbassador(db, admin, dan.id, true, NOW);
    await setRegistrationEliteTick(db, admin, dan.id, "inResults", false, NOW);
    expect((await readEventResults(db, admin, raceId)).registered.find((runner) => runner.bibNumber === 103)).toMatchObject({ outOfRanking: true, result: null });
    await save(RESULTS);
    expect(await storedPositions()).toMatchObject({ 103: [null, null, null], 102: [1, 1, 1] });
  });

  it("«Apare pe site» unticked reads the ambassador's own tick as not given — «Participant #bib» in the public results, still ranked", async () => {
    const { dan } = await field();
    await save(RESULTS);
    await setRegistrationAmbassador(db, admin, dan.id, true, NOW);
    await setRegistrationEliteTick(db, admin, dan.id, "onSite", false, NOW);
    const rows = await publicRows();
    expect(rows?.[0]?.[0]).toBe(103);
    expect(rows?.[0]?.[1]).not.toBe("Dan Ionescu");
    expect(rows?.[0]?.[2]).toBe(1);
    expect((await readEventResults(db, admin, raceId)).registered.find((runner) => runner.bibNumber === 103)).toMatchObject({ named: false, outOfRanking: false, ambassador: true });
  });
});

describe("§NNN whose result it is: said on the backoffice's page, never on the published results", () => {
  it("names the registration's marks on every registered line, and none on a line typed by hand", async () => {
    const { ana, ben, dan } = await field();
    await setRegistrationAmbassador(db, admin, dan.id, true, NOW);
    await setRegistrationElite(db, admin, ben.id, true, NOW);
    await setRegistrationElite(db, admin, ana.id, true, NOW);
    await setRegistrationAmbassador(db, admin, ana.id, true, NOW);
    await save([...RESULTS, typed(0, { bib: "900", name: "Ion Vasile", sex: "male", time: "41:00" })]);

    const view = await readEventResults(db, admin, raceId);
    expect(view.registered.map((runner) => [runner.bibNumber, runner.elite, runner.ambassador])).toEqual([
      [101, true, true],
      [102, true, false],
      [103, false, true],
      [104, false, false],
    ]);
    expect(view.typed.map((runner) => [runner.bibNumber, runner.elite, runner.ambassador])).toEqual([[900, false, false]]);
  });

  it("BR-REQ-039-01 the published results carry no mark: not a field, not a word", async () => {
    const { ben, dan } = await field();
    await save(RESULTS);
    await setRegistrationAmbassador(db, admin, dan.id, true, NOW);
    await setRegistrationElite(db, admin, ben.id, true, NOW);

    const published = await readPublicEventResults(db, raceId, PUBLIC);
    expect(published?.rows.map((row) => row.bibNumber)).toEqual([103, 102, 101, 104]);
    const json = JSON.stringify(published);
    expect(json).not.toMatch(/ambassador|ambasador|elite|elită/i);
    for (const row of published?.rows ?? []) expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["ambassador"]));
  });
});
