import { eq } from "drizzle-orm";
import sharp, { type Metadata } from "sharp";
import { mediaAssets } from "@/db/schema/gallery";
import type { Database } from "@/db/types";
import { env } from "@/shared/config/env";
import { bodyImageSrc, getStorage, objectKey } from "./storage";

/**
 * A YouTube film's poster, fetched once and kept in the club's own store
 * (`DECISIONS.md` §NNN, AGENTS.md §17, `DECISIONS.md` §69/§110's "nothing is fetched from
 * Google until the reader presses" rule).
 *
 * The *server* fetches YouTube's own thumbnail — a request from this application to
 * `i.ytimg.com`, made once, the same kind of request the editor already makes for its own
 * thumbnail (§110) — re-encodes it through the same `sharp` pipeline every picture goes
 * through, and stores it as an ordinary `media_assets` row behind the four-method adapter. The
 * facade a visitor's browser renders then shows *this* address, never YouTube's, so the
 * privacy property §69 built stands: no third-party request before the click.
 *
 * The row is keyed by the video id itself (`yt-<id>`, not a random UUID): a video embedded on
 * an event and in a page's body at once shares one stored poster rather than fetching and
 * storing it twice, and a repeat save of the same video costs one indexed lookup, not a new
 * fetch. The id is public — it is the whole of what a YouTube link already discloses — so
 * using it as the object key trades nothing away that "opaque keys" (§17) was protecting.
 */

const POSTER_QUALITIES = ["hqdefault", "mqdefault", "default"] as const;

/** Small posters — YouTube's own thumbnails are never larger than 480×360. */
const POSTER_WEB_MAX = 640;
const POSTER_THUMB_MAX = 320;
const POSTER_WEB_QUALITY = 82;
const POSTER_THUMB_QUALITY = 75;

export function posterKeyPrefix(videoId: string): string {
  return `yt-${videoId}`;
}

/** The address the facade would show, whether or not the object has actually been stored yet. */
export function posterUrlFor(videoId: string): string {
  return bodyImageSrc(objectKey(posterKeyPrefix(videoId), "web"));
}

type FetchImage = typeof fetch;

/**
 * How long a single quality is given to answer, however this runs (`DECISIONS.md` §NNN, found by
 * re-review): up to three qualities are tried in sequence, so with no timeout a hanging
 * `i.ytimg.com` could keep a save waiting for minutes — worse, one running inside a transaction
 * would outlive the pool's 30-second `idle_in_transaction_session_timeout` (`src/db/client.ts`)
 * and take the whole save down with it. A poster is a nicety; it is never worth that.
 */
const POSTER_FETCH_TIMEOUT_MS = 3000;

/**
 * A fixture poster, built once in-process with `sharp` — never a request anywhere — for
 * `E2E_STUB_YOUTUBE_POSTER` (`shared/config/env.ts`, found by re-review, `DECISIONS.md` §NNN):
 * the end-to-end suite's own server otherwise makes a real request to `i.ytimg.com` on every
 * save that carries a film, which a CI runner with no route to it turns into either the full
 * fetch timeout on every quality tried or a poster that never arrives — a real dependency the
 * suite never asked for and the spec cannot see.
 */
let stubPosterBytes: Promise<Buffer> | null = null;
function stubYoutubeFetch(): FetchImage {
  return (async (url: string | URL | Request) => {
    const address = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (!address.includes("i.ytimg.com") || !address.endsWith("hqdefault.jpg")) {
      return new Response(null, { status: 404 });
    }
    stubPosterBytes ??= sharp({ create: { width: 480, height: 360, channels: 3, background: "#224488" } })
      .jpeg()
      .toBuffer();
    return new Response(new Uint8Array(await stubPosterBytes), { status: 200 });
  }) as FetchImage;
}

/** `fetch` in every real environment; a network-free fixture only where `E2E_STUB_YOUTUBE_POSTER` says so. */
function defaultPosterFetch(): FetchImage {
  return env.E2E_STUB_YOUTUBE_POSTER ? stubYoutubeFetch() : fetch;
}

/**
 * Tries YouTube's thumbnail sizes from the largest down, and returns the first that answers
 * with actual image bytes. `hqdefault` is on every video that has finished processing;
 * `mqdefault` and `default` are the fallbacks for one that has not, or that was set private
 * after the link was pasted. A network failure, a timeout, a non-2xx answer or an empty body
 * moves to the next quality; nothing there means every quality failed and the caller keeps the
 * old poster or shows the text facade — never a broken image.
 */
export async function fetchYoutubeThumbnail(
  videoId: string,
  fetchImpl: FetchImage = defaultPosterFetch(),
): Promise<Buffer | null> {
  for (const quality of POSTER_QUALITIES) {
    try {
      const response = await fetchImpl(`https://i.ytimg.com/vi/${videoId}/${quality}.jpg`, {
        signal: AbortSignal.timeout(POSTER_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength === 0) continue;
      return bytes;
    } catch {
      // The next quality is tried; a poster is a nicety, never something a save may fail over.
      continue;
    }
  }
  return null;
}

async function processPoster(input: Buffer): Promise<{ web: Buffer; thumb: Buffer; width: number; height: number }> {
  let metadata: Metadata;
  try {
    metadata = await sharp(input).metadata();
  } catch {
    throw new Error("not an image");
  }
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new Error(`unsupported thumbnail format: ${metadata.format ?? "unknown"}`);
  }
  const upright = sharp(input, { failOn: "error" }).rotate();
  const { data: web, info } = await upright
    .clone()
    .resize({ width: POSTER_WEB_MAX, height: POSTER_WEB_MAX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: POSTER_WEB_QUALITY, effort: 6 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await upright
    .clone()
    .resize({ width: POSTER_THUMB_MAX, height: POSTER_THUMB_MAX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: POSTER_THUMB_QUALITY, effort: 6 })
    .toBuffer();
  return { web, thumb, width: info.width, height: info.height };
}

/**
 * Fetches and stores a video's poster if the club does not already have one, and answers with
 * the address to show. Never throws over a fetch or an encode failure — those come back as
 * `null`, which is "no poster could be made", not "the save failed": the caller decides between
 * keeping an older poster and falling back to the text facade.
 */
export async function ensureYoutubePoster<T extends Record<string, unknown>>(
  db: Database<T>,
  videoId: string,
  options: { now?: Date; fetchImpl?: FetchImage } = {},
): Promise<string | null> {
  const keyPrefix = posterKeyPrefix(videoId);
  const [existing] = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(eq(mediaAssets.keyPrefix, keyPrefix))
    .limit(1);
  if (existing) return posterUrlFor(videoId);

  const now = options.now ?? new Date();
  let bytes: Buffer | null;
  try {
    bytes = await fetchYoutubeThumbnail(videoId, options.fetchImpl);
  } catch {
    return null;
  }
  if (!bytes) return null;

  let processed: Awaited<ReturnType<typeof processPoster>>;
  try {
    processed = await processPoster(bytes);
  } catch {
    return null;
  }

  const storage = getStorage();
  const [asset] = await db
    .insert(mediaAssets)
    .values({
      keyPrefix,
      originalFilename: `${videoId}.jpg`,
      width: processed.width,
      height: processed.height,
      byteSize: processed.web.byteLength,
      createdByStaffUserId: null,
      createdAt: now,
      lastReferencedAt: now,
    })
    .onConflictDoNothing({ target: mediaAssets.keyPrefix })
    .returning();

  // A concurrent save fetched the same video first: the row is already there, so use it.
  if (!asset) return posterUrlFor(videoId);

  try {
    await storage.put(objectKey(keyPrefix, "web"), processed.web, "image/webp");
    await storage.put(objectKey(keyPrefix, "thumb"), processed.thumb, "image/webp");
  } catch (error) {
    await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));
    await storage.delete(objectKey(keyPrefix, "web")).catch(() => undefined);
    throw error;
  }

  return posterUrlFor(videoId);
}

/**
 * A minimal shape of a rich-text document — just enough to find and patch its `youtube` blocks
 * without this module importing the rich-text schema (which would make `media` depend on
 * `content`, the wrong direction). `RichText`'s own `RichTextDoc` is structurally this.
 */
type YoutubeBlockLike = {
  type: "youtube";
  attrs: { videoId: string; poster?: string | null; posterSource?: "club" | "youtube" | null; [key: string]: unknown };
};
type OtherBlockLike = { type: string; attrs?: Record<string, unknown> };
type RichTextLike = { type: "doc"; content?: Array<YoutubeBlockLike | OtherBlockLike> };

/**
 * Every `youtube` block in a body whose `poster` is not already set gets one fetched
 * (`DECISIONS.md` §NNN) — a body may embed the same film the event's `video_url` does, or
 * several different films, and each is stored once and keyed by its own video id. A block
 * whose fetch fails is left exactly as parsed (`poster: null`), and `RichTextVideo` falls back
 * to the text facade for that one film — never a broken image, and never a reason to refuse
 * the save.
 */
export async function attachYoutubePosters<T extends Record<string, unknown>, D extends RichTextLike>(
  db: Database<T>,
  doc: D,
  options: { now?: Date; fetchImpl?: FetchImage } = {},
): Promise<D> {
  if (!doc.content || doc.content.length === 0) return doc;
  let changed = false;
  const content = await Promise.all(
    doc.content.map(async (block) => {
      if (block.type !== "youtube") return block;
      const yt = block as YoutubeBlockLike;
      // A club-chosen poster (the panel's own picker) is never replaced by the automatic fetch —
      // an organizer's pick outlives whatever YouTube's own thumbnail happens to be today.
      if (yt.attrs.posterSource === "club") return block;
      if ((yt.attrs.poster ?? null) !== null) return block;
      try {
        const poster = await ensureYoutubePoster(db, yt.attrs.videoId, options);
        if (!poster) return block;
        changed = true;
        return { ...yt, attrs: { ...yt.attrs, poster, posterSource: "youtube" as const } };
      } catch {
        return block;
      }
    }),
  );
  return changed ? ({ ...doc, content } as D) : doc;
}

/**
 * What an event save resolves `video_poster_url` to, given what it is trying to save and what
 * the row already held. `undefined` means "leave the column exactly as it is" — the same
 * discipline every other optional column in `eventColumnsFrom` follows.
 *
 * - No caller mentioned `videoUrl` (§266: no form posts it any more): untouched, *unless* the
 *   row already has a YouTube `video_url` and no poster yet — an event saved before this feature
 *   existed, or whose one fetch failed, gets one more try on its next ordinary save, rather than
 *   keeping the blank rectangle forever because nothing ever posts `videoUrl` again to give
 *   `nextVideoUrl` a value (found by re-review, `DECISIONS.md` §NNN).
 * - Cleared to null: the poster is cleared with it — there is no film to show a poster for.
 * - A link that is not a YouTube link: untouched; the column already means nothing for it.
 * - A YouTube link: a poster is fetched (or reused) for its id. Success stores the new
 *   address. Failure keeps the current poster when the video id did not change (a transient
 *   failure on a save that touched something else), and clears it when the video id did
 *   change (there is nothing yet to show a poster of).
 */
export async function resolveEventVideoPoster<T extends Record<string, unknown>>(
  db: Database<T>,
  input: {
    nextVideoUrl: string | null | undefined;
    currentVideoUrl: string | null;
    currentPosterUrl: string | null;
    videoIdOf: (url: string | null | undefined) => string | null;
    now?: Date;
    fetchImpl?: FetchImage;
  },
): Promise<{ videoPosterUrl?: string | null }> {
  if (input.nextVideoUrl === undefined) {
    if (input.currentPosterUrl !== null) return {};
    const currentVideoId = input.videoIdOf(input.currentVideoUrl);
    if (!currentVideoId) return {};
    try {
      const fetched = await ensureYoutubePoster(db, currentVideoId, { now: input.now, fetchImpl: input.fetchImpl });
      return fetched ? { videoPosterUrl: fetched } : {};
    } catch {
      return {};
    }
  }
  if (input.nextVideoUrl === null) return { videoPosterUrl: null };

  const nextVideoId = input.videoIdOf(input.nextVideoUrl);
  if (!nextVideoId) return {};

  const currentVideoId = input.videoIdOf(input.currentVideoUrl);
  const fallback = currentVideoId === nextVideoId ? input.currentPosterUrl : null;

  try {
    const fetched = await ensureYoutubePoster(db, nextVideoId, { now: input.now, fetchImpl: input.fetchImpl });
    return { videoPosterUrl: fetched ?? fallback };
  } catch {
    return { videoPosterUrl: fallback };
  }
}
