/**
 * The club's words still written as a literal, file by file (§NNN) — what `club-literals.test.ts` lets through
 * until the later changes move each to `club/club.json`: the catalogues' and the legal templates' wording, the
 * scripts and the CI's local database name, the sample events. A ratchet: a file that stops saying a word fails
 * the test until its entry goes, and a new one is never added here to make a change pass — read the word from
 * `theme/brand.ts`, `events/domain/place.ts` or `i18n/dates.ts` instead.
 */
export const KNOWN_LEAKS: Record<string, readonly string[]> = {
  // the local database's name and role in CI (`brasov_runners`)
  ".github/workflows/date-nightly.yml": ["Brașov", "Brașov Runners"],
  // the local database's name and role in CI (`brasov_runners`)
  ".github/workflows/docs-check.yml": ["Brașov", "Brașov Runners"],
  // the local database's name and role in CI (`brasov_runners`)
  ".github/workflows/e2e-dev-nightly.yml": ["Brașov", "Brașov Runners"],
  // the local database's name and role in CI (`brasov_runners`)
  ".github/workflows/release.yml": ["Brașov", "Brașov Runners"],
  // the local database's name and role
  "docker-compose.yml": ["Brașov", "Brașov Runners", "brasovrunners"],
  // the catalogues' wording — moved by the wording change
  "messages/en.json": ["#NoOneLeftBehind", "#brasovrunners", "BV 123456", "BVR", "Brașov", "Brașov Runners", "Girl Zone", "Poiana", "Tâmpa", "brasovrunners", "Șchei"],
  // the catalogues' wording — moved by the wording change
  "messages/ro.json": ["#NoOneLeftBehind", "#brasovrunners", "BV 123456", "BVR", "Brașov", "Brașov Runners", "Girl Zone", "Poiana", "Pădurea Noua", "Tâmpa", "brasovrunners", "Șchei"],
  // the package's name
  "package.json": ["Brașov", "Brașov Runners", "brasovrunners"],
  // the scripts' own messages and the local database's name
  "scripts/backstop-verdict.mjs": ["Brașov"],
  // the scripts' own messages and the local database's name
  "scripts/bind-domain.mjs": ["Brașov", "Brașov Runners"],
  // the calendar picture's sample months
  "scripts/calendar-image-preview/busy.json": ["#NoOneLeftBehind", "#brasovrunners", "Brașov", "Brașov Runners", "Poiana", "Tâmpa", "brasovrunners"],
  // the calendar picture's sample months
  "scripts/calendar-image-preview/empty.json": ["#NoOneLeftBehind", "#brasovrunners", "Brașov", "Brașov Runners", "brasovrunners"],
  // the calendar picture's sample months
  "scripts/calendar-image-preview/fortnight.json": ["#NoOneLeftBehind", "#brasovrunners", "Brașov", "Brașov Runners", "Olimpia", "Poiana", "Tâmpa", "brasovrunners"],
  // the calendar picture's sample months
  "scripts/calendar-image-preview/june.json": ["#NoOneLeftBehind", "#brasovrunners", "Brașov", "Brașov Runners", "Tâmpa", "brasovrunners"],
  // the calendar picture's sample months
  "scripts/calendar-image-preview/sparse.json": ["#NoOneLeftBehind", "#brasovrunners", "Brașov", "Brașov Runners", "Tâmpa", "brasovrunners"],
  // the scripts' own messages and the local database's name
  "scripts/cloud-setup.sh": ["Brașov", "Brașov Runners", "brasovrunners"],
  // the scripts' own messages and the local database's name
  "scripts/db-reset-local.mjs": ["Brașov Runners", "brasovrunners"],
  // the scripts' own messages and the local database's name
  "scripts/email-probe.ts": ["Brașov", "Brașov Runners"],
  // the scripts' own messages and the local database's name
  "scripts/release.mjs": ["Brașov Runners", "brasovrunners"],
  // the scripts' own messages and the local database's name
  "scripts/ship.mjs": ["Brașov Runners", "brasovrunners"],
  // the design page's sample event
  "src/modules/design/fixtures.ts": ["Piața Sfatului", "Titulescu"],
  // the safety form's name in the relayed message
  "src/modules/feedback/domain/branches.ts": ["Girl Zone"],
  // the legal templates' wording — moved by the legal-clauses change
  "src/modules/legal-documents/templates/privacy-notice.ts": ["Girl Zone"],
  // the legal templates' wording — moved by the legal-clauses change
  "src/modules/legal-documents/templates/tokens.ts": ["Titulescu"],
  // the email preview's sample event
  "src/modules/notifications/domain/email-sample.ts": ["Livada Poștei", "Tâmpa"],
};
