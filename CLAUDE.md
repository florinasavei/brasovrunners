<!-- PROJECT_BASELINE: BR-V1.18-2026-09-04 -->

# CLAUDE.md — start here if you are an AI coding agent

**Baseline `BR-V1.18-2026-09-04`** · [changelog](./CHANGELOG.md) · [weekend plan](./WEEKEND.md)

Brașov Runners: a bilingual website and free event-registration platform for a small running
club in Brașov, Romania. One Next.js App Router monolith, PostgreSQL, Material UI.

## Current mode: M1 complete in code, QA deployed

M1 — event pages, the full registration lifecycle, staff sign-in, legal document versioning,
transactional email and a registrations backoffice — exists and is tested. **QA now runs on a
real host**: a Neon project in Frankfurt and a Vercel project on its provider-assigned
hostname, serving the seeded events with a reachable database, and the participant journey can
now be walked there end to end because every environment but production carries clearly marked
sample legal text (`DECISIONS.md` §29). What is left is still not application code: a Mailgun
account, the club's `.ro` domain, the club's *approved* privacy notice and declaration text, and
the production half of the two-project topology. See "What is deployed" below and
`DECISIONS.md` §26–§30 for what changed to get here.

[`WEEKEND.md`](./WEEKEND.md) records the narrower pilot this replaced — Romanian event pages
only, no registration, no email, no login — and is now a historical scope document rather than
the current one. `SETUP.md` §29 is the original ten-pull-request M1 plan; most of it now exists.

## Commands that exist right now

```text
yarn setup        install the tracked git hooks and the `git gone` alias — once per clone
yarn dev          Next.js dev server; needs .env.local (copy .env.example)
yarn build        production build
yarn start        production server, honours PORT
yarn lint         ESLint
yarn typecheck    tsc --noEmit
yarn test         unit and database tests; no database or Docker needed (PGlite)
yarn test:concurrency  two-connection suite (BR-REQ-051-01 criterion 5); needs the database
yarn test:e2e     Playwright, 320px mobile and desktop; needs the database running
yarn check        docs:check + typecheck + lint + test; CI and the pre-commit hook run this
yarn docs:check   documentation consistency
yarn db:migrate   apply migrations locally · db:seed sample events · db:studio browse
yarn db:seed:legal  the sample legal documents alone; never deletes, safe on a live database
yarn db:migrate:env  apply migrations to local|qa|production — the only supported way to
                  migrate a deployed database (AGENTS.md §7.6, DECISIONS.md §31)
yarn smoke        ask a deployment's /api/health whether it works; ends every deploy
yarn release      versioned archive and share copies under dist/
```

Full list with explanations: [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md). Do not write a
command into a document until it is in `package.json`.

**Toolchain:** Node `22.14.0` (`.nvmrc`), Yarn 4.18.0 via Corepack, TypeScript 5.9.3 — not 7,
which `typescript-eslint` refuses. Tests need no database: PGlite runs real PostgreSQL in
process. Concurrency tests must not use it; see `docs/DEVELOPMENT.md`.

## Read order

1. This file.
2. `WEEKEND.md` — the pilot this replaced, kept for its reasoning, not its scope table.
3. `AGENTS.md` §1.5 (priority order) and the one §10 subsection for the rule you are touching.
4. The `BR-REQ-*` you implement, in `SPECS.md`. Name it before you write code.
5. Everything else on demand. `README.md` § Where a rule lives is the index.

## Rules that cannot be broken, pilot or not

These carry trust. `AGENTS.md` §1.5 ranks them above every other goal, including speed.

| Rule | Where it lives |
| --- | --- |
| No overbooking, ever, under real concurrent load — not merely under a single-connection test. `tests/concurrency/capacity.test.ts` is what the locked capacity transaction is checked against; the pilot's `CHECK (capacity IS NULL)` guard is gone now that it passes. | `AGENTS.md` §10.6, BR-REQ-034-01, BR-REQ-034-02 |
| No registration without an approved declaration and privacy notice, and never invented legal text in production. Everywhere else carries clearly marked *sample* text — complete in structure, every club-specific fact a visible `<PLACEHOLDER>`, with a not-approved banner in its own rendered body. Production is refused hard, and the refusal has a test. | `AGENTS.md` §10.8, §29; BR-REQ-053-01; `DECISIONS.md` §29 |
| Publication is one state per event: both languages go live together, and PUBLISHED requires a complete translation in every locale. A locale with no translation is a 404, never the other language's text. | `AGENTS.md` §11.2, BR-REQ-040-02, `DECISIONS.md` §28 |
| A test registration behaves exactly like a real one in the queue — `kind` appears in no condition in the allocator or the capacity formula — is omitted from every count the club is given, and cannot exist in production. | `AGENTS.md` §12.6, BR-REQ-037-04, `DECISIONS.md` §30 |
| Participants never get passwords or accounts. Staff-only auth. | `AGENTS.md` §10.3, §13 |
| Email action links: token hashed at rest, single use, GET never mutates. | `AGENTS.md` §12.8, BR-REQ-036-02 |
| Every absolute URL derives from `APP_BASE_URL`. No hostname literal in `src/`, and the club's domain appears in no file except `SETUP.md` §26 — `docs:check` fails otherwise. | `AGENTS.md` §8, BR-REQ-101-02 |
| Email identity goes through the versioned canonicalizer, never a raw string compare. | `AGENTS.md` §10.4, BR-REQ-032-* |
| Authorization is asserted on the server, never by hiding UI. | BR-REQ-060-01 |
| Vocabulary matches `BUSINESS.md`: participant, registration, hold, waiting-list offer, declaration, confirmed. | `AGENTS.md` §1.5 |

## Fast lane — what is relaxed during the pilot, and what is not

Recorded once in `DECISIONS.md` §20 so it does not have to be re-argued. This was a pilot-scope
allowance; the M1-completion work recorded in `DECISIONS.md` §26–§27 used the full change-type
matrix and a baseline bump, per the scope it was given, precisely because it changed documented
rules (the staff auth provider, the capacity guard) rather than adding pilot-scale application
code underneath unchanged ones.

**Relaxed:** application code needs no baseline bump and no six-document edit. Add a
`CHANGELOG.md` line when something user-visible ships; that is all.

**Not relaxed:** a change to a documented *rule* still follows the change-type matrix in
`AGENTS.md` §1.4. The table above is in force. `yarn check` still runs before every commit
and blocks on an undefined `BR-REQ-*`, a leaked hostname, or a root file missing from the
README index — application source under `src/` is not indexed and needs no README row.

## What exists right now

Public Romanian event pages, running and tested. `/ro/evenimente` lists seeded events and
`/ro/evenimente/<slug>` shows one, with `SportsEvent` JSON-LD, a sitemap and robots. English
translations are published too: every event carries a complete Romanian and English
translation. BR-REQ-040-02 still holds — an unpublished locale is a 404 and never a fallback
to the other language. The site root redirects to the events listing, which is the landing page.

**The backoffice, and the whole of an event in it.** An organizer signs in, creates a race or
duplicates last year's, sets every column the row carries — kind, event status, both times, the
end time and the timezone, the coordinates, the map link, distance, climb, the featured flag, and
the whole registration block including capacity, the window and the approved declaration a
participant signs — previews it, publishes it, archives it when it is over, and deletes one made
by mistake. `src/db/seeds/pilot.ts` is no longer how an event is configured (`DECISIONS.md` §28).
Deleting is Administrator-only and is refused for an event with any registration against it;
archiving is the answer there. Three staff roles asserted on the server, staff administration for
an Administrator, DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED **for the event** — both languages go
live together, and PUBLISHED is refused while either is incomplete — and a save that carries the
version it was loaded with, on the translation *and* on the event row, so a second organizer's
save is a CONFLICT rather than an overwrite. Built ahead of its milestone on purpose:
`DECISIONS.md` §25, §28. Staff sign-in is Auth.js with the Zitadel OAuth provider
(`DECISIONS.md` §26, reversing §24, which was never shipped to anyone). `STAFF_AUTH_MODE=provider`
is the real thing; local and test still use the development switcher of `AGENTS.md` §13.1, and any
environment without a Zitadel tenant runs `STAFF_AUTH_MODE=disabled`, answering 404 to every staff
request. Everywhere there *is* a way in, a signed-out `/admin` goes to sign-in and comes back to
the backoffice afterwards.

**Legal documents.** `legal_documents`/`legal_document_translations` (§12.5), immutable once
referenced, with no editor screen in any form — an event *selects* an approved declaration
version; nothing in the backoffice edits a word of one. Every environment except production is
seeded with a full **sample** privacy notice, terms and declaration in both languages: complete in
structure, every club-specific fact a visible `<PLACEHOLDER>`, and a not-approved banner as the
first thing on the rendered page. Production is refused outright (`DECISIONS.md` §29, superseding
§27). The two public routes (`/ro/confidentialitate`, `/ro/termeni`) render whatever is currently
approved, or say plainly that nothing is yet.

**The registration lifecycle, proven under real concurrency.** Submission (honeypot + timing
check, generic response regardless of what the address turns out to mean), email confirmation,
the 30-minute declaration hold, capacity, the waiting list, self-unregistration, and the
registration-maintenance job — one shared allocator
(`modules/registrations/service.ts`) that a participant's click and the scheduled job both go
through. `tests/concurrency/capacity.test.ts` proves twenty simultaneous confirmations against
one free place produce exactly one winner, and that a released place goes to the front of the
waiting list rather than to a concurrent new registration — against real PostgreSQL, not the
single-connection PGlite the rest of the suite runs on. The pilot's `CHECK (capacity IS NULL)`
guard is gone, removed only after that suite passed.

**Email.** Ten message types (§16.3), Romanian and English, HTML and text, through the outbox
built earlier. A message that carries an action link mints its token at send time — the outbox
row itself never holds a secret, satisfying §14.5 even though the row can sit queued for
minutes before a worker renders it. Two job endpoints
(`/api/internal/jobs/email-outbox`, `.../registration-maintenance`) behind a constant-time
`JOB_SECRET`, and `/api/webhooks/mailgun` verifying Mailgun's own signature. No in-process
interval: this deploys to Vercel serverless functions, which have no persistent process for one
to live in, so the external scheduler is the only mechanism, not a fallback. The Mailgun
adapter itself is still declared and deliberately not wired — it throws rather than dropping
mail — and startup still refuses live delivery outside production.

**A registrations backoffice.** List and filter by event and status, one registration's full
timeline, a resend that can only ever send what §15.8 allows for the current status, and a CSV
export with formula-neutralized cells (§15.10). Administrator only, asserted on the server.

**Test registrations, so the queue can be watched working.** `registrations.kind` is `REAL` or
`TEST`; an Administrator fills an event's queue with synthetic participants on `@test.invalid`
addresses and clears them again. A `TEST` row goes through the same allocator, occupies a place
and is promoted in turn — `kind` appears in no condition in the allocator or the capacity formula,
and a test asserts the two kinds produce identical transitions. It is omitted from the CSV export,
labelled everywhere it is listed, and cannot exist when `APP_ENV=production`, refused twice
(`DECISIONS.md` §30).

**`/api/health`.** Database reachability plus each scheduled job's own liveness — degraded, not
down, when a job is stale or has never run, because a stalled scheduler delays a notification
rather than breaking the site.

**604 unit and integration tests, 60 end-to-end runs (30 per viewport project), and five
concurrency tests.** `yarn test` needs no database — PGlite runs real
PostgreSQL in process. `yarn test:e2e` needs `docker compose up -d db` and a seed, and so does
`yarn test:concurrency`, which needs two genuine connections and would prove nothing on a
single-connection database.

Not built: the rest of the CMS — articles, static pages, galleries, the media library and the
Tiptap body contract (M5) — and everything M2–M4 name (multi-distance races, bibs, results,
runner profiles).

**What is deployed.** QA only, and none of what remains is application code. A Neon project in
Frankfurt holds the migrated schema and the seeded events; a Vercel project tracking `qa`
serves them on its provider-assigned hostname, with `/api/health` reporting the database
reachable. Its exact hostname lives in `SETUP.md` §26 and nowhere else, and `APP_BASE_URL` is
the only thing that knows it. **Staff sign-in works there**: a Zitadel tenant exists, QA runs
`STAFF_AUTH_MODE=provider`, and an organizer signs in with a real account gated by the
`staff_users` allowlist. Email is still `capture`, so nothing transmits.

Two settings that are not obvious and cost an afternoon between them: the Zitadel application
needs **"Include user's profile info in the ID Token"** enabled, or the ID token carries no
`email` claim and every sign-in is refused by the allowlist gate that cannot see an address;
and the first Administrator is a `staff_users` row inserted by hand, because the screen that
invites people is itself behind the sign-in it would be granting.

**Still owed, all of it account creation or a decision rather than code.** A Mailgun account;
the club's `.ro` domain; the club's *approved* privacy notice, terms and declaration text, which
replace the sample versions through a migration (`docs/RUNBOOKS.md` § Legal document version) and
without which production correctly refuses every registration; and the production half of the
topology — its own Neon project and its own Vercel project tracking `main`, never sharing QA's
database or secrets. `SETUP.md` §26 and `docs/RUNBOOKS.md` are the procedures.

## Stack and providers, as decided

| Layer | Decision | Status |
| --- | --- | --- |
| App | Next.js 16 App Router, TypeScript 5.9 strict, `src/`, Yarn 4, Node 22.14.0 | done |
| UI | Material UI 9 + Emotion, `@mui/material-nextjs/v16-appRouter` | done |
| i18n | `next-intl` 4; `ro` default, `en`; `localePrefix` always; no cross-locale fallback | done; both locales published |
| Data | PostgreSQL on Neon, Frankfurt; Drizzle over `node-postgres`, pooled URL. Local: `docker compose up -d db` | QA project live, migrated and seeded; production project not created |
| Hosting | Vercel Hobby, function region `fra1`; one project per environment | QA deployed on its provider hostname, tracking `qa`; production project not created |
| Jobs | No in-process interval — serverless has no process for one. `.github/workflows/scheduled-jobs.yml` calls both endpoints every five minutes with each environment's `JOB_SECRET` | live in QA since `BR-V1.18`. It had never run before that: `QA_APP_BASE_URL` and `QA_JOB_SECRET` did not exist, so every run logged "qa is not configured; skipping" and exited green |
| Auth | staff only. **Decided:** Auth.js with the Zitadel OAuth provider, `staff_users` as the server-side allowlist (`DECISIONS.md` §26, reversing §24). Roles, helpers, backoffice, the development switcher and the provider wiring are all built, and a QA tenant exists | built; live in QA |
| Email | Mailgun. Sandbox first (5 authorized recipients, dev only), then the club domain. A `*.vercel.app` domain cannot be verified — its DNS is not ours. Templates, the outbox jobs and the webhook are built; the adapter throws rather than sending live | built; delivery to real people needs the domain |
| Storage | Documented: R2 behind the four-method adapter in `AGENTS.md` §17. Direction: `public/` until a non-developer uploads | deferred |
| Spam | Honeypot + timing check on registration submission, built. Cloudflare Turnstile only if that fails — it is a processor the unapproved privacy notice must name | built (honeypot + timing); Turnstile not built |

**Before installing anything:** verify the current API against the library's documentation
(Context7 or the official docs site). Next 16, MUI 9, next-intl 4 and Drizzle 0.45 are newer
than any training data can be trusted on. Pin exact versions in `package.json`.

## Working conventions

- **Fast, clean, easy to work on — the owner's standing instruction, and it applies to every
  change.** Prefer nothing over a dependency, the platform over a library, and what is already
  installed over something new. Server Components by default; a client island has to earn it.
  The header and the landing page are what every visitor pays for. `AGENTS.md` §1.5.
- **Do not commit or push.** Stage changes and hand back a suggested message; the owner
  commits. Creating a branch when asked is fine.
- Branch from `qa`, PR into `qa`. `main` is production. `SETUP.md` § Contributing.
- Windows development machine, Linux CI. Anything with paths or line endings: test both.
- Tests are named by the `BR-REQ-*` they cover, or by the `AGENTS.md` section for cross-cutting
  mechanisms (jobs, health). `WEEKEND.md` records the six that mattered for the original pilot.
- No `BaseService`, barrels, dispatch tables, or wrappers around MUI. `AGENTS.md` §1.3.
- When a doc contradicts this file, the doc wins and this file is wrong — fix it here.
