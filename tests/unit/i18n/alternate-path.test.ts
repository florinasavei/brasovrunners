import { describe, expect, it } from "vitest";
import { parseLocalizedPath } from "@/i18n/alternate-path";

/**
 * BR-REQ-040-01 criterion 5 — the alternate-locale link points at the corresponding localized
 * page.
 *
 * Reading a localized URL back into the route that produced it is what the language switcher
 * needs before it can build the other language's URL. Everything here is pure; the half that
 * needs the database — translating a slug — is in `events/locale-switch.test.ts`.
 */
describe("BR-REQ-040-01 parsing a localized path", () => {
  it("recognises the Romanian listing and the English one", () => {
    expect(parseLocalizedPath("/ro/evenimente")).toEqual({
      locale: "ro",
      route: "/events",
      params: {},
    });
    expect(parseLocalizedPath("/en/events")).toEqual({
      locale: "en",
      route: "/events",
      params: {},
    });
  });

  it("recognises an event page and returns its slug", () => {
    expect(parseLocalizedPath("/ro/evenimente/tura-pe-tampa")).toEqual({
      locale: "ro",
      route: "/events/[slug]",
      params: { slug: "tura-pe-tampa" },
    });
    expect(parseLocalizedPath("/en/events/tampa-trail")).toEqual({
      locale: "en",
      route: "/events/[slug]",
      params: { slug: "tampa-trail" },
    });
  });

  it("prefers a static route over a dynamic one that could also match", () => {
    // `/en/events` must be the listing, never the detail route with an empty slug.
    expect(parseLocalizedPath("/en/events")?.route).toBe("/events");
  });

  it("recognises the locale root", () => {
    expect(parseLocalizedPath("/ro")).toEqual({ locale: "ro", route: "/", params: {} });
  });

  it("recognises the staff routes in both locales", () => {
    expect(parseLocalizedPath("/ro/admin")?.route).toBe("/admin");
    expect(parseLocalizedPath("/en/admin/staff")?.route).toBe("/admin/staff");
    expect(parseLocalizedPath("/ro/autentificare")?.route).toBe("/sign-in");
    expect(parseLocalizedPath("/en/sign-in")?.route).toBe("/sign-in");
    expect(parseLocalizedPath("/ro/previzualizare/evenimente/8f0c")).toEqual({
      locale: "ro",
      route: "/preview/events/[id]",
      params: { id: "8f0c" },
    });
  });

  it("decodes a percent-encoded segment", () => {
    // Romanian slugs are ASCII by rule, but a URL arrives encoded and the database holds the
    // decoded value, so a switch on an encoded path must still find the event.
    expect(parseLocalizedPath("/ro/evenimente/tura-pe-t%C3%A2mpa")?.params.slug).toBe(
      "tura-pe-tâmpa",
    );
  });

  it("returns nothing for a path that is not one of ours", () => {
    // Each of these is a real shape: no locale prefix, an unknown locale, an unknown route,
    // and an event path with the other locale's route spelling.
    expect(parseLocalizedPath("/evenimente")).toBeUndefined();
    expect(parseLocalizedPath("/de/veranstaltungen")).toBeUndefined();
    expect(parseLocalizedPath("/ro/nu-exista")).toBeUndefined();
    expect(parseLocalizedPath("/ro/events/tura-pe-tampa")).toBeUndefined();
    expect(parseLocalizedPath("/")).toBeUndefined();
  });

  it("ignores a query string", () => {
    expect(parseLocalizedPath("/ro/evenimente?utm_source=facebook")?.route).toBe("/events");
  });
});
