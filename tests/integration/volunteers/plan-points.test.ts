import { and, asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { CoordinatesRefusal } from "@/modules/event-checkpoints/domain/coordinates";
import { viewPersonData } from "@/modules/registrations/person-data";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { readVolunteerPlan } from "@/modules/volunteers/plan";
import {
  changePlanPoint,
  listPlanPoints,
  PLAN_POINT_REASONS,
  PLAN_POINTS_MAX,
  PlanPointGone,
  type PlanPointPlace,
  PlanPointRefusal,
  planPointRefusalValues,
} from "@/modules/volunteers/plan-points";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { type PlanRace, planAddressOf, seedPlanRace } from "../../helpers/volunteer-plan";

/**
 * §NNN, BR-REQ-050-02, BR-REQ-060-01 — «Punctele planului» (the owner, 2026-11-17: «După ce încarc acea poză cu harta de
 * voluntari vreau să pot defini punctele de mână, să pun nume punct și la ce km e și coordonate punct» — «Practic voluntarii
 * sunt de 2 tipuri: start-finish și pe traseu»), from a real database:
 *
 * - **the plan's one list** (`listPlanPoints`): every point of the event, the editor's and the plan's own — the start–finish
 *   points first, in the order they were added, with no number; then the route by kilometre, at one kilometre the editor's
 *   first and then the plan's own in the order they were added, numbered from 1;
 * - **`changePlanPoint`**: `add` (the place, the name, the kilometre of a route point, the coordinates, forty at most),
 *   `edit` (all of a plan's own point, its kind included; of an editor's point the coordinates alone) and `remove` (a plan's
 *   own point only; its people stand at no point again) — each asked of whoever works the volunteers before anything is
 *   read, each audited with the point and never a person, a press that changes nothing writing nothing;
 * - nothing of it emails anybody or expires a public cache tag;
 * - a person is placed at a point of the plan's own exactly as at an editor's, and their own data names it.
 *
 * The page, the Server Actions and the «Voluntari» list are `plan-points-screens.test.ts`; that none of it is public,
 * `tests/integration/events/plan-points-stay-private.test.ts`; the message, `plan-points-mail.test.ts`.
 */
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), unstable_cache: vi.fn() }));
const { revalidatePath, revalidateTag } = await import("next/cache");

const NOW = new Date("2026-11-16T10:00:00.000Z");
const PIATA = "45.64271, 25.58871";
/**
 * The instant of each press: a second after the one before, so the trail reads in the order of the presses whatever the
 * database does with rows of one instant — or the very same instant for every press while `frozen`, which is how the
 * plan's order is shown to follow the presses and never the clock.
 */
let ticks = 0;
let frozen = false;
const clock = () => (frozen ? NOW : new Date(NOW.getTime() + (ticks += 1) * 1000));

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let race: PlanRace;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  ticks = 0;
  frozen = false;
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Staff ${role}`, role }).returning();
  }
  // Three editor's points — the junction at 1.2, the water at 5.5, the bridge at 7.25 — and people at them (`volunteer-plan.ts`).
  race = await seedPlanRace(db, NOW);
  // As a Next server: without it the public cache expires nothing whatever is asked, and «no tag was expired» would prove nothing.
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.mocked(revalidateTag).mockClear();
  vi.mocked(revalidatePath).mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

type Boxes = { place?: unknown; name?: unknown; km?: unknown; coordinates?: unknown };
const add = (boxes: Boxes, actor: StaffUser = staff.MODERATOR!, eventId = race.raceId) =>
  changePlanPoint(db, actor, { kind: "add", eventId, place: "route", name: "Izvor", km: "3,4", coordinates: "", ...boxes }, clock());
const edit = (id: unknown, boxes: Boxes, actor: StaffUser = staff.MODERATOR!, eventId = race.raceId) =>
  changePlanPoint(db, actor, { kind: "edit", eventId, id, place: "route", name: "Izvor", km: "3,4", coordinates: "", ...boxes }, clock());
const remove = (id: unknown, actor: StaffUser = staff.MODERATOR!, eventId = race.raceId) => changePlanPoint(db, actor, { kind: "remove", eventId, id }, clock());
/** A point added, and its id. */
const added = async (boxes: Boxes) => (await add(boxes)).id;

const rowOf = async (id: string) => (await db.select().from(eventCheckpoints).where(eq(eventCheckpoints.id, id)))[0];
const rowsOf = (eventId = race.raceId) => db.select().from(eventCheckpoints).where(eq(eventCheckpoints.eventId, eventId)).orderBy(asc(eventCheckpoints.km), asc(eventCheckpoints.position));
const personOf = async (id: string) => (await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0];
const trail = async () => (await db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt))).filter((row) => row.action.startsWith("volunteer_plan."));
const place = (id: string, checkpointId: string) => changeVolunteer(db, staff.ADMIN!, { kind: "setCheckpoint", eventId: race.raceId, id, checkpointId }, clock());
/** The plan's list as the three things a reader tells points apart by: the number, the name, where it stands. */
const listed = async (eventId = race.raceId) => (await listPlanPoints(db, eventId)).map((point) => [point.number, point.nameRo, point.startFinish ? "startFinish" : point.planOnly ? "plan" : "editor"]);

/** What a refused press said: the code, the rule's own sentence and the box — and that nothing was written. */
async function refusal(press: Promise<unknown>): Promise<{ code: string; reason: string | null; fields: readonly string[] }> {
  try {
    await press;
  } catch (error) {
    const known = error as { code: string; fields: readonly string[]; reason?: string };
    return { code: known.code, reason: error instanceof PlanPointRefusal || error instanceof CoordinatesRefusal || error instanceof PlanPointGone ? error.reason : null, fields: known.fields };
  }
  throw new Error("expected a refusal");
}

describe("§NNN the plan's one list: every point, one order, one number", () => {
  it("reads the editor's points as the route, numbered by distance — exactly what the plan numbered before", async () => {
    const points = await listPlanPoints(db, race.raceId);
    expect(points.map((point) => [point.number, point.nameRo, point.nameEn, point.km])).toEqual([
      [1, "Intersecția Stejeriș", "Stejeriș junction", 1.2],
      [2, "Apă la cabană", "Water at the hut", 5.5],
      [3, "Podul de lemn", "The wooden bridge", 7.25],
    ]);
    for (const point of points) expect(point).toMatchObject({ planOnly: false, startFinish: false, latitude: null, longitude: null });
    // What an editor's point offers and its note are read with it: the plan's page says them.
    expect(points[0]).toMatchObject({ id: race.points.junction, kinds: ["DIRECTION"], noteRo: "Mașinile vin din stânga: ține alergătorii pe dreapta." });
    expect(points[1]).toMatchObject({ id: race.points.water, kinds: ["WATER"], noteRo: null, noteEn: null });
  });

  it("puts the start–finish points first, in the order they were added and with no number; then the route by kilometre — at one kilometre the editor's first, then the plan's own as they were added", async () => {
    // Every one added in the same instant: the order is the order of the presses, never the clock's or an id's.
    frozen = true;
    await add({ place: "route", name: "Curba A", km: "5,5" });
    await add({ place: "startFinish", name: "Kituri", km: "" });
    await add({ place: "route", name: "Izvor", km: "3.4" });
    await add({ place: "startFinish", name: "Linia de start" });
    await add({ place: "route", name: "Curba B", km: "5.50" });
    await add({ place: "route", name: "Vârf", km: "12" });
    await add({ place: "route", name: "Poarta", km: "0" });

    expect(await listed()).toEqual([
      [null, "Kituri", "startFinish"],
      [null, "Linia de start", "startFinish"],
      [1, "Poarta", "plan"],
      [2, "Intersecția Stejeriș", "editor"],
      [3, "Izvor", "plan"],
      // Kilometre 5.5: the editor's point, then the plan's own two in the order they were added.
      [4, "Apă la cabană", "editor"],
      [5, "Curba A", "plan"],
      [6, "Curba B", "plan"],
      [7, "Podul de lemn", "editor"],
      [8, "Vârf", "plan"],
    ]);
    // The same on every read.
    expect(await listed()).toEqual(await listed());
  });

  it("keeps the editor's own order among its points at one kilometre, and the plan's own after them", async () => {
    // Two more editor's points at the water's kilometre, in the order the editor numbered them (`position`).
    await db.insert(eventCheckpoints).values([
      { eventId: race.raceId, km: "5.50", nameRo: "Cronometru", nameEn: "Timing", kinds: ["TIMING"], position: 2 },
      { eventId: race.raceId, km: "5.50", nameRo: "Prim ajutor", nameEn: "First aid", kinds: ["FIRST_AID"], position: 1 },
    ]);
    await add({ name: "Curba", km: "5.5" });
    expect((await listed()).filter(([, name]) => !["Intersecția Stejeriș", "Podul de lemn"].includes(name as string))).toEqual([
      [2, "Apă la cabană", "editor"],
      [3, "Prim ajutor", "editor"],
      [4, "Cronometru", "editor"],
      [5, "Curba", "plan"],
    ]);
  });

  it("says no kilometre of a start–finish point, whatever its column holds, and never orders by it", async () => {
    const kits = await added({ place: "startFinish", name: "Kituri" });
    const start = await added({ place: "startFinish", name: "Linia de start" });
    // The column holds 0 and nobody reads it — not even when something else wrote a number there.
    await db.update(eventCheckpoints).set({ km: "42.00" }).where(eq(eventCheckpoints.id, kits));
    const points = await listPlanPoints(db, race.raceId);
    expect(points.slice(0, 2).map((point) => [point.id, point.km, point.number])).toEqual([
      [kits, 0, null],
      [start, 0, null],
    ]);
  });

  it("reads one event's points alone, and none for an event that has none", async () => {
    await add({ name: "Izvor" });
    expect(await listed(race.otherId)).toEqual([[1, "Punctul altui eveniment", "editor"]]);
    await db.delete(eventCheckpoints).where(eq(eventCheckpoints.eventId, race.otherId));
    expect(await listPlanPoints(db, race.otherId)).toEqual([]);
  });

  it("is what the plan reads: the same points, the same numbers, each with its people", async () => {
    const kits = await added({ place: "startFinish", name: "Kituri" });
    await add({ name: "Izvor", km: "3.4" });
    await place(race.people.radu, kits);
    const plan = await readVolunteerPlan(db, staff.MODERATOR!, race.raceId);
    expect(plan.points.map(({ number, point }) => [number, point.nameRo])).toEqual((await listPlanPoints(db, race.raceId)).map((point) => [point.number, point.nameRo]));
    expect(plan.points.map(({ number, point }) => [number, point.number])).toEqual([
      [null, null],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    // Radu stands at the start–finish: at a point, and no longer under «Fără punct».
    expect(plan.points[0].people.map((person) => person.name)).toEqual(["Radu Liber"]);
    expect(plan.unplaced.map((person) => person.name)).toEqual([]);
  });
});

describe("§NNN «Adaugă punctul»", () => {
  it("adds a point on the route: the plan's own, the one name in both columns, nothing of the public table — and audits it", async () => {
    const before = await rowsOf();
    const result = await add({ place: "route", name: "Intersecția de la izvor", km: "3,4", coordinates: "" });
    expect(result).toEqual({ changed: true, outcome: "added", id: expect.any(String) });

    const row = await rowOf(result.id);
    expect(row).toMatchObject({
      eventId: race.raceId,
      planOnly: true,
      startFinish: false,
      // The organizers' own word for a place, published nowhere: the same in both columns.
      nameRo: "Intersecția de la izvor",
      nameEn: "Intersecția de la izvor",
      km: "3.40",
      latitude: null,
      longitude: null,
      // No kinds, no limit, no note, and never on the route's chart.
      kinds: [],
      cutoffMinutes: null,
      cutoffTime: null,
      noteRo: null,
      noteEn: null,
      onProfile: false,
      position: 0,
    });
    // The instant the press was made, as the caller handed it in.
    expect(row.createdAt.getTime()).toBe(NOW.getTime() + 1000);
    // The editor's three points are as they were, to the last column.
    expect((await rowsOf()).filter((other) => other.id !== result.id)).toEqual(before);

    const rows = await trail();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "volunteer_plan.point_added", actorStaffUserId: staff.MODERATOR!.id, entityType: "event", entityId: race.raceId });
    expect(rows[0].metadataJson).toEqual({
      pointId: result.id,
      planOnly: true,
      from: null,
      to: { place: "route", name: "Intersecția de la izvor", km: 3.4, latitude: null, longitude: null },
    });
  });

  it("adds a point at the start–finish with its coordinates: no kilometre is read — whatever was posted — and 0 is stored", async () => {
    for (const [name, posted] of [
      ["Kituri", "12,5"],
      ["Linia de start", ""],
      ["Linia de sosire", "nu știu"],
      ["Garderobă", undefined],
    ] as const) {
      const result = await add({ place: "startFinish", name, km: posted, coordinates: PIATA });
      expect(await rowOf(result.id), name).toMatchObject({ planOnly: true, startFinish: true, nameRo: name, nameEn: name, km: "0.00", latitude: "45.642710", longitude: "25.588710", onProfile: false, kinds: [] });
    }
    // Added one after another: each takes the next place in the order they were added.
    expect((await rowsOf()).filter((row) => row.planOnly).map((row) => [row.nameRo, row.position])).toEqual([
      ["Kituri", 0],
      ["Linia de start", 1],
      ["Linia de sosire", 2],
      ["Garderobă", 3],
    ]);
    expect((await trail())[0].metadataJson).toMatchObject({ planOnly: true, from: null, to: { place: "startFinish", name: "Kituri", km: null, latitude: 45.64271, longitude: 25.58871 } });
  });

  it("reads the coordinates as a maps application copies them, and keeps six decimals", async () => {
    const pasted = await added({ name: "A", coordinates: `45°38'33.8"N 25°35'19.4"E` });
    expect(await rowOf(pasted)).toMatchObject({ latitude: "45.642722", longitude: "25.588722" });
    const linked = await added({ name: "B", coordinates: "https://www.google.com/maps/@45.64271,25.58871,17z" });
    expect(await rowOf(linked)).toMatchObject({ latitude: "45.642710", longitude: "25.588710" });
    const points = await listPlanPoints(db, race.raceId);
    expect(points.find((point) => point.id === pasted)).toMatchObject({ latitude: 45.642722, longitude: 25.588722 });
    expect(points.find((point) => point.id === linked)).toMatchObject({ latitude: 45.64271, longitude: 25.58871 });
  });

  it("trims the name and folds its inner spaces; one to sixty characters, anything else refused naming the box", async () => {
    const tidy = await added({ name: "  Intersecția \t de   la\nizvor  " });
    expect(await rowOf(tidy)).toMatchObject({ nameRo: "Intersecția de la izvor", nameEn: "Intersecția de la izvor" });
    const sixty = "x".repeat(60);
    expect(await rowOf(await added({ name: `  ${sixty}  ` }))).toMatchObject({ nameRo: sixty });

    const before = await rowsOf();
    for (const name of ["", "   ", "\n\t", "x".repeat(61), undefined, null, 7, ["Izvor"]]) {
      expect(await refusal(add({ name })), JSON.stringify(name)).toEqual({ code: "VALIDATION_ERROR", reason: "PLAN_POINT_NAME_MISSING", fields: ["name"] });
    }
    expect(await rowsOf()).toEqual(before);
    expect(await trail()).toHaveLength(2);
  });

  it("asks the kilometre of a point on the route — a comma or a point, two decimals, 0 to 9999.99 — and holds it to no route's length", async () => {
    // The event's route is ten kilometres long: the editor would refuse a point past it; the plan is the organizers' own.
    await db.update(events).set({ distanceMeters: 10_000 }).where(eq(events.id, race.raceId));
    for (const [typed, stored] of [
      ["5,5", "5.50"],
      ["5.5", "5.50"],
      ["0", "0.00"],
      ["12.50 km", "12.50"],
      ["25", "25.00"],
      ["9999.99", "9999.99"],
      [" 3,25 ", "3.25"],
    ] as const) {
      expect((await rowOf(await added({ name: `km ${typed}`, km: typed }))).km, typed).toBe(stored);
    }
    const before = await rowsOf();
    for (const km of ["", "   ", "abc", "-1", "10000", "5.555", "5,5,5", "1e3", undefined, null, 5]) {
      expect(await refusal(add({ km })), JSON.stringify(km)).toEqual({ code: "VALIDATION_ERROR", reason: "PLAN_POINT_KM_INVALID", fields: ["km"] });
    }
    expect(await rowsOf()).toEqual(before);
  });

  it("refuses a place that is neither of the two, coordinates in no shape read, and the first box wrong first", async () => {
    const before = await rowsOf();
    for (const where of ["finish", "", "ROUTE", "start-finish", undefined, null, 1]) {
      expect(await refusal(add({ place: where })), JSON.stringify(where)).toEqual({ code: "VALIDATION_ERROR", reason: "PLAN_POINT_PLACE_UNKNOWN", fields: ["place"] });
    }
    for (const coordinates of ["Piața Sfatului", "45.64271", "95, 25", "https://maps.app.goo.gl/AbCdEf123456"]) {
      expect(await refusal(add({ coordinates })), coordinates).toEqual({ code: "VALIDATION_ERROR", reason: "COORDINATES_INVALID", fields: ["coordinates"] });
      expect(await refusal(add({ place: "startFinish", coordinates })), coordinates).toEqual({ code: "VALIDATION_ERROR", reason: "COORDINATES_INVALID", fields: ["coordinates"] });
    }
    // In the order of the form's boxes: the place, the name, the kilometre, the coordinates.
    expect((await refusal(add({ place: "x", name: "", km: "x", coordinates: "x" }))).reason).toBe("PLAN_POINT_PLACE_UNKNOWN");
    expect((await refusal(add({ name: "", km: "x", coordinates: "x" }))).reason).toBe("PLAN_POINT_NAME_MISSING");
    expect((await refusal(add({ km: "x", coordinates: "x" }))).reason).toBe("PLAN_POINT_KM_INVALID");
    expect((await refusal(add({ coordinates: "x" }))).reason).toBe("COORDINATES_INVALID");
    expect(await rowsOf()).toEqual(before);
    expect(await trail()).toEqual([]);
  });

  it(`takes at most ${PLAN_POINTS_MAX} points of the plan's own on an event, both kinds together — the editor's points are not counted`, async () => {
    for (let at = 0; at < PLAN_POINTS_MAX; at += 1) {
      await add(at % 2 === 0 ? { place: "route", name: `Punct ${at}`, km: String(at) } : { place: "startFinish", name: `Loc ${at}` });
    }
    // Forty of its own beside the editor's three.
    expect((await rowsOf()).length).toBe(PLAN_POINTS_MAX + 3);
    expect(await refusal(add({ name: "Unul în plus" }))).toEqual({ code: "VALIDATION_ERROR", reason: "PLAN_POINT_TOO_MANY", fields: [] });
    expect(await refusal(add({ place: "startFinish", name: "Încă unul" }))).toEqual({ code: "VALIDATION_ERROR", reason: "PLAN_POINT_TOO_MANY", fields: [] });
    expect((await rowsOf()).length).toBe(PLAN_POINTS_MAX + 3);
    // Another event has its own forty.
    expect(await add({ name: "Altundeva" }, staff.ADMIN!, race.otherId)).toMatchObject({ changed: true });
    // One deleted, one more fits — and takes its place after every other, never a number already used.
    const [first] = (await rowsOf()).filter((row) => row.planOnly);
    await remove(first.id);
    const again = await add({ name: "Acum încape" });
    expect(again).toMatchObject({ changed: true, outcome: "added" });
    expect((await rowOf(again.id)).position).toBe(PLAN_POINTS_MAX);
    expect(await refusal(add({ name: "Din nou prea multe" }))).toMatchObject({ reason: "PLAN_POINT_TOO_MANY" });
  });

  it("is not there for an event that is not", async () => {
    expect(await refusal(add({}, staff.ADMIN!, "11111111-1111-4111-8111-111111111111"))).toMatchObject({ code: "NOT_FOUND" });
    expect(await refusal(add({}, staff.ADMIN!, "not-an-id"))).toMatchObject({ code: "NOT_FOUND" });
    expect(await trail()).toEqual([]);
  });
});

describe("§NNN «Salvează punctul»", () => {
  it("changes a point of the plan's own whole — its name, its kilometre, its coordinates — and audits what it said before and after", async () => {
    const id = await added({ name: "Izvor", km: "3,4" });
    expect(await edit(id, { name: "  Izvorul   rece ", km: "4.25", coordinates: PIATA })).toEqual({ changed: true, outcome: "edited", id });
    expect(await rowOf(id)).toMatchObject({ planOnly: true, startFinish: false, nameRo: "Izvorul rece", nameEn: "Izvorul rece", km: "4.25", latitude: "45.642710", longitude: "25.588710", position: 0, onProfile: false });

    const rows = await trail();
    expect(rows.map((row) => row.action)).toEqual(["volunteer_plan.point_added", "volunteer_plan.point_changed"]);
    expect(rows[1]).toMatchObject({ actorStaffUserId: staff.MODERATOR!.id, entityType: "event", entityId: race.raceId });
    expect(rows[1].metadataJson).toEqual({
      pointId: id,
      planOnly: true,
      from: { place: "route", name: "Izvor", km: 3.4, latitude: null, longitude: null },
      to: { place: "route", name: "Izvorul rece", km: 4.25, latitude: 45.64271, longitude: 25.58871 },
    });
    // The coordinates taken off again: an empty box is «none».
    expect(await edit(id, { name: "Izvorul rece", km: "4.25", coordinates: "  " })).toMatchObject({ changed: true });
    expect(await rowOf(id)).toMatchObject({ latitude: null, longitude: null });
  });

  it("moves a point from the route to the start–finish, where it loses its kilometre and its number — and back, where it needs one", async () => {
    const id = await added({ name: "Poarta", km: "0,3", coordinates: PIATA });
    expect((await listed()).find(([, name]) => name === "Poarta")).toEqual([1, "Poarta", "plan"]);

    // To the start–finish: the kilometre posted with it is not read.
    expect(await edit(id, { place: "startFinish", name: "Poarta", km: "0,3", coordinates: PIATA })).toMatchObject({ changed: true, outcome: "edited" });
    expect(await rowOf(id)).toMatchObject({ planOnly: true, startFinish: true, km: "0.00", latitude: "45.642710" });
    expect((await listed())[0]).toEqual([null, "Poarta", "startFinish"]);
    expect((await trail()).at(-1)!.metadataJson).toMatchObject({ from: { place: "route", km: 0.3 }, to: { place: "startFinish", km: null } });

    // Back to the route: without a kilometre it is refused and stays where it was…
    expect(await refusal(edit(id, { place: "route", name: "Poarta", km: "", coordinates: PIATA }))).toEqual({ code: "VALIDATION_ERROR", reason: "PLAN_POINT_KM_INVALID", fields: ["km"] });
    expect(await rowOf(id)).toMatchObject({ startFinish: true, km: "0.00" });
    // …and with one it is a point of the route again, numbered by where it is.
    expect(await edit(id, { place: "route", name: "Poarta", km: "6", coordinates: PIATA })).toMatchObject({ changed: true });
    expect(await rowOf(id)).toMatchObject({ planOnly: true, startFinish: false, km: "6.00" });
    expect((await listed()).find(([, name]) => name === "Poarta")).toEqual([3, "Poarta", "plan"]);
  });

  it("holds an edit of the plan's own point to the same rules as adding one", async () => {
    const id = await added({ name: "Izvor", km: "3,4" });
    const before = await rowOf(id);
    expect(await refusal(edit(id, { name: "" }))).toMatchObject({ reason: "PLAN_POINT_NAME_MISSING", fields: ["name"] });
    expect(await refusal(edit(id, { name: "x".repeat(61) }))).toMatchObject({ reason: "PLAN_POINT_NAME_MISSING" });
    expect(await refusal(edit(id, { km: "departe" }))).toMatchObject({ reason: "PLAN_POINT_KM_INVALID", fields: ["km"] });
    expect(await refusal(edit(id, { place: "undeva" }))).toMatchObject({ reason: "PLAN_POINT_PLACE_UNKNOWN", fields: ["place"] });
    expect(await refusal(edit(id, { coordinates: "nicăieri" }))).toMatchObject({ reason: "COORDINATES_INVALID", fields: ["coordinates"] });
    expect(await rowOf(id)).toEqual(before);
    expect(await trail()).toHaveLength(1);
  });

  it("changes ONLY the coordinates of an editor's point: a posted name, kilometre or place for it is never read and never written", async () => {
    const before = await rowOf(race.points.water);
    // Everything a forged form could post beside the coordinates — none of it valid, none of it read.
    expect(await edit(race.points.water, { place: "startFinish", name: "ALT NUME", km: "99", coordinates: PIATA })).toEqual({ changed: true, outcome: "edited", id: race.points.water });
    expect(await rowOf(race.points.water)).toEqual({ ...before, latitude: "45.642710", longitude: "25.588710" });
    // Words that would be refused of a plan's own point are not even looked at here.
    expect(await edit(race.points.water, { place: "nicăieri", name: "", km: "x", coordinates: "45.5, 25.5" })).toMatchObject({ changed: true });
    expect(await rowOf(race.points.water)).toEqual({ ...before, latitude: "45.500000", longitude: "25.500000" });
    // Still the editor's public point of the route, where it was.
    expect((await listed()).find(([, name]) => name === "Apă la cabană")).toEqual([2, "Apă la cabană", "editor"]);

    const rows = await trail();
    expect(rows.map((row) => row.action)).toEqual(["volunteer_plan.point_changed", "volunteer_plan.point_changed"]);
    expect(rows[0].metadataJson).toEqual({
      pointId: race.points.water,
      planOnly: false,
      from: { place: "route", name: "Apă la cabană", km: 5.5, latitude: null, longitude: null },
      to: { place: "route", name: "Apă la cabană", km: 5.5, latitude: 45.64271, longitude: 25.58871 },
    });
    // The coordinates are the one box held to a rule, and the one box that can be emptied.
    expect(await refusal(edit(race.points.water, { coordinates: "nicăieri" }))).toEqual({ code: "VALIDATION_ERROR", reason: "COORDINATES_INVALID", fields: ["coordinates"] });
    expect(await edit(race.points.water, { coordinates: "" })).toMatchObject({ changed: true });
    expect(await rowOf(race.points.water)).toEqual(before);
  });

  it("writes nothing and audits nothing for a press that changes nothing", async () => {
    const id = await added({ place: "route", name: "Izvor", km: "3,4", coordinates: PIATA });
    const kits = await added({ place: "startFinish", name: "Kituri" });
    await edit(race.points.water, { coordinates: PIATA });
    const rows = await rowsOf();
    const audited = (await trail()).length;

    // The same words, typed the same or another way.
    expect(await edit(id, { place: "route", name: "Izvor", km: "3,4", coordinates: PIATA })).toEqual({ changed: false, id });
    expect(await edit(id, { place: "route", name: "  Izvor ", km: "3.40 km", coordinates: "45.642710,25.588710" })).toEqual({ changed: false, id });
    expect(await edit(id, { place: "route", name: "Izvor", km: "3.4", coordinates: "45,64271; 25,58871" })).toEqual({ changed: false, id });
    // A start–finish point: its kilometre is not read, so a posted one changes nothing.
    expect(await edit(kits, { place: "startFinish", name: "Kituri", km: "7", coordinates: "" })).toEqual({ changed: false, id: kits });
    // An editor's point with the coordinates it has — whatever else was posted.
    expect(await edit(race.points.water, { place: "startFinish", name: "Alt nume", km: "1", coordinates: PIATA })).toEqual({ changed: false, id: race.points.water });
    expect(await edit(race.points.bridge, { coordinates: "" })).toEqual({ changed: false, id: race.points.bridge });

    expect(await rowsOf()).toEqual(rows);
    expect(await trail()).toHaveLength(audited);
  });

  it("is NOT_FOUND for another event's point, a point that is not there and a value that is no id — nothing written", async () => {
    const id = await added({ name: "Izvor" });
    const before = await rowsOf();
    const elsewhere = await rowOf(race.points.elsewhere);
    // Another event's point, under this event; and this event's point, under the other. NOT_FOUND, said on the page as a
    // point no longer on the plan (`PLAN_POINT_GONE`) — never as a registration that is gone.
    const gone = { code: "NOT_FOUND", reason: "PLAN_POINT_GONE" };
    expect(await refusal(edit(race.points.elsewhere, { coordinates: PIATA }))).toMatchObject(gone);
    expect(await refusal(edit(id, { name: "Furat" }, staff.ADMIN!, race.otherId))).toMatchObject(gone);
    for (const missing of ["11111111-1111-4111-8111-111111111111", "not-an-id", "", undefined, null, 7]) {
      expect(await refusal(edit(missing, { coordinates: PIATA })), JSON.stringify(missing)).toMatchObject(gone);
      expect(await refusal(remove(missing)), JSON.stringify(missing)).toMatchObject(gone);
    }
    // An event that is not there is the domain's own NOT_FOUND: no page of it to say anything on.
    expect(await refusal(edit(id, {}, staff.ADMIN!, "11111111-1111-4111-8111-111111111111"))).toMatchObject({ code: "NOT_FOUND", reason: null });
    expect(await rowsOf()).toEqual(before);
    expect(await rowOf(race.points.elsewhere)).toEqual(elsewhere);
    expect(await trail()).toHaveLength(1);
  });
});

describe("§NNN «Șterge punctul»", () => {
  it("deletes a point of the plan's own: its people stand at no point again, and the result and the trail say how many — never who", async () => {
    const kits = await added({ place: "startFinish", name: "Kituri", coordinates: PIATA });
    await place(race.people.radu, kits);
    await place(race.people.ana, kits);
    // Placed there and cancelled since: on no plan, yet the row keeps the point until the point goes.
    await place(race.people.dan, kits);
    await db.update(eventVolunteers).set({ state: "CANCELLED" }).where(eq(eventVolunteers.id, race.people.dan));
    const others = (await rowsOf()).filter((row) => row.id !== kits);

    expect(await remove(kits)).toEqual({ changed: true, outcome: "removed", id: kits, freed: 2 });
    expect(await rowOf(kits)).toBeUndefined();
    // The reference's own ON DELETE SET NULL: everybody who named the point names none — the cancelled row too.
    for (const person of [race.people.radu, race.people.ana, race.people.dan]) expect((await personOf(person)).checkpointId).toBeNull();
    // Nobody else moved, and no other point changed.
    expect((await personOf(race.people.ion)).checkpointId).toBe(race.points.bridge);
    expect(await rowsOf()).toEqual(others);
    const plan = await readVolunteerPlan(db, staff.MODERATOR!, race.raceId);
    expect(plan.unplaced.map((person) => person.name)).toEqual(["Ana Pop", "Radu Liber"]);

    const last = (await trail()).at(-1)!;
    expect(last).toMatchObject({ action: "volunteer_plan.point_removed", actorStaffUserId: staff.MODERATOR!.id, entityType: "event", entityId: race.raceId });
    expect(last.metadataJson).toEqual({
      pointId: kits,
      planOnly: true,
      from: { place: "startFinish", name: "Kituri", km: null, latitude: 45.64271, longitude: 25.58871 },
      to: null,
      freed: 2,
    });
    // A count, never a person: no name, no address, no volunteer's id.
    const said = JSON.stringify(last.metadataJson);
    for (const person of ["Radu", "Ana", "Dan", race.people.radu, race.people.ana, race.people.dan, planAddressOf("Radu Liber")]) expect(said).not.toContain(person);
  });

  it("deletes a point nobody stands at, freeing nobody", async () => {
    const id = await added({ name: "Izvor" });
    expect(await remove(id)).toEqual({ changed: true, outcome: "removed", id, freed: 0 });
    expect((await trail()).at(-1)!.metadataJson).toMatchObject({ freed: 0, to: null });
  });

  it("refuses an editor's point — it is deleted in the editor — and leaves it and its people where they were", async () => {
    const before = await rowsOf();
    expect(await refusal(remove(race.points.junction))).toEqual({ code: "VALIDATION_ERROR", reason: "PLAN_POINT_IN_EDITOR", fields: [] });
    expect(await rowsOf()).toEqual(before);
    expect((await personOf(race.people.ana)).checkpointId).toBe(race.points.junction);
    expect(await trail()).toEqual([]);
  });
});

describe("§NNN who may change the plan's points (BR-REQ-060-01)", () => {
  it("refuses the Tehnic role, the Redactor, a desk Volunteer and a member before anything is read — nothing written, nothing audited", async () => {
    const id = await added({ name: "Izvor" });
    const before = await rowsOf();
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      const actor = staff[role]!;
      expect(await refusal(add({ name: "Al meu" }, actor)), role).toMatchObject({ code: "FORBIDDEN" });
      expect(await refusal(edit(id, { name: "Al meu" }, actor)), role).toMatchObject({ code: "FORBIDDEN" });
      expect(await refusal(edit(race.points.water, { coordinates: PIATA }, actor)), role).toMatchObject({ code: "FORBIDDEN" });
      expect(await refusal(remove(id, actor)), role).toMatchObject({ code: "FORBIDDEN" });
      // Refused before the event, the point or what was typed is so much as looked at.
      expect(await refusal(add({ name: "" }, actor, "not-an-id")), role).toMatchObject({ code: "FORBIDDEN" });
      expect(await refusal(edit("not-an-id", { km: "x" }, actor, "11111111-1111-4111-8111-111111111111")), role).toMatchObject({ code: "FORBIDDEN" });
      expect(await refusal(remove("not-an-id", actor, "not-an-id")), role).toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await rowsOf()).toEqual(before);
    expect(await trail()).toHaveLength(1);
  });

  it("is the Organizer's and both Administrators' to do", async () => {
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      const result = await add({ name: `Al lui ${role}` }, staff[role]!);
      expect(await edit(result.id, { name: `Schimbat de ${role}` }, staff[role]!), role).toMatchObject({ changed: true });
      expect(await remove(result.id, staff[role]!), role).toMatchObject({ changed: true, outcome: "removed" });
    }
    expect((await trail()).map((row) => row.actorStaffUserId)).toEqual([staff.MODERATOR!.id, staff.MODERATOR!.id, staff.MODERATOR!.id, staff.ADMIN!.id, staff.ADMIN!.id, staff.ADMIN!.id, staff.SUPERADMIN!.id, staff.SUPERADMIN!.id, staff.SUPERADMIN!.id]);
  });
});

describe("§NNN nothing else moves: nobody is emailed and no public cache tag is expired", () => {
  it("queues no email and expires no tag — adding, changing, moving between the kinds and deleting a point people with an address stand at", async () => {
    const kits = await added({ place: "startFinish", name: "Kituri" });
    // Ana and Radu have an address and a role given: everything a message to them would need.
    await place(race.people.ana, kits);
    await place(race.people.radu, kits);
    expect(await personOf(race.people.ana)).toMatchObject({ email: planAddressOf("Ana Pop"), state: "CONFIRMED" });
    const before = { ana: await personOf(race.people.ana), radu: await personOf(race.people.radu) };

    await edit(kits, { place: "startFinish", name: "Kituri și numere", coordinates: PIATA });
    await edit(kits, { place: "route", name: "Kituri și numere", km: "0,1", coordinates: PIATA });
    await edit(race.points.junction, { coordinates: PIATA });
    await add({ name: "Izvor", km: "3,4" });
    // Nothing of a person moved by a point being changed under them: not the state, the number, the roles' row, the tick.
    expect(await personOf(race.people.ana)).toEqual(before.ana);
    expect(await personOf(race.people.radu)).toEqual(before.radu);
    await remove(kits);

    expect(await db.select().from(emailOutbox)).toEqual([]);
    expect(revalidateTag).not.toHaveBeenCalled();
    // The service names no page either: the Server Action alone refreshes the plan's own.
    expect(revalidatePath).not.toHaveBeenCalled();

    // Beside a press that does expire one, so «none» above is the verbs' doing: a volunteer cancelled moves what the public page counts.
    await changeVolunteer(db, staff.ADMIN!, { kind: "setState", eventId: race.raceId, id: race.people.radu, state: "CANCELLED" }, NOW, { sendEmail: false });
    expect(vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag)).toContain("public:places");
  });
});

describe("§NNN a person at a point of the plan's own", () => {
  it("is placed there, moved and taken off exactly as at an editor's point — audited the same way, telling nobody", async () => {
    const izvor = await added({ place: "route", name: "Izvor", km: "3,4" });
    const kits = await added({ place: "startFinish", name: "Kituri" });
    const edits = async () => (await db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt))).filter((row) => row.action === "volunteer.edited");

    expect(await place(race.people.radu, izvor)).toMatchObject({ changed: true });
    expect((await personOf(race.people.radu)).checkpointId).toBe(izvor);
    expect(await place(race.people.radu, kits)).toMatchObject({ changed: true });
    expect((await personOf(race.people.radu)).checkpointId).toBe(kits);
    expect((await edits()).map((row) => row.metadataJson)).toEqual([
      expect.objectContaining({ volunteerId: race.people.radu, fields: ["checkpoint"], checkpointId: izvor }),
      expect.objectContaining({ volunteerId: race.people.radu, fields: ["checkpoint"], checkpointId: kits }),
    ]);
    // Another event's own point is no point of this plan, whichever kind it is.
    const elsewhere = (await add({ place: "startFinish", name: "Kituri" }, staff.ADMIN!, race.otherId)).id;
    await expect(place(race.people.radu, elsewhere)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await personOf(race.people.radu)).checkpointId).toBe(kits);
    // Taken off: under «Fără punct» again.
    expect(await place(race.people.radu, "")).toMatchObject({ changed: true });
    expect((await readVolunteerPlan(db, staff.MODERATOR!, race.raceId)).unplaced.map((person) => person.name)).toEqual(["Radu Liber"]);
    expect(await db.select().from(emailOutbox)).toEqual([]);
  });

  it("names the point when the person asks for their data — by the name the organizers typed (art. 15 GDPR)", async () => {
    const kits = await added({ place: "startFinish", name: "Kituri și numere" });
    await place(race.people.radu, kits);
    const data = await viewPersonData(db, staff.ADMIN!, planAddressOf("Radu Liber"), NOW);
    expect(data.volunteerOffers.map((offer) => offer.checkpointName)).toEqual(["Kituri și numere"]);
    // …and none again once the point is deleted.
    await remove(kits);
    expect((await viewPersonData(db, staff.ADMIN!, planAddressOf("Radu Liber"), NOW)).volunteerOffers.map((offer) => offer.checkpointName)).toEqual([null]);
  });
});

describe("§NNN the words a refusal is said with", () => {
  it("has a sentence in both catalogues for every reason, and fills what the sentence counts", () => {
    for (const reason of [...PLAN_POINT_REASONS, "COORDINATES_INVALID", new PlanPointGone().reason]) {
      for (const [locale, catalogue] of [
        ["ro", ro],
        ["en", en],
      ] as const) {
        const sentence = (catalogue.Admin.errors as Record<string, string>)[reason];
        expect(sentence, `${locale}: Admin.errors.${reason}`).toBeTruthy();
        // Every placeholder of the sentence has a value: the page never prints «{max}».
        const filled = sentence.replace(/\{(\w+)\}/g, (whole, name: string) => planPointRefusalValues(reason)[name] ?? whole);
        expect(filled, `${locale}: ${reason}`).not.toMatch(/\{\w+\}/);
      }
    }
    expect(planPointRefusalValues("PLAN_POINT_NAME_MISSING")).toEqual({ max: "60" });
    expect(planPointRefusalValues("PLAN_POINT_TOO_MANY")).toEqual({ max: String(PLAN_POINTS_MAX) });
    expect(planPointRefusalValues("NOT_FOUND")).toEqual({});
    expect(new PlanPointRefusal("PLAN_POINT_TOO_MANY", []).values).toEqual({ max: "40" });
    const places: PlanPointPlace[] = ["route", "startFinish"];
    expect(places).toHaveLength(2);
  });

  it("holds the database to the same two kinds: a start–finish point that is not the plan's own cannot be written", async () => {
    await expect(db.update(eventCheckpoints).set({ startFinish: true }).where(and(eq(eventCheckpoints.id, race.points.water)))).rejects.toThrow();
    expect(await rowOf(race.points.water)).toMatchObject({ planOnly: false, startFinish: false });
  });
});
