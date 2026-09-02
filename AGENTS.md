<!-- PROJECT_BASELINE: BR-V1.12-2026-09-02 -->

# Brașov Runners — Agent and Engineering Guide

**Baseline `BR-V1.12-2026-09-02`** · versioned with the whole set · [changelog](./CHANGELOG.md)


> Canonical architecture, implementation, security, testing, deployment, CMS, registration, and AI-review rules for every developer or coding agent working in this repository.

**Status:** Authoritative technical baseline  
**Project:** Brașov Runners bilingual community, meetup, event, race-registration, and content platform  
**QA host / Production host:** see [`SETUP.md`](./SETUP.md) §26. Both applications run on
provider-assigned hostnames until the custom domain is bound at the end of M1.

---

## 0. Read this before changing the repository

Brașov Runners is a small local running club that organizes weekly meetups, larger community events, and running races or contests.

Build one maintainable Next.js modular monolith containing:

- Romanian and English public website;
- events and race-filtered listings;
- no-account participant registration by verified email;
- declaration acceptance;
- capacity holds and waiting-list promotion;
- participant self-unregistration by email;
- optional public runner profiles with social links;
- staff-only CMS/backoffice authentication;
- articles, static content, galleries, and media;
- transactional email and delivery history;
- private participant administration.

Do not turn this into a generic race platform, social network, generic CMS, microservice system, or infrastructure project.

The permanent release flow is:

```text
feature/*, fix/*, chore/*
            |
            v
           qa  ------------------> QA deployment
            |
            | reviewed release PR
            v
          main ------------------> Production deployment
```

There is no `develop` branch.

The frontend uses **Material UI**, not Tailwind or shadcn, so conventions remain close to Flyward while the visual identity remains specific to Brașov Runners.

Zitadel authentication is for staff only. Participants do not receive application accounts or passwords.

AI reviewers may read and comment, but reviewer-only integrations must not push code, modify workflows, merge, deploy, or read secrets.

---

## 1. Documentation authority and synchronization

The repository has six synchronized root documents:

| Document | Authority |
| --- | --- |
| `README.md` | Entry point, commands, environment and branch summary |
| `BUSINESS.md` | Canonical non-technical business behavior |
| `SPECS.md` | Canonical scope, requirement IDs, priorities, acceptance criteria |
| `AGENTS.md` | Canonical technical and contributor rules |
| `SETUP.md` | Canonical repository/provider setup and operational bootstrap |
| `DECISIONS.md` | Historical planning rationale; context only, never overrides canonical current rules |

Order of authority:

1. Project owner's latest explicit instruction.
2. `BUSINESS.md` for business behavior.
3. `SPECS.md` for accepted scope and acceptance.
4. This file for implementation.
5. `SETUP.md` for current setup procedure.
6. `DECISIONS.md` for historical rationale only.
7. Implementation decisions recorded in `DECISIONS.md`.
8. Existing tests and repository conventions.
9. Current task plan.

A lasting change to registration behavior, email identity, roles, locales, branches, environments, CMS workflow, security boundary, canonical routes, or architecture must update all affected documents.

All six root documents must carry the same baseline marker as an HTML comment on their
first line:

```text
<!-- PROJECT_BASELINE: <current baseline> -->
```

The current value is the one in this file's first line. Bump it in all six documents in
the same commit. `scripts/docs-check.mjs` rejects a mismatch and rejects more than one
marker per document.

`npm run docs:check` must verify:

- identical baseline marker in all six files;
- required files exist;
- relative links resolve;
- business-rule IDs referenced in `SPECS.md` exist in `BUSINESS.md`;
- requirement IDs referenced anywhere in the repository exist in `SPECS.md`;
- every `BR-BUS-*` heading in `BUSINESS.md` is referenced by at least one requirement;
- every file under the root, `docs/`, `scripts/`, and `.github/` is linked from `README.md`, so the README index stays complete;
- the top heading of `CHANGELOG.md` equals the current baseline;
- every root document, `docs/PRACTICES.md`, and `docs/RUNBOOKS.md` show the baseline in visible text, not only in the marker;
- no hostname literal appears under `src/`, and the club's own hostname appears in no file except `SETUP.md` §26. Every other document writes `<domain>`. This holds for `docs/history/` too, which the requirement scan skips but this check does not.

Do not duplicate large sections when a short summary and link are sufficient.

### 1.5 Priority order when goals conflict

Most changes to this codebase will be made by an AI agent, prompted by someone who did not
write the original code. That is a design input, not a footnote.

When two goals conflict, the higher one wins:

1. correctness of trust-carrying rules: capacity, queue order, declaration acceptance, authorization, participant privacy;
2. legibility to a stranger with no context beyond the repository;
3. one rule implemented in exactly one place;
4. conventional patterns over novel ones;
5. tests as executable specification, named by requirement ID;
6. less code over less duplication; abstract on the third occurrence, not the second;
7. measured performance on paths that matter;
8. elegance.

Binding consequences:

- Every business rule that can be a pure function MUST be one, and time-dependent rules MUST take an injected clock rather than reading the wall clock internally.
- Code vocabulary MUST match `BUSINESS.md`: participant, registration, hold, waiting-list offer, declaration, confirmed. No synonyms.
- Tests MUST be named with the `BR-REQ-*` IDs they cover. `scripts/docs-check.mjs` enforces that referenced IDs exist.
- Errors raised on trust-carrying paths MUST name the rule they enforce.
- Barrel files, runtime dispatch tables in place of literals, metaprogramming, and inheritance beyond one level are rejected in review.

Practice guidance: [`docs/PRACTICES.md` § Code priorities](./docs/PRACTICES.md#code-priorities).

### 1.6 Versioning

The baseline `BR-V<major>.<minor>-<date>` versions the documentation. Bump the minor for any
rule, requirement, scope, structure, or process change; bump the major only when the product
changes generation. Every bump is one pull request with the whole change set, a
`CHANGELOG.md` entry whose heading equals the new marker, and an appended `DECISIONS.md`
section. Tag `main` with `baseline/<baseline>` on merge. Application code is versioned by
semver in `package.json` and tagged `v<semver>`; a code release records the baseline it
implements. Filenames inside the repository stay stable; `npm run release` produces the versioned
folder, archive, and standalone copies. Every document carries a visible baseline line under
its title. `README.md` § Versioning is the full policy.

### 1.4 Change-type matrix

A documentation change is never a single-file edit. It is the complete set of edits
across every affected document, in one pull request, with the baseline marker bumped in
the same commit. Find the row and edit every marked document.

| Change | README | BUSINESS | SPECS | AGENTS | SETUP | DECISIONS | MANIFEST |
| --- | --- | --- | --- | --- | --- | --- | --- |
| New or changed business rule | if summarized | yes | yes | if implementation changes | if a setup step changes | append | if headline |
| Registration state or transition | yes | yes | yes | §10.5 | §19 | append | no |
| New message type | no | BR-BUS-080 | yes | §16.3 | §21 | no | no |
| New token purpose | no | if participant-visible | yes | §12.8 | §17 | no | no |
| Data model field | no | if participant-visible | yes | §12.x | §16 | no | no |
| New route | no | if visitor-visible | yes | §9.2 | no | no | no |
| Role or permission | no | BR-BUS-060 | yes | §10.2, §13 | §15 | append | no |
| Timing constant | no | yes, in words | yes | §8 | §10 | no | no |
| Provider, hosting, or environment | yes | BR-BUS-101 | if acceptance changes | §3.1, §7 | §2, §3, §26 | append | yes |
| Branch or release flow | yes | BR-BUS-090 | no | §6 | §1, §27 | append | yes |
| Scope moved between milestones, or to or from unplanned | yes | §8 | §3, §6 | §2 | §29 | append | yes |

No rule may exist in exactly one document. A rule that appears in only one place is
either an orphan to be removed or a rule that belongs in a different file.

### 1.1 Normative words

**MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

### 1.2 No hallucinated implementation

Before using a framework, package, GitHub permission, provider API, or vendor plan:

1. inspect the installed version and lockfile;
2. inspect repository configuration;
3. check current official documentation;
4. implement only supported behavior;
5. record uncertainty instead of inventing an API or capability.

Never invent:

- package exports;
- provider-specific environment variables already defined by a library;
- GitHub permission names;
- vendor quotas/pricing;
- legal wording or legal effect;
- traffic, registration, or conversion numbers;
- database fields without a requirement;
- commands absent from `package.json`.

### 1.3 No AI slop

Do not add:

- generic architecture essays inside source files;
- comments that merely restate code;
- placeholder interfaces or empty modules;
- speculative TODOs;
- `BaseService`, `GenericRepository`, or generic event-bus abstractions without repeated concrete need;
- duplicate helpers;
- unrelated refactoring;
- empty directory trees;
- wrappers that expose the same API as MUI without product value;
- public copy presented as approved when it is generated;
- tests that only mirror implementation details.

Prefer explicit feature functions, visible business rules, small modules, database constraints, and behavior-focused tests.

---

## 2. Product scope and milestones

The launchable product is **M1**. Later milestones are scheduled in the owner's order
(`DECISIONS.md` §13) and built in that order. `BUSINESS.md` §8 is the plain-language version.

| Milestone | Delivers |
| --- | --- |
| M1 — Launch | Foundation; staff auth and minimal backoffice; public event pages with exact free-place count and structured data; complete registration lifecycle including waiting list, offers, expiry, restart; outbox with capture adapter from the first registration and live Mailgun before real use; legal documents via runbook; production on the custom domain |
| M2 — Race features | Multi-distance race pages and registration UI; bib batch assignment and export; results import and publishing with consent; backoffice completeness: state-aware resend, CSV export, staff-created registrations, exceptional promotion |
| M3 — Announcements | Event updates with editorial approval; `EVENT_UPDATE_NOTICE` to active registrations |
| M4 — Runner profiles | Opt-in public profiles, social links, moderation |
| M5 — Mini CMS | Articles, static pages, galleries and media library, Author role in full |

Requirements for a milestone are written in `SPECS.md` when that milestone starts. Do not
implement a later milestone's behavior early.

**The one permitted exception to "nothing for later".** M1 includes three structural
footprints for M2 because they are trivial now and painful on race week: the `races` table
and `events.race_id`, results consent fields on registrations, and a nullable
`registrations.bib_number`. Nothing else forward-looking is created: no deferred routes,
enum values, provider adapters, or abstractions.

### Not planned

Requires an owner decision recorded in `DECISIONS.md` before any of it is built:

- participant passwords or general participant login;
- payments, refunds, invoices;
- proxy/team/household/minor registration;
- configurable questions/forms;
- medical/emergency/identity-document data; birth year and gender, and therefore result categories;
- paper/offline declaration capture (a bounded form is proposed in `DECISIONS.md` §10);
- verified-email changes and participant-record merges;
- race-day check-in, timing integration, leaderboards;
- points, badges, streaks, rankings;
- recurring-event engine;
- GPX/maps;
- Strava/Garmin OAuth, tokens, API synchronization, activity import;
- searchable public runner directory;
- public attendance history;
- participant-uploaded profile photos;
- bulk race photo hosting;
- newsletters/marketing automation;
- scheduled publishing;
- content comments, full revision history, live collaboration;
- arbitrary page builder;
- public API;
- separate backend/microservices;
- stateful PR preview environments;
- write-capable AI review agents.

---

## 3. Accepted architecture and stack

### 3.1 Runtime stack

| Area | Decision |
| --- | --- |
| Framework | Next.js App Router |
| Language | TypeScript, strict mode |
| Package manager | npm with committed `package-lock.json` |
| Rendering | Server Components by default |
| UI | Material UI Core |
| Styling | Emotion, MUI theme, `sx`, limited CSS Modules |
| MUI/Next | Official `@mui/material-nextjs` integration matching installed versions |
| Editor | Tiptap open-source core |
| Editorial storage | Validated Tiptap JSON; no arbitrary HTML |
| Internationalization | `next-intl` |
| Locales | `ro`, `en` |
| Default locale | `ro` |
| Formatting locales | `ro-RO`, `en-GB` |
| Default timezone | `Europe/Bucharest` |
| Validation | Zod at application boundaries |
| ORM | Drizzle ORM |
| Database | PostgreSQL; Neon for QA/production |
| Staff authentication | Auth.js with Zitadel provider |
| Participant access | Hashed, expiring, purpose-scoped email action tokens |
| Email | Mailgun behind adapter and PostgreSQL outbox |
| Storage | Cloudflare R2 behind adapter |
| Hosting | GoDaddy Node.js Hosting; separate QA/production applications |
| Source control/CI | GitHub and GitHub Actions |
| Unit/integration | Vitest and real disposable PostgreSQL |
| Browser tests | Playwright |

Exact versions are controlled by the repository. Never silently upgrade a major version in unrelated work.

No paid MUI X or Tiptap cloud feature is required for V1.

### 3.2 Material UI rules

Use:

- `@mui/material`;
- `@mui/icons-material` when needed;
- `@emotion/react` and `@emotion/styled`;
- official App Router cache provider matching installed Next.js/MUI versions;
- `ThemeProvider`, `CssBaseline`, and `next/font` integration;
- theme tokens for palette, typography, spacing, breakpoints, shape, shadows, and component defaults.

Do not use Tailwind or shadcn.

Styling conventions:

- theme tokens instead of repeated literal colors;
- `sx` for small local rules;
- `styled`/reusable component for repeated patterns;
- CSS Modules when long-form typography or ordinary CSS is clearer;
- no brittle generated class selectors;
- no wrapper around every MUI component.

Public pages must look like a local running community, not a default MUI dashboard. Admin pages may be denser but remain simple.

### 3.3 High-level architecture

```text
                         GitHub repository
                                 |
                  +--------------+--------------+
                  |                             |
                  v                             v
              qa branch                    main branch
                  |                             |
                  v                             v
          GoDaddy QA app                GoDaddy production app
             QA host                        production host
                  |                             |
       +----------+----------+       +----------+----------+
       |          |          |       |          |          |
       v          v          v       v          v          v
    Zitadel     Neon       R2      Zitadel     Neon       R2
      QA         QA        QA        PROD       PROD      PROD
                  |                             |
              Mailgun QA                  Mailgun PROD
```

Zitadel is used only by staff. Public participant actions are handled by this application's email-token boundary.

Local and test use local/disposable infrastructure and fake/capture adapters.

### 3.4 Architecture constraints

Do not add without a recorded decision in `DECISIONS.md` and a concrete requirement:

- microservices/Kubernetes/self-managed production server;
- separate .NET API;
- second frontend/repository;
- one app per locale;
- participant password authentication;
- custom staff identity provider;
- custom mail server;
- external generic CMS;
- direct browser database access;
- separate race aggregate;
- Redis/message broker/generic event bus;
- shared QA/production resources;
- generic repository abstraction over ordinary Drizzle queries;
- device fingerprinting or cross-account identity correlation.

Provider SDKs remain inside narrow infrastructure adapters.

---

## 4. Repository bootstrap and commands

### 4.1 Required root files

```text
README.md
BUSINESS.md
SPECS.md
AGENTS.md
SETUP.md
DECISIONS.md
package.json
package-lock.json
.env.example
.gitignore
.nvmrc or equivalent Node pin
docker-compose.yml
```

### 4.2 Required scripts

The foundation must expose stable names:

```text
npm run setup
npm run dev
npm run build
npm run start
npm run lint
npm run format
npm run format:check
npm run typecheck
npm run test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run check
npm run docs:check
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:reset:local
npm run deploy:build
```

Do not claim a command exists until it is in `package.json` and tested.

### 4.3 Local setup contract

```bash
npm ci
npm run setup
cp .env.example .env.local
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run setup` installs the tracked git hooks (§6.3). Run it once per clone.

Local setup must not require production/QA credentials.

---

## 5. Suggested source structure

```text
src/
  app/
    [locale]/
      (public)/
      (participant-actions)/
      admin/
    api/
      auth/
      webhooks/
      internal/jobs/

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
    client.ts
    schema/
    migrations/
    seeds/

  infrastructure/
    auth/
    email/
    storage/

  i18n/
  shared/
    config/
    errors/
    logging/
    security/
    seo/
    validation/

  theme/
```

Create directories only when they contain real code.

Dependency direction:

- pages/actions/route handlers orchestrate;
- application modules own use cases;
- domain functions own pure rules;
- Drizzle/provider calls stay in infrastructure/repository functions close to feature;
- domain code does not import React, Next.js, MUI, translation library, or provider SDK;
- Client Components do not import server-only modules;
- provider SDKs do not leak across modules;
- no generic `utils.ts` dumping ground.

---

## 6. Git workflow

### 6.1 Permanent branches

```text
qa
main
```

- `qa`: default branch, integrated release candidate, QA deployment.
- `main`: production branch and production deployment.

### 6.2 Short-lived branches

```text
feature/<short-name>
fix/<short-name>
chore/<short-name>
hotfix/<short-name>
```

Use lowercase kebab-case. Delete after merge.

### 6.3 Normal flow

1. update local `qa` with fast-forward only;
2. branch from `qa`;
3. make focused changes;
4. run relevant checks;
5. push and open PR into `qa`;
6. CI/review/QA;
7. squash merge;
8. `qa` deploys automatically.

`qa` must remain releasable. Do not use it as an unreviewed scratch branch.

Step 4 is enforced locally, not left to memory. `npm run setup` sets `core.hooksPath` to the
tracked `.githooks`, whose `pre-commit` runs `npm run check` and blocks a failing commit. CI
runs the same `npm run check`, so the two cannot drift as `check` grows (BR-REQ-090-02).
Hooks need no dependency: husky and lint-staged are deliberately not installed (§1.5
priority 4 and 6). `--no-verify` exists for emergencies and does not bypass CI.

### 6.4 Production promotion

1. confirm QA acceptance;
2. open `qa -> main` release PR;
3. review complete diff and migration plan;
4. require production checks/approval;
5. merge with merge commit;
6. deploy production;
7. run smoke tests/monitor.

Do not squash the release PR; preserve ancestry.

### 6.5 Hotfix

```text
hotfix/* from main -> reviewed PR to main -> deploy -> main back into qa
```

No permanent divergence.

### 6.6 Protection

Both `qa` and `main`:

- block direct pushes/force pushes/deletion;
- require pull request and required CI;
- require resolved conversations;
- restrict bypass;
- require current branch before merge where practical.

`main` additionally accepts normal releases only from `qa`.

AI reviewer is not CODEOWNER and is never a required approval.

---

## 7. Environments and deployment

### 7.1 Named environments

```ts
type AppEnvironment = "local" | "test" | "qa" | "production";
```

`APP_ENV` is authoritative. `NODE_ENV` cannot distinguish QA from production.

| Environment | Database | Staff auth | Email | Storage | Data |
| --- | --- | --- | --- | --- | --- |
| local | Local PostgreSQL | Mock | Capture | Local/fake | Synthetic |
| test | Disposable PostgreSQL | Mock | Capture | Fake | Disposable |
| qa | Dedicated Neon | Dedicated Zitadel QA | Capture/allowlist | Dedicated R2 | Persistent synthetic |
| production | Dedicated Neon | Dedicated Zitadel production | Live | Dedicated R2 | Authorized real |

### 7.2 Provider modes

```ts
type StaffAuthMode = "mock" | "zitadel";
type EmailDeliveryMode = "capture" | "allowlist" | "live";
type StorageMode = "local" | "fake" | "r2";
```

Required combinations:

| APP_ENV | Auth | Email | Storage |
| --- | --- | --- | --- |
| local | mock | capture | local |
| test | mock | capture | fake |
| qa | zitadel | capture or allowlist | r2 |
| production | zitadel | live | r2 |

Startup rejects unsafe combinations.

### 7.3 GoDaddy Node.js Hosting applications

Recommended:

```text
brasov-runners-qa
  deployment branch: qa
  hostname: provider default until the custom domain is bound

brasov-runners-production
  deployment branch: main
  hostname: provider default until the custom domain is bound
```

The custom domain is bound at the end of M1. `SETUP.md` §26 holds the only hostname
table in the repository, and `docs/RUNBOOKS.md` § Domain binding is the binding procedure.
Binding must be a configuration and DNS change only.

Separate applications prevent environment-variable/deployment mixing. GoDaddy is a hosting adapter, not part of the business/domain architecture.

Hosting rules:

- root `package.json` and `package-lock.json` are required;
- `npm run build` must produce the production build;
- `npm start` must start the application;
- runtime must honor `process.env.PORT`;
- pin a Node.js version compatible with the currently supported GoDaddy runtime; do not assume an unverified future version;
- no Docker or infrastructure YAML is required for normal production startup;
- do not write durable business data to the application filesystem;
- use PostgreSQL for business state and R2 for durable media;
- do not introduce GoDaddy-specific imports into domain modules;
- do not introduce Vercel-only runtime APIs, Edge-only assumptions, Vercel KV, or Vercel Blob;
- keep hosting migration possible without rewriting event, registration, CMS, participant, declaration, or notification modules.

The primary domain and normal DNS may remain at GoDaddy. Cloudflare is still used for R2; the main-site DNS does not need to move to Cloudflare solely because R2 is used.

### 7.4 Database isolation

Production uses separate Neon project/boundary from QA. QA never receives production clone or participant data.

Each deployed database contains environment marker:

```text
app_environment_metadata(environment, provisioned_at)
```

Startup/migrate/seed/reset verifies marker against `APP_ENV` and aborts on mismatch.

### 7.5 QA safeguards

QA:

- synthetic data only;
- `X-Robots-Tag: noindex, nofollow` and restrictive robots;
- no production canonical/sitemap URLs;
- visible QA badge in Admin;
- captured/allowlisted email only;
- separate webhook/job secrets;
- no production storage/auth/database access;
- protected access where supported.

### 7.6 Migrations

- every schema change includes committed Drizzle migration;
- CI applies to disposable PostgreSQL;
- QA before production;
- production migration is explicit/gated/observable;
- no destructive migration from browser/startup;
- use expand/contract when app/schema overlap is possible;
- failed migration blocks deployment;
- rollback considers schema/data compatibility.

### 7.7 Reset and seed

- deterministic/idempotent local/QA seeds;
- reset requires explicit environment marker and confirmation flag;
- production seed/reset prohibited;
- no real email/name/photo in fixtures.

---

## 8. Configuration

Read environment variables once in a server-only module and validate complete combinations with Zod.

Conceptual contract:

```text
APP_ENV
APP_BASE_URL
DATABASE_URL
STAFF_AUTH_MODE
Auth.js/Zitadel values required by installed provider
EMAIL_DELIVERY_MODE
EMAIL_ALLOWLIST
MAILGUN_API_KEY
MAILGUN_DOMAIN
MAILGUN_WEBHOOK_SIGNING_KEY
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_BASE_URL
JOB_SECRET
```

Rules:

- `.env.example` contains names and safe descriptions, never values;
- `.env*` secrets ignored;
- no secrets under `NEXT_PUBLIC_`;
- no scattered `process.env` reads;
- no environment branching in domain logic;
- absolute URLs derive from validated `APP_BASE_URL` and route helpers;
- `APP_BASE_URL` is the single source of every absolute URL the application emits: email
  action links, canonical tags, `hreflang` alternates, `sitemap.xml`, `robots.txt`, Open
  Graph URLs, authentication callback URLs, and the Mailgun webhook URL;
- no hostname literal may appear anywhere under `src/`; `npm run check` fails on one;
- cookies are host-only, with no `domain` attribute set, so a hostname change breaks nothing;
- CSP, CORS, and redirect allowlists read from configuration, never from a literal;
- `R2_PUBLIC_BASE_URL` is configuration; start on the R2 development subdomain;
- production rejects localhost/non-production identifiers;
- QA rejects known production identifiers/live email;
- do not invent Auth.js provider variable names; use installed official contract.

Business timing defaults belong in typed config/constants with tests:

```text
EMAIL_CONFIRMATION_TTL_HOURS = 48
DIRECT_DECLARATION_HOLD_MINUTES = 30
WAITLIST_OFFER_TTL_HOURS = 24
PARTICIPANT_ACTION_SESSION_MINUTES = 30
```

All deadlines are capped by registration close and event start. Changing these defaults updates business/spec docs when behavior changes.

---

## 9. Internationalization and routes

### 9.1 Locales

```ts
type AppLocale = "ro" | "en";
```

One authoritative locale definition is imported by routing, validation, metadata, email, declarations, tests.

```text
src/i18n/
  routing.ts
  request.ts
  navigation.ts
  formats.ts
  locale.ts
messages/
  ro.json
  en.json
```

### 9.2 URL strategy

Always-visible locale prefix:

```text
/ro/...
/en/...
```

`/` redirects to saved valid locale or `/ro`. Explicit URL locale wins. Use top-level `[locale]` and `next-intl` helpers; never concatenate localized URLs manually.

Logical/public route mapping includes:

```text
/events                         /ro/evenimente              /en/events
/events/[slug]                  /ro/evenimente/[slug]       /en/events/[slug]
/events/[slug]/register         /ro/evenimente/[slug]/inscriere
                                /en/events/[slug]/register
/races                          /ro/curse                    /en/races
/news/[slug]                    /ro/noutati/[slug]           /en/news/[slug]
/gallery/[slug]                 /ro/galerie/[slug]           /en/gallery/[slug]
/runners/[slug]                 /ro/alergatori/[slug]        /en/runners/[slug]
/legal/privacy                  /ro/confidentialitate        /en/privacy
/legal/terms                    /ro/termeni                  /en/terms
/admin/...                      /ro/admin/...                /en/admin/...
```

The two legal routes render the current approved version of the corresponding legal
document and are linked from the footer in both locales.

Participant action/manage pages are localized but excluded from public navigation/sitemap/indexing.

Non-human routes are unprefixed:

```text
/api/auth/...
/api/webhooks/mailgun
/api/internal/jobs/email-outbox
/api/internal/jobs/registration-maintenance
/api/health
```

### 9.3 Messages and content

- semantic keys, not English sentence keys;
- no hard-coded user-facing strings;
- CI checks key/interpolation parity;
- enum/error codes stay language-neutral;
- production missing-key fallback logs without PII;
- operational data and localized editorial data are separate;
- translation publication independent per locale;
- no Romanian editorial fallback on English URL.

### 9.4 Dates, units, legal content

- store `timestamptz`;
- format with selected locale/event timezone;
- store distance/elevation in meters;
- declaration/legal versions have localized content/version/effective date;
- AI may format approved text but not invent substance.

---

## 10. Core domain rules

### 10.1 Event

```ts
type EventKind =
  | "COMMUNITY_RUN"
  | "TRAIL_RUN"
  | "INTERVAL_SESSION"
  | "LONG_RUN"
  | "MEETUP"
  | "RACE"
  | "OTHER";

type EventStatus = "SCHEDULED" | "CANCELLED" | "COMPLETED";
type EditorialStatus = "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
type RegistrationMode = "NONE" | "INTERNAL" | "EXTERNAL";
```

Rules:

- race is event kind;
- one registration mode;
- external creates no local participant/registration;
- external provider is display label, not integration enum;
- capacity only internal;
- absent capacity means unlimited;
- absent open means after eligible publication;
- absent close means event start;
- cancelled/completed cannot accept registration;
- requested locale translation must be published;
- internal event references approved declaration template version;
- an event may belong to a race (`race_id`); a race groups child events that share name,
  date, place, and description and differ by distance (`BUSINESS.md` BR-BUS-012);
- a participant may hold at most one active registration across the child events of one
  race; the capacity transaction enforces this alongside the per-event uniqueness.

### 10.2 Staff roles

```ts
type StaffRole = "AUTHOR" | "EDITOR" | "ADMIN";
```

- Author: own/assigned drafts; submit review.
- Editor: all editorial content; publish/unpublish/archive; event content/galleries.
- Admin: registrations, participants, waitlist, declarations, profiles, exports, roles, operations.

Participant is not a staff role.

### 10.3 Participant identity

Participant identity is one canonical email, not a password account.

Store:

- verified delivery email;
- normalized email;
- canonical email;
- canonicalization version;
- current default name/locale;
- verification timestamp.

Do not use public profile slug/social link/device/IP as identity.

The canonical email is immutable in V1. Admin may correct a participant name, but must not overwrite a verified email or merge participant rows. An unverified typo is handled by cancelling the pending registration and starting again with the correct address. A future verified email-change or merge workflow requires an explicit scope decision and migration/audit design.

### 10.4 Email canonicalization

Implement one pure, versioned function. Pseudocode:

```ts
type CanonicalEmail = {
  deliveryEmail: string;
  normalizedEmail: string;
  canonicalEmail: string;
  canonicalizationVersion: 1;
};

function canonicalizeEmail(input: string): CanonicalEmail {
  const trimmed = trimUnicodeWhitespace(input);
  const {local, domain} = parseSingleMailbox(trimmed);
  const normalizedDomain = normalizeDomainToAscii(domain).toLowerCase();
  const normalizedLocal = local.toLowerCase(); // deliberate product policy

  // gmail.com and googlemail.com are the same inbox
  const gmailDomains = new Set(["gmail.com", "googlemail.com"]);
  const isGmail = gmailDomains.has(normalizedDomain);
  const canonicalDomain = isGmail ? "gmail.com" : normalizedDomain;

  let canonicalLocal = normalizedLocal;

  if (isGmail) {
    canonicalLocal = canonicalLocal.split("+", 1)[0].replaceAll(".", "");
  }

  return {
    deliveryEmail: trimmed,
    normalizedEmail: `${normalizedLocal}@${normalizedDomain}`,
    canonicalEmail: `${canonicalLocal}@${canonicalDomain}`,
    canonicalizationVersion: 1
  };
}
```

Rules:

- validate syntax before persistence/send;
- exactly one mailbox, no display-name input;
- preserve verified delivery spelling separately;
- lowercase all addresses for comparison by explicit product choice;
- remove Gmail dots/plus tag only for the exact domains `gmail.com` and `googlemail.com`;
- collapse `googlemail.com` to `gmail.com` in the canonical value only; `normalizedEmail`
  and `deliveryEmail` keep the submitted domain;
- never remove dots/plus for custom domains;
- provider-specific rules are added only with documented behavior, new version, migration plan, and tests;
- unique DB constraint on canonical email;
- never log canonical/delivery email unnecessarily;
- do not claim this detects unrelated addresses owned by the same person.

### 10.5 Registration status

```ts
type RegistrationStatus =
  | "PENDING_EMAIL_CONFIRMATION"
  | "PENDING_DECLARATION"
  | "WAITLISTED"
  | "WAITLIST_OFFERED"
  | "CONFIRMED"
  | "CANCELLED"
  | "EXPIRED";
```

Core invariants:

1. one row per event/participant;
2. unique database constraint;
3. no place consumed before email confirmation;
4. declaration required before Confirmed;
5. Confirmed plus unexpired holds consume capacity;
6. Pending email and Waitlisted do not occupy capacity, but eligible Waitlisted entries have allocation priority over later registrations;
7. no capacity-changing transaction may let a later registration bypass that queue;
8. cancellation is idempotent;
9. self-cancellation allowed before event start;
10. email failure does not roll back committed state;
11. locale/legal/declaration acceptance are historical facts;
12. Admin corrections are explicit/audited;
13. no transition can exceed capacity.

Allowed transitions:

```text
PENDING_EMAIL_CONFIRMATION -> PENDING_DECLARATION
PENDING_EMAIL_CONFIRMATION -> WAITLISTED
PENDING_EMAIL_CONFIRMATION -> EXPIRED
PENDING_DECLARATION        -> CONFIRMED
PENDING_DECLARATION        -> WAITLISTED
PENDING_DECLARATION        -> CANCELLED
PENDING_DECLARATION        -> EXPIRED
WAITLISTED                 -> WAITLIST_OFFERED
WAITLISTED                 -> CANCELLED
WAITLIST_OFFERED           -> CONFIRMED
WAITLIST_OFFERED           -> CANCELLED
WAITLIST_OFFERED           -> EXPIRED
WAITLISTED                 -> EXPIRED
CONFIRMED                  -> CANCELLED

CANCELLED/EXPIRED          -> PENDING_EMAIL_CONFIRMATION
                              when rejoining is eligible and participant.email_verified_at IS NULL
CANCELLED/EXPIRED          -> PENDING_DECLARATION
                              when rejoining is eligible, participant is verified, and a place is allocated
CANCELLED/EXPIRED          -> WAITLISTED
                              when rejoining is eligible, participant is verified, and no place is available
```

A restart must run inside the same capacity transaction and queue allocator as a
first-time registration. It may never leapfrog an existing waiting list and may never
land directly on `CONFIRMED`.

`WAITLISTED -> EXPIRED` is performed by registration maintenance once the event has
started, with `expiry_reason = EVENT_STARTED`. No message is sent for it.

Any other transition requires explicit reviewed rule.

### 10.6 Capacity

For `capacity IS NOT NULL`:

```text
occupied =
  confirmed registrations
  + unexpired PENDING_DECLARATION holds
  + unexpired WAITLIST_OFFERED holds

publicDirectAvailability =
  max(capacity - occupied - eligible WAITLISTED registrations, 0)
```

Rules:

- public count means places a new registrant can receive after active holds and existing waiting-list priority;
- every capacity-changing transaction expires stale holds and calls the queue allocator before giving a place to a later registration;
- event row lock or equivalent safe serialization protects capacity and FIFO allocation;
- public read may subtract eligible waiting entries as a conservative safeguard while maintenance is catching up, but it never mutates state;
- scheduled maintenance expires holds and allocates released places;
- increasing capacity allocates the queue first;
- decreasing capacity below occupied places is rejected;
- no cached free count is a source of truth;
- no capacity or queue decision may depend on the maintenance job having run; every read
  and every capacity-changing transaction evaluates hold expiry against the current time;
- DB integration tests prove no overbooking and no queue leapfrogging.

### 10.7 Waiting list

- only capped/internal/full/open events;
- email confirmed before active waitlist;
- FIFO by `waitlisted_at`, then stable ID;
- existing eligible waiting entries always have priority over later direct registrations;
- one active registration per participant/event;
- promotion creates `WAITLIST_OFFERED` and `hold_expires_at`;
- offer deadline default 24h, capped by close/start;
- signing declaration confirms;
- decline/cancel/expiry releases hold;
- expiry leaves active queue; user may rejoin at end;
- default Admin action promotes next;
- exceptional selected promotion requires reason/audit;
- parallel workers use locking/constraints to prevent duplicate offer.

### 10.8 Declaration

V1 internal registration requires approved declaration version.

- immutable version after use;
- localized title/body;
- deterministic content SHA-256 over canonical serialized JSON;
- participant sees exact version;
- acceptance requires explicit checkbox + typed full name;
- acceptance stores version/hash/locale/name/server timestamp;
- no raw IP/user-agent stored by default;
- staff cannot sign on participant's behalf;
- do not label as qualified electronic signature;
- exact wording/effect approved by human/legal owner.

### 10.9 Public runner profile

- one profile per verified participant;
- private by default;
- manage through email action session;
- public fields: display name, short plain-text bio, slug, allowlisted social URLs;
- no email/registration/declaration/private fields;
- no participant-uploaded image in V1;
- Admin moderation/unpublish;
- excluded from the sitemap and from any directory, and served with `noindex, nofollow`;
- Strava is outbound link only, no API/token/activity sync.

Supported providers:

```ts
type SocialProvider =
  | "STRAVA"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "TIKTOK"
  | "YOUTUBE"
  | "WEBSITE";
```

Validate HTTPS and provider host allowlist. Render safe external links with `rel="noopener noreferrer nofollow"`.

---

## 11. Mini CMS

### 11.1 Boundary

Custom CMS inside application. No arbitrary route/layout/content-type creation.

Supported:

- articles/announcements;
- event translations/SEO fields;
- fixed static page keys;
- gallery translations/image text;
- media selection/upload.

Legal documents (privacy notice, terms, event declaration) are Admin-controlled
versioned content, not ordinary Author content. V1 has no editor screen for them: new
versions arrive through a migration or seed following
`docs/RUNBOOKS.md` § Legal document version. The backoffice shows them read-only. No staff
role may edit a version that a participant has already accepted.

### 11.2 Editorial workflow

```text
DRAFT -> IN_REVIEW -> PUBLISHED -> ARCHIVED
```

- Author: create/edit own draft, submit review.
- Editor/Admin: edit all, return to draft, publish, unpublish, archive.
- Author cannot publish/edit Published.
- Editor/Admin may edit live content after explicit warning.
- publishing per locale.
- no scheduled publication/comments/full history/live collaboration.

### 11.3 Tiptap contract

Use open-source Tiptap core only.

Canonical body is JSON produced by allowlisted schema. Required nodes/marks:

- document/paragraph/text;
- headings;
- bold/italic;
- link;
- bullet/ordered list/list item;
- blockquote;
- media-library image reference if implemented.

Rules:

- validate JSON on server;
- reject unknown nodes/marks/attributes;
- no raw HTML node, scripts, iframes, arbitrary embeds;
- render server-side/static through same allowlisted schema;
- derive plain text for excerpt/search/reading time where needed;
- do not store arbitrary client-generated HTML as authority;
- no paid Tiptap Cloud/collaboration/comments/AI extension;
- editor integrated with MUI and accessible keyboard controls.

### 11.4 Fixed pages

```text
ABOUT
HOME_INTRO
COMMUNITY_INTRO
CONTACT_INFO
```

CMS cannot create routes. Privacy, terms, and declarations are legal documents under
§12.5 and are not fixed pages.

### 11.5 Preview/concurrency/slugs

- staff-authorized preview only;
- selected locale/current draft;
- noindex/no sitemap/no public cache;
- optimistic integer `version` required on save;
- stale save returns conflict;
- slug unique per locale/type;
- editable before first publication;
- stable afterward unless Admin exceptional redirect plan.

### 11.6 AI-assisted content

AI output stays Draft and human reviewed. Never invent results, quotes, sponsors, safety instructions, or legal text. No automatic publication.

---

## 12. Minimum data model (M1, including the M2 footprints)

Use PostgreSQL UUID primary keys unless accepted repository convention differs. Physical names `snake_case`.

### 12.1 Staff users

```text
staff_users
- id uuid PK
- zitadel_subject text UNIQUE NOT NULL
- email text NOT NULL
- display_name text NOT NULL
- preferred_locale ro|en NOT NULL DEFAULT ro
- role AUTHOR|EDITOR|ADMIN NOT NULL
- created_at timestamptz
- updated_at timestamptz
```

No passwords/provider tokens.

### 12.2 Participants

```text
participants
- id uuid PK
- delivery_email text NOT NULL
- normalized_email text NOT NULL
- canonical_email text UNIQUE NOT NULL
- canonicalization_version integer NOT NULL
- default_name text NOT NULL
- preferred_locale ro|en NOT NULL DEFAULT ro
- email_verified_at timestamptz null
- created_at timestamptz
- updated_at timestamptz
```

Do not index/log email beyond operational need. Admin search requires protected normalized/canonical indexes.

### 12.3 Events and races

```text
races
- id uuid PK
- slug_key text
- starts_at timestamptz
- timezone text NOT NULL DEFAULT Europe/Bucharest
- latitude numeric null
- longitude numeric null
- cover_media_asset_id uuid null
- created_by_staff_user_id uuid
- updated_by_staff_user_id uuid
- created_at timestamptz
- updated_at timestamptz

race_translations
- id
- race_id
- locale
- editorial_status
- title
- slug
- summary
- body_json jsonb
- seo_title, seo_description
- published_at null
- version integer
UNIQUE(race_id, locale)

events
- id uuid PK
- race_id uuid null            -- M1 footprint for M2; null for events with no siblings
- kind
- event_status
- starts_at timestamptz
- ends_at timestamptz null
- timezone text NOT NULL DEFAULT Europe/Bucharest
- latitude numeric null
- longitude numeric null
- distance_meters integer null
- elevation_gain_meters integer null
- capacity integer null
- registration_mode
- registration_opens_at timestamptz null
- registration_closes_at timestamptz null
- declaration_document_id uuid null   -- references a legal_documents row with key EVENT_DECLARATION
- external_provider text null
- external_registration_url text null
- cover_media_asset_id uuid null
- created_by_staff_user_id uuid
- updated_by_staff_user_id uuid
- created_at timestamptz
- updated_at timestamptz
```

Checks:

- when `race_id` is set, the event's kind is `RACE`;
- end after start;
- non-negative distance/elevation;
- positive capacity;
- close not before open/not after start for internal;
- capacity/declaration internal only;
- approved declaration required internal;
- external HTTPS/provider fields external only.

Indexes:

```text
(event_status, starts_at)
(kind, starts_at)
(registration_mode, starts_at)
```

### 12.4 Event translations

```text
event_translations
- id
- event_id
- locale
- slug
- title
- excerpt
- body_json jsonb
- location_name
- location_address null
- difficulty_label null
- cover_alt_text null
- seo_title null
- seo_description null
- editorial_status
- author_staff_user_id null
- reviewed_by_staff_user_id null
- published_at null
- version integer
- created_at
- updated_at

UNIQUE(event_id, locale)
UNIQUE(locale, slug)
```

### 12.5 Legal documents

One versioning mechanism serves the privacy notice, the terms, and the event
declaration. Acceptance evidence hashes the same way for all three.

```text
legal_documents
- id
- key PRIVACY_NOTICE|TERMS|EVENT_DECLARATION
- version integer
- effective_at
- is_approved boolean
- content_sha256 text
- created_by_staff_user_id
- approved_by_staff_user_id null
- created_at

UNIQUE(key, version)

legal_document_translations
- id
- legal_document_id
- locale
- title
- body_json jsonb
- created_at

UNIQUE(legal_document_id, locale)
```

A version referenced by an acceptance is immutable. Exactly one approved version per key
is current at a given time, resolved by `effective_at`. The public legal routes render
the current approved version for the requested locale.

### 12.6 Registrations

```text
registrations
- id
- event_id
- participant_id
- status
- locale
- registered_name
- privacy_notice_version integer NOT NULL
- privacy_acknowledged_at timestamptz NOT NULL
- race_id uuid null                    -- denormalized from the event for the race-level uniqueness index
- results_name_consent boolean NOT NULL
- results_consent_version integer NOT NULL
- bib_number integer null              -- M1 footprint; assigned in M2, unique per race, enforced in the assignment transaction
- submitted_at
- email_confirmed_at null
- waitlisted_at null
- offer_created_at null
- hold_expires_at null
- confirmed_at null
- cancelled_at null
- expired_at null
- expiry_reason EMAIL_CONFIRMATION_LAPSED|DECLARATION_HOLD_LAPSED|WAITLIST_OFFER_LAPSED|EVENT_STARTED null
- cancellation_source PARTICIPANT|ADMIN null
- created_at
- updated_at

UNIQUE(event_id, participant_id)
UNIQUE(race_id, participant_id) WHERE race_id IS NOT NULL AND status IN (active statuses)   -- one distance per race
INDEX(event_id, status)
INDEX(participant_id, status)
INDEX(event_id, waitlisted_at, id)
INDEX(event_id, hold_expires_at)
```

### 12.7 Declaration acceptances

```text
declaration_acceptances
- id
- registration_id
- legal_document_id
- declaration_version
- content_sha256
- locale
- typed_name
- accepted_at
- created_at

INDEX(registration_id, accepted_at)
```

Registration confirmation references latest acceptance through relation/query; do not overwrite historical rows.

### 12.8 Email action tokens

```text
email_action_tokens
- id
- participant_id
- registration_id null
- purpose
- token_hash UNIQUE
- expires_at
- used_at null
- invalidated_at null
- created_at

INDEX(participant_id, purpose, expires_at)
INDEX(registration_id, purpose, expires_at)
```

Purpose values:

```text
VERIFY_REGISTRATION_EMAIL
COMPLETE_DECLARATION
MANAGE_REGISTRATION
WAITLIST_OFFER
MANAGE_PROFILE
```

Never store raw token.

### 12.9 Public profiles

```text
participant_profiles
- id
- participant_id UNIQUE
- slug UNIQUE
- public_display_name
- bio text null
- is_public boolean DEFAULT false
- published_at null
- moderated_at null
- moderation_reason null
- version integer
- created_at
- updated_at

participant_social_links
- id
- participant_profile_id
- provider
- url
- sort_order
- created_at
- updated_at

UNIQUE(participant_profile_id, provider)
```

### 12.10 CMS content

```text
articles
- id
- author_staff_user_id
- cover_media_asset_id null
- created_at
- updated_at

article_translations
- id
- article_id
- locale
- slug
- title
- excerpt
- body_json jsonb
- cover_alt_text null
- seo_title null
- seo_description null
- editorial_status
- reviewed_by_staff_user_id null
- published_at null
- version integer
- created_at
- updated_at

UNIQUE(article_id, locale)
UNIQUE(locale, slug)

content_pages
content_page_translations

gallery_albums
gallery_album_translations
media_assets
gallery_items
gallery_item_translations
```

Use the same translation/editorial/version patterns.

### 12.11 Email outbox

```text
email_outbox
- id
- participant_id null
- registration_id null
- message_type
- locale
- recipient_email
- payload_json
- idempotency_key UNIQUE
- requested_by_staff_user_id null
- is_manual_resend boolean DEFAULT false
- status PENDING|PROCESSING|SENT|FAILED|BOUNCED|COMPLAINED
- attempt_count
- next_attempt_at null
- locked_at null
- provider_message_id null
- last_error null
- created_at
- sent_at null

INDEX(status, next_attempt_at, created_at)
INDEX(registration_id, created_at)
```

Each deliberate resend gets a new row/idempotency key.

### 12.12 Audit/environment

```text
audit_logs
- id
- actor_staff_user_id null
- participant_id null
- action
- entity_type
- entity_id null
- metadata_json
- created_at

app_environment_metadata
- singleton_key
- environment
- provisioned_at

job_runs
- id
- job_name
- started_at
- finished_at null
- items_processed integer
- error_count integer
- last_error text null

INDEX(job_name, started_at)
```

`job_runs` exists so a stalled scheduler is visible. The health check reports degraded
when the last successful run of a job is older than its agreed threshold.

Do not put email body, raw token, declaration body, or full participant export in audit metadata.

### 12.13 Deferred tables

Do not add participant auth/password/account-provider tables, questions, medical/emergency/minor data, teams, bibs, check-ins, results, leaderboards, points, badges, GPX, Strava tokens/activities, content comments, collaboration sessions.

---

## 13. Staff authentication and participant action sessions

### 13.1 Staff authentication

Use Auth.js Zitadel provider. Do not hand-roll OIDC/token exchange/session/logout.

Verify installed/current official docs for callback, env names, issuer, logout, redirects, claims.

Local/test may provide development-only seeded staff switcher:

- unavailable QA/production;
- server guarded;
- synthetic identities;
- same authorization helpers.

After provider login:

1. read immutable `sub`;
2. require verified email when supplied;
3. find/create `staff_users` by subject;
4. update safe email/display name;
5. preserve local role/preference.

Never provision public participants through Zitadel.

Server helpers:

```text
getCurrentStaffUser()
requireStaff()
requireStaffRole("AUTHOR" | "EDITOR" | "ADMIN")
```

### 13.2 Email action tokens

Generate with cryptographically secure random bytes, minimum 32 bytes, base64url encode. Store SHA-256 hash only.

Token requirements:

- one purpose;
- one participant;
- optional one registration;
- explicit expiry;
- invalidation/used timestamp;
- no PII encoded;
- no JWT unless reviewed concrete reason;
- safe constant-time hash comparison where applicable;
- rate-limited validation attempts.

GET must be read-only. Preferred flow:

1. email link opens GET token page;
2. server validates enough to display safe context but does not consume/change state;
3. participant submits explicit POST;
4. server consumes token or exchanges it for a short-lived, purpose-limited HTTP-only action session;
5. redirect to clean URL without token;
6. subsequent allowed actions use restricted session;
7. session expires quickly and cannot access staff/admin APIs.

Email scanners fetching GET cannot confirm/cancel/promote.

Token pages:

- `noindex`;
- `Referrer-Policy: no-referrer`;
- no third-party analytics/scripts;
- tokens redacted from logs/errors/traces;
- generic invalid/expired response with resend path.

### 13.3 Participant action authorization

Do not treat action session as general login.

Scope examples:

```text
registration:<registrationId>:verify
registration:<registrationId>:complete
registration:<registrationId>:manage
profile:<participantId>:manage
```

Every participant mutation verifies scope, participant/registration binding, expiry, current state, and CSRF/origin as applicable.

---

## 14. Application conventions

### 14.1 Server and client

- Server Components by default;
- narrow client boundaries for MUI interactivity/Tiptap;
- no provider/database secret in Client Component;
- route handlers for callbacks/webhooks/jobs/token exchange/downloads;
- Server Actions may handle same-app forms when security/caching behavior is understood;
- keep handlers thin, call application services.

### 14.2 Validation

Use Zod or repository standard for:

- form/query/route parameters;
- locale;
- email and social URL;
- action-token input;
- Tiptap JSON;
- webhook payload/signature metadata;
- environment config;
- JSON payloads.

Prefer inferred types from schemas/Drizzle. Avoid `any`; use `unknown` and narrow.

### 14.3 Errors

Stable domain error codes, translated at boundary:

```text
UNAUTHENTICATED
FORBIDDEN
NOT_FOUND
VALIDATION_ERROR
CONFLICT
TOKEN_INVALID
TOKEN_EXPIRED
EMAIL_CONFIRMATION_REQUIRED
DECLARATION_REQUIRED
REGISTRATION_NOT_OPEN
REGISTRATION_CLOSED
EVENT_FULL
WAITLIST_NOT_AVAILABLE
OFFER_EXPIRED
HOLD_EXPIRED
DUPLICATE_REGISTRATION
PROFILE_NOT_PUBLIC
INTERNAL_ERROR
```

Never expose SQL/stack/provider secret/token.

### 14.4 Naming and imports

- database `snake_case`;
- TypeScript `camelCase`/`PascalCase`;
- feature naming follows domain language;
- import through module public APIs where useful;
- no deep cross-feature imports without need;
- no barrel files that create cycles.

### 14.5 Logging and caching

Logs may contain environment, request correlation, entity IDs, safe status/error code.

Never log:

- raw action token;
- email body;
- declaration body/signature;
- session/provider token;
- unnecessary email/name;
- webhook secret/signature;
- export contents.

Public editorial pages may cache. Never shared-public cache:

- Admin/CMS;
- participant action pages;
- registration state/capacity mutation result;
- participant/profile management;
- declarations/acceptance;
- private email history.

Free-place display may use short request-time data with deliberate invalidation, but submission always rechecks transactionally.

---

## 15. Critical workflows

### 15.1 Registration submission

1. resolve event by localized slug to stable ID;
2. validate published locale, status, internal mode, window;
3. validate name/email/locale, the acknowledged privacy-notice version, and the public-results
   choice with its wording version, all against the current approved versions; reject a
   submission missing any of them;
4. canonicalize email;
5. begin transaction;
6. upsert/find participant by canonical email without overwriting verified identity silently;
7. load existing `(event, participant)` registration;
8. if active, keep current state and determine correct resend/recovery;
9. if Cancelled/Expired and rejoin eligible, restart at the step matching the
   participant's verification state: Pending email when `email_verified_at IS NULL`,
   otherwise run the capacity transaction and land on Pending declaration or Waitlisted;
   never restore Confirmed directly and never bypass an existing queue;
10. otherwise create Pending email registration;
11. create fresh verification token hash and invalidate previous active verification tokens;
12. insert verify-email outbox item;
13. commit;
14. return generic “check your email” response.

No place consumed.

### 15.2 Email confirmation

On explicit POST with valid token/action session:

1. begin transaction;
2. lock registration/event;
3. verify current state/registration window;
4. mark participant/registration email confirmed;
5. expire stale holds for event;
6. allocate any currently free places to older eligible waiting entries first;
7. calculate direct availability after occupied holds and waiting-list priority;
8. if capacity unlimited or a direct place remains, transition to Pending declaration and set hold expiry;
9. otherwise transition to Waitlisted/set FIFO timestamp;
10. consume token;
11. insert state-appropriate outbox if needed;
12. commit;
13. show declaration page or waiting-list result.

### 15.3 Declaration signing

1. verify action session/registration/state;
2. load exact declaration translation/version/hash;
3. validate checkbox + typed name;
4. begin transaction and lock event/registration;
5. expire stale holds;
6. verify current hold still active;
7. if expired, allocate older eligible waiting entries first, then renew the hold only if direct capacity remains; otherwise move this participant to Waitlisted at the queue tail and stop;
8. insert immutable acceptance;
9. transition Confirmed, clear hold;
10. create registration-confirmed outbox with manage/cancel token;
11. consume/rotate completion token;
12. commit;
13. invalidate public capacity data.

### 15.4 Public free-place query

- load event capacity/mode/state;
- count Confirmed;
- count unexpired Pending declaration and Waitlist offered holds;
- count eligible Waitlisted entries for allocation priority;
- return `max(capacity - occupied - eligibleWaitlisted, 0)` for a capped event;
- exclude pending email confirmations;
- do not mutate queue state from the public GET;
- do not persist mutable counter as sole source of truth;
- use indexes and transaction recheck.

### 15.5 Self-unregistration

1. GET displays safe state only;
2. explicit POST verifies management token/session;
3. begin transaction, lock event/registration;
4. if already Cancelled, return idempotent result;
5. verify before event start;
6. set Cancelled/source Participant/clear hold;
7. insert cancellation outbox;
8. call transactional `fillAvailableSpots(eventId)`;
9. consume/rotate token;
10. commit;
11. invalidate capacity data.

### 15.6 Fill available spots

Within an event-locked transaction, called by cancellation, hold expiry, capacity increase, and before later direct allocation:

1. expire stale holds;
2. compute available places;
3. while place available and eligible Waitlisted exists (bounded):
   - select oldest `WAITLISTED` row using safe lock (`FOR UPDATE SKIP LOCKED` or equivalent);
   - transition to `WAITLIST_OFFERED`;
   - set offer/hold deadline;
   - create offer token and outbox;
   - decrement local available count;
4. commit without calling Mailgun.

For unlimited events there is no waitlist promotion.

### 15.7 Offer accept/decline/expiry

Accept:

- validate offer/session/deadline;
- display declaration;
- atomic acceptance -> Confirmed as declaration workflow.

Decline/cancel:

- transition Cancelled, release hold, queue message, fill available spots.

Scheduled expiry:

- lock expired offered registrations;
- transition Expired with reason;
- release hold;
- queue expiry email;
- fill available spots.

Rejoin:

- participant uses valid manage flow while window open;
- transition to Waitlisted with new timestamp at queue end.

### 15.8 Admin resend

1. Admin authorization;
2. load registration/participant/current state/delivery history;
3. derive allowed message type from state;
4. refuse meaningless/unsafe resend;
5. rate-limit;
6. create/rotate token if needed;
7. insert new outbox row marked manual resend and actor;
8. audit;
9. commit.

Resend never changes state or marks declaration accepted.

### 15.9 Profile management

1. participant requests link with generic response;
2. if verified participant exists, create manage-profile token/outbox;
3. token exchanges to short-lived profile-scoped action session;
4. validate display name/bio/social URLs;
5. optimistic save;
6. explicit publish/unpublish;
7. Admin moderation may unpublish with reason;
8. public route queries only `is_public=true` and never joins private registrations/email.

### 15.10 CSV export

- Admin only;
- validate filters;
- query necessary fields;
- neutralize values starting `=`, `+`, `-`, `@`;
- authorized short-lived response;
- audit;
- no public storage/log body.

---

## 16. Email

### 16.1 Outbox

Registration/database state is authoritative when Mailgun fails.

Worker:

- small batches;
- safe claim/lock;
- bounded backoff/max attempts;
- sanitized errors;
- at-least-once assumption;
- state-aware idempotency;
- deliberate manual resend gets new identity;
- Admin retry;
- no Redis.

PostgreSQL `FOR UPDATE SKIP LOCKED` may be used when supported by implementation.

### 16.2 Job endpoints

```text
POST /api/internal/jobs/email-outbox
POST /api/internal/jobs/registration-maintenance
```

Require verified scheduler identity or a scoped `JOB_SECRET`. Job correctness MUST NOT depend on an in-memory timer staying alive. A minimal external scheduler may call these endpoints; persisted PostgreSQL state remains authoritative and jobs are idempotent/restart-safe.

Registration maintenance:

- expire pending email tokens/registrations where policy applies;
- expire declaration holds;
- expire waiting-list offers;
- close remaining waiting-list entries for events that have started, with
  `expiry_reason = EVENT_STARTED`;
- call fill available spots;
- bounded/idempotent/observable;
- record a `job_runs` row for every invocation.

The maintenance job is a delivery and liveness mechanism, not a correctness mechanism.
Capacity and queue correctness come from transaction-time expiry evaluation (§10.6). The
job exists to send expiry messages, promote the queue on an otherwise idle event, and
retry the outbox.

Invocation has two layers:

- primary: an in-process interval inside the persistent application calling the same
  internal handler, permitted because correctness does not depend on it;
- watchdog: an external scheduler posting to the job endpoints with `JOB_SECRET`, at
  roughly five minutes for maintenance and one to five minutes for the outbox.

The scheduler is named in `SETUP.md` §26. Changing it must not change business logic.

### 16.3 Message types

```text
VERIFY_REGISTRATION_EMAIL
COMPLETE_DECLARATION
WAITLIST_JOINED
WAITLIST_SPOT_OFFER
REGISTRATION_CONFIRMED
REGISTRATION_CANCELLED
WAITLIST_OFFER_EXPIRED
REGISTRATION_MANAGE_LINK
PROFILE_MANAGE_LINK
REGISTRATION_STATE_NOTICE
```

`REGISTRATION_STATE_NOTICE` is the Admin resend for a cancelled or expired registration.
It states the current status and, when rejoining is eligible, links to the ordinary
public event registration page. It carries no scoped token and creates none.

Complete Romanian/English HTML and text templates. Locale/timezone-aware dates and localized URLs. No fragile sentence fragments.

### 16.4 Modes

- capture: local/test;
- capture or allowlist: QA;
- live: production.

QA subject visibly marked. Startup rejects unsafe combination.

### 16.5 Webhooks

- verify Mailgun signature;
- reject stale/malformed;
- idempotent;
- update sent/delivered/bounced/complained/failed metadata;
- suppress repeated send where provider indicates permanent failure;
- no body/secrets/action token in logs.

---

## 17. Media and storage

Narrow adapter:

```text
put object
read metadata
create public/signed URL
delete object
```

Rules:

- separate QA/production buckets/credentials;
- local/test fake/filesystem;
- opaque keys;
- original filename metadata only;
- validate MIME/extension/signature/size/dimensions;
- raster JPEG/PNG/WebP initially;
- reject SVG unless separately sanitized;
- correct orientation/strip unnecessary EXIF/location;
- serve web-suitable variants;
- reference check before delete;
- orphan cleanup;
- public profile participant upload deferred.

---

## 18. SEO, accessibility, performance

### 18.1 SEO

Published editorial pages require localized unique title/description, self-referencing canonical, hreflang for published equivalents plus `x-default` to Romanian, Open Graph with locale and alternate, semantic headings, server-rendered content, internal links, alt text, and applicable JSON-LD.

Required JSON-LD, server-rendered, one block per entity:

- `SportsOrganization` on the homepage and About page, with a stable `@id` and `sameAs` for official profiles;
- `SportsEvent` on event pages, with `startDate`/`endDate` carrying the event timezone offset, `eventStatus` (`EventCancelled` retained for cancelled events), `eventAttendanceMode`, `location`, `organizer` referencing the club `@id`, `offers`, and for capped events `maximumAttendeeCapacity` and `remainingAttendeeCapacity`;
- `Article` on news pages with `datePublished` and `dateModified`;
- `BreadcrumbList` on detail pages.

`remainingAttendeeCapacity` MUST come from the same computation as the visible free-place count (§10.6). No separate cached number. Structured data MUST NOT contain participant names, emails, registration lists, or declaration data.

Production sitemap includes published editorial pages only.

Exclude/noindex:

- QA;
- Admin/CMS;
- auth callbacks/jobs/webhooks;
- participant action/manage pages;
- declaration pages;
- previews/drafts;
- public runner profiles in V1.

Never place action token in canonical/Open Graph/analytics.

### 18.4 Machine readability and AI crawlers

Public pages MUST render their content in the server HTML response. A fact that exists only
after client hydration, or only behind a tab, accordion, or modal interaction, is not
considered published for retrieval purposes.

Facts that matter (dates, times, meeting points, distances, cost, availability, cancellation)
MUST appear in body text, not only inside styled components.

`robots.txt` distinguishes retrieval and search crawlers from training crawlers. Retrieval
agents are allowed so the club appears in AI answers. The training-crawler policy is an owner
decision recorded in `BUSINESS.md` §9 and `DECISIONS.md`. Regardless of that decision, the
paths excluded in §18.1 stay disallowed for every agent, which is a privacy rule.

Crawler user-agent names MUST be verified against each provider's current documentation
before being written into `robots.txt`, per §1.2, and re-verified quarterly. Do not implement
them from memory.

Serving different content to a crawler than to a person is forbidden.

Practice guidance: [`docs/PRACTICES.md` § SEO](./docs/PRACTICES.md#seo) and
[`docs/PRACTICES.md` § AIO](./docs/PRACTICES.md#aio).

### 18.5 Mobile-first

The phone is the design target; larger layouts derive from it (`BUSINESS.md` BR-BUS-041).

- Base styles are phone styles. In MUI, the unprefixed or `xs` value is the phone; `md` and
  above add. A component written desktop-first and patched for `xs` is rejected in review.
- No horizontal scrolling at any width. Tables that cannot fit render as cards below `md`.
- No hover-only affordance. Anything shown on hover is reachable by tap or present in the page.
- Touch targets in participant journeys are at least 44 by 44 CSS pixels; never below 24.
- Registration, declaration, and offer pages keep the primary action reachable without
  scrolling back, and show any deadline in the first screen.
- Form fields carry correct `type`, `inputmode`, `autocomplete`, and `autocapitalize`.
- Dialogs scroll internally and preserve entered data across rotation; prefer a page.
- Email templates are single column with one primary button and its URL printed below it.
- The backoffice registration list and detail work on a phone; the rest of the backoffice
  may be desktop-comfortable.
- Playwright runs a mobile viewport project for every registration journey.

Practice guidance: [`docs/PRACTICES.md` § Mobile-first](./docs/PRACTICES.md#mobile-first).

### 18.2 Accessibility

Target WCAG 2.2 AA:

- semantic HTML;
- labels/instructions;
- keyboard/focus;
- contrast;
- state not color only;
- live-region feedback;
- reduced motion;
- adequate tap targets;
- test MUI dialogs/menus/forms/Tiptap;
- declaration/offer deadline readable mobile;
- translated labels do not clip.

### 18.3 Performance

- Server Components;
- narrow client islands;
- responsive images;
- limited third-party scripts;
- indexed queries/server pagination;
- no full participant dataset to client;
- no external social embeds;
- measure before optimizing;
- capacity correctness over cache cleverness;
- Core Web Vitals targets at p75 mobile: LCP 2.5 s, INP 200 ms, CLS 0.1;
- editorial content may be cached; the free-place count never is.

Practice guidance: [`docs/PRACTICES.md` § Performance](./docs/PRACTICES.md#performance) and
[`docs/PRACTICES.md` § Accessibility](./docs/PRACTICES.md#accessibility).

---

## 19. Security and privacy

### 19.1 Baseline

- HTTPS QA/production;
- secure Auth.js session/cookies;
- exact OIDC redirects;
- server authorization;
- hashed/expiring scoped action tokens;
- GET email links never mutate;
- CSRF/origin protection;
- validation at boundaries;
- upload/webhook verification;
- least privilege/separate secrets;
- no production data in tests/screenshots;
- tested security headers/CSP;
- backups/restore test.

### 19.2 Personal data

V1 normally stores:

- participant name/email/locale;
- canonical duplicate identity;
- registration state/timestamps;
- declaration acceptance evidence;
- transactional email state;
- optional explicitly public profile fields;
- staff identity/role.

Do not collect phone, birth date, emergency contact, health, address, ID document, device fingerprint, raw IP history without approved requirement/privacy review.

### 19.3 Privacy operations

Before launch humans approve/document:

- legal basis/text;
- declaration wording/effect;
- retention;
- access/correction/export;
- deletion/anonymization;
- historical registration/declaration handling;
- public profile takedown;
- photo removal;
- responsible contact.

### 19.4 Abuse and rate limiting

Protect:

- registration submission;
- management/profile link request;
- token validation;
- Admin resend;
- uploads/auth-adjacent routes.

Use platform-native or small database-backed throttle. Do not add Redis solely for V1. Avoid persisting raw IP longer than necessary; never use IP/device as participant identity.

### 19.5 Public profile safety

- plain-text bio or tightly controlled schema;
- HTTPS/host-validated links;
- no arbitrary embed/HTML;
- no email/registration history;
- Admin moderation;
- direct URL/noindex;
- report/takedown operational path before launch.

---

## 20. Testing

### 20.1 Strategy

- unit: pure rules/normalization/transitions;
- integration: PostgreSQL constraints/transactions/concurrency;
- component: non-trivial UI/editor;
- Playwright: critical journeys;
- QA contract tests: providers.

Avoid large snapshot suites.

### 20.2 Unit tests

Cover:

- email canonicalization: case, whitespace, Gmail dots, Gmail plus, non-Gmail preservation;
- event/registration windows;
- state transition matrix;
- free-place calculation;
- hold/offer deadline capping;
- waitlist FIFO selection;
- declaration hash/version validation;
- social URL/provider validation;
- action token expiry/purpose/scope;
- role permissions;
- CMS transition/Tiptap schema validation;
- i18n route/fallback;
- environment/email-mode validation;
- CSV formula neutralization.

### 20.3 Integration tests

Real disposable PostgreSQL/migrations:

- unique participant canonical email;
- unique event/participant registration;
- duplicate dotted/tagged Gmail reuses identity;
- concurrent capacity confirmation never overbooks;
- an older active waitlist is never bypassed by a later email confirmation;
- public direct-availability respects queued demand;
- expired hold frees capacity;
- cancellation promotes exactly next waiting participant;
- parallel promotion cannot duplicate spot/participant;
- declaration acceptance + confirmation atomic;
- registration/outbox atomic rollback;
- resend creates new outbox/token without state change;
- action token hash/single-use/invalidation;
- profile public query excludes private fields;
- locale publication/slug uniqueness;
- CMS stale-version rejection;
- environment marker/seeds/audit.

### 20.4 E2E

Local E2E uses mock staff auth/captured email and test helper to extract action links.

Core journeys:

1. Romanian/English homepage/event discovery.
2. See free-place count.
3. Submit registration without login.
4. Open verify link via GET and assert no state change.
5. Confirm via POST.
6. Sign declaration and become Confirmed.
7. Confirmation email contains management link.
8. Dotted/tagged Gmail attempt does not create duplicate.
9. Unregister via explicit confirmation and release place.
10. Full event joins Waitlisted.
11. Cancellation creates Waiting-list offer.
12. Offered participant signs declaration and confirms.
13. Offer decline/expiry promotes next.
14. Admin resends current required email.
15. Unauthorized non-Admin cannot access participant data.
16. Participant requests profile link, publishes profile/social links.
17. Public profile excludes email/registrations and is noindex.
18. Admin unpublishes profile.
19. Author creates/submits draft; Editor publishes locales independently.
20. Drafts/actions/Admin absent from sitemap.
21. QA noindex behavior.

### 20.5 QA provider checks

- real staff Zitadel login/logout;
- Mailgun allowlisted delivery/webhook;
- R2 upload/read/delete;
- outbox scheduler/retry;
- registration maintenance scheduler;
- bilingual templates;
- token URL does not leak in logs/analytics;
- MUI SSR/hydration;
- AI reviewer permission audit if enabled.

External provider availability must not block every PR.

### 20.6 Translation validation

Fail CI for key/interpolation mismatch, invalid JSON, unsupported locale, missing legal/declaration translation required by event, untranslated required enum presentation.

---

## 21. Continuous integration

Today `.github/workflows/docs-check.yml` runs on PRs/pushes to `qa`/`main`. It invokes
`npm run check`, the same command `.githooks/pre-commit` runs. Keep it that way: CI and the
hook must never name different commands, or a change can pass locally and fail in CI
(BR-REQ-090-02). The workflow is renamed to `ci.yml` when the full pipeline below replaces
it; until then its check name stays stable for branch protection.

Typical order once the application exists:

```text
checkout
setup pinned Node
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run docs:check
npm run test:unit
start disposable PostgreSQL
npm run db:migrate
npm run test:integration
npm run build
```

Playwright may run in same/parallel job after build depending runtime.

Rules:

- lockfile install only;
- every CI step a developer can run locally belongs inside `npm run check`, so the hook and CI stay one command;
- least-privilege workflow token;
- no production secrets on PR jobs;
- no untrusted fork code with privileged secrets;
- migrations tested;
- required checks named stably;
- failures block merge;
- never claim checks passed when not run.

Production deployment build must verify branch/environment marker before migration/release.

---

## 22. Read-only AI reviewers

### 22.1 Scope and security objective

This section governs **repository-connected AI integrations**: any GitHub App, workflow,
or bot that authenticates to the repository. It does not govern a local AI coding tool
operated by a human developer, which works on a short-lived branch under that
developer's own credentials and whose output goes through the normal pull-request review
like any other commit. Agent-assisted development is expected; the human author owns
every commit.

Allow Claude/Codex/other reviewer to inspect code, PRs, checks, and logs while preventing repository/deployment mutation. The AI review job is read-only; optional PR comments use a separate trusted relay.

### 22.2 Allowed

- repository contents/history read;
- PR diff/discussion read;
- Actions/checks/status/log read;
- ephemeral test execution with read-only checkout;
- workflow summary or review artifact output;
- textual patch suggestion.

A separate trusted relay MAY post validated non-binding comments. Do not give the AI review job PR write permission.

### 22.3 Forbidden

- contents/workflows/actions/deployments write;
- pushes/tags/branches;
- PR creation/merge/approval/close;
- workflow dispatch/rerun/cancel;
- repository settings/secrets/environments;
- production provider access;
- unsupervised commits by a repository-authenticated integration.

### 22.4 GitHub permission model

Prefer custom GitHub App or dedicated workflow with minimum permissions.

Conceptual GitHub App:

```text
Metadata: read
Contents: read
Pull requests: read
Actions: read
Checks: read
Commit statuses: read
Pull requests or Issues: write only if comments are required
```

Do not grant Contents write, Workflows write, Actions write, Deployments write, Administration write, Secrets access.

Conceptual AI review job:

```yaml
permissions:
  contents: read
  pull-requests: read
  actions: read
  checks: read
  statuses: read
```

Optional comments use a separate relay job/app with only the minimum PR-comment permission. The relay does not check out or execute untrusted PR code, receives a bounded validated review artifact, and has no contents/workflows/actions/deployments write permission.

Pin third-party actions to immutable commit SHA after review. Do not expose secrets to untrusted PR code. AI is not CODEOWNER/required approval.

### 22.5 Review quality

Reviewer must:

- cite file/line;
- distinguish defect/security/risk/suggestion/question;
- explain consequence and smallest fix;
- avoid invented APIs;
- avoid style churn;
- not repeat CI output as insight;
- flag uncertain findings as uncertain.

Human owns merge/release.

---

## 23. Seed data

Deterministic local/QA seeds:

Staff:

- Author;
- Editor;
- Admin.

Participants:

- normal verified participant;
- dotted Gmail canonical duplicate fixture;
- tagged Gmail canonical duplicate fixture;
- `googlemail.com` canonical duplicate fixture;
- private public-profile candidate;
- published profile with safe social links.

Events:

- Romanian-only/bilingual;
- no-registration meetup;
- internal unlimited;
- internal open with places;
- full with waitlist;
- active declaration hold;
- waiting-list offer;
- external;
- cancelled/completed/draft.

Registrations:

- Pending email;
- Pending declaration;
- Waitlisted;
- Waitlist offered;
- Confirmed;
- Cancelled;
- Expired.

Content/outbox:

- CMS Draft/In review/Published;
- approved legal document versions in both locales for all three keys;
- outbox Pending/Sent/Failed/Bounced.

Use reserved example domains/fictional names. Never production.

---

## 24. Operations and ownership

Before launch:

- structured logs/monitoring;
- uptime;
- failed outbox visibility;
- registration transition/promotion failure alerting;
- backup/restore test;
- media cleanup;
- QA reset runbook;
- release/rollback/incident runbooks;
- registration/waitlist/email support runbook;
- public profile takedown process;
- provider ownership/recovery documented.

Health endpoint:

```text
GET /api/health
```

No secrets/schema/PII.

Brașov Runners owns GoDaddy domain/DNS/hosting, GitHub, Neon, Zitadel, Mailgun, Cloudflare R2, password manager, billing/recovery. Freelancer least privilege, not sole recovery owner.

---

## 25. Documentation and decision records

There is one decision record: `DECISIONS.md`. It holds the planning history (§1 to §5), the
baseline decisions (§6 onward), and every lasting implementation decision made after code
exists. Do not create a separate ADR directory; two decision systems drift apart.

Append a numbered section for a lasting "why" decision: adding a dependency, changing a
boundary in §3.4, choosing a provider, or deliberately declining something an implementer
might later "fix". Use the shape Title, Status, Date, Context, Decision, Consequences,
Alternatives. Never rewrite an earlier section; supersede it with a new one that says so.

Operational procedures live in `docs/RUNBOOKS.md`; practice guidance in `docs/PRACTICES.md`.
Keep the README concise and do not duplicate a guide into it.

Meaningful PR description:

- problem/scope/non-scope;
- business/spec IDs;
- implementation/state transitions;
- migration;
- i18n;
- security/privacy/token impact;
- email/capacity/waitlist impact;
- tests/screenshots;
- QA steps/rollback.

---

## 26. Implementation roadmap

Ordered by the owner's priorities (`DECISIONS.md` §12 and §13). `SETUP.md` §29 holds the
pull-request breakdown. Each milestone ends with its own slice of the launch checklist in
`docs/PRACTICES.md` § Launch checklist, and a milestone is not done until it is on production.

### M1 — Launch: event page and registration

- Phase 1.0 Foundation: repository, `qa`/`main` protection, CI, `docs:check`, Next.js, MUI, theme, i18n shell, PostgreSQL, Drizzle, migrations, environment validation, seeds.
- Phase 1.1 Walking skeleton (`DECISIONS.md` §7): one seeded event, registration form, capture-mode email, placeholder declaration, `CONFIRMED` reached, deployed to QA, clicked through by a person.
- Phase 1.2 Staff auth and minimal backoffice: Zitadel/Auth.js, roles, create/edit/publish an event, list registrations, one registration's timeline.
- Phase 1.3 Event pages: localized public list and detail, exact free-place count, structured data, sitemap, robots, canonical/hreflang. Race grouping in the schema and a grouped page when `race_id` is present; no multi-distance registration UI yet.
- Phase 1.4 Registration lifecycle: identity and tokens, privacy acknowledgment, results consent capture, legal documents via runbook, confirmation, holds, declaration acceptance, confirmed, unregistration, concurrency tests.
- Phase 1.5 Waiting list: FIFO, offers, expiry, restart, queue closure at event start, maintenance job, `job_runs`, scheduler.
- Phase 1.6 Live email: Mailgun, templates in both locales, modes, webhooks, delivery history. Requires the domain (`DECISIONS.md` §6.10).
- Phase 1.7 Launch gate: domain binding, approved legal documents loaded, backups, monitoring, `docs/PRACTICES.md` § Launch checklist for these surfaces, one real registration on production.

### M2 — Race features

- Multi-distance race page and registration UI on the M1 schema; one-distance-per-race rule surfaced to the participant.
- Bib batch assignment with per-distance ranges, uniqueness per race, override, audit, CSV/PDF export.
- Results import keyed by bib with per-row status, validation against confirmed registrations, per-distance publication through the editorial workflow, anonymous entries for declined consent, republish for corrections.
- Backoffice completeness: state-aware resend, participant CSV export, staff-created registrations (`DECISIONS.md` §10.1), exceptional promotion with reason.
- Requirements written at milestone start.

### M3 — Announcements

- `event_updates` with localized bodies through Draft/In review/Published.
- `EVENT_UPDATE_NOTICE`, explicit action, Editor/Admin, one outbox row per active registration in its locale, audited.
- The transactional-versus-marketing line written into `BUSINESS.md` BR-BUS-080.

### M4 — Runner profiles

- Opt-in profile, manage link, allowlisted social links, publish/unpublish, moderation extended to Editor, `noindex`, privacy tests.

### M5 — Mini CMS

- Tiptap editor beyond event descriptions, articles, static pages, galleries, media library on R2, preview, concurrency, Author role in full.

## 27. Contributor operating contract

### Before work

1. Read relevant root docs.
2. Inspect repository/package scripts/nearby patterns/migrations/tests.
3. Identify business/spec IDs.
4. Confirm the task is inside the current milestone and names its BR-REQ IDs.
5. Identify affected locales, environments, roles, data/privacy, email, capacity/waitlist, migrations.
6. State short plan and observable acceptance.

### During work

- smallest coherent change;
- preserve modular monolith;
- keep rules out of presentation/routes;
- validate untrusted input;
- server-authorize;
- transactions/constraints for related writes;
- update both locales;
- add behavior tests;
- use synthetic data;
- no unrelated refactor/speculative V2.

### Forbidden shortcuts

- participant password/account because email flow seems harder;
- use email string directly without canonicalizer;
- rely only on UI duplicate check;
- count capacity outside transaction;
- mutate on GET token link;
- store raw token;
- sign declaration for participant;
- call Mailgun inside DB transaction;
- enable live email outside production;
- use production data/credentials for test;
- authorize only by hidden UI;
- manually edit production schema;
- invent provider/package API;
- claim unrun checks passed.

### Before completion

1. run applicable format/lint/typecheck/docs/tests/build;
2. inspect diff/unrelated change;
3. verify no secret/token/PII/debug/temp file;
4. verify locales;
5. verify state transition/capacity/token behavior;
6. summarize behavior, migrations, tests, QA, limitations;
7. append to `DECISIONS.md` when a lasting decision changed.

Do not let multiple agents edit same branch/worktree simultaneously.

---

## 28. Freelancer handover

A new maintainer receives:

- organization-owned access, least privilege;
- local setup/run commands;
- branch/release flow;
- QA credentials through password manager;
- architecture/data model/decision records;
- migration/backup/restore runbooks;
- GoDaddy/Mailgun/R2/Zitadel/Neon ownership map;
- registration/waitlist/declaration/email support runbook;
- known limitations/deferred scope;
- current incident contacts.

Offboarding removes GitHub/GoDaddy/provider/password-manager access and rotates any shared secret.

---

## 29. Explicit owner approval required

Do not silently decide/implement:

- final branding/copy;
- legal/privacy/terms/declaration substance;
- claim of qualified electronic signature;
- retention/deletion/historical declaration policy;
- participant medical/minor/ID data;
- payments;
- different hold/offer durations;
- public searchable runner directory/indexing;
- profile photos;
- Strava/Garmin API/OAuth;
- results/leaderboards/gamification points;
- newsletter/marketing;
- new locale;
- external CMS/separate backend/provider replacement;
- reduced QA/production isolation;
- write-capable AI reviewer.

Record an approved lasting change in `DECISIONS.md` with the implementation.

---

## 30. Definition of done

A task is complete only when applicable conditions hold:

- requested behavior works end to end;
- business/spec IDs satisfied;
- invariants enforced server-side and database where appropriate;
- input/locale/config/token validated;
- staff authorization or participant action scope enforced;
- no email-link GET mutation;
- errors safe/localized/observable;
- migrations reviewed;
- important behavior/concurrency tested;
- Romanian/English handled;
- capacity/waitlist/public count consistent;
- declaration version/evidence preserved;
- resend does not duplicate/bypass state;
- public profile exposes only allowed fields;
- QA cannot access production/send live email;
- private data/tokens absent from UI/log/cache/analytics/export;
- `DECISIONS.md` or `docs/RUNBOOKS.md` updated;
- no deferred feature accidentally added;
- format/lint/typecheck/docs/tests/build pass or skipped/failure reported honestly.

Final repository rule:

> Build the smallest production-worthy version of the requested behavior inside one bilingual modular monolith, with staff-only authentication, verified-email participant actions, explicit registration state transitions, transaction-safe capacity and waiting lists, versioned declarations, private data by default, and enough tests that the next freelancer can change it confidently.
