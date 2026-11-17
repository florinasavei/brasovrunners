import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

/**
 * A pdfkit file's digest, free of how its streams happened to be compressed: the header, every object in the order the file
 * holds them — its dictionary without `/Length`, and its stream inflated when it is `/FlateDecode` — and the trailer's
 * dictionary. The cross-reference table's byte offsets and `startxref` are left out: they follow from the compressed lengths.
 *
 * Why not the SHA-256 of the bytes: zlib is a pure function of its input on one build, so two files with the same digest are
 * the same file byte for byte wherever both are drawn — but Node's zlib (Chromium's) may compress the same input differently
 * on another processor or another release, and a digest of the bytes captured on one machine would then fail on the next for
 * nothing the code did. A test that a change kept a PDF the same (the one-person volunteer agreement, `agreements-route.test.ts`)
 * compares this digest with one captured from the code before the change.
 */
export function pdfContentDigest(pdf: Buffer): string {
  const text = pdf.toString("latin1");
  const hash = createHash("sha256");
  const header = /^%PDF-\d\.\d\n%[^\n]*\n/.exec(text);
  if (!header) throw new Error("not a pdfkit file: no header");
  hash.update(header[0], "latin1");
  let at = header[0].length;
  const objectHead = /(\d+) (\d+) obj\n/y;
  const streamTail = "\nendstream\nendobj\n";
  for (;;) {
    objectHead.lastIndex = at;
    const head = objectHead.exec(text);
    if (!head) break;
    const dictionaryStart = at + head[0].length;
    const end = text.indexOf("\nendobj\n", dictionaryStart);
    if (end === -1) throw new Error(`object ${head[1]} never ends`);
    // A stream's own bytes may hold anything, so its end is found by its length, never by searching for a word.
    const stream = text.indexOf("\nstream\n", dictionaryStart);
    hash.update(head[0], "latin1");
    if (stream !== -1 && stream < end) {
      const dictionary = text.slice(dictionaryStart, stream);
      const length = /\/Length (\d+)\n/.exec(dictionary);
      if (!length) throw new Error(`object ${head[1]}: a stream without its length`);
      const bytesStart = stream + "\nstream\n".length;
      const bytesEnd = bytesStart + Number(length[1]);
      if (text.slice(bytesEnd, bytesEnd + streamTail.length) !== streamTail) throw new Error(`object ${head[1]}: the stream does not end where its length says`);
      const bytes = pdf.subarray(bytesStart, bytesEnd);
      hash.update(dictionary.replace(length[0], ""), "latin1");
      hash.update(/\/Filter \/FlateDecode\n/.test(dictionary) ? inflateSync(bytes) : bytes);
      at = bytesEnd + streamTail.length;
    } else {
      hash.update(text.slice(dictionaryStart, end), "latin1");
      at = end + "\nendobj\n".length;
    }
  }
  // The cross-reference table follows the last object; after it, the trailer names the root, the information and the file's id.
  const trailer = /^xref\n[\s\S]*?\ntrailer\n([\s\S]*?)\nstartxref\n\d+\n%%EOF\n$/.exec(text.slice(at));
  if (!trailer) throw new Error("not a pdfkit file: no cross-reference table and trailer after the objects");
  hash.update(trailer[1], "latin1");
  return hash.digest("hex");
}
