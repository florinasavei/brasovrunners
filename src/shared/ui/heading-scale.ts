/**
 * The backoffice's heading scale (§NNN): the one place a staff screen's heading gets its size. The theme's `h2`…`h6` are
 * the public site's scale, too large for a dense working screen, so a backoffice heading wears the theme's `h2` look at
 * the size of its level here — a screen's title, then a card at level 2, a fold inside it a step smaller, so a card and its cards are told
 * apart (`Panel`, §350). `tests/unit/design/heading-scale.test.ts` refuses a size written on a heading by hand.
 */
export const HEADING_SX = {
  /** A screen's own title under the shell's `h1` (§844: the house's 1.25rem `h2`). */
  title: { fontSize: "1.25rem" },
  2: { fontSize: "1.1rem" },
  3: { fontSize: "1rem" },
  4: { fontSize: "0.95rem" },
  5: { fontSize: "0.9rem" },
} as const;

export type HeadingLevel = keyof typeof HEADING_SX;
