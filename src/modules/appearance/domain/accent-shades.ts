import { COLOR, COLOR_DARK } from "@/theme/brand";
import { contrastRatio, HEX_COLOR, MIN_TEXT_CONTRAST, relativeLuminance } from "./tint-contrast";

/**
 * The new look's accent from one colour (§NNN, amending §708): the four shades «Aspectul nou» wears —
 * `accent` (the mark, a rule, a large word), `accentInk` (the words: MUI's `primary.main` under the
 * look), `accentDeep` (a pressed button) and `accentTint` (a pale band or the weekly runs' chip) — in
 * the light scheme and after dark, derived from the colour the club types so every pair the look draws
 * clears WCAG AA. The presets in `LOOK_ACCENT` (`theme/brand.ts`) are held to the same rules by
 * `tests/unit/appearance/look-accent.test.ts`; the orange preset is this function's answer for the
 * club's orange.
 *
 * Pure arithmetic, no zod, no database, no colour literal: the service derives a typed colour with it
 * and the backoffice's colour island shows the same shades live, from one source.
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
export const ACCENT_INK_CONTRAST = 7;

/** Why a typed accent is refused, or `null` when the shades can be derived from it. */
export type AccentVerdict = "notAColour" | "tooGrey" | null;

type Rgb = readonly [number, number, number];

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as unknown as Rgb;
}

function hexOf(channels: Rgb): string {
  return `#${channels.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

/** `from` moved `share` (0–1) of the way to `to`, channel by channel. */
function mix(from: string, to: Rgb, share: number): string {
  const start = rgb(from);
  return hexOf([0, 1, 2].map((index) => start[index] + (to[index] - start[index]) * share) as unknown as Rgb);
}

/** The first 1 % step from `from` towards `to`, starting at `minimum`, that keeps `keeps`; `to` itself at worst. */
function walk(from: string, to: Rgb, minimum: number, keeps: (hex: string) => boolean): string {
  for (let step = Math.round(minimum * 100); step <= 100; step += 1) {
    const candidate = mix(from, to, step / 100);
    if (keeps(candidate)) return candidate;
  }
  return mix(from, to, 1);
}

/** The card colour with `share` of the accent in it, lessened a step at a time until `keeps` holds; the card itself at worst. */
function tint(card: string, accent: string, share: number, keeps: (hex: string) => boolean): string {
  const target = rgb(accent);
  for (let step = Math.round(share * 100); step > 0; step -= 1) {
    const candidate = mix(card, target, step / 100);
    if (keeps(candidate)) return candidate;
  }
  return card;
}

const atAa = (a: string, b: string) => contrastRatio(a, b) >= MIN_TEXT_CONTRAST;

/** The accent the club may type: `#rrggbb` (lower-cased by the caller), and not a grey. */
export function judgeAccent(hex: string): AccentVerdict {
  if (!HEX_COLOR.test(hex)) return "notAColour";
  const channels = rgb(hex);
  if (Math.max(...channels) - Math.min(...channels) < MIN_CHROMA) return "tooGrey";
  return null;
}

/** The light scheme's four shades of a colour. */
function lightShades(base: string): AccentShade {
  const accent = walk(base, BLACK, 0, (hex) => atAa(hex, COLOR.paper) && atAa(hex, COLOR.surface));
  const accentInk = walk(
    accent,
    BLACK,
    0.15,
    (hex) => relativeLuminance(hex) <= relativeLuminance(COLOR.inkMuted) && contrastRatio(COLOR.surface, hex) >= ACCENT_INK_CONTRAST,
  );
  const deepTarget = Math.min(contrastRatio(COLOR.surface, accentInk) + 2.5, 19);
  const accentDeep = walk(accentInk, BLACK, 0.15, (hex) => contrastRatio(COLOR.surface, hex) >= deepTarget);
  const accentTint = tint(COLOR.surface, accent, 0.1, (hex) => atAa(COLOR.ink, hex) && atAa(COLOR.inkMuted, hex) && atAa(accentInk, hex));
  return { accent, accentInk, accentDeep, accentTint };
}

/** The dark scheme's four shades of a colour. */
function darkShades(base: string): AccentShade {
  const accent = walk(base, WHITE, 0, (hex) => atAa(hex, COLOR_DARK.paper) && atAa(hex, COLOR_DARK.surface));
  const accentInk = walk(accent, WHITE, 0.15, (hex) => contrastRatio(hex, COLOR_DARK.surface) >= ACCENT_INK_CONTRAST);
  const deepTarget = Math.min(contrastRatio(accentInk, COLOR_DARK.surface) + 2, 16);
  const accentDeep = walk(accentInk, WHITE, 0.15, (hex) => contrastRatio(hex, COLOR_DARK.surface) >= deepTarget);
  const accentTint = tint(COLOR_DARK.surface, accent, 0.14, (hex) => atAa(COLOR_DARK.ink, hex) && atAa(COLOR_DARK.inkMuted, hex) && atAa(accentInk, hex));
  return { accent, accentInk, accentDeep, accentTint };
}

/**
 * The shades of a typed accent, both schemes. The caller has judged it (`judgeAccent`); a value that
 * is not `#rrggbb` throws, so nothing unchecked is ever written into a stylesheet.
 */
export function deriveAccentShades(hex: string): AccentShades {
  const base = hex.toLowerCase();
  if (!HEX_COLOR.test(base)) throw new Error(`not a #rrggbb colour: ${hex}`);
  return { light: lightShades(base), dark: darkShades(base) };
}
