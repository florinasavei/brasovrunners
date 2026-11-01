/**
 * The club's words still written as a literal, file by file, word by word, with the number of strings that say it (§NNN) — what `club-literals.test.ts` lets through
 * until the later changes move each to `club/club.json`: the catalogues' and the legal templates' wording, the
 * scripts and the CI's local database name, the sample events. A ratchet: each word is counted in strings, so a new string that says it fails even in a listed file, and a file that says a word
 * fewer times fails the test until its count is lowered, and a new one is never added here to make a change pass — read the word from
 * `theme/brand.ts`, `events/domain/place.ts` or `i18n/dates.ts` instead.
 */
export const KNOWN_LEAKS: Record<string, Record<string, number>> = {
  // the local database's name and role in CI (`brasov_runners`)
  ".github/workflows/date-nightly.yml": { Brașov: 4, "Brașov Runners": 4 },
  // the local database's name and role in CI (`brasov_runners`)
  ".github/workflows/docs-check.yml": { Brașov: 4, "Brașov Runners": 4 },
  // the local database's name and role in CI (`brasov_runners`)
  ".github/workflows/e2e-dev-nightly.yml": { Brașov: 4, "Brașov Runners": 4 },
  // the local database's name and role in CI (`brasov_runners`)
  ".github/workflows/release.yml": {
    Brașov: 1,
    "Brașov Runners": 1,
    "Brașov Runners (apart)": 1,
  },
  // the local database's name and role
  "docker-compose.yml": { Brașov: 3, "Brașov Runners": 6, brasovrunners: 3 },
  // the catalogues' wording — moved by the wording change
  "messages/en.json": {
    "#NoOneLeftBehind": 1,
    "#brasovrunners": 1,
    "BV 123456": 5,
    BVR: 7,
    Brașov: 7,
    "Brașov Runners": 11,
    "Girl Zone": 12,
    Poiana: 1,
    Tâmpa: 1,
    brasovrunners: 11,
    Șchei: 1,
  },
  // the catalogues' wording — moved by the wording change
  "messages/ro.json": {
    "#NoOneLeftBehind": 1,
    "#brasovrunners": 1,
    "BV 123456": 5,
    BVR: 7,
    Brașov: 6,
    "Brașov Runners": 11,
    "Girl Zone": 12,
    Poiana: 1,
    "Pădurea Noua": 1,
    Tâmpa: 1,
    brasovrunners: 11,
    Șchei: 1,
  },
  // the package's name
  "package.json": {
    Brașov: 1,
    "Brașov Runners": 2,
    "Brașov Runners (apart)": 1,
    brasovrunners: 1,
  },
  // the scripts' own messages and the local database's name
  "scripts/backstop-verdict.mjs": { Brașov: 1 },
  // the scripts' own messages and the local database's name
  "scripts/bind-domain.mjs": {
    Brașov: 2,
    "Brașov Runners": 2,
    "Brașov Runners (apart)": 2,
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
  // the scripts' own messages and the local database's name
  "scripts/cloud-setup.sh": {
    Brașov: 3,
    "Brașov Runners": 4,
    brasovrunners: 1,
  },
  // the scripts' own messages and the local database's name
  "scripts/db-reset-local.mjs": { "Brașov Runners": 1, brasovrunners: 1 },
  // the scripts' own messages and the local database's name
  "scripts/email-probe.ts": {
    Brașov: 2,
    "Brașov Runners": 2,
    "Brașov Runners (apart)": 2,
  },
  // the scripts' own messages and the local database's name
  "scripts/release.mjs": { "Brașov Runners": 1, brasovrunners: 1 },
  // the scripts' own messages and the local database's name
  "scripts/ship.mjs": { "Brașov Runners": 1, brasovrunners: 1 },
  // the design page's sample event
  "src/modules/design/fixtures.ts": { "Piața Sfatului": 1, Titulescu: 2 },
  // the safety form's name in the relayed message
  "src/modules/feedback/domain/branches.ts": { "Girl Zone": 1 },
  // the legal templates' wording — moved by the legal-clauses change
  "src/modules/legal-documents/templates/privacy-notice.ts": { "Girl Zone": 2 },
  // the legal templates' wording — moved by the legal-clauses change
  "src/modules/legal-documents/templates/tokens.ts": { Titulescu: 2 },
  // the email preview's sample event
  "src/modules/notifications/domain/email-sample.ts": {
    "Livada Poștei": 2,
    Tâmpa: 4,
  },
};
