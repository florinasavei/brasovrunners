import { describe, expect, it } from "vitest";
import { summaryPillHref } from "@/modules/registrations/domain/summary-filter-links";

/**
 * BR-REQ-041-01, `DECISIONS.md` §626 — where a pill of the registrations list's summary strip leads.
 *
 * Every pill is a filter written into the address. What matters is what goes into that address
 * and what stays out: the list's own filters travel, the page's one-shot messages never do, and
 * pressing the state in force again takes it off.
 */
const BASE = "/ro/admin/registrations";

describe("§626 a summary pill's address", () => {
  it("sets the state and keeps the list's other filters", () => {
    const current = { eventId: "e1", q: "ana", clubMember: "1", bounced: "1", promo: "1", sort: "name", dir: "asc", perPage: "50" };
    const href = summaryPillHref(BASE, current, "CONFIRMED");
    const url = new URL(href, "https://x.test");
    expect(url.pathname).toBe(BASE);
    expect(Object.fromEntries(url.searchParams)).toEqual({ ...current, status: "CONFIRMED" });
  });

  it("changes the state in force to the pill's own", () => {
    const url = new URL(summaryPillHref(BASE, { eventId: "e1", status: "WAITLISTED" }, "CONFIRMED"), "https://x.test");
    expect(url.searchParams.getAll("status")).toEqual(["CONFIRMED"]);
    expect(url.searchParams.get("eventId")).toBe("e1");
  });

  it("takes the state off when its own pill is pressed again", () => {
    expect(summaryPillHref(BASE, { eventId: "e1", q: "ana", status: "CONFIRMED" }, "CONFIRMED")).toBe(`${BASE}?eventId=e1&q=ana`);
  });

  it("the total takes any state off and keeps the rest", () => {
    expect(summaryPillHref(BASE, { eventId: "e1", status: "WAITLISTED", promo: "1" }, null)).toBe(`${BASE}?eventId=e1&promo=1`);
    expect(summaryPillHref(BASE, {}, null)).toBe(BASE);
  });

  it("never carries a one-shot message, an open panel or the page", () => {
    const flashes = {
      saved: "registrationsCancelled",
      error: "forbidden",
      cancelled: "3",
      erased: "1",
      failed: "1",
      sent: "4",
      erase: "reg-1",
      marked: "2",
      voided: "17,18",
      test: "2",
      until: "2026-10-01T10:00:00Z",
      stop: "paused",
      gmail: "3",
      held: "1",
      page: "4",
    };
    for (const status of ["CONFIRMED", "WAITLISTED", null] as const) {
      const href = summaryPillHref(BASE, { eventId: "e1", ...flashes }, status);
      for (const key of Object.keys(flashes)) expect(href, `${key} in ${href}`).not.toMatch(new RegExp(`[?&]${key}=`));
      expect(href).toContain("eventId=e1");
    }
  });

  it("an unreadable state in the address is replaced, or dropped, never copied", () => {
    expect(summaryPillHref(BASE, { status: "nonsense" }, "CONFIRMED")).toBe(`${BASE}?status=CONFIRMED`);
    expect(summaryPillHref(BASE, { status: "nonsense" }, null)).toBe(BASE);
  });

  it("an empty value is no filter", () => {
    expect(summaryPillHref(BASE, { eventId: "", q: "" }, "EXPIRED")).toBe(`${BASE}?status=EXPIRED`);
  });
});
