import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { KIT_DIR, kitFiles } from "./brand-kit.mjs";

/**
 * What the committed rasters were built from (§885): each SVG source's sha256 — its line endings normalised to
 * LF first, so a Windows checkout and Linux CI agree — and the palette colours `brand-assets.mjs` paints with,
 * read from `club/club.json`. `yarn brand:assets` writes it to `club/assets.lock.json` beside the rasters it
 * builds; `tests/unit/theme/brand-assets-lock.test.ts` computes it again and fails with «run yarn brand:assets»
 * when a source or a colour moved and the rasters did not.
 *
 * Since §NNN it locks the «PR Kit»'s logo files too (`brand-kit.mjs`): each SVG and PNG in `public/brand/kit/`,
 * named from the club's slug, by its sha256 — an SVG's text with LF endings, a PNG's bytes as they are — so a kit
 * file changed or left behind without the script fails the same test.
 */

/** The SVG sources the rasters are drawn from, repository-relative. */
export const BRAND_SOURCES = ["public/brand/logo.svg", "public/brand/logo-white.svg", "public/brand/email-cannot-come.svg", "public/brand/email-reconfirm.svg"];

/** The club's own file, as the script and the lock read it. */
export function clubConfig(root) {
  return JSON.parse(readFileSync(path.join(root, "club/club.json"), "utf8"));
}

/**
 * The club's palette, as the script paints with it: `tints.emailBand` behind the white lockup (the primary when the
 * club leaves it out), the primary's ink for the glyph, and the primary itself — the kit's coloured logo (§NNN) — the
 * colours the committed rasters hold, which the lock test reads back from the PNGs themselves.
 */
export function brandColours(root) {
  const { palette } = clubConfig(root);
  return { emailBand: palette.tints?.emailBand ?? palette.primary, primaryInk: palette.primaryInk, primary: palette.primary };
}

/** A file's sha256: an SVG's text with LF endings, any other file's bytes. */
function digest(file) {
  const bytes = readFileSync(file);
  const content = file.endsWith(".svg") ? bytes.toString("utf8").replace(/\r\n/g, "\n") : bytes;
  return createHash("sha256").update(content).digest("hex");
}

/** The lock's content, as `club/assets.lock.json` holds it. */
export function brandAssetsLock(root) {
  const sources = Object.fromEntries(BRAND_SOURCES.map((source) => [source, digest(path.join(root, source))]));
  const kit = Object.fromEntries(kitFiles(clubConfig(root).slug).map(({ name }) => [`${KIT_DIR}/${name}`, digest(path.join(root, KIT_DIR, name))]));
  return { sources, colours: brandColours(root), kit };
}
