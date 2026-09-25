import { foldName } from "./name-fold";

/**
 * Whose registration a row is, on an address that may carry several runners (§NNN, a family on one
 * address; BR-REQ-032).
 *
 * The participant is still the address, canonicalized (§74): one inbox, one participant, one
 * throttle, one "my registrations" link. What tells a parent's entry from a child's under that one
 * participant is the runner's own name — the legal name of record, first and last joined
 * (`composeLegalName`) — folded exactly as the signature and the erase confirmation fold a name
 * (`foldName`, §179, §314): case, runs of whitespace, diacritics and an apostrophe's shape are
 * forgiven, every letter, hyphen and word order is not. So "Ștefan Pop", "STEFAN  POP" and
 * "stefan pop" are one runner filling the form twice, and "Ana Pop" and "Maria Pop" are two.
 *
 * Pure and dependency-free, like `name-fold.ts`: the service decides with it under the event's
 * lock, and the same value is written to `registrations.name_key`, which the unique index keeps.
 */
export function registrationNameKey(registeredName: string): string {
  return foldName(registeredName);
}

/** Are these two names one runner, by the key above? An empty name is nobody's. */
export function sameRunner(a: string, b: string): boolean {
  const key = registrationNameKey(a);
  return key !== "" && key === registrationNameKey(b);
}
