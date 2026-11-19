import { SIGNED_CONTRACT_MAX_BYTES, SIGNED_CONTRACT_NAME_MAX, type VolunteerDocumentFormat } from "@/db/schema/event-volunteer-documents";
import { BROWSER_SEND_BYTES } from "@/modules/media/limits";
import { foldName } from "@/modules/registrations/domain/name-fold";

/**
 * «Contract semnat» (§NNN): what a signed agreement may be, read from the file itself, and which volunteer a file is, read from
 * its name. Pure: no database, no request — the service (`../signed-contract.ts`) asks these and decides.
 */

export { SIGNED_CONTRACT_MAX_BYTES };

/** The card's address on a volunteer's page: where an upload sent with scripts off comes back to. */
export const SIGNED_CONTRACT_ANCHOR = "contract-semnat";

/**
 * The most one request of the page carries (§NNN): a request to a function on the host carries at most 4.5 MB (§66), so a larger
 * file goes up in pieces of this size, the house's own browser send limit (`media/limits.ts#BROWSER_SEND_BYTES`), with room for
 * the multipart envelope. The server takes a piece of any size up to the whole file; only the page cuts at this one.
 */
export const SIGNED_CONTRACT_PART_BYTES = BROWSER_SEND_BYTES;

/** Each format as a download serves it: its type, and the extensions a name of it may end in (the first is the one added). */
export const SIGNED_CONTRACT_FORMATS: Readonly<Record<VolunteerDocumentFormat, { contentType: string; extensions: readonly string[] }>> = {
  PDF: { contentType: "application/pdf", extensions: ["pdf"] },
  DOCX: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extensions: ["docx"] },
  DOC: { contentType: "application/msword", extensions: ["doc"] },
  JPEG: { contentType: "image/jpeg", extensions: ["jpg", "jpeg"] },
  PNG: { contentType: "image/png", extensions: ["png"] },
  HEIC: { contentType: "image/heic", extensions: ["heic", "heif"] },
  HEIF: { contentType: "image/heif", extensions: ["heif", "heic"] },
};

/**
 * The file input's `accept`: the extensions and the types, so a phone offers its files, its photographs and its camera. Only a
 * hint to the picker — the server reads the bytes (`sniffSignedContract`).
 */
export const SIGNED_CONTRACT_ACCEPT = [
  ...new Set(Object.values(SIGNED_CONTRACT_FORMATS).flatMap((format) => format.extensions.map((extension) => `.${extension}`))),
  ...new Set(Object.values(SIGNED_CONTRACT_FORMATS).map((format) => format.contentType)),
].join(",");

// ---------------------------------------------------------------------------------------------
// What the file is: its own bytes, never its name or the browser's word
// ---------------------------------------------------------------------------------------------

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Where `%PDF-` may start: a reader looks in the first kilobyte, so a scanner's file with a byte or two before it is still a PDF. */
const PDF_SEARCH = 1024;

/** An ISO media file's brands (`ftyp`) that make it a phone's HEIC; the plain HEIF ones; and AVIF's, which is neither. */
const HEIC_BRANDS: ReadonlySet<string> = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx"]);
const HEIF_BRANDS: ReadonlySet<string> = new Set(["mif1", "msf1", "heif"]);
const AVIF_BRANDS: ReadonlySet<string> = new Set(["avif", "avis"]);

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0): boolean {
  if (bytes.length < at + signature.length) return false;
  return signature.every((byte, index) => bytes[at + index] === byte);
}

/** Where `needle` first stands in `bytes` from `from` up to `until`, or -1: a plain search, fast enough for ten megabytes. */
function indexOfBytes(bytes: Uint8Array, needle: readonly number[], from = 0, until = bytes.length): number {
  const last = Math.min(until, bytes.length) - needle.length;
  const first = needle[0];
  for (let at = from; at <= last; at += 1) {
    if (bytes[at] !== first) continue;
    let index = 1;
    while (index < needle.length && bytes[at + index] === needle[index]) index += 1;
    if (index === needle.length) return at;
  }
  return -1;
}

const asciiBytes = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));
/** A name as an OLE2 directory writes it: UTF-16, little-endian. */
const utf16leBytes = (text: string): number[] => [...text].flatMap((character) => [character.charCodeAt(0), 0]);

const CONTENT_TYPES_PART = asciiBytes("[Content_Types].xml");
const WORD_FOLDER = asciiBytes("word/");
const WORD_STREAM = utf16leBytes("WordDocument");

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)));
}

/** A photograph from a phone: an ISO media file whose brands say HEIC, or HEIF and not AVIF. */
function heifFormatOf(bytes: Uint8Array): "HEIC" | "HEIF" | null {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp") return null;
  const declared = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  // The brands end where the box does; a size this function cannot trust reads the first few only.
  const end = declared >= 16 && declared <= 1024 ? declared : 64;
  const major = ascii(bytes, 8, 12);
  const brands = [major];
  for (let at = 16; at + 4 <= Math.min(end, bytes.length); at += 4) brands.push(ascii(bytes, at, at + 4));
  if (brands.some((brand) => HEIC_BRANDS.has(brand))) return "HEIC";
  if (AVIF_BRANDS.has(major)) return null;
  return brands.some((brand) => HEIF_BRANDS.has(brand)) ? "HEIF" : null;
}

/**
 * What a whole file is, from its own bytes (§NNN) — never from its name or the type the browser claimed: a name is typed and a
 * type is the browser's guess. Null for anything else, a renamed program or a page among them.
 *
 * - **JPEG**, **PNG**: their signatures.
 * - **DOCX**: a ZIP holding `[Content_Types].xml` and a `word/` folder — an Excel or a plain archive is not one.
 * - **DOC**: Word's older file, a compound file holding a `WordDocument` stream — an old Excel or PowerPoint is not one.
 * - **HEIC** / **HEIF**: a phone's photograph, by the brands of its first box; an AVIF is neither.
 * - **PDF**: `%PDF-` within the first kilobyte — read last, so a file that opens with another signature is never taken for one.
 */
export function sniffSignedContract(bytes: Uint8Array): VolunteerDocumentFormat | null {
  if (startsWith(bytes, JPEG)) return "JPEG";
  if (startsWith(bytes, PNG)) return "PNG";
  if (startsWith(bytes, ZIP)) return indexOfBytes(bytes, CONTENT_TYPES_PART) >= 0 && indexOfBytes(bytes, WORD_FOLDER) >= 0 ? "DOCX" : null;
  if (startsWith(bytes, OLE2)) return indexOfBytes(bytes, WORD_STREAM) >= 0 ? "DOC" : null;
  const heif = heifFormatOf(bytes);
  if (heif) return heif;
  return indexOfBytes(bytes, PDF, 0, PDF_SEARCH + PDF.length) >= 0 ? "PDF" : null;
}

/**
 * Whether the first piece of a file sent in pieces may still be one of the formats (§NNN): its signature alone, refused at once
 * when it is none, so ten megabytes of something else never go up. The whole file is read again by `sniffSignedContract` the
 * moment its last piece arrives — a Word file's folders can stand anywhere in it.
 */
export function mayBeSignedContract(firstBytes: Uint8Array): boolean {
  return (
    indexOfBytes(firstBytes, PDF, 0, PDF_SEARCH + PDF.length) >= 0 ||
    startsWith(firstBytes, JPEG) ||
    startsWith(firstBytes, PNG) ||
    heifFormatOf(firstBytes) !== null ||
    startsWith(firstBytes, ZIP) ||
    startsWith(firstBytes, OLE2)
  );
}

// ---------------------------------------------------------------------------------------------
// The file's name: kept as it was uploaded, made safe
// ---------------------------------------------------------------------------------------------

/**
 * What a name may not carry: control characters, the marks that turn a line's direction (a name drawn «…fdp.exe» as «…exe.pdf»)
 * and the characters nobody sees.
 */
const UNSAFE_IN_NAME = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

/**
 * The name a file was uploaded with, as it is kept (§NNN): its last path segment (an older browser sent «C:\fakepath\…»),
 * composed (NFC), without control characters or direction marks, its spaces collapsed, and cut at `SIGNED_CONTRACT_NAME_MAX`
 * characters with its extension kept. Empty when nothing is left; the service names it then.
 */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).at(-1) ?? "";
  const cleaned = base.normalize("NFC").replace(UNSAFE_IN_NAME, "").replace(/\s+/g, " ").trim();
  const characters = [...cleaned];
  if (characters.length <= SIGNED_CONTRACT_NAME_MAX) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
  const stem = [...cleaned.slice(0, cleaned.length - extension.length)].slice(0, SIGNED_CONTRACT_NAME_MAX - [...extension].length);
  return `${stem.join("").trimEnd()}${extension}`;
}

/** The extension a name ends in, lower-cased, or "". */
function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return match ? match[1].toLowerCase() : "";
}

/**
 * The name a download gives the file: the one it was uploaded with, and the format's extension added when that name's does not
 * say what the bytes are (a photograph named «contract.pdf» downloads as «contract.pdf.jpg»), so the reader opens it in the right
 * program. `content-disposition.ts` makes it safe for the header.
 */
export function downloadNameOf(fileName: string, format: VolunteerDocumentFormat): string {
  const { extensions } = SIGNED_CONTRACT_FORMATS[format];
  return extensions.includes(extensionOf(fileName)) ? fileName : `${fileName}.${extensions[0]}`;
}

/** The name kept when the uploaded one had nothing left after cleaning: «contract» and the format's extension. */
export function fallbackFileName(format: VolunteerDocumentFormat): string {
  return `contract.${SIGNED_CONTRACT_FORMATS[format].extensions[0]}`;
}

// ---------------------------------------------------------------------------------------------
// Which volunteer a file is: «Contract-voluntariat-<Name>.docx», matched by the folded name
// ---------------------------------------------------------------------------------------------

/** The few letters a decomposition leaves whole, as an ASCII file name writes them: «ł» is «l». */
const PLAIN_LETTERS: Readonly<Record<string, string>> = { ß: "ss", ø: "o", ł: "l", đ: "d", æ: "ae", œ: "oe", þ: "th", ı: "i" };

/**
 * A person's name as the match reads it (§NNN): the house's name fold (`name-fold.ts` — case, the diacritics with a comma below
 * or a cedilla, «ș» and «ş» alike, the characters nobody sees), then every mark that is not a letter or a digit — a hyphen, an
 * underscore, a dot, an apostrophe — as one space. «Anaïs Meyson» and «Anais-Meyson» read «anais meyson»; «Țâmpu» and «Ţampu»
 * read «tampu».
 */
export function foldPersonName(name: string): string {
  return foldName(name)
    .replace(/[ßøłđæœþı]/g, (letter) => PLAIN_LETTERS[letter] ?? letter)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The extensions a contract's file may end in, one after another («….docx.pdf»), all taken off before the name is read. */
const FILE_EXTENSIONS: ReadonlySet<string> = new Set(Object.values(SIGNED_CONTRACT_FORMATS).flatMap((format) => format.extensions));

/** The words the club's files start with, folded: «Contract-voluntariat-», «Contract voluntariat», «Contract de voluntariat». */
const CONTRACT_PREFIXES = ["contract de voluntariat", "contract voluntariat"] as const;

/**
 * The person a file is named after (§NNN), folded: the name without its extensions and a browser's « (1)» for a second download,
 * then without a leading «Contract-voluntariat-» in any case or spelling. «Contract-voluntariat-Anais-Meyson.docx» is «anais
 * meyson»; a file named only «Contract-voluntariat.docx» is "" — nobody.
 */
export function nameInContractFile(fileName: string): string {
  let stem = fileName.split(/[\\/]/).at(-1) ?? "";
  for (let extension = extensionOf(stem); extension && FILE_EXTENSIONS.has(extension); extension = extensionOf(stem)) {
    stem = stem.slice(0, stem.length - extension.length - 1);
  }
  stem = stem.replace(/\s*\(\d{1,3}\)$/, "");
  const folded = foldPersonName(stem);
  for (const prefix of CONTRACT_PREFIXES) {
    if (folded === prefix) return "";
    if (folded.startsWith(`${prefix} `)) return folded.slice(prefix.length + 1).trim();
  }
  return folded;
}

/** Why a file of «Încarcă contractele semnate» was not attached, by name (§NNN); the words are `Admin.volunteers.contract.reasons.*`. */
export type ContractNameRefusal =
  /** The name says nobody: «Contract-voluntariat.docx». */
  | "noName"
  /** No volunteer of the event, cancelled or not, has the name. */
  | "noMatch"
  /** Two or more volunteers of the event who are not cancelled have it. */
  | "ambiguous"
  /** Only a cancelled volunteer has it: attached by hand on their page, if at all. */
  | "cancelledOnly"
  /** An earlier file of the same upload is already that volunteer's. */
  | "twice";

export type ContractFileMatch =
  | { kind: "matched"; volunteerId: string }
  /**
   * A later file naming the volunteer an earlier one matched: a spare, with the person's id. It goes up only when every earlier
   * file of the same upload for that person was refused (by its bytes, or never received), and otherwise is left as `twice` — so
   * one upload never replaces its own file, and a good file never stays out behind a bad one (§NNN).
   */
  | { kind: "refused"; reason: "twice"; volunteerId: string }
  | { kind: "refused"; reason: Exclude<ContractNameRefusal, "twice"> };

/** One volunteer of the event as the match reads them. */
export type ContractCandidate = { id: string; name: string; cancelled: boolean };

/** The name's words in one order, so «Popescu Ion» and «Ion Popescu» read the same. */
const wordsInOrder = (folded: string): string => folded.split(" ").filter(Boolean).sort().join(" ");

/**
 * «Încarcă contractele semnate» (§NNN): each file matched to **one** volunteer of the event by the name it carries, or refused
 * with the reason — never a guess. A file is first compared with the volunteers who are not cancelled: the folded name exactly,
 * and only when nobody has it, the same words in another order («Popescu-Ion» for «Ion Popescu»). Exactly one is the match; two
 * or more is `ambiguous`. Nobody among them, and a cancelled volunteer with the name, is `cancelledOnly`; nobody at all is
 * `noMatch`. A volunteer an earlier file of the same upload matched is `twice`, with the person's id: the sender tries it only
 * when the earlier file was refused, so one upload never replaces its own file and never leaves a good one out.
 * The candidates are the event's alone: a volunteer of another event is never among them (the service reads them by the event).
 */
export function matchContractFiles(fileNames: readonly string[], volunteers: readonly ContractCandidate[]): ContractFileMatch[] {
  const read = volunteers.map((volunteer) => {
    const folded = foldPersonName(volunteer.name);
    return { id: volunteer.id, cancelled: volunteer.cancelled, folded, words: wordsInOrder(folded) };
  });
  const active = read.filter((volunteer) => !volunteer.cancelled);
  const cancelled = read.filter((volunteer) => volunteer.cancelled);
  const findIn = (pool: typeof read, wanted: string) => {
    const exact = pool.filter((volunteer) => volunteer.folded === wanted);
    if (exact.length > 0) return exact;
    const words = wordsInOrder(wanted);
    return pool.filter((volunteer) => volunteer.words === words);
  };
  const taken = new Set<string>();
  return fileNames.map((fileName): ContractFileMatch => {
    const wanted = nameInContractFile(fileName);
    if (!wanted) return { kind: "refused", reason: "noName" };
    const found = findIn(active, wanted);
    if (found.length > 1) return { kind: "refused", reason: "ambiguous" };
    if (found.length === 1) {
      if (taken.has(found[0].id)) return { kind: "refused", reason: "twice", volunteerId: found[0].id };
      taken.add(found[0].id);
      return { kind: "matched", volunteerId: found[0].id };
    }
    return { kind: "refused", reason: findIn(cancelled, wanted).length > 0 ? "cancelledOnly" : "noMatch" };
  });
}
