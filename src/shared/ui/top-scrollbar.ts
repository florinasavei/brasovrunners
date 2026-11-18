import { ADMIN_TABLE_SURFACE } from "@/shared/ui/surface";

/**
 * The second scrollbar above a wide backoffice table (§NNN; the owner, 2026-11-18, of the volunteers' list: «vreau sa pot
 * da scroll intr-un tabel si din partea asta de sus, fara sa mai fiu nevoit sa dau scroll pana jos»). The pure half: the
 * frame's address and the bar's look, plain strings and objects, so a Server Component can name the frame and the island
 * (`TopScrollbar`) can find it — no element crosses the boundary (§370). `watchScrollRow`'s `mirror` keeps it in step.
 */

/** The address of a table's frame, from the table's own name (`AdminTable`'s `tableId`, or a screen's one table). */
export function frameIdFor(name: string): string {
  return `table-frame-${name}`;
}

/** The mark on the one sticky part above every backoffice page, the site header (`SiteHeader`): the bar sticks right under it. */
export const STICKY_HEADER_SELECTOR = "[data-sticky-header]";

/**
 * How far from the window's top the bar sticks (§NNN): the sticky header's real height, border included — so no strip of
 * rows shows between the two and the bar never slides under the header — and 0 where there is no sticky header (none
 * found, or not sticky there). Read, not a constant: the header's height follows its logo, its links and the club's
 * look, and `HEADER_CLEARANCE_PX` (76) is a toast's and an anchor's clearance, taller than the header itself.
 */
export function stickyClearancePx(header: { offsetHeight: number } | null, position: string | undefined): number {
  if (!header || (position !== "sticky" && position !== "fixed")) return 0;
  return Math.max(0, Math.round(header.offsetHeight));
}

type Watcher = new (callback: () => void) => { observe(target: never): void; disconnect(): void };

/**
 * Keeps `--top-scrollbar-top` on the bar equal to `stickyClearancePx` (§NNN): written at once — before the bar is first
 * shown — and again whenever the header's size changes (a window narrowed until a link folds, the club's look switched).
 * `position` reads the header's computed position at that moment. The observer is a constructor passed in, so a test can
 * drive it without a browser. Returns the cleanup.
 */
export function placeUnderHeader(
  bar: { style: { setProperty(name: string, value: string): void } },
  header: { offsetHeight: number } | null,
  position: () => string | undefined,
  Resize?: Watcher,
): () => void {
  const place = () => bar.style.setProperty("--top-scrollbar-top", `${stickyClearancePx(header, position())}px`);
  place();
  if (!header || !Resize) return () => undefined;
  const watcher = new Resize(place);
  watcher.observe(header as never);
  return () => watcher.disconnect();
}

/**
 * The bar: nothing until the island says the frame overflows (`data-shown`), so a table that fits, the phone's blocks, a
 * page without JavaScript and the moment before hydration all show none; never on paper. Sticky at the top of the window,
 * right under the sticky site header (`--top-scrollbar-top`, its real height, written by `placeUnderHeader` before the bar
 * is shown), inside the box that holds it and its frame — so it stays while the table is on screen and leaves with it. Opaque in the colour
 * of what the table stands on (`ADMIN_TABLE_SURFACE`), above the pinned verbs (2) and the column edges (1) that pass under it.
 *
 * Its track is drawn, not left to the platform: where scrollbars are overlays that appear only mid-scroll (a Mac, a
 * tablet), an undrawn bar is nothing to grab. Chrome and Safari draw it from `::-webkit-scrollbar` (12 px, a thumb in the
 * muted text's colour on the divider's); Firefox, which has no such selector, from `scrollbar-width` and `scrollbar-color` —
 * set only there, because Chrome ignores the `::-webkit-scrollbar` rules once those are set. MUI's palette variables, both
 * schemes, no literal (§694).
 */
export const TOP_SCROLLBAR_SX = {
  display: "none",
  // From `md` up only: below it a finger swipes the table itself, and `AdminTable` draws blocks there.
  "&[data-shown]": { display: { xs: "none", md: "block" } },
  position: "sticky",
  top: "var(--top-scrollbar-top, 0px)",
  zIndex: 3,
  overflowX: "auto",
  overflowY: "hidden",
  overscrollBehaviorX: "contain",
  backgroundColor: ADMIN_TABLE_SURFACE,
  // The one child: as wide as the frame's scroll reaches (`--top-scrollbar-width`, written by the watcher), one pixel tall.
  "& > span": { display: "block", height: "1px", width: "var(--top-scrollbar-width, 100%)" },
  "&::-webkit-scrollbar": { height: 12 },
  "&::-webkit-scrollbar-track": { backgroundColor: "var(--mui-palette-divider)", borderRadius: "6px" },
  "&::-webkit-scrollbar-thumb": { backgroundColor: "var(--mui-palette-text-secondary)", borderRadius: "6px" },
  "@supports not selector(::-webkit-scrollbar)": {
    scrollbarWidth: "thin",
    scrollbarColor: "var(--mui-palette-text-secondary) var(--mui-palette-divider)",
  },
  "@media print": { "&, &[data-shown]": { display: "none" } },
} as const;
