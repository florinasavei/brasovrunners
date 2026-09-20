/**
 * Motion, in one place: how long, what curve, and the switch that turns all of it off.
 *
 * Every animation on the site is **CSS**, written into `sx` on Server Components and emitted
 * with the page — no `Fade`, no `Grow`, no client island earns its place for decoration
 * (`AGENTS.md` §1.5, §18.3). The one JS transition is the nav menu's, and MUI owns that.
 *
 * `MOTION_OK` is the guard, and it is opt-*in*: a rule under it animates only for a reader who
 * has not asked their system for less motion (`AGENTS.md` §18.2). Written as the positive media
 * query rather than a `reduce` override so the static state is the default — a browser that
 * evaluates neither shows the page still, and a keyframe with `opacity: 0` at the start can
 * never leave content invisible because a later rule failed to apply.
 *
 * `HOVER_OK` keeps hover effects to devices that hover. On a phone `:hover` sticks after a tap,
 * so a card that lifts on hover would stay lifted after the visitor came back to the list.
 *
 * Keyframe names are declared once, globally, in `theme.ts` (`MuiCssBaseline`), and referenced
 * by name here — one emission per page rather than one per element that uses them.
 */

/** Milliseconds. Short, because nothing here is the point of the page. */
export const DURATION = { fast: 150, base: 250, slow: 400 } as const;

/** Material's standard curve: quick out of the gate, soft landing. */
export const EASE = "cubic-bezier(0.2, 0, 0, 1)";

export const MOTION_OK = "@media (prefers-reduced-motion: no-preference)";
export const HOVER_OK = "@media (hover: hover)";

/** Names of the global `@keyframes` in `theme.ts`. */
export const KEYFRAMES = {
  /** Opacity 0 → 1. */
  fade: "br-fade",
  /** Opacity 0 → 1 while rising 8px into place. */
  rise: "br-rise",
  /** Shadow 0 → the header's scrolled shadow, driven by the scroll position. */
  headerShadow: "br-header-shadow",
  /** The loader's figure: a runner's bob and lean, on the spot (§166). */
  run: "br-run",
} as const;

/**
 * A card, chip or row that lifts under the pointer.
 *
 * Transform and shadow only — both compositor properties, so the lift costs no layout on a
 * list of forty cards. The transition is unconditional (a transition has no effect when nothing
 * changes) and the hover state is behind `HOVER_OK`.
 */
export const liftOnHover = {
  transition: `transform ${DURATION.fast}ms ${EASE}, box-shadow ${DURATION.fast}ms ${EASE}`,
  [HOVER_OK]: {
    "&:hover": { transform: "translateY(-2px)", boxShadow: 3 },
  },
  "@media (prefers-reduced-motion: reduce)": {
    transition: "none",
    [HOVER_OK]: { "&:hover": { transform: "none" } },
  },
} as const;

/**
 * Content that arrives — the listing's cards, the hero.
 *
 * `both` fills so the element sits at its end state after the animation and at its start state
 * during any delay; `index` staggers a list so the cards arrive in reading order. Capped at
 * five: past the first screen nobody is watching, and a delay that grows with the list would
 * make the fortieth card appear two seconds after the page.
 */
export function riseIn(index = 0) {
  return {
    [MOTION_OK]: {
      animation: `${KEYFRAMES.rise} ${DURATION.slow}ms ${EASE} both`,
      animationDelay: `${Math.min(index, 5) * 50}ms`,
    },
  } as const;
}

export const fadeIn = {
  [MOTION_OK]: { animation: `${KEYFRAMES.fade} ${DURATION.slow}ms ${EASE} both` },
} as const;

/**
 * Content that has just streamed in, behind a `<Suspense>` boundary (`DECISIONS.md` §166).
 *
 * Shorter than `fadeIn`: the reader has already been looking at a skeleton of the same shape
 * in the same box, so this is the swap settling rather than an arrival, and 400ms there reads
 * as the page still loading. Opacity only — the box was already the right size, and moving it
 * would undo the whole point of the skeleton.
 */
export const fadeInSoft = {
  [MOTION_OK]: { animation: `${KEYFRAMES.fade} ${DURATION.base}ms ${EASE} both` },
} as const;

/**
 * The loading figure: a small runner that bobs and leans on the spot.
 *
 * The one animation on the site that repeats, and the only reason it is allowed to: it says
 * "still working" for as long as that is true, and stops existing the moment it is not. The
 * cycle is deliberately longer than the 150–400ms the rest of the site uses — a 250ms loop is
 * a twitch, not a stride — and it moves nothing but `transform`, so a skeleton carrying one
 * costs no layout.
 *
 * Under `MOTION_OK` like everything else, so a reader who asked for less motion gets the
 * figure standing still. It is never the only signal: the element carrying it always has an
 * accessible name saying the page is loading.
 */
export const runInPlace = {
  [MOTION_OK]: { animation: `${KEYFRAMES.run} 900ms ${EASE} infinite` },
} as const;

/**
 * MUI's `Skeleton animation="wave"` is the shimmer, and this is the switch that turns it off.
 *
 * The wave is drawn by the component's own `::after` pseudo-element, which is emitted by MUI
 * and therefore not written behind `MOTION_OK` the way this file's own rules are. Rather than
 * re-implement the shimmer to get the guard the right way round, the guard is added: a reader
 * who asked for less motion gets the same grey shapes, still.
 */
export const shimmerOffForReducedMotion = {
  "@media (prefers-reduced-motion: reduce)": { "&::after": { animation: "none" } },
} as const;
