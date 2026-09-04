# Changelog

Every change to the documentation baseline, newest first. The heading of the top entry is
the current baseline and must equal the `PROJECT_BASELINE` marker on line 1 of every root
document; `docs:check` enforces that. Application releases will be added here under their
own tags once code exists (`README.md` § Versioning).

Format: one entry per baseline, three parts: what changed, which documents, why (pointing at
the `DECISIONS.md` section). Keep entries short; the detail lives in `DECISIONS.md`.

## BR-V1.14-2026-09-03

- The site root is the events listing. `/ro` and `/en` answer 308 to `/ro/evenimente` and `/en/events`: this site exists so people can find and enter the club's races, and a welcome page in front of that is a page nobody reads. A permanent redirect rather than rendering the listing at two URLs, so there is one address per locale and no canonical to argue about. The `SportsOrganization` JSON-LD moved with the landing role — BR-REQ-052-02 asks the homepage to carry it, and the listing is now the homepage.
- Races come first in the listing, then the soonest. Not a neutral sort and not meant to be: a race three months out sits above a community run tomorrow, because the race is what the site is advertising and the weekly run is what regulars already know about. The date decides only within a kind, and a race that has finished drops out like anything else. If one specific event ever needs to outrank its own kind, that is an editorial flag on the table rather than another clause in the ordering.
- The listing leads with events that have not happened yet, and when there are none it shows the most recent one that has, labelled and dated. Previously it showed everything soonest-first, so between seasons the first card was last month's run, which reads as an abandoned site rather than a quiet month. Past events stay published, linkable and in the sitemap.
- Every event is published in Romanian *and* English, each translation complete. BR-REQ-040-02 is unchanged — an unpublished locale is a 404 and never a fallback to the other language — and `tests/integration/events/publication.test.ts` still proves it with its own data; the seeded rows simply are published now. The end-to-end suite gained a check that the English page serves English words and that each locale resolves only at its own slug, since the slugs genuinely differ.
- A sample anniversary cross in the seed, bilingual. **Its date, distance and meeting point are invented** and must be replaced with the club's real race before this is shown to anyone.
- The header lockup is sized with `clamp` rather than fixed pixels. At 28px the mark and wordmark came to 307px side by side, against the 288px a 320px phone leaves after container padding, so the whole page scrolled sideways — a BR-REQ-041-01 criterion 1 failure that only appears below roughly 360px. Fluid rather than a breakpoint, because the overflow is continuous: a breakpoint at 360 would leave 361 broken.
- The club's kit typeface, Facón, is self-hosted and sets the header wordmark — `BRASOV RUNNERS`, unaccented, matching the printed shirt. It is confined to that one string because the font contains 129 characters and none of them are Romanian: not ș or ț in either encoding, not ă, â or î. The club's name, spelled properly, remains in the message catalogue and is what the header link announces to a screen reader. The fallback is Roboto 900 italic, which is not a guess — the designer's read-me names Roboto Black Italic as the face Facón was drawn from. The TTF is served unmodified, because the licence forbids altering the file and a 36kB TTF needs no conversion.
- `.gitattributes`: images, fonts and PDFs are declared binary, so no line-ending conversion can corrupt one and no review is buried under a megabyte of diff. Text diffs stay on for everything else, deliberately.

- The club's real logo, wired in. `src/theme/brand.ts` is now the only file in `src/` that may name a colour, a font or a logo path, and the MUI theme is assembled from it. The supplied SVG puts its artwork in a band inside a 3000×3000 canvas, so 61% of the height is empty space every layout would reserve; `public/brand/` holds four cropped, editor-metadata-stripped variants — the full lockup and the mountains alone, each in the club's blue and in white for dark grounds. The masters and the kit photograph are kept unprocessed in `docs/brand/`, out of `public/` because that directory is served to the internet. The two enormous PNG exports are deliberately not committed: 111MB, and git does not forget a blob.
- The site header pairs the mountains with the wordmark set as live text rather than showing the full lockup, which is 2.4:1 — at a height that fits a header, the wordmark inside it renders about four pixels tall. Links home, 44px tap target (BR-REQ-041-01 criterion 6). The mark is duplicated as `src/app/icon.svg` for the browser tab, with a test that the two cannot drift apart — nothing imports a Next file-convention icon, so no compiler would notice.
- Two font *roles* rather than one family — display for headings, body for text. Both resolve to Roboto: the kit's display face takes neither, because it cannot spell a Romanian word.
- Every palette pair the pages render is asserted against WCAG AA (BR-REQ-070-02 criterion 4). The club blue is 8.22:1 on the page background; `blueInk` is a hover and pressed step, not a contrast remedy. One documented failure is asserted as a failure: the secondary is 2.64:1 as text, so it is a surface with dark text on it and never text itself. The full audit remains an e2e concern that is not built.
- Two open branding questions are recorded rather than silently decided. The logo file states pure `#0000ff`, while the kit photograph samples at `#0d1c3d`–`#1b2843` navy — lighting does not explain that, since pure blue has no red or green channel. The vector file wins for now, being the only source that states a value rather than photographing one. The kit's navy-to-cyan gradient is captured as a token derived from that photograph, with its measured ramp written down beside it; the authoritative values are in the printer's file.
- Email action tokens (BR-REQ-036-02): `email_action_tokens`, a 32-byte base64url secret that exists only in the email that carried it, and a SHA-256 hash that is the only thing stored. Purpose-scoped, expiring, single use. Three entry points — issue, read, consume — and which one a route uses is a security decision: the read path runs inside `SET TRANSACTION READ ONLY`, so PostgreSQL itself refuses the write that a Gmail or Outlook link prefetch would otherwise perform, and consume is one conditional `UPDATE` so two requests cannot both spend a token. Reissuing invalidates the previous active token, and two partial unique indexes make that structural rather than a habit of the issue function. A `CHECK` refuses any `token_hash` that is not 64 lowercase hex characters, so a raw secret cannot be stored even by a direct insert that bypasses the module.
- The transactional outbox (BR-REQ-080-02): `email_outbox`, with `enqueueEmail` typed to take a transaction — passing the connection pool does not compile — so the row commits with the change that caused it and no provider is reachable inside it. A worker claims batches with `FOR UPDATE SKIP LOCKED` in its own transaction, sends with none open, and retries with bounded exponential backoff to a six-attempt ceiling; a permanent failure is never retried, and `last_error` is redacted of anything token-shaped. Criterion 3, concurrent workers, is unproven rather than tested: PGlite is single-connection and a green test against it would prove only that the SQL parses.
- The email adapter boundary and delivery modes (BR-REQ-080-03): a two-method interface, a capture adapter that is the mailbox in local and test, and a Mailgun stub with no network call and no SDK behind it — it throws, naming the missing sending domain and templates, rather than swallowing mail while looking healthy. Startup now refuses live delivery outside production, any non-capture mode in local or test, allowlist mode with an empty or malformed list, and a transmitting mode without credentials. QA subjects are prefixed `[QA]`, and allowlist membership is compared by canonical email identity rather than by string, so a Gmail alias of an authorized address is authorized too.
- 128 new unit and integration tests, 243 in total, and 18 end-to-end. Nothing routes to any of the above yet: the registration form, the token pages and the job endpoint all wait on the domain and the club's approved texts.
- Public event pages: `/ro/evenimente` and `/ro/evenimente/[slug]`, with localized pathnames per `AGENTS.md` §9.2 — the same pages are `/en/events` and `/en/events/[slug]`. Server Components, mobile-first, every fact rendered as text (BR-REQ-010-01, BR-REQ-011-01, BR-REQ-020-01, BR-REQ-040-01, BR-REQ-040-02, BR-REQ-070-03).
- `SportsEvent` and `SportsOrganization` JSON-LD, with the event's own UTC offset on start and end times and an organizer reference to the club `@id` (BR-REQ-052-02). Logo and `sameAs` are absent until the club supplies them; the requirement is not yet fully met.
- `sitemap.xml` and `robots.txt`. The sitemap lists only locales with a published translation, so English event URLs are absent while their translations are Draft. QA and local disallow everything (BR-REQ-090-01); no AI training-crawler policy is stated, because that is still an open owner decision.
- New `event_translations.cost_text`: localized wording such as "Gratuit" or "50 lei". BR-REQ-041-01 and BR-REQ-070-03 both require cost on the page as text, and no field existed to hold it. Absent means the club has not stated a cost, never that the event is free.
- `docker-compose.yml` for local PostgreSQL (`SETUP.md` §9). Tests still need nothing — they run PGlite in process.
- The database connection is established on first use rather than at import, so `yarn build` succeeds without a database. Event pages and the sitemap render per request, since organizers publish and cancel between deploys.
- BR-REQ-040-01 criterion 5: event pages emit `hreflang` alternates looked up from the database, so each points at *that locale's own slug*. The slugs differ — `tura-pe-tampa` and `tampa-trail` are one event — so the obvious approach of swapping the locale prefix produces a URL that does not resolve. Draft locales are omitted rather than advertised.
- `yarn setup` now also installs a `git gone` alias, which deletes local branches whose remote branch was removed after merge. It uses `-D` because this repository squash-merges, so `-d` refuses every time; the safety is the `[gone]` filter, which only matches a branch whose remote copy is already deleted.
- Migrations renamed from Drizzle's generated names to `0000_events_and_translations`, `0001_event_cost_text` and `0002_participants`. The SQL is byte-identical, so the content hashes an already-migrated database holds still match and nothing re-runs.
- Removed `eventKindMessageKey` and the `Pathnames` type: nothing called them (`AGENTS.md` §1.3).
- `yarn db:reset:local` (`scripts/db-reset-local.mjs`), a command `README.md` had promised and that did not exist. It drops the `drizzle` schema as well as `public`: dropping only `public` leaves Drizzle's migration journal intact, so the next migrate skips the earlier migrations and fails on a missing enum. Refuses any host that is not local and any `APP_ENV` beyond local or test.
- Email canonicalization (BR-REQ-032-01, -02, -04): a pure versioned function per `AGENTS.md` §10.4, the `participants` table with `UNIQUE(canonical_email)`, and the `participants/canonicalize.test.ts` SPECS names. 29 unit tests plus 7 integration tests proving the database rejects an alias rather than trusting application code. Built early because §10.3 makes the canonical email immutable with no merge path, so a mistake here is permanent.
- `WEEKEND.md` corrects the email progression: a Mailgun sandbox reaches at most five authorized addresses, so it is a development tool rather than a launch step, and a `*.vercel.app` domain cannot be verified at all because its DNS is not ours. Two steps, not three. Spam protection starts with a honeypot and rate limiting rather than a third-party script the unapproved privacy notice would have to disclose.
- BR-REQ-040-04 and BR-REQ-040-03 now have the test files SPECS names. Catalogue parity checks identical key sets and identical ICU placeholders; a second check extracts every `t("…")` call from `src/` and fails on a key that exists in neither catalogue, which is what a typo produces. Formatting is asserted per locale: Romanian and English month names, the event's own timezone rather than the server's, and a comma decimal separator in Romanian.
- CI gains a separate `e2e` job with a PostgreSQL service and Chromium. It is separate on purpose: `docs-check` gates every commit and must run on a bare machine with no database.
- Playwright end-to-end tests: 16 across a 320px mobile project and a desktop one, covering no horizontal scrolling, facts as text, 44px tap targets, the parsed `SportsEvent` block, and the three 404 paths (BR-REQ-041-01, BR-REQ-040-02, BR-REQ-052-02). Run with `yarn test:e2e`; kept out of `yarn check`, which must work without a database.
- `README.md` § Technical baseline rewritten in plain language: what each piece is, why it was chosen, and what is deliberately not built yet.
- `docs:check` no longer flags a JSON-LD vocabulary namespace such as `https://schema.org` as a leaked hostname. Providers and CDNs are still rejected; `AGENTS.md` §8 records the exception and its limits.

## BR-V1.13-2026-09-02

- Package manager is Yarn 4.18.0 via Corepack, replacing npm, matching the owner's other project. `.yarnrc.yml` pins dependencies exactly by default; `yarn.lock` replaces `package-lock.json`; every document, the pre-commit hook and CI now say `yarn`.
- Node pinned to `22.14.0` in `.nvmrc` and `engines.node`. CI reads `.nvmrc` rather than `lts/*`, and now also runs `yarn build` and starts the server on `PORT`, because Vercel never exercises that contract (BR-REQ-101-01).
- `events` and `event_translations` with the full M1 column set from `AGENTS.md` §12.3 and §12.4, Drizzle over `node-postgres`. A `CHECK` constraint refuses any non-null `capacity` for the whole pilot, so the capacity engine cannot be half-built (BR-REQ-034-01, BR-REQ-011-01).
- Tests run with no database, no Docker and no setup: PGlite is real PostgreSQL in WebAssembly and applies the same migrations as Neon. 40 tests, named by requirement. Concurrency requirements are explicitly excluded from this harness, which is single-connection.
- `yarn check` is now `docs:check + typecheck + lint + test`; the hook and CI both grew with it and neither needed editing.
- Source restructured to `AGENTS.md` §5: `shared/config`, `shared/ui`, `modules/events`, `db/schema`, `db/seeds`, `tests/{unit,integration,helpers}`.
- New `docs/DEVELOPMENT.md`: prerequisites, first run, every command, the PGlite limit, and the traps that have already cost time.
- TypeScript stays at 5.9.3. 7.0.2 was tried and reverted: `eslint-config-next` pulls `typescript-eslint`, which refuses TS 7 outright.

- First application code. Next.js 16 App Router scaffold with TypeScript strict and `src/`: Material UI 9 through the official `@mui/material-nextjs/v16-appRouter` cache provider, a placeholder non-default palette, Roboto with `latin-ext` for Romanian diacritics, and `next-intl` 4 with `ro` default, `en`, and `localePrefix: always`.
- `npm run dev`, `build`, `start`, `lint` and `typecheck` now exist. `npm run check` is `docs:check` + `typecheck` + `lint`, and the pre-commit hook and CI both run it.
- Verified on a production server: `npm start` honours `PORT`, `/` redirects to `/ro`, both locales prerender, `/en` serves English rather than a Romanian fallback, and an unknown locale 404s instead of falling back (BR-REQ-040-01, BR-REQ-040-02, BR-REQ-101-01).
- Environment is Zod-validated in `src/env.ts`: `APP_ENV` is the environment identity, `APP_BASE_URL` drives `metadataBase`, so no hostname literal exists in `src/` (BR-REQ-101-02).
- `docs:check` no longer demands a README index row for git-ignored files, so build output such as `*.tsbuildinfo` and a developer's `.env.local` cannot fail the check.
- Why: `DECISIONS.md` §20; scope in `WEEKEND.md` step 1.

## BR-V1.12-2026-09-02

- Local development workflow, the first slice of PR 1: `npm run setup` (`scripts/setup.mjs`) sets `core.hooksPath` to the tracked `.githooks`, whose `pre-commit` runs `npm run check` and blocks a failing commit. No dependency added; husky and lint-staged deliberately not installed.
- CI now runs `npm run check` instead of `node scripts/docs-check.mjs`, so the hook and CI can never name different commands. BR-REQ-090-02 gains acceptance criteria 6 and 7.
- Fixed: `docs:check` failed on Windows for every file outside the repository root, because it compared `path.relative` output containing `\` against Markdown links containing `/`. The same bug made the `docs/history` exclusion inert on Windows. `npm run release` was blocked by it.
- Fixed: `npm run release` produced no archive on Windows and still exited 0, because it passed an absolute `D:\...` path to `tar` running with `cwd` already set to `dist/`.
- Redacted the club's unregistered domain from `DECISIONS.md` and `docs/history/ORIGINAL_PLAN_2026-08.md` to `<domain>`, the placeholder `SETUP.md` §26 already used, ahead of making the repository public.
- `docs:check` now fails when the club's own hostname appears outside `SETUP.md` §26, `docs/history/` included. The existing hostname guard only walked `src/`, which does not exist yet, so it could not see a hostname in a Markdown file.
- That guard is driven by `git ls-files`, so it scans exactly what publishing would expose — extensionless files such as `.github/CODEOWNERS` and `.githooks/pre-commit` included — with no size cap and no extension allowlist. It matches case-insensitively and folds the spellings a browser still resolves: fullwidth and ideographic dots, zero-width characters, percent and source-code escapes, punycode labels, and a hostname split by a line wrap. Verified against a 23-case bypass matrix with no false positives.
- `SETUP.md` §26 no longer claims to be the only place *any* hostname appears; `github.com` legitimately appears in four documents. It now states the rule the check actually enforces.
- Added `package-lock.json`; `npm ci` failed from a clean clone without it.
- New `SETUP.md` § Contributing: clone, `npm run setup`, branch naming, `npm run check`, pull request into `qa`. `AGENTS.md` §21 no longer points at a `ci.yml` that does not exist.
- Added `LICENSE`: MIT, copyright Brașov Runners, naming the club rather than the maintainer per BR-BUS-101.
- Softened four passages ahead of publication: three in `docs/PRACTICES.md` § Delivery that framed adoption and maintainer risk as predictions about the club's people, and the "vibe-coded" line in `docs/history/ORIGINAL_PLAN_2026-08.md`, which now carries a superseded note pointing at the human-review rules in `AGENTS.md` §1.5.
- Hosting reversed from GoDaddy to Vercel Hobby (`fra1`, one project per environment) after GoDaddy's own deploy contract was found to block outbound Postgres on 5432 and external SMTP, with no free public tier. `AGENTS.md` §3.1 and §7.3, `SETUP.md` §2, §3 and §26, `README.md`, BR-BUS-101, `MANIFEST.txt`. The app stays portable by rule; CI now exercises `npm start` because Vercel does not.
- Added `CLAUDE.md` (agent entry point) and `WEEKEND.md` (pilot scope): Romanian event pages on Vercel from Neon, no registration, no email, no login. Both indexed and baseline-checked.
- Fast lane for application code during the pilot: no baseline bump or multi-document edit for code; rule changes unchanged; trust-carrying rules unchanged.
- Why: `DECISIONS.md` §19 and §20.

## BR-V1.11-2026-09-02

- Every document shows its baseline in a visible line under its title; `docs:check` requires it and rejects stale literals in `docs/` too.
- `npm run release` (`scripts/release.mjs`) builds a versioned folder, a versioned archive, and standalone `<NAME>-<baseline>.md` copies for sharing. Repository filenames stay stable by policy.
- Why: `DECISIONS.md` §18.

## BR-V1.10-2026-09-02

- Added this changelog and the versioning policy (`README.md` § Versioning, `AGENTS.md` §1.6).
- Archive and git tags now carry the baseline: `brasovrunners-<baseline>.zip`, `baseline/<baseline>`.
- `docs:check` verifies the changelog heading matches the marker.
- Why: `DECISIONS.md` §17.

## BR-V1.9-2026-09-02

- Documentation tree flattened: ten practice guides into `docs/PRACTICES.md`, three runbooks into `docs/RUNBOOKS.md`, ADR directory retired in favour of `DECISIONS.md` alone.
- 31 files in seven directories became 18 in three. All references rewritten.
- Why: `DECISIONS.md` §16.

## BR-V1.8-2026-09-02

- Repository fixed as `florinasavei/brasovrunners`; personal-account ownership recorded as a temporary exception to BR-BUS-101.
- Added `.gitignore`, `.editorconfig`, `.gitattributes`, minimal `package.json`, read-only `docs-check` workflow, `CODEOWNERS` with the maintainer, repository bootstrap runbook.
- Why: `DECISIONS.md` §15.

## BR-V1.7-2026-09-02

- Mobile-first made a rule: BR-BUS-041 and BR-REQ-041-01, `AGENTS.md` §18.5, mobile practice guide, Playwright mobile project required.
- Why: `DECISIONS.md` §14.

## BR-V1.6-2026-09-01

- Milestone model M1 to M5 replaces the "V1" vocabulary; pull-request sequence rewritten as 19 PRs; phases rewritten.
- New rules BR-BUS-012 (races with several distances) and BR-BUS-072 (public-results consent), with requirements; race-level duplicate rule; `races` table, consent fields, `bib_number` footprints.
- Why: `DECISIONS.md` §12 and §13.

## BR-V1.5-2026-08-28

- Discoverability requirements BR-REQ-052-02 (structured data) and BR-REQ-070-03 (server-rendered facts, crawler policy).
- Engineering priority order `AGENTS.md` §1.5; practice guides for SEO, AIO, accessibility, performance, editorial, delivery, code priorities, launch.
- Why: `DECISIONS.md` §6b and §6.12.

## BR-V1.4-2026-08-27

- Audit of BR-V1.3 resolved: `SPECS.md` written (60 requirements), `scripts/docs-check.mjs` added, nine provisional decisions applied, domain binding deferred to the end of M1, read-only AI scope clarified.
- Why: `DECISIONS.md` §6.

## BR-V1.3-2026-08-27

- Original handoff baseline: README, BUSINESS, AGENTS, SETUP, DECISIONS, MANIFEST. `SPECS.md` referenced but absent.
