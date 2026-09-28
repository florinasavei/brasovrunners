<!-- PROJECT_BASELINE: BR-V2.24-2026-09-27 -->

# CLAUDE.md — start here if you are an AI coding agent

**Baseline `BR-V2.24-2026-09-27`** · [changelog](./CHANGELOG.md) · [weekend plan](./WEEKEND.md)

Brașov Runners: a bilingual website and free event-registration platform for a small running
club in Brașov, Romania. One Next.js App Router monolith, PostgreSQL, Material UI.

## Current mode: production is live, the club is finishing its accounts

M1 — event pages, the full registration lifecycle, staff sign-in, legal document versioning,
transactional email, a registrations backoffice, and since 2026-09-18 the race-day desk, a
photo gallery on R2, recurring events and a rich-text event description — exists and is
tested. **Production serves the club's `.com`** (first deployment 2026-09-17; it runs
`BR-V1.69` on schema `0065` as of 2026-09-24) and **QA serves its `qa.` subdomain** (the same
release, plus whatever the open batch PR has merged), each on its own
Neon project in Frankfurt, each with staff sign-in through Zitadel; every environment but
production carries clearly marked sample legal text (`DECISIONS.md` §29), so the participant
journey can be walked on QA end to end. What is left is not application code — it is the list
under "Still owed" below, and it is also `/admin/tasks`, which reads it from the system.

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
yarn test:concurrency  two-connection suite (BR-REQ-051-01 criterion 5); needs the database
yarn test:e2e     Playwright, 320px mobile and desktop; needs the database running
yarn test:e2e:dev  Playwright against `next dev`: every backoffice and public route, twice; minutes; not in CI (§370)
yarn check        docs:check + secrets:check + migrations:check + typecheck + lint + test; CI and the pre-commit hook run this
yarn docs:check   documentation consistency
yarn secrets:check  refuse a commit carrying a provider credential — the repository is public (§98)
yarn migrations:check  a migration expands or contracts, never both (AGENTS.md §7.6)
yarn db:migrate   apply migrations locally · db:seed sample events · db:studio browse
yarn db:seed:legal  the sample legal documents alone; never deletes, safe on a live database
yarn db:migrate:env  apply migrations to local|qa|production — the only supported way to
                  migrate a deployed database (AGENTS.md §7.6, DECISIONS.md §31)
yarn smoke        ask a deployment's /api/health whether it works; ends every deploy
yarn release      versioned archive and share copies under dist/
yarn batch:merge  merge branches into the one checked out; the journal, catalogues and tests by rule
yarn docs:land    land a batch's documents: a dispatcher's manifest, or `--tree` for the branch's
                  own `.release/*.json` entries (`.release/README.md`)
yarn ship         merge a landed PR into qa, release it and wait for production; from a phone,
                  the label `ship` on the PR runs all of it on GitHub (`docs/RUNBOOKS.md`)
```

Full list with explanations: [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md). Do not write a
command into a document until it is in `package.json`.

**Toolchain:** Node 22 (`.nvmrc` says the major, `22`; §125), Yarn 4.18.0 via Corepack, TypeScript 5.9.3 — not 7,
which `typescript-eslint` refuses. Tests need no database: PGlite runs real PostgreSQL in
process. Concurrency tests must not use it; see `docs/DEVELOPMENT.md`.

## Read order

0. [`docs/VIBECODING.md`](./docs/VIBECODING.md) — one page: the loop, where things live, the rules that bite.
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
| No registration without an approved declaration and privacy notice, and no legal text in effect that the club did not approve. The platform ships complete texts as templates (`legal-documents/templates/`), with the club's four facts as visible `<PLACEHOLDER>`s; everywhere but production the seed wraps them in a not-approved banner, and production is refused a seed — the club approves them in `/admin/legal` ("start from the platform's text"). The refusal has a test. | `AGENTS.md` §10.8, §29; BR-REQ-053-01; `DECISIONS.md` §29, §95 |
| Publication is one state per event: both languages go live together, and PUBLISHED requires a complete translation in every locale. A locale with no translation is a 404, never the other language's text. | `AGENTS.md` §11.2, BR-REQ-040-02, `DECISIONS.md` §28 |
| A test registration behaves exactly like a real one in the queue — `kind` appears in no condition in the allocator or the capacity formula — is omitted from every count the club is given, and cannot exist in production. | `AGENTS.md` §12.6, BR-REQ-037-04, `DECISIONS.md` §30 |
| A public participant list is a disclosure, not a display option: `HIDDEN` by default on every event, names only, having ticked "I want to appear" (§143), and never switched on before the approved privacy notice describes it. It shows the confirmed. Only while the notice in force names `{{participantListStates}}` (§396) does it also show the ticked pending and waiting list, each name with its state. Never a cancelled, expired, unconfirmed-address or test registration. | `AGENTS.md` §10.10, BR-REQ-039-01, `DECISIONS.md` §32 |
| Staff may enter, rename, cancel and erase a registration, and — at the race-day desk — confirm one on a paper declaration the *participant* signed, give a waiting-list entry a free place, set a number by hand and check people in. Nothing else: no verified-email edit, no participant merge, no staff-signed declaration (a paper acceptance names the staff member who *recorded* it), and no desk verb that bypasses the allocator or an approved declaration. Every staff role works the desk and sees a name, a state and a number there, never an address. The Organizer reads the whole list, the export and the race numbers and changes nothing on them (§289); cancel, erase, rename, resend and the printing mark stay Administrator-only, and the Tehnic role gets none of it. Erasing releases the place through the allocator and leaves an audit row that names who and why but never who was erased. | `AGENTS.md` §15.11, BR-REQ-037-03, BR-REQ-037-05, BR-REQ-037-06, BR-REQ-037-07, BR-REQ-037-08, `DECISIONS.md` §67 |
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

## What exists right now — the map, with where each thing is decided

Everything below is built, tested and deployed unless a line says otherwise. Each line names
the `DECISIONS.md` section that records *why*; the section is the place to read before
changing the thing. The prose that used to stand here (three hundred lines) is in those
sections and in `CHANGELOG.md`.

**Public site**

- Event pages in both languages, JSON-LD, sitemap, robots; the site root is the listing; an
  unpublished locale is a 404, never the other language (BR-REQ-040-02, §28). Rich-text
  description, rules (`#rules`) and programme (`#schedule`) per language (§71, §96); the
  programme's **timed rows** on the event — a list on the page, repeated in the reminder, one
  calendar entry each (§117). A repeated event is **one line** on the listing and in the
  backoffice (§113); glyphs on type, surface, difficulty and cost (§112); the calendar picks
  a month or a year (§116); a group run takes no registration and has no programme (§111).
- The listing: featured event (its route as the cards' pills, §449), a «Filtre» button with checkbox groups (§413, replacing §133's chips; quieter and closer to the cards §458), a month view (grid from `sm`, agenda on a phone, swiped between months on a touch screen §475), every card's picture in one 16∶9 frame around the club's point (§454)
  (§89); Open Graph cards drawn from the event, a square one for Instagram, share links (§90);
  **events as a calendar** — `.ics` per event, Google Calendar's add link, and a `webcal://`
  feed of every published event (§107). Race week: countdown, "come to the desk with the QR"
  (§76–§79). Gallery on R2, "Galerie" in the nav while an album is published (BR-REQ-054-01, §66); «Echipa», the club's people as cards — rich-text bios and several links each since §474 — in the nav while a card is on the site (§459).
  A place may be **"to be announced"** — withheld in SQL from every public surface and email until
  the switch goes off (§328); **"Linkuri și fișiere"**, up to twelve labelled links per event (a GPX on
  Drive, a PDF, an album) under `#links` (§332).
- **The start to be announced** (§533): «Data se anunță mai târziu» / «Ora se anunță mai târziu» in «Când și unde» — the start withheld in SQL, the page, the card and the share picture saying «Data se anunță în curând» (or the day with «Ora se anunță în curând»), the listing's own «Data sau ora se anunță» section, nothing in a month, the calendar, the feed or the .ics; registration «în curând» at every door until the organizer opens it; refused on a series, on an event anybody registered for and on the lead event; migration `0105`.
- **Night events** (§394, the tooltip §415, the pill «Noapte» §428): whether a date is a night event is computed, never stored — a start at or after civil dusk (or before civil dawn)
  at the club's place (`CLUB_COORDINATES`, default Brașov) on that date, through the NOAA solar algorithm in the platform; the pill «Eveniment de
  noapte» keeps the headlamp glyph and says the sunset; a series answers per date; the editor's «Eveniment de noapte: Automat / Da / Nu» overrides
  it (the column of §382 became the tri-state override); the reminder says the sunset and «ia o frontală» only on a night date.
- **An external event paid at the organizer's** (§395): the cost row reads «Cu taxă, la organizator», the club's discount note in the reader's
  language under it (both languages or neither, only for EXTERNAL + PAID), the ics cost line, JSON-LD `offers.url` at the organizer's form.
- **The partners as a block** (§401): «Împreună cu» on the event page is a collapsible block with the partner cards inside; the listing's filter row keeps a step of space above the grid and offers a «Colaborare» / «Partnership» chip while a partnered event is on the calendar.
- **The weather** (§402, §416, the pill among the route pills with an umbrella §429): the forecast for the event's date and start hour at the event's own place (the map link's coordinates, else the typed «Coordonate», else the club's), from Open-Meteo (free, keyless, fetched on the server and cached an hour), on the event page within seven days and in the reminder — since §469 one line on both (the sky, the start hour's degrees, «ploaie probabilă N %» only when rain is likely), the cards' pill unchanged; nothing when unavailable.
- **The difficulty scale** (§526, replacing §412's five words): five bands — ușor, mediu, greuț, greu, foarte greu — of three steps each, fifteen levels in one `events.difficulty_level` column (NULL shows no pill); the gauge draws the band and the step as dots, the emails and the calendar say «Mediu, treapta 2 din 3», the listing's filter ticks a whole band, and «Ghid» explains the club's scale.
- **«Întrebări frecvente» / "FAQ"** (§525): `/ro/intrebari`, `/en/faq`, a platform page like «Echipa» — questions and rich-text answers in both languages, grouped by an optional category, each a native fold with its own deep link, `FAQPage` structured data; in the menu only once the page is published and a question is on the site.
- **The members' zone** (§524): «Beneficiile membrilor» at `/ro/membri` is public and carries the sign-in button; the members-only page is `/ro/zona-membri` (`/en/members-area`), outside `/admin`, `noindex`, opened by any signed-in account — a member sees it and nothing of the backoffice.
- **A film's poster and volume** (§403; a film is a node in the description since §481; the corner glyph and the HD hint §478): the club's own stored copy of a YouTube thumbnail before the click (nothing from Google until then), a server-rendered facade that works without JavaScript, a mute/volume bar after the click.
- The header lockup (§58); the kit-face wordmark at the head of the listing, the calendar and the contact page (§292), never in the header
  (`shared/ui/Wordmark`, CHANGELOG `BR-V1.32`); `PAGE_WIDTH` in `theme/brand.ts`; a
  dark scheme by the switch only (§93); icons from `@mui/icons-material`, one file per glyph; every backoffice button's glyph by name from `shared/ui/action-icons.ts` through the admin-only `GlyphButton` / `GlyphSubmitButton` / `GlyphButtonLink`, never on a public page, and the club's runner on the public send buttons (§318).

**Registration**

- One door, `RegistrationCta`: the organizer's own link, the button with the free places, the
  waiting list, or a sentence — and one count, `readPublicAvailability`, the allocator's own
  formula, never a second one; an uncapped event shows no number (CHANGELOG `BR-V1.19`,
  `AGENTS.md` §10.6). One-page form, required half first, optional sections
  folded but open (§59), a consent never folded; a rejection returns to a focusable error
  summary naming each field (§47). Phones are E.164 (§84); citizenship; the runner's language
  for the emails and the declaration (§97); "I am a Brașov Runners team member" is a claim
  that grants nothing (§48); `FEATURE_DISPLAY_NAME` (off) hides nicknames (§95); the event's
  date, place and links to its page, its rules, the terms and the privacy notice on the form
  (§102); an optional **socials** section — Strava link, Instagram username (§106); a parent
  registers a **minor**: the guardian's name, required under eighteen (§108); nobody under **the event's own minimum age** (default 14, 0 for none) on the race day, counted in the race's own zone, at every door (§321, §329).
- The flow in five steps on the form and the event page (§91): form → email link (48 h) →
  the declaration → confirmed (QR, race number) → race day. **A free race is confirmed a week
  before**: for an event further away than its participation window (per event — 0 as the second number means the place never expires before the start (§407) — default asked
  7 days before, due 2 days before), the place is held until the deadline and the declaration —
  the confirmation — is asked at once and again when the window opens; inside the window and
  on a weekly run, the thirty-minute hold (§104). **Every such deadline is the club's "Termene" setting** — «Setări» → «Termene» since §516 — since `BR-V1.86` (§377, the recommended values and the one-press fill §456; 30 min / 24 h / 48 h by default), the reminder per event or the club's.
- The lifecycle (audited 2026-09-25, §420: no dead offer after the close, a number only for a confirmed address, every family link live, the desk race refused), one allocator for the click and the job, proven under real concurrency
  (`tests/concurrency/capacity.test.ts`); the 30-minute hold, the waiting list and its
  24-hour offers, self-unregistration, the maintenance job (`AGENTS.md` §10.5–§10.6, §40, §68). Test registrations
  (`kind = TEST`) go through the same queue and are counted nowhere the club looks (§30).
  A public participant list, built and `HIDDEN` until the privacy notice describes it (§32); since §396 it says each runner's state and lists the pending and the waiting list, once the notice in force names `{{participantListStates}}`.
- The declaration: the club's text with tokens — `{{participant}}`, `{{declarant}}`,
  `{{guardian}}`, `{{idDocument}}`, `{{event}}`, `{{eventDate}}`, `{{eventLocation}}`,
  `{{signedAt}}` — the identity document typed at signing and never scanned, the signature in
  a hand, the signed PDF emailed back and rendered per event, the blank paper form; retention
  three years, the document and the health note seven days after the event (§85–§87, §95).
  A **minor's declaration is signed by the minor and the parent**, each with their own identity document, once the declaration in force names `{{participantIdDocument}}` — until the club approves such a text, the parent signs alone as before (§330). The club's archive copy of every signed declaration to `DECLARATIONS_ARCHIVE_TO` (§99), the identity document masked (§320).
- A **family on one address** (§389; the declarations as one wizard §471): the form sent again with another name creates nothing and emails the address a single-use link
  to register the other person, the address fixed; the club's limit per address is in "Termene" (default 4); each person confirms, signs
  and gets their own QR code. It is on since `BR-V1.94` (migration `0073` dropped `registrations_event_participant_unique`; §390).
- **A family in one sitting** (§519, amending §389, §446 and §471): after the form the screen asks «Mai înscrii pe cineva cu aceeași adresă?», the next form keeps the address and the shared boxes, and nothing is mailed until «Gata» or the «Termene» window; from the second person on it is one email with every person and one button that confirms them all and opens the declarations wizard; «Toate înscrierile mele» shows each person's declaration. Migration `0096`.
- A **group run may offer an optional self-declaration** by surface, asphalt or trail (§393): a checkbox in «Traseul» (on by itself for
  trail), a named section with one button on the run's page, the same signing parts as the race declaration (typed identity document, a hand
  signature, the runner's language), the PDF to the signer and the club's archive with the document masked, seven days' retention, never a
  registration; refused while no approved text of that surface or no approved privacy notice is in force; Organizer and Administrator read the
  signatures, an Administrator erases one with an audit row.
- Race numbers in registration order from the event's own first number (§173, reversing §94),
  never reused; a picture of every bib, a bib
  sheet, and the small print the club composes per event — one or two lines, the same on the paper and the preview (§317); a preferential number typed by hand among the free ones, emailed to the runner
  (§87, §94, §105). Check-in codes and hosted QR; "Înscrierile mele" on one link (§77).
- Anti-bot: honeypot + timing check; Cloudflare Turnstile behind two keys (§97).

**Email**

- 27 message types (`email_outbox.email_message_type`; the newsletter, its confirmation and the new-event alert since §445) — the organizer's **update notice**, sent only when they tick "Anunță participanții", and the **cancellation** with its reason are the newest; a cancelled event goes quiet (§331) — bilingual by default, one branded
  card, the action as a button, deep links — event, programme, rules, "I can't make it any
  more", the PDF — and every one previewed on «Setări» → «Emailuri» (§81, §91, §96). Tokens minted
  at send time, hashed at rest, single use (`AGENTS.md` §14.5). `EMAIL_DELIVERY_MODE` is `live`
  only on production — QA `allowlist`, local `capture` — and live outside production is refused
  at startup (§37, `AGENTS.md` §16). The outbox drains after the request that
  queued it and on the scheduler (§68); a spent Mailgun allowance defers, never discards (§40).
  The club's copy of a participant's message is a separate "[Copie club]" message per address, with no token, QR or attachment, and Mailgun open and click tracking are off on every message (§320). The reminder before the start (the club's lead or the event's own, 48 hours by default, §377), the thank-you after (§81–§83); the participation confirmation
  when the window opens (§104); the number given by hand (§105).
- **Emails leave on the scheduler's tick** (§513, amending §68): on QA and production a queued message waits for the next outbox run (15 minutes by day, an hour at night, longer under the budget governor) instead of leaving after the request; «Setări» → «Termene» → «Când pleacă emailurile» switches it back (Administrator); the screens after the form, the resend and the newsletter pop-up say the real wait, and a deadline an email carries runs from its send, not its queueing.
- **The confirmed email, the reminder and the declaration request carry one facts block** (§392): Când (with the weekday), Unde (the place
  in that language, the address, the map), Program (the timed rows), Traseu (the page's own route words), Cost (only when not free), Linkuri
  (the page's anchors by the page's own rules, `#links` only when the section exists) — one function, drawn once per language half, in place
  of §81's bold line; the club's copy keeps it without the QR.
- **The Mailgun plan is a setting** on «Setări» → «Emailuri» — Free, Basic, Foundation, Scale or
  typed ceilings — and every "how much can we still send" figure and the cost table follow it
  (§100). **The club is told when email stops**: `/api/health` answers 503 for anything but
  `ok`, with an `email` block; a cron-job.org monitor with failure notifications is the alarm
  (§98). Canonical email identity, versioned; Gmail dots are two addresses (§74).

**Backoffice**

- Six roles the club can name (the Administrator runs the club, the Superadministrator the platform: §450) — Voluntar (the desk only), Redactor (the words), Organizator,
  Tehnic, Administrator, Superadministrator — asserted on the server (§103, BR-REQ-060-01);
  Zitadel sign-in (§26); `STAFF_AUTH_MODE`: `provider` deployed, `dev-switcher` locally and in
  tests, `disabled` answers 404 to every staff route (`AGENTS.md` §13.1). `/admin/guide` opens the reader's
  own sections first (§103).
- **Members** (§524): a seventh role, `MEMBER` (rank 0, below the volunteer), is a `staff_users` row added on «Echipa» — one by one or «Adaugă mai mulți membri» for a list — invited by Zitadel with the same key; `requireStaff` answers null for it, so every backoffice page, action and route refuses a member as it refuses a stranger. Its texts are «Pagini» → «Pagini standard» → «Membri», published by an Administrator.
- **«Setări»** (§516): one main-bar entry with tabs at `/admin/settings/<tab>` — «Emailuri», «Termene», «Aspect», «Costuri», «Anti-robot» (named «Platformă» until §522; «Contact» moved to «Pagini» → «Contact», `/admin/pages/contact`, on 2026-09-28), then «Configurație» (`/devs`) as the last tab and its only way in (§520); every club setting lives there (the Mailgun plan, the deadlines, the site's tint, the money and Neon's limits, the anti-robot switch); «Sarcini» keeps «Club», «De făcut» and «Aplicația», each row linking to the tab and card where it is done; every old address (`/admin/emails`, `/admin/tasks?panel=costs` …) answers a 308.
- The whole of an event in one form and one save, both languages together, versions on the
  row and the translations (§28, §36, §64, §70, §71); recurring events published as a series;
  the ⋮ menu; the queue panel with the waiting list in order (§92); the participation window's
  two numbers (§104). Legal documents written, approved and never rewritten (§46, §53, §57), and a terms version deletable once nobody agreed to it while it was in force (§316);
  "start from the platform's text" prefills the club's three texts (§95). Standing pages in
  the editor, pictures in the text (§72–§73).
- **The editor mirrors the page** (§406, amending §350 and §358; the cards regrouped and the film card retired §481): one card per public-page section in the page's order, a page map at the top that opens each card, every closed card's line naming the required fields still empty per language, and «Creează și publică» / «Publică» always at full look — pressed with something missing, they open the §47 refusal summary instead of dimming.
- Registrations: list, filters (bounced too), timeline, resend, CSV with names, identity
  document, socials, guardian, check-in and bounce (`AGENTS.md` §15.10); enter, rename, cancel,
  erase — erase takes the declaration acceptance with the row in one transaction, the audit row
  first, which cancelling never does (§33, §44, §67, §88); "Trimite acum" within the allowance (§80). The race-day desk on a phone: scan or
  type, confirm on paper, give a place, a number, check in, walk-ins (§67); the desk row names
  a minor's parent (§108).
- **What wakes the database, and the brakes on it** («Costuri» as the money page — the month so far, the projection, the database's configuration: §479) (the metered figure, the budget governor and the suspended mode: §447) (the bill is time awake, §327): anonymous public
  traffic reads rows from Next's data cache, expired by every write that changes them (§333); a job
  ping with nothing due answers without the database, and the Administrator may set a minimum
  interval between real runs on «Setări» → «Costuri» (§334, §516); the "Limitele bazei de date" card
  reads and sets Neon's size ceiling and monthly quota, and `/api/health` warns at 80% of it (§335).
- Backoffice folds start closed and open themselves only for a refusal, a save, a warning or the
  address's `#` (§336); «Setări» → «Emailuri» is one card of cards (§516). The telephone is one box with a flag
  and a mask (§337); a bib is a true A5 sheet, two to an A4 page (§338).
- **Batch 3 (2026-09-24):** tooltips that explain, with a series naming the dates it left as drafts and a switch
  to publish new ones automatically (§341); a canonical and `hreflang` on every public page, the sitemap to match (§342);
  cost as Free / Paid with an amount / Donation on another site (§343); partners as cards of typed links (§344);
  the MUI date picker in the backoffice, always 24-hour and day-first (§345); the time field is the platform's own since §400; "12 înscriși din 50 de locuri"
  beside the register button, from the cached count (§346); integrated together in §347.
- **Batch 4 (2026-09-24):** an event may cap its waiting list — empty is unlimited, 0 is none — counted under the
  allocator's lock at every door (§348); every date a person reads carries its weekday in the reader's language,
  through one helper, `src/i18n/dates.ts` (§349); the event create page and editor are one layout — Publicare and
  Recurență beside fourteen named cards in three groups, per-card RO/EN tabs, the series scope as three choices (§350).
- **Batch 5 (2026-09-24):** a series' draft line says "N date noi, create automat, nu sunt pe site" and carries
  „Publică” and „Publică automat de acum” on the row (§351); a partner card has a short description of the partnership
  in both languages, its registration link first, and **every optional text the club types is both languages or neither**,
  refused at save — the owner's rule "multi-lingual, always" (§352, `src/shared/forms/both-languages.ts`).
- **Batch 6 (2026-09-24):** public pages carry only their islands' words — the listing 119 → 39 KB on the wire —
  and `/ro`, `/en` are a real 308 from `src/proxy.ts` (§353); bilingual everywhere: the organizer's note and the
  cancellation reason in both languages, each registrant reading their own; page SEO and album descriptions both or
  neither; one-sided labels read as a pair; "the same words in both languages" warned (§354).
- **Batch 7 (2026-09-24):** the jobs' safety look on the pinger's hour, one wake per idle hour (§355); the event page's
  facts grouped by question — "Când" on one line, the address under the place, route and cost as pills (§356); the
  declaration names the risks the runner takes on, and no legal text or email carries a hardcoded value (§357);
  the work queue in `docs/QUEUE.md`, updated with every batch.
- **Batch 8 (2026-09-24):** the event editor's first card holds the status, the course and the links as named cards,
  create and edit alike (§358).
- **Batch 9 (2026-09-24):** the email editor starts from the placeholders, a sample value is refused at save and an
  old one flagged with "Înlocuiește cu câmpurile" (§359); every backoffice sub-navigation is one row of secondary tabs (§360).
- **Batch 10 (2026-09-24):** both text editors' toolbars wear Material icons with tooltips, one shared `ToolbarButton` (§361).
- **Batch 11 (2026-09-24):** the meeting point is asked once per language, Română and English side by side, and every
  reader sees the place in their language; the server never fills a blank English name (§362).
- **Batch 12 (2026-09-24):** the editor's floating bars are lifted on what they render (Tiptap drops their style in
  production) and a fold keeps its state across the language tabs (§363); organizers write to an event's participants,
  in both languages, by group, through the outbox as `ORGANIZER_MESSAGE` (§364, migration `0068`); the phone's footer
  floats one line and rests two, the build stamp in the "Despre club" fold (§365).
- **Batch 13 (2026-09-24):** the listing's cards are one structure — the title the blue link, the place its map, the
  time its clock, route and cost as the page's pills (§366); a partnered event wears a handshake on its card, calendar
  entry and page, and a series' usual place is read, not compared byte for byte (§367); the dispatcher is in the
  repository — `docs/DISPATCHER.md`, the `br-chain` and `br-fix-round` workflows, `yarn docs:land`, `yarn ship` (§368).
- **Batch 7 (2026-09-24, `BR-V1.83`):** the club's name has one source, `CLUB_NAME`, and the last hardcoded values
  leave the documents and screens — a donation event reads as free to attend with a `DonateAction`, the queue panel in
  the event's zone, the legal editor keeps its height (§369) · the backoffice works under `yarn dev` again: no element
  prop into a client component (a source-walk test in `yarn check`), no bare template lookup, `yarn test:e2e:dev` (§370) ·
  a save press paints "Se salvează…" first — every measured press under 200 ms at 4× CPU, `afterPaint` (§371).
- **Batch 8 (2026-09-25, `BR-V1.84`):** the phone footer is one row from 320 px — every item on it, a lock glyph for the
  privacy notice, RO and EN as flags with the current one ringed, 24-px targets below 360 and 28 up to `sm` (the owner's
  choice; §372) · the email editor's placeholder legend and preview sample, the save guard on sample values, and a bilingual
  email's second half entirely in its own language, the status in words (§373) · the dispatcher guards its own context,
  `yarn ship` continues past a merged batch PR, a worktree-sweep card, a resumed branch still gets its review (§374).
- **Batch 9 (2026-09-25, `BR-V1.85`):** the listing card: one handshake glyph and never a partner's name, the next date and
  its time on one line on a phone (the lead «Următoarea:» only where the widest date still fits), the pills in the order
  surface, difficulty, distance, elevation, cost (§375) · the `/admin/legal` notice says what the code enforces and folds
  closed on the legal page; a malformed admin id answers 404 on every backoffice page and API route (§376).
- **Batch 10 (2026-09-25, `BR-V1.86`):** "Termene" — every participant-facing deadline is one club setting on `/admin/emails`
  (the email link, the declaration hold, the waiting-list offer, the reminder with a per-event override, self check-in, race
  week, a series' horizon), Administrator-only and audited, applied to new holds and offers only; every email, page and legal
  template takes its words from it through placeholders, the reminder clause hedged for the event's own choice; migration `0069` (§377).
- **Batch 11 (2026-09-25, `BR-V1.87`):** the footer's privacy notice is a question mark right after "Despre club" on a phone and
  the word "GDPR" from `sm`, the phone bar's items 6 px apart (§378) · the partner marker is the 🤝 emoji everywhere (§379).
- **Batch 12 (2026-09-25, `BR-V1.88`):** one phone density scale, `src/theme/density.ts` (eight steps used only below `sm`), on every
  public page — the listing 118 px shorter at 360 px, an event page about 50 — with a test that holds every changed site to its desktop value (§380) · the partner card is an outlined, tinted surface in both schemes and the listing card's time is bold like its date, a race's two times included (§381).
- **Batch 13 (2026-09-25, `BR-V1.89`):** "Necesită frontală" — a per-event headlamp mark: a checkbox in the editor's "Traseul" card (a series carries it by scope), a
  headlamp pill after elevation on the card, the hero and the event page, a line in the calendar entry's tooltip and the `.ics`; migration `0070` (§382).
- **Batch 14 (2026-09-25, `BR-V1.90`):** "Următoarele emailuri automate" on `/admin/emails` — every email the platform will send on its
  own in the next fourteen days, from the jobs' own formula (one pure module both the jobs and the panel call), with the recipients
  the job would pick now and the "Copie club" line (§383).
- **Batch 15 (2026-09-25, `BR-V1.91`):** every backoffice action that worked says so in a toast (a flash cookie across redirects, never twice),
  and every irreversible or outward-facing one asks first in one `ConfirmDialog` — publishing, cancelling, erasing, notices, messages, settings,
  the team, the legal versions — naming how many real participants are emailed, from the query the send uses; test rows counted apart;
  check-in stays one tap; the bulk cancel's ticks now belong to their form (§384) · the phone footer says "GDPR", a rule before RO/EN, a condensed fold, the version as a chip (§385) · the 🤝 marker in gray ink, the chip says "Colaborare" / "Partnership" (§386).
- **Batch 16 (2026-09-25, `BR-V1.92`):** a route / training description per language in the "Traseul" card — pit stops, climbs, a map as a
  picture in the text, both languages or neither — shown on the event page as "Traseul" under `#route` with the route link, the GPX and the map
  inside it while "Linkuri și fișiere" keeps the rest; the emails deep-link by the page's own rule; the orphan-picture sweep now counts every
  text of an event (§387, migration `0071`) · the backoffice event cards wear the public card's type chip, route pills and 🤝 marker — one shared `buildRoutePills` / `RoutePills` draws the listing card, the event page's own rows and the backoffice list (§388) · the phone tap-target e2e assertions round to a tenth of a pixel (the CI flake).
- **Batch 17 (2026-09-25, `BR-V1.93`):** a family on one address — the form sent again with another name creates nothing and emails the
  address a single-use link to register the other person, the address fixed; the club's limit per address in "Termene" (default 4); each
  person confirms, signs and gets their own QR code; dormant until `BR-V1.94`'s contract migration drops the old one-per-address index
  (§389, migration `0072`) · the share picture's button says "Descarcă poza" / "Download the picture".
- **Batch 18 (2026-09-25, `BR-V1.94`):** the family flow is open — the contract migration `0073` drops the old one-registration-per-address
  index; the gate reads the catalogue, so the flow switched itself on with no setting; the privacy-notice template says whose data is entered
  and whose inbox receives the messages; `migrations:check` still misses `DROP CONSTRAINT` as a contract (a chore) (§390).
- **Batch 19 (2026-09-25, `BR-V1.95`):** the partner marker is Material's `Handshake` glyph again, drawn in each surface's own ink — the
  grayscale-filtered 🤝 of §379/§386 read as a smudge (§391).
- **Batch 20 (2026-09-25, `BR-V1.96`):** the confirmed email, the reminder and the declaration request carry one facts block — when, where,
  programme, route, cost, the page's links — in place of §81's bold line (§392) · an optional self-declaration on a group run, asphalt or
  trail, signed on the site and emailed to the signer and the club's archive, seven days' retention, two more legal texts to approve (§393,
  migration `0074`) · «Eveniment de noapte» computed from civil dusk at the club's place per date, the editor's Automat / Da / Nu override,
  replacing §382's checkbox (§394, migration `0076`) · the club's discount note on an external event paid at the organizer's, «Cu taxă,
  la organizator», the ics cost line, JSON-LD offers at the organizer (§395, migration `0075`) · the public participant list says each runner's state and lists the ticked pending and waiting list, only while the notice in force names `{{participantListStates}}` (§396) · Panel's help variant («Ce înseamnă fiecare tip?», the email legend with an «i»), a new event free by default, the robot glyph on every automatic line (§398) · `/admin/tasks` → «Aplicația» renders `docs/QUEUE.md` read-only through the `/devs/docs` renderer, for Administrator, Superadministrator and Tehnic (§397).
- **Batch 21 (2026-09-25, `BR-V1.97`):** the difficulty pill is a scale of dumbbells, the word beside it and in the accessible name (§399) · a YouTube film shows the club's own stored poster before the click and a mute/volume bar after it, the facade server-rendered, no poster fetch inside a transaction (§403, migration `0077`) · the backoffice's time field is the platform's own `<input type="time">`, 24-hour, any minute — §345's wheel picker gone, its date picker kept (§400) · «Împreună cu» is a collapsible block on the event page, the listing's filter row sits a step above the grid and offers a «Colaborare» chip while a partnered event is on the calendar (§401) · the weather for the event's date and hour from Open-Meteo (free, keyless) on the page within seven days and in the reminder (§402).
- **Batch 22 (2026-09-25, `BR-V1.98`):** every night sentence names the start, the sunset and the end — «Începe la 19:00, apusul la 19:00, se termină la 20:40» — the tooltip, the month view, the .ics line, the reminder and the editor's line alike, a pre-dawn start with its own shape (§404) · the editor mirrors the page: one card per page section in the page's order with a page map, every closed card naming its missing required fields per language, create-and-publish always at full look and opening the refusal summary when something is missing (§406) · the programme card's rows are one grid with the help folded and a new row starting on the event's day (§405) · the confirmation window's second number accepts 0 — the place never expires before the start — and the card says when a runner can confirm (§407) · the registrants' count is said once under the editor's header, the orange outline alone marking the cards whose changes notify participants (§408) · the race's listing card carries the register button and a bold line with the free places, from the one availability count (§409) · the age sentence says the minimum and the parent's consent plainly — «Vârsta minimă: 14 ani. Sub 18 ani, înscrierea se face de un părinte, cu acordul acestuia.» (§410) · the end-to-end specs read a listing card through its fold and the tasks page by its pathname, so the full two-project run no longer flakes on order (§411).
- **Batch 23 (2026-09-25, `BR-V1.99`):** the difficulty has five levels — foarte ușor, ușor, mediu, greu, foarte greu — drawn as one gauge glyph with the needle at one of five positions, the dumbbells of §399 gone, migration `0078` (§412) · pictures are stored as a ladder of sizes per kind, WebP, never upscaled, and served with `srcSet` + `sizes`; «Calitate: Normală / Înaltă» beside every upload, the stored facts shown after it (§414) · the weather reads the event's own place — the map link's coordinates, else the typed «Coordonate», else the club's — the featured card carries the row and the small cards a glyph with the degrees, the page three hours and the start hour's details (§416) · the listing's filters are one «Filtre» button, collapsed by default, opening checkbox groups — type, surface, difficulty, distance, cost, night, collaboration, registration open — only the values on the calendar, the state in the address, working without JavaScript (§413) · the night pill's tooltip says only the sunset — «Soarele apune la 19:00» — (the sunrise on a pre-dawn start); the calendar entry, the .ics and the reminder keep §404's full sentence (§415) · a picture in the short description is on the listing card whatever the length of the words — the three-line clamp of §366 holds the words alone, never a picture (§417).
- **Batch 24 (2026-09-25, `BR-V2.00`):** the five legal templates, the paper form and the signing page rewritten per the counsel review — informed acceptance of risk within the law (Codul civil art. 1355), the family flow allowed, minors split at 14, no identity number on a group-run declaration, accurate processors and retention, «un părinte sau tutore» (§418) · the emails per the review — the data's source and the link's life on a family registration, the offer's deadline, masked identity numbers, a guardian's greeting, a way to withdraw in the update notice, two club copies fewer (§419) · the registration audit's fixes — offers never past their deadline after the close, provisional numbers swept and drawn where the rules say, no settled number for an unverified address, the verification link's true life, a closed registration's declaration link never crashes, the restart keeps the participation window, a misconfigured Turnstile fails open with a health warning, the family link stays live for its window, the desk's counts real only (§420) — migration `0080` (every family link stays live; stale provisional numbers cleared) · an express terms tick that records the accepted version (migration `0081`), an adult on a family link keeps their own consents, the public list's states only under the notice that names them and for a club-set period, emergency contacts purged at seven days (§421).
- **Hotfix (2026-09-26, `BR-V2.01`):** the registration form's race-rules box sits inside the read button and is required, a live «Mai lipsesc:» list above the send button names every missing thing with a link to it, the read-to-the-end gate re-measures itself, one asterisk on the repeat-email label — the owner's QA morning, 2026-09-26 (§422).
- **Batch 25 (2026-09-26, `BR-V2.02`):** «Publică» on a draft's own editor in one press, as «Creează și publică» does (§423) · the «Filtre» button and its boxes are small 24-px chips inside their 44-px tap targets (§424) · the registration's page and the export say which terms version was accepted and when; a staff entry says «pe hârtie» (§425) · `yarn ship` judges settled checks, `docs:land` refuses blanks and a fixer's housekeeping, dropped indexes and constraints are contracts, the `next dev` walk runs nightly on qa (§426) · the contact form, self-unregistration and the signed declaration say their outcome in a toast through §384's flash, mounted only where a flow lands (§427) · the night pill says «Noapte» with a crescent, the sunset proven to the minute against reference times (§428) · the card's weather pill sits last among the route pills, with an umbrella when rain is likely (§429) · an Administrator button gives the pictures uploaded before §414 their ladder, in batches, idempotent (§430) · the register form’s round-two follow-ups over the hotfix — the «open and read» words only for an event with rules, the no-JavaScript render test.
- **Batch 26 (2026-09-26, `BR-V2.03`):** chore/ci-e2e-sharded (§431) · citizenship is required on the form, «Română» by default (§432) · the backoffice asks a duration as hours and minutes (§433) · albums outside events and a public gallery page (§434) · a `.com` renewal row on `/admin/tasks` (§435) · a backoffice save blocked by a corporate proxy falls back to a plain form post and says so; `/admin/network` names what IT must allow (§436) · the picture upload offers Minimă / Medie / Mare / Originală and shows the picture's dimensions and weight (§437) · `/admin/tasks` lands on «Club» and gains «De făcut», the club's shared checklist pre-filled with the Administrator's and the Organizer's lists (§438) · every time reads 24-hour in both languages through the one date helper (§439) · the group-run self-declaration has a minimum age (§440) · the backoffice guide rewritten per role as numbered steps with the exact button words (§441) · the contact page shows the club's address(es) by a setting (§442) · every email picks Mailgun or the club's Gmail by a setting per message group, Gmail's daily cap and pace as settings; migration `0088` (§443) · spare bibs for on-the-spot entries: pre-printed numbers from a range reserved for the desk, an empty name line, the desk suggests the next spare (§444) · the newsletter with opt-in topics and new-event alerts: a pop-up on the contact page, double opt-in, a manage/unsubscribe link on every message, a composer on `/admin/emails`, a notice paragraph, migration `0082` (§445) · registering another person on the same address is one confirmation from the inbox — the second form with a different name AND birth date is kept as a pending entry and the email lists the address's registrations with «Confirm că înscriu altă persoană»; migration `0084` (§446) · the compute figures read what Neon meters; a budget governor throttles jobs and public reads as the month runs ahead; a suspended database is served from the saved copy with a banner (§447) · the event's status lives in the editor's first card and the declaration selector under «Regulament» (§448).
- **Batch 27 (2026-09-26, `BR-V2.04`):** the featured hero's route row is the listing card's pills — surface, difficulty, distance, climb, night, cost — with the amount and the route's links under them (§449) · the Administrator runs the club — the team (every role but the top one), the legal texts, the plans and the club's settings — and the Superadministrator keeps the platform limits and the Superadministrator grant (§450) · «Înscrierile se deschid în curând»: a tick in the registration window keeps registration shut and says "soon" on the page, the card and the calendar, «Anunță-mă» still taking addresses; migration `0089` (§451) · dates read as Romanian is spoken — no «pe» before a weekday-led date, «la» / «at» before the hour inside a sentence (§452) · a visible separator under every backoffice table row, in both schemes (§453) · every listing card shows its picture in one 16∶9 frame around a point the club picks («Centrul pe card»); the crop box and the upload offer fixed shapes — Liber, 16:9, 4:3, 1:1, 4:5 (§454) · Open-Meteo credited once, in the footer (§455) · «Termene» names each deadline's recommended value and sets them all in one confirmed press (§456) · the club's copies (Bcc) on `/admin/emails` save and are shown back, a refused save naming the entry that is not an address (§457) · the filters panel drops its explanatory sentence and sits closer to the cards (§458) · «Echipa» / "The team", a page like Contact with person cards in both languages kept in Pagini → «Pagina Echipa», in the menu only while a card is on the site; migration `0090` (§459) · the four typefaces are the repository's own files through `next/font/local`, nothing fetched from Google at build — the CI shards' font flake is gone (§460) · the contact page always shows the club's address as a mail link beside the form (§461) · Reply-To defaults to the club's own mailbox and the newsletter goes through Mailgun, both as settings (§462).
- **Batch 28 (2026-09-27, `BR-V2.05`):** the phone-prefix and citizenship pickers take a typed search — accents and case ignored, +40 / 40 / 0040 find România — over the native select that still posts (§463) · «Tradu din română» — one press fills an event's, a page's or an album's English boxes from the Romanian through DeepL's free API, the layout kept, nothing saved by the press, a daily character budget on Costuri (§464) · the listing's past-events help line is gone (§465) · the editor's Cost card folds into «Ce fel de eveniment» (§466) · the typed birth date is echoed in words under its box with the age on race day, and the city is required, right after it (§467) · the family-link email is a bold facts block with a second, single-use action «Nu înscriu această persoană» that deletes the pending entry (§468) · fix/event-page-minimal-weather-back-arrow-edit-glyph (§469) · feat/one-event-card-hero-and-list (§470) · several people on one address sign their declarations in one wizard — «Declarația n din N», one PDF each, «Semnez mai târziu» to skip (§471) · the card's registration line bolds only the closing date with its hour and the free places (§472).
- **Batch 29 (2026-09-27, `BR-V2.06`):** a discreet «?» after the event page's weather line — an indicative forecast, data from Open-Meteo (§473) · «Echipa» grows up: a rich-text introduction and bios, several typed links per person; migration `0091` (§474) · the calendar's month view swipes between months on a phone, like Google Calendar (§475) · the «Înscrieri» badge says what it counts, per upcoming event, in a tooltip (§476) · the image-quality end-to-end spec runs on both projects again, lighter (§477).
- **Batch 30 (2026-09-27, `BR-V2.07`):** the film's volume is a quiet corner glyph with the slider on demand, and the film asks YouTube for HD first (§478) · «Costuri» is the club's money page — the month so far per provider at the published price, a projection to month end, the database's configuration in one card (§479).
- **Batch 31 (2026-09-27, `BR-V2.08`):** the measured density pass at 360 px — the «Despre club» fold 180 → 96 px, true 44-px folds, inline links that keep their line, the cards and the event page tightened on the scale (§480) · the editor's cards regrouped — «Când și unde» and «Program, regulament și declarație» as one card each, the film card gone and every film a node in the description; migration `0092` (§481) · «Copiază și tradu tot: RO → EN» at the top of every editor, always visible, one press fills every English box through DeepL (§482) · the nits of V2.03–V2.07 — no colleague's name in the public repository's source, one audit id per setting, the .ro row gone, Echipa's bounds, the editor's leftovers (§483) · the weather line names its place and its hours — «Vremea la <loc>, <zi> HH:MM–HH:MM: …» — on the page and in the reminder (§484) · «Din galerie» beside every picture upload, the same crop box and shapes after the choice, the film's poster a gallery picture the club replaces and crops (§485) · the whole listing card is one tap to the event page, its inner links kept, and a recurring event wears a repeat glyph with its rhythm (§486) · the calendar page's head on a phone — a «?» in place of the intro, small month/year selects on one row with ‹ Azi ›, the chip pairs small (§487).
- **Batch 32 (2026-09-27, `BR-V2.09`):** «Aspectul site-ului» — the public pages' light background tint as a club setting, presets from the club's colours, a contrast guard (§488) · the public pages measured on a production build and the top wins taken — query counts pinned by a test, dead code removed (§489).
- **Batch 33 (2026-09-27, `BR-V2.10`):** the review nits of V2.08–V2.09 — orphaned keys, the guide's exact button words, stale comments, the calendar's desktop gap (§490) · the film columns and the six-link check retired (migration `0093`), the twelve-link check (`0094`), the snapshot chain repaired at its newest link (§491) · end-to-end coverage for «Din galerie», the whole-card tap and the calendar head, run against a build (§492) · the V2.03 behaviour nits — a Gmail cap deferral is not a stall, a permanent SMTP refusal is FAILED, one connection per drain, the governor's RED edges, the newsletter alert under the lock, twins named (§493).
- **Batch 34 (2026-09-27, `BR-V2.11`):** chore/migration-0095-film-columns-dropped (§494) · chore/queue-after-v203-rest (§495) · fix/toasts-on-top-and-translate-done-toast (§496) · fix/deepl-credit-from-usage-api (§497) · fix/event-page-conditions-fold-and-public-buttons (§498) · fix/declaration-documents-say-their-version (§499) · feat/start-list-socials (§500) · chore/cloud-session-setup (§501).
- **Batch 35 (2026-09-27, `BR-V2.12`):** the registration form's held press sends again once Turnstile answers, proven with Cloudflare's test keys in an end-to-end spec (§502) · the group run's optional self-declaration is kept while the person takes part and deleted at their request — the seven-day purge, its sentences, the legal templates and the emails follow (§503) · the release tests one tree once — a passing run records its tree and a later run of the same tree within 24 h skips the heavy jobs, eight shards on every pull request, `yarn ship` polls each run to its end and times every step, the landing commit skips the hook after docs:check (§504) · «Vârsta minimă de participare» is one field in the Regulament card for every event type and the page says it for every type (§505).
- **Batch 36 (2026-09-27, `BR-V2.13`):** the country before the city on the form, România by default, and a sex the person chooses (§510) · Costuri opens with the month's total and the backoffice speaks one plain sentence per field (§511) · the public list's card inside «Program, regulament și declarație» (§512) · emails leave on the scheduler's tick, never right after the request — a «Termene» setting (§513) · a «Tradu cardul: RO → EN» in every card's tab row beside the whole-editor button (§514) · the declarations reviewed — the race declaration as trail and road from one shared body, minimum age 14 with no under-14 flow, the group-run texts on the event's minimum age (§515) · one «Setări» area with tabs, Sarcini pointing into it, every old address redirected (§516) · the newsletter no longer offers «Coduri de reducere» — members-only from the members' zone — retired from every screen and stripped from stored subscriptions by migration `0100` (§517) · the anti-bot check says every state under itself and on the send button, offers «Reîncearcă verificarea» wherever a person could be stuck, never holds a press for a check that gave up, and `/api/health` says a level for the presses the valve sent (§518) · several people on one address in one sitting — one held family email with every person, one confirm-all link, «Toate înscrierile mele», one declarations wizard (§519).
- **Batch 37 (2026-09-27, `BR-V2.14`):** the V2.13 leftovers — «Configurație» only under «Setări», fragment addresses hop to their tab, the waiting-list offer kept while its email is queued, the family form carries the country, the ship tolerates a merge in progress, the family confirmation previewed (§520) · a glyph on every button and every fold header, public site and backoffice, guarded by a source-walk test (§521) · the plain-words pass over the whole backoffice — one sentence per fact, at most 200 characters, detail behind «?», enforced by the test (§522) · one self-declaration per person per series of group runs — no expiry, ended only by the signer's request or a new text version; the templates, the paper form, the notice and the PDF written for the recurring run; migration `0101` (§523).
- **Batch 38 (2026-09-27, `BR-V2.15`):** the members' zone — a «Membru» role below the volunteer with the same Zitadel sign-in and no backoffice, the public «Beneficiile membrilor» page with the sign-in button, one members-only page behind the sign-in, bulk invitations; migration `0102` (§524).
- **Batch 39 (2026-09-27, `BR-V2.16`):** «Întrebări frecvente» — a platform page the club fills with questions and rich-text answers in both languages, native folds with deep links, `FAQPage` structured data; Pagini in «standard» and «personalizate» groups; migration `0103` (§525) · the difficulty as five bands × three steps — ușor, mediu, greuț, greu, foarte greu, each 1·2·3 — one level column backfilled from the old five values, the gauge with step dots, the club's scale in the guide; migration `0104` (§526).
- **Batch 40 (2026-09-27, `BR-V2.17`):** the backoffice events list searched by name, filtered by state — viitoare, încheiate, ciorne, publicate, arhivate, anulate — and sorted by date, name or state, all in the address and without JavaScript (§527) · every difficulty gauge says its exact level of fifteen in a tooltip — «Ușor 2 — nivelul 2 din 15» — and a «?» in the editor explains the club's scale with its own examples (§528) · the outbox panel says when the emails leave — the next scheduled run, each row's own time — and carries the on/off switch for scheduled delivery (§529) · «Mărimea textului» — the public pages' text size as a club setting, Mic / Normal / Mare / Foarte mare, the owner's own change from his phone (§530) · the cleanup after the night — the queue and the map brought to the truth, the review leftovers of V2.13–V2.16 (the offer rule in the queue panel, the glyph guard, plain words over toasts and steps), dead exports and orphan keys (§531) · every legal text regenerated from its template in one press, every draft approved in one press, versions deleted in bulk under the existing rules (§532).
- **Batch 41 (2026-09-28, `BR-V2.18`):** an event published before its date or its time is known — «Data se anunță mai târziu» and «Ora se anunță mai târziu» in «Când și unde»; the site says «Data se anunță în curând», or the day with «Ora se anunță în curând», lists the event in its own «Data sau ora se anunță» section and keeps it out of every month, the calendar, the feed and the .ics; registration stays «în curând» until the organizer opens it; refused on a series, on an event with registrations and on the lead event; migration `0105` (the owner, from the phone; §533).
- **Batch 42 (2026-09-27, `BR-V2.19`):** the group-run self-declaration template after the owner's second counsel pass — validity until withdrawn or replaced, the health clause as the runner's own assessment with the organiser's non-evaluation sentence, the retention logic, «alergare de grup, nu ghidaj montan», the version line with the full date (§534) · a release from the phone: the label `ship` on a PR into qa runs the landing and the release on GitHub Actions — `.release/<branch>.json` carries a change's facts, `yarn docs:land --tree` lands them, `yarn batch:merge` resolves the safe files, `SHIP_TOKEN` and `SHIP_PRODUCTION_URL` once in the repo's settings (§535) · one person's email is never held: the family sitting begins only on «Da, încă o persoană», the screen after the form asks one question, and the flow's emails say one fact per line (§536).
- **Batch 43 (2026-09-27, `BR-V2.20`):** «Dificultate» and «Treapta» on one centred axis in «Ce fel de eveniment» — one grid row, the toggle wearing the select's outline with its label in the edge, a «?» beside each, the help line under, full width on a phone (§537) · «De făcut» tells the Administrator to write the «Echipa» and «Întrebări frecvente» pages — two lines in the reader's language with a link to each editor, added once to a stored list and never revived after a delete (§538) · the legal texts grouped by kind, filtered through the address, and regenerated from one obvious press — five cards with a state line each on /admin/legal, «Versiune nouă» → «Pornește de la șablon» in three labelled rows with a state line under each button, «Șablon nou» when the template moved, «Regenerează toate (6)», a three-step help line, every press asking first (§539) · a backoffice resend or «Trimite acum» leaves at once — «Trimite acum, fără să aștepte trecerea programată» by default in the confirm dialog, the one row drained after the response inside the allowance, «Pleacă acum» on the queue panel, an audit row naming the bypass; the family sitting's live rows carry familyHeld and the «imediat» reload says «a plecat» (§540) · a photo on «Echipa» gets the same upload as every other picture, with the crop box (1:1 first) — the crop saved with the person (migration `0106`) and drawn by one rule on the page, the list and the preview (§541).
- **Batch 44 (2026-09-27, `BR-V2.21`):** the Organizer reads the events and changes none of them — every event write is the Administrator's (and the Superadministrator's), the Redactor keeps the words, the Organizer keeps the registrations, the export, the race numbers, the desk and the message to participants; the editor opens read-only for a reader; the guide says the split (§542).
- **Batch 45 (2026-09-27, `BR-V2.22`):** a family sitting reserves every place the moment each form is sent (the one allocator, availability − N on the site), one deadline fixed by the first form, a counted placeholder so the count tells nobody an address's state (§39), one email listing every registration with one confirm, a «Familie» marker on every surface; migration `0107` (§543) · the citizenship and telephone-prefix pickers open tall enough to read — eight 44-px rows on a desktop, a bottom sheet with the search pinned on a phone, the chosen country in view (§544) · an event may be saved without its date or hour while «Data se anunță mai târziu» / «Ora se anunță mai târziu» is on — the boxes optional, the state said without inventing a date, required again when the switch goes off (§545).
- `/admin/tasks`: what the club still owes and what it pays, read from the system — the
  monitors, Mailgun, Turnstile, the archive mailbox, Vercel's token, the `.ro`, the contact
  form — with the steps under each row; the cost table with the Mailgun plan's price under «Setări» → «Costuri» (§516, §41,
  §97–§101, §149). `/devs`: the
  configuration, Neon's month, Vercel's deployments and build minutes, the outbox, the
  repository's documents at `/devs/docs/<name>` (§88, §101).

**Platform**

- Production on the club's `.com`, QA on `qa.`, each a Vercel project over its own Neon
  project; releases are the `qa → main` PR; the gated migration workflow (§31) and the build
  that waits for it (§62); `/api/health` and `yarn smoke` (§31, §98). Monitors on cron-job.org,
  fifteen minutes by day and hourly at night, because idle compute is billed on Neon Launch (§280).
  Mailgun live on `mail.<domain>`; `contact@` forwards to the club's Gmail (`SETUP.md` §35); since `BR-V2.04` every email's Reply-To and the address the site shows default to the Gmail in `CONTACT_SMTP_USER` until the club saves «Adresa de contact afișată», and the newsletter group leaves by Mailgun (§462, amending §442 and §443).
- Guards: token validation keyed on the hash, throttled job endpoints, the resend oracle rule
  (§39, `AGENTS.md` §19.4); the pool's `statement_timeout` and
  `idle_in_transaction_session_timeout` (`docs/PLATFORM.md` § Connections are not the ceiling). The repository is public: `yarn secrets:check` in `yarn check`, GitHub
  secret scanning and push protection on (§98).

Not built: articles and what M2–M4 name (multi-distance races, results, runner profiles); a
custom domain for the bucket. `SETUP.md` is the numbered procedures with their values, and the
build plan it carried is two tables pointing at the code (§118); `docs/VIBECODING.md` is the
short way in.

**Two settings that cost an afternoon between them:** the Zitadel application needs
**"Include user's profile info in the ID Token"**, or every sign-in is refused by the allowlist
that cannot see an address; and the first Administrator is a `staff_users` row inserted by
hand, because the screen that invites people is behind the sign-in it would grant.

**Still owed, all of it the club's own work rather than code** (checked against the live
systems on 2026-09-22; `/admin/tasks` shows the same list with the steps, read from the system —
it is the authority, this is the summary):

1. ~~cron-job.org monitors~~ — done 2026-09-18 evening: six jobs, both environments `ok`.
2. ~~Mailgun sending domain~~ — done 2026-09-18 evening: `mail.` subdomain verified,
   production sends live, webhook signed; `contact@mail.<domain>` forwards to the owner until
   the club has a mailbox; Zitadel's own mail goes through the same domain. QA sends through
   the same domain with its own key since 2026-09-23, to anyone, tagged `[QA]` (§307).
   Procedure: `SETUP.md` §35.
3. ~~Production Zitadel application~~ — done 2026-09-17: application, `STAFF_AUTH_MODE=provider`,
   the owner's SUPERADMIN row. Sign in at `/admin` on the production host.
4. ~~The club's approved legal texts~~ — the **terms** and the **privacy notice** are approved
   and live on production (verified 2026-09-22 at `/ro/termeni` and `/ro/confidentialitate`):
   the club's own text, carrying its legal name, seat and CIF, with no placeholder and no
   sample banner. The **declaration** is approved in the same screen and cannot be read from
   outside — `/admin/legal` on production says which of the three are in effect, and a
   registration is refused while it is not.
5. **Volunteer accounts** for race day (`SETUP.md` §34) and a rehearsal on QA. Since the
   invitation key is set (item 10), "Add" on Echipa creates the account and sends the
   invitation itself.
6. ~~Neon keys~~ — done 2026-09-18 evening: a project-scoped key on each Vercel project,
   `/devs` shows the database's month on both. Still optional: a custom domain for the R2
   bucket; the retention and support decisions of `SETUP.md` §30.
7. ~~The anti-bot check~~ — done 2026-09-19: the widget `brasovrunners-site`, both keys on
   both Vercel projects, the box shows on the QA form (`SETUP.md` §36). The row turns green
   on each project's next deployment.
8. **The five legal texts** approved on production — since `BR-V2.00` (§418) from the counsel-reviewed templates, all five in one sitting, BEFORE the race is published — from the platform's templates — **again, since Since `BR-V2.04` (§450) an Administrator approves them; the Superadministrator role is no longer needed for it.
   2026-09-24**: the templates now carry the GDPR rewrite (§322–§324), the per-event minimum age
   (§329) and the minor's own signature (§330); the texts in effect say none of it until the club
   approves new versions, and the minor's second signature stays off until it does (§330). Approved
   on production from the platform's templates
   (`/admin/legal` → New version → "start from the platform's text", four facts to fill) —
   the same item as 4, with the texts now written. Approving new versions from the templates also makes the terms and the privacy notice read their deadlines from "Termene" (§377); the production texts keep their literal numbers until then.
   **Since §393 two more texts:** the optional group-run declarations (asfalt, trail) — `/admin/legal` → Versiune nouă → «pornește de la
   textul platformei» → each of the two, four facts each; until the trail text is approved no run offers the button. **And the notice once more:** since §396 its section 4 describes the public list's states; until a notice from the new template is approved on production, public lists show confirmed names only (`/admin/tasks` shows the row `listStatesNotice`).
9. ~~The health monitor~~ — done 2026-09-19: `GET /api/health` every 30 minutes with failure
   notifications on production and QA (`SETUP.md` §36). Both answered `ok` on 2026-09-22.
10. ~~The invitation key~~ — done 2026-09-20, and **only actually working since 2026-09-22**:
    the token was on both Vercel projects from the start, but the service account had never been
    made an **Org User Manager**, so it authenticated and could create nobody. Every "Add" wrote
    the allowlist row, was refused by Zitadel, and said so in a banner that was gone at the next
    click — the first to find out was the colleague, meeting "User not found in the system" at
    sign-in. The membership is granted now (§288, `SETUP.md` §37, which carries the one-call
    check). The two code follow-ups §288 asked for are done (§297): Echipa marks a row whose
    sign-in account does not exist, and `/admin/tasks` probes the key with the call the invitation
    actually makes, so "authenticates but may not" is a red row rather than a colleague's surprise.
11. ~~The contact form's Gmail~~ — done 2026-09-20: `CONTACT_SMTP_USER`,
    `CONTACT_SMTP_PASSWORD` and `CONTACT_FORM_TO` on both projects, and `/ro/contact` shows
    the **form** on production and on QA rather than the address (§149, `SETUP.md` §38). Who
    receives a message is «Pagini» → «Contact» → "Cine primește mesajele de contact".
12. **The race itself, and this is the launch item.** Production publishes the weekly group run
    and nothing else: the 21 November race has no event there, so nobody can register for it.
    It is one save in `/admin/events` — the event, its capacity, its participation window, its
    bib band — and then publish. Everything under it is live already, which is what items 1–11
    were about. **The click list is `SETUP.md` §39**, field by field, with every value filled
    in; the two the club alone can decide are marked there (how many places, and how many days
    before the race a confirmation is asked and owed).
13. ~~**The monitors' cadence, for Neon's bill**~~ — set 2026-09-24, the eight jobs recorded in
    `SETUP.md` §40: production health hourly at :02 (not 02:02 or 03:02), QA's every six hours;
    the job monitors frequent, because an idle ping wakes nothing. **Two small things left:** tick
    minute 45 on "prod maintenance day", and QA's „Cât de des verifică platforma" → 2 ore. The
    Neon limits themselves are set (production 100 CU-hours a month, QA 30).

14. **The privacy notice, once more** — the template now says a person may register someone else on their own address, entering Since `BR-V2.03` (§445) the template also describes the newsletter and its topics — approve the notice after this release, once, to cover everything.
    that person's data on their behalf and receiving their messages (§389); the notice in force on production says none of it until
    the club approves a new version from the platform's text (`/admin/legal`, the same click as item 8).
    Since `BR-V1.96` (§393, §396) the template also describes the optional group-run declaration and the public list's states — one new version covers all of it.
15. ~~**The family flow's contract release, `BR-V1.94`**~~ — done 2026-09-25 (§390): — one contract-only migration drops `registrations_event_participant_unique`;
    the flow is on wherever migration `0073` ran; production got it with this release. What is left is item 14, the notice.
16. **Approve the legal texts again, from the new templates** — first on QA, then on production. Since `BR-V2.13`–`BR-V2.15`
    the templates carry the trail and the road race declarations (§515), the group-run declarations for a whole series (§523)
    and a privacy notice that describes the members' zone (§524). `/admin/legal` → «Aprobă acum textele care lipsesc…» approves
    in one press every text that has no approved version; a text already in force is «Versiune nouă» → «Pornește de la șablon»,
    one at a time. A Romanian lawyer should read the declarations first. This covers items 8 and 14 too.
    Since §NNN the notice's template also says that only the club's organizers and administrators see the newsletter's
    subscriber list with the addresses and may download it — approve that notice before an Organizer reads the addresses
    on production.
17. **Re-grade every event's difficulty** — migration `0104` put each event in the middle step of its old band (§526). Open each
    event in `/admin/events` and choose the band and «Treapta» on the fifteen-step scale; the guide («Ghid») explains the scale.
18. **Open the members' zone and the FAQ** — approve the members' zone address, `/ro/zona-membri` (it sits outside the backoffice,
    which departs from the brief: §524); add the first members on «Echipa» → «Adaugă mai mulți membri» (after the notice of item 16);
    write «Pagini» → «Pagini standard» → «Membri» and «Întrebări frecvente» (§525) in both languages, then publish them.

**The values behind items 10 and 11 are in `.env.local` and on both Vercel projects**, never in
this repository — it is public, and `yarn secrets:check` blocks a commit that carries one. The
club's four legal facts live the same way (`SETUP.md` §30), which is why the approved texts on
production read with the club's real name and CIF while the templates in `legal-documents/` show
`<PLACEHOLDER>`.

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
