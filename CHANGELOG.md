# Changelog

Every change to the documentation baseline, newest first. The heading of the top entry is
the current baseline and must equal the `PROJECT_BASELINE` marker on line 1 of every root
document; `docs:check` enforces that. Application releases will be added here under their
own tags once code exists (`README.md` § Versioning).

Format: one entry per baseline, three parts: what changed, which documents, why (pointing at
the `DECISIONS.md` section). Keep entries short; the detail lives in `DECISIONS.md`.

## BR-V1.14-2026-09-03

- Public event pages: `/ro/evenimente` and `/ro/evenimente/[slug]`, with localized pathnames per `AGENTS.md` §9.2 — the same pages are `/en/events` and `/en/events/[slug]`. Server Components, mobile-first, every fact rendered as text (BR-REQ-010-01, BR-REQ-011-01, BR-REQ-020-01, BR-REQ-040-01, BR-REQ-040-02, BR-REQ-070-03).
- `SportsEvent` and `SportsOrganization` JSON-LD, with the event's own UTC offset on start and end times and an organizer reference to the club `@id` (BR-REQ-052-02). Logo and `sameAs` are absent until the club supplies them; the requirement is not yet fully met.
- `sitemap.xml` and `robots.txt`. The sitemap lists only locales with a published translation, so English event URLs are absent while their translations are Draft. QA and local disallow everything (BR-REQ-090-01); no AI training-crawler policy is stated, because that is still an open owner decision.
- New `event_translations.cost_text`: localized wording such as "Gratuit" or "50 lei". BR-REQ-041-01 and BR-REQ-070-03 both require cost on the page as text, and no field existed to hold it. Absent means the club has not stated a cost, never that the event is free.
- `docker-compose.yml` for local PostgreSQL (`SETUP.md` §9). Tests still need nothing — they run PGlite in process.
- The database connection is established on first use rather than at import, so `yarn build` succeeds without a database. Event pages and the sitemap render per request, since organizers publish and cancel between deploys.
- BR-REQ-040-01 criterion 5: event pages emit `hreflang` alternates looked up from the database, so each points at *that locale's own slug*. The slugs differ — `tura-pe-tampa` and `tampa-trail` are one event — so the obvious approach of swapping the locale prefix produces a URL that does not resolve. Draft locales are omitted rather than advertised.
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
