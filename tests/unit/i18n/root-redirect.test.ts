import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { listingPath, localeRootTarget } from "@/i18n/root-redirect";
import { routing } from "@/i18n/routing";
import proxy from "@/proxy";

/**
 * The site root is the listing, answered by the proxy with a real status (§353).
 *
 * `app/[locale]/page.tsx`'s `permanentRedirect` runs after the root layout has started
 * streaming, so production answered `/ro` with a 200, a 300 KB error document and a client-side
 * hop — a soft redirect on the most-visited URL. The proxy answers before anything renders.
 */
describe("§353 the locale root redirects before anything renders", () => {
  it("reads each locale's listing from the route table", () => {
    const localized = routing.pathnames["/events"] as Record<string, string>;
    for (const locale of routing.locales) expect(listingPath(locale)).toBe(`/${locale}${localized[locale]}`);
    expect(listingPath("ro")).toBe("/ro/evenimente");
    expect(listingPath("en")).toBe("/en/events");
  });

  it("names a target for a locale's root, with or without the slash, and for nothing else", () => {
    expect(localeRootTarget("/ro")).toBe("/ro/evenimente");
    expect(localeRootTarget("/ro/")).toBe("/ro/evenimente");
    expect(localeRootTarget("/en")).toBe("/en/events");
    for (const pathname of ["/", "/de", "/RO", "/ro/evenimente", "/evenimente", "/ro/admin", "//ro"]) {
      expect(localeRootTarget(pathname), pathname).toBeNull();
    }
  });

  it("answers /ro with a 308 to the listing and no page, the query kept", async () => {
    const response = proxy(new NextRequest("http://localhost:4000/ro?utm_source=newsletter&x=1"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost:4000/ro/evenimente?utm_source=newsletter&x=1");
    expect(await response.text()).toBe("");
  });

  it("answers /en with its own listing", () => {
    const response = proxy(new NextRequest("http://localhost:4000/en/"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost:4000/en/events");
  });

  it("sends / to the listing in one hop, keeping next-intl's locale and its temporary status", () => {
    const response = proxy(new NextRequest("http://localhost:4000/?ref=qr"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:4000/ro/evenimente?ref=qr");
  });

  it("leaves every other address to next-intl as before", () => {
    // The listing itself renders (a rewrite, not a redirect), and an unprefixed page still gets
    // its locale from next-intl.
    expect(proxy(new NextRequest("http://localhost:4000/ro/evenimente")).headers.get("location")).toBeNull();
    const unprefixed = proxy(new NextRequest("http://localhost:4000/evenimente"));
    expect(unprefixed.headers.get("location")).toBe("http://localhost:4000/ro/evenimente");
    const contact = proxy(new NextRequest("http://localhost:4000/contact"));
    expect(contact.headers.get("location")).toBe("http://localhost:4000/ro/contact");
  });
});
