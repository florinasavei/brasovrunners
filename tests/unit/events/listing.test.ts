import { describe, expect, it } from "vitest";
import {
  calendarBoundaryKey,
  listingSections,
  partnerFilterOffered,
  presentEventTypes,
} from "@/modules/events/domain/listing";

/**
 * BR-REQ-041-01 criterion 12 — the listing's loading states (`DECISIONS.md` §166).
 *
 * The listing used to compute all of this inline, between three awaits on one page. It is
 * three streamed regions now, rendered by three components off one shared promise, so the
 * rules that decide *what goes where* had to become functions — and a function that decides
 * whether a skeleton appears is worth a test, because getting it wrong is a bug nobody sees
 * in a diff and everybody sees on a phone.
 */

const event = (id: string, type: string, featured = false, hasPartner = false) => ({
  id,
  type,
  featured,
  coHosts: hasPartner ? [{ name: "Brașov Running Festival" }] : null,
  coHostName: null,
  coHostUrl: null,
});

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

  it("narrows the list by kind and leaves the lead event alone", () => {
    // Deliberate: the hero is the club's answer to "what is next", and asking to see hikes is
    // not a reason to stop advertising Sunday's race.
    const rows = [event("a", "RACE", true), event("b", "GROUP_RUN"), event("c", "HIKE")];
    const { featured, listed } = listingSections(rows, "HIKE");
    expect(featured?.id).toBe("a");
    expect(listed.map((row) => row.id)).toEqual(["c"]);
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

  // §133, extended §NNN — the owner, 22:15, 2026-09-25: "I want to see that «colaboration»
  // event in the filters as well".
  it("narrows by partner, AND-combined with the kind, and never touches the hero", () => {
    const rows = [
      event("a", "RACE", true, true),
      event("b", "GROUP_RUN", false, true),
      event("c", "GROUP_RUN", false, false),
      event("d", "HIKE", false, true),
    ];
    const { featured, listed } = listingSections(rows, "GROUP_RUN", true, true);
    // The hero stays the hero whether or not it carries a partner (unchanged from the kind
    // filter's own rule above).
    expect(featured?.id).toBe("a");
    // AND-combined: only the GROUP_RUN row that also has a partner survives — "c" is dropped
    // by the partner filter, "d" by the kind filter.
    expect(listed.map((row) => row.id)).toEqual(["b"]);
  });

  it("leaves every kind alone when the partner filter is off", () => {
    const rows = [event("a", "RACE"), event("b", "GROUP_RUN", false, true)];
    expect(listingSections(rows, undefined, true, false).listed.map((row) => row.id)).toEqual(["a", "b"]);
  });
});

describe("partnerFilterOffered offers the chip only where it would narrow something", () => {
  it("is offered while a partnered event is among what the page shows", () => {
    expect(partnerFilterOffered([event("a", "RACE", false, true)], false)).toBe(true);
  });

  it("is not offered when nothing the page shows carries a partner", () => {
    expect(partnerFilterOffered([event("a", "RACE"), event("b", "HIKE")], false)).toBe(false);
  });

  it("stays offered while the filter is already in force, even matching nothing", () => {
    // Exactly `presentEventTypes`'s own rule for a kind the address names: the page can still
    // say what it is filtered by.
    expect(partnerFilterOffered([event("a", "RACE")], true)).toBe(true);
  });

  it("offers nothing at all when there is nothing", () => {
    expect(partnerFilterOffered([], false)).toBe(false);
  });
});

describe("presentEventTypes offers only kinds that would filter something", () => {
  it("names each kind the club has, in the closed set's order and once each", () => {
    const rows = [event("a", "HIKE"), event("b", "RACE"), event("c", "HIKE")];
    expect(presentEventTypes(rows)).toEqual(["RACE", "HIKE"]);
  });

  it("keeps the kind the address names even when nothing matches it", () => {
    // Otherwise the chip row could not show which filter is in force on a page saying the
    // filter found nothing.
    expect(presentEventTypes([event("a", "RACE")], "COFFEE")).toEqual(["RACE", "COFFEE"]);
  });

  it("offers nothing at all when there is nothing", () => {
    expect(presentEventTypes([])).toEqual([]);
  });
});

describe("calendarBoundaryKey asks for the skeleton exactly when the query changes", () => {
  const october = { kind: "month", month: { year: 2026, month: 10 } } as const;
  const november = { kind: "month", month: { year: 2026, month: 11 } } as const;

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

  // §167. The calendar's rows are narrowed by the kind filter too — `events/page.tsx` filters
  // what `listPublishedEventsBetween` returns before handing it down — so the filter is an
  // input of the query the boundary suspends on. §166 said the opposite and was wrong about
  // its own page: pressing "Cursă" changed the grid's contents while the key stood still, and
  // React kept the previous kind's grid on screen for the whole round-trip.
  it("changes with the kind filter, because the grid is narrowed by it as well", () => {
    expect(calendarBoundaryKey(october, "grid")).not.toBe(calendarBoundaryKey(october, "grid", "RACE"));
    expect(calendarBoundaryKey(october, "grid", "HIKE")).not.toBe(
      calendarBoundaryKey(october, "grid", "RACE"),
    );
  });

  it("does not change when nothing the query depends on did", () => {
    expect(calendarBoundaryKey(october, "grid")).toBe(calendarBoundaryKey(october, "grid"));
    expect(calendarBoundaryKey(october, "grid", "RACE")).toBe(calendarBoundaryKey(october, "grid", "RACE"));
    // The layout has no meaning in the year view, so it must not split the key there either.
    expect(calendarBoundaryKey({ kind: "year", year: 2027 }, "list")).toBe(
      calendarBoundaryKey({ kind: "year", year: 2027 }, "grid"),
    );
  });

  it("pads the month, so October and the year 2026 cannot collide", () => {
    expect(calendarBoundaryKey({ kind: "month", month: { year: 2026, month: 1 } }, "grid")).toContain("2026-01");
  });

  // §133, extended §NNN. The month view is narrowed by the partner filter the same way, so a
  // toggle of it (never left stale by §166/§167's own bug for the kind filter) needs a new key.
  it("changes with the partner filter, and stays put when it does not", () => {
    expect(calendarBoundaryKey(october, "grid")).not.toBe(calendarBoundaryKey(october, "grid", undefined, true));
    expect(calendarBoundaryKey(october, "grid", "RACE", true)).not.toBe(calendarBoundaryKey(october, "grid", "RACE", false));
    expect(calendarBoundaryKey(october, "grid", "RACE", true)).toBe(calendarBoundaryKey(october, "grid", "RACE", true));
  });
});
