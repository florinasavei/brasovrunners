import { inArray } from "drizzle-orm";
import sharp from "sharp";
import { mediaAssets } from "@/db/schema/gallery";
import type { Database } from "@/db/types";
import { getStorage, objectKey } from "@/modules/media/storage";
import { env } from "@/shared/config/env";
import { bibPictureUrl } from "./bib-design";
import type { BibPictureSlot } from "./bib-picture-frame";

/**
 * The pictures a bib design names (§560): their stored facts for the editor, and their pixels for
 * the two renderers.
 *
 * ## The facts
 *
 * A design names a picture by its web variant's address, `…/<key prefix>/web.webp` (§249), so the
 * prefix is read back out of it: which asset it is, its small file, its size — what the crop box
 * needs to hold the place's shape. A picture moved by the older pictures' button (§430) keeps its
 * old address in a design saved before the move — the version digit 4 where the row now says 8 —
 * and is found under either. A picture that no longer exists is simply absent: the editor shows
 * the place empty, so the next save drops it.
 *
 * ## The pixels
 *
 * Every stored picture is WebP (§414), and neither renderer reads WebP: pdfkit embeds only JPEG and
 * PNG ("Unknown image format." — the sheet of a design with a picture failed whole), and `next/og`
 * answers "Unsupported image type: image/webp" and draws nothing (the preview showed no picture).
 * So both routes fetch each picture here, with the deadline and the ceiling the sheet always had,
 * and hand the renderers a PNG — which keeps a logo's transparency — no wider than the place can
 * use, with its size, which makes the crop exact (`bib-picture-frame.ts`). Anything that fails is
 * `null`: the coloured band and no sponsors' strip, exactly as a bib printed before it had pictures.
 */
export type BibPictureFacts = { id: string; src: string; thumb: string; width: number; height: number };

const PREFIX = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/web\.webp$/;

/** The key prefix a design's picture address carries, or null for anything else. */
export function bibPictureKeyPrefix(src: string | null | undefined): string | null {
  if (!src) return null;
  return PREFIX.exec(src)?.[1] ?? null;
}

/** The prefixes a row may be stored under for an address: its own, and the moved one (§430). */
function candidatePrefixes(prefix: string): string[] {
  return prefix[14] === "4" ? [prefix, `${prefix.slice(0, 14)}8${prefix.slice(15)}`] : [prefix];
}

export async function readBibPictureFacts<T extends Record<string, unknown>>(
  db: Database<T>,
  srcs: readonly (string | null | undefined)[],
): Promise<Map<string, BibPictureFacts>> {
  const wanted = new Map<string, string[]>();
  for (const src of srcs) {
    const prefix = bibPictureKeyPrefix(src);
    if (src && prefix) wanted.set(src, candidatePrefixes(prefix));
  }
  const facts = new Map<string, BibPictureFacts>();
  if (wanted.size === 0) return facts;
  const rows = await db
    .select({ id: mediaAssets.id, keyPrefix: mediaAssets.keyPrefix, width: mediaAssets.width, height: mediaAssets.height })
    .from(mediaAssets)
    .where(inArray(mediaAssets.keyPrefix, [...new Set([...wanted.values()].flat())]));
  const storage = getStorage();
  for (const [src, prefixes] of wanted) {
    const row = rows.find((candidate) => prefixes.includes(candidate.keyPrefix));
    if (!row) continue;
    facts.set(src, {
      id: row.id,
      src,
      thumb: storage.publicUrl(objectKey(row.keyPrefix, "thumb")),
      width: row.width,
      height: row.height,
    });
  }
  return facts;
}

/** One picture ready for a renderer: PNG bytes and their size in pixels. */
export type LoadedBibPicture = { png: Buffer; width: number; height: number };

/** A club's header or sponsors' strip: one of this site's own WebP variants, so both are small. */
const PICTURE_MAX_BYTES = 4 * 1024 * 1024;
const PICTURE_TIMEOUT_MS = 5_000;

/**
 * How wide a picture is handed over, in pixels: the sheet's 559 points are 2 330 pixels at 300 dpi,
 * and a crop of half the picture needs twice that; the screen's preview is 990 pixels across.
 */
export const BIB_PICTURE_WIDTH = { sheet: 3000, preview: 1600 } as const;

async function loadOne(src: string | null, maxWidth: number): Promise<LoadedBibPicture | null> {
  const address = bibPictureUrl(src, env.APP_BASE_URL);
  if (!address) return null;
  try {
    const response = await fetch(address, { signal: AbortSignal.timeout(PICTURE_TIMEOUT_MS) });
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > PICTURE_MAX_BYTES) return null;
    const { data, info } = await sharp(Buffer.from(bytes))
      .resize({ width: maxWidth, withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { png: data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/**
 * Both places' pictures for a renderer, each `null` where there is none or it could not be read —
 * and the members' own (§664), read only when `members` says a member's bib will be drawn and the
 * members' switch is on: their header for «Doar banda de sus», their card's photograph for «Tot
 * numărul» (§NNN), never both. A sheet of no member's bib fetches nothing more than before.
 */
export async function loadBibPictures(
  design: {
    headerImageSrc: string | null;
    sponsorImageSrc: string | null;
    member?: { enabled: boolean; style?: "band" | "card"; headerImageSrc: string | null; cardImageSrc?: string | null };
  },
  maxWidth: number,
  members = false,
): Promise<Record<BibPictureSlot | "memberHeader", LoadedBibPicture | null>> {
  const member = members && design.member?.enabled ? design.member : null;
  const memberHeaderSrc = member && member.style !== "card" ? member.headerImageSrc : null;
  const memberCardSrc = member && member.style === "card" ? (member.cardImageSrc ?? null) : null;
  const [header, sponsors, memberHeader, memberCard] = await Promise.all([
    loadOne(design.headerImageSrc, maxWidth),
    loadOne(design.sponsorImageSrc, maxWidth),
    loadOne(memberHeaderSrc, maxWidth),
    loadOne(memberCardSrc, maxWidth),
  ]);
  return { header, sponsors, memberHeader, memberCard };
}

/** A loaded picture as `next/og` takes it: an inline PNG, with its size. */
export function bibPictureForImage(picture: LoadedBibPicture | null): { src: string; width: number; height: number } | null {
  return picture ? { src: `data:image/png;base64,${picture.png.toString("base64")}`, width: picture.width, height: picture.height } : null;
}
