import { canManageRegistrations, canReadContent, canSeeDiagnostics, type StaffRole } from "./roles";

/**
 * «Setări» / "Settings" — the backoffice's one place for what the club sets (§516; the owner,
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
 *     appearance  canReadContent          the public pages' tint (§488)
 *     costs       canManageRegistrations  the money page and the database card (§479), as «Costuri» was
 *     platform    canManageRegistrations  the anti-robot check (§254, §282): the Superadministrator
 *                                         switches it (§450), the Administrator reads it
 *
 * **And a seventh, «Configurație» (`/devs`), last in the row for `canSeeDiagnostics`.** The owner was
 * on «Configurație» looking for the Neon limits, which are on «Costuri»: two places with no tab
 * between them. It is a tab of the row rather than a seventh route under `/admin/settings`, because
 * `/devs` stays where it is — its own layout and gate (§119, BR-REQ-090-04), its three panels (§265),
 * the address the hosting dashboard's holder is given — and it draws this same row above its panels,
 * with «Configurație» marked, so the way back to «Costuri» is one tap. The main bar has no
 * «Configurație» of its own since §520 — one page, one way in; the Tehnic, whose whole reason to open
 * the backoffice is that page, reaches it through «Setări», and `/devs` draws its own three panels as
 * entries of this row (`SettingsSubNav`'s `configurationPanels`), never as a second row.
 */
/*
 * «Contact» (who reads «Scrie-ne» and the address the site shows, §164, §442) was a tab here from
 * §516 until the owner, 2026-09-28: «când dau click pe pagina de contact mă duce automat la
 * Setări... ar trebui să rămân în același loc». It is a standard page of «Pagini» (§525), the row
 * he pressed it from, at `/admin/pages/contact`, and `/admin/settings/contact` answers 308 there —
 * one page, one way in, as «Configurație» (§520).
 */
export const SETTINGS_TABS = ["emails", "deadlines", "appearance", "costs", "platform"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** The row's last entry: `/devs`, a tab of the row that is not a route of this section. */
export const CONFIGURATION_TAB = "configuration";
export type SettingsRowEntry = SettingsTab | typeof CONFIGURATION_TAB;

/** Whether the row offers «Configurație» — the page's own gate, so the tab never leads to a 404. */
export function offersConfigurationTab(role: StaffRole): boolean {
  return canSeeDiagnostics(role);
}

/** The internal route of each tab — the key `routing.pathnames` knows it by. */
export const SETTINGS_TAB_ROUTE = {
  emails: "/admin/settings/emails",
  deadlines: "/admin/settings/deadlines",
  appearance: "/admin/settings/appearance",
  costs: "/admin/settings/costs",
  platform: "/admin/settings/platform",
} as const satisfies Record<SettingsTab, string>;

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
