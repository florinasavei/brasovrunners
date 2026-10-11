# The redesign plan (2026)

<!-- The working copy lives in the owner's Claude document; this file is the repository's version,
     kept in step by the dispatcher. No person's name appears here: the repository is public. -->

**As of 2026-10-10.** The owner and the club's president asked for a facelift of the public site —
two mock-ups, a landing page and a calendar page — and said it is the last item in the queue and
must be planned carefully. This page is that plan: the decisions, what exists, the visual system,
the constraints, the phases, the content the club provides, and the open questions.

## Decisions only the club can make

Twelve choices shape the whole facelift. Each row names the default the dispatcher builds if nobody
objects; a different answer changes the phases, not the rules.

| # | Decision | Default | Why it is the club's |
| --- | --- | --- | --- |
| 1 | The accent colour | a hot-pink accent token (and a darker «pinkInk» that carries white text at AA) beside the logo blue; the logo mark drawn in ink in the header; emails, PDFs, race numbers and share cards stay blue | the logo is pure blue and a brand test pins it |
| 2 | The heading face | Inter 800 (one new weight file; Inter is self-hosted with ș ț ă â î) for headings; body stays Roboto | a face is a licence and a look the club owns |
| 3 | A real home page — **decided (2026-10-10)** | a real home page at `/ro` and `/en`, reached from the logo — never a menu entry — switchable on and off in «Aspect» → «Pagina principală»; `/events` stays the listing under «Alergări»; canonicals and the sitemap move | it reverses §353 (the root is a redirect, for SEO) |
| 4 | The four menu words | «Alergări» = the listing; «Calendar»; «Comunitatea» = a club page linking «Echipa», «Galerie», «Întrebări» and the members' zone; «Despre noi» = a club page | the club decides what each word points to |
| 5 | Where «Vino cu noi» goes | the next weekly run's page; the band's «Cum funcționează» opens a club page | there is no sign-up for runners |
| 6 | Photographs | real club photos only, from the gallery; no stock or generated pictures; people in a home-page photo have agreed | consent and the club's own face |
| 7 | The Instagram block | a static strip of six gallery pictures with a link; no live feed | an embed is forbidden (AGENTS.md §18.3); a feed needs a Meta app and a token |
| 8 | The numbers band | typed in «Aspect» → «Pagina principală»: the founding date (years computed), «alergători activi»; «2×/săptămână» and «100% gratuit» computed from the events | invented figures are forbidden (BUSINESS.md §7) |
| 9 | What «Evenimente speciale» means | everything that is not a weekly series; the chip «Ediție specială» keeps its meaning (§168) | the mock-up's word and today's flag differ |
| 10 | The round arrow on cards | only on the home page's cards, keeping the whole-card tap; the listing keeps its text door | it reverses §319 |
| 11 | Icons | the filled Material family stays; the lighter look comes from colour, weight and spacing | a second family touches every glyph (§318) |
| 12 | How it ships | behind one setting, «Aspectul nou», read like the page tint: on for QA, off on production until the club approves on QA; the old look deleted one release after the flip; the backoffice keeps today's look | a live site with real registrations needs a one-press way back |

## What exists versus what is new

Most of the mock-ups' parts exist as data and components; what is new is one page, one photo field,
a handful of settings and the look.

| Element | Today | New |
| --- | --- | --- |
| Header | `SiteHeader` + `SiteNav`: logo, six entries, language switch; socials in the footer | a CTA slot and the two social icons, inside the one-row-at-320-px rule |
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
becomes the pink pair; the backoffice, the emails, the PDFs, the race numbers and the share cards keep
the logo blue. Headings Inter 800, letter-spacing −0.02 em; the two-tone word a `span`, not a
gradient; Caveat only where drawn, never preloaded. Cards: 16 px radius, one soft shadow, the photo on
top, a tag pill. Buttons: pill-shaped, a trailing arrow glyph (§521), `contained` pink and `outlined`
ink, 44 px tall. Chips: the existing `GlyphChip`. One inline mountain SVG under 2 KB. Motion from
`theme/motion.ts` only. Photos as plain `img` with the R2 ladder's `srcset`; only the hero eager.

The scope: the public layout sets `data-look="2026"` when «Aspectul nou» is on, the way `data-dark`
switches the dark scheme; the overrides read under that attribute as plain-object selectors. Off,
every page is pixel-identical to today; the backoffice never carries the attribute.

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
| 1 | Tokens and the public shell: the pink pair, Inter 800, the public scope, the setting «Aspectul nou», the header CTA and socials, the watermark; the design-system page shows both looks | brand and font tests green, header one row at 320 px, the club's yes on QA |
| 2 | Cover photos on events, and the event kind: a cover column with its crop, the editor's picker, the ladder; weekly or special derived from the series; the photo tag | listing specs green; every weekly run and the race carry a cover |
| 3 | The home page: the root becomes a page; hero, next run, weekly and special, the band, why, the strip, the numbers; redirect, canonicals, sitemap. Every part a setting: «Pagina principală activă»; the hero picture with its crop and two lines and the three buttons' targets; N gallery pictures per strip or carousel, in order; the founding date and the runners figure; an unset strip is not drawn | LCP under 2.5 s on a 320 px phone, root tests rewritten, the club's yes on QA |
| 4 | The calendar: filter chips with the kind, three colours and a legend, the next-event panel, the subscribe box, the title block | first week above the fold at 320 px, filters work with scripts off |
| 5 | The listing and the event page: cards with their photo and pills, the arrow if approved, the event page's head | listing and event specs green |
| 6 | The flip and the clean-up: «Aspectul nou» on in production; one release later the old look's code goes; the decisions amended | a week on production without the way back being used |

No dates: the pace is the owner's and the club's. At one batch a day, phases 1–6 are about three
weeks of calendar time.

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
- [ ] The weather words on the next-run card from Open-Meteo's condition code? Default: yes.
- [ ] Should «Următoarea alergare» ever be a club-chosen event? Default: the soonest run; the featured flag keeps marking the race.

If nobody answers anything: phases 1 and 2 start with every default above once today's chains have
landed; phase 3 waits for the photographs.
