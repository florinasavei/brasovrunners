import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_KINDS,
  CHECKPOINT_NAME_MAX,
  CHECKPOINTS_MAX,
  type Checkpoint,
  CheckpointRefusal,
  type CheckpointContext,
  checkpointContext,
  checkpointRows,
  checkpointsStampPart,
  canEditCheckpoints,
  canReadCheckpoints,
  cutoffOffset,
  isBlankPosted,
  type PostedCheckpoint,
  prepareCheckpoints,
  readClockTime,
  readKm,
  sortedByKm,
} from "@/modules/event-checkpoints/domain/checkpoint";
import { checkpointFinish, checkpointStart } from "@/modules/event-checkpoints/domain/start";
import { STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * §NNN, BR-REQ-011-01 — the checkpoints' rules, with no database: a kilometre read as typed and held
 * to the route's length, the cut-offs measured from the start and against each other, a note in both
 * languages or neither, the order a runner meets the points, the page's rows with the finish last.
 */

/** A route of 21.1 km, a race starting at 09:00 (540 minutes), a three-hour limit. */
const CONTEXT: CheckpointContext = { routeKm: 21.1, startMinutes: 540, limitMinutes: 180 };

const row = (index: number, over: Partial<PostedCheckpoint> = {}): PostedCheckpoint => ({
  index,
  id: "",
  nameRo: `Punct ${index}`,
  nameEn: `Point ${index}`,
  km: String(index + 1),
  kinds: [],
  cutoff: "",
  noteRo: "",
  noteEn: "",
  remove: false,
  ...over,
});

function refusal(posted: PostedCheckpoint[], context = CONTEXT): CheckpointRefusal {
  try {
    prepareCheckpoints(posted, context);
  } catch (error) {
    if (error instanceof CheckpointRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("§NNN a kilometre and a time of the day, as typed", () => {
  it.each([
    ["12", 12],
    ["12,5", 12.5],
    ["12.50", 12.5],
    [" 7,25 km ", 7.25],
    ["0", 0],
    ["9999.99", 9999.99],
  ])("reads %s as %s", (typed, km) => expect(readKm(typed)).toBe(km));

  it.each(["", "abc", "-1", "1e3", "12,555", "10000", "1,2,3", "12 km 3"])("refuses %j as a kilometre", (typed) => expect(readKm(typed)).toBeNull());

  it.each([
    ["11:30", "11:30"],
    ["9:05", "09:05"],
    ["00:00", "00:00"],
    ["23:59", "23:59"],
    ["11:30:00", "11:30"],
  ])("reads %s as %s", (typed, time) => expect(readClockTime(typed)).toBe(time));

  it.each(["", "24:00", "11:60", "1130", "11.30", "noon"])("refuses %j as a time", (typed) => expect(readClockTime(typed)).toBeNull());

  it("counts a cut-off from the start: before the start when earlier than its time of day, the next day's only for a race that ends the next day", () => {
    expect(cutoffOffset("11:30", 540)).toBe(150);
    expect(cutoffOffset("09:00", 540)).toBe(0);
    // An ordinary race: 08:59 is a minute before the start, never the next day's.
    expect(cutoffOffset("08:59", 540)).toBe(-1);
    expect(cutoffOffset("08:59", 540, 180)).toBe(-1);
    // A night race from 22:00 ending at 06:00 (480 minutes): 02:00 is four hours later.
    expect(cutoffOffset("02:00", 22 * 60, 480)).toBe(240);
    expect(cutoffOffset("23:30", 22 * 60, 480)).toBe(90);
    // With no end given the race ends the day it starts.
    expect(cutoffOffset("02:00", 22 * 60)).toBe(-1200);
    // No start known: the time of the day itself.
    expect(cutoffOffset("11:30", null)).toBe(690);
  });
});

describe("§NNN the rules a checkpoint is held to", () => {
  it("drops the spare rows nobody typed in and the rows ticked «Scoate»", () => {
    const blank = row(5, { nameRo: "", nameEn: "", km: "" });
    expect(isBlankPosted(blank)).toBe(true);
    const removed = row(1, { id: "11111111-1111-4111-8111-111111111111", remove: true });
    expect(prepareCheckpoints([row(0), blank, removed], CONTEXT).map((r) => r.nameRo)).toEqual(["Punct 0"]);
  });

  it("keeps the points in distance order, ties in the order typed, with the closed set's kinds in their own order", () => {
    const rows = prepareCheckpoints(
      [row(0, { km: "10", nameRo: "B" }), row(1, { km: "5", nameRo: "A", kinds: ["TIMING", "WATER"] }), row(2, { km: "10", nameRo: "C" })],
      CONTEXT,
    );
    expect(rows.map((r) => r.nameRo)).toEqual(["A", "B", "C"]);
    expect(rows[0].kinds).toEqual(["WATER", "TIMING"]);
    expect(CHECKPOINT_KINDS).toEqual(["WATER", "FOOD", "FIRST_AID", "TIMING"]);
  });

  it("folds a name to one line and refuses a missing or an over-long one, in either language, naming the box", () => {
    expect(prepareCheckpoints([row(0, { nameRo: "  Apă   la  vârf ", nameEn: "Water" })], CONTEXT)[0].nameRo).toBe("Apă la vârf");
    const missing = refusal([row(0, { nameEn: "  " })]);
    expect(missing.reason).toBe("CHECKPOINT_NAME_MISSING");
    expect(missing.fields).toEqual(["cp[0].nameEn"]);
    const both = refusal([row(0, { nameRo: "", nameEn: "" })].map((r) => ({ ...r, km: "3" })));
    expect(both.fields).toEqual(["cp[0].nameRo", "cp[0].nameEn"]);
    const long = refusal([row(0, { nameRo: "x".repeat(CHECKPOINT_NAME_MAX + 1) })]);
    expect(long.fields).toEqual(["cp[0].nameRo"]);
    expect(long.values.max).toBe(String(CHECKPOINT_NAME_MAX));
  });

  it("refuses a kilometre that is no number, and one beyond the route's length with the reason and the length", () => {
    expect(refusal([row(0, { km: "abc" })]).reason).toBe("CHECKPOINT_KM_INVALID");
    const beyond = refusal([row(2, { km: "21,2", nameRo: "Dincolo" })]);
    expect(beyond.reason).toBe("CHECKPOINT_KM_BEYOND_ROUTE");
    expect(beyond.fields).toEqual(["cp[2].km"]);
    expect(beyond.values).toMatchObject({ name: "Dincolo", km: "21.2", max: "21.1" });
    // The route's own length is allowed, and a metres figure is rounded up to the hundredth.
    expect(prepareCheckpoints([row(0, { km: "21,1" })], CONTEXT)).toHaveLength(1);
    expect(prepareCheckpoints([row(0, { km: "21,10" })], { ...CONTEXT, routeKm: 21.097 })).toHaveLength(1);
    // No length known: nothing to hold the kilometre to.
    expect(prepareCheckpoints([row(0, { km: "400" })], { ...CONTEXT, routeKm: null })).toHaveLength(1);
  });

  it("refuses a kind outside the closed set", () => {
    expect(refusal([row(0, { kinds: ["WATER", "PIZZA"] })]).reason).toBe("CHECKPOINT_KIND_UNKNOWN");
  });

  it("refuses a cut-off that is not a time, and one at or before the start", () => {
    expect(refusal([row(0, { cutoff: "noon" })]).reason).toBe("CHECKPOINT_CUTOFF_INVALID");
    const early = refusal([row(0, { cutoff: "09:00" })]);
    expect(early.reason).toBe("CHECKPOINT_CUTOFF_BEFORE_START");
    expect(early.fields).toEqual(["cp[0].cutoff"]);
    // 08:30 is before a 09:00 start: an ordinary race has no next day to put it on.
    expect(refusal([row(0, { cutoff: "08:30" })]).reason).toBe("CHECKPOINT_CUTOFF_BEFORE_START");
    // With no start known, nothing to be before.
    expect(prepareCheckpoints([row(0, { cutoff: "05:00" })], { ...CONTEXT, startMinutes: null, limitMinutes: null })).toHaveLength(1);
  });

  it("refuses a cut-off after the one of a point further along, naming the earlier point's box", () => {
    const wrong = refusal([row(0, { km: "5", cutoff: "11:00", nameRo: "Prima" }), row(1, { km: "10", cutoff: "10:30", nameRo: "A doua" })]);
    expect(wrong.reason).toBe("CHECKPOINT_CUTOFF_AFTER_LATER");
    expect(wrong.fields).toEqual(["cp[0].cutoff"]);
    expect(wrong.values).toMatchObject({ name: "Prima", later: "A doua", laterCutoff: "10:30" });
    // The order is the kilometre's, never the order the rows were typed in.
    const fine = prepareCheckpoints([row(0, { km: "10", cutoff: "11:00" }), row(1, { km: "5", cutoff: "10:15" })], CONTEXT);
    expect(fine.map((r) => r.cutoff)).toEqual(["10:15", "11:00"]);
    // The same minute at two points is allowed; a point with none does not take part.
    expect(prepareCheckpoints([row(0, { km: "5", cutoff: "10:00" }), row(1, { km: "6" }), row(2, { km: "10", cutoff: "10:00" })], CONTEXT)).toHaveLength(3);
  });

  it("refuses a cut-off after the event's end when it has one", () => {
    const late = refusal([row(0, { cutoff: "12:30" })]);
    expect(late.reason).toBe("CHECKPOINT_CUTOFF_AFTER_END");
    expect(prepareCheckpoints([row(0, { cutoff: "12:00" })], CONTEXT)).toHaveLength(1);
  });

  it("counts a night race across midnight", () => {
    const night: CheckpointContext = { routeKm: 42, startMinutes: 22 * 60, limitMinutes: 8 * 60 };
    const rows = prepareCheckpoints([row(0, { km: "10", cutoff: "23:30" }), row(1, { km: "30", cutoff: "03:00" })], night);
    expect(rows.map((r) => r.cutoff)).toEqual(["23:30", "03:00"]);
    expect(refusal([row(0, { km: "10", cutoff: "03:00" }), row(1, { km: "30", cutoff: "23:30" })], night).reason).toBe("CHECKPOINT_CUTOFF_AFTER_LATER");
  });

  it("holds a note to both languages or neither, at most 120 characters each", () => {
    expect(prepareCheckpoints([row(0, { noteRo: " Pe stânga ", noteEn: "On the left" })], CONTEXT)[0]).toMatchObject({ noteRo: "Pe stânga", noteEn: "On the left" });
    expect(prepareCheckpoints([row(0)], CONTEXT)[0]).toMatchObject({ noteRo: null, noteEn: null });
    const one = refusal([row(0, { noteRo: "doar română" })]);
    expect(one.reason).toBe("CHECKPOINT_NOTE_ONE_LANGUAGE");
    expect(one.fields).toEqual(["cp[0].noteEn"]);
    expect(refusal([row(0, { noteRo: "x".repeat(121), noteEn: "y" })]).fields).toEqual(["cp[0].noteRo"]);
  });

  it("refuses more points than a route holds", () => {
    const many = Array.from({ length: CHECKPOINTS_MAX + 1 }, (_, i) => row(i, { km: String((i % 20) + 1) }));
    const refused = refusal(many);
    expect(refused.reason).toBe("CHECKPOINT_TOO_MANY");
    expect(refused.values.max).toBe(String(CHECKPOINTS_MAX));
    expect(prepareCheckpoints(many.slice(0, CHECKPOINTS_MAX), CONTEXT)).toHaveLength(CHECKPOINTS_MAX);
  });

  it("is every refusal a validation error, with the box in its fields", () => {
    const error = refusal([row(0, { km: "x" })]);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.fields[0]).toMatch(/^cp\[\d+\]\./);
  });
});

describe("§NNN what the event says the points are measured against", () => {
  const at = (hours: number, minutes = 0) => new Date(Date.UTC(2026, 10, 21, hours, minutes));
  const wall = (instant: Date) => instant.getUTCHours() * 60 + instant.getUTCMinutes();

  it("takes the typed distance first, the track's second, and nothing when there is none", () => {
    const base = { start: at(9), endsAt: null, wallMinutesOf: wall };
    expect(checkpointContext({ ...base, distanceMeters: 21097, gpxMeters: 25000 }).routeKm).toBeCloseTo(21.097);
    expect(checkpointContext({ ...base, distanceMeters: null, gpxMeters: 25000 }).routeKm).toBe(25);
    expect(checkpointContext({ ...base, distanceMeters: null, gpxMeters: null }).routeKm).toBeNull();
    expect(checkpointContext({ ...base, distanceMeters: 0, gpxMeters: null }).routeKm).toBeNull();
  });

  it("reads the start's minute of the day and the span to the event's end", () => {
    const context = checkpointContext({ distanceMeters: 10_000, gpxMeters: null, start: at(9, 30), endsAt: at(12, 30), wallMinutesOf: wall });
    expect(context).toEqual({ routeKm: 10, startMinutes: 570, limitMinutes: 180 });
    expect(checkpointContext({ distanceMeters: null, gpxMeters: null, start: null, endsAt: at(12), wallMinutesOf: wall })).toMatchObject({ startMinutes: null, limitMinutes: null });
    // An end that is not after the start is no limit.
    expect(checkpointContext({ distanceMeters: null, gpxMeters: null, start: at(9), endsAt: at(8), wallMinutesOf: wall }).limitMinutes).toBeNull();
  });

  it("counts from the race's gun when there is one, and from nothing while the start's hour is blank", () => {
    const event = { startsAt: new Date("2026-11-21T07:00:00Z"), raceStartsAt: null, timezone: "Europe/Bucharest" };
    expect(checkpointStart(event)).toEqual(event.startsAt);
    const gun = new Date("2026-11-21T08:30:00Z");
    expect(checkpointStart({ ...event, raceStartsAt: gun })).toEqual(gun);
    // No hour typed: the provisional start has one second past noon (§545).
    expect(checkpointStart({ ...event, startsAt: new Date("2026-11-21T10:00:01Z") })).toBeNull();
    // No date typed: the undated day (§545).
    expect(checkpointStart({ ...event, startsAt: new Date("9999-01-01T10:00:00Z") })).toBeNull();
  });

  it("gives the finish row its limit on the event's own clock, and the route's length when typed", () => {
    const event = {
      startsAt: new Date("2026-11-21T07:00:00Z"), // 09:00 in Bucharest
      raceStartsAt: null,
      endsAt: new Date("2026-11-21T10:00:00Z"), // 12:00
      timezone: "Europe/Bucharest",
      distanceMeters: 21097,
    };
    expect(checkpointFinish(event)).toEqual({ km: 21.1, limit: "12:00" });
    expect(checkpointFinish({ ...event, endsAt: null, distanceMeters: null })).toEqual({ km: null, limit: null });
    expect(checkpointFinish({ ...event, endsAt: new Date("2026-11-21T06:00:00Z") }).limit).toBeNull();
  });
});

describe("§NNN the table the event page draws", () => {
  const point = (id: string, km: number, cutoff: string | null = null): Checkpoint => ({
    id,
    nameRo: id,
    nameEn: id,
    km,
    kinds: ["WATER"],
    cutoff,
    noteRo: null,
    noteEn: null,
  });

  it("is nothing without checkpoints, even with a time limit: the finish alone is no section", () => {
    expect(checkpointRows([], { km: 21.1, limit: "12:00" })).toEqual([]);
  });

  it("lists the points by distance and puts the finish last when the event has a time limit", () => {
    const rows = checkpointRows([point("b", 12, "10:30"), point("a", 5, "09:45")], { km: 21.1, limit: "12:00" });
    expect(rows.map((r) => (r.kind === "point" ? r.id : "finish"))).toEqual(["a", "b", "finish"]);
    expect(rows[2]).toEqual({ kind: "finish", km: 21.1, cutoff: "12:00" });
  });

  it("has no finish row without a time limit", () => {
    expect(checkpointRows([point("a", 5)], { km: 21.1, limit: null })).toHaveLength(1);
  });

  it("orders ties by how they were typed", () => {
    expect(sortedByKm([{ km: 2, n: "x" }, { km: 1, n: "y" }, { km: 2, n: "z" }]).map((r) => r.n)).toEqual(["y", "x", "z"]);
  });
});

describe("§NNN the picture stamp covers the checkpoints", () => {
  const base: Checkpoint = { id: "a", nameRo: "Apă", nameEn: "Water", km: 5, kinds: ["WATER"], cutoff: "10:00", noteRo: null, noteEn: null };

  it("changes with a kilometre, a kind or a cut-off, and not with a name or an id", () => {
    const stamp = checkpointsStampPart([base]);
    expect(stamp).toBe("5.00:WATER:10:00");
    expect(checkpointsStampPart([{ ...base, km: 5.5 }])).not.toBe(stamp);
    expect(checkpointsStampPart([{ ...base, kinds: ["WATER", "FOOD"] }])).not.toBe(stamp);
    expect(checkpointsStampPart([{ ...base, cutoff: "10:05" }])).not.toBe(stamp);
    expect(checkpointsStampPart([{ ...base, cutoff: null }])).not.toBe(stamp);
    expect(checkpointsStampPart([{ ...base, nameRo: "Alt nume", id: "b" }])).toBe(stamp);
    expect(checkpointsStampPart([])).toBe("");
  });

  it("is the same whatever order the rows come in", () => {
    const other: Checkpoint = { ...base, id: "b", km: 9, cutoff: null };
    expect(checkpointsStampPart([base, other])).toBe(checkpointsStampPart([other, base]));
  });
});

describe("§NNN who may read and who may write", () => {
  it("lets the Organizer and the Administrators write, and every role that opens the editor read", () => {
    const writers = STAFF_ROLES.filter((role) => canEditCheckpoints(role));
    expect(writers.sort()).toEqual(["ADMIN", "MODERATOR", "SUPERADMIN"]);
    for (const role of ["COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) expect(canReadCheckpoints(role)).toBe(true);
    expect(canReadCheckpoints("CONTRIBUTOR")).toBe(false);
    expect(canEditCheckpoints("DEV")).toBe(false);
    expect(canEditCheckpoints("COPYWRITER")).toBe(false);
  });
});
