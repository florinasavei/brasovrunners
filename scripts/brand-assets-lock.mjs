import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * What the committed rasters were built from (§NNN): each SVG source's sha256 — its line endings normalised to
 * LF first, so a Windows checkout and Linux CI agree — and the palette colours `brand-assets.mjs` paints with,
 * read from `club/club.json`. `yarn brand:assets` writes it to `club/assets.lock.json` beside the rasters it
 * builds; `tests/unit/theme/brand-assets-lock.test.ts` computes it again and fails with «run yarn brand:assets»
 * when a source or a colour moved and the rasters did not.
 */

/** The SVG sources the rasters are drawn from, repository-relative. */
export const BRAND_SOURCES = ["public/brand/logo.svg", "public/brand/logo-white.svg", "public/brand/email-cannot-come.svg"];

/**
 * The club's palette, as the script paints with it: `tints.emailBand` behind the white lockup (the primary when the
 * club leaves it out) and the primary's ink for the glyph — the colours the committed rasters hold, which the lock
 * test reads back from the PNGs themselves.
 */
export function brandColours(root) {
  const { palette } = JSON.parse(readFileSync(path.join(root, "club/club.json"), "utf8"));
  return { emailBand: palette.tints?.emailBand ?? palette.primary, primaryInk: palette.primaryInk };
}

/** The lock's content, as `club/assets.lock.json` holds it. */
export function brandAssetsLock(root) {
  const sources = Object.fromEntries(
    BRAND_SOURCES.map((source) => {
      const text = readFileSync(path.join(root, source), "utf8").replace(/\r\n/g, "\n");
      return [source, createHash("sha256").update(text).digest("hex")];
    }),
  );
  return { sources, colours: brandColours(root) };
}
