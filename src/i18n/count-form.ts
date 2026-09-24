/**
 * Which of three phrasings a counted noun takes, so "1 dată", "2 date" and "20 de date" each
 * read as Romanian (`DECISIONS.md` §NNN; the owner, of a series row reading "Ciornă · 1 date":
 * "ce înseamnă această 1 ciornă?").
 *
 * The catalogues carry no ICU plurals (`docs/VIBECODING.md`), so a counted phrase is three plain
 * keys — `one`, `few`, `other`, CLDR's names for Romanian's three forms — and this picks the
 * key. The words stay in `messages/*.json`, in both languages; English has two forms and
 * repeats the plural under `few` and `other`, so the two catalogues keep the same keys.
 *
 * Romanian:
 * - `one` — exactly 1: "1 dată";
 * - `few` — 0, 2 to 19, and any number whose last two digits are 01 to 19: "2 date", "19 date",
 *   "101 date", "0 date";
 * - `other` — 20 and over, when the last two digits are 00 or 20 to 99: the noun takes "de" —
 *   "20 de date", "21 de date", "100 de date", "120 de date".
 *
 * English: `one` for 1, `other` for everything else. Any locale but Romanian is read as English,
 * the site's only other language.
 *
 * Pure and tiny on purpose: `Intl.PluralRules` gives the same answer, but a rule this small
 * written out is one a reader can check against the examples above without knowing CLDR.
 */
export type CountForm = "one" | "few" | "other";

export function countForm(count: number, locale: string): CountForm {
  if (count === 1) return "one";
  if (locale !== "ro") return "other";
  const lastTwo = Math.abs(count) % 100;
  return Math.abs(count) >= 20 && (lastTwo === 0 || lastTwo >= 20) ? "other" : "few";
}
