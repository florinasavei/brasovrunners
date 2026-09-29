import { describe, expect, it } from "vitest";
import { prefetchFor } from "@/i18n/prefetch";

/**
 * §549 — a link from a static public page prefetches only another static page at its bare address;
 * a per-request address (a form, a session page, a live twin) is never prefetched.
 */
describe("§549 prefetchFor", () => {
  it.each(["/events", "/calendar", "/faq", "/team", "/gallery", "/legal/terms", "/legal/privacy"])("keeps Next's default for the static page %s", (href) => {
    expect(prefetchFor(href)).toBeUndefined();
  });

  it("keeps Next's default for a static page named with its params", () => {
    expect(prefetchFor({ pathname: "/events/[slug]", params: { slug: "crosul" } } as never)).toBeUndefined();
    expect(prefetchFor({ pathname: "/pages/[slug]", query: {} })).toBeUndefined();
    expect(prefetchFor({ pathname: "/gallery/[slug]", query: { ignored: undefined } })).toBeUndefined();
  });

  it.each(["/contact", "/members", "/members-area", "/sign-in", "/registrations/mine", "/registrations/resend", "/admin"])("never prefetches the per-request page %s", (href) => {
    expect(prefetchFor(href)).toBe(false);
  });

  it("never prefetches the register or the declaration form", () => {
    expect(prefetchFor({ pathname: "/events/[slug]/register", params: { slug: "crosul" } } as never)).toBe(false);
    expect(prefetchFor({ pathname: "/events/[slug]/declaration", params: { slug: "crosul" } } as never)).toBe(false);
  });

  it("never prefetches a live twin: a static page asked with a query", () => {
    expect(prefetchFor({ pathname: "/calendar", query: { month: "2026-11" } })).toBe(false);
    expect(prefetchFor({ pathname: "/events", query: "type=RACE" })).toBe(false);
    expect(prefetchFor("/events?type=RACE")).toBe(false);
    expect(prefetchFor({ pathname: "/events/[slug]", query: { lista: "2" } })).toBe(false);
  });

  it("ignores an anchor", () => {
    expect(prefetchFor("/faq#payments")).toBeUndefined();
  });
});
