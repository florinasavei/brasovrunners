import { canManageRegistrations, canReadContent, type StaffRole } from "./roles";

/**
 * «Setări» / "Settings" — the backoffice's one place for what the club sets (§NNN; the owner,
 * 2026-09-27: «navbar-urile și URL-urile shared între Sarcini și config sunt un pic greșite, ne
 * duce prea dintr-o parte în alta»).
 *
 * Before this, a setting lived wherever it was first built: the Mailgun plan, «Termene», the
 * club's copies and the contact address on `/admin/emails`; the money, the Neon card and its
 * brakes on `/admin/tasks` → «Costuri»; the anti-robot switch on `/admin/tasks` → «Anti-robot»;
 * the site's tint on `/admin/pages` → «Aspect». Each is now one secondary tab (§360) of one route,
 * `/admin/settings/<tab>`, and every old address answers 308 to its new one (`src/i18n/moved-paths.ts`).
 *
 * Who opens each tab is the gate its panels already asked, unchanged — a tab is a place, never a
 * permission; every form on it still asks its own predicate at the page, the action and the service
 * (§450, BR-REQ-060-01):
 *
 *     emails      canReadContent          the messages and their words (the Redactor's, §247), the plan,
 *                                         the roads, the queue, the club's copies — each panel its own gate
 *     deadlines   canReadContent          «Termene» and the per-address limit (§377, §389)
 *     contact     canReadContent          who reads «Scrie-ne» and the address the site shows (§164, §442)
 *     appearance  canReadContent          the public pages' tint (§488)
 *     costs       canManageRegistrations  the money page and the database card (§479), as «Costuri» was
 *     platform    canManageRegistrations  the anti-robot check (§254, §282): the Superadministrator
 *                                         switches it (§450), the Administrator reads it
 */
export const SETTINGS_TABS = ["emails", "deadlines", "contact", "appearance", "costs", "platform"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** The internal route of each tab — the key `routing.pathnames` knows it by. */
export const SETTINGS_TAB_ROUTE = {
  emails: "/admin/settings/emails",
  deadlines: "/admin/settings/deadlines",
  contact: "/admin/settings/contact",
  appearance: "/admin/settings/appearance",
  costs: "/admin/settings/costs",
  platform: "/admin/settings/platform",
} as const satisfies Record<SettingsTab, string>;

export function isSettingsTab(value: string | undefined): value is SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(value ?? "");
}

/** Whether `role` may open one tab. */
export function canOpenSettingsTab(role: StaffRole, tab: SettingsTab): boolean {
  switch (tab) {
    case "costs":
    case "platform":
      return canManageRegistrations(role);
    default:
      return canReadContent(role);
  }
}

/** The tabs a role is offered, in the row's order. */
export function visibleSettingsTabs(role: StaffRole): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => canOpenSettingsTab(role, tab));
}

/**
 * Where a bare `/admin/settings` lands: the role's first tab, or `null` for a role with none.
 *
 * «Setări»'s own gate is `canOpenSettings` in `roles.ts` (the union of the gates above, written
 * there as a threshold so the section list can ask it without a cycle); a unit test holds it equal
 * to "this role has a tab".
 */
export function defaultSettingsTab(role: StaffRole): SettingsTab | null {
  return visibleSettingsTabs(role)[0] ?? null;
}
