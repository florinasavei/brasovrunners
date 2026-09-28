import type { ImageFileFacts } from "../browser-shrink";
import type { ImageQuality } from "../ladder";

/**
 * The sentence shown after an upload (§414). Mirrors `StoredImageFacts` (`media/service.ts`),
 * which the browser cannot import.
 */
export type StoredFacts = {
  width: number;
  height: number;
  quality: ImageQuality;
  encoding: "lossy" | "nearLossless";
  bytes: number;
  files: number;
  totalBytes: number;
  /** The widest rung below the master (§437), or `null`. */
  topRung: { width: number; bytes: number } | null;
};

export type StoredFactsLabels = {
  /** With `{width}`, `{height}`, `{quality}`, `{size}`, `{files}` and `{total}`. */
  template: string;
  /** Appended when there is a smaller copy, with `{width}` and `{size}` (§437). */
  topRung: string;
  low: string;
  normal: string;
  high: string;
  original: string;
  /** «Mare» or «Originală» that came out near-lossless, with `{quality}` (§437). */
  nearLossless: string;
};

/** What is about to be uploaded (§437); `sent` only when the browser sends another file. */
export type ChosenFacts = { name: string; chosen: ImageFileFacts; sent?: ImageFileFacts };

export type ChosenFactsLabels = {
  /** With `{name}`, `{width}`, `{height}` and `{size}`. */
  chosen: string;
  /** With `{width}`, `{height}` and `{size}`: the browser sent fewer pixels. */
  sent: string;
  /** With `{size}`: the browser re-encoded the file at its own pixels, only to make it lighter. */
  lighter: string;
};

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template);
}

export function describeChosenImage(facts: ChosenFacts, labels: ChosenFactsLabels, lang: string): string {
  const chosen = fill(labels.chosen, {
    name: facts.name,
    width: String(facts.chosen.width),
    height: String(facts.chosen.height),
    size: formatBytes(facts.chosen.bytes, lang),
  });
  if (!facts.sent) return chosen;
  const samePixels = facts.sent.width === facts.chosen.width && facts.sent.height === facts.chosen.height;
  const sent = fill(samePixels ? labels.lighter : labels.sent, {
    width: String(facts.sent.width),
    height: String(facts.sent.height),
    size: formatBytes(facts.sent.bytes, lang),
  });
  return `${chosen} ${sent}`;
}

/** The facts to keep from a prepared upload: `sent` only when the browser sent another file. */
export function chosenFactsOf(name: string, prepared: { chosen: ImageFileFacts; sent: ImageFileFacts; reencoded: boolean }): ChosenFacts {
  return prepared.reencoded ? { name, chosen: prepared.chosen, sent: prepared.sent } : { name, chosen: prepared.chosen };
}

/** "381 KB" or "1,2 MB", in the page's language. */
export function formatBytes(bytes: number, lang: string): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;
}

export function describeStoredImage(facts: StoredFacts, labels: StoredFactsLabels, lang: string): string {
  const level = labels[facts.quality];
  const quality = facts.encoding === "nearLossless" ? labels.nearLossless.replace("{quality}", level) : level;
  const sentence = labels.template
    .replace("{width}", String(facts.width))
    .replace("{height}", String(facts.height))
    .replace("{quality}", quality)
    .replace("{size}", formatBytes(facts.bytes, lang))
    .replace("{files}", String(facts.files))
    .replace("{total}", formatBytes(facts.totalBytes, lang));
  if (!facts.topRung) return sentence;
  return `${sentence} ${fill(labels.topRung, { width: String(facts.topRung.width), size: formatBytes(facts.topRung.bytes, lang) })}`;
}
