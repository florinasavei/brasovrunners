# `club/` — which club this platform is

`club.json` is the club's identity, read at build time (`DECISIONS.md` §882): its name, slug, short
mark and wordmark; the public list's short forms; its place — city, county, plate code, country,
time zone and the zone's words, the coordinates the sunset is read for, an identity card example;
its hashtags; its safety form's name; its logo files and their proportions.

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

The region stays Romania for every club: `country` is `"RO"`, the languages `ro` and `en`, the legal
texts Romanian law, the prices RON. The palette, the mountains drawing, the legal clauses and the
catalogues' wording are not here yet; later changes move them.
