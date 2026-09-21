/**
 * The typed name that stands between an Administrator and an erasure (BR-REQ-037-06, §179).
 *
 * Erasing from the list is a different risk from erasing on somebody's own page. On the page you
 * arrived by choosing that person and you have their name, their address and their state in
 * front of you. In the list you are looking at twenty-five rows that re-sort under you, the row
 * you meant and the row above it are one line apart, and the menu that opens is the same menu
 * for both. A dialog with a button is no protection there: "are you sure" is answered yes by
 * reflex, and the reflex is exactly what the second row gets erased by.
 *
 * So the confirmation is a *transcription*: the name on the row has to be typed. It cannot be
 * answered by reflex, it cannot be answered by muscle memory, and it cannot be answered while
 * looking at the wrong row — the wrong row's name will not match.
 *
 * ## Why it forgives what it forgives
 *
 * A guard that cannot be satisfied is a guard that gets removed. Three things are folded away,
 * and nothing else:
 *
 * - **Case**, because a Romanian keyboard and a hurried hand disagree about it constantly.
 * - **Whitespace**, collapsed and trimmed, because a name copied off the row arrives with it.
 * - **Diacritics**, because "Ștefan" is `Ș` (U+0218, comma below) on one keyboard, `Ş` (U+015E,
 *   cedilla) on an older one and plain `S` on a phone, and the club would otherwise be left with
 *   rows it is unable to erase. `admin-repository.ts` folds the same letters, for the same
 *   reason, when it searches.
 *
 * What is *not* folded is the name itself: every word of it has to be there, in order. That is
 * the friction, and it is the whole point.
 *
 * Pure, so it can be tested as a table rather than through a browser, and so the service and any
 * future caller can never disagree about what counts as a match.
 */

/**
 * Lower-cased, whitespace-collapsed, and stripped of anything a diacritic is written with.
 *
 * `NFD` is the entire trick, and it is the platform's rather than a table's (`AGENTS.md` §1.5).
 * Decomposing turns every one of Romanian's ă â î ș ț — precomposed or already written as a
 * letter plus a combining mark, with a comma below or with a cedilla — into a bare ASCII letter
 * followed by a mark in the `Mn` category, which the next line removes. A hand-written map of
 * five letters would do the same thing for the five somebody remembered and silently fail on the
 * sixth; this cannot.
 */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Mn}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does what was typed name the registration it is about to erase?
 *
 * Empty never matches, whatever the row is called: an empty field is a form that was submitted
 * without the confirmation, not a confirmation that happens to be blank.
 */
export function eraseConfirmationMatches(typed: string, registeredName: string): boolean {
  const wanted = fold(registeredName);
  if (wanted === "") return false;
  return fold(typed) === wanted;
}
