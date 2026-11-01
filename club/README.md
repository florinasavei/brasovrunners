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

## The palette, the drawing, the logo and the wordmark (§NNN)

- **`palette`** in `club.json`, by role, each `#rrggbb` in lower case. Five are required: `primary` (the
  logo's own colour — `tests/unit/theme/brand.test.ts` holds it equal to `public/brand/logo.svg`'s fill),
  `primaryInk` (its deeper ink), `dark` (the two after dark, light enough to carry words on the dark page),
  `secondary` (a fill under the body's ink) and `accent` («Aspectul nou»'s default). The rest — `kit` (the
  kit's gradient), `tints`
  (the page tints, the hero's ends, the poster's hairline, the sheet's member fill, the blue preset's pressed
  shades), `look` and `secondaryLook` (each accent's four shades by day and after dark) — are Brașov's
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

The region stays Romania for every club: `country` is `"RO"`, the languages `ro` and `en`, the legal
texts Romanian law, the prices RON. The legal clauses and the catalogues' wording are not here yet;
later changes move them.
