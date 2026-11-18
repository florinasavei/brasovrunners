import { HEADER_CLEARANCE_PX } from "@/theme/brand";
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

/**
 * The bar: nothing until the island says the frame overflows (`data-shown`), so a table that fits, the phone's blocks, a
 * page without JavaScript and the moment before hydration all show none; never on paper. Sticky at the top of the window,
 * just under the sticky site header (`HEADER_CLEARANCE_PX`, the pair every sticky thing in the backoffice clears), inside
 * the box that holds it and its frame — so it stays while the table is on screen and leaves with it. Opaque in the colour
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
  top: HEADER_CLEARANCE_PX.sm,
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
