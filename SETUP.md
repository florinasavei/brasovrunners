<!-- PROJECT_BASELINE: BR-V1.13-2026-09-02 -->

# Brașov Runners — Repository and Platform Setup

**Baseline `BR-V1.13-2026-09-02`** · versioned with the whole set · [changelog](./CHANGELOG.md)


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
staff CMS/backoffice -> Auth.js + Zitadel
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
- a ROTLD-accredited registrar account for the `.ro` domain and its DNS once registered;
- Cloudflare account for R2 object storage;
- Neon account;
- Zitadel organization/instances/projects;
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
Brașov Runners / Zitadel QA
Brașov Runners / Zitadel Production
Brașov Runners / Mailgun
Brașov Runners / R2 QA
Brașov Runners / R2 Production
Brașov Runners / Scheduler QA
Brașov Runners / Scheduler Production
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

## 6. Scaffold the application

Use the current supported `create-next-app` flow after checking official documentation.

Select:

```text
TypeScript: yes
ESLint: yes
Tailwind: no
src directory: yes
App Router: yes
import alias: @/*
```

Pin Node in `.nvmrc` or equivalent and commit `yarn.lock`.

Install only the foundation dependencies needed for the first slice:

```bash
yarn add \
  @mui/material \
  @mui/icons-material \
  @emotion/react \
  @emotion/styled \
  @mui/material-nextjs \
  next-intl \
  zod \
  drizzle-orm

yarn add -D \
  drizzle-kit \
  prettier \
  vitest \
  @playwright/test
```

Select one current PostgreSQL driver compatible with both local PostgreSQL and the chosen Neon connection mode after checking current Drizzle/Neon docs. Do not install multiple drivers without a reason.

Add staff auth and Tiptap only in their implementation PRs:

```bash
yarn add next-auth
yarn add @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-placeholder
```

Verify current package names/peer requirements before running commands. Do not copy stale version-specific imports from this document.

Do not install a form framework, client state library, page builder, external CMS, collaboration service, queue, analytics, maps, payments, or social API SDK during foundation work.

## 7. Add root documents and documentation check

Add:

```text
README.md
BUSINESS.md
SPECS.md
AGENTS.md
SETUP.md
DECISIONS.md
```

Implement `yarn docs:check` to verify:

- all six contain exactly the same `PROJECT_BASELINE` marker;
- relative Markdown links resolve;
- required files exist;
- every `BR-BUS-*` ID referenced in `SPECS.md` exists in `BUSINESS.md`;
- every `BR-REQ-*` ID referenced anywhere in the repository exists in `SPECS.md`;
- every `BR-BUS-*` heading in `BUSINESS.md` is referenced by at least one requirement;
- every file under the root, `docs/`, `scripts/`, `.github/`, and `.githooks/` is linked from `README.md`;
- the club's own hostname appears nowhere outside §26, which uses `<domain>` until the domain is registered;
- the top heading of `CHANGELOG.md` equals the current baseline;
- every root document, `docs/PRACTICES.md`, and `docs/RUNBOOKS.md` show the baseline in visible text.

A reference implementation is committed at `scripts/docs-check.mjs`.

Playwright runs two projects, a mobile viewport and a desktop viewport, and every registration journey runs under both (`BR-REQ-041-01`).

Make this part of `yarn check` and CI. Add a `CODEOWNERS` entry covering the six root
documents, and a pull-request template checkbox confirming the change-type matrix in
`AGENTS.md` §1.4 was followed.

## 8. Add stable package scripts

Expected names:

```json
{
  "scripts": {
    "setup": "node scripts/setup.mjs",
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "...",
    "format": "...",
    "format:check": "...",
    "typecheck": "tsc --noEmit",
    "test": "...",
    "test:unit": "...",
    "test:integration": "...",
    "test:e2e": "...",
    "check": "...",
    "docs:check": "...",
    "db:generate": "...",
    "db:migrate": "...",
    "db:seed": "...",
    "db:reset:local": "...",
    "deploy:build": "..."
  }
}
```

Fill actual commands from selected tools. Do not leave placeholders in a merged implementation.

`check` is the aggregate local-and-CI gate. Every step a developer can run locally —
`format:check`, `lint`, `typecheck`, `docs:check`, `test:unit` — belongs inside it, because
`.githooks/pre-commit` and `.github/workflows/docs-check.yml` both invoke exactly
`yarn check` and must never name different commands (BR-REQ-090-02).

`setup` is already implemented. It sets `core.hooksPath` to the tracked `.githooks`
directory, which needs no dependency; husky and lint-staged are deliberately not installed
(`AGENTS.md` §1.5 priority 4 and 6).

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
type StaffAuthMode = "mock" | "zitadel";
type EmailDeliveryMode = "capture" | "allowlist" | "live";
type StorageMode = "local" | "fake" | "r2";
```

Required combinations:

```text
local:      mock / capture / local
 test:      mock / capture / fake
 qa:        zitadel / capture-or-allowlist / r2
 production: zitadel / live / r2
```

`.env.example` should document concepts:

```text
APP_ENV
APP_BASE_URL
DATABASE_URL
STAFF_AUTH_MODE
Auth.js/Zitadel variables required by installed provider
EMAIL_DELIVERY_MODE
EMAIL_ALLOWLIST
MAILGUN_API_KEY
MAILGUN_DOMAIN
MAILGUN_WEBHOOK_SIGNING_KEY
STORAGE_MODE
JOB_SCHEDULER_ALLOWED
R2_ACCOUNT_ID
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

## 11. Configure Material UI

Follow the official MUI App Router integration for the installed Next.js/MUI version.

Foundation checklist:

- [ ] Correct App Router cache provider.
- [ ] `ThemeProvider` and `CssBaseline`.
- [ ] `next/font` mapped into theme typography.
- [ ] Brand tokens for colors, typography, shape, spacing.
- [ ] Light mode only initially unless dark mode is explicitly designed.
- [ ] MUI SSR/hydration test.
- [ ] No Tailwind/shadcn files/dependencies.
- [ ] Public components do not look like default admin templates.

Do not add paid MUI X. Use MUI Core tables for initial Admin lists.

## 12. Configure internationalization

Install/configure `next-intl` with:

```text
ro default
en
localePrefix = always
explicit URL locale wins
```

Create:

```text
src/i18n/routing.ts
src/i18n/request.ts
src/i18n/navigation.ts
src/i18n/formats.ts
messages/ro.json
messages/en.json
```

Implement localized routes from `SPECS.md`, including public runner profiles and registration action pages.

CI validates message key/interpolation parity.

QA and all participant action pages are `noindex`.

## 13. Create database foundation

Create Drizzle config, client, migrations, seed runner, and environment guard.

Initial migration groups can be incremental; do not create all tables in one unreviewable migration.

Required M1 tables:

```text
staff_users
participants
participant_profiles
participant_social_links
races
race_translations
events
event_translations
legal_documents
legal_document_translations
registrations
declaration_acceptances
email_action_tokens
articles
article_translations
content_pages
content_page_translations
gallery_albums
gallery_album_translations
media_assets
gallery_items
gallery_item_translations
email_outbox
audit_logs
app_environment_metadata
job_runs
```

Important constraints:

- unique `participants.canonical_email`;
- unique `(registrations.event_id, registrations.participant_id)`;
- unique localized slugs;
- positive capacity and valid dates;
- unique legal document `(key, version)`;
- unique token hash;
- unique one profile per participant;
- unique one social provider per profile.

Do not create participant password/auth provider, medical, minor, result, point/badge, or Strava token tables.

## 14. Implement canonical email identity first

Create a pure versioned canonicalization module with no database/provider dependency.

V1 behavior:

1. trim surrounding Unicode whitespace;
2. parse/validate one mailbox;
3. lowercase local/domain for comparison;
4. for exact `gmail.com`, remove `.` from local part and remove content from first `+` onward;
5. do not apply Gmail transformations to other domains;
6. return delivery, normalized, canonical, and version.

Tests must cover:

```text
User@Example.com == user@example.com
" user@example.com " == user@example.com
john.smith@gmail.com == johnsmith@gmail.com
johnsmith+race@gmail.com == johnsmith@gmail.com
john.smith@company.com != johnsmith@company.com
john+race@company.com != john@company.com
```

Persist original verified delivery address separately. Do not claim this detects one person across unrelated mailboxes.

## 15. Configure staff authentication

Create separate Zitadel applications/credentials:

```text
QA staff application
Production staff application
```

Local/test use mock staff identities.

Use Auth.js current Zitadel provider and Authorization Code/PKCE behavior supported by current package/provider. Do not hand-roll OIDC.

Staff roles:

```text
AUTHOR
EDITOR
ADMIN
```

No participant role and no public participant login route.

Checklist:

- [ ] Exact QA/production callback/logout URLs.
- [ ] No wildcard redirect unless official provider requires and risk accepted.
- [ ] Immutable `sub` stored in `staff_users`.
- [ ] Local role stored in PostgreSQL.
- [ ] First Admin granted by controlled runbook after first login.
- [ ] Mock staff switcher unavailable in QA/production.
- [ ] Server role helpers tested.

## 16. Implement the mini CMS

Use Tiptap open-source core only.

Canonical persisted body:

```text
validated Tiptap JSON
```

Allow only required nodes/marks:

```text
paragraph
heading
text
bold
italic
link
bullet list
ordered list
list item
blockquote
media-library image reference when implemented
```

Do not enable raw HTML, iframes, remote embeds, collaboration, comments, paid cloud, or AI publishing extensions.

Workflow:

```text
DRAFT -> IN_REVIEW -> PUBLISHED -> ARCHIVED
```

Required content:

- articles/announcements;
- event descriptions and SEO;
- fixed page keys;
- gallery text.

Requirements:

- server schema validation;
- public static rendering using same allowlist;
- optimistic integer version;
- protected noindex preview;
- per-locale publication;
- Author/Editor/Admin permission matrix;
- audit transitions;
- published save warning;
- declarations excluded from ordinary Author editing.

## 17. Implement participant email action tokens

Use Node cryptographic random generation, at least 32 random bytes, base64url for emailed token, SHA-256 hash stored in DB.

Purpose values:

```text
VERIFY_REGISTRATION_EMAIL
COMPLETE_DECLARATION
MANAGE_REGISTRATION
WAITLIST_OFFER
MANAGE_PROFILE
```

Rules:

- raw token never stored/logged;
- token bound to participant and optional registration;
- explicit expiry;
- GET does not mutate/consume;
- POST consumes or exchanges to short-lived action-scoped HTTP-only session;
- clean redirect removes token from address bar;
- no third-party scripts/analytics on token pages;
- `Referrer-Policy: no-referrer`;
- token/session cannot access Admin APIs;
- invalid/expired response generic and localized;
- resend rotates previous active purpose token;
- validation/request endpoints throttled.

Write tests for email scanner GET, replay, wrong purpose, wrong registration, expiry, invalidation, and scope escape.

## 18. Implement declarations

Before production, the owner provides approved Romanian and English declaration wording and confirms typed-name acceptance is suitable.

Data rules:

- immutable template version after use;
- stable key/version/effective date;
- localized Tiptap JSON body;
- deterministic SHA-256 of canonical serialized JSON;
- event references approved version;
- acceptance stores version/hash/locale/typed name/server time;
- staff cannot sign for participant;
- no raw IP/device by default;
- UI does not call it qualified electronic signature.

V1 has **no** declaration editor screen. New approved versions arrive through a
migration or seed, following `docs/RUNBOOKS.md` § Legal document version. The backoffice
shows legal documents read-only. Ordinary Authors and Editors cannot edit legal text, and
no role may edit a version a participant has already accepted.

The same mechanism serves the privacy notice and the terms (`legal_documents`, key
`PRIVACY_NOTICE`, `TERMS`, `EVENT_DECLARATION`). Both legal routes must be reachable from
the footer in both locales before production.

## 19. Implement registration and capacity

Registration form collects:

```text
full name
email
locale
acknowledgment of the current approved privacy notice
choice: may my name appear in public results (BR-BUS-072)
```

The acknowledged privacy-notice version and timestamp, and the results choice with its
wording version, are stored on the registration. A submission missing either is rejected.
No password, no login.

State enum:

```text
PENDING_EMAIL_CONFIRMATION
PENDING_DECLARATION
WAITLISTED
WAITLIST_OFFERED
CONFIRMED
CANCELLED
EXPIRED
```

Implementation sequence:

1. submit -> validate the privacy-notice version, then upsert participant by canonical email;
2. create/reuse one event/participant registration;
3. verification email/outbox;
4. explicit POST email confirmation;
5. transactionally check capacity;
6. available -> 30-minute declaration hold;
7. full or capacity already owed to an older queue -> Waitlisted;
8. declaration acceptance -> Confirmed;
9. confirmation email with manage/unregister link;
10. explicit POST unregistration -> Cancelled and release;
11. restart of a cancelled/expired registration re-enters at Pending email only when the
    participant is unverified; a verified participant re-enters through the same capacity
    transaction at Pending declaration or Waitlisted.

Capacity source of truth:

```text
occupied =
  confirmed
  + unexpired pending-declaration holds
  + unexpired waitlist-offer holds

places available to a new registrant =
  max(capacity - occupied - eligible waitlisted entries, 0)
```

Every capacity-changing transaction must allocate existing waiting entries before a later registration. Increasing capacity promotes the queue first; lowering capacity below occupied places is rejected.

Use an event row lock or equivalent serialization. Do not call Mailgun inside the transaction. Create outbox rows atomically.

Write a real PostgreSQL concurrency test that attempts more confirmations than capacity and proves final occupied count never exceeds capacity.

## 20. Implement waiting list and promotion

When a capped internal event is full/open, or its remaining places are already owed to older waiting entries:

- email-confirmed participant enters FIFO Waitlisted;
- no place consumed;
- localized waiting email;
- no later direct registration may bypass the active queue.

When place releases/expires:

- transaction locks event;
- expires stale holds;
- selects oldest Waitlisted safely;
- transitions to Waitlist offered;
- creates hold default 24h capped by close/start;
- creates fresh offer token/outbox;
- no Mailgun call in transaction.

Offer page:

- deadline/countdown;
- approved declaration;
- explicit accept/sign;
- explicit decline/cancel.

Expiry job:

- transition Expired with reason;
- release hold;
- send expiry email;
- promote next.

Expired participant may rejoin at queue end while open.

When the event starts, registration maintenance closes any remaining Waitlisted entries
with `expiry_reason = EVENT_STARTED`. No message is sent for that transition.

Admin:

- default Promote next;
- selected promotion requires reason/audit;
- cannot overbook or bypass declaration.

## 21. Implement backoffice registration management

Backoffice resend mapping:

```text
PENDING_EMAIL_CONFIRMATION -> verify-email message
PENDING_DECLARATION        -> complete-declaration message
WAITLISTED                 -> waiting-list status/manage message
WAITLIST_OFFERED           -> current claim-place offer
CONFIRMED                  -> confirmation/manage-unregister message
CANCELLED or EXPIRED       -> REGISTRATION_STATE_NOTICE, with an eligible restart link
```

A resend never changes state or extends a deadline by itself.

Admin list/detail must show:

- participant name/delivery email;
- canonical duplicate identity indicator;
- status and timeline;
- email confirmation;
- declaration version/acceptance time;
- waitlist position time;
- hold/offer deadline;
- confirmation/cancellation/expiry;
- email history/provider state;
- audit history.

Actions:

```text
resend current action email
resend manage link
cancel
restart when eligible, at the step matching the participant's verification state
move to waitlist
promote next
exceptionally promote selected with reason
correct name
unpublish public profile
export CSV
```

Never offer “mark declaration signed” on behalf of participant. Do not provide an in-place verified-email edit or participant-merge action in V1; resolve unverified typos by cancelling and restarting the pending registration.

Resend creates a new outbox row/token and does not change state.

## 22. Implement public runner profiles

Eligibility: verified participant.

Management:

- generic request form by email;
- emailed `MANAGE_PROFILE` token;
- short-lived profile-scoped session;
- optimistic save;
- explicit publish/unpublish.

V1 fields:

```text
public display name
short plain-text bio
stable slug
Strava URL
Instagram URL
Facebook URL
TikTok URL
YouTube URL
personal website URL
```

Validation:

- HTTPS;
- known provider host allowlists;
- safe normalized personal website URL;
- no arbitrary HTML/embeds;
- external link safety attributes.

Public response must never select email, registration, declaration, or private participant columns.

Profiles are direct-link public, `noindex`, and absent from sitemap/directory. Admin can unpublish with reason. Participant avatar upload and Strava API are deferred.

## 23. Configure email/outbox

Local/test: capture. QA: capture or allowlist. Production: live.

Message types:

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
```

Create Romanian/English text and HTML templates with tests.

Outbox worker:

- small batches;
- safe lock/claim;
- bounded retry/backoff;
- max attempts;
- Admin retry;
- at-least-once behavior;
- unique send identity;
- manual resend creates distinct row;
- no raw token/body in logs.

Mailgun:

- verify sending domain/DNS;
- production sending credentials;
- QA sending only when allowlisted;
- webhook signature secret;
- delivery/bounce/complaint/failure handling;
- do not keep resending to permanent bounce without Admin review.

## 24. Configure R2 and media

Create separate buckets/credentials:

```text
brasov-runners-qa-media
brasov-runners-production-media
```

Local/test use fake/filesystem.

Checklist:

- [ ] Bucket-scoped credentials.
- [ ] QA cannot access production bucket.
- [ ] Opaque keys.
- [ ] CORS only required origins/methods.
- [ ] File type/size/signature/dimension validation.
- [ ] JPEG/PNG/WebP initial allowlist.
- [ ] EXIF/location removal and orientation correction.
- [ ] Web-suitable variants.
- [ ] Orphan cleanup.
- [ ] No participant profile upload in V1.

## 25. Create Neon QA and production

Use separate production boundary, not only schemas in one shared project.

Recommended:

```text
Neon QA project/database
Neon Production project/database
```

Checklist:

- [ ] Dedicated connection strings.
- [ ] Pooled connection appropriate for runtime.
- [ ] Direct/admin connection only where migration tooling requires.
- [ ] Environment marker initialized.
- [ ] QA synthetic seed.
- [ ] Production never auto-seeded.
- [ ] Backup/restore capability documented and tested before launch.
- [ ] No production clone into QA.

## 26. Create the Vercel QA and production projects

This section is the **only** place in the repository where the club's own hostname appears.
Everything else says "QA host" or "production host", or writes `<domain>`. `docs:check`
fails when a club hostname appears in any other file, so the name cannot leak into a
document before the domain is registered. Both applications start on their
provider-assigned default hostnames; the custom domain is bound at the end of M1 using
`docs/RUNBOOKS.md` § Domain binding.

| Project | Production branch | APP_ENV | Current hostname | Final hostname |
| --- | --- | --- | --- | --- |
| `brasov-runners-qa` | `qa` | `qa` | provider default | `qa.<domain>` |
| `brasov-runners-production` | `main` | `production` | provider default | `<domain>` and `www.<domain>` |

Two projects rather than one project with preview deployments, so each environment has its
own environment variables and its own stable hostname. Set the function region to `fra1` on
both. Verify the exact setting names in the Vercel dashboard when creating them.

Fill the current hostname column when each application is created, and replace this table
with the final values once binding is complete.

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
- run maintenance about every five minutes and the outbox every one to five minutes;
- scheduler credentials are limited to the job endpoint and are separate per environment;
- record every run in `job_runs` so a stalled scheduler is visible in the health check.

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

- **PR 1 — Foundation.** Root docs and `docs:check` in `yarn check`, the `yarn setup`
  hook install and the `.githooks/pre-commit` gate, Next.js and MUI with the App Router
  integration, i18n shell, CI, `CODEOWNERS`, pull-request template, local PostgreSQL,
  environment validation, `.nvmrc` pinned to the host's verified runtime.
- **PR 2 — Database.** Drizzle, migrations, environment marker, seeds, the M1 schema including
  the three M2 footprints (`races`, `events.race_id`, results consent fields, `bib_number`).
- **PR 3 — Walking skeleton.** One seeded event, registration form with privacy acknowledgment
  and results consent, capture-mode outbox, placeholder declaration, `CONFIRMED` reached.
  Deployed to QA. Clicked through by a person. Deliberately ugly.
- **PR 4 — Staff auth and minimal backoffice.** Zitadel and Auth.js, roles, mock auth locally,
  event create/edit/publish, registration list and timeline.
- **PR 5 — Event pages.** Public list and detail per locale, exact free-place count, race-grouped
  page when `race_id` is present, structured data, sitemap, robots, canonical and hreflang.
- **PR 6 — Identity, tokens, legal documents.** Canonical email, hashed scoped tokens,
  participant action session, `legal_documents` with the runbook, acceptance evidence.
- **PR 7 — Registration lifecycle.** Confirmation, holds, declaration, confirmed, unregistration,
  restart per verification state, concurrency tests against real PostgreSQL.
- **PR 8 — Waiting list and jobs.** FIFO, offers, expiry, queue closure at event start,
  maintenance and outbox jobs, `job_runs`, scheduler, health check.
- **PR 9 — Live email.** Mailgun adapter, templates in both locales, modes and QA allowlist,
  webhooks, delivery history. Blocked on the domain.
- **PR 10 — Launch gate.** Domain binding runbook, approved legal documents loaded, backups with
  a tested restore, monitoring, the M1 slice of `docs/PRACTICES.md` § Launch checklist, one real
  registration on production.

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

Repository/delivery:

- [ ] `qa` default and protected.
- [ ] `main` protected.
- [ ] CI required.
- [ ] Release PR process rehearsed.
- [ ] AI reviewer read-only permissions verified.

Application:

- [ ] Romanian/English flows.
- [ ] MUI SSR/hydration/accessibility.
- [ ] Staff auth/roles.
- [ ] CMS Draft/Review/Publish.
- [ ] Canonical email tests.
- [ ] Email GET no mutation.
- [ ] Declaration approved/versioned.
- [ ] Capacity concurrency test.
- [ ] Waitlist offer/expiry/promotion test.
- [ ] Self-unregistration.
- [ ] Admin resend/delivery history.
- [ ] Public profile privacy/noindex.

Providers:

- [ ] Separate QA/production Vercel projects and Neon/Zitadel/R2 resources.
- [ ] Mailgun production domain verified.
- [ ] QA email restricted.
- [ ] Webhook/job secrets configured.
- [ ] Production config rejects unsafe resources/modes.

Operations/privacy:

- [ ] Legal/privacy/terms/declaration approved.
- [ ] Retention/deletion policy.
- [ ] Participant/profile/photo support process.
- [ ] Backups and restore test.
- [ ] Monitoring/alerts.
- [ ] Ownership/recovery/handover documented.

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

Final operational rule:

> No direct production fixes, no participant password system, no state-changing email GET links, no raw tokens in storage or logs, no live email in QA, no external CMS, no unreviewed declaration wording, and no AI reviewer with repository write access.
