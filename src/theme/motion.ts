/**
 * Motion: durations, curve and guards. Every animation is CSS in `sx`, no client island for
 * decoration (`AGENTS.md` §1.5, §18.3).
 *
 * `MOTION_OK` is opt-in (`AGENTS.md` §18.2): the static state is the default, so a failed rule
 * never leaves content at a keyframe's `opacity: 0`. `HOVER_OK` keeps hover to devices that
 * hover, since `:hover` sticks after a tap. Keyframes are emitted once in `theme.ts`.
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

/** A card, chip or row that lifts under the pointer; transform and shadow only, no layout. */
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
 * Content that arrives — the listing's cards, the hero. `index` staggers a list in reading order,
 * capped at five so a long list's last card is not delayed by seconds.
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
 * Content streamed in behind a `<Suspense>` skeleton (§166): shorter than `fadeIn`, opacity only,
 * since the skeleton already held the box.
 */
export const fadeInSoft = {
  [MOTION_OK]: { animation: `${KEYFRAMES.fade} ${DURATION.base}ms ${EASE} both` },
} as const;

/**
 * The loading figure, a runner bobbing on the spot: the site's only repeating animation. 900ms
 * reads as a stride; its element always carries an accessible "loading" name.
 */
export const runInPlace = {
  [MOTION_OK]: { animation: `${KEYFRAMES.run} 900ms ${EASE} infinite` },
} as const;

/** Stops MUI's `Skeleton animation="wave"` shimmer (its own `::after`) under reduced motion. */
export const shimmerOffForReducedMotion = {
  "@media (prefers-reduced-motion: reduce)": { "&::after": { animation: "none" } },
} as const;
