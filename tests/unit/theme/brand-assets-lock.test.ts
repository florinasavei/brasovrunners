import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { BRAND_SOURCES, brandAssetsLock } from "../../../scripts/brand-assets-lock.mjs";
import { KIT_DIR, kitFiles } from "../../../scripts/brand-kit.mjs";

/**
 * BR-REQ-101-01 (§885): the committed rasters — the PDFs' lockup, the emails' letterhead and the «Nu mai pot ajunge»
 * glyph — are the SVG sources and the club's colours as `yarn brand:assets` last drew them.
 *
 * The script writes `club/assets.lock.json` with each source's sha256 (line endings normalised to LF, so a Windows
 * checkout agrees with CI) and the palette colours it paints with. A source or a colour changed without the rasters
 * rebuilt is a PDF or an email in the old artwork, which nobody sees until a participant does: this fails first.
 */
const ROOT = path.resolve(__dirname, "../../..");

type Lock = { sources: Record<string, string>; colours: Record<string, string>; kit: Record<string, string> };

const committed = JSON.parse(readFileSync(path.join(ROOT, "club/assets.lock.json"), "utf8")) as Lock;

describe("BR-REQ-101-01: the brand rasters are built from today's sources (§885)", () => {
  const now = brandAssetsLock(ROOT) as Lock;

  it("locks every SVG source the script draws from", () => {
    expect(Object.keys(committed.sources).sort()).toEqual([...BRAND_SOURCES].sort());
  });

  for (const source of BRAND_SOURCES) {
    it(`${source} is the file the rasters were drawn from`, () => {
      expect(now.sources[source], `${source} changed since the rasters were built — run yarn brand:assets`).toBe(committed.sources[source]);
    });
  }

  it("the palette's colours are the ones the rasters were painted in", () => {
    expect(now.colours, "the palette in club/club.json changed since the rasters were built — run yarn brand:assets").toEqual(committed.colours);
  });

  /*
    §NNN: the «PR Kit»'s logo files, named from the club's slug, each by its sha256 — so a kit file edited by hand, or one left
    from a slug that changed, fails here as a source changed without a rebuild does.
  */
  it("locks every file of the PR kit, named from the club's slug, and nothing else", () => {
    const slug = (JSON.parse(readFileSync(path.join(ROOT, "club/club.json"), "utf8")) as { slug: string }).slug;
    expect(Object.keys(committed.kit).sort()).toEqual(kitFiles(slug).map(({ name }: { name: string }) => `${KIT_DIR}/${name}`).sort());
    expect(readdirSync(path.join(ROOT, KIT_DIR)).sort()).toEqual(kitFiles(slug).map(({ name }: { name: string }) => name).sort());
  });

  it("every file of the PR kit is the one the script wrote", () => {
    for (const file of Object.keys(committed.kit)) expect(now.kit[file], `${file} changed since yarn brand:assets wrote it`).toBe(committed.kit[file]);
  });

  it("names the colours the committed rasters actually hold: the white lockup's band and the glyph's ink", async () => {
    const hex = (data: Buffer, at: number) => `#${data.subarray(at, at + 3).toString("hex")}`;
    const band = await sharp(path.join(ROOT, "public/brand/logo-white-email.png")).raw().toBuffer({ resolveWithObject: true });
    expect(hex(band.data, 0), "logo-white-email.png's band").toBe(committed.colours.emailBand);
    const glyph = await sharp(path.join(ROOT, "public/brand/email-cannot-come.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const opaque = new Set<string>();
    for (let at = 0; at < glyph.data.length; at += 4) if (glyph.data[at + 3] === 255) opaque.add(hex(glyph.data, at));
    expect([...opaque], "email-cannot-come.png's ink").toEqual([committed.colours.primaryInk]);
  });

  it("locks a CRLF checkout of the same files to the same hashes, and a changed source to another", () => {
    const copy = mkdtempSync(path.join(tmpdir(), "brand-lock-"));
    try {
      mkdirSync(path.join(copy, "club"));
      cpSync(path.join(ROOT, "club/club.json"), path.join(copy, "club/club.json"));
      for (const source of BRAND_SOURCES) {
        mkdirSync(path.dirname(path.join(copy, source)), { recursive: true });
        const lf = readFileSync(path.join(ROOT, source), "utf8").replace(/\r\n/g, "\n");
        writeFileSync(path.join(copy, source), lf.replace(/\n/g, "\r\n"));
      }
      // The kit's SVGs are text and come out of a Windows checkout with CRLF too; its PNGs are bytes, copied as they are.
      mkdirSync(path.join(copy, KIT_DIR), { recursive: true });
      for (const file of Object.keys(committed.kit)) {
        if (file.endsWith(".svg")) writeFileSync(path.join(copy, file), readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"));
        else cpSync(path.join(ROOT, file), path.join(copy, file));
      }
      expect(brandAssetsLock(copy)).toEqual(committed);
      writeFileSync(path.join(copy, BRAND_SOURCES[0]), "<svg/>");
      expect((brandAssetsLock(copy) as Lock).sources[BRAND_SOURCES[0]]).not.toBe(committed.sources[BRAND_SOURCES[0]]);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
