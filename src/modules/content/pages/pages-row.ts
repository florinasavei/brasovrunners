import { routing } from "@/i18n/routing";

/**
 * «Pagini»'s row of secondary tabs (§360, §459, §524, §525), as data: every entry and the address
 * it opens, all of them under `/admin/pages` (the owner, 2026-09-28: «când dau click pe pagina de
 * contact mă duce automat la Setări... ar trebui să rămân în același loc»).
 *
 * «Contact» was the one entry that left the section — it opened «Setări» → «Contact» (§516), so the
 * main bar lit «Setări» and the «Pagini» row was gone under the reader's thumb. It lives at
 * `/admin/pages/contact` now, the same two cards, and the old address answers 308 here
 * (`src/i18n/moved-paths.ts`). The main bar lights «Pagini» on every one of these addresses because
 * each is under `/admin/pages` (`activeAdminTabHref`), and the row marks the entry the address names
 * (`pagesRowEntryOf`) — a unit test holds each page's `active` to it.
 */
export const PAGES_ROW_ENTRIES = ["contact", "team", "faq", "members", "pages"] as const;
export type PagesRowEntry = (typeof PAGES_ROW_ENTRIES)[number];

/** The internal route of each entry — the key `routing.pathnames` knows it by. */
export const PAGES_ROW_ROUTE = {
  contact: "/admin/pages/contact",
  team: "/admin/pages/team",
  faq: "/admin/pages/faq",
  members: "/admin/pages/members",
  pages: "/admin/pages",
} as const satisfies Record<PagesRowEntry, string>;

/**
 * Which entry of the row an address belongs to: a standard page by its own segment, and the club's
 * own pages — the list, `new` and one page's editor (`[id]`) — as «Pagini personalizate». `null`
 * for an address outside `/admin/pages`. The locale segment, when there is one, is ignored: the
 * `/admin` part of a path is the same in both locales (§9.2).
 */
export function pagesRowEntryOf(pathname: string): PagesRowEntry | null {
  const segments = pathname.split("/").filter(Boolean);
  const rest = segments.length > 0 && (routing.locales as readonly string[]).includes(segments[0]) ? segments.slice(1) : segments;
  if (rest[0] !== "admin" || rest[1] !== "pages") return null;
  const entry = rest[2];
  if (entry === undefined) return "pages";
  return (PAGES_ROW_ENTRIES as readonly string[]).includes(entry) && entry !== "pages" ? (entry as PagesRowEntry) : "pages";
}
