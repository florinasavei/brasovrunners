/**
 * The share row's pills (`DECISIONS.md` §140, §158): one shape for the anchors the server
 * renders and the two islands beside them, so a network's button, the phone's own sheet and
 * the Instagram picture read as one row.
 *
 * Full 44 pixels on a touch screen, and smaller from `sm` up (§170; the owner: "aceste
 * butoane sunt mult prea mari"). A finger needs the 44; a pointer does not, and eight pills
 * at finger size across a desktop row read as the loudest thing on the page when they are
 * the least important. 32 is still well over the 24 WCAG 2.2 asks for.
 *
 * A plain object in a `.ts` file: a Server Component may not pass a function across the
 * boundary (`AGENTS.md` §14.1), and both sides import this.
 */
export const SHARE_PILL_SX = {
  minHeight: { xs: 44, sm: 32 },
  gap: 0.5,
  borderRadius: 22,
  px: { xs: 1.5, sm: 1.25 },
  fontSize: { sm: "0.78rem" },
} as const;

/** The glyph inside a pill: 20 pixels, decorative (the name is the pill's text). */
export const SHARE_ICON_SX = { fontSize: 20 } as const;
