import { describe, expect, it } from "vitest";
import { editionDifference, groupSeries, recurrenceOf, seriesKey, usualOf } from "@/modules/events/domain/series";

/** BR-REQ-020-01 criterion 9, BR-REQ-050-02 criterion 11 (`DECISIONS.md` §113) — a repeated event is one line. */
const ZONE = "Europe/Bucharest";
const at = (wall: string) => new Date(`${wall}:00+03:00`);

const run = (title: string, wall: string, type = "GROUP_RUN") => ({ type, title, startsAt: at(wall) });

describe("a series is the same title and type again", () => {
  it("keys on the type and the trimmed, case-folded title", () => {
    expect(seriesKey({ type: "GROUP_RUN", title: " Running up that hill  " })).toBe(seriesKey({ type: "GROUP_RUN", title: "running up That hill" }));
    expect(seriesKey({ type: "GROUP_RUN", title: "Running up that hill" })).not.toBe(seriesKey({ type: "RACE", title: "Running up that hill" }));
    expect(seriesKey({ type: "GROUP_RUN", title: "Running up that hill" })).not.toBe(
      seriesKey({ type: "GROUP_RUN", title: "Running up that hill — Christmas edition" }),
    );
  });

  it("groups in order of first appearance, members soonest first", () => {
    const rows = [
      run("Crosul", "2026-10-11T09:00", "RACE"),
      run("Running up that hill", "2026-09-28T18:30"),
      run("Coffee", "2026-09-26T10:00", "COFFEE"),
      run("Running up that hill", "2026-09-21T18:30"),
      run("Running up that hill", "2026-09-23T18:30"),
    ];
    const series = groupSeries(rows);
    expect(series.map((s) => s.members[0].title)).toEqual(["Crosul", "Running up that hill", "Coffee"]);
    expect(series[1].members.map((m) => m.startsAt.toISOString())).toEqual([
      at("2026-09-21T18:30").toISOString(),
      at("2026-09-23T18:30").toISOString(),
      at("2026-09-28T18:30").toISOString(),
    ]);
  });
});

describe("how a series recurs", () => {
  it("reads 'every Monday and Wednesday at 18:30' off weekly dates, across the clock change", () => {
    const members = ["2026-10-19T18:30", "2026-10-21T18:30", "2026-10-26T18:30", "2026-10-28T18:30", "2026-11-02T18:30"].map((w) => ({
      // The last Sunday of October is the 25th: 18:30 stays 18:30 on the wall clock.
      startsAt: new Date(`${w}:00${w < "2026-10-25" ? "+03:00" : "+02:00"}`),
    }));
    expect(recurrenceOf(members, ZONE)).toEqual({ kind: "weekly", weekdays: [1, 3], time: "18:30" });
  });

  it("reads a fortnight, and drops the time when it differs", () => {
    const members = [at("2026-09-21T18:30"), at("2026-10-05T19:00"), at("2026-10-19T18:30")].map((startsAt) => ({ startsAt }));
    expect(recurrenceOf(members, ZONE)).toEqual({ kind: "fortnightly", weekdays: [1], time: null });
  });

  it("is a list of dates for a monthly run, a hand-made pair, or one occurrence", () => {
    expect(recurrenceOf([at("2026-09-21T18:30"), at("2026-10-21T18:30")].map((startsAt) => ({ startsAt })), ZONE)).toEqual({ kind: "dates" });
    expect(recurrenceOf([at("2026-09-21T18:30"), at("2026-09-23T18:30")].map((startsAt) => ({ startsAt })), ZONE)).toEqual({ kind: "dates" });
    expect(recurrenceOf([{ startsAt: at("2026-09-21T18:30") }], ZONE)).toEqual({ kind: "dates" });
  });
});

describe("a date that is not like the series' others", () => {
  /** Four Wednesdays at Parcul Tractorul, 18:30 — what "usual" is read off. */
  const member = (values: Partial<Parameters<typeof editionDifference>[0]> = {}) => ({
    startsAt: at("2026-09-23T18:30"),
    timezone: ZONE,
    locationName: "Parcul Tractorul",
    eventStatus: "SCHEDULED",
    isSpecial: false,
    ...values,
  });
  const usual = usualOf([member(), member({ startsAt: at("2026-09-30T18:30") }), member({ startsAt: at("2026-10-07T18:30") })]);

  it("has no mark when it is like the others", () => {
    expect(editionDifference(member(), usual)).toBeNull();
  });

  it("marks the special edition inside a series (§168, §169) — the owner's Brașov-Marathon Wednesday", () => {
    expect(editionDifference(member({ isSpecial: true }), usual)).toEqual({ kind: "special" });
  });

  it("ranks the marks: cancelled, then special, then the place, then the hour", () => {
    // Nothing to come to outranks everything, including a special edition that was called off.
    expect(editionDifference(member({ isSpecial: true, eventStatus: "CANCELLED" }), usual)).toEqual({ kind: "cancelled" });
    // A special edition explains its own place and hour, so it is what the date is told as.
    expect(editionDifference(member({ isSpecial: true, locationName: "Poiana Brașov" }), usual)).toEqual({ kind: "special" });
    expect(editionDifference(member({ isSpecial: true, startsAt: at("2026-09-23T09:00") }), usual)).toEqual({ kind: "special" });
    // An ordinary date elsewhere or at another hour says so, as it always did.
    expect(editionDifference(member({ locationName: "Poiana Brașov" }), usual)).toEqual({ kind: "moved", place: "Poiana Brașov" });
    expect(editionDifference(member({ startsAt: at("2026-09-23T09:00") }), usual)).toEqual({ kind: "retimed", time: "09:00" });
  });
});
