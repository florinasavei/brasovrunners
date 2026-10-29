<!-- PROJECT_BASELINE: BR-V3.93-2026-10-29 -->

# CLAUDE.md — start here if you are an AI coding agent

**Baseline `BR-V3.93-2026-10-29`** · [changelog](./CHANGELOG.md) · [weekend plan](./WEEKEND.md)

Brașov Runners: a bilingual website and free event-registration platform for a small running
club in Brașov, Romania. One Next.js App Router monolith, PostgreSQL, Material UI.

## Current mode: production is live, the club is finishing its accounts

M1 — event pages, the full registration lifecycle, staff sign-in, legal document versioning,
transactional email, a registrations backoffice, and since 2026-09-18 the race-day desk, a
photo gallery on R2, recurring events and a rich-text event description — exists and is
tested. **Production serves the club's `.com`** (first deployment 2026-09-17; it runs the
baseline above) and **QA serves its `qa.` subdomain** (the same release, plus whatever has
merged into `qa` since), each on its own
Neon project in Frankfurt, each with staff sign-in through Zitadel; every environment but
production carries clearly marked sample legal text (`DECISIONS.md` §29), so the participant
journey can be walked on QA end to end. What is left is not application code — it is
`/admin/tasks`, which reads it from the system, summarised in `docs/OWNER-TODO.md`.

[`WEEKEND.md`](./WEEKEND.md) records the narrower pilot this replaced — Romanian event pages
only, no registration, no email, no login — and is now a historical scope document rather than
the current one. The original ten-pull-request M1 plan is a table in `DECISIONS.md` §118; it exists.

## Commands that exist right now

```text
yarn setup        install the tracked git hooks and the `git gone` alias — once per clone
yarn dev          Next.js dev server; needs .env.local (copy .env.example)
yarn build        production build
yarn start        production server, honours PORT
yarn lint         ESLint
yarn typecheck    tsc --noEmit
yarn test         unit and database tests; no database or Docker needed (PGlite)
yarn test:categories  the six test categories (trust, drawn, pages, database, guards, logic) and their files
yarn test:fast    trust + guards + logic — what the pre-commit hook runs on the staged files' tests
yarn test:skip    every category but the ones named (`yarn test:skip drawn pages`); «trust» is never left out
yarn test:concurrency  two-connection suite (BR-REQ-051-01 criterion 5); needs the database
yarn test:clock   the suite with the real clock at +1 month, +1 year, +10 years: a test that
                  fails only there pins a date the calendar will reach (docs/DEVELOPMENT.md);
                  `--concurrency` for the two-connection suite
yarn test:e2e     Playwright, 320px mobile and desktop; needs the database running
yarn test:e2e:dev  Playwright against `next dev`: every backoffice and public route, twice; minutes; not in CI (§370)
yarn check        check:static + test; CI runs this (the static half on one runner, the tests on four shards); the pre-commit hook runs check:static and the tests of the staged files
yarn check:static  docs:check + secrets:check + migrations:check + typecheck + lint — everything in `check` but the tests
yarn docs:check   documentation consistency
yarn secrets:check  refuse a commit carrying a provider credential — the repository is public (§98)
yarn migrations:check  a migration expands or contracts, never both (AGENTS.md §7.6)
yarn db:migrate   apply migrations locally · db:seed sample events · db:studio browse
yarn db:seed:legal  the sample legal documents alone; never deletes, safe on a live database
yarn db:migrate:env  apply migrations to local|qa|production — the only supported way to
                  migrate a deployed database (AGENTS.md §7.6, DECISIONS.md §31)
yarn smoke        ask a deployment's /api/health?deep=1 whether it works; ends every deploy
yarn idle:measure  Neon's wakes and Vercel's requests while nobody visited (docs/PLATFORM.md § Idle cost)
yarn db:sizes     the database's size, its largest tables and 30-day growth; `--env qa|production` (read-only; docs/PLATFORM.md § Keeping Neon and Vercel light)
yarn release      versioned archive and share copies under dist/
yarn calendar:preview  the calendar picture drawn without a server, every format, to dist/calendar-preview/
yarn batch:merge  merge branches into the one checked out; the journal, catalogues and tests by rule
yarn docs:land    land a batch's documents: a dispatcher's manifest, or `--tree` for the branch's
                  own `.release/*.json` entries (`.release/README.md`)
yarn ship         merge a landed PR into qa, release it and wait for production; from a phone,
                  the label `ship` on the PR runs all of it on GitHub (`docs/RUNBOOKS.md`)
yarn handoff      where everything stands, for a session taking over from one that stopped
                  (credits, a limit): baselines, open PRs, unmerged branches, the next migration
                  number, local work not on GitHub (`docs/DISPATCHER.md` § When a session stops)
```

Full list with explanations: [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md). Do not write a
command into a document until it is in `package.json`.

**Toolchain:** Node 22 (`.nvmrc` says the major, `22`; §125), Yarn 4.18.0 via Corepack, TypeScript 5.9.3 — not 7,
which `typescript-eslint` refuses. Tests need no database: PGlite runs real PostgreSQL in
process. Concurrency tests must not use it; see `docs/DEVELOPMENT.md`.

## Read order

−1. **Taking over from a session that stopped** (credits, a usage limit, a closed laptop)? Run
   `yarn handoff` first, then `docs/QUEUE.md` § «Where things stand» and `docs/DISPATCHER.md`
   § When a session stops.
0. [`docs/VIBECODING.md`](./docs/VIBECODING.md) — one page: the loop, where things live, the rules that bite.
1. This file.
2. `AGENTS.md` §1.5 (priority order) and the one §10 subsection for the rule you are touching.
3. The `BR-REQ-*` you implement, in `SPECS.md`. Name it before you write code.
4. Everything else on demand — `WEEKEND.md` (the pilot this replaced) only for its reasoning. `README.md` § Where a rule lives is the index.

## Rules that cannot be broken, pilot or not

These carry trust. `AGENTS.md` §1.5 ranks them above every other goal, including speed.

| Rule | Where it lives |
| --- | --- |
| No overbooking, ever, under real concurrent load — not merely under a single-connection test. `tests/concurrency/capacity.test.ts` is what the locked capacity transaction is checked against; the pilot's `CHECK (capacity IS NULL)` guard is gone now that it passes. A registration an Administrator put on «Lista de invitați speciali» (the special guests list) consumes no place — the formula's one explicit exclusion, on that audited column (§643, §648); the event's public-count ticks never put it into the places line. A live invitation by email, unless sent «Pe lista de invitați speciali», holds one counted place until its deadline, its acceptance or its withdrawal, and its acceptance moves that place to the registration in the same transaction (§647). | `AGENTS.md` §10.6, BR-REQ-034-01, BR-REQ-034-02 |
| No registration without an approved declaration and privacy notice, and no legal text in effect that the club did not approve. The platform ships complete texts as templates (`legal-documents/templates/`), with the club's four facts as visible `<PLACEHOLDER>`s; everywhere but production the seed wraps them in a not-approved banner, and production is refused a seed — the club approves them in `/admin/legal` ("start from the platform's text"). The refusal has a test. | `AGENTS.md` §10.8, §29; BR-REQ-053-01; `DECISIONS.md` §29, §95 |
| Publication is one state per event: both languages go live together, and PUBLISHED requires a complete translation in every locale. A locale with no translation is a 404, never the other language's text. | `AGENTS.md` §11.2, BR-REQ-040-02, `DECISIONS.md` §28 |
| A test registration behaves exactly like a real one in the queue — `kind` appears in no condition in the allocator or the capacity formula — is omitted from every count the club is given, and cannot exist in production. | `AGENTS.md` §12.6, BR-REQ-037-04, `DECISIONS.md` §30 |
| A public participant list is a disclosure, not a display option: `HIDDEN` by default on every event, names only, having ticked "I want to appear" (§143), and never switched on before the approved privacy notice describes it. It shows the confirmed. Only while the notice in force names `{{participantListStates}}` (§396) does it also show the ticked pending and waiting list, each name with its state — the waiting list only when the event's «Lista de așteptare e publică» is on as well (§628); how many wait is its own switch, «Arată public câți așteaptă» (§634). Never a cancelled, expired, unconfirmed-address or test registration. | `AGENTS.md` §10.10, BR-REQ-039-01, `DECISIONS.md` §32 |
| Staff may enter, rename, cancel and erase a registration, and — at the race-day desk — confirm one on a paper declaration the *participant* signed, give a waiting-list entry a free place, set a number by hand and check people in; an Administrator may offer a chosen waiting-list entry a place at any time, adding one supplementary place to the capacity when none is free, confirmed and audited («Trimite-i oferta», `DECISIONS.md` §642); and an Administrator may vouch remotely for an address never confirmed and give that row a place — a counted free one, or the same one supplementary place, confirmed and audited («Dă-i un loc acum», `DECISIONS.md` §637, §642) — the person still signing their own declaration; and an Administrator may put a registration on «Lista de invitați speciali» or take it off, through the allocator and audited, putting on only while the event's «Folosește lista de invitați speciali» is on (`DECISIONS.md` §643, §648); and an Administrator may invite named people by email to an event, each invitation holding a place until its deadline — with one confirmed, audited supplementary place per invitation on a full race or while anyone waits — while the person registers and signs themselves from the link; and an Administrator may correct any answer the person typed, audited field by field («Modifică datele», `DECISIONS.md` §645) — the address, the consents and the declaration stay the person's. Nothing else: no verified-email edit, no participant merge, no staff-signed declaration (a paper acceptance names the staff member who *recorded* it), and no desk verb that bypasses the allocator or an approved declaration. Every staff role works the desk and sees a name, a state and a number there, never an address. The Organizer reads the whole list, the export and the race numbers and changes nothing on them (§289); cancel, erase, correcting an answer, resend and the printing mark stay Administrator-only, and the Tehnic role gets none of it. Erasing releases the place through the allocator and leaves an audit row that names who and why but never who was erased. | `AGENTS.md` §15.11 (verb 6 for «Lista de invitați speciali», verb 7 for invitations), BR-REQ-037-03, BR-REQ-037-05, BR-REQ-037-06, BR-REQ-037-07, BR-REQ-037-08, `DECISIONS.md` §67 |
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

## What exists right now — where to look

Everything in M1 is built, tested and deployed. This file no longer keeps a line per feature or a
line per batch; three places do, and they are kept by the landing itself:

- **What shipped, per release:** `CHANGELOG.md`, newest first. `docs/QUEUE.md` → «Released» has
  one row per release with its `§` numbers.
- **Why each thing is the way it is:** `DECISIONS.md`, one numbered section per decision. Read
  the section before changing the thing; search it by the screen's words (they are quoted in
  «…») or by the module's name.
- **What the code must do:** `SPECS.md`, the `BR-REQ-*` and their numbered criteria.

The areas, and where their code lives:

| Area | Code | Start reading at |
| --- | --- | --- |
| Public site: listing, calendar, event pages, gallery, «Echipa», FAQ, members' zone | `src/app/[locale]/`, `src/modules/content/` | §28, §89, §406, §524, §525 |
| Registration: the form, the one allocator, holds, waiting list, family on one address, declarations, race numbers, the desk | `src/modules/registrations/` | `AGENTS.md` §10.5–§10.6, §67, §104, §389, §519, §543 |
| Email: 27+ message types through the outbox, Mailgun and Gmail, the newsletter | `src/modules/notifications/`, `src/infrastructure/email/`, `src/modules/newsletter/` | §68, §81, §392, §443, §445, §513 |
| Legal texts: templates, approval, versions, the signed PDF | `src/modules/legal-documents/` (the templates in `templates/`) | §29, §95, §418, §515 |
| Backoffice: roles, the event editor, «Setări», «Sarcini», registrations | `src/app/[locale]/admin/`, `src/modules/staff-identity/` | §103, §406, §450, §516, §542 |
| Costs and the database's brakes: the cache, the governor, Neon's limits | `src/modules/public-cache/`, `src/modules/resilience/` | §327, §333–§335, §447, §479, §549 |
| Platform: Vercel + Neon per environment, migrations, health, monitors | `scripts/`, `.github/workflows/` | §31, §62, §98, §280; `docs/PLATFORM.md` |

`/admin/tasks` shows what the club still owes and what it pays, read from the live system;
`/devs` (under «Setări» → «Configurație») shows the configuration, Neon's month, Vercel's
deployments and the outbox.

Not built: articles and what M2–M4 name (multi-distance races, runner profiles; results exist
since §808); a custom domain for the bucket. `SETUP.md` is the numbered procedures with their values;
`docs/VIBECODING.md` is the short way in.

**Two settings that cost an afternoon between them:** the Zitadel application needs
**"Include user's profile info in the ID Token"**, or every sign-in is refused by the allowlist
that cannot see an address; and the first Administrator is a `staff_users` row inserted by
hand, because the screen that invites people is behind the sign-in it would grant.

**What the club still owes** — approving the legal texts, the race's event, volunteer accounts and the rest of the
club's own work — is `/admin/tasks` on each environment (read from the live system: the authority) and
[`docs/OWNER-TODO.md`](./docs/OWNER-TODO.md) (the summary with its history). None of it is an AI agent's to do; the
values behind it live in `.env.local` and on the Vercel projects, never in this public repository.

Open pull requests are listed on GitHub; the convention below says who merges them.

## Stack and providers, as decided

| Layer | Decision | Status |
| --- | --- | --- |
| App | Next.js 16 App Router, TypeScript 5.9 strict, `src/`, Yarn 4, Node 22 | done |
| UI | Material UI 9 + Emotion, `@mui/material-nextjs/v16-appRouter` | done |
| i18n | `next-intl` 4; `ro` default, `en`; `localePrefix` always; no cross-locale fallback | done; both locales published |
| Data | PostgreSQL on Neon, Frankfurt; Drizzle over `node-postgres`, pooled URL. Local: `docker compose up -d db` | both projects live and migrated on `0065` (2026-09-24); the gated `migrate.yml` run on a push to `main` is the only way production migrates. Launch since 2026-09-22; **the pages read the plan from Neon's own answer** (the project row's `owner.subscription_type`), and `platform_settings.neonPlan` is only the fallback without a key (`DECISIONS.md` §280, §306, §326). **Capped since 2026-09-23**: production 0.25–1 CU and 100 CU-hours a month, QA 0.25 CU and 30 — a project that reaches its limit is suspended until the next period (`SETUP.md` §40) |
| Hosting | Vercel Hobby, function region `fra1`; one project per environment | both live: production on the club's `.com` since 2026-09-17, QA on its `qa.` subdomain (`SETUP.md` §26). The build waits for the migration it was compiled against (`scripts/wait-for-migration.mjs`) |
| Jobs | No in-process interval — serverless has no process for one. The request that queues an email drains the outbox after its own response (`notifications/drain.ts`); an external HTTP pinger POSTs both endpoints every fifteen minutes by day and hourly at night (Romania time) with each environment's `JOB_SECRET`; `.github/workflows/scheduled-jobs.yml` is the backstop, not the clock | eight monitors, as set 2026-09-24 (`SETUP.md` §40): production jobs every 15 min by day and hourly at night, production health hourly, QA outbox hourly, maintenance every 2 h, health every 6 h; both `/api/health` `ok` |
| Auth | staff only. **Decided:** Auth.js with the Zitadel OAuth provider, `staff_users` as the server-side allowlist (`DECISIONS.md` §26, reversing §24). Roles, helpers, backoffice, the development switcher and the provider wiring are all built, and a QA tenant exists | built; live in QA |
| Email | Mailgun, EU region, on the club's `mail.` subdomain — production with its key, QA with its own (§307); the US sandbox was the first step (§37) and is unused. A `*.vercel.app` domain cannot be verified — its DNS is not ours. Templates, the outbox jobs and the webhook are built | live: production `live`, QA `allowlist` with the star (§163), every QA subject tagged `[QA]`; both share the domain's daily allowance and its webhooks |
| Storage | Cloudflare R2 behind the four-method adapter in `AGENTS.md` §17; one bucket, per-environment prefixes; public reads on the `r2.dev` address | live: bucket `brasovrunners-media` created 2026-09-18, variables on both Vercel projects (`SETUP.md` §32) |
| Spam | Honeypot + timing check on registration submission, built. Cloudflare Turnstile behind `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` (`DECISIONS.md` §97); the privacy notice names it | built; Turnstile on when the keys are set; a contact message that passes every gate but looks automated is delivered marked `[posibil spam]`, never dropped (§310) |
| Weather | Open-Meteo's hourly forecast — public, keyless, no account and no variable; fetched on the server for the club's coordinates, cached an hour, silent on any failure, credited on the page (CC BY) (§402) | built; nothing to set up; its last answer on `/devs` → Stare |
| Translation | DeepL API Free (500 000 characters a month, EU) behind a one-method adapter; `TRANSLATE_PROVIDER=deepl|off`, `DEEPL_API_KEY` (§464; one always-visible «Copiază și tradu tot: RO → EN» per editor §482) | built; the key is the club's — until it is set the editors' button is greyed and links the steps and `/admin/tasks` carries the row |

**Before installing anything:** verify the current API against the library's documentation
(Context7 or the official docs site). Next 16, MUI 9, next-intl 4 and Drizzle 0.45 are newer
than any training data can be trusted on. Pin exact versions in `package.json`.

## Working conventions

- **Fast, clean, easy to work on — the owner's standing instruction, and it applies to every
  change.** Prefer nothing over a dependency, the platform over a library, and what is already
  installed over something new. Server Components by default; a client island has to earn it.
  The header and the landing page are what every visitor pays for. `AGENTS.md` §1.5.
- **A small bug is a small fix — no rabbit holes.** The owner, 2026-10-22: «Ar trebui să poți fixa
  astfel de bug-uri ușor, rapid și cu puțini tokens consumați… nu mai intra în rabbit-hole.» Find the
  one place, change it, run the tests of what you touched, commit, push, PR, `ship`, one short line
  when it is live. No audit, no agents, no new guards, no waves, no refactor beside it unless the owner
  asks; anything wider is a one-line question first, never a start.
- **Commit on a feature branch, push it, open the PR into `qa`; never push to `qa` or `main`.**
  The owner merges pull requests and said so on 2026-09-17 ("commit and push for me and create
  PRs"); before that the rule was to stage and hand back a message. A release is the `qa →
  main` PR the owner merges; approving the production migration run and redeploying after it
  are authorised ("approve / deploy prod for me").
- Branch from `qa` with `--no-track`, PR into `qa`. `main` is production. `SETUP.md` § Contributing.
- Windows development machine, Linux CI. Anything with paths or line endings: test both.
- The owner also works from a phone through Claude Code on the web. A cloud session prepares
  itself (`scripts/cloud-setup.sh`, run by the `SessionStart` hook in `.claude/settings.json`:
  dependencies, the image's PostgreSQL 16 migrated one transaction per migration and seeded,
  local values only; §501); keep that script working when you change setup, the database
  version or the dev server. `docs/DEVELOPMENT.md` § Coding from the phone.
- Tests are named by the `BR-REQ-*` they cover, or by the `AGENTS.md` section for cross-cutting
  mechanisms (jobs, health). `WEEKEND.md` records the six that mattered for the original pilot.
- No `BaseService`, barrels, dispatch tables, or wrappers around MUI. `AGENTS.md` §1.3.
- When a doc contradicts this file, the doc wins and this file is wrong — fix it here.
