import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  distanceBand,
  listingFilterKey,
  listingFilterQuery,
  matchesListingFilter,
  NO_FILTER,
  offeredFilters,
  offersAnything,
  parseListingFilter,
  withoutValue,
  type FilterableEvent,
} from "@/modules/events/domain/listing-filter";

/**
 * BR-REQ-041-01 — the listing's filters (`DECISIONS.md` §NNN, amending §133 and §401; the owner,
 * 2026-09-25: "un buton de filtre, collapsed by default, checkboxuri pe pill-uri și mai multe
 * filtre"). The state lives in the address, OR within a group and AND across groups; the panel
 * offers a box only where ticking it would change what the page shows, or the address ticks it.
 */

/** A fixed instant: after every row's own `publishedAt` and before every row's own `startsAt`. */
const NOW = new Date("2026-01-01T00:00:00Z");
const PAST = new Date("2025-01-01T00:00:00Z");
const FUTURE = new Date("2026-06-01T00:00:00Z");

type Row = FilterableEvent & { id: string; night?: boolean };
const row = (id: string, fields: Partial<Row> = {}): Row => ({
  id,
  type: "GROUP_RUN",
  surface: null,
  difficulty: null,
  distanceMeters: null,
  costType: null,
  coHosts: null,
  coHostName: null,
  coHostUrl: null,
  // The window a row carries when nothing about registration is under test: open, from before
  // `NOW` to well after it.
  registrationMode: "INTERNAL",
  eventStatus: "SCHEDULED",
  startsAt: FUTURE,
  registrationOpensAt: null,
  registrationClosesAt: null,
  publishedAt: PAST,
  ...fields,
});
const isNight = (event: Row) => event.night === true;
const ids = (rows: Row[], params: Record<string, string | string[]>) => {
  const filter = parseListingFilter(params);
  return rows.filter((event) => matchesListingFilter(event, filter, isNight, NOW)).map((event) => event.id);
};

describe("parseListingFilter reads the address", () => {
  it("reads the old single-value addresses exactly as before", () => {
    expect(parseListingFilter({ type: "RACE" })).toEqual({ ...NO_FILTER, type: ["RACE"] });
    expect(parseListingFilter({ partner: "1" })).toEqual({ ...NO_FILTER, partner: true });
    expect(parseListingFilter({ type: "RACE", partner: "1", view: "list", month: "2026-10" })).toEqual({
      ...NO_FILTER,
      type: ["RACE"],
      partner: true,
    });
  });

  it("reads a repeated parameter as several ticks of one group — the shape a GET form submits", () => {
    expect(parseListingFilter({ type: ["HIKE", "RACE"], surface: "TRAIL", night: "1" })).toEqual({
      ...NO_FILTER,
      type: ["RACE", "HIKE"],
      surface: ["TRAIL"],
      night: true,
    });
  });

  it("reads a comma-separated value the same way — a hand-written link, not only the GET form's own shape", () => {
    expect(parseListingFilter({ type: "RACE,GROUP_RUN" })).toEqual(parseListingFilter({ type: ["RACE", "GROUP_RUN"] }));
    // The closed set's own order (`EVENT_TYPES`), whichever order the address named them in.
    expect(parseListingFilter({ type: "RACE,GROUP_RUN", surface: "TRAIL,ASPHALT" })).toEqual({
      ...NO_FILTER,
      type: ["GROUP_RUN", "RACE"],
      surface: ["ASPHALT", "TRAIL"],
    });
  });

  it("ignores a value outside its closed set, and a tick given twice", () => {
    expect(
      parseListingFilter({ type: ["NOPE", "RACE", "RACE"], difficulty: "IMPOSSIBLE", distance: "UP_TO_5", cost: "FREE", partner: "yes" }),
    ).toEqual({
      ...NO_FILTER,
      type: ["RACE"],
      distance: ["UP_TO_5"],
      cost: ["FREE"],
    });
  });

  it("reads nothing as no filter", () => {
    expect(parseListingFilter({})).toEqual(NO_FILTER);
    expect(activeFilterCount(NO_FILTER)).toBe(0);
  });
});

describe("the filter goes back into the address in the form's own shape", () => {
  it("writes one parameter per tick, repeated within a group, in the closed set's order", () => {
    const filter = parseListingFilter({ type: ["HIKE", "RACE"], cost: "FREE", partner: "1" });
    expect(listingFilterQuery(filter)).toEqual({ type: ["RACE", "HIKE"], cost: "FREE", partner: "1" });
    expect(listingFilterQuery(NO_FILTER)).toEqual({});
  });

  it("round-trips: what it writes, it reads back as the same state", () => {
    const filter = parseListingFilter({
      type: ["HIKE", "RACE"],
      surface: "TRAIL",
      difficulty: "HARD",
      distance: "OVER_21",
      cost: "PAID",
      partner: "1",
      night: "1",
      registration: "1",
    });
    expect(parseListingFilter(listingFilterQuery(filter))).toEqual(filter);
    expect(activeFilterCount(filter)).toBe(9);
  });

  it("gives one key per state, whatever order the boxes were ticked in", () => {
    expect(listingFilterKey(parseListingFilter({ type: ["HIKE", "RACE"] }))).toBe(listingFilterKey(parseListingFilter({ type: ["RACE", "HIKE"] })));
    expect(listingFilterKey(NO_FILTER)).toBe("all");
    expect(listingFilterKey(parseListingFilter({ type: "RACE" }))).not.toBe(listingFilterKey(parseListingFilter({ type: "RACE", night: "1" })));
  });

  it("unticks one box for an active chip's link, and leaves the rest", () => {
    const filter = parseListingFilter({ type: ["RACE", "HIKE"], partner: "1" });
    expect(withoutValue(filter, "type", "RACE")).toEqual({ ...filter, type: ["HIKE"] });
    expect(withoutValue(filter, "partner")).toEqual({ ...filter, partner: false });
  });

  it("unticks the registration flag the same way as the other two", () => {
    const filter = parseListingFilter({ registration: "1" });
    expect(withoutValue(filter, "registration")).toEqual({ ...filter, registration: false });
  });
});

describe("matchesListingFilter: OR within a group, AND across groups", () => {
  const rows = [
    row("race-trail", { type: "RACE", surface: "TRAIL", difficulty: "HARD", distanceMeters: 21_097, costType: "PAID" }),
    row("race-road", { type: "RACE", surface: "ASPHALT", difficulty: "MODERATE", distanceMeters: 10_000, costType: "FREE" }),
    row("hike", { type: "HIKE", surface: "TRAIL", distanceMeters: 25_000, coHosts: [{ name: "Salvamont" }] }),
    row("run-night", { type: "GROUP_RUN", surface: "ASPHALT", difficulty: "EASY", distanceMeters: 8_000, costType: "FREE", night: true }),
  ];

  it("shows either kind when two kinds are ticked", () => {
    expect(ids(rows, { type: ["RACE", "HIKE"] })).toEqual(["race-trail", "race-road", "hike"]);
  });

  it("requires every group that has a tick", () => {
    expect(ids(rows, { type: "RACE", surface: "TRAIL" })).toEqual(["race-trail"]);
    expect(ids(rows, { surface: "TRAIL", partner: "1" })).toEqual(["hike"]);
    expect(ids(rows, { cost: "FREE", night: "1" })).toEqual(["run-night"]);
  });

  it("never matches a tick with a question the club left unanswered", () => {
    // The hike states no difficulty and no cost: ticking any difficulty or any cost leaves it out.
    expect(ids(rows, { difficulty: ["EASY", "MODERATE", "HARD"] })).not.toContain("hike");
    expect(ids(rows, { cost: ["FREE", "PAID", "DONATION"] })).not.toContain("hike");
  });

  it("reads the distance in four bands, a half marathon being a half marathon", () => {
    expect(ids(rows, { distance: "UP_TO_5" })).toEqual([]);
    expect(ids(rows, { distance: "FROM_5_TO_10" })).toEqual(["race-road", "run-night"]);
    expect(ids(rows, { distance: "FROM_10_TO_21" })).toEqual(["race-trail"]);
    expect(ids(rows, { distance: "OVER_21" })).toEqual(["hike"]);
    expect(
      [5_000, 5_001, 10_000, 10_001, 21_100, 21_101].map((meters) => distanceBand(meters)),
    ).toEqual(["UP_TO_5", "FROM_5_TO_10", "FROM_5_TO_10", "FROM_10_TO_21", "FROM_10_TO_21", "OVER_21"]);
    expect(distanceBand(null)).toBeNull();
    expect(distanceBand(0)).toBeNull();
  });

  it("asks the caller whether a date is a night event (§394), never the clock itself", () => {
    const filter = parseListingFilter({ night: "1" });
    expect(matchesListingFilter(rows[0], filter, () => true, NOW)).toBe(true);
    expect(matchesListingFilter(rows[0], filter, () => false, NOW)).toBe(false);
  });

  it("reads registration-open off the row's own window, the same rule RegistrationCta gives", () => {
    const open = row("open");
    const notYetOpen = row("not-yet-open", { registrationOpensAt: FUTURE });
    const closed = row("closed", { registrationClosesAt: PAST, startsAt: PAST });
    const cancelled = row("cancelled", { eventStatus: "CANCELLED" });
    const external = row("external", { registrationMode: "EXTERNAL" });
    const none = row("none", { registrationMode: "NONE" });
    const filter = parseListingFilter({ registration: "1" });
    expect(matchesListingFilter(open, filter, isNight, NOW)).toBe(true);
    expect(matchesListingFilter(notYetOpen, filter, isNight, NOW)).toBe(false);
    expect(matchesListingFilter(closed, filter, isNight, NOW)).toBe(false);
    expect(matchesListingFilter(cancelled, filter, isNight, NOW)).toBe(false);
    expect(matchesListingFilter(external, filter, isNight, NOW)).toBe(false);
    expect(matchesListingFilter(none, filter, isNight, NOW)).toBe(false);
  });

  it("lets everything through with no filter", () => {
    expect(ids(rows, {})).toEqual(rows.map((event) => event.id));
  });
});

describe("offeredFilters offers a box only where ticking it would change the page (§133's rule, generalised)", () => {
  const offered = (rows: Row[], filter = NO_FILTER) => offeredFilters(rows, filter, isNight, NOW);

  it("offers nothing when every event is the same kind — fewer than two kinds is nothing to choose between", () => {
    const rows = [row("a"), row("b")];
    expect(offered(rows)).toEqual({ groups: [], flags: [] });
    expect(offersAnything(offered(rows))).toBe(false);
  });

  it("offers each kind the club has when there are two or more, in the closed set's order", () => {
    const rows = [row("a", { type: "HIKE" }), row("b", { type: "RACE" }), row("c", { type: "HIKE" })];
    expect(offered(rows).groups).toEqual([{ group: "type", values: ["RACE", "HIKE"] }]);
  });

  it("offers a value some events carry and others leave unanswered, and never one every event carries", () => {
    const rows = [row("a", { surface: "TRAIL" }), row("b", { surface: "ASPHALT" }), row("c", { costType: "FREE" }), row("d", { costType: "FREE" })];
    const offer = offered(rows.map((event) => ({ ...event, costType: "FREE" })));
    // Every row free: "Gratuit" would narrow nothing.
    expect(offer.groups.find((entry) => entry.group === "cost")).toBeUndefined();
    expect(offer.groups.find((entry) => entry.group === "surface")).toEqual({ group: "surface", values: ["ASPHALT", "TRAIL"] });
  });

  it("does not offer a group where only one value would narrow — one box with nothing to choose between (§NNN, restoring §133's own rule)", () => {
    // Only ASPHALT ever narrows here: the other two rows leave `surface` unanswered, which
    // narrows nothing on its own (there is no "unanswered" box to tick).
    const rows = [row("a", { surface: "ASPHALT" }), row("b"), row("c")];
    expect(offered(rows).groups.find((entry) => entry.group === "surface")).toBeUndefined();
  });

  it("keeps a single ticked value even where nothing else in the group would narrow", () => {
    const rows = [row("a", { surface: "ASPHALT" }), row("b"), row("c")];
    const offer = offered(rows, parseListingFilter({ surface: "ASPHALT" }));
    expect(offer.groups.find((entry) => entry.group === "surface")).toEqual({ group: "surface", values: ["ASPHALT"] });
  });

  it("offers «Colaborare» while some events carry a partner, «Eveniment de noapte» while some dates are dark, and «Înscrieri deschise» while some are open", () => {
    const rows = [
      row("a", { coHosts: [{ name: "Salvamont" }] }),
      row("b", { night: true }),
      row("c", { registrationMode: "NONE" }),
    ];
    expect(offered(rows).flags).toEqual(["partner", "night", "registration"]);
    expect(offered([row("a"), row("b")]).flags).toEqual([]);
  });

  it("keeps a box the address ticks, even where it now matches nothing, so the page says what it is filtered by", () => {
    const offer = offered([row("a"), row("b")], parseListingFilter({ type: "COFFEE", partner: "1", distance: "OVER_21" }));
    expect(offer.groups).toEqual([
      { group: "type", values: ["COFFEE"] },
      { group: "distance", values: ["OVER_21"] },
    ]);
    expect(offer.flags).toEqual(["partner"]);
  });

  it("reads the whole list, never the filtered rows, so ticking one box never takes another away", () => {
    const rows = [row("a", { type: "RACE" }), row("b", { type: "HIKE" })];
    expect(offered(rows, parseListingFilter({ type: "RACE" }))).toEqual(offered(rows));
  });

  it("offers nothing at all when there is nothing", () => {
    expect(offered([])).toEqual({ groups: [], flags: [] });
  });
});
