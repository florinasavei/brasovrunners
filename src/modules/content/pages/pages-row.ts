import { routing } from "@/i18n/routing";

/**
 * «Pagini»'s row of secondary tabs (§360, §459, §524, §525), all under `/admin/pages`, so the main
 * bar lights «Pagini» on each. «Contact» moved here from «Setări» (the old address answers 308,
 * `src/i18n/moved-paths.ts`); a unit test holds each page's `active` to `pagesRowEntryOf`.
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
 * The row entry an address belongs to: a standard page by its segment; the list, `new` and `[id]`
 * as «Pagini personalizate»; `null` outside `/admin/pages`. The locale segment is ignored (§9.2).
 */
export function pagesRowEntryOf(pathname: string): PagesRowEntry | null {
  const segments = pathname.split("/").filter(Boolean);
  const rest = segments.length > 0 && (routing.locales as readonly string[]).includes(segments[0]) ? segments.slice(1) : segments;
  if (rest[0] !== "admin" || rest[1] !== "pages") return null;
  const entry = rest[2];
  if (entry === undefined) return "pages";
  return (PAGES_ROW_ENTRIES as readonly string[]).includes(entry) && entry !== "pages" ? (entry as PagesRowEntry) : "pages";
}
