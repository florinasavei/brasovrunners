import { alignmentOf, type BlockAlignment } from "../domain/schema";

/**
 * A paragraph's or heading's alignment as `sx` (§213). Left emits nothing, so text written
 * before alignment existed renders the same markup (as §193). No phone variant: unlike a float,
 * centring reads fine at every width.
 */
export function blockAlignSx(attrs: { align?: BlockAlignment | null } | undefined) {
  const align = alignmentOf(attrs);
  return align === "left" ? {} : ({ textAlign: align } as const);
}
