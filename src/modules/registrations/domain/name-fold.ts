/**
 * A name as somebody types it, folded to what the name *is* (§179, §NNN).
 *
 * Two rules ask "is this the same name?" and must never disagree about the answer: the name an
 * Administrator transcribes before erasing a registration (`erase-confirmation.ts`), and the
 * name a participant types as their signature (`signature-name.ts`). Both forgive what a
 * keyboard does and nothing a person decides:
 *
 * - **Case**, because a Romanian keyboard and a hurried hand disagree about it constantly.
 * - **Whitespace**, collapsed and trimmed, because a name copied off a screen arrives with it —
 *   including the non-breaking space a phone inserts after an autocorrection.
 * - **Diacritics**, because "Ștefan" is `Ș` (U+0218, comma below) on one keyboard, `Ş` (U+015E,
 *   cedilla) on an older one and plain `S` on a phone. `admin-repository.ts` folds the same
 *   letters, for the same reason, when it searches.
 * - **The shape of an apostrophe or a hyphen**, not its presence: an iPhone turns `'` into `’`
 *   by itself ("smart punctuation"), and a name registered on a laptop as "O'Brien" must not be
 *   unsignable from the phone. "OBrien" still does not match — the apostrophe has to be there.
 * - **Characters nobody can see** — a zero-width space or a soft hyphen pasted along with a
 *   name. A field cannot be refused for something the person has no way to find.
 *
 * What is *not* folded is the name itself: every letter and digit, every hyphen and apostrophe,
 * every word, in order. "Ana Maria" is not "Ana-Maria", and "Munca Florin" is not "Florin Munca".
 *
 * `NFD` does the diacritics, and it is the platform's rather than a table's (`AGENTS.md` §1.5).
 * Decomposing turns every one of Romanian's ă â î ș ț — precomposed or already written as a
 * letter plus a combining mark, with a comma below or with a cedilla — into a bare letter followed
 * by a mark, which the next step removes. A hand-written map of five letters would do the same
 * for the five somebody remembered and silently fail on the sixth; this cannot. Lower-casing
 * comes first, so a capital whose lower case carries a mark (Turkish `İ`) is folded as well.
 *
 * Pure and dependency-free: the browser runs the very same function as the server (the signature
 * field's live check), so the two cannot disagree about a name either.
 */
const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
const APOSTROPHES = /[`\u00B4\u02B9\u02BC\u2018\u2019\u201B\u2032]/g;
const HYPHENS = /[\u2010\u2011]/g;

export function foldName(value: string): string {
  return value
    .replace(INVISIBLE, "")
    .toLocaleLowerCase("ro-RO")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(APOSTROPHES, "'")
    .replace(HYPHENS, "-")
    .replace(/\s+/g, " ")
    .trim();
}
