import { describe, expect, it } from "vitest";
import { LIVE_SEGMENT, liveTwinPathname, mayBeSignedIn } from "@/i18n/live-twin";

/**
 * §NNN (amending §333) — which request the static page cannot answer, and so goes to the page's
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
