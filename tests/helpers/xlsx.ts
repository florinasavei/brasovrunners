import { gunzipSync, inflateRawSync } from "node:zlib";

/**
 * Reading a written `.xlsx` by hand, for the tests of the files the backoffice hands out (§172,
 * §581): the assertions are on the **bytes**, not on a library's own round trip — a writer that
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
 * A sheet — the first unless `sheet` says which, counted from 1 — as a grid of what each cell shows before formatting: a
 * text cell's words (shared or inline), a number's or a date serial's digits, and `undefined` for a cell not written.
 * `rows[0]` is the header row; `sheetName` is that sheet's name.
 */
export function readSheet(buffer: Buffer, sheet = 1): { rows: (string | undefined)[][]; sheetName: string } {
  const parts = unzip(buffer);
  const shared = [...(parts.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    unescapeXml([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("")),
  );
  const xml = parts.get(`xl/worksheets/sheet${sheet}.xml`) ?? "";
  const rows: (string | undefined)[][] = [];
  for (const cell of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, letters, rowNumber, attributes, inner = ""] = cell;
    const column = [...letters].reduce((sum, letter) => sum * 26 + (letter.charCodeAt(0) - 64), 0) - 1;
    const row = Number(rowNumber) - 1;
    const type = /t="([^"]+)"/.exec(attributes)?.[1];
    const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1];
    const shown = type === "s" && value !== undefined ? shared[Number(value)] : type === "inlineStr" ? unescapeXml(inline ?? "") : value !== undefined ? unescapeXml(value) : undefined;
    (rows[row] ??= [])[column] = shown;
  }
  const sheetName = unescapeXml([...(parts.get("xl/workbook.xml") ?? "").matchAll(/<sheet [^>]*name="([^"]*)"/g)][sheet - 1]?.[1] ?? "");
  return { rows, sheetName };
}

/**
 * The start list alone (§787): the header and the registrations, without the statistics footer the export writes
 * under them. The footer starts after one empty row, and no registration's row is ever empty (it carries the id),
 * so the table ends where the first empty row begins.
 */
export function startListRows<Row extends (string | undefined)[] | undefined>(rows: readonly Row[]): Row[] {
  const end = rows.findIndex((row, index) => index > 0 && (!row || row.every((cell) => cell === undefined)));
  return end === -1 ? [...rows] : rows.slice(0, end);
}

/** How one cell is stored: its type attribute (`s` shared text, `inlineStr`, none for a number), its style index and its value. */
export type RawCell = { type: string | undefined; style: number | undefined; value: string | undefined };

/** Every written cell of the first sheet by reference («B12»), as the file stores it — for the assertions on typing and style. */
export function rawCells(buffer: Buffer): Map<string, RawCell> {
  const sheet = unzip(buffer).get("xl/worksheets/sheet1.xml") ?? "";
  const cells = new Map<string, RawCell>();
  for (const cell of sheet.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, reference, attributes, inner = ""] = cell;
    const style = /\bs="(\d+)"/.exec(attributes)?.[1];
    cells.set(reference, { type: /\bt="([^"]+)"/.exec(attributes)?.[1], style: style === undefined ? undefined : Number(style), value: /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] });
  }
  return cells;
}

/** Whether a style index (`RawCell.style`) is a bold font, read from the workbook's own styles part. */
export function isBoldStyle(buffer: Buffer, style: number | undefined): boolean {
  if (style === undefined) return false;
  const styles = unzip(buffer).get("xl/styles.xml") ?? "";
  const fonts = [...(/<fonts[^>]*>([\s\S]*?)<\/fonts>/.exec(styles)?.[1] ?? "").matchAll(/<font>([\s\S]*?)<\/font>|<font\/>/g)].map((font) => /<b\s*\/?>/.test(font[0]));
  const formats = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "").matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)];
  const fontId = Number(/\bfontId="(\d+)"/.exec(formats[style]?.[1] ?? "")?.[1] ?? 0);
  return fonts[fontId] === true;
}
