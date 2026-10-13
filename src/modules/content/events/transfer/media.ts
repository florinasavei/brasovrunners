import { createHash } from "node:crypto";
import { mediaAssets } from "@/db/schema/gallery";
import type { Database } from "@/db/types";
import { MAX_GPX_BYTES } from "@/modules/events/domain/route-gpx";
import { MAX_UPLOAD_BYTES } from "@/modules/media/limits";
import { ladderFromStoredMaster } from "@/modules/media/images";
import { newAssetKeyPrefix, putImageObjects } from "@/modules/media/service";
import { bodyImageSrc, objectKey, type Storage } from "@/modules/media/storage";
import type { EventConfig, MediaEntry } from "./file-format";

/**
 * The pictures and the file an event points to — found in its configuration, named in the file, and
 * copied into another environment's own storage on import (§NNN).
 *
 * Three rules hold everything here:
 *
 * - **By address, never by id.** A picture is `…/<uuid>/web.webp` on the store's public host; its row in
 *   `media_assets` has an id that means nothing elsewhere. The file names the address, the size and the
 *   SHA-256 of the bytes, and nothing about the row.
 * - **What is fetched is checked before anything is stored.** The address must be https (http only
 *   where the environment is the developer's), a name rather than an IP address or a local host, and of
 *   the shape this site's own pictures have; the answer must be the size and the hash the file said,
 *   within a ceiling, read with no redirect followed. A server asked to download from an address in a
 *   file somebody wrote is a server that could be pointed anywhere, so the hash is the real guard: bytes
 *   that are not the ones the exporting site hashed are never stored, and so never read back.
 * - **A medium that cannot be had is left empty and listed**, never a reason to refuse the event.
 */

export type MediaKind = "image" | "gpx";

/** One place in a configuration that names a medium. */
export type MediaRef = { role: string; url: string; kind: MediaKind };

/** The boxes of one language's texts that may carry a picture. */
export const TEXT_BOXES = ["excerptBody", "body", "rules", "schedule", "routeDescription"] as const;
const LOCALES = ["ro", "en"] as const;

/** The bib design's four picture places, by their dotted path inside the design. */
const BIB_PICTURES = [
  { role: "bib.header", path: ["headerImageSrc"] },
  { role: "bib.sponsors", path: ["sponsorImageSrc"] },
  { role: "bib.member.header", path: ["member", "headerImageSrc"] },
  { role: "bib.member.card", path: ["member", "cardImageSrc"] },
] as const;

/** The words' key of a medium's role (`Admin.eventJson.roles.<key>`): the five places a picture sits, and the GPX. */
export type MediaRoleKey = "cover" | "bibHeader" | "bibSponsors" | "bibMemberHeader" | "bibMemberCard" | "text" | "gpx";
export const MEDIA_ROLE_KEYS: readonly MediaRoleKey[] = ["cover", "bibHeader", "bibSponsors", "bibMemberHeader", "bibMemberCard", "text", "gpx"];

export function mediaRoleKey(role: string): MediaRoleKey {
  switch (role) {
    case "cover":
      return "cover";
    case "bib.header":
      return "bibHeader";
    case "bib.sponsors":
      return "bibSponsors";
    case "bib.member.header":
      return "bibMemberHeader";
    case "bib.member.card":
      return "bibMemberCard";
    case "route.gpx":
      return "gpx";
    default:
      return "text";
  }
}

const IMAGE_TAIL =/(?:^|\/)([a-z]+\/[0-9a-f-]{36}\/web\.webp)$/;
const GPX_TAIL = /(?:^|\/)([a-z]+\/route-gpx\/[0-9a-f-]{36}\/[a-z0-9-]{1,60}\.gpx)$/;

/** The store key behind a public address, or null when the address is none of this site's. */
export function storeKeyOfUrl(url: string, kind: MediaKind): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  return (kind === "gpx" ? GPX_TAIL : IMAGE_TAIL).exec(pathname)?.[1] ?? null;
}

type Json = unknown;

/** Every `image` figure of a rich document, wherever it is nested (a table's cell, a list item). */
function imageSources(node: Json, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) imageSources(child, found);
  } else if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>;
    const attrs = record.attrs as { src?: unknown } | undefined;
    if (record.type === "image" && typeof attrs?.src === "string") found.push(attrs.src);
    for (const value of Object.values(record)) if (typeof value === "object") imageSources(value, found);
  }
  return found;
}

function bibPictureAt(design: Record<string, unknown>, path: readonly string[]): string | null {
  let cursor: unknown = design;
  for (const key of path) {
    if (typeof cursor !== "object" || cursor === null) return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" && cursor !== "" ? cursor : null;
}

/** Every medium the configuration names, once per place (the same address in two places is two refs, one fetch). */
export function collectMediaRefs(config: EventConfig): MediaRef[] {
  const refs: MediaRef[] = [];
  if (config.cover) refs.push({ role: "cover", url: config.cover.url, kind: "image" });
  for (const { role, path } of BIB_PICTURES) {
    const url = bibPictureAt(config.bib.design, path);
    if (url) refs.push({ role, url, kind: "image" });
  }
  for (const locale of LOCALES) {
    for (const box of TEXT_BOXES) {
      for (const src of imageSources(config.translations[locale][box])) refs.push({ role: `text.${locale}.${box}`, url: src, kind: "image" });
    }
  }
  if (config.route.gpx) refs.push({ role: "route.gpx", url: config.route.gpx.url, kind: "gpx" });
  return refs;
}

/** A configuration with every picture's address replaced; `null` takes the picture out (a figure of a text, a place of the design, the cover, the GPX). */
export function mapMediaUrls(config: EventConfig, replace: (url: string, kind: MediaKind) => string | null): EventConfig {
  const mapDocument = (node: Json): Json => {
    if (Array.isArray(node)) {
      return node.flatMap((child) => (isImageFigure(child) && replace(child.attrs.src, "image") === null ? [] : [mapDocument(child)]));
    }
    if (typeof node !== "object" || node === null) return node;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) next[key] = mapDocument(value);
    if (isImageFigure(node)) next.attrs = { ...node.attrs, src: replace(node.attrs.src, "image") };
    return next;
  };

  const design = structuredClone(config.bib.design) as Record<string, unknown>;
  for (const { path } of BIB_PICTURES) {
    const parent = path.length === 1 ? design : (design[path[0]] as Record<string, unknown> | undefined);
    const key = path[path.length - 1];
    if (!parent || typeof parent[key] !== "string" || parent[key] === "") continue;
    parent[key] = replace(parent[key] as string, "image");
  }

  const translations = { ...config.translations };
  for (const locale of LOCALES) {
    const row = { ...translations[locale] };
    for (const box of TEXT_BOXES) {
      const doc = row[box];
      if (doc) row[box] = mapDocument(doc) as Record<string, unknown>;
    }
    translations[locale] = row;
  }

  const cover = config.cover ? (replace(config.cover.url, "image") === null ? null : { ...config.cover, url: replace(config.cover.url, "image") as string }) : null;
  const gpx = config.route.gpx ? (replace(config.route.gpx.url, "gpx") === null ? null : { ...config.route.gpx, url: replace(config.route.gpx.url, "gpx") as string }) : null;
  return { ...config, cover, route: { ...config.route, gpx }, bib: { ...config.bib, design }, translations };
}

function isImageFigure(node: unknown): node is { type: "image"; attrs: { src: string } } {
  if (typeof node !== "object" || node === null) return false;
  const record = node as { type?: unknown; attrs?: { src?: unknown } };
  return record.type === "image" && typeof record.attrs?.src === "string";
}

// --- Reading what the store holds, for the file ------------------------------------------------

/** The bytes behind a medium's address, from this environment's own store, or null when there are none. */
export async function readStoredMedium(storage: Storage, ref: MediaRef): Promise<Buffer | null> {
  const key = storeKeyOfUrl(ref.url, ref.kind);
  return key ? storage.get(key) : null;
}

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/**
 * The file's list of media: one entry per distinct address, each with the size and the hash of what
 * the store holds. An address the store cannot answer is listed with no size and no hash, so the
 * importing side says it could not be verified rather than guessing.
 */
export async function describeMedia(refs: readonly MediaRef[], read: (ref: MediaRef) => Promise<Buffer | null>): Promise<MediaEntry[]> {
  const entries: MediaEntry[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.url)) continue;
    seen.add(ref.url);
    const bytes = await read(ref).catch(() => null);
    entries.push({
      role: ref.role,
      url: ref.url,
      contentType: ref.kind === "gpx" ? "application/gpx+xml" : "image/webp",
      size: bytes ? bytes.byteLength : null,
      sha256: bytes ? sha256Hex(bytes) : null,
    });
  }
  return entries;
}

// --- Fetching a medium from another environment ------------------------------------------------

/** What a medium that was not copied is listed with — the words are `Admin.eventJson.media.<reason>`. */
export type MediaFailure = "refused" | "unverifiable" | "unreachable" | "tooLarge" | "sizeMismatch" | "hashMismatch" | "notAPicture" | "noStorage";

export type FetchedMedium = { ok: true; bytes: Buffer } | { ok: false; reason: MediaFailure };

/** The ceiling per medium: a stored picture's master can be a few megabytes near-lossless; a GPX is four at most. */
export const MAX_MEDIUM_BYTES = { image: Math.max(12 * 1024 * 1024, MAX_UPLOAD_BYTES), gpx: MAX_GPX_BYTES } as const;

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Whether the address may be fetched at all (§NNN): https — or http where the environment is a
 * developer's, `local` or `test` — and a name, never an IP literal, `localhost` or an internal suffix;
 * and of the shape this site's own objects have, so the request can only ask for a stored picture or GPX.
 */
export function isFetchableMediaUrl(url: string, kind: MediaKind, options: { allowHttp: boolean }): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (parsed.protocol !== "https:" && !(options.allowHttp && parsed.protocol === "http:")) return false;
  if (!options.allowHttp) {
    const host = parsed.hostname.toLowerCase();
    // An IPv4 or IPv6 literal, `localhost`, or a name that only resolves inside a network.
    if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[") || host === "localhost" || /\.(?:local|internal|localhost|lan|home|corp)$/.test(host) || !host.includes(".")) return false;
  }
  return storeKeyOfUrl(url, kind) !== null;
}

/** The body of a response, read up to a ceiling: `null` when it is longer, so a huge answer is never held in memory. */
async function readCapped(response: Response, max: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * One medium from the address the file gives, checked against what the file says about it: the size,
 * then the SHA-256. Nothing is stored here; the caller stores what this returns.
 */
export async function fetchVerifiedMedium(
  entry: Pick<MediaEntry, "url" | "size" | "sha256"> | undefined,
  ref: MediaRef,
  options: { allowHttp: boolean; fetchImpl?: typeof fetch },
): Promise<FetchedMedium> {
  if (!entry || entry.size === null || entry.sha256 === null) return { ok: false, reason: "unverifiable" };
  if (!isFetchableMediaUrl(ref.url, ref.kind, options)) return { ok: false, reason: "refused" };
  const max = MAX_MEDIUM_BYTES[ref.kind];
  if (entry.size > max) return { ok: false, reason: "tooLarge" };
  let body: Buffer | null;
  try {
    const response = await (options.fetchImpl ?? fetch)(ref.url, { redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: ref.kind === "gpx" ? "application/gpx+xml,*/*" : "image/webp,image/*,*/*" } });
    if (!response.ok) return { ok: false, reason: "unreachable" };
    body = await readCapped(response, max);
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (body === null) return { ok: false, reason: "tooLarge" };
  if (body.byteLength !== entry.size) return { ok: false, reason: "sizeMismatch" };
  if (sha256Hex(body) !== entry.sha256) return { ok: false, reason: "hashMismatch" };
  return { ok: true, bytes: body };
}

// --- Storing it here ---------------------------------------------------------------------------

/**
 * A picture's master stored as another environment's own — the master as it is, a new opaque key
 * prefix (so no cache anywhere has seen the address), and the ladder the site makes under every stored
 * picture (`ladderFromStoredMaster`, the one pipeline the older pictures' button uses) — with its row in
 * `media_assets`, so the pictures page lists it, the sweep keeps it while something names it and
 * takes it a week after nothing does. The bytes must be a WebP the size of a picture (the same check
 * every stored master gets); anything else is refused and nothing is written.
 */
export async function storeCopiedPicture<T extends Record<string, unknown>>(
  db: Database<T>,
  storage: Storage,
  input: { actorId: string; bytes: Buffer; originalFilename: string; now: Date },
): Promise<{ assetId: string; src: string } | { refused: "notAPicture" }> {
  let ladder: Awaited<ReturnType<typeof ladderFromStoredMaster>>;
  try {
    ladder = await ladderFromStoredMaster(input.bytes);
  } catch {
    return { refused: "notAPicture" };
  }
  const keyPrefix = newAssetKeyPrefix();
  await putImageObjects(storage, keyPrefix, {
    web: input.bytes,
    thumb: ladder.thumb,
    rungs: ladder.rungs,
    width: ladder.width,
    height: ladder.height,
    quality: "normal",
    encoding: "lossy",
  });
  const [asset] = await db
    .insert(mediaAssets)
    .values({
      keyPrefix,
      originalFilename: input.originalFilename.slice(0, 255),
      width: ladder.width,
      height: ladder.height,
      byteSize: input.bytes.byteLength,
      createdByStaffUserId: input.actorId,
      createdAt: input.now,
      lastReferencedAt: input.now,
    })
    .returning({ id: mediaAssets.id });
  return { assetId: asset.id, src: bodyImageSrc(objectKey(keyPrefix, "web")) };
}
