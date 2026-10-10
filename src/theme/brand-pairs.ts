import { COLOR, COLOR_DARK, GRADIENT } from "./brand";

/**
 * The text-on-background pairs the pages actually render, named by their tokens (§NNN).
 *
 * They lived as prose rows inside `tests/unit/theme/brand.test.ts` — "body text on a card" — and
 * the design-system page (`/admin/design`) draws the same table with each pair's ratio, so the
 * pairs are a constant here that the test imports back: one list, asserted and drawn, never a
 * second copy that drifts. Nothing here names a colour; every value is read from `brand.ts`.
 *
 * `tests/unit/theme/brand.test.ts` (BR-REQ-070-02 criterion 4) holds every pair at WCAG 2.1 AA,
 * 4.5 : 1 or more, with the contrast helper of `modules/appearance/domain/tint-contrast.ts`.
 */
export type BrandToken = { readonly name: string; readonly hex: string };

export type BrandPair = { readonly foreground: BrandToken; readonly background: BrandToken };

const light = (key: keyof typeof COLOR): BrandToken => ({ name: `COLOR.${key}`, hex: COLOR[key] });
const dark = (key: keyof typeof COLOR_DARK): BrandToken => ({ name: `COLOR_DARK.${key}`, hex: COLOR_DARK[key] });
const gradient = (key: "heroTint" | "heroTintDark"): BrandToken => ({ name: `GRADIENT.${key}`, hex: GRADIENT[key] });

const pair = (foreground: BrandToken, background: BrandToken): BrandPair => ({ foreground, background });

/** Body text, labels, the club's blue as text, the hover shade, button text and the secondary's text — the light scheme. */
export const TEXT_PAIRS: readonly BrandPair[] = [
  pair(light("ink"), light("paper")),
  pair(light("ink"), light("surface")),
  pair(light("inkMuted"), light("paper")),
  pair(light("inkMuted"), light("surface")),
  pair(light("blue"), light("paper")),
  pair(light("blue"), light("surface")),
  pair(light("blueInk"), light("paper")),
  pair(light("blueInk"), light("surface")),
  pair(light("paper"), light("blue")),
  pair(light("ink"), light("orange")),
];

/** The same pairs after dark (`DECISIONS.md` §93); the orange keeps its dark text on either scheme. */
export const TEXT_PAIRS_DARK: readonly BrandPair[] = [
  pair(dark("ink"), dark("paper")),
  pair(dark("ink"), dark("surface")),
  pair(dark("inkMuted"), dark("paper")),
  pair(dark("inkMuted"), dark("surface")),
  pair(dark("blue"), dark("paper")),
  pair(dark("blue"), dark("surface")),
  pair(dark("blueInk"), dark("paper")),
  pair(dark("paper"), dark("blue")),
  pair(light("ink"), light("orange")),
];

/** Text over both ends of the hero's gradient (§166), in both schemes. */
export const HERO_PAIRS: readonly BrandPair[] = [
  pair(light("ink"), gradient("heroTint")),
  pair(light("ink"), light("surface")),
  pair(light("inkMuted"), gradient("heroTint")),
  pair(light("blue"), gradient("heroTint")),
  pair(dark("ink"), gradient("heroTintDark")),
  pair(dark("inkMuted"), gradient("heroTintDark")),
  pair(dark("blue"), gradient("heroTintDark")),
];

/** Button text over both stops of the accent gradient, in both schemes. */
export const ACCENT_PAIRS: readonly BrandPair[] = [
  pair(light("paper"), light("blue")),
  pair(light("paper"), light("blueInk")),
  pair(dark("paper"), dark("blue")),
  pair(dark("paper"), dark("blueInk")),
];

/** Every pair the page draws and the test asserts, in one list. */
export const BRAND_PAIRS: readonly BrandPair[] = [...TEXT_PAIRS, ...TEXT_PAIRS_DARK, ...HERO_PAIRS, ...ACCENT_PAIRS];
