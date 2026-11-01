/**
 * Brașov Runners' identity, as words — the one file under `tests/fork/` allowed to list it (§NNN).
 *
 * `yarn test:fork` builds the platform's identity from a made-up club (`tests/fixtures/fork-club/club.json`) and
 * asserts that none of these words comes out: a word that does is a literal of this club's still written in the
 * code, and a fork would ship it. Folded before comparing (no case, no diacritics); a short code is matched as a
 * whole word only. «Romania» is not here: the platform's region stays Romania for every club running it.
 */
export const UPSTREAM_IDENTITY: readonly string[] = [
  "Brașov Runners",
  "BRASOV RUNNERS",
  "brasovrunners",
  "brasov-runners",
  "BVR",
  "Brașov",
  "BV",
  "BV 123456",
  "#NoOneLeftBehind",
  "Europe/Bucharest",
  "ora României",
  "Romanian time",
  "Girl Zone",
  "Tâmpa",
  "Piața Sfatului",
  "45.6427",
  "25.5887",
];
