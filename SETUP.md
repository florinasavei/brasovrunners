<!-- PROJECT_BASELINE: BR-V1.36-2026-09-18 -->

# Brașov Runners — Repository and Platform Setup

**Baseline `BR-V1.36-2026-09-18`** · versioned with the whole set · [changelog](./CHANGELOG.md)


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
- Neon account;
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

**The procedure is `docs/RUNBOOKS.md` § Staff sign-in**, which holds the field-by-field settings
for both environments, the two settings that cost an afternoon each, the commands that verify a
sign-in without guessing, the four reasons a refusal can have, and what the free tier refuses.
This section is the decision and the shape; that one is what to do.

Auth.js with the Zitadel OAuth provider, and `staff_users` as the server-side allowlist: an
unknown Zitadel account is refused before a session ever issues. `DECISIONS.md` §26 records
why this reverses §24 — nothing was ever built against §24 beyond the development switcher.

What a Zitadel tenant needs, once one exists (an account-creation task, not a code change):

- an application registered for this project, with a client ID and secret;
- the redirect/callback URL Auth.js expects, per its current documentation, for each
  environment's `APP_BASE_URL`;
- `AUTH_SECRET`, `AUTH_ZITADEL_ID`, `AUTH_ZITADEL_SECRET` and `AUTH_ZITADEL_ISSUER` set for
  that environment, and `STAFF_AUTH_MODE=provider`;
- password and passwordless sign-in both configured in Zitadel's own login policy — this
  application does not choose between them.

Two things to know regardless:

- **Local and test** use the development staff switcher: `STAFF_AUTH_MODE=dev-switcher`, three
  synthetic identities, one per role, at `/ro/autentificare`. The process refuses to start with
  this mode in qa or production.
- **Until the tenant exists for an environment**, that environment runs
  `STAFF_AUTH_MODE=disabled`, where every staff request is answered by nobody and the
  backoffice returns 404 — the honest state, not a workaround.

Who may sign in is maintained in the backoffice by an administrator: add a colleague by email
address and role, change a role, revoke access. There is no invitation email yet, so the entry
waits until that person first signs in with that address.

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
- [ ] A signed-out `/admin` goes to sign-in wherever a sign-in exists, and answers 404 only where
      `STAFF_AUTH_MODE=disabled`; signing in lands back in the backoffice and signing out clears
      the provider session as well as any development cookie.
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
- optimistic integer version, on the translation row and on the event row;
- protected noindex preview;
- **publication per event, not per locale** (`DECISIONS.md` §28): both languages go live
  together, and PUBLISHED is refused while any locale is missing a field the public page renders;
- create, duplicate, archive and delete an event, with every column of `events` editable;
  deletion is Administrator-only and refused for an event with any registration against it;
- Author/Editor/Admin permission matrix;
- audit transitions;
- published save warning;
- declarations excluded from ordinary Author editing; an event selects an approved version and
  never edits one.

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
shows legal documents read-only, and the event editor *selects* an approved declaration version
for an internal event — a choice among versions, never an edit of one. Ordinary Authors and
Editors cannot edit legal text, and no role may edit a version a participant has already
accepted.

Until the club approves its own wording, `yarn db:seed` loads a clearly marked **sample** version
of all three keys in every environment except production: complete in structure, every
club-specific fact a visible `<PLACEHOLDER>`, and a not-approved banner as the first section of
each rendered page. Production is refused outright — the seed throws rather than skipping quietly
— and registration there correctly refuses everyone until the approved text is loaded
(`DECISIONS.md` §29). The sample seed never deletes: it inserts the next version when its text
changes, because a version an acceptance references is immutable.

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
CONFIRMED                  -> the confirmation again (REGISTRATION_CONFIRMED: code, QR, manage link)
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

```text
Neon QA project          exists — AWS Frankfurt (aws-eu-central-1), migrated, seeded (2026-09-04)
Neon production project  exists — brasov-runners-production (lively-haze-50960748), aws-eu-central-1,
                         PostgreSQL 18, created 2026-09-16, never migrated: its first migration is
                         the gated workflow run after the first release PR
```

Free plan (checked 2026-09-16, neon.com/docs/introduction/plans): 100 projects, 0.5 GB storage and
100 CU-hours per project per month. The second project costs nothing.

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
      nothing has been rehearsed, and its retention on the Free plan is not recorded here.
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
every day, hours 23 and 0–6, minute 0. The health check knows the two cadences
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

**The club's reply address, until it has a mailbox.** `contact@mail.brasovrunners.com` is a
Mailgun **Route** (Send → Receiving → Routes): match recipient `contact@mail.brasovrunners.com`
→ Forward to the owner's Gmail, Stop, priority 0, no "store and notify" (nothing reads incoming
mail, and storing people's messages at a third party for nothing is not a feature). Receiving
works because the `mail.` MX records point at Mailgun. When the club gets Google or Microsoft
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

**Why fifteen and not five (2026-09-18).** Neon's Free plan gives each project 100 CU-hours a
month and *suspends the compute* when they are spent, until the next month; the compute sleeps
after five idle minutes and cannot be told not to. A monitor every five minutes means it never
sleeps: 0.25 CU × 24 h = 6 CU-hours a day, 180 a month, exhausted around the 17th. QA measured
exactly that — 74 CU-hours by 18 September. At fifteen minutes the compute is awake for about
five and a half minutes per ping, some 37% of the time, ~65 CU-hours a month plus real traffic;
hourly on QA is ~17. `/devs` shows the figure when `NEON_API_KEY` and `NEON_PROJECT_ID` are
set (§33). The health thresholds are thirty-five minutes, so fifteen reads `ok`.

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
- **PR 4 — Staff auth and minimal backoffice.** Auth.js with the `staff_users` allowlist, roles,
  the development switcher locally, event edit/publish, registration list and timeline. Event
  editing, the roles and the editorial workflow shipped early (`DECISIONS.md` §25); the sign-in
  method and the registration views did not.
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
      by the gated workflow (§25). **Free plan, 100 CU-hours a month each**: the monitors must
      run at the §26 cadences or the compute is suspended mid-month (`DECISIONS.md` §68).
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

Two minutes, optional, read-only (BR-REQ-090-07). The Free plan's 100 CU-hours a month per
project is the one limit whose exhaustion takes the site down (§26 has the arithmetic), and the
figure lives in Neon's console, which no organizer opens. With these two variables `/devs` shows
it: CU-hours used against 100, hours awake against hours elapsed, and when the period ends.

1. Neon console → your avatar → **Account settings** → **API keys** → **Create API key**, name
   `brasovrunners-devs-readonly`. Copy it once. (Neon API keys are account-wide; this one is only
   ever used to read one project's row, and `/devs` shows a number, never the key.)
2. The project id is in the project's URL in the console (`console.neon.tech/app/projects/<id>`),
   or `npx neonctl projects list`.
3. `vercel env add NEON_API_KEY production` and `vercel env add NEON_PROJECT_ID production`
   with the production project's values; the same for QA with QA's project id. Redeploy.
4. `/devs` → "Database (Neon)" shows the figures; red past 80%. Nothing else reads the key.

## 34. Volunteer accounts for race day

Every desk verb (BR-REQ-037-08) is open to the lowest role, so a volunteer is a **Contributor**.
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
   project set `MAILGUN_DOMAIN=mail.<club domain>`, `MAILGUN_API_KEY` (step 4),
   `MAILGUN_API_BASE_URL=https://api.eu.mailgun.net/v3`, keep `EMAIL_DELIVERY_MODE=allowlist`
   and `EMAIL_ALLOWLIST=<your address>`, redeploy, register on QA with a dotted spelling of your
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

Sandbox afterwards: leave it; QA can keep the club domain in allowlist mode (step 6), which
frees it from the sandbox's five-recipient limit.
