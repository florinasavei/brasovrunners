import { COLOR } from "@/theme/brand";

/**
 * The two rules a page colour keeps (§488), shared by the service and the live backoffice check:
 * `COLOR.ink` and `COLOR.inkMuted` at AA (4.5 : 1) on it, and a white card at most `MAX_CARD_STEP`
 * away — darker is a dark theme by the back door (§93). `brand.test.ts` holds the presets to them.
 */
/** A page colour as the club may type it: `#rrggbb`, six hex digits, nothing else. */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** WCAG 2.1 AA for body-size text. */
export const MIN_TEXT_CONTRAST = 4.5;

/** How far the page may step away from a white card before it is too dark to be a light page. */
export const MAX_CARD_STEP = 1.2;

function channelLuminance(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  if (!HEX_COLOR.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [1, 3, 5].map((start) => channelLuminance(Number.parseInt(hex.slice(start, start + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Why a page colour is refused, or `null` when it keeps both rules. */
export type TintVerdict = "notAColour" | "unreadable" | "tooDark" | null;

/** "Unreadable" first: the rule the reader cares about, and it usually implies "tooDark". */
export function judgeTint(hex: string): TintVerdict {
  if (!HEX_COLOR.test(hex)) return "notAColour";
  if (contrastRatio(COLOR.ink, hex) < MIN_TEXT_CONTRAST || contrastRatio(COLOR.inkMuted, hex) < MIN_TEXT_CONTRAST) {
    return "unreadable";
  }
  if (contrastRatio(COLOR.surface, hex) > MAX_CARD_STEP) return "tooDark";
  return null;
}
