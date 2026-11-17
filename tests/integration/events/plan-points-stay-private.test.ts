import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { duplicateEvent } from "@/modules/content/events/service";
import { exportEvent, readEventConfig } from "@/modules/content/events/transfer/export";
import { serializeEventFile } from "@/modules/content/events/transfer/file-format";
import { assertSavedCheckpointsHold, changeCheckpoints, copyCheckpoints, listCheckpoints, replaceCheckpoints, SavedCheckpointsRefusal } from "@/modules/event-checkpoints/checkpoints";
import { CHECKPOINTS_MAX, type Checkpoint, checkpointRows, checkpointsStampPart, type PostedCheckpoint, profileMarkers } from "@/modules/event-checkpoints/domain/checkpoint";
import { BIB_STAMP } from "@/modules/events/repository";
import { type BibProfileSource, withBibCheckpoints } from "@/modules/registrations/bib-extras";
import { changePlanPoint, listPlanPoints } from "@/modules/volunteers/plan-points";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, BR-REQ-011-01, BR-REQ-050-02 — a point of the volunteers' plan alone, and where any point is, are never public.
 *
 * «Punctele planului» (the owner, 2026-11-17: «vreau să pot defini punctele de mână, să pun nume punct și la ce km e și
 * coordonate punct») keeps its points in the table of the event's «Puncte pe traseu». This file holds the public side of
 * that table to what it was — from a real database, with a route point of the plan's own, a start–finish point and a point
 * with coordinates in it:
 *
 * - **every reader that existed** returns exactly what it returns without them: `listCheckpoints`, the public read behind the
 *   event's page (`public-cache/reads.ts`), the event's file, a copy of the event («Duplică», `copyCheckpoints`), and the race
 *   number's — its checkpoints, its stamp in TypeScript and its stamp in SQL;
 * - **every writer that existed** leaves them alone: the editor's save and an import never touch, delete, renumber or carry a
 *   plan-only point, a kept row keeps its coordinates through both, the editor's thirty counts the editor's points only, and
 *   a point of the plan standing past the route's length breaks no event save;
 * - and the people standing at the plan's own points stay there through all of it.
 *
 * That no other file reads the plan's side of the table is `tests/unit/volunteers/plan-points-never-leave.test.ts`.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { cachedEventCheckpoints } = await import("@/modules/public-cache/reads");

const NOW = new Date("2026-11-16T10:00:00.000Z");
/** Numbers no event of this file has for its own place: found anywhere public, they came from a point. */
const SPRING = "44.123456, 26.654321";
const KITS = "44.234567, 26.765432";
const WATER = "44.345678, 26.876543";
const SECRETS = ["Izvorul ascuns", "Kituri secrete", "44.123456", "26.654321", "44.234567", "26.765432", "44.345678", "26.876543"];

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;
let eventId: string;
const points = { junction: "", water: "", bridge: "", spring: "", kits: "" };
const people = { ana: "", radu: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

const posted = (over: Partial<PostedCheckpoint> & { index: number }): PostedCheckpoint => ({
  id: "",
  nameRo: "",
  nameEn: "",
  km: "",
  kinds: [],
  cutoffHours: "",
  cutoffMinutesPart: "",
  noteRo: "",
  noteEn: "",
  onProfile: true,
  remove: false,
  ...over,
});

async function volunteer(name: string, checkpointId: string): Promise<string> {
  const email = `${name.toLowerCase()}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId, name, email, canonicalEmail: email, canonicalizationVersion: 1, phone: "+40700000001", source: "PUBLIC", state: "CONFIRMED", checkpointId, createdAt: NOW, updatedAt: NOW })
    .returning({ id: eventVolunteers.id });
  return row.id;
}

beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Ana Admin", role: "ADMIN" }).returning();
  [organizer] = await db.insert(staffUsers).values({ email: "organizer@example.test", displayName: "Oana Organizator", role: "MODERATOR" }).returning();
  // A 21.1 km race with its gun at 09:00 on its own clock and three hours to finish.
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-11-21T07:00:00.000Z"), raceStartsAt: new Date("2026-11-21T07:00:00.000Z"), endsAt: new Date("2026-11-21T10:00:00.000Z"), distanceMeters: 21_100 })
    .returning({ id: events.id });
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: `crosul-${eventId.slice(0, 8)}`, title: "Crosul" },
    { eventId, locale: "en", slug: `cross-${eventId.slice(0, 8)}`, title: "The cross" },
  ]);
  // The editor's three points, saved as the card saves them: what a point offers, a limit, a note, one off the chart.
  await changeCheckpoints(
    db,
    admin,
    {
      kind: "save",
      eventId,
      rows: [
        posted({ index: 0, nameRo: "Apă la cabană", nameEn: "Water at the hut", km: "5,5", kinds: ["WATER", "FOOD"], cutoffHours: "1", cutoffMinutesPart: "0", noteRo: "Pahare", noteEn: "Cups" }),
        posted({ index: 1, nameRo: "Podul de lemn", nameEn: "The wooden bridge", km: "7.25", kinds: ["DIRECTION"], onProfile: false }),
        posted({ index: 2, nameRo: "Intersecția Stejeriș", nameEn: "Stejeriș junction", km: "1,2", kinds: ["DIRECTION"] }),
      ],
    },
    NOW,
  );
  const saved = await listCheckpoints(db, eventId);
  [points.junction, points.water, points.bridge] = saved.map((row) => row.id);
});

/** Everything the public side reads of the event's points, as one value to compare. */
async function publicSide() {
  const list = await listCheckpoints(db, eventId);
  const source: BibProfileSource = { routeGpx: { key: "route/a.gpx" } as never, distanceMeters: 21_100, elevationGainMeters: null };
  const [stamped] = await db
    .select({ stamp: BIB_STAMP })
    .from(events)
    .innerJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, "ro")))
    .where(eq(events.id, eventId));
  const config = (await readEventConfig(db, eventId))!.config;
  const { file } = await exportEvent(db, { actor: admin, eventId, now: NOW });
  return {
    list,
    // The event's page: the cached read, the table's rows and the chart's pins.
    page: await cachedEventCheckpoints(eventId),
    rows: checkpointRows(list, { km: 21.1, limit: "12:00", minutes: 180 }),
    markers: profileMarkers(list, "ro"),
    // The race number: the checkpoints it draws, and the stamp of its picture in TypeScript and in SQL.
    bib: (await withBibCheckpoints(db, eventId, source, { showProfile: true, showCheckpoints: true })).checkpoints,
    stampPart: checkpointsStampPart(list),
    sqlStamp: stamped.stamp,
    // The event's file: its configuration, and the file itself as it is written.
    config,
    file: serializeEventFile(file),
  };
}

/** The plan's own points and the coordinates, added as the plan's page adds them; people standing at each. */
async function addThePlansOwn() {
  points.spring = (await changePlanPoint(db, organizer, { kind: "add", eventId, place: "route", name: "Izvorul ascuns", km: "3,4", coordinates: SPRING }, NOW)).id;
  points.kits = (await changePlanPoint(db, organizer, { kind: "add", eventId, place: "startFinish", name: "Kituri secrete", km: "", coordinates: KITS }, NOW)).id;
  // …and where one of the editor's own points is.
  await changePlanPoint(db, organizer, { kind: "edit", eventId, id: points.water, place: "route", name: "", km: "", coordinates: WATER }, NOW);
  people.ana = await volunteer("Ana", points.spring);
  people.radu = await volunteer("Radu", points.kits);
}

const rowOf = async (id: string) => (await db.select().from(eventCheckpoints).where(eq(eventCheckpoints.id, id)))[0];
const rowsOf = (id = eventId) => db.select().from(eventCheckpoints).where(eq(eventCheckpoints.eventId, id)).orderBy(asc(eventCheckpoints.km), asc(eventCheckpoints.position));
const standsAt = async (id: string) => (await db.select({ at: eventVolunteers.checkpointId }).from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0].at;
const CHECKPOINT_KEYS: (keyof Checkpoint)[] = ["id", "nameRo", "nameEn", "km", "kinds", "cutoffMinutes", "cutoffClock", "noteRo", "noteEn", "onProfile"];

describe("§NNN every reader that existed returns what it returned", () => {
  it("reads the same list, page, race number, stamp and file with a plan-only route point, a start–finish point and a point with coordinates in the table", async () => {
    const before = await publicSide();
    expect(before.list.map((row) => row.nameRo)).toEqual(["Intersecția Stejeriș", "Apă la cabană", "Podul de lemn"]);
    // A reader that reads nothing proves nothing: each has something to say of these three points.
    expect(before.page).toHaveLength(3);
    expect(before.rows).toHaveLength(4);
    expect(before.markers).toHaveLength(2);
    expect(before.bib).toHaveLength(3);
    expect(before.stampPart).toContain("5.50:WATER+FOOD:60@10:00");
    expect(before.config.route.checkpoints).toHaveLength(3);

    await addThePlansOwn();
    // They are in the table, and the plan's own reader sees all five.
    expect((await rowsOf()).length).toBe(5);
    expect((await listPlanPoints(db, eventId)).map((point) => [point.number, point.nameRo, point.latitude])).toEqual([
      [null, "Kituri secrete", 44.234567],
      [1, "Intersecția Stejeriș", null],
      [2, "Izvorul ascuns", 44.123456],
      [3, "Apă la cabană", 44.345678],
      [4, "Podul de lemn", null],
    ]);

    // …and the public side is, value for value, what it was.
    const after = await publicSide();
    expect(after).toEqual(before);
    // Not a name of a plan's own point and not a digit of a coordinate, anywhere a public reader looks.
    const said = JSON.stringify(after);
    for (const secret of SECRETS) expect(said, secret).not.toContain(secret);
    // A `Checkpoint` has no field for the kind or the coordinates: nothing a reader could pass on by spreading it.
    for (const reader of [after.list, after.page, after.bib ?? []]) {
      for (const row of reader) expect(Object.keys(row).sort()).toEqual([...CHECKPOINT_KEYS].sort());
    }
    for (const row of after.config.route.checkpoints) for (const key of Object.keys(row)) expect(key).not.toMatch(/plan|startFinish|latitude|longitude|coordinates/i);
  });

  it("changes no stamp of the race number's picture when a point of the plan's own is added, moved, given coordinates or deleted", async () => {
    const before = await publicSide();
    await addThePlansOwn();
    await changePlanPoint(db, organizer, { kind: "edit", eventId, id: points.spring, place: "route", name: "Izvorul ascuns", km: "9", coordinates: "" }, NOW);
    expect((await publicSide()).sqlStamp).toBe(before.sqlStamp);
    await changePlanPoint(db, organizer, { kind: "edit", eventId, id: points.spring, place: "startFinish", name: "Izvorul ascuns", km: "", coordinates: SPRING }, NOW);
    await changePlanPoint(db, organizer, { kind: "remove", eventId, id: points.kits }, NOW);
    const after = await publicSide();
    expect([after.sqlStamp, after.stampPart]).toEqual([before.sqlStamp, before.stampPart]);
    // Beside a change that does move it — an editor's point retimed — so «the same» above is the plan's doing.
    await db.update(eventCheckpoints).set({ cutoffMinutes: 75 }).where(eq(eventCheckpoints.id, points.water));
    expect((await publicSide()).sqlStamp).not.toBe(before.sqlStamp);
  });

  it("carries neither onto a copy of the event: «Duplică» and `copyCheckpoints` copy the editor's three points, with no coordinates", async () => {
    await addThePlansOwn();
    const copy = await duplicateEvent(db, { actor: admin, eventId, now: NOW });
    const copied = await rowsOf(copy.id);
    expect(copied.map((row) => [row.nameRo, row.nameEn, row.km, row.planOnly, row.startFinish, row.latitude, row.longitude])).toEqual([
      ["Intersecția Stejeriș", "Stejeriș junction", "1.20", false, false, null, null],
      ["Apă la cabană", "Water at the hut", "5.50", false, false, null, null],
      ["Podul de lemn", "The wooden bridge", "7.25", false, false, null, null],
    ]);
    // The copy's plan starts with the route alone: no start–finish, nothing of the plan's own.
    expect((await listPlanPoints(db, copy.id)).map((point) => [point.number, point.planOnly, point.startFinish])).toEqual([
      [1, false, false],
      [2, false, false],
      [3, false, false],
    ]);
    // The same by the function a series' new dates use.
    const [other] = await db.insert(events).values({ type: "RACE", startsAt: new Date("2026-12-05T07:00:00.000Z") }).returning({ id: events.id });
    expect(await copyCheckpoints(db, eventId, other.id, NOW)).toBe(3);
    expect((await rowsOf(other.id)).every((row) => !row.planOnly && !row.startFinish && row.latitude === null && row.longitude === null)).toBe(true);
    // The source keeps everything it had.
    expect((await rowsOf()).length).toBe(5);
  });
});

describe("§NNN every writer that existed leaves the plan's own points and every coordinate alone", () => {
  it("keeps them through an editor's save that renames, moves, adds and removes points — and a kept row keeps its coordinates", async () => {
    await addThePlansOwn();
    const own = { spring: await rowOf(points.spring), kits: await rowOf(points.kits) };
    const water = await rowOf(points.water);
    expect(water).toMatchObject({ latitude: "44.345678", longitude: "26.876543" });

    // The card as an Administrator saves it: the water renamed and moved, the bridge kept, the junction ticked «Scoate», one new point.
    const result = await changeCheckpoints(
      db,
      admin,
      {
        kind: "save",
        eventId,
        rows: [
          posted({ index: 0, id: points.water, nameRo: "Apă la izvor", nameEn: "Water at the spring", km: "6", kinds: ["WATER"], cutoffHours: "1", cutoffMinutesPart: "30" }),
          posted({ index: 1, id: points.bridge, nameRo: "Podul de lemn", nameEn: "The wooden bridge", km: "7.25", kinds: ["DIRECTION"], onProfile: false }),
          posted({ index: 2, id: points.junction, nameRo: "Intersecția Stejeriș", nameEn: "Stejeriș junction", km: "1,2", kinds: ["DIRECTION"], remove: true }),
          posted({ index: 3, nameRo: "Sosire", nameEn: "Finish", km: "21", kinds: ["TIMING"] }),
        ],
      },
      NOW,
    );
    expect(result).toEqual({ changed: true, added: 1, edited: 1, removed: 1 });

    // The plan's own two rows: every column as it was — not renumbered, not renamed, not deleted.
    expect(await rowOf(points.spring)).toEqual(own.spring);
    expect(await rowOf(points.kits)).toEqual(own.kits);
    // The kept row: the editor's columns are the save's, the coordinates still the plan's.
    expect(await rowOf(points.water)).toMatchObject({ nameRo: "Apă la izvor", km: "6.00", cutoffMinutes: 90, latitude: "44.345678", longitude: "26.876543", planOnly: false, startFinish: false });
    // The new point is the editor's own, with no coordinates.
    expect((await rowsOf()).find((row) => row.nameRo === "Sosire")).toMatchObject({ planOnly: false, startFinish: false, latitude: null, longitude: null });
    expect(await rowOf(points.junction)).toBeUndefined();
    // The editor's list is its own three; the people at the plan's own points stand where they stood.
    expect((await listCheckpoints(db, eventId)).map((row) => row.nameRo)).toEqual(["Apă la izvor", "Podul de lemn", "Sosire"]);
    expect([await standsAt(people.ana), await standsAt(people.radu)]).toEqual([points.spring, points.kits]);
    // The editor's trail names the editor's points alone, before and after: both of its rows, the first save's and this one's.
    const audits = (await db.select().from(auditLogs).where(eq(auditLogs.entityId, eventId))).filter((row) => row.action === "event_checkpoints.changed");
    expect(audits).toHaveLength(2);
    const told = JSON.stringify(audits.map((row) => row.metadataJson));
    expect(told).toContain("Apă la izvor");
    for (const secret of SECRETS) expect(told, secret).not.toContain(secret);
  });

  it("drops a forged save that names a plan's own point by its id: neither changed nor deleted, and never copied into the editor's list", async () => {
    await addThePlansOwn();
    const before = await rowsOf();
    const editors = await listCheckpoints(db, eventId);
    const result = await changeCheckpoints(
      db,
      admin,
      {
        kind: "save",
        eventId,
        rows: [
          posted({ index: 0, id: points.spring, nameRo: "Al editorului acum", nameEn: "The editor's now", km: "2", kinds: ["WATER"] }),
          posted({ index: 1, id: points.kits, nameRo: "Kituri secrete", nameEn: "Kituri secrete", km: "0", remove: true }),
        ],
      },
      NOW,
    );
    expect(result).toEqual({ changed: false, added: 0, edited: 0, removed: 0 });
    expect(await rowsOf()).toEqual(before);
    expect(await listCheckpoints(db, eventId)).toEqual(editors);
  });

  it(`counts the editor's thirty by the editor's points alone: ${CHECKPOINTS_MAX} of them fit beside the plan's own, the next is refused`, async () => {
    await addThePlansOwn();
    const more = Array.from({ length: CHECKPOINTS_MAX - 3 }, (_, at) => posted({ index: 10 + at, nameRo: `Punct ${at}`, nameEn: `Point ${at}`, km: (8 + at * 0.4).toFixed(1) }));
    expect(await changeCheckpoints(db, admin, { kind: "save", eventId, rows: more }, NOW)).toMatchObject({ changed: true, added: CHECKPOINTS_MAX - 3 });
    expect(await listCheckpoints(db, eventId)).toHaveLength(CHECKPOINTS_MAX);
    expect(await rowsOf()).toHaveLength(CHECKPOINTS_MAX + 2);
    await expect(changeCheckpoints(db, admin, { kind: "save", eventId, rows: [posted({ index: 99, nameRo: "Unul în plus", nameEn: "One more", km: "20" })] }, NOW)).rejects.toMatchObject({ reason: "CHECKPOINT_TOO_MANY" });
  });

  it("keeps them through an import that replaces the event's list — a point the file still has keeps its coordinates, one it dropped takes them along", async () => {
    await addThePlansOwn();
    await changePlanPoint(db, organizer, { kind: "edit", eventId, id: points.junction, place: "route", name: "", km: "", coordinates: "44.456789, 26.987654" }, NOW);
    const own = { spring: await rowOf(points.spring), kits: await rowOf(points.kits) };

    // The file: the water as it is named and placed (kept, its note changed), a new point, and neither the junction nor the bridge.
    const result = await replaceCheckpoints(
      db,
      admin,
      eventId,
      [
        { nameRo: "Apă la cabană", nameEn: "Water by the hut", km: 5.5, kinds: ["WATER"], cutoffMinutes: 45, noteRo: "Pahare noi", noteEn: "New cups", onProfile: true },
        { nameRo: "Sosire", nameEn: "Finish", km: 21, kinds: ["TIMING"], cutoffMinutes: null, noteRo: null, noteEn: null, onProfile: true },
      ],
      NOW,
    );
    expect(result).toEqual({ changed: true });

    expect(await rowOf(points.spring)).toEqual(own.spring);
    expect(await rowOf(points.kits)).toEqual(own.kits);
    // The kept row: the file's words, the plan's coordinates.
    expect(await rowOf(points.water)).toMatchObject({ nameEn: "Water by the hut", cutoffMinutes: 45, noteRo: "Pahare noi", latitude: "44.345678", longitude: "26.876543" });
    // The points the file no longer has are gone, coordinates and all; the file's new point has none.
    expect(await rowOf(points.junction)).toBeUndefined();
    expect(await rowOf(points.bridge)).toBeUndefined();
    expect((await rowsOf()).find((row) => row.nameRo === "Sosire")).toMatchObject({ planOnly: false, latitude: null, longitude: null });
    expect((await listCheckpoints(db, eventId)).map((row) => row.nameRo)).toEqual(["Apă la cabană", "Sosire"]);
    // The people at the plan's own points were never the import's to free.
    expect([await standsAt(people.ana), await standsAt(people.radu)]).toEqual([points.spring, points.kits]);
    // An import of the very list the editor has changes nothing, whatever the plan holds beside it.
    const same = (await listCheckpoints(db, eventId)).map((row) => ({
      nameRo: row.nameRo,
      nameEn: row.nameEn,
      km: row.km,
      kinds: row.kinds,
      cutoffMinutes: row.cutoffMinutes,
      noteRo: row.noteRo,
      noteEn: row.noteEn,
      onProfile: row.onProfile,
    }));
    expect(await replaceCheckpoints(db, admin, eventId, same, NOW)).toEqual({ changed: false });
  });

  it("holds an event's save to the editor's points alone: a point of the plan standing past the route's length breaks nothing", async () => {
    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    // The plan is the organizers' own: a point at kilometre 500 of a 21.1 km route, and one at the start–finish.
    await changePlanPoint(db, organizer, { kind: "add", eventId, place: "route", name: "Departe", km: "500", coordinates: "" }, NOW);
    await changePlanPoint(db, organizer, { kind: "add", eventId, place: "startFinish", name: "Kituri", km: "", coordinates: "" }, NOW);
    await expect(assertSavedCheckpointsHold(db, event, null)).resolves.toBeUndefined();
    // …while an editor's point there would: the rule still holds the public list.
    await db.insert(eventCheckpoints).values({ eventId, nameRo: "Prea departe", nameEn: "Too far", km: "30.00", position: 9 });
    await expect(assertSavedCheckpointsHold(db, event, null)).rejects.toBeInstanceOf(SavedCheckpointsRefusal);
  });
});
