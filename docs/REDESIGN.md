# The redesign plan (2026)

<!-- The working copy lives in the owner's Claude document; this file is the repository's version,
     kept in step by the dispatcher. No person's name appears here: the repository is public. -->

**As of 2026-10-11.** The owner and the club's president asked for a facelift of the public site —
two mock-ups, a landing page and a calendar page — and said it is the last item in the queue and
must be planned carefully. This page is that plan: the decisions, what exists, the visual system,
the constraints, the phases, the content the club provides, and the open questions. On 2026-10-11
the owner approved starting phase 1 with the plan's defaults, so decisions 1, 2 and 12 are taken by
their defaults and phase 1 is built behind the setting, off (§ Phase 1, as built). Later the same day he
asked for the home page — «start the homepage now, with empty photo slots and the plan's defaults» — so
decisions 5, 6 and 10 and open questions 6 and 7 are taken by their defaults too, and phase 3's part A is
built behind its own setting, off; parts B and C then built the four lower sections and wired them into
the page and its setting, taking decisions 7 and 8 by their defaults (all of it § Phase 3, as built). The home page is complete behind its switch, waiting for the
club's photographs and words on QA.

## Decisions only the club can make

Twelve choices shape the whole facelift. Each row names the default the dispatcher builds if nobody
objects; a different answer changes the phases, not the rules.

| # | Decision | Default | Why it is the club's |
| --- | --- | --- | --- |
| 1 | The accent colour — **decided by default (2026-10-11), then made the club's setting** | a hot-pink accent token (and a darker «pinkInk» that carries white text at AA) beside the logo blue; the logo stays the club's blue under both looks (the owner overrode the ink default, 2026-10-11); emails, PDFs, race numbers and share cards stay blue. Since the owner's «this should be a configuration in the theme» (2026-10-11) the pink is the default of «Aspectul nou» → «Culoarea de accent»: pink, blue, orange, or a colour the club types, its readable shades derived on the server | the logo is pure blue and a brand test pins it |
| 2 | The heading face — **decided by default (2026-10-11)** | Inter 800 (one new weight file; Inter is self-hosted with ș ț ă â î) for headings; body stays Roboto | a face is a licence and a look the club owns |
| 3 | A real home page — **decided (2026-10-10)** | a real home page at `/ro` and `/en`, reached from the logo — never a menu entry — switchable on and off in «Aspect» → «Pagina principală»; `/events` stays the listing under «Alergări»; canonicals and the sitemap move | it reverses §353 (the root is a redirect, for SEO) |
| 4 | The four menu words | «Alergări» = the listing; «Calendar»; «Comunitatea» = a club page linking «Echipa», «Galerie», «Întrebări» and the members' zone; «Despre noi» = a club page | the club decides what each word points to |
| 5 | Where «Vino cu noi» goes — **decided by default (2026-10-11)** | the next weekly run's page; the band's «Cum funcționează» opens a club page | there is no sign-up for runners |
| 6 | Photographs — **decided by default (2026-10-11)** | real club photos only, from the gallery; no stock or generated pictures; people in a home-page photo have agreed | consent and the club's own face |
| 7 | The Instagram block — **decided by default (2026-10-11)** | a static strip of six gallery pictures with a link; no live feed | an embed is forbidden (AGENTS.md §18.3); a feed needs a Meta app and a token |
| 8 | The numbers band — **decided by default (2026-10-11)** | typed in «Aspect» → «Pagina principală»: the founding date (years computed), «alergători activi»; «2×/săptămână» and «100% gratuit» computed from the events | invented figures are forbidden (BUSINESS.md §7) |
| 9 | What «Evenimente speciale» means — **decided by default (2026-10-11)** | everything that is not a weekly series; the chip «Ediție specială» keeps its meaning (§168) | the mock-up's word and today's flag differ |
| 10 | The round arrow on cards — **decided by default (2026-10-11)** | only on the home page's cards, keeping the whole-card tap; the listing keeps its text door | it reverses §319 |
| 11 | Icons | the filled Material family stays; the lighter look comes from colour, weight and spacing | a second family touches every glyph (§318) |
| 12 | How it ships — **decided by default (2026-10-11)** | behind one setting, «Aspectul nou», read like the page tint: on for QA, off on production until the club approves on QA; the old look deleted one release after the flip; the backoffice keeps today's look | a live site with real registrations needs a one-press way back |

## What exists versus what is new

Most of the mock-ups' parts exist as data and components; what is new is one page, one photo field,
a handful of settings and the look.

| Element | Today | New |
| --- | --- | --- |
| Header | `SiteHeader` + `SiteNav`: logo, six entries, language switch; socials in the footer | a CTA slot; «Urmărește-ne» with Instagram, Facebook and Strava at the top right on a computer; the language as a round button floating bottom-right (owner, 2026-10-11) — inside the one-row-at-320-px rule |
| Hero | nothing: the root answers a 308 to `/events` (§353) | the route, a hero component, a setting for the picture, its crop and two lines; redirect, canonicals and sitemap move |
| «Următoarea alergare» | the featured card (§470), the weather pill (§402), sunset computed (`sun.ts`) | the «soonest run» rule, weather words, an «Apus» line, the photo tag |
| Weekly and special sections | a series is one card (§113); the pills | the split rule, the short weekday line, **a cover photo per event** (events have no picture field) |
| «Prima dată» band | nothing | the words (a setting), five icons, a target page |
| «De ce» items and the quote | Caveat is self-hosted | the words, four icons; Caveat on the home page |
| Photo strip and Instagram | the gallery and its R2 ladder; social addresses as environment values | six chosen pictures and the strip; no feed |
| Numbers band | nothing | four settings; two figures computed |
| Calendar: grid, prev/next, «Lună / An / Listă» | all exist; the period lives in the path (§574) | the look |
| Calendar: filters | a collapsed GET «Filtre» form shared with the listing (§413) | always-visible chips; a «kind» dimension (weekly / special) |
| Calendar: colours | only a race is coloured | pink / green / grey by kind, a legend, a word beside the colour |
| Calendar: next-event panel | nothing | a next-upcoming read, a second column from `md`, pills, weather |
| Calendar: subscribe box | Google, one «Apple / Outlook» webcal button, `.ics`, the feed's address | the box's title and rows; an Outlook link needs its host in `PROVIDER_HOSTS` |
| The look | no component overrides; 10 px radius; Roboto 500 headings; blue and orange | tokens and overrides scoped to the public pages |

The four data gaps, in order of size: a cover photo per event; the home page's words, pictures and
numbers as settings; an event kind derived from the series and the type; the founding date and the
active-runners figure.

## The visual system

New tokens in `src/theme/brand.ts`, each with a dark twin and an AA assertion: `accent` (the pink),
`accentInk` (white text at 4.5:1), `accentTint` (bands and weekly chips), `kindSpecial` and its ink
(green), `kindOther` (grey), `inkStrong` (headings). On public pages, under the new look, `primary`
becomes the accent — the pink pair by default, or the preset or colour the club chose under «Culoarea
de accent» — and a component wears the accent only through `primary.*` and `LOOK_ACCENT_TINT`, never
by naming a pink token; the backoffice, the emails, the PDFs, the race numbers and the share cards keep
the logo blue. Headings Inter 800, letter-spacing −0.02 em; the two-tone word a `span`, not a
gradient; Caveat only where drawn, never preloaded. Cards: 16 px radius, one soft shadow, the photo on
top, a tag pill. Buttons: pill-shaped, a trailing arrow glyph (§521), `contained` pink and `outlined`
ink, 44 px tall. Chips: the existing `GlyphChip`. One inline mountain SVG under 2 KB. Motion from
`theme/motion.ts` only. Photos as plain `img` with the R2 ladder's `srcset`; only the hero eager.

The scope: the public layout sets `data-look="2026"` when «Aspectul nou» is on, the way `data-dark`
switches the dark scheme; the overrides read under that attribute as plain-object selectors. Off,
every page is pixel-identical to today. The attribute is on `<html>` wherever the setting is on, the backoffice's pages included (they share the root layout); every rule stops at the backoffice shell's `data-backoffice` marker, so staff never see the look.

**Component-based, by the owner's rule (2026-10-10).** One named Server Component per section under `src/modules/home/ui/` — `Hero`, `NextRunCard`, `RunCardGrid`, `StepsBand`, `WhyList`, `PhotoStrip`, `NumbersBand`; the calendar's `KindChips`, `NextEventPanel`, `SubscribeBox` likewise — typed props, no element-valued prop, tokens only from `brand.ts`; each drawn with a fixture on `/admin/design` → «Mostre» and listed in `docs/VIBECODING.md` → «Where things live»; carousels are CSS scroll-snap strips, no island; everything the club sees is a setting.

What does not change: hex only in `brand.ts`; AA for every pair; the gradient budget of three; fonts
as repository files (§460); the filled icon family (§318); the email emphasis colour; light by default,
dark through the footer's button (§93); the club's page tint under both looks.

## Constraints that do not move

The rules that cannot be broken (CLAUDE.md). The header and the home page are what every visitor
pays for (AGENTS.md §1.5, §18.3): Server Components, islands only where a click needs JS, every
critical-path kilobyte argued, no external embed, LCP 2.5 s on a phone. Static pages (§549) with the
clock holds; every public read through `public-cache/reads.ts`. The Neon bill is time awake (§327).
320 px first: one header row, 44 px targets, the first card and the first calendar week above the fold
(§569). Works with scripts off (§413). Both languages, same keys. Accessibility: one `h1`, one `main`,
the grid as a table, state never by colour alone. The brand and font tests. The decisions this amends
get their sections first: §353, §251, §470, §292, §487, §319 (if the arrow is approved), §366, §486.
The e2e suite is the gate, rewritten in the same chains. Two-step release, plus the setting's flip.

## Phases and releases

Each phase is one to three reviewed chains, released to QA first and to production on the owner's
word; a phase starts when the gate under the previous one is passed. Phases 1 and 2 can run side by
side.

| Phase | What | Gate |
| --- | --- | --- |
| 0 | Decisions and assets — no code: the twelve answers; the hero, one cover per run and race, six strip pictures in the gallery; the numbers | answers in writing, photos uploaded |
| 1 | Tokens and the public shell: the pink pair, Inter 800, the public scope, the setting «Aspectul nou», the header CTA and socials, the watermark; the design-system page shows both looks — **built behind the setting, off (2026-10-11)** | brand and font tests green, header one row at 320 px, the club's yes on QA |
| 2 | Cover photos on events, and the event kind: a cover column with its crop, the editor's picker, the ladder; weekly or special derived from the series; the photo tag — **built on `feat/facelift-phase-2`, awaiting release** | listing specs green; every weekly run and the race carry a cover |
| 3 | The home page: the root becomes a page; hero, next run, weekly and special, the band, why, the strip, the numbers; redirect, canonicals, sitemap. Every part a setting: «Pagina principală activă»; the hero picture with its crop and two lines and the three buttons' targets; N gallery pictures per strip or carousel, in order; the founding date and the runners figure; an unset strip is not drawn — **built behind «Pagina principală», off (2026-10-11): part A the page, its setting, the hero, the next run and the run sections; part B the four lower sections; part C their wiring and the panel in folds** | LCP under 2.5 s on a 320 px phone, root tests rewritten, the club's yes on QA |
| 4 | The calendar: filter chips with the kind, three colours and a legend, the next-event panel, the subscribe box, the title block — **built behind «Aspectul nou», off (2026-10-11)** | first week above the fold at 320 px, filters work with scripts off |
| 5 | The listing and the event page: cards with their photo and pills, the arrow if approved, the event page's head | listing and event specs green |
| 6 | The flip and the clean-up: «Aspectul nou» on in production; one release later the old look's code goes; the decisions amended | a week on production without the way back being used |

No dates: the pace is the owner's and the club's. At one batch a day, phases 1–6 are about three
weeks of calendar time.

### Phase 1, as built

On the branch `feat/facelift-phase-1` (2026-10-11), with decisions 1, 2 and 12 at their defaults.
Everything below is drawn only while «Setări» → «Aspect» → «Aspectul nou» is on, and only on the
public pages; off (the default), no rule matches and every page is what it was.

| Part | Where | Notes |
| --- | --- | --- |
| Tokens | `src/theme/brand.ts` (`COLOR` / `COLOR_DARK`) | `accent` (the hot pink, `#d6176f`), `accentInk` (the pink that carries words — the plan's «pinkInk»), `accentDeep` (hover), `accentTint`, `kindSpecial` + `kindSpecialInk`, `kindOther`, `inkStrong`; each with a dark twin |
| AA pairs | `src/theme/brand-pairs.ts` (`LOOK_PAIRS`, `LOOK_PAIRS_DARK`) | 17 a scheme, held by `tests/unit/theme/brand.test.ts`; `accentInk` is no lighter than `inkMuted`, so every page tint carries it |
| Scope | `src/theme/look.ts` | `data-look="2026"` on `<html>`, `:not(:has([data-backoffice]))`; `data-look-preview` for the design page's box |
| Pink `primary` | `src/modules/appearance/domain/site-look.ts` | MUI's `--mui-palette-primary-*` variables redefined under the scope, one unlayered stylesheet from the layout, like the tint |
| Pill buttons, Inter 800 headings | `src/theme/theme.ts` | theme overrides under the scope; `h1`–`h3` that state no weight of their own (a card's title keeps its 500 until phase 5); Inter 800 is `src/theme/fonts/Inter-800.woff2`, not preloaded |
| The setting | `src/modules/appearance/site-look.ts`, `ui/SiteLookPanel.tsx` | Administrator only, audited `site_look.changed`, expires the static pages |
| «Vino cu noi» | `src/shared/ui/HeaderCta.tsx`, `ArrowButtonLink.tsx`; target `src/modules/events/domain/next-weekly-run.ts` | the next weekly run's page, else the listing; a tighter pill below `sm` that keeps its arrow (§521); drawn into the nav's trailing group before the ☰, and not in the backoffice |
| «Urmărește-ne» | `src/shared/ui/HeaderSocials.tsx` | the owner, 2026-10-11: «Urmărește-ne» / "Follow us" and Instagram, Facebook and Strava, in that order, from the footer's one list; the header row's last item, its top right, after the nav and its ☰, from `md` up (§722, amending §708's two marks inside the nav) |
| The language | `src/shared/ui/FloatingLocaleSwitch.tsx`, drawn by `SiteFooter.tsx` | the owner, 2026-10-11: «the language switchers are always on the bottom right» — one 44-pixel round button showing the other language's flag and code, floating just above the footer's sticky bar in the bottom-right corner on every public page, so it stays while one scrolls and rises with the bar when its fold opens; the header's copy and the phone's flags on the bar are hidden under the scope (§722, amending §262 under the look) |
| The logo, blue | `src/shared/ui/SiteHeader.tsx` | the supplied lockup, unfiltered, under both looks |
| The watermark | `src/shared/ui/MountainMark.tsx`, `LookWatermark.tsx` | the mountain mark, faint, between the content and the footer |
| Both looks side by side | `/admin/design` → «Aspectul nou» (`src/modules/design/ui/LookSection.tsx`) | the same components twice, the right box under the preview scope; under them every accent preset with its four shades |
| The accent, the club's | presets `LOOK_ACCENT` in `src/theme/brand.ts`; a typed colour's shades `src/modules/appearance/domain/accent-shades.ts`; the form's «Culoarea de accent» in `ui/SiteLookPanel.tsx`, «Personalizat» `ui/CustomAccentOption.tsx`, the miniature `ui/AccentPreview.tsx` | pink (the default), blue (the club's blue as today's look wears it), orange, or a typed `#rrggbb` that is not a grey; four shades a scheme — `accent`, `accentInk`, `accentDeep`, `accentTint` — written by the layout's one stylesheet onto MUI's primary and `--br-accent-tint` (`LOOK_ACCENT_TINT` in `src/theme/look.ts`), so a rule under the look asks for `primary.*` or that variable and never names the pink; every preset and 432 typed colours held at AA in both schemes by `tests/unit/appearance/look-accent.test.ts` |

What phase 1 leaves for the gate: the club's look at QA with the setting on, phone and laptop; the
header's one row at 320 px measured by the e2e suite with the setting on.

### Phase 3, as built

On the branch `feat/home-page` (2026-10-11): part A (the page, its setting, the hero, the next run and the
run sections) with decisions 3, 5, 6 and 10 and open questions 6 and 7 at their defaults, then parts B and C
(the four lower sections, wired into the page and its setting) with decisions 7 and 8 at theirs. Everything below is drawn only while «Setări» → «Aspect» → «Pagina principală» is on;
off (the default), the root answers a 307 to the listing and the logo still leads there. It is its own
switch, independent of «Aspectul nou»: the page wears whichever look is in force.

| Part | Where | Notes |
| --- | --- | --- |
| The setting | `src/modules/appearance/home-page.ts`, `domain/home-page.ts`, `ui/HomePagePanel.tsx` | one `platform_settings` row `homePage`: on/off, the hero's picture (id, key prefix, size, crop) and its two lines in both languages or neither; Administrator only, audited `home_page.changed`, expires the static pages; no migration |
| The route | `src/app/[locale]/page.tsx` | static (§549); on: the page, canonical to itself; off: a 307 to the listing (no longer §353's 308, which browsers keep for good); the proxy no longer answers `/ro` and `/en` |
| The logo | `src/shared/ui/LogoLink.tsx`, `SiteHeader.tsx` | leads to `/` while the page is on, to the listing while it is off; never a menu entry |
| The sitemap | `src/app/sitemap.ts` | on: `/ro` and `/en` at priority 1, the listing at 0.9; off: as before |
| `HomePage` | `src/modules/home/ui/HomePage.tsx` | the one `main`; the sections below in order |
| `Hero` | `src/modules/home/ui/Hero.tsx` | the one `h1`, the last word in the accent; «Vino cu noi» (the next weekly run, else the listing) and «Vezi calendarul» as `ArrowButtonLink`s; the photograph eager with `fetchpriority="high"`, or the empty slot |
| `NextRunCard` | `src/modules/home/ui/NextRunCard.tsx` | the soonest group run or race still going ahead: its cover, the kind's tag, when, where, the forecast's words at the start (Open-Meteo's condition code), «Apus la …», the round arrow |
| `RunCardGrid` | `src/modules/home/ui/RunCardGrid.tsx` | the weekly runs and the special events (`eventKind`, §709), one card per series, at most six each; a CSS scroll-snap strip on a phone, three to a row from `md`; «Vezi toate alergările» to the listing |
| The parts | `HomePicture.tsx`, `RunTag.tsx`, `RoundArrow.tsx`, `card-sx.ts` | the 16∶9 frame or the empty slot (the mountain mark), the kind's pill in its tokens with its word, the arrow inside the card's one link |
| What they show | `src/modules/home/home-content.ts`, `domain/sections.ts` | read from the listing's cached upcoming events and the forecast's cached hour: nothing new asked of the database |
| The samples | `/admin/design` → «Mostre» → «Pagina principală» | the same components from `design/home-fixtures.ts#sampleHome` |

**The four lower sections.** Part B (`feat/home-sections`) built them as components with their domain and
fixtures; part C wired them into the page and the setting and folded the panel. Each is drawn only while its
switch is on — off by default — and, under it, only with something true to show.

| Part | Where | Notes |
| --- | --- | --- |
| «Prima dată» | `src/modules/home/ui/StepsBand.tsx`, `domain/steps.ts` | a heading, one sentence, five numbered steps (an `<ol>`, each a title over one sentence), «Cum funcționează» as an outlined arrow pill to a club page — not drawn until one is chosen and published |
| «De ce» and the quote | `src/modules/home/ui/WhyList.tsx`, `domain/why.ts` | four reasons with their glyphs; the quote in Caveat, drawn only when the club wrote it in both languages, its author only beside it |
| The photo strip | `src/modules/home/ui/PhotoStrip.tsx`, `domain/photo-strip.ts`, `strip-pictures.ts` | up to twelve of the club's stored pictures in its order, square tiles in a CSS scroll-snap row, lazy, with the ladder's `srcset` (a `strip` column in `media/ladder.ts`); the gallery's door and the club's Instagram as a link, never a feed; no picture, no section |
| The numbers | `src/modules/home/ui/NumbersBand.tsx`, `domain/numbers.ts` | the years from the founding day and «alergători activi» as typed; the runs a week and «100%» free computed from the weekly series ahead; a figure without its fact is left out, no figure no band |
| Their words and glyphs | `domain/home-text.ts`, `ui/home-glyphs.ts`, `ui/home-surfaces.ts` | every box both languages or neither, an empty one the platform's sentence (`HomeSections.*`); the glyphs a registry of their own; the band's fill the hero's tint, the pale pink under «Aspectul nou» |
| The setting | `src/modules/appearance/domain/home-page.ts`, `domain/home-sections-form.ts`, `home-page.ts` | the same `homePage` row gains `steps`, `why`, `strip` and `numbers`; a section that no longer reads is its empty value, never the page off; each box a pair `<stem>Ro` / `<stem>En`, a refusal naming the box |
| The strip's pictures | `changeStripPicture` in `home-page.ts`; the actions in `app/[locale]/admin/settings/appearance/actions.ts` | added, moved a place and taken out by small forms of their own, like a product's pictures; each keeps its key prefix and size beside its id, so the public read asks the store nothing and the pictures page lists it «Pe pagina principală» |
| «Cum funcționează» | the hero's third button and the band's | a club page chosen by its id from «Pagini personalizate», opened at its own address in each language; a page not published there is no button |
| The panel | `src/modules/appearance/ui/HomePagePanel.tsx` | the choice, then one fold per part — the sections' switches, the hero, «Prima dată», «De ce», the strip's heading, the numbers — closed on arrival with a line saying what is in it, each box showing the platform's sentence as its placeholder; «Copiază și tradu tot» over all of it; the strip's pictures in a fold of their own after the form |
| The page | `src/modules/home/ui/HomePage.tsx`, `home-content.ts` | the eight sections in the plan's order; the club page and the Instagram read from what the site already caches |
| The samples | `/admin/design` → «Mostre» | the four from `design/fixtures.ts` inside the new look's preview box, beside part A's |

**Turning it on, on QA:** sign in, «Setări» → «Aspect», and put «Aspectul nou» on first (the page wears
whichever look is in force; the new one is the one to judge), then «Pagina principală». Fill each fold you want (an empty box
is the platform's sentence, shown in grey), choose the club page for «Cum funcționează», add the strip's
pictures under «Fotografiile benzii», then open «Ce secțiuni arată pagina» and tick the four lower
sections, choose «Pagina principală» → «Salvează pagina principală» → confirm (an Administrator). The way
back is the same card, «Lista de alergări».

**The gate:** LCP under 2.5 s on a 320-pixel phone, measured on QA with the club's photograph in the
hero, and the club's yes on QA.

### Phase 4, as built

On the branch `feat/facelift-phase-4-calendar` (2026-10-11), with the plan's defaults for its open
questions: no hero photo on the calendar; the chips carry the kind and the surface, the collapsed
«Filtre» panel the rest; a separate Outlook row. Drawn only under «Aspectul nou»; off, the calendar
is today's and reads nothing more.

| Part | Where | Notes |
| --- | --- | --- |
| The title block | `src/app/[locale]/calendar/page.tsx` | the kit-face wordmark in the accent (§292 keeps it above the one `h1`); the `h1` «Calendar» drawn as the eyebrow from `sm`; the line «Planifică-ți următoarea alergare.» in Inter 800 with its last word in the accent, and the subline — from `sm`, so a phone's first week stays above the fold |
| The kind | `src/modules/events/domain/calendar-kind.ts` | `?kind=weekly` / `?kind=special` from §709's `eventKind`, one choice; the live twin answers it (`i18n/live-twin.ts`). The «Filtre» panel asks the same kind for everyone, under both looks and on the listing too: «Eveniment special» in «Tipul» (`?type=SPECIAL`, `SPECIAL_TYPE` in `listing-filter.ts`, §NNN), OR with the types, offered only where it narrows |
| `KindChips` | `src/modules/events/ui/KindChips.tsx` | «Toate evenimentele», «Alergări săptămânale», «Evenimente speciale», then the period's surfaces — `ChipLink`s to the address with the choice made, every other filter kept; a sideways strip on a phone. The «Filtre» panel hides its surface group under the look (`lookChips`) and keeps the boxes in its form |
| Three colours and a legend | `calendar-tone-sx.ts`, `CalendarLegend.tsx`; tokens `CALENDAR_TONE_TOKENS` in `src/theme/brand-pairs.ts` | weekly in the club's accent, pink by default (the band `LOOK_ACCENT_TINT`, a dot in `primary.light`: the setting's variables, never the pink's tokens), special green (`kindSpecial`), other grey (`kindOther`: a coffee, a shoe test); every pair AA in both schemes (`brand.test.ts`, the weekly one under every accent with `look-accent.test.ts`); the legend says each colour's word |
| `NextEventPanel` | `src/modules/events/ui/NextEventPanel.tsx` | the next date still ahead that the page's filters let through (`domain/next-event.ts`), from the listing's cached read; its day, the title, time and place, the route pills and the weather at the start, «Vezi detalii»; read only while the look is on |
| `SubscribeBox` | `src/modules/events/ui/SubscribeBox.tsx` | «Vrei să nu ratezi alergările?»: Google, Apple (`webcal://`), Outlook (`outlook.live.com`, in `PROVIDER_HOSTS`), the `.ics`, the address to copy in a fold; today's «Adaugă în calendarul tău» row is hidden under the look |
| Two columns | the page | from `md` the month and, beside it, the panel and the box; on a phone they follow the month |
| On the design page | `/admin/design` → «Mostre» → «Calendarul, sub aspectul nou» | the four parts with made-up data inside a preview box |

## Content and assets the club must provide

| What | Who | Shape | Where it goes |
| --- | --- | --- | --- |
| The hero photo | the club, with the yes of everyone recognisable | landscape, at least 2400 × 1350 | the gallery, then «Aspect» → «Pagina principală» |
| One cover per weekly run and per race | the club | 16:9 | each event in the editor (phase 2) |
| Six pictures for the strip | the club | square or 4:3, varied | the gallery; chosen in «Pagina principală» |
| The home page's words | the president and the owner, in Romanian; English with the translate button once the DeepL key is set | headline, subline, the band's sentences and five steps, the four «De ce» items, the quote | «Pagina principală», both languages |
| The numbers | the club | the founding date; «alergători activi» | «Pagina principală»; the other two computed |
| The two club pages | the president | «Comunitatea» and «Despre noi», both languages | «Pagini» → «Pagini personalizate», today |
| The approval | the president and the owner | a look at QA with «Aspectul nou» on, phone and laptop | each gate that names it |

Not needed: an Instagram developer account, a designer's file, fonts to buy, a lawyer's reading.

## Where this sits in the queue

The facelift is last, by the owner's word on 2026-10-10. Before it: a shop price in lei or in euro;
permissions per person («Gestionează magazinul») and the shop's own section; «Echipa» as an
organisational chart; «Adaugă o comandă pentru un membru»; the real catalogue entered on QA. What can
start before the facelift without waste: the photographs; the numbers and the social links as settings;
the design-system page (phase 1's proof surface); the org chart is drawn with today's tokens on purpose.

## Open questions

- [ ] Does the backoffice get the new look too, later? Default: no.
- [ ] Is «Comunitatea» one page or a menu group? Default: one page.
- [ ] Does the calendar page carry a hero photo? Default: no.
- [ ] Does the listing keep the collapsed «Filtre» panel beside the new chips? Default: the chips carry the kind and the surface; the panel keeps the rest.
- [ ] A separate Outlook row in the subscribe box? Default: yes, with Outlook's host in `PROVIDER_HOSTS`.
- [x] The weather words on the next-run card from Open-Meteo's condition code? Default: yes — taken (2026-10-11, phase 3 part A).
- [x] Should «Următoarea alergare» ever be a club-chosen event? Default: the soonest run; the featured flag keeps marking the race — taken (2026-10-11): the soonest group run or race.

If nobody answers anything: phases 1 and 2 start with every default above once today's chains have
landed; phase 3 waits for the photographs.
