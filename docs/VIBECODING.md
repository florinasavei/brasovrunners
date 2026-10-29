# Vibecoding this repo — the one page to read before asking an AI to change anything

<!-- PROJECT_BASELINE: BR-V3.94-2026-10-29 -->

**Baseline `BR-V3.94-2026-10-29`**

The owner's word for how this platform is built: an AI agent writes, the owner reads and
merges. This page is the short version of everything an agent trips over. `CLAUDE.md` is the
long one; `AGENTS.md` is the law.

## The loop

```text
git checkout qa && git pull                       start from qa, never from main
git checkout -b feat/<what> --no-track            one branch per unit of work
…change…                                          keep going until the ask is done, not half
yarn test:fast                                    the quick tests: trust (the rules that cannot be broken), guards, logic
yarn check                                        docs + migrations + types + lint + 18 000 tests in six categories (yarn test:categories)
docker compose up -d db && yarn db:reset:local    local Postgres with the sample data
yarn build && yarn start --port 4783              a production build, like Vercel's
yarn test:e2e                                     140 Playwright runs, phone + desktop (~35 s)
git commit                                        the hook: check:static + the staged files' tests in the yarn test:fast categories
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

One line a row: the thing, then where it starts. Each row's why, the files beside it and the decisions are in
[`docs/WHERE-THINGS-LIVE.md`](./WHERE-THINGS-LIVE.md) — read the row there before changing that thing.

| You want to change… | Start at |
| --- | --- |
| A page a visitor sees | `src/app/[locale]/…/page.tsx` |
| A deadline | `src/modules/deadlines/`, `duration-words.ts` |
| Which fold of «Setări» → «Termene» a deadline sits in, and a fold's closed line | `src/modules/deadlines/domain/deadlines.ts`, `ui/DeadlinesPanel.tsx` |
| A glyph on a tab of «Setări»' row | `src/modules/staff-identity/ui/SettingsSubNav.tsx`, `shared/ui/panel-glyphs.ts` |
| A glyph on a tab of «Sarcini», «Galerie» or on the language switch of «Emailuri» | `src/modules/diagnostics/ui/TasksSubNav.tsx`, `src/modules/content/gallery/ui/GallerySubNav.tsx` |
| The words on it | `messages/ro.json`, `messages/en.json` |
| A backoffice screen | `src/app/[locale]/admin/…`, `actions.ts` |
| A route handler | `src/app/api/…/route.ts` |
| A file a route hands out for saving | `src/shared/http/content-disposition.ts`, `tests/unit/design/download-names.test.ts` |
| The rules of registration | `src/modules/registrations/service.ts` |
| What staff may do to a registration | `src/modules/registrations/admin-service.ts` |
| Internal notes on a registration | `src/db/schema/registration-notes.ts`, `src/modules/registrations/notes.ts` |
| The statistics under the registrations Excel | `src/modules/registrations/statistics.ts`, `registrations/domain/club-runner.ts#isClubRunner` |
| What «Sunt membru al grupului» means | `src/modules/content/members/member-definition.ts`, `app/[locale]/admin/pages/members/DefinitionCard.tsx` |
| The members' levels | `src/db/schema/member-tiers.ts`, `src/modules/content/member-tiers/` |
| The statistics under the registrations Excel | `src/modules/registrations/statistics.ts`, `registrations/domain/club-runner.ts#isClubRunner` |
| The registrations Excel kept live | `src/modules/registrations/sheet-colours.ts`, `src/theme/brand.ts` |
| An email | `src/modules/notifications/templates.ts`, `render.ts` |
| A legal text template | `src/modules/legal-documents/templates/` |
| A visitor's message | `src/db/schema/email-outbox.ts`, `contact/service.ts` |
| The tags at the start of every email the club or a colleague receives | `notifications/domain/subject-tags.ts`, `messages/*.json` |
| Which road a form leaves by | `feedback/domain/branches.ts`, `contact/domain/recipients.ts#contactViaFor` |
| The race declaration's five clauses | `templates/declaration.ts`, `legal-documents/domain/signature-trace.ts` |
| The event editor | `src/modules/content/events/` |
| Which card of the event editor a field sits in | `ui/boxes/*Box.tsx`, `src/app/[locale]/admin/events/[id]/page.tsx` |
| A race number | `src/modules/registrations/bib-geometry.ts`, `bib-header.ts` |
| The bib designer «Cum arată numărul de concurs» | `src/modules/content/events/ui/BibDesignPanel.tsx`, `panel-glyphs.ts` |
| An event as a JSON file | `src/modules/content/events/transfer/`, `file-format.ts` |
| An event's «De făcut pentru pagina evenimentului» | `src/modules/content/events/domain/page-todos.ts`, `src/modules/event-todos/` |
| A race's results | `src/db/schema/event-results.ts`, `src/modules/results/results.ts` |
| «Vin!» on a turn-up event | `content/events/ui/OnlyForTurnUp.tsx`, `boxes/RegistrationBox.tsx` |
| The «Vii mâine la …?» email | `src/modules/rsvp/domain/ask.ts`, `src/modules/rsvp/ask.ts` |
| «Vin!» outside its page | `src/modules/rsvp/coming.ts`, `src/modules/rsvp/public-page.ts` |
| «Vin!» on the last surfaces | `src/modules/home/home-content.ts`, `src/modules/events/ui/EventPageView.tsx` |
| The «Vin!» name switch | `ui/RsvpRemembered.tsx`, `remembered-actions.ts` |
| The members' zone opens on «Alergări» with «Cine vine» open | `src/app/[locale]/members-area/zone.tsx`, `/members-area` |
| The member mark on «Cine vine» | `src/modules/rsvp/domain/public-member.ts`, `domain/identity.ts#identityClubMember` |
| The remembered browser | `src/db/schema/person-sessions.ts`, `src/modules/person-session/` |
| An event's volunteers | `src/db/schema/event-volunteers.ts`, `src/modules/volunteers/domain/volunteer.ts` |
| The volunteer agreement | `src/modules/legal-documents/templates/volunteer-agreement.ts`, `domain/merge-fields.ts` |
| What a volunteer says about themselves, the role's description, and the… | `domain/volunteer.ts`, `volunteers.ts` |
| Who may offer to volunteer | `src/modules/volunteers/domain/access.ts`, `volunteers/invitation-link.ts` |
| Volunteers from 14, with a parent's or guardian's agreement, on a page of… | `modules/volunteers/domain/volunteer.ts`, `modules/volunteers/guardian.ts` |
| The volunteers' page, four small things | `modules/volunteers/ui/VolunteerCallout.tsx`, `volunteers.ts` |
| A calendar button beside the volunteers' «Data nașterii» | `src/modules/registrations/ui/BirthDateField.tsx`, `BirthDatePicker.tsx` |
| An event's volunteer badges | `src/app/[locale]/admin/events/[id]/badges/`, `page.tsx` |
| One volunteer badge for everyone, no role | `badges/badge-design.ts`, `badge-query.ts` |
| The volunteers' page's roles as calm cards and chips | `src/modules/volunteers/ui/VolunteerCategoryCard.tsx`, `VolunteerContactLine.tsx` |
| The volunteers' page tells the volunteer the steps and that the organizers… | `src/modules/volunteers/ui/VolunteerSteps.tsx`, `ui/VolunteerDone.tsx` |
| An event's volunteer roles in configurable categories, each with a contact… | `src/db/schema/event-volunteers.ts`, `modules/volunteers/domain/volunteer.ts` |
| A volunteer role without a number | `domain/volunteer.ts`, `ui/VolunteersCard.tsx` |
| A volunteer role without a number | `domain/volunteer.ts`, `ui/VolunteersCard.tsx` |
| The volunteers' public list | `src/modules/volunteers/domain/public-list.ts`, `volunteers/public-list.ts` |
| Whether the event page shows «Vreau să fiu voluntar» | `src/modules/volunteers/domain/access.ts`, `events/[slug]/page.tsx` |
| The event editor's roles: one form, one save, a card per category | `ui/VolunteersCard.tsx`, `modules/volunteers/role-rows.ts` |
| «Traseul»'s Strava / Garmin Connect maps and its GPX file | `src/modules/events/domain/route-maps.ts`, `route-gpx.ts` |
| A minor signing a group run's declaration beside a parent | `src/modules/group-run-declarations/domain.ts`, `src/app/[locale]/events/[slug]/declaration/page.tsx` |
| «Traseul»'s checkpoints and the race's «Timp limită» | `src/modules/event-checkpoints/domain/checkpoint.ts`, `domain/start.ts` |
| The route's elevation profile | `src/modules/routes/elevation/`, `parse.ts` |
| A new kind of checkpoint, or another way a limit is said | `src/db/schema/event-checkpoints.ts`, `domain/checkpoint.ts` |
| An event's cover picture or its kind | `ui/boxes/CoverBox.tsx`, `src/modules/events/domain/event-kind.ts` |
| The home page | `src/modules/home/ui/`, `src/modules/events/ui/ListingCard.tsx` |
| The public list's «Club» column | `ui/boxes/StartListBox.tsx`, `domain/public-list-club.ts` |
| A setting that is on or off | `src/shared/ui/`, `src/shared/ui/TickButton.tsx` |
| A table or a column | `src/db/schema/*.ts`, `src/db/migrations/00NN_<what>.sql` |
| Colours, fonts, the logo | `src/theme/brand.ts` |
| The look | `src/theme/brand.ts`, `src/theme/theme.ts` |
| The facelift | `src/theme/look.ts`, `src/modules/appearance/domain/site-look.ts` |
| The home page's sections | `src/modules/home/ui/`, `home-glyphs.ts` |
| The calendar under «Tema v2» | `src/modules/events/ui/`, `src/modules/events/domain/next-event-away.ts` |
| The event page's share row with «Adaugă în calendar» as its last pill, and… | `ShareLinks.tsx`, `CalendarFoldClose.tsx` |
| What `/devs` and `/admin/tasks` say | `src/modules/diagnostics/`, `domain/db-sizes.ts` |
| A scheduled job | `src/modules/jobs/`, `src/modules/registrations/maintenance.ts` |
| A volunteer the club types with no address or no telephone | `src/modules/volunteers/domain/volunteer.ts`, `volunteers.ts` |

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
