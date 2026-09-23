import { foldName } from "./name-fold";

/**
 * The signature on the declaration is the declarant's name, typed exactly (§NNN, reversing the
 * "a hint, not a validation" half of §283).
 *
 * The owner, looking at a signature of "Florin Munca2" under "You registered as Florin Munca":
 * "can I also have this validation here? So I have to type the exact name?" §283 had refused it
 * on the ground that a string comparison would be the platform deciding what a person's name is.
 * It is not: the name was given by the same person, at registration, a few minutes or days
 * earlier, and it is the name the declaration's own text already prints as the one who declares
 * (`{{declarant}}`, §108). A signature that disagrees with the text above it is a declaration
 * that contradicts itself — and the only person who can type something else is somebody who was
 * not paying attention, which is precisely what a signature exists to rule out.
 *
 * "Exactly" is made humane by `foldName`: case, runs of whitespace, diacritics (`Ștefan`,
 * `Stefan`, `ŞTEFAN` with a cedilla are one name) and the typographic shape of an apostrophe are
 * forgiven; every letter, digit, hyphen and apostrophe, and the order of the names, are not.
 *
 * Pure and free of server imports on purpose: the signature field in the browser imports this
 * very function for its live check, and the service imports it for the check that decides.
 */

/**
 * Whose name the signature must be (§108): the parent or guardian's for a minor — the parent
 * signs, and the declaration names them as the declarant — and the participant's otherwise.
 * The same truthiness `declarantValues` uses, so the text and the rule never name two people.
 */
export function expectedSignatureName(registration: {
  registeredName: string;
  guardianName: string | null | undefined;
}): string {
  return registration.guardianName ? registration.guardianName : registration.registeredName;
}

/**
 * Is what was typed the name the declaration expects?
 *
 * Empty never matches, whatever the expected name is: a blank signature is a form submitted
 * without one, not a signature that happens to be blank.
 */
export function signatureNameMatches(typed: string, expected: string): boolean {
  const wanted = foldName(expected);
  if (wanted === "") return false;
  return foldName(typed) === wanted;
}
