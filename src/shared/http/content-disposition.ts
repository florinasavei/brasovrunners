/**
 * The one place a `Content-Disposition` header is built (§NNN, RFC 6266 and RFC 5987).
 *
 * An HTTP header value is Latin-1 bytes: a file named after an event whose title has an S with a
 * comma below, a T with a comma below or an en dash used to crash the download with a 500 («Cannot
 * convert argument to a ByteString»), the registrations' Excel export first. So every download goes
 * through here, and the header carries the name twice:
 *
 * - `filename="..."`: an ASCII fallback for the clients that read only that one — the name with its
 *   accents taken off, typographic dashes and quotes made plain, anything else outside printable
 *   ASCII dropped, never empty;
 * - `filename*=UTF-8''...`: the real name, percent-encoded, which every current browser prefers.
 *
 * `tests/unit/design/download-names.test.ts` refuses a `filename=` header literal anywhere else in
 * `src/`, so the bug cannot come back with the next download.
 */

/** Typographic characters that have a plain ASCII twin (by code point); the rest of non-ASCII is dropped. */
const PLAIN_TWINS: Record<string, string> = {
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "“": "'",
  "”": "'",
  "„": "'",
  "«": "'",
  "»": "'",
  "…": "...",
  "\u00a0": " ",
  "\u202f": " ",
  "ß": "ss",
  "ø": "o",
  "Ø": "O",
  "ł": "l",
  "Ł": "L",
  "đ": "d",
  "Đ": "D",
  "æ": "ae",
  "Æ": "AE",
  "œ": "oe",
  "Œ": "OE",
};

/** A name needs a letter or a digit to be a name: «.xlsx» alone is not one. */
const HAS_WORD = /[A-Za-z0-9]/;

/**
 * Printable ASCII for a header's quoted string. `"` and a backslash would need escaping, so they
 * become plain characters; what has no twin is dropped, and a stem with nothing readable left is
 * `defaultStem`, the extension kept.
 */
export function asciiFallbackName(fileName: string, defaultStem = "download"): string {
  const plain = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, (char) => PLAIN_TWINS[char] ?? "")
    .replace(/"/g, "'")
    .replace(/[\\/]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const dot = plain.lastIndexOf(".");
  const extension = dot >= 0 ? plain.slice(dot) : "";
  const stem = extension ? plain.slice(0, dot) : plain;
  if (HAS_WORD.test(stem)) return plain;
  return `${defaultStem}${HAS_WORD.test(extension) ? extension : ""}`;
}

/** RFC 5987's `value-chars`: `encodeURIComponent` leaves `!'()*` alone, the grammar does not. */
function encodeRfc5987(value: string): string {
  // A lone surrogate would make `encodeURIComponent` throw: it becomes the replacement character.
  const wellFormed = value.replace(/[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g, (unit) => (unit.length === 2 ? unit : "\ufffd"));
  return encodeURIComponent(wellFormed).replace(/['()*!]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * `attachment; filename="<ascii>"; filename*=UTF-8''<percent-encoded>` for any name, accepted by
 * `new Headers()` for any input. `fileName` is the whole name with its extension; `defaultStem` is
 * what stands in when nothing readable is left of the ASCII fallback.
 */
export function contentDisposition(type: "attachment" | "inline", fileName: string, defaultStem = "download"): string {
  return `${type}; filename="${asciiFallbackName(fileName, defaultStem)}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}
