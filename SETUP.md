<!-- PROJECT_BASELINE: BR-V3.63-2026-10-20 -->

# Brașov Runners — Repository and Platform Setup

**Baseline `BR-V3.63-2026-10-20`** · versioned with the whole set · [changelog](./CHANGELOG.md)


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
| `brasov-runners-qa` | `qa` | `qa` | `qa.brasovrunners.com` — `APP_BASE_URL` moved to it on 2026-09-17 by `yarn domain:bind qa`, effective on the next QA deployment; `brasov-runners-qa-nu.vercel.app` still serves and is the address the QA job pings, the backstop and a second health monitor must call (§40, since 2026-10-03; `CLAUDE.md` «Still owed» item 19) — on 2026-10-03 the pings in use called the public name | `qa.brasovrunners.com` |
| `brasov-runners-production` | `main` | `production` | `brasov-runners-production.vercel.app` (created 2026-09-16; stays reachable, and is the address the production job pings, the backstop and a second health monitor must call — §40, since 2026-10-03; `CLAUDE.md` «Still owed» item 19 — on 2026-10-03 the pings in use called the public name) | `brasovrunners.com`, with `www.brasovrunners.com` redirecting to it — bought and bound 2026-09-16, DNS at the registrar since 2026-09-17 (its contact address must stay verified: the 2026-10-03 hold, §40); a year later `brasovrunners.ro` and its `www`, redirecting too, until the club decides otherwise (`DECISIONS.md` §55) |

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

**The registrant contact and the renewal — since 2026-10-03 (`DECISIONS.md` §659).** On
2026-10-03 the registrar held the domain from about 11:04 to 18:24 UTC because the ICANN contact
verification sent at registration had landed in spam on 16 September; the name, the backoffice,
QA and `mail.` went with it (`docs/RUNBOOKS.md` § The domain stops answering). So, at ROMARG's
control panel and in the contact mailbox, once and after every change:

- **The registrant and admin contact is a mailbox outside the domain, read daily** — today the
  owner's Gmail. Never an address `@brasovrunners.com` or `@mail.brasovrunners.com`: a domain on
  hold cannot deliver the email that lifts the hold.
- **The ICANN contact verification arrives at registration and after every change of the
  registrant contact** (name, email, postal address), and must be clicked within **15 days**, or
  the registrar suspends the domain (`clientHold`) with every record unchanged. After any change of
  the contact, look for it the same day. It comes from the registrar's verification service — for
  a registrar on OpenSRS, that service's own sender, not ROMARG's name.
- **Whitelist both senders in that mailbox.** In Gmail: **Settings** → **Filters and Blocked
  Addresses** → **Create a new filter** → *Has the words* `brasovrunners.com` → **Never send it to
  Spam** and **Star it**; and one filter per sender — ROMARG's address and the verification
  service's, as they appear on their first email — with the same two ticks. A message that names
  the domain then never lands in spam, whoever sends it.
- **Auto-renew is on, with a card valid past the renewal date** (2027-09-16). Check the card's
  expiry each summer; a refused card at renewal is an expired domain.
- **The renewal date on both Vercel projects:** `DOMAIN_REGISTERED_ON=2026-09-16` and
  `DOMAIN_RENEWAL_YEARS=1` (the years paid from registration in total; 2 after the first yearly
  renewal), in the Production environment, then a redeploy. What the code does with them
  (`src/modules/diagnostics/domain/domain-renewal.ts`, from configuration and the clock only, never
  a WHOIS query): the expiry is the registration day plus the years paid — 2027-09-16;
  «Sarcini» (`/admin/tasks`) shows the row «Reînnoirea domeniului .com» green until 90 days before,
  amber from 2027-06-18, red from 2027-08-17 (30 days) and past the day; from that same red day
  `/api/health` — shallow and `?deep=1` alike — answers `degraded` with a 503, so the hourly
  health monitor emails a month before the expiry; «Setări» → «Costuri» shows the expiry with the
  month's costs. Unset, the row says the date is not known and nothing else changes, so nothing
  reminds anybody.

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
subdomain. Planned mailboxes `admin@brasovrunners.com`, one per organizer, and a
public `contact@brasovrunners.com` that they all read — a shared mailbox or, failing that on the
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
fifteen minutes around the clock and 180 at five. *(Superseded 2026-09-23/24: the health
monitors are hourly on production and six-hourly on QA — §40 has the eight jobs as set.)*

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
Forward destination takes a comma-separated list (`owner@…, organizer@…`) and each gets a
copy. Only `contact@` is routed — a reply sent to `noreply@mail.<domain>` is dropped, which
is right, because every email the site sent carried `Reply-To: contact@…` until `BR-V2.04`; since then (§462) the Reply-To defaults to the Gmail in `CONTACT_SMTP_USER` unless the club saves «Adresa de contact afișată» on «Pagini» → «Contact» (`/admin/pages/contact#shown-contact-address`; «Setări» → «Contact» from §516 until 2026-09-28), so the Route matters for the older emails and for a club that chooses the mailbox. **The same mailbox is the declarations archive** once `DECLARATIONS_ARCHIVE_TO=brasovrunners@gmail.com`
is set on the production project (`DECISIONS.md` §99): every signed declaration arrives there
as a PDF at signing. One more message per registration on Mailgun's allowance. **Since
`DECISIONS.md` §244 this is a setting instead**: «Setări» → «Emailuri» (`/admin/settings/emails`, §516) → "Copiile clubului", where an
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

This is the same command the pre-commit hook runs and the same command CI runs (there in two
halves, `yarn check:static` and `yarn test` on four shards), so a clean result locally means a
clean result in CI. Once the application exists, also run `yarn build`.

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
the problem for the next person. The one documented exception is a batch's landing commit
(`docs/DISPATCHER.md` § Land a batch), whose branches all passed the hook and whose pull request
CI checks with the full `yarn check` minutes later; every other commit keeps the hook (§504).

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
- [x] CI required — `docs-check` (`yarn check`: the static half in `checks`, the tests in four `unit` shards) on both branches.
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
      QA still sends from the sandbox until its own sending key is made (optional). Since §670
      (2026-10-08) §35 step 5 is the rule: both addresses on Delivered, Permanent Failure and Spam
      Complaints of the club's sending domain — the record above is how it was first set, and which
      of the two addresses each event carries now is to be checked in Mailgun against step 5.
- [x] Production config rejects unsafe resources/modes — the development switcher
      (`tests/unit/config/env.test.ts`), live delivery anywhere else
      (`notifications/modes.test.ts`), test registrations, twice
      (`registrations/test-kind.test.ts`), sample legal text (`legal/versions.test.ts`). The
      environment marker of `AGENTS.md` §7.4 is **not implemented** (§25).

Operations/privacy:

- [ ] Legal/privacy/terms/declaration approved — the club; `docs/RUNBOOKS.md` § Legal document
      version. Production refuses every registration until then, correctly.
- [ ] Retention/deletion policy — erasure exists (BR-REQ-037-06) and the 04:00 sweep deletes on the
      windows the privacy notice states (§322); whether to shorten any of them is the club's decision,
      with the numbers on `/devs` → «Baza de date» (`yarn db:sizes`) and the proposal table in
      `docs/PLATFORM.md` § Keeping Neon and Vercel light, long term.
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
period. **Which plan the figures are read against is Neon's own answer** (`DECISIONS.md` §326,
correcting §306): the project row the page already reads names the owning account's plan
(`owner.subscription_type`, `launch_v3` since 2026-09-22). The Administrator's choice on
«Setări» → «Costuri» (`/admin/settings/costs`, §516) → „Planul Neon (baza de date)" is only the fallback for an environment
without the key, or a Neon that did not answer; unset, it reads as Free. The limits set on each
project are §40.

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
   signing key** → `MAILGUN_WEBHOOK_SIGNING_KEY` (one key per domain: the same value on both Vercel
   projects). Add **both** deployments' addresses — `https://<production host>/api/webhooks/mailgun`
   and `https://<QA host>/api/webhooks/mailgun` — to each of the three events the application acts
   on (`DECISIONS.md` §76, §670):
   - **Delivered** — required since §670: it is what tells a registration that a refused email's
     address works again, or that the same email — or one that carries it, as the confirmation
     «Retrimite QR» sends carries the race number — arrived after all. Without it nothing ever clears
     and every «Email respins» stays as it was. Mailgun does not retry a delivery notification: a
     `delivered` event the webhook missed (a 5xx, a deployment, the domain down) is never replayed, and
     the refusal it would have cleared stays until such an email is delivered again;
   - **Permanent Failure** — `BOUNCED` on the outbox row, with its cause («Email respins»);
   - **Spam Complaints** — `COMPLAINED`.

   "Temporary Failure" is ignored by the route; leave it off. Mailgun takes up to three URLs per
   event. Every message carries a tag naming the deployment it left from (`env:production`,
   `env:qa`), and each deployment's webhook answers the other's events without opening its
   database, so the shared domain wakes neither for the other. Check it worked: Mailgun's «Test
   webhook» on Delivered answers 200 from both addresses (a test event names no message of ours, so it
   changes nothing), and Mailgun → Sending → Logs shows the webhook delivered for the next real email.
   Afterwards «Sarcini» watches it (`DECISIONS.md` §671): when the participants' emails that left by
   Mailgun in the last seven days carry not one delivery, it shows the red row «Mailgun nu trimite
   evenimentele „Delivered”» with this step's values filled in; the row goes at the first delivery reported.
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
webhooks and its suppression list. Both deployments' addresses are on every webhook (step 5) and each
acts only on its own messages' events, by the tag (§670) — a message sent before the tag existed is
acted on by both, and matches no row on the one that did not send it. The suppression list is not
split: a QA rehearsal's typo that bounces suppresses that address for production too, and a production
email to it then reads «Mailgun nu mai trimite» with no production cause in its history.

**Probation: 100 messages an hour.** Mailgun's notice of 2026-10-01 said: «You are sending too
fast. Your account is on probation and domains are limited to 100 messages / hour. To maintain
the rate the account has been temporarily disabled. The account will be enabled in 847 seconds.» The outbox paces to «Limita pe oră» on
«Setări» → «Emailuri» (default 100; `DECISIONS.md` §605): Mailgun's road sends at most that many
in any sixty-one minutes, counted in recipients (a copy is a message to Mailgun), the rest wait for
the next pass, and a refusal for the rate (a 429, or "temporarily disabled") pauses the message —
and every other Mailgun message until the pause ends — instead of failing it. The page shows
«Trimise în ultima oră: N din 100» beside the day's count. The default 100 has no margin beyond the
extra minute and the send's own timestamp, so set production's box to 90 while the probation lasts.
Each environment counts only its own outbox, and QA shares the domain and its box defaults to 100
too: together the two could send 200 in Mailgun's hour. Set QA's «Limita pe oră» to about 10 now,
and keep its rehearsals small while the probation lasts.
Ask Mailgun's support to lift the probation, then raise or clear the field on production.
**While Mailgun says stop** — a pause, or the allowance spent — the switch «Gmail preia când Mailgun se
oprește» (same page, «Prin ce pleacă emailurile»; on by default wherever the club's Gmail of §38 is set
and the privacy notice in force names `{{gmailFallback}}` — until a notice from the template is approved
it is greyed, and «Sarcini» carries the row «Nota de confidențialitate: Gmail preia când Mailgun se oprește»)
sends every group through Gmail until Mailgun reopens, and a refusal that is not about the message never
marks it failed; the failed come back with «Reîncearcă emailurile eșuate» on the queue (`DECISIONS.md` §622).

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
  *(Eight since 2026-09-18 counted by job, with new schedules since 2026-09-24: §40.)*
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

**The same account is the outbox's fallback road (`DECISIONS.md` §622):** while Mailgun says stop, «Gmail
preia când Mailgun se oprește» sends the whole queue through it — once the approved privacy notice names it
(`{{gmailFallback}}`, section 6 of the template), never before — at most «Limita Gmail pe zi» recipients in
a rolling day (500 is Google's own ceiling, shared with the people who write by hand and with QA) — on a
race morning that cap, not Mailgun's, is what decides how many confirmations still leave, so raise it there
before the window if Mailgun is on probation.

**Which road to choose: Mailgun, which the card marks «recomandat» (§782; the owner, 2026-10-15: «ar trebui în configs să scriu (recomandat)»).**
The pair «Prin ce trimitem» is on «Pagini» → «Contact» twice with the same words: once for «Scrie-ne» (in «Cine primește mesajele de contact») and
once under each «Spune-ne ceva» form. Mailgun is recommended because a message leaves from the club's own verified domain (SPF and DKIM), with the
person's address as `Reply-To` and **no copy in the club's Sent folder** — it arrives in the club's mailbox as mail from outside, not as «from me to
me», which is what a Gmail filter filed out of the Inbox on 2026-10-15; it has a delivery status by webhook; and it has neither Gmail's app password
(which Google revokes) nor its ceiling of about 500 a day, the club being on Mailgun's paid plan since 2026-10-01. Gmail stays the road behind it: a
form left on Gmail keeps a copy in the club's «Trimise» (the card says so beside it), and either road, when it fails twice, hands the message to the
other. **The default** of a form with no saved road — a fresh install, a new form, a deployment nobody has chosen on — is Mailgun where it transmits
(`EMAIL_DELIVERY_MODE` `allowlist` or `live`) and the club's Gmail where it does not; «Girl Zone» stays on Mailgun everywhere. **A road the club
saved is never changed by a release.** «Scrie-ne» had no road setting before §782 and always went by Gmail: with nothing saved it now goes by Mailgun
on a deployment where Mailgun transmits — choose «Gmail-ul clubului» in «Cine primește mesajele de contact» to keep the old road. The privacy notice's template says both roads for «Scrie-ne» too (§782); approve the notice from the new template (`/admin/legal`, a lawyer reading that paragraph first) like every change of the notice.

**The form's message is an outbox row since §778, and one road down is no loss.** «Scrie-ne» (the road the club chose, §782) and each «Spune-ne ceva» form
(the road the club chose on «Pagini» → «Contact») queue their message in the same outbox the emails use, and it leaves at once, after the
response; the words stay in the row only until it is delivered, then they are deleted and the row stays as the trace («Setări» → «Emailuri» →
«Mesaje de pe site»: the road chosen, the road it left by, the tries, what each road answered). If the road refuses twice — a revoked app password
(`smtp EAUTH`, Google's `535-5.7.8`), a timeout, a `5xx` — the **other road** carries it (Gmail to Mailgun, Mailgun to Gmail) and the Administrators
are emailed (once per club day per road); a timeout that may have come after the message was handed over keeps it on that road for three tries, then the
other road carries it — a possible second copy beats a lost message; a wrong password is no longer a sentence on the page, and `/devs` → «Stare» says which road fails. Girl Zone leaves by Gmail only with
the tick «Dacă Mailgun pică, trimite prin Gmail-ul clubului» and the notice naming it — and while the tick is in force the public form says so.
**Approve the privacy notice from the new template** (`/admin/legal`, with the other texts of the release): its contact and feedback paragraphs now say the
platform keeps a message only until it leaves (seconds, three days at the very most) — until then the notice in force says «nicio copie» and
`/admin/tasks` has the row «Nota de confidențialitate: coada mesajelor din formulare» (the queue runs meanwhile). What to do when a road stays down: `docs/RUNBOOKS.md` § A way
of sending is down. **The diagnosis of 2026-10-15** (QA «Spune-ne ceva» «did not send by Gmail»): what is proven is that no refusal was ever logged — QA's function
log held eight `[feedback] … sent` and no failure line, and the outbox's Gmail road on the same account carried twenty a day. What is **not** proven is
which road carried those eight: the old log line named no road, and the card was set to Mailgun, so they may all have been Mailgun's. One thing to
check, in a minute, as a hypothesis: the form's **«Către»**. If it is the club's own Gmail address (the account that sends), Gmail may keep a message
sent to itself in Sent / All mail and not in the Inbox; the card warns beside the box. Put another address there, or set that form's road to
Mailgun. **Answered by the owner on 2026-10-15 13:20:** the messages had arrived — a Gmail filter had filed them out of the Inbox; no road failed. From now on «Mesaje de pe site» names the road each message left by, so the question has an answer. On QA the allowlist now applies to Gmail as it does to Mailgun: a
recipient it does not name is captured, not sent (`EMAIL_ALLOWLIST`; `*` names everybody).

**Done on both Vercel projects**, and visible: `/ro/contact` shows the form on production and on
QA rather than the club's address (checked 2026-09-22). `CONTACT_SMTP_USER`,
`CONTACT_SMTP_PASSWORD` and `CONTACT_FORM_TO` were written on 2026-09-20 and predate the builds
now serving. The procedure below is kept for a new app password — Google shows one once — and for
the part that stays the club's, which is who receives a message («Pagini» → «Contact», `/admin/pages/contact`).

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
   characters (spaces or not, both work). The same on the QA project (a QA message reaches only an address
   `EMAIL_ALLOWLIST` names — since §778 the same rule as for Mailgun — its subject starting with `[QA] ` so it is
   never mistaken for a real question; put a test address there if even that is unwelcome).
   `CONTACT_FORM_TO` is **optional since `DECISIONS.md` §164**: it is the fallback list, read
   only while the club has named nobody in the app, and there is no `CONTACT_CC` variable at
   all. Set it if you want the form to work before anybody opens the backoffice.
4. Redeploy both projects.
5. In the app — the part the club owns, and the part that changes without a developer:
   «Pagini» → «Contact» (`/admin/pages/contact#contact-recipients`) → **"Cine primește mesajele de contact"** → **Către** = the mailboxes that
   receive each message, comma-separated; **Copie (Cc)** = anybody who should get a copy and
   be visible to the others (the administrator colleague's Yahoo, say); **Copie ascunsă (Bcc)** = anybody who
   should get a copy without the others seeing it — an archive mailbox, say (§293) → Salvează. The sentence above the boxes
   says which list is in force — the app's or `CONTACT_FORM_TO` — so there is no guessing.
6. Check: open `/ro/contact` on the deployment and send a message. The page says "Mesajul a
   plecat. Îți răspundem pe …", the email arrives in every mailbox from the club's address
   with "Reply" addressed to whoever wrote, and the "Formularul de contact" row on
   `/admin/tasks` is green; `/devs` shows the form as `smtp`. A wrong password shows
   `smtp EAUTH` in the row's «Mesaje de pe site» line, in `/devs` → «Stare» and in the function log —
   never the password — while the message goes by Mailgun (§778; before it, the page said «Nu am putut trimite. Scrie-ne
   direct la …» and the message was lost). Once the password is right, the first message Gmail carries clears the road.
7. **Optional, in the club's Gmail: file the messages the site marks as possible spam.** A
   message the form lets through but that looks automated still arrives, so that a real person is
   never lost. That covers a post with no anti-bot token while the check is on, and a sender whose
   domain imitates the club's (`search-<domain>`, `<name>-seo.com`). The subject carries
   `[posibil spam]`, right after the tags (`[contact][posibil spam] Mesaj de pe site: …`, `[QA][contact][posibil spam] …` on QA) and a note under the message says why. To file
   them away: open the club's Gmail → the search box → **Show search options** → in **Has the
   words** type `subject:"[posibil spam]"` (Gmail ignores the brackets and matches the phrase, so
   the QA mark is caught too) → **Create filter** → tick **Skip the Inbox (Archive it)** and
   **Apply the label** → **New label** `Posibil spam` → **Create filter**. Do not tick **Delete
   it**. Look at the label once a week: somebody whose browser never ran the check lands there too,
   and "Reply" still answers them. The mark is fixed text (`SUSPICIOUS_SUBJECT_MARK` in
   `src/modules/contact/message.ts`); changing it breaks this filter in every mailbox that has one.
   Do the same in any mailbox that is on "Către" or "Copie (Cc)" and wants it. (`DECISIONS.md`
   §310, §744) **Or stop them at the source:** «Pagini» → «Contact» → «Cine primește mesajele de contact»
   has a tick, «Nu-mi trimite mesajele care par spam», off by default; ticked, such a message is
   not emailed and the card only counts how many were stopped in the last 30 days (the sender
   still sees «mesaj trimis»; nothing of the message is kept). It covers the contact form and
   «Spune-ne ceva» except its safety branch.
8. **Optional: let the calendar entry ask «Da / Nu / Poate», and file the answers.** Off until
   somebody types an address; then a race's confirmation, reminder, «Detalii actualizate» about
   the time or the place and cancellation carry an invitation the runner's calendar app (Gmail,
   Outlook, Apple) answers, and the answer arrives as an email from the runner — «Accepted: <event>
   (…)» or its translation. Nothing on the site reads it; the club reads its Gmail. A group run's
   invitation rides only on the signed declaration's email and is sent once: no change notice or
   cancellation reaches the signers, so a run moved or called off afterwards stays as it was in
   their calendars — tell them another way. A calendar's «Nu» cancels nothing either: the place
   stays taken until the runner uses «Nu mai pot ajunge». (`DECISIONS.md` §672)
   - **QA first, then production.** Set the address on QA, register yourself for a QA event from a
     Gmail address (and an Outlook or Apple one if you can), and check: the confirmation arrives
     with its text, its links and the signed PDF visible, and with Da / Nu / Poate; one answer lands
     under the «Calendar» label below; «Setări» → «Emailuri» shows the row as sent, not «eșuat» or
     «respins». Only then set the address on production. The first real send on QA is the check
     that a live inbox shows the buttons and that Mailgun accepts the invitation's shape; nothing
     in the tests can replace it.
   - In the app, as an Administrator, on each deployment (QA has its own): «Setări» → «Emailuri» →
     **«Răspunsurile din calendar»** → «Răspunsurile din calendar merg la» = the club's Gmail with
     `+calendar` before the `@` (Gmail delivers `name+calendar@…` to `name@…`, and the part after
     the `+` is what the filter catches) → **Salvează adresa** → confirm. Never write the address
     into this repository; it lives in the app only.
   - In the club's Gmail: the search box → **Show search options** → **To** = that `+calendar`
     address → **Create filter** → tick **Skip the Inbox (Archive it)** and **Apply the label** →
     **New label** `Calendar` → **Create filter**. The answers collect under the label, out of the
     inbox. Do not tick **Delete it**: a runner who writes a line with the answer is reachable there.
   - To go back to the plain calendar file («Adaugă în calendar», no answer asked), empty the box
     and save. That does not reach the invitations already sent: they stay in the runners'
     calendars, and a cancellation after that no longer removes them. Changing the address to
     another one changes the organizer of entries already answered, which some calendar apps
     refuse; choose the address once.

**«Spune-ne ceva» — the anonymous forms under the contact form, above «Contact direct» and the newsletter (§676, §679, §772).** Nothing to set on the
deployment: each form leaves by the road the club chooses for it, «Prin ce trimitem» (§772) — the club's
Gmail, the same account as the form above (`CONTACT_SMTP_USER`, `CONTACT_SMTP_PASSWORD`), or Mailgun
(`MAILGUN_*`, already set, with the email provider live) — **Mailgun is the one the card marks «recomandat»**,
with its reasons in one line under the four pairs (§782). Until the club chooses, the three ordinary
branches («Cum a fost», «O sugestie», «O reclamație») leave by Mailgun where it transmits and by Gmail where
it does not (before §782: always Gmail), and the confidential «Girl Zone» by Mailgun; a form left on
Gmail carries the caption «Prin Gmail rămâne o copie în „Trimise”.» A form whose road this deployment lacks is not offered, whatever its switch says, and its
radio is greyed on the card with a link to the steps in «Sarcini» (the rows «Formularul de contact» for
Gmail and «Email către participanți reali» for Mailgun). On each deployment (QA has its own):

1. `/admin/legal` → the «GDPR» card → «Regenerează din șablon» → approve the notice: its section 5
   describes the forms. Until a notice naming them is in force in both languages, nothing shows on
   `/contact` whatever the switches say, and `/admin/tasks` carries the row «formularele „Spune-ne ceva”».
   The same paragraph now also names the named mode (§678): every form opens with «Anonim» / «Cu nume
   și prenume», and a person who gives a name chooses «Cine să afle?» — the club's mailbox or the safety
   branch's person. A notice approved before that template says the forms ask no name, so until one
   from the new template is in force in both languages every form is anonymous only, and
   `/admin/tasks` carries the row «„Spune-ne ceva” cu nume și prenume» — approve it again once this
   release is in.
2. «Pagini» → «Contact» → **«Spune-ne ceva»**: tick «Pornit» on each branch the club wants, with the
   one address that receives it; for «Girl Zone», the designated person's own address (not a shared
   club mailbox) and the first name the form shows («Mesajul ajunge doar la …») → **Salvează
   formularele** → confirm. Each branch is off by default; untick to take it away. «Cine să afle?»
   offers the safety branch's person whenever her address and first name are saved, switched on or not —
   unticking «Girl Zone» takes away her form, not her; on the safety form «Clubul» is the
   «O reclamație» address, or the contact form's recipients when it has none. Under each form,
   **«Prin ce trimitem»** (§772): «Gmail-ul clubului („Scrie-ne”)» or «Mailgun (recomandat)», two radios, saved with
   the rest. The road follows the form whose reader the message reaches: a message for the club's
   mailbox leaves by the road of the form it was written on (a Girl Zone message for «Clubul», by
   «O reclamație»'s), and one for the designated person by Girl Zone's own, whatever form it was written
   on, with the neutral subject; one from another form says which on its line «Din formularul: „…”».
   **Girl Zone by Gmail** puts her messages in the club's mailbox and its Sent folder, which everybody
   who reads that mailbox sees: the card says so under the radios, and the confidentiality of her form is
   then the club's choice. **Gmail for Girl Zone is greyed until the privacy notice in force says so**
   (§772): the notice's feedback paragraph promises her messages never pass through the club's mailbox
   unless the club chooses Gmail, and names that road with the marker `{{feedbackSafetyGmail}}`. Approve
   the notice from the template of this release first (item 1), in both languages; until then her
   messages leave by Mailgun whatever the card says, the form's sentences keep saying «doar la …», and
   `/admin/tasks` carries the row «Girl Zone prin Gmail» if Gmail was already saved. Once it is in force,
   the form's sentences stop saying «doar» and say the message reaches her through the club's mailbox.
   The optional «E-mail (opțional)» beside the name becomes the message's `Reply-To` on either road
   and is kept nowhere; Girl Zone's form has it too, with a «Telefon (opțional)» box beside it
   (the telephone goes in the message and is no `Reply-To`).
3. Check: `/ro/contact` shows «Spune-ne ceva» under the contact form, above «Contact direct» and the newsletter (the newsletter last); a message sent from QA arrives
   with `[QA][feedback][…]` in front of its subject (the tags, §786: «Filtre în Gmail» below), its first line «Nume: (anonim)» or the name the person gave. The site keeps no copy of any message, so the inbox is the
   only place to look.

To take the form away, clear the recipients on «Pagini» → «Contact» (`/admin/pages/contact`) and leave `CONTACT_FORM_TO`
empty — or remove `CONTACT_SMTP_USER` or `CONTACT_SMTP_PASSWORD` and redeploy: the page goes
back to the address either way. Google's own limit on an ordinary account is about 500 messages a day,
which is more than a club receives; the form's own limit is five an hour per sender.

### Filtre în Gmail — the tags at the start of every message the club receives

Every email the site sends **to the club or to a colleague** starts with fixed tags in square brackets, in lowercase
ASCII, never translated, so one Gmail filter files a message whichever language it was written in (`DECISIONS.md` §786;
the tags are `src/modules/notifications/domain/subject-tags.ts`'s, the one place that knows them). The words come
after: `[feedback][cum-a-fost] Cum a fost: <event>`. On QA the environment's mark comes first and is joined to
the tags: `[QA][feedback][cum-a-fost] …`. A message to a runner, a volunteer, a subscriber, an invitee of the public
or a member (their shop receipts, their invitation to the members' zone) **has no tags** — their subjects are what
they were. The club's copy of a runner's message keeps its own mark, `[Copie club]`.

| Tag | What arrives under it |
| --- | --- |
| `[contact]` | «Scrie-ne»: a visitor's message through the contact form |
| `[feedback]` + `[cum-a-fost]` · `[sugestie]` · `[reclamatie]` · `[girl-zone]` | «Spune-ne ceva», one tag for each of its four forms; **a message that reached Girl Zone's person carries `[girl-zone]`**, whichever form wrote it |
| `[inscrieri]` | «somebody has confirmed» (the registrations notice) |
| `[declaratii]` | the archive copy of a signed declaration |
| `[voluntari]` | an organizers' notice of a volunteer's sign-up |
| `[legal]` | the Administrators' digest of legal templates that moved |
| `[livrare]` | the platform's notices about the email roads: a road is down, a message could not be delivered |
| `[sistem]` | the platform's alerts: the database unreachable, and back |
| `[magazin]` | the members' shop: the club's notice of an order |
| `[echipa]` | a colleague's invitation to the backoffice |

**Ready-to-paste filters.** In Gmail: the search box → **Show search options** → paste into **Has the words** →
**Create filter** → tick **Apply the label** (a new one) and, if you like, **Skip the Inbox** → **Create filter**. Gmail
searches the words and ignores the brackets, so a quoted phrase is exact enough: a subject whose human words repeat
the tag's word («Comandă nouă în magazin», «Ești în echipa …») names the same family anyway. `[QA]` in front
changes nothing for these filters. **A filter matches the words anywhere in the subject**, so an event's title or a
visitor's name that repeats a tag's words («Girl Zone Run») can be filed under it by mistake: it mislabels, it forwards
nothing. For the confidential filter, the stricter `subject:"[feedback][girl-zone]"` narrows it.

```text
subject:"[contact]"                                  label «Site / Contact»
subject:"[feedback]" -subject:"[girl-zone]"          label «Site / Feedback»  (all three ordinary forms)
subject:"[cum-a-fost]"                               label «Site / Cum a fost»
subject:"[sugestie]"                                 label «Site / Sugestii»
subject:"[reclamatie]"                               label «Site / Reclamații»
subject:"[girl-zone]"                                label «Girl Zone»  — see the warning below
subject:"[inscrieri]" OR subject:"[declaratii]"      label «Site / Înscrieri»
subject:"[voluntari]"                                label «Site / Voluntari»
subject:"[legal]"                                    label «Site / Legal»
subject:"[livrare]" OR subject:"[sistem]"            label «Site / Platformă»  (a road down, the database away: read these)
subject:"[magazin]"                                  label «Site / Magazin»
subject:"[echipa]"                                   label «Site / Echipa»  (a colleague's invitation)
subject:"[Copie club]"                               label «Site / Copii»  (the club's copy of a runner's message: no tag, its own mark)
subject:"[QA]"                                       label «QA»  (skip the Inbox; the tests of a QA release)
```

**Girl Zone's messages are confidential.** Filter `subject:"[girl-zone]"` only in the mailbox of the person who
receives them (or of the club's, when the club chose Gmail for that form), with a label and a star, **never with
«Forward it to»**, never in a filter another account can read, and never in a mailbox shared wider than the form's
card says. The `[feedback]` filter above excludes `[girl-zone]` for the same reason: a forward or a shared label made
from it would carry her messages along. The subject's words stay neutral on purpose («Mesaj confidențial de pe
site»); the tag is the one thing that tells the person's own filter what it is. **The tag shows in a notification's
preview** (a lock screen included), which the neutral words alone would not: the person can hide previews or silence
notifications for the «Girl Zone» label in the mail app.

Changing a tag is changing every mailbox's filter, so a tag moves only by a decision.

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
| Când și unde | Durata (Ore / Minute) | how long the club will be there, start to prize-giving |
| Când și unde | Fus orar | **Europe/Bucharest** (already filled in) |
| Când și unde | Punct de întâlnire | where people gather, e.g. **Parcul Tractorul** |
| Când și unde | Adresă | the street address, for the map and the calendar entry |
| Când și unde | Link către punctul de întâlnire | a Google Maps link, https |
| Înscrieri | Modul de înscriere | **Înscrieri pe site** |
| Înscrieri | Număr de locuri | **YOURS** — how many runners the club can handle. Leave it empty only if there is genuinely no limit; the page then shows no number and the waiting list never engages |
| Înscrieri | Lista de așteptare | **Nelimitată** — the list is private (§628) and an open-ended line costs the club nothing. The other answers: **Limitată la un număr de locuri** shows a box for how many may wait (empty or **0** there switches back to Nelimitată), and **Fără listă de așteptare** turns everyone away once the places are gone — the only answer that closes the list |
| Înscrieri | Locurile din lista de așteptare se alocă automat | **Da** (the default) offers a freed or added place to the first person waiting at once. **Nu** leaves every such place to you: hand it out from «Coada de înscrieri» on the event's page with «Trimite-i oferta» (the ordinary offer and its email, to the named person), or at the desk with «Dă-i un loc»; while anyone waits, newcomers join the list. The recipe for a margin (say 200 medals, 150 places announced): keep **150** and **Da**; when the list forms, press «Trimite-i oferta» on each named person, one by one — on a full race its window says it adds a place and its button reads «Adaugă un loc și trimite oferta»; once confirmed, the capacity grows by one (150 → 151), written in the registration's trail with who and for whom, and the place is that person's, not the first in line's. There is no need to raise **Număr de locuri** first; set **Nu** only if you also want places freed by cancellations to wait for your choice. It works at any moment before the start, after **Înscrierile se închid** too (the offer then lasts at most until the start); at the desk «Dă-i un loc» still needs a free place. Raise the places in the editor only if you want them open to everyone: once nobody is left waiting, the places still free go to whoever registers next |
| Înscrieri | Înscrierile se deschid | leave **empty** — entries open the moment the event is published |
| Înscrieri | Înscrierile se închid | leave **empty** for "until the start", or a date if the club wants the list closed earlier |
| Înscrieri | Confirmarea participării: cu câte zile înainte se cere | **YOURS** — the default **7** asks everyone to confirm a week out |
| Înscrieri | …și cu câte zile înainte expiră | **YOURS** — the default **2**: an unconfirmed place goes to the waiting list two days before (when somebody waits). Changing either number later moves the places already reserved by the window to the new deadline in the same save — the card says how many before you press, the banner after; inside an open window each of those people is emailed the new deadline. The last call to sign goes «Setări» → «Termene» → «Ultima chemare la semnat…» hours before the deadline (48 by default) |
| Înscrieri | Numerele de concurs (BIB) încep de la | **1**, or **100** if the club wants three-digit numbers |
| Înscrieri → «Numere de concurs (BIB)» → «Cum arată numărul de concurs» → «Antet» | Culoarea numerelor de concurs (BIB) | the band colour on the printed bib; any of the palette's |
| Înscrieri | Declarația pe care o semnează participantul | the approved **EVENT_DECLARATION** — the only entry in the list on production |
| Înscrieri | Publică lista participanților | leave **off**. It goes on only once the privacy notice describes it |
| Înscrieri | Clubul pe lista publică | **«Doar» the club's name** (the default, §753, §756): the «Club» column shows the club's own name for everyone who typed the club (BVR, the full name, any usual spelling, «.ro» after it, one typo in a word forgiven, a digit never), with or without an account on «Echipa»; every other cell is blank, and the column is not drawn when none has a value. «Cum l-au scris» shows what people typed, silly text included; «Nu arăta clubul» draws no column. Display only: the backoffice, the exports, the desk and the bibs keep the typed club |
| Înscrieri | Arată public câți așteaptă | under «Arată public numărătoarea», shown while that one is ticked (§669); unticking the count makes the line's count private too. Suggested for the race: **untick it**. The card, the page and each person on the list then learn only that a waiting list exists and how to join it — no count and no place in the line (the newest is always last, so a place would be the count); you still see every number in the backoffice (§634) |
| Traseu și detalii | Distanță, Denivelare, Dificultate, Suprafață, Cost | as the race is |
| Română / English | Titlu, Adresa paginii, Rezumat | both languages — the event cannot be published with either missing |
| Română / English | Regulamentul evenimentului | the race rules. Every entrant ticks "am citit regulamentul", and the emails link here |
| Când și unde | Program | kit pickup, briefing, start, cut-offs — one timed row each; every row becomes a calendar entry and is repeated in the reminder. The rows are the programme (§117). Change the event's date and the rows move with it (§295) |
| Română / English | Note sub program | optional free text that appears beneath the rows on the page — how the kit is collected, the cut-off rules — per language (§294) |

Then **Salvează**, read the page through **Previzualizare** — the editor's card of that name also
has **Formular**, the registration form a runner will fill in, with the boxes set above — and press **Publică**. Both
languages go live together; that is the rule, not a setting.

### After it is published, in this order

1. `/ro/evenimente` on the club's domain — the race is there, with its free places on the
   button.
2. Open the registration form and read it as a runner would. Do **not** complete a real entry on
   production unless the club wants that row in its list; the rehearsal belongs on the QA host,
   where the same form sends real email to the addresses in `EMAIL_ALLOWLIST`.
3. «Setări» → «Emailuri» (`/admin/settings/emails`, §516) → the Mailgun plan. Free is **100 messages a day**, and a completed
   registration costs about six, so about **16 entries a day** (`docs/PLATFORM.md`). If the
   race opens to a crowd, one month of **Basic** is $15 and is a setting on that screen — no
   deployment.
4. `/admin/tasks` → the row for this item turns green by itself once the event exists.
5. The club's own runners — organizers, pacemakers, invited runners — go on **«Lista de invitați speciali»**.
   First, in the event's settings (`/admin/events` → the race → «Lista publică a participanților»),
   tick **«Folosește lista de invitați speciali»** and choose, under it:
   - **«Numerele invitaților speciali încep de la»** — empty, they draw from the race's own series like
     everybody; set (say 900), the special guests list has its own series from there up, in confirmation
     order. The save refuses a start inside the race's series (the first number and as many after
     it as there are places), or a start whose series would run into the desk's spare numbers; on a
     race without a limit of places, whose series has no end, only a start below the race's first
     number is accepted. It judges the start only when the save moves it, switches the special guests list
     on, or moves the race's first number or its places — a place «Trimite-i oferta» added never
     makes the next save refuse a start nobody touched. A save carried to other dates of a series
     judges each date by its own places and spares, and a refusal says the box and the date and
     changes no date; a duplicate or a repeat whose places have reached the special guests' start is refused
     with a sentence that says the box to move. A standing series in that state makes no new dates
     until the start is moved: each maintenance run counts it as an error in its job record and
     logs the event's id. Leave room above the race's places for
     such supplementary places and for the desk's spares (say 900 for a race of 150, not 151). With
     the special guests' series above the race's, the spares printed for the desk stay between the two — a
     print that would reach the special guests' series is refused with a sentence that names this box. A
     series with no free number left draws the next free number after it, in the other series if
     need be; no number is ever given twice;
   - **«Numără și invitații speciali»** — unticked by default, «Cine vine» counts the race's places only;
     ticked, it counts the special guests list too. The places line and the free places never do;
   - **«Arată invitații speciali pe lista publică»** — unticked by default (§743): no special guest is on any
     public list, whether or not they ticked «Vreau să apar»; ticked, one who ticked appears on «Cine vine»
     with their number. It changes no count and takes effect only while the switch above is on.

   Above «Arată public câți așteaptă», which sits under it (§669), on this and every event whether or not the
   special guests list is on, **«Arată public numărătoarea»** — ticked by default; unticked, «Arată public
   câți așteaptă» is hidden (its tick kept, but the line's count is private everywhere, each waiting
   person's own page and email included), «Cine vine» shows the names
   only, with no count in its title, no «confirmați» line and no position, and the event's public
   pages say no number at all: no «N înscriși din M locuri», no free places, no «Toate cele M locuri»
   (it reads «Toate locurile s-au ocupat»), no room or count on the waiting list — only whether
   places are left, the race is full or the waiting list is open (§668).

   Then they register like anybody (or are entered from «Înscrierile primite»), and an
   Administrator opens each registration → «Lista de invitați speciali» → chooses «Invitat special — nu
   ocupă un loc» and confirms (the «i» beside the heading says what the list is for and is not). They keep a declaration, a race number and their row on the public list if they
   ticked, and take none of the announced places; a place one of them held is given back to the
   line (§643, §647, `AGENTS.md` §15.11). A number already given stays when somebody changes list.
   While the switch is on — or while anybody already on the list still holds a place, since
   unticking it takes nobody off — the event page's places line («N înscriși din M locuri») carries one
   sentence in the public's words — organisers, volunteers and invited runners may be at the start
   outside the advertised places, taking none of them; the name «Lista de invitați speciali» is the backoffice's
   alone and appears on no public page and in no participant's email.
6. **Invitations by email** — members, partners, guests the club wants at the start, without asking
   them to fight the public form (§647). «Alergări» → «Editează» on the race → «Înscrierile primite»
   → «Trimite invitații» opens the «Invitații» section of the race's registrations list:
   - tick members from the members' zone (search by name or address), and/or type other people one per
     line — the name, then the email address;
   - «Zile până expiră» (7 by default; never past the start — invitations may go after **Înscrierile
     se închid**, for organizers, pacemakers and volunteers invited late);
   - «Limba invitației» (Română by default) for typed addresses the club has never seen: a member gets
     the account's language, somebody already registered with the club the language they used;
   - «Pe lista de invitați speciali (nu ocupă un loc)» for organizers, volunteers and pacemakers: their invitations
     keep none of the announced places. The tick shows only while the race's **«Folosește lista de
     invitați speciali»** (item 5) is ticked; switched off since the page was opened, the send is refused with
     the same sentence the registration's own «Lista de invitați speciali» gives;
   - «Trimite invitațiile» asks first: how many invitations, how many places are free for them, until
     when the invitation lasts and in which language a new address gets it, and — on a full race, or
     while anybody is on the waiting list — how many supplementary places it adds and what the capacity
     becomes; the button names the places it adds. A free place somebody waits for is theirs, never an
     invitation's, whether «Locurile din lista de așteptare se alocă automat» says **Da** or **Nu** and
     after **Înscrierile se închid** too. Each person gets one email, «Acceptă invitația», which opens the form with their
     name and address filled in; they fill in the rest, accept the terms and sign the declaration
     themselves, from the email that follows.
   - Each invitation keeps its place until its deadline; unaccepted, the place goes back to the line by
     itself. On the invitation's row: «Retrimite» (a new link; the deadline stays, unless you type a
     number of days in the box and that comes later) and «Retrage» (the place goes back at once). While
     anybody is on the waiting list, «Retrimite» on an invitation that holds a counted place sends the
     link and the email again but keeps the deadline — the row shows no days box, the dialog says why,
     and the message after it says the deadline stayed: if the invitation is not accepted by then, the
     place goes to the waiting list. An invitation «Pe lista de invitați speciali» can still be extended. The Organizer sees the list, not
     the buttons.
   - Somebody invited who registers anyway, through the public form or at the desk, takes the
     invitation's place once their address is confirmed or a place is given to them: the invitation
     reads «Acceptată» and links the registration, and their registration's page says «Înscriere pe
     invitație — trimisă de …». Nobody waits behind a place kept in their own name.
   - The privacy notice describes invitations once the club approves it from the template:
     `/admin/tasks` shows the row «Nota de confidențialitate: invitațiile pe email» until then.
     Invitations work meanwhile.

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

**When the pages open but a save does not** (the same laptop, 2026-09-26): the proxy lets pages
through and stops the scripted save — a POST with the `Next-Action` header, answered as
`text/x-component`. Since `DECISIONS.md` §436 the backoffice says so where the save was pressed,
in the order to act on it:

1. The warning «Rețeaua a blocat salvarea» appears above the form; what was typed stays in it.
   **If the green confirmation already appeared, do not press anything** — the save is in; check
   the page. The platform never sends a save twice on its own, because a cancel, an erase or a
   message sent twice happens twice.
2. Otherwise press **«Trimite pe calea simplă»**: the same form goes as a plain form post, which
   the proxy lets through. The page it lands on says «…am încercat calea simplă.» — the save is in
   only if the green confirmation shows as well. No confirmation means the save may not have landed: check the page before
   pressing again. «Nici calea simplă nu a putut fi folosită» means it did not leave: the phone, and the check below.
3. Open **`/admin/network`** («Verificarea rețelei», linked from the guide and from that notice)
   on the same laptop. It tries four things from the browser — the saves, the plain form post,
   a stored picture, the anti-robot check — and prints, under each red row, the exact line for IT,
   with the host taken from the site's configuration.
4. **Copiază raportul** and send it to IT (or to the club). It holds the results, the site's
   address and the browser's description, nothing about the person.
5. The hosts IT is asked to allow are the ones the page prints: this site's (POST with
   `Next-Action`, and plain `multipart/form-data` posts), the picture store's public address
   (`R2_PUBLIC_BASE_URL`), and Cloudflare Turnstile's script host. Meanwhile: the phone.

### What to have ready before sitting down

The capacity and the two window numbers (the club's own call), the rules text, the programme,
the meeting point and its map link, and the bib band colour. Nothing else is asked for, and
nothing here needs a developer.

## 40. Neon's limits and the monitors' cadence — set 2026-09-23

**Why.** The owner, with Neon's billing page open: "$1 in two days — I need to throttle", then
"QA cheaper, and production capped, not unlimited". Measured the same night from Neon's
operations log: the bill is **time awake**, not size. Both computes averaged 0.26 CU while awake,
and on Launch a compute sleeps only after **5 idle minutes, a figure Launch does not let anybody
lower** — so every request that touches the database costs at least 5 minutes at 0.25 CU.
Production was awake 25 h of the first 37 h: about 75 wakes from the job and health monitors at
:00/:15/:30/:45, about 64 from visitors, crawlers, staff and deployments. `DECISIONS.md` §327.

**What is set, on Neon itself (read back after each change):**

```text
                      max size        monthly limit (compute_time_seconds)
production            0.25–1 CU       100 CU-hours  (360000)  ≈ $10.60 at most
QA                    0.25 CU fixed    30 CU-hours  (108000)  ≈  $3.20 at most
```

Together they sit under the $15 spending notification on Neon's Billing page (organisation-wide,
kept; it stood at $0.14 of $15 on 2026-10-01, the first day of the October period —
`docs/PLATFORM.md` § Cost keeps the readings). **A project that reaches its limit is suspended by Neon until the next billing period
starts** — on production that is the site down: registrations, the desk, the emails. So the
limit leaves room (production used 6.3 CU-hours in the first 37 hours, most of it two people
testing all day), and «Setări» → «Costuri» (`/admin/settings/costs`, §516) shows the month's hours. To raise a limit before
it bites, the same call that set it, with the project's id and an API key allowed to change the
project:

```text
PATCH https://console.neon.tech/api/v2/projects/<project id>
{ "project": { "settings": { "quota": { "compute_time_seconds": <CU-hours × 3600> } } } }
```

The size ceiling is `PATCH …/projects/<id>/endpoints/<endpoint id>` with
`{"endpoint":{"autoscaling_limit_max_cu":1}}`, and the same values in the project's
`default_endpoint_settings` so a recreated compute inherits them.

**The monitors on cron-job.org, as set — read back from the owner's screenshots on
2026-09-24.** Account time zone `Europe/Bucharest`. The job addresses are each Vercel project's
own `vercel.app` address (§26's table), on purpose — on 2026-10-03 the pings in use were not, so
read them back (below); the health monitors call the club's hosts, and since 2026-10-03 a second
pair calls the `vercel.app` addresses.
Every job POST carries `Authorization: Bearer <that environment's JOB_SECRET>` (the job's
*Advanced* tab); the health GETs carry nothing.

```text
cron-job.org title          request                                          crontab               when
prod outbox day             POST production …/api/internal/jobs/email-outbox  */15 7-22 * * *       every 15 min, 07:00–22:45
prod outbox night           POST production …/api/internal/jobs/email-outbox  0 0-6,23 * * *        hourly, 23:00–06:00
prod maintenance day        POST production …/jobs/registration-maintenance   0,15,30 7-22 * * *    :00 :15 :30, 07:00–22:30 — see below
prod maintenance night      POST production …/jobs/registration-maintenance   0 0-1,4-6,23 * * *    hourly, 23:00–06:00, not 02:00 or 03:00
brasovrunners PROD health   GET  the .com /api/health                         2 0-1,4-23 * * *      hourly at :02, not 02:02 or 03:02
qa outbox                   POST QA …/api/internal/jobs/email-outbox          0 * * * *             hourly
qa maintenance              POST QA …/jobs/registration-maintenance           0 */2 * * *           every 2 hours, even hours
brasovrunners QA health     GET  qa. /api/health                              2 */6 * * *           00:02, 06:02, 12:02, 18:02
brasovrunners PROD deep     GET  the .com /api/health?deep=1                  2 4 * * *             once a day, 04:02 — to add (§577)
brasovrunners QA deep       GET  qa. /api/health?deep=1                       2 4 * * *             once a day, 04:02 — to add (§577)
```

All of them: *notify on failure* after 1 failure, *notify when disabled for too many failures* on,
responses not saved.

**A long real run is not a failure (`DECISIONS.md` §667).** cron-job.org gives up on a request
after 30 seconds and reports «Timeout». A job ping that runs for real answers within twenty
seconds: a run still going then answers 200 with `continuing: true` and its `startedAt`, and
finishes on the platform after the response — its plan written when it ends. With responses not
saved, the job's **History** shows such a run as a successful 200 that took about twenty seconds
instead of «Timeout»; the body (`continuing: true`, `startedAt`) shows there only with the job's
"save responses" option on. Vercel's function log for the route is the authority:
`[jobs] <job>: finished after the response in <ms> ms` (and the error line, if it failed). Nothing
to set: no schedule, header or timeout changes.

**Since 2026-10-03: the jobs and a second health monitor on the address no registrar can hold
(`DECISIONS.md` §659).** While the registrar held the name for seven hours (§26), no job ran:
the table above names the `vercel.app` addresses, yet the cron-job.org job pings in use called the
public name, and the GitHub backstop called nothing — its base-URL secrets were unset, so its steps
skipped green (step 3). The clicks below move both to the `vercel.app` addresses. Each Vercel
project's own `vercel.app` address (§26's table) answers whatever happens to the club's DNS. The
owner's clicks, once:

```text
cron-job.org title           request (unchanged schedule, header and notifications)
prod outbox day / night      POST https://brasov-runners-production.vercel.app/api/internal/jobs/email-outbox
prod maintenance day / night POST https://brasov-runners-production.vercel.app/api/internal/jobs/registration-maintenance
qa outbox                    POST https://brasov-runners-qa-nu.vercel.app/api/internal/jobs/email-outbox
qa maintenance               POST https://brasov-runners-qa-nu.vercel.app/api/internal/jobs/registration-maintenance

new, beside the two on the public names, which stay:
brasovrunners PROD origin    GET  https://brasov-runners-production.vercel.app/api/health   2 0-1,4-23 * * *   hourly at :02, as PROD health
brasovrunners QA origin      GET  https://brasov-runners-qa-nu.vercel.app/api/health        2 */6 * * *        every six hours, as QA health
```

1. **The job pings** — every job of the table above, six in all, two endpoints per environment:
   cron-job.org → the job → **Common** → **URL** → the address above; the *Advanced* tab's
   `Authorization: Bearer <that environment's JOB_SECRET>` stays as it is. **Save**, then **Test
   run**: 200. While the name is gone the jobs keep running, and the outage grace — its own
   decision in this release — needs exactly that: its `dns` signal is the maintenance job finding
   the public name gone, which it can only do if something reaches the job by another address.
2. **The two new health monitors** — *Create cronjob* → the address above, *GET*, no header,
   *Custom* schedule as in the table, *notify on failure* after 1 failure and *when disabled*, the
   same as the others. Each is the shallow `/api/health` (§577): it wakes no database and costs one
   function call an hour. **The monitors on the public names stay**: they are the ones that say the
   name is dead. Read the pair together — public red and `vercel.app` green is the name
   (`docs/RUNBOOKS.md` § The domain stops answering); both red is the site — unless the body still
   carries a build and `domain.status` says `urgent` or `expired`: from 30 days before the expiry
   (once `DOMAIN_REGISTERED_ON` is set) the shallow health answers 503 on every host, and that pair
   is the renewal (§26), not the site.
3. **The backstop's secrets.** GitHub → the repository → **Settings** → **Secrets and variables**
   → **Actions** → **Secrets**: `PRODUCTION_APP_BASE_URL` = `https://brasov-runners-production.vercel.app`
   and `QA_APP_BASE_URL` = `https://brasov-runners-qa-nu.vercel.app`, no trailing slash, beside
   `PRODUCTION_JOB_SECRET` and `QA_JOB_SECRET` (each that project's `JOB_SECRET`, character for
   character). **Today the two base URLs are unset**: `.github/workflows/scheduled-jobs.yml`'s steps
   print «not configured; skipping» and exit in zero seconds with a green tick, four times a day,
   and guard nothing (the green skip of `DECISIONS.md` §31). Verify with **Actions** →
   **scheduled-jobs** → **Run workflow**: each step takes a second or two and prints the job's JSON.

**Why `/api` on the `vercel.app` host is not sent to the public name.** Nothing in the application
redirects one host to another, and `src/proxy.ts` — the only code that redirects at all (locales,
aliases, moved backoffice addresses) — excludes `/api` from its matcher
(`"/((?!api|_next|_vercel|.*\\..*).*)"`), so `/api/health` and both job routes answer on whichever
host was asked. Keep it so in Vercel too: the project → **Settings** → **Domains** → the
`vercel.app` domain must not be set to *Redirect to* the public name, or every ping above would
follow a 308 back to the name that is gone.

**Since §577 (2026-09-30): the daily window and the two depths of `/api/health`.** An idle
platform now looks at its database once a day, at **04:00** in Brașov — both jobs' safety run, the
retention sweep, the picture sweep and the standing series — instead of every hour; every deadline
the work has (a hold, an offer, an email link, a reminder, an outbox retry) keeps its own time, and
any action of a person that makes work sooner wakes the job at the next ping. `/api/health` is
**shallow** by default: the build and the configuration, no database and no third party, so the
hourly and six-hourly health monitors above wake nothing — they stay as they are, and they still
email when the site stops answering. The full report is **`/api/health?deep=1`**: the database,
the schema, the jobs, the email, the Neon quota, the bot check and the DeepL credit. The two `deep`
monitors in the table are the owner's clicks, once each: *Create cronjob* → the address above,
*GET*, no header, *Custom* → every day, hour 4, minute 2, the same notifications. At 04:02 the
database is still awake from the 04:00 runs (a compute sleeps five idle minutes after the last
query), so the deep check costs no wake of its own. `yarn smoke` and the migration workflow ask for
the deep report themselves; `yarn ship` polls the shallow one and asks the deep one once, after the
new build answers. The job monitors' cadence stays as it is: a ping with nothing due answers from
the cache in milliseconds, and the quarter-hour by day is what a hold's hand-over waits for.

**Why this is right against the health check** (`modules/jobs/quiet-hours.ts`: a job is
`stale` after twice the cadence plus five minutes — 35 minutes by day, 125 at night on
production; 125 on QA, which carries `PINGER_CADENCE_MINUTES=60`):

- Production's night maintenance gap, 01:00 → 04:00, reads `stale` from 03:05 to 04:00 — but no
  health check runs in that window (it skips 02:02 and 03:02), and the 04:02 check follows the
  04:00 run. No false alarm; a hold or offer that expires at 02:10 is released at 04:00, when
  nobody is registering.
- QA's maintenance every 2 hours sits inside its 125 minutes, and each QA health check runs two
  minutes after an even-hour maintenance run.
- The health checks were the expensive ones: every `/api/health` touched the database, and on
  Launch a wake costs at least five minutes (above). Since §577 the monitors' `/api/health` is
  shallow and touches nothing; only the daily `?deep=1` at 04:02 reads the database, inside the
  04:00 runs' wake. A job ping with nothing due answers from the cache and wakes nothing (§334),
  which is why the job monitors stay frequent. The staleness figures below are for the deep check;
  since §577 a real run is allowed up to a day apart (the 04:00 window), plus the same threshold.

**QA's emails wait longer than production's, on purpose.** Under «Când pleacă emailurile» =
«La trecerea programată» (the default) an email leaves at the outbox job's next real run. On QA
the `qa outbox` monitor above is **hourly** and „Cât de des verifică site-ul" is 2 ore, so a QA
email may wait up to about three hours — it has not stopped, it is waiting. `/admin/settings/emails`
→ «Coada de trimitere» says it: the next round, the last one, what holds it back, and when each
queued email leaves; `/admin/tasks` → the monitors row says this environment's cadence (from
`PINGER_CADENCE_MINUTES`, 60 on QA). While testing on QA, either:

1. on cron-job.org → `qa outbox` → Execution schedule → Custom → every 15 minutes
   (`*/15 * * * *`), and on QA „Cât de des verifică site-ul" → „La nevoie" — then put both back
   (hourly, 2 ore), because every real run wakes QA's database; or
2. on QA's `/admin/settings/emails` → «Coada de trimitere» → «Trimite imediat după cerere» (the
   same setting as «Termene» → «Când pleacă emailurile»); each email leaves seconds after the
   request, and the switch sends what was already queued. Switch it back with «Trimite la trecerea
   programată».

**The setting is per environment:** each database keeps its own, so switching it on QA changes
nothing on production, and the reverse.

**Two things still open, both the owner's:**

1. **prod maintenance day** reads `0,15,30` — the :45 run is missing (probably a click). It
   passes the health check (a 30-minute gap against 35), but by day a hold or a waiting-list offer
   is then released up to 30 minutes late instead of 15, at no saving: tick minute **45** too, so
   it reads `*/15 7-22 * * *` like the outbox.
2. On QA, «Setări» → «Costuri» (`/admin/settings/costs#job-cadence`, §516) → „Cât de des verifică site-ul" → **2 ore** (the card is
   live since BR-V1.70); production stays on „La nevoie".

## 41. Release from the phone — the token, the variable and the label (once, before a holiday)

**Why.** A release used to need the PC that ran the dispatcher: the landing text sat in its
scratchpad and `yarn ship` ran from its checkout. `.github/workflows/release.yml` does the same
on GitHub (`DECISIONS.md` §535), started by the label `ship` on a pull request into `qa`. It
needs three things GitHub cannot ship in a file, because the repository is public. Ten minutes,
from a computer (the phone's browser works, in desktop mode).

**1. The token — secret `SHIP_TOKEN`.** GitHub's own token cannot do it: a push or a merge made
with it starts no workflow, so `qa`'s run, the release PR's run and `migrate.yml` would never
start. Signed in as the owner (the account that may merge into `main` and is a required reviewer
of the `production` environment):

1. github.com → your picture → **Settings** → **Developer settings** → **Personal access tokens**
   → **Fine-grained tokens** → **Generate new token**.
2. **Token name** `brasovrunners ship`; **Expiration** a date after you are back (at most a year);
   **Resource owner** you; **Repository access** → **Only select repositories** → this repository.
3. **Repository permissions** — each **Read and write**: **Contents**, **Pull requests**,
   **Actions**, **Deployments** (approving the gated `production` migration run), **Workflows**
   (a landing that merges `qa` in carries `qa`'s workflow changes, and GitHub refuses that push
   without it). **Metadata** is read-only and set by itself. Nothing else. **Issues** is no
   longer needed (`DECISIONS.md` §658): the closing comment and the removal of the `ship` label
   are made with the run's own token, which the workflow grants itself, so a token without it
   loses nothing and an existing token that has it may keep it.
4. **Generate token**, copy it once.
5. The repository → **Settings** → **Secrets and variables** → **Actions** → **Secrets** →
   **New repository secret** → Name `SHIP_TOKEN`, Secret the token → **Add secret**.

**2. The variable `SHIP_PRODUCTION_URL`.** Same page → **Variables** → **New repository
variable** → Name `SHIP_PRODUCTION_URL`, Value production's origin — `https://` and the
production host in §26's table, no trailing slash — → **Add variable**. The same value the PC
keeps in `.env.local`.

**3. The label `ship`.** The repository → **Issues** → **Labels** → **New label** → Label name
`ship` (lower case, exactly), any colour → **Create label**.

**4. Rehearse once, before you leave.** **Actions** → **release** → **Run workflow** → Branch
`qa`, **pr** the number of an open pull request into `qa` that carries a `.release/` entry, tick
**dry_run** → **Run workflow**. It merges `qa` in and lands the entry on the runner only, and its
summary page shows the landing commit and the diff it would push; nothing is pushed or shipped.
Green there means the token, the variable and the scripts work; the first real press is then the
label. `docs/RUNBOOKS.md` § Release from the phone has the everyday steps. A pull request that
shows «This branch has conflicts» gets no run from the label at all — run **release** by hand
with its number, as here with **dry_run** off.

**When the token expires** the run stops at its first step and says so; generate a new one the
same way and replace the secret's value (**Secrets** → `SHIP_TOKEN` → **Update**).

## 42. Vercel's plan on «Setări» → «Costuri»

The money page prices Vercel from a setting, not from Vercel: the site does not ask Vercel's API
which plan the account is on. So when the club takes **Pro** — as on 2026-09-30, for the function
quota before the 21 November race — an Administrator opens **«Setări» → «Costuri»** on each
environment, finds the card **«Planul Vercel (găzduirea)»** under the database's card, chooses
**Pro**, types the number of **developer seats** (the people who deploy; view-only seats are
free), writes a note (why, until when) and saves. The day the club drops Pro, the same card goes
back to **Hobby**. A deployment that never set it reads Hobby, which is what the page said before
the card existed. Each save is audited (`vercel_plan.changed`, with the seats before and after).

Three places read it: the «Cât costă» sentence (per month and per year), the table under it
(each service per month and per year, and the total) and the Vercel line of «Luna aceasta».
On Pro the Vercel row costs the seats' price a month, with Romanian VAT on top as for Mailgun,
and its build minutes are counted with no ceiling, because Pro's is not recorded here.

The price it quotes is the one `docs/PLATFORM.md` § Subscriptions records, checked 2026-09-05:
**$20 a month per developer seat**, with $20 of usage credit included and usage beyond it billed
on top; the catalogue is `src/modules/diagnostics/domain/vercel-plan.ts`. Re-check it with the
other vendors' prices. Reading the plan from Vercel's own answer first, with this setting as the
fallback — the way the Neon plan works since `DECISIONS.md` §326 — is the follow-up.

## 43. Magazinul membrilor — open the members' shop

The members' shop (`DECISIONS.md` §683, its editor rebuilt in §697) is built and closed: members see
nothing of it until the steps below are done, in this order (the last two are optional). Payment never
goes through the site — the member pays by bank transfer or in cash, and an Administrator — or the
colleague who runs the shop (step 6) — marks the order paid.

«Magazin» in the backoffice's top bar has three tabs: **«Produse»** (the product list), **«Comenzi»**
(the orders) and **«Setări»** (how to pay and who hears of an order). A product is a page of its own,
with its cards in the order you fill them.

1. **Approve the privacy notice that names the shop.** `/admin/legal` → the «GDPR» card →
   «Regenerează din șablon» → confirm. Section 5 gains the shop's paragraph (what an order keeps,
   why, for how long, that payment is outside the site). A lawyer should read it first, above all
   how long the orders are kept as accounting records. Open the draft, fill in what is left,
   «Salvează ciorna», then «Aprobă și publică». Until a notice naming `{{membersShop}}` is in force
   in both languages, the members' zone draws no shop and an order is refused; `/admin/tasks`
   shows the row «Nota de confidențialitate: magazinul membrilor» while a product is visible.
2. **Write how to pay and who hears of an order.** «Magazin» → «Setări»: the payment words in Română
   and English (both or neither — the club's IBAN and, for example, «sau numerar la alergare»;
   «Copiază și tradu tot: RO → EN» fills the English from the Romanian once DeepL is set up, §464),
   and optionally one address for «Cine primește comenzile». With the address empty no email is
   sent to the club; the orders are in «Comenzi» either way. The box **«Îi scriem membrului pe email
   despre comenzi»** (on by default) is the one switch for the member's two emails — «Comanda ta a
   fost primită» and «Comanda ta e plătită»; off, the member gets neither (the club's own notice is
   a different thing and stays), and the per-order tick on «Comenzi» is not offered (§704).
3. **Add a product.** «Magazin» → «Produse» → «Adaugă un produs». The page has the cards in order:
   - **«Denumirea și prețul»** — the name in both languages (the translate button at the top), the
     price («45» or «45,50») and «Moneda»: lei or euro, chosen per product, shown to members as such
     and never converted; an order keeps the currency it was placed in.
   - **«Descrierea»** — the rich-text editor, one tab per language, both or neither: material, care,
     the supplier's drawing; tables and pictures are allowed («Imagine» inserts one from the gallery
     or an upload).
   - **«Mărimile și stocul»** — tick the sizes you sell among XXS · XS · S · M · L · XL · XXL · 3XL ·
     4XL; beside each ticked size, how many are left (empty: no limit; 0: sold out). «Mărime unică»
     for a buff or a sticker, with its own «Stoc» box. «Alte variante» for what is not a size — a
     colour, a children's cut — one per line, «Albastru: 5» or «Copii». Under them, the fold
     **«Tabelul de mărimi»**: up to four measured columns named in both languages (for example
     «Lățime piept (cm)» / «Chest width (cm)») and a number per ticked size; members see it as a table
     under the product. Under the sizes, **«Ghidul de mărimi (o poză)»**: the supplier's size-chart
     drawing, one picture per product, optional (upload, or «Din galerie»; it starts whole — crop
     only if it has margins; «Scoate» clears it). Members get a «Ghid de mărimi» button beside the
     size select that opens it large, with pinch-zoom; without a picture there is no button. Every
     ticked size is a variant members order; a size that has orders cannot
     be unticked — set its stock to 0 instead.
   - **«Publicarea»** — «Vizibil în magazin» when it should be on sale, and «Adaugă produsul».
   The new product opens on its own page, where **«Fotografiile»** is the first card: «Adaugă o
   fotografie» (upload with the quality choice, or «Din galerie»), choose the crop, «Adaugă
   fotografia» — up to eight. The first is the cover: it shows in the list and large in the members'
   zone, the rest as thumbnails under it. ↑ / ↓ reorder, «Scoate fotografia» removes one from the
   product (it stays in the gallery), «Înlocuiește sau decupează» puts another picture in its place
   or changes its crop. «Salvează» at the end of the page saves the four cards; a picture is saved
   by its own button at once. A product that has orders is archived rather than deleted («Șterge» /
   «Arhivează», the last card).
4. **Reorder the products.** On «Produse», ↑ / ↓ beside each product; the members' zone shows the
   same order. Each row says the price, the sizes with their stock, how many pictures and how many
   orders it has, and whether it is visible.
5. **Run the orders.** «Magazin» → «Comenzi»: filter by state and product, «Marchează plătită» when
   the money arrives (the member gets an email while «Îi scriem membrului…» is on), «Marchează predată» at the hand-over, «Anulează»
   before the hand-over (the stock goes back). «Descarcă CSV» downloads the filtered list. The
   Organizer reads every tab and the CSV and changes nothing.
6. **Give the shop to the colleague who runs it** (optional, §687). On «Echipa», on that
   colleague's row, after the role: tick «Gestionează magazinul» and confirm. They find the shop
   under «Magazin» in their top bar from the next page they open, and do steps 2–5 themselves —
   whatever their role: a volunteer, a Redactor, an Organizer or a Tehnic. They never see the
   members' addresses (only the Organizer and the Administrators do, by role); an Administrator
   needs no tick — the role includes it. Untick it to take it back; a colleague made a member
   loses it by themselves.
7. **Type in the orders collected outside the site** (`DECISIONS.md` §690) — a supplier's sheet,
   say. Each person in it needs an account on «Echipa» first (a member, or a colleague); then,
   on «Magazin» → «Comenzi», the fold «Adaugă o comandă pentru un membru»: the member from the list, the
   product and its size (a sold-out one is offered greyed), how many, a note if any, and two
   ticks — «Trimite-i membrului emailul de confirmare» (off: the member gets no email; not drawn at all while the
   «Setări» switch is off) and
   «Marchează direct ca plătită» (for a row already paid: the order lands as «Plătită», with the
   «plătită» email only if the first tick is on). The club's own «Cine primește comenzile» mailbox
   is never emailed for an order the club typed itself. One row at a time, checked by the person
   typing it; the order takes from the same stock as a member's own and shows in the member's
   «Comenzile mele» like any order, marked «adăugată de club» in the list and «club» in the CSV's
   column «Adăugată de». Whoever runs the shop may do it: an Administrator, or the colleague given
   «Gestionează magazinul» in step 6.

**Member levels** (optional, any time; `DECISIONS.md` §811, amended by §817). A level is the staff's own label on a
member, and its one use is to decide **which member sees which discount code**. An Administrator **names the levels**
on «Pagini» → «Membri» → «Niveluri de membru» (a name in both languages, a note for the administrators in both
languages — or in neither — the order in «Poziția», «Ascuns» for a level no longer given) and presses the one
«Salvează toate nivelurile»; **gives each member one** on «Echipa», in «Nivel» on the member's row — chosen in the same
step when adding one person (under the role «Membru» in «Adaugă o persoană») — or one for all
the people added at once in «Adaugă mai mulți membri»; and **says who each code is for** with the chips «Pentru cine e codul» in
«Coduri de reducere»: «Toți membrii» (members with or without a level) or one or more levels, chosen on every code — a new
code starts with nothing ticked and is not saved until one is, and «Toți membrii» cannot be ticked together with a level
(§811, amended by §828). Every code's line says «Pentru: …». The codes saved before the choice was explicit read as «Toți membrii».
**The zone's tabs and where it opens (`DECISIONS.md` §715, amended).** The members' zone opens on **«Alergări»** — the address
`/zona-membri` (`/members-area`), the sign-in's landing and the members' page's button — then **«Coduri de reducere»**
(`/zona-membri/coduri`) and **«Magazin»** (`/zona-membri/magazin`, drawn only once the notice names the shop). The old
`/zona-membri/alergari` still works: a permanent redirect to the zone. Nothing to set up. In the zone's «Coduri de reducere» a member then sees the
codes for everyone and those for their own level; a member with no level sees the codes for everyone alone. **No
member sees their level, and no visitor sees the levels:** the zone draws no badge, the public «Beneficiile membrilor»
page has no section of levels, and no code card says why it is there. Only the administrators see a level, on «Echipa»
and in the editors. A level is never a permission: it opens and closes nothing, and the shop does not read it. (The
`glyph` column of the levels is a leftover of the first version, no longer shown or edited; a later contract
migration drops it.)
The privacy notice's template names the level among what the club keeps about a member (section 12): approve the notice
from the new template on production, a lawyer reading that clause first, before giving members levels; the clause says only the
administrators see the level (§817), so a notice approved from the first version of the template, which also named the member, is
approved once more. An Administrator
or a colleague who opens the zone sees every code, so they can check what the club has; a member sees the codes for
everyone and for their own level.

## 44. Voluntari — register the people who help at a race

The event's volunteers (`DECISIONS.md` §754) are built and closed: no event page offers «Vreau să fiu
voluntar» until the steps below are done. Since §768 the form is a **page of its own**, `/ro/evenimente/<slug>/voluntari`
(`/en/events/<slug>/volunteers`); the event's page keeps only one line, «Căutăm voluntari: …», and one button to it. A volunteer is not a registration — no place of the race, no
declaration, no row on the public list, no account — and the Organizer and the Administrators are the
only ones who see the names, addresses and telephone numbers.

1. **Define the roles.** The event's editor → the card **«Voluntari»** → «Roluri» (one form for every role, §791): each
   role is **one line** — «Nume (RO)» and «Nume (EN)» (both or neither, like every text the club types), «Câte persoane»
   (or the tick «Nelimitat»), «Categoria» and «Poziția» — and the **empty line at the end** of each category («Rol nou»)
   adds a role when you type its names. Change as many roles as you like, then press **«Salvează toate rolurile» once**: it
   saves every change together, or — when one line is wrong — none of them, the sentence naming that role and its category
   («„Punct de apă” din „Traseu”: lipsește numele în engleză»), with everything you typed still in the boxes. The role's
   **«Mai multe»** holds «Descrierea rolului» — what the person does, where they stand, from what hour — written in the same
   editor the pages use, one tab per language (Română | English), both languages or neither (about 2000 characters
   of words each; lists and paragraphs, no tables or pictures; `DECISIONS.md` §765) and the band's colour.
   **«Tradu cardul: RO → EN»** at the top of the card fills every English name and description from the Romanian ones in one
   press, and «Tradu din română» under an English box does the one box (both greyed, with the steps, until the translation
   key of `/admin/tasks` is set). The description is read under the
   role's tick on the public form (folded «Detalii» when long), beside «Mai multe» on the card, and — in plain
   words — in the agreement's «Ce presupune rolul», its PDF and the emails.
   Roles belong to **one date**: a weekly run's dates, and a copy of an event, start with none (the event's JSON file carries them, step 9). Roles may be grouped in **categories**, each with a contact person: step 9.
   **«Poziția»** sets the order inside a category, from 1: type the place you want, the others make room (a role you did not
   touch keeps its place); a role moved to another category goes to the end of it unless you type a place other than the number the box showed.
   The save writes only the roles **you changed** on the page you were looking at: if a colleague saved while your page was open,
   their roles and their order stay as they left them, and a role you changed that they changed too (or deleted) is refused by
   name — «altcineva a schimbat rolul între timp; reîncarcă pagina» — with nothing saved. A role
   with people on it — cancelled ones too — cannot be
   deleted: move them to another role or delete them first (**«Șterge rolul»** on its line asks first and is its own press, not part of the save). An event's volunteers are not accounts:
   whoever works the race-day desk also needs an account on «Echipa», with the role Voluntar (§34) — the
   staff role of the same name, which this card neither gives nor needs.
2. **Approve the privacy notice that names volunteers** — before the form can show. `/admin/legal` →
   the «GDPR» card → «Regenerează din șablon» → confirm. Section 5 gains the volunteers' paragraph (what
   an offer keeps, why — consent for the public form, the club's legitimate interest for a person an
   organizer enters — who sees it) and section 7 the period: **30 days after the event's start** (an offer
   entered after the start, 30 days after its entry), then the maintenance job deletes the offers. A lawyer should read both. Open the draft, fill in what is
   left, «Salvează ciorna», «Aprobă și publică». Until a notice naming `{{volunteers}}` is in force in
   **both** languages the page shows no form and a post is refused; `/admin/tasks` shows the row
   «Nota de confidențialitate: voluntarii evenimentelor» while an event ahead takes volunteers. Your
   own list on the card works without it. **Since the volunteer agreement (§758) the same paragraph also
   names its acceptance** (`{{volunteerAgreement}}`: the version, the moment, the way, the text's
   fingerprint, the age statement, the PDF on the receipt and the link's email): approve this notice from
   the template **in the same sitting as step 3**. A notice approved before that names `{{volunteers}}` only,
   and until one naming both is in force in **both** languages the form, «Trimite linkul contractului» and
   «Semnat pe hârtie» wait; `/admin/tasks` shows the row «Nota de confidențialitate: contractul de
   voluntariat» meanwhile. **Since §765 the paragraph also names what a volunteer says about themselves**
   (`{{volunteerProfile}}`: the age, the sex, the city, whether they have volunteered before, their own claim to belong to the club's group and,
   only while the club gives T-shirts, the size): approve the notice from the template again, in the same sitting. Until a notice that names it is in
   force in **both** languages the public form stays as it was — «Am cel puțin 18 ani», no age, sex, city or size — and nothing of it is
   kept; `/admin/tasks` shows the row «Nota de confidențialitate: ce spun voluntarii despre ei» and the card says so in a line. A lawyer reads whether the
   sex, which the registration form also asks, needs more than the purpose written there.
3. **Approve the volunteer agreement — a lawyer reads it first** (`DECISIONS.md` §758). `/admin/legal` →
   the card «Contract de voluntariat» → «Regenerează din șablon» → confirm (or the one press that approves
   every text still missing). The platform's text says, in plain words, that the help is unpaid and no
   employment, what the volunteer does (the role's tasks, the organizers' instructions, safety and the
   event's rules, the participants' data kept confidential, telling you when they cannot come), what the
   club does (information about the role and its risks, the means, a contact on the day, a volunteer
   certificate on request), that either side may end it at any time, a pointer to the privacy notice, and
   Romania's volunteering law, **Legea nr. 78/2014**. The person, the role and what it asks, the event, its
   date and place fill in by themselves when somebody accepts; only the club's four facts are left to
   type. The lawyer checks it against the law: the written form and whether an electronic acceptance is
   enough, the age (the platform takes volunteers from **14 years**; under 18 a parent or guardian accepts the same
   text too — step 8, whose clause the lawyer reads here as well), the role's description as the task sheet, insurance, and a register of volunteer
   agreements. The platform deletes the volunteers' rows, the acceptances with them, 30 days after the
   event; whether the club must keep a record of the agreements longer, and how (a narrowed acceptance
   record, or an archive copy to the club's mailbox as the declarations have), is the owner's and the
   lawyer's question, to settle before the text is approved — until then the text promises only what the
   platform does: the volunteer's copy by email, and the proof kept for as long as the privacy notice says.
   Approve the notice of step 2 in the same sitting. Until an agreement is in force in
   **both** languages the page shows no form; `/admin/tasks` shows the row «Contractul de voluntariat»
   while an event ahead takes volunteers. A public copy of the text in force, its blanks as dots, is at
   `/ro/contract-voluntariat` and `/en/volunteer-agreement`.
4. **Take volunteers on the page.** The same card → tick «Primește voluntari pe pagină» (a real tick box: press the row, the box fills). The card says in a
   line whether the form is on the page now and, if not, which of the conditions is missing: the event
   takes volunteers, the event is published and not for the members alone (the form is public), the
   event is not cancelled or over, a role still needs people, the notice describes them, a volunteer
   agreement is in force, and the notice describes its acceptance. While they all hold, the event's page says «Căutăm voluntari:» and the names of the
   roles that still need people, with the button «Vreau să fiu voluntar» (unless you unticked «Arată butonul …», step 12); the page it opens — «Vreau să fiu voluntar la …», the event's date and
   place, the roles with their descriptions and how many places each still has — asks the name,
   the address, the telephone number, «Ce ești dispus(ă) să faci» — one box per role that still needs
   people, as many ticked as the person would do, at least one (§761) —, an optional
   message, the consent tick, «Am citit și accept contractul de voluntariat» (linking the text in force)
   and — once the notice of step 2 names them — «Data nașterii» (the registration form's own box, typed day first: the age on the day of the event, the gun's day when the race has one, must be 14 or more, with a parent or guardian under 18; it replaces the tick «Am cel puțin 18 ani» and, since §773, the old «Vârsta»), «Sex», «Orașul», the optional ticks «Am mai fost voluntar în trecut la alte curse»
   and «Fac parte din grupul …», behind the same anti-bot checks as the registration form. Under the roles' list the form says, kindly, that a person may be asked to cover another responsibility and will be contacted (§773).
   The button on the event's page opens this page **in a new tab**. **«Arată public câți voluntari mai sunt necesari»** (a third tick on the card, **off by default**, one press like the other two)
   decides whether the page tells each role how many people it still needs («mai sunt necesare 3 persoane») or shows no number at all: leave it off unless you want the number public —
   the card always shows «N din M». **Approve the privacy notice from the template once more** (§773): its volunteers' paragraph now says «data nașterii» where it said the age; until then the notice in force keeps saying «vârsta» beside the new box's name. A volunteer entered before this release keeps the age they had (no date); typing a date on their row replaces it. The page answers **404** while the form could not be sent —
   the same conditions as the line above — never a form that cannot work, and after a send it says «Am primit oferta ta» on that page, with a toast;
   it is never in the sitemap or a search index, like the registration page. **«Oferim tricouri voluntarilor»** (a tick on the card, off by
   default, one press like «Primește voluntari pe pagină») adds «Mărimea tricoului» to the form and to every row; the club gives no T-shirts today.
5. **Answer the offers.** Each sign-up is «Înscris», with **no role yet**: it waits under **«De repartizat»**
   at the top of the card, with the roles the person ticked as chips. The person gets one email, «Ți-am primit
   oferta de voluntar», with nothing to press and the agreement they accepted attached as a PDF, and each
   Organizer, Administrator and Superadministrator gets a notice with who and which roles they offered for
   (never the address or the number). **Give each person a role**: on a row under «De repartizat», «Dă-i
   rolul …» beside each role they ticked (with how that role stands, «Sosire · 0 din 1»), or «Alt rol» →
   «Dă-i rolul ales» for another role of the event; the person gets a short email naming it. A person who
   already has a role may be given more («Dă-i și rolul …», §837 — they count in each role's «N din M»), each
   role held is a chip with «Ia-i rolul …», and the whole set is ticked in «Modifică» → «Rolurile date» — the
   email follows, naming every role that stands, and a corrected address or a reopened person is told the
   roles again. On the card: «Confirmă» when you have spoken to the person, «Anulează», «Modifică» (the roles ticked,
   the roles given — none ticked takes them all back — and your own note, never shown publicly), «Șterge
   voluntarul» (the address and the telephone number go with it). «N din M» beside each role counts only the
   people **given** that role («Înscris» and «Confirmat»); the page stops offering a role once it has them.
   A role may also have **no number** (§784): tick «Nelimitat» on its line (§791) instead of typing
   «Câte persoane» — the number box goes while the tick is on. Such a role reads «3 · fără număr» on the card, is never full, is always on the event's page and
   on the volunteers' page, and the page never says a number for it («mai sunt locuri», even with the counts on); the card's closed line counts only the roles with a number
   («0 din 10 + roluri fără număr»), and «Câte ecusoane» starts it at the people you gave it.
   «Adaugă un voluntar de mână» enters a person yourself — tick what they would do, and give a role if you
   already know it; a role may take more people than it asked; the age, sex, city and ticks are optional there (an age below 14 is refused, and one of 14–17 asks the parent's name, step 8), and drawn only once the notice of step 2 names them.
   A row shows «A mai fost voluntar» and «Din grupul …» as small chips and the rest in one line. «Descarcă CSV» downloads the list, grouped by
   the role given, with a column of the roles each person offered for. A role somebody was given or ticked
   cannot be deleted until you change their roles.
   Each person's row says where they stand with the agreement: «Contract acceptat» (with the version, the
   way and when, and «PDF contract» for their copy) or «Contract neacceptat încă». For a person you entered
   by hand: **«Trimite linkul contractului»** emails them the agreement and a single-use link to accept it
   (valid 14 days; a new press sends a new link that replaces the old), or print **«PDF de semnat»** — the
   agreement filled for them, with the volunteer's and the organizer's signature lines — let them sign it
   at the desk, keep the sheet, and press **«Semnat pe hârtie»**, which records the version in force and
   your name as the one who recorded it, and emails the person their copy. While nobody gave the person a
   role, the agreement names the roles they offered for: the platform's text says so in its own sentence
   («Rolul îl stabilesc organizatorii dintre cele pentru care voluntarul s-a oferit — …»); a version approved
   before it has room for one role, and names them there, «în rolul Masă, Traseu». Approve the agreement
   again from the template (`/admin/legal` → «Contract de voluntariat» → «Regenerează din șablon», a lawyer
   reading the two new sentences first); `/admin/tasks` carries the row until then. If a new version was approved,
   or the person's role or ticks changed, after you printed the PDF, the record is refused: print it again and have
   the new sheet signed. «Link trimis» on the row means a link is live in their mailbox; a message the
   provider refuses for good leaves the row «Contract neacceptat încă» again.
6. **A person who asks for their data** is found by address on «Toate datele unei persoane»: the offers
   are listed there with every column, and deleted from this card.

7. **Print the volunteers' badges** (§764). The «Voluntari» card → **«Ecusoane pentru voluntari»** opens a
   page of its own for the event, for the Organizer and the Administrators. A badge is a small, long strip
   — 90 × 35 mm (16 on an A4 sheet) or 100 × 40 mm (14), or your own width × height in whole millimetres,
   60–200 by 30–100 — with the club's logo, the event's short title, «VOLUNTAR», the role on its coloured
   band and a white space with «Nume:» and one faint line: **no name is printed**, the volunteer writes it
   with a marker, so the file holds no personal data.
   - **«Cum arată ecusonul»** — the designer, with its preview: the size, the header (the club's blue, a
     colour or a picture), «VOLUNTAR» and the short title in Română **and** English, the writing area, the
     coordinator's telephone (the club's number, with its label in both languages) and the cut marks.
     «Salvează ecusonul» keeps it on the event — on this date: each date of a series has its own badge — and
     the event's JSON file (§751) carries it too. Under 35 mm tall the small words come out very small.
     Two optional sections, each with its own tick (§776): **«Text liber»** — one small line of your own words,
     in Română **and** English, at most 60 characters, centred under the role's band (a rule, a zone, a
     message: the same on every badge, never about a volunteer) — and **«Spațiu pentru marker»** — a second
     white area beside «Nume:», blank on paper, with an optional short label in both languages (at most 20
     characters, for example «Tură» or «Zona») and a faint line to write on. The preview shows both as you
     type. A badge that is too short for everything you ticked is refused when you save, with a sentence
     saying what does not fit and how tall it must be: the free-text line and the coordinator's telephone
     together need a custom size at least 34 mm tall; both ready-made sizes (90 × 35 and 100 × 40 mm) take everything.
   - **A role's colour** is part of the role: «Mai multe» on its line in the card (saved with «Salvează toate rolurile»), or
     all the roles at once under «Culorile rolurilor» on the badges' page. «Portocaliul clubului», one of
     the palette, or «Altă culoare» typed as `#rrggbb`; it is kept only when white or black text reads on
     it at a contrast of 4.5 to 1, and the page says each role's contrast in words. A colour already kept is
     not checked again, only one you change.
   - **«Tipărire»** — «Câte ecusoane» per role (it starts at the people the role needs), «În plus» for
     spares, «Ecusoane fără rol» for whoever comes without one, the language the badges print in, then
     **«Descarcă ecusoanele (PDF)»**: at most 300 of a pile and 1 000 in a file; a box you empty means none
     of that pile, and a number the file cannot take brings you back to the page with the reason. Print at
     100 %, cut along the dashed lines.

8. **Volunteers from 14, with a parent's or guardian's agreement** (`DECISIONS.md` §768; the owner, 2026-10-14: «voluntarii
   trebuie să aibă cel puțin 14 ani, nu 18»). The age is one constant of the platform, `VOLUNTEER_MINIMUM_AGE` = 14 (no club
   setting: a different number is Legea nr. 78/2014's question and one line of code). A person of 14–17 is taken **only with a parent or
   guardian who accepts the same agreement in their own name**; an adult goes alone, as ever. **Until both texts below are in force in
   both languages, the club takes nobody under 18**: the form refuses a typed age under 18 with a sentence that says so, the
   organizers' entry refuses it too, and `/admin/tasks` shows the row «Textele pentru voluntarii sub 18 ani».
   - **Approve the two texts again from the platform's templates, a lawyer reading them first** (`/admin/legal` → «GDPR» and «Contract de
     voluntariat» → «Regenerează din șablon» → confirm). The notice's volunteers paragraph now names minors, the guardian's name and email
     (`{{volunteerMinors}}`), why they are kept (to ask the guardian's agreement) and that they go with the volunteer's row, 30 days after the
     event. The agreement gains four sentences that name the guardian (`{{volunteerGuardian}}`) and drop whole for an adult: the guardian's
     consent by accepting this same text in their own name — and that the minor is confirmed only after it —, activities suited to the age and no
     night or dangerous posts, the guardian's data, and how the guardian accepts. **For the lawyer, not decided here:** Legea nr. 78/2014 has its
     own rules on the age and the consent of minors who volunteer — whether 14 is the right floor, whether a parent's typed name is the consent form it
     asks, what «activități potrivite vârstei» must exclude, whether the club must keep the guardian's consent beyond the 30 days, and whether the
     guardian, who is not on any list, is told enough by the email's footer (art. 14 GDPR).
   - **What a person of 15 sees**: on the volunteers' page, as soon as the age typed is under 18, the block «Dacă ai sub 18 ani» — «Numele
     părintelui sau tutorelui», «Emailul părintelui sau tutorelui» and the tick «Părintele sau tutorele meu știe și e de acord» (always shown without scripts,
     the server asks them of a minor only). Sent, the offer is «Înscris» and the parent gets an email with a **single-use link** (valid 14 days, hashed at rest;
     opening it changes nothing) to a page with the agreement filled for the volunteer, where they tick, type their name — the acceptance — and press
     «Îmi dau acordul». The volunteer then gets their copy again, with both acceptances on the PDF.
   - **On the card**: a minor shows «Acordul părintelui lipsește» until the parent accepts («Link trimis părintelui» while a link is live,
     «Acordul părintelui primit» after), with the parent's name beside the age. **«Confirmă» is refused** with that sentence until the parent has accepted.
     «Trimite linkul părintelui» sends the email again (only with an address); **«PDF de semnat de părinte»** is the sheet for the desk — the volunteer's line
     and the parent's — and **«Acordul părintelui pe hârtie»** records that the parent signed it (after a question), naming you; the sheet is kept
     by the club. A volunteer entered by hand under 18 needs the parent's name (the address only if you have it: the consent may be on paper); a
     person's age changed to 18 or more clears the parent's data. The CSV and «Toate datele unei persoane» carry the parent too.
     A person already «Confirmat» cannot be changed to an age under 18 in one save: the card says «Acordul părintelui lipsește», and you move them
     back to «Înscris» first, so no minor stays confirmed without the parent. A parent's address that is the volunteer's own mailbox is no refusal
     (a family on one address), but the row says «Aceeași adresă ca a voluntarului», so your «Confirmă» is the check. Once the parent accepted,
     the PDF shows two signers, each with their own version and fingerprint, which may differ when the club approved a newer text between.
   - **A parent's own request to see or erase what is kept** (art. 15 and 17 GDPR): «Toate datele unei persoane» finds a row by the **volunteer's**
     address, never the parent's, and the parent's name and address live only on the minor's row (30 days after the event, they go with it).
     So for a parent's request, find the minor's row on the event's «Voluntari» card (the parent's address is on it, and the CSV lists it), read or
     export it from there, and erase by deleting the row — that is the manual route; no tool searches by a guardian's address, because the platform
     keeps no list of guardians (a table of them was refused, `DECISIONS.md` §768).

9. **Group the roles in categories, and name a contact person for each** (`DECISIONS.md` §774; the owner, 2026-10-14: «Pentru „ce sunt
   dispus să fac” trebuie să am categorii cu sub-categorii … Toate astea configurabile», and «trebuie să fie o persoană de contact pentru
   voluntari» — «the contact person for each category will be established later»). No category is needed: an event with none lists its roles as
   before.
   - **«Categorii»** — the card «Voluntari» → the fold «Categorii» → «Adaugă o categorie»: the name in Română **and** English (both or neither;
     «Copiază și tradu tot» fills the English one), for example «Start / Sosire» and «Traseu»; at most 12 on an event, a name once per event.
     ↑ / ↓ set the order the card and the page list them in; «Modifică» renames; «Șterge categoria» asks first and is **refused with a sentence while
     any role sits under it** — move or delete the roles first.
   - **«Categoria» of a role** — each role's line (and the empty line that adds one) has a choice: one of the categories, or «Alte roluri» (no category; every
     role from before the categories is there). **The same role name may stand in two categories** («Direcționare» under «Start / Sosire» and under «Traseu»),
     never twice in one. A role is then told apart as **«Direcționare (Traseu)»** wherever it is named alone — the «Dă-i rolul …» buttons and select, the
     chips, the email «Rolul tău de voluntar», the CSV's role columns and the agreement's sentences; the badge's band shows the role only. The card lists
     the roles in a card per category (with its contact person under the title), in the category's order, «Alte roluri» last; «Poziția» orders a role inside its
     category; a role moved to another category goes to the end of it. **Filing a role that people already signed for under a category** (or moving it to another) changes the words it is named
     with, so the card adds a note on their rows — «the accepted text named other roles» — as renaming a role always did; **the signatures stay valid**.
     The same holds for a paper agreement already printed: rename or move a role or a category after printing and **print the agreement again** before
     «Semnat pe hârtie», because the sheet names the role with its category.
   - **On the volunteers' page** the roles show under a heading per category, in the category's order, each with its tick, description and count line
     as before; a category with no role still needing people is not shown, the roles under none follow under «Alte activități», and an event with no
     category shows no heading at all.
   - **«Persoana de contact»** on each category's own row: a name, a telephone number and an email, **each optional and empty when the category is
     made**, with a «Salvează» of its own — fill it in when the club knows who it is (the telephone is read as a Romanian number or with the country
     code, and must be written like a telephone number: words such as «în curând» are refused, a foreign or a landline number is not). The trail names the boxes that changed, never the words. Once set, the contact appears: under the category's heading on the volunteers' page,
     as one line «Întrebări? Ana Popescu · +40 712 345 678 · ana@…» with the telephone and the address as links; in the footer of the volunteers'
     emails — «Ți-am primit oferta», «Rolul tău» and the parent's request — the contact of the category of the role (or roles) concerned (each one
     with its category when the roles ticked sit under two); and on the
     badges: tick «Telefonul coordonatorului» in the badge's designer and leave the number empty, and each role's badge prints its category's
     telephone (a number typed in the designer wins on every role; a role with no number keeps the row blank, so every badge is cut alike). **Never in the CSV.** It is the club's own business contact, published by the
     club's choice, nothing of a volunteer's or a participant's: the privacy notice's template needs no change — but name only a person who agreed to be on a public page,
     since the number may also be printed on badges and travels in the event's file.
   - **In the event's JSON file** (§751) the categories (with their contact) and the roles travel as the file's own key `volunteers`: their words, how many each
     needs, the description, the colour and the category by its place in the list — never a person, an id or the tick «Primește voluntari». «Ca eveniment
     nou» writes them into the new draft through the card's own rules (an entry the card would refuse is skipped); an import over an existing event leaves
     its roles and categories as they are, and the preview says so (a skipped entry is counted in words, never silently).
   - **Local and QA databases** get two categories with the owner's example roles on the sample race (`yarn db:seed`; never production, `DECISIONS.md` §30).
10. **Choose who may offer, and invite people by email** (`DECISIONS.md` §820; the owner, 2026-10-19: «invite only volunteer … Brașov Runners only volunteers»). The card
    «Voluntari», under «Primește voluntari pe pagină» (shown only while it is ticked), has the choice **«Cine se poate oferi»** — three radios and one **«Salvează»**:
    - **«Oricine, de pe pagina evenimentului»** — as in step 4 (the default, and what every event was).
    - **«Doar membrii clubului (conectați în zona membrilor)»** — the event's page says «Căutăm voluntari dintre membrii clubului: …» and the button opens the
      volunteers' page, which shows the form only to a signed-in member (an account of the members' zone, or any colleague's): the name and the address come from the
      account, the address is read-only and «Fac parte din grupul …» is ticked and locked. Anyone else reads «Voluntarii pentru acest eveniment sunt membrii clubului — intră
      în zona membrilor.» with the sign-in button — which brings the member back to this page, not to the members' zone — and a post from a stranger is refused by the server,
      not only hidden. A member needs an account first («Echipa» → «Adaugă mai mulți membri»).
    - **«Doar cu invitație de la club»** — the event's page says nothing about volunteers and the volunteers' page answers 404 for everyone without an invitation's link (a
      made-up link too). The fold **«Invitații»** (it appears with this choice, and stays while any invitation exists) takes **«Adrese (una pe rând)»** — up to 50 at a time — an
      optional club's line, up to 500 characters, written in **both languages or neither** on the two tabs **«Mesaj (română)»** and **«Message (English)»** (each half of the
      email says its own, «Tradu din română» fills the second; one language alone is refused) and the email's language, and **«Trimite invitațiile»** sends each address one email,
      «Te invităm să fii voluntar la …», with the roles that still need people, the event's facts and the button **«Mă ofer voluntar»** — a personal link that opens the form
      with the invited address locked and works **once**. Nothing is sent while the offer itself is closed (the card's line says why: not published, no role needing people, the
      notice or the agreement not in force) — a link would lead to a 404. An address that already has an invitation is not sent a second one, one that already offered is
      skipped, and a withdrawn one comes back on the same row. The list under the box shows each address with «Trimisă», «Folosită», «Retrasă» or «Expirată» (the event itself is over or called off: a race
      moved to a later day keeps its links, whatever date they were sent under) and, on an open one, **«Retrimite»** (a new email; the old link stops working at once) and **«Retrage»** (the link then says «Clubul a retras invitația.»), each asking first.
      Organizers and Administrators send; nobody else sees the fold. An invitation holds no role's seat and no place of the race.
    - **The choice is for one date** — the other dates of a series keep their own (the card's form writes this event, never the series).
    - **Changing the choice later deletes nothing** — no sign-up, no invitation. A link already sent keeps working in every choice until it is used; «Oricine» → «Doar cu
      invitație» closes the public form at the next read. The choice travels with a copy of the event, with every date of a repeat and with the event's JSON file (not the tick
      «Primește voluntari», which a copy starts without).
    - **The privacy notice** — its volunteers' paragraph has one more sentence for the invitation by email and the member's account (`{{volunteers}}`, no new marker): approve the
      notice from the template in the next sitting, a lawyer reading that sentence first — it now names the legal basis (the club's legitimate interest in inviting its volunteers,
      art. 6(1)(f)) and the source of the address (the person or the club's contacts, art. 14(2)(f)). The invitations are deleted with the offers, 30 days after the event's start.
    - **One person's invitations** — the person's data screen («Toate datele unei persoane», Administrator) lists the invitations sent to an address, with the club's line in both
      languages, and **«Șterge invitațiile de voluntariat»** erases them on request (art. 17), asking first; the offers and registrations stay.

11. **Show the volunteers on the event's page — or keep the list private** (`DECISIONS.md` §821; the owner, 2026-10-19: «private vs public lists of volunteers»). By default the
    list of volunteers is the team's alone (the card, the CSV, the badges), exactly as before. The card «Voluntari» has one more tick, under «Arată public câți voluntari mai sunt
    necesari»: **«Lista voluntarilor e publică pe pagina evenimentului»** (off by default, one press like the others, audited). Three things must hold before a name shows:
    - **The notice describes it.** Approve the privacy notice from the template once more (`/admin/legal` → the «GDPR» card → «Regenerează din șablon», a lawyer reading the
      volunteers' paragraph first): it gains a sentence with the marker `{{volunteersList}}` — what the page shows (the name and the role given, nothing else), for whom (only a
      volunteer who ticked), the basis (their consent, withdrawn by writing) and until when (the offer's deletion, 30 days after the event's start). Until a notice naming it is in
      force in **both** languages the page shows no card and the form asks no tick; `/admin/tasks` shows the row «Textul pentru lista publică a voluntarilor» while an upcoming
      event has the list public, and the card says so in a line with a link to «Documente legale».
    - **The volunteer ticks.** The volunteers' page then has one more optional box, **«Vreau să apar pe lista publică a voluntarilor»** (off by default, with one line of help), in every
      way in (anyone, a member, an invitation). For a person you enter yourself («Adaugă un voluntar de mână», «Modifică») the same words are a box, **«Vrea să apară pe lista publică
      a voluntarilor»**: tick it only when the person told you they want to, preferably in writing — your name stays in the log, as for a paper agreement. A tick can always be cleared;
      it cannot be recorded while the notice is silent. A row with the tick says «Vrea pe lista publică» (the wish; the page names the person only once confirmed, under the conditions above). A volunteer who ticked under a notice from before this one is never named, and neither is a volunteer under eighteen (counted only: the guardian's acceptance covers the agreement, not a public name).
    - **You confirm them.** The page names only **«Confirmat»** volunteers; the others are not on it at all.
    What the visitor sees: the card **«Voluntarii (N)»**, a fold **closed on arrival** like «Condiții de participare», after «Căutăm voluntari» and before the rules — the names of the
    volunteers who ticked, each with the role you gave them, and «și încă N voluntari» for the rest of the confirmed. Nobody ticked yet but the page is asking for volunteers: the card is
    the one sentence «Echipa de voluntari se formează.»; the offer closed and nobody ticked: no card. Never an address, a telephone number, a city or a date of birth. The card goes 30
    days after the event's start, when the maintenance job deletes the offers, and at once if you untick the box, switch «Primește voluntari» off or the notice stops describing it.
    The tick travels with a copy of the event, every date of a repeat and the event's JSON file (never a volunteer, and not «Primește voluntari»).
12. **Take volunteers without showing the button — send the link yourself** (`DECISIONS.md` §835; the owner, 2026-10-20: «I want to be able to allow registration for volunteers but I want to
    control if the button is visible on the website or not»). «Primește voluntari» still opens the sign-up; one more tick on the card, **«Arată butonul „Vreau să fiu voluntar” pe pagina
    evenimentului»**, decides whether the public site **says so**. It is **ticked by default**, so every event keeps looking as it did. Untick it (one press, audited, nothing else changes) and:
    - the event's page no longer draws «Căutăm voluntari: …» with its button, nor the sentence «Echipa de voluntari se formează.» in the volunteers' card; nothing else on the site links to the page;
    - the volunteers' page **keeps working** for whoever has its link, under the same «Cine se poate oferi» (anyone; the club's signed-in members; only with an invitation's own link), and is
      still never in a search index or the sitemap;
    - the card shows the page's **link in Romanian and in English**, each in a box with «Copiază» beside it (shown while «Primește voluntari» is ticked): copy it and send it in the group chat or an email.
      The card's line above the ticks says «… dar pagina evenimentului nu trimite la ea: se ajunge la ea doar prin link». Every other condition of step 4 still has to hold, or the link answers «not found».
    The tick travels with a copy of the event, every date of a repeat and the event's JSON file (written only when unticked; a file without it means shown).

## 45. Clasament — put a race's results in the backoffice, and make them public only when the notice says so

A race's results (`DECISIONS.md` §808; the owner, 2026-10-17: «Aș vrea să pot pune și clasament la final după cursă») are
built in the backoffice and **closed to the public until the privacy notice describes them**. Only a **race** has results (a
group run and the other events have none; the page says so). The Organizer, the Administrator and the Superadministrator
enter them; **only the Administrator and the Superadministrator make them public**.

1. **Approve the privacy notice that names the results — a lawyer reads it first.** `/admin/legal` → the «GDPR» card →
   «Regenerează din șablon» → confirm. Section 4 gains two paragraphs where it said «Rezultate cu nume nu publicăm încă»:
   what the results show (the place overall, by sex and in the category, the race number, the time, whether the runner finished,
   dropped out, did not start or was disqualified, and the category — the sex and the age group on the race day, the Excel's own
   bands), that the name appears **only for those who ticked «Vreau să apar pe lista de participanți & rezultate»** (one tick for
   the list and the results, withdrawn the same way, and the name then leaves the ranking too), that everyone else is
   «Participant #numărul de concurs» without a name — **and so is anyone who registered under an older notice, which said «Rezultate cu
   nume nu publicăm încă», whatever they ticked** (the §421 rule the public list's states already follow: a tick given then agreed to a list,
   not to a ranking by name) — that the ranking closes with the public list in the same period, and where the data stays (section 7:
   three years from the race, with its registrations). The lawyer reads, first: the legitimate interest for the unticked rows
   (art. 6(1)(f)); naming the earlier registrants is **not** a default — it would be the owner's separate decision, asking them by email first.
   **Approve the terms from the template in the same sitting**: the older terms promised «te vom întreba separat» before a named result,
   and their sentence now says the ranking is published only after the race and only on the notice's terms, naming `{{results}}` too.
   Until a notice **and** terms naming `{{results}}` are in force in **both** languages, ticking «Clasamentul e public pe pagina
   evenimentului» is refused with a sentence and a link here, and `/admin/tasks` shows the rows «Nota de confidențialitate: clasamentul
   curselor» and «Termenii: clasamentul curselor». Entering, importing and ranking work meanwhile.
2. **After the race, open «Clasament» — or before it.** The race's editor → the card «Înscrieri» → «Clasament», or the registrations list with the race
   chosen (both links are drawn for a published race and for one that has started, before the start too; the page then says the race has not begun
   and lets you write from now on; a typed address works for any race). The page has a line for every
   registered runner who holds a race number — the checked-in first, then by number — with four boxes: **«Timp»** (`h:mm:ss`, `mm:ss` or
   `mm:ss.t`), **«Stare»** (Sosit, Abandon, Neprezentat, Descalificat), **«Timp cip»** (optional) and **«Notă»**. A line with every box empty is
   no result. The blank choice of «Stare» reads «Din timp (Sosit / Neprezentat)» because it is exactly that: a time typed with no state is
   «Sosit»; a note alone is «Neprezentat»; abandon, neprezentat and descalificat are written without a time. A number a **cancelled or
   expired** registration holds is refused («numărul aparține unei înscrieri neconfirmate»): a result is never filed under a cancelled
   person. When the desk changes a runner's number, the result moves with the runner.
3. **«Importă din CSV»** (the first card, closed): paste the text of a file or choose it — `număr, timp`, then the chip's time and a status
   if there are any, with or without a header row, separated by a comma, a semicolon or a tab; the status as its code or its word in Romanian
   or English. The rows read **fill the boxes and save nothing**; a number no registration holds becomes a new line under «Alergători
   neînscriși», with the name left for you to write (that card opens by itself). A file with a bad line is refused whole, naming the line.
   **A runner you type by hand and the public ranking.** Such a runner (no registration, so no form to tick) shows on the site as «Participant
   #număr» unless the person told you they want their name there. If they did, tick **«A acceptat să apară cu numele în clasament»** on their
   line and save: the ranking then shows the name you typed (only while a privacy notice that describes the results is in force). Tick it only
   when the person said so (for a minor, the parent or guardian) — the record keeps who ticked it and when, never the name, exactly as a paper
   declaration at the desk names the staff member who recorded it. A line shows under its boxes what the site will print for it («Pe site:
   Participant #număr» or «Pe site: cu numele»; the name needs a privacy notice that describes the results in force). Changing the name on a
   ticked line records the agreement again under whoever saves it, so write the new name only after the new person said so. A registered
   runner who takes the number later is named by their own tick alone. Taking the tick off takes the name off the next read. The tick needs a name written on the line (otherwise the
   save is refused), a CSV never carries it, a registered runner's line has none (their name follows their own tick on the form), and every
   role that may enter results may tick it.
4. **«Salvează tot clasamentul»** — ONE button for the whole page: it writes every line in one go or, when a line is wrong, none — the sentence
   names the runner and the problem, and every box keeps what was typed. A line you cleared (or left out) is a result removed. The places are
   computed on every save: overall among the finishers by the gun time, by sex, and in the category (sex and age band on the race day; ties share
   the place and the next is skipped); a runner without a sex or a birth date has no category, and nobody is guessed into one. A corrected
   answer or an erased registration changes the places at once: the page and the public read rank again from the live answers. A page opened before a
   colleague saved is refused («Altcineva a salvat între timp. Reîncarcă pagina…») rather than written over theirs. **«Șterge»** on a line is its own press and asks first.
   «Descarcă clasamentul (CSV)» is the file with the names as the backoffice sees them; the download is recorded in the trail, without a name.
5. **«Clasamentul e public pe pagina evenimentului»** (the Administrator's tick, with its own «Salvează», asks first): off for every event. It
   only works **after the race has started** (you may type the results before) and under the notice and terms of step 1. The public read —
   `readPublicEventResults` — shows a name **only for a registered runner who ticked, whose registration is confirmed, who is not a special
   guest the event hides, and who registered under a notice that described the results**; a runner the club typed by hand is named only while
   the staff's record of their agreement stands (step 3), and otherwise appears as «Participant #număr». **What the event's page shows, and when.** Under «Cine vine» a card **«Clasament»**
   (`#clasament`, open when the page opens) with one row per result: the place, the race number, the name or «Participant #număr», the time (the chip
   time in a line under it, when you typed one) and the category with the place in it; the runners who did not finish come last, with «Abandon»,
   «Neprezentat» or «Descalificat» and no place. A line says when it was published and until when it stays on the page (the day and the hour) — the same period as the public
   list, counted from the end of the race («Setări» → «Termene»). A visitor can tick a category or type part of a race number to narrow the table
   (the table shows every row without a script). The card appears **only while all of these hold** — the tick is on, the race has started, the notice and
   the terms in force name `{{results}}` in both languages, **the race's start hour was announced** (a race still saved with «Ora se anunță» has no
   start for the public pages, so it shows no «Clasament» and no chip, whatever the tick says), **at least one result is saved** and the period has not passed —
   and otherwise the page has no heading and no sentence about it at all. On the events listing, a finished race's card wears a **«Clasament»** chip that leads to it. Taking the tick off removes both at once.
   Not built, to be decided later: an email to each runner with their result, result columns in the registrations Excel, and a timing provider.
   **The race's editor reminds you:** once the race is over and the results are not public, its «De făcut pentru pagina evenimentului» lists
   «Cursa s-a terminat și clasamentul nu e publicat» (high, with a link to «Clasament»), until the period ends — and only for a colleague who may open
   «Clasament», and while the notice and the terms in force name `{{results}}` (before that, `/admin/tasks` says what is missing). A race over whose hour was
   never announced shows «Ora startului încă se anunță: clasamentul nu poate apărea pe pagină» instead, with a link to «Când și unde»: fill the hour in.
6. **What stays where.** The audit trail names the race number, the state and the times, never a runner. Erasing a registration leaves its result,
   nameless, with its number, its time and its overall place, and clears the category and the places by sex and by category that described the
   person, so the other runners' overall places do not move. The typed runners' names and their agreements go with the rows. **Three years after the race the sweep deletes the race's results with its registrations**
   (a registration held for a dispute keeps its result until the hold is cleared), as section 7 of the notice says; the results file you download is a
   copy the sweep cannot reach, so delete it within the same period. «Toate datele unei persoane» lists a person's results and its file carries them.
   The Excel of the registrations is unchanged.


## 46. Răspunsurile „Vin!” — let people say they are coming to a turn-up event, and show how many

The answer «Vin!» (`DECISIONS.md` §811; the owner, 2026-10-18: «how do I mark myself as "Going"?») is for the events people simply
turn up to — the weekly group run, and any hike, coffee or meetup saved with «Fără înscrieri». It is **not a registration**: it holds no
place, signs no declaration and makes no participant. It is **closed until the privacy notice describes it**, and it is a tick the club
turns on event by event. Three steps are the club's: the notice (1), the tick (2) and, for the «Vii?» email, the notice once more (7).

1. **Approve a privacy notice that names «Vin!» — a lawyer reads it first.** `/admin/legal` → the «GDPR» card → «Regenerează din șablon»
   → confirm. Four paragraphs gain the answer (the marker `{{rsvp}}` is the button's own name, „Vin!” / “I'm coming!”):
   - **section 4** — what the page publishes: how many come, and the name **only of those who ticked «Vreau să apar cu numele»**
     (consent, art. 6(1)(a)); everyone else is only counted; an answer is not a registration;
   - **section 5** — what is kept (the address, the name if written, the tick, the page's language, the notice's version, the moment),
     the one message with its two buttons («Da, vin» counts, «Nu vin» deletes), at most one every ten minutes per address, the links
     valid for that person only, once, until the event starts; the basis (the person's request and the club's legitimate interest,
     art. 6(1)(f));
   - **section 7** — thirty days after the event's end, seven days for an answer never confirmed, a cancelled event's at once, the
     remembered browser a year from its last answer;
   - **section 10** — the remembered browser's two cookies (see step 3): *strictly necessary for a function the person asked for*
     (Legea nr. 506/2004, art. 4(6)). **The lawyer reads that sentence first**, and the IP-free, tracking-free description of the two cookies.

   Until the notice in force names `{{rsvp}}` in **both** languages, no event page shows the box, the count or a sentence about it, and the
   service refuses an answer; the club's tick stays on in the editor, doing nothing. `/admin/tasks` carries the row «Nota de
   confidențialitate: răspunsurile „Vin!”» (open while an upcoming event is ticked and the notice is silent, done by itself the day a
   notice naming it takes effect), and `/admin/legal` says it in a line. **The terms do not change**: an answer buys, books and signs nothing.
   **The member mark** (`DECISIONS.md` §831) is a marker of its own, `{{rsvpMember}}` („BVR”), in section 4's «Vin!» paragraph — a person who ticks «Sunt membru al grupului …» (a claim the club does not check), or who answers from a member account, shows „BVR” beside the name they chose to show and is counted among «M membri» without a name — so until a notice that names it is in force in both languages the form has no tick, nothing is marked or counted, and `/admin/tasks` carries the row `rsvpMemberNotice`; an answer given before that notice is never marked (it agreed to a name, not to a mark). **A member whose answer is already counted** (given before the notice, or from the page or a remembered browser) is marked „Membru” by the zone only when the answer is made from the account, so they take it back and give it again from the zone; the notice carries its own «Temei pentru semn» clause, and a lawyer reads it with the sentence on the account's role. **A tick typed beside somebody else's address** is told to its owner: the «Da, vin» email and the page of its link say that the press shows the name with the mark, and the page then does not press itself.
2. **Tick the event.** `/admin/events` → the event → «Participare, înscrieri și regulament» → **«Acceptă răspunsuri „Vin!” din pagină,
   calendar și email»**. It is shown for a type that takes no registration (a group run) and for any other type saved with «Fără înscrieri»;
   any other mode writes it off. A weekly run's tick travels with the series (a «de acum încolo» save carries it to the later dates, a new
   date copies it), «Duplică» keeps it, and the event's JSON file writes it **only when it is on** (a file without it reads «off», and an older
   release still reads every file that has it off). **The answers themselves are never carried** by a duplicate, a repeat or a file.
3. **What a visitor sees.** On the event's page, where the registration card would stand, a fold **«Confirmă prezența (opțional)»** (`#vin`; named «Vii?» before §825, and «Vii?» is still the name of the day-before email question, step 7), closed like «Condiții de participare» with «Confirmă prezența (opțional) · N vin» (or «… · Tu vii ✓ · N vin», «… · Fii primul care confirmă» at zero) on its line; opened, it holds the sentence «Nu e o înscriere: ne ajută să știm câți venim.», the address, an optional
   name, the tick «Vreau să apar cu numele» and the button **«Vin!»** (the same honeypot, timing check and Turnstile as the «Anunță-mă» box). The
   page says one sentence whatever the address meant — «Ți-am trimis un email: apasă „Da, vin” ca să te numărăm.» — and the email brings the event's
   facts, the day as a calendar file, **«Da, vin»** and, under it, **«Nu vin»**. The buttons open `/vin/<link>` (`/en/coming/<link>`), whose GET only
   shows the event and one button: the press is a POST. In a browser the page presses that button by itself once (§812), so opening **«Da, vin»** is enough; a scanner that fetches the link without running scripts, and a browser without JavaScript, see the button and count nobody (a link sandbox that does run scripts can count the address; the person's own click then reads «Ești deja numărat», and «Nu mai vin» in the same email takes the answer back). A link works once: «Da, vin» for 48 hours (never past the start), «Nu vin» until the event starts (the event's start as it is then, so a moved event keeps its links). Inside the card, under the form, the fold **«Nu mai vin»** (an address; the link by email; it never says whether the address answered). Right under the card, a closed fold of its own, **«Cine vine (N)»** (`#cine-vine`, the same bar as a race's list; just «Cine vine» and «Încă nu a confirmat nimeni.» while nobody has) —
   the confirmed count and the names of those who ticked, «și încă N» for the rest — and in the event's facts the line **«N vin · vezi cine»**, a link that opens it (only while the event is still to be held).
   **The remembered browser.** The «Da, vin» (or «Nu mai vin») press also makes the browser *remembered* for a year: two cookies, `br_person` (a
   random secret, readable only by the server, its fingerprint kept) and `br_person_hint` (the masked address and the name, no secret). On any other event that
   takes answers the page then says «Răspunzi ca an…@gmail.com» and **«Vin!»** is one tap, counted at once, no email; **«Nu mai vin»** is one tap
   too, and **«Nu sunt eu»** forgets the browser. Without JavaScript the typed form stands. This is not a login and opens nothing else.
   **The name, any time (§827).** Once counted, a person shows or hides their name from the tick **«Numele meu apare la „Cine vine”»** — on «Tu vii ✓» in that remembered browser, in the members' zone's row, or on the page of the «Nu mai vin» link in the email (a POST that does not spend the link, so «Nu mai vin» still works from it); the notice's paragraph says so, and approving it again from the template (step 7's click) carries the sentence. **A lawyer reads that paragraph's «Debifat, numele rămâne în răspuns» first**: unticking hides the name but keeps it stored in the answer (so ticking again brings it back), until «Nu mai vin» deletes the answer or the 30-day sweep does — whether a name may be kept after the consent to show it is withdrawn (GDPR art. 17(1)(b)) is the lawyer's question, not decided here; approve the notice from the new template before relying on it. Every door shows the name the tick would publish (the box is prefilled and editable), so a name typed on the page with the tick off is never made public unseen.
   **From a calendar (§815).** For an event that offers the answer, the club's calendar feed, the event's `.ics` file and the file attached to the
   emails say **«Vin! → <the event's page>#vin»** and under it **«N vin până acum»** (nobody yet: «Fii primul care spune că vine.»). Google and Apple make
   the link tappable, and it lands on the «Confirmă prezența (opțional)» card — one more tap in a remembered browser, an email once in any other. A calendar cannot take the
   answer itself (a feed subscribed from an address is read-only in Google), so the link is all of it. The feed is made again with every confirmation or
   withdrawal, never at each poll; a file saved earlier keeps the day's number and a link that stays true. On the listing, a single date wears
   **«N vin»** (the people glyph), a 44-pixel link to the same card, once at least one person has confirmed; a series card never does, its dates do.
   Nothing to set up: all of it follows the tick and the notice, and says nothing for an event that does not offer the answer.
4. **What the club sees.** In the editor, under the registration card, a fold **«Răspunsuri „Vin!” (N)»** (read-only: no file, no button) lists the email, the
   name, whether the person asked to be named, confirmed or not, and when — **for the Organizer, the Administrator and the Superadministrator**; every other
   role sees only the counts. The preview before saving and `/previzualizare` show nothing of it.
5. **Erasing, and what the sweep does.** Thirty days after the event's end the answers go (seven days for one never confirmed; a cancelled event's at the next
   run; a remembered browser a year after its last answer). «Toate datele unei persoane» (`/admin/registrations/person`) lists a person's answers and
   browsers, counts them in the JSON export, and an Administrator can **«Șterge răspunsurile „Vin!” și browserele»** on request — one audit row with the
   counts, never the address.
6. **From the members' zone (§822).** In «Alergări» a signed-in member answers a run that takes answers with one press, **«Vin!»** (the account's address, counted at once, no email; the name only on their own tick), and the home page's and the event page's calendar links say «N vin» like the rest, except on a repeating run's card, which shows no count. **One step for the club:** approve the privacy notice again from the template (step 7's click), so it describes this answer; the gate stays the one for «Vin!» (§822), so nothing waits on it. **The zone opens on «Alergări»** (§715 amended): each run is a card with «Vin!» and, directly under it, **«Cine vine (N)»** open — the names of those who ticked «Vreau să apar cu numele» and «și încă N» for the rest, exactly what the event page's «Cine vine» shows and no more (§143, §812; being a member shows no extra name) — and the next run that takes answers is the first card, in the event listing's lead frame.
7. **The «Vii?» email (`DECISIONS.md` §818).** One step for the club: **approve the privacy notice again from the template** (`/admin/legal` → the «GDPR» card → «Regenerează din șablon», as in step 1; a lawyer
   reads section 5's two paragraphs first — the newsletter's, which now says the automatic question the day before, and «Vin!»'s, which says the subscriber's address is written as
   an unconfirmed answer when the question is sent and deleted at «Nu vin» or after 7 days). Until a notice naming `{{rsvpAsk}}` (and `{{rsvp}}`) is in force, in both languages, **nobody is asked**
   and the topic's box does not show in the pop-up or on the subscriber's page; `/admin/tasks` carries the row `rsvpAskNotice` while an upcoming event is ticked. The topic is named in the
   notice only through `{{rsvpAsk}}` (`{{newsletterTopics}}` leaves it out), so a notice approved before names nothing of it.
   After that: a newsletter subscriber who ticks the topic **«Întrebarea «Vii?» înaintea alergărilor»** (or «Toate noutățile») gets, the day before a ticked event, from 08:00 club time,
   one email «Vii mâine la …?» with the two buttons **«Vin»** (then «Da, vin» on the page that opens; counts them, no second email) and **«Nu vin»** (counts nobody, and the browser is not
   remembered) — once per event, never for an event ticked only on its own day, never to someone already counted, and not sent at all if it would arrive after midnight. It leaves
   by the newsletter's road, last in line, so it never spends the share kept for registrations' links. No organizer writes for the topic.
8. **How the «Vii?» question is sent (`DECISIONS.md` §823)** — three settings, each saved in the backoffice, none needing a deploy; the defaults are what step 7 describes, so nothing moves until the club changes one.
   - **When.** «Setări» → «Termene» → the fold «Înainte de start»: «Întrebarea „Vii?” pleacă înainte de start cu (zile)» — 0 to 7, **1** by default, and **0 means never** (the fold's closed line then reads «„Vii?” nu se trimite») — and «Întrebarea „Vii?” pleacă de la ora» — 0 to 23 on the club's clock, **8** by default (0 is midnight). The email leaves at the job's first run at or after that hour on that calendar day, and says the day in words («mâine», «poimâine», «peste 3 zile»; in the club's own words for the email it is the field `{rsvpAskDay}`, never a «mâine» typed by hand). The «Vin» button lives until the event's start, however many days ahead it went. Change it and a question already queued but not yet sent follows the new numbers at its send; one that no longer fits is dropped, never sent late.
   - **To whom.** «Setări» → «Emailuri» → «Cui îi trimitem întrebarea „Vii?”» — three radios: the newsletter's subscribers of the topic (**the default**), the people who answered «Vin!» at an earlier date of the same series (a weekly run's earlier Sundays; an answer is kept thirty days after its date, so about the last month), or both (one email each; someone on both lists is asked as a subscriber; a «Vin» pressed in a subscriber's question counts as an earlier answer only while that address still receives the topic, so someone who unticked the topic is not asked through this list). **The second audience is gated twice.** First, the privacy notice: approve it again from the template (`/admin/legal` → the «GDPR» card → «Regenerează din șablon»; a lawyer reads the new sentences in section 5's «Vin!» paragraph and section 7's line about refusals first). The marker `{{rsvpAskAnswerers}}` is the switch and it is silent in every notice approved before it: until a notice that names it is in force in both languages, nobody of that audience is asked, whatever the club chose, and `/admin/tasks` carries the row `rsvpAskAnswerersNotice` while the choice is ANSWERERS or BOTH. An answer given under an older notice is never asked again (it agreed to being counted, not to being asked). Second, each person: every such email carries **«Nu mă mai întreba la seria aceasta»**, a link to a page with one button (opening it records nothing; the press does, once). The link does not depend on the answer: it still works after «Nu vin» in the same email and after the event, until sixty days after the start. The refusal is kept as the address's canonical form and the series' key, nothing else, for as long as the series lives and a year after its last date; it holds for both lists, shows in «Date despre persoană», and is not erased with the answers (forgetting it would ask the person again; the links, which hold the address, are erased). «Date despre persoană» names the refused series by its type and the title the club wrote.
   - **Which events.** The event editor's «Vin!» block, under «Acceptă răspunsuri „Vin!”»: the tick «Trimite emailul „Vii?” înainte de această dată» — **on** by default for every event; unticked, that date is never asked (its «Vin!» still works). Its help says, in the club's own numbers, who gets the email, how long before the start and from what hour (read from «Termene» and «Emailuri», with a link to each), with 0 days it says the email is off and draws the tick disabled, and while the privacy notice in force does not describe the email (or, for the earlier answerers, that use) it says the email does not leave yet instead of promising it. It is carried by a series, by «Duplică» and by the event's JSON file (written only when off).
