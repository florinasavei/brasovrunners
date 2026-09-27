import { existsSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { MOVED_BACKOFFICE_PATHS, resolveMovedBackofficePath } from "@/i18n/moved-paths";
import { routing } from "@/i18n/routing";
import proxy from "@/proxy";

/**
 * §NNN — every backoffice address that moved into «Setări» answers a 308 to its new one, before
 * anything renders, with the query kept: `/admin/emails`, `/admin/pages/appearance`,
 * `/admin/tasks?panel=costs` and `/admin/tasks?panel=botCheck`. BR-REQ-060-01: the redirect
 * says where a page is, never whether the reader may open it — the page behind it still decides.
 */
const ROOT = process.cwd();

describe("§NNN the moved backoffice addresses", () => {
  it("names each old address and its new place, in both locales, with the query kept", () => {
    for (const locale of routing.locales) {
      expect(resolveMovedBackofficePath(`/${locale}/admin/emails`, "")).toEqual({ pathname: `/${locale}/admin/settings/emails`, search: "" });
      expect(resolveMovedBackofficePath(`/${locale}/admin/emails`, "?lang=en&saved=emailPlan")).toEqual({
        pathname: `/${locale}/admin/settings/emails`,
        search: "?lang=en&saved=emailPlan",
      });
      expect(resolveMovedBackofficePath(`/${locale}/admin/pages/appearance`, "?saved=siteTint")).toEqual({
        pathname: `/${locale}/admin/settings/appearance`,
        search: "?saved=siteTint",
      });
      // The panel was the old address's way of naming the place; the new address is the place.
      expect(resolveMovedBackofficePath(`/${locale}/admin/tasks`, "?panel=costs&saved=neonPlan")).toEqual({
        pathname: `/${locale}/admin/settings/costs`,
        search: "?saved=neonPlan",
      });
      expect(resolveMovedBackofficePath(`/${locale}/admin/tasks`, "?panel=botCheck")).toEqual({ pathname: `/${locale}/admin/settings/platform`, search: "" });
    }
    // Unprefixed stays unprefixed: next-intl negotiates the locale on the next hop, as for `/login`.
    expect(resolveMovedBackofficePath("/admin/emails", "")).toEqual({ pathname: "/admin/settings/emails", search: "" });
    // A trailing slash is the same address.
    expect(resolveMovedBackofficePath("/ro/admin/emails/", "")).toEqual({ pathname: "/ro/admin/settings/emails", search: "" });
  });

  it("leaves every address that did not move alone — «Sarcini»'s own panels included", () => {
    for (const [pathname, search] of [
      ["/ro/admin/tasks", ""],
      ["/ro/admin/tasks", "?panel=club"],
      ["/ro/admin/tasks", "?panel=todo&for=Ana"],
      ["/ro/admin/tasks", "?panel=app"],
      ["/ro/admin/pages", ""],
      ["/ro/admin/pages/team", ""],
      ["/ro/admin/settings/emails", ""],
      ["/ro/admin/emails/extra", ""],
      ["/ro/evenimente", ""],
      ["/ro", ""],
    ] as const) {
      expect(resolveMovedBackofficePath(pathname, search), `${pathname}${search}`).toBeNull();
    }
  });

  it("points every row at a route that exists, and away from one that does not any more", () => {
    for (const moved of MOVED_BACKOFFICE_PATHS) {
      expect(existsSync(path.join(ROOT, "src/app/[locale]", moved.to, "page.tsx")), moved.to).toBe(true);
      expect(moved.to in routing.pathnames, moved.to).toBe(true);
      // The old page is gone (a panel's old page, `/admin/tasks`, stays for its own panels).
      if (moved.panel === undefined) {
        expect(existsSync(path.join(ROOT, "src/app/[locale]", moved.from, "page.tsx")), moved.from).toBe(false);
        expect(moved.from in routing.pathnames, moved.from).toBe(false);
      }
    }
  });

  it("is answered by the proxy: a 308, the query kept, no body, never indexed or cached", async () => {
    const response = proxy(new NextRequest("http://localhost:4000/ro/admin/tasks?panel=costs&saved=neonLimits"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost:4000/ro/admin/settings/costs?saved=neonLimits");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toBe("");

    const emails = proxy(new NextRequest("http://localhost:4000/en/admin/emails?lang=ro"));
    expect(emails.status).toBe(308);
    expect(emails.headers.get("location")).toBe("http://localhost:4000/en/admin/settings/emails?lang=ro");

    const tint = proxy(new NextRequest("http://localhost:4000/ro/admin/pages/appearance"));
    expect(tint.status).toBe(308);
    expect(tint.headers.get("location")).toBe("http://localhost:4000/ro/admin/settings/appearance");

    const bot = proxy(new NextRequest("http://localhost:4000/ro/admin/tasks?panel=botCheck"));
    expect(bot.status).toBe(308);
    expect(bot.headers.get("location")).toBe("http://localhost:4000/ro/admin/settings/platform");
  });

  it("does not redirect «Sarcini» itself", () => {
    const response = proxy(new NextRequest("http://localhost:4000/ro/admin/tasks?panel=todo"));
    expect(response.status).not.toBe(308);
  });
});
