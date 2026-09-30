import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import proxy from "@/proxy";
import {
  DECLINED_PREFETCH_STATUS,
  isRouterPrefetch,
  isStaticPublicAnswer,
  LIVE_SEGMENT,
  liveTwinPathname,
  mayBeSignedIn,
  STATIC_PAGE_BROWSER_CACHE_CONTROL,
} from "@/i18n/live-twin";
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

  it("leaves a calendar period's own path to the CDN, and sends a filter on it to the period's twin (§574)", () => {
    expect(liveTwinPathname("/ro/calendar/2026-10", search(""), false)).toBeNull();
    expect(liveTwinPathname("/ro/calendar/2026-10/list", search("_rsc=1"), false)).toBeNull();
    expect(liveTwinPathname("/ro/calendar/2026-10", search("type=RACE"), false)).toBe(`/ro/${LIVE_SEGMENT}/calendar/2026-10`);
    expect(liveTwinPathname("/en/calendar/2026-10/list", search("partner=1"), false)).toBe(`/en/${LIVE_SEGMENT}/calendar/2026-10/list`);
    expect(liveTwinPathname("/ro/calendar/2027", search("surface=TRAIL"), true)).toBe(`/ro/${LIVE_SEGMENT}/calendar/2027`);
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

/*
  §NNN (amending §549): a twin only when what the page reads from the address changes what it shows.
  Measured on production 2026-09-30: `/ro/evenimente?foo=1` and `?page=2` were live-twin renders.
*/
describe("§NNN the twin answers only the questions the page itself reads", () => {
  it("leaves a key no page reads to the CDN, on every twinned route", () => {
    for (const query of ["foo=1", "page=2", "s=wp-login", "q=alergare", "lang=en", "fbclid=x&foo=1"]) {
      expect(liveTwinPathname("/ro/events", search(query), false), query).toBeNull();
      expect(liveTwinPathname("/ro/calendar/2026-10", search(query), false), query).toBeNull();
      expect(liveTwinPathname("/ro/events/crosul", search(query), false), query).toBeNull();
    }
  });

  it("leaves a filter that names nothing the page knows to the CDN, as the page would show the bare listing", () => {
    for (const query of ["type=FOO", "surface=", "difficulty=constructor", "partner=0", "night=yes", "view=grid", "cost=x&distance=y"]) {
      expect(liveTwinPathname("/ro/events", search(query), false), query).toBeNull();
      expect(liveTwinPathname("/en/calendar/2026-10/list", search(query), false), query).toBeNull();
    }
  });

  it("keeps every filter the page reads, in each shape it reads it, and the list layout", () => {
    for (const query of ["type=RACE", "type=race", "type=RACE,HIKE", "surface=TRAIL", "partner=1", "night=1", "registration=1", "view=list"]) {
      expect(liveTwinPathname("/ro/events", search(query), false), query).toBe(`/ro/${LIVE_SEGMENT}/events`);
    }
    expect(liveTwinPathname("/ro/calendar/2026-10", search("cost=FREE"), false)).toBe(`/ro/${LIVE_SEGMENT}/calendar/2026-10`);
    // The period path's layout is the path's, never the query's.
    expect(liveTwinPathname("/ro/calendar/2026-10", search("view=list"), false)).toBeNull();
  });

  it("keeps the bare calendar's old month, year and layout keys for its twin, past the proxy's redirect", () => {
    for (const query of ["month=2026-11", "year=2027", "view=list", "view=grid"]) {
      expect(liveTwinPathname("/ro/calendar", search(query), false), query).toBe(`/ro/${LIVE_SEGMENT}/calendar`);
    }
  });

  it("keeps an event page's four keys whatever their value, and the session's twin", () => {
    for (const query of ["lista=", "lista=2", "interest=done", "since=x", "declaratie=abc", "foo=1&lista=3"]) {
      expect(liveTwinPathname("/ro/events/crosul", search(query), false), query).toBe(`/ro/${LIVE_SEGMENT}/events/crosul`);
    }
    expect(liveTwinPathname("/ro/events/crosul", search("foo=1"), true)).toBe(`/ro/${LIVE_SEGMENT}/events/crosul`);
  });
});

/*
  §NNN: a signed-in reader's event links in view were each a twin render on prefetch. The proxy now
  declines a prefetch that a twin would answer — an empty 204 — and the press navigates to the twin.
*/
describe("§NNN the proxy declines a prefetch only a twin could answer", () => {
  const session = { cookie: "authjs.session-token=abc" };
  const prefetch = { rsc: "1", "next-router-prefetch": "1", "next-router-segment-prefetch": "/_tree" };
  const ask = (path: string, headers: Record<string, string>) => proxy(new NextRequest(`http://localhost:4000${path}`, { headers }));

  it("knows the router's prefetch from a navigation and a visit", () => {
    expect(isRouterPrefetch(new Headers(prefetch))).toBe(true);
    expect(isRouterPrefetch(new Headers({ "next-router-prefetch": "1" }))).toBe(true);
    expect(isRouterPrefetch(new Headers({ rsc: "1" }))).toBe(false);
    expect(isRouterPrefetch(new Headers())).toBe(false);
  });

  it("answers a signed-in reader's prefetch of an event page with an empty, unkept 204", async () => {
    const response = ask("/ro/evenimente/crosul", { ...session, ...prefetch });
    expect(response.status).toBe(DECLINED_PREFETCH_STATUS);
    expect(response.headers.get("cache-control")).toMatch(/private, no-store/);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it("still sends the signed-in reader's navigation and visit to the twin", () => {
    for (const headers of [{ ...session, rsc: "1" }, session]) {
      const response = ask("/ro/evenimente/crosul", headers);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-rewrite")).toContain(`/ro/${LIVE_SEGMENT}/events/crosul`);
    }
  });

  it("lets a stranger's prefetch of the same page reach the static page, and a signed-in prefetch of the listing too", () => {
    for (const [path, headers] of [
      ["/ro/evenimente/crosul", prefetch],
      ["/ro/evenimente", { ...session, ...prefetch }],
      ["/en/events/crosul", prefetch],
    ] as const) {
      const response = ask(path, headers);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("x-middleware-rewrite") ?? "", path).not.toContain(`/${LIVE_SEGMENT}/`);
    }
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
    // A calendar period's own path, one segment or two (§574).
    expect(isStaticPublicAnswer("/ro/calendar/2026-10", search(""), false)).toBe(true);
    expect(isStaticPublicAnswer("/en/calendar/2026-10/list", search(""), false)).toBe(true);
    expect(isStaticPublicAnswer("/ro/calendar/2026-10", search("type=RACE"), false)).toBe(false);
    expect(PREFETCHED_PATHNAMES.size).toBe(11);
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
