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
  // While `ScrollRow` draws its own bar (below), the browser's is not drawn too, nor its room kept.
  "&[data-drawn-bar]": { scrollbarWidth: "none", pb: 0, "&::-webkit-scrollbar": { display: "none" } },
} as const;

/**
 * The bar `ScrollRow` draws under the row (the owner, 2026-10-12, on a phone: «trebuie să văd
 * scrollbar»): a phone's browser shows its own scrollbar only while a finger scrolls, so the row's
 * one cue was invisible exactly where the chips overflow. A track in the divider's colour, a thumb
 * in the muted text's, the thumb's width the share of the row on screen and its place the scroll's
 * (`--scroll-thumb-size`, `--scroll-thumb-pos`, written by `watchScrollRow`). Drawn only while the
 * row overflows (`data-shown`); decoration, since the row itself is what a finger scrolls.
 */
export const SCROLL_BAR_SX = {
  display: "none",
  position: "relative",
  height: 4,
  // Up into the room the 44-pixel links leave under their small pills: nearer the chips, and no taller a row.
  mt: "-6px",
  borderRadius: "2px",
  bgcolor: "divider",
  overflow: "hidden",
  "&[data-shown]": { display: "block" },
  "& > span": {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "var(--scroll-thumb-pos, 0%)",
    width: "var(--scroll-thumb-size, 100%)",
    borderRadius: "2px",
    bgcolor: "text.secondary",
  },
} as const;

/** The drawn bar, as `watchScrollRow` writes it; a real element satisfies it, and so does a fake in a test. */
export type ScrollBarElement = {
  toggleAttribute(name: string, force?: boolean): boolean;
  style: { setProperty(name: string, value: string): void };
};

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
 * A second scrollbar kept in step with the scroller (§NNN; `TopScrollbar` draws it above a wide backoffice table): a box
 * that scrolls sideways itself, its one child as wide as `--top-scrollbar-width` says. A real element satisfies it, and so
 * does a fake in a test.
 */
export type ScrollMirrorElement = {
  scrollLeft: number;
  clientWidth: number;
  toggleAttribute(name: string, force?: boolean): boolean;
  style: { setProperty(name: string, value: string): void };
  addEventListener(type: "scroll", listener: () => void, options?: { passive: boolean }): void;
  removeEventListener(type: "scroll", listener: () => void): void;
};

/** Whether a scroller has anything past its edge (§NNN): more than a pixel, so a rounding never shows a bar. */
export function overflowsSideways(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth > clientWidth + 1;
}

/**
 * How wide the mirror's child is (§NNN): its own width plus the scroller's room, so the two scroll exactly as far and one
 * `scrollLeft` means the same place in both — the bar need not be as wide as the frame (its border, a vertical bar).
 */
export function mirrorContentWidth(mirrorClientWidth: number, scrollWidth: number, clientWidth: number): number {
  return mirrorClientWidth + Math.max(0, scrollWidth - clientWidth);
}

/** The position one side was last given by the other, until that side's own «scroll» — the echo of the write — takes it. */
export type GivenPosition = { value?: number };

/**
 * One step of keeping two scrollers in step (§NNN): `to` takes `from`'s position only when they differ by a pixel or more,
 * so a zoomed page's fractional positions never start a write. With `given`, it remembers the position `to` now holds,
 * so `isEcho` knows `to`'s next «scroll» for the answer to this write rather than a hand's move. Returns whether it wrote.
 */
export function keepInStep(from: { scrollLeft: number }, to: { scrollLeft: number }, given?: GivenPosition): boolean {
  if (Math.abs(from.scrollLeft - to.scrollLeft) < 1) return false;
  const before = to.scrollLeft;
  if (given) given.value = from.scrollLeft;
  to.scrollLeft = from.scrollLeft;
  // A «scroll» said at once (a test's fake) already took it; a box that could not move says nothing, so nothing is awaited.
  // Otherwise what the box holds now, clamped as it may be, is what its «scroll» will say.
  if (given && given.value !== undefined) given.value = to.scrollLeft === before ? undefined : to.scrollLeft;
  return true;
}

/**
 * Whether a «scroll» of `box` is the echo of the write `given` remembers (§NNN), not a hand's: the browser says «scroll» a
 * frame after the write, when the other side's hand may already have moved on, and answering it would write the other side
 * back to where it was — the thumb flickering back mid-drag, a running smooth scroll cut. The memory is taken either way:
 * one write, one echo.
 */
export function isEcho(box: { scrollLeft: number }, given: GivenPosition): boolean {
  const echo = given.value !== undefined && Math.abs(box.scrollLeft - given.value) < 1;
  given.value = undefined;
  return echo;
}

/**
 * Keeps `data-more-start` / `data-more-end` true to the scroller (§720 amended): recomputed on
 * scroll, on a size change of the row or of any child, and, through a `MutationObserver` on the
 * child list, whenever a child is added or removed (a soft navigation to a month with other
 * surface chips keeps the instance, so the row's scroll position survives and the cue must follow).
 * With `bar`, it also shows and moves the drawn scrollbar (`SCROLL_BAR_SX`) and hides the
 * browser's own while the drawn one is up. With `mirror` (§NNN), it shows a second scrollbar while the
 * scroller overflows, as far-reaching as the scroller, and keeps the two in step both ways (`keepInStep`), the «scroll»
 * that echoes its own write answering nothing (`isEcho`), so neither side is ever written back by a late echo:
 * the same scroll, resize and mutation that move the edge cue move the mirror, so a frame has one watcher.
 * The observers are constructors passed in, so a test can drive it without a browser. Returns the cleanup.
 */
export function watchScrollRow(
  el: ScrollRowElement,
  Resize?: Watcher,
  Mutation?: Watcher,
  bar?: ScrollBarElement,
  mirror?: ScrollMirrorElement,
): () => void {
  // What each side was last given by the other (§NNN): its next «scroll» is that write's echo, and answers nothing.
  const givenFrame: GivenPosition = {};
  const givenMirror: GivenPosition = {};
  // `follow` false: this is the echo of the mirror's write, so the frame is where the mirror put it — or behind a hand
  // that has moved the mirror on since, which the mirror's own «scroll» brings over.
  const update = (follow = true) => {
    const left = Math.abs(el.scrollLeft);
    const room = el.scrollWidth - el.clientWidth;
    el.toggleAttribute("data-more-start", left > 1);
    el.toggleAttribute("data-more-end", room - left > 1);
    if (mirror) {
      // Shown first, so its own width can be read; then its child sized, then its place, in that order (a place past a
      // narrower child would be clamped).
      const shown = overflowsSideways(el.scrollWidth, el.clientWidth);
      mirror.toggleAttribute("data-shown", shown);
      if (shown) {
        mirror.style.setProperty("--top-scrollbar-width", `${mirrorContentWidth(mirror.clientWidth, el.scrollWidth, el.clientWidth)}px`);
        if (follow) keepInStep(el, mirror, givenMirror);
      }
    }
    if (!bar) return;
    // The drawn bar: shown while the row overflows, its thumb the share on screen at the scroll's place.
    const overflows = room > 1;
    el.toggleAttribute("data-drawn-bar", overflows);
    bar.toggleAttribute("data-shown", overflows);
    if (!overflows) return;
    const size = el.clientWidth / el.scrollWidth;
    const pos = Math.min(1, left / room) * (1 - size);
    bar.style.setProperty("--scroll-thumb-size", `${(size * 100).toFixed(2)}%`);
    bar.style.setProperty("--scroll-thumb-pos", `${(pos * 100).toFixed(2)}%`);
  };
  const resize = Resize ? new Resize(() => update()) : null;
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
  // The scroller's «scroll»: the edge cue always; the mirror only when a hand moved the scroller, not the echo of `follow`'s write.
  const onScroll = () => update(!isEcho(el, givenFrame));
  // The mirror moved by a hand: the scroller follows. The mirror's «scroll» that answers `update`'s write answers nothing.
  const follow = () => {
    if (mirror && !isEcho(mirror, givenMirror)) keepInStep(mirror, el, givenFrame);
  };
  update();
  el.addEventListener("scroll", onScroll, { passive: true });
  mirror?.addEventListener("scroll", follow, { passive: true });
  observeChildren();
  mutation?.observe(el as never, { childList: true } as never);
  return () => {
    el.removeEventListener("scroll", onScroll);
    mirror?.removeEventListener("scroll", follow);
    resize?.disconnect();
    mutation?.disconnect();
  };
}
