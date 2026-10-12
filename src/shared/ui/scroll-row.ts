/**
 * One style for every row of chips that scrolls sideways (§720 amended): the scrollbar is
 * thin and visible, never hidden, so a person sees there is more than the screen shows (the
 * owner, 2026-10-12: «I need to show a scrollbars here so user knows there are multiple options
 * here»), and `ScrollRow` adds an edge fade while the row can scroll further that way.
 *
 * Plain strings only, so it crosses from a Server Component into `ScrollRow` (§370). The colours
 * are MUI's own palette variables (`text.secondary` and `divider`, light and dark alike); no
 * literal lives here (§694). Spread it, then add the row's own layout (`display`, `gap`, snap).
 * `SubNav` adopts it later (a sibling change edits that file now).
 */
const FADE_PX = 28;

export const SCROLL_ROW_SX = {
  overflowX: "auto",
  overscrollBehaviorX: "contain",
  // Firefox and current Chrome: a thin bar, the thumb in the muted text colour on the divider's.
  scrollbarWidth: "thin",
  scrollbarColor: "var(--mui-palette-text-secondary) var(--mui-palette-divider)",
  // A little room under the chips, so the bar does not touch them.
  pb: 0.5,
  // Safari and older Chrome draw the same bar from these.
  "&::-webkit-scrollbar": { height: 6 },
  "&::-webkit-scrollbar-track": { backgroundColor: "var(--mui-palette-divider)", borderRadius: "3px" },
  "&::-webkit-scrollbar-thumb": { backgroundColor: "var(--mui-palette-text-secondary)", borderRadius: "3px" },
  // The edge cue: `ScrollRow` sets these from the scroller's position; nothing fades when all fits.
  "&[data-more-end]": { maskImage: `linear-gradient(to right, currentColor calc(100% - ${FADE_PX}px), transparent)` },
  "&[data-more-start]": { maskImage: `linear-gradient(to right, transparent, currentColor ${FADE_PX}px)` },
  "&[data-more-start][data-more-end]": {
    maskImage: `linear-gradient(to right, transparent, currentColor ${FADE_PX}px, currentColor calc(100% - ${FADE_PX}px), transparent)`,
  },
} as const;
