# Vibecoding this repo — the one page to read before asking an AI to change anything

<!-- PROJECT_BASELINE: BR-V1.54-2026-09-23 -->

**Baseline `BR-V1.54-2026-09-23`**

The owner's word for how this platform is built: an AI agent writes, the owner reads and
merges. This page is the short version of everything an agent trips over. `CLAUDE.md` is the
long one; `AGENTS.md` is the law.

## The loop

```text
git checkout qa && git pull                       start from qa, never from main
git checkout -b feat/<what> --no-track            one branch per unit of work
…change…                                          keep going until the ask is done, not half
yarn check                                        docs + migrations + types + lint + 1 000 tests (~1 min)
docker compose up -d db && yarn db:reset:local    local Postgres with the sample data
yarn build && yarn start --port 4783              a production build, like Vercel's
yarn test:e2e                                     140 Playwright runs, phone + desktop (~35 s)
git commit                                        the pre-commit hook runs yarn check again
git push -u origin feat/<what> && gh pr create --base qa   the owner merges; a release is qa → main
```

Document as you go, in the same commit: a `DECISIONS.md` § for a rule that changed (why, and
what was refused), a `SPECS.md` criterion for behaviour a test proves, a `CHANGELOG.md` line
for anything a person sees. `yarn check` fails on a `BR-REQ-*` that does not exist, a hostname
literal, or a hex colour outside `src/theme/brand.ts`.

## Where things live

| You want to change… | Go to |
| --- | --- |
| A page a visitor sees | `src/app/[locale]/…/page.tsx` (Server Component; `"use client"` islands only where a click needs JS) |
| The words on it | `messages/ro.json` and `messages/en.json` — both, same keys, no ICU plurals |
| A backoffice screen | `src/app/[locale]/admin/…`; its Server Actions in the sibling `actions.ts` |
| A route handler (PDF, image, API) | `src/app/api/…/route.ts` |
| The rules of registration (holds, the waiting list, capacity) | `src/modules/registrations/service.ts` — the allocator; nothing bypasses it |
| What staff may do to a registration | `src/modules/registrations/admin-service.ts` |
| An email | `src/modules/notifications/templates.ts` (RO + EN copy), `render.ts` (data, links, attachments), the enum in `src/db/schema/email-outbox.ts` |
| A legal text template | `src/modules/legal-documents/templates/` |
| The event editor | `src/modules/content/events/` (fields.ts validates, service.ts saves, ui/ renders) |
| A table or a column | `src/db/schema/*.ts`, then `yarn db:generate --name <what>` → `src/db/migrations/00NN_<what>.sql` (expand only) |
| Colours, fonts, the logo | `src/theme/brand.ts` — the only file allowed a hex value |
| What `/devs` and `/admin/tasks` say | `src/modules/diagnostics/` |
| A scheduled job | `src/modules/jobs/` (retention) and `src/modules/registrations/maintenance.ts` |

## Adding a field, end to end

1. `src/db/schema/<table>.ts` — the column, nullable unless it has a default. Then `yarn db:generate --name <what>`; read the SQL it wrote.
2. `fields.ts` of the module — the Zod rule (what is refused).
3. `actions.ts` — read it from the form (`value("name")`); `service.ts` — write it.
4. The form component — the `TextField`, with `name`, a label from `messages/*.json`, `helperText` that says what to type.
5. The page that shows it, and the CSV/PDF if it belongs there.
6. A test beside the nearest existing one (`tests/integration/...`); `yarn test` runs on PGlite, no database needed.

## The rules that bite

- **Both languages or none.** Every message key exists in both files; the test `i18n/messages.test.ts` checks every `t("…")` in `src/` — use one-word namespaces (`getTranslations("Admin")` + `t("queue.title")`), never `"Admin.queue"`.
- **Server → client.** A Server Component may not pass a function or a component reference to a client component (MUI `Chip`, `IconButton`, `Link`): use `component="a"` with a string `href` from `getPathname(...)`.
- **No hostname of the club's in `src/`** — everything derives from `APP_BASE_URL`; a third party's fixed host (Cloudflare, Vercel, Facebook) goes in `PROVIDER_HOSTS` in `scripts/docs-check.mjs` with one line saying why.
- **Migrations expand only.** Add a column or an enum value; never drop or rename in the same release (`yarn migrations:check`).
- **Tap targets are 44 px** — every link and button on a public page; the e2e suite measures them.
- **Personal data:** a public list shows names and clubs only; the desk never shows an address; nothing about a person goes in a URL; erase deletes, it does not blank.
- **Legal text is the club's.** The platform ships templates; only a version approved in `/admin/legal` has effect. An agent never marks one approved.
- **The Bash tool mangles backslashes in heredocs** — write scripts with the Write tool and run them by path.

## What "done" means

`yarn check` green, `yarn test:e2e` 140/140 on a production build, the docs updated, one PR
into `qa` with a description a non-developer can read, and a message to the owner that says
what changed and what was left out — never "done" for half.
