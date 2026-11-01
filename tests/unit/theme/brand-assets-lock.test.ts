import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { BRAND_SOURCES, brandAssetsLock } from "../../../scripts/brand-assets-lock.mjs";

/**
 * BR-REQ-101-01 (§NNN): the committed rasters — the PDFs' lockup, the emails' letterhead and the «Nu mai pot ajunge»
 * glyph — are the SVG sources and the club's colours as `yarn brand:assets` last drew them.
 *
 * The script writes `club/assets.lock.json` with each source's sha256 (line endings normalised to LF, so a Windows
 * checkout agrees with CI) and the palette colours it paints with. A source or a colour changed without the rasters
 * rebuilt is a PDF or an email in the old artwork, which nobody sees until a participant does: this fails first.
 */
const ROOT = path.resolve(__dirname, "../../..");

type Lock = { sources: Record<string, string>; colours: Record<string, string> };

const committed = JSON.parse(readFileSync(path.join(ROOT, "club/assets.lock.json"), "utf8")) as Lock;

describe("BR-REQ-101-01: the brand rasters are built from today's sources (§NNN)", () => {
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
      expect(brandAssetsLock(copy)).toEqual(committed);
      writeFileSync(path.join(copy, BRAND_SOURCES[0]), "<svg/>");
      expect((brandAssetsLock(copy) as Lock).sources[BRAND_SOURCES[0]]).not.toBe(committed.sources[BRAND_SOURCES[0]]);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
