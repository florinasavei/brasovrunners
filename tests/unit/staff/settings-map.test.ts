import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { routing } from "@/i18n/routing";
import { ADMIN_SECTIONS, canOpenSettings, canSeeDiagnostics, STAFF_ROLES, type StaffRole, visibleAdminSections } from "@/modules/staff-identity/domain/roles";
import {
  canOpenSettingsTab,
  defaultSettingsTab,
  offersConfigurationTab,
  SETTINGS_TAB_ROUTE,
  SETTINGS_TABS,
  visibleSettingsTabs,
} from "@/modules/staff-identity/domain/settings-tabs";
import { SECTION_TARGET_ROUTE, TASK_TARGETS, targetRoute } from "@/modules/diagnostics/domain/task-targets";

/**
 * §516 — one predictable backoffice map (the owner, 2026-09-27: «navbar-urile și URL-urile shared
 * între Sarcini și config sunt un pic greșite, ne duce prea dintr-o parte în alta»).
 *
 * BR-REQ-060-01: «Setări» and each of its tabs are offered only to the roles their gates open, and
 * every tab's page asserts the same gate on the server. The bar is in the order the club opens
 * things. Every row of «Sarcini» → «Club» that is done on a screen of this backoffice links to a
 * route that exists and to a card that carries the `#` it names.
 */
const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const pageOf = (route: string) => path.join("src/app/[locale]", route, "page.tsx");
/** A route's page on disk: its own `page.tsx`, or the one in its `(list)` route group (the lists keep a loading boundary there). */
const routeExists = (route: string) =>
  existsSync(path.join(ROOT, pageOf(route))) || existsSync(path.join(ROOT, "src/app/[locale]", route, "(list)", "page.tsx"));

describe("BR-REQ-060-01 «Setări»: who opens which tab", () => {
  it("offers the three content tabs from the Redactor up, «Costuri» and «Anti-robot» to the Administrators, nothing to the volunteer", () => {
    const content = ["emails", "deadlines", "appearance"];
    const expected: Record<StaffRole, string[]> = {
      // A club member (§524) has no backoffice at all.
      MEMBER: [],
      CONTRIBUTOR: [],
      COPYWRITER: content,
      MODERATOR: content,
      DEV: content,
      ADMIN: [...SETTINGS_TABS],
      SUPERADMIN: [...SETTINGS_TABS],
    };
    for (const role of STAFF_ROLES) expect(visibleSettingsTabs(role), role).toEqual(expected[role]);
  });

  it("keeps the gates of the panels that moved: «Costuri» and «Anti-robot» were `canManageRegistrations` on «Sarcini»", () => {
    for (const role of STAFF_ROLES) {
      expect(canOpenSettingsTab(role, "costs"), role).toBe(role === "ADMIN" || role === "SUPERADMIN");
      expect(canOpenSettingsTab(role, "platform"), role).toBe(role === "ADMIN" || role === "SUPERADMIN");
    }
  });

  it("offers the section exactly to a role with a tab in it, and lands it on «Emailuri»", () => {
    for (const role of STAFF_ROLES) {
      expect(canOpenSettings(role), role).toBe(visibleSettingsTabs(role).length > 0);
      expect(visibleAdminSections(role).includes("settings"), role).toBe(canOpenSettings(role));
      expect(defaultSettingsTab(role), role).toBe(canOpenSettings(role) ? "emails" : null);
    }
  });

  it("ends the row with «Configurație» (/devs) for exactly the roles that page opens to, and /devs draws the row with it marked", () => {
    for (const role of STAFF_ROLES) expect(offersConfigurationTab(role), role).toBe(canSeeDiagnostics(role));
    // One way in (§520): the main bar has no «Configurație» of its own; «Setări» lights on /devs.
    for (const role of STAFF_ROLES) {
      expect(visibleAdminSections(role) as string[], role).not.toContain("devs");
      if (offersConfigurationTab(role)) expect(visibleAdminSections(role), role).toContain("settings");
    }
    expect(read("src/modules/staff-identity/ui/BackofficeShell.tsx")).toContain('alsoActiveOn: [getPathname({ locale, href: "/devs" })]');
    expect(ro.Admin.nav).not.toHaveProperty("devs");
    expect(en.Admin.nav).not.toHaveProperty("devs");
    expect(STAFF_ROLES.filter(offersConfigurationTab)).toEqual(["DEV", "ADMIN", "SUPERADMIN"]);
    expect(ro.Admin.settingsTabs.configuration).toBe("Configurație");
    expect(en.Admin.settingsTabs.configuration).toBe("Configuration");
    const nav = read("src/modules/staff-identity/ui/SettingsSubNav.tsx");
    expect(nav).toContain('offersConfigurationTab(role)');
    expect(nav).toContain('href: getPathname({ locale, href: "/devs" })');
    const devs = read("src/app/[locale]/devs/page.tsx");
    expect(devs).toContain('active="configuration"');
    // One row only (§360, §520): the page's panels are entries of «Setări»'s row, not a second SubNav.
    expect(devs).toContain("configurationPanels={DEVS_PANELS.map(");
    expect(devs).not.toMatch(/<SubNav\b/);
    expect(nav).toContain("configurationPanels && configurationPanels.length > 0");
    // The Neon block always names where its limits are set, whatever the plan's source: a link for
    // a role that opens «Costuri», a sentence for the rest.
    expect(devs).toContain('<Link href={{ pathname: "/admin/settings/costs", hash: "neon-limits" }}>{t("neon.limitsLink")}</Link>');
    expect(devs).toContain('canOpenSettingsTab(actor.role, "costs") ? (');
    expect(ro.Devs.neon.limitsSetBy).toContain("Setări → Costuri");
    expect(en.Devs.neon.limitsSetBy).toContain("Settings → Costs");
  });

  it("gives a higher role every tab a lower one has", () => {
    for (let lower = 0; lower < STAFF_ROLES.length; lower += 1) {
      for (let higher = lower + 1; higher < STAFF_ROLES.length; higher += 1) {
        for (const tab of visibleSettingsTabs(STAFF_ROLES[lower])) {
          expect(canOpenSettingsTab(STAFF_ROLES[higher], tab), `${STAFF_ROLES[higher]} ⊇ ${STAFF_ROLES[lower]}: ${tab}`).toBe(true);
        }
      }
    }
  });
});

describe("§516 the main bar, in the order the club opens things", () => {
  it("is events, registrations, the desk, gallery, pages, newsletter, shop, settings, tasks, team, legal, guide", () => {
    expect([...ADMIN_SECTIONS]).toEqual(["events", "registrations", "checkin", "gallery", "pages", "newsletter", "shop", "settings", "tasks", "staff", "legal", "guide"]);
    expect(ADMIN_SECTIONS).not.toContain("emails");
  });

  it("offers every role the same order with its own gaps, never a reordering", () => {
    for (const role of STAFF_ROLES) {
      const offered = visibleAdminSections(role);
      expect(offered, role).toEqual(ADMIN_SECTIONS.filter((section) => offered.includes(section)));
    }
    expect(visibleAdminSections("CONTRIBUTOR")).toEqual(["checkin", "guide"]);
  });

  it("names every section in both languages, «Setări» / «Settings» included", () => {
    for (const section of ADMIN_SECTIONS) {
      expect(ro.Admin.nav[section as keyof typeof ro.Admin.nav], section).toBeTruthy();
      expect(en.Admin.nav[section as keyof typeof en.Admin.nav], section).toBeTruthy();
    }
    expect(ro.Admin.nav.settings).toBe("Setări");
    expect(en.Admin.nav.settings).toBe("Settings");
    for (const tab of SETTINGS_TABS) {
      expect(ro.Admin.settingsTabs[tab], tab).toBeTruthy();
      expect(en.Admin.settingsTabs[tab], tab).toBeTruthy();
    }
  });

  it("draws the bar's href for «Setări» and a glyph for it", () => {
    expect(read("src/modules/staff-identity/ui/BackofficeShell.tsx")).toContain('settings: getPathname({ locale, href: "/admin/settings" })');
    expect(read("src/modules/staff-identity/ui/AdminTabs.tsx")).toMatch(/settings: TuneIcon,/);
  });
});

describe("§516 every «Setări» tab is a route with the same shape", () => {
  it("is a real route in the table, a page on disk, and the tab row first — no «← Înapoi la …»", () => {
    for (const tab of SETTINGS_TABS) {
      const route = SETTINGS_TAB_ROUTE[tab];
      expect(route in routing.pathnames, route).toBe(true);
      expect(existsSync(path.join(ROOT, pageOf(route))), route).toBe(true);
      const page = read(pageOf(route));
      // The page asks the tab's own gate on the server (BR-REQ-060-01), as a real 404.
      expect(page, tab).toMatch(new RegExp(`canOpenSettingsTab\\((actor|staff)\\.role, "${tab}"\\)\\) notFound\\(\\)`));
      expect(page, tab).toMatch(new RegExp(`<SettingsSubNav locale=\\{locale\\} role=\\{(actor|staff)\\.role\\} active="${tab}" />`));
      // The tabs are the way back: no page draws a back link of its own.
      expect(page, tab).not.toMatch(/←|Înapoi|backTo/);
    }
  });

  it("answers a bare /admin/settings with the reader's first tab, and has no loading boundary to flush a 200", () => {
    expect(read("src/app/[locale]/admin/settings/page.tsx")).toMatch(/redirect\(getPathname\(\{ locale, href: SETTINGS_TAB_ROUTE\[tab\] \}\)\)/);
    expect(read("src/app/[locale]/admin/settings/layout.tsx")).toMatch(/if \(!canOpenSettings\(actor\.role\)\) notFound\(\)/);
    expect(existsSync(path.join(ROOT, "src/app/[locale]/admin/settings/loading.tsx"))).toBe(false);
  });

  it("lands every tab's save back on its own tab", () => {
    const actionsOf = (tab: string) => read(`src/app/[locale]/admin/settings/${tab}/actions.ts`);
    for (const tab of SETTINGS_TABS) {
      const actions = actionsOf(tab);
      // Where a save lands; a sibling tab that shows the same setting is only revalidated, never landed on.
      const targets = [...actions.matchAll(/(?<!revalidatePath\()getPathname\(\{ locale, href: "([^"]+)" \}\)/g)].map((match) => match[1]);
      expect(targets.length, tab).toBeGreaterThan(0);
      for (const target of targets) expect(target, tab).toBe(SETTINGS_TAB_ROUTE[tab]);
      expect(actions, tab).not.toContain("panel=");
    }
  });
});

describe("§516 «Sarcini» → «Club» rows point into the map", () => {
  /** Every `id="…"` a component under src/ carries, the backoffice's anchors. */
  const anchors = (() => {
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".tsx")) for (const match of readFileSync(full, "utf8").matchAll(/\bid="([a-z0-9-]+)"/g)) found.add(match[1]);
      }
    };
    walk(path.join(ROOT, "src"));
    return found;
  })();

  it("links each target to a route that exists, and to a card that carries its `#`", () => {
    const entries = Object.entries(TASK_TARGETS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, target] of entries) {
      const route = targetRoute(target);
      expect(route.pathname in routing.pathnames, id).toBe(true);
      expect(routeExists(route.pathname), `${id}: ${route.pathname}`).toBe(true);
      if (route.hash) expect(anchors.has(route.hash), `${id}: #${route.hash}`).toBe(true);
    }
  });

  it("sends the rows about a setting into «Setări», on the tab that holds it", () => {
    expect(TASK_TARGETS.botCheck).toEqual({ kind: "settings", tab: "platform", hash: "bot-check" });
    expect(TASK_TARGETS.neonLimits).toEqual({ kind: "settings", tab: "costs", hash: "neon-limits" });
    expect(TASK_TARGETS.translation).toEqual({ kind: "settings", tab: "costs", hash: "translation-budget" });
    expect(TASK_TARGETS.declarationArchiveMail).toEqual({ kind: "settings", tab: "emails", hash: "club-notices" });
    for (const route of Object.values(SECTION_TARGET_ROUTE)) expect(route in routing.pathnames, route).toBe(true);
  });

  it("sends «Scrie-ne»'s row to «Pagini» → «Contact», the standard page that holds it (2026-09-28)", () => {
    expect(TASK_TARGETS.contactForm).toEqual({ kind: "pages", entry: "contact", hash: "contact-recipients" });
    expect(targetRoute(TASK_TARGETS.contactForm!)).toEqual({ pathname: "/admin/pages/contact", hash: "contact-recipients" });
    expect(read("src/modules/diagnostics/ui/TaskTargetLink.tsx")).toContain('`${t("nav.pages")} → ${t("pages.tabContact")}`');
  });

  it("draws the link on the row, 44 pixels tall, named by the navigation's own words", () => {
    const page = read("src/app/[locale]/admin/tasks/page.tsx");
    expect(page).toContain('<TaskTargetLink locale={locale} role={actor.role} target={TASK_TARGETS[task.id]} />');
    const link = read("src/modules/diagnostics/ui/TaskTargetLink.tsx");
    expect(link).toContain("minHeight: 44");
    expect(link).toContain('t("nav.settings")');
    expect(link).toContain("t(`settingsTabs.${target.tab}`)");
  });
});

describe("§516 nothing in src/ links to an address that moved", () => {
  /** The code of a file without its comments: a comment may tell the history, a link may not. */
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(full)) files.push(full);
    }
  };
  walk(path.join(ROOT, "src"));

  it("has no href, redirect or route to /admin/emails, /admin/pages/appearance, /admin/settings/contact or a moved «Sarcini» panel", () => {
    const moved = /["'`]\/admin\/(emails|pages\/appearance|settings\/contact)["'`?#/]|panel=(costs|botCheck)\b|panel: "(costs|botCheck)"/;
    const offenders = files
      .filter((file) => !file.endsWith(path.join("i18n", "moved-paths.ts")))
      .filter((file) => moved.test(code(readFileSync(file, "utf8"))))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
