import { readFileSync } from "node:fs";

/**
 * A font's `cmap`, read by hand — no font library — for the tests that prove a character is in a file rather
 * than assume it: `tests/unit/theme/fonts.test.ts` (the WOFF2 faces' Romanian letters) and
 * `tests/unit/theme/brand.test.ts` (every character of the wordmark in `Wordmark.ttf`, §NNN).
 */

/** Whether a Unicode `cmap` subtable (format 4 or 12) maps a code point to a real glyph. */
export function cmapHas(cmap: Buffer, codePoint: number): boolean {
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

/** The `cmap` table of a TrueType or OpenType file (`.ttf`, `.otf`): the table directory, then the table. */
export function sfntCmap(file: string): Buffer {
  const bytes = readFileSync(file);
  const numTables = bytes.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (bytes.toString("latin1", record, record + 4) !== "cmap") continue;
    const offset = bytes.readUInt32BE(record + 8);
    const length = bytes.readUInt32BE(record + 12);
    return bytes.subarray(offset, offset + length);
  }
  throw new Error(`${file} has no cmap table`);
}
