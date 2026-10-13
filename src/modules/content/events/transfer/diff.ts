import { hasRichTextContent, readRichText, richTextToPlainText } from "@/modules/content/rich-text/domain/schema";
import type { EventConfig } from "./file-format";
import { type MediaKind, mapMediaUrls, TEXT_BOXES } from "./media";

/**
 * What an import over an event would change, field by field (§NNN): the file's configuration against
 * the target's, both read by the one function (`export.ts#configFromRows`), so a field that is the
 * same is the same and one that differs is shown with both sides — in both languages, the pictures
 * named.
 *
 * Pictures are compared by the hash of their bytes, not by their address — an address differs between
 * environments for the very same picture — so a cover that is the same photograph is not a change and
 * is not copied again. Nothing here reads the database or the store: the caller hands the digests in.
 */

/** One side of a change, as the page draws it in the reader's own words. */
export type ChangeValue =
  | { type: "empty" }
  | { type: "boolean"; value: boolean }
  | { type: "text"; value: string }
  | { type: "picture"; known: boolean }
  | { type: "document"; text: string; pictures: number };

export type ConfigChange = {
  /** The leaf's dotted path in the configuration, e.g. `translations.ro.title` or `registration.capacity`. */
  key: string;
  /** The message key of its label — the path with the language taken out (`translations.title`). */
  label: string;
  /** The language a per-language field is in, or null. */
  locale: "ro" | "en" | null;
  from: ChangeValue;
  to: ChangeValue;
};

const DOCUMENT_PATH = new RegExp(`^translations\\.(?:ro|en)\\.(?:${TEXT_BOXES.join("|")})$`);
/** Leaves that are objects the page shows whole: a rich text document, and a picture's crop. */
const isWhole = (path: string) => DOCUMENT_PATH.test(path) || /(?:^|\.)crop$/i.test(path) || /Crop$/.test(path);

/** The configuration's leaves by dotted path; arrays and the whole-objects above are one leaf each. */
export function leavesOf(value: unknown, path = "", out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && !isWhole(path)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) leavesOf(child, path === "" ? key : `${path}.${key}`, out);
  } else {
    out.set(path, value);
  }
  return out;
}

/** How a picture reads while two configurations are compared: its hash, or its address when the hash is not known. */
export const PICTURE_PREFIX = { digest: "sha256:", address: "url:" } as const;

/** A copy of the configuration whose every picture's address is replaced by its digest, for comparing two of them. */
export function comparable(config: EventConfig, digestOf: (url: string, kind: MediaKind) => string | null): EventConfig {
  return mapMediaUrls(config, (url, kind) => {
    const digest = digestOf(url, kind);
    return digest ? `${PICTURE_PREFIX.digest}${digest}` : `${PICTURE_PREFIX.address}${url}`;
  });
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function picturesIn(node: unknown): number {
  if (Array.isArray(node)) return node.reduce<number>((sum, child) => sum + picturesIn(child), 0);
  if (typeof node !== "object" || node === null) return 0;
  const record = node as Record<string, unknown>;
  return (record.type === "image" ? 1 : 0) + Object.values(record).reduce<number>((sum, child) => sum + picturesIn(child), 0);
}

const MAX_TEXT = 240;
const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);

/** One leaf as a value the page can draw. */
export function changeValueOf(path: string, value: unknown): ChangeValue {
  if (value === null || value === undefined || value === "") return { type: "empty" };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (DOCUMENT_PATH.test(path)) {
    const document = readRichText(value);
    return hasRichTextContent(document)
      ? { type: "document", text: clip(richTextToPlainText(document).replace(/\s+/g, " ").trim()), pictures: picturesIn(value) }
      : { type: "empty" };
  }
  if (typeof value === "string" && (value.startsWith(PICTURE_PREFIX.digest) || value.startsWith(PICTURE_PREFIX.address))) {
    return { type: "picture", known: value.startsWith(PICTURE_PREFIX.digest) };
  }
  if (typeof value === "string") return { type: "text", value: clip(value) };
  if (typeof value === "number") return { type: "text", value: String(value) };
  return { type: "text", value: clip(JSON.stringify(value)) };
}

/** The message key and the language of a leaf's label: `translations.ro.title` is `translations.title` in `ro`. */
export function labelOf(path: string): { label: string; locale: "ro" | "en" | null } {
  const match = /^translations\.(ro|en)\.(.+)$/.exec(path);
  if (match) return { label: `translations.${match[2]}`, locale: match[1] as "ro" | "en" };
  const named = /^place\.name\.(ro|en)$/.exec(path);
  if (named) return { label: "place.name", locale: named[1] as "ro" | "en" };
  return { label: path, locale: null };
}

/**
 * Every leaf that differs between the file's configuration and the target's, in the configuration's own
 * order. Both arguments are compared as `comparable` copies: pictures by digest.
 */
export function diffConfigs(incoming: EventConfig, current: EventConfig): ConfigChange[] {
  const before = leavesOf(current);
  const after = leavesOf(incoming);
  const changes: ConfigChange[] = [];
  // Every path either side has: an object on one side and null on the other have different leaves, and
  // a leaf missing from a side is the same answer as an empty one.
  for (const key of new Set([...after.keys(), ...before.keys()])) {
    const to = after.get(key) ?? null;
    const from = before.get(key) ?? null;
    if (sameJson(from, to)) continue;
    changes.push({ key, ...labelOf(key), from: changeValueOf(key, from), to: changeValueOf(key, to) });
  }
  return changes;
}
