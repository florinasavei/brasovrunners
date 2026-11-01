import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { brandAssetsLock, brandColours } from "./brand-assets-lock.mjs";

/**
 * `yarn brand:assets` — the club's lockup as the rasters the PDFs and the emails need (`DECISIONS.md` §174): pdfkit
 * draws no SVG and many mail clients refuse it. Flattened onto white, since an alpha PNG in a PDF
 * composites badly on some viewers and printers. Run after changing the SVG source or the palette in
 * `club/club.json`; the outputs are committed so `next build` needs no native dependency.
 *
 * Its colours are the club's (§885): the palette's `tints.emailBand` behind the white lockup (the primary
 * when a club leaves it out), the primary's ink for the glyph, read from `club/club.json`; white is the page's. It ends by writing `club/assets.lock.json` —
 * each source's sha256 and those colours — which `tests/unit/theme/brand-assets-lock.test.ts` holds the
 * sources to, so a changed source without a rebuild fails the tests. `--lock-only` writes the lock alone,
 * for a change that moved nothing the rasters are drawn from.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const colours = brandColours(root);
const lockOnly = process.argv.includes("--lock-only");

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
    // For a message that still wants a blue band; the card's header is white since §189. No template links it
    // any more, but delivered emails do, so it stays in public/; its band is the club's `tints.emailBand`.
    background: colours.emailBand,
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
  {
    source: "public/brand/email-cannot-come.svg",
    target: "public/brand/email-cannot-come.png",
    /*
      The glyph before «Nu mai pot ajunge» in every email about a live registration (§558): the
      manage page's cancel glyph (`EventBusy`) in the club's ink blue, drawn at 20 px, so 2× here.
      With alpha, so it sits on the button's white and on a dark theme's re-coloured one alike.
      Its fill is the club's primary ink, whatever the source file says (§885).
    */
    width: 40,
    background: null,
    fill: colours.primaryInk,
  },
];

for (const { source, target, width, background, canvas, fill } of lockOnly ? [] : OUTPUTS) {
  const text = await readFile(path.join(root, source), "utf8");
  const svg = Buffer.from(fill ? text.replace(/fill="#[0-9a-fA-F]{6}"/g, `fill="${fill}"`) : text);
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
  await writeFile(path.join(root, target), png);
  const { width: w, height: h, hasAlpha } = await sharp(png).metadata();
  console.log(`${path.basename(target)}: ${w}x${h}, alpha ${hasAlpha ? "yes" : "no"}, ${(png.byteLength / 1024).toFixed(1)} KiB`);
}

await writeFile(path.join(root, "club/assets.lock.json"), `${JSON.stringify(brandAssetsLock(root), null, 2)}\n`);
console.log("club/assets.lock.json: the sources and colours the rasters were built from");
