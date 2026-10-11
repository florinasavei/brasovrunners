import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  listingFilterQuery,
  matchesListingFilter,
  NO_FILTER,
  offeredFilters,
  parseListingFilter,
  singleValues,
  SPECIAL_TYPE,
  withoutValue,
  type FilterableEvent,
  type FilterFacts,
} from "@/modules/events/domain/listing-filter";

/**
 * BR-REQ-041-01 — «Eveniment special» in the filter's «Tipul» (`DECISIONS.md` §NNN, amending §413
 * and §720; the owner, 2026-10-11: «Aici la tip trebuie să pot vedea și evenimentele speciale»).
 * A special event is every date that is not of a standing weekly series (§709's `eventKind`, read
 * off the series' cadence the public row already carries); the box is one more answer in the type
 * group, with the group's OR, and offered only where it narrows.
 */

type Row = FilterableEvent & { id: string };
const row = (id: string, type: string, seriesCadence: string | null): Row => ({
  id,
  type,
  surface: null,
  difficultyLevel: null,
  distanceMeters: null,
  costType: null,
  coHosts: null,
  coHostName: null,
  coHostUrl: null,
  seriesCadence,
});
const facts: FilterFacts<Row> = { night: () => false, door: () => false };

// The owner's listing: the weekly runs, a race, a run held once, a monthly coffee.
const WEDNESDAY = row("wednesday", "GROUP_RUN", "WEEKLY");
const SATURDAY = row("saturday", "GROUP_RUN", "WEEKLY");
const RACE = row("race", "RACE", null);
const ONE_OFF = row("one-off", "GROUP_RUN", null);
const COFFEE = row("coffee", "COFFEE", "MONTHLY");
const ROWS = [WEDNESDAY, SATURDAY, RACE, ONE_OFF, COFFEE];

const ids = (params: Record<string, string | string[]>, rows: Row[] = ROWS) => {
  const filter = parseListingFilter(params);
  return rows.filter((event) => matchesListingFilter(event, filter, facts)).map((event) => event.id);
};

describe("the address names «Eveniment special» as one more type", () => {
  it("reads `?type=SPECIAL` in any case, after the types, once", () => {
    expect(parseListingFilter({ type: "SPECIAL" }).type).toEqual([SPECIAL_TYPE]);
    expect(parseListingFilter({ type: "special" }).type).toEqual([SPECIAL_TYPE]);
    expect(parseListingFilter({ type: ["special", "RACE", "Special"] }).type).toEqual(["RACE", SPECIAL_TYPE]);
    expect(parseListingFilter({ type: "special,group-run" }).type).toEqual(["GROUP_RUN", SPECIAL_TYPE]);
  });

  it("writes it back in the form's own shape, counts it and unticks it like any box", () => {
    const filter = parseListingFilter({ type: ["GROUP_RUN", "SPECIAL"] });
    expect(listingFilterQuery(filter)).toEqual({ type: ["GROUP_RUN", "SPECIAL"] });
    expect(listingFilterQuery(filter, "past")).toEqual({ "past-type": ["GROUP_RUN", "SPECIAL"] });
    expect(activeFilterCount(filter)).toBe(2);
    expect(withoutValue(filter, "type", SPECIAL_TYPE).type).toEqual(["GROUP_RUN"]);
    expect(parseListingFilter({ "past-type": "special" }, "past").type).toEqual([SPECIAL_TYPE]);
    expect(parseListingFilter({ "past-type": "special" }).type).toEqual([]);
  });
});

describe("«Eveniment special» matches every date that is not of a weekly series", () => {
  it("alone: the race, the run held once and the monthly coffee — never a weekly date", () => {
    expect(ids({ type: "SPECIAL" })).toEqual(["race", "one-off", "coffee"]);
  });

  it("OR within «Tipul»: with «Alergare de grup», every group run and every special date", () => {
    expect(ids({ type: ["GROUP_RUN", "SPECIAL"] })).toEqual(["wednesday", "saturday", "race", "one-off", "coffee"]);
    expect(ids({ type: ["RACE", "SPECIAL"] })).toEqual(["race", "one-off", "coffee"]);
  });

  it("AND across groups, as every box", () => {
    const trailRace = { ...row("trail-race", "RACE", null), surface: "TRAIL" };
    const trailWeekly = { ...row("trail-weekly", "GROUP_RUN", "WEEKLY"), surface: "TRAIL" };
    expect(ids({ type: "SPECIAL", surface: "TRAIL" }, [...ROWS, trailRace, trailWeekly])).toEqual(["trail-race"]);
  });

  it("a series stopped, or one that repeats every two weeks, is special (§709)", () => {
    expect(ids({ type: "SPECIAL" }, [row("fortnightly", "GROUP_RUN", "FORTNIGHTLY"), row("stopped", "GROUP_RUN", null)])).toEqual([
      "fortnightly",
      "stopped",
    ]);
  });
});

describe("the panel offers «Eveniment special» only where it narrows", () => {
  const typeValues = (rows: Row[], filter = NO_FILTER) =>
    offeredFilters(rows, filter, facts).groups.find((entry) => entry.group === "type")?.values;

  it("the owner's listing: «Alergare de grup», «Concurs», «Cafea» and «Eveniment special», in that order", () => {
    expect(typeValues(ROWS)).toEqual(["GROUP_RUN", "RACE", "COFFEE", SPECIAL_TYPE]);
  });

  it("every date special, or every date weekly: not offered — it would narrow nothing", () => {
    expect(typeValues([RACE, ONE_OFF, COFFEE])).toEqual(["GROUP_RUN", "RACE", "COFFEE"]);
    expect(typeValues([WEDNESDAY, SATURDAY])).toBeUndefined();
  });

  it("a choice on its own: every date a group run, some weekly, some not — the group is «Eveniment special» alone", () => {
    expect(typeValues([WEDNESDAY, SATURDAY, ONE_OFF])).toEqual([SPECIAL_TYPE]);
  });

  it("ticked by the address, it stays even where it now narrows nothing", () => {
    expect(typeValues([RACE], parseListingFilter({ type: "SPECIAL" }))).toEqual([SPECIAL_TYPE]);
  });

  it("the past window's sentence names the shared type, never the kind", () => {
    expect(singleValues([RACE, row("race-2", "RACE", null)])).toEqual([{ group: "type", value: "RACE" }]);
  });
});
