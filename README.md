<!-- PROJECT_BASELINE: BR-V1.13-2026-09-02 -->

# Brașov Runners Platform

**Baseline `BR-V1.13-2026-09-02`** · versioned with the whole set · [changelog](./CHANGELOG.md)


A bilingual public website, mini CMS, and free event-registration platform for **Brașov Runners**, a small local running club in Brașov that organizes weekly meetups, larger community events, and local running races or contests.

The project is intentionally one maintainable Next.js modular monolith. It should be simple enough for a freelancer to build, operate, and hand over without introducing unnecessary infrastructure.

## Current status

| | |
| --- | --- |
| Baseline | The `PROJECT_BASELINE` marker on line 1 of every root document; `MANIFEST.txt` repeats it. `docs:check` rejects a mismatch or a stale copy anywhere else. |
| Repository | [`florinasavei/brasovrunners`](https://github.com/florinasavei/brasovrunners); to be transferred to a club-owned organization before handover |
| Code | Scaffold running: Next.js App Router, Material UI, `next-intl` with `ro`/`en`. No database or registration yet. |
| Priority | M1: event pages and registration, defined in [`DECISIONS.md`](./DECISIONS.md) §12 |
| Now | **Weekend pilot:** Romanian event pages on Vercel from Neon, no registration — [`WEEKEND.md`](./WEEKEND.md). `SETUP.md` §29 remains the M1 plan |
| History | [`CHANGELOG.md`](./CHANGELOG.md), one entry per baseline |
| Open questions | Owner decisions in [`BUSINESS.md`](./BUSINESS.md) §9; provisional baseline decisions in [`DECISIONS.md`](./DECISIONS.md) §6 |

## Versioning

Everything in this repository is versioned by one identifier, the **baseline**:

```text
BR-V<major>.<minor>-<YYYY-MM-DD>
```

- It appears as the `PROJECT_BASELINE` marker on line 1 of all six root documents, in
  `MANIFEST.txt`, and as the top heading of [`CHANGELOG.md`](./CHANGELOG.md). `docs:check`
  fails if any of these disagree or if a stale copy appears elsewhere.
- **Minor** bumps for any change to a rule, requirement, scope, structure, or process.
  **Major** bumps when the product itself changes generation, which is not before M1 ships.
  The date is the day the change set was made.
- Every bump is one pull request containing the whole change set, a `CHANGELOG.md` entry,
  and an appended `DECISIONS.md` section explaining why.
- On merge to `main`, tag the commit `baseline/<baseline>`.
- Every document shows its baseline in a visible line under its title, not only in the
  hidden marker, so a printed or emailed copy still says which version it is.
- **Filenames inside the repository stay stable.** `README.md` must be called `README.md` for
  GitHub to render it, and every link, `CODEOWNERS` line, and check keys on the current names.
  Renaming files per version would break all of them on every bump.
- **Filenames outside the repository are versioned.** `yarn release` builds
  `dist/brasovrunners-<baseline>/`, the archive `dist/brasovrunners-<baseline>.zip`, and
  `dist/share/<NAME>-<baseline>.md` standalone copies of every document for sending to people
  who do not use git. It refuses to run when `docs:check` fails. An archive or a shared copy
  without the baseline in its name is not a release.
- Application code, once it exists, is versioned separately by semantic version in
  `package.json` and tagged `v<semver>` on `main`. A code release names the documentation
  baseline it was built against in its changelog entry.

## Start here

**Terminology.** Older passages that say "V1" mean the scoped product as a whole, across
milestones M1 to M5. The launch is **M1**. Milestone assignment is always by the tables in
[`BUSINESS.md`](./BUSINESS.md) §8 and [`AGENTS.md`](./AGENTS.md) §2, never by the word "V1".

### Root documents

Six synchronized documents. All carry the same `PROJECT_BASELINE` marker on line 1, and a
lasting decision updates every affected one and bumps that marker in the same pull request.

| Document | Audience | Purpose |
| --- | --- | --- |
| [`README.md`](./README.md) | Everyone | Entry point, repository map, project summary, branch flow, environments, and commands |
| [`BUSINESS.md`](./BUSINESS.md) | Club organizers and non-technical stakeholders | Plain-language product behavior and the numbered `BR-BUS-*` business rules |
| [`SPECS.md`](./SPECS.md) | Product owner, QA, and developers | The `BR-REQ-*` requirements, priorities, acceptance criteria, and release scope |
| [`AGENTS.md`](./AGENTS.md) | Developers and AI coding/review agents | Architecture, data model, implementation rules, security, testing, and delivery constraints |
| [`SETUP.md`](./SETUP.md) | Repository owner and implementer | Step-by-step repository, provider, environment, and first-release setup |
| [`DECISIONS.md`](./DECISIONS.md) | Maintainers, freelancers, and AI agents | Decision history and rationale; context only, and never overrides the current authoritative documents |

### Supporting files

| Path | Purpose |
| --- | --- |
| [`CLAUDE.md`](./CLAUDE.md) | Entry point for AI coding agents: current mode, live commands, the rules that cannot be broken, the pilot fast lane |
| [`WEEKEND.md`](./WEEKEND.md) | The pilot scope: what one weekend builds, in order, and what it defers and why |
| [`LICENSE`](./LICENSE) | MIT, copyright Brașov Runners; the club owns the platform per BR-BUS-101 |
| [`MANIFEST.txt`](./MANIFEST.txt) | One-page handoff summary of the baseline and the headline decisions |
| [`CHANGELOG.md`](./CHANGELOG.md) | One entry per baseline, newest first; top heading must equal the marker |
| [`scripts/docs-check.mjs`](./scripts/docs-check.mjs) | Enforces documentation synchronization; runs in `yarn check` and CI |
| [`scripts/release.mjs`](./scripts/release.mjs) | `yarn release`: versioned folder, archive, and standalone versioned copies under `dist/` |
| [`scripts/dev.mjs`](./scripts/dev.mjs) | `yarn dev`: starts on port 47821, or the next free one, and keeps `APP_BASE_URL` matching |
| [`scripts/setup.mjs`](./scripts/setup.mjs) | `yarn setup`: points git at `.githooks` so `yarn check` runs before every commit |
| [`.githooks/pre-commit`](./.githooks/pre-commit) | Runs `yarn check` and blocks the commit on failure; the same command CI runs |
| [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) | How to run this locally: prerequisites, first run, every command, and what will catch you out |
| [`docs/PRACTICES.md`](./docs/PRACTICES.md) | Practice guides and checklists: code priorities, delivery, mobile-first, SEO, AIO, accessibility, performance, editorial, launch. Guidance, not authority |
| [`docs/RUNBOOKS.md`](./docs/RUNBOOKS.md) | Three runbooks: [repository bootstrap](./docs/RUNBOOKS.md#repository-bootstrap) for the first push, [domain binding](./docs/RUNBOOKS.md#domain-binding) at the end of M1, [legal document version](./docs/RUNBOOKS.md#legal-document-version) whenever approved wording changes |
| [`docs/history/ORIGINAL_PLAN_2026-08.md`](./docs/history/ORIGINAL_PLAN_2026-08.md) | Original planning input, retained for traceability. **Not authoritative.** It predates Material UI, staff-only auth, passwordless participants, waiting lists, the `qa`/`main` flow, and every hosting decision since. |
| [`.github/workflows/docs-check.yml`](./.github/workflows/docs-check.yml) | Runs `docs:check` on every pull request and on `qa`/`main`; read-only permissions |
| [`.github/CODEOWNERS`](./.github/CODEOWNERS) | Review ownership of the root documents |
| [`.github/pull_request_template.md`](./.github/pull_request_template.md) | Per-pull-request checks, including the documentation sync checklist |
| [`package.json`](./package.json) | Scripts and exact-pinned dependencies; `yarn check` is the aggregate gate |
| [`drizzle.config.ts`](./drizzle.config.ts) | Drizzle Kit config: schema path, migration output, `DATABASE_URL` |
| [`vitest.config.mts`](./vitest.config.mts) | Vitest config; `.mts` because Vite loads a `.ts` config as CommonJS |
| [`next.config.ts`](./next.config.ts) | Next.js configuration, wrapped by the next-intl plugin; nothing host-specific |
| [`tsconfig.json`](./tsconfig.json) | TypeScript, strict, as generated by create-next-app |
| [`eslint.config.mjs`](./eslint.config.mjs) | ESLint flat config from `eslint-config-next`; `yarn lint` |
| [`.nvmrc`](./.nvmrc) | Node version, `22.14.0`, matching `engines.node`; CI reads it via `node-version-file` |
| [`.yarnrc.yml`](./.yarnrc.yml) | Yarn 4 settings: node-modules linker, exact version pins, supply-chain gates |
| [`.env.example`](./.env.example) | Environment variable names and safe local examples, never real values (`AGENTS.md` §8) |
| [`yarn.lock`](./yarn.lock) | Lockfile, so `yarn install --immutable` works from a clean clone; currently no dependencies |
| [`.gitignore`](./.gitignore), [`.editorconfig`](./.editorconfig), [`.gitattributes`](./.gitattributes) | Repository hygiene: ignored paths, editor defaults, line endings |

**This index is complete by rule.** Every file under the repository root, `docs/`,
`scripts/`, `.github/`, and `.githooks/` must be linked from this README. `docs:check` fails
when one is not, so a file added without a row here cannot merge. Application source under
`src/` is described by the structure section below rather than linked file by file.

## If you are an AI agent

Start with [`CLAUDE.md`](./CLAUDE.md), then [`WEEKEND.md`](./WEEKEND.md) while the pilot is
the current mode. Then read this section fully before making any change.

**Order of authority.** When two sources disagree, the higher one wins:

1. the project owner's latest explicit instruction;
2. [`BUSINESS.md`](./BUSINESS.md) for business behavior;
3. [`SPECS.md`](./SPECS.md) for accepted scope and acceptance criteria;
4. [`AGENTS.md`](./AGENTS.md) for implementation;
5. [`SETUP.md`](./SETUP.md) for setup procedure;
6. [`DECISIONS.md`](./DECISIONS.md) and [`docs/history/`](./docs/history/) for rationale only, never as a source of requirements;
7. implementation decisions recorded in [`DECISIONS.md`](./DECISIONS.md);
8. existing tests and repository conventions.

**Read order for a first task.** This README, then [`AGENTS.md`](./AGENTS.md) §0 to §4, then the `BR-REQ-*` requirements your task implements in [`SPECS.md`](./SPECS.md), then the `BR-BUS-*` rules those cite in [`BUSINESS.md`](./BUSINESS.md). Read [`SETUP.md`](./SETUP.md) only for the step you are performing.

**Before writing code, state which requirement IDs you are implementing.** Work that
implements no `BR-REQ-*` either needs a new requirement first or is out of scope. If a task
description conflicts with a requirement, stop and say so rather than choosing.

**Hard rules that are easy to violate:**

- Never invent legal wording, declaration text, privacy text, package exports, provider APIs, GitHub permission names, vendor limits, or traffic and conversion numbers. Record uncertainty instead. See [`AGENTS.md`](./AGENTS.md) §1.2.
- Never add a hostname literal to `src/`. Every absolute URL derives from `APP_BASE_URL`. `docs:check` fails on a violation.
- Never write a rule into exactly one document. Use the change-type matrix in [`AGENTS.md`](./AGENTS.md) §1.4 and edit the whole row in one pull request.
- Never claim a command, table, or field exists until it is in `package.json`, a migration, or the code.
- Never mark a declaration accepted on a participant's behalf, and never bypass email confirmation.
- Never introduce a second frontend, a separate API service, a broker, or an external CMS without a decision recorded in [`DECISIONS.md`](./DECISIONS.md). See [`AGENTS.md`](./AGENTS.md) §3.4.
- Read [`AGENTS.md`](./AGENTS.md) §1.3 and §1.5 before generating code; they list the rejected patterns and the priority order that decides conflicts.
- Do not write a hostname, crawler user-agent name, provider limit, or vendor behavior from memory. Verify it against current official documentation first, and record when you checked.

**Guides worth opening before building a public page:** [`docs/PRACTICES.md` § Mobile-first](./docs/PRACTICES.md#mobile-first),
[`docs/PRACTICES.md` § SEO](./docs/PRACTICES.md#seo),
[`docs/PRACTICES.md` § AIO](./docs/PRACTICES.md#aio),
[`docs/PRACTICES.md` § Accessibility](./docs/PRACTICES.md#accessibility), and
[`docs/PRACTICES.md` § Performance](./docs/PRACTICES.md#performance). They are guidance rather
than authority, and each names the requirement IDs it serves.

**Repository-connected AI integrations are read-only.** That boundary is about credentials,
not about who writes code: see [`AGENTS.md`](./AGENTS.md) §22 and [`DECISIONS.md` §6.11](./DECISIONS.md). A local agent working on a
short-lived branch under a human developer's credentials, whose output goes through normal
pull-request review, is expected and unrestricted by that section.

**Definition of done for any change:** `yarn check` passes, including `docs:check`; tests
cover the acceptance criteria of every requirement you listed; the documentation rows in the
change-type matrix are complete; and the pull-request template checklist is filled in.

## Where a rule lives

| Looking for | Go to |
| --- | --- |
| What the product does, in plain language | [`BUSINESS.md`](./BUSINESS.md) §4 |
| Which milestone something belongs to | [`SPECS.md`](./SPECS.md) §3 and §6; [`BUSINESS.md`](./BUSINESS.md) §8 |
| Acceptance criteria for a behavior | [`SPECS.md`](./SPECS.md) §4, indexed by rule in §5 |
| Registration states and allowed transitions | [`AGENTS.md`](./AGENTS.md) §10.5 |
| Capacity, holds, and queue priority | [`AGENTS.md`](./AGENTS.md) §10.6 and §10.7 |
| Email canonicalization rules | [`AGENTS.md`](./AGENTS.md) §10.4 |
| Database tables and fields | [`AGENTS.md`](./AGENTS.md) §12 |
| Routes and locale slugs | [`AGENTS.md`](./AGENTS.md) §9.2 |
| Message types and the outbox | [`AGENTS.md`](./AGENTS.md) §16 |
| Roles and what each may do | [`BUSINESS.md`](./BUSINESS.md) §3 and BR-BUS-060; [`AGENTS.md`](./AGENTS.md) §10.2 |
| Timing constants | [`AGENTS.md`](./AGENTS.md) §8 and [`SETUP.md`](./SETUP.md) §10 |
| Environment configuration and secrets | [`SETUP.md`](./SETUP.md) §3 and §10 |
| Hostnames and deployment applications | [`SETUP.md`](./SETUP.md) §26, the only hostname table |
| Pull-request sequence, by milestone | [`SETUP.md`](./SETUP.md) §29 |
| Why a decision was made | [`DECISIONS.md`](./DECISIONS.md); baseline `BR-V1.4` decisions are in §6 |
| What wins when two engineering goals conflict | [`AGENTS.md`](./AGENTS.md) §1.5 and [`docs/PRACTICES.md` § Code priorities](./docs/PRACTICES.md#code-priorities) |
| How to sequence the build, and the non-technical risks | [`docs/PRACTICES.md` § Delivery](./docs/PRACTICES.md#delivery) |
| Mobile-first rules and the journeys that must be excellent on a phone | [`AGENTS.md`](./AGENTS.md) §18.5 and [`docs/PRACTICES.md` § Mobile-first](./docs/PRACTICES.md#mobile-first) |
| How to do SEO, structured data, or sitemaps well | [`docs/PRACTICES.md` § SEO](./docs/PRACTICES.md#seo) |
| How to be found and quoted correctly by AI assistants | [`docs/PRACTICES.md` § AIO](./docs/PRACTICES.md#aio) |
| Accessibility expectations and the WCAG 2.2 specifics | [`docs/PRACTICES.md` § Accessibility](./docs/PRACTICES.md#accessibility) |
| Performance targets and MUI cost control | [`docs/PRACTICES.md` § Performance](./docs/PRACTICES.md#performance) |
| How to write an event page or article | [`docs/PRACTICES.md` § Editorial](./docs/PRACTICES.md#editorial) |
| What must be true before the first production release | [`docs/PRACTICES.md` § Launch checklist](./docs/PRACTICES.md#launch-checklist) |

## Product summary

The platform lets people:

- discover Brașov Runners meetups, community runs, events, and races;
- read useful event information in Romanian or English;
- see the exact number of currently available places for capped events;
- register without creating an account or password;
- confirm control of their email address;
- sign the approved event declaration before becoming confirmed;
- join a waiting list when an event is full;
- claim a place from a time-limited waiting-list offer;
- unregister through a secure link received by email;
- optionally publish a small runner profile containing selected social links such as Strava;
- read club articles and view public galleries.

The club can:

- manage events, capacity, registrations, waiting lists, declarations, and transactional email from one backoffice;
- resend the email appropriate to a participant's current registration state;
- cancel, safely restart, waitlist, or promote registrations with an audit trail; a restart re-enters the flow at the correct step for the participant's verification state and never lands directly on Confirmed;
- let approved contributors write and publish content through a small built-in CMS;
- export participant data without exposing it publicly.

## Authentication model

Authentication is deliberately limited to staff:

- `AUTHOR`, `EDITOR`, and `ADMIN` users sign in to the CMS/backoffice through Zitadel;
- ordinary participants do **not** create an application account;
- participant identity is based on a verified email address;
- participant actions use short-lived, purpose-limited email links;
- public profile editing also uses a secure emailed management link.

This avoids password, account-recovery, and user-management friction for runners while keeping staff access protected.

## Registration lifecycle

```text
Submit name + email + privacy acknowledgment
        |
        v
PENDING_EMAIL_CONFIRMATION ----------------+
        |                                  |
        | confirm email                    | link unused for 48h
        v                                  v
  +-----+--------------------------+    EXPIRED
  |                                |
  | place available                | event full
  v                                v
PENDING_DECLARATION             WAITLISTED
  |         |                      |     |
  |         | hold lapses          |     | event starts
  |         v                      |     v
  |      EXPIRED                   |  EXPIRED
  |                                |
  | sign declaration               | place released
  v                                v
CONFIRMED                     WAITLIST_OFFERED
  |                                |     |
  | unregister                     |     | deadline passes
  v                                |     v
CANCELLED                          |  EXPIRED
                                   | sign before deadline
                                   v
                                CONFIRMED

CANCELLED or EXPIRED -> restart while registration is open:
  participant email already verified -> PENDING_DECLARATION or WAITLISTED
  participant email not verified     -> PENDING_EMAIL_CONFIRMATION
```

A registration expires when the confirmation link is unused for 48 hours, when the
declaration hold lapses, when a waiting-list offer deadline passes, or when the
event starts while the participant is still on the waiting list. A restart always
passes through the same capacity transaction and queue allocator as a first-time
registration, so it can never leapfrog an existing waiting list.

A place is counted as occupied by a confirmed registration or by an unexpired temporary hold while the participant completes the declaration or accepts a waiting-list offer.

An existing waiting list has priority over later registrations. The public number means **places immediately available to a new registrant after active holds and waiting-list priority are respected**. A capacity-changing transaction promotes eligible waiting participants before giving a direct place to someone who arrived later.

## Duplicate prevention

The system keeps one participant identity per canonical email and one registration per participant per event.

Email comparison is case-insensitive and trims surrounding whitespace. For consumer Gmail addresses (`gmail.com` and `googlemail.com`, which are the same inbox), dots in the local part and a `+tag` suffix are ignored for duplicate detection, and both domains collapse to one canonical identity. Those Gmail-specific rules are not applied to custom domains or other providers.

This prevents common aliases of the same inbox from creating duplicate registrations. It does not claim to prove that two completely different email addresses belong to the same human.

Because the verified email is the participant identity, the backoffice does not silently edit it or merge participant records. An unverified typo is handled by cancelling the pending registration and starting again with the correct address. Verified email changes and participant merges are explicitly deferred until a safe verified workflow is approved.

## Public runner profiles

A verified participant may opt into a public profile containing:

- public display name;
- short biography;
- optional Strava, Instagram, Facebook, TikTok, YouTube, or personal website links.

V1 profiles:

- never display the participant's email address;
- never display private registration history;
- are not a Strava API integration and do not import activity data;
- are hidden until the participant explicitly publishes them;
- may be moderated or unpublished by an administrator;
- are public by direct URL but excluded from the public sitemap and served with `noindex, nofollow` in V1.

## Scope and milestones

The launchable product is **M1**. Later milestones are scheduled in the owner's order and
built in that order. Full lists: [`BUSINESS.md`](./BUSINESS.md) §8, [`AGENTS.md`](./AGENTS.md) §2.

| Milestone | Delivers |
| --- | --- |
| **M1 — Launch** | Mobile-first public event pages with exact free-place counts; the complete registration journey: confirmation, declaration, holds, waiting list, timed offers, unregistration; staff login and a minimal backoffice; live transactional email; versioned legal documents; production on the custom domain |
| **M2 — Race features** | Multi-distance races, bib assignment and export, results import and publishing with consent, backoffice completeness (resend, export, staff-created registrations) |
| **M3 — Announcements** | Timestamped event updates with editorial approval; notices to registered participants |
| **M4 — Runner profiles** | Opt-in public profiles with social links, moderation |
| **M5 — Mini CMS** | Articles, static pages, galleries and media, Author role in full |

Not planned without an owner decision: payments, minors, medical or identity data, age and
gender categories, paper declarations, check-in and timing integration, recurring-event
automation, Strava/Garmin sync, gamification, newsletters, page builders, a separate backend.

## Technical baseline

| Area | Decision |
| --- | --- |
| Application | Next.js App Router modular monolith |
| Language | TypeScript in strict mode |
| UI | Material UI Core, Emotion, and official MUI App Router integration |
| Rich-text editor | Tiptap open-source core; JSON is the canonical editorial body |
| Internationalization | `next-intl`; Romanian and English |
| Database | PostgreSQL with Drizzle ORM; Neon in QA and production |
| Staff authentication | Auth.js with Zitadel |
| Participant access | Verified email action links; no participant login account |
| Email | Mailgun behind an application adapter and transactional outbox |
| Storage | Cloudflare R2 behind an application adapter |
| Hosting | Vercel Hobby, function region `fra1`; one project per environment, deploying `qa` and `main`. Portable by rule: no Vercel-only runtime API |
| Domain / DNS | A ROTLD-accredited registrar for the `.ro`, transferable later; the custom domain is bound at the end of M1 (see [`SETUP.md`](./SETUP.md) §26) |
| Source control | GitHub |
| Testing | Vitest, disposable PostgreSQL integration tests, and Playwright |

Material UI keeps frontend conventions close to Flyward while the public design remains specific to Brașov Runners rather than looking like a generic administration dashboard.

No paid MUI X or Tiptap cloud feature is required for V1.

## Branch and deployment flow

There are two long-lived branches:

```text
feature/*, fix/*, chore/*
            |
            v
           qa  ------------------> QA host
            |
            | reviewed release PR
            v
          main ------------------> production host
```

Rules:

- `qa` is the default branch and current integrated release candidate;
- normal branches start from `qa` and open pull requests into `qa`;
- feature/fix pull requests use squash merge;
- production promotion is a reviewed `qa -> main` pull request;
- the release pull request uses a merge commit so branch ancestry remains clear;
- direct pushes to `qa` and `main` are blocked;
- `qa` and `main` must pass required CI checks;
- there is no `develop` branch;
- emergency fixes start from `main`, deploy through a reviewed hotfix PR, and are immediately merged back into `qa`.


### Hosting rule

Vercel is the V1 application host, one project per environment. Keep the application portable: it must build with `yarn build`, start with `yarn start`, use the runtime `PORT`, and use no Vercel-only runtime API. Vercel itself never runs `yarn start` — it builds serverless functions — so CI must exercise that contract, or a portability regression stays invisible until a host change (BR-REQ-101-01).

Use two Vercel projects from the same repository:

```text
brasov-runners-qa          <- qa branch   <- QA host
brasov-runners-production  <- main branch <- production host
```

Hostnames are deliberately not written into this document. Both applications run on
their provider-assigned default hostnames until the custom domain is bound at the end
of V1. [`SETUP.md`](./SETUP.md) §26 holds the only hostname table, and
[`docs/RUNBOOKS.md` § Domain binding](./docs/RUNBOOKS.md#domain-binding) is the binding procedure.

`APP_BASE_URL` is the single source of every absolute URL the application produces:
email action links, canonical tags, `hreflang` alternates, `sitemap.xml`, `robots.txt`,
Open Graph URLs, authentication callbacks, and the Mailgun webhook URL. No hostname
literal may appear in `src/`.

The domain and normal DNS stay with whichever registrar holds the `.ro`; that may change over time and the application does not care. Cloudflare remains the documented object-storage provider through R2; using R2 does not by itself require moving the main site's DNS to Cloudflare.

Time-driven work such as email-outbox retries and waitlist/hold expiry must be idempotent and restart-safe. No capacity or queue decision may depend on the maintenance job having run: every read and every capacity-changing transaction evaluates hold expiry against the current time. The scheduler is a delivery and liveness mechanism only, it invokes protected internal job endpoints, and it is infrastructure rather than domain logic.

## Environments

| Environment | Purpose | Data and providers |
| --- | --- | --- |
| Local | Daily development | Local PostgreSQL, mock staff auth, captured email, local/fake storage |
| Test | CI and automated integration tests | Disposable PostgreSQL and fake/capture adapters |
| QA | Integrated testing and club acceptance | Dedicated Neon, Zitadel, R2, and allowlisted/captured email; synthetic data only |
| Production | Live website | Dedicated production resources and authorized real data |

`APP_ENV` distinguishes these environments. `NODE_ENV` is not used as the environment identity.

QA never uses raw production participant data, never sends arbitrary live email, and is always `noindex`.

## Mini CMS

The CMS is part of the same application and supports only real club needs:

- articles and announcements;
- event titles, descriptions, locations, images, SEO fields, and translations;
- selected static content such as About and homepage introduction;
- gallery titles, descriptions, captions, and alternative text;
- Romanian and English content;
- draft, review, publish, unpublish, and archive actions;
- protected preview;
- a small media library;
- optimistic concurrency so one editor cannot silently overwrite another.

Tiptap JSON is stored as the canonical editable body. Public rendering uses an allowlisted Tiptap schema; arbitrary HTML, scripts, remote embeds, collaboration cloud, comments, and paid editor extensions are excluded from V1.

Legal documents (privacy notice, terms, and the event declaration) are versioned, Admin-controlled content stored outside the ordinary Author/Editor workflow. Their wording requires human approval. AI must not invent them. V1 has no editor screen for them; new versions arrive through [the legal document runbook](./docs/RUNBOOKS.md#legal-document-version).

## Read-only AI review

This section governs **repository-connected AI integrations**: any GitHub App, workflow,
or bot that authenticates to the repository. It does not govern a local AI coding tool
operated by a human developer, which works on a short-lived branch under that
developer's own credentials and whose output goes through the normal pull-request
review like any other commit.

Claude, Codex, or another AI reviewer may be connected in **review-only mode**.

Default reviewer access is strictly read-only:

- read repository files and history;
- read pull-request diffs and discussions;
- read checks, Actions runs, statuses, and pipeline logs;
- run tests in an ephemeral runner without repository write credentials;
- publish findings in the workflow job summary or as a review artifact;
- suggest patches as text.

Posting comments is optional. When enabled, a separate trusted relay receives validated review output and posts the comment; the AI review job itself keeps read-only repository permissions.

The scope of this boundary is recorded in [`DECISIONS.md` §6.11](./DECISIONS.md).

Forbidden:

- push commits or tags;
- create, delete, or modify branches;
- open implementation pull requests automatically, or commit without a human author;
- approve, merge, or close releases;
- modify workflow files or repository settings;
- rerun, cancel, or dispatch workflows;
- trigger deployments;
- read repository, provider, or environment secrets.

Enforce this with GitHub App/workflow permissions, branch protection, and deployment permissions—not only with an instruction prompt.

## Local setup contract

After the foundation pull request, a new developer should be able to run:

```bash
yarn install --immutable
yarn setup
cp .env.example .env.local
docker compose up -d db
yarn db:migrate
yarn db:seed
yarn dev
```

`yarn setup` is the one step that is already live today: it points git at
[`.githooks`](./.githooks/pre-commit), so `yarn check` runs before every commit and a
change cannot pass locally but fail in CI. Run it once per clone. The step-by-step
contributor walkthrough is [`SETUP.md`](./SETUP.md) § Contributing.

The repository should expose stable commands:

```text
yarn setup
yarn dev
yarn build
yarn start
yarn lint
yarn format
yarn format:check
yarn typecheck
yarn test
yarn test:unit
yarn test:integration
yarn test:e2e
yarn check
yarn docs:check
yarn db:generate
yarn db:migrate
yarn db:seed
yarn db:reset:local
yarn deploy:build
```

Exact versions belong in `package.json`, `yarn.lock`, and the pinned Node version. Contributors must inspect those files rather than assume versions from this document.

## Suggested repository structure

```text
README.md
BUSINESS.md
SPECS.md
AGENTS.md
SETUP.md
DECISIONS.md
MANIFEST.txt

scripts/
  docs-check.mjs        documentation synchronization check
  release.mjs           versioned release build into dist/
  setup.mjs             yarn setup: installs the tracked git hooks

.githooks/
  pre-commit            runs yarn check and blocks a failing commit

src/
  app/
  modules/
    staff-identity/
    participants/
    registrations/
    events/
    declarations/
    profiles/
    content/
    media/
    notifications/
    audit/
  db/
  infrastructure/
  i18n/
  shared/
  theme/

messages/
  ro.json
  en.json

content/
  legal/          approved source text used to seed the first legal document version

.github/
  workflows/
    docs-check.yml
  CODEOWNERS
  pull_request_template.md

docs/
  PRACTICES.md    all practice guides in one file: code priorities, delivery, mobile,
                  SEO, AIO, accessibility, performance, editorial, launch checklist
  RUNBOOKS.md     repository bootstrap, domain binding, legal document version
  history/        non-authoritative original planning input

tests/
  unit/
  integration/
  e2e/
```

Create folders only when they contain real code.

## Documentation synchronization

| Change | Required document updates |
| --- | --- |
| Participant or club behavior | `BUSINESS.md` and `SPECS.md` |
| Scope, priority, or acceptance criteria | `SPECS.md`; also `BUSINESS.md` when behavior changes |
| Architecture, security, data model, or implementation | `AGENTS.md` |
| Provider/repository/environment setup | `SETUP.md` and relevant technical docs |
| Entry-point summary, branches, environments, or commands | `README.md` |
| Roles, locales, registration lifecycle, CMS workflow, hosting topology, or release flow | Normally all six |
| Baseline decision or headline scope change | All six plus `MANIFEST.txt`, with an appended entry in `DECISIONS.md` |

`AGENTS.md` §1.4 holds the full change-type matrix. A documentation change is never a
single-file edit: it is the complete set of edits across every affected document, in one
pull request, with the baseline marker bumped in the same commit.

[`scripts/docs-check.mjs`](./scripts/docs-check.mjs) implements `yarn docs:check`, which verifies:

- all six baseline markers are identical;
- relative document links resolve;
- business-rule IDs referenced by `SPECS.md` exist in `BUSINESS.md`;
- required root documents exist, including `DECISIONS.md`;
- every requirement ID referenced anywhere in the repository exists in `SPECS.md`;
- every file under the root, `docs/`, `scripts/`, `.github/`, and `.githooks/` is linked from this README;
- no hostname literal appears under `src/`, and the club's own hostname appears nowhere outside [`SETUP.md`](./SETUP.md) §26.

## Implementation order

Summary of [`SETUP.md`](./SETUP.md) §29, which is authoritative.

**M1 — Launch**

1. Foundation: repository, protections, CI, `docs:check`, Next.js, MUI, i18n shell.
2. Database, migrations, seeds, including the three M2 schema footprints.
3. Walking skeleton: one event, one registration, capture-mode email, confirmed, on QA.
4. Staff auth and minimal backoffice.
5. Event pages with exact capacity and structured data.
6. Identity, tokens, legal documents.
7. Registration lifecycle with concurrency tests.
8. Waiting list, jobs, scheduler.
9. Live email. Requires the domain.
10. Launch gate: domain binding, approved legal texts, backups, monitoring, one real registration.

**M2** race features · **M3** announcements · **M4** runner profiles · **M5** mini CMS.

## Ownership

Brașov Runners must own the repository, domain, hosting, database, authentication, email, storage, billing, and recovery access. A freelancer receives least-privilege access and must not remain the only person capable of recovering production.
