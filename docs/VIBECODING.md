# Vibecoding this repo — the one page to read before asking an AI to change anything

<!-- PROJECT_BASELINE: BR-V2.94-2026-10-11 -->

**Baseline `BR-V2.94-2026-10-11`**

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

**In a Claude Code on the web session** (the owner on a phone, the PC off) the database is
already up, migrated and seeded when you start: the SessionStart hook ran
`scripts/cloud-setup.sh`. Skip the `docker compose` line — there is no Docker there. To start
over, drop the database (`su postgres -c "dropdb brasov_runners"`) and run
`bash scripts/cloud-setup.sh` again; `yarn db:reset:local` needs PostgreSQL 17 and the session
has 16. There is no `gh` either: open the pull request through the GitHub tools. Never write a
QA or production value anywhere; the session is local-only by design.
[`DEVELOPMENT.md` § Coding from the phone](./DEVELOPMENT.md#coding-from-the-phone-claude-code-on-the-web).

**To release from there**, the branch carries its own release facts: in place of editing
`DECISIONS.md`, `CHANGELOG.md` and `SPECS.md`, commit one `.release/<branch-slug>.json` (the §
text, the bullet, the criteria; `.release/README.md` has the shape) and write the README row,
SETUP or docs text the change needs yourself. The owner then adds the label **ship** to the pull
request and `.github/workflows/release.yml` lands and ships it
([`RUNBOOKS.md` § Release from the phone](./RUNBOOKS.md#release-from-the-phone)).

## Where things live

| You want to change… | Go to |
| --- | --- |
| A page a visitor sees | `src/app/[locale]/…/page.tsx` (Server Component; `"use client"` islands only where a click needs JS) |
| A deadline (hold, offer, link, reminder, check-in, race week, horizon) | `src/modules/deadlines/`; the words via `duration-words.ts` (§377) |
| The words on it | `messages/ro.json` and `messages/en.json` — both, same keys, no ICU plurals |
| A backoffice screen | `src/app/[locale]/admin/…`; its Server Actions in the sibling `actions.ts` |
| A route handler (PDF, image, API) | `src/app/api/…/route.ts` |
| The rules of registration (holds, the waiting list, capacity) | `src/modules/registrations/service.ts` — the allocator; nothing bypasses it |
| What staff may do to a registration | `src/modules/registrations/admin-service.ts` |
| An email | `src/modules/notifications/templates.ts` (RO + EN copy), `render.ts` (data, links, attachments), the enum in `src/db/schema/email-outbox.ts` |
| A legal text template | `src/modules/legal-documents/templates/` |
| The event editor | `src/modules/content/events/` (fields.ts validates, service.ts saves, ui/ renders) |
| «Traseul»'s Strava / Garmin Connect maps and its GPX file | the parsers `src/modules/events/domain/route-maps.ts` (ids only, never the pasted HTML), the file's checks `route-gpx.ts`; the page `events/ui/EventRoute.tsx`, `RouteMapPanel.tsx` (the press), `RouteMapTabs.tsx`; the editor's map boxes in `ui/boxes/CourseBox.tsx`, the GPX upload in `ui/boxes/LinksBox.tsx` (`RouteGpxField.tsx`, and the GPX row's button in `LinkRowsEditor.tsx`), the upload's route `src/app/api/admin/route-gpx/route.ts` |
| An event's cover picture or its kind (weekly / special) | «Copertă» in the editor (`ui/boxes/CoverBox.tsx`); the kind and the photo tag in `src/modules/events/domain/event-kind.ts`; the `<img>` sources in `src/modules/events/cover.ts` — both read off the public row (`cover`, `seriesCadence`) |
| The home page («Pagina principală», off by default): the hero, «Următoarea alergare», the weekly runs, the special events | one Server Component per section with typed props in `src/modules/home/ui/` (`HomePage`, `Hero`, `NextRunCard`, `RunCardGrid`, and their parts `HomePicture`, `RunTag`, `RoundArrow`); what they show `src/modules/home/home-content.ts` and `domain/sections.ts`; the switch and every section's words, pictures and figures `src/modules/appearance/home-page.ts` (the lower sections' boxes `domain/home-sections-form.ts`) and its card `ui/HomePagePanel.tsx` («Setări» → «Aspect», a fold per part); the route `src/app/[locale]/page.tsx` (off: a 307 to the listing); each drawn at `/admin/design` → «Mostre» from `src/modules/design/home-fixtures.ts`. A new section is a component there, a fixture and a row here |
| A table or a column | `src/db/schema/*.ts`, then `yarn db:generate --name <what>` → `src/db/migrations/00NN_<what>.sql` (expand only) |
| Colours, fonts, the logo | `src/theme/brand.ts` — the only file allowed a hex value |
| The look — the tokens, the type, the components | `src/theme/brand.ts`, `src/theme/theme.ts`; see them drawn at `/admin/design` (§692) |
| The facelift («Aspectul nou», off by default): the pink, Inter 800, the pill with its arrow, «Vino cu noi», the mountains | the scope `src/theme/look.ts` (write a new-look rule under `UNDER_LOOK`, never test the setting in a page); the pink `src/modules/appearance/domain/site-look.ts`; the parts `src/shared/ui/ArrowButtonLink.tsx`, `HeaderCta.tsx`, `HeaderSocials.tsx`, `MountainMark.tsx`, `LookWatermark.tsx`; both looks side by side at `/admin/design` → «Aspectul nou»; the plan `docs/REDESIGN.md` |
| The home page's sections — «Prima dată», «De ce» and the quote, the photo strip, the numbers band | one Server Component each in `src/modules/home/ui/` (`StepsBand`, `WhyList`, `PhotoStrip`, `NumbersBand`), typed props, glyphs by name from `home-glyphs.ts`, fills from `home-surfaces.ts`; what the club types and the figures in `src/modules/home/domain/` (both languages or neither; a figure without its fact is left out); the strip's `<img>` sources in `src/modules/home/strip-pictures.ts`, its pictures added, moved and taken out by `changeStripPicture`; drawn under the run sections by `HomePage` while their switches are on, and with fixtures on `/admin/design` → «Mostre» |
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
- **Server → client.** A Server Component may not pass a function or a component reference to a client component (MUI `Chip`, `IconButton`, `Link`): use `component="a"` with a string `href` from `getPathname(...)`. An icon too: pass its name (`icon="save"`) to the backoffice-only `GlyphButton` / `GlyphSubmitButton` / `GlyphButtonLink`, never an element — and a public page never imports `action-icons.ts` (a test enforces it, §318). `divider` is on the list too, and `yarn check` refuses any element-valued prop into a client component (§370).
- **Messages with `{x}` or a tag** are `t("key", values)` or `t.raw("key")`, never a bare `t("key")`: a production build prints it raw and `next dev` prints the key. Write a literal `<` as `'<'` (§370).
- **No hostname of the club's in `src/`** — everything derives from `APP_BASE_URL`; a third party's fixed host (Cloudflare, Vercel, Facebook) goes in `PROVIDER_HOSTS` in `scripts/docs-check.mjs` with one line saying why.
- **Migrations expand only.** Add a column or an enum value; never drop or rename in the same release (`yarn migrations:check`).
- **The design system has guards (§694).** No colour literal outside `src/theme/brand.ts`, no `@mui/icons-material` barrel import, and in the backoffice no icon file imported directly (ask `shared/ui/action-icons.ts` by name; a public page imports its one icon file, or names it in a registry listed in `ICON_REGISTRIES` (`tests/unit/design/guards-allowlist.ts`)), no bare MUI `Button` / `IconButton` / `Chip` in a page or an area's `ui/` — `ButtonLink`, `GlyphButton`, `GlyphChip` instead — and in the backoffice a state's chip is `StatusChip` (`shared/ui/status-glyphs.ts`), the public table keeping only the names public pages draw. `tests/unit/design/` fails on a new offender; today's are listed with a reason in `guards-allowlist.ts`, a ratchet that only shrinks (a fixed file leaves the list and `PINNED` drops). The page `/admin/design` shows the system.
- **Tap targets are 44 px** — every link and button on a public page; the e2e suite measures them.
- **Personal data:** a public list shows names and clubs only; the desk never shows an address; nothing about a person goes in a URL; erase deletes, it does not blank.
- **Legal text is the club's.** The platform ships templates; only a version approved in `/admin/legal` has effect. An agent never marks one approved.
- **The Bash tool mangles backslashes in heredocs** — write scripts with the Write tool and run them by path.

## What "done" means

`yarn check` green, `yarn test:e2e` 140/140 on a production build, the docs updated, one PR
into `qa` with a description a non-developer can read, and a message to the owner that says
what changed and what was left out — never "done" for half.
