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
 * which is exactly what the featured hero's comment claimed it was doing.
 */
export const heroSurface = {
  backgroundImage: SURFACE_GRADIENT.hero,
  "[data-dark] &": { backgroundImage: SURFACE_GRADIENT.heroDark },
} as const;

/**
 * The featured event's card: the first card of the listing's grid, at the width of every other
 * card, told apart by its frame and its background alone (§470; the owner, 2026-09-26: "vreau doar
 * sa fie primul, nu neaparat mai lat pe desktop, e ok sa afisam 2 sau 3 carduri, dar toate
 * cardurile trebuie sa aiba aceeasi latime").
 *
 * The frame is the hero's two pixels of the club's blue (the owner, 2026-09-18: "the main event must
 * be more highlighted"), drawn as the card's own one-pixel border in blue plus a one-pixel ring
 * outside it — a `box-shadow`, which takes no room — so the lead's box and the room inside it are
 * exactly every other card's, to the pixel: a two-pixel border would have narrowed its content by
 * two pixels against the width budget `EventFacts.tsx`'s "when" row was measured to (§366, §375).
 * The background is the hero's gradient (`heroSurface`, §166). A plain object, like `specialCard`
 * below, because it is `sx` handed from a Server Component to MUI's client `Card`, and the ring
 * names the palette's CSS variable for the same reason. It replaces `specialCard` on a featured
 * event that is also special — one frame per card; the «Ediție specială» chip still says the
 * second thing.
 */
export const featuredCard = {
  borderColor: "primary.main",
  boxShadow: "0 0 0 1px var(--mui-palette-primary-main)",
  ...heroSurface,
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
 *
 * It is the page title's one mark of identity, and it stays at every width (§NNN): the compact
 * page head keeps the bar and only halves the room above it on a phone, four pixels under the
 * title's words where `sm` and up keep eight. Only the page H1s carry it.
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
  "@media (max-width:599.95px)": { "&::after": { marginTop: "0.25rem" } },
  "[data-dark] &::after": { background: SURFACE_GRADIENT.ruleDark },
} as const;

/**
 * A card for an event the club marked special (`DECISIONS.md` §272; the owner: "vreau să fac
 * hilight la evenimentele speciale, testări de papuci, etc").
 *
 * A chip said so already (§168) and a chip is one line among four. This is the card itself: the
 * club's secondary colour on the border and the faintest wash of it behind, so a shoe testing
 * among eleven Monday runs is found by the eye before anything is read.
 *
 * `secondary.main` at four percent, over the card's own background rather than instead of it —
 * a fill that replaced the surface would put body text on a tint nobody checked for contrast,
 * and the same four percent reads correctly in both schemes because it is a wash rather than a
 * colour. Nothing about the border needs a dark variant: the orange was chosen as a pair with
 * dark text and holds on either (`theme.ts`).
 */
const SPECIAL_WASH = "color-mix(in srgb, var(--mui-palette-secondary-main) 4%, transparent)";

/**
 * A partner's own card on the event page (`DECISIONS.md` §344, §352 amended — the owner, of
 * the shared race with the Brașov Running Festival, 2026-09-25: "The partner card should have
 * a border and a gray background so it stands out"). Outlined, with a wash behind it rather
 * than the page's own background, so the card the club shares its event with reads as its own
 * box among the page's plain rows.
 *
 * `action.selected` rather than a literal gray: MUI's own stronger "something sits here" tint
 * (`CalendarEventChip` and `RegistrationSteps` already lean on it for the same reason), tuned
 * against both schemes' text (`theme.ts`'s palettes) so light and dark each get a wash that
 * reads as gray without a second value to keep in step with the brand. `action.hover` — the
 * calendar header's own wash — was tried first and screenshotted at 360 pixels in both colour
 * schemes; in light it sat too close to the page's own paper next to the owner's "stands out",
 * so the card moved to the stronger token.
 */
export const partnerCardSurface = {
  border: 1,
  borderColor: "divider",
  borderRadius: 2,
  bgcolor: "action.selected",
} as const;

export const specialCard = {
  borderColor: "secondary.main",
  /*
    **A CSS variable, never a callback.** This was written as `(theme) => …`, which is a
    *function*, and this object is handed as `sx` from a Server Component to MUI's `Card`,
    which is a client one. React refuses to serialize a function across that boundary
    (`AGENTS.md` §14.1), so every card on the listing threw "Functions cannot be passed directly
    to Client Components" — the page answered 200 and the section did not render. It reached QA
    on 2026-09-22 and looked like the environment being down.

    `--mui-palette-secondary-main` is the variable MUI writes for the same colour
    (`theme.ts` sets `cssVariables`), so the wash still follows the scheme — and it is a string,
    which crosses any boundary.
  */
  backgroundImage: `linear-gradient(0deg, ${SPECIAL_WASH}, ${SPECIAL_WASH})`,
} as const;
