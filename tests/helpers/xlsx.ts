import { gunzipSync, inflateRawSync } from "node:zlib";

/**
 * Reading a written `.xlsx` by hand, for the tests of the files the backoffice hands out (§172,
 * §NNN): the assertions are on the **bytes**, not on a library's own round trip — a writer that
 * agreed with its own reader and with nothing else would pass a round-trip test and still hand the
 * club a file Excel refuses.
 */

/** A zero-based column index as the sheet's cell references spell it: 0 → A, 25 → Z, 27 → AB. */
export function columnLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `${columnLetter(Math.floor(index / 26) - 1)}${String.fromCharCode(65 + (index % 26))}`;
}

/**
 * The entries of a ZIP, by name, decompressed — read through the **central directory** at the end
 * of the file, since a streaming writer may leave the sizes out of the local headers (bit 3).
 */
export function unzip(buffer: Buffer): Map<string, string> {
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");

  const entries = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);

  const files = new Map<string, string>();
  for (let index = 0; index < entries; index += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localAt = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localAt + 26);
    const localExtraLength = buffer.readUInt16LE(localAt + 28);
    const start = localAt + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    const content = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : gunzipSync(raw);
    files.set(name, content.toString("utf8"));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const unescapeXml = (value: string) =>
  value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * The first sheet as a grid of what each cell shows before formatting: a text cell's words
 * (shared or inline), a number's or a date serial's digits, and `undefined` for a cell not written.
 * `rows[0]` is the header row.
 */
export function readSheet(buffer: Buffer): { rows: (string | undefined)[][]; sheetName: string } {
  const parts = unzip(buffer);
  const shared = [...(parts.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    unescapeXml([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("")),
  );
  const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
  const rows: (string | undefined)[][] = [];
  for (const cell of sheet.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, letters, rowNumber, attributes, inner = ""] = cell;
    const column = [...letters].reduce((sum, letter) => sum * 26 + (letter.charCodeAt(0) - 64), 0) - 1;
    const row = Number(rowNumber) - 1;
    const type = /t="([^"]+)"/.exec(attributes)?.[1];
    const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1];
    const shown = type === "s" && value !== undefined ? shared[Number(value)] : type === "inlineStr" ? unescapeXml(inline ?? "") : value !== undefined ? unescapeXml(value) : undefined;
    (rows[row] ??= [])[column] = shown;
  }
  const sheetName = unescapeXml(/<sheet [^>]*name="([^"]*)"/.exec(parts.get("xl/workbook.xml") ?? "")?.[1] ?? "");
  return { rows, sheetName };
}
