import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import type { BibProfileSource } from "@/modules/registrations/bib-extras";
import type { FormOutcome } from "@/shared/forms/outcome";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §757, §770, BR-REQ-011-01 and BR-REQ-060-01 — an event's checkpoints, through the real Server Actions:
 * saved as the card posts them (added, changed, ticked «Scoate»), a kilometre beyond the route and a
 * time limit longer than the event's or than a later point's, or with no start to count from, refused
 * naming the box with the sentence's own numbers, the five kinds («Direcționare» among them), every change audited, a save that never deletes a point it was not told about, the role
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
const { withBibCheckpoints } = await import("@/modules/registrations/bib-extras");
const { withCutoffClocks } = await import("@/modules/event-checkpoints/domain/start");
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

type Row = {
  id?: string;
  nameRo?: string;
  nameEn?: string;
  km?: string;
  kinds?: readonly string[];
  /** The time limit in minutes from the start, posted as the card's two boxes: hours and minutes. */
  limit?: number;
  /** The two boxes as typed, for what the card's boxes would refuse. */
  boxes?: readonly [string, string];
  noteRo?: string | null;
  noteEn?: string | null;
  remove?: boolean;
  /** «Arată pe profilul traseului»: true or false as the form drew and posted it; undefined for a form that did not draw the box. */
  onProfile?: boolean;
};

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
    const [hours, minutes] = row.boxes ?? (row.limit === undefined ? ["", ""] : [String(Math.floor(row.limit / 60)), String(row.limit % 60)]);
    data.set(`cp[${index}].cutoffHours`, hours);
    data.set(`cp[${index}].cutoffMinutesPart`, minutes);
    data.set(`cp[${index}].noteRo`, row.noteRo ?? "");
    data.set(`cp[${index}].noteEn`, row.noteEn ?? "");
    if (row.remove) data.set(`cp[${index}].remove`, "on");
    // The profile's tick (§NNN): a form that drew the box posts its marker, and «on» when it is ticked; undefined is a form drawn before the box existed.
    if (row.onProfile !== undefined) {
      data.set(`cp[${index}].onProfileShown`, "1");
      if (row.onProfile) data.set(`cp[${index}].onProfile`, "on");
    }
  });
  for (const [name, value] of Object.entries(extra)) data.set(name, value);
  return data;
}

const WATER: Row = { nameRo: "Apă", nameEn: "Water", km: "5", kinds: ["WATER"], limit: 60 };
const FOOD: Row = { nameRo: "Mâncare", nameEn: "Food", km: "12,5", kinds: ["FOOD", "WATER"], limit: 135, noteRo: "Banane", noteEn: "Bananas" };

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

describe("§757 an event's checkpoints", () => {
  it("adds two points with a time limit each, in distance order, and audits it", async () => {
    // Typed out of order, with a comma and spare blank rows at the foot, as the card posts them.
    expect(await save([FOOD, WATER, {}, {}])).toBe("redirected");
    expect(state.redirected[0]).toContain("#box-checkpoints");
    const rows = await listCheckpoints(db, eventId);
    expect(rows.map((row) => [row.km, row.nameRo, row.nameEn, row.cutoffMinutes])).toEqual([
      [5, "Apă", "Water", 60],
      [12.5, "Mâncare", "Food", 135],
    ]);
    // The clock follows the start: 09:00 on the event's own clock, so one hour is 10:00 and two hours and a quarter 11:15.
    expect(rows.map((row) => row.cutoffClock)).toEqual(["10:00", "11:15"]);
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
        { km: 5, name: "Apă", cutoffMinutes: 60 },
        { km: 12.5, name: "Mâncare", cutoffMinutes: 135 },
      ],
    });
    expect(state.flashed.join("|")).toContain("checkpointsSaved");
  });

  it("stores the time limit as minutes and never writes the old time of the day, and the position as the order by distance", async () => {
    await save([FOOD, WATER]);
    const stored = await db.select().from(eventCheckpoints).where(eq(eventCheckpoints.eventId, eventId));
    expect(stored.map((row) => row.cutoffMinutes ?? 0).sort((a, b) => a - b)).toEqual([60, 135]);
    expect(stored.map((row) => row.cutoffTime)).toEqual([null, null]);
    expect([...stored].sort((a, b) => a.position - b.position).map((row) => row.nameRo)).toEqual(["Apă", "Mâncare"]);
  });

  it("refuses a kilometre beyond the route, with the reason and the length, naming the box and keeping what was typed", async () => {
    const refusal = await save([{ ...WATER, km: "22,5", nameRo: "Dincolo" }]);
    expect(refusal).toMatchObject({
      error: "CHECKPOINT_KM_BEYOND_ROUTE",
      errorValues: { name: "Dincolo", km: "22,5", max: "21,1" },
      fields: ["cp[0].km"],
    });
    expect((refusal as FormOutcome).values["cp[0].km"]).toEqual(["22,5"]);
    // The English backoffice names the point in English and writes the kilometre with a point.
    const english = form([{ ...WATER, km: "22,5", nameRo: "Dincolo", nameEn: "Beyond" }]);
    english.set("uiLocale", "en");
    expect(await post(saveCheckpointsAction, english)).toMatchObject({ errorValues: { name: "Beyond", km: "22.5", max: "21.1" } });
    expect(await listCheckpoints(db, eventId)).toEqual([]);
    expect(await actions()).toEqual([]);
  });

  it("measures the kilometre against the GPX's length when the club typed no distance", async () => {
    await db.update(events).set({ distanceMeters: null, routeGpx: await uploadTrack("") }).where(eq(events.id, eventId));
    // The track is 3.11 km long.
    expect(await save([{ ...WATER, km: "3,2", limit: undefined }])).toMatchObject({ error: "CHECKPOINT_KM_BEYOND_ROUTE", errorValues: { max: "3,11" } });
    expect(await save([{ ...WATER, km: "3", limit: undefined }])).toBe("redirected");
  });

  it("refuses a time limit that is not a duration and one longer than the event's, naming the box and saying both durations", async () => {
    expect(await save([{ ...WATER, boxes: ["0", "0"] }])).toMatchObject({ error: "CHECKPOINT_CUTOFF_INVALID", fields: ["cp[0].cutoffHours"] });
    expect(await save([{ ...WATER, boxes: ["1", "60"] }])).toMatchObject({ error: "CHECKPOINT_CUTOFF_INVALID", fields: ["cp[0].cutoffMinutesPart"] });
    expect(await save([{ ...WATER, boxes: ["noon", ""] }])).toMatchObject({ error: "CHECKPOINT_CUTOFF_INVALID" });
    // The race's «Timp limită» is three hours (09:00 to 12:00): three and a half is longer.
    const refusal = await save([{ ...WATER, limit: 210 }]);
    expect(refusal).toMatchObject({ error: "CHECKPOINT_CUTOFF_AFTER_END", errorValues: { cutoff: "3 h 30 min", limit: "3 h" }, fields: ["cp[0].cutoffHours"] });
    // What was typed stays in the two boxes.
    expect((refusal as FormOutcome).values["cp[0].cutoffHours"]).toEqual(["3"]);
    expect((refusal as FormOutcome).values["cp[0].cutoffMinutesPart"]).toEqual(["30"]);
    expect(await save([{ ...WATER, limit: 180 }])).toBe("redirected");
    expect(await listCheckpoints(db, eventId)).toHaveLength(1);
  });

  it("counts the time limits from the race's gun when the race has one, minutes against minutes", async () => {
    // The event starts at 09:00 and ends at 12:00, but the gun is at 10:00: the race's «Timp limită» is two hours.
    await db.update(events).set({ raceStartsAt: new Date("2026-11-21T08:00:00.000Z") }).where(eq(events.id, eventId));
    expect(await save([{ ...WATER, limit: 150 }])).toMatchObject({ error: "CHECKPOINT_CUTOFF_AFTER_END", errorValues: { limit: "2 h" } });
    expect(await save([{ ...WATER, limit: 90 }])).toBe("redirected");
    // Ninety minutes after the gun is 11:30 on the event's clock.
    expect((await listCheckpoints(db, eventId)).map((row) => [row.cutoffMinutes, row.cutoffClock])).toEqual([[90, "11:30"]]);
  });

  it("moves every clock with the start and keeps the minutes: the time limit is a duration", async () => {
    await save([WATER, FOOD]);
    expect((await listCheckpoints(db, eventId)).map((row) => row.cutoffClock)).toEqual(["10:00", "11:15"]);
    // The club moves the race to start at 10:30 (08:30Z) — with the same three hours, ending at 13:30.
    await db.update(events).set({ startsAt: new Date("2026-11-21T08:30:00.000Z"), endsAt: new Date("2026-11-21T11:30:00.000Z") }).where(eq(events.id, eventId));
    const moved = await listCheckpoints(db, eventId);
    expect(moved.map((row) => row.cutoffMinutes)).toEqual([60, 135]);
    expect(moved.map((row) => row.cutoffClock)).toEqual(["11:30", "12:45"]);
    // And a gun later than the meeting time takes the clocks with it.
    await db.update(events).set({ raceStartsAt: new Date("2026-11-21T09:00:00.000Z") }).where(eq(events.id, eventId));
    expect((await listCheckpoints(db, eventId)).map((row) => row.cutoffClock)).toEqual(["12:00", "13:15"]);
  });

  it("refuses a time limit while the start has no hour to count it from, and keeps a saved limit that is posted unchanged", async () => {
    await save([WATER]);
    const [water] = await listCheckpoints(db, eventId);
    // «Ora se anunță mai târziu»: the stored start has the provisional second past noon (§545), and the event no end.
    await db.update(events).set({ startsAt: new Date("2026-11-21T10:00:01.000Z"), endsAt: null }).where(eq(events.id, eventId));
    expect((await listCheckpoints(db, eventId))[0]).toMatchObject({ cutoffMinutes: 60, cutoffClock: null });
    // A new point with a limit has nothing to count from…
    expect(await save([{ ...WATER, id: water.id }, { nameRo: "Nou", nameEn: "New", km: "9", limit: 90 }])).toMatchObject({
      error: "CHECKPOINT_CUTOFF_NO_START",
      fields: ["cp[1].cutoffHours"],
    });
    // …as does a changed one; the one posted as it was, with a note added, is saved.
    expect(await save([{ ...WATER, id: water.id, limit: 70 }])).toMatchObject({ error: "CHECKPOINT_CUTOFF_NO_START" });
    expect(await save([{ ...WATER, id: water.id, noteRo: "Banane", noteEn: "Bananas" }, { nameRo: "Fără limită", nameEn: "No limit", km: "9" }])).toBe("redirected");
    expect((await listCheckpoints(db, eventId)).map((row) => [row.nameRo, row.cutoffMinutes])).toEqual([
      ["Apă", 60],
      ["Fără limită", null],
    ]);
  });

  it("saves «Direcționare» as the fifth kind, with the others in the closed set's order, and reads it back", async () => {
    expect(await save([{ ...WATER, kinds: ["DIRECTION", "WATER"] }, { nameRo: "Voluntar", nameEn: "Marshal", km: "9", kinds: ["DIRECTION"] }])).toBe("redirected");
    const rows = await listCheckpoints(db, eventId);
    expect(rows.map((row) => row.kinds)).toEqual([["WATER", "DIRECTION"], ["DIRECTION"]]);
    const stored = await db.select({ kinds: eventCheckpoints.kinds }).from(eventCheckpoints).where(eq(eventCheckpoints.eventId, eventId));
    expect(stored.flatMap((row) => row.kinds).sort()).toEqual(["DIRECTION", "DIRECTION", "WATER"]);
    // All five values round-trip through the column.
    await db.insert(eventCheckpoints).values({ eventId, nameRo: "Toate", nameEn: "All", km: "20.00", kinds: ["WATER", "FOOD", "FIRST_AID", "TIMING", "DIRECTION"] });
    expect((await listCheckpoints(db, eventId)).at(-1)?.kinds).toEqual(["WATER", "FOOD", "FIRST_AID", "TIMING", "DIRECTION"]);
  });

  it("refuses a time limit longer than the one of a point further along, naming the earlier point's box", async () => {
    const refusal = await save([
      { ...WATER, nameRo: "Prima", limit: 120 },
      { ...FOOD, nameRo: "A doua", limit: 90 },
    ]);
    expect(refusal).toMatchObject({
      error: "CHECKPOINT_CUTOFF_AFTER_LATER",
      errorValues: { name: "Prima", cutoff: "2 h", later: "A doua", laterCutoff: "1 h 30 min" },
      fields: ["cp[0].cutoffHours"],
    });
    expect(await listCheckpoints(db, eventId)).toEqual([]);
  });

  it("holds the rules to the whole list that will be there, not only the rows the form named", async () => {
    await save([WATER, FOOD]);
    // A stale form that only knows a new point at km 8 with a time limit longer than the saved point's at km 12.5.
    expect(await save([{ nameRo: "Nou", nameEn: "New", km: "8", limit: 150 }])).toMatchObject({ error: "CHECKPOINT_CUTOFF_AFTER_LATER" });
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
      { ...WATER, id: water.id, limit: 70 },
      { ...FOOD, id: food.id },
    ]);
    const after = await listCheckpoints(db, eventId);
    expect(after.map((row) => row.cutoffMinutes)).toEqual([70, 135]);
    expect(after.map((row) => row.id)).toEqual([water.id, food.id]);
    const changed = (await trail()).filter((row) => row.action === "event_checkpoints.changed");
    expect(changed).toHaveLength(2);
    expect(changed[1].metadataJson).toMatchObject({
      added: 0,
      edited: 1,
      removed: 0,
      from: [{ km: 5, cutoffMinutes: 60 }, { km: 12.5 }],
      to: [{ km: 5, cutoffMinutes: 70 }, { km: 12.5 }],
    });
    // Pressing «Salvează punctele» on the list as it is changes nothing and records nothing.
    expect(await save([{ ...WATER, id: water.id, limit: 70 }, { ...FOOD, id: food.id }])).toBe("redirected");
    expect(await actions()).toEqual(["event_checkpoints.changed", "event_checkpoints.changed"]);
    expect(state.flashed.at(-1)).toContain("checkpointsUnchanged");
  });

  it("reorders by distance: moving a point's kilometre moves it in the list and keeps its id", async () => {
    await save([WATER, FOOD]);
    const [water, food] = await listCheckpoints(db, eventId);
    await save([{ ...WATER, id: water.id, km: "14", limit: 150 }, { ...FOOD, id: food.id }]);
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
    await save([{ ...water, id: water.id, nameRo: water.nameRo, nameEn: water.nameEn, km: String(water.km), limit: water.cutoffMinutes ?? undefined }, FOOD]);
    expect(await listCheckpoints(db, eventId)).toHaveLength(2);
    // The stale form knows only the first point and changes its time limit.
    await save([{ ...WATER, id: water.id, limit: 65 }]);
    const rows = await listCheckpoints(db, eventId);
    expect(rows.map((row) => [row.nameRo, row.cutoffMinutes])).toEqual([
      ["Apă", 65],
      ["Mâncare", 135],
    ]);
  });

  it("belongs to one event: another event's point id posted here touches nothing and adds nothing", async () => {
    await db.insert(eventCheckpoints).values({ eventId: otherEventId, nameRo: "Altul", nameEn: "Other", km: "2.00", kinds: ["WATER"] });
    const [other] = await listCheckpoints(db, otherEventId);
    expect(await save([{ ...WATER, id: other.id, nameRo: "Furat", nameEn: "Stolen" }])).toBe("redirected");
    expect((await listCheckpoints(db, otherEventId)).map((row) => row.nameRo)).toEqual(["Altul"]);
    expect(await listCheckpoints(db, eventId)).toEqual([]);
  });

  it("never brings back a point a colleague removed: a stale form's row for it is dropped, not added again", async () => {
    await save([WATER, FOOD]);
    const [water, food] = await listCheckpoints(db, eventId);
    const asPosted = (row: typeof water): Row => ({ id: row.id, nameRo: row.nameRo, nameEn: row.nameEn, km: String(row.km), kinds: row.kinds, limit: row.cutoffMinutes ?? undefined, noteRo: row.noteRo, noteEn: row.noteEn });
    // A colleague removes the food point.
    await save([asPosted(water), { ...asPosted(food), remove: true }]);
    expect((await listCheckpoints(db, eventId)).map((row) => row.nameRo)).toEqual(["Apă"]);
    // This form was drawn before that, still shows the food point, and retimes the water.
    expect(await save([{ ...asPosted(water), limit: 65 }, asPosted(food)])).toBe("redirected");
    expect((await listCheckpoints(db, eventId)).map((row) => [row.nameRo, row.cutoffMinutes])).toEqual([["Apă", 65]]);
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

  it("hands the bib's strip and the event page the same clock: one converter, the gun's hour plus the limit (§770)", async () => {
    await save([WATER, FOOD]);
    const source: BibProfileSource = { routeGpx: { key: "route/a.gpx" } as never, distanceMeters: 21_100, elevationGainMeters: null };
    const strip = await withBibCheckpoints(db, eventId, source, { showProfile: true, showCheckpoints: true });
    expect(strip.checkpoints?.map((row) => [row.km, row.cutoffClock])).toEqual([
      [5, "10:00"],
      [12.5, "11:15"],
    ]);
    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    expect(withCutoffClocks(await listCheckpoints(db, eventId), event).map((row) => row.cutoffClock)).toEqual(["10:00", "11:15"]);
  });

  it("goes with its event, and the database holds the same rules: no negative kilometre, a note in one language, an empty name, a time limit of a positive time within a week", async () => {
    await save([WATER]);
    const insert = (values: Partial<typeof eventCheckpoints.$inferInsert>) =>
      db.insert(eventCheckpoints).values({ eventId, nameRo: "A", nameEn: "A", km: "1.00", ...values });
    await expectViolation(insert({ km: "-1.00" }), { code: SQLSTATE.CHECK_VIOLATION, constraint: "event_checkpoints_km_not_negative" });
    await expectViolation(insert({ noteRo: "doar română" }), { code: SQLSTATE.CHECK_VIOLATION, constraint: "event_checkpoints_note_both_languages" });
    await expectViolation(insert({ nameEn: "" }), { code: SQLSTATE.CHECK_VIOLATION, constraint: "event_checkpoints_name_length" });
    await expectViolation(insert({ cutoffMinutes: 0 }), { code: SQLSTATE.CHECK_VIOLATION, constraint: "event_checkpoints_cutoff_minutes_range" });
    await expectViolation(insert({ cutoffMinutes: -5 }), { code: SQLSTATE.CHECK_VIOLATION, constraint: "event_checkpoints_cutoff_minutes_range" });
    await expectViolation(insert({ cutoffMinutes: 10_081 }), { code: SQLSTATE.CHECK_VIOLATION, constraint: "event_checkpoints_cutoff_minutes_range" });
    await insert({ cutoffMinutes: 10_080 });
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

/** The preview's form: each ticked proposal by its index, with the names typed in its two boxes. */
function pickForm(gpxKey: string, picks: Array<[number, string, string]>): FormData {
  const data = form([], { gpxKey });
  for (const [at, nameRo, nameEn] of picks) {
    data.append("pick", String(at));
    data.set(`cp[${at}].nameRo`, nameRo);
    data.set(`cp[${at}].nameEn`, nameEn);
  }
  return data;
}

const WAYPOINTS =
  `<wpt lat="45.6" lon="25.51"><name>Izvor</name><sym>Drinking Water</sym></wpt>` +
  `<wpt lat="45.6" lon="25.52"><name>Cabana</name></wpt>` +
  `<wpt lat="45.64" lon="25.52"><name>Parcare</name></wpt>`;

describe("§757 «Ia punctele din GPX»", () => {
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

  it("adds what the club ticked, with the names it gave in each language, and audits it as taken from the GPX", async () => {
    const gpx = await uploadTrack(WAYPOINTS);
    await db.update(events).set({ routeGpx: gpx }).where(eq(events.id, eventId));
    const data = pickForm(gpx.key, [
      [0, "Izvor", "Spring"],
      [1, "Cabana", "The hut"],
    ]);
    expect(await post(addGpxCheckpointsAction, data)).toBe("redirected");
    const rows = await listCheckpoints(db, eventId);
    expect(rows.map((row) => [row.nameRo, row.nameEn, row.cutoffMinutes, row.kinds])).toEqual([
      ["Izvor", "Spring", null, ["WATER"]],
      ["Cabana", "The hut", null, []],
    ]);
    expect(rows[0].km).toBeCloseTo(0.78, 1);
    const [row] = await trail();
    expect(row.metadataJson).toMatchObject({ source: "gpx", added: 2 });
    expect(state.flashed.join("|")).toContain("checkpointsAdded");
  });

  it("never stores a GPX point with its English name silently copied from the Romanian one: an empty box is refused, naming it", async () => {
    const gpx = await uploadTrack(WAYPOINTS);
    await db.update(events).set({ routeGpx: gpx }).where(eq(events.id, eventId));
    const refused = await post(addGpxCheckpointsAction, pickForm(gpx.key, [[1, "Cabana", ""]]));
    expect(refused).toMatchObject({ error: "CHECKPOINT_NAME_MISSING", fields: ["cp[1].nameEn"] });
    // What was typed stays in the preview's boxes.
    expect((refused as FormOutcome).values["cp[1].nameRo"]).toEqual(["Cabana"]);
    expect(await listCheckpoints(db, eventId)).toEqual([]);
  });

  it("adds only the proposals picked, never the ones too far from the track, and nothing twice", async () => {
    const gpx = await uploadTrack(WAYPOINTS);
    await db.update(events).set({ routeGpx: gpx }).where(eq(events.id, eventId));
    // Index 2 is beyond the offerable list (the parking is too far), and a repeat of 1 is one pick.
    await post(
      addGpxCheckpointsAction,
      pickForm(gpx.key, [
        [1, "Cabana", "The hut"],
        [2, "Parcare", "Car park"],
        [1, "Cabana", "The hut"],
      ]),
    );
    expect((await listCheckpoints(db, eventId)).map((row) => row.nameRo)).toEqual(["Cabana"]);
    await post(addGpxCheckpointsAction, pickForm(gpx.key, [[1, "Cabana", "The hut"]]));
    expect(await listCheckpoints(db, eventId)).toHaveLength(1);
    expect(await actions()).toEqual(["event_checkpoints.changed"]);
    expect(state.flashed.at(-1)).toContain("checkpointsUnchanged");
  });

  it("refuses a preview made from another file than the one the event has now", async () => {
    const gpx = await uploadTrack(WAYPOINTS);
    await db.update(events).set({ routeGpx: gpx }).where(eq(events.id, eventId));
    const data = pickForm("test/route-gpx/00000000-0000-4000-8000-000000000000/old.gpx", [[0, "Izvor", "Spring"]]);
    expect(await post(addGpxCheckpointsAction, data)).toMatchObject({ error: "CONFLICT" });
    expect(await listCheckpoints(db, eventId)).toEqual([]);
  });

  it("places a waypoint just past a typed distance at the route's end, and never offers one farther past it", async () => {
    const gpx = await uploadTrack(WAYPOINTS);
    // A typed 1.5 km against the second waypoint at 1.56 km: within the tolerance, it is the finish, at 1.5.
    await db.update(events).set({ routeGpx: gpx, distanceMeters: 1500 }).where(eq(events.id, eventId));
    expect(await post(addGpxCheckpointsAction, pickForm(gpx.key, [[1, "Sosire", "Finish"]]))).toBe("redirected");
    expect((await listCheckpoints(db, eventId)).map((row) => [row.nameRo, row.km])).toEqual([["Sosire", 1.5]]);
  });

  it("does not offer a waypoint farther past a typed distance than the tolerance: its index adds nothing", async () => {
    const gpx = await uploadTrack(WAYPOINTS);
    // A typed 1 km: the waypoint at 1.56 km is past the end by more than 300 m, so only the spring is offered.
    await db.update(events).set({ routeGpx: gpx, distanceMeters: 1000 }).where(eq(events.id, eventId));
    expect(await post(addGpxCheckpointsAction, pickForm(gpx.key, [[1, "Cabana", "The hut"]]))).toBe("redirected");
    expect(await listCheckpoints(db, eventId)).toEqual([]);
    expect(state.flashed.at(-1)).toContain("checkpointsUnchanged");
  });

  it("refuses CONFLICT when the route's distance changed between reading the file and saving", async () => {
    // The service reads the GPX before it locks the event (§403); a distance typed meanwhile is a route it did not measure against.
    const gpx = await uploadTrack(WAYPOINTS);
    await db.update(events).set({ routeGpx: gpx, distanceMeters: null }).where(eq(events.id, eventId));
    const { changeCheckpoints } = await import("@/modules/event-checkpoints/checkpoints");
    // The database, but a colleague types a distance just before the transaction opens.
    let typed = false;
    const slow = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "transaction") return Reflect.get(target, property, receiver);
        return async (run: Parameters<typeof db.transaction>[0]) => {
          if (!typed) {
            typed = true;
            await target.update(events).set({ distanceMeters: 2000 }).where(eq(events.id, eventId));
          }
          return target.transaction(run);
        };
      },
    });
    const refused = await changeCheckpoints(slow, staff.ADMIN as StaffUser, { kind: "save", eventId, rows: [] }, new Date()).catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: "CONFLICT" });
  });

  it("is for those who may write: the Tehnic is refused", async () => {
    const gpx = await uploadTrack(WAYPOINTS);
    await db.update(events).set({ routeGpx: gpx }).where(eq(events.id, eventId));
    state.actor = staff.DEV;
    expect(await post(addGpxCheckpointsAction, pickForm(gpx.key, [[0, "Izvor", "Spring"]]))).toMatchObject({ error: "FORBIDDEN" });
    expect(await listCheckpoints(db, eventId)).toEqual([]);
  });
});

describe("§757 the picture stamp covers the checkpoints", () => {
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
    await save([{ ...WATER, id: water.id, limit: 65 }]);
    const retimed = await stamp();
    expect(retimed).not.toBe(one);
    await save([{ ...WATER, id: water.id, limit: 65, km: "6" }]);
    const moved = await stamp();
    expect(moved).not.toBe(retimed);
    await save([{ ...WATER, id: water.id, limit: 65, km: "6", kinds: ["WATER", "FOOD"] }]);
    const kinds = await stamp();
    expect(kinds).not.toBe(moved);
    await save([{ ...WATER, id: water.id, limit: 65, km: "6", kinds: ["WATER", "FOOD", "DIRECTION"] }]);
    const direction = await stamp();
    expect(direction).not.toBe(kinds);
    await save([{ ...WATER, id: water.id, limit: 65, km: "6", kinds: ["WATER", "FOOD", "DIRECTION"], nameRo: "Alt nume", nameEn: "Other name" }]);
    expect(await stamp()).toBe(direction);
    // A moved start moves the clock a limit closes at, so the pictures that print it are new addresses.
    await db.update(events).set({ raceStartsAt: new Date("2026-11-21T08:00:00.000Z"), endsAt: new Date("2026-11-21T11:00:00.000Z") }).where(eq(events.id, eventId));
    const gun = await stamp();
    expect(gun).not.toBe(direction);
    await db.update(events).set({ raceStartsAt: new Date("2026-11-21T08:15:00.000Z"), endsAt: new Date("2026-11-21T11:15:00.000Z") }).where(eq(events.id, eventId));
    expect(await stamp()).not.toBe(gun);
    await save([{ ...WATER, id: water.id, remove: true }]);
    expect(await stamp()).toBe(none);
  });
});

describe("§NNN «Arată pe profilul traseului» — the tick on each point", () => {
  const onProfileOf = async () => Object.fromEntries((await listCheckpoints(db, eventId)).map((row) => [row.nameRo, row.onProfile]));

  it("is on for a new point and for any point the form did not carry the box for", async () => {
    // A form drawn before the box existed posts neither the box nor its marker: the point is on, as the column's default says.
    await save([WATER]);
    expect(await onProfileOf()).toEqual({ Apă: true });
    // A form that drew the box and had it ticked.
    await save([{ ...FOOD, onProfile: true }]);
    expect(await onProfileOf()).toEqual({ Apă: true, Mâncare: true });
  });

  it("saves an unticked box as off, reads it back, and says so in the audit trail", async () => {
    await save([{ ...WATER, onProfile: false }]);
    expect(await onProfileOf()).toEqual({ Apă: false });
    const stored = await db.select().from(eventCheckpoints).where(eq(eventCheckpoints.eventId, eventId));
    expect(stored.map((row) => row.onProfile)).toEqual([false]);
  });

  it("changes with the tick alone: a saved point ticked off is an edit, ticked on again another, and an unchanged save records nothing", async () => {
    await save([{ ...WATER, onProfile: true }]);
    const [water] = await listCheckpoints(db, eventId);
    expect(await actions()).toEqual(["event_checkpoints.changed"]);
    await save([{ ...WATER, id: water.id, onProfile: false }]);
    expect(await onProfileOf()).toEqual({ Apă: false });
    expect((await trail())[1].metadataJson).toMatchObject({ added: 0, edited: 1, removed: 0 });
    await save([{ ...WATER, id: water.id, onProfile: false }]);
    expect(await trail()).toHaveLength(2);
    await save([{ ...WATER, id: water.id, onProfile: true }]);
    expect(await onProfileOf()).toEqual({ Apă: true });
    expect(await trail()).toHaveLength(3);
  });

  it("keeps a point's tick when a form that did not draw the box saves it: «not posted» is never «unticked»", async () => {
    await save([{ ...WATER, onProfile: false }]);
    const [water] = await listCheckpoints(db, eventId);
    // A stale form from before the release: the same point, no box, no marker — and a new point beside it.
    await save([{ ...WATER, id: water.id, nameEn: "Water point" }, FOOD]);
    expect(await onProfileOf()).toEqual({ Apă: false, Mâncare: true });
    expect((await listCheckpoints(db, eventId)).find((row) => row.nameRo === "Apă")?.nameEn).toBe("Water point");
  });

  it("keeps the ticks of the points a form was not told about", async () => {
    await save([{ ...WATER, onProfile: false }, { ...FOOD, onProfile: true }]);
    const [water] = await listCheckpoints(db, eventId);
    // A colleague's list in the form has only the food: the water, unticked, survives the save as it was.
    await save([{ ...FOOD, id: (await listCheckpoints(db, eventId))[1].id, onProfile: true }]);
    expect(await onProfileOf()).toEqual({ Apă: false, Mâncare: true });
    expect(water.onProfile).toBe(false);
  });

  it("puts a point taken from the GPX on the chart", async () => {
    const stored = await storeRouteGpx(getStorage(), {
      bytes: Buffer.from(
        `<?xml version="1.0"?><gpx version="1.1" creator="test"><wpt lat="45.6" lon="25.6"><name>Izvor</name><sym>Drinking Water</sym></wpt><trk><trkseg>${Array.from({ length: 55 }, (_, step) => `<trkpt lat="45.6" lon="${(25.5 + step * 0.005).toFixed(3)}"><ele>600</ele></trkpt>`).join("")}</trkseg></trk></gpx>`,
      ),
      name: "Traseu.gpx",
      environment: "test",
      now: new Date("2026-10-13T10:00:00.000Z"),
    });
    await db.update(events).set({ routeGpx: stored as never }).where(eq(events.id, eventId));
    const waypoints = await loadGpxWaypoints((stored as { key: string }).key);
    expect(waypoints?.proposals.length).toBeGreaterThan(0);
    const data = new FormData();
    data.set("uiLocale", "ro");
    data.set("eventId", eventId);
    data.set("gpxKey", (stored as { key: string }).key);
    data.append("pick", "0");
    data.set("cp[0].nameRo", "Izvorul");
    data.set("cp[0].nameEn", "The spring");
    expect(await post(addGpxCheckpointsAction, data)).toBe("redirected");
    expect(await onProfileOf()).toEqual({ Izvorul: true });
  });

  it("leaves the race number's picture alone: the tick is not part of its stamp", async () => {
    await db.insert(eventTranslations).values({ eventId, locale: "ro", slug: "cursa", title: "Cursa" });
    const stamp = async () => {
      const [row] = await db
        .select({ stamp: BIB_STAMP })
        .from(events)
        .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
        .where(eq(events.id, eventId));
      return row.stamp;
    };
    await save([{ ...WATER, onProfile: true }]);
    const ticked = await stamp();
    const [water] = await listCheckpoints(db, eventId);
    await save([{ ...WATER, id: water.id, onProfile: false }]);
    expect(await stamp()).toBe(ticked);
  });

  it("keeps the table's list whole: every point is listed, ticked or not", async () => {
    await save([{ ...WATER, onProfile: false }, { ...FOOD, onProfile: true }]);
    expect((await listCheckpoints(db, eventId)).map((row) => row.nameRo)).toEqual(["Apă", "Mâncare"]);
  });
});
