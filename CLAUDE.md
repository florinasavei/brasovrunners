<!-- PROJECT_BASELINE: BR-V1.14-2026-09-03 -->

# CLAUDE.md — start here if you are an AI coding agent

**Baseline `BR-V1.14-2026-09-03`** · [changelog](./CHANGELOG.md) · [weekend plan](./WEEKEND.md)

Brașov Runners: a bilingual website and free event-registration platform for a small running
club in Brașov, Romania. One Next.js App Router monolith, PostgreSQL, Material UI. Nothing is
built yet — the repository is documentation, a documentation checker, and a pre-commit hook.

## Current mode: weekend pilot

Read [`WEEKEND.md`](./WEEKEND.md) before anything else. It is the scope. The full plan in
`SETUP.md` §29 is ten pull requests and roughly 200 hours; the pilot is Romanian event pages on
Vercel from Neon, no registration, no email, no login. Everything else is deferred there with a
reason.

## Commands that exist right now

```text
yarn setup        install the tracked git hooks — once per clone
yarn dev          Next.js dev server; needs .env.local (copy .env.example)
yarn build        production build
yarn start        production server, honours PORT
yarn lint         ESLint
yarn typecheck    tsc --noEmit
yarn test         unit and database tests; no database or Docker needed (PGlite)
yarn test:e2e     Playwright, 320px mobile and desktop; needs the database running
yarn check        docs:check + typecheck + lint + test; CI and the pre-commit hook run this
yarn docs:check   documentation consistency
yarn db:migrate   apply migrations · db:seed sample events · db:studio browse
yarn release      versioned archive and share copies under dist/
```

Full list with explanations: [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md). Do not write a
command into a document until it is in `package.json`.

**Toolchain:** Node `22.14.0` (`.nvmrc`), Yarn 4.18.0 via Corepack, TypeScript 5.9.3 — not 7,
which `typescript-eslint` refuses. Tests need no database: PGlite runs real PostgreSQL in
process. Concurrency tests must not use it; see `docs/DEVELOPMENT.md`.

## Read order

1. `WEEKEND.md` — what to build this weekend and what not to.
2. This file.
3. `AGENTS.md` §1.5 (priority order) and the one §10 subsection for the rule you are touching.
4. The `BR-REQ-*` you implement, in `SPECS.md`. Name it before you write code.
5. Everything else on demand. `README.md` § Where a rule lives is the index.

## Rules that cannot be broken, pilot or not

These carry trust. `AGENTS.md` §1.5 ranks them above every other goal, including speed.

| Rule | Where it lives |
| --- | --- |
| No capped event until the locked capacity transaction exists. The DB refuses a non-null `capacity` for now. | `AGENTS.md` §10.6, BR-REQ-034-01, BR-REQ-034-02 |
| No registration without the club's approved declaration and privacy notice. Never invent legal text. | `AGENTS.md` §10.8, §29; BR-REQ-053-01 |
| Participants never get passwords or accounts. Staff-only auth. | `AGENTS.md` §10.3, §13 |
| Email action links: token hashed at rest, single use, GET never mutates. | `AGENTS.md` §12.8, BR-REQ-036-02 |
| Every absolute URL derives from `APP_BASE_URL`. No hostname literal in `src/`, and the club's domain appears in no file except `SETUP.md` §26 — `docs:check` fails otherwise. | `AGENTS.md` §8, BR-REQ-101-02 |
| Email identity goes through the versioned canonicalizer, never a raw string compare. | `AGENTS.md` §10.4, BR-REQ-032-* |
| Authorization is asserted on the server, never by hiding UI. | BR-REQ-060-01 |
| Vocabulary matches `BUSINESS.md`: participant, registration, hold, waiting-list offer, declaration, confirmed. | `AGENTS.md` §1.5 |

## Fast lane — what is relaxed during the pilot, and what is not

Recorded once in `DECISIONS.md` §20 so it does not have to be re-argued.

**Relaxed:** application code needs no baseline bump and no six-document edit. Add a
`CHANGELOG.md` line when something user-visible ships; that is all.

**Not relaxed:** a change to a documented *rule* still follows the change-type matrix in
`AGENTS.md` §1.4. The table above is in force. `yarn check` still runs before every commit
and blocks on an undefined `BR-REQ-*`, a leaked hostname, or a root file missing from the
README index — application source under `src/` is not indexed and needs no README row.

## Stack and providers, as decided

| Layer | Decision | Status |
| --- | --- | --- |
| App | Next.js 16 App Router, TypeScript 5.9 strict, `src/`, Yarn 4, Node 22.14.0 | done |
| UI | Material UI 9 + Emotion, `@mui/material-nextjs/v16-appRouter` | done |
| i18n | `next-intl` 4; `ro` default, `en`; `localePrefix` always; no cross-locale fallback | done; `en` stays Draft |
| Data | PostgreSQL on Neon, Frankfurt; Drizzle over `node-postgres`, pooled URL | schema + seed done; needs `DATABASE_URL` |
| Hosting | Vercel Hobby, function region `fra1`; one project per environment | not deployed yet |
| Auth | staff only. Documented: Auth.js + Zitadel. Direction: Auth.js alone, no external IdP | deferred |
| Email | Documented: Mailgun. Direction: Resend, Ireland region. Needs the domain first | deferred |
| Storage | Documented: R2. Direction: `public/` until a non-developer needs uploads | deferred |

**Before installing anything:** verify the current API against the library's documentation
(Context7 or the official docs site). Next 16, MUI 9, next-intl 4 and Drizzle 0.45 are newer
than any training data can be trusted on. Pin exact versions in `package.json`.

## Working conventions

- **Do not commit or push.** Stage changes and hand back a suggested message; the owner
  commits. Creating a branch when asked is fine.
- Branch from `qa`, PR into `qa`. `main` is production. `SETUP.md` § Contributing.
- Windows development machine, Linux CI. Anything with paths or line endings: test both.
- Tests are named by the `BR-REQ-*` they cover. Six tests matter for the pilot; `WEEKEND.md`
  lists them.
- No `BaseService`, barrels, dispatch tables, or wrappers around MUI. `AGENTS.md` §1.3.
- When a doc contradicts this file, the doc wins and this file is wrong — fix it here.
