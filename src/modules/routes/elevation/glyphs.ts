import type { ElevationGlyph } from "./geometry";

/**
 * The pins' glyphs as SVG path data (§NNN): one small solid shape per kind of checkpoint, each drawn in a 16 × 16 box
 * centred on (0, 0), to be scaled to the pin head and filled with the head's ink. Plain strings — no MUI icon inside an
 * SVG (an icon is a component, and a Server Component must not hand one to a client island; §370), and the same data a
 * PDF writer can walk.
 *
 * A drop for water, a fork for food, a cross for first aid, a stopwatch for timing, an arrow for direction, a dot for a
 * point that offers none of them. Never the only sign: the visually hidden list and the `<title>` say the point's name,
 * and the table under the chart says what it offers in words.
 */

/** The box every path is drawn in: `-GLYPH_HALF` to `GLYPH_HALF` on both axes. */
export const GLYPH_HALF = 8;

export const ELEVATION_GLYPH_PATHS: Readonly<Record<ElevationGlyph, string>> = {
  // A drop.
  water: "M0 -7.5C3.6 -3.4 5.8 -0.6 5.8 2.4A5.8 5.8 0 0 1 -5.8 2.4C-5.8 -0.6 -3.6 -3.4 0 -7.5Z",
  // A fork: three tines, the bowl, the handle.
  food: "M-3 -7.5h1.4v4.5h.9v-4.5h1.4v4.5h.9v-4.5h1.4v5.4a2.6 2.6 0 0 1 -2.2 2.6v7h-1.6v-7a2.6 2.6 0 0 1 -2.2 -2.6z",
  // A cross.
  firstAid: "M-2 -7h4v5h5v4h-5v5h-4v-5h-5v-4h5z",
  // A stopwatch: a ring and a hand (the hand stands inside the hole, so even-odd fills it).
  timing:
    "M0 -7.2a7.2 7.2 0 1 1 0 14.4a7.2 7.2 0 1 1 0 -14.4zM0 -5a5 5 0 1 0 0 10a5 5 0 1 0 0 -10zM-.9 -3.4h1.8v3.9h2.6v1.7h-4.4z",
  // An arrow, pointing up.
  direction: "M0 -7.5l6 7h-3.8v7.5h-4.4v-7.5h-3.8z",
  // A dot.
  none: "M0 -3.4a3.4 3.4 0 1 1 0 6.8a3.4 3.4 0 1 1 0 -6.8z",
};

/** Whether a glyph's path is to be filled with the even-odd rule (the stopwatch's ring has a hole). */
export const GLYPH_EVEN_ODD: Readonly<Record<ElevationGlyph, boolean>> = {
  water: false,
  food: false,
  firstAid: false,
  timing: true,
  direction: false,
  none: false,
};
