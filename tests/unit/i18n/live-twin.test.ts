import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import proxy from "@/proxy";
import { isStaticPublicAnswer, LIVE_SEGMENT, liveTwinPathname, mayBeSignedIn, STATIC_PAGE_BROWSER_CACHE_CONTROL } from "@/i18n/live-twin";
import { PREFETCHED_PATHNAMES } from "@/i18n/prefetch";

/**
 * §549 (amending §333) — which request the static page cannot answer, and so goes to the page's
 * live twin: an address whose query the page reads, or an event page asked with a session cookie.
 */
const search = (query: string) => new URLSearchParams(query);

describe("liveTwinPathname", () => {
  it("leaves the bare listing, calendar and event page to the CDN", () => {
    expect(liveTwinPathname("/ro/events", search(""), false)).toBeNull();
    expect(liveTwinPathname("/en/calendar", search(""), false)).toBeNull();
    expect(liveTwinPathname("/ro/events/crosul", search(""), false)).toBeNull();
  });

  it("sends a filter, a month, a layout to the twin (§413, §116, §137)", () => {
    expect(liveTwinPathname("/ro/events", search("type=RACE"), false)).toBe(`/ro/${LIVE_SEGMENT}/events`);
    expect(liveTwinPathname("/ro/calendar", search("month=2026-11"), false)).toBe(`/ro/${LIVE_SEGMENT}/calendar`);
    expect(liveTwinPathname("/en/calendar", search("view=list&partner=1"), false)).toBe(`/en/${LIVE_SEGMENT}/calendar`);
  });

  it("sends an event page's own questions to the twin: ?lista=, ?interest=, ?declaratie=", () => {
    for (const query of ["lista=2", "interest=1", "interest=invalid&since=2026-11-20T10:00:00.000Z", "declaratie=abc"]) {
      expect(liveTwinPathname("/ro/events/crosul", search(query), false)).toBe(`/ro/${LIVE_SEGMENT}/events/crosul`);
    }
  });

  it("keeps a shared link static: fbclid, utm_*, gclid and Next's own _rsc ask the page nothing", () => {
    expect(liveTwinPathname("/ro/events/crosul", search("fbclid=IwAR0&utm_source=facebook&utm_medium=social"), false)).toBeNull();
    expect(liveTwinPathname("/ro/events", search("_rsc=1a2b3"), false)).toBeNull();
    expect(liveTwinPathname("/ro/events", search("gclid=x&utm_campaign=race"), false)).toBeNull();
  });

  it("sends a signed-in reader to the event page's twin only — the staff edit button (§135)", () => {
    expect(liveTwinPathname("/ro/events/crosul", search(""), true)).toBe(`/ro/${LIVE_SEGMENT}/events/crosul`);
    expect(liveTwinPathname("/ro/events", search(""), true)).toBeNull();
    expect(liveTwinPathname("/ro/calendar", search(""), true)).toBeNull();
  });

  it("has no twin for any other route: the form, a token page, the backoffice", () => {
    expect(liveTwinPathname("/ro/events/crosul/register", search("x=1"), true)).toBeNull();
    expect(liveTwinPathname("/ro/contact", search("sent=1"), false)).toBeNull();
    expect(liveTwinPathname("/ro/admin", search("a=1"), true)).toBeNull();
    expect(liveTwinPathname("/ro/faq", search("q=1"), false)).toBeNull();
  });
});

describe("mayBeSignedIn", () => {
  it("knows Auth.js's session cookie, on HTTP and HTTPS, whole or chunked, and the development switcher's", () => {
    expect(mayBeSignedIn(["authjs.session-token"])).toBe(true);
    expect(mayBeSignedIn(["__Secure-authjs.session-token"])).toBe(true);
    expect(mayBeSignedIn(["__Secure-authjs.session-token.0", "__Secure-authjs.session-token.1"])).toBe(true);
    expect(mayBeSignedIn(["br_dev_staff"])).toBe(true);
  });

  it("is not fooled by the cookies every visitor may carry", () => {
    expect(mayBeSignedIn([])).toBe(false);
    expect(mayBeSignedIn(["br_flash", "authjs.csrf-token", "authjs.callback-url", "theme"])).toBe(false);
  });
});

/**
 * §549 — a static page's answer tells the browser what Vercel's CDN tells it: keep it, but ask
 * again before every use. `next start` would otherwise hand the browser `stale-while-revalidate`,
 * and the browser would show a page from before the last save.
 */
describe("isStaticPublicAnswer", () => {
  it("is every static public page at its bare address, in both locales", () => {
    for (const path of ["/ro/events", "/en/events/crosul", "/ro/calendar", "/ro/faq", "/en/team", "/ro/gallery", "/ro/gallery/album", "/ro/pages/despre", "/ro/legal/terms", "/en/legal/privacy"]) {
      expect(isStaticPublicAnswer(path, search(""), false), path).toBe(true);
    }
    // Next's own `_rsc` and a share's `utm_*` still reach the static page.
    expect(isStaticPublicAnswer("/ro/events", search("_rsc=abc&utm_source=x"), false)).toBe(true);
    expect(PREFETCHED_PATHNAMES.size).toBe(10);
  });

  it("is never a twin's answer, a page rendered per request, or the backoffice", () => {
    expect(isStaticPublicAnswer("/ro/events", search("type=RACE"), false)).toBe(false);
    expect(isStaticPublicAnswer("/ro/events/crosul", search(""), true)).toBe(false);
    expect(isStaticPublicAnswer("/ro/events/crosul/register", search(""), false)).toBe(false);
    expect(isStaticPublicAnswer("/ro/contact", search(""), false)).toBe(false);
    expect(isStaticPublicAnswer("/ro/admin/events/new", search(""), true)).toBe(false);
    expect(isStaticPublicAnswer("/ro/live/events", search("type=RACE"), false)).toBe(false);
  });

  it("says what Vercel's CDN sends the browser for an s-maxage page", () => {
    expect(STATIC_PAGE_BROWSER_CACHE_CONTROL).toBe("public, max-age=0, must-revalidate");
  });
});

/**
 * The proxy sets that header off Vercel only on a GET or a HEAD (a review nit): a POST to a static
 * page's address — a Server Action, a form sent without JavaScript — is answered per request, and
 * Next's own `no-store` on it must stand, which it does only while no `Cache-Control` is set first.
 */
describe("the proxy's browser header for a static page", () => {
  const ask = (method: string) => proxy(new NextRequest("http://localhost:4000/ro/evenimente", { method })).headers.get("cache-control");

  it("is set on a GET and a HEAD, off Vercel", () => {
    expect(process.env.VERCEL).not.toBe("1");
    expect(ask("GET")).toBe(STATIC_PAGE_BROWSER_CACHE_CONTROL);
    expect(ask("HEAD")).toBe(STATIC_PAGE_BROWSER_CACHE_CONTROL);
  });

  it("is never set on a POST to the same address", () => {
    expect(ask("POST")).toBeNull();
  });
});
