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

`legal.json` is the club's own choices in its legal texts (§NNN), each in Romanian and English — both
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
texts Romanian law, the prices RON. The palette, the mountains drawing and the catalogues' wording are
not here yet; later changes move them.
