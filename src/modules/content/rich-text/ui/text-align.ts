import { alignmentOf, type BlockAlignment } from "../domain/schema";

/**
 * Where a paragraph or a heading sits in the text column, as `sx` (`DECISIONS.md` §213) —
 * separated from `RichText` for the same reason `image-layout.ts` is: it is the whole of the
 * rule, and the interesting part of it is what it does *not* emit.
 *
 * **The default emits nothing at all.** Left is already what the theme does, so a declaration
 * saying so would change no pixel and add a rule to every paragraph on every page the club has
 * ever written. The same discipline as §193's clearing rules: a body written before alignment
 * existed renders exactly the markup it rendered before, rather than new rules that happen to
 * be no-ops.
 *
 * **There is no responsive variant, unlike a floated picture.** A float has to be undone on a
 * phone because a third of 320 pixels beside a paragraph is two words a line (§193); a centred
 * heading is a centred heading at every width, and it is the arrangement the organizer asked
 * for precisely because they are looking at the page on one.
 */
export function blockAlignSx(attrs: { align?: BlockAlignment | null } | undefined) {
  const align = alignmentOf(attrs);
  return align === "left" ? {} : ({ textAlign: align } as const);
}
