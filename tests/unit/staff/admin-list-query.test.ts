import { describe, expect, it } from "vitest";
import {
  ariaSortFor,
  buildListHref,
  DEFAULT_PER_PAGE,
  type ListQuery,
  pageCount,
  parseListQuery,
  sortHref,
} from "@/modules/staff-identity/domain/admin-list-query";

/**
 * The URL contract behind every backoffice list (BR-REQ-041-01 criterion 7, BR-REQ-060-01).
 *
 * The interesting cases are all hostile or malformed, because `?sort=` and `?page=` arrive from
 * a URL anybody can type: an unknown sort key must never reach an `ORDER BY`, and a nonsense
 * page must produce a list rather than a crash.
 */
const SORTABLE = ["name", "status", "submitted"] as const;
const OPTIONS = { sortable: SORTABLE, defaultSort: "submitted", defaultDir: "desc" } as const;

describe("parseListQuery", () => {
  it("falls back to the caller's defaults when the query string is empty", () => {
    const query = parseListQuery({}, OPTIONS);

    expect(query).toMatchObject({
      page: 1,
      perPage: DEFAULT_PER_PAGE,
      sort: "submitted",
      dir: "desc",
      offset: 0,
    });
  });

  it("refuses a sort key that is not on the caller's allowlist", () => {
    // The whole point: this string is one step from an ORDER BY, so an unknown one is replaced
    // rather than passed along or rejected with an error page.
    const query = parseListQuery({ sort: "registrations.id; drop table" }, OPTIONS);

    expect(query.sort).toBe("submitted");
  });

  it("accepts a sort key that is on it", () => {
    expect(parseListQuery({ sort: "name", dir: "asc" }, OPTIONS)).toMatchObject({
      sort: "name",
      dir: "asc",
    });
  });

  it("treats a direction that is neither asc nor desc as the default", () => {
    expect(parseListQuery({ sort: "name", dir: "sideways" }, OPTIONS).dir).toBe("desc");
  });

  it.each([
    ["zero", "0"],
    ["negative", "-3"],
    ["fractional", "1.5"],
    ["not a number", "abc"],
    ["a number with a tail", "12abc"],
    ["empty", ""],
  ])("falls back to page 1 when the page is %s", (_label, page) => {
    expect(parseListQuery({ page }, OPTIONS).page).toBe(1);
  });

  it("computes the offset from the page and the page size", () => {
    expect(parseListQuery({ page: "3", perPage: "50" }, OPTIONS)).toMatchObject({
      page: 3,
      perPage: 50,
      offset: 100,
      limit: 50,
    });
  });

  it("caps the page size, because the URL must not be able to ask for the whole season", () => {
    // Server-side pagination exists so thousands of participant rows never arrive at once.
    // A page size taken from the query string would hand that straight back.
    expect(parseListQuery({ perPage: "100000" }, OPTIONS).perPage).toBe(100);
  });
});

describe("pageCount", () => {
  it("gives an empty list one page, so page 1 always exists", () => {
    expect(pageCount(0, 25)).toBe(1);
  });

  it("rounds a partial last page up", () => {
    expect(pageCount(51, 25)).toBe(3);
  });

  it("does not invent a second page for an exactly full one", () => {
    expect(pageCount(50, 25)).toBe(2);
    expect(pageCount(25, 25)).toBe(1);
  });
});

describe("buildListHref", () => {
  it("keeps the parameters it is not asked to change", () => {
    const href = buildListHref("/ro/admin/registrations", { status: "CONFIRMED", q: "ana" }, { sort: "name" });

    expect(href).toContain("status=CONFIRMED");
    expect(href).toContain("q=ana");
    expect(href).toContain("sort=name");
  });

  it("drops a parameter set to an empty string, so 'all events' is an absent filter", () => {
    expect(buildListHref("/list", { eventId: "abc" }, { eventId: "" })).toBe("/list");
  });

  it("returns the bare path when nothing is left", () => {
    expect(buildListHref("/list", {}, {})).toBe("/list");
  });

  it("resets the page when a filter changes", () => {
    // Filtering from page 4 of an unfiltered list to a filtered list with two pages would
    // otherwise land on a page that does not exist, and read as "no results".
    const href = buildListHref("/list", { page: "4", status: "PENDING" }, { status: "CONFIRMED" });

    expect(href).not.toContain("page=");
  });

  it("keeps the page when the page is the thing being changed", () => {
    expect(buildListHref("/list", { page: "4" }, { page: 5 })).toContain("page=5");
  });

  it("escapes a value rather than letting it add parameters of its own", () => {
    const href = buildListHref("/list", {}, { q: "ana&status=CONFIRMED" });

    expect(href).toBe("/list?q=ana%26status%3DCONFIRMED");
  });
});

describe("sortHref", () => {
  const query: ListQuery = {
    page: 2,
    perPage: 25,
    sort: "name",
    dir: "asc",
    offset: 25,
    limit: 25,
  };

  it("flips the direction of the column already sorted on", () => {
    expect(sortHref("/list", {}, query, "name")).toContain("dir=desc");
  });

  it("starts a new column at the direction it reads best in", () => {
    // A date wants newest first; a name wants A to Z. The caller states which.
    expect(sortHref("/list", {}, query, "submitted", "desc")).toContain("dir=desc");
    expect(sortHref("/list", {}, query, "status", "asc")).toContain("dir=asc");
  });

  it("returns to page one when the order changes", () => {
    expect(sortHref("/list", { page: "2" }, query, "status")).not.toContain("page=");
  });
});

describe("ariaSortFor", () => {
  const query: ListQuery = { page: 1, perPage: 25, sort: "name", dir: "asc", offset: 0, limit: 25 };

  it("reports the sorted column in the words aria-sort takes", () => {
    expect(ariaSortFor(query, "name")).toBe("ascending");
    expect(ariaSortFor({ ...query, dir: "desc" }, "name")).toBe("descending");
  });

  it("reports every other column as unsorted", () => {
    expect(ariaSortFor(query, "status")).toBe("none");
  });
});
