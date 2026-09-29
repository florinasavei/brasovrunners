import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * The club's lockup as the rasters the PDFs and the emails need (`DECISIONS.md` §174): pdfkit
 * draws no SVG and many mail clients refuse it. Flattened onto white, since an alpha PNG in a PDF
 * composites badly on some viewers and printers. Run after changing the SVG source; the outputs
 * are committed so `next build` needs no native dependency.
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
    // For a message that still wants a blue band; the card's header is white since §189.
    background: "#1a1aff",
  },
  {
    source: "public/brand/logo.svg",
    target: "public/brand/logo-email.png",
    width: 720,
    // The lockup on white, the email card's header (§189); no alpha, which dark themes composite badly.
    background: "#ffffff",
  },
  {
    source: "public/brand/logo.svg",
    target: "public/brand/logo-email-banner.png",
    width: 1200,
    background: "#ffffff",
    /*
      The email's letterhead, edge to edge (§239): the white band is the picture itself, the
      600-pixel card at 2×, because a dark-theme client re-colours a cell but not a PNG.
    */
    canvas: { height: 340, inner: { width: 620, height: 210 } },
  },
  {
    source: "public/brand/logo-white.svg",
    target: "src/theme/pdf/logo-white.png",
    width: 720,
    /*
      The one output with alpha: a bib's band is the event's colour (§173). Written as 8-bit RGBA
      (`palette: false`), never indexed: pdfkit composites an indexed PNG's `tRNS` badly.
    */
    background: null,
  },
];

for (const { source, target, width, background, canvas } of OUTPUTS) {
  const svg = await readFile(source);
  const raster = canvas
    ? // A banner: the lockup fitted in its box, centred on the full canvas.
      sharp(
        await sharp(svg, { density: 600 })
          .resize({ width: canvas.inner.width, height: canvas.inner.height, fit: "inside" })
          .png()
          .toBuffer(),
      ).resize({
        width,
        height: canvas.height,
        fit: "contain",
        background,
      })
    : sharp(svg, { density: 600 }).resize({ width, fit: "inside" });
  if (background) raster.flatten({ background });
  const png = await raster.png({ compressionLevel: 9, palette: background !== null }).toBuffer();
  await writeFile(target, png);
  const { width: w, height: h, hasAlpha } = await sharp(png).metadata();
  console.log(`${path.basename(target)}: ${w}x${h}, alpha ${hasAlpha ? "yes" : "no"}, ${(png.byteLength / 1024).toFixed(1)} KiB`);
}
