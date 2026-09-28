import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";
import { PAGES_ROW_ENTRIES, PAGES_ROW_ROUTE, pagesRowEntryOf } from "@/modules/content/pages/pages-row";
import { activeAdminTabHref } from "@/modules/staff-identity/domain/admin-tab-match";
import { SETTINGS_TAB_ROUTE } from "@/modules/staff-identity/domain/settings-tabs";
import { deletePage, movePageInNav } from "@/modules/content/pages/service";
import { canEditEventFields, canEditTexts, canReadContent, canTransition, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { pageListVerbs } from "@/modules/content/pages/page-list-verbs";

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

describe("«Pagini»'s row on the club's own pages' editors, and the list's gate (§537)", () => {
  it("renders the row with «Paginile clubului» marked on /admin/pages/new and /admin/pages/<id>", () => {
    for (const file of ["src/app/[locale]/admin/pages/new/page.tsx", "src/app/[locale]/admin/pages/[id]/page.tsx"]) {
      expect(read(file), file).toContain('<PagesSubNav locale={locale} active="pages" />');
    }
    expect(pagesRowEntryOf("/en/admin/pages/new")).toBe("pages");
    expect(pagesRowEntryOf("/en/admin/pages/1b4e28ba-2fa1-11d2-883f-0016d3cca427")).toBe("pages");
  });

  it("gates the list's layout as the page and the tab do: a Redactor reaches the list (BR-REQ-060-01)", () => {
    const layout = read("src/app/[locale]/admin/pages/(list)/layout.tsx");
    expect(layout).toContain("if (!canReadContent(actor.role)) notFound();");
    expect(layout).not.toContain("isEditorial(actor.role)");
    expect(read("src/app/[locale]/admin/pages/(list)/page.tsx")).toContain("if (!canReadContent(actor.role)) notFound();");
    expect(canReadContent("COPYWRITER")).toBe(true);
    expect(canReadContent("CONTRIBUTOR")).toBe(false);
  });

  it("keeps the list's writes behind their own gates: a Redactor cannot reorder or delete", async () => {
    const copywriter = { id: "00000000-0000-4000-8000-000000000001", role: "COPYWRITER" as const };
    expect(canEditEventFields("COPYWRITER")).toBe(false);
    // Refused before the database is asked, so no database is needed to prove it.
    const db = {} as Parameters<typeof movePageInNav>[0];
    await expect(movePageInNav(db, { actor: copywriter, pageId: "x", direction: "up" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deletePage(db, { actor: copywriter, pageId: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The arrows are drawn only for a role the move accepts.
    expect(read("src/app/[locale]/admin/pages/(list)/page.tsx")).toContain("const mayMove = canEditEventFields(actor.role);");
  });
});

describe("the pages list's ⋮ offers each role only the verbs its services accept (BR-REQ-060-01)", () => {
  const STATUSES = ["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"] as const;

  it("gates «Șterge» on canEditEventFields, the gate deletePage asserts", () => {
    for (const role of STAFF_ROLES) {
      for (const status of STATUSES) expect(pageListVerbs(role, status).remove, `${role} ${status}`).toBe(canEditEventFields(role));
    }
    expect(pageListVerbs("COPYWRITER", "DRAFT").remove).toBe(false);
    expect(pageListVerbs("ADMIN", "DRAFT").remove).toBe(true);
  });

  it("offers «Publică» / «Retrage» only where transitionPage's table lets the role move the page", () => {
    for (const role of STAFF_ROLES) {
      for (const status of STATUSES) {
        const target = status === "PUBLISHED" ? "DRAFT" : "PUBLISHED";
        expect(pageListVerbs(role, status).toggleTo, `${role} ${status}`).toBe(canTransition(role, status, target, false) ? target : null);
      }
    }
    // A Redactor is shown neither; an Administrator unpublishes a live page and publishes a submitted one.
    for (const status of STATUSES) expect(pageListVerbs("COPYWRITER", status).toggleTo).toBeNull();
    expect(pageListVerbs("ADMIN", "PUBLISHED").toggleTo).toBe("DRAFT");
    expect(pageListVerbs("ADMIN", "IN_REVIEW").toggleTo).toBe("PUBLISHED");
  });

  it("keeps «Editează» for canEditTexts, and the list draws each form only with its item", () => {
    for (const role of STAFF_ROLES) expect(pageListVerbs(role, "DRAFT").edit, role).toBe(canEditTexts(role));
    expect(pageListVerbs("COPYWRITER", "DRAFT").edit).toBe(true);
    const list = read("src/app/[locale]/admin/pages/(list)/page.tsx");
    expect(list).toContain("const verbs = pageListVerbs(actor.role, row.editorialStatus as EditorialStatus);");
    expect(list).toContain("{verbs.remove && (");
    expect(list).toContain("{verbs.toggleTo && (");
    expect(list).toContain('if (verbs.remove) items.push({ kind: "submit", label: t("pages.delete")');
  });
});
