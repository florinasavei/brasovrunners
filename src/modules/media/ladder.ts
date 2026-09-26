import { HIGH_WEB_MAX, WEB_MAX } from "./limits";

/**
 * The widths a picture is stored at, and how a page asks for the right one (§414).
 *
 * **Nothing but `limits.ts` imported, on purpose** — the same rule as `limits.ts` itself
 * (§178): the browser half of the upload reads `parseImageQuality`, the server's pipeline reads
 * `ladderWidths`, and the public pages read `pictureSrcSet` / `pictureSizes`. Anything that
 * needs `sharp` or the environment lives elsewhere.
 *
 * ## Why a ladder
 *
 * A stored picture had two files: `web` (2400px on its long side, WebP 88) and `thumb` (640px).
 * Every page drew `web` whatever it was drawn at — a 320-pixel phone downloaded 380 KB to show
 * a picture 1100 physical pixels wide — and every place that drew `thumb` drew it wider than it
 * is on a phone with a 3× screen (an album cover across a 390-pixel phone is 1074 physical
 * pixels of a 640-pixel file). The owner's word for the second one is "super pixelated".
 *
 * So a picture is stored at the widths the site actually draws it at, 1× and 2× (3× on a
 * phone): `LADDER_WIDTHS` below every master narrower than 0.9 of it, plus the master itself,
 * and every public `<img>` carries `srcset` and `sizes` so the browser takes the smallest file
 * at least as wide as the picture is drawn. A rung is never wider than the master — nothing is
 * enlarged — and the master is `web.webp`, exactly as before, so every address already stored in
 * a body keeps working.
 */

/** The two choices beside every upload. `normal` is the default and what an old client sends. */
export const IMAGE_QUALITIES = ["normal", "high"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export const DEFAULT_IMAGE_QUALITY: ImageQuality = "normal";

/**
 * The quality a request asked for, or `null` when it asked for something that is not one.
 *
 * Absent (a client from before §414, a test that posts only a file) is the default; anything
 * else must be one of the two words — the server never guesses what `"hd"` or `"max"` meant.
 */
export function parseImageQuality(value: unknown): ImageQuality | null {
  if (value === null || value === undefined || value === "") return DEFAULT_IMAGE_QUALITY;
  return typeof value === "string" && (IMAGE_QUALITIES as readonly string[]).includes(value)
    ? (value as ImageQuality)
    : null;
}

/**
 * The rungs, in CSS pixels × device pixels. 480 and 640 are a gallery tile and a card on a phone
 * at 2× and 3×; 960 and 1280 a phone's full column at 3× and a laptop's half column at 2×; 1600
 * and 1920 a laptop's full column at 1.5× and 2×. The master (≤ 2400 at «Normală») is the
 * widest screen's. Each rung is at most 1.5× the one below, so the browser never downloads more
 * than half again what it draws.
 *
 * 2400 is a rung only under a master at «Înaltă» (up to `HIGH_WEB_MAX`, 4000; §414): a
 * «Normală» master is at most 2400 and so never gets it (`ladderWidths` keeps rungs under 0.9 of
 * the master), and a 4000-pixel poster is not what a laptop at 2× has to download — it takes
 * the same 2400 file a «Normală» picture's master is, and only a screen wider than that takes
 * the whole master.
 */
export const LADDER_WIDTHS = [480, 640, 960, 1280, 1600, 1920, 2400] as const;

/** The master's long side for a choice (§414): what `images.ts` resizes to. */
export function masterMaxEdge(quality: ImageQuality): number {
  return quality === "high" ? HIGH_WEB_MAX : WEB_MAX;
}

/**
 * The rungs stored below a master of this width: those narrower than 0.9 of it. A 1725-pixel
 * portrait gets 480…1280, not a 1600 that would be the master again for 7% fewer bytes.
 */
export function ladderWidths(masterWidth: number): number[] {
  return LADDER_WIDTHS.filter((width) => width < masterWidth * 0.9);
}

/**
 * Whether an asset was stored with a ladder, read from its key prefix alone.
 *
 * The prefix is a UUID, and one minted since §414 is **version 8** — RFC 9562's version for
 * "vendor-specific" layouts — where every older one is a version 4 from `randomUUID()`. The body
 * renderer has nothing but the picture's address (a body is JSON; the page does not ask the
 * database about each picture in it), so the fact "this picture has smaller siblings" has to be
 * in the address, and the version digit is the one place in it that can carry a fact without
 * changing its shape — the body schema's `/<36 hex>/web.webp` still matches, and no stored body
 * or column changes. A picture from before is drawn exactly as it was: one `src`, no `srcset`,
 * because a `srcset` naming files that do not exist is a broken picture, not a fallback.
 */
export function isLadderKeyPrefix(keyPrefix: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(keyPrefix);
}

/** A random UUID (v4) re-labelled version 8: 122 random bits become 122 random bits and a mark. */
export function ladderKeyPrefixOf(uuid: string): string {
  return `${uuid.slice(0, 14)}8${uuid.slice(15)}`;
}

/**
 * A picture stored before §414, as PostgreSQL's `~` reads it: a version-4 UUID from
 * `randomUUID()`, which is what every prefix was until the ladder, and nothing else — not a
 * ladder's version 8, and not a film poster's `yt-<id>`, which keeps YouTube's one small file on
 * purpose (§403, §414). What the one-off button of §NNN converts.
 */
export const FORMER_KEY_PREFIX_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

/**
 * The prefix a laddered picture had before §NNN gave it its ladder: the same UUID with its version
 * digit back at 4 — `ladderKeyPrefixOf`'s inverse. A converted picture moves to
 * `ladderKeyPrefixOf(old)`, so its old address is always derivable from its new one and needs no
 * column; for a picture uploaded with a ladder it names a directory that never existed.
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
 * `srcset` for a stored picture, from the master's address and size, or `undefined` when there
 * is nothing to choose between. The master is always the last candidate, at its own width, so a
 * screen wider than every rung gets exactly what it got before.
 *
 * - **A picture with a ladder**: every rung, then the master.
 * - **A picture from before** (a version-4 prefix): no `srcset` — it is drawn exactly as it was,
 *   the thumbnail where a page drew the thumbnail and the master where it drew the master. The
 *   first version of this offered it "thumbnail, then master", and the re-review measured what
 *   that did (§414): an old album's cover across a 390-pixel phone at 3× is 1074 physical
 *   pixels, wider than the 640-pixel thumbnail, so the browser took the 2400-pixel master —
 *   381 KB where its thumbnail is 37 KB (a 3455 × 2673 photograph, measured), on the albums
 *   page, for every old album on it. Two candidates four times apart are not a ladder; a phone is
 *   better served by the file it always had until the album is uploaded again.
 * - **No width recorded** (a body from before the upload route stored one): no `srcset`.
 */
export function pictureSrcSet(masterSrc: string, masterWidth: number | null | undefined): string | undefined {
  const match = MASTER_SUFFIX.exec(masterSrc);
  if (!match || !masterWidth || !isLadderKeyPrefix(match[1])) return undefined;
  return [...ladderWidths(masterWidth).map((width) => `${rungSrc(masterSrc, width)} ${width}w`), `${masterSrc} ${masterWidth}w`].join(", ");
}

/**
 * Where a picture is drawn, as the widths `sizes` needs: for each breakpoint from the widest
 * down, `vw` per cent of the viewport plus `px` pixels. Measured from the layouts, not guessed:
 *
 * - `page` — the event page's column: `Container maxWidth="xl"` (1536) with 24-pixel gutters
 *   from `sm` and 16 below, so 1488 at its widest.
 * - `prose` — a standing page's column, `PROSE_MEASURE` (60rem = 960) inside the same container.
 * - `card` — a listing card's inner width: one card below `md` (900), two to `xl`, three from it,
 *   less the grid's gap and the card's own 16-pixel padding.
 * - `tile` — an album's grid: two tiles below `sm`, three to `md`, four from it.
 * - `cover` — the albums listing: one, two, three per row.
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
 * `sizes` for a picture drawn in `column`.
 *
 * `share` is the part of the column the organizer gave it from `sm` up (100, 75, 50, 33 — on a
 * phone every picture is the full width, `image-layout.ts`), and `magnify` is how much wider
 * than its box the image itself is drawn: `1 / crop.w` for a cropped picture (the photograph is
 * laid over its window at that magnification, §241) and the cover factor for a tile that cuts a
 * wide photograph to 4:3. Plain `calc()` and media conditions only — every engine the site
 * supports reads them.
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

/**
 * How much wider than a box of `boxRatio` (width / height) a picture is drawn with
 * `object-fit: cover`: 1 for anything as tall or taller, its ratio over the box's for anything
 * wider — a 3:2 photograph in a 4:3 tile is drawn 1.125 times the tile's width.
 */
export function coverMagnification(width: number, height: number, boxRatio: number): number {
  if (!width || !height) return 1;
  return Math.max(1, width / height / boxRatio);
}
