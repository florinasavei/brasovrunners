import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/**
 * §460 (2026-09-26) — every face is a file in the repository; the build never asks Google.
 *
 * `next/font/google` downloaded Roboto, Inter, Caveat and Nunito at build time, and a runner that
 * could not reach Google failed the build ("cannot resolve …/font/google/font") with nothing
 * wrong in the code — the owner: "it keeps reappearing". The locale layout now loads the four
 * through `next/font/local` from `src/theme/fonts/`.
 *
 * Source-level, like `wordmark.test.ts`, plus a reading of each file's own `cmap`: a WOFF2 is a
 * header, a table directory and one Brotli stream, and Node decompresses Brotli itself, so no
 * font library is needed to prove the Romanian letters are in the file rather than assumed.
 */

const SRC = path.join(process.cwd(), "src");
const FONTS = path.join(SRC, "theme", "fonts");
const LAYOUT = path.join(SRC, "app", "[locale]", "layout.tsx");

/** Every source file under `src/`, as absolute paths. */
function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((file) => /\.(ts|tsx|css|mjs|js)$/.test(file))
    .map((file) => path.join(SRC, file));
}

/** The WOFF2 files the layout names, as `src/theme/fonts/`-relative names. */
function layoutFontFiles(): string[] {
  const source = readFileSync(LAYOUT, "utf8");
  return [...source.matchAll(/"\.\.\/\.\.\/theme\/fonts\/([^"]+)"/g)].map((match) => match[1]);
}

// ---- A WOFF2 reader, just enough for `cmap` and `OS/2` (W3C WOFF2 §5) -------------------------

const KNOWN_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep"];

function readBase128(bytes: Buffer, at: { offset: number }): number {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = bytes[at.offset++];
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error("UIntBase128 longer than five bytes");
}

/** The uncompressed tables of a WOFF2 file, by tag (only the untransformed ones are usable). */
function woff2Tables(file: string): Map<string, Buffer> {
  const bytes = readFileSync(file);
  expect(bytes.toString("latin1", 0, 4)).toBe("wOF2");
  const numTables = bytes.readUInt16BE(12);
  const compressedLength = bytes.readUInt32BE(20);
  const at = { offset: 48 };
  const entries: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = bytes[at.offset++];
    const index = flags & 0x3f;
    let tag = KNOWN_TAGS[index] ?? `#${index}`;
    if (index === 63) {
      tag = bytes.toString("latin1", at.offset, at.offset + 4);
      at.offset += 4;
    }
    const version = (flags >> 6) & 3;
    const origLength = readBase128(bytes, at);
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    const length = transformed ? readBase128(bytes, at) : origLength;
    entries.push({ tag, length });
  }
  const data = brotliDecompressSync(bytes.subarray(at.offset, at.offset + compressedLength));
  const tables = new Map<string, Buffer>();
  let offset = 0;
  for (const { tag, length } of entries) {
    tables.set(tag, data.subarray(offset, offset + length));
    offset += length;
  }
  return tables;
}

/** Whether a Unicode `cmap` subtable (format 4 or 12) maps a code point to a real glyph. */
function cmapHas(cmap: Buffer, codePoint: number): boolean {
  const count = cmap.readUInt16BE(2);
  const subtables: number[] = [];
  for (let i = 0; i < count; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8);
    const encoding = cmap.readUInt16BE(6 + i * 8);
    if ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) {
      subtables.push(cmap.readUInt32BE(8 + i * 8));
    }
  }
  return subtables.some((start) => {
    const format = cmap.readUInt16BE(start);
    if (format === 12) {
      const groups = cmap.readUInt32BE(start + 12);
      for (let g = 0; g < groups; g++) {
        const base = start + 16 + g * 12;
        if (codePoint >= cmap.readUInt32BE(base) && codePoint <= cmap.readUInt32BE(base + 4)) return true;
      }
      return false;
    }
    if (format === 4) {
      const segments = cmap.readUInt16BE(start + 6) / 2;
      const ends = start + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const rangeOffsets = deltas + segments * 2;
      for (let s = 0; s < segments; s++) {
        const end = cmap.readUInt16BE(ends + s * 2);
        const first = cmap.readUInt16BE(starts + s * 2);
        if (codePoint < first || codePoint > end) continue;
        if (first === 0xffff) return false;
        const rangeOffset = cmap.readUInt16BE(rangeOffsets + s * 2);
        if (rangeOffset === 0) return true;
        const glyphAt = rangeOffsets + s * 2 + rangeOffset + (codePoint - first) * 2;
        return cmap.readUInt16BE(glyphAt) !== 0;
      }
    }
    return false;
  });
}

// ------------------------------------------------------------------------------------------------

/** The letters a Romanian page cannot do without, and the punctuation the club's texts use. */
const ROMANIAN = "șțăâîȘȚĂÂÎ„”«»–—€…’";

describe("the fonts are files in the repository, never a download at build (§460)", () => {
  it("nothing under src/ imports next/font/google or links Google's font service", () => {
    const offenders = sourceFiles().filter((file) =>
      /["']next\/font\/google["']|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });

  it("the locale layout declares the four faces through next/font/local, variables unchanged", () => {
    const source = readFileSync(LAYOUT, "utf8");
    expect(source).toContain('from "next/font/local"');
    for (const variable of ["--font-roboto", "--font-inter", "--font-signature", "--font-nunito", "--font-facon"]) {
      expect(source).toContain(`variable: "${variable}"`);
    }
  });

  it("every file the layout names exists, and every family carries its licence", () => {
    const files = layoutFontFiles();
    expect(files.length).toBeGreaterThanOrEqual(13);
    for (const file of files) {
      expect(existsSync(path.join(FONTS, file)), file).toBe(true);
      const family = file.replace(/[-.].*$/, "");
      expect(existsSync(path.join(FONTS, `${family}-LICENSE.txt`)), `${family}-LICENSE.txt`).toBe(true);
    }
  });

  it("no WOFF2 in src/theme/fonts/ is shipped without the layout naming it", () => {
    const shipped = readdirSync(FONTS).filter((file) => file.endsWith(".woff2"));
    expect(shipped.sort()).toEqual(layoutFontFiles().filter((file) => file.endsWith(".woff2")).sort());
  });

  it.each(layoutFontFiles().filter((file) => file.endsWith(".woff2")))(
    "%s: its weight is the one in its name, and it sets every Romanian letter",
    (file) => {
      const tables = woff2Tables(path.join(FONTS, file));
      const weight = Number(file.match(/-(\d{3})\.woff2$/)?.[1]);
      expect(tables.get("OS/2")?.readUInt16BE(4)).toBe(weight);
      const cmap = tables.get("cmap");
      expect(cmap).toBeDefined();
      const missing = [...ROMANIAN].filter((char) => !cmapHas(cmap!, char.codePointAt(0)!));
      expect(missing.join("")).toBe("");
      // The reader is not vacuous: a character no latin face carries reads as absent.
      expect(cmapHas(cmap!, "中".codePointAt(0)!)).toBe(false);
    },
  );
});
