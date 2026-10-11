import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { isStaticPublicAnswer, STATIC_PAGE_BROWSER_CACHE_CONTROL } from "@/i18n/live-twin";
import { prefetchFor } from "@/i18n/prefetch";
import proxy from "@/proxy";

/**
 * §714 (amending §353) — the site's root is the root page's to answer, not the proxy's.
 *
 * §353 answered `/ro` and `/en` in the proxy with a 308 to the listing, because a redirect thrown
 * from a page that was rendered per request came after the layout had started streaming. Since the
 * home page («Pagina principală») is a setting, the root is the home page while it is on and the
 * listing's redirect while it is off — and the proxy cannot read a setting without waking the database
 * on the site's most-visited address. So the proxy lets the root through to `app/[locale]/page.tsx`,
 * a static page (§549) whose redirect, decided in a prerender, is a real status line the CDN keeps.
 * `/` stays next-intl's: one hop to `/ro`.
 */
const ROOT = path.resolve(__dirname, "../../..");
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
const code = (file: string) => source(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("§714 the locale root reaches its page", () => {
  it("lets /ro and /en through to the root page, never a redirect of the proxy's own", () => {
    for (const address of ["http://localhost:4000/ro", "http://localhost:4000/en", "http://localhost:4000/ro/", "http://localhost:4000/ro?utm_source=newsletter"]) {
      const response = proxy(new NextRequest(address));
      expect(response.headers.get("location"), address).toBeNull();
      expect(response.status, address).toBe(200);
    }
  });

  it("tells the browser what Vercel's CDN tells it about a static page (§549)", () => {
    const response = proxy(new NextRequest("http://localhost:4000/ro"));
    expect(response.headers.get("cache-control")).toBe(STATIC_PAGE_BROWSER_CACHE_CONTROL);
    expect(isStaticPublicAnswer("/ro", new URLSearchParams(), false)).toBe(true);
    expect(isStaticPublicAnswer("/en", new URLSearchParams("utm_source=x"), true)).toBe(true);
    // The root's own pattern matches the locale alone, nothing under it.
    expect(isStaticPublicAnswer("/ro/admin", new URLSearchParams(), false)).toBe(false);
    expect(isStaticPublicAnswer("/de", new URLSearchParams(), false)).toBe(false);
  });

  it("sends / to the default locale's root in one hop, next-intl's temporary status kept", () => {
    const response = proxy(new NextRequest("http://localhost:4000/?ref=qr"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:4000/ro?ref=qr");
  });

  it("leaves every other address to next-intl as before", () => {
    expect(proxy(new NextRequest("http://localhost:4000/ro/evenimente")).headers.get("location")).toBeNull();
    const unprefixed = proxy(new NextRequest("http://localhost:4000/evenimente"));
    expect(unprefixed.headers.get("location")).toBe("http://localhost:4000/ro/evenimente");
    const contact = proxy(new NextRequest("http://localhost:4000/contact"));
    expect(contact.headers.get("location")).toBe("http://localhost:4000/ro/contact");
  });

  it("lets the logo prefetch the root, a static page", () => {
    expect(prefetchFor("/")).toBeUndefined();
    expect(prefetchFor("/?x=1")).toBe(false);
  });
});

describe("§714 the root page: the home page while the setting is on, a temporary redirect while it is off", () => {
  const page = code("src/app/[locale]/page.tsx");

  it("reads the setting from the public cache and redirects with next-intl's temporary redirect when off", () => {
    expect(page).toContain("const setting = await cachedHomePage();");
    expect(page).toMatch(/if \(!setting\.on\) redirect\(\{ href: "\/events", locale \}\);/);
    // Never §353's permanent redirect: a browser keeps a 308 for good, and the switch must be seen at once.
    expect(page).not.toMatch(/permanentRedirect/);
    expect(page).toMatch(/from "@\/i18n\/navigation"/);
  });

  it("is static with the public pages' ceiling and reads nothing of the request", () => {
    expect(page).toMatch(/^export const revalidate = 86400;$/m);
    expect(page).not.toMatch(/\bsearchParams\b|from "next\/headers"/);
    expect(page).not.toMatch(/^export const dynamic/m);
  });

  it("declares itself canonical in each language only while it is the home page, and carries the club's block", () => {
    expect(page).toMatch(/if \(!\(await cachedHomePage\(\)\)\.on\) return \{\};/);
    expect(page).toContain('alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/"))');
    // BR-REQ-052-02 criterion 1: the homepage's one SportsOrganization block, at the root's own address.
    expect(page).toContain('<JsonLd data={sportsOrganizationJsonLd(CLUB_NAME, staticRouteUrl(env.APP_BASE_URL, "/", locale))} />');
  });

  it("is no longer answered by the proxy", () => {
    expect(code("src/proxy.ts")).not.toMatch(/root-redirect|localeRootTarget/);
  });
});
