<!-- PROJECT_BASELINE: BR-V2.45-2026-09-27 -->

# Running this locally

**Baseline `BR-V2.45-2026-09-27`** · [agent entry point](../CLAUDE.md) · [pilot scope](../WEEKEND.md)

Everything here is a command that exists today. If a command is in this file it is in
`package.json`; if it is not, it has not been built yet.

## Prerequisites

| | |
| --- | --- |
| **Node** | `22` — the major, from `.nvmrc`; CI reads that same file (§125). `engines.node` says `22.x`, because a host selects a Node *major* and refuses to install when an exact patch it cannot supply is demanded. |
| **Yarn** | 4.18.0, via Corepack. It ships with Node — you do not install yarn yourself. |
| **A database** | Only for event pages: `docker compose up -d db`. The home page and the whole test suite need none. |

```bash
node --version        # must print v22.something
corepack enable       # once per machine; makes `yarn` resolve to 4.18.0
```

If `node --version` disagrees, use a version manager (`nvm use`, `fnm use`) — `.nvmrc` is there
for exactly that.

## First run

```bash
git clone https://github.com/florinasavei/brasovrunners.git
cd brasovrunners
corepack enable
yarn install --immutable
yarn setup                    # points git at .githooks; once per clone
cp .env.example .env.local
```

`yarn setup` configures this clone's git and is not optional. It installs the pre-commit hook
that runs `yarn check` — the only thing standing between you and a red pull request from a
green working copy — and adds a `git gone` alias:

```bash
git gone     # delete local branches whose remote branch was deleted after merge
```

It uses `git branch -D` deliberately. This repository squash-merges into `qa`, so the squashed
commit differs from the branch's own and plain `-d` refuses every time. The safety is the
`[gone]` filter: a branch only reaches that state once its remote copy is deleted, which
happens on merge. A branch you never pushed has no upstream, is never `[gone]`, and is never
touched. Both settings are repository-local; your global git config is untouched.

Then fill in `.env.local`:

| Variable | What to put in it |
| --- | --- |
| `APP_ENV` | `local` |
| `APP_BASE_URL` | `http://localhost:47821`. `yarn dev` overrides it with the port it actually bound. |
| `DATABASE_URL` | Your Neon **pooled** connection string, the host containing `-pooler`. Region Frankfurt. |

`.env.local` is git-ignored and must never be committed. `.env.example` carries the names and
safe examples only — never a real value (`AGENTS.md` §8).

### Set up the database

```bash
docker compose up -d db   # local PostgreSQL on 5432
yarn db:migrate           # applies src/db/migrations
yarn db:seed              # four sample events, Romanian and English published
yarn dev                  # http://localhost:47821 → redirects to /ro
```

`docker-compose.yml` gives you a local PostgreSQL with throwaway credentials. Use Neon instead
by pointing `DATABASE_URL` at its **pooled** connection string — nothing else changes.

`yarn db:seed` clears both tables and refuses to run when `APP_ENV=production`.

### No database yet?

Skip the two `db:` commands and run `yarn dev` anyway — the home page reads nothing from the
database, and `yarn check`, the full test suite, `yarn build` and `yarn lint` all pass without
one. Leave `DATABASE_URL` **commented out** rather than empty: an empty value fails URL
validation, while an absent one is allowed. Come back here when you have a Neon project.

## Everyday commands

```text
yarn dev                 dev server on http://localhost:47821 (next free port if taken)
yarn build               production build
yarn start               production server; honours PORT
yarn check               docs:check + secrets:check + migrations:check + typecheck + lint + tests — the pre-commit gate
yarn test                all tests
yarn test:unit           pure-rule tests only
yarn test:integration    database tests only
yarn test:concurrency    the two-connection suite; needs the database running
yarn test:watch          re-run on change
yarn test:e2e            browser tests, mobile and desktop; needs the database running
yarn db:seed:legal       the sample legal documents alone; never deletes, safe on a live database
yarn db:migrate:env      apply migrations to one named environment (local|qa|production)
yarn smoke               ask a deployment's /api/health?deep=1 whether it actually works
yarn idle:measure        Neon's wakes (and, with --vercel-project, the last hour of requests) while nobody visited; docs/PLATFORM.md § Idle cost
yarn test:e2e:ui         the same, in Playwright's UI mode
yarn test:e2e:dev        every backoffice and public route against `next dev` (E2E_DEV=1; port 4784, or a running `yarn dev` via E2E_PORT); minutes; not on the docs-check CI a pull request waits on — `.github/workflows/e2e-dev-nightly.yml` runs it once a night at 01:37 UTC on `qa` instead (§370, §426)
yarn typecheck           tsc --noEmit
yarn lint                ESLint
yarn docs:check          documentation consistency
yarn secrets:check       refuse a commit carrying a provider credential (the repository is public)
yarn migrations:check    a migration expands or contracts, never both (AGENTS.md §7.6)
yarn db:generate         regenerate migrations after editing src/db/schema/
yarn db:migrate          apply migrations
yarn db:studio           browse the database
yarn db:seed             reset and reseed sample events
yarn flags:sync          re-copy the country flags into public/flags/ (runs on install)
yarn db:reset:local      drop both schemas, migrate and seed from nothing
yarn release             versioned archive and share copies under dist/
```

`yarn check` is the single gate. The pre-commit hook runs it and CI runs it, so they cannot
drift. When a step is added to CI that a developer can run locally, it belongs inside `check`.

**A hook forgets git's own environment first (§553).** git exports `GIT_DIR` and `GIT_INDEX_FILE`
into a hook, so everything `yarn check` starts inherits them: on 2026-09-28 a test's throwaway
repository ran `git init`, `git add` and `git rm` against the repository being committed (1 942
staged deletions, then `core.bare=true` in the main checkout). Both hooks in `.githooks/` begin
with `unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX`, and a test that spawns git — or a
script that runs git — passes `env: gitEnv(…)` from `tests/helpers/git-env.ts`, never
`process.env` as it is; `tests/unit/scripts/hook-git-env.test.ts` holds both ends.

**Dead code.** `node scripts/unused-exports.mjs` lists the exports under `src/` that no other file
under `src/`, `tests/`, `scripts/` or `docs/` names and their own file does not use — a grep walk,
no dependency; `--types` adds types and interfaces, `--local` adds exports only their own file uses.
It is a list of candidates to read, not a gate, and not in `check`; the script's `ALLOWLIST` names
what is kept on purpose, with the reason (§489).

## The dev server port

`yarn dev` starts on **47821** — the same URL every day, and far from 3000, 5173, 8000 and
8080 so it does not collide with other projects. If something already holds it, the server
steps up to 47822, 47823 and so on, printing which port it chose.

`next dev` cannot do this alone: given an explicit `--port` it fails with `EADDRINUSE` rather
than stepping up, and it only walks the port range when no port was specified at all. So
`yarn dev` runs [`scripts/dev.mjs`](../scripts/dev.mjs), which probes for a free port first.

That script also exports `APP_BASE_URL` matching the port it chose. Next's loader does not
overwrite variables already in the environment, so the chosen port always wins over the value
in `.env.local` and the two cannot disagree. `yarn build` and `yarn start` do not go through
the script, so `.env.local` governs there.

Start somewhere else with `DEV_PORT=50000 yarn dev`.

Note that Next refuses to run two dev servers for the same project regardless of port — you
will see "Another next dev server is already running". That is Next's own lock, not this
script.

## Tests

**The tests need no database, no Docker and no setup.** They run PGlite — real PostgreSQL
compiled to WebAssembly, inside the test process — and apply the same migrations that run
against Neon. `yarn test` and you are done.

That is a deliberate choice over `pg-mem`, which emulates PostgreSQL in JavaScript and
silently accepts SQL that real PostgreSQL rejects. `SELECT ... FOR UPDATE` is a no-op there,
which is precisely the kind of thing that would make a capacity test pass while production
overbooks.

> ### The limit, and it is a hard one
>
> PGlite is **single-connection**. It cannot express two transactions racing each other.
>
> Every concurrency requirement — BR-REQ-034-02 (twenty simultaneous confirmations against one
> free place), BR-REQ-034-03, parallel waiting-list promotion — **must** run against a real
> PostgreSQL server. Writing those against PGlite produces a green suite and an overbooked
> event. Add Docker or Testcontainers *alongside* this harness rather than replacing it; these
> tests are fast and need no daemon, which is worth keeping.

**The suite that needs the other kind of database.** `yarn test:concurrency` runs
`tests/concurrency/` against a real PostgreSQL server, with genuinely parallel connections. Two
files now: `cms-conflict.test.ts` proves BR-REQ-051-01 criterion 5 (two organizers saving one
event, one save refused as stale, the other surviving whole), and `capacity.test.ts` proves
BR-REQ-034-02 and BR-REQ-034-03 — twenty simultaneous confirmations against one free place
produce exactly one winner, and a released place goes to the front of the waiting list rather
than to a concurrent new registration. It has its own configuration
(`vitest.concurrency.config.mts`), it is excluded from `yarn test`, and it fails loudly rather
than skipping when `DATABASE_URL` is unset — a concurrency suite that quietly passes with
nothing connected is worse than no suite at all.

```bash
docker compose up -d db && yarn db:migrate
yarn test:concurrency
```

**End-to-end tests are separate.** `yarn test:e2e` builds the app, starts the production
server and drives a real browser at 320px and at desktop width, so it needs the database
running and a seeded set of events. It is deliberately **not** part of `yarn check`: that gate
runs on every commit and in CI, and must work on a machine with no Docker. Install the browser
once with `npx playwright install chromium`.

Tests are named by the requirement they cover. `tests/unit/` holds pure rules;
`tests/integration/` holds anything touching the database. A test asserting a database rule
should use `expectViolation` from `tests/helpers/constraints.ts` — Drizzle wraps driver
errors, so matching on the message would pass for any failure at all, including a typo in the
query. The helper checks the SQLSTATE code and the constraint name instead.

## Where the flags come from

`public/flags/` is **generated** and git-ignored: `scripts/sync-flags.mjs` copies the 4:3 SVGs
out of `flag-icons` on every `yarn install` and as the first half of `yarn build`. If the
language switcher shows broken images, run `yarn flags:sync`.

Only the SVG files are used, never the package's stylesheet — that CSS references all 271 flags
as background images, which is a large file to ship for the two the header shows. The set is
there because a country field needs hundreds; the switcher is its first use.

## Signing in to the backoffice locally

Real staff sign-in is Auth.js with the Zitadel provider (`DECISIONS.md` §26), which needs a
Zitadel tenant most developer machines do not have. Local and test use the development
switcher `AGENTS.md` §13.1 permits instead: open `/ro/autentificare`, pick one of three synthetic
identities — Author, Editor, Administrator — and you are that role until you sign out. The
identities are created on demand, so a migrated-but-unseeded database works.

It is guarded twice. `STAFF_AUTH_MODE` defaults to `dev-switcher` in local and test and to
`disabled` everywhere else, and a process that is *told* to use the switcher with
`APP_ENV=qa` or `production` refuses to start. The backoffice is at `/ro/admin`; signed out, it
redirects to the switcher locally and answers 404 where there is no way in.

## Coding from the phone (Claude Code on the web)

A Claude Code cloud session (Claude Code on the web, on this repository) starts from a fresh
clone: no `node_modules`, no `.env.local`, PostgreSQL 16 installed but stopped. The
`SessionStart` hook in `.claude/settings.json` runs `scripts/cloud-setup.sh` on every start and
resume of such a session, and only there — it is guarded on `CLAUDE_CODE_REMOTE=true`, so a
session on a developer's own machine never runs it (§501). The script, idempotent and silent
when there is nothing to do:

- enables Corepack and runs `yarn install --immutable`, then `yarn setup` for the git hooks;
- starts the local PostgreSQL and creates the role and database `brasov_runners` with the
  password `local_only_not_a_secret` — the same throwaway values `docker-compose.yml` publishes —
  skipping either when it exists;
- writes `.env.local` from `.env.example` only when there is none, setting `APP_ENV=local`,
  `APP_BASE_URL=http://localhost:47821` and the local `DATABASE_URL`, nothing else;
- migrates (one transaction per migration on PostgreSQL 16) and runs `yarn db:seed` only on an
  empty events table, refusing any database that is not on localhost.

Every step skips what is already done, so a resumed session costs seconds. Three things differ
from a laptop, all worked around by the script:

- The environment's network policy refuses `repo.yarnpkg.com`, so Corepack takes Yarn from the
  npm registry (`COREPACK_NPM_REGISTRY`, also written into the session's environment through
  `CLAUDE_ENV_FILE`).
- The image ships PostgreSQL 16 and no Docker daemon. drizzle-kit applies every pending
  migration in one transaction, and 16 will not let a transaction use an enum value added to a
  type created in that same transaction, which 17 (`docker-compose.yml`, CI) allows — so on 16
  the script applies one transaction per migration, recording the same rows, and `yarn
  db:migrate` carries on from there. `yarn db:reset:local` migrates in one transaction, so to
  start over drop the database (`su postgres -c "dropdb brasov_runners"`) and run the script again.
- Playwright's own browser download is refused, so the script names the image's Chromium in
  `PLAYWRIGHT_CHROMIUM_PATH`, which `playwright.config.ts` reads and every other machine leaves
  unset. The container has no IPv6 either; `scripts/dev.mjs` falls back to IPv4 for its probe.

A cloud session therefore runs on **local values only**: email in `capture` mode, the
`dev-switcher` staff sign-in, this machine's database. **No QA or production credential goes
into the cloud environment's settings or into this repository** — it is public, and
`yarn secrets:check` blocks the commit that tries. Deploys and production migrations do not
change: a branch, a pull request into `qa`, the `qa → main` release PR, and the gated migration
workflow (`DECISIONS.md` §31). The weather and anything else outside the policy's allowlist
stays silent, as it is built to. To run the same setup on a Linux machine of your own,
`bash scripts/cloud-setup.sh --force`.

## Where things live

```text
src/
  app/[locale]/        routes; Server Components by default
  modules/events/      event queries and rules
  db/
    client.ts          the pg.Pool, node-postgres — not neon-http
    schema/            Drizzle tables; edit here, then yarn db:generate
    migrations/        generated SQL; commit it, never edit it. Renaming a file means
                       updating its `tag` in meta/_journal.json to match, and the SQL
                       must stay byte-identical or applied databases will re-run it
    seeds/
  i18n/                routing, request config, navigation helpers
  shared/
    config/env.ts      Zod-validated environment
    ui/                small presentational pieces
  theme/               MUI theme and its client boundary
  proxy.ts             locale negotiation (Next 16's name for middleware)
tests/
  unit/  integration/  helpers/
```

`AGENTS.md` §5 is the full structure and the dependency rules. The short version: domain code
does not import React, Next, MUI, or a provider SDK, and there is no `utils.ts`.

## Things that will catch you out

- **`middleware.ts` does not exist here.** Next 16 renamed it to `proxy.ts`, with the export
  renamed to match. The Node runtime is the only one it supports.
- **The public pages are static, and a production build keeps what it made** (§549). The
  listing, the calendar, an event page, the standing pages, the gallery, the legal pages, the
  `.ics` files and the Open Graph pictures are made on their first visit and kept (ISR), expired
  by the write that changes them — the same `revalidatePublicContent(...)` every write already
  calls — and by their clock (`src/modules/public-cache/page-lifetime.ts`). `curl -sI` shows it:
  `x-nextjs-cache: HIT` on a second visit, and on a static *page* `Cache-Control: public,
  max-age=0, must-revalidate` — what Vercel's CDN hands the browser for such a page, said by
  `proxy.ts` everywhere else for a GET or a HEAD (the pictures and the `.ics` files keep Next's
  own header off Vercel), because `next start` would otherwise give the browser Next's own `s-maxage`
  and `stale-while-revalidate`, and the browser would show its copy from before the last save
  (and Playwright's `networkidle` would wait for its background request forever). On Vercel the
  CDN keeps Next's `s-maxage` and the proxy sets nothing. A filtered listing
  (`?type=…`), `?lista=` and a signed-in browser on an event page are the
  page's *live twin* under `src/app/[locale]/live/`, rendered per request as before
  (`src/i18n/live-twin.ts`) — so a signed-in browser never shows you the stranger's copy; use
  `curl` or a private window for that. A calendar month is a static page of its own path
  (`/ro/calendar/2026-10`, `/ro/calendar/2026-10/list`, `/ro/calendar/2026`), and the old
  `?month=`, `?year=` and `?view=list` are redirected there by the proxy: a 308 when the address names the period, a `no-store` 307 when it means this month (whose target moves with the clock). Why: Next's router may
  answer a soft navigation to a static page's address plus a query from that page's prefetched
  copy, without asking the server, and on Vercel (whose answer to a prefetch is the page's whole
  `.rsc`) the calendar's arrows changed the address and left the month on screen
  (`src/modules/events/domain/calendar-path.ts`). A new control that changes what a static page
  shows goes to a path of its own, not to a query on the same path. `next start` does not show
  the difference; `tests/e2e/calendar-month-from-path.spec.ts` answers a prefetch the way Vercel
  does to catch it. `next start` stores the pages it made in
  `.next/server/app/ro/` and `/en/`, and they outlive a restart: `yarn db:reset:local` deletes
  them, and a running `yarn start` must be restarted after a reset (it holds them in memory
  too). A row changed by hand in the database is on the pages within a day, or at the next
  write, as §333 already said of the rows. Under `next dev` nothing is cached.
- **`component={Link}` fails in a Server Component**, with "Functions cannot be passed directly
  to Client Components". `src/shared/ui/ButtonLink.tsx` exists for that reason.
- **The MUI App Router provider is imported from a version-suffixed path**,
  `@mui/material-nextjs/v16-appRouter`. It must match the Next major.
- **TypeScript is pinned to 5.9.3, not 7.** `eslint-config-next` pulls `typescript-eslint`,
  which refuses TS 7 outright. Upgrading TypeScript means checking that first.
- **The database no longer refuses a capacity.** It did, during the pilot — see `WEEKEND.md`.
  The locked capacity transaction (`modules/registrations/service.ts`) and its concurrency
  suite (`tests/concurrency/capacity.test.ts`) exist now, and the constraint was removed only
  after that suite passed. An event may carry a real capacity.
- **Resetting the database means dropping the `drizzle` schema too.** Drizzle records applied
  migrations in a table inside its own schema, so `DROP SCHEMA public CASCADE` alone leaves it
  believing everything is applied; the next migrate then fails on a missing enum and leaves an
  empty database. `yarn db:reset:local` does it correctly and refuses any non-local host.
- **`yarn db:generate` names a new file by the journal's entry count, not the next number.**
  The numbers skip (0088 sits at idx 85), so a generated file lands on a number that already
  exists and overwrites that entry's snapshot. The recipe, every time:
  1. `yarn db:generate` — twice without a TTY when an enum or a column is added and removed at
     once (the first pass asks, the second writes).
  2. Rename the generated `NNNN_*.sql`, its `meta/NNNN_snapshot.json` and its journal `tag` to the
     next free number, and `git restore` the snapshots it overwrote.
  3. `yarn db:generate` again — it must say "No schema changes, nothing to migrate" — then
     `yarn migrations:check` and `tests/unit/db/migration-chain.test.ts`, which holds every
     snapshot's `prevId` to the one before it in journal order.

  One exception, BR-V2.10 only (§491): the Drizzle schema dropped `events.video_url` and
  `video_poster_url` a release before the database does, so step 3 reports that drop until
  BR-V2.11 ships it as its own contract migration — generated by exactly this recipe.
- **Adding a message key means adding it to both catalogues.** `yarn test` fails otherwise,
  naming the key and the file. It also fails on a `t("…")` key that exists in neither, which
  is what a typo looks like — nothing else catches that, since it renders the raw key.
- **Windows and CI differ on paths and line endings.** `docs:check` has been broken by that
  before. `.gitattributes` normalises to LF; test both if you touch either.
