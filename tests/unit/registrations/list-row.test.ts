import { describe, expect, it } from "vitest";
import { listReturnAnchor, listReturnHref, registrationRowAnchor } from "@/modules/registrations/domain/list-row";

/**
 * BR-REQ-060-01, BR-REQ-070-01, `DECISIONS.md` §NNN — the owner, 2026-11-12: «Mă disperă în general că atunci când fac
 * un edit gen „aleg partenerul” și navighezi». A press on a row of the registrations list comes back to that row, its
 * outcome in the toast; a refusal still lands on the alert, where its sentence is. Only the list's query travels in the
 * form — the path is the caller's — so the field chooses which rows come back and never where the browser goes.
 */
const ID = "8f0c5d0e-1b7a-4c1d-9c55-0a1b2c3d4e5f";
const LIST = "/ro/admin/registrations";

describe("§NNN where a row's press comes back", () => {
  it("is the row of the registration when the press went through", () => {
    expect(registrationRowAnchor(ID)).toBe(`reg-${ID}`);
    expect(listReturnAnchor({ saved: "partnerSaved" }, ID)).toBe(`reg-${ID}`);
    // The row's `id` in the table is written from the database's own spelling: lower case.
    expect(listReturnAnchor({ saved: "noteAdded" }, ID.toUpperCase())).toBe(`reg-${ID}`);
  });

  it("is the page's alert for a refusal, for a press on no one row, and for an id that is not one", () => {
    expect(listReturnAnchor({ error: "FORBIDDEN" }, ID)).toBe("admin-alert");
    expect(listReturnAnchor({ saved: "memberTicksCleared" })).toBe("admin-alert");
    expect(listReturnAnchor({ saved: "noteAdded" }, "")).toBe("admin-alert");
    // Never a fragment somebody typed into a hidden field.
    expect(listReturnAnchor({ saved: "noteAdded" }, 'x"><script>')).toBe("admin-alert");
    expect(listReturnAnchor({ saved: "noteAdded" }, "admin-alert")).toBe("admin-alert");
  });

  it("writes the list's own query with the outcome in it, the keys of an older outcome dropped", () => {
    const href = listReturnHref(LIST, `eventId=abc&status=CONFIRMED&sort=name&dir=asc&page=3&perPage=50&saved=old&error=X&from=row&resent=1&erase=${ID}&count=2`, { saved: "resent" }, ID);
    const url = new URL(href, "https://example.test");
    expect(url.pathname).toBe(LIST);
    expect(Object.fromEntries(url.searchParams)).toEqual({ eventId: "abc", status: "CONFIRMED", sort: "name", dir: "asc", page: "3", perPage: "50", saved: "resent" });
    expect(url.hash).toBe(`#reg-${ID}`);
  });

  it("cannot be sent anywhere but the path it was given: the field is a query, whatever is typed in it", () => {
    const href = listReturnHref(LIST, "https://evil.example/x?y=1&saved=hack", { error: "CONFLICT" }, ID);
    expect(href.startsWith(`${LIST}?`)).toBe(true);
    const url = new URL(href, "https://example.test");
    expect(url.host).toBe("example.test");
    expect(url.searchParams.get("error")).toBe("CONFLICT");
    expect(url.searchParams.get("saved")).toBeNull();
    expect(url.hash).toBe("#admin-alert");
    // An empty query is the plain list.
    expect(listReturnHref(LIST, "", { saved: "noteAdded" }, ID)).toBe(`${LIST}?saved=noteAdded#reg-${ID}`);
  });
});
