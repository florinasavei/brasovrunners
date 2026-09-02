# Changelog

Every change to the documentation baseline, newest first. The heading of the top entry is
the current baseline and must equal the `PROJECT_BASELINE` marker on line 1 of every root
document; `docs:check` enforces that. Application releases will be added here under their
own tags once code exists (`README.md` § Versioning).

Format: one entry per baseline, three parts: what changed, which documents, why (pointing at
the `DECISIONS.md` section). Keep entries short; the detail lives in `DECISIONS.md`.

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
