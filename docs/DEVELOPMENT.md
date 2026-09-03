<!-- PROJECT_BASELINE: BR-V1.13-2026-09-02 -->

# Running this locally

**Baseline `BR-V1.13-2026-09-02`** · [agent entry point](../CLAUDE.md) · [pilot scope](../WEEKEND.md)

Everything here is a command that exists today. If a command is in this file it is in
`package.json`; if it is not, it has not been built yet.

## Prerequisites

| | |
| --- | --- |
| **Node** | `22.14.0` exactly. `.nvmrc` and `engines.node` both say so; CI reads `.nvmrc`. |
| **Yarn** | 4.18.0, via Corepack. It ships with Node — you do not install yarn yourself. |
| **A database** | Only for `yarn dev`. Tests need nothing (see [Tests](#tests)). |

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

`yarn setup` installs the pre-commit hook that runs `yarn check`. It is not optional: it is the
only thing standing between you and a red pull request from a green working copy.

Then fill in `.env.local`:

| Variable | What to put in it |
| --- | --- |
| `APP_ENV` | `local` |
| `APP_BASE_URL` | `http://localhost:3000` |
| `DATABASE_URL` | Your Neon **pooled** connection string, the host containing `-pooler`. Region Frankfurt. |

`.env.local` is git-ignored and must never be committed. `.env.example` carries the names and
safe examples only — never a real value (`AGENTS.md` §8).

### Set up the database

```bash
yarn db:migrate       # applies src/db/migrations to DATABASE_URL
yarn db:seed          # three sample events, Romanian published, English draft
yarn dev              # http://localhost:3000 → redirects to /ro
```

`yarn db:seed` clears both tables and refuses to run when `APP_ENV=production`.

### No database yet?

`yarn dev` needs one, but almost nothing else does. You can run `yarn check`, the whole test
suite, `yarn build` and `yarn lint` with `DATABASE_URL` empty. Come back to this section when
you have a Neon project.

## Everyday commands

```text
yarn dev                 dev server on http://localhost:3000
yarn build               production build
yarn start               production server; honours PORT
yarn check               docs:check + typecheck + lint + tests — the pre-commit gate
yarn test                all tests
yarn test:unit           pure-rule tests only
yarn test:integration    database tests only
yarn test:watch          re-run on change
yarn typecheck           tsc --noEmit
yarn lint                ESLint
yarn docs:check          documentation consistency
yarn db:generate         regenerate migrations after editing src/db/schema/
yarn db:migrate          apply migrations
yarn db:studio           browse the database
yarn db:seed             reset and reseed sample events
yarn release             versioned archive and share copies under dist/
```

`yarn check` is the single gate. The pre-commit hook runs it and CI runs it, so they cannot
drift. When a step is added to CI that a developer can run locally, it belongs inside `check`.

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
> event. When that work starts, add Docker or Testcontainers *alongside* this harness rather
> than replacing it; these tests are fast and need no daemon, which is worth keeping.

Tests are named by the requirement they cover. `tests/unit/` holds pure rules;
`tests/integration/` holds anything touching the database. A test asserting a database rule
should use `expectViolation` from `tests/helpers/constraints.ts` — Drizzle wraps driver
errors, so matching on the message would pass for any failure at all, including a typo in the
query. The helper checks the SQLSTATE code and the constraint name instead.

## Where things live

```text
src/
  app/[locale]/        routes; Server Components by default
  modules/events/      event queries and rules
  db/
    client.ts          the pg.Pool, node-postgres — not neon-http
    schema/            Drizzle tables; edit here, then yarn db:generate
    migrations/        generated SQL; commit it, never edit it
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
- **Windows and CI differ on paths and line endings.** `docs:check` has been broken by that
  before. `.gitattributes` normalises to LF; test both if you touch either.
