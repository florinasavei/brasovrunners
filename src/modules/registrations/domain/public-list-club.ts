/**
 * «Clubul pe lista publică» (§753, amending §32, §143 and §396): what the public list's «Club» column says.
 *
 * The owner, 2026-10-13: «people type stupid things there, I just want to show Brașov Runners members and
 * ignore the other clubs … but I still want to show the BVR ones». The club is free text, a public list is a
 * disclosure (`AGENTS.md` §10.10), and the privacy notice describes the typed club as "the club you wrote" —
 * so the default shows less than the person typed, never more:
 *
 * - `members_only` — the cell holds the club's own name for a row whose person is on the club's members list
 *   (the bibs' own test, `member-ticks.ts#memberCanonicalEmails`) AND whose typed club names the club
 *   (`namesTheClub`); every other cell is blank. A member who typed nothing, or another club, shows
 *   nothing: they did not claim it on the form, and showing their membership anyway would be a disclosure
 *   the notice does not describe.
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

/** Every event that exists, and every one created, shows the club's own members' club only. */
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
 * Words people put around the club's name without changing whose it is: «Clubul …», «Asociația …»,
 * «… Team», «… Club». Folded like everything else (no case, no diacritics). Stripped wherever they stand,
 * so they never decide a match on their own: a cell of nothing but these names no club.
 */
const FILLER = new Set([
  "club",
  "clubul",
  "clubului",
  "asociatia",
  "asociatiei",
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
 * The club's usual nicknames that no rule derives from its name: the county's two-letter plate code
 * plus the first letter of the second word («BVR»). Whole cells after folding, spaces gone, so «B.V.R.»
 * and «bv runners» are the same cell. Nothing else is a nickname: a bare «BR» would name any club.
 */
const NICKNAMES = ["bvr", "bvrunners", "bvrunner"] as const;

/** A string folded to its letters and digits: lower case, no diacritics, no punctuation or spaces. */
function wordsOf(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/**
 * Every spelling of the club's name the list accepts, each as one string of letters and digits — derived
 * from the configured name: the words in order, the last word singular too («Runner»), the words'
 * initials with the first word («BR Brașov») in either order, and the nicknames above. Never the initials
 * alone, never a part of the name.
 */
export function clubSpellings(clubName: string = CLUB_NAME): ReadonlySet<string> {
  const words = wordsOf(clubName).filter((word) => !FILLER.has(word));
  const spellings = new Set<string>();
  if (words.length === 0) return spellings;
  spellings.add(words.join(""));
  const last = words[words.length - 1];
  if (words.length > 1 && last.length > 3 && last.endsWith("s")) spellings.add([...words.slice(0, -1), last.slice(0, -1)].join(""));
  if (words.length > 1) {
    const initials = words.map((word) => word[0]).join("");
    spellings.add(`${initials}${words[0]}`);
    spellings.add(`${words[0]}${initials}`);
  }
  for (const nickname of NICKNAMES) spellings.add(nickname);
  return spellings;
}

const DEFAULT_SPELLINGS = clubSpellings();

/**
 * Whether a typed club names the club itself: the whole cell, once case, diacritics, punctuation, spaces
 * and the filler words above are folded away, is one of the club's spellings. Never a substring of an
 * unrelated word or name — «Brașov Runners Cluj» and «Super Brașov Runners Fans» are other clubs, and
 * «Runners» alone is nobody's.
 */
export function namesTheClub(typed: string | null | undefined, spellings: ReadonlySet<string> = DEFAULT_SPELLINGS): boolean {
  if (typeof typed !== "string") return false;
  const cell = wordsOf(typed)
    .filter((word) => !FILLER.has(word))
    .join("");
  return cell !== "" && spellings.has(cell);
}

/**
 * The cell the list draws under `members_only`, from what the query let through: the club's own name when
 * the typed text names it, otherwise nothing. The query already blanked every non-member's text, so this is
 * the second of the two conditions, never the only one.
 */
export function memberClubCell(typedOfAMember: string | null | undefined): string | null {
  return namesTheClub(typedOfAMember) ? CLUB_NAME : null;
}
