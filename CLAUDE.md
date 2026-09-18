<!-- PROJECT_BASELINE: BR-V1.36-2026-09-18 -->

# CLAUDE.md — start here if you are an AI coding agent

**Baseline `BR-V1.36-2026-09-18`** · [changelog](./CHANGELOG.md) · [weekend plan](./WEEKEND.md)

Brașov Runners: a bilingual website and free event-registration platform for a small running
club in Brașov, Romania. One Next.js App Router monolith, PostgreSQL, Material UI.

## Current mode: production is live, the club is finishing its accounts

M1 — event pages, the full registration lifecycle, staff sign-in, legal document versioning,
transactional email, a registrations backoffice, and since 2026-09-18 the race-day desk, a
photo gallery on R2, recurring events and a rich-text event description — exists and is
tested. **Production serves the club's `.com`** (first deployment 2026-09-17, `BR-V1.34`;
`BR-V1.35` released 2026-09-18) and **QA serves its `qa.` subdomain**, each on its own
Neon project in Frankfurt, each with staff sign-in through Zitadel; every environment but
production carries clearly marked sample legal text (`DECISIONS.md` §29), so the participant
journey can be walked on QA end to end. What is left is not application code — it is the list
under "Still owed" below, and it is also `/admin/tasks`, which reads it from the system.

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
yarn check        docs:check + migrations:check + typecheck + lint + test; CI and the pre-commit hook run this
yarn docs:check   documentation consistency
yarn migrations:check  a migration expands or contracts, never both (AGENTS.md §7.6)
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
| A public participant list is a disclosure, not a display option: `HIDDEN` by default on every event, names only, confirmed and not opted out, and never switched on before the approved privacy notice describes it. | `AGENTS.md` §10.10, BR-REQ-039-01, `DECISIONS.md` §32 |
| Staff may enter, rename, cancel and erase a registration, and — at the race-day desk — confirm one on a paper declaration the *participant* signed, give a waiting-list entry a free place, set a number by hand and check people in. Nothing else: no verified-email edit, no participant merge, no staff-signed declaration (a paper acceptance names the staff member who *recorded* it), and no desk verb that bypasses the allocator or an approved declaration. Every staff role works the desk and sees a name, a state and a number there, never an address; the list, the export, cancel and erase stay Administrator-only. Erasing releases the place through the allocator and leaves an audit row that names who and why but never who was erased. | `AGENTS.md` §15.11, BR-REQ-037-03, BR-REQ-037-05, BR-REQ-037-06, BR-REQ-037-07, BR-REQ-037-08, `DECISIONS.md` §67 |
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

**Registration has a door.** `modules/events/ui/RegistrationCta.tsx` is the one control, on the
featured hero and on the event page, rendering exactly one state: the organizer's own link for an
event registered elsewhere, a primary button and the free places for an open one, the waiting list
when it is full, and a sentence — opening date, closed, cancelled — where there is no button to
offer. The count is the allocator's own formula (`readPublicAvailability`), never a second one.
Until `BR-V1.19` the whole lifecycle was built, tested and unreachable: the route existed and no
file under `src/` linked to it.

**The form a stranger fills in is one page, and what loads is the required half.** Fifteen
questions were asked on one screen — 2,697 pixels at 390 wide, now 2,117; a multi-step form was considered and refused in all three shapes it
could take, because each keeps partial answers somewhere that costs more than the scrolling it
saves — hidden fields would put health text in the markup of every later step, a partial row
would need a condition inside the allocator, and a client wizard would have to reimplement the
browser's own validation in two languages. What loads now is what a submission is refused
without, plus the consents; the t-shirt, the club, the display name and the health note sit
in native `<details>` — **open by default since 2026-09-17** (`DECISIONS.md` §59: the club field
was reported missing while folded), still foldable. A consent is never collapsed — a question behind a summary nobody
opens has not been put to them. A rejection the browser could not catch returns to a focusable
error summary by URL fragment, with each field named as a link to that field. The declaration
page names the event and the instant the hold expires, above the text rather than after it
(`DECISIONS.md` §47).

**The club can see which entries are its own.** An optional "I am a Brașov Runners team member"
tick, on the public form and the staff-entered one, inside the optional disclosure whose summary
names the club. Staff were never blocked from registering — `participants` and `staff_users`
share no constraint and the public form reads no session — so what this adds is visibility, not
access. It is a **claim**: matching against `staff_users` would answer "no" for most members,
who have no backoffice account. It grants nothing and appears in no condition in the allocator
or the capacity formula, which a test enforces; the export prints "Yes" or an empty cell and
never "No" (`DECISIONS.md` §48).

**A public participant list, built and switched off.** `events.participant_list_visibility` is
`HIDDEN` for every event and `NAMES` publishes the registered names of confirmed, real, not
opted-out participants and nothing else. It may not be turned on until the club's approved privacy
notice describes the disclosure — the sample notice carries the paragraph with placeholders
(BR-REQ-039-01, `DECISIONS.md` §32).

**The backoffice, and the whole of an event in it.** An organizer signs in, creates a race or
duplicates last year's, sets every column the row carries — type and surface, event status, both
times, the end time and the timezone, the map link and the route link, distance, climb, difficulty, the featured flag, and
the whole registration block including capacity, the window and the approved declaration a
participant signs — previews it, publishes it, archives it when it is over, and deletes one made
by mistake. `src/db/seeds/pilot.ts` is no longer how an event is configured (`DECISIONS.md` §28).
Deleting is Administrator-only and is refused for an event with any registration against it;
archiving is the answer there. Three staff roles asserted on the server, staff administration for
an Administrator, DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED **for the event** — both languages go
live together, and PUBLISHED is refused while either is incomplete — and a save that carries the
version it was loaded with, on the translation *and* on the event row, so a second organizer's
save is a CONFLICT rather than an overwrite. The editor is **one form and one save** now —
Publication, then Settings, then Content as one tabbed panel per language — writing the event row
and both translations in a single transaction, where a stale version anywhere fails the whole save
and writes none of it. Only what a translator would change is entered per language: the title, the
page address, the short description and the two SEO fields. The meeting point, the street address,
the difficulty and the cost are one value for the whole event (`AGENTS.md` §11.7, `DECISIONS.md`
§36), which means the English page shows them in the club's own words — the accepted trade, and
migration `0017` has since dropped the columns they left behind. Built ahead of its milestone on purpose: `DECISIONS.md` §25, §28. Staff sign-in is Auth.js with the Zitadel OAuth provider
(`DECISIONS.md` §26, reversing §24, which was never shipped to anyone). `STAFF_AUTH_MODE=provider`
is the real thing; local and test still use the development switcher of `AGENTS.md` §13.1, and any
environment without a Zitadel tenant runs `STAFF_AUTH_MODE=disabled`, answering 404 to every staff
request. Everywhere there *is* a way in, a signed-out `/admin` goes to sign-in and comes back to
the backoffice afterwards.

**The header carries the club's lockup** — the supplied artwork entire, mountains over
`BRASOV RUNNERS` in the lettering the logo was drawn with, at 44px so that lettering reads. The
browser tab shows the same file. The kit-face wordmark (Facón) is on the **homepage**, above the
listing, and nowhere else (`shared/ui/Wordmark`). Three other arrangements were tried on
2026-09-17 and are recorded in `SiteHeader.tsx` with what was wrong with each (`DECISIONS.md`
§58). The page is `xl` wide; `PAGE_WIDTH` in `theme/brand.ts` is the one place that says so.

**Standing pages are written in an editor.** `modules/content/rich-text`: an allowlisted Tiptap
schema (`AGENTS.md` §11.3) validated on the server, a server renderer that can only emit what the
allowlist names, and one client island for the writing. Headings, bold, italic, links, lists and
quotations — and nothing else, because everything else in StarterKit is switched off in the editor
*and* refused by the schema. Bodies written before it are read through the same module, so no
migration ran. **Pictures are in the text** (`DECISIONS.md` §72, §73): the picture control
shrinks in the browser, stores on R2 like a gallery photo, and inserts a block whose address
the schema accepts and no other; a click on the picture opens a panel for its alt text (empty
until written, never the file name), a caption, one of four widths, and "choose one already
uploaded". `/admin/gallery/pictures` lists every stored picture with where it is used; the
orphan sweep (`media/references.ts`, on the maintenance job) deletes what nothing has
referenced for seven days, drafts counting as references. An event's short description is the
same editor (`excerpt_json`; the plain `excerpt` is derived on save).

**Legal documents.** `legal_documents`/`legal_document_translations` (§12.5), immutable once
approved or referenced. The backoffice **writes** them and never **rewrites** them
(`DECISIONS.md` §46, §53): an Administrator drafts a version, reads it, approves it, and from
that moment its words are fixed — a correction is the next version, and an event *selects* an
approved declaration rather than editing one. A draft that was **never** approved may now be
deleted, because nothing can have relied on it; an approved version is never deleted and its
approval is never withdrawn, and §53 records why the second of those is a registration-lifecycle
change rather than a missing button. The defect §53 found is fixed: the declaration page posts the
id and hash of the text it showed, and a signature against any other version is refused
(`DECISIONS.md` §57). An approved version's page offers **the next version from this one**,
prefilled — that is what "editing" a legal document means here. The club no longer needs a developer to publish
its own wording, which was the last thing standing between a real runner and a registration. Every environment except production is
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

**A registrations backoffice that can change a registration, within three moves.** List and
filter by event and status, one registration's full timeline, a resend that can only ever send
what §15.8 allows for the current status, and a CSV export with formula-neutralized cells
(§15.10). Beyond reading: **enter** a registration for somebody who asked in person — the same
allocator, the same queue position, the same unconfirmed start, `source = STAFF` and the organizer
on the row; **correct** the registered name, and nothing else, because the verified address is the
identity; and **cancel**, which is what "remove them" means, releasing the place to the front of
the waiting list; and **erase**, for somebody who asks to be removed rather than to withdraw,
which takes the declaration with it and is the one thing cancelling cannot do. Every one of the
four writes an `audit_logs` row. A staff-entered registration reaches CONFIRMED only when the participant signs
the declaration from their own email — consent cannot be relayed (BR-REQ-037-03, BR-REQ-037-05,
`DECISIONS.md` §33). Administrator only, asserted on the server.

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

**The guards are finished, and the pool is bounded in time.** §19.4 named five surfaces and
guarded two; token validation is now keyed on the presented token's *hash* — the threat is one
link hammered, not enumeration — and the job endpoints are throttled per job name, counted only
after `JOB_SECRET` verifies. The second surface has a route now: `/registrations/resend` lets a
participant ask for their own link back when nothing arrived, sending only what the current
status allows and answering identically whatever it finds, because a form anybody can type any
address into is a membership oracle the moment it says "no such registration". Uploads are the
fifth and have nothing behind them yet. The database
pool sets `statement_timeout` and `idle_in_transaction_session_timeout`: its size was never the
risk (`docs/PLATFORM.md` § "Connections are not the ceiling" does the arithmetic), one unbounded
query holding a serverless function for 300 seconds was. And a **spent Mailgun allowance now
defers a message instead of discarding it** — the provider refuses a spent daily cap with the
same 400 it uses for a malformed message, which the adapter called permanent, so on the club's
busiest day every message queued after the cap was thrown away (`DECISIONS.md` §40). `/devs`
shows the volume against the allowance before a window opens, and explains every configuration
enum rather than only reporting its value (§41).

**1022 unit and integration tests, 140 end-to-end runs (70 per viewport project), and five
concurrency tests.** `yarn test` needs no database — PGlite runs real
PostgreSQL in process. `yarn test:e2e` needs `docker compose up -d db` and a seed, and so does
`yarn test:concurrency`, which needs two genuine connections and would prove nothing on a
single-connection database.

**A photo gallery, on R2.** Albums with photos shrunk in the browser and re-encoded on the
server to two WebP variants (no original, no EXIF), stored through the §17 adapter —
`STORAGE_MODE` derives `local`/`fake`/`r2`/`unconfigured` from the five `R2_*` variables.
The bucket exists since 2026-09-18 and both deployed environments have the variables
(`SETUP.md` §32). Public `/galerie`; "Galerie" in the nav while an album is published
(BR-REQ-054-01, `DECISIONS.md` §66).

**The race-day desk** (`/admin/checkin`, "Ziua cursei"; `DECISIONS.md` §67). Every staff role,
on a phone: scan a runner's QR or type a name, a number or the code; mark them here; confirm a
pending registration on a paper declaration the participant signed (recorded under the
volunteer's name); give a waiting-list entry a free place; type a number; enter a walk-in with
the fast track. Nothing at the desk places anybody past capacity. Every confirmation mints
`registrations.checkin_code`; the confirmation email carries the code and a hosted QR;
participants can say "I am here" from their own link from the day before. `/admin/guide`
explains the platform per role, volunteers first; `SETUP.md` §34 is the volunteer-account
procedure.

**The event editor asks for what organizers think in** (`DECISIONS.md` §64, §70, §71): a date
and a 24-hour time; a duration in minutes rather than an end; a gun time only on a race; a full
description per language in the §11.3 rich-text editor; a Strava event link and a YouTube film;
recurrence — cadence, days of the week, weeks — on the creation form, with the events list
publishing a whole series at once.

**The database gets to sleep** (`DECISIONS.md` §68). A request that queues an email drains the
outbox after its own response; the external monitors run every fifteen minutes by day and
hourly at night, Romania time, because Neon's free month is 100 CU-hours and a five-minute
pinger spends 180. `/devs` shows the month's figure with `NEON_API_KEY` (`SETUP.md` §33).

**Race week, for the runner and the desk** (`DECISIONS.md` §76–§79). Within seven days of
the featured event the homepage counts down on the event's own calendar and, once
registration has closed, says to come to the desk with the QR; "Alte evenimente" folds on a
phone. `/inscrieri/ale-mele` ("Înscrierile mele", in the footer): one address, one link, every
active registration — code and QR, "I am here", cancel — on the `MANAGE_PROFILE` token, its
first use; the same oracle rule as "send me my link again". The desk row and the registration
page carry "email respins" with Mailgun's reason when a message bounced. A confirmed row's
resend is the confirmation itself, QR included; the bib sheet prints one per page on request.
**Gmail dots are two addresses** since canonicalization version 2 (`DECISIONS.md` §74): the
club rehearses from its own inbox; the plus tag still collapses.

Not built: the rest of the CMS — articles and what M2–M4 name (multi-distance races, one bib
per race across distances, results, runner profiles). A custom domain for the bucket
(`media.<domain>`) is optional and undone.

**What is deployed.** Production on the club's `.com` and QA on its `qa.` subdomain,
each a Vercel project (`fra1`) over its own Neon project (Frankfurt), sharing nothing.
Production tracks `main` and QA tracks `qa`; a release is the `qa → main` PR, whose merge
fires the gated migration workflow and whose build waits for that migration
(`docs/RUNBOOKS.md` § Deploy a release). The hostnames live in `SETUP.md` §26 and nowhere
else; `APP_BASE_URL` is the only thing that knows them. **Staff sign-in works on both**: each
has its own Zitadel application on the one tenant (`STAFF_AUTH_MODE=provider`), and the owner
is SUPERADMIN on production. Production email is **live** since 2026-09-18; QA stays
`allowlist`.

Two settings that are not obvious and cost an afternoon between them: the Zitadel application
needs **"Include user's profile info in the ID Token"** enabled, or the ID token carries no
`email` claim and every sign-in is refused by the allowlist gate that cannot see an address;
and the first Administrator is a `staff_users` row inserted by hand, because the screen that
invites people is itself behind the sign-in it would be granting.

**Still owed, all of it account creation or a decision rather than code** (as of 2026-09-18;
`/admin/tasks` shows the same list with the steps, read from the system):

1. ~~cron-job.org monitors~~ — done 2026-09-18 evening: six jobs, both environments `ok`.
2. ~~Mailgun sending domain~~ — done 2026-09-18 evening: `mail.` subdomain verified,
   production sends live, webhook signed; `contact@mail.<domain>` forwards to the owner until
   the club has a mailbox; Zitadel's own mail goes through the same domain. QA still uses the
   sandbox (its own sending key is optional). Procedure: `SETUP.md` §35.
3. ~~Production Zitadel application~~ — done 2026-09-17: application, `STAFF_AUTH_MODE=provider`,
   the owner's SUPERADMIN row. Sign in at `/admin` on the production host.
4. **The club's approved legal texts** — privacy notice, terms, declaration — written and
   approved in `/admin/legal` on production. Until then production correctly refuses every
   registration.
5. **Volunteer accounts** for race day (`SETUP.md` §34) and a rehearsal on QA.
6. Optional: `NEON_API_KEY` + `NEON_PROJECT_ID` on both Vercel projects (`SETUP.md` §33 — a
   QA-scoped key exists since 2026-09-18, waiting to be pasted); a custom domain for the R2
   bucket; the retention and support decisions of `SETUP.md` §30.

Open pull requests are listed on GitHub; the convention below says who merges them.

## Stack and providers, as decided

| Layer | Decision | Status |
| --- | --- | --- |
| App | Next.js 16 App Router, TypeScript 5.9 strict, `src/`, Yarn 4, Node 22.14.0 | done |
| UI | Material UI 9 + Emotion, `@mui/material-nextjs/v16-appRouter` | done |
| i18n | `next-intl` 4; `ro` default, `en`; `localePrefix` always; no cross-locale fallback | done; both locales published |
| Data | PostgreSQL on Neon, Frankfurt; Drizzle over `node-postgres`, pooled URL. Local: `docker compose up -d db` | both projects live and migrated (schema `0028` on QA, `0027` on production after `BR-V1.35`); the gated `migrate.yml` run on a push to `main` is the only way production migrates. Free plan: 100 CU-hours a month per project — `DECISIONS.md` §68 |
| Hosting | Vercel Hobby, function region `fra1`; one project per environment | both live: production on the club's `.com` since 2026-09-17, QA on its `qa.` subdomain (`SETUP.md` §26). The build waits for the migration it was compiled against (`scripts/wait-for-migration.mjs`) |
| Jobs | No in-process interval — serverless has no process for one. The request that queues an email drains the outbox after its own response (`notifications/drain.ts`); an external HTTP pinger POSTs both endpoints every fifteen minutes by day and hourly at night (Romania time) with each environment's `JOB_SECRET`; `.github/workflows/scheduled-jobs.yml` is the backstop, not the clock | all six monitors live since 2026-09-18 (production 15 min by day / hourly at night per endpoint, QA hourly); both `/api/health` `ok` |
| Auth | staff only. **Decided:** Auth.js with the Zitadel OAuth provider, `staff_users` as the server-side allowlist (`DECISIONS.md` §26, reversing §24). Roles, helpers, backoffice, the development switcher and the provider wiring are all built, and a QA tenant exists | built; live in QA |
| Email | Mailgun. Sandbox first (5 authorized recipients, dev only), then the club domain. A `*.vercel.app` domain cannot be verified — its DNS is not ours. Templates, the outbox jobs and the webhook are built; the adapter throws rather than sending live | built; delivery to real people needs the domain |
| Storage | Cloudflare R2 behind the four-method adapter in `AGENTS.md` §17; one bucket, per-environment prefixes; public reads on the `r2.dev` address | live: bucket `brasovrunners-media` created 2026-09-18, variables on both Vercel projects (`SETUP.md` §32) |
| Spam | Honeypot + timing check on registration submission, built. Cloudflare Turnstile only if that fails — it is a processor the unapproved privacy notice must name | built (honeypot + timing); Turnstile not built |

**Before installing anything:** verify the current API against the library's documentation
(Context7 or the official docs site). Next 16, MUI 9, next-intl 4 and Drizzle 0.45 are newer
than any training data can be trusted on. Pin exact versions in `package.json`.

## Working conventions

- **Fast, clean, easy to work on — the owner's standing instruction, and it applies to every
  change.** Prefer nothing over a dependency, the platform over a library, and what is already
  installed over something new. Server Components by default; a client island has to earn it.
  The header and the landing page are what every visitor pays for. `AGENTS.md` §1.5.
- **Commit on a feature branch, push it, open the PR into `qa`; never push to `qa` or `main`.**
  The owner merges pull requests and said so on 2026-09-17 ("commit and push for me and create
  PRs"); before that the rule was to stage and hand back a message. A release is the `qa →
  main` PR the owner merges; approving the production migration run and redeploying after it
  are authorised ("approve / deploy prod for me").
- Branch from `qa` with `--no-track`, PR into `qa`. `main` is production. `SETUP.md` § Contributing.
- Windows development machine, Linux CI. Anything with paths or line endings: test both.
- Tests are named by the `BR-REQ-*` they cover, or by the `AGENTS.md` section for cross-cutting
  mechanisms (jobs, health). `WEEKEND.md` records the six that mattered for the original pilot.
- No `BaseService`, barrels, dispatch tables, or wrappers around MUI. `AGENTS.md` §1.3.
- When a doc contradicts this file, the doc wins and this file is wrong — fix it here.
