import { HEX_COLOR, shadesOf } from "@/theme/brand";

/**
 * The new look's accent from one colour (§723, amending §708): the four shades «Aspectul nou» wears —
 * `accent` (the mark, a rule, a large word), `accentInk` (the words: MUI's `primary.main` under the
 * look), `accentDeep` (a pressed button) and `accentTint` (a pale band or the weekly runs' chip) — in
 * the light scheme and after dark, derived from the colour the club types so every pair the look draws
 * clears WCAG AA. The presets in `LOOK_ACCENT` (`theme/brand.ts`) are held to the same rules by
 * `tests/unit/appearance/look-accent.test.ts`; the orange preset is this function's answer for the
 * club's orange.
 *
 * Pure arithmetic, no zod, no database, no colour literal: the service derives a typed colour with it
 * and the backoffice's colour island shows the same shades live, from one source. The walk itself is
 * `theme/brand.ts#shadesOf` since §885 — the one file that computes colours, which also fills the shades a
 * club's `club.json` leaves out with it — and this module judges the typed colour before asking it.
 *
 * **How.** Each shade is the colour walked towards black (by day) or towards white (after dark) in
 * steps of 1 %, stopping at the first step that keeps its rule. A colour that already keeps it is kept
 * as typed; so the club's own colour is what the page shows wherever it can be.
 *
 * - `accent`: text at AA on the page and on a card, and the words on its fill (white by day, the dark
 *   page after dark) at AA too.
 * - `accentInk`: at least 15 % further, and no lighter than the muted ink by day (`COLOR.inkMuted`) —
 *   §488 holds the muted ink at AA on every page tint the club may choose, a typed one included, so
 *   the accent's words hold there too; 7 : 1 against the card in either scheme.
 * - `accentDeep`: at least 15 % further again, a clear step past `accentInk` (the hover reads as a
 *   press, deeper by day and lighter after dark, as the blues are ordered).
 * - `accentTint`: the card colour with a little of `accent` in it (10 % by day, 14 % after dark),
 *   lessened until the body's ink, the muted ink and `accentInk` all read on it at AA.
 *
 * **Refused**, in words: a colour that is not `#rrggbb`, and a grey — channels within `MIN_CHROMA` of
 * each other — because a grey accent reads as the body's text and a link would no longer look like one.
 */

/** The four shades the new look wears, in one scheme. */
export type AccentShade = { readonly accent: string; readonly accentInk: string; readonly accentDeep: string; readonly accentTint: string };

/** Both schemes: what the layout's stylesheet writes under the look's scope. */
export type AccentShades = { readonly light: AccentShade; readonly dark: AccentShade };

/** The shades' names, in the order the design page and the previews draw them. */
export const ACCENT_SHADE_KEYS = ["accent", "accentInk", "accentDeep", "accentTint"] as const satisfies readonly (keyof AccentShade)[];

/** How far apart a colour's channels must be for it to be a colour rather than a grey (0–255). */
export const MIN_CHROMA = 40;

/** The contrast `accentInk` keeps against the card, in either scheme. */
export { ACCENT_INK_CONTRAST } from "@/theme/brand";

/** Why a typed accent is refused, or `null` when the shades can be derived from it. */
export type AccentVerdict = "notAColour" | "tooGrey" | null;

/** The accent the club may type: `#rrggbb` (lower-cased by the caller), and not a grey. */
export function judgeAccent(hex: string): AccentVerdict {
  if (!HEX_COLOR.test(hex)) return "notAColour";
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  if (Math.max(...channels) - Math.min(...channels) < MIN_CHROMA) return "tooGrey";
  return null;
}

/**
 * The shades of a typed accent, both schemes. The caller has judged it (`judgeAccent`); a value that
 * is not `#rrggbb` throws, so nothing unchecked is ever written into a stylesheet.
 */
export function deriveAccentShades(hex: string): AccentShades {
  const base = hex.toLowerCase();
  if (!HEX_COLOR.test(base)) throw new Error(`not a #rrggbb colour: ${hex}`);
  return shadesOf(base);
}
