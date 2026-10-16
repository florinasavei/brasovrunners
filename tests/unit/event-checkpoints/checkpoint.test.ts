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
  isBlankPosted,
  type PostedCheckpoint,
  prepareCheckpoints,
  readClockTime,
  readKm,
  readTimeLimit,
  sortedByKm,
} from "@/modules/event-checkpoints/domain/checkpoint";
import { savedDurationMinutes } from "@/modules/content/events/duration";
import { checkpointClock, checkpointFinish, checkpointStart, cutoffClockOf, minutesFromClock, withCutoffClocks } from "@/modules/event-checkpoints/domain/start";
import { STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * §757, §770, BR-REQ-011-01 — the checkpoints' rules, with no database: a kilometre read as typed and
 * held to the route's length, the time limits (hours and minutes from the start) held to the event's
 * own and to each other, a note in both languages or neither, the order a runner meets the points, the
 * page's rows with the finish last, and the one converter between a clock and a time limit.
 */

/** A route of 21.1 km, a race whose start is known, a three-hour limit. */
const CONTEXT: CheckpointContext = { routeKm: 21.1, startKnown: true, limitMinutes: 180 };

/** A time limit in minutes as the race's two boxes carry it: hours and minutes. */
const limit = (minutes: number) => ({ cutoffHours: String(Math.floor(minutes / 60)), cutoffMinutesPart: String(minutes % 60) });

const row = (index: number, over: Partial<PostedCheckpoint> = {}): PostedCheckpoint => ({
  index,
  id: "",
  nameRo: `Punct ${index}`,
  nameEn: `Point ${index}`,
  km: String(index + 1),
  kinds: [],
  cutoffHours: "",
  cutoffMinutesPart: "",
  noteRo: "",
  noteEn: "",
  onProfile: true,
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

describe("§757 a kilometre, a time of the day and a time limit, as typed", () => {
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
  ])("reads the clock %s as %s (an old file's or an old row's time of day)", (typed, time) => expect(readClockTime(typed)).toBe(time));

  it.each(["", "24:00", "11:60", "1130", "11.30", "noon"])("refuses %j as a time of day", (typed) => expect(readClockTime(typed)).toBeNull());

  it.each([
    ["1", "30", 90],
    ["", "45", 45],
    ["2", "", 120],
    ["0", "30", 30],
    ["", "", null],
    [" ", " ", null],
    // The hours cleared on a whole-hour limit leaves its «0» minutes behind: the limit is removed, not refused as a zero.
    ["", "0", null],
    ["", "00", null],
    ["168", "0", 10080],
  ])("reads the limit %j h %j min as %s, the race's own two boxes' way", (hours, minutes, expected) => expect(readTimeLimit(hours, minutes)).toBe(expected));

  it.each([
    ["0", "0", "hours"],
    ["1", "60", "minutes"],
    ["1", "x", "minutes"],
    ["x", "30", "hours"],
    ["169", "", "hours"],
    ["-1", "30", "hours"],
    ["1.5", "", "hours"],
  ])("refuses the limit %j h %j min, naming the %s box", (hours, minutes, box) => expect(readTimeLimit(hours, minutes)).toBe(box));
});

describe("§770 the one converter between a clock and a time limit", () => {
  it("reads a time of day as the minutes after the start: before the start it is nothing, the next day's only for an event that runs past midnight", () => {
    expect(minutesFromClock("11:30", 540)).toBe(150);
    // At the start: zero minutes, a limit nobody could meet.
    expect(minutesFromClock("09:00", 540)).toBeNull();
    // An ordinary race: 08:59 is a minute before the start, never the next day's.
    expect(minutesFromClock("08:59", 540)).toBeNull();
    expect(minutesFromClock("08:59", 540, 180)).toBeNull();
    // A night race from 22:00 ending at 06:00 (480 minutes): 02:00 is four hours later.
    expect(minutesFromClock("02:00", 22 * 60, 480)).toBe(240);
    expect(minutesFromClock("23:30", 22 * 60, 480)).toBe(90);
    // With no end given the race ends the day it starts.
    expect(minutesFromClock("02:00", 22 * 60)).toBeNull();
  });

  it("says the clock a limit closes at: the start plus the minutes, on the event's own clock", () => {
    const start = new Date("2026-11-21T07:00:00Z"); // 09:00 in Bucharest
    expect(cutoffClockOf(start, 150, "Europe/Bucharest")).toBe("11:30");
    expect(cutoffClockOf(start, 1, "Europe/Bucharest")).toBe("09:01");
    // Past midnight the clock wraps: 22:00 + 4 h = 02:00.
    expect(cutoffClockOf(new Date("2026-11-21T20:00:00Z"), 240, "Europe/Bucharest")).toBe("02:00");
  });

  it("counts elapsed minutes across the night the clocks go back", () => {
    // 24 October 2026, 22:00 summer time (19:00Z): five elapsed hours later it is 03:00 winter time.
    expect(cutoffClockOf(new Date("2026-10-24T19:00:00Z"), 300, "Europe/Bucharest")).toBe("03:00");
    expect(cutoffClockOf(new Date("2026-10-24T19:00:00Z"), 60, "Europe/Bucharest")).toBe("23:00");
  });

  it("is each other's inverse for any limit the card accepts", () => {
    const start = new Date("2026-11-21T07:00:00Z");
    for (const minutes of [1, 59, 60, 90, 150, 600]) {
      const clock = cutoffClockOf(start, minutes, "Europe/Bucharest");
      expect(minutesFromClock(clock, 9 * 60, 1000)).toBe(minutes);
    }
  });

  it("gives a reader the clocks of the event it draws, and none while the start has no date or hour", () => {
    const event = { startsAt: new Date("2026-11-21T07:00:00Z"), raceStartsAt: null, timezone: "Europe/Bucharest" };
    expect(checkpointClock(event)(150)).toBe("11:30");
    expect(checkpointClock(event)(null)).toBeNull();
    // The gun, not the meeting time, is what a limit counts from.
    expect(checkpointClock({ ...event, raceStartsAt: new Date("2026-11-21T08:00:00Z") })(90)).toBe("11:30");
    // No hour typed: the provisional start (§545) says nothing a clock could be counted from.
    expect(checkpointClock({ ...event, startsAt: new Date("2026-11-21T10:00:01Z") })(150)).toBeNull();
    const withClocks = withCutoffClocks([{ cutoffMinutes: 30 }, { cutoffMinutes: null }], event);
    expect(withClocks.map((r) => r.cutoffClock)).toEqual(["09:30", null]);
    expect(withCutoffClocks([{ cutoffMinutes: 30 }], null)[0].cutoffClock).toBeNull();
  });
});

describe("§757 the rules a checkpoint is held to", () => {
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
    expect(CHECKPOINT_KINDS).toEqual(["WATER", "FOOD", "FIRST_AID", "TIMING", "DIRECTION"]);
  });

  it("takes «Direcționare» as the fifth kind, with the others in the closed set's own order (§770)", () => {
    const rows = prepareCheckpoints([row(0, { kinds: ["DIRECTION", "WATER"] }), row(1, { km: "9", kinds: ["DIRECTION"] })], CONTEXT);
    expect(rows[0].kinds).toEqual(["WATER", "DIRECTION"]);
    expect(rows[1].kinds).toEqual(["DIRECTION"]);
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
    // Each language writes the kilometre its own way: a comma in Romanian, a point in English.
    expect(beyond.values).toMatchObject({ name: "Dincolo", km: "21,2", max: "21,1" });
    expect(beyond.valuesIn("en")).toMatchObject({ name: "Point 2", km: "21.2", max: "21.1" });
    // The route's own length is allowed, and a metres figure is rounded up to the hundredth.
    expect(prepareCheckpoints([row(0, { km: "21,1" })], CONTEXT)).toHaveLength(1);
    expect(prepareCheckpoints([row(0, { km: "21,10" })], { ...CONTEXT, routeKm: 21.097 })).toHaveLength(1);
    // No length known: nothing to hold the kilometre to.
    expect(prepareCheckpoints([row(0, { km: "400" })], { ...CONTEXT, routeKm: null })).toHaveLength(1);
  });

  it("refuses a kind outside the closed set", () => {
    expect(refusal([row(0, { kinds: ["WATER", "PIZZA"] })]).reason).toBe("CHECKPOINT_KIND_UNKNOWN");
  });

  it("reads a time limit typed as hours and minutes, and keeps it as minutes (§770)", () => {
    const rows = prepareCheckpoints([row(0, { cutoffHours: "1", cutoffMinutesPart: "30" }), row(1, { km: "9", ...limit(150) })], CONTEXT);
    expect(rows.map((r) => r.cutoffMinutes)).toEqual([90, 150]);
    expect(prepareCheckpoints([row(0)], CONTEXT)[0].cutoffMinutes).toBeNull();
  });

  it("refuses a limit that is not a duration, naming the hours box or the minutes box", () => {
    // The hours box cleared on a whole-hour limit leaves «0» in the minutes box: that is no limit, not a «0».
    expect(prepareCheckpoints([row(0, { cutoffHours: "", cutoffMinutesPart: "0" })], CONTEXT)[0].cutoffMinutes).toBeNull();
    expect(readTimeLimit("", "0")).toBeNull();
    const zero = refusal([row(0, { cutoffHours: "0", cutoffMinutesPart: "0" })]);
    expect(zero.reason).toBe("CHECKPOINT_CUTOFF_INVALID");
    expect(zero.fields).toEqual(["cp[0].cutoffHours"]);
    const sixty = refusal([row(0, { cutoffHours: "1", cutoffMinutesPart: "60" })]);
    expect(sixty.reason).toBe("CHECKPOINT_CUTOFF_INVALID");
    expect(sixty.fields).toEqual(["cp[0].cutoffMinutesPart"]);
    expect(refusal([row(0, { cutoffHours: "noon" })]).reason).toBe("CHECKPOINT_CUTOFF_INVALID");
  });

  it("refuses a limit with no start to count it from, unless the row keeps the limit it already had", () => {
    const noStart: CheckpointContext = { routeKm: 21.1, startKnown: false, limitMinutes: null };
    const refused = refusal([row(0, { ...limit(45) })], noStart);
    expect(refused.reason).toBe("CHECKPOINT_CUTOFF_NO_START");
    expect(refused.fields).toEqual(["cp[0].cutoffHours"]);
    // No limit asked: nothing to count.
    expect(prepareCheckpoints([row(0)], noStart)).toHaveLength(1);
    // A saved point whose limit is posted unchanged keeps it while the hour is to be announced; a changed one is refused.
    const saved = new Map<string, number | null>([["11111111-1111-4111-8111-111111111111", 45]]);
    const unchanged = row(0, { id: "11111111-1111-4111-8111-111111111111", ...limit(45) });
    expect(prepareCheckpoints([unchanged], { ...noStart, savedMinutes: saved })).toHaveLength(1);
    expect(refusal([{ ...unchanged, ...limit(50) }], { ...noStart, savedMinutes: saved }).reason).toBe("CHECKPOINT_CUTOFF_NO_START");
  });

  it("refuses a limit longer than the one of a point further along, naming the earlier point's box and both durations", () => {
    const wrong = refusal([row(0, { km: "5", ...limit(90), nameRo: "Prima" }), row(1, { km: "10", ...limit(75), nameRo: "A doua" })]);
    expect(wrong.reason).toBe("CHECKPOINT_CUTOFF_AFTER_LATER");
    expect(wrong.fields).toEqual(["cp[0].cutoffHours"]);
    expect(wrong.values).toMatchObject({ name: "Prima", cutoff: "1 h 30 min", later: "A doua", laterCutoff: "1 h 15 min" });
    // The order is the kilometre's, never the order the rows were typed in.
    const fine = prepareCheckpoints([row(0, { km: "10", ...limit(120) }), row(1, { km: "5", ...limit(75) })], CONTEXT);
    expect(fine.map((r) => r.cutoffMinutes)).toEqual([75, 120]);
    // The same limit at two points is allowed; a point with none does not take part.
    expect(prepareCheckpoints([row(0, { km: "5", ...limit(60) }), row(1, { km: "6" }), row(2, { km: "10", ...limit(60) })], CONTEXT)).toHaveLength(3);
  });

  it("refuses a limit longer than the event's own, minutes against minutes", () => {
    const late = refusal([row(0, { cutoffHours: "3", cutoffMinutesPart: "30" })]);
    expect(late.reason).toBe("CHECKPOINT_CUTOFF_AFTER_END");
    expect(late.fields).toEqual(["cp[0].cutoffHours"]);
    // The sentence says the event's limit, to choose up to.
    expect(late.values).toMatchObject({ cutoff: "3 h 30 min", limit: "3 h" });
    expect(prepareCheckpoints([row(0, { cutoffHours: "3" })], CONTEXT)).toHaveLength(1);
    // The event's limit is as long as the race says, with no clock arithmetic: a night race of eight hours takes seven.
    expect(prepareCheckpoints([row(0, { cutoffHours: "7" })], { routeKm: 42, startKnown: true, limitMinutes: 8 * 60 })).toHaveLength(1);
    // No end given: no limit to be longer than.
    expect(prepareCheckpoints([row(0, { cutoffHours: "20" })], { ...CONTEXT, limitMinutes: null })).toHaveLength(1);
  });

  it("names a point in the page's language, and a row with no name by its kilometre, never by a number the card does not show", () => {
    const named = refusal([row(0, { nameRo: "Cabana", nameEn: "The hut", ...limit(999) })]);
    expect(named.valuesIn("ro").name).toBe("Cabana");
    expect(named.valuesIn("en").name).toBe("The hut");
    const unnamed = refusal([row(4, { nameRo: "", nameEn: "", km: "12,5" })]);
    expect(unnamed.reason).toBe("CHECKPOINT_NAME_MISSING");
    expect(unnamed.valuesIn("ro").name).toBe("km 12,5");
    expect(unnamed.valuesIn("en").name).toBe("km 12.5");
    expect(JSON.stringify(unnamed.words)).not.toContain("#");
    // One language typed: both sentences name it by that one.
    expect(refusal([row(0, { nameRo: "", nameEn: "Hut" })]).valuesIn("ro").name).toBe("Hut");
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

describe("§757 what the event says the points are measured against", () => {
  const at = (hours: number, minutes = 0) => new Date(Date.UTC(2026, 10, 21, hours, minutes));

  it("takes the typed distance first, the track's second, and nothing when there is none", () => {
    const base = { start: at(9), limitMinutes: null };
    expect(checkpointContext({ ...base, distanceMeters: 21097, gpxMeters: 25000 }).routeKm).toBeCloseTo(21.097);
    expect(checkpointContext({ ...base, distanceMeters: null, gpxMeters: 25000 }).routeKm).toBe(25);
    expect(checkpointContext({ ...base, distanceMeters: null, gpxMeters: null }).routeKm).toBeNull();
    expect(checkpointContext({ ...base, distanceMeters: 0, gpxMeters: null }).routeKm).toBeNull();
  });

  it("measures the limit in elapsed minutes, so the night the clocks change moves nothing (§770)", () => {
    // 24 October 2026, 22:00 summer time (19:00Z), six real hours: the finish closes at 03:00 winter time, six hours of limit.
    const start = new Date("2026-10-24T19:00:00Z");
    const context = checkpointContext({
      distanceMeters: 50_000,
      gpxMeters: null,
      start,
      limitMinutes: savedDurationMinutes(start, new Date("2026-10-25T01:00:00Z")),
    });
    expect(context).toMatchObject({ startKnown: true, limitMinutes: 360 });
    // Six elapsed hours is the most a point may have, whatever the wall clock says on the way.
    expect(refusal([row(0, { km: "40", cutoffHours: "6", cutoffMinutesPart: "1" })], context).reason).toBe("CHECKPOINT_CUTOFF_AFTER_END");
    expect(prepareCheckpoints([row(0, { km: "40", cutoffHours: "6" })], context)).toHaveLength(1);
  });

  it("reads whether the start is known and the span to the event's end", () => {
    const context = checkpointContext({ distanceMeters: 10_000, gpxMeters: null, start: at(9, 30), limitMinutes: 180 });
    expect(context).toEqual({ routeKm: 10, startKnown: true, limitMinutes: 180, savedMinutes: undefined });
    // The event's «Timp limită» is a duration: it is true while the hour is unsaid, and a point's limit is held to it then too.
    const unsaid = checkpointContext({ distanceMeters: null, gpxMeters: null, start: null, limitMinutes: 60 });
    expect(unsaid).toMatchObject({ startKnown: false, limitMinutes: 60 });
    expect(refusal([row(0, limit(150))], { ...unsaid, startKnown: true }).reason).toBe("CHECKPOINT_CUTOFF_AFTER_END");
    // A limit that is not positive is no limit.
    expect(checkpointContext({ distanceMeters: null, gpxMeters: null, start: at(9), limitMinutes: 0 }).limitMinutes).toBeNull();
    expect(checkpointContext({ distanceMeters: null, gpxMeters: null, start: at(9), limitMinutes: null }).limitMinutes).toBeNull();
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

  it("gives the finish row its limit on the event's own clock and in minutes, and the route's length when typed", () => {
    const event = {
      type: "RACE",
      startsAt: new Date("2026-11-21T07:00:00Z"), // 09:00 in Bucharest
      raceStartsAt: null,
      endsAt: new Date("2026-11-21T10:00:00Z"), // 12:00
      timezone: "Europe/Bucharest",
      distanceMeters: 21097,
    };
    expect(checkpointFinish(event)).toEqual({ km: 21.1, limit: "12:00", minutes: 180 });
    expect(checkpointFinish({ ...event, endsAt: null, distanceMeters: null })).toEqual({ km: null, limit: null, minutes: null });
    expect(checkpointFinish({ ...event, endsAt: new Date("2026-11-21T06:00:00Z") }).limit).toBeNull();
    // Counted from the gun when the race has one, as the race's own «Timp limită» is.
    expect(checkpointFinish({ ...event, raceStartsAt: new Date("2026-11-21T08:00:00Z") })).toMatchObject({ limit: "12:00", minutes: 120 });
    // Only a race closes its finish: a group run's end is when it ends, no limit — no finish row.
    expect(checkpointFinish({ ...event, type: "GROUP_RUN" })).toEqual({ km: 21.1, limit: null, minutes: null });
    expect(checkpointFinish({ ...event, type: "HIKE" }).limit).toBeNull();
  });
});

describe("§757 the table the event page draws", () => {
  const point = (id: string, km: number, cutoffMinutes: number | null = null, cutoffClock: string | null = null): Checkpoint => ({
    id,
    nameRo: id,
    nameEn: id,
    km,
    kinds: ["WATER"],
    cutoffMinutes,
    cutoffClock,
    noteRo: null,
    noteEn: null,
    onProfile: true,
  });

  it("is nothing without checkpoints, even with a time limit: the finish alone is no section", () => {
    expect(checkpointRows([], { km: 21.1, limit: "12:00", minutes: 180 })).toEqual([]);
  });

  it("lists the points by distance and puts the finish last when the event has a time limit", () => {
    const rows = checkpointRows([point("b", 12, 90, "10:30"), point("a", 5, 45, "09:45")], { km: 21.1, limit: "12:00", minutes: 180 });
    expect(rows.map((r) => (r.kind === "point" ? r.id : "finish"))).toEqual(["a", "b", "finish"]);
    expect(rows[2]).toEqual({ kind: "finish", km: 21.1, cutoffMinutes: 180, cutoffClock: "12:00" });
    expect(rows[0]).toMatchObject({ cutoffMinutes: 45, cutoffClock: "09:45" });
  });

  it("has no finish row without a time limit", () => {
    expect(checkpointRows([point("a", 5)], { km: 21.1, limit: null, minutes: null })).toHaveLength(1);
  });

  it("orders ties by how they were typed", () => {
    expect(sortedByKm([{ km: 2, n: "x" }, { km: 1, n: "y" }, { km: 2, n: "z" }]).map((r) => r.n)).toEqual(["y", "x", "z"]);
  });
});

describe("§757 the picture stamp covers the checkpoints", () => {
  const base: Checkpoint = { id: "a", nameRo: "Apă", nameEn: "Water", km: 5, kinds: ["WATER"], cutoffMinutes: 60, cutoffClock: "10:00", noteRo: null, noteEn: null, onProfile: true };

  it("changes with a kilometre, a kind, a limit or the clock it closes at, and not with a name or an id", () => {
    const stamp = checkpointsStampPart([base]);
    expect(stamp).toBe("5.00:WATER:60@10:00");
    expect(checkpointsStampPart([{ ...base, km: 5.5 }])).not.toBe(stamp);
    expect(checkpointsStampPart([{ ...base, kinds: ["WATER", "FOOD"] }])).not.toBe(stamp);
    expect(checkpointsStampPart([{ ...base, kinds: ["WATER", "DIRECTION"] }])).not.toBe(stamp);
    expect(checkpointsStampPart([{ ...base, cutoffMinutes: 65, cutoffClock: "10:05" }])).not.toBe(stamp);
    // A moved start moves the clock though the limit is the same: a new picture address.
    expect(checkpointsStampPart([{ ...base, cutoffClock: "10:30" }])).not.toBe(stamp);
    expect(checkpointsStampPart([{ ...base, cutoffMinutes: null, cutoffClock: null }])).not.toBe(stamp);
    expect(checkpointsStampPart([{ ...base, nameRo: "Alt nume", id: "b" } as Checkpoint])).toBe(stamp);
    expect(checkpointsStampPart([])).toBe("");
  });

  it("is the same whatever order the rows come in", () => {
    const other: Checkpoint = { ...base, id: "b", km: 9, cutoffMinutes: null, cutoffClock: null };
    expect(checkpointsStampPart([base, other])).toBe(checkpointsStampPart([other, base]));
  });
});

describe("§757 who may read and who may write", () => {
  it("lets the Organizer and the Administrators write, and every role that opens the editor read", () => {
    const writers = STAFF_ROLES.filter((role) => canEditCheckpoints(role));
    expect(writers.sort()).toEqual(["ADMIN", "MODERATOR", "SUPERADMIN"]);
    for (const role of ["COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) expect(canReadCheckpoints(role)).toBe(true);
    expect(canReadCheckpoints("CONTRIBUTOR")).toBe(false);
    expect(canEditCheckpoints("DEV")).toBe(false);
    expect(canEditCheckpoints("COPYWRITER")).toBe(false);
  });
});
