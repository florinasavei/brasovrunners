import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import type { FormOutcome } from "@/shared/forms/outcome";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, BR-REQ-011-01 and BR-REQ-060-01 — an event's checkpoints, through the real Server Actions:
 * saved as the card posts them (added, changed, ticked «Scoate»), a kilometre beyond the route and a
 * cut-off before the start or after a later point's refused naming the box with the sentence's own
 * numbers, every change audited, a save that never deletes a point it was not told about, the role
 * asserted by the service whatever the card drew (the Administrator and the Organizer write, the
 * Tehnic, the Redactor and the volunteer are refused), the GPX's waypoints taken as a preview and then
 * as what the club ticked, and the picture stamp moving with every one. The session and navigation
 * stand-ins are `event-todos.test.ts`'s.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, redirected: [] as string[], flashed: [] as string[] }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: (_name: string, value: string) => {
      state.flashed.push(decodeURIComponent(value));
    },
    delete: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { addGpxCheckpointsAction, saveCheckpointsAction } = await import("@/app/[locale]/admin/events/[id]/checkpoint-actions");
const { listCheckpoints } = await import("@/modules/event-checkpoints/checkpoints");
const { clearGpxWaypointsCache, loadGpxWaypoints } = await import("@/modules/event-checkpoints/gpx-file");
const { BIB_STAMP } = await import("@/modules/events/repository");
const { getStorage } = await import("@/modules/media/storage");
const { storeRouteGpx } = await import("@/modules/content/events/route-gpx");

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
let otherEventId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function person(role: StaffRole, name: string): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
  return row;
}

/** A 21.1 km race starting at 09:00 on its own clock (Bucharest, winter time) and ending at 12:00. */
beforeEach(async () => {
  await resetTables(db);
  clearGpxWaypointsCache();
  staff.ADMIN = await person("ADMIN", "Ana Admin");
  staff.MODERATOR = await person("MODERATOR", "Oana Organizator");
  staff.DEV = await person("DEV", "Tudor Tehnic");
  staff.COPYWRITER = await person("COPYWRITER", "Radu Redactor");
  staff.CONTRIBUTOR = await person("CONTRIBUTOR", "Vlad Voluntar");
  const [first, second] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date("2026-11-21T07:00:00.000Z"), endsAt: new Date("2026-11-21T10:00:00.000Z"), distanceMeters: 21_100 },
      { type: "RACE", startsAt: new Date("2026-12-05T07:00:00.000Z"), distanceMeters: 10_000 },
    ])
    .returning({ id: events.id });
  eventId = first.id;
  otherEventId = second.id;
  state.actor = staff.ADMIN;
  state.redirected.length = 0;
  state.flashed.length = 0;
});

type Row = { id?: string; nameRo?: string; nameEn?: string; km?: string; kinds?: string[]; cutoff?: string; noteRo?: string; noteEn?: string; remove?: boolean };

/** The card's form: one row per entry, numbered from 0, with the boxes' own names. */
function form(rows: Row[], extra: Record<string, string> = {}, forEvent = eventId): FormData {
  const data = new FormData();
  data.set("uiLocale", "ro");
  data.set("eventId", forEvent);
  rows.forEach((row, index) => {
    data.set(`cp[${index}].id`, row.id ?? "");
    data.set(`cp[${index}].nameRo`, row.nameRo ?? "");
    data.set(`cp[${index}].nameEn`, row.nameEn ?? "");
    data.set(`cp[${index}].km`, row.km ?? "");
    for (const kind of row.kinds ?? []) data.append(`cp[${index}].kinds`, kind);
    data.set(`cp[${index}].cutoff`, row.cutoff ?? "");
    data.set(`cp[${index}].noteRo`, row.noteRo ?? "");
    data.set(`cp[${index}].noteEn`, row.noteEn ?? "");
    if (row.remove) data.set(`cp[${index}].remove`, "on");
  });
  for (const [name, value] of Object.entries(extra)) data.set(name, value);
  return data;
}

const WATER: Row = { nameRo: "Apă", nameEn: "Water", km: "5", kinds: ["WATER"], cutoff: "10:00" };
const FOOD: Row = { nameRo: "Mâncare", nameEn: "Food", km: "12,5", kinds: ["FOOD", "WATER"], cutoff: "11:15", noteRo: "Banane", noteEn: "Bananas" };

/** Runs an action that redirects on success and returns its refusal otherwise. */
async function post(action: (previous: FormOutcome | null, form: FormData) => Promise<FormOutcome | null>, data: FormData) {
  return action(null, data).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
}

const save = (rows: Row[], extra: Record<string, string> = {}) => post(saveCheckpointsAction, form(rows, extra));
const trail = () => db.select().from(auditLogs).where(eq(auditLogs.entityId, eventId)).orderBy(auditLogs.createdAt);
const actions = async () => (await trail()).map((row) => row.action);

describe("§NNN an event's checkpoints", () => {
  it("adds two points with a cut-off each, in distance order, and audits it", async () => {
    // Typed out of order, with a comma and spare blank rows at the foot, as the card posts them.
    expect(await save([FOOD, WATER, {}, {}])).toBe("redirected");
    expect(state.redirected[0]).toContain("#box-checkpoints");
    const rows = await listCheckpoints(db, eventId);
    expect(rows.map((row) => [row.km, row.nameRo, row.nameEn, row.cutoff])).toEqual([
      [5, "Apă", "Water", "10:00"],
      [12.5, "Mâncare", "Food", "11:15"],
    ]);
    // The closed set's own order, whatever order the boxes were ticked in; the note in both languages.
    expect(rows[1].kinds).toEqual(["WATER", "FOOD"]);
    expect(rows[1]).toMatchObject({ noteRo: "Banane", noteEn: "Bananas" });
    expect(rows[0]).toMatchObject({ noteRo: null, noteEn: null });
    const [row] = await trail();
    expect(row).toMatchObject({ action: "event_checkpoints.changed", entityType: "event", actorStaffUserId: staff.ADMIN!.id });
    expect(row.metadataJson).toMatchObject({
      added: 2,
      edited: 0,
      removed: 0,
      source: "form",
      to: [
        { km: 5, name: "Apă", cutoff: "10:00" },
        { km: 12.5, name: "Mâncare", cutoff: "11:15" },
      ],
    });
    expect(state.flashed.join("|")).toContain("checkpointsSaved");
  });

  it("stores the cut-off as a time of the day and the position as the order by distance", async () => {
    await save([FOOD, WATER]);
    const stored = await db.select().from(eventCheckpoints).where(eq(eventCheckpoints.eventId, eventId));
    expect(stored.map((row) => row.cutoffTime).sort()).toEqual(["10:00:00", "11:15:00"]);
    expect([...stored].sort((a, b) => a.position - b.position).map((row) => row.nameRo)).toEqual(["Apă", "Mâncare"]);
  });

  it("refuses a kilometre beyond the route, with the reason and the length, naming the box and keeping what was typed", async () => {
    const refusal = await save([{ ...WATER, km: "22,5", nameRo: "Dincolo" }]);
    expect(refusal).toMatchObject({
      error: "CHECKPOINT_KM_BEYOND_ROUTE",
      errorValues: { name: "Dincolo", km: "22.5", max: "21.1" },
      fields: ["cp[0].km"],
    });
    expect((refusal as FormOutcome).values["cp[0].km"]).toEqual(["22,5"]);
    expect(await listCheckpoints(db, eventId)).toEqual([]);
    expect(await actions()).toEqual([]);
  });

  it("measures the kilometre against the GPX's length when the club typed no distance", async () => {
    await db.update(events).set({ distanceMeters: null, routeGpx: await uploadTrack("") }).where(eq(events.id, eventId));
    // The track is 3.11 km long.
    expect(await save([{ ...WATER, km: "3,2", cutoff: "" }])).toMatchObject({ error: "CHECKPOINT_KM_BEYOND_ROUTE", errorValues: { max: "3.11" } });
    expect(await save([{ ...WATER, km: "3", cutoff: "" }])).toBe("redirected");
  });

  it("refuses a cut-off at or before the start, one that is not a time, and one after the event's end", async () => {
    expect(await save([{ ...WATER, cutoff: "08:30" }])).toMatchObject({ error: "CHECKPOINT_CUTOFF_BEFORE_START", fields: ["cp[0].cutoff"] });
    expect(await save([{ ...WATER, cutoff: "09:00" }])).toMatchObject({ error: "CHECKPOINT_CUTOFF_BEFORE_START", errorValues: { cutoff: "09:00" } });
    expect(await save([{ ...WATER, cutoff: "noon" }])).toMatchObject({ error: "CHECKPOINT_CUTOFF_INVALID" });
    expect(await save([{ ...WATER, cutoff: "12:30" }])).toMatchObject({ error: "CHECKPOINT_CUTOFF_AFTER_END" });
    expect(await listCheckpoints(db, eventId)).toEqual([]);
  });

  it("counts the cut-offs from the race's gun when the race has one", async () => {
    await db.update(events).set({ raceStartsAt: new Date("2026-11-21T08:00:00.000Z") }).where(eq(events.id, eventId));
    // The event starts at 09:00 but the gun is at 10:00: 09:30 is before it.
    expect(await save([{ ...WATER, cutoff: "09:30" }])).toMatchObject({ error: "CHECKPOINT_CUTOFF_BEFORE_START" });
    expect(await save([{ ...WATER, cutoff: "10:30" }])).toBe("redirected");
  });

  it("refuses a cut-off after the one of a point further along, naming the earlier point's box", async () => {
    const refusal = await save([
      { ...WATER, nameRo: "Prima", cutoff: "11:00" },
      { ...FOOD, nameRo: "A doua", cutoff: "10:30" },
    ]);
    expect(refusal).toMatchObject({
      error: "CHECKPOINT_CUTOFF_AFTER_LATER",
      errorValues: { name: "Prima", later: "A doua", laterCutoff: "10:30" },
      fields: ["cp[0].cutoff"],
    });
    expect(await listCheckpoints(db, eventId)).toEqual([]);
  });

  it("holds the rules to the whole list that will be there, not only the rows the form named", async () => {
    await save([WATER, FOOD]);
    // A stale form that only knows a new point at km 8 with a cut-off after the saved point at km 12.5.
    expect(await save([{ nameRo: "Nou", nameEn: "New", km: "8", cutoff: "11:30" }])).toMatchObject({ error: "CHECKPOINT_CUTOFF_AFTER_LATER" });
    expect(await listCheckpoints(db, eventId)).toHaveLength(2);
  });

  it("refuses a missing name in either language and a note in one language only, naming the box", async () => {
    expect(await save([{ ...WATER, nameEn: "" }])).toMatchObject({ error: "CHECKPOINT_NAME_MISSING", fields: ["cp[0].nameEn"] });
    expect(await save([{ ...WATER, noteRo: "doar română" }])).toMatchObject({ error: "CHECKPOINT_NOTE_ONE_LANGUAGE", fields: ["cp[0].noteEn"] });
    expect(await save([{ ...WATER, km: "abc" }])).toMatchObject({ error: "CHECKPOINT_KM_INVALID", fields: ["cp[0].km"] });
    expect(await save([{ ...WATER, kinds: ["WATER", "PIZZA"] }])).toMatchObject({ error: "CHECKPOINT_KIND_UNKNOWN" });
  });

  it("changes a point and audits the list before and after; an unchanged save records nothing", async () => {
    await save([WATER, FOOD]);
    const [water, food] = await listCheckpoints(db, eventId);
    await save([
      { ...WATER, id: water.id, cutoff: "10:10" },
      { ...FOOD, id: food.id },
    ]);
    const after = await listCheckpoints(db, eventId);
    expect(after.map((row) => row.cutoff)).toEqual(["10:10", "11:15"]);
    expect(after.map((row) => row.id)).toEqual([water.id, food.id]);
    const changed = (await trail()).filter((row) => row.action === "event_checkpoints.changed");
    expect(changed).toHaveLength(2);
    expect(changed[1].metadataJson).toMatchObject({
      added: 0,
      edited: 1,
      removed: 0,
      from: [{ km: 5, cutoff: "10:00" }, { km: 12.5 }],
      to: [{ km: 5, cutoff: "10:10" }, { km: 12.5 }],
    });
    // Pressing «Salvează punctele» on the list as it is changes nothing and records nothing.
    expect(await save([{ ...WATER, id: water.id, cutoff: "10:10" }, { ...FOOD, id: food.id }])).toBe("redirected");
    expect(await actions()).toEqual(["event_checkpoints.changed", "event_checkpoints.changed"]);
    expect(state.flashed.at(-1)).toContain("checkpointsUnchanged");
  });

  it("reorders by distance: moving a point's kilometre moves it in the list and keeps its id", async () => {
    await save([WATER, FOOD]);
    const [water, food] = await listCheckpoints(db, eventId);
    await save([{ ...WATER, id: water.id, km: "14", cutoff: "11:30" }, { ...FOOD, id: food.id }]);
    const after = await listCheckpoints(db, eventId);
    expect(after.map((row) => row.id)).toEqual([food.id, water.id]);
    const stored = await db.select().from(eventCheckpoints).where(eq(eventCheckpoints.eventId, eventId));
    expect(stored.find((row) => row.id === food.id)?.position).toBe(0);
    expect(stored.find((row) => row.id === water.id)?.position).toBe(1);
  });

  it("removes a point ticked «Scoate», and only that one", async () => {
    await save([WATER, FOOD]);
    const [water, food] = await listCheckpoints(db, eventId);
    await save([{ ...WATER, id: water.id, remove: true }, { ...FOOD, id: food.id }]);
    expect((await listCheckpoints(db, eventId)).map((row) => row.id)).toEqual([food.id]);
    const last = (await trail()).at(-1);
    expect(last?.metadataJson).toMatchObject({ added: 0, edited: 0, removed: 1 });
  });

  it("never deletes a point the form was not told about: a colleague's addition survives a stale save", async () => {
    await save([WATER]);
    const [water] = await listCheckpoints(db, eventId);
    // A colleague adds a point while this form is open.
    await save([{ ...water, id: water.id, nameRo: water.nameRo, nameEn: water.nameEn, km: String(water.km), cutoff: water.cutoff ?? "" }, FOOD]);
    expect(await listCheckpoints(db, eventId)).toHaveLength(2);
    // The stale form knows only the first point and changes its cut-off.
    await save([{ ...WATER, id: water.id, cutoff: "10:05" }]);
    const rows = await listCheckpoints(db, eventId);
    expect(rows.map((row) => [row.nameRo, row.cutoff])).toEqual([
      ["Apă", "10:05"],
      ["Mâncare", "11:15"],
    ]);
  });

  it("belongs to one event: another event's point id posted here is not touched, and the point is added as a new one", async () => {
    await db.insert(eventCheckpoints).values({ eventId: otherEventId, nameRo: "Altul", nameEn: "Other", km: "2.00", kinds: ["WATER"] });
    const [other] = await listCheckpoints(db, otherEventId);
    expect(await save([{ ...WATER, id: other.id, nameRo: "Furat", nameEn: "Stolen" }])).toBe("redirected");
    expect((await listCheckpoints(db, otherEventId)).map((row) => row.nameRo)).toEqual(["Altul"]);
    expect((await listCheckpoints(db, eventId)).map((row) => row.nameRo)).toEqual(["Furat"]);
    expect((await listCheckpoints(db, eventId))[0].id).not.toBe(other.id);
  });

  it("refuses a malformed event id and an event that is not there, as the service's own refusals", async () => {
    const forged = form([WATER]);
    forged.set("eventId", "x");
    expect(await post(saveCheckpointsAction, forged)).toMatchObject({ error: "NOT_FOUND" });
    expect(await post(saveCheckpointsAction, form([WATER], {}, "7b2c1f0e-3d4a-4b5c-8d6e-0f1a2b3c4d5e"))).toMatchObject({ error: "NOT_FOUND" });
  });

  it("lets the Administrator and the Organizer write, and refuses the Tehnic, the Redactor and the volunteer in the service", async () => {
    for (const role of ["ADMIN", "MODERATOR"] as const) {
      state.actor = staff[role];
      expect(await save([{ ...WATER, nameRo: `Punct ${role}`, km: role === "ADMIN" ? "5" : "9" }])).toBe("redirected");
    }
    expect(await listCheckpoints(db, eventId)).toHaveLength(2);
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR"] as const) {
      state.actor = staff[role];
      expect(await save([WATER])).toMatchObject({ error: "FORBIDDEN" });
    }
    expect(await listCheckpoints(db, eventId)).toHaveLength(2);
    expect((await actions()).filter((action) => action === "event_checkpoints.changed")).toHaveLength(2);
  });

  it("goes with its event, and the database holds the same rules: no negative kilometre, a note in one language, an empty name", async () => {
    await save([WATER]);
    const insert = (values: Partial<typeof eventCheckpoints.$inferInsert>) =>
      db.insert(eventCheckpoints).values({ eventId, nameRo: "A", nameEn: "A", km: "1.00", ...values });
    await expectViolation(insert({ km: "-1.00" }), { code: SQLSTATE.CHECK_VIOLATION, constraint: "event_checkpoints_km_not_negative" });
    await expectViolation(insert({ noteRo: "doar română" }), { code: SQLSTATE.CHECK_VIOLATION, constraint: "event_checkpoints_note_both_languages" });
    await expectViolation(insert({ nameEn: "" }), { code: SQLSTATE.CHECK_VIOLATION, constraint: "event_checkpoints_name_length" });
    await expectViolation(insert({ kinds: ["PIZZA" as never] }), { code: SQLSTATE.INVALID_ENUM_INPUT });
    await db.delete(events).where(and(eq(events.id, eventId)));
    expect(await db.select().from(eventCheckpoints)).toEqual([]);
  });
});

/** A track along a parallel, 41 points 0.001° apart: 3.1 km, with the waypoints given. */
async function uploadTrack(waypoints: string) {
  const body = Array.from({ length: 41 }, (_, i) => `<trkpt lat="45.6000" lon="${(25.5 + i * 0.001).toFixed(5)}"><ele>600</ele></trkpt>`).join("");
  const bytes = Buffer.from(`<?xml version="1.0"?><gpx version="1.1" creator="test">${waypoints}<trk><trkseg>${body}</trkseg></trk></gpx>`);
  return storeRouteGpx(getStorage(), { bytes, name: "Traseu.gpx", environment: "test", now: new Date("2026-10-13T10:00:00.000Z") });
}

const WAYPOINTS =
  `<wpt lat="45.6" lon="25.51"><name>Izvor</name><sym>Drinking Water</sym></wpt>` +
  `<wpt lat="45.6" lon="25.52"><name>Cabana</name></wpt>` +
  `<wpt lat="45.64" lon="25.52"><name>Parcare</name></wpt>`;

describe("§NNN «Ia punctele din GPX»", () => {
  it("reads the file's waypoints once and offers the ones that sit on the track", async () => {
    const gpx = await uploadTrack(WAYPOINTS);
    const parsed = await loadGpxWaypoints(gpx.key);
    expect(parsed?.waypointCount).toBe(3);
    expect(parsed?.proposals.map((p) => [p.name, p.tooFar])).toEqual([
      ["Izvor", false],
      ["Cabana", false],
      ["Parcare", true],
    ]);
    expect(parsed?.proposals[0].kinds).toEqual(["WATER"]);
    expect(await loadGpxWaypoints(null)).toBeNull();
    expect(await loadGpxWaypoints("test/route-gpx/00000000-0000-4000-8000-000000000000/none.gpx")).toBeNull();
  });

  it("adds what the club ticked, the name copied into both languages, and audits it as taken from the GPX", async () => {
    const gpx = await uploadTrack(WAYPOINTS);
    await db.update(events).set({ routeGpx: gpx }).where(eq(events.id, eventId));
    const data = form([], { gpxKey: gpx.key });
    data.append("pick", "0");
    data.append("pick", "1");
    expect(await post(addGpxCheckpointsAction, data)).toBe("redirected");
    const rows = await listCheckpoints(db, eventId);
    expect(rows.map((row) => [row.nameRo, row.nameEn, row.cutoff, row.kinds])).toEqual([
      ["Izvor", "Izvor", null, ["WATER"]],
      ["Cabana", "Cabana", null, []],
    ]);
    expect(rows[0].km).toBeCloseTo(0.78, 1);
    const [row] = await trail();
    expect(row.metadataJson).toMatchObject({ source: "gpx", added: 2 });
    expect(state.flashed.join("|")).toContain("checkpointsAdded");
  });

  it("adds only the proposals picked, never the ones too far from the track, and nothing twice", async () => {
    const gpx = await uploadTrack(WAYPOINTS);
    await db.update(events).set({ routeGpx: gpx }).where(eq(events.id, eventId));
    const first = form([], { gpxKey: gpx.key });
    first.append("pick", "1");
    // Index 2 is beyond the offerable list (the parking is too far), and a repeat of 1 is one pick.
    first.append("pick", "2");
    first.append("pick", "1");
    await post(addGpxCheckpointsAction, first);
    expect((await listCheckpoints(db, eventId)).map((row) => row.nameRo)).toEqual(["Cabana"]);
    const again = form([], { gpxKey: gpx.key });
    again.append("pick", "1");
    await post(addGpxCheckpointsAction, again);
    expect(await listCheckpoints(db, eventId)).toHaveLength(1);
    expect(await actions()).toEqual(["event_checkpoints.changed"]);
    expect(state.flashed.at(-1)).toContain("checkpointsUnchanged");
  });

  it("refuses a preview made from another file than the one the event has now", async () => {
    const gpx = await uploadTrack(WAYPOINTS);
    await db.update(events).set({ routeGpx: gpx }).where(eq(events.id, eventId));
    const data = form([], { gpxKey: "test/route-gpx/00000000-0000-4000-8000-000000000000/old.gpx" });
    data.append("pick", "0");
    expect(await post(addGpxCheckpointsAction, data)).toMatchObject({ error: "CONFLICT" });
    expect(await listCheckpoints(db, eventId)).toEqual([]);
  });

  it("holds the GPX's points to the same rules: a kilometre beyond a typed distance is refused", async () => {
    const gpx = await uploadTrack(WAYPOINTS);
    // A typed distance shorter than the track: the second waypoint is at 1.56 km.
    await db.update(events).set({ routeGpx: gpx, distanceMeters: 1000 }).where(eq(events.id, eventId));
    const data = form([], { gpxKey: gpx.key });
    data.append("pick", "1");
    expect(await post(addGpxCheckpointsAction, data)).toMatchObject({ error: "CHECKPOINT_KM_BEYOND_ROUTE" });
    expect(await listCheckpoints(db, eventId)).toEqual([]);
  });

  it("is for those who may write: the Tehnic is refused", async () => {
    const gpx = await uploadTrack(WAYPOINTS);
    await db.update(events).set({ routeGpx: gpx }).where(eq(events.id, eventId));
    state.actor = staff.DEV;
    const data = form([], { gpxKey: gpx.key });
    data.append("pick", "0");
    expect(await post(addGpxCheckpointsAction, data)).toMatchObject({ error: "FORBIDDEN" });
    expect(await listCheckpoints(db, eventId)).toEqual([]);
  });
});

describe("§NNN the picture stamp covers the checkpoints", () => {
  const stamp = async () => {
    const [row] = await db
      .select({ stamp: BIB_STAMP })
      .from(events)
      .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
      .where(eq(events.id, eventId));
    return row.stamp;
  };

  it("changes with a point added, moved, retimed or given another kind, and not with a name", async () => {
    await db.insert(eventTranslations).values({ eventId, locale: "ro", slug: "cursa", title: "Cursa" });
    const none = await stamp();
    await save([WATER]);
    const one = await stamp();
    expect(one).not.toBe(none);
    const [water] = await listCheckpoints(db, eventId);
    await save([{ ...WATER, id: water.id, cutoff: "10:05" }]);
    const retimed = await stamp();
    expect(retimed).not.toBe(one);
    await save([{ ...WATER, id: water.id, cutoff: "10:05", km: "6" }]);
    const moved = await stamp();
    expect(moved).not.toBe(retimed);
    await save([{ ...WATER, id: water.id, cutoff: "10:05", km: "6", kinds: ["WATER", "FOOD"] }]);
    const kinds = await stamp();
    expect(kinds).not.toBe(moved);
    await save([{ ...WATER, id: water.id, cutoff: "10:05", km: "6", kinds: ["WATER", "FOOD"], nameRo: "Alt nume", nameEn: "Other name" }]);
    expect(await stamp()).toBe(kinds);
    await save([{ ...WATER, id: water.id, remove: true }]);
    expect(await stamp()).toBe(none);
  });
});
