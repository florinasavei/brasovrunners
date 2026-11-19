import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventResults } from "@/db/schema/event-results";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { FINISH_ARRIVAL_GRACE_MS, FINISH_UNDO_WINDOW_MS, FINISH_WINDOW_MS } from "@/modules/results/domain/finish-line";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace, person, RACE_STARTS_AT, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §850, §986 — the finish line, «Cronometrare» (BR-REQ-050-02, BR-REQ-060-01): `recordFinish` stamps the time since the gun — the
 * claimed press within the server's bounds, a claim before the gun refused, the server's own time for a claim ahead of it, nothing a
 * day and three hours after the gun — on a confirmed runner's number or an elite line's, re-ranks, audits without a name and refuses
 * what «Clasament» must handle; every role that works the desk may press, a member may not; the same number twice keeps the first and
 * writes the second to the trail, a retry — known by the press's own id, else guessed — is no duplicate and writes nothing, and a
 * decision of «Clasament» — «Descalificat», or a write-off later than the moment pressed — stays; `undoFinish` takes back one's own
 * press at the line, unchanged and not pressed again, for ten minutes; `setRaceGun` is «Start», pressed, moved and taken off until the
 * first finisher, within its window, the organizer's own press sent twice changing nothing and a press whose page saw another gun
 * moving nothing; `readFinishGun` is the clock's question's gun; `readFinishLine` is the page's data; `readFinishHistory` is
 * «Istoricul sosirilor» with who wrote each line.
 */
const revalidate = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()), revalidatePublicContent: revalidate }));

const { FinishError, gunOf, readEventResults, readFinishGun, readFinishLine, recordFinish, saveEventResults, setRaceGun, undoFinish } = await import("@/modules/results/results");
const { readFinishHistory } = await import("@/modules/results/finish-history");

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
const GUN = RACE_STARTS_AT;
const at = (minutes: number, seconds = 0) => new Date(GUN.getTime() + minutes * 60_000 + seconds * 1000);
const ms = (minutes: number, seconds = 0) => minutes * 60_000 + seconds * 1000;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  revalidate.mockClear();
  for (const [role, name] of [["ADMIN", "Ana Admin"], ["MODERATOR", "Oana Organizator"], ["DEV", "Tudor Tehnic"], ["CONTRIBUTOR", "Vlad Voluntar"], ["COPYWRITER", "Radu Redactor"], ["MEMBER", "Membru Club"]] as const) staff[role] = await person(db, role, name);
  raceId = (await createRace(db)).id;
  await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01" });
  await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, sex: "FEMALE", birthDate: "1985-03-10" });
  await registerRunner(db, raceId, { name: "Dan Ionescu", bibNumber: 103, sex: "MALE", birthDate: "1996-11-21" });
});

const finish = (bib: number, now: Date, actor: StaffUser = staff.CONTRIBUTOR!, claimedAt?: Date) =>
  recordFinish(db, actor, { eventId: raceId, bibNumber: bib, claimedAtMs: claimedAt?.getTime() ?? null }, now);
const stored = () => db.select().from(eventResults).where(eq(eventResults.eventId, raceId)).orderBy(eventResults.bibNumber);
const trail = async () => (await db.select().from(auditLogs).where(eq(auditLogs.entityId, raceId)).orderBy(auditLogs.createdAt, auditLogs.id)).filter((row) => row.action.startsWith("event_result.") || row.action.startsWith("event.race_gun"));

/** A line of the race's elite list, as the Administrator typed it (§895, §975). */
async function eliteLine(name: string, bibNumber: number | null, over: Partial<typeof eventEliteEntries.$inferInsert> = {}) {
  const [line] = await db.insert(eventEliteEntries).values({ eventId: raceId, name, bibNumber, ...over }).returning();
  return line;
}

describe("§850 §986 recordFinish — the time since the gun, stamped", () => {
  it("writes «Sosit» with the time since the gun, ranks, audits the number and the times and never a name, and tells the public cache", async () => {
    const first = await finish(102, at(45, 12));
    expect(first).toMatchObject({ kind: "recorded", bibNumber: 102, name: "Bia Marin", label: null, gunTimeMs: ms(45, 12), positionOverall: 1, outOfRanking: false, again: false });
    const second = await finish(101, at(50));
    expect(second).toMatchObject({ kind: "recorded", bibNumber: 101, gunTimeMs: ms(50), positionOverall: 2 });
    expect((await stored()).map((row) => [row.bibNumber, row.status, row.gunTimeMs, row.positionOverall, row.positionSex, row.categoryKey, row.updatedByStaffUserId])).toEqual([
      [101, "FINISHED", 3_000_000, 2, 2, "FEMALE:from30", staff.CONTRIBUTOR!.id],
      [102, "FINISHED", 2_712_000, 1, 1, "FEMALE:from40", staff.CONTRIBUTOR!.id],
    ]);
    const rows = await trail();
    expect(rows.map((row) => row.action)).toEqual(["event_result.created", "event_result.created"]);
    // The row's id beside the times: the undo's proof the line wrote it.
    const row102 = (await stored()).find((row) => row.bibNumber === 102)!;
    expect(rows[0].metadataJson).toEqual({ bibNumber: 102, status: "FINISHED", gunTimeMs: 2_712_000, chipTimeMs: null, finishLine: true, resultId: row102.id });
    expect(rows[0].actorStaffUserId).toBe(staff.CONTRIBUTOR!.id);
    expect(JSON.stringify(rows.map((row) => row.metadataJson))).not.toContain("Marin");
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it("counts from «Start» when pressed, else the race's own start, else the event's", async () => {
    expect(gunOf({ startsAt: GUN, raceStartsAt: null })).toEqual(GUN);
    const later = new Date(GUN.getTime() + 3_600_000);
    expect(gunOf({ startsAt: GUN, raceStartsAt: later })).toEqual(later);
    const pressed = new Date(later.getTime() + 2 * 60_000 + 3_000);
    expect(gunOf({ startsAt: GUN, raceStartsAt: later, raceGunAt: pressed })).toEqual(pressed);
    const withGun = await createRace(db, { raceStartsAt: later });
    await registerRunner(db, withGun.id, { name: "Eli Vasile", bibNumber: 7, sex: "MALE", birthDate: "1990-01-01" });
    // Fifty minutes after the gathering is ten minutes before the gun: refused; thirty minutes after the gun is a 30:00.
    await expect(recordFinish(db, staff.ADMIN!, { eventId: withGun.id, bibNumber: 7 }, at(50))).rejects.toMatchObject({ code: "RESULT_FINISH_NOT_STARTED" });
    expect(await recordFinish(db, staff.ADMIN!, { eventId: withGun.id, bibNumber: 7 }, new Date(later.getTime() + 30 * 60_000))).toMatchObject({ gunTimeMs: 30 * 60_000 });
  });

  it("refuses an unknown or unconfirmed number carrying the stamped time, a press before the gun, a day after it, and a number that is no number", async () => {
    const unknown = await finish(900, at(42, 13)).catch((error: unknown) => error);
    expect(unknown).toBeInstanceOf(FinishError);
    expect(unknown).toMatchObject({ code: "RESULT_BIB_UNKNOWN", bibNumber: 900, gunTimeMs: ms(42, 13), fields: ["bib"] });
    await registerRunner(db, raceId, { name: "Cancelled Runner", bibNumber: 104, sex: "MALE", birthDate: "1990-01-01", status: "CANCELLED" });
    await expect(finish(104, at(43))).rejects.toMatchObject({ code: "RESULT_BIB_UNKNOWN", bibNumber: 104 });
    await expect(finish(101, new Date(GUN.getTime() - 1000))).rejects.toMatchObject({ code: "RESULT_FINISH_NOT_STARTED" });
    await expect(finish(101, GUN)).rejects.toMatchObject({ code: "RESULT_FINISH_NOT_STARTED" });
    await expect(finish(0, at(1))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // A day after the gun the line is closed: the times are «Clasament»'s to type, and a 25-hour time would not fit the column anyway.
    await expect(finish(103, new Date(GUN.getTime() + 25 * 3_600_000))).rejects.toMatchObject({ code: "RESULT_FINISH_CLOSED" });
    // A queued press claiming a moment of the race is still taken a few hours after the day — and refused after that, whatever it claims.
    await expect(finish(103, new Date(GUN.getTime() + FINISH_WINDOW_MS + FINISH_ARRIVAL_GRACE_MS + 1000), staff.CONTRIBUTOR, at(12, 3))).rejects.toMatchObject({ code: "RESULT_FINISH_CLOSED" });
    await expect(finish(103, new Date(GUN.getTime() + 30 * 24 * 3_600_000), staff.CONTRIBUTOR, at(12, 3))).rejects.toMatchObject({ code: "RESULT_FINISH_CLOSED" });
    // Stamped to the second: the half second of the press is dropped.
    expect(await finish(103, new Date(at(40, 7).getTime() + 500))).toMatchObject({ gunTimeMs: ms(40, 7) });
    expect((await stored()).map((row) => row.bibNumber)).toEqual([103]);
  });

  it("turns a runner written off by mistake into «Sosit» at the stamped time, keeping the note, and audits the change", async () => {
    await saveEventResults(db, staff.ADMIN!, { eventId: raceId, rows: [{ key: "r[101]", bib: "101", name: "", sex: "", birthDate: "", time: "", status: "DNF", chip: "", note: "a renunțat la km 5", agreed: "" }] }, at(30));
    expect(await finish(101, at(55))).toMatchObject({ kind: "recorded", bibNumber: 101, gunTimeMs: ms(55), positionOverall: 1 });
    const [row] = await stored();
    expect(row).toMatchObject({ bibNumber: 101, status: "FINISHED", gunTimeMs: ms(55), note: "a renunțat la km 5" });
    expect((await trail()).at(-1)).toMatchObject({ action: "event_result.updated", metadataJson: { bibNumber: 101, status: "FINISHED", gunTimeMs: ms(55), chipTimeMs: null, changed: ["time", "status"], finishLine: true, resultId: row.id } });
  });

  it("never turns «Descalificat» into «Sosit» at the line: the row stays, the press's time goes to the trail beside it", async () => {
    await finish(101, at(40), staff.CONTRIBUTOR);
    await saveEventResults(db, staff.MODERATOR!, { eventId: raceId, rows: [{ key: "r[101]", bib: "101", name: "", sex: "", birthDate: "", time: "", status: "DSQ", chip: "", note: "a tăiat traseul", agreed: "" }] }, at(50));
    const [before] = await stored();
    // A Redactor's press claimed at 40:02 — queued on a phone without signal, or a second volunteer — arriving at 55:00.
    const late = await finish(101, at(55), staff.COPYWRITER, at(40, 2));
    expect(late).toMatchObject({ kind: "duplicate", bibNumber: 101, gunTimeMs: ms(40, 2), storedStatus: "DSQ", storedGunTimeMs: null, storedBy: "Oana Organizator" });
    // A fresh press of the disqualified runner crossing the line is no different.
    expect(await finish(101, at(56), staff.CONTRIBUTOR)).toMatchObject({ kind: "duplicate", storedStatus: "DSQ", gunTimeMs: ms(56) });
    expect(await stored()).toEqual([before]);
    expect(before).toMatchObject({ status: "DSQ", gunTimeMs: null, note: "a tăiat traseul", positionOverall: null });
    expect((await trail()).filter((row) => row.action === "event_result.finish_duplicate").map((row) => [row.actorStaffUserId, row.metadataJson])).toEqual([
      [staff.COPYWRITER!.id, { bibNumber: 101, gunTimeMs: ms(40, 2), storedGunTimeMs: null, storedStatus: "DSQ", storedResultId: before.id, finishLine: true }],
      [staff.CONTRIBUTOR!.id, { bibNumber: 101, gunTimeMs: ms(56), storedGunTimeMs: null, storedStatus: "DSQ", storedResultId: before.id, finishLine: true }],
    ]);
  });

  it("leaves an «Abandon» or a «Neprezentat» written after the moment pressed: a queued press never overwrites a later decision", async () => {
    await saveEventResults(
      db,
      staff.MODERATOR!,
      {
        eventId: raceId,
        rows: [
          { key: "r[101]", bib: "101", name: "", sex: "", birthDate: "", time: "", status: "DNF", chip: "", note: "", agreed: "" },
          { key: "r[102]", bib: "102", name: "", sex: "", birthDate: "", time: "", status: "DNS", chip: "", note: "", agreed: "" },
        ],
      },
      at(50),
    );
    const before = await stored();
    expect(await finish(101, at(55), staff.CONTRIBUTOR, at(45))).toMatchObject({ kind: "duplicate", storedStatus: "DNF", gunTimeMs: ms(45) });
    expect(await finish(102, at(55), staff.CONTRIBUTOR, at(49, 59))).toMatchObject({ kind: "duplicate", storedStatus: "DNS" });
    expect(await stored()).toEqual(before);
    // Pressed after the decision, the runner crossed the line: turned «Sosit», as a runner written off by mistake.
    expect(await finish(101, at(55, 30), staff.CONTRIBUTOR, at(55))).toMatchObject({ kind: "recorded", gunTimeMs: ms(55) });
    expect((await stored()).map((row) => [row.bibNumber, row.status])).toEqual([
      [101, "FINISHED"],
      [102, "DNS"],
    ]);
  });

  it("is open to every role that works the desk — the desk Volunteer included — and refused to a member, and on an event that is not a race", async () => {
    for (const [role, bib] of [["CONTRIBUTOR", 101], ["COPYWRITER", 102], ["DEV", 103]] as const) await expect(finish(bib, at(40), staff[role]), role).resolves.toMatchObject({ kind: "recorded", bibNumber: bib });
    await expect(finish(101, at(41), staff.MEMBER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const run = await createRace(db, { type: "GROUP_RUN" });
    await expect(recordFinish(db, staff.ADMIN!, { eventId: run.id, bibNumber: 1 }, at(40))).rejects.toMatchObject({ code: "RESULTS_NOT_OPEN" });
    await expect(recordFinish(db, staff.ADMIN!, { eventId: "not-an-id", bibNumber: 1 }, at(40))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(readFinishLine(db, staff.MEMBER!, raceId, at(40), 5)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(readFinishLine(db, staff.CONTRIBUTOR!, raceId, at(40), 5)).resolves.toMatchObject({ finished: 3 });
  });
});

describe("§986 the claimed time: the moment pressed, within the server's bounds", () => {
  it("stamps a queued press with the moment it was pressed, not the moment it arrived", async () => {
    expect(await finish(101, at(50), staff.CONTRIBUTOR, at(45, 12))).toMatchObject({ gunTimeMs: ms(45, 12) });
    // Five seconds ahead of the server is a phone's clock, taken; six is a runner not yet arrived: the server's own.
    expect(await finish(102, at(50), staff.CONTRIBUTOR, at(50, 5))).toMatchObject({ gunTimeMs: ms(50, 5) });
    expect(await finish(103, at(50), staff.CONTRIBUTOR, at(50, 6))).toMatchObject({ gunTimeMs: ms(50) });
  });

  it("refuses a claim before the gun — or in its first second — as not started, never stamping its arrival, and leaves the gun free", async () => {
    // A press queued on a phone before the gun, arriving fifty minutes into the race: no finisher made up at 50:00.
    await expect(finish(101, at(50), staff.CONTRIBUTOR, new Date(GUN.getTime() - 60_000))).rejects.toMatchObject({ code: "RESULT_FINISH_NOT_STARTED" });
    await expect(finish(102, at(50), staff.CONTRIBUTOR, new Date(GUN.getTime() + 400))).rejects.toMatchObject({ code: "RESULT_FINISH_NOT_STARTED" });
    expect(await stored()).toEqual([]);
    expect(await trail()).toEqual([]);
    // Nothing fixed the gun: «Start» still moves it.
    expect(await setRaceGun(db, staff.MODERATOR!, { eventId: raceId, clear: false }, at(50, 30))).toMatchObject({ changed: true });
  });
});

describe("§986 the same number twice: the first stored wins", () => {
  it("answers a retry of a saved press — the same volunteer, the same second — as saved, writing nothing", async () => {
    await finish(101, at(45, 20), staff.CONTRIBUTOR, at(45, 12));
    const [before] = await stored();
    revalidate.mockClear();
    const retry = await finish(101, at(46), staff.CONTRIBUTOR, at(45, 12));
    expect(retry).toMatchObject({ kind: "recorded", bibNumber: 101, gunTimeMs: ms(45, 12), again: true, positionOverall: 1 });
    expect(await stored()).toEqual([before]);
    expect((await trail()).map((row) => row.action)).toEqual(["event_result.created"]);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("keeps the first row untouched and writes another volunteer's press — or the same one's another second — to the trail with both times", async () => {
    await finish(101, at(45, 20), staff.CONTRIBUTOR, at(45, 12));
    const [before] = await stored();
    const other = await finish(101, at(45, 30), staff.MODERATOR, at(45, 14));
    expect(other).toMatchObject({ kind: "duplicate", bibNumber: 101, name: "Ana Popescu", gunTimeMs: ms(45, 14), storedGunTimeMs: ms(45, 12), storedBy: "Vlad Voluntar" });
    const later = await finish(101, at(46), staff.CONTRIBUTOR, at(45, 59));
    expect(later).toMatchObject({ kind: "duplicate", gunTimeMs: ms(45, 59), storedGunTimeMs: ms(45, 12), storedBy: "Vlad Voluntar" });
    expect(await stored()).toEqual([before]);
    const rows = await trail();
    expect(rows.map((row) => [row.action, row.actorStaffUserId])).toEqual([
      ["event_result.created", staff.CONTRIBUTOR!.id],
      ["event_result.finish_duplicate", staff.MODERATOR!.id],
      ["event_result.finish_duplicate", staff.CONTRIBUTOR!.id],
    ]);
    expect(rows[1].metadataJson).toEqual({ bibNumber: 101, gunTimeMs: ms(45, 14), storedGunTimeMs: ms(45, 12), storedStatus: "FINISHED", storedResultId: before.id, finishLine: true });
  });

  it("answers a retry carrying the press's own id from the trail, exactly as it was answered — a «Sosit» or a number found — writing nothing", async () => {
    const pressId = "4a7e0c1d-2b3f-4c5d-8e9f-0a1b2c3d4e5f";
    const press = (actor: StaffUser, id: string, claimedAt: Date, now: Date) => recordFinish(db, actor, { eventId: raceId, bibNumber: 101, claimedAtMs: claimedAt.getTime(), pressId: id }, now);
    // A phone six seconds ahead: its claim of 45:26 refused at 45:20, the server's own time stamped.
    expect(await press(staff.CONTRIBUTOR!, pressId, at(45, 26), at(45, 20))).toMatchObject({ kind: "recorded", gunTimeMs: ms(45, 20), again: false });
    const [before] = await stored();
    expect((await trail())[0].metadataJson).toEqual({ bibNumber: 101, status: "FINISHED", gunTimeMs: ms(45, 20), chipTimeMs: null, finishLine: true, resultId: before.id, pressId });
    revalidate.mockClear();
    // The answer lost, the phone sends the same press two seconds later — its claim now within bounds, another second: the same press.
    expect(await press(staff.CONTRIBUTOR!, pressId, at(45, 26), at(45, 22))).toMatchObject({ kind: "recorded", resultId: before.id, gunTimeMs: ms(45, 20), positionOverall: 1, again: true });
    // …and still the press it was after the day and its grace.
    expect(await press(staff.CONTRIBUTOR!, pressId, at(45, 26), new Date(GUN.getTime() + FINISH_WINDOW_MS + FINISH_ARRIVAL_GRACE_MS + 60_000))).toMatchObject({ kind: "recorded", again: true });
    expect(await stored()).toEqual([before]);
    expect(revalidate).not.toHaveBeenCalled();
    // Another volunteer's press of 101: a duplicate, its id in the trail; its retry is answered as that duplicate, no second row.
    const otherId = "9c8b7a6d-5e4f-4d3c-9b2a-1f0e9d8c7b6a";
    const duplicate = await press(staff.MODERATOR!, otherId, at(45, 21), at(45, 25));
    expect(duplicate).toMatchObject({ kind: "duplicate", gunTimeMs: ms(45, 21), storedGunTimeMs: ms(45, 20), storedStatus: "FINISHED", storedBy: "Vlad Voluntar" });
    expect(await press(staff.MODERATOR!, otherId, at(45, 21), at(45, 31))).toEqual(duplicate);
    // A second press of the volunteer's own, with an id of its own at the very second stored: no guess — the trail said it is another press.
    expect(await press(staff.CONTRIBUTOR!, "1b2c3d4e-5f60-4718-a9b0-c1d2e3f4a5b6", at(45, 20), at(45, 40))).toMatchObject({ kind: "duplicate", storedBy: "Vlad Voluntar" });
    const rows = await trail();
    expect(rows.map((row) => [row.action, (row.metadataJson as { pressId?: string }).pressId])).toEqual([
      ["event_result.created", pressId],
      ["event_result.finish_duplicate", otherId],
      ["event_result.finish_duplicate", "1b2c3d4e-5f60-4718-a9b0-c1d2e3f4a5b6"],
    ]);
    // «Istoricul sosirilor» shows each press once.
    expect((await readFinishHistory(db, staff.ADMIN!, raceId)).lines.map((line) => line.what.kind)).toEqual(["duplicate", "duplicate", "finish"]);
    // An id another account used is not this one's press: the Organizer's retry is answered, the volunteer sending that id is not.
    expect(await press(staff.CONTRIBUTOR!, otherId, at(45, 21), at(45, 50))).toMatchObject({ kind: "duplicate", gunTimeMs: ms(45, 21) });
    expect((await trail()).filter((row) => row.action === "event_result.finish_duplicate")).toHaveLength(3);
  });

  it("refuses a retry whose row is gone since — undone at the line, or deleted on «Clasament» —, never recording it again (§986)", async () => {
    const pressId = "5d6e7f80-91a2-4b3c-8d4e-5f6071829304";
    const press = (id: string, bib: number, claimedAt: Date, now: Date) => recordFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, bibNumber: bib, claimedAtMs: claimedAt.getTime(), pressId: id }, now);
    expect(await press(pressId, 101, at(40), at(40, 1))).toMatchObject({ kind: "recorded", again: false });
    const [row] = await stored();
    await undoFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, resultId: row.id }, at(41));
    revalidate.mockClear();
    const before = await trail();
    // The answer to the first send was lost; the phone sends it again after the undo: told it was undone since, nothing written.
    await expect(press(pressId, 101, at(40), at(42))).rejects.toMatchObject({ code: "RESULT_PRESS_UNDONE" });
    expect(await stored()).toEqual([]);
    expect(await trail()).toEqual(before);
    expect(revalidate).not.toHaveBeenCalled();
    // A press deleted on «Clasament» since, the same.
    const otherId = "6e7f8091-a2b3-4c4d-9e5f-607182930415";
    expect(await press(otherId, 102, at(43), at(43, 1))).toMatchObject({ kind: "recorded", again: false });
    const [second] = await stored();
    await db.delete(eventResults).where(eq(eventResults.id, second.id));
    await expect(press(otherId, 102, at(43), at(44))).rejects.toMatchObject({ code: "RESULT_PRESS_UNDONE" });
    expect(await stored()).toEqual([]);
  });

  it("says «cont șters» — no name — for a stored row whose account is gone", async () => {
    const [gone] = await db.insert(staffUsers).values({ email: "gone@example.test", displayName: "Fost Voluntar", role: "CONTRIBUTOR" }).returning();
    await finish(102, at(44), gone);
    await db.delete(staffUsers).where(eq(staffUsers.id, gone.id));
    expect(await finish(102, at(45), staff.CONTRIBUTOR)).toMatchObject({ kind: "duplicate", storedBy: null, storedGunTimeMs: ms(44) });
  });
});

describe("§986 an elite at the line", () => {
  it("records a line of the race's elite list as a typed row with the line's name and number, nothing else of a person", async () => {
    await eliteLine("Andrei Munteanu", 7, { bibLabel: "Andrei M." });
    const recorded = await finish(7, at(31, 5));
    expect(recorded).toMatchObject({ kind: "recorded", bibNumber: 7, name: "Andrei Munteanu", label: "Andrei M.", gunTimeMs: ms(31, 5), positionOverall: 1, outOfRanking: false });
    const [row] = await stored();
    expect(row).toMatchObject({ bibNumber: 7, registrationId: null, displayName: "Andrei Munteanu", sex: null, birthDate: null, nameAgreedAt: null, nameAgreedByStaffUserId: null, status: "FINISHED" });
    // «Clasament» draws it as a typed runner, the same row.
    const view = await readEventResults(db, staff.ADMIN!, raceId);
    expect(view.typed.map((runner) => [runner.bibNumber, runner.name, runner.result?.status])).toEqual([[7, "Andrei Munteanu", "FINISHED"]]);
  });

  it("runs a line left out of the ranking hors concours (rule 3): no place, and nobody else's moves", async () => {
    await eliteLine("Ion Rapid", 8, { inResults: false });
    expect(await finish(8, at(29))).toMatchObject({ kind: "recorded", positionOverall: null, outOfRanking: true });
    expect(await finish(101, at(40))).toMatchObject({ positionOverall: 1 });
    const rows = await stored();
    expect(rows.map((row) => [row.bibNumber, row.positionOverall])).toEqual([
      [8, null],
      [101, 1],
    ]);
  });

  it("says a registration marked «Elită» by its label, and draws the elites' buttons by label, the numberless disabled", async () => {
    const elite = await registerRunner(db, raceId, { name: "Silviu Dobre", bibNumber: 110, sex: "MALE", birthDate: "1992-01-01" });
    await db.update(registrations).set({ elite: true, firstName: "Silviu" }).where(eq(registrations.id, elite.id));
    const unnumbered = await registerRunner(db, raceId, { name: "Paul Stan", bibNumber: null, sex: "MALE", birthDate: "1990-01-01" });
    await db.update(registrations).set({ elite: true, firstName: "Paul" }).where(eq(registrations.id, unnumbered.id));
    await eliteLine("Ana Lungu", 9);
    await eliteLine("Ștefan Iordache", null);
    expect(await finish(110, at(28))).toMatchObject({ label: "Silviu", name: "Silviu Dobre" });
    const view = await readFinishLine(db, staff.CONTRIBUTOR!, raceId, at(29), 20);
    expect(view.elites.map((button) => [button.label, button.name, button.bibNumber, button.kind, button.finishedGunTimeMs])).toEqual([
      ["Ana", "Ana Lungu", 9, "line", null],
      ["Paul", "Paul Stan", null, "registration", null],
      ["Silviu", "Silviu Dobre", 110, "registration", ms(28)],
      ["Ștefan", "Ștefan Iordache", null, "line", null],
    ]);
  });

  it("draws a line numbered by «Dă-i un număr» as every other elite, and its press records «Sosit» under the line's name (§990)", async () => {
    const ingrid = await eliteLine("Ingrid Pop", null);
    const before = await readFinishLine(db, staff.ADMIN!, raceId, at(29), 20);
    // Without a number: the line's id for «Dă-i un număr», nothing to press.
    expect(before.elites.map((button) => [button.label, button.bibNumber, button.entryId])).toEqual([["Ingrid", null, ingrid.id]]);
    const { giveEliteLineNumber } = await import("@/modules/registrations/elite-list");
    // The race's next free number: 101–103 are the runners', from the race's first number 1 — so 1.
    const given = await giveEliteLineNumber(db, staff.ADMIN!, ingrid.id, at(29));
    expect(given).toMatchObject({ bibNumber: 1, given: true });
    const after = await readFinishLine(db, staff.CONTRIBUTOR!, raceId, at(30), 20);
    expect(after.elites).toEqual([{ key: `l:${ingrid.id}`, kind: "line", label: "Ingrid", name: "Ingrid Pop", bibNumber: 1, entryId: ingrid.id, finishedGunTimeMs: null }]);
    // Pressed by the desk Volunteer: the line's own typed row, its name and number, ranked like any finisher.
    expect(await finish(1, at(31, 5))).toMatchObject({ kind: "recorded", bibNumber: 1, name: "Ingrid Pop", label: "Ingrid", gunTimeMs: ms(31, 5), positionOverall: 1 });
    expect((await stored()).map((row) => [row.bibNumber, row.registrationId, row.displayName, row.status])).toEqual([[1, null, "Ingrid Pop", "FINISHED"]]);
    expect((await readFinishLine(db, staff.CONTRIBUTOR!, raceId, at(32), 20)).elites[0].finishedGunTimeMs).toBe(ms(31, 5));
  });
});

describe("§986 «Anulează» at the line: one's own unchanged press, ten minutes", () => {
  const resultOf = async (bib: number) => (await stored()).find((row) => row.bibNumber === bib)!;

  it("deletes the volunteer's own press of the last ten minutes, ranks the others again and audits the undo", async () => {
    await finish(101, at(40));
    await finish(102, at(41));
    const row = await resultOf(101);
    revalidate.mockClear();
    expect(await undoFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, resultId: row.id }, new Date(row.createdAt.getTime() + FINISH_UNDO_WINDOW_MS))).toEqual({ bibNumber: 101 });
    expect((await stored()).map((one) => [one.bibNumber, one.positionOverall])).toEqual([[102, 1]]);
    expect((await trail()).at(-1)).toMatchObject({ action: "event_result.deleted", actorStaffUserId: staff.CONTRIBUTOR!.id, metadataJson: { bibNumber: 101, status: "FINISHED", gunTimeMs: ms(40), finishLine: true, undo: true } });
    expect(revalidate).toHaveBeenCalledTimes(1);
    await expect(undoFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, resultId: row.id }, at(42))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses one's own press once another volunteer pressed the number after it: the runner keeps a time, «Clasament» corrects it", async () => {
    // Vlad pressed 102 for another runner; Radu pressed 102 as 102 crossed — a duplicate. Vlad's undo would leave 102 with no time.
    await finish(102, at(40), staff.CONTRIBUTOR);
    await finish(102, at(41, 30), staff.COPYWRITER);
    const row = await resultOf(102);
    await expect(undoFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, resultId: row.id }, at(42))).rejects.toMatchObject({ code: "RESULT_UNDO_NOT_ALLOWED" });
    expect(await stored()).toEqual([row]);
    // The page says why there is no «Anulează» on Vlad's own line, and «Istoricul sosirilor» keeps both times.
    const view = await readFinishLine(db, staff.CONTRIBUTOR!, raceId, at(42), 20);
    expect(view.recent.map((line) => [line.bibNumber, line.undoUntilMs, line.pressedAgain])).toEqual([[102, null, "other"]]);
    // Pressed again by Vlad himself: the same — which of his two presses was right is «Clasament»'s to say.
    await finish(101, at(43), staff.CONTRIBUTOR);
    await finish(101, at(43, 20), staff.CONTRIBUTOR);
    const own = await resultOf(101);
    await expect(undoFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, resultId: own.id }, at(44))).rejects.toMatchObject({ code: "RESULT_UNDO_NOT_ALLOWED" });
    expect((await readFinishLine(db, staff.CONTRIBUTOR!, raceId, at(44), 20)).recent.find((line) => line.bibNumber === 101)?.pressedAgain).toBe("self");
  });

  it("refuses a row typed on «Clasament» — never pressed at the line — though its writer saved it a minute ago", async () => {
    await saveEventResults(db, staff.MODERATOR!, { eventId: raceId, rows: [{ key: "r[101]", bib: "101", name: "", sex: "", birthDate: "", time: "40:00", status: "", chip: "", note: "", agreed: "" }] }, at(45));
    const row = await resultOf(101);
    expect(row).toMatchObject({ updatedByStaffUserId: staff.MODERATOR!.id, createdAt: row.updatedAt });
    await expect(undoFinish(db, staff.MODERATOR!, { eventId: raceId, resultId: row.id }, at(46))).rejects.toMatchObject({ code: "RESULT_UNDO_NOT_ALLOWED" });
    const view = await readFinishLine(db, staff.MODERATOR!, raceId, at(46), 20);
    expect(view.recent.map((line) => [line.bibNumber, line.undoUntilMs, line.pressedAgain])).toEqual([[101, null, null]]);
    expect(await stored()).toEqual([row]);
  });

  it("refuses another's press, one past ten minutes, a row changed since and a member", async () => {
    await finish(101, at(40));
    const row = await resultOf(101);
    await expect(undoFinish(db, staff.MODERATOR!, { eventId: raceId, resultId: row.id }, at(41))).rejects.toMatchObject({ code: "RESULT_UNDO_NOT_ALLOWED" });
    await expect(undoFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, resultId: row.id }, new Date(row.createdAt.getTime() + FINISH_UNDO_WINDOW_MS + 1))).rejects.toMatchObject({ code: "RESULT_UNDO_NOT_ALLOWED" });
    await expect(undoFinish(db, staff.MEMBER!, { eventId: raceId, resultId: row.id }, at(41))).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Corrected on «Clasament» since — by its writer even: changed, so «Clasament»'s now.
    await db.update(eventResults).set({ note: "verificat", updatedAt: at(40, 30) }).where(eq(eventResults.id, row.id));
    await expect(undoFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, resultId: row.id }, at(41))).rejects.toMatchObject({ code: "RESULT_UNDO_NOT_ALLOWED" });
    // A runner written off and turned «Sosit» at the line was changed, not written: no undo here either.
    await saveEventResults(db, staff.ADMIN!, { eventId: raceId, rows: [{ key: "r[102]", bib: "102", name: "", sex: "", birthDate: "", time: "", status: "DNS", chip: "", note: "", agreed: "" }, { key: "r[101]", bib: "101", name: "", sex: "", birthDate: "", time: "40:00", status: "", chip: "", note: "verificat", agreed: "" }] }, at(30));
    await finish(102, at(43));
    await expect(undoFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, resultId: (await resultOf(102)).id }, at(44))).rejects.toMatchObject({ code: "RESULT_UNDO_NOT_ALLOWED" });
    expect((await stored()).map((one) => one.bibNumber)).toEqual([101, 102]);
  });
});

describe("§986 «Start»: the gun as pressed", () => {
  const press = (now: Date, actor: StaffUser = staff.MODERATOR!, claimed?: Date) => setRaceGun(db, actor, { eventId: raceId, clear: false, claimedAtMs: claimed?.getTime() ?? null }, now);
  const clear = (now: Date, actor: StaffUser = staff.MODERATOR!) => setRaceGun(db, actor, { eventId: raceId, clear: true }, now);
  const gunAt = async () => (await db.select({ at: events.raceGunAt, by: events.raceGunByStaffUserId, version: events.version }).from(events).where(eq(events.id, raceId)))[0];

  it("sets the gun to the tap heard at most ten seconds after it and at most five seconds ahead, moves it on a second press and counts the finishes from it", async () => {
    const { version } = await gunAt();
    expect(await press(at(2, 5), staff.MODERATOR, at(2, 3))).toEqual({ changed: true, gunAt: at(2, 3) });
    expect(await gunAt()).toEqual({ at: at(2, 3), by: staff.MODERATOR!.id, version });
    // A tap claimed a minute off is no tap of this press: the server's own clock.
    expect(await press(at(2, 30), staff.ADMIN, at(1, 0))).toEqual({ changed: true, gunAt: at(2, 30) });
    expect(await finish(101, at(47, 30))).toMatchObject({ gunTimeMs: ms(45) });
    const rows = await trail();
    expect(rows.filter((row) => row.action.startsWith("event.race_gun")).map((row) => [row.action, row.metadataJson])).toEqual([
      ["event.race_gun_set", { at: at(2, 3).toISOString(), previous: null }],
      ["event.race_gun_set", { at: at(2, 30).toISOString(), previous: at(2, 3).toISOString() }],
    ]);
  });

  it("takes the organizer's own «Start» heard again within ten seconds for the same press sent twice: the gun as it stands, nothing written", async () => {
    expect(await press(at(1, 0), staff.MODERATOR, at(0, 59))).toEqual({ changed: true, gunAt: at(0, 59) });
    // The same tap again, queued behind the first on a slow signal, heard eight seconds later and claiming its own moment.
    expect(await press(at(1, 8), staff.MODERATOR, at(1, 2))).toEqual({ changed: false, gunAt: at(0, 59), repeated: true });
    expect((await gunAt()).at).toEqual(at(0, 59));
    // Another organizer within the ten seconds: a press of their own, which moves it — and the first one's after that is theirs too.
    expect(await press(at(1, 9), staff.ADMIN)).toEqual({ changed: true, gunAt: at(1, 9) });
    expect(await press(at(1, 12), staff.MODERATOR)).toEqual({ changed: true, gunAt: at(1, 12) });
    // Their own again more than ten seconds later: a press of its own, which moves the gun.
    expect(await press(at(1, 23), staff.MODERATOR)).toEqual({ changed: true, gunAt: at(1, 23) });
    // After «Anulează startul», a «Start» within the ten seconds is a press of its own.
    await clear(at(1, 25));
    expect(await press(at(1, 27), staff.MODERATOR)).toEqual({ changed: true, gunAt: at(1, 27) });
    expect((await trail()).map((row) => row.action)).toEqual(["event.race_gun_set", "event.race_gun_set", "event.race_gun_set", "event.race_gun_set", "event.race_gun_cleared", "event.race_gun_set"]);
  });

  it("moves only the gun the page saw: two organizers at the start line, the later «Start» refused, nothing written (§986)", async () => {
    // Both pages drawn before anybody pressed: each one's «Start» says it saw no gun.
    const start = (now: Date, actor: StaffUser, seenGunAtMs: number | null) => setRaceGun(db, actor, { eventId: raceId, clear: false, claimedAtMs: null, seenGunAtMs }, now);
    expect(await start(at(0, 1), staff.MODERATOR!, null)).toEqual({ changed: true, gunAt: at(0, 1) });
    // The Administrator presses seconds later on a page still saying «Start»: refused — every runner's time stays counted from the first.
    await expect(start(at(0, 4), staff.ADMIN!, null)).rejects.toMatchObject({ code: "RACE_GUN_CHANGED" });
    expect(await gunAt()).toMatchObject({ at: at(0, 1), by: staff.MODERATOR!.id });
    // The organizer's own second tap, queued behind the first and saying the same page's «none»: the press sent twice, as before.
    expect(await start(at(0, 6), staff.MODERATOR!, null)).toEqual({ changed: false, gunAt: at(0, 1), repeated: true });
    // The Administrator's page drawn again saw the gun as it stands: its «Mută startul acum» moves it.
    expect(await start(at(0, 30), staff.ADMIN!, at(0, 1).getTime())).toEqual({ changed: true, gunAt: at(0, 30) });
    // A «Mută startul acum» under the gun of before, and one under a gun taken off since, move nothing either.
    await expect(start(at(0, 50), staff.MODERATOR!, at(0, 1).getTime())).rejects.toMatchObject({ code: "RACE_GUN_CHANGED" });
    await clear(at(0, 55), staff.ADMIN!);
    await expect(start(at(1, 10), staff.MODERATOR!, at(0, 30).getTime())).rejects.toMatchObject({ code: "RACE_GUN_CHANGED" });
    expect(await gunAt()).toMatchObject({ at: null, by: null });
    // Each refusal wrote nothing: the trail holds the two «Start» and the one «Anulează startul».
    expect((await trail()).map((row) => row.action)).toEqual(["event.race_gun_set", "event.race_gun_set", "event.race_gun_cleared"]);
  });

  it("reads the gun for the clock's question with who pressed it and whether a «Sosit» fixed it (§986)", async () => {
    expect(await readFinishGun(db, staff.CONTRIBUTOR!, raceId)).toEqual({ at: GUN, pressed: false, byName: null, fixed: false });
    await press(at(0, 2));
    expect(await readFinishGun(db, staff.CONTRIBUTOR!, raceId)).toEqual({ at: at(0, 2), pressed: true, byName: "Oana Organizator", fixed: false });
    // An «Abandon» typed on «Clasament» fixes nothing; the first «Sosit» — whoever recorded it — does.
    await db.insert(eventResults).values({ eventId: raceId, bibNumber: 900, displayName: "Ion Abandon", status: "DNF", updatedAt: at(10), createdAt: at(10) });
    expect((await readFinishGun(db, staff.CONTRIBUTOR!, raceId))?.fixed).toBe(false);
    await finish(101, at(40), staff.COPYWRITER!);
    expect(await readFinishGun(db, staff.CONTRIBUTOR!, raceId)).toEqual({ at: at(0, 2), pressed: true, byName: "Oana Organizator", fixed: true });
    // An account gone since: the gun stands, nobody named.
    await db.update(events).set({ raceGunByStaffUserId: null }).where(eq(events.id, raceId));
    expect((await readFinishGun(db, staff.CONTRIBUTOR!, raceId))?.byName).toBeNull();
    expect(await readFinishGun(db, staff.CONTRIBUTOR!, "0b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b")).toBeNull();
    await expect(readFinishGun(db, staff.MEMBER!, raceId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("takes the gun off, back to the planned start, and finds nothing to take off twice", async () => {
    await press(at(1));
    expect(await clear(at(1, 30))).toEqual({ changed: true, gunAt: null });
    expect(await gunAt()).toMatchObject({ at: null, by: null });
    expect(await clear(at(1, 40))).toEqual({ changed: false, gunAt: null });
    expect((await trail()).map((row) => [row.action, row.metadataJson])).toEqual([
      ["event.race_gun_set", { at: at(1).toISOString(), previous: null }],
      ["event.race_gun_cleared", { previous: at(1).toISOString() }],
    ]);
  });

  it("is fixed once a runner is «Sosit», pressed only from three hours before the planned gun to six after, and only by whoever enters results", async () => {
    await expect(press(new Date(GUN.getTime() - 3 * 3_600_000 - 1000))).rejects.toMatchObject({ code: "RACE_GUN_WINDOW" });
    await expect(press(new Date(GUN.getTime() + 6 * 3_600_000 + 1000))).rejects.toMatchObject({ code: "RACE_GUN_WINDOW" });
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "DEV", "MEMBER"] as const) await expect(press(at(1), staff[role]), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    await press(new Date(GUN.getTime() - 3 * 3_600_000));
    await finish(101, at(40));
    await expect(press(at(41))).rejects.toMatchObject({ code: "RACE_GUN_FIXED" });
    await expect(clear(at(41))).rejects.toMatchObject({ code: "RACE_GUN_FIXED" });
    const run = await createRace(db, { type: "GROUP_RUN" });
    await expect(setRaceGun(db, staff.ADMIN!, { eventId: run.id, clear: false }, at(1))).rejects.toMatchObject({ code: "RESULTS_NOT_OPEN" });
  });

  it("is read by the finish line alone: «Clasament»'s, «Cronometrare»'s gun; the editor's planned start untouched", async () => {
    await press(at(3));
    const view = await readFinishLine(db, staff.CONTRIBUTOR!, raceId, at(4), 20);
    expect(view.gun).toMatchObject({ at: at(3), pressed: true, byName: "Oana Organizator", planned: GUN, fixed: false, windowOpen: true });
    const [row] = await db.select({ startsAt: events.startsAt, raceStartsAt: events.raceStartsAt }).from(events).where(eq(events.id, raceId));
    expect(row).toEqual({ startsAt: GUN, raceStartsAt: null });
  });
});

describe("§986 readFinishLine — «Ultimii sosiți» with who entered each", () => {
  it("lists the latest written first with the live place, who wrote it, and until when the viewer may undo their own", async () => {
    await finish(102, at(45), staff.CONTRIBUTOR);
    await finish(101, at(50), staff.MODERATOR);
    await finish(103, at(44), staff.CONTRIBUTOR);
    // Latest *written* first — the press's clock, not the race time: 101 was pressed at 50:00, 102 at 45:00, 103 at 44:00.
    const view = await readFinishLine(db, staff.CONTRIBUTOR!, raceId, at(50, 30), 2);
    expect(view.recent.map((line) => [line.bibNumber, line.name, line.gunTimeMs, line.positionOverall, line.by, line.changed, line.undoUntilMs !== null])).toEqual([
      [101, "Ana Popescu", ms(50), 3, "Oana Organizator", false, false],
      [102, "Bia Marin", ms(45), 2, "Vlad Voluntar", false, true],
    ]);
    expect(view.finished).toBe(3);
    expect(view.withNumber).toBe(3);
    // Ten minutes after it was written, the volunteer's own line has no «Anulează» any more.
    const later = await readFinishLine(db, staff.CONTRIBUTOR!, raceId, at(60), 3);
    expect(later.recent.find((line) => line.bibNumber === 102)?.undoUntilMs).toBeNull();
  });
});

describe("§986 «Istoricul sosirilor»", () => {
  it("names who wrote each line, newest first, from the line and from «Clasament», with the number's name of today and never one in the trail", async () => {
    await setRaceGun(db, staff.MODERATOR!, { eventId: raceId, clear: false }, at(0, 0));
    await finish(101, at(40), staff.CONTRIBUTOR);
    await undoFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, resultId: (await stored())[0].id }, at(40, 30));
    await finish(101, at(41), staff.CONTRIBUTOR);
    await finish(101, at(41, 10), staff.DEV);
    const ana = { key: "r[101]", bib: "101", name: "", sex: "", birthDate: "", time: "41:05", status: "", chip: "", note: "", agreed: "" };
    await saveEventResults(db, staff.ADMIN!, { eventId: raceId, rows: [ana] }, at(43));
    await saveEventResults(db, staff.ADMIN!, { eventId: raceId, rows: [ana, { key: "r[102]", bib: "102", name: "", sex: "", birthDate: "", time: "", status: "DSQ", chip: "", note: "", agreed: "" }] }, at(43, 30));
    await finish(102, at(44), staff.CONTRIBUTOR);
    const history = await readFinishHistory(db, staff.MODERATOR!, raceId);
    expect(history.limited).toBe(false);
    expect(history.lines.map((line) => [line.what.kind, line.who, line.where, line.liveName])).toEqual([
      ["duplicate", "Vlad Voluntar", "timing", "Bia Marin"],
      ["created", "Ana Admin", "results", "Bia Marin"],
      ["updated", "Ana Admin", "results", "Ana Popescu"],
      ["duplicate", "Tudor Tehnic", "timing", "Ana Popescu"],
      ["finish", "Vlad Voluntar", "timing", "Ana Popescu"],
      ["undo", "Vlad Voluntar", "timing", "Ana Popescu"],
      ["finish", "Vlad Voluntar", "timing", "Ana Popescu"],
      ["gunSet", "Oana Organizator", "timing", null],
    ]);
    // The press of a runner «Clasament» disqualified is in the trail with the decision that stays; a «Sosit»'s with its time.
    expect(history.lines.filter((line) => line.what.kind === "duplicate").map((line) => line.what)).toEqual([
      { kind: "duplicate", bibNumber: 102, gunTimeMs: ms(44), storedGunTimeMs: null, storedStatus: "DSQ" },
      { kind: "duplicate", bibNumber: 101, gunTimeMs: ms(41, 10), storedGunTimeMs: ms(41), storedStatus: "FINISHED" },
    ]);
    const trailText = JSON.stringify((await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, raceId)))).map((one) => one.metadataJson));
    expect(trailText).not.toContain("Popescu");
    await expect(readFinishHistory(db, staff.CONTRIBUTOR!, raceId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("says nobody for an account removed since, and keeps the line", async () => {
    const [gone] = await db.insert(staffUsers).values({ email: "gone2@example.test", displayName: "Fost Voluntar", role: "CONTRIBUTOR" }).returning();
    await finish(103, at(44), gone);
    await db.delete(staffUsers).where(eq(staffUsers.id, gone.id));
    const history = await readFinishHistory(db, staff.ADMIN!, raceId);
    expect(history.lines.map((line) => [line.what.kind, line.who])).toEqual([["finish", null]]);
    // «Clasament» says the same of the row: written by an account that is gone.
    const view = await readEventResults(db, staff.ADMIN!, raceId);
    expect(view.registered.find((runner) => runner.bibNumber === 103)?.result?.writtenBy).toEqual({ name: null, changed: false });
  });
});
