/**
 * «Clubul pe lista publică» (§753 and §NNN, amending §32, §143 and §396): what the public list's «Club» column says.
 *
 * The owner, 2026-10-13: «people type stupid things there, I just want to show Brașov Runners members and
 * ignore the other clubs … but I still want to show the BVR ones». The club is free text, and a public list
 * is a disclosure (`AGENTS.md` §10.10) — so the default shows less than the person typed, never more:
 *
 * - `members_only` — «Doar {club}»: the cell holds the club's own name for every row whose typed club names
 *   the club (`namesTheClub`), whoever typed it; every other cell is blank. Since §NNN membership is no
 *   condition: the club's runners have no accounts on «Echipa», so §753's account test left the column
 *   empty on the live race. The cell only ever says what the person wrote, in the club's own spelling — the
 *   list showed every typed club before §753, so nothing new is disclosed.
 * - `as_typed` — the typed club, as before the setting existed.
 * - `hidden` — no column.
 *
 * Pure: the mode's reading and the matcher. The query is `repository.ts#listPublicStartList`; the club's
 * name comes from the platform's one constant (§357), never written here.
 */

import { CLUB_NAME } from "@/theme/brand";

/** The three modes, in the order the editor offers them; the first is the default. */
export const PUBLIC_LIST_CLUBS = ["members_only", "as_typed", "hidden"] as const;

export type PublicListClubMode = (typeof PUBLIC_LIST_CLUBS)[number];

/** Every event that exists, and every one created, shows the club's own name only. */
export const DEFAULT_PUBLIC_LIST_CLUB: PublicListClubMode = "members_only";

/**
 * The event's mode as the public list reads it. A row with none, or a value this release does not know,
 * reads as the default — the safe side of a disclosure.
 */
export function publicListClubOf(event: { publicListClub?: string | null } | null | undefined): PublicListClubMode {
  const value = event?.publicListClub;
  return PUBLIC_LIST_CLUBS.find((mode) => mode === value) ?? DEFAULT_PUBLIC_LIST_CLUB;
}

/**
 * Words people put around the club's name without changing whose it is: «Clubul …», «Asociația …», «ACS …»,
 * «… Team», «… Club». Folded like everything else (no case, no diacritics). Stripped wherever they stand,
 * so they never decide a match on their own: a cell of nothing but these names no club.
 */
const FILLER = new Set([
  "club",
  "clubul",
  "clubului",
  "asociatia",
  "asociatiei",
  "asociatie",
  "sportiv",
  "sportiva",
  "as",
  "acs",
  "cs",
  "echipa",
  "echipei",
  "team",
  "grup",
  "grupul",
  "group",
  "the",
  "de",
  "la",
  "of",
  "membru",
  "member",
]);

/**
 * The club's usual short forms that no rule derives from its name. `CITY_SHORT` is the county's plate code,
 * which stands for the first word beside the rest of the name («BV Runners»); `NICKNAMES` name the club on
 * their own («BVR»). Nothing else: a bare «BR» or «BV» would name any club.
 */
const CITY_SHORT = "bv";
const NICKNAMES = ["bvr"] as const;

/** A cell longer than this, folded, is not a club's name: refused before any search. */
const LONGEST_CELL = 80;

/** A word of the club's own name this long or longer tolerates one typo («Brasov Runers», «Brashov»). */
const TYPO_FROM_LETTERS = 6;

/** The words of a string, folded: lower case, no diacritics; punctuation and spaces split them. */
function wordsOf(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/**
 * What one piece of a typed cell may be: the club's `n`-th word (`word`, its singular counts as the word),
 * the city's short form standing for the first word (`city`), the initials (`initials`), a nickname
 * (`nickname`) or a filler word (`filler`, transparent).
 */
type PieceKind = { kind: "word"; index: number } | { kind: "city" } | { kind: "initials" } | { kind: "nickname" } | { kind: "filler" };

type Piece = { text: string; typo: boolean; is: PieceKind };

/** Every piece a cell may be cut into, derived from the configured name; and how many words the name has. */
export type ClubVocabulary = { readonly pieces: readonly Piece[]; readonly words: number };

/**
 * The club's vocabulary, derived from its configured name (§357): its words (the last one singular too),
 * their initials, the city's short form, the nicknames above, and the longer filler words (a glued
 * «clubbrasovrunners» still splits). Never a literal of the name in the code.
 */
export function clubVocabulary(clubName: string = CLUB_NAME): ClubVocabulary {
  const words = wordsOf(clubName).filter((word) => !FILLER.has(word));
  const pieces: Piece[] = [];
  if (words.length === 0) return { pieces, words: 0 };
  words.forEach((word, index) => pieces.push({ text: word, typo: word.length >= TYPO_FROM_LETTERS, is: { kind: "word", index } }));
  const lastIndex = words.length - 1;
  const last = words[lastIndex];
  if (words.length > 1 && last.length > 3 && last.endsWith("s")) {
    const singular = last.slice(0, -1);
    pieces.push({ text: singular, typo: singular.length >= TYPO_FROM_LETTERS, is: { kind: "word", index: lastIndex } });
  }
  if (words.length > 1) {
    pieces.push({ text: words.map((word) => word[0]).join(""), typo: false, is: { kind: "initials" } });
    pieces.push({ text: CITY_SHORT, typo: false, is: { kind: "city" } });
  }
  for (const nickname of NICKNAMES) pieces.push({ text: nickname, typo: false, is: { kind: "nickname" } });
  for (const filler of FILLER) if (filler.length >= 3) pieces.push({ text: filler, typo: false, is: { kind: "filler" } });
  return { pieces, words: words.length };
}

/**
 * Whether `typed` is `target` with at most one typo — one letter added, dropped, changed, or two
 * neighbours swapped — and the first letter right (a different first letter is a different word:
 * «Gunners» is not «Runners»).
 */
function withinOneTypo(typed: string, target: string): boolean {
  if (typed === target) return true;
  if (typed[0] !== target[0] || Math.abs(typed.length - target.length) > 1) return false;
  let i = 0;
  while (i < typed.length && i < target.length && typed[i] === target[i]) i += 1;
  const rest = (a: number, b: number) => typed.slice(a) === target.slice(b);
  if (typed.length === target.length) {
    return rest(i + 1, i + 1) || (typed[i] === target[i + 1] && typed[i + 1] === target[i] && rest(i + 2, i + 2));
  }
  return typed.length > target.length ? rest(i + 1, i) : rest(i, i + 1);
}

/** Every length of the cell from `start` that `piece` may cover. A typo is a letter: «Runners 2» is not «Runners». */
function coverings(cell: string, start: number, piece: Piece): number[] {
  if (!piece.typo) return cell.startsWith(piece.text, start) ? [piece.text.length] : [];
  const lengths: number[] = [];
  for (const length of [piece.text.length - 1, piece.text.length, piece.text.length + 1]) {
    if (start + length > cell.length) continue;
    const slice = cell.slice(start, start + length);
    if (/^\p{L}+$/u.test(slice) && withinOneTypo(slice, piece.text)) lengths.push(length);
  }
  return lengths;
}

const DEFAULT_VOCABULARY = clubVocabulary();

/**
 * Whether a typed club names the club itself.
 *
 * Case, diacritics, punctuation, spaces and filler words («Clubul», «Asociația», «ACS», «Team») are folded
 * away; what is left must split, glued or not, into pieces of the club's own vocabulary — its words (one
 * typo allowed in a word of six letters or more), their initials with the first word, the city's short
 * form, a nickname — with nothing else in the cell, and the pieces must name the club somewhere: the
 * name's words in order («Brașov Runners», «BV Runners»), the initials beside the first word («BR Brașov»),
 * or a nickname («BVR»). So «Brașov Runners (BVR)» and «brasovrunners» are the club, and «Brașov Runners
 * Cluj», «Cluj Runners», «Runners», «BR» and «Brașov» alone are not.
 */
export function namesTheClub(typed: string | null | undefined, vocabulary: ClubVocabulary = DEFAULT_VOCABULARY): boolean {
  if (typeof typed !== "string" || vocabulary.words === 0) return false;
  const cell = wordsOf(typed)
    .filter((word) => !FILLER.has(word))
    .join("");
  if (cell === "" || cell.length > LONGEST_CELL) return false;

  /*
    A search over the ways to cut the cell, remembered by where it stands: `previous` is the last piece that
    was not a filler, `run` how many of the name's words in order end there, `named` whether the club has
    been named yet. True when the whole cell is cut and the club was named.
  */
  const seen = new Map<string, boolean>();
  const search = (at: number, previous: PieceKind["kind"] | `word${number}` | "", run: number, named: boolean): boolean => {
    if (at === cell.length) return named;
    const key = `${at}|${previous}|${run}|${named}`;
    const known = seen.get(key);
    if (known !== undefined) return known;
    let found = false;
    for (const piece of vocabulary.pieces) {
      for (const length of coverings(cell, at, piece)) {
        let next: typeof previous = previous;
        let nextRun = run;
        let nextNamed = named;
        const is = piece.is;
        if (is.kind === "word") {
          nextRun = is.index === 0 ? 1 : run === is.index ? run + 1 : 0;
          if (nextRun === vocabulary.words) nextNamed = true;
          if (is.index === 0 && previous === "initials") nextNamed = true;
          next = `word${is.index}`;
        } else if (is.kind === "city") {
          nextRun = 1;
          next = "city";
        } else if (is.kind === "initials") {
          if (previous === "word0") nextNamed = true;
          nextRun = 0;
          next = "initials";
        } else if (is.kind === "nickname") {
          nextNamed = true;
          nextRun = 0;
          next = "nickname";
        }
        if (search(at + length, next, nextRun, nextNamed)) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    seen.set(key, found);
    return found;
  };
  return search(0, "", 0, false);
}

/**
 * The cell the list draws under `members_only`, from the typed club: the club's own name when the typed
 * text names it, otherwise nothing. Whoever typed it (§NNN) — the typed text itself never reaches the page.
 */
export function memberClubCell(typed: string | null | undefined): string | null {
  return namesTheClub(typed) ? CLUB_NAME : null;
}
