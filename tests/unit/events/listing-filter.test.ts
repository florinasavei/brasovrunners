import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  distanceBand,
  doorNeedsAvailability,
  listingFilterQuery,
  matchesListingFilter,
  NO_FILTER,
  offeredFilters,
  offersAnything,
  parseListingFilter,
  registrationDoorOpen,
  withoutValue,
  type FilterableEvent,
  type FilterFacts,
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

/** `night` and `door` stand for the caller's two answers (§394, the page's registration door). */
type Row = FilterableEvent & { id: string; night?: boolean; door?: boolean };
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
  externalRegistrationUrl: null,
  externalProvider: null,
  ...fields,
});
const facts: FilterFacts<Row> = { night: (event) => event.night === true, door: (event) => event.door === true };
const ids = (rows: Row[], params: Record<string, string | string[]>) => {
  const filter = parseListingFilter(params);
  return rows.filter((event) => matchesListingFilter(event, filter, facts)).map((event) => event.id);
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

  it("reads the short forms a hand-written link may use: kilometre bands, lowercase and hyphenated names (§NNN)", () => {
    expect(parseListingFilter({ distance: "10-21" })).toEqual({ ...NO_FILTER, distance: ["FROM_10_TO_21"] });
    expect(parseListingFilter({ distance: "0-5,5-10" })).toEqual({ ...NO_FILTER, distance: ["UP_TO_5", "FROM_5_TO_10"] });
    // `?distance=21+` reaches the page as "21 " — a query string reads `+` as a space.
    expect(parseListingFilter({ distance: "21 " })).toEqual({ ...NO_FILTER, distance: ["OVER_21"] });
    expect(parseListingFilter({ distance: "21-" })).toEqual({ ...NO_FILTER, distance: ["OVER_21"] });
    expect(parseListingFilter({ distance: new URLSearchParams("distance=21+").getAll("distance") })).toEqual({ ...NO_FILTER, distance: ["OVER_21"] });
    // The enum names still read, so every address the form ever wrote means what it meant.
    expect(parseListingFilter({ distance: "FROM_10_TO_21" })).toEqual(parseListingFilter({ distance: "10-21" }));
    expect(parseListingFilter({ type: "race,group-run" })).toEqual(parseListingFilter({ type: "RACE,GROUP_RUN" }));
    expect(parseListingFilter({ type: " RACE , GROUP_RUN " })).toEqual({ ...NO_FILTER, type: ["GROUP_RUN", "RACE"] });
    expect(parseListingFilter({ surface: "trail", difficulty: "hard", cost: "free" })).toEqual({
      ...NO_FILTER,
      surface: ["TRAIL"],
      difficulty: ["HARD"],
      cost: ["FREE"],
    });
  });

  it("finds no alias on the prototype, and no band outside the four", () => {
    expect(parseListingFilter({ distance: ["constructor", "toString", "21-42", "5"] })).toEqual(NO_FILTER);
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

  it("asks the caller whether a date is a night event (§394) and whether the page has a door, never the clock itself", () => {
    const night = parseListingFilter({ night: "1" });
    expect(matchesListingFilter(rows[0], night, { night: () => true, door: () => false })).toBe(true);
    expect(matchesListingFilter(rows[0], night, { night: () => false, door: () => true })).toBe(false);
    const registration = parseListingFilter({ registration: "1" });
    expect(matchesListingFilter(rows[0], registration, { night: () => false, door: () => true })).toBe(true);
    expect(matchesListingFilter(rows[0], registration, { night: () => true, door: () => false })).toBe(false);
  });

  it("lets everything through with no filter", () => {
    expect(ids(rows, {})).toEqual(rows.map((event) => event.id));
  });
});

describe("«Înscrieri deschise» is the page's own registration door (§NNN), never the window alone", () => {
  const places = (available: number, waitlistRoom: number | null = null, waitlistCapacity: number | null = null) => ({
    available,
    waitlistRoom,
    waitlistCapacity,
  });

  it("is a door while there is a place, or no count at all (an uncapped event)", () => {
    expect(registrationDoorOpen(row("open"), places(3), NOW)).toBe(true);
    expect(registrationDoorOpen(row("uncapped"), null, NOW)).toBe(true);
  });

  it("is a door when the places are gone but the waiting list takes people", () => {
    expect(registrationDoorOpen(row("full"), places(0), NOW)).toBe(true);
    expect(registrationDoorOpen(row("full-room"), places(0, 2, 10), NOW)).toBe(true);
  });

  it("is no door when full with no waiting list, or with the waiting list full (§348) — the window is open, the page has no button", () => {
    expect(registrationDoorOpen(row("no-list"), places(0, null, 0), NOW)).toBe(false);
    expect(registrationDoorOpen(row("list-full"), places(0, 0, 5), NOW)).toBe(false);
  });

  it("is the organizer's form for an external event, as the page's button is", () => {
    expect(registrationDoorOpen(row("external", { registrationMode: "EXTERNAL", externalRegistrationUrl: "https://example.org/form" }), null, NOW)).toBe(true);
    // No address to send anyone to: the page draws nothing, so neither is it a door.
    expect(registrationDoorOpen(row("external-bare", { registrationMode: "EXTERNAL" }), null, NOW)).toBe(false);
  });

  it("is no door before the window opens, after it closes, for a cancelled event or one that takes no registration", () => {
    expect(registrationDoorOpen(row("not-yet-open", { registrationOpensAt: FUTURE }), null, NOW)).toBe(false);
    expect(registrationDoorOpen(row("closed", { registrationClosesAt: PAST, startsAt: PAST }), null, NOW)).toBe(false);
    expect(registrationDoorOpen(row("cancelled", { eventStatus: "CANCELLED" }), null, NOW)).toBe(false);
    expect(registrationDoorOpen(row("none", { registrationMode: "NONE" }), null, NOW)).toBe(false);
  });

  it("asks for the free places only for an internal event whose window is open — the one read a listing pays for", () => {
    expect(doorNeedsAvailability(row("open"), NOW)).toBe(true);
    expect(doorNeedsAvailability(row("external", { registrationMode: "EXTERNAL" }), NOW)).toBe(false);
    expect(doorNeedsAvailability(row("none", { registrationMode: "NONE" }), NOW)).toBe(false);
    expect(doorNeedsAvailability(row("not-yet-open", { registrationOpensAt: FUTURE }), NOW)).toBe(false);
    expect(doorNeedsAvailability(row("cancelled", { eventStatus: "CANCELLED" }), NOW)).toBe(false);
  });
});

describe("offeredFilters offers a box only where ticking it would change the page (§133's rule, generalised)", () => {
  const offered = (rows: Row[], filter = NO_FILTER) => offeredFilters(rows, filter, facts);

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
      row("c", { door: true }),
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
