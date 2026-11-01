# `club/` — which club this platform is

`club.json` is the club's identity, read at build time (`DECISIONS.md` §882): its name, slug, short
mark and wordmark; the public list's short forms; its place — city, county, plate code, country,
time zone and the zone's words, the coordinates the sunset is read for, an identity card example;
its hashtags; its safety form's name; its palette; its logo files and their proportions.

`guard-words.json` is the club's own places and names that no code should spell out — its hill, its
parks, its stadiums, its programmes — which the literal check refuses anywhere else. A file of its
own because the bundler carries `club.json` whole into every public page's scripts, and the
application never needs these: the literal check reads them, nothing under `src/` imports them
(`tests/unit/club/import-surface.test.ts`). So nothing goes in `club.json` that a visitor's browser
should not receive. One guard word, the safety form's name, is also `safetyProgramme` there: a
public form's name, which the contact page prints anyway — the list as a whole never ships.

`infra.json` is the names the club's tooling holds, read by the scripts and the release workflow and by
nothing under `src/` (`tests/unit/club/import-surface.test.ts`; `DECISIONS.md` §886):

- `domainLabels` — the labels of the club's own hostname (`<label>.<tld>`). `yarn docs:check` builds
  its «the club's domain appears nowhere but SETUP.md §26» pattern from them; a dotted suffix is
  required, so a bare repository name does not match.
- `vercelProjects` — the Vercel project of each environment, `qa` and `production`, which
  `yarn domain:bind` addresses by name.
- `releaseAuthor` — the name on the release workflow's commits (`.github/workflows/release.yml`);
  without the file, the repository's name.

The release archive's and the ship times file's names come from `club.json`'s `slug`, the idle and
backstop clocks from `place.timeZone`. The local database, its role, the container and the package
name keep the old spelling (renaming wipes local volumes).

How it reaches the code:

- `src/club/config.ts` is the only file that imports `club.json` (through the `@club/*` alias in
  `tsconfig.json` and the Vitest configurations), and only five modules import it:
  `src/theme/brand.ts`, `src/modules/events/domain/place.ts`, `src/i18n/dates.ts`,
  `src/modules/events/domain/sun.ts` and `src/shared/config/env.ts`. Everything else reads their
  constants — `CLUB_NAME`, `CLUB_LOCALITY`, `HOME_COUNTRY`, `CLUB_TIME_ZONE` and the rest.
- JSON, not TypeScript, so a plain `.mjs` script can read it without a compiler.
- No Zod and no environment in `src/club/`: the theme brings it into every public client island.
  `tests/unit/club/club-config.test.ts` checks what a schema would.
- `tests/unit/club/club-literals.test.ts` refuses the club's words — built from `club.json` and
  `guard-words.json` — written as a literal in `src/`, `scripts/`, the catalogues, the workflows,
  `package.json` and `docker-compose.yml`; the ones still there are listed in
  `tests/unit/club/known-leaks.ts`, a list that only shrinks.
- `yarn test:fork` builds the identity from a made-up club (`tests/fixtures/fork-club/`) and finds
  none of this club's words in what it renders.

## The palette, the drawing, the logo and the wordmark (§885)

- **`palette`** in `club.json`, by role, each `#rrggbb` in lower case. Five are required: `primary` (the
  logo's own colour — `tests/unit/theme/brand.test.ts` holds it equal to `public/brand/logo.svg`'s fill),
  `primaryInk` (its deeper ink), `dark` (the two after dark, light enough to carry words on the dark page),
  `secondary` (a fill under the body's ink) and `accent` («Aspectul nou»'s default). The rest — `kit` (the
  kit's gradient), `tints`
  (the page tints, the hero's ends, the poster's hairline, the sheet's member fill, the blue preset's pressed
  shades, and `emailBand`: the band behind `logo-white-email.png`, the primary when left out), `look` and `secondaryLook` (each accent's four shades by day and after dark) — are Brașov's
  hand-picked values; a club that leaves one out gets it derived from those by `src/theme/brand.ts`
  (`shadesOf`, `mix`), the one file that computes colours. `brand.ts` keeps every name it exported: the roles
  are `PALETTE`, the hue names (`COLOR.blue`, `COLOR.orange`…) their aliases, and the stored preset ids
  (`faintBlue`, `blue`, `orange`…) unchanged. The platform's neutrals — the ink, the paper, the kinds' fills,
  the calendar picture's other themes, the race numbers' print colours — stay in `brand.ts`: they are the same
  for every club. Every pair the pages draw is held at AA on whatever the file says (`yarn test`, and
  `yarn test:fork` on a made-up club that writes only the five).
- **`decor.json`**: the mountains drawing — its box and its ridges (`far`, `near`), drawn under the public
  pages by `MountainMark` and across the calendar picture's empty days. Read through `src/club/decor.ts` by
  those readers alone, never by `brand.ts` or anything every visitor's scripts carry
  (`tests/unit/club/import-surface.test.ts`). `"layers": []` draws nothing.
- **The logo**: `logo` in `club.json` gives the lockup's proportions, and every place that sized it by hand —
  the race number, the badge, the bib designer, the two PDFs — reads them (`brand.ts#LOGO_RATIO`, rounded to
  three decimals, and `LOGO_HEIGHT_SHARE`). A squarer lockup stands inside the race number's band. The files are
  `public/brand/logo.svg` and its siblings; after changing one, or the palette, run `yarn brand:assets`, which
  redraws the rasters the PDFs and the emails use and writes `assets.lock.json` — each source's sha256 and the
  colours. A test fails with «run yarn brand:assets» while the lock and the sources disagree.
- **The wordmark's face**: `src/theme/fonts/Wordmark.ttf`, with its licence beside it as
  `Wordmark-LICENSE.txt` — a fixed slot in the fonts folder (`next/font/local` loads only from there), so a
  club's own face replaces the two files and no code. Every character of `wordmark` must be in the face
  (`brand.test.ts` reads its `cmap`).

## The legal texts' club choices (§884)

`legal.json` is the club's own choices in its legal texts (§884), each in Romanian and English — both
or neither. The platform's templates (`src/modules/legal-documents/templates/`) carry a visible
`<PLACEHOLDER>` where each goes, and `withClubClauses` (`templates/club-facts.ts`, the only importer of
this file — `tests/unit/club/import-surface.test.ts`) writes the club's words in when the templates are
read, so "start from the platform's text", the one press, the seed and the templates' fingerprint
(`filledHash`, §639) all read the club's sentences:

| Key | Placeholder | What it says |
| --- | --- | --- |
| `dataProtectionOfficer` | `<RESPONSABILUL CU PROTECȚIA DATELOR>` / `<DATA PROTECTION OFFICER>` | The notice's §1 sentence: whether the club has a data protection officer, and why |
| `mailbox.account` | `<CĂSUȚA DE E-MAIL A CLUBULUI: CE CONT ESTE>` / `<THE CLUB'S MAILBOX: WHAT ACCOUNT IT IS>` | The notice's §6 sentence on what account the club's mailbox is |
| `mailbox.providerTerms` | `<CĂSUȚA DE E-MAIL A CLUBULUI: REGULILE FURNIZORULUI>` / `<THE CLUB'S MAILBOX: ITS PROVIDER'S OWN TERMS>` | Whether the mailbox's provider also processes data under its own terms |
| `mailbox.name` | `<NUMELE CĂSUȚEI CLUBULUI>` / `<THE CLUB'S MAILBOX NAME>` | The mailbox's bare name, «prin … sau Mailgun» |
| `mailbox.theClubs` | `<CĂSUȚA CLUBULUI>` / `<THE CLUB'S MAILBOX>` | «the club's …», as the contact form's road says it |
| `mailbox.withCompany` | `<CĂSUȚA CLUBULUI ȘI FIRMA EI>` / `<THE CLUB'S MAILBOX AND ITS COMPANY>` | The mailbox with its company in brackets, on the road a message takes while Mailgun is stopped |
| `mailbox.company` | `<FIRMA CĂSUȚEI CLUBULUI>` / `<THE CLUB'S MAILBOX COMPANY>` | The company alone, among those that may access data from the US |
| `photoChannels` | `<UNDE PUBLICĂ CLUBUL FOTOGRAFII>` / `<WHERE THE CLUB PUBLISHES PHOTOGRAPHS>` | The platforms the club publishes photographs on, named one by one |
| `prizeMoney` | `<PREMIILE ÎN BANI>` / `<PRIZE MONEY>` | The terms' sentence on prize money |

The safety form's name in the notice (`<NUMELE FORMULARULUI DE SIGURANȚĂ>` / `<THE SAFETY FORM'S NAME>`)
is `club.json`'s `safetyProgramme`. A key left out — or written in one language — keeps its placeholder:
the draft shows it, and `/admin/legal` refuses to approve a text that still holds one, so a fork that
empties this file types its own sentences before anything is in force (`yarn test:fork`,
`tests/fork/legal.test.ts`). Changing a value changes this club's filled templates, which the daily
check announces to the Administrators as a new template («Șablon nou») to read and approve; it never
changes a text already approved. Values only, never a new `{{field}}`: a field changes every template's
fingerprint.

The region stays Romania for every club: `country` is `"RO"`, the languages `ro` and `en`, the legal
texts Romanian law, the prices RON.

## The club's own sentences (§NNN)

`messages/ro.json` and `messages/en.json` are the platform's catalogues, and they are neutral: a sentence there is
one every club can live with — «Alergăm împreună», not «Alergăm împreună prin Brașov». This club's own sentences are
`club/messages/ro.json` and `club/messages/en.json`, an **overlay**: `src/i18n/catalogue.ts`, the only file that
imports either (`tests/unit/club/import-surface.test.ts`), lays it over the platform's once per process, and every
page, email and PDF reads the merged catalogue — so Brașov reads exactly what it read before the move. What it holds:
the home page's title, description, hero and «why» item, the calendar's motto, the listing's and the specials'
intros, a safety rule, a newsletter hint, the backoffice's examples that name its places, the hue labels, the
starting list's two lines, the dated history of `/admin/tasks` and the redesign plan of `/admin/design`.

The rules (`tests/unit/club/overlay.test.ts`):

- **A stamp.** The file's first key is `"$club"`, equal to `club.json`'s `slug`; it is checked and taken off before
  the merge, so an overlay copied from another club's folder fails loudly rather than speaking for this one.
- **Objects merge, strings and lists replace.** A key the overlay holds replaces the platform's sentence; a list
  (the steps of a task) replaces the whole list; a namespace merges key by key.
- **Only what the platform says.** Every key of the overlay is a key of the platform's catalogue, with the same
  `{arguments}`, in both languages — the overlay says the same thing in the club's words, never a new message. One
  sub-tree is the club's alone, `Admin.design.plan`: `/admin/design` draws «Planul» only when the overlay has it.
- **Both languages or neither.** `ro` and `en` hold the same keys.
- **Values that are facts arrive as arguments**, not as overlay sentences: the short mark (`{short}`), the identity
  card example (`{idExample}`), the safety form's name (`{safetyName}`), the slug (`{slug}`), the zone (`{timeZone}`,
  `{zoneWords}`) and the media bucket (`{bucket}`, `R2_BUCKET`) — each from `brand.ts`, `place.ts` or `dates.ts` at
  the call (`tests/unit/notifications/no-hardcoded-values.test.ts` pins them). A fork with an empty overlay
  (`{ "$club": "<its slug>" }`) is right from the start: `yarn test:fork` formats every message of the platform's
  catalogue with a made-up club's values and finds none of this club's words (`tests/fork/words.test.ts`).
- **The guard does not read it.** `club/` is exempt from the literal check, so this is where the club's names may be
  written; the platform's catalogues are scanned, and `KNOWN_LEAKS` has no row for them.

A batch merge resolves a conflict in the overlay key by key, as it does the platform's catalogues (`yarn batch:merge`,
`scripts/merge-resolve.mjs#CATALOGUES`).
