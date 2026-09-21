import { describe, expect, it } from "vitest";
import { START_LIST_PAGE_SIZE, startListPage } from "@/modules/registrations/domain/start-list-page";

/**
 * BR-REQ-039-01, `DECISIONS.md` §250 — one page of the public entry list.
 *
 * Two kinds of row share one sequence: the runners the list names, in the order they confirmed,
 * and then one line each for the runners who asked to be left off (§186). Getting that wrong is
 * not cosmetic — a page that asks the database for the wrong slice shows somebody twice, or
 * skips them, and the list is what a runner checks to see that they are in.
 */
describe("§250 the entry list, one page at a time", () => {
  it("asks for exactly the rows one page shows", () => {
    const first = startListPage(120, 0, "1", 50);
    expect(first).toMatchObject({ page: 1, pages: 3, namedOffset: 0, namedLimit: 50, anonymousOnPage: 0, firstPosition: 1 });

    const second = startListPage(120, 0, "2", 50);
    expect(second).toMatchObject({ page: 2, namedOffset: 50, namedLimit: 50, firstPosition: 51 });

    const last = startListPage(120, 0, "3", 50);
    expect(last).toMatchObject({ page: 3, namedOffset: 100, namedLimit: 20, firstPosition: 101 });
  });

  it("puts the unnamed runners after the named ones, across the page boundary", () => {
    // 48 named and 5 anonymous: the first page ends with two of the anonymous lines, and the
    // second page carries the other three. Nobody is counted twice and nobody is dropped.
    const first = startListPage(48, 5, "1", 50);
    expect(first).toMatchObject({ pages: 2, namedLimit: 48, anonymousOnPage: 2, total: 53 });

    const second = startListPage(48, 5, "2", 50);
    expect(second).toMatchObject({ namedLimit: 0, namedOffset: 48, anonymousOnPage: 3, firstPosition: 51 });
    expect(first.namedLimit + first.anonymousOnPage + second.namedLimit + second.anonymousOnPage).toBe(53);
  });

  it("fetches nothing when a page holds no named rows at all", () => {
    // The query is skipped on a `namedLimit` of zero: a page of anonymous lines needs no names,
    // and asking for none is a round trip that returns nothing.
    expect(startListPage(0, 30, "1", 50)).toMatchObject({ namedLimit: 0, anonymousOnPage: 30, pages: 1 });
  });

  it("reads anything that is not a page as the first one", () => {
    // The query string is typed by anybody: a word, a negative number, a page past the end.
    for (const asked of ["", "x", "0", "-4", undefined, null, "9999"]) {
      const view = startListPage(120, 0, asked, 50);
      expect(view.page >= 1 && view.page <= view.pages, String(asked)).toBe(true);
    }
    expect(startListPage(120, 0, "9999", 50).page).toBe(3);
    expect(startListPage(120, 0, "-4", 50).page).toBe(1);
  });

  it("is one page when there is nothing to show", () => {
    expect(startListPage(0, 0, "1", 50)).toMatchObject({ pages: 1, total: 0, namedLimit: 0, anonymousOnPage: 0 });
  });

  it("shows fifty to a page by default", () => {
    expect(START_LIST_PAGE_SIZE).toBe(50);
    expect(startListPage(51, 0, "1").namedLimit).toBe(50);
  });
});
