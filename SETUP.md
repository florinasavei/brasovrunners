<!-- PROJECT_BASELINE: BR-V1.68-2026-09-23 -->

# Brașov Runners — Repository and Platform Setup

**Baseline `BR-V1.68-2026-09-23`** · versioned with the whole set · [changelog](./CHANGELOG.md)


> Step-by-step setup for the repository, QA/production flow, staff authentication, CMS, participant email actions, registration, waiting list, and providers.

Read [`README.md`](./README.md), [`BUSINESS.md`](./BUSINESS.md), [`SPECS.md`](./SPECS.md), and [`AGENTS.md`](./AGENTS.md) before implementation. [`DECISIONS.md`](./DECISIONS.md) contains planning rationale and history only.

## 1. Locked topology

```text
short-lived branch
        |
        v
pull request to qa
        |
        v
qa -> QA host
        |
        v
reviewed qa -> main release PR
        |
        v
main -> production host
```

Environments:

```text
local
 test
 qa
 production
```

Authentication:

```text
staff CMS/backoffice -> Auth.js, allowlisted by the staff_users table; no external provider
participants          -> verified email action links, no account/password
```

Application:

```text
one Next.js App Router modular monolith
Material UI
next-intl
Drizzle + PostgreSQL
Tiptap OSS mini CMS
Mailgun
Cloudflare R2
```

Do not create a separate CMS, participant identity provider, backend API, Redis queue, or microservice.

## 2. Ownership and prerequisite accounts

Create resources under Brașov Runners-controlled ownership, not a freelancer's personal account. The domain and DNS live with the club's registrar; hosting is a Brașov Runners-owned Vercel account; R2 remains in Cloudflare.

Required:

- GitHub organization or organization-controlled repository;
- Vercel account (Hobby) with two projects, QA and production;
- a registrar account for the club's domain and its DNS — **ROMARG** holds the `.com`
  (registered 2026-09-16) and edits its DNS; a `.ro` at a ROTLD-accredited registrar a year
  later, both kept (`DECISIONS.md` §55);
- Cloudflare account for R2 object storage;
- Neon account, on the Launch usage-based plan since 2026-09-22;
- Mailgun account/domain;
- Cloudflare R2;
- organization password manager;
- at least two recovery-capable trusted owners where providers support it.

Checklist:

- [ ] Organization-controlled email is primary owner/billing contact.
- [ ] MFA enabled for human owners.
- [ ] Recovery codes stored in password manager.
- [ ] Freelancer has named individual access, not shared owner credentials.
- [ ] Production recovery does not depend on one freelancer.
- [ ] Billing and domain renewal ownership documented.

The domain itself is **not** a prerequisite for development. Both applications run on
their provider-assigned hostnames until the binding step in §26. The domain must exist
before Mailgun sending-domain verification, which is section 23, because Mailgun cannot
send from an unverified domain and verification needs SPF and DKIM records plus
propagation. Register and park it before then.

## 3. Secret storage

Create password-manager records grouped by environment/provider:

```text
Brașov Runners / GitHub
Brașov Runners / Registrar Domain & DNS
Brașov Runners / Vercel QA
Brașov Runners / Vercel Production
Brașov Runners / Cloudflare R2
Brașov Runners / Neon QA
Brașov Runners / Neon Production
Brașov Runners / Mailgun
Brașov Runners / R2 QA
Brașov Runners / R2 Production
Brașov Runners / Scheduler QA
Brașov Runners / Scheduler Production
Brașov Runners / Zoho Mail            (planned — team mailboxes, DECISIONS.md §56)
```

Never store secrets in email, chat, spreadsheets, issues, PR descriptions, repository files, screenshots, or documentation.

Repository commits only `.env.example`; ignore `.env`, `.env.local`, captured email, local uploads, test artifacts, and generated secret files.

Avoid personal access tokens by default. Prefer GitHub CLI user authentication, `GITHUB_TOKEN` in workflows, or a minimally permissioned GitHub App. If a PAT is unavoidable, use a fine-grained repository-scoped token with expiry and document/rotate it.

## 4. Create the GitHub repository

Repository:

```text
https://github.com/florinasavei/brasovrunners
```

It starts under the maintainer's personal account. Transfer it to a club-owned organization
before handover (`DECISIONS.md` §15); GitHub redirects the old URL after a transfer.
The exact first-push sequence is `docs/RUNBOOKS.md` § Repository bootstrap.

Settings:

- [ ] Private initially.
- [ ] Issues enabled if used for project management.
- [ ] Wiki disabled unless deliberately used.
- [ ] Delete head branches after merge.
- [ ] Allow squash merge.
- [ ] Allow merge commits.
- [ ] Disable rebase merge unless team deliberately needs it.
- [ ] Default branch becomes `qa` after initialization.
- [ ] Secret scanning/dependency alerts enabled when available.

Initialize locally:

```bash
git init
git add .
git commit -m "chore: initialize repository"
git branch -M main
git remote add origin <repository-url>
git push -u origin main
git switch -c qa
git push -u origin qa
```

Set `qa` as default branch.

### 4.1 Ruleset for `qa`

- [ ] Pull request required.
- [ ] Required `ci` check.
- [ ] Conversations resolved.
- [ ] Direct/force pushes blocked.
- [ ] Branch deletion blocked.
- [ ] Squash merge for normal work.
- [ ] Human approval required when team size supports it.

During a genuine one-person maintenance period, reduce mandatory approvals rather than routinely bypassing rules. CI remains mandatory. Do not enable "require review from code owners" while there is a single maintainer; a sole `CODEOWNER` cannot approve their own pull request.

### 4.2 Ruleset for `main`

- [ ] Pull request required.
- [ ] Required `ci`/production checks.
- [ ] Direct/force pushes blocked.
- [ ] Branch deletion blocked.
- [ ] Normal source branch restricted to `qa` by process/rules where available.
- [ ] Production environment approval enabled where available.
- [ ] Release PR uses merge commit.

## 5. Configure read-only Claude/Codex review

The AI reviewer may read code, PRs, checks, and logs, and may optionally comment. It must not push, merge, dispatch workflows, deploy, or read secrets.

Preferred approach: custom GitHub App or dedicated GitHub Action with minimal permissions.

The AI review job itself is read-only.

GitHub App conceptual permissions:

```text
Metadata: read
Contents: read
Pull requests: read
Actions: read
Checks: read
Commit statuses: read
```

Do not grant the AI review job:

```text
Contents: write
Pull requests: write
Workflows: write
Actions: write
Deployments: write
Administration: write
Secrets or environment write
```

For a review workflow, begin from:

```yaml
permissions:
  contents: read
  pull-requests: read
  actions: read
  checks: read
  statuses: read
```

Write the review to `GITHUB_STEP_SUMMARY` or a review artifact. If inline or summary PR comments are required, add a separate trusted relay job/app with the minimum PR-comment permission. The relay must not check out or execute untrusted PR code and must accept only bounded, validated review output.

Checklist:

- [ ] Reviewer token cannot push in a permission test.
- [ ] Reviewer cannot dispatch/rerun/cancel Actions.
- [ ] Reviewer cannot read environment secrets.
- [ ] AI review job has no PR write permission.
- [ ] Optional comment relay is separately permissioned and cannot push, merge, dispatch, or deploy.
- [ ] Reviewer is not CODEOWNER or required approval.
- [ ] Untrusted PR code never receives review-provider/API secrets.
- [ ] Third-party actions are reviewed and pinned to immutable commit SHA.
- [ ] Human still approves merge/release.

Do not install a broad third-party GitHub App when strict review-only permissions cannot be configured.

## 6–8. The build plan, retired (scaffold, root documents, package scripts)

Sections 6–8 and 11–24 were the M1 build plan: what to scaffold, what to implement, in what
order. It is built (`CLAUDE.md` § What exists right now), so the plan is history and lives in
`DECISIONS.md` §118 as a table — each retired section, what it asked for, and where that
thing is now. The numbers are kept here so a reference to `SETUP.md` §19 still lands
somewhere that says where to look. The full text is in the repository's history
(`git show 7ecd060:SETUP.md`).

| § | Was | Where it lives now |
| --- | --- | --- |
| 6 | Scaffold the application | `package.json`, `.nvmrc`, `src/`; `CLAUDE.md` § Stack |
| 7 | Root documents and the documentation check | `scripts/docs-check.mjs`, `yarn docs:check`; `README.md` § Where a rule lives |
| 8 | Stable package scripts | `package.json`, `docs/DEVELOPMENT.md` |

## 9. Local PostgreSQL

Create `docker-compose.yml` with one supported PostgreSQL image, named volume, health check, and local-only credentials.

Example local concepts:

```text
host: localhost
port: 5432
database: brasov_runners
user: brasov_runners
```

Do not reuse QA/production credentials.

Local workflow:

```bash
docker compose up -d db
yarn db:migrate
yarn db:seed
yarn dev
```

Integration tests use a disposable database/schema and committed migrations.

## 10. Environment configuration

Create one server-only typed config module.

Environment type:

```ts
type AppEnvironment = "local" | "test" | "qa" | "production";
type StaffAuthMode = "dev-switcher" | "provider" | "disabled";
type EmailDeliveryMode = "capture" | "allowlist" | "live";
type StorageMode = "local" | "fake" | "r2";
```

Required combinations:

```text
local:      dev-switcher / capture / local
 test:      dev-switcher / capture / fake
 qa:        provider-once-tenant-exists-else-disabled / capture-or-allowlist / r2
 production: provider-once-tenant-exists-else-disabled / live / r2
```

`.env.example` should document concepts:

```text
APP_ENV
APP_BASE_URL
DATABASE_URL
STAFF_AUTH_MODE          dev-switcher | provider | disabled; unset derives per environment
AUTH_SECRET              required when STAFF_AUTH_MODE=provider
AUTH_ZITADEL_ID          required when STAFF_AUTH_MODE=provider
AUTH_ZITADEL_SECRET      required when STAFF_AUTH_MODE=provider
AUTH_ZITADEL_ISSUER      required when STAFF_AUTH_MODE=provider
JOB_SECRET               verifies the two job endpoints (§16.2); a scheduler's secret, not a staff session
PINGER_CADENCE_MINUTES   the day-time monitor's cadence in minutes; 15 on production, 60 on QA (§148)
CONTACT_SMTP_USER        the club's Gmail address, the contact form's sender (§149, §38 below)
CONTACT_SMTP_PASSWORD    its 16-character Google app password
CONTACT_FORM_TO          who receives the form's messages, comma-separated (the Gmail, a Yahoo)
CONTACT_SMTP_HOST        smtp.gmail.com unless the club leaves Google
CONTACT_SMTP_PORT        465 unless the club leaves Google
EMAIL_DELIVERY_MODE
EMAIL_ALLOWLIST
MAILGUN_API_KEY
MAILGUN_DOMAIN
MAILGUN_WEBHOOK_SIGNING_KEY
STORAGE_MODE
JOB_SCHEDULER_ALLOWED
R2_ENDPOINT
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_BASE_URL
JOB_SECRET
```

Business timing defaults:

```text
EMAIL_CONFIRMATION_TTL_HOURS=48
DIRECT_DECLARATION_HOLD_MINUTES=30
WAITLIST_OFFER_TTL_HOURS=24
PARTICIPANT_ACTION_SESSION_MINUTES=30
```

They may be code constants or validated config, but must not vary accidentally by environment.

`APP_BASE_URL` carries the current hostname and is the only place a hostname appears at
runtime. It changes once, at domain binding. No hostname literal belongs in `src/`.

Create environment marker table and verify it from startup/migration/seed/reset tooling.

## 11–24. The build plan, retired (the application, slice by slice)

See §6–8 above for why. What each section asked for, and where it is:

| § | Was | Where it lives now |
| --- | --- | --- |
| 11 | Material UI | `src/theme/`, `src/app/[locale]/layout.tsx` (`DECISIONS.md` §58, §93) |
| 12 | Internationalization | `src/i18n/`, `messages/ro.json`, `messages/en.json` (§28, §96) |
| 13 | Database foundation | `src/db/schema/`, `src/db/migrations/0000`–`0043`, `yarn db:*` (`AGENTS.md` §7.6) |
| 14 | Canonical email identity | `src/modules/participants/domain/canonical-email.ts` (§74) |
| 15 | Staff authentication | `src/auth.ts`, `src/modules/staff-identity/` (§26, §103); `docs/RUNBOOKS.md` § Staff sign-in |
| 16 | The mini CMS | `src/modules/content/` (§28, §36, §70–§73, §110) |
| 17 | Participant email action tokens | `src/modules/action-tokens/` (`AGENTS.md` §12.8, §14.5) |
| 18 | Declarations | `src/modules/legal-documents/`, `registrations/signed-declaration.ts` (§46, §53, §85–§87, §95) |
| 19 | Registration and capacity | `src/modules/registrations/service.ts`, `tests/concurrency/capacity.test.ts` (§26, §104) |
| 20 | Waiting list and promotion | `registrations/service.ts`, `registrations/maintenance.ts` (§40, §68) |
| 21 | Backoffice registration management | `registrations/admin-service.ts`, `/admin/registrations` (§33, §44, §67, §88) |
| 22 | Public runner profiles | M4, not built; "Înscrierile mele" on one link is what exists (§77) |
| 23 | Email and the outbox | `src/modules/notifications/`, `src/infrastructure/email/` (§37, §40, §81, §96, §100) |
| 24 | R2 and media | `src/modules/media/` (`AGENTS.md` §17; §32 below for the bucket) |

## 25. Create Neon QA and production

Use separate production boundary, not only schemas in one shared project.

```text
Neon QA project          exists — AWS Frankfurt (aws-eu-central-1), migrated, seeded (2026-09-04)
Neon production project  exists — brasov-runners-production (lively-haze-50960748), aws-eu-central-1,
                         PostgreSQL 18, created 2026-09-16, never migrated: its first migration is
                         the gated workflow run after the first release PR
```

The account moved from Free to **Launch** on 2026-09-22. The provider console shows no monthly
minimum, up to 100 projects, 10 included branches per project, 500 GB public transfer,
autoscaling to 16 CU and scale-to-zero after five idle minutes. Usage is $0.106 per CU-hour,
$0.35 per GB-month of storage and $0.20 per GB-month of changes retained for Instant Restore.
The first 1.8 CU-hours in the Sep 22–Oct 1 partial billing period cost $0.19. If 1.8 CU-hours is
a representative day, compute is about $5.72 for 30 days; a 0.25 CU compute kept warm all month
is about $19.08 per project. Storage and restore history are additional. Re-check the
[official pricing](https://neon.com/pricing) before budgeting; these figures are observations,
not a promised vendor contract.

**December 2026 checkpoint, not an automatic change.** The owner may return the account to Free
after reviewing the Launch invoices and real QA/production usage. Before changing the plan,
re-check Neon's then-current Free limits and confirm both projects' compute, storage, branches,
restore needs and production expectations fit them. If the owner chooses Free, update
BR-REQ-090-07, the diagnostics constants and labels, this section and `docs/PLATFORM.md` in the
same change; until then Launch remains the active plan.

**How it was created, for the next environment.** The Neon CLI authenticates through the browser,
and a login started from an agent's shell prints a link whose callback port is closed by the time
anybody clicks it — run the first command in your own terminal, the rest from anywhere:

```bash
npx neonctl auth                                  # once; saves credentials under your profile
npx neonctl projects create --name brasov-runners-production --region-id aws-eu-central-1 \
  --org-id <the organisation neonctl lists when asked> --output json
npx neonctl connection-string --project-id <id> --pooled    # DATABASE_URL for the Vercel project
npx neonctl connection-string --project-id <id>             # the direct URL, for the GitHub environment
```

Where the two URLs went (`AGENTS.md` §7.6): the pooled one is the production Vercel project's
`DATABASE_URL`, set through the scratch link of §26; the direct one is the GitHub `production`
environment's `DATABASE_URL`. Neither is in this repository, in `.env.local` as
`DATABASE_URL_PRODUCTION`, or anywhere a `yarn db:migrate:env production` could pick it up by
accident — production is migrated by the workflow, from `main`, behind the reviewer.

Checklist, walked 2026-09-16:

- [x] Dedicated connection strings — one project each, nothing shared.
- [x] Pooled connection appropriate for runtime — the `-pooler` host in both Vercel projects.
- [x] Direct/admin connection only where migration tooling requires — the GitHub environments
      hold the direct URL, nothing else does.
- [ ] Environment marker initialized — **not implemented**: nothing under `src/db` creates or
      checks `app_environment_metadata` (`AGENTS.md` §7.4). Named here rather than ticked.
- [x] QA synthetic seed, including the sample legal documents (`DECISIONS.md` §29).
- [x] Production never auto-seeded, and the sample legal documents refuse it outright —
      `tests/integration/legal/versions.test.ts`.
- [x] Migrations are applied by `.github/workflows/migrate.yml`, never by hand and never by a
      build. Each GitHub **Environment** (`qa`, `production`) holds two secrets: `DATABASE_URL` —
      that environment's own database, the direct (non-pooled) URL migration tooling wants — and
      `APP_BASE_URL`, which the post-migration smoke check reads. `production` has a required
      reviewer and a `main`-only deployment branch policy since 2026-09-16; `qa` has neither, by
      design.
- [ ] Backup/restore capability documented and tested before launch — Neon's own restore exists;
      nothing has been rehearsed, and the configured Launch retention window is not recorded here.
- [x] No production clone into QA — nothing to clone yet, and no procedure does it.
- [ ] PostgreSQL majors match — QA and production are both PostgreSQL 18 on Neon; the local
      `docker-compose.yml` image is `postgres:17.6-alpine` and PGlite runs its own. Nothing has
      broken on the gap, and it is named so a migration proven only on 17 is not a surprise on 18.

## 26. Create the Vercel QA and production projects

This section is the **only** place in the repository where the club's own hostname appears.
Everything else says "QA host" or "production host", or writes `<domain>`. `docs:check`
fails when a club hostname appears in any other file, so the name cannot leak into a
document before the domain is registered. Both applications start on their
provider-assigned default hostnames; the custom domain is bound at the end of M1 using
`docs/RUNBOOKS.md` § Domain binding.

| Project | Production branch | APP_ENV | Current hostname | Final hostname |
| --- | --- | --- | --- | --- |
| `brasov-runners-qa` | `qa` | `qa` | `qa.brasovrunners.com` — `APP_BASE_URL` moved to it on 2026-09-17 by `yarn domain:bind qa`, effective on the next QA deployment; `brasov-runners-qa-nu.vercel.app` still serves and is what the QA pinger and the migrate smoke call, on purpose | `qa.brasovrunners.com` |
| `brasov-runners-production` | `main` | `production` | `brasov-runners-production.vercel.app` (created 2026-09-16, never deployed; stays reachable as the smoke and scheduler target) | `brasovrunners.com`, with `www.brasovrunners.com` redirecting to it — bought and bound 2026-09-16, DNS at the registrar pending; a year later `brasovrunners.ro` and its `www`, redirecting too, until the club decides otherwise (`DECISIONS.md` §55) |

The QA project's hostname carries a `-nu` suffix Vercel appended because the plain name was
taken. It is not cosmetic: `APP_BASE_URL` must match it character for character, or the
sitemap, the canonical tags and every email action link name a host that is not this one. The
first deployment got this wrong and the sitemap proved it within a minute.

**Registrar and DNS, as they are (2026-09-16) — CURRENT.** Registrar **ROMARG** (registry
authority OpenSRS), registered 2026-09-16 for one year, renews 2027-09-16. Nameservers
`ns1`–`ns4.romarg.com`; records are edited in ROMARG's cPanel Zone Editor. Every record the zone
holds:

| Name | TTL | Type | Value |
| --- | ---: | --- | --- |
| `brasovrunners.com.` | 30 | A | `216.198.79.1` |
| `www.brasovrunners.com.` | 30 | CNAME | `0b1d9745f650b685.vercel-dns-017.com` |
| `qa.brasovrunners.com.` | 30 | CNAME | `c3b032cf9c2dea0e.vercel-dns-017.com` |

ROMARG's default records — an FTP host, a `mail` CNAME and an MX — were removed on purpose:
there is **no MX and no `mail.` record today**, so nothing on the domain receives mail yet. HTTPS
is issued and renewed by Vercel; nothing is bought or installed at the registrar. FTP is not used.
Vercel reports both production hostnames configured (`A` and `CNAME`), and `www` answers 308 to
the apex.

**QA moved to `qa.brasovrunners.com` on 2026-09-17.** The order that made it safe: the QA Zitadel
application first gained `https://qa.brasovrunners.com/api/auth/callback/zitadel` and the
post-logout URI `https://qa.brasovrunners.com` (verified by starting a sign-in from that host and
seeing Zitadel answer with its login page rather than a redirect-URI error), then
`yarn domain:bind qa qa.brasovrunners.com --apply` moved `APP_BASE_URL`. The reverse order
refuses every staff sign-in until the URI is added — which is exactly what "QA sign-in stopped
working" turned out to be the day the hostname was attached without it.

**Email on the domain — PLANNED, nothing configured.** The provider for team mail is **not chosen** (2026-09-17). The club has applied for a nonprofit
grant — **Google Workspace for Nonprofits**, and **Microsoft 365 for Nonprofits** is the other
candidate — and whichever is granted first takes the apex. **Zoho Mail** is the fallback if
neither is, since its usable tier is paid. What each grant actually includes is recorded here when
one is granted and not before (`AGENTS.md` §1.2). The split with application mail is identical
whichever wins: the mailbox provider owns the apex MX, SPF and DKIM, and Mailgun sends from the
subdomain. Planned mailboxes `admin@brasovrunners.com`, `amalia@brasovrunners.com`, `dani@brasovrunners.com`, and a
public `contact@brasovrunners.com` that all three read — a shared mailbox or, failing that on the
plan chosen, a group. Application mail stays separate, on a subdomain: the planned name is
`mail.brasovrunners.com`, **not configured yet — §35 is the procedure, with every value that
can be known before Mailgun generates the DKIM key**. The provider is Mailgun, whose adapter is built and whose account exists; the
owner also named Brevo as a candidate, which would be a new adapter and webhook rather than
configuration (`DECISIONS.md` §56). Until a sending domain is verified, production email stays
`capture`.

Two projects rather than one project with preview deployments, so each environment has its
own environment variables and its own stable hostname. Set the function region to `fra1` on
both. Verify the exact setting names in the Vercel dashboard when creating them.

Fill the current hostname column when each application is created, and replace this table
with the final values once binding is complete.

**The function region is a project setting, and it drifted.** On 2026-09-16 the QA project
reported `serverlessFunctionRegion: iad1` — Virginia — while every document here said `fra1` and
the database sits in Frankfurt, so each query crossed the Atlantic twice. Read the setting back
rather than trusting the documents, and set it with the CLI's API passthrough. `vercel api` is
what a script must use: the token in the CLI's own credentials file expires, the CLI refreshes its
copy in memory and never rewrites the file, and the REST API answers 403 to the stale one.

```bash
TEAM=$(node -p "require('./.vercel/project.json').orgId")
npx vercel api "/v9/projects/brasov-runners-qa?teamId=$TEAM" --raw      # read serverlessFunctionRegion, nodeVersion
echo '{"serverlessFunctionRegion":"fra1","nodeVersion":"22.x"}' | npx vercel api "/v9/projects/brasov-runners-qa?teamId=$TEAM" -X PATCH --input -
```

It takes effect on the next deployment. The production project was created with `fra1` and Node
`22.x` from the start, and with an *ignored build step* — `if [ "$VERCEL_ENV" = "production" ];
then exit 1; else exit 0; fi` — so it builds `main` and nothing else: a pull-request branch never
produces a preview deployment on the production project, where it would run with no environment
variables and therefore `APP_ENV`'s local defaults. On Git Bash, prefix any `vercel api` call with
`MSYS_NO_PATHCONV=1`, or the shell rewrites the leading `/` of the API path into a Windows path.

**Addressing the production project from this repository.** The checkout is linked to the QA
project (`.vercel/project.json`), and `vercel env` acts on the linked project. Do not relink the
repository; link an empty scratch directory to production and pass `--cwd`:

```bash
npx vercel link --project brasov-runners-production --yes --cwd <empty directory>
npx vercel env add DATABASE_URL production --value "<pooled Neon URL>" --yes --cwd <that directory>
npx vercel env ls production --cwd <that directory>
```

**What the production project holds, as of 2026-09-16:** `APP_ENV=production`, `APP_BASE_URL=https://brasovrunners.com` (set by `yarn domain:bind`
on 2026-09-16 — `www.brasovrunners.com` answers 308 to it; the registrar's DNS records are still
to be created), `DATABASE_URL` (the Neon production pooled URL), `ENABLE_EXPERIMENTAL_COREPACK=1`,
a fresh `JOB_SECRET`, a fresh `AUTH_SECRET`, `STAFF_AUTH_MODE=disabled` and
`EMAIL_DELIVERY_MODE=capture`. Nothing was copied from QA. The four Zitadel variables arrive with
the production Zitadel application (`docs/RUNBOOKS.md` § Staff sign-in); the Mailgun variables
with the verified sending domain. The smoke and scheduler targets stay on the provider hostname
on purpose — it resolves whether or not the club's DNS does.

Connect the GitHub repository to each project and set its production branch as stated. Configure provider credentials only in the correct project.

`deploy:build` must verify branch and `APP_ENV`:

- QA build refuses non-`qa` deployment branch when acting as stable QA;
- production build refuses non-`main`;
- config validates database marker/bucket/email mode/base URL.

QA headers/robots enforce noindex.

Runtime checklist:

- [ ] Root `package.json` and `yarn.lock` present.
- [ ] `yarn build` succeeds in clean CI.
- [ ] `yarn start` starts the production server.
- [ ] Application honors `process.env.PORT`.
- [ ] Repository pins a Node.js version the host currently supports, verified on the day.
      `.nvmrc` pins the exact patch for developers and CI; `engines.node` states the major
      only (`22.x`), because a host selects a major and refuses to install when asked for a
      patch it does not ship.
- [ ] `ENABLE_EXPERIMENTAL_COREPACK=1` set in each Vercel project, so `packageManager` is
      honored and the build uses Yarn 4.18.0 rather than the image's bundled Yarn 1, which
      cannot read this repository's lockfile.
- [ ] No production dependency on Docker.
- [ ] No durable uploads written to the app filesystem.
- [ ] QA app has only QA credentials.
- [ ] Production app has only production credentials.
- [ ] `APP_BASE_URL` in each project matches that project's current hostname.
- [ ] CI runs `yarn build && yarn start` and hits the server on `PORT`, because Vercel does not exercise that path.
- [ ] QA is `noindex, nofollow`.

Domain and DNS items are deliberately absent from this checklist. They belong to the
binding runbook and are performed once, at the end of M1.

The main site's DNS stays with the registrar. Keep Cloudflare only for R2 unless a future feature specifically requires Cloudflare-managed DNS.

Background jobs:

- expose protected POST endpoints for email-outbox and registration-maintenance work;
- persist all job state in PostgreSQL;
- make every job idempotent and safe to retry;
- do not rely on an in-memory interval for correctness;
- invoke the endpoints from two layers: an in-process interval inside the persistent
  application as the primary trigger, and an external scheduler as a watchdog;
- run both every fifteen minutes in a deployed environment (five until 2026-09-18 — see the
  Neon arithmetic below); the outbox is also drained by the request that filled it
  (`AGENTS.md` §16.2, `DECISIONS.md` §68), so the cadence sets how late an *expiry* message
  can be, never how late a verification link is;
- scheduler credentials are limited to the job endpoint and are separate per environment;
- record every run in `job_runs` so a stalled scheduler is visible in the health check.

The scheduler itself is `.github/workflows/scheduled-jobs.yml`, every five minutes. Vercel's
Hobby plan fires cron once per day, which cannot serve a 30-minute declaration hold; GitHub
Actions' floor is five minutes. Each environment contributes two repository secrets, named
for it, and a matrix row in that workflow:

```text
QA_APP_BASE_URL          https://<the qa project's current hostname>
QA_JOB_SECRET            the qa project's JOB_SECRET, character for character
PRODUCTION_APP_BASE_URL  https://<the production project's provider hostname> — set on deployment
                         day, not before: the matrix row exists and skips with a notice until
                         then, and setting it earlier turns every five-minute run red against
                         a host that is not serving yet
PRODUCTION_JOB_SECRET    the production project's JOB_SECRET, character for character — generated
                         2026-09-16, held in that Vercel project and in the owner's .env.local copy
```

A missing pair is skipped with a notice rather than failing the run, so the workflow can be
merged before an environment exists. Both values must match that Vercel project's own
variables exactly — a mismatched secret shows up as a 401 in the workflow log and as a
`stale` job in `/api/health`, never as silent inaction.

**GitHub Actions is the backstop, not the clock.** Measured on this repository, its `schedule`
trigger fired roughly every **two hours** rather than every five minutes: every run succeeded,
and the gaps between them were 01:13Z, 23:22Z, 21:41Z, 19:33Z, 17:40Z. GitHub documents
`schedule` as best-effort and delays it under load, which a low-activity private repository
sees constantly. Nothing is broken and nothing is incorrect — expiry is evaluated against `now`
on every read (`AGENTS.md` §16.2, §10.6) — but a 30-minute declaration hold can then sit expired
for two hours before its place is released, and the waitlisted runner behind it waits that long
for an offer that was already theirs.

So the primary caller is an **external HTTP pinger**, and the workflow stays as the thing that
still runs when the pinger's own account lapses. Any service that can POST on a schedule with a
header will do; the club needs no paid plan for it. Per environment, two monitors:

```text
POST <APP_BASE_URL>/api/internal/jobs/email-outbox               production: every 15 min, 07:00–22:59 Europe/Bucharest
POST <APP_BASE_URL>/api/internal/jobs/registration-maintenance               hourly (minute 0), 23:00–06:59
                                                                 QA: hourly, day and night
Header: Authorization: Bearer <that environment's JOB_SECRET>
```

On cron-job.org that is Settings → Time zone `Europe/Bucharest`, then per production address
two jobs with a **Custom** schedule: day = every day, hours 7–22, minutes 0/15/30/45; night =
every day, hours 23 and 0–6, minute 0.

**The third monitor — the one that tells the club when email has stopped (`DECISIONS.md`
§98).** `GET <APP_BASE_URL>/api/health`, no header, every 30 minutes (Custom → every day,
every hour, minutes 0 and 30), and under *Notifications* tick **on failure** and *when the job
gets disabled*. `/api/health` answers 503 while any outbox message is deferred by Mailgun's
daily allowance, has failed, or has waited more than ninety minutes for a scheduler that is
not running; cron-job.org then emails the account's address from its own mail servers — the
one path that does not go through the provider that is down. When the condition clears the
page answers 200 again and the "job successful" mail follows. Not on the job endpoints: a
job cron-job.org sees failing for long enough is disabled by it, and the outbox job is the
thing that clears the condition. Every environment; on QA it also catches a monitor pair
somebody paused and forgot. The health check knows the two cadences
(`modules/jobs/quiet-hours.ts`): fifty minutes since the last run is `ok` at 03:00 and `stale`
at noon. The site is allowed to be slower at night — the first request after an idle hour
pays Neon's cold start — because nobody in Brașov is registering at 03:00 and a warm database
then costs the same CU-hours it costs at noon: about 50 a month this way, against 65 at
fifteen minutes around the clock and 180 at five.

**Mailgun, done 2026-09-18.** Sending domain `mail.brasovrunners.com` — a subdomain, so the
apex stays free for mailboxes later (`docs/RUNBOOKS.md` § Step 2 — Email) — EU region, shared
IP, self-managed DKIM 2048. The records at ROMARG (Zone Editor, TTL 30): TXT `mail` =
`v=spf1 include:mailgun.org ~all`; TXT `mta._domainkey.mail` = the DKIM key, **entered as two
TXT strings** because cPanel silently truncates one string at 255 characters and Mailgun then
reads a key that ends early (split at exactly 255, "+ Add TXT string to record"); MX `mail` ×2
= `mxa.eu.mailgun.org`, `mxb.eu.mailgun.org`, priority 10; CNAME `email.mail` =
`eu.mailgun.org`; TXT `_dmarc.mail` = Mailgun's `p=none` record (reporting only). The API
base for an EU domain is `https://api.eu.mailgun.net/v3` — the US one answers 404 for it.
Production variables: `MAILGUN_DOMAIN`, `MAILGUN_API_BASE_URL`, `MAILGUN_API_KEY` (the
domain's sending key "brasovrunners-production"), `MAILGUN_WEBHOOK_SIGNING_KEY`,
`EMAIL_FROM_ADDRESS=noreply@mail.brasovrunners.com`, `EMAIL_REPLY_TO=contact@mail.brasovrunners.com`,
`EMAIL_DELIVERY_MODE=live`. Verified with `yarn email:probe` pointed at the domain.

**The club's mailbox (2026-09-18 evening): `brasovrunners@gmail.com`**, a Gmail of the club's
(password and 2-step backup codes in the club's password store), which reads `contact@` and
replies from it — Gmail "Send mail as" `contact@mail.brasovrunners.com` through
`smtp.eu.mailgun.org:587`, user `postmaster@mail.brasovrunners.com`, the domain's SMTP
credential (the one Zitadel uses; do not reset it). `contact@mail.brasovrunners.com` is a
Mailgun **Route** (Send → Receiving → Routes): match recipient `contact@mail.brasovrunners.com`
→ Forward to `brasovrunners@gmail.com, <the owner's address>`, Stop, priority 0, no "store and notify" (nothing reads incoming
mail, and storing people's messages at a third party for nothing is not a feature). Receiving
works because the `mail.` MX records point at Mailgun. **Several people can read it:** the
Forward destination takes a comma-separated list (`owner@…, amalia@…, dani@…`) and each gets a
copy. Only `contact@` is routed — a reply sent to `noreply@mail.<domain>` is dropped, which
is right, because every email the site sends carries `Reply-To: contact@…`. **The same mailbox is the declarations archive** once `DECLARATIONS_ARCHIVE_TO=brasovrunners@gmail.com`
is set on the production project (`DECISIONS.md` §99): every signed declaration arrives there
as a PDF at signing. One more message per registration on Mailgun's allowance. **Since
`DECISIONS.md` §244 this is a setting instead**: `/admin/emails` → "Copiile clubului", where an
Administrator names the mailbox and any visible (Cc) or hidden (Bcc) copies, with the variable
kept as the fallback for a deployment that names none. The same panel sets who is told when
somebody confirms (§245) — each of those addresses is one more message per registration too. When the club gets Google or Microsoft
mailboxes, those take the **apex** (`@brasovrunners.com`) and this subdomain is untouched; only
the two reply-to values move — `EMAIL_REPLY_TO` here and the Zitadel SMTP provider's.

**Zitadel sends its own mail through the same domain.** Its invitations, password resets and
codes went out from Zitadel's default sender; now from the club's. Zitadel console → Default
Settings → **SMTP Provider** → Mailgun: host `smtp.eu.mailgun.org`, port 587, STARTTLS, user
`postmaster@mail.brasovrunners.com`, password = the domain's SMTP credential (Domain settings →
SMTP Credentials → reset; it is in `.env.local` and the password manager), sender
`noreply@mail.brasovrunners.com` "Brașov Runners", reply-to `contact@mail.brasovrunners.com`.
Test, save, **Activate**; the old sandbox provider is **deactivated**, not deleted (deleting
asks for the sender name typed exactly as it was saved, and the comma-below `ș` is not the
cedilla `ş` — a deactivated provider is harmless either way). The EU host, not
`smtp.mailgun.org`: the domain lives in the EU region.

**Why fifteen and not five (2026-09-18; cost updated 2026-09-22).** A monitor every five minutes
prevents the compute from sleeping: 0.25 CU × 24 h = 6 CU-hours a day, 180 a month. That used to
exhaust Free around the 17th; on Launch it costs about $19.08 per project in a 30-day month at
$0.106/CU-hour. QA measured the underlying problem — 74 CU-hours by 18 September. At fifteen
minutes the compute is awake for about five and a half minutes per ping, some 37% of the time,
~65 CU-hours or $6.89 a month plus real traffic; hourly on QA is ~17 CU-hours or $1.80. The
cadence still saves money and lets idle computes sleep, but crossing 100 CU-hours no longer
suspends the site. `/devs` reads the figure when `NEON_API_KEY` and `NEON_PROJECT_ID` are set
(§33). The health thresholds are thirty-five minutes, so fifteen reads `ok`.

Checklist:

- [ ] The monitor sends **POST**, not GET. A GET reaches the route and is refused; §12.8's rule
      that GET never mutates is what makes that safe, and a monitor left on GET looks green
      while nothing runs.
- [ ] The secret is the same string as that Vercel project's `JOB_SECRET`, and it is stored in
      the password manager under `Brașov Runners / Scheduler QA` or `/ Scheduler Production`
      (§3), never in a monitor's public status page.
- [ ] Production uses its own monitor and its own secret. One monitor pointed at both
      environments is one leaked credential away from being both.
- [ ] Failure alerting goes to a real inbox: a pinger that has quietly stopped is
      indistinguishable, from the outside, from a scheduler that never fired.
- [ ] Verify with `/api/health`: both jobs move from `stale` to `ok` within a few minutes, and
      that is the acceptance test for this step, not a green dashboard on the pinger.

Choose the external scheduler before Phase 5. Vercel Hobby cron runs once per day with
hour-level jitter (Vercel's published limits, checked 2026-09-02), which is too coarse for
maintenance every five minutes, so it is not the trigger. GitHub Actions `schedule`
is free but has a five-minute minimum and its runs are delayed or dropped under load,
which makes it acceptable as a watchdog and poor as a sole trigger. A dedicated HTTP cron
service is the more reliable third option. Record the choice in §2 and §3 and in
`DECISIONS.md`.

Nothing about correctness depends on this choice: hold expiry is evaluated inside every
capacity transaction (`AGENTS.md` §10.6). A stalled scheduler delays emails and idle
promotion; it never overbooks an event.


## 27. GitHub Actions CI

Run on pull requests and pushes to `qa`/`main`:

```text
checkout
setup pinned Node
yarn install --immutable
format:check
lint
typecheck
docs:check
unit tests
start disposable PostgreSQL
migrate
integration tests
build
```

Add Playwright after public/action flows exist.

Workflow permissions start with:

```yaml
permissions:
  contents: read
```

Add only required permissions. Do not expose production secrets to PR workflows. Pin third-party actions.

Required status check name should remain stable, e.g. `ci`.

## Contributing

The shortest complete path from no clone to an open pull request. Sections 1 to 27 are the
one-time provider and application bootstrap; this is what every contributor does afterwards,
every time. It is deliberately unnumbered so the numbered setup sequence keeps its
cross-references.

**Once per clone:**

```bash
git clone https://github.com/florinasavei/brasovrunners.git
cd brasovrunners
yarn install --immutable
yarn setup
```

`yarn setup` points git at the tracked `.githooks` directory. From then on `yarn check`
runs before every commit and a failing commit is blocked. Skipping it is the one way to get a
red pull request from a green working copy, so it is not optional.

**The repository is public.** Anything committed is published, and a credential that was
pushed is a credential to rotate, whatever happens to the commit afterwards. Three guards
(`DECISIONS.md` §98): `yarn secrets:check` runs inside `yarn check` and refuses a commit
carrying a Mailgun, Neon, Turnstile, Vercel or GitHub key, a private key block, a connection
string with a real password, or a `JOB_SECRET`-style variable with a value; GitHub's secret
scanning and push protection are on for the formats it knows; and every real value lives in
`.env.local` (ignored) or in the host's environment variables — `.env.example` names
variables and never fills them. If the check fires on an example, write the example
differently; there is no allowlist to add it to, on purpose.

**Per change:**

```bash
git switch qa
git pull --ff-only origin qa
git switch -c feature/<short-name>
```

Branch from `qa`, never from `main`. Names are lowercase kebab-case with one of four
prefixes, and the branch is deleted after merge:

| Prefix | Use |
| --- | --- |
| `feature/` | new behavior |
| `fix/` | a defect in merged behavior |
| `chore/` | tooling, documentation, dependencies, no product behavior |
| `hotfix/` | production emergency only; branches from `main`, not `qa` |

Name a change after what it does, not after the file it touches: `feature/waitlist-offer-expiry`,
not `feature/update-registrations`.

**Before pushing:**

```bash
yarn check
```

This is the same command the pre-commit hook runs and the same command CI runs, so a clean
result locally means a clean result in CI. Once the application exists, also run
`yarn build`.

**Opening the pull request:**

- base `qa`, never `main`; a `qa -> main` pull request is a release and is section 28's job;
- name the `BR-REQ-*` IDs the change implements, or say why none apply;
- fill in the pull-request template, including the `AGENTS.md` §1.4 change-type checkbox;
- a documentation rule change is never one file: edit the whole matrix row, bump the baseline
  marker in all six root documents, add the `CHANGELOG.md` entry, append to `DECISIONS.md`;
- `docs-check` must pass; it is a required check;
- squash merge after review.

If `yarn check` fails for a reason you believe is wrong, fix the check rather than
bypassing it. `git commit --no-verify` exists for emergencies, does not bypass CI, and leaves
the problem for the next person.

## 28. Daily Git flow

Starting work, branch naming, `yarn check`, and opening a pull request into `qa` are in
§ Contributing above; they are not repeated here. This section covers the two flows a
contributor does not run day to day.

Release:

```text
base: main
compare: qa
```

Review migrations, environment changes, declaration changes, email templates/tokens, capacity/waitlist behavior, CMS publication, privacy, and rollback. Merge with merge commit.

Hotfix:

```bash
git switch main
git pull --ff-only origin main
git switch -c hotfix/<name>
```

PR to `main`, deploy, then immediately PR/merge `main` back to `qa`.

## 29. Pull-request sequence

Ordered by the owner's milestones (`DECISIONS.md` §12 and §13, `AGENTS.md` §26). Each pull
request is vertical, reviewable, and names the `BR-REQ-*` IDs it implements. A milestone is
finished when it is on production, not when its last pull request merges.

### M1 — Launch

Shipped: ten pull requests, on production since 2026-09-17 (`BR-V1.34`). The list is the
first entries of `CHANGELOG.md` and the table in `DECISIONS.md` §118; the code is what
`CLAUDE.md` § What exists right now points at.


### M2 — Race features

- **PR 11 — Multi-distance UI.** Race page with distances, registration per distance, the
  one-distance-per-race rule surfaced to the participant.
- **PR 12 — Backoffice completeness.** State-aware resend, participant CSV export,
  staff-created registrations, exceptional promotion with reason.
- **PR 13 — Bibs.** Batch assignment with ranges per distance, uniqueness per race, override,
  audit, export for printing.
- **PR 14 — Results.** CSV import keyed by bib, validation, per-distance publication through
  the editorial workflow, anonymous entries for declined consent, republish.

### M3 — Announcements

- **PR 15 — Event updates.** `event_updates`, localized bodies, editorial workflow, newest-first
  on the event page.
- **PR 16 — Participant notices.** `EVENT_UPDATE_NOTICE`, explicit Editor/Admin action, one
  outbox row per active registration, audit, BR-BUS-080 line added.

### M4 — Runner profiles

- **PR 17 — Profiles.** Manage link and session, allowlisted social links, publish/unpublish,
  moderation for Editor and Admin, `noindex`, privacy tests.

### M5 — Mini CMS

- **PR 18 — Editorial content.** Articles, static pages, Tiptap beyond event descriptions,
  preview, concurrency, Author role in full.
- **PR 19 — Media and galleries.** R2 media library, galleries, alternative-text gate.

## 30. Production readiness checklist

Walked on 2026-09-16 (`DECISIONS.md` §55) and again on 2026-09-18, after the first two
production releases. A ticked row names its evidence; an unticked one names who owes it. Tick
nothing from memory.

Repository/delivery:

- [x] `qa` default and protected — default branch; the `docs-check` status is required and
      strict on both branches.
- [x] `main` protected — same rule, and it accepts releases from `qa` only.
- [x] CI required — `docs-check` (`yarn check`) on both branches.
- [x] Release PR process rehearsed — `qa → main` #45 (2026-09-17, the first production
      deployment) and #47 (2026-09-18): merge, the gated migration run approved, the build
      that waited for it. One lesson from #47: the build times out after twenty minutes if the
      migration is not approved by then, and is redeployed by hand once it is
      (`docs/RUNBOOKS.md` § Deploy a release).
- [ ] AI reviewer read-only permissions verified — not re-verified this walk.

Application (true by test; `yarn check` runs 1004 tests, `yarn test:e2e` 140, `yarn test:concurrency` 5):

- [x] Romanian/English flows — end-to-end, both viewports.
- [x] MUI SSR/hydration/accessibility — end-to-end.
- [x] Staff auth/roles — `tests/unit/config/env.test.ts`, the `/admin` end-to-end runs.
- [x] CMS Draft/Review/Publish — events and standing pages; articles are M5.
- [x] Canonical email tests.
- [x] Email GET no mutation.
- [x] Declaration approved/versioned — with the binding defect of `DECISIONS.md` §53 still open,
      as its own task.
- [x] Capacity concurrency test — `yarn test:concurrency`.
- [x] Waitlist offer/expiry/promotion test.
- [x] Self-unregistration.
- [x] Admin resend/delivery history.
- [ ] Public profile privacy/noindex — M4, not built; nothing to verify yet.

Providers:

- [x] Separate QA/production Vercel projects — both exist, `fra1`, separate variables, separate
      secrets, separate Git production branches (2026-09-16).
- [x] Separate QA/production Neon projects — both exist in `aws-eu-central-1`, both migrated
      by the gated workflow (§25), under Launch since 2026-09-22. The §26 monitor cadences keep
      usage-based compute cost down; there is no longer a 100-CU-hour suspension.
- [x] R2 resources — bucket `brasovrunners-media`, one account token, the five variables on
      both Vercel projects (§32, 2026-09-18).
- [x] Mailgun production domain verified — `mail.brasovrunners.com`, EU region, DKIM 2048,
      all five records valid on 2026-09-18 (§26 has the records and the one trap: cPanel cuts
      a TXT value at 255 characters, so the DKIM key is entered as two strings). Production
      sends live since the same evening; one probe reached the owner's inbox.
- [x] QA email restricted — `allowlist`, and `live` is refused outside production at startup
      (`tests/integration/notifications/modes.test.ts`).
- [x] Webhook/job secrets configured — both environments: `JOB_SECRET`, and the six
      cron-job.org jobs of §26 (four production, day/night; two QA, hourly) created 2026-09-18
      with `/api/health` reading `ok` on both. Production: `MAILGUN_WEBHOOK_SIGNING_KEY` set,
      the domain-level webhook "brasovrunners production" on delivered / permanent failure /
      temporary failure / spam complaints; a second webhook "brasovrunners qa" points at QA.
      QA still sends from the sandbox until its own sending key is made (optional).
- [x] Production config rejects unsafe resources/modes — the development switcher
      (`tests/unit/config/env.test.ts`), live delivery anywhere else
      (`notifications/modes.test.ts`), test registrations, twice
      (`registrations/test-kind.test.ts`), sample legal text (`legal/versions.test.ts`). The
      environment marker of `AGENTS.md` §7.4 is **not implemented** (§25).

Operations/privacy:

- [ ] Legal/privacy/terms/declaration approved — the club; `docs/RUNBOOKS.md` § Legal document
      version. Production refuses every registration until then, correctly.
- [ ] Retention/deletion policy — erasure exists (BR-REQ-037-06); a written retention period is
      the club's decision.
- [ ] Participant/profile/photo support process — the club.
- [ ] Backups and restore test — Neon's own restore, not rehearsed (§25).
- [ ] Monitoring/alerts — `/api/health` and `yarn smoke` exist; `/devs` shows the database's
      CU-hours once `NEON_API_KEY` is set (§33); failure alerting from the pinger to a real
      inbox is not confirmed.
- [x] Production staff sign-in — the "Brasov Runners Production" Zitadel application
      (2026-09-17), `STAFF_AUTH_MODE=provider`, the owner's SUPERADMIN row; verified by the owner
      signing in on 2026-09-18.
- [ ] Volunteer accounts for race day — §34; and a rehearsal on QA with test registrations.
- [ ] Ownership/recovery/handover documented — §2 and §31 exist; the repository, Vercel, Neon,
      Mailgun and Zitadel accounts are the maintainer's personal ones (BR-BUS-101).
- [x] Domain renewal date and owner recorded — the `.com` at ROMARG, registered 2026-09-16 for
      one year, renews 2027-09-16, DNS in ROMARG's Zone Editor (§26). The registrar's invoice
      amount is still to be recorded in `docs/PLATFORM.md` § Cost.

## 31. Freelancer onboarding and offboarding

Onboarding:

- [ ] Named GitHub/Vercel/provider access at minimum useful role.
- [ ] Password-manager shared records only as needed.
- [ ] Read all root docs and run local setup.
- [ ] First change through feature -> QA PR.
- [ ] No production access until necessary.

Offboarding:

- [ ] Remove GitHub/Vercel/provider/password-manager access.
- [ ] Revoke app/session/token access.
- [ ] Rotate shared secrets if any were exposed.
- [ ] Transfer branches/issues/runbooks.
- [ ] Confirm Brașov Runners retains recovery ownership.

## 32. Create the Cloudflare R2 bucket for the photo gallery

Owner's step, about ten minutes, needed before the gallery (`AGENTS.md` §17; its own `DECISIONS.md` section
arrives with it) can be built and tested. Free at the club's size — `docs/PLATFORM.md` has the
allowance and the one catch: **Cloudflare requires a payment method on file to switch R2 on**,
even on the free plan. Nothing is charged inside the allowance.

1. **Account.** `dash.cloudflare.com` → Sign up, with the club's address (the password manager
   record `Brașov Runners / Cloudflare R2`, §3). The free plan; no domain needs to be added —
   the site's DNS stays at ROMARG (`DECISIONS.md` §50 on why Cloudflare is not in front of it).
2. **Enable R2.** Left menu → R2 Object Storage → "Purchase R2" (the free plan; this is where the
   card is asked for).
3. **Bucket.** Create bucket → name `brasovrunners-media`, location hint **European Union** —
   the photos stay in the EU like everything else. Then Settings → **Public access**: enable the
   `r2.dev` subdomain (or connect a custom domain) and copy the public URL — that is
   `R2_PUBLIC_BASE_URL`. Reads are public because the gallery is; writes only ever go through
   the token below, and keys are opaque, so nothing is listable or guessable.
4. **Token.** R2 → "Manage R2 API Tokens" → Create API token → name `brasovrunners-site`,
   permission **Object Read & Write**, scoped to that one bucket, no TTL. Copy the **Access Key
   ID**, the **Secret Access Key** and the **endpoint** (`https://<account id>.r2.cloudflarestorage.com`)
   before closing — the secret is shown once.
5. **Hand over.** Paste into `.env.local` as a commented block, exactly as the other providers'
   values are kept there (§3): the S3 endpoint, the access key id, the secret, the bucket name
   and the public URL — the five `R2_*` variables of `AGENTS.md` §8 — then set the same five on
   both Vercel projects (`vercel env add`) and redeploy. `/admin/tasks` turns its storage row
   green and the album page gets its upload button.

Production and QA share one bucket with a per-environment prefix (`qa/`, `production/`) until
a second bucket is worth a second token; the adapter takes the prefix from configuration.

**Done 2026-09-18.** Account on the owner's Gmail (free plan, card on file), bucket
`brasovrunners-media`, location Eastern Europe (EEUR), Standard class, public development URL
enabled, one *account* API token `brasovrunners-site` (Object Read & Write, that bucket only,
no expiry). The account id, the S3 endpoint, the public URL and the token's two keys are in
`.env.local` as a commented block and in the password manager — the repository is public, so
they appear in no committed file. The five variables are set on both Vercel projects. Not done:
a custom domain for the bucket (`media.brasovrunners.com` would be the name) — optional, and
only worth it once the `r2.dev` address in the gallery's image URLs bothers somebody.

## 33. Let `/devs` read the database's consumption from Neon

Two minutes, optional, read-only (BR-REQ-090-07). Launch bills CU-hours instead of suspending the
project at Free's former 100-hour allowance, and the figure lives in Neon's console, which no
organizer opens. With these two variables `/devs` reads CU-hours, active hours and the billing
period. **Which plan the figures are read against is a setting** (`DECISIONS.md` §306): an
Administrator picks Free or Launch once per environment on `/admin/tasks` → Costuri → „Planul Neon
(baza de date)"; unset reads as Free. Neon's API gives consumption, never the plan or the invoice.

1. Neon console → your avatar → **Account settings** → **API keys** → **Create API key**, name
   `brasovrunners-devs-readonly`. Copy it once. (Neon API keys are account-wide; this one is only
   ever used to read one project's row, and `/devs` shows a number, never the key.)
2. The project id is in the project's URL in the console (`console.neon.tech/app/projects/<id>`),
   or `npx neonctl projects list`.
3. `vercel env add NEON_API_KEY production` and `vercel env add NEON_PROJECT_ID production`
   with the production project's values; the same for QA with QA's project id. Redeploy.
4. `/devs` → "Database (Neon)" shows the figures: on Launch the hours as an estimated charge,
   with no ceiling and nothing red; on Free against the 100 CU-hours, red past 80%. Nothing else
   reads the key.

**The same for Vercel, as far as Vercel allows (`DECISIONS.md` §101).** Vercel's public API
has no usage endpoint — bandwidth and invocations are on the dashboard's Usage page only — but
it lists deployments, and from those `/devs` shows the month's deployments, today's against
Hobby's 100 a day and the build minutes against Hobby's 6,000 a month. Vercel → avatar →
**Account Settings** → **Tokens** → Create (`brasovrunners-devs`, scope the account, one year);
the project id from the project's **Settings → General → Project ID** (`prj_…`); then
`VERCEL_API_TOKEN` and `VERCEL_PROJECT_ID` on each project (QA with its own id;
`VERCEL_TEAM_ID` only on a team account). Redeploy. `/admin/tasks` carries the same steps.

## 34. Volunteer accounts for race day

Every desk verb (BR-REQ-037-08) is open to the lowest role, so a volunteer is a **Voluntar**
(`CONTRIBUTOR` in the database; since `DECISIONS.md` §103 that role is the desk and nothing
else, and `/admin` takes them straight to it).
Sign-in is Zitadel plus the `staff_users` allowlist (§25), so a volunteer needs both:

1. Zitadel console → **Users** → **New** — email (theirs, or a club address for a shared desk
   account such as `voluntar@<club domain>`), a name, an initial password; untick "email
   verification required" if the address is the club's. Repeat per volunteer.
2. Site → **Echipa** (`/admin/staff`, Superadministrator) → add the same email with the role
   **Colaborator**. The name typed here is what the audit trail shows on every check-in.
3. Hand them the guide: **Ghid** in the backoffice bar, first section — and have them open
   **Ziua cursei** on their phone once, the day before, so sign-in is already done.

One account per volunteer is the honest audit trail; one shared "Voluntar masă" account is
acceptable when there is no time, and the trail then says "Voluntar masă". Remove or downgrade
the accounts after the race from the same screen.

Final operational rule:

> No direct production fixes, no participant password system, no state-changing email GET links, no raw tokens in storage or logs, no live email in QA, no external CMS, no unreviewed declaration wording, and no AI reviewer with repository write access.

## 35. Put the Mailgun sending domain on the club's `.com`

Twenty minutes across three consoles, once (BR-REQ-080-03; `/admin/tasks` → "Email către
participanți reali" shows the same steps with the values filled in). **Where it stands
(2026-09-18, evening):** the domain `mail.<club domain>` exists in Mailgun's **EU region**
(`unverified` until DKIM resolves); at ROMARG the SPF TXT, the tracking CNAME and the two MX
are published and Mailgun reads them as valid; the DKIM TXT was published **truncated to 255
characters** (step 2 says why and how); the production sending key `brasovrunners-production`
(id `44ec4598-451361b4`) exists and is on the production Vercel project as `MAILGUN_API_KEY`,
beside `MAILGUN_DOMAIN`, `MAILGUN_API_BASE_URL` and `EMAIL_FROM_ADDRESS` the owner set. Left:
the DKIM fix, Verify, the webhook, `EMAIL_DELIVERY_MODE=live`.

**Decisions baked in.** The subdomain, so the apex MX stays free for the club's own mailbox
provider (§26). The **EU region** (`https://api.eu.mailgun.net/v3`): the account works in
both regions, a domain lives in one and cannot move, and a Romanian club's participant
addresses belong in Frankfurt like its database does — the privacy notice names the processor
and its region. The sender is `"Brașov Runners" <noreply@mail.<club domain>>` with no variable
set (`env.ts` defaults both); `EMAIL_REPLY_TO` is set only when a club mailbox exists — an
*empty* value is refused at startup.

1. **Mailgun → Sending → Domains → Add new domain.** Name `mail.<club domain>`; region
   **EU**; DKIM key length 2048; leave "Use this domain for inbound" off. Mailgun then shows
   the records below with its own values — the DKIM one is generated here and exists nowhere
   else.
2. **ROMARG → cPanel → Zone Editor**, TTL 300, short names (cPanel appends the domain).
   Mailgun's values for this EU domain, read back through its API on 2026-09-18:

   ```text
   TXT    mail                  v=spf1 include:mailgun.org ~all
   TXT    mta._domainkey.mail   k=rsa; p=<401 characters — see below>
   CNAME  email.mail            eu.mailgun.org
   MX 10  mail                  mxa.eu.mailgun.org      (optional: only receiving)
   MX 10  mail                  mxb.eu.mailgun.org
   TXT    _dmarc.mail           v=DMARC1; p=quarantine; adkim=s; aspf=s   (ours, not Mailgun's)
   ```

   **The DKIM value is longer than one DNS string.** A TXT string holds 255 characters; a
   2048-bit key is 401. cPanel's Zone Editor saved the first 255 and dropped the rest (found
   with `nslookup -type=TXT mta._domainkey.mail.<club domain> ns1.romarg.com`: the published
   value is a prefix of Mailgun's). Enter it as **two quoted strings on one line**, split
   anywhere: `"k=rsa; p=MIIB…first 200…" "…the remaining 201…"` — resolvers concatenate them
   and Mailgun reads the whole key. Nothing on the apex: SPF and DKIM for the apex belong to
   the mailbox provider when one is chosen (§26).
3. **Mailgun → the domain → DNS Records → Verify DNS settings.** Green within minutes at
   TTL 300; up to an hour if ROMARG caches. `curl -u api:<any key of the account>
   https://api.eu.mailgun.net/v4/domains/mail.<club domain>` shows each record's `valid`
   flag without waiting for the console. Until it is green, sending answers 400 and the
   outbox retries — nothing is lost.
4. **Mailgun → Sending → Domain settings → Sending API keys → Create** for this domain →
   `MAILGUN_API_KEY`. A domain-scoped key, not the account's private key.
5. **Mailgun → Sending → Webhooks** (domain `mail.<club domain>`): copy the **HTTP webhook
   signing key** → `MAILGUN_WEBHOOK_SIGNING_KEY`; add `https://<production host>/api/webhooks/mailgun`
   for **Permanent Failure** and **Spam Complaints** — the two events the application acts on
   (`BOUNCED`/`COMPLAINED` on the outbox row, "email respins" at the desk and on the
   registration, `DECISIONS.md` §76). "Delivered" is optional and harmless; "Temporary
   Failure" is ignored by the route.
6. **Rehearse on QA first** — production refuses every registration until the club's legal
   texts are approved (§30), so a registration there cannot be walked yet. On the QA Vercel
   project set `MAILGUN_DOMAIN=mail.<club domain>`, `MAILGUN_API_KEY` (QA's **own** sending key,
   `brasovrunners-qa` — created like step 4's, so revoking one never stops the other; the owner
   keeps it in `.env.local` as `MAILGUN_API_KEY_QA`), `MAILGUN_API_BASE_URL=https://api.eu.mailgun.net/v3`,
   keep `EMAIL_DELIVERY_MODE=allowlist` with `EMAIL_ALLOWLIST=*` (`DECISIONS.md` §163, §307 — every
   subject carries `[QA]`), redeploy, register on QA with a dotted spelling of your
   Gmail (`DECISIONS.md` §74 — each spelling is a new participant, all land in one inbox): the
   verification, the declaration link and the confirmation with its QR arrive from
   `noreply@mail.<club domain>`. `/devs` on QA shows the email check "limited (allowlist)" and
   the webhook "configured".
7. **Production**, from a scratch directory linked to the production project (§33's trick):

   ```text
   npx vercel env add MAILGUN_DOMAIN production               mail.<club domain>
   npx vercel env add MAILGUN_API_KEY production              <step 4>
   npx vercel env add MAILGUN_API_BASE_URL production         https://api.eu.mailgun.net/v3
   npx vercel env add MAILGUN_WEBHOOK_SIGNING_KEY production  <step 5>
   npx vercel env add EMAIL_REPLY_TO production               <a club mailbox, only if it exists>
   npx vercel env rm  EMAIL_DELIVERY_MODE production && npx vercel env add EMAIL_DELIVERY_MODE production   live
   ```

   Redeploy. `/devs` → "E-mail" reads `live`; `/api/health` unchanged (delivery is not a job).
8. **Watch the first day.** `/admin/registrations` shows the outbox counter — sent today
   against the free plan's hundred — and "Trimite acum" (`DECISIONS.md` §80). A spent
   allowance defers the rest to the reset, never drops it (`DECISIONS.md` §40).

Sandbox afterwards: unused since 2026-09-23 — QA sends through the club domain with its own key
(step 6, `DECISIONS.md` §307). Two consequences to remember: QA and production share the domain's
daily allowance (a rehearsal's messages count against the same hundred a day), and the domain's
webhooks point at production, so a QA bounce is recorded on production's outbox, not QA's.

## 36. The anti-bot check and the health monitors — done (2026-09-19)

Both were the club's clicks, done outside the repository on 2026-09-19 and recorded here so
nobody redoes them (`/admin/tasks` reads the same facts from the deployment):

- **Cloudflare Turnstile** (`DECISIONS.md` §97): the widget `brasovrunners-site` exists in
  the club's Cloudflare account (Managed mode, the `.com` and its `qa.` subdomain as
  hostnames); `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set on **both** Vercel
  projects (Production environment) and the "Verify you are human" box shows on the QA form.
  The "Anti-bot check" row on `/admin/tasks` turns green on each project's next deployment.
- **The health monitors** (`DECISIONS.md` §98): cron-job.org has `GET /api/health` every
  30 minutes with "notify on failure" on production and on QA — the club is emailed when
  email stops. Nine monitors in all: the two job pingers per environment (§26) and this one.
  QA's pingers are hourly (§68), so QA carries `PINGER_CADENCE_MINUTES=60` (set 2026-09-19,
  `DECISIONS.md` §148): without it the health check measured QA against production's fifteen
  minutes and cried "degraded" — a cronjob-failed email — for most of every hour.
- **Release #58** (`qa → main`, 2026-09-19) is live; the production schema is `0042`
  (`0043`, the programme rows, arrives with the next release and its gated migration run).

## 37. Let "Add" on Echipa create the sign-in account and send the invitation — done (2026-09-20)

**Done on both Vercel projects.** `ZITADEL_MANAGEMENT_PAT` was written on 2026-09-20 and
predates the builds now serving, so "Add" on Echipa already creates the account and sends the
invitation. The procedure below is kept for the day the token is rotated or revoked — it has no
expiry, so revoking it is a decision somebody has to make rather than something that happens.

Five minutes in the Zitadel console, once (`DECISIONS.md` §123). The platform emails the
invitation itself either way — who added them, as what, the sign-in link (§141); without
this key the colleague creates their own account at the sign-in page with that address, with
it "Add" creates the account too and Zitadel sends the password link.

1. Zitadel console → **Users → Service Accounts → New**: user name `brasovrunners-invites`,
   name "Brașov Runners — invitații", access token type **Bearer**. Create.
2. **Organization → Managers → + New**: the service account, role **Org User Manager** (it may
   create users and send their invitation codes; nothing else). The dialog is called "Add an
   Administrator" and it names the service user at the top; if it asks for a *Loginname*, that
   is `brasovrunners-invites`.

   **This is the step that was missed** on the club's own instance, and it cost an evening
   (`DECISIONS.md` §288). Two traps:

   - **"Role Assignments" is not this.** That page grants a user roles *inside a project* and
     has nothing to do with managing users. A service account can sit there, Active, looking
     perfectly configured, and still be unable to create anybody.
   - **Nothing tells you.** Without the membership every "Add" on Echipa writes the allowlist
     row, is refused by Zitadel, and says so in one banner that is gone at the next click. The
     colleague then meets Zitadel's own **"User not found in the system"** at sign-in, which
     reads like their problem rather than the club's.

   To check it without inviting anybody, ask the token what it can see — 0 human users where
   the console shows some means the membership is missing:

   ```bash
   curl -s -X POST "$AUTH_ZITADEL_ISSUER/v2/users"      -H "Authorization: Bearer $ZITADEL_MANAGEMENT_PAT"      -H "Content-Type: application/json"      -d '{"query":{"limit":50},"queries":[{"typeQuery":{"type":"TYPE_HUMAN"}}]}'
   ```
3. On the service account → **Personal Access Tokens → New**. Zitadel's console offers no
   expiry field here, and the token it makes does not expire — so it is a secret that has to be
   revoked by hand when it is no longer wanted, on the same screen. Copy it — shown once —
   into the password manager, and note there that it has no end date.
4. Vercel → the production project → Settings → Environment Variables:
   `ZITADEL_MANAGEMENT_PAT` = the token (Production). The same on the QA project. Redeploy
   both.
5. Check: Echipa → add yourself with a second address → the alert says the invitation is on
   its way with the password link, and two mails arrive: the club's (through Mailgun) and
   Zitadel's from `noreply@mail.<club domain>` (Zitadel's SMTP, §35). A colleague who never
   signed in has "Resend the invitation" on their row.

Locally the development switcher is the provider, so nothing is sent and the alert says so.

## 38. The contact form — the club's Gmail lends it an app password — done (2026-09-20)

**Done on both Vercel projects**, and visible: `/ro/contact` shows the form on production and on
QA rather than the club's address (checked 2026-09-22). `CONTACT_SMTP_USER`,
`CONTACT_SMTP_PASSWORD` and `CONTACT_FORM_TO` were written on 2026-09-20 and predate the builds
now serving. The procedure below is kept for a new app password — Google shows one once — and for
the part that stays the club's, which is who receives a message (`/admin/emails`).

Five minutes, once, in the club's Google account and on Vercel (`DECISIONS.md` §149). The
"Scrie-ne" page is built and works on every laptop (the message is captured, nothing is
sent); on a deployment it shows the club's address as a link until these are set, and the
form itself once they are. Nothing here touches Mailgun or its 100 messages a day: the form
sends through Google's own mail server, from the club's Gmail, to whichever mailboxes the
club names — which is why a colleague's Yahoo can be on the list.

1. The club's Google account → **Security → 2-Step Verification**: on. Google offers app
   passwords only to accounts with it.
2. Still under Security → **App passwords** → create one named "Brașov Runners site" → copy
   the 16 characters (shown once) into the password manager.
3. Vercel → the production project → Settings → Environment Variables (Production):
   `CONTACT_SMTP_USER` = the club's Gmail address; `CONTACT_SMTP_PASSWORD` = the 16
   characters (spaces or not, both work). The same on the QA project (a QA message is a real
   email to the same mailboxes, its subject starting with `[QA] ` so it is never mistaken
   for a real question; put a test address there if even that is unwelcome).
   `CONTACT_FORM_TO` is **optional since `DECISIONS.md` §164**: it is the fallback list, read
   only while the club has named nobody in the app, and there is no `CONTACT_CC` variable at
   all. Set it if you want the form to work before anybody opens the backoffice.
4. Redeploy both projects.
5. In the app — the part the club owns, and the part that changes without a developer:
   `/admin/emails` → **"Cine primește mesajele de contact"** → **Către** = the mailboxes that
   receive each message, comma-separated; **Copie (Cc)** = anybody who should get a copy and
   be visible to the others (Amalia's Yahoo, say); **Copie ascunsă (Bcc)** = anybody who
   should get a copy without the others seeing it — an archive mailbox, say (§293) → Salvează. The sentence above the boxes
   says which list is in force — the app's or `CONTACT_FORM_TO` — so there is no guessing.
6. Check: open `/ro/contact` on the deployment and send a message. The page says "Mesajul a
   plecat. Îți răspundem pe …", the email arrives in every mailbox from the club's address
   with "Reply" addressed to whoever wrote, and the "Formularul de contact" row on
   `/admin/tasks` is green; `/devs` shows the form as `smtp`. A wrong password shows
   "Nu am putut trimite. Scrie-ne direct la …" on the page and `smtp EAUTH` in the function
   log — never the password. Those failed tries are not counted against the sender: once
   the password is right, the same address sends at once.
7. **Optional, in the club's Gmail: file the messages the site marks as possible spam.** A
   message the form lets through but that looks automated still arrives, so that a real person is
   never lost. That covers a post with no anti-bot token while the check is on, and a sender whose
   domain imitates the club's (`search-<domain>`, `<name>-seo.com`). The subject starts with
   `[posibil spam] ` (`[QA] [posibil spam] …` on QA) and a note under the message says why. To file
   them away: open the club's Gmail → the search box → **Show search options** → in **Has the
   words** type `subject:"[posibil spam]"` (Gmail ignores the brackets and matches the phrase, so
   the QA mark is caught too) → **Create filter** → tick **Skip the Inbox (Archive it)** and
   **Apply the label** → **New label** `Posibil spam` → **Create filter**. Do not tick **Delete
   it**. Look at the label once a week: somebody whose browser never ran the check lands there too,
   and "Reply" still answers them. The mark is fixed text (`SUSPICIOUS_SUBJECT_PREFIX` in
   `src/modules/contact/message.ts`); changing it breaks this filter in every mailbox that has one.
   Do the same in any mailbox that is on "Către" or "Copie (Cc)" and wants it. (`DECISIONS.md`
   §310)

To take the form away, clear the recipients on `/admin/emails` and leave `CONTACT_FORM_TO`
empty — or remove `CONTACT_SMTP_USER` or `CONTACT_SMTP_PASSWORD` and redeploy: the page goes
back to the address either way. Google's own limit on an ordinary account is about 500 messages a day,
which is more than a club receives; the form's own limit is five an hour per sender.

## 39. Put the 21 November race on production — the last thing between the club and its entries

This is item 12 of `CLAUDE.md` § Still owed, and it is the launch. Everything under it is live:
the sign-in, the approved legal texts, Mailgun on the club's own domain, the anti-bot check, the
monitors, the contact form. Production publishes the weekly group run and nothing else, so on
the day this is saved and published, the race takes entries.

**Fifteen minutes in one form.** Sign in at `/admin` on the club's own domain, press **Adaugă
un eveniment**, and fill in what follows. Two of the numbers are the club's decision and nobody
else's: they are marked **YOURS**. Everything else below is a value, not a placeholder.

### The form, field by field

| Panel | Field | What to type |
| --- | --- | --- |
| — | Tip eveniment | **Cursă** |
| Când și unde | Începutul evenimentului | **21.11.2026**, and the hour the first runner is expected at the desk |
| Când și unde | Startul cursei | the hour the gun goes — this is what the countdown and the reminder use |
| Când și unde | Durata (minute) | how long the club will be there, start to prize-giving |
| Când și unde | Fus orar | **Europe/Bucharest** (already filled in) |
| Când și unde | Punct de întâlnire | where people gather, e.g. **Parcul Tractorul** |
| Când și unde | Adresă | the street address, for the map and the calendar entry |
| Când și unde | Link către punctul de întâlnire | a Google Maps link, https |
| Înscrieri | Modul de înscriere | **Înscrieri pe site** |
| Înscrieri | Număr de locuri | **YOURS** — how many runners the club can handle. Leave it empty only if there is genuinely no limit; the page then shows no number and the waiting list never engages |
| Înscrieri | Înscrierile se deschid | leave **empty** — entries open the moment the event is published |
| Înscrieri | Înscrierile se închid | leave **empty** for "until the start", or a date if the club wants the list closed earlier |
| Înscrieri | Confirmarea participării: cu câte zile înainte se cere | **YOURS** — the default **7** asks everyone to confirm a week out |
| Înscrieri | …și cu câte zile înainte expiră | **YOURS** — the default **2**: an unconfirmed place goes to the waiting list two days before |
| Înscrieri | Numerele de concurs (BIB) încep de la | **1**, or **100** if the club wants three-digit numbers |
| Înscrieri | Culoarea numerelor de concurs (BIB) | the band colour on the printed bib; any of the palette's |
| Înscrieri | Declarația pe care o semnează participantul | the approved **EVENT_DECLARATION** — the only entry in the list on production |
| Înscrieri | Publică lista participanților | leave **off**. It goes on only once the privacy notice describes it |
| Traseu și detalii | Distanță, Denivelare, Dificultate, Suprafață, Cost | as the race is |
| Română / English | Titlu, Adresa paginii, Rezumat | both languages — the event cannot be published with either missing |
| Română / English | Regulamentul evenimentului | the race rules. Every entrant ticks "am citit regulamentul", and the emails link here |
| Când și unde | Program | kit pickup, briefing, start, cut-offs — one timed row each; every row becomes a calendar entry and is repeated in the reminder. The rows are the programme (§117). Change the event's date and the rows move with it (§295) |
| Română / English | Note sub program | optional free text that appears beneath the rows on the page — how the kit is collected, the cut-off rules — per language (§294) |

Then **Salvează**, read the page through **Previzualizare**, and press **Publică**. Both
languages go live together; that is the rule, not a setting.

### After it is published, in this order

1. `/ro/evenimente` on the club's domain — the race is there, with its free places on the
   button.
2. Open the registration form and read it as a runner would. Do **not** complete a real entry on
   production unless the club wants that row in its list; the rehearsal belongs on the QA host,
   where the same form sends real email to the addresses in `EMAIL_ALLOWLIST`.
3. `/admin/emails` → the Mailgun plan. Free is **100 messages a day**, and a completed
   registration costs about six, so about **16 entries a day** (`docs/PLATFORM.md`). If the
   race opens to a crowd, one month of **Basic** is $15 and is a setting on that screen — no
   deployment.
4. `/admin/tasks` → the row for this item turns green by itself once the event exists.

### If somebody says the site is blocked at work

Not the site. A corporate network — Siemens' Zscaler, on 2026-09-22 — refuses whole categories,
and one of them is **"Newly Registered and Observed Domains"**: any domain registered in roughly
the last month, whatever is on it. The club's `.com` was registered on 2026-09-16, so it sits in
that category until it ages out, usually thirty days from registration.

Three answers, in the order they are worth giving:

1. **Wait.** The category expires on its own; nothing needs doing and nothing is wrong.
2. **Phone, not office laptop.** Mobile data is not behind the employer's proxy, and that is the
   whole club's usual device anyway.
3. **Ask the employer's IT for an exception**, which the block page links to. Worth it only for
   somebody who has to open the backoffice from a work machine every day.

There is nothing to change on our side: the block is decided before a request reaches the site,
so it is invisible to the monitors and to `/api/health`, and it affects one network rather than
the internet.

### What to have ready before sitting down

The capacity and the two window numbers (the club's own call), the rules text, the programme,
the meeting point and its map link, and the bib band colour. Nothing else is asked for, and
nothing here needs a developer.
