import { CLUB_SLUG, PR_KIT_COLOURS } from "@/theme/brand";

/**
 * «PR Kit» (§1015; the owner, 2026-11-20: «also put them in the backoffice website and call it "PR Kit" so we can download it
 * at any time, even the volunteers can do that»): what the kit holds and what each file is called — pure, so the page, the
 * routes and the tests read one list.
 *
 * - **The logo**: two shapes — the whole lockup, and its mountains alone — each in three inks, each as an SVG and a PNG
 *   (`yarn brand:assets` writes them into `public/brand/kit/`, `scripts/brand-kit.mjs`) and a PDF drawn on request from the
 *   same paths; transparent, and the white one on the club's colour as well (`LOGO_GROUNDS`).
 * - **The sticker sheets**: six A4 PDFs drawn on request — two with a code to the site, four with the logo alone
 *   (`sheets.ts` holds their geometry).
 * - **The YouTube poster**: one A4 PDF drawn on request, its code to the club's channel, only while `CLUB_YOUTUBE_URL` is set.
 *
 * Every file is named from the club's slug, so a download says whose it is — and a fork's says the fork's.
 */

export const LOGO_SHAPES = ["lockup", "mountains"] as const;
export type LogoShape = (typeof LOGO_SHAPES)[number];

/** The logo's inks: the club's primary on a light ground, white on a dark one or a photograph, black for one ink. */
export const LOGO_INKS = ["primary", "white", "black"] as const;
export type LogoInk = (typeof LOGO_INKS)[number];

export const LOGO_FORMATS = ["svg", "png", "pdf"] as const;
export type LogoFormat = (typeof LOGO_FORMATS)[number];

/** The word a shape's files carry: `scripts/brand-kit.mjs`'s `KIT_SHAPES`, which `brand-kit.test.ts` holds equal. */
const SHAPE_WORD: Record<LogoShape, string> = { lockup: "logo", mountains: "mountains" };

/** The PNG's width in pixels, written in its name: `scripts/brand-kit.mjs`'s `KIT_PNG_WIDTH`. */
export const KIT_PNG_WIDTH = 4000;

/**
 * The margin the kit's frame leaves around the measured drawing, as a share of the drawing's width on every side:
 * `scripts/brand-kit.mjs`'s `KIT_MARGIN`, so the PDFs can place the drawing itself, not its frame.
 */
export const KIT_MARGIN = 0.04;

/** Where the kit's files are served from: `public/brand/kit/`, as the site's address path. */
export const KIT_PUBLIC_PATH = "/brand/kit";

/** Each ink's colour, the one the kit's files are written in (`PR_KIT_COLOURS`, from the club's palette). */
export const LOGO_INK_HEX: Record<LogoInk, string> = PR_KIT_COLOURS.ink;

/** The ground each ink is drawn on: white under the primary and the black, the primary under the white. */
export const LOGO_INK_GROUND: Record<LogoInk, string> = { primary: PR_KIT_COLOURS.paper, white: PR_KIT_COLOURS.ink.primary, black: PR_KIT_COLOURS.paper };

/**
 * The ground a logo file is drawn on (§1046; the owner, 2026-11-22, on the white tile shown on the club's colour: «trebe să fie
 * ceva bifă pt fundal, e confusing»): `none` — transparent, every ink's file — or `primary`, the club's colour filling the
 * frame, which the white ink alone also comes on. `scripts/brand-kit.mjs`'s `kitGrounds` says the same.
 */
export const LOGO_GROUNDS = ["none", "primary"] as const;
export type LogoGround = (typeof LOGO_GROUNDS)[number];

/** The grounds an ink's files come on: every ink transparent, the white on the club's colour as well. */
export function logoGrounds(ink: LogoInk): readonly LogoGround[] {
  return ink === "white" ? LOGO_GROUNDS : ["none"];
}

/**
 * One logo file: `<slug>-logo-primary.svg`, `<slug>-mountains-white-4000px.png`, `<slug>-logo-black.pdf`, and on the club's
 * colour `<slug>-logo-white-on-primary.svg` — the stickers' `-on-primary` word.
 */
export function logoFileName(shape: LogoShape, ink: LogoInk, format: LogoFormat, slug: string = CLUB_SLUG, ground: LogoGround = "none"): string {
  return `${slug}-${SHAPE_WORD[shape]}-${ink}${ground === "primary" ? "-on-primary" : ""}${format === "png" ? `-${KIT_PNG_WIDTH}px` : ""}.${format}`;
}

/** Every logo tile, shape by shape and ink by ink, in the page's order. */
export function logoVariants(): Array<{ shape: LogoShape; ink: LogoInk }> {
  return LOGO_SHAPES.flatMap((shape) => LOGO_INKS.map((ink) => ({ shape, ink })));
}

/** Every logo download: each tile's shape and ink on each of its grounds. */
export function logoFiles(): Array<{ shape: LogoShape; ink: LogoInk; ground: LogoGround }> {
  return logoVariants().flatMap(({ shape, ink }) => logoGrounds(ink).map((ground) => ({ shape, ink, ground })));
}

/** A logo download's address path segment back to what it names, or null for anything else: the route's one parser. */
export function parseLogoFile(name: string, slug: string = CLUB_SLUG): { shape: LogoShape; ink: LogoInk; ground: LogoGround; format: LogoFormat } | null {
  for (const { shape, ink, ground } of logoFiles()) {
    for (const format of LOGO_FORMATS) {
      if (logoFileName(shape, ink, format, slug, ground) === name) return { shape, ink, ground, format };
    }
  }
  return null;
}

/** The six sticker sheets, in the page's order: the two with a code to the site, then the logo alone. */
export const STICKER_SHEET_KEYS = ["qr-12", "qr-24", "logo-12", "logo-24", "logo-40", "logo-12-primary"] as const;
export type StickerSheetKey = (typeof STICKER_SHEET_KEYS)[number];

export function isStickerSheetKey(value: string): value is StickerSheetKey {
  return (STICKER_SHEET_KEYS as readonly string[]).includes(value);
}

/** A sheet's file: `<slug>-stickers-qr-12-per-sheet.pdf`, the primary's `<slug>-stickers-logo-12-per-sheet-on-primary.pdf`. */
export function stickerFileName(sheet: StickerSheetKey, slug: string = CLUB_SLUG): string {
  const [kind, count, ground] = sheet.split("-");
  return `${slug}-stickers-${kind}-${count}-per-sheet${ground ? `-on-${ground}` : ""}.pdf`;
}

/** The poster's file, in its language: `<slug>-youtube-poster-a4-ro.pdf`. */
export function posterFileName(locale: string, slug: string = CLUB_SLUG): string {
  return `${slug}-youtube-poster-a4-${locale}.pdf`;
}

/**
 * An address as a person reads it under a code (§1015): no scheme, no `www.`, no closing slash — the site's address prints as
 * its host alone, a channel's as its host and its handle. The code itself keeps the whole address.
 */
export function shownAddress(url: string): string {
  return url
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

/** A `#rrggbb` colour as its three channels, 0–255: what a print shop asks for beside the hex. */
export function rgbOf(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16), Number.parseInt(match[3], 16)];
}
