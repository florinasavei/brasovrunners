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

/**
 * BR-REQ-020-01 criterion 13, amended (§NNN) — the owner, at a Happy Monday date marked "Nu în
 * locul obișnuit: Parcul Sportiv Tractorul – intrarea dinspre Patinoarul Olimpic, Brasov": "the
 * location is actually the same". The dates had been made without ", Brasov" and without a map
 * link; one was saved later with both. Same entrance, two spellings — and a real move still marked.
 */
describe("§NNN the usual place is read, not compared byte for byte", () => {
  const TRACTORUL = "Parcul Sportiv Tractorul – intrarea dinspre Patinoarul Olimpic";
  const MAP = ["https:/", "maps.example.test", "vuCwrzFtgLTDE5H68"].join("/");
  const monday = (wall: string, values: { locationName?: string | null; mapUrl?: string | null } = {}) => ({
    startsAt: at(wall),
    timezone: ZONE,
    locationName: TRACTORUL,
    mapUrl: null as string | null,
    eventStatus: "SCHEDULED",
    isSpecial: false,
    ...values,
  });

  it("marks no date of the owner's September: one date as made, one saved with ', Brasov' and the map", () => {
    // The month view: two Mondays, one of each spelling — a tie the old byte compare lost.
    const members = [monday("2026-09-21T18:30"), monday("2026-09-28T18:30", { locationName: `${TRACTORUL}, Brasov`, mapUrl: MAP })];
    const usual = usualOf(members);
    for (const member of members) expect(editionDifference(member, usual)).toBeNull();
    // Either order: whichever spelling is the usual one, the other is at it.
    const reversed = [monday("2026-09-21T18:30", { locationName: `${TRACTORUL}, Brasov`, mapUrl: MAP }), monday("2026-09-28T18:30")];
    for (const member of reversed) expect(editionDifference(member, usualOf(reversed))).toBeNull();
  });

  it("marks no date when one spelling has diacritics or a longer address and the rest do not", () => {
    const members = [
      monday("2026-10-05T18:30"),
      monday("2026-10-12T18:30", { locationName: `${TRACTORUL}, Brașov` }),
      monday("2026-10-19T18:30", { locationName: `${TRACTORUL}, Strada Turnului 5, 500152 Brașov, România` }),
      // `at` is summer time (+03:00), so every date here stays before the clocks change on 25 October.
      monday("2026-09-28T18:30", { locationName: "Parcul Sportiv Tractorul - intrarea dinspre Patinoarul Olimpic" }),
    ];
    const usual = usualOf(members);
    for (const member of members) expect(editionDifference(member, usual)).toBeNull();
  });

  it("marks no date whose name differs but whose map link is the usual dates' link", () => {
    const members = [monday("2026-10-05T18:30", { mapUrl: MAP }), monday("2026-10-12T18:30", { mapUrl: MAP }), monday("2026-10-19T18:30", { locationName: "Tractorul", mapUrl: MAP })];
    const usual = usualOf(members);
    for (const member of members) expect(editionDifference(member, usual)).toBeNull();
  });

  it("reads the English page's names on the English page", () => {
    const EN = "Tractorul Sports Park – entrance from the Olympic Ice Rink";
    const members = [monday("2026-10-05T18:30", { locationName: EN }), monday("2026-10-12T18:30", { locationName: `${EN}, Brasov, Romania` })];
    const usual = usualOf(members);
    for (const member of members) expect(editionDifference(member, usual)).toBeNull();
  });

  it("still marks a date at another park or another entrance, with its own words", () => {
    const moved = monday("2026-10-26T18:30", { locationName: "Stația de telecabină Tâmpa" });
    const gate = monday("2026-11-02T18:30", { locationName: "Parcul Sportiv Tractorul – intrarea dinspre Strada Turnului" });
    const members = [monday("2026-10-05T18:30"), monday("2026-10-12T18:30", { locationName: `${TRACTORUL}, Brasov`, mapUrl: MAP }), monday("2026-10-19T18:30"), moved, gate];
    const usual = usualOf(members);
    expect(editionDifference(moved, usual)).toEqual({ kind: "moved", place: "Stația de telecabină Tâmpa" });
    expect(editionDifference(gate, usual)).toEqual({ kind: "moved", place: "Parcul Sportiv Tractorul – intrarea dinspre Strada Turnului" });
  });

  it("says nothing about the place when most dates have none, as before", () => {
    const members = [monday("2026-10-05T18:30", { locationName: null }), monday("2026-10-12T18:30", { locationName: null }), monday("2026-10-19T18:30")];
    const usual = usualOf(members);
    expect(usual.place).toBeNull();
    for (const member of members) expect(editionDifference(member, usual)).toBeNull();
  });
});
