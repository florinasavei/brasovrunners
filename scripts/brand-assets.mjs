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
    // Kept for any message that still wants a blue band; the card's own header is white
    // since §189.
    background: "#1a1aff",
  },
  {
    source: "public/brand/logo.svg",
    target: "public/brand/logo-email.png",
    width: 720,
    /*
      The lockup in its own colours, on white — the email card's header since §189.

      The band was the club's blue with the white lockup on it, and the owner, looking at a
      confirmation: "nu îmi place headerul ăsta albastru, nu se potrivește cu logo-ul BVR". He is
      right about what it looks like: the lockup already contains a blue field, so a blue band
      around a blue field reads as a sticker stuck on a wall rather than as a letterhead. White is
      what the site's own header does with the same lockup.

      No alpha, like the PDF's above: several mail clients composite a transparent PNG onto
      whatever they please, which on a dark theme is a dark field under a dark-blue logo.
    */
    background: "#ffffff",
  },
  {
    source: "public/brand/logo-white.svg",
    target: "src/theme/pdf/logo-white.png",
    width: 720,
    /*
      No background at all, which is the one output here that keeps an alpha channel.

      A bib's header band is the **event's** colour (§173) — a race can be green or red — so
      the lockup cannot be baked onto the club's blue the way the email's is. It has to arrive
      transparent and be drawn over whatever the band is.

      Which means the caveat at the top of this file applies, and the way round it is the
      encoding: this one is written as 8-bit RGBA (`palette: false`), never indexed. An indexed
      PNG carries its transparency in a `tRNS` chunk, and that is the shape pdfkit composites
      badly — it is what turned the filled blue lockup into a thin outline in the declaration.
      A straight RGBA image reaches a PDF as an image plus a soft mask, which is the ordinary,
      well-trodden path, and it is also what `next/og` wants for the same picture.
    */
    background: null,
  },
];

for (const { source, target, width, background } of OUTPUTS) {
  const svg = await readFile(source);
  const raster = sharp(svg, { density: 600 }).resize({ width, fit: "inside" });
  if (background) raster.flatten({ background });
  const png = await raster.png({ compressionLevel: 9, palette: background !== null }).toBuffer();
  await writeFile(target, png);
  const { width: w, height: h, hasAlpha } = await sharp(png).metadata();
  console.log(`${path.basename(target)}: ${w}x${h}, alpha ${hasAlpha ? "yes" : "no"}, ${(png.byteLength / 1024).toFixed(1)} KiB`);
}
