/**
 * A public button's glyph (§NNN; the owner, 2026-09-27, of the event page's sign button: "that
 * button needs to be smaller and have an icon (as do all the buttons from this website)").
 *
 * Every button a visitor presses wears a picture before its words, as the backoffice's verbs do
 * (§318). The backoffice names its glyphs through `action-icons.ts`; a public page never imports
 * that list (a lookup by a runtime key ships all fifty of them, §318), so a public button imports
 * its one glyph file from `@mui/icons-material/<Name>` and draws it as the button's **first
 * child** — never through `startIcon`, which from a Server Component is an element-valued prop
 * into a client component, refused by `tests/unit/shared/server-element-props.test.ts` (§370).
 * `children` is the one slot that crosses the boundary safely.
 *
 * The sizes are MUI's own start-icon slot's (18 / 20 / 22 by button size), so a glyph drawn as a
 * child is as big as one drawn by `startIcon`, and `SubmitButton`'s running figure, which takes
 * the glyph's place while a request is in flight, is the same size again.
 */
export const BUTTON_GLYPH_PX = { small: 18, medium: 20, large: 22 } as const;

/** The gap MUI's start-icon slot keeps between the glyph and the words: spread into the button's `sx`. */
export const WITH_GLYPH_SX = { gap: 1 } as const;

/** The glyph's own `sx`, by the button's size: MUI's start-icon size, never shrunk by a long label. */
export function glyphSx(size: keyof typeof BUTTON_GLYPH_PX = "medium") {
  return { fontSize: BUTTON_GLYPH_PX[size], flexShrink: 0 } as const;
}
