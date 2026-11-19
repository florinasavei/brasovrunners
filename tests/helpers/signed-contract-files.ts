/**
 * Made-up files for «Contract semnat» (§NNN): the leading bytes and the inner names each format is read by, and nothing a person
 * wrote — a few hundred bytes each, padded to any length a test asks. Never a real document.
 */

const ascii = (text: string) => Buffer.from(text, "latin1");
const utf16le = (text: string) => Buffer.from(text, "utf16le");

/** A ZIP local file header naming `name`: the signature, 26 bytes of header, the name. */
const zipEntry = (name: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(22), Buffer.from([name.length, 0, 0, 0]), ascii(name)]);

/** An ISO media file's first box (`ftyp`): its size, the major brand, a minor version, the compatible brands. */
function ftyp(major: string, compatible: readonly string[]): Buffer {
  const body = Buffer.concat([ascii("ftyp"), ascii(major), Buffer.alloc(4), ...compatible.map(ascii)]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length + 4);
  return Buffer.concat([size, body]);
}

const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export const SAMPLE_FILES = {
  pdf: () => ascii("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"),
  docx: () => Buffer.concat([zipEntry("[Content_Types].xml"), ascii("<Types/>"), zipEntry("_rels/.rels"), zipEntry("word/document.xml"), ascii("<w:document/>")]),
  doc: () => Buffer.concat([OLE2, Buffer.alloc(504), utf16le("Root Entry"), Buffer.alloc(44), utf16le("WordDocument"), Buffer.alloc(40)]),
  jpeg: () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), ascii("JFIF\0"), Buffer.alloc(64), Buffer.from([0xff, 0xd9])]),
  png: () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0, 0, 0, 13]), ascii("IHDR"), Buffer.alloc(17)]),
  heic: () => Buffer.concat([ftyp("heic", ["mif1", "heic"]), Buffer.alloc(64)]),
  heif: () => Buffer.concat([ftyp("mif1", ["mif1", "miaf"]), Buffer.alloc(64)]),
  // What is none of them, whatever it is named.
  avif: () => Buffer.concat([ftyp("avif", ["avif", "mif1", "miaf"]), Buffer.alloc(64)]),
  xlsx: () => Buffer.concat([zipEntry("[Content_Types].xml"), zipEntry("xl/workbook.xml"), ascii("<workbook/>")]),
  zip: () => Buffer.concat([zipEntry("notes.txt"), ascii("hello")]),
  xls: () => Buffer.concat([OLE2, Buffer.alloc(504), utf16le("Root Entry"), Buffer.alloc(44), utf16le("Workbook"), Buffer.alloc(40)]),
  exe: () => Buffer.concat([ascii("MZ"), Buffer.alloc(58), Buffer.from([0x80, 0, 0, 0]), Buffer.alloc(64), ascii("PE\0\0")]),
  html: () => ascii("<!doctype html><html><body><script>alert(1)</script></body></html>"),
  text: () => ascii("Contract semnat de Ana Pop\n"),
} as const;

export type SampleKind = keyof typeof SAMPLE_FILES;

/** A PDF of exactly `bytes` bytes: the signature, then padding. */
export function pdfOfSize(bytes: number): Buffer {
  const head = ascii("%PDF-1.7\n");
  return bytes <= head.length ? head.subarray(0, bytes) : Buffer.concat([head, Buffer.alloc(bytes - head.length, 0x20)]);
}
