import { HIGH_WEB_MAX, LOW_WEB_MAX, ORIGINAL_WEB_MAX, WEB_MAX } from "./limits";

/**
 * The widths a picture is stored at, and how a page asks for the right one (§414).
 *
 * Imports nothing but `limits.ts` (§178): the browser half of the upload reads this file too.
 * A picture is stored at the widths the site draws it at (1×, 2×, 3× on a phone), never wider
 * than the master; the master stays `web.webp`, so every stored address keeps working.
 */

/**
 * The four choices beside every upload, smallest first (§437). `normal` is the default and
 * what an old client sends; `high` still keeps 4000 pixels, as under §414.
 */
export const IMAGE_QUALITIES = ["low", "normal", "high", "original"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export const DEFAULT_IMAGE_QUALITY: ImageQuality = "normal";

/** The quality asked for; absent means the default, an unknown word `null` (never guessed). */
export function parseImageQuality(value: unknown): ImageQuality | null {
  if (value === null || value === undefined || value === "") return DEFAULT_IMAGE_QUALITY;
  return typeof value === "string" && (IMAGE_QUALITIES as readonly string[]).includes(value)
    ? (value as ImageQuality)
    : null;
}

/**
 * The rungs, in CSS pixels × device pixels: tiles and cards on a phone, full and half columns on
 * a laptop at 1.5–2×. Each rung is at most 1.5× the one below.
 *
 * 3200 exists only under an «Originală» master (wider than `HIGH_WEB_MAX`, §437). A «Mare» master
 * must never name one: those were stored since §414 without a 3200 file, and the srcset is built
 * at render time from the master's width.
 */
export const LADDER_WIDTHS = [480, 640, 960, 1280, 1600, 1920, 2400, 3200] as const;

/** The rung that exists only under an «Originală» master (§437). */
const ORIGINAL_ONLY_RUNG = 3200;

const MASTER_MAX_EDGE: Record<ImageQuality, number> = {
  low: LOW_WEB_MAX,
  normal: WEB_MAX,
  high: HIGH_WEB_MAX,
  original: ORIGINAL_WEB_MAX,
};

/** The master's long side for a choice (§414, §437): what `images.ts` resizes to. */
export function masterMaxEdge(quality: ImageQuality): number {
  return MASTER_MAX_EDGE[quality];
}

/** The rungs below a master: those under 0.9 of its width (a near-master rung saves too little). */
export function ladderWidths(masterWidth: number): number[] {
  return LADDER_WIDTHS.filter(
    (width) => width < masterWidth * 0.9 && (width !== ORIGINAL_ONLY_RUNG || masterWidth > HIGH_WEB_MAX),
  );
}

/** The widest file the browser can take below the master, or `null` when the master is alone. */
export function topRungWidth(masterWidth: number): number | null {
  return ladderWidths(masterWidth).at(-1) ?? null;
}

/**
 * Whether an asset was stored with a ladder, read from its key prefix alone: a version-8 UUID
 * (RFC 9562, vendor-specific) since §414, version 4 before. The body renderer has only the
 * address, and the version digit carries the fact without changing the address's shape.
 */
export function isLadderKeyPrefix(keyPrefix: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(keyPrefix);
}

/** A random UUID (v4) re-labelled version 8: 122 random bits become 122 random bits and a mark. */
export function ladderKeyPrefixOf(uuid: string): string {
  return `${uuid.slice(0, 14)}8${uuid.slice(15)}`;
}

/**
 * A picture stored before §414, as PostgreSQL's `~` reads it: a version-4 UUID only — not a
 * ladder's version 8 nor a film poster's `yt-<id>` (§403). What §430's button converts.
 */
export const FORMER_KEY_PREFIX_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

/**
 * `ladderKeyPrefixOf`'s inverse: the prefix a picture converted by §430 had before, so the old
 * address needs no column. For a picture uploaded with a ladder it names nothing that exists.
 */
export function formerKeyPrefixOf(ladderKeyPrefix: string): string {
  return `${ladderKeyPrefix.slice(0, 14)}4${ladderKeyPrefix.slice(15)}`;
}

const MASTER_SUFFIX = /\/([0-9a-f-]{36})\/web\.webp$/;

/** The address of one rung, from the master's: the same directory, `<width>w.webp`. */
export function rungSrc(masterSrc: string, width: number): string {
  return masterSrc.replace(/\/web\.webp$/, `/${width}w.webp`);
}

/**
 * `srcset` for a stored picture: every rung, then the master at its own width; `undefined` for a
 * picture from before the ladder or with no recorded width. An old picture gets no
 * "thumbnail, then master" set: a 3× phone would take the 2400-pixel master (§414).
 */
export function pictureSrcSet(masterSrc: string, masterWidth: number | null | undefined): string | undefined {
  const match = MASTER_SUFFIX.exec(masterSrc);
  if (!match || !masterWidth || !isLadderKeyPrefix(match[1])) return undefined;
  return [...ladderWidths(masterWidth).map((width) => `${rungSrc(masterSrc, width)} ${width}w`), `${masterSrc} ${masterWidth}w`].join(", ");
}

/**
 * Where a picture is drawn, for `sizes`: per breakpoint from the widest down, `vw` per cent of
 * the viewport plus `px` pixels, measured from the layouts (`Container maxWidth="xl"` with
 * 24/16-pixel gutters, `PROSE_MEASURE`, the card, tile and cover grids).
 */
type SizeRule = { minWidth: number | null; vw: number; px: number };

const COLUMNS = {
  page: [
    { minWidth: 1536, vw: 0, px: 1488 },
    { minWidth: 600, vw: 100, px: -48 },
    { minWidth: null, vw: 100, px: -32 },
  ],
  prose: [
    { minWidth: 1008, vw: 0, px: 960 },
    { minWidth: 600, vw: 100, px: -48 },
    { minWidth: null, vw: 100, px: -32 },
  ],
  card: [
    { minWidth: 1536, vw: 0, px: 448 },
    { minWidth: 900, vw: 50, px: -68 },
    { minWidth: null, vw: 100, px: -64 },
  ],
  tile: [
    { minWidth: 1536, vw: 0, px: 363 },
    { minWidth: 900, vw: 25, px: -21 },
    { minWidth: 600, vw: 33.33, px: -24 },
    { minWidth: null, vw: 50, px: -20 },
  ],
  cover: [
    { minWidth: 1536, vw: 0, px: 485 },
    { minWidth: 900, vw: 33.33, px: -27 },
    { minWidth: 600, vw: 50, px: -32 },
    { minWidth: null, vw: 100, px: -32 },
  ],
} as const satisfies Record<string, readonly SizeRule[]>;

export type PictureColumn = keyof typeof COLUMNS;

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

function length(vw: number, px: number): string {
  if (vw === 0) return `${Math.round(px)}px`;
  if (Math.round(px) === 0) return `${round(vw, 2)}vw`;
  return `calc(${round(vw, 2)}vw ${px < 0 ? "-" : "+"} ${Math.abs(Math.round(px))}px)`;
}

/**
 * `sizes` for a picture drawn in `column`. `share` is the column percentage from `sm` up (full
 * width below, `image-layout.ts`); `magnify` is how much wider than its box the image is drawn
 * (`1 / crop.w` for a crop, §241, or the cover factor).
 */
export function pictureSizes(column: PictureColumn, share = 100, magnify = 1): string {
  const rules: readonly SizeRule[] = COLUMNS[column];
  return rules
    .map((rule) => {
      // The share applies from `sm` up; below it the picture is the full width.
      const factor = magnify * (rule.minWidth !== null && rule.minWidth >= 600 ? share / 100 : 1);
      const value = length(rule.vw * factor, rule.px * factor);
      return rule.minWidth === null ? value : `(min-width: ${rule.minWidth}px) ${value}`;
    })
    .join(", ");
}

/** How much wider than a box of `boxRatio` (width / height) `object-fit: cover` draws a picture. */
export function coverMagnification(width: number, height: number, boxRatio: number): number {
  if (!width || !height) return 1;
  return Math.max(1, width / height / boxRatio);
}
