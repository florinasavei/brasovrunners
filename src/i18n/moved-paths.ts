import { routing } from "@/i18n/routing";

/**
 * Backoffice addresses that moved, and where each one lives now (§516).
 *
 * «Setări» gathered the club's settings from three sections: the email page, two panels of
 * «Sarcini» and one tab of «Pagini». A bookmark, a link in an old email to staff, a tab left open
 * or a line in `SETUP.md` still names the old address, so each one answers a **308** — permanent,
 * and a POST stays a POST — to its new one, with the query kept (a `?saved=` or `?lang=` still
 * means what it meant). A fragment is the browser's: it rides along on its own, so an old
 * `#email-plan` still opens its card — when the card is still on that page. The three that left
 * the email page for a tab of their own are `MOVED_FRAGMENTS` below.
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
  // «Contact» left «Setări» for «Pagini», the row it is pressed from (the owner, 2026-09-28: «ar
  // trebui să rămân în același loc»): the same two cards, at the standard pages' own address.
  { from: "/admin/settings/contact", to: "/admin/pages/contact" },
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

/**
 * Cards that left a page for another tab of «Setări» (§520), by the `id` their fold carries: the
 * old `/admin/emails#contact-recipients` is 308'd to `/admin/settings/emails#contact-recipients`,
 * where no such card is any more — the server never sees a fragment, so it cannot send the reader on.
 * `MovedFragmentHop` on that page reads this table in the browser and replaces the address with the
 * card's new tab, the fragment kept, so the card opens there (`OpenFoldFromHash`, §336).
 */
type MovedFragment = { page: string; hash: string; to: string };

export const MOVED_FRAGMENTS: readonly MovedFragment[] = [
  { page: "/admin/settings/emails", hash: "contact-recipients", to: "/admin/pages/contact" },
  { page: "/admin/settings/emails", hash: "shown-contact-address", to: "/admin/pages/contact" },
  { page: "/admin/settings/emails", hash: "deadlines", to: "/admin/settings/deadlines" },
];

/**
 * Where the browser should go for a `#fragment` naming a card that now lives on another tab — the
 * path with its locale segment kept and the fragment — or `null` when the card is on this page (or
 * the fragment names nothing that moved).
 */
export function resolveMovedFragment(pathname: string, hash: string): string | null {
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  if (!id) return null;
  const segments = pathname.split("/").filter(Boolean);
  const hasLocale = segments.length > 0 && (routing.locales as readonly string[]).includes(segments[0]);
  const prefix = hasLocale ? `/${segments[0]}` : "";
  const rest = `/${(hasLocale ? segments.slice(1) : segments).join("/")}`;
  const moved = MOVED_FRAGMENTS.find((entry) => entry.page === rest && entry.hash === id);
  return moved ? `${prefix}${moved.to}#${moved.hash}` : null;
}
