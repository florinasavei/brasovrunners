import { describe, expect, it } from "vitest";
import { resultsClockInstants, resultsOnShow } from "@/modules/results/domain/results-open";

/**
 * §NNN, race results part 2 (BR-REQ-039-01) — the cheap half of the rule that puts a race's results on its page and its card: a race,
 * the Administrator's tick, the race has started, the public list's period (§421) is not over — and, passed in, the notice and the
 * terms in force describing them. The listing's chip and the page's section ask this one function.
 */
const STARTS = new Date("2026-11-21T07:00:00.000Z");
const ENDS = new Date("2026-11-21T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const deadlines = { publicListDays: 30 };
const gates = { noticeDescribes: true, termsDescribe: true };
const race = { type: "RACE", resultsPublished: true, startsAt: STARTS, endsAt: ENDS };
const AFTER = new Date(ENDS.getTime() + DAY);

describe("resultsOnShow", () => {
  it("is on for a published race that has started, inside the period, under a notice and terms that describe it", () => {
    expect(resultsOnShow(race, AFTER, deadlines, gates)).toBe(true);
    // From the gun: the read shows results the moment the race has started (publishing waits for it too).
    expect(resultsOnShow(race, STARTS, deadlines, gates)).toBe(true);
  });

  it("is off before the race starts", () => {
    expect(resultsOnShow(race, new Date(STARTS.getTime() - 1), deadlines, gates)).toBe(false);
  });

  it("is off after the public list's period, counted from the end — and on at the last instant", () => {
    const closes = new Date(ENDS.getTime() + 30 * DAY);
    expect(resultsOnShow(race, closes, deadlines, gates)).toBe(true);
    expect(resultsOnShow(race, new Date(closes.getTime() + 1), deadlines, gates)).toBe(false);
  });

  it("counts the period from the start for a race saved without an end", () => {
    const noEnd = { ...race, endsAt: null };
    expect(resultsOnShow(noEnd, new Date(STARTS.getTime() + 30 * DAY), deadlines, gates)).toBe(true);
    expect(resultsOnShow(noEnd, new Date(STARTS.getTime() + 30 * DAY + 1), deadlines, gates)).toBe(false);
  });

  it("is off until the Administrator publishes, whatever else holds", () => {
    expect(resultsOnShow({ ...race, resultsPublished: false }, AFTER, deadlines, gates)).toBe(false);
  });

  it("is off for every type that takes no results", () => {
    for (const type of ["GROUP_RUN", "HIKE", "COFFEE", "MEETUP", "GEAR_TEST", "EXTERNAL"]) expect(resultsOnShow({ ...race, type }, AFTER, deadlines, gates), type).toBe(false);
  });

  it("is off while the privacy notice or the terms in force do not describe the results", () => {
    expect(resultsOnShow(race, AFTER, deadlines, { ...gates, noticeDescribes: false })).toBe(false);
    expect(resultsOnShow(race, AFTER, deadlines, { ...gates, termsDescribe: false })).toBe(false);
  });

  it("is off for an event whose date is still to be announced: it has no start", () => {
    expect(resultsOnShow({ ...race, startsAt: null, endsAt: null }, AFTER, deadlines, gates)).toBe(false);
  });
});

describe("resultsClockInstants", () => {
  it("names the start and the end of the period — the two moments a static page must be made again", () => {
    expect(resultsClockInstants(race, deadlines).map((date) => date.toISOString())).toEqual([STARTS.toISOString(), new Date(ENDS.getTime() + 30 * DAY).toISOString()]);
  });

  it("names none for an undated event", () => {
    expect(resultsClockInstants({ startsAt: null, endsAt: null }, deadlines)).toEqual([]);
  });
});
