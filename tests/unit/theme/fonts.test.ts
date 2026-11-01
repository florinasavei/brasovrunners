import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cmapHas } from "../../helpers/font-cmap";

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
    for (const variable of ["--font-roboto", "--font-inter", "--font-signature", "--font-nunito", "--font-wordmark"]) {
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

  it("BR-REQ-101-01: Inter 800 (the heading face of «Tema v2», §708) is in the Inter family and, like Caveat, never preloaded", () => {
    const source = readFileSync(LAYOUT, "utf8");
    /** One `const <name> = localFont({ … });` declaration of the layout, whole. */
    const declaration = (name: string) => {
      const match = source.match(new RegExp(`const ${name} = localFont\\(\\{[\\s\\S]*?\\n\\}\\);`));
      expect(match, `const ${name} = localFont(...)`).not.toBeNull();
      return match![0];
    };
    const inter = declaration("inter");
    expect(inter).toMatch(/\{\s*path: "\.\.\/\.\.\/theme\/fonts\/Inter-800\.woff2", weight: "800", style: "normal"\s*\}/);
    expect(inter).toContain("preload: false");
    const signature = declaration("signature");
    expect(signature).toContain("Caveat-500.woff2");
    expect(signature).toContain("preload: false");
    // The body face is the one that is preloaded: the check above is not vacuous.
    expect(declaration("roboto")).not.toContain("preload: false");
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
