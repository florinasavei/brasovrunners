import { describe, expect, it } from "vitest";
import { listingSections } from "@/modules/events/domain/listing";
import { matchesListingFilter, parseListingFilter } from "@/modules/events/domain/listing-filter";

/**
 * BR-REQ-041-01 criterion 12 — the listing's loading states (`DECISIONS.md` §166).
 *
 * The listing used to compute all of this inline, between three awaits on one page. It is
 * rendered by several components off the one read the page awaits (§413), so the rules that
 * decide *what goes where* had to become functions — worth a test, because getting them wrong is
 * a bug nobody sees in a diff and everybody sees on a phone.
 *
 * What the filters are and what the panel offers is `listing-filter.test.ts` (§413).
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
  // The registration window (§413): open throughout, since none of these tests are about it —
  // `listing-filter.test.ts` covers the "Înscrieri deschise" flag itself.
  registrationMode: "INTERNAL" as const,
  eventStatus: "SCHEDULED" as const,
  startsAt: new Date("2026-06-01T00:00:00Z"),
  registrationOpensAt: null,
  registrationClosesAt: null,
  publishedAt: new Date("2025-01-01T00:00:00Z"),
  externalRegistrationUrl: null,
  externalProvider: null,
});

type Row = ReturnType<typeof event>;
const matching = (params: Record<string, string | string[]>) => {
  const filter = parseListingFilter(params);
  return (row: Row) => matchesListingFilter(row, filter, { night: () => false, door: () => true });
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

// §413, reversing what §133 and §401 said of the kind and partner chips: the lead follows the
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
