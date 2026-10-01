import { z } from "zod";
import { COLOR } from "@/theme/brand";

/**
 * What an event's shared card looks like (`DECISIONS.md` §609; the owner, 2026-10-01: «poza
 * descărcată pentru Instagram trebuie să fie un pic mai frumoasă, și pe viitor configurabilă»).
 *
 * `share-image.tsx` draws the card in two shapes — the square «Instagram» download and the
 * 1200×630 picture a pasted link shows (§90) — and reads **only this object** for every colour,
 * every element that may be left out and the background picture. The platform's choices are
 * `DEFAULT_SHARE_CARD_DESIGN`, and today every caller passes exactly that.
 *
 * ## Why it exists before anything stores it
 *
 * «Pe viitor configurabilă»: the club will one day choose its card. That day is a JSON column
 * `share_card_design` on `events`, read through `readShareCardDesign`, and a box in the event
 * editor — the same pair the race number has (`bib_design`, §249). Neither is built: nobody asked
 * for the box yet, and a column nobody writes is a migration for nothing. What is built is the
 * seam, so the drawing already takes its decisions from one place and the box, when it comes,
 * changes no drawing code.
 *
 * Pure, like `registrations/bib-design.ts` whose shape it copies: zod and the palette, no `node:`
 * builtin and no React, so a future client form may import the schema without dragging a
 * renderer into the bundle.
 */

/**
 * Three looks the club may later choose between. `brand`: the club's blue with white words, the
 * default. `ink`: near-black, the blue as the glow. `paper`: the page's off-white with ink words
 * and blue accents.
 */
export const SHARE_CARD_PALETTES = ["brand", "ink", "paper"] as const;
export type ShareCardPalette = (typeof SHARE_CARD_PALETTES)[number];

/** The tagline's ceiling, in characters: one handwritten line under the title. */
export const SHARE_CARD_TAGLINE_MAX = 60;

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A picture for the whole card, or null for none — an absolute `https:` address and nothing else:
 * never `http:` (a mixed-content fetch), never `javascript:` or `data:` stored in a column. The
 * renderer fetches it with a deadline and draws the plain card if it cannot (`share-image.tsx`).
 */
const picture = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  })
  .nullable()
  .catch(null);

/** One line, its whitespace collapsed, cut at the ceiling rather than refused. */
function oneLine(value: string): string {
  return Array.from(value.replace(/\s+/g, " ").trim()).slice(0, SHARE_CARD_TAGLINE_MAX).join("").trim();
}

export const shareCardDesignSchema = z
  .object({
    palette: z.enum(SHARE_CARD_PALETTES).catch("brand"),
    /** The kit's orange unless the club picks another: the pill, the rule, the dot, the circle. */
    accent: z.string().trim().regex(HEX).catch(COLOR.orange),
    /** The club's lockup at the top and its mountains in the band. */
    showLogo: z.boolean().catch(true),
    /** The event's type in the pill; a cancelled event says so whatever this says. */
    showType: z.boolean().catch(true),
    showPlace: z.boolean().catch(true),
    /** The distance and the climb, as two chips. */
    showRoute: z.boolean().catch(true),
    /** The site's host in the band, from `APP_BASE_URL`. */
    showHost: z.boolean().catch(true),
    /** A handwritten line under the title; nothing is drawn while it is empty. */
    tagline: z.string().transform(oneLine).catch(""),
    /** The future «choose a picture» of the editor: drawn full-bleed under a legibility overlay. */
    backgroundPictureUrl: picture,
  })
  .strict();

export type ShareCardDesign = z.infer<typeof shareCardDesignSchema>;

export const DEFAULT_SHARE_CARD_DESIGN: ShareCardDesign = {
  palette: "brand",
  accent: COLOR.orange,
  showLogo: true,
  showType: true,
  showPlace: true,
  showRoute: true,
  showHost: true,
  tagline: "",
  backgroundPictureUrl: null,
};

/**
 * Whatever is stored, read as a design — and never a throw. A card that fails to draw is worse
 * than a plain card, so every field falls back to the platform's choice on its own, an object
 * that is not one at all reads as the whole default, and a key this release does not know is
 * ignored rather than taking the rest down with it (the reasoning of `readBibDesign`, §249).
 */
export function readShareCardDesign(value: unknown): ShareCardDesign {
  const stored: Record<string, unknown> = typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  const known = Object.fromEntries(
    Object.keys(DEFAULT_SHARE_CARD_DESIGN)
      .filter((key) => key in stored)
      .map((key) => [key, stored[key]]),
  );
  const parsed = shareCardDesignSchema.safeParse({ ...DEFAULT_SHARE_CARD_DESIGN, ...known });
  return parsed.success ? parsed.data : DEFAULT_SHARE_CARD_DESIGN;
}

/** A six-digit hex at an opacity, as the `rgba()` Satori draws. A malformed hex reads as the ink. */
export function withAlpha(hex: string, alpha: number): string {
  const value = HEX.test(hex) ? hex.slice(1) : COLOR.ink.slice(1);
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Relative luminance of a six-digit hex, the WCAG formula. */
function luminance(hex: string): number {
  const value = HEX.test(hex) ? hex.slice(1) : COLOR.ink.slice(1);
  const channel = (at: number) => {
    const c = Number.parseInt(value.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * Ink or white on the accent, whichever reads better: the kit's orange takes ink (6.2:1 against
 * 2.8:1 for white), and a dark accent the club may one day choose takes white rather than going
 * unread under ink letters.
 */
export function textOnAccent(accent: string): string {
  const ground = luminance(accent);
  const contrast = (text: string) => {
    const [light, dark] = [Math.max(ground, luminance(text)), Math.min(ground, luminance(text))];
    return (light + 0.05) / (dark + 0.05);
  };
  return contrast(COLOR.ink) >= contrast(COLOR.surface) ? COLOR.ink : COLOR.surface;
}

/** Every colour the card is drawn in, decided from the design alone. */
export type ShareCardColours = {
  /** The look actually drawn: `paper` under a picture is drawn as `brand`, or the words vanish. */
  palette: ShareCardPalette;
  /** The flat colour under everything, and the overlay's colour over a picture. */
  base: string;
  /** The card's background over the base: a gradient, or null for the flat base. */
  gradient: string | null;
  /** The soft radial light at the top right, and the same colour at nothing, where it ends. */
  glow: string;
  glowFade: string;
  /** The accent's large circle at the bottom right. */
  circle: string;
  /** The words. */
  text: string;
  /**
   * The type pill: a tint of the words' colour with a line round it, the words in their colour — quiet,
   * so that the one solid accent pill on the card is the cancelled one's (§609).
   */
  pill: string;
  pillBorder: string;
  pillText: string;
  /** The cancelled pill: the accent solid, ink on it (white on a dark accent). */
  cancelledPill: string;
  cancelledPillText: string;
  /** The rule under the title, the dot in the date, the tagline. */
  accent: string;
  /** The route chips. */
  chip: string;
  chipBorder: string;
  /** The band at the foot, and the host on it. */
  band: string;
  bandText: string;
  /** Which lockup goes at the top and which mountains in the band. */
  logo: "white" | "blue";
  mark: "white" | "blue";
  /**
   * Over a picture: the vertical veil that keeps the words legible; null without one. It is
   * strongest where the white words are smallest — `SHARE_PICTURE_VEIL` — so the logo's wordmark
   * and the pill read on any photograph, a near-white one included (§609): at a quarter of the base,
   * the review measured them at about 1.5:1.
   */
  overlay: string | null;
};

/**
 * The veil over a picture, as the base colour's opacity: 0.72 over the top quarter, behind the logo
 * and the pill (white on a white photograph under it reads at about 5:1, and the radial light is
 * left off), easing to 0.6 at the middle where the photograph shows most and the title is large,
 * and 0.88 at the foot behind the date, the place and the chips.
 */
export const SHARE_PICTURE_VEIL = { top: 0.72, middle: 0.6, foot: 0.88 } as const;

/**
 * The palette, the accent and whether a picture is drawn, as colours. `brand` and `ink` are
 * white words on a dark ground with a paper band; `paper` is ink words on the page's off-white
 * with a blue band. A picture under `paper` is drawn as `brand`: ink words over a photograph
 * under a light veil read as nothing on a phone.
 */
export function shareCardColours(design: ShareCardDesign, hasPicture: boolean): ShareCardColours {
  const palette: ShareCardPalette = hasPicture && design.palette === "paper" ? "brand" : design.palette;
  const accent = HEX.test(design.accent) ? design.accent : COLOR.orange;
  const dark = palette !== "paper";
  const base = palette === "brand" ? COLOR.blueInk : palette === "ink" ? COLOR.ink : COLOR.paper;
  const text = dark ? COLOR.surface : COLOR.ink;
  const glow = palette === "brand" ? COLOR.surface : COLOR.blue;
  return {
    palette,
    base,
    gradient:
      palette === "brand"
        ? `linear-gradient(135deg, ${COLOR.blueInk} 0%, ${COLOR.blue} 100%)`
        : palette === "ink"
          ? `linear-gradient(135deg, ${COLOR.ink} 0%, ${withAlpha(COLOR.ink, 0.92)} 55%, ${withAlpha(COLOR.blueInk, 0.9)} 100%)`
          : null,
    // No light over a picture: it would whiten the corner the pill sits in.
    glow: withAlpha(glow, hasPicture ? 0 : palette === "brand" ? 0.18 : palette === "ink" ? 0.42 : 0.07),
    glowFade: withAlpha(glow, 0),
    circle: withAlpha(accent, dark ? 0.14 : 0.1),
    text,
    // Over a picture the pill is a shade of the base rather than a tint of the words, which would lighten it.
    pill: hasPicture ? withAlpha(base, 0.55) : withAlpha(text, 0.14),
    pillBorder: withAlpha(text, 0.45),
    pillText: text,
    cancelledPill: accent,
    cancelledPillText: textOnAccent(accent),
    accent,
    chip: dark ? withAlpha(COLOR.surface, 0.14) : withAlpha(COLOR.blue, 0.08),
    chipBorder: withAlpha(text, 0.3),
    band: dark ? COLOR.paper : COLOR.blue,
    bandText: dark ? COLOR.blue : COLOR.paper,
    logo: dark ? "white" : "blue",
    mark: dark ? "blue" : "white",
    overlay: hasPicture
      ? `linear-gradient(180deg, ${withAlpha(base, SHARE_PICTURE_VEIL.top)} 0%, ${withAlpha(base, SHARE_PICTURE_VEIL.top)} 25%, ${withAlpha(base, SHARE_PICTURE_VEIL.middle)} 50%, ${withAlpha(base, SHARE_PICTURE_VEIL.foot)} 100%)`
      : null,
  };
}

/** A text of at most `max` characters, cut at its last word that fits with «…», or mid-word without one. */
function clampAtWord(text: string, max: number): string {
  const characters = Array.from(text);
  if (characters.length <= max) return text;
  const head = characters.slice(0, max).join("");
  const space = head.lastIndexOf(" ");
  const cut = space > 0 ? head.slice(0, space) : characters.slice(0, max - 1).join("");
  return `${cut.replace(/[\s,;:.–—-]+$/u, "")}…`;
}

/**
 * The title, at most `max` characters: Satori draws every line it is given, so a long title is
 * cut here — at the last word that fits, with «…» — rather than running into the date. A title
 * with no space before the ceiling is cut mid-word, still with «…».
 */
export const SHARE_CARD_TITLE_MAX = 110;

export function clampTitle(title: string, max: number = SHARE_CARD_TITLE_MAX): string {
  return clampAtWord(title, max);
}

/**
 * The meeting point, at most `max` characters, cut the same way (§609): `location_name` is free
 * text, and a place that wraps to a second line pushes the facts under it off the wide card. The
 * drawing keeps the place to one line as well (`whiteSpace: nowrap`, an ellipsis where it would
 * overflow), so a place of sixty wide letters is cut there rather than wrapped.
 */
export const SHARE_CARD_PLACE_MAX = 60;

export function clampPlace(place: string, max: number = SHARE_CARD_PLACE_MAX): string {
  return clampAtWord(place.replace(/\s+/g, " ").trim(), max);
}
