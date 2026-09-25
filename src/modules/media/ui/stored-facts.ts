import type { ImageQuality } from "../ladder";

/**
 * The sentence shown after an upload (§NNN): what the picture became, in the words of the
 * catalogue. Pure — the two upload islands call it with the answer the route gave — so a test
 * can read it without a browser.
 *
 * The facts are the server's (`StoredImageFacts` in `media/service.ts`), repeated here as a
 * plain type because this file runs in the browser and that one imports the database.
 */
export type StoredFacts = {
  width: number;
  height: number;
  quality: ImageQuality;
  encoding: "lossy" | "nearLossless";
  bytes: number;
  files: number;
  totalBytes: number;
};

export type StoredFactsLabels = {
  /** With `{width}`, `{height}`, `{quality}`, `{size}`, `{files}` and `{total}`. */
  template: string;
  normal: string;
  high: string;
  /** "High" that came out near-lossless: a poster, a screenshot, lettering. */
  nearLossless: string;
};

/** "381 KB" or "1,2 MB", in the page's language. */
export function formatBytes(bytes: number, lang: string): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;
}

export function describeStoredImage(facts: StoredFacts, labels: StoredFactsLabels, lang: string): string {
  const quality =
    facts.quality === "normal" ? labels.normal : facts.encoding === "nearLossless" ? labels.nearLossless : labels.high;
  return labels.template
    .replace("{width}", String(facts.width))
    .replace("{height}", String(facts.height))
    .replace("{quality}", quality)
    .replace("{size}", formatBytes(facts.bytes, lang))
    .replace("{files}", String(facts.files))
    .replace("{total}", formatBytes(facts.totalBytes, lang));
}
