import { foldName } from "./name-fold";

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
 * A guard that cannot be satisfied is a guard that gets removed. Case, whitespace and diacritics
 * are folded away — and the shape of an apostrophe — and nothing else; `name-fold.ts` says why
 * each, and it is shared with the signature on the declaration (§NNN), because two rules asking
 * "is this the same name?" must never give two answers. Without the diacritics the club would
 * be left with rows it is unable to erase.
 *
 * What is *not* folded is the name itself: every word of it has to be there, in order. That is
 * the friction, and it is the whole point.
 *
 * Pure, so it can be tested as a table rather than through a browser, and so the service and any
 * future caller can never disagree about what counts as a match.
 */

/**
 * Does what was typed name the registration it is about to erase?
 *
 * Empty never matches, whatever the row is called: an empty field is a form that was submitted
 * without the confirmation, not a confirmation that happens to be blank.
 */
export function eraseConfirmationMatches(typed: string, registeredName: string): boolean {
  const wanted = foldName(registeredName);
  if (wanted === "") return false;
  return foldName(typed) === wanted;
}
