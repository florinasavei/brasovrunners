import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventResults } from "@/db/schema/event-results";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { readFinishHistory } from "@/modules/results/finish-history";
import {
  readEventResults,
  readFinishLine,
  readPublicEventResults,
  recordFinish,
  resetEventResults,
  saveEventResults,
  setRaceGun,
  setResultAgeBands,
  setResultAwards,
  setResultsPublished,
} from "@/modules/results/results";
import type { PostedResultRow } from "@/modules/results/rows";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { AFTER_THE_RACE, approveResultsTexts, createRace, person, RACE_STARTS_AT, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §997 — «Resetează clasamentul», through the service on real PostgreSQL (BR-REQ-050-02, BR-REQ-060-01): the trial runs before a race
 * wiped in one transaction — every result of the race, the runners typed by hand among them, and the gun a test «Start» set — by the
 * Administrator and the Superadministrator alone, on a race only, only while the planned gun is ahead (a test «Start» does not close
 * it), refused with CONFLICT when the page drew another count or another gun; the configuration, the elite list, the registrations, their
 * numbers and check-ins untouched, another race untouched, one audit row with counts only. And «Cronometrare»'s presses: one a phone
 * made before the reset and sent after it is refused, never a test finish brought back, while a press after it is a press.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
// What the service tells the public cache: once after a reset that wiped something, never for one that found nothing.
const revalidate = vi.hoisted(() => vi.fn());
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()), revalidatePublicContent: revalidate }));

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};

/** The planned gun, and the moments around it: the trial an hour before, the reset ten minutes after the trial's finishes. */
const PLANNED = RACE_STARTS_AT;
const before = (minutes: number, seconds = 0) => new Date(PLANNED.getTime() - minutes * 60_000 + seconds * 1000);
const TRIAL_GUN = before(60);

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  revalidate.mockClear();
  for (const [role, name] of [["ADMIN", "Ana Admin"], ["SUPERADMIN", "Sorin Super"], ["MODERATOR", "Oana Organizator"], ["DEV", "Tudor Tehnic"], ["CONTRIBUTOR", "Vlad Voluntar"], ["COPYWRITER", "Radu Redactor"], ["MEMBER", "Membru Club"]] as const) {
    staff[role] = await person(db, role, name);
  }
  raceId = (await createRace(db)).id;
  await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01", checkedInAt: before(90) });
  await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, sex: "FEMALE", birthDate: "1985-03-10" });
  await registerRunner(db, raceId, { name: "Dan Ionescu", bibNumber: 103, sex: "MALE", birthDate: "1996-11-21", checkedInAt: before(80) });
});

const line = (bib: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `r[${bib}]`, bib: String(bib), name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });
const typed = (index: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `n[${index}]`, bib: "", name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });
const stored = (eventId = raceId) => db.select().from(eventResults).where(eq(eventResults.eventId, eventId)).orderBy(eventResults.bibNumber);
const eventRow = async (eventId = raceId) => (await db.select().from(events).where(eq(events.id, eventId)))[0];
const resets = () => db.select().from(auditLogs).where(and(eq(auditLogs.entityId, raceId), eq(auditLogs.action, "event.results_reset")));

/**
 * The trial an hour before the planned gun: «Start» pressed, a «Neprezentat» with a note and a runner typed by hand on «Clasament», then
 * two finishes pressed at the line — four results and a gun, what the page draws and the reset wipes.
 */
async function trialRun() {
  await setRaceGun(db, staff.MODERATOR!, { eventId: raceId, clear: false }, TRIAL_GUN);
  await saveEventResults(
    db,
    staff.MODERATOR!,
    { eventId: raceId, rows: [line(103, { status: "DNS", note: "probă" }), typed(0, { bib: "900", name: "Ion Vasile", sex: "MALE", birthDate: "05.03.1985", time: "42:00" })] },
    before(59),
  );
  await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 101 }, before(58));
  await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 102 }, before(57, 30));
  expect((await stored()).map((row) => [row.bibNumber, row.status])).toEqual([
    [101, "FINISHED"],
    [102, "FINISHED"],
    [103, "DNS"],
    [900, "FINISHED"],
  ]);
}

const reset = (actor: StaffUser, now: Date, seen: { results?: number; gun?: number | null } = {}) =>
  resetEventResults(db, actor, { eventId: raceId, seenResults: seen.results ?? 4, seenGunAtMs: seen.gun === undefined ? TRIAL_GUN.getTime() : seen.gun }, now);

describe("§997 resetEventResults — the trial runs wiped before the start", () => {
  it("deletes every result of the race and clears the gun, in one go, keeping every setting, the elite list and the registrations", async () => {
    await approveResultsTexts(db);
    await setResultAwards(db, staff.ADMIN!, raceId, { places: 5, categories: false }, before(70));
    await setResultAgeBands(db, staff.ADMIN!, raceId, [18, 35, 50], before(70));
    // Ticked public before the race (§985): set now, shown from the start — the reset leaves the tick as it is.
    expect(await setResultsPublished(db, staff.ADMIN!, raceId, true, before(70))).toMatchObject({ changed: true, fromStart: true });
    await db.insert(eventEliteEntries).values({ eventId: raceId, name: "Andrei Elitu", bibNumber: 7 });
    await trialRun();
    const eventBefore = await eventRow();
    const registrationsBefore = await db.select().from(registrations).where(eq(registrations.eventId, raceId)).orderBy(registrations.bibNumber);
    const elitesBefore = await db.select().from(eventEliteEntries).where(eq(eventEliteEntries.eventId, raceId));
    expect(eventBefore.raceGunAt).toEqual(TRIAL_GUN);
    revalidate.mockClear();

    expect(await reset(staff.ADMIN!, before(50))).toEqual({ changed: true, deleted: 4, gunCleared: true });

    expect(await stored()).toEqual([]);
    const eventAfter = await eventRow();
    expect(eventAfter).toMatchObject({ raceGunAt: null, raceGunByStaffUserId: null });
    // Nothing else of the event moved: the awards, the age bands, «Clasament public» and its moment, the version, the times.
    const kept = (event: typeof eventBefore) => Object.fromEntries(Object.entries(event).filter(([column]) => column !== "raceGunAt" && column !== "raceGunByStaffUserId"));
    expect(kept(eventAfter)).toEqual(kept(eventBefore));
    expect(eventAfter).toMatchObject({ awardPlaces: 5, awardCategories: false, resultAgeBands: [18, 35, 50], resultsPublished: true });
    // The registrations, their numbers and their check-ins, and the elite list with its number: as they were.
    expect(await db.select().from(registrations).where(eq(registrations.eventId, raceId)).orderBy(registrations.bibNumber)).toEqual(registrationsBefore);
    expect(await db.select().from(eventEliteEntries).where(eq(eventEliteEntries.eventId, raceId))).toEqual(elitesBefore);

    // One audit row: who, the counts — never a name, a number or a time.
    const rows = await resets();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorStaffUserId: staff.ADMIN!.id, entityType: "event", entityId: raceId, metadataJson: { results: 4, gunCleared: true } });
    expect(rows[0].createdAt).toEqual(before(50));
    expect(JSON.stringify(rows[0].metadataJson)).not.toMatch(/Popescu|Vasile|Marin|101|900/);
    expect(revalidate).toHaveBeenCalledTimes(1);

    // The pages read nothing back: «Clasament» counts no result, «Cronometrare» counts from the plan again, and from the start the
    // public read — the tick still on — has no row to show.
    const view = await readEventResults(db, staff.ADMIN!, raceId);
    expect(view.counts).toEqual({ FINISHED: 0, DNF: 0, DNS: 0, DSQ: 0 });
    expect(view.registered.map((runner) => [runner.bibNumber, runner.result, runner.checkedIn])).toEqual([
      [101, null, true],
      [103, null, true],
      [102, null, false],
    ]);
    expect(view.typed).toEqual([]);
    const timing = await readFinishLine(db, staff.CONTRIBUTOR!, raceId, before(49), 20);
    expect(timing.gun).toMatchObject({ at: PLANNED, pressed: false, byName: null, fixed: false });
    expect(timing.recent).toEqual([]);
    expect(timing.finished).toBe(0);
    const shown = await readPublicEventResults(db, raceId, { now: AFTER_THE_RACE, deadlines: DEFAULT_DEADLINES, noticeDescribes: true, termsDescribe: true, firstResultsNoticeVersion: 1, firstResultsNameAskNoticeVersion: null });
    expect(shown?.rows).toEqual([]);
  });

  it("is the Superadministrator's too, and a reset that finds nothing writes and records nothing", async () => {
    await trialRun();
    expect(await reset(staff.SUPERADMIN!, before(50))).toEqual({ changed: true, deleted: 4, gunCleared: true });
    revalidate.mockClear();
    expect(await reset(staff.ADMIN!, before(49), { results: 0, gun: null })).toEqual({ changed: false, deleted: 0, gunCleared: false });
    expect(await resets()).toHaveLength(1);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("wipes the results alone when no «Start» was given, and the gun alone when nothing was entered", async () => {
    await saveEventResults(db, staff.ADMIN!, { eventId: raceId, rows: [line(101, { status: "DNS" })] }, before(65));
    expect(await reset(staff.ADMIN!, before(50), { results: 1, gun: null })).toEqual({ changed: true, deleted: 1, gunCleared: false });
    await setRaceGun(db, staff.ADMIN!, { eventId: raceId, clear: false }, before(45));
    expect(await reset(staff.ADMIN!, before(40), { results: 0, gun: before(45).getTime() })).toEqual({ changed: true, deleted: 0, gunCleared: true });
    expect((await resets()).map((row) => row.metadataJson)).toEqual(expect.arrayContaining([{ results: 1, gunCleared: false }, { results: 0, gunCleared: true }]));
    expect(await eventRow()).toMatchObject({ raceGunAt: null });
  });

  it("refuses every role but the Administrators, whatever the page drew, and writes nothing", async () => {
    await trialRun();
    for (const role of ["MODERATOR", "DEV", "CONTRIBUTOR", "COPYWRITER", "MEMBER"] as const) {
      await expect(reset(staff[role]!, before(50))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await stored()).toHaveLength(4);
    expect(await eventRow()).toMatchObject({ raceGunAt: TRIAL_GUN });
    expect(await resets()).toEqual([]);
  });

  it("refuses an event that is not a race, and an id that is no event", async () => {
    const groupRun = await createRace(db, { type: "GROUP_RUN" });
    await expect(resetEventResults(db, staff.ADMIN!, { eventId: groupRun.id, seenResults: 0, seenGunAtMs: null }, before(50))).rejects.toMatchObject({ code: "RESULTS_NOT_OPEN" });
    await expect(resetEventResults(db, staff.ADMIN!, { eventId: "not-an-id", seenResults: 0 }, before(50))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(resetEventResults(db, staff.ADMIN!, { eventId: "00000000-0000-4000-8000-000000000000", seenResults: 0 }, before(50))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is open until the planned gun — a test «Start» an hour before does not close it — and refused at it and after", async () => {
    await trialRun();
    // The trial's «Start» moved the line's gun an hour earlier; the plan still says 09:00, so a minute before it the reset is open.
    expect((await reset(staff.ADMIN!, before(1))).changed).toBe(true);
    await setRaceGun(db, staff.ADMIN!, { eventId: raceId, clear: false }, before(0, -30));
    await expect(reset(staff.ADMIN!, PLANNED, { results: 0, gun: before(0, -30).getTime() })).rejects.toMatchObject({ code: "RESULTS_RESET_AFTER_START" });
    await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 101 }, new Date(PLANNED.getTime() + 20 * 60_000));
    await expect(reset(staff.ADMIN!, new Date(PLANNED.getTime() + 21 * 60_000), { results: 1, gun: before(0, -30).getTime() })).rejects.toMatchObject({ code: "RESULTS_RESET_AFTER_START" });
    expect(await stored()).toHaveLength(1);
    expect(await resets()).toHaveLength(1);
  });

  it("counts from the race's own start when it has one: the gathering's hour passing does not close it", async () => {
    const raceStartsAt = new Date(PLANNED.getTime() + 60 * 60_000);
    await db.update(events).set({ raceStartsAt }).where(eq(events.id, raceId));
    await saveEventResults(db, staff.ADMIN!, { eventId: raceId, rows: [line(101, { status: "DNS" })] }, before(65));
    // Half an hour after the gathering, half an hour before the gun: open.
    expect((await reset(staff.ADMIN!, new Date(PLANNED.getTime() + 30 * 60_000), { results: 1, gun: null })).deleted).toBe(1);
    await expect(reset(staff.ADMIN!, raceStartsAt, { results: 0, gun: null })).rejects.toMatchObject({ code: "RESULTS_RESET_AFTER_START" });
  });

  it("refuses with CONFLICT a page that drew another count or another gun: nothing wiped", async () => {
    await trialRun();
    revalidate.mockClear();
    // The page was drawn before the last finish arrived: three results, not four.
    await expect(reset(staff.ADMIN!, before(50), { results: 3 })).rejects.toMatchObject({ code: "CONFLICT" });
    // …or before the trial's «Start»: no gun, where one stands now.
    await expect(reset(staff.ADMIN!, before(50), { gun: null })).rejects.toMatchObject({ code: "CONFLICT" });
    // …or a count that is no count.
    await expect(reset(staff.ADMIN!, before(50), { results: Number.NaN })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await stored()).toHaveLength(4);
    expect(await eventRow()).toMatchObject({ raceGunAt: TRIAL_GUN });
    expect(await resets()).toEqual([]);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("leaves another race's results and gun as they were", async () => {
    const other = await createRace(db);
    await registerRunner(db, other.id, { name: "Eli Vasile", bibNumber: 101, sex: "MALE", birthDate: "1990-01-01" });
    await setRaceGun(db, staff.ADMIN!, { eventId: other.id, clear: false }, before(62));
    await saveEventResults(db, staff.ADMIN!, { eventId: other.id, rows: [line(101, { status: "DNF", note: "altă cursă" })] }, before(61));
    const otherBefore = { rows: await stored(other.id), event: await eventRow(other.id) };
    await trialRun();
    await reset(staff.ADMIN!, before(50));
    expect(await stored(other.id)).toEqual(otherBefore.rows);
    expect(await eventRow(other.id)).toEqual(otherBefore.event);
  });

  it("is a line of «Istoricul sosirilor», newest first, saying how many results went and that the start went with them", async () => {
    await trialRun();
    await reset(staff.ADMIN!, before(50));
    const history = await readFinishHistory(db, staff.ADMIN!, raceId);
    expect(history.lines[0]).toMatchObject({ who: "Ana Admin", where: "results", what: { kind: "reset", results: 4, gunCleared: true }, liveName: null });
    // The writes before it stay in the trail: the reset says why none of them has a row any more.
    expect(history.lines.length).toBeGreaterThan(1);
  });
});

describe("§997 «Cronometrare» after a reset — a press made before it never brings a test finish back", () => {
  it("refuses a press a phone kept from before the reset — even with a new «Start» given right before it reached the server", async () => {
    await trialRun();
    await reset(staff.ADMIN!, before(50));
    // An organizer's new «Start», tapped five seconds before the reset and heard a second after it: the gun stands before the reset.
    await setRaceGun(db, staff.ADMIN!, { eventId: raceId, clear: false, claimedAtMs: before(50, -5).getTime() }, before(50, 1));
    expect((await eventRow()).raceGunAt).toEqual(before(50, -5));
    // A volunteer's press of the trial, made three seconds before the reset on a phone without signal, sent a minute later: its moment
    // is after that gun, so without the reset it would be a finisher — it is refused, and nothing is written.
    await expect(recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 102, claimedAtMs: before(50, -3).getTime() }, before(49))).rejects.toMatchObject({
      code: "RESULT_PRESS_BEFORE_RESET",
    });
    expect(await stored()).toEqual([]);
    // A press made after the reset is a press: recorded with its own time since the new gun.
    expect(await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 101, claimedAtMs: before(49, 30).getTime() }, before(49, 31))).toMatchObject({ kind: "recorded", bibNumber: 101 });
    expect((await stored()).map((row) => row.bibNumber)).toEqual([101]);
  });

  it("refuses the retry of a press the trial recorded, sent again after the reset, with the reset's reason", async () => {
    await setRaceGun(db, staff.ADMIN!, { eventId: raceId, clear: false }, TRIAL_GUN);
    const pressId = "5b8f6c1e-2d3a-4f5b-9c7d-0e1f2a3b4c5d";
    const pressedAt = before(58);
    expect(await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 101, claimedAtMs: pressedAt.getTime(), pressId }, pressedAt)).toMatchObject({ kind: "recorded" });
    await resetEventResults(db, staff.ADMIN!, { eventId: raceId, seenResults: 1, seenGunAtMs: TRIAL_GUN.getTime() }, before(50));
    // The answer was lost on the way; the phone sends the same press again once the signal is back.
    await expect(recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 101, claimedAtMs: pressedAt.getTime(), pressId }, before(49))).rejects.toMatchObject({ code: "RESULT_PRESS_BEFORE_RESET" });
    expect(await stored()).toEqual([]);
  });

  it("refuses an old press after the planned gun too, while the race's own presses are recorded", async () => {
    await trialRun();
    await reset(staff.ADMIN!, before(50));
    const raceMinute = new Date(PLANNED.getTime() + 25 * 60_000);
    await expect(recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 101, claimedAtMs: before(55).getTime() }, raceMinute)).rejects.toMatchObject({ code: "RESULT_PRESS_BEFORE_RESET" });
    expect(await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 101, claimedAtMs: raceMinute.getTime() }, raceMinute)).toMatchObject({ kind: "recorded", gunTimeMs: 25 * 60_000 });
    // A press with no moment of its own — the plain form, scripts off — is the server's now, after the reset: no reset check stops it.
    expect(await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 102 }, new Date(raceMinute.getTime() + 60_000))).toMatchObject({ kind: "recorded", gunTimeMs: 26 * 60_000 });
    // Nor does one claiming a moment not yet come — past any date a clock can hold, even: the server's own time, as for a fast phone.
    expect(await recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: 103, claimedAtMs: 9e15 }, new Date(raceMinute.getTime() + 120_000))).toMatchObject({ kind: "recorded", gunTimeMs: 27 * 60_000 });
  });
});
