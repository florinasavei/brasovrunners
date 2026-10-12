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

/** What `watchScrollRow` needs from a scroller; a real element satisfies it, and so does a fake in a test. */
export type ScrollRowElement = {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  children: ArrayLike<unknown>;
  toggleAttribute(name: string, force?: boolean): boolean;
  addEventListener(type: "scroll", listener: () => void, options?: { passive: boolean }): void;
  removeEventListener(type: "scroll", listener: () => void): void;
};

type Watcher = new (callback: () => void) => { observe(target: never, options?: never): void; disconnect(): void };

/**
 * Keeps `data-more-start` / `data-more-end` true to the scroller (§720 amended): recomputed on
 * scroll, on a size change of the row or of any child, and, through a `MutationObserver` on the
 * child list, whenever a child is added or removed (a soft navigation to a month with other
 * surface chips keeps the instance, so the row's scroll position survives and the cue must follow).
 * The observers are constructors passed in, so a test can drive it without a browser. Returns the cleanup.
 */
export function watchScrollRow(el: ScrollRowElement, Resize?: Watcher, Mutation?: Watcher): () => void {
  const update = () => {
    const left = Math.abs(el.scrollLeft);
    el.toggleAttribute("data-more-start", left > 1);
    el.toggleAttribute("data-more-end", el.scrollWidth - el.clientWidth - left > 1);
  };
  const resize = Resize ? new Resize(update) : null;
  const observeChildren = () => {
    resize?.disconnect();
    resize?.observe(el as never);
    for (const child of Array.from(el.children)) resize?.observe(child as never);
  };
  const mutation = Mutation
    ? new Mutation(() => {
        observeChildren();
        update();
      })
    : null;
  update();
  el.addEventListener("scroll", update, { passive: true });
  observeChildren();
  mutation?.observe(el as never, { childList: true } as never);
  return () => {
    el.removeEventListener("scroll", update);
    resize?.disconnect();
    mutation?.disconnect();
  };
}
