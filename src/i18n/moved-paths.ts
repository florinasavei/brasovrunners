import { routing } from "@/i18n/routing";

/**
 * Backoffice addresses that moved, and where each one lives now (§NNN).
 *
 * «Setări» gathered the club's settings from three sections: the email page, two panels of
 * «Sarcini» and one tab of «Pagini». A bookmark, a link in an old email to staff, a tab left open
 * or a line in `SETUP.md` still names the old address, so each one answers a **308** — permanent,
 * and a POST stays a POST — to its new one, with the query kept (a `?saved=` or `?lang=` still
 * means what it meant). A fragment is the browser's: it rides along on its own, so an old
 * `#email-plan` still opens its card.
 *
 * Pure and table-driven, so the proxy asks one function and a unit test walks every row. The
 * `/admin` part of a path is the same in both locales (§9.2), so the table is written once; the
 * locale segment is kept as it came, and an unprefixed path stays unprefixed for next-intl to
 * negotiate on the next hop, as `aliases.ts` does for `/login`.
 */

/** A moved path: the old address's path after the locale, and — for a panel — its `?panel=`. */
type MovedPath = { from: string; panel?: string; to: string };

export const MOVED_BACKOFFICE_PATHS: readonly MovedPath[] = [
  { from: "/admin/emails", to: "/admin/settings/emails" },
  { from: "/admin/pages/appearance", to: "/admin/settings/appearance" },
  { from: "/admin/tasks", panel: "costs", to: "/admin/settings/costs" },
  { from: "/admin/tasks", panel: "botCheck", to: "/admin/settings/platform" },
];

/**
 * Where a request for a moved backoffice address goes — the path and its query, both as the
 * browser should ask for them — or `null` when the address did not move.
 */
export function resolveMovedBackofficePath(pathname: string, search: string): { pathname: string; search: string } | null {
  const segments = pathname.split("/").filter(Boolean);
  const hasLocale = segments.length > 0 && (routing.locales as readonly string[]).includes(segments[0]);
  const prefix = hasLocale ? `/${segments[0]}` : "";
  const rest = `/${(hasLocale ? segments.slice(1) : segments).join("/")}`;

  const query = new URLSearchParams(search);
  const panel = query.get("panel") ?? undefined;
  const moved = MOVED_BACKOFFICE_PATHS.find((entry) => entry.from === rest && (entry.panel === undefined || entry.panel === panel));
  if (!moved) return null;

  // The panel is the old address's way of naming the place; the new address is the place.
  if (moved.panel !== undefined) query.delete("panel");
  const kept = query.toString();
  return { pathname: `${prefix}${moved.to}`, search: kept ? `?${kept}` : "" };
}
