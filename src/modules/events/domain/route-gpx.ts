/**
 * «Traseul»'s GPX file (§718): the track the club uploads to the site's own storage (`AGENTS.md`
 * §17), so a runner downloads it from the event page and loads it on a watch — beside the
 * Strava and Garmin Connect maps, and beside the GPX *link* kind of «Linkuri și fișiere» (§332),
 * which stays for a file the club keeps elsewhere.
 *
 * Pure: the checks the upload applies, the key it writes under, and the reader of the stored
 * column. The object is never a `media_assets` row, so the pictures' sweep (`media/references.ts`)
 * never sees it; it is deleted when the last event row naming its key lets go of it
 * (`content/events/route-gpx.ts`).
 */

/**
 * The largest file accepted: four megabytes. A long trail's track with a point every second is
 * well under one; and a request to a function on the host carries at most 4.5 MB, so a larger
 * file could not arrive anyway.
 */
export const MAX_GPX_BYTES = 4 * 1024 * 1024;

/** What the event row stores (`events.route_gpx`). */
export type RouteGpx = {
  /** `<env>/route-gpx/<uuid>/<file>.gpx` — the object in the store. */
  key: string;
  /** The file's name as the club uploaded it, for the editor and the page's small print. */
  name: string;
  /** Bytes. */
  size: number;
  /** ISO instant. */
  uploadedAt: string;
};

/** The key's shape, the database's CHECK said again (`events_route_gpx_names_a_gpx_key`). */
export const ROUTE_GPX_KEY = /^[a-z]+\/route-gpx\/[0-9a-f-]{36}\/[a-z0-9-]{1,60}\.gpx$/;

const MAX_NAME_LENGTH = 120;

/**
 * The file's own name for the download, from what the club called it: the letters without their
 * accents, lower-cased, every other run of characters one hyphen, at most sixty — «Traseu Tâmpa
 * 2026.gpx» downloads as `traseu-tampa-2026.gpx`. A name with nothing left is `traseu`.
 */
export function gpxFileStem(name: string): string {
  const stem = name
    .replace(/\.gpx$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return stem === "" ? "traseu" : stem;
}

/** The object key of a new upload: the environment, a fresh id, the download's own name. */
export function routeGpxKey(environment: string, id: string, name: string): string {
  return `${environment}/route-gpx/${id}/${gpxFileStem(name)}.gpx`;
}

/** The download's file name, read off the key. */
export function routeGpxFileName(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}

/** Whether a stored object's key is a GPX the upload wrote — what the media route serves as one. */
export function isRouteGpxKey(key: string): boolean {
  return ROUTE_GPX_KEY.test(key);
}

/** The headers a GPX is served with, from the store or from `/api/media`: a file to save, not a page. */
export function routeGpxHeaders(key: string): { contentType: string; contentDisposition: string } {
  return { contentType: "application/gpx+xml", contentDisposition: `attachment; filename="${routeGpxFileName(key)}"` };
}

/** The name as shown: no control characters, no path, at most 120 characters. */
export function cleanGpxName(name: string): string {
  const base = name.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (base === "" ? "traseu.gpx" : base).slice(0, MAX_NAME_LENGTH);
}

export type GpxRefusal = "empty" | "tooLarge" | "notXml" | "notGpx";

/**
 * Whether the bytes are a GPX document, by what they are and never by the file's extension: UTF-8
 * text, an optional XML declaration, comments or processing instructions, then the root element
 * `<gpx …>` — a namespace prefix allowed (`<gpx:gpx>`), a `<!DOCTYPE>` refused (a GPX has none, and
 * an entity declaration is the one thing an XML file may carry that is worth refusing) — and the
 * document closes the same element at its end. Not a validating parse: the club's watch reads the
 * file, the site keeps it as it was given.
 */
export function checkGpx(bytes: Uint8Array): { ok: true } | { ok: false; reason: GpxRefusal } {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  if (bytes.byteLength > MAX_GPX_BYTES) return { ok: false, reason: "tooLarge" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "notXml" };
  }
  text = text.replace(/^﻿/, "").trim();
  if (!text.startsWith("<")) return { ok: false, reason: "notXml" };
  // The prolog: the declaration, comments, processing instructions, whitespace.
  let rest = text;
  for (;;) {
    const prolog = /^(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->)\s*/.exec(rest);
    if (!prolog) break;
    rest = rest.slice(prolog[0].length);
  }
  if (/^<!DOCTYPE/i.test(rest)) return { ok: false, reason: "notGpx" };
  const root = /^<((?:[A-Za-z_][\w.-]*:)?gpx)(?=[\s/>])/.exec(rest);
  if (!root) return { ok: false, reason: /^<[A-Za-z_]/.test(rest) ? "notGpx" : "notXml" };
  const closing = new RegExp(`</${root[1].replace(/[.]/g, "\\.")}\\s*>(?:\\s|<!--[\\s\\S]*?-->)*$`);
  if (!closing.test(rest)) return { ok: false, reason: "notXml" };
  return { ok: true };
}

/** The stored column as a file, or null when it is none or not one this release understands. */
export function readRouteGpx(stored: unknown): RouteGpx | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const { key, name, size, uploadedAt } = stored as Record<string, unknown>;
  if (typeof key !== "string" || !isRouteGpxKey(key)) return null;
  return {
    key,
    name: typeof name === "string" && name.trim() !== "" ? cleanGpxName(name) : routeGpxFileName(key),
    size: typeof size === "number" && Number.isFinite(size) && size >= 0 ? Math.round(size) : 0,
    uploadedAt: typeof uploadedAt === "string" ? uploadedAt : "",
  };
}

/**
 * The editor's hidden input, as posted: the JSON the upload answered, or "" for «Scoate». A value
 * that is neither — not JSON, not a GPX key (of `environment`, when it is given) — is refused
 * (`undefined`), never stored; the save asks for this environment's, so a row cannot be pointed at
 * another environment's object.
 */
export function readPostedRouteGpx(posted: string, environment: string | null = null): RouteGpx | null | undefined {
  if (posted.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(posted);
  } catch {
    return undefined;
  }
  const gpx = readRouteGpx(parsed);
  if (!gpx || (environment !== null && !gpx.key.startsWith(`${environment}/route-gpx/`))) return undefined;
  return gpx;
}

/** The size in the reader's language: `850 KB`, `1,2 MB` / `1.2 MB`. */
export function gpxSizeWords(size: number, locale: string): string {
  if (size < 1024 * 1024) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(1, Math.round(size / 1024)))} KB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size / (1024 * 1024))} MB`;
}
