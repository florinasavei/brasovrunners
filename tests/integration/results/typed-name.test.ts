import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventResults } from "@/db/schema/event-results";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { PRUNE_STEPS, pruneExpiredRows } from "@/modules/jobs/retention";
import { exportEventResults, importResultsCsv, readEventResults, readPublicEventResults, ResultRowError, saveEventResults, setResultsPublished } from "@/modules/results/results";
import type { PostedResultRow } from "@/modules/results/rows";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { AFTER_THE_RACE, approvePrivacyNotice, approveResultsTexts, approveTerms, createRace, person, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §810 — a runner the club entered by hand stands by name in the public ranking once the staff record that the person agreed
 * (BR-REQ-039-01, BR-REQ-050-02): migration 0167's columns and checks, the save that sets and clears the record with its audit row (who and when,
 * never the name), the page's data, the public read's rule, the fingerprint that makes a stale form a conflict, and the retention sweep.
 * Modelled on the race-day desk's paper declaration (§67): the participant agrees, a staff member records it.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
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
  revalidate.mockClear();
  for (const [role, name] of [["ADMIN", "Ana Admin"], ["MODERATOR", "Oana Organizator"], ["DEV", "Tudor Tehnic"], ["CONTRIBUTOR", "Vlad Voluntar"]] as const) {
    staff[role] = await person(db, role, name);
  }
  raceId = (await createRace(db)).id;
});

const line = (bib: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `r[${bib}]`, bib: String(bib), name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });
const typed = (index: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `n[${index}]`, bib: "", name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });
/** Ion, entered by hand, agreed. */
const ion = (over: Partial<PostedResultRow> = {}) => typed(0, { bib: "900", name: "Ion Vasile", sex: "male", time: "42:00", agreed: "on", ...over });

let ticks = 0;
const clock = () => new Date(NOW.getTime() + ++ticks * 1000);
const save = (rows: PostedResultRow[], fingerprint?: string | null, actor: StaffUser = staff.ADMIN!) => saveEventResults(db, actor, { eventId: raceId, rows, fingerprint }, clock());
const stored = () => db.select().from(eventResults).where(eq(eventResults.eventId, raceId)).orderBy(eventResults.bibNumber);
const byBib = async (bib: number) => (await stored()).find((row) => row.bibNumber === bib);
const trail = () => db.select().from(auditLogs).where(eq(auditLogs.entityId, raceId)).orderBy(auditLogs.createdAt, auditLogs.id);
const resultsTrail = async () => (await trail()).filter((row) => row.action.startsWith("event_result."));

describe("§810 migration 0167: the columns and their checks", () => {
  const insert = (values: Partial<typeof eventResults.$inferInsert>) => db.insert(eventResults).values({ eventId: raceId, bibNumber: 900, status: "DNS", ...values });

  it("starts every row with no agreement recorded, registered or typed", async () => {
    const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101 });
    await insert({ bibNumber: 101, registrationId: ana.id });
    await insert({ displayName: "Ion Vasile" });
    expect((await stored()).map((row) => [row.nameAgreedAt, row.nameAgreedByStaffUserId])).toEqual([[null, null], [null, null]]);
  });

  it("accepts the moment with the actor, or the moment alone, on a typed row that has a name", async () => {
    await insert({ displayName: "Ion Vasile", nameAgreedAt: NOW, nameAgreedByStaffUserId: staff.ADMIN!.id });
    await insert({ bibNumber: 901, displayName: "Maria Pop", nameAgreedAt: NOW });
    expect((await byBib(900))?.nameAgreedByStaffUserId).toBe(staff.ADMIN!.id);
    expect((await byBib(901))?.nameAgreedAt).toEqual(NOW);
  });

  it("refuses at the database a staff mark on a registered runner's row: their name follows their own tick, never a staff mark", async () => {
    const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101 });
    await expect(insert({ bibNumber: 101, registrationId: ana.id, displayName: "Ana", nameAgreedAt: NOW })).rejects.toThrow();
    await expect(insert({ bibNumber: 101, registrationId: ana.id, nameAgreedAt: NOW })).rejects.toThrow();
    // Nor can an update put the mark on a row a registration holds.
    await insert({ bibNumber: 101, registrationId: ana.id });
    await expect(db.update(eventResults).set({ displayName: "Ana", nameAgreedAt: NOW }).where(eq(eventResults.bibNumber, 101))).rejects.toThrow();
  });

  it("refuses an actor without a moment, and a moment without a name to show", async () => {
    await expect(insert({ displayName: "Ion", nameAgreedByStaffUserId: staff.ADMIN!.id })).rejects.toThrow();
    await expect(insert({ nameAgreedAt: NOW })).rejects.toThrow();
    await expect(insert({ displayName: null, nameAgreedAt: NOW, nameAgreedByStaffUserId: staff.ADMIN!.id })).rejects.toThrow();
  });

  it("keeps the moment when the staff account that recorded it is removed (`ON DELETE SET NULL`): the agreement stays, naming nobody", async () => {
    const [gone] = await db.insert(staffUsers).values({ email: "temporar@example.test", displayName: "Temporar", role: "MODERATOR" }).returning();
    await insert({ displayName: "Ion Vasile", nameAgreedAt: NOW, nameAgreedByStaffUserId: gone.id });
    await db.delete(staffUsers).where(eq(staffUsers.id, gone.id));
    expect(await byBib(900)).toMatchObject({ nameAgreedAt: NOW, nameAgreedByStaffUserId: null, displayName: "Ion Vasile" });
  });

  it("leaves the row untouched when a registration is erased: a registered row never carried a mark", async () => {
    const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101 });
    await insert({ bibNumber: 101, registrationId: ana.id });
    await db.delete(registrations).where(eq(registrations.id, ana.id));
    expect(await byBib(101)).toMatchObject({ registrationId: null, nameAgreedAt: null, nameAgreedByStaffUserId: null });
  });
});

describe("§810 the save records, keeps and withdraws the agreement", () => {
  it("sets the moment and the actor when the tick comes with a new typed line, and audits it without the name", async () => {
    await save([ion()], null, staff.MODERATOR!);
    const at = new Date(NOW.getTime() + ticks * 1000);
    expect(await byBib(900)).toMatchObject({ displayName: "Ion Vasile", registrationId: null, nameAgreedAt: at, nameAgreedByStaffUserId: staff.MODERATOR!.id });
    const [created] = await resultsTrail();
    expect(created).toMatchObject({ action: "event_result.created", actorStaffUserId: staff.MODERATOR!.id, metadataJson: { bibNumber: 900, status: "FINISHED", gunTimeMs: 42 * 60_000, chipTimeMs: null, nameAgreed: true } });
    expect(JSON.stringify(created.metadataJson)).not.toContain("Ion");
  });

  it("leaves a typed line unticked by default, and records nothing about an agreement in the trail", async () => {
    await save([ion({ agreed: "" })]);
    expect(await byBib(900)).toMatchObject({ nameAgreedAt: null, nameAgreedByStaffUserId: null });
    expect((await resultsTrail())[0].metadataJson).toEqual({ bibNumber: 900, status: "FINISHED", gunTimeMs: 42 * 60_000, chipTimeMs: null });
  });

  it("turns the tick on later: the moment and the actor of that save, one `event_result.updated` row naming the change and never the name", async () => {
    await save([ion({ agreed: "" })]);
    await save([ion()], null, staff.MODERATOR!);
    const at = new Date(NOW.getTime() + ticks * 1000);
    expect(await byBib(900)).toMatchObject({ nameAgreedAt: at, nameAgreedByStaffUserId: staff.MODERATOR!.id });
    const updated = (await resultsTrail()).at(-1);
    expect(updated).toMatchObject({ action: "event_result.updated", actorStaffUserId: staff.MODERATOR!.id, metadataJson: { bibNumber: 900, changed: ["nameAgreed"], nameAgreed: true } });
    expect(JSON.stringify(updated?.metadataJson)).not.toContain("Ion");
  });

  it("keeps the first moment and the first actor when the same tick is saved again, and writes nothing", async () => {
    await save([ion()], null, staff.MODERATOR!);
    const first = await byBib(900);
    const trailBefore = (await trail()).length;
    const outcome = await save([ion()], null, staff.ADMIN!);
    expect(outcome).toMatchObject({ changed: false, updated: 0 });
    expect(await byBib(900)).toMatchObject({ nameAgreedAt: first?.nameAgreedAt, nameAgreedByStaffUserId: staff.MODERATOR!.id });
    expect((await trail()).length).toBe(trailBefore);
  });

  it("keeps the agreement through a correction of the time, and does not rewrite who recorded it", async () => {
    await save([ion()], null, staff.MODERATOR!);
    const first = await byBib(900);
    await save([ion({ time: "41:30" })], null, staff.ADMIN!);
    expect(await byBib(900)).toMatchObject({ gunTimeMs: 41 * 60_000 + 30_000, nameAgreedAt: first?.nameAgreedAt, nameAgreedByStaffUserId: staff.MODERATOR!.id });
    expect((await resultsTrail()).at(-1)?.metadataJson).toEqual({ bibNumber: 900, status: "FINISHED", gunTimeMs: 41 * 60_000 + 30_000, chipTimeMs: null, changed: ["time"] });
  });

  it("records the agreement again when the name changes beside a tick that stays on: the new person is on the saver's record, in the trail, never the name", async () => {
    await save([ion()], null, staff.MODERATOR!);
    await save([ion({ name: "Maria Pop" })], null, staff.ADMIN!);
    const at = new Date(NOW.getTime() + ticks * 1000);
    expect(await byBib(900)).toMatchObject({ displayName: "Maria Pop", nameAgreedAt: at, nameAgreedByStaffUserId: staff.ADMIN!.id });
    const updated = (await resultsTrail()).at(-1);
    expect(updated).toMatchObject({ action: "event_result.updated", actorStaffUserId: staff.ADMIN!.id, metadataJson: { bibNumber: 900, changed: ["name", "nameAgreed"], nameAgreed: true } });
    expect(JSON.stringify(updated?.metadataJson)).not.toMatch(/Ion|Maria/);
  });

  it("does not record anything for a new name beside a tick that is off", async () => {
    await save([ion({ agreed: "" })]);
    await save([ion({ name: "Maria Pop", agreed: "" })]);
    expect(await byBib(900)).toMatchObject({ displayName: "Maria Pop", nameAgreedAt: null, nameAgreedByStaffUserId: null });
    expect((await resultsTrail()).at(-1)?.metadataJson).toMatchObject({ changed: ["name"] });
  });

  it("withdraws the agreement when the tick is taken off: both columns cleared, one audit row, the name stays for the club", async () => {
    await save([ion()]);
    await save([ion({ agreed: "" })], null, staff.MODERATOR!);
    expect(await byBib(900)).toMatchObject({ nameAgreedAt: null, nameAgreedByStaffUserId: null, displayName: "Ion Vasile" });
    expect((await resultsTrail()).at(-1)).toMatchObject({ action: "event_result.updated", actorStaffUserId: staff.MODERATOR!.id, metadataJson: { changed: ["nameAgreed"], nameAgreed: false } });
  });

  it("lets the organizer, who enters the results, tick it; the Tehnic role and a volunteer are refused whole", async () => {
    await save([ion()], null, staff.MODERATOR!);
    expect((await byBib(900))?.nameAgreedByStaffUserId).toBe(staff.MODERATOR!.id);
    for (const role of ["DEV", "CONTRIBUTOR"] as const) {
      await expect(save([ion({ bib: "901" })], null, staff[role]!), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await stored()).toHaveLength(1);
  });

  it("refuses the tick on a line with no name, naming the name's box, and writes nothing of the other lines", async () => {
    const attempt = save([ion({ bib: "901", name: "Maria Pop", time: "43:00" }), ion({ bib: "902", name: "", key: "n[1]" })]);
    await expect(attempt).rejects.toBeInstanceOf(ResultRowError);
    await expect(attempt).rejects.toMatchObject({ code: "RESULT_ROW_INVALID", problem: "agreedNameMissing", bibNumber: 902, fields: ["n[1].name"] });
    expect(await stored()).toEqual([]);
  });

  it("refuses the tick on a stored line whose name was cleared in the same form", async () => {
    await save([ion()]);
    await expect(save([ion({ name: "" })])).rejects.toMatchObject({ problem: "agreedNameMissing" });
    expect(await byBib(900)).toMatchObject({ displayName: "Ion Vasile", nameAgreedAt: expect.any(Date) });
  });

  it("takes a tick alone on a blank line for nothing, and never gives it to another line", async () => {
    await save([typed(0, { agreed: "on" }), typed(1, { bib: "901", name: "Maria Pop", time: "43:00" })]);
    expect((await stored()).map((row) => [row.bibNumber, row.nameAgreedAt])).toEqual([[901, null]]);
  });

  it("ignores a forged tick on a registered line: their name follows their own tick on the form", async () => {
    await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101 });
    await save([line(101, { time: "50:00", agreed: "on" })]);
    expect(await byBib(101)).toMatchObject({ displayName: null, nameAgreedAt: null, nameAgreedByStaffUserId: null });
    expect((await resultsTrail())[0].metadataJson).toEqual({ bibNumber: 101, status: "FINISHED", gunTimeMs: 50 * 60_000, chipTimeMs: null });
  });

  it("clears the mark of a typed row a registration takes over: the runner who registered is named by their own tick or not at all", async () => {
    await save([ion()]);
    expect((await byBib(900))?.nameAgreedAt).toBeInstanceOf(Date);
    const late = await registerRunner(db, raceId, { name: "Ion Vasile", bibNumber: 900, ticked: false });
    await save([line(900, { time: "42:00" })]);
    expect(await byBib(900)).toMatchObject({ registrationId: late.id, displayName: null, nameAgreedAt: null, nameAgreedByStaffUserId: null });
    expect((await resultsTrail()).at(-1)?.metadataJson).toMatchObject({ bibNumber: 900, nameAgreed: false });
  });

  it("names an erased registration's nameless row only after a name is typed and the tick recorded", async () => {
    const ana = await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01" });
    await save([line(101, { time: "50:00" })]);
    await db.delete(registrations).where(eq(registrations.id, ana.id));
    expect(await byBib(101)).toMatchObject({ registrationId: null, displayName: null, nameAgreedAt: null });
    await expect(save([typed(0, { bib: "101", time: "50:00", agreed: "on" })])).rejects.toMatchObject({ problem: "agreedNameMissing" });
    await save([typed(0, { bib: "101", name: "Persoana Noua", time: "50:00", agreed: "on" })]);
    expect(await byBib(101)).toMatchObject({ displayName: "Persoana Noua", nameAgreedAt: expect.any(Date) });
  });

  it("starts an imported number's new line unticked: a CSV carries no agreement", async () => {
    const rows = await importResultsCsv(db, staff.ADMIN!, raceId, "900,42:00");
    expect(rows).toEqual([expect.objectContaining({ bibNumber: 900, matched: false })]);
    expect(Object.keys(rows[0])).not.toContain("agreed");
    expect(await stored()).toEqual([]);
  });

  it("makes a form drawn before another session ticked or unticked the line a conflict", async () => {
    await save([ion({ agreed: "" })]);
    const before = (await readEventResults(db, staff.ADMIN!, raceId)).fingerprint;
    await save([ion()]);
    await expect(save([ion({ time: "41:00" })], before)).rejects.toMatchObject({ code: "CONFLICT" });
    const after = (await readEventResults(db, staff.ADMIN!, raceId)).fingerprint;
    expect(after).not.toBe(before);
    await expect(save([ion({ time: "41:00" })], after)).resolves.toMatchObject({ updated: 1 });
  });
});

describe("§810 the page's data and the export", () => {
  it("tells the page which typed lines are ticked, and whether the public list would name them", async () => {
    await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101 });
    await save([line(101, { time: "50:00" }), ion(), typed(1, { bib: "901", name: "Maria Pop", time: "43:00" })]);
    const before = await readEventResults(db, staff.ADMIN!, raceId);
    expect(before.registered[0]).toMatchObject({ nameAgreed: null, named: false });
    expect(before.typed.map((runner) => [runner.bibNumber, runner.nameAgreed, runner.named])).toEqual([[900, true, false], [901, false, false]]);
    // With a notice that describes the results in force, the agreed runner would be named; the other never.
    await approveResultsTexts(db);
    const after = await readEventResults(db, staff.ADMIN!, raceId);
    expect(after.typed.map((runner) => [runner.bibNumber, runner.nameAgreed, runner.named])).toEqual([[900, true, true], [901, false, false]]);
  });

  it("exports the same names the backoffice sees, agreed or not, and the file carries no agreement column", async () => {
    await save([ion(), typed(1, { bib: "901", name: "Maria Pop", time: "43:00" })]);
    const { rows } = await exportEventResults(db, staff.ADMIN!, raceId, NOW);
    expect(rows.map((row) => [row.bibNumber, row.name])).toEqual([[900, "Ion Vasile"], [901, "Maria Pop"]]);
    expect(Object.keys(rows[0])).not.toContain("nameAgreedAt");
  });
});

describe("§810 the public read: a typed runner is named only while the staff's record stands", () => {
  const options = { now: AFTER_THE_RACE, deadlines: DEFAULT_DEADLINES, noticeDescribes: true, termsDescribe: true, firstResultsNoticeVersion: 1 as number | null };

  async function published(rows: PostedResultRow[]) {
    await save(rows);
    await approveResultsTexts(db);
    await setResultsPublished(db, staff.ADMIN!, raceId, true, NOW);
  }

  it("names the agreed typed runner and leaves the other «Participant #bib» (a null name)", async () => {
    await published([ion(), typed(1, { bib: "901", name: "Maria Pop", time: "43:00" })]);
    const result = await readPublicEventResults(db, raceId, options);
    expect(result?.rows.map((row) => [row.bibNumber, row.name])).toEqual([[900, "Ion Vasile"], [901, null]]);
    // Nothing else of the read changed: the same keys, no agreement, no actor, no moment.
    expect([...new Set(result?.rows.flatMap((row) => Object.keys(row)))].sort()).toEqual(["bibNumber", "categoryKey", "chipTimeMs", "gunTimeMs", "name", "positionCategory", "positionOverall", "positionSex", "sex", "status"]);
    expect(JSON.stringify(result)).not.toMatch(/nameAgreed|Maria|agreed/i);
  });

  it("takes the name off the next read when the tick is withdrawn", async () => {
    await published([ion()]);
    await save([ion({ agreed: "" })]);
    expect((await readPublicEventResults(db, raceId, options))?.rows[0].name).toBeNull();
  });

  it("names nobody while no approved notice describes the results, agreed or not", async () => {
    await published([ion()]);
    expect((await readPublicEventResults(db, raceId, { ...options, firstResultsNoticeVersion: null }))?.rows[0].name).toBeNull();
  });

  it("shows nothing at all when the notice or the terms in force no longer describe the results", async () => {
    await published([ion()]);
    expect(await readPublicEventResults(db, raceId, { ...options, noticeDescribes: false })).toBeNull();
    expect(await readPublicEventResults(db, raceId, { ...options, termsDescribe: false })).toBeNull();
  });

  it("still names a registered runner by their own tick alone: a staff mark on the same bib is not read", async () => {
    await approvePrivacyNotice(db, { results: true });
    await approveTerms(db, { results: true });
    await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, ticked: false });
    await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, ticked: true });
    await save([line(101, { time: "50:00", agreed: "on" }), line(102, { time: "51:00" })]);
    await setResultsPublished(db, staff.ADMIN!, raceId, true, NOW);
    const result = await readPublicEventResults(db, raceId, options);
    expect(result?.rows.map((row) => [row.bibNumber, row.name])).toEqual([[101, null], [102, "Bia Marin"]]);
  });

  it("does not name a typed runner whose number a confirmed registration took since: until the next save, the line is the registered runner's", async () => {
    await published([ion()]);
    await registerRunner(db, raceId, { name: "Ion Vasile", bibNumber: 900, ticked: false });
    // No save in between: the stored row still carries the staff mark and no registration.
    expect(await byBib(900)).toMatchObject({ registrationId: null, nameAgreedAt: expect.any(Date) });
    expect((await readPublicEventResults(db, raceId, options))?.rows.map((row) => [row.bibNumber, row.name])).toEqual([[900, null]]);
  });

  it("a typed row without the mark returns a null name from the real read, whatever name was typed", async () => {
    await published([ion({ agreed: "" })]);
    const result = await readPublicEventResults(db, raceId, options);
    expect(result?.rows[0].name).toBeNull();
    expect(JSON.stringify(result)).not.toContain("Ion");
  });

  it("never names a test registration's row: the join does not return it, and the database refuses a mark on it", async () => {
    await published([ion()]);
    const test = await registerRunner(db, raceId, { name: "Persoana De Proba", bibNumber: 170, kind: "TEST" });
    await db.insert(eventResults).values({ eventId: raceId, registrationId: test.id, bibNumber: 170, status: "FINISHED", gunTimeMs: 3_600_000 });
    await expect(db.update(eventResults).set({ displayName: "Proba", nameAgreedAt: NOW }).where(eq(eventResults.bibNumber, 170))).rejects.toThrow();
    const result = await readPublicEventResults(db, raceId, options);
    expect(result?.rows.find((row) => row.bibNumber === 170)?.name).toBeNull();
    expect(JSON.stringify(result)).not.toContain("Proba");
  });
});

describe("§810 retention: the agreement goes with the row, three years after the race", () => {
  it("deletes a typed row whole — the name, the moment and the actor with it", async () => {
    expect(PRUNE_STEPS).toContain("event-results");
    const old = await createRace(db, { startsAt: new Date("2026-11-21T07:00:00.000Z") });
    await db.insert(eventResults).values({ eventId: old.id, bibNumber: 900, displayName: "Ion Vasile", status: "DNS", nameAgreedAt: NOW, nameAgreedByStaffUserId: staff.ADMIN!.id });
    const outcome = await pruneExpiredRows(db, new Date("2030-06-01T12:00:00.000Z"));
    expect(outcome.failures).toEqual([]);
    expect(outcome.results).toBe(1);
    expect(await db.select().from(eventResults).where(eq(eventResults.eventId, old.id))).toEqual([]);
  });
});
