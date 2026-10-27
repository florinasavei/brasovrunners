// yarn calendar:preview [--month june|busy|sparse|fortnight|empty|all] [--theme poster|club|light|dark|season|all]
//
// «Salvează ca imagine» (§855) drawn without a server or a database: the page's own drawing code is bundled,
// served beside `public/` (the logo, the poster's fonts) and the site's fonts, and every month asked is written
// in every theme asked («Afiș» alone unless told), each in its three layouts and four formats, to
// dist/calendar-preview/<month>/<theme>-<layout>-<format>.png. For changing the picture: draw, look at the
// files, change, draw again. The months are scripts/calendar-image-preview/*.json — June 2026 as the club's
// own poster had it, a busy six-week August in English, a November with two dates, a September with a series on
// two weekdays, a fortnightly one, a 69-character title and three dates on one day, and an empty October.
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const here = path.join(root, "scripts/calendar-image-preview");
const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const months = fs.readdirSync(here).filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, ""));
const monthArg = option("month", "all");
const chosen = monthArg === "all" ? months : monthArg.split(",");
const themes = option("theme", "poster");
const out = path.join(root, "dist/calendar-preview");

const require = createRequire(path.join(root, "package.json"));
// esbuild arrives with the toolchain (tsx, drizzle-kit); bundling a page needs nothing more.
const esbuild = require("esbuild");
const { chromium } = require("@playwright/test");

fs.mkdirSync(out, { recursive: true });
const work = fs.mkdtempSync(path.join(out, ".page-"));
await esbuild.build({
  entryPoints: [path.join(here, "page.ts")],
  bundle: true,
  format: "iife",
  outfile: path.join(work, "bundle.js"),
  absWorkingDir: root,
  alias: { "@": path.join(root, "src") },
  logLevel: "error",
});

// The site's own faces under the names the canvas is handed («Roboto-700.woff2» → Roboto 700), as the page
// would have them loaded before the dialog opens; the poster's own are fetched by the drawing's loader.
const fontDir = path.join(root, "src/theme/fonts");
const faces = fs.readdirSync(fontDir).filter((file) => /\.(woff2|ttf|otf)$/.test(file)).map((file) => {
  const [family, rest = "400"] = file.replace(/\.(woff2|ttf|otf)$/, "").split("-");
  const weight = family === "Facon" ? "900" : (rest.match(/\d{3}/)?.[0] ?? "400");
  const style = family === "Facon" || /italic/i.test(rest) ? "italic" : "normal";
  fs.copyFileSync(path.join(fontDir, file), path.join(work, file));
  return `@font-face{font-family:'${family}';src:url('/${file}');font-weight:${weight};font-style:${style}}`;
});
fs.writeFileSync(path.join(work, "index.html"), `<!doctype html><meta charset="utf-8"><style>${faces.join("")}</style><body style="font-family:Roboto,sans-serif;--font-facon:Facon,Roboto,sans-serif;--font-signature:Caveat,cursive"><script src="/bundle.js"></script></body>`);

// One origin for the page, the logo and the fonts, as on the site: a canvas that draws a file:// image is tainted.
const types = { ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".png": "image/png" };
const server = http.createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url ?? "/", "http://preview").pathname);
  const file = [path.join(work, name), path.join(root, "public", name)].find((candidate) => (candidate.startsWith(work) || candidate.startsWith(path.join(root, "public"))) && fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!file) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  for (const month of chosen) {
    const data = JSON.parse(fs.readFileSync(path.join(here, `${month}.json`), "utf8"));
    const images = await page.evaluate(([d, t]) => window.renderPreview(d, t), [data, themes]);
    fs.mkdirSync(path.join(out, month), { recursive: true });
    for (const [name, url] of Object.entries(images)) fs.writeFileSync(path.join(out, month, `${name}.png`), Buffer.from(url.split(",")[1], "base64"));
    console.log(`${month}: ${Object.keys(images).length} pictures in ${path.relative(root, path.join(out, month))}`);
  }
} finally {
  await browser.close();
  server.close();
  fs.rmSync(work, { recursive: true, force: true });
}
