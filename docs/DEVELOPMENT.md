<!-- PROJECT_BASELINE: BR-V1.15-2026-09-04 -->

# Running this locally

**Baseline `BR-V1.15-2026-09-04`** · [agent entry point](../CLAUDE.md) · [pilot scope](../WEEKEND.md)

Everything here is a command that exists today. If a command is in this file it is in
`package.json`; if it is not, it has not been built yet.

## Prerequisites

| | |
| --- | --- |
| **Node** | `22.14.0` exactly. `.nvmrc` and `engines.node` both say so; CI reads `.nvmrc`. |
| **Yarn** | 4.18.0, via Corepack. It ships with Node — you do not install yarn yourself. |
| **A database** | Only for event pages: `docker compose up -d db`. The home page and the whole test suite need none. |

```bash
node --version        # must print v22.14.0
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
yarn check               docs:check + typecheck + lint + tests — the pre-commit gate
yarn test                all tests
yarn test:unit           pure-rule tests only
yarn test:integration    database tests only
yarn test:concurrency    the two-connection suite; needs the database running
yarn test:watch          re-run on change
yarn test:e2e            browser tests, mobile and desktop; needs the database running
yarn test:e2e:ui         the same, in Playwright's UI mode
yarn typecheck           tsc --noEmit
yarn lint                ESLint
yarn docs:check          documentation consistency
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

**The first suite that needed the other kind of database.** `yarn test:concurrency` runs
`tests/concurrency/` against a real PostgreSQL server, with two genuine connections, and proves
BR-REQ-051-01 criterion 5: two organizers saving one event, one save refused as stale, the other
surviving whole. It has its own configuration (`vitest.concurrency.config.mts`), it is excluded
from `yarn test`, and it fails loudly rather than skipping when `DATABASE_URL` is unset — a
concurrency suite that quietly passes with nothing connected is worse than no suite at all.

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

There is no staff login yet (`DECISIONS.md` §24), so local and test use the development
switcher `AGENTS.md` §13.1 permits: open `/ro/autentificare`, pick one of three synthetic
identities — Author, Editor, Administrator — and you are that role until you sign out. The
identities are created on demand, so a migrated-but-unseeded database works.

It is guarded twice. `STAFF_AUTH_MODE` defaults to `dev-switcher` in local and test and to
`disabled` everywhere else, and a process that is *told* to use the switcher with
`APP_ENV=qa` or `production` refuses to start. The backoffice is at `/ro/admin`; signed out, it
redirects to the switcher locally and answers 404 where there is no way in.

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
- **`component={Link}` fails in a Server Component**, with "Functions cannot be passed directly
  to Client Components". `src/shared/ui/ButtonLink.tsx` exists for that reason.
- **The MUI App Router provider is imported from a version-suffixed path**,
  `@mui/material-nextjs/v16-appRouter`. It must match the Next major.
- **TypeScript is pinned to 5.9.3, not 7.** `eslint-config-next` pulls `typescript-eslint`,
  which refuses TS 7 outright. Upgrading TypeScript means checking that first.
- **The database refuses a capacity.** That is not a bug — see `WEEKEND.md`. A capped event
  needs the locked capacity transaction, and until it exists the constraint is what makes
  deferring it safe.
- **Resetting the database means dropping the `drizzle` schema too.** Drizzle records applied
  migrations in a table inside its own schema, so `DROP SCHEMA public CASCADE` alone leaves it
  believing everything is applied; the next migrate then fails on a missing enum and leaves an
  empty database. `yarn db:reset:local` does it correctly and refuses any non-local host.
- **Adding a message key means adding it to both catalogues.** `yarn test` fails otherwise,
  naming the key and the file. It also fails on a `t("…")` key that exists in neither, which
  is what a typo looks like — nothing else catches that, since it renders the raw key.
- **Windows and CI differ on paths and line endings.** `docs:check` has been broken by that
  before. `.gitattributes` normalises to LF; test both if you touch either.
