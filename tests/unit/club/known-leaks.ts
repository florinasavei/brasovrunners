/**
 * The club's words still written as a literal, file by file, word by word, with the number of strings that say it (§882) — what `club-literals.test.ts` lets through
 * until the later changes move each to `club/club.json`: the scripts and the CI's local database name, the calendar picture's sample months.
 * The catalogues have no row and never get one again (§887): this club's own sentences are `club/messages/*.json`, which the guard does not
 * scan, and the platform's catalogues say none of its words. A ratchet: each word is counted in strings, so a new string that says it fails even in a listed file, and a file that says a word
 * fewer times fails the test until its count is lowered, and a new one is never added here to make a change pass — read the word from
 * `theme/brand.ts`, `events/domain/place.ts` or `i18n/dates.ts` instead.
 */
export const KNOWN_LEAKS: Record<string, Record<string, number>> = {
  // the local database's name and role in CI (`brasov_runners`) stay by design (§886, kept by design: the local database, role, container and package name)
  ".github/workflows/date-nightly.yml": { Brașov: 4, "Brașov Runners": 4 },
  // the local database's name and role in CI (`brasov_runners`) stay by design (§886, kept by design: the local database, role, container and package name)
  ".github/workflows/docs-check.yml": { Brașov: 4, "Brașov Runners": 4 },
  // the local database's name and role in CI (`brasov_runners`) stay by design (§886, kept by design: the local database, role, container and package name)
  ".github/workflows/e2e-dev-nightly.yml": { Brașov: 4, "Brașov Runners": 4 },
  // the local database's name and role, its container and volume (`brasovrunners-db`, `brasovrunners_pgdata`) stay by design (§886, kept by design: the local database, role, container and package name)
  "docker-compose.yml": { Brașov: 3, "Brașov Runners": 6, brasovrunners: 3 },
  // the package's name (kept by design, §886) and its description string, left for a later chain
  "package.json": {
    Brașov: 1,
    "Brașov Runners": 2,
    "Brașov Runners (apart)": 1,
    brasovrunners: 1,
  },
  // the calendar picture's sample months
  "scripts/calendar-image-preview/busy.json": {
    "#NoOneLeftBehind": 1,
    "#brasovrunners": 1,
    Brașov: 24,
    "Brașov Runners": 15,
    "Brașov Runners (apart)": 14,
    Poiana: 14,
    Tâmpa: 16,
    brasovrunners: 1,
  },
  // the calendar picture's sample months
  "scripts/calendar-image-preview/empty.json": {
    "#NoOneLeftBehind": 1,
    "#brasovrunners": 1,
    Brașov: 1,
    "Brașov Runners": 2,
    "Brașov Runners (apart)": 1,
    brasovrunners: 1,
  },
  // the calendar picture's sample months
  "scripts/calendar-image-preview/fortnight.json": {
    "#NoOneLeftBehind": 1,
    "#brasovrunners": 1,
    Brașov: 3,
    "Brașov Runners": 2,
    "Brașov Runners (apart)": 1,
    Olimpia: 10,
    Poiana: 3,
    Tâmpa: 2,
    brasovrunners: 1,
  },
  // the calendar picture's sample months
  "scripts/calendar-image-preview/june.json": {
    "#NoOneLeftBehind": 1,
    "#brasovrunners": 1,
    Brașov: 12,
    "Brașov Runners": 13,
    "Brașov Runners (apart)": 12,
    Tâmpa: 12,
    brasovrunners: 1,
  },
  // the calendar picture's sample months
  "scripts/calendar-image-preview/sparse.json": {
    "#NoOneLeftBehind": 1,
    "#brasovrunners": 1,
    Brașov: 3,
    "Brașov Runners": 4,
    "Brașov Runners (apart)": 3,
    Tâmpa: 2,
    brasovrunners: 1,
  },
  // the local database's name and role stay by design (§886, kept by design: the local database, role, container and package name)
  "scripts/cloud-setup.sh": { Brașov: 3, "Brașov Runners": 3 },
  // the local database's container (`brasovrunners-db`) stays by design (§886, kept by design: the local database, role, container and package name)
  "scripts/db-reset-local.mjs": { "Brașov Runners": 1, brasovrunners: 1 },
};
