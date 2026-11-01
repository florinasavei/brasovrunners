import { COLOR, contrastRatio, HEX_COLOR, MIN_TEXT_CONTRAST } from "@/theme/brand";

/**
 * The two rules a page colour has to keep (§488, «Aspectul site-ului»), as plain arithmetic — no
 * zod, no database — so the service refuses a «Personalizat» colour with them and the backoffice's
 * colour island says the same verdict live while the Administrator types, from one source.
 *
 * - **Readable:** body text (`COLOR.ink`) and muted text (`COLOR.inkMuted`) at WCAG 2.1 AA,
 *   4.5 : 1 or more, on the page colour.
 * - **Light enough:** the white cards (`COLOR.surface`) stay a card on it — at most
 *   `MAX_CARD_STEP` : 1 between the card and the page. Past that the page reads as a coloured
 *   wash and the tint is a dark theme by the back door; the dark scheme has its own colours (§93).
 *
 * The presets in `SITE_TINT` (`theme/brand.ts`) are held to the same two rules by `brand.test.ts`.
 *
 * The contrast itself is `theme/brand.ts`'s since §NNN — the one file that computes colours, which derives a
 * club's missing tints with it — and is named from here as it always was, so none of its readers changed.
 */
export { contrastRatio, HEX_COLOR, MIN_TEXT_CONTRAST, relativeLuminance } from "@/theme/brand";

/** How far the page may step away from a white card before it is too dark to be a light page. */
export const MAX_CARD_STEP = 1.2;

/** Why a page colour is refused, or `null` when it keeps both rules. */
export type TintVerdict = "notAColour" | "unreadable" | "tooDark" | null;

/**
 * The verdict on a typed page colour. "Unreadable" is checked first, because it is the rule the
 * reader cares about; a colour that fails it is almost always too dark as well.
 */
export function judgeTint(hex: string): TintVerdict {
  if (!HEX_COLOR.test(hex)) return "notAColour";
  if (contrastRatio(COLOR.ink, hex) < MIN_TEXT_CONTRAST || contrastRatio(COLOR.inkMuted, hex) < MIN_TEXT_CONTRAST) {
    return "unreadable";
  }
  if (contrastRatio(COLOR.surface, hex) > MAX_CARD_STEP) return "tooDark";
  return null;
}
