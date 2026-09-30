/**
 * The site menu's one order (§571, amending §406's list and the header's fixed sections).
 *
 * The owner, 2026-09-29, on «Pagini» → «Paginile clubului»: «vreau să pot seta ordinea la orice
 * pagină, inclusiv cea de evenimente, calendar, contact». Every entry the menu can carry has a
 * stable key — the platform's sections by name, a custom page as `page:<id>` — and the club's
 * order is one list of those keys, stored as one `platform_settings` value (no migration: the
 * table takes any key, §100).
 *
 * **The merge rule.** The stored list rules. An entry it does not name — a fresh site with no list
 * yet, a page written after the last save, a section a later release adds — falls to the end, in
 * today's default order: the platform's sections first as `MENU_SECTION_KEYS` lists them, then the
 * custom pages in the order the old «Ordinea» column gave them. A key the list names that no longer
 * exists (a deleted page) is dropped. So nothing needs setting up, and a new page appears last.
 *
 * Pure, and imported by the header's client navigation: no database, no server import here.
 */

/**
 * The platform's own sections, in today's default order (§251, the header's «Evenimente · Calendar · Contact …»).
 * «Membri» left the list with §591: the members' zone is a link in the footer's fold, not an entry of the
 * menu, so a stored order that still names `members` simply loses that key (the merge rule's deleted page).
 */
export const MENU_SECTION_KEYS = ["events", "calendar", "contact", "gallery", "team", "faq"] as const;
export type MenuSectionKey = (typeof MENU_SECTION_KEYS)[number];

/** A custom page's key: its id, never its address, which differs per language and may change. */
export type MenuPageKey = `page:${string}`;
export type MenuKey = MenuSectionKey | MenuPageKey;

const PAGE_PREFIX = "page:";

export function pageMenuKey(pageId: string): MenuPageKey {
  return `${PAGE_PREFIX}${pageId}`;
}

/** The page id inside a `page:<id>` key, or null for a section's key or anything else. */
export function pageIdOfMenuKey(key: string): string | null {
  return key.startsWith(PAGE_PREFIX) && key.length > PAGE_PREFIX.length ? key.slice(PAGE_PREFIX.length) : null;
}

export function isMenuSectionKey(key: string): key is MenuSectionKey {
  return (MENU_SECTION_KEYS as readonly string[]).includes(key);
}

/**
 * What the settings row holds, read defensively: a list of strings, duplicates dropped, or the
 * empty list for anything else (no row, a value an older or newer release wrote in another shape).
 */
export function parseStoredMenuOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.length > 0 && item.length <= 100) seen.add(item);
  }
  return [...seen];
}

/**
 * `items` in the club's order: those the stored list names by their place in it, then every other
 * one in the order it came in (a stable sort). The one merge rule, for the header, the footer and
 * the backoffice card alike — so what the card shows is what the site draws.
 */
export function sortByMenuOrder<T>(items: readonly T[], keyOf: (item: T) => string, stored: readonly string[]): T[] {
  const place = new Map(stored.map((key, index) => [key, index] as const));
  return items
    .map((item, index) => ({ item, index, rank: place.get(keyOf(item)) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
      if (a.rank !== undefined) return -1;
      if (b.rank !== undefined) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/**
 * Every key the menu can carry today, in the club's order: the sections, then the given custom
 * pages (in the old column's order, which is the fallback), sorted by the stored list. Keys the
 * list names that are not among them are gone.
 */
export function resolveMenuOrder(stored: readonly string[], pageIdsInFallbackOrder: readonly string[]): MenuKey[] {
  const everything: MenuKey[] = [...MENU_SECTION_KEYS, ...pageIdsInFallbackOrder.map(pageMenuKey)];
  return sortByMenuOrder(everything, (key) => key, stored);
}

/**
 * One entry one place up or down. At an end, or for a key that is not in the list, the list comes
 * back unchanged — a second press on «Sus» at the top does nothing rather than fail.
 */
export function moveMenuEntry<K extends string>(order: readonly K[], key: string, direction: "up" | "down"): K[] {
  const index = order.indexOf(key as K);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= order.length) return [...order];
  const moved = [...order];
  [moved[index], moved[target]] = [moved[target], moved[index]];
  return moved;
}
