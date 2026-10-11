import { COLOR, COLOR_DARK, GRADIENT, LOOK_ACCENT } from "./brand";

/**
 * The text-on-background pairs the pages actually render, named by their tokens (§692).
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

/**
 * The new look's pairs (§708, «Aspectul nou»; `docs/REDESIGN.md` § The visual system): the pink as
 * `primary` — words on the page, a card and the pale pink band, and white on its fill and on the
 * hover's — the hot pink itself, the band under ink, the kinds' fills under their words, and the
 * headings' stronger ink. Drawn only on the public pages while the setting is on.
 */
export const LOOK_PAIRS: readonly BrandPair[] = [
  pair(light("accentInk"), light("paper")),
  pair(light("accentInk"), light("surface")),
  pair(light("accentInk"), light("accentTint")),
  pair(light("surface"), light("accentInk")),
  pair(light("surface"), light("accentDeep")),
  pair(light("accent"), light("paper")),
  pair(light("accent"), light("surface")),
  pair(light("surface"), light("accent")),
  pair(light("ink"), light("accentTint")),
  pair(light("inkMuted"), light("accentTint")),
  pair(light("kindSpecialInk"), light("kindSpecial")),
  pair(light("kindSpecialInk"), light("paper")),
  pair(light("kindSpecialInk"), light("surface")),
  pair(light("ink"), light("kindOther")),
  pair(light("inkMuted"), light("kindOther")),
  pair(light("inkStrong"), light("paper")),
  pair(light("inkStrong"), light("surface")),
];

/** The same pairs after dark: a fill under the dark page colour where the light one takes white. */
export const LOOK_PAIRS_DARK: readonly BrandPair[] = [
  pair(dark("accentInk"), dark("paper")),
  pair(dark("accentInk"), dark("surface")),
  pair(dark("accentInk"), dark("accentTint")),
  pair(dark("paper"), dark("accentInk")),
  pair(dark("paper"), dark("accentDeep")),
  pair(dark("accent"), dark("paper")),
  pair(dark("accent"), dark("surface")),
  pair(dark("paper"), dark("accent")),
  pair(dark("ink"), dark("accentTint")),
  pair(dark("inkMuted"), dark("accentTint")),
  pair(dark("kindSpecialInk"), dark("kindSpecial")),
  pair(dark("kindSpecialInk"), dark("paper")),
  pair(dark("kindSpecialInk"), dark("surface")),
  pair(dark("ink"), dark("kindOther")),
  pair(dark("inkMuted"), dark("kindOther")),
  pair(dark("inkStrong"), dark("paper")),
  pair(dark("inkStrong"), dark("surface")),
];

/** The four shades of an accent, by day and after dark (`LOOK_ACCENT`, or a typed colour's derivation). */
type AccentKey = "accent" | "accentInk" | "accentDeep" | "accentTint";
type AccentScheme = Readonly<Record<AccentKey, string>>;

/**
 * The accent's pairs (§NNN), for any accent: the same ten of each scheme `LOOK_PAIRS` holds for the
 * pink — its words on the page, a card and its band, the words on its fill and on the pressed fill,
 * the hot shade as text and as a fill, and the body's and the muted ink on its band. `name` labels the
 * accent's own tokens (`LOOK_ACCENT.blue.light.accentInk`); the page's tokens keep theirs.
 * `tests/unit/appearance/look-accent.test.ts` holds every preset and a spread of typed colours to them.
 */
export function accentPairsOf(name: string, shades: { light: AccentScheme; dark: AccentScheme }): BrandPair[] {
  const own = (scheme: "light" | "dark", key: AccentKey): BrandToken => ({ name: `${name}.${scheme}.${key}`, hex: shades[scheme][key] });
  const lightPairs = (fill: BrandToken) => [
    pair(own("light", "accentInk"), light("paper")),
    pair(own("light", "accentInk"), light("surface")),
    pair(own("light", "accentInk"), own("light", "accentTint")),
    pair(fill, own("light", "accentInk")),
    pair(fill, own("light", "accentDeep")),
    pair(own("light", "accent"), light("paper")),
    pair(own("light", "accent"), light("surface")),
    pair(fill, own("light", "accent")),
    pair(light("ink"), own("light", "accentTint")),
    pair(light("inkMuted"), own("light", "accentTint")),
  ];
  const darkPairs = (fill: BrandToken) => [
    pair(own("dark", "accentInk"), dark("paper")),
    pair(own("dark", "accentInk"), dark("surface")),
    pair(own("dark", "accentInk"), own("dark", "accentTint")),
    pair(fill, own("dark", "accentInk")),
    pair(fill, own("dark", "accentDeep")),
    pair(own("dark", "accent"), dark("paper")),
    pair(own("dark", "accent"), dark("surface")),
    pair(fill, own("dark", "accent")),
    pair(dark("ink"), own("dark", "accentTint")),
    pair(dark("inkMuted"), own("dark", "accentTint")),
  ];
  // The words on a fill: white by day, the dark page after dark — `primary.contrastText` under the look.
  return [...lightPairs(light("surface")), ...darkPairs(dark("paper"))];
}

/** The pairs of the presets other than the pink (whose pairs are `LOOK_PAIRS` above), both schemes. */
export const LOOK_ACCENT_PAIRS: readonly BrandPair[] = (["blue", "orange"] as const).flatMap((preset) => accentPairsOf(`LOOK_ACCENT.${preset}`, LOOK_ACCENT[preset]));

/** Every pair the page draws and the test asserts, in one list. */
export const BRAND_PAIRS: readonly BrandPair[] = [
  ...TEXT_PAIRS,
  ...TEXT_PAIRS_DARK,
  ...HERO_PAIRS,
  ...ACCENT_PAIRS,
  ...LOOK_PAIRS,
  ...LOOK_PAIRS_DARK,
  ...LOOK_ACCENT_PAIRS,
];

/**
 * The calendar's three colours by kind (the facelift's phase 4, `docs/REDESIGN.md` § What exists
 * versus what is new): a weekly run in the accent's pale band (the club's accent; the names below
 * are the default pink's), a special event in the green, any other date in the warm grey — each
 * entry's fill, the words on it and the dot the legend and the entry lead with. One table, read by
 * the calendar's styles (`events/ui/calendar-tone-sx.ts`, which draws an accent token through the
 * setting's variables, never as the pink's own colour) and held at AA by
 * `tests/unit/theme/brand.test.ts`: the words on the fill, and the dot on the page and on a card (a
 * dot is a mark, 3 : 1 would do; the dots meet 4.5 : 1 anyway) — the pink's here, every other
 * accent's through `accentPairsOf`. Never colour alone: the legend says each colour's word, and
 * every entry keeps its glyphs and its accessible name.
 */
export const CALENDAR_TONE_TOKENS = {
  weekly: { fill: "accentTint", ink: "ink", dot: "accent" },
  special: { fill: "kindSpecial", ink: "kindSpecialInk", dot: "kindSpecialInk" },
  other: { fill: "kindOther", ink: "ink", dot: "inkMuted" },
} as const satisfies Record<string, { fill: keyof typeof COLOR; ink: keyof typeof COLOR; dot: keyof typeof COLOR }>;

/** The calendar's tones as pairs, both schemes: the words on each fill, each dot on the page and on a card. */
export const CALENDAR_TONE_PAIRS: readonly BrandPair[] = (["light", "dark"] as const).flatMap((scheme) => {
  const token = scheme === "light" ? light : dark;
  return Object.values(CALENDAR_TONE_TOKENS).flatMap(({ fill, ink, dot }) => [
    pair(token(ink), token(fill)),
    pair(token(dot), token("paper")),
    pair(token(dot), token("surface")),
  ]);
});
