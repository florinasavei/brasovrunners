import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * The club's lockup as the rasters the PDFs and the emails need (`DECISIONS.md` §174).
 *
 * The source of truth is `public/brand/logo.svg` and its white twin; SVG is what the site
 * serves and what a review can read. Two places cannot take it:
 *
 *   - **a PDF**, because pdfkit draws rasters, not vectors. The file it used carried an alpha
 *     channel, and an alpha PNG reaches a PDF as an image plus a soft mask — which some viewers
 *     and most printers composite badly, and which is how the club's filled blue lockup came out
 *     of the declaration as a thin outline (the owner: "logo-ul nu apare colorat frumos cu
 *     albastru în declarație"). Flattened onto white there is no mask at all, so nothing can
 *     get it wrong, and every page these are drawn on is white.
 *   - **an email**, because half the mail clients in use refuse SVG entirely.
 *
 * Run it after changing the source: `node scripts/brand-assets.mjs`. The outputs are committed,
 * because a build that rasterised on the fly would put a native dependency in the way of `next
 * build` for a file that changes once a year.
 */

const OUTPUTS = [
  {
    source: "public/brand/logo.svg",
    target: "src/theme/pdf/logo.png",
    width: 1200,
    // No alpha: see above. White, because a PDF page is white.
    background: "#ffffff",
  },
  {
    source: "public/brand/logo-white.svg",
    target: "public/brand/logo-white-email.png",
    width: 720,
    // The email's header band is the club's blue, and the lockup sits on it.
    background: "#1a1aff",
  },
];

for (const { source, target, width, background } of OUTPUTS) {
  const svg = await readFile(source);
  const png = await sharp(svg, { density: 600 })
    .resize({ width, fit: "inside" })
    .flatten({ background })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  await writeFile(target, png);
  const { width: w, height: h, hasAlpha } = await sharp(png).metadata();
  console.log(`${path.basename(target)}: ${w}x${h}, alpha ${hasAlpha ? "yes" : "no"}, ${(png.byteLength / 1024).toFixed(1)} KiB`);
}
