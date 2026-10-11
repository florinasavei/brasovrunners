/**
 * «Aspectul nou» — the scope the facelift's look is drawn under (§708; `docs/REDESIGN.md` § The
 * visual system, decision 12).
 *
 * The locale layout puts `data-look="2026"` on `<html>` while the club's setting is on
 * (`modules/appearance/domain/site-look.ts`), the way MUI's `data-dark` switches the scheme (§93).
 * Everything the new look changes is written **under** that attribute as a plain-object selector —
 * in the theme's component overrides (`theme.ts`), in a surface fragment (`surfaces.ts`), in the
 * one small stylesheet of palette variables the layout draws — so with the setting off no rule
 * matches and every page is drawn exactly as before.
 *
 * - **Public pages only.** `:not(:has([data-backoffice]))`, the marker the page tint and the text
 *   size already stop at (§488, §530): the backoffice shell carries it, so staff never see the new
 *   look even while it is on. A browser without `:has()` drops the rule and shows today's look —
 *   the safe side.
 * - **A preview scope too.** `/admin/design` draws the new look beside today's inside a box that
 *   carries `data-look-preview="2026"`: every rule that reads the page's scope reads that box's as
 *   well, so the design page shows the overrides themselves, never a copy of them.
 * - **No colour here.** The tokens are `brand.ts`'s; this file names where they apply.
 */

/** The attribute the locale layout sets on `<html>` while «Aspectul nou» is on. */
export const LOOK_ATTRIBUTE = "data-look";
/** Its one value: the facelift of 2026. A later look would be another value, not another attribute. */
export const LOOK_VALUE = "2026";
/** The attribute of a box that draws the new look inside the backoffice (the design page's side-by-side). */
export const LOOK_PREVIEW_ATTRIBUTE = "data-look-preview";

/** The public pages under the new look, light or dark. */
export const LOOK_ROOT = `html[${LOOK_ATTRIBUTE}="${LOOK_VALUE}"]:not(:has([data-backoffice]))`;
/** The same after dark: MUI writes `data-dark` on `<html>` (§93). */
export const LOOK_ROOT_DARK = `html[data-dark][${LOOK_ATTRIBUTE}="${LOOK_VALUE}"]:not(:has([data-backoffice]))`;
/** A preview box, anywhere. */
export const LOOK_PREVIEW = `[${LOOK_PREVIEW_ATTRIBUTE}="${LOOK_VALUE}"]`;
/** A preview box after dark. */
export const LOOK_PREVIEW_DARK = `[data-dark] [${LOOK_PREVIEW_ATTRIBUTE}="${LOOK_VALUE}"]`;

/**
 * The nested selector an `sx` fragment or a theme override writes its new-look rules under: the
 * element inside the public scope, or inside a preview box. `{ [UNDER_LOOK]: { borderRadius: 999 } }`.
 */
export const UNDER_LOOK = `${LOOK_ROOT} &, ${LOOK_PREVIEW} &`;

/**
 * The same after dark, for a fill that has a dark twin (`COLOR_DARK`): more specific than
 * `UNDER_LOOK` (one attribute more), so it wins wherever both match, whatever the order.
 */
export const UNDER_LOOK_DARK = `${LOOK_ROOT_DARK} &, ${LOOK_PREVIEW_DARK} &`;

/**
 * The elements a page draws only under the new look — the header's «Urmărește-ne», the mountain
 * watermark — are hidden by default and shown inside the scope, so the backoffice, which
 * renders inside the same header and layout, never shows them even while the setting is on.
 * `display` is the shown value (`inline-flex`, `flex`, `block`).
 */
export function onlyUnderLook<T>(display: T) {
  return { display: "none", [UNDER_LOOK]: { display } } as const;
}

/**
 * The reverse: what today's look draws and the new one replaces — the header's language switcher,
 * whose place «Urmărește-ne» takes while the footer's bar carries the language (§722, §NNN) — keeps its own
 * `display` (a breakpoint object too) everywhere but inside the scope, where it is not drawn. The
 * backoffice, outside the scope, keeps it.
 */
export function notUnderLook<T>(display: T) {
  return { display, [UNDER_LOOK]: { display: "none" } } as const;
}

/**
 * The other half of `onlyUnderLook`: today's element, drawn while the setting is off and hidden
 * under the new look, where a new component stands in its place (the calendar's subscribe row
 * gives way to `SubscribeBox`, phase 4). Off, the rule matches nothing and the page is as it was.
 */
export const OFF_UNDER_LOOK = { [UNDER_LOOK]: { display: "none" } } as const;

/**
 * The accent's pale band under the new look (§723): the one shade MUI's palette has no slot for. The
 * other three ride on MUI's own primary — `primary.light` is `accent`, `primary.main` is `accentInk`,
 * `primary.dark` is `accentDeep` — and all four are written by the layout's one stylesheet
 * (`modules/appearance/domain/site-look.ts`) from the club's accent, light and dark, so a rule that
 * names this variable follows the club's choice in either scheme and needs no dark twin.
 */
export const LOOK_ACCENT_TINT_VARIABLE = "--br-accent-tint";
/** The band's colour, for an `sx` written under `UNDER_LOOK`: `{ [UNDER_LOOK]: { bgcolor: LOOK_ACCENT_TINT } }`. */
export const LOOK_ACCENT_TINT = `var(${LOOK_ACCENT_TINT_VARIABLE})`;

/** Headings under the new look: the display face at 800, set a little tighter (decision 2). */
export const LOOK_HEADING = { fontWeight: 800, letterSpacing: "-0.02em" } as const;

/** A button under the new look: a pill (§708). The height and the glyph are the primitive's (`ArrowButtonLink`). */
export const LOOK_BUTTON_RADIUS = 999;
