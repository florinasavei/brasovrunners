import { SURFACE_GRADIENT } from "./brand";
import { HOVER_OK } from "./motion";

/**
 * The site's surfaces as `sx` fragments a Server Component can spread (§166). Plain objects,
 * never theme functions, since a function cannot cross into a MUI client component
 * (`AGENTS.md` §14.1); the dark variant uses MUI's `data-dark` attribute on `<html>`. Three
 * gradients is the budget.
 */

/**
 * The featured event's text-carrying surface (contrast asserted in `brand.test.ts`).
 * `backgroundImage`, never the `background` shorthand, which would reset the caller's
 * `bgcolor` fallback (§167).
 */
export const heroSurface = {
  backgroundImage: SURFACE_GRADIENT.hero,
  "[data-dark] &": { backgroundImage: SURFACE_GRADIENT.heroDark },
} as const;

/**
 * The featured event's card, the same width as every other (§470), told apart by frame and
 * background. The two-pixel blue frame is the one-pixel border plus a one-pixel `box-shadow`
 * ring, which takes no room, so the content keeps the width `EventFacts.tsx`'s "when" row was
 * measured to (§366, §375). Replaces `specialCard` on a featured special event.
 */
export const featuredCard = {
  borderColor: "primary.main",
  boxShadow: "0 0 0 1px var(--mui-palette-primary-main)",
  ...heroSurface,
} as const;

/**
 * The primary action under a hovering pointer. `backgroundImage` keeps MUI's button colour
 * underneath as the fallback. No `transition` (§167): gradients do not interpolate, and the
 * shorthand would replace MUI's own Button transitions.
 */
export const accentOnHover = {
  [HOVER_OK]: {
    "&:hover": { backgroundImage: SURFACE_GRADIENT.accent },
    "[data-dark] &:hover": { backgroundImage: SURFACE_GRADIENT.accentDark },
  },
} as const;

/** A short decorative bar under a section heading, drawn with `::after`; carries no text. */
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

/**
 * The wash behind a special event's card (§272): `secondary.main` at 4 % layered over the card's
 * own background, not replacing it, so text contrast is unchanged in both schemes.
 */
const SPECIAL_WASH = "color-mix(in srgb, var(--mui-palette-secondary-main) 4%, transparent)";

/**
 * A partner's card on the event page, outlined and tinted so it stands out (§344, §352, §381).
 * `action.selected` is a gray that follows both schemes; `action.hover` was too faint in light.
 */
export const partnerCardSurface = {
  border: 1,
  borderColor: "divider",
  borderRadius: 2,
  bgcolor: "action.selected",
} as const;

export const specialCard = {
  borderColor: "secondary.main",
  // A CSS variable, never a `(theme) => …` callback: this `sx` crosses into a client `Card`,
  // and a function cannot (`AGENTS.md` §14.1).
  backgroundImage: `linear-gradient(0deg, ${SPECIAL_WASH}, ${SPECIAL_WASH})`,
} as const;
