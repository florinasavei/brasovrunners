import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";
import { PAGES_ROW_ENTRIES, PAGES_ROW_ROUTE, pagesRowEntryOf } from "@/modules/content/pages/pages-row";
import { activeAdminTabHref } from "@/modules/staff-identity/domain/admin-tab-match";
import { SETTINGS_TAB_ROUTE } from "@/modules/staff-identity/domain/settings-tabs";

/**
 * «Pagini»'s row keeps the reader in «Pagini» (the owner, 2026-09-28: «când dau click pe pagina de
 * contact mă duce automat la Setări... ar trebui să rămân în același loc»).
 *
 * «Contact» opened «Setări» → «Contact» (§516), so the main bar lit «Setări» and the row was gone.
 * Every entry is an address under `/admin/pages` now; the main bar resolves «Pagini» for each, the
 * row marks the entry the address names, and each page's `active` is that entry.
 */
const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** The main bar's hrefs as the shell resolves them, for one locale — the sections that could compete. */
const barFor = (locale: string) => [
  { href: `/${locale}/admin` },
  { href: `/${locale}/admin/pages` },
  { href: `/${locale}/admin/gallery` },
  { href: `/${locale}/admin/settings`, alsoActiveOn: [`/${locale}/devs`] },
  { href: `/${locale}/admin/tasks` },
];

/** The five addresses of the row, and the entry each one is. */
const ADDRESSES = [
  { path: "/admin/pages/contact", entry: "contact" },
  { path: "/admin/pages/team", entry: "team" },
  { path: "/admin/pages/faq", entry: "faq" },
  { path: "/admin/pages/members", entry: "members" },
  { path: "/admin/pages", entry: "pages" },
] as const;

describe("«Pagini»'s row: every entry an address of the section", () => {
  it("routes every entry under /admin/pages, to a route in the table and a page on disk", () => {
    expect([...PAGES_ROW_ENTRIES]).toEqual(["contact", "team", "faq", "members", "pages"]);
    for (const entry of PAGES_ROW_ENTRIES) {
      const route = PAGES_ROW_ROUTE[entry];
      expect(route === "/admin/pages" || route.startsWith("/admin/pages/"), entry).toBe(true);
      expect(route in routing.pathnames, route).toBe(true);
      const onDisk =
        existsSync(path.join(ROOT, "src/app/[locale]", route, "page.tsx")) ||
        existsSync(path.join(ROOT, "src/app/[locale]", route, "(list)", "page.tsx"));
      expect(onDisk, route).toBe(true);
    }
  });

  it("names the entry of each of the five addresses, in both locales and unprefixed", () => {
    for (const { path: address, entry } of ADDRESSES) {
      for (const locale of routing.locales) expect(pagesRowEntryOf(`/${locale}${address}`), `${locale}${address}`).toBe(entry);
      expect(pagesRowEntryOf(address), address).toBe(entry);
      expect(pagesRowEntryOf(`/ro${address}/`), `${address}/`).toBe(entry);
    }
    // The club's own pages — a new one and one page's editor — are «Paginile clubului».
    expect(pagesRowEntryOf("/ro/admin/pages/new")).toBe("pages");
    expect(pagesRowEntryOf("/ro/admin/pages/1b4e28ba-2fa1-11d2-883f-0016d3cca427")).toBe("pages");
    // Outside the section there is no entry.
    for (const address of ["/ro/admin", "/ro/admin/settings/emails", "/ro/admin/gallery", "/ro/contact", "/ro/admin/pagesx"]) {
      expect(pagesRowEntryOf(address), address).toBeNull();
    }
  });

  it("lights «Pagini» in the main bar on every one of the five addresses, never «Setări» or «Evenimente»", () => {
    for (const locale of routing.locales) {
      const bar = barFor(locale);
      for (const { path: address } of ADDRESSES) {
        expect(activeAdminTabHref(bar, `/${locale}${address}`), `${locale}${address}`).toBe(`/${locale}/admin/pages`);
      }
      // The rest of the bar still resolves as it did: the longest href, then «Setări» on /devs.
      expect(activeAdminTabHref(bar, `/${locale}/admin/settings/emails`)).toBe(`/${locale}/admin/settings`);
      expect(activeAdminTabHref(bar, `/${locale}/admin/events/new`)).toBe(`/${locale}/admin`);
      expect(activeAdminTabHref(bar, `/${locale}/devs`)).toBe(`/${locale}/admin/settings`);
      expect(activeAdminTabHref(bar, `/${locale}/evenimente`)).toBeNull();
    }
  });

  it("marks, on each page, the entry its own address names", () => {
    const pageFile = (route: string) =>
      route === "/admin/pages" ? "src/app/[locale]/admin/pages/(list)/page.tsx" : `src/app/[locale]${route}/page.tsx`;
    for (const { path: address, entry } of ADDRESSES) {
      expect(read(pageFile(address)), address).toContain(`<PagesSubNav locale={locale} active="${entry}" />`);
    }
  });

  it("draws the row from the table, so no entry leaves the section", () => {
    const nav = read("src/modules/content/pages/ui/PagesSubNav.tsx");
    expect(nav).toContain("href: getPathname({ locale, href: PAGES_ROW_ROUTE[key] })");
    expect(nav).toContain("active: active === key");
    expect(nav).not.toContain("/admin/settings");
    // The list's standard cards open the same addresses.
    const list = read("src/app/[locale]/admin/pages/(list)/page.tsx");
    for (const entry of ["contact", "team", "faq", "members"]) expect(list, entry).toContain(`href: PAGES_ROW_ROUTE.${entry},`);
    expect(list).not.toContain("/admin/settings/contact");
  });

  it("keeps «Contact» off «Setări»: its two cards and their saves are «Pagini»'s, the gate unchanged", () => {
    expect(Object.values(SETTINGS_TAB_ROUTE) as string[]).not.toContain("/admin/settings/contact");
    expect("/admin/settings/contact" in routing.pathnames).toBe(false);
    const page = read("src/app/[locale]/admin/pages/contact/page.tsx");
    // BR-REQ-060-01: the page asks the gate the tab asked (canReadContent), as a real 404.
    expect(page).toContain("if (!canReadContent(actor.role)) notFound();");
    expect(page).not.toContain("SettingsSubNav");
    const actions = read("src/app/[locale]/admin/pages/contact/actions.ts");
    expect(actions.match(/href: "\/admin\/pages\/contact"/g)).toHaveLength(2);
    expect(actions).not.toContain("/admin/settings/contact");
    expect(actions.match(/requireStaffCapability\(canManageClubSettings\)/g)).toHaveLength(2);
  });
});
