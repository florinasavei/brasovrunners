import { SURFACE_GRADIENT } from "./brand";
import { HOVER_OK } from "./motion";

/**
 * The site's gradients, as `sx` fragments a Server Component can spread (`DECISIONS.md` §166).
 *
 * `motion.ts` is how long and what curve; this is what colour, and the two are separate for
 * the same reason: a component should be able to say "the featured surface" without naming a
 * colour, because `theme/brand.ts` is the only file in `src/` allowed to (`AGENTS.md` §3.2).
 * Everything here is a **plain object**, never a function of the theme — `theme.applyStyles`
 * would be the MUI way to write the dark variant and a function cannot cross from a Server
 * Component into a MUI client component (`AGENTS.md` §14.1). The dark scheme is selected by
 * the valueless `data-dark` attribute MUI puts on `<html>` instead, which is an ordinary CSS
 * selector and costs nothing at runtime.
 *
 * Three of them, and that is the budget. A gradient is an accent: past three the page stops
 * having a lead surface and becomes a paint chart.
 */

/**
 * A surface that carries text and wants to be the one the eye lands on: the featured event.
 *
 * Both ends of both ramps are asserted against body text and muted text in
 * `tests/unit/theme/brand.test.ts`, which is what keeps "shiny" from quietly costing a reader
 * the countdown.
 *
 * `backgroundImage` and never the `background` shorthand (§167). The shorthand resets
 * `background-color` to transparent, so spreading this over a `bgcolor` would silently erase
 * the flat colour the caller asked to keep underneath rather than leave it as the fallback —
 * which is exactly what `FeaturedEventHero`'s comment claimed it was doing.
 */
export const heroSurface = {
  backgroundImage: SURFACE_GRADIENT.hero,
  "[data-dark] &": { backgroundImage: SURFACE_GRADIENT.heroDark },
} as const;

/**
 * The primary action, under a pointer that can hover.
 *
 * `backgroundImage` rather than `backgroundColor`, so MUI's own contained-button colour stays
 * underneath as the resting state and as the fallback: nothing here can leave a button with no
 * background. Behind `HOVER_OK` because on a phone `:hover` sticks after a tap, and a button
 * that keeps its hover paint after the page comes back is a button that looks pressed forever.
 *
 * **No `transition` here, on purpose** (§167). It carried one, and it was dead CSS twice over.
 * `background-image` has a discrete animation type — no browser interpolates a gradient — so
 * the 150ms curve never ran; the swap was always a flip. And `transition` in an `sx` fragment
 * is the whole shorthand, so declaring one here replaced the four properties MUI's own Button
 * fades (`background-color`, `box-shadow`, `border-color`, `color`) and made *those* snap
 * instead. Leaving the property out keeps MUI's transition intact, and the gradient arriving
 * at once is what it always did. Nothing here moves, so there is nothing for
 * `prefers-reduced-motion` to switch off.
 */
export const accentOnHover = {
  [HOVER_OK]: {
    "&:hover": { backgroundImage: SURFACE_GRADIENT.accent },
    "[data-dark] &:hover": { backgroundImage: SURFACE_GRADIENT.accentDark },
  },
} as const;

/**
 * A short bar under a section heading, drawn with `::after` so it needs no element.
 *
 * Purely decorative — no text sits on it, so it is the one gradient free to be saturated. It
 * is what makes a heading read as the start of a section on a page that is otherwise a column
 * of cards.
 */
export const headingRule = {
  "&::after": {
    content: '""',
    display: "block",
    width: 56,
    height: 3,
    marginTop: "0.5rem",
    borderRadius: 2,
    background: SURFACE_GRADIENT.rule,
  },
  "[data-dark] &::after": { background: SURFACE_GRADIENT.ruleDark },
} as const;
