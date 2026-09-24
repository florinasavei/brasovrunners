import { foldName } from "./name-fold";

/**
 * The signature on the declaration is the declarant's name, typed exactly (§314, reversing the
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
 * Whose name the declarant's signature must be (§108): the parent or guardian's for a minor — the
 * parent signs, and the declaration names them as the declarant — and the participant's
 * otherwise. The same truthiness `declarantValues` uses, so the text and the rule never name two
 * people. Since §NNN a minor signs as well, in a box of their own, where the declaration in effect
 * asks for it (`expectedSignatures`).
 */
export function expectedSignatureName(registration: {
  registeredName: string;
  guardianName: string | null | undefined;
}): string {
  return registration.guardianName ? registration.guardianName : registration.registeredName;
}

/**
 * The boxes a declaration is signed in, by the name each one posts (§NNN).
 *
 * `typedName` is the declarant's signature, as it has been since §314: the adult's own, or the
 * parent's or guardian's for a minor. `minorTypedName` is the minor's own signature, asked only
 * when a parent declares for them and the declaration in effect asks the minor to sign.
 */
export type SignatureBox = "typedName" | "minorTypedName";

/**
 * Who signs a declaration, and under which name each one must (§NNN, the owner: "the minor
 * signing must be a bit different … also 2 signatures!").
 *
 * An adult signs once, with the name they registered under. A minor's declaration is signed by
 * the parent or guardian, as the declarant (§108, §314) — and, when `minorSigns`, by the minor as
 * well, at the same press, with the name they were registered under: the name the club can
 * correct with "Corectează numele", which is why the two boxes have different ways out when the
 * name itself is wrong. "A minor" is `guardianName` set, the same truthiness
 * `expectedSignatureName` and `declarantValues` use, so the page, the text and the rule never
 * disagree about who signs.
 *
 * `minorSigns` is the production gate of §NNN: whether the declaration in effect names the minor's
 * own document (`asksForMinorSignature`). Required, never defaulted, so every caller says which
 * text it read — the page the one it shows, the service the one it binds the signature to, the
 * desk's paper confirmation the one on the paper. Without it a minor's declaration is signed as it
 * was before §NNN: once, by the parent, and no minor's box is expected — so none is ever wrong.
 */
export function expectedSignatures(
  registration: {
    registeredName: string;
    guardianName: string | null | undefined;
  },
  { minorSigns }: { minorSigns: boolean },
): { typedName: string; minorTypedName: string | null } {
  return {
    typedName: expectedSignatureName(registration),
    minorTypedName: registration.guardianName && minorSigns ? registration.registeredName : null,
  };
}

/**
 * The boxes whose signature is not the name expected of them, in the order the page shows them
 * (the minor's first, then the declarant's). Empty when every signature matches.
 *
 * One function for the service, which refuses what it returns, and for the page, which marks
 * the same boxes after a refusal — so the two can never name a different box. A box that is not
 * expected (the minor's, for an adult or under a text that does not ask the minor to sign) is
 * never wrong, whatever was posted in it.
 */
export function mismatchedSignatures(
  typed: { typedName: string; minorTypedName?: string | null },
  expected: { typedName: string; minorTypedName: string | null },
): SignatureBox[] {
  const wrong: SignatureBox[] = [];
  if (expected.minorTypedName !== null && !signatureNameMatches(typed.minorTypedName ?? "", expected.minorTypedName)) {
    wrong.push("minorTypedName");
  }
  if (!signatureNameMatches(typed.typedName, expected.typedName)) wrong.push("typedName");
  return wrong;
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
