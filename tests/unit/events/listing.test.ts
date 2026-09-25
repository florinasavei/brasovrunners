import { describe, expect, it } from "vitest";
import { calendarBoundaryKey, listingSections } from "@/modules/events/domain/listing";
import { listingFilterKey, matchesListingFilter, parseListingFilter } from "@/modules/events/domain/listing-filter";

/**
 * BR-REQ-041-01 criterion 12 — the listing's loading states (`DECISIONS.md` §166).
 *
 * The listing used to compute all of this inline, between three awaits on one page. It is
 * three streamed regions now, rendered by three components off one shared promise, so the
 * rules that decide *what goes where* had to become functions — and a function that decides
 * whether a skeleton appears is worth a test, because getting it wrong is a bug nobody sees
 * in a diff and everybody sees on a phone.
 *
 * What the filters are and what the panel offers is `listing-filter.test.ts` (§NNN).
 */

const event = (id: string, type: string, featured = false, hasPartner = false) => ({
  id,
  type,
  featured,
  surface: null,
  difficulty: null,
  distanceMeters: null,
  costType: null,
  coHosts: hasPartner ? [{ name: "Brașov Running Festival" }] : null,
  coHostName: null,
  coHostUrl: null,
});

type Row = ReturnType<typeof event>;
const matching = (params: Record<string, string | string[]>) => {
  const filter = parseListingFilter(params);
  return (row: Row) => matchesListingFilter(row, filter, () => false);
};

describe("listingSections divides the listing the way it always did", () => {
  it("takes the first row as the lead event, and only when it is the featured one", () => {
    // `listUpcomingEvents` orders featured first, which is why the first row is enough.
    const rows = [event("a", "RACE", true), event("b", "GROUP_RUN")];
    expect(listingSections(rows).featured?.id).toBe("a");
    expect(listingSections([event("a", "RACE"), event("b", "GROUP_RUN")]).featured).toBeUndefined();
  });

  it("never lists the lead event again below itself", () => {
    // The e2e suite asserts the same thing against the rendered page; this is the reason it
    // passes, and it is the assertion that survives a refactor of the page.
    const rows = [event("a", "RACE", true), event("b", "GROUP_RUN"), event("c", "HIKE")];
    expect(listingSections(rows).listed.map((row) => row.id)).toEqual(["b", "c"]);
  });

  it("copies rather than sorting the caller's array in place", () => {
    const rows = [event("a", "RACE"), event("b", "GROUP_RUN")];
    const { listed } = listingSections(rows);
    expect(listed).not.toBe(rows);
    expect(rows).toHaveLength(2);
  });

  it("has nothing to lead with and nothing to list when there is nothing", () => {
    expect(listingSections([])).toEqual({ featured: undefined, listed: [] });
  });

  // §167. Between seasons the page is handed the club's last event so the listing is not
  // blank, and that row still carries the featured flag it had while it was next. A race
  // that has already been run is not the club's answer to "what is next", so it must be an
  // ordinary card under the "no upcoming events" notice — and it must still be listed, which
  // is the half a naive guard gets wrong (the page returns nothing at all under a hero with
  // an empty list).
  it("never heroes a past event, and lists it instead", () => {
    const rows = [event("a", "RACE", true)];
    const { featured, listed } = listingSections(rows, undefined, false);
    expect(featured).toBeUndefined();
    expect(listed.map((row) => row.id)).toEqual(["a"]);
  });

  it("heroes the same row once the club has something upcoming again", () => {
    const rows = [event("a", "RACE", true)];
    expect(listingSections(rows, undefined, true).featured?.id).toBe("a");
  });
});

// §NNN, reversing what §133 and §401 said of the kind and partner chips: the lead follows the
// filters. The owner, 2026-09-25: "un buton de filtre … și mai multe filtre" — with five groups
// of boxes, an asphalt 5 km at the top of a page filtered to trail reads as a broken filter.
describe("listingSections: the lead event follows the filters", () => {
  const rows = [
    event("a", "RACE", true, true),
    event("b", "GROUP_RUN", false, true),
    event("c", "GROUP_RUN", false, false),
    event("d", "HIKE", false, true),
  ];

  it("keeps a lead event that matches, and lists only the others that match", () => {
    const { featured, listed } = listingSections(rows, matching({ type: ["RACE", "HIKE"] }));
    expect(featured?.id).toBe("a");
    expect(listed.map((row) => row.id)).toEqual(["d"]);
  });

  it("hides a lead event that does not match, and never demotes it to a card", () => {
    const { featured, listed } = listingSections(rows, matching({ type: "GROUP_RUN" }));
    expect(featured).toBeUndefined();
    expect(listed.map((row) => row.id)).toEqual(["b", "c"]);
  });

  it("AND-combines the partner with the kind, exactly as §401 did", () => {
    const { featured, listed } = listingSections(rows, matching({ type: "GROUP_RUN", partner: "1" }));
    expect(featured).toBeUndefined();
    expect(listed.map((row) => row.id)).toEqual(["b"]);
  });

  it("leaves everything alone with no filter", () => {
    const { featured, listed } = listingSections(rows, matching({}));
    expect(featured?.id).toBe("a");
    expect(listed.map((row) => row.id)).toEqual(["b", "c", "d"]);
  });
});

describe("calendarBoundaryKey asks for the skeleton exactly when the query changes", () => {
  const october = { kind: "month", month: { year: 2026, month: 10 } } as const;
  const november = { kind: "month", month: { year: 2026, month: 11 } } as const;
  const key = (params: Record<string, string | string[]>) => listingFilterKey(parseListingFilter(params));

  it("changes with the month, so the grid is replaced rather than left stale", () => {
    expect(calendarBoundaryKey(october, "grid")).not.toBe(calendarBoundaryKey(november, "grid"));
  });

  it("changes with the layout, because the grid and the agenda are different shapes", () => {
    expect(calendarBoundaryKey(october, "grid")).not.toBe(calendarBoundaryKey(october, "list"));
  });

  it("changes between a month and the year that contains it", () => {
    expect(calendarBoundaryKey({ kind: "year", year: 2026 }, "grid")).not.toBe(
      calendarBoundaryKey({ kind: "month", month: { year: 2026, month: 1 } }, "grid"),
    );
  });

  // §167. The calendar's rows are narrowed by the filters too, so the filters are an input of
  // the query the boundary suspends on. §166 said the opposite and was wrong about its own
  // page: pressing "Cursă" changed the grid's contents while the key stood still, and React kept
  // the previous kind's grid on screen for the whole round-trip. Since §NNN every box counts.
  it("changes with every filter, because the grid is narrowed by each of them", () => {
    expect(calendarBoundaryKey(october, "grid")).not.toBe(calendarBoundaryKey(october, "grid", key({ type: "RACE" })));
    expect(calendarBoundaryKey(october, "grid", key({ type: "HIKE" }))).not.toBe(calendarBoundaryKey(october, "grid", key({ type: "RACE" })));
    expect(calendarBoundaryKey(october, "grid", key({ type: "RACE" }))).not.toBe(
      calendarBoundaryKey(october, "grid", key({ type: "RACE", partner: "1" })),
    );
    expect(calendarBoundaryKey(october, "grid", key({ surface: "TRAIL" }))).not.toBe(
      calendarBoundaryKey(october, "grid", key({ surface: "TRAIL", night: "1" })),
    );
  });

  it("does not change when nothing the query depends on did", () => {
    expect(calendarBoundaryKey(october, "grid")).toBe(calendarBoundaryKey(october, "grid"));
    expect(calendarBoundaryKey(october, "grid", key({}))).toBe(calendarBoundaryKey(october, "grid"));
    // The same boxes ticked in another order are the same state.
    expect(calendarBoundaryKey(october, "grid", key({ type: ["RACE", "HIKE"] }))).toBe(
      calendarBoundaryKey(october, "grid", key({ type: ["HIKE", "RACE"] })),
    );
    // The layout has no meaning in the year view, so it must not split the key there either.
    expect(calendarBoundaryKey({ kind: "year", year: 2027 }, "list")).toBe(calendarBoundaryKey({ kind: "year", year: 2027 }, "grid"));
  });

  it("pads the month, so October and the year 2026 cannot collide", () => {
    expect(calendarBoundaryKey({ kind: "month", month: { year: 2026, month: 1 } }, "grid")).toContain("2026-01");
  });
});
