<!-- PROJECT_BASELINE: BR-V1.94-2026-09-25 -->

# Brașov Runners — Requirements and Acceptance Criteria

**Baseline `BR-V1.94-2026-09-25`** · versioned with the whole set · [changelog](./CHANGELOG.md)


**Audience:** Product owner, project manager, QA, developers, and AI agents.

This document is the canonical scope and acceptance layer. [`BUSINESS.md`](./BUSINESS.md) says how the platform behaves in plain language; this file says what must be true for a behavior to be accepted; [`AGENTS.md`](./AGENTS.md) says how it is built; [`SETUP.md`](./SETUP.md) says how the repository and providers are configured; [`DECISIONS.md`](./DECISIONS.md) records why.

## 1. How to read this document

Requirement IDs are stable and are never renumbered or reused:

```text
BR-REQ-<business rule number>-<sequence>
```

`BR-REQ-034-02` is the second requirement derived from `BR-BUS-034`. A requirement covers one testable behavior, not one business rule; most rules produce several.

Each requirement states its source rule, the implementing section of `AGENTS.md`, a priority, a release, numbered acceptance criteria, and how it is verified. Acceptance criteria are written so a person who has not read the code can execute them.

A change to any requirement follows the change-type matrix in `AGENTS.md` §1.4. `yarn docs:check` enforces that every `BR-BUS-*` referenced here exists in `BUSINESS.md`, that every `BR-REQ-*` referenced anywhere in the repository exists here, and that every business rule is covered by at least one requirement.

## 2. Priority definitions

| Priority | Meaning |
| --- | --- |
| MUST | The milestone cannot be released without it. A failing MUST blocks promotion from `qa` to `main`. |
| SHOULD | Expected in the milestone. May be deferred by an explicit owner decision recorded in `DECISIONS.md`. |
| MAY | Accepted if it costs little. Never a release blocker. |

## 3. Release scope and milestones

The launchable product is **M1**. Later milestones are scheduled in the owner's order and
are built strictly in that order (`DECISIONS.md` §12 and §13; `BUSINESS.md` §8).

| Milestone | Scope | Requirements |
| --- | --- | --- |
| M1 — Launch | Event pages, complete registration journey with waiting list, staff login and minimal backoffice, live email, legal documents, production on the custom domain | Complete, in section 4 |
| M2 — Race features | Multi-distance UI, one number per race across distances, results with consent, backoffice completeness | Written at milestone start; M1 carries the schema footprints (BR-REQ-012-01, BR-REQ-072-01) and, since 2026-09-17, per-event race numbers and the printed sheet (BR-REQ-038-01) |
| M3 — Announcements | Event updates with approval, notices to registered participants | Written at milestone start |
| M4 — Runner profiles | Opt-in profiles and moderation | Section 4.8 exists; re-confirmed at milestone start |
| M5 — Mini CMS | Articles, static pages, galleries, media | Sections 4.9 and parts of 4.10 exist; re-confirmed at milestone start |

Each requirement's **Release** field names its milestone.

**One slice moved earlier, and the requirements were not relabelled.** Event editing, the
editorial workflow, the protected preview and the three staff roles were built during M1
rather than M5, because until they existed only a developer could change a race. The affected
requirements — BR-REQ-050-01, BR-REQ-051-01, BR-REQ-051-02 — keep `Release: M5` and carry a
**Status** line saying which part is built. `DECISIONS.md` §25 records the reordering.

**Release gate for M1.** Every M1 MUST requirement passes, the owner decisions in
`BUSINESS.md` §9 are answered, the approved legal documents are loaded, the domain-binding
runbook is complete, and one real registration has completed on production.

**Release gate for later milestones.** Every MUST requirement tagged with that milestone
passes, and the milestone's slice of `docs/PRACTICES.md` § Launch checklist is complete.

---

## 4. Requirements

### 4.1 Public website and internationalization

#### BR-REQ-040-01 — Locale-prefixed public routes

- **Source:** BR-BUS-040
- **Implements:** AGENTS.md §9.2
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given any public page, when it is requested, then its URL carries a `/ro` or `/en` prefix.
2. Given a request to `/`, when no valid saved locale exists, then the response redirects to `/ro`.
3. Given a request to `/`, when a valid saved locale exists, then the response redirects to that locale.
4. Given a URL with an explicit locale prefix, when a different locale is saved, then the URL wins.
5. Given any localized page, when it renders, then the alternate-locale link points at the corresponding localized slug and not at a concatenated URL.
6. Given the language switcher in the site header, when it is used on any page, then the visitor lands on the same page in the other language — resolved on the server, because the two locales of an event have different slugs and only the database holds the pair. When that page has no published translation in the target language, the switcher lands on that language's event listing rather than on a 404.
7. Given the switcher, when it renders, then the current language is marked rather than offered as a link, and the visible label is the language code with the flag as decoration beside it — a flag is a country, not a language.
8. Given the bare root, when any visitor requests it, then they land on the Romanian listing — no `Accept-Language` negotiation and no locale cookie; the chosen language lives in the address of every page (2026-09-18, `DECISIONS.md` §96).
9. Given a request to a locale's root (`/ro`, `/en`), when it arrives, then the response is a 308 to that locale's listing, with the query kept and no page body. Given a request to `/`, then it reaches the listing in one redirect (2026-09-24, `DECISIONS.md` §353).

**Verification:** unit `i18n/alternate-path.test.ts`; integration `events/locale-switch.test.ts`; e2e `event-pages.spec.ts`

#### BR-REQ-040-02 — No cross-locale content fallback

- **Source:** BR-BUS-040, BR-BUS-020
- **Implements:** AGENTS.md §9.3, §11.2
- **Priority:** MUST
- **Release:** M1
- **Status:** restated by `DECISIONS.md` §28, and bounded by §36. Publication is one state for
  the whole event, so the half-published event the earlier wording described — Romanian live
  while English is a draft — can no longer occur. The rule itself is unchanged and stronger:
  what a locale must never do is serve the other language's *text*.
  §36 draws the line explicitly: the meeting point, the street address, the difficulty and the
  cost are one value for the whole event, not a translation, so the English page showing the
  club's own words for them is a single stored value rather than a fallback to another row.
  Since migration `0018` the difficulty and the cost are closed sets — `EASY|MODERATE|HARD` and
  `FREE|PAID` — so they are one stored value *and* render in the reader's own language; the two
  name fields remain the club's own words, because a place name is not translated.

**Acceptance criteria**

1. Given an event that is not published, when either language's URL is requested, then both 404, and the event is absent from both listings and from the sitemap.
2. Given a published event that has no translation in one language, when that language's URL for it is requested, then the page 404s and does not display the other language's body.
3. Given the same event, when that language's listing is requested, then the event is absent from it, and the sitemap contains only the language it has a translation for.
4. Given a published event with a translation in both languages, when it is unpublished, then both languages stop being reachable in the same moment.
5. Given the language switcher on a page whose event has no translation in the target language, when it is used, then it lands on that language's event listing rather than on a 404.
6. Given an event's meeting point or street address, when either language's page renders, then it shows the one value stored on the event — this is a shared field, not a translation, and not a fallback (AGENTS.md §11.7).
7. Given an event's difficulty or cost, when either language's page renders, then it shows that language's word for the stored enum value, and when the value is null the page omits the row entirely rather than stating a difficulty or a cost the club never gave.
8. Given a "Linkuri și fișiere" row or a partner's link stored with its label in one language only, when either language's event page renders, then both pages show the kind's own word in their language and neither shows the club's one-language label. The editor still shows the stored label, and the closed line reads "etichetă într-o singură limbă" (§354). Verification: unit events/event-links.test.ts, events/co-hosts.test.ts, events/event-facts-co-hosts.test.ts, content/box-summaries.test.ts.

**Verification:** integration `events/publication.test.ts`, `events/locale-switch.test.ts`; e2e `cms-publish.spec.ts`, `event-pages.spec.ts`

#### BR-REQ-040-03 — Localized formatting and registration locale

- **Source:** BR-BUS-040
- **Implements:** AGENTS.md §9.4
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given an event starting at a known instant, when the page renders in each locale, then the date and time are formatted for that locale in the event timezone.
2. Given a registration created from an English page, when any later email for it is sent, then that email is in English regardless of the sender's locale.
3. Given a distance stored in meters, when it is displayed, then it is presented in the unit appropriate to the locale without changing the stored value.
4. Given any date a person reads — an event page, an email, the declaration PDF, a share picture, a backoffice table or card — when it is rendered, then it carries its day of the week in the reader's language: the long form 'Sâmbătă, 16 ian. 2027' / 'Saturday, 16 Jan 2027' or the short form 'Sâm., 16 ian. 2027' / 'Sat, 16 Jan 2027', any time on a 24-hour clock; birth dates, date and time inputs and machine formats (CSV, xlsx, JSON, .ics, the sitemap, `<time dateTime>`) are exempt (2026-09-23, `DECISIONS.md` §349).
5. Given a date that starts a label, a line, a cell or a heading, when it is rendered, then its first letter is a capital; given a date inside a Romanian sentence, then the weekday keeps the language's lower case, and the sentence says 'pe', not 'la', before it (2026-09-23, `DECISIONS.md` §349).
6. Given an instant, when it is formatted, then it is read in the zone the caller names — the event's own zone for an event date, the club's zone for a platform timestamp — and a calendar day with no time is read as the day it names whatever the reader's or the server's zone (2026-09-23, `DECISIONS.md` §349).
7. Given a bilingual email, when it is rendered, then every date in each half (the event's start, the hold deadline, the signing time) is written in that half's language, and the signed declaration writes its dates in the declaration's language (2026-09-23, `DECISIONS.md` §349).

**Verification:** unit `i18n/formats.test.ts`; integration `notifications/locale.test.ts`

#### BR-REQ-040-04 — No untranslated user-facing strings

- **Source:** BR-BUS-040
- **Implements:** AGENTS.md §9.3
- **Priority:** MUST
- **Release:** M1
- **Status:** amended, and recorded in `DECISIONS.md` §35. The rule is about the **public site**,
  which is fully bilingual and stays so. The backoffice's enum labels — editorial status,
  transitions, staff roles, event status, registration mode, registration status — are Romanian
  only and live in `modules/staff-identity/domain/staff-labels.ts` rather than in either
  catalogue.

**Acceptance criteria**

1. Given the message catalogs, when CI runs, then `ro.json` and `en.json` have identical key sets and identical interpolation placeholders.
2. Given a missing key in production, when a page renders, then the failure is logged without participant data and the page still renders.
3. Given the source tree, when CI runs, then no user-facing string literal exists outside the message catalogs — except the backoffice enum labels named in the status above, which are Romanian constants typed `Record<Enum, string>`, so a new enum value is a compile error rather than a raw token on a screen.
4. Given either catalogue, when CI runs, then it carries none of those enum labels: one copy of the club's own vocabulary, not two kept in step by a test.
5. Given a message that a page or a client island asks for and the catalogue lacks, when it renders with `APP_ENV` local or test, then it throws and the error boundary renders. On QA and production the failure is logged and the page still renders, as criterion 2 says (2026-09-24, `DECISIONS.md` §353).
6. Given any page, when it is served, then its payload carries only the messages its client islands read, and a public page carries none of the backoffice's. A test that walks the import graph from every route fails on a key an island reads that its provider does not carry, and on a listed key no island needs (2026-09-24, `DECISIONS.md` §353).
7. criterion (new): no message in either catalogue names the club. A sentence that needs the name takes it as `{club}`, and every call site fills it from `CLUB_NAME`; a test walks both catalogues and every such call (§369, superseding §215's `Site.name` equality test).
8. A message with an argument (`{x}`) or a tag is always looked up with its values, or read with `t.raw` when a client component fills the template itself. It is never looked up bare as `t("key")`: a development build refuses that lookup and shows the key, while a production build returns the message unformatted. A literal angle bracket is written ICU-quoted (`'<id>'`). Every `t.raw` key names a message or a sub-tree of the catalogue. Verification: unit `i18n/messages.test.ts` (2026-09-24, `DECISIONS.md` §370).

**Verification:** CI check `i18n-parity`; unit `i18n/messages.test.ts`

#### BR-REQ-041-01 — Mobile-first journeys

- **Source:** BR-BUS-041, BR-BUS-070
- **Implements:** AGENTS.md §18.5
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given any public page at 320 pixels wide in either locale, when it renders, then there is no horizontal scrolling and no clipped text.
2. Given an event page at 360 pixels wide, when it renders, then date, start time, meeting point, distance, cost, and places left are visible in the first screen as text.
3. Given the registration, declaration, and offer pages on a phone viewport, when they render, then the primary action is reachable without scrolling back past the content, and the deadline, where one exists, is visible in the first screen.
4. Given the registration form on a phone, when each field is focused, then the keyboard type and autocomplete match the field.
5. Given a dialog on a phone, when the device rotates or the content exceeds the viewport, then the dialog scrolls internally and entered data is preserved.
6. Given any interactive element in a participant journey, when its rendered size is measured, then it is at least 44 by 44 CSS pixels.
7. Given the registration list and registration detail in the backoffice on a phone viewport, when they render, then a participant can be found by name and their status read without horizontal scrolling.
8. Given the test suite, when it runs, then every registration journey runs under a mobile viewport project as well as desktop.
9. Given the public registration form, when it renders, then every field a submission is refused without is present without opening anything, every optional data field is collapsed behind a native disclosure whose summary names what is inside, and every consent is presented uncollapsed. It is one page; a multi-step form is refused (`DECISIONS.md` §47).
10. Given a submission the server rejects, when the response renders, then the page is entered at a focusable summary naming each rejected field as a link to that field, and each rejected field carries its own message next to it — a phone's message says the number is not valid — and every box holds what was typed, a select its choice, a tick its state, the privacy consent alone asked again; the values travel in an encrypted cookie for ten minutes on the form's path and never in the address, a draft the cookie cannot hold is dropped rather than truncated, and a submission that goes through forgets it (2026-09-19, `DECISIONS.md` §142).
11. Given any public page, when it renders, then the light/dark switch is the first control on the footer's line, in the bar's own bottom-left corner (not the page column's), 44px tall like the line, and the header carries none (2026-09-19, `DECISIONS.md` §115, §119).
12. Given a public page whose content costs a query — the event listing and the gallery — when it is asked for, then the parts that do not depend on that query are rendered at once and each part that does is replaced, until it arrives, by a loading shape occupying the same box, carrying `role="status"` and a name saying the page is loading in the reader's language; and when the reader changes the month, the year or the layout, then the calendar's controls do not move, only the calendar's body is replaced, and nothing on the page is blanked (2026-09-20, `DECISIONS.md` §166).
13. Given any animation the site draws — a loading figure, a shimmer, a fade, a hover lift — when the reader's system asks for reduced motion, then nothing moves and no information is lost, because every animated element is accompanied by the same fact in words (2026-09-20, `DECISIONS.md` §166).

14. Given a public page whose content costs a query, when a loading shape stands in for a region, then it is never larger than the smallest shape that region can take — the month grid is drawn with exactly the number of week rows the month on view spans, and a region that may be absent reserves no box — so the swap only ever grows the page and never collapses it; and given a control that navigates to such a page without its own route-level loading state, when it is pressed, then the control itself says the press landed, in place and without moving, for as long as the navigation is pending (2026-09-20, `DECISIONS.md` §167).

15. Given the facts block on an event's own page, when it renders, then each row's pieces are a list, one line under another with a bullet that is hidden from a screen reader, rather than one line separated by middle dots — a row with a single piece being just that fact; the labels stay a `<dt>`, the values a `<dd>`, the words unchanged, and a link among the pieces keeps its 44 pixels. The hero and the listing cards keep the one-line form (2026-09-20, `DECISIONS.md` §168). The list's `role="list"` and each item's `role="listitem"` are stated as well as meant, because WebKit drops the implicit roles from a list with no marker of its own; and the one time of an event that is not a race is named on its bullet ("începe la 09:00") rather than standing there as a bare number, while the one-line form keeps it unnamed after the date (2026-09-20, `DECISIONS.md` §169).
16. Given a text field on any form, when the server refused it or the browser refused it after it was touched or on a send press, then the box carries a red exclamation mark inside it, at the end (at the top of a multi-line box), and the browser-refused case also has the red outline; a pristine field, a select and a field with its own end adornment carry none; the mark is decorative and the words stay in the helper text and the error summary (2026-09-23, `DECISIONS.md` §309).
17. Given a backoffice form that carries typed values — the event's create and save, the repeat rule, a page, an album, a legal version, adding a colleague, a registration entered or renamed by staff, the email copy, the plan settings, the test rows' count, a hand-set race number — when the server refuses it, then the page answers without a redirect: a focusable summary first in the form names each refused field as a link to its box under the box's label (in the language's endonym for a translated box), the box says "check this field", and every box comes back as typed — rich texts, programme rows, partners, the repeat tick, cadence, end and weekdays included — with JavaScript on or off, and nothing typed is put in the URL; a value that exists to be retyped (a typed title, phrase, name or count) comes back empty and the summary says it is asked again; a success redirects exactly as before (2026-09-23, `DECISIONS.md` §315).
18. Given a backoffice box whose schema refuses a value, when it renders, then its HTML constraints — `required`, `minLength`/`maxLength`, `pattern`, `type` url/email/number, `min`/`max`/`step` — are read off the Zod schema the service validates with, never typed a second time; `required` asks the schema what an empty box reaches it as; a `pattern` whose schema trims before it tests allows whitespace at either end, so the browser never refuses what the server accepts; the browser refuses the send first, with JavaScript off too, and the submit button names the first box still missing (2026-09-23, `DECISIONS.md` §315).
19. Given the registration form's send button, its "send again" after a too-fast refusal, and the contact form's send button, when they render, then each shows the club's runner before its label: standing at rest, running while the request is in flight, and still under reduced motion. The label stays the button's accessible name (2026-09-23, `DECISIONS.md` §318).
20. Given any public page, when its client JavaScript is built, then it carries none of the backoffice's action icons: the icon list is reachable only from the `/admin` and `/devs` routes, and the components public pages render (`ButtonLink`, `SubmitButton`, `RunnerLoader`) import it neither directly nor through anything (2026-09-23, `DECISIONS.md` §318).
21. Given any public page at any width, when the footer renders, then the privacy notice link is on the always-visible bar, outside the fold: "GDPR" on a phone, "Confidențialitate" from sm, "Privacy" in English. It is a 44-pixel target that overlaps nothing, and its accessible name is the notice's ("Nota de confidențialitate (GDPR)" / "Privacy notice") and contains the visible word (§323).
22. Given any page with the sticky footer, when the browser scrolls something into view — keyboard focus, an anchor, a scripted click — then it stops above the footer, never behind it: the document reserves 96px at the bottom on a phone, where the footer is two lines, and 52px from 600px up, next to the header's reserve at the top (2026-09-23, `DECISIONS.md` §324).
23. Given any public page below 600px, when the footer renders with its fold closed, then the privacy link reads "Confidențialitate" / "Privacy" (named "Nota de confidențialitate (GDPR)" / "Privacy notice" for assistive technology), not "GDPR". It sits at the start of the bar's second line with the language switcher at the far end, and the switch, the summary and the social marks stay on the first line. The bar is at most two 44px lines tall and nothing on it overlaps. From 600px up the bar is one line (2026-09-23, `DECISIONS.md` §324).
24. Given a backoffice date or time picker on a phone, when it renders, then its calendar, clock and clear buttons are each at least 44 pixels, and a programme row's three narrow boxes wrap instead of overflowing; a row's boxes carry no clear button, the row's own remove button emptying it (2026-09-23, `DECISIONS.md` §345).
25. Given any public page, when it is served, then the message catalogue its client islands receive holds only the keys those islands read (`PUBLIC_CLIENT_MESSAGES` in `src/i18n/client-messages.ts`, a few kilobytes) and none of the backoffice's. The `/admin` and `/devs` layouts nest a provider that adds the staff islands' keys. A test walks every route's imports to each client file and fails when a key an island reads is missing from its provider's list, or a listed key is read by no island (§353).
26. (Replaces the criterion of §168/§169.) Given the facts block on an event's own page or its preview, when it renders, then its rows are grouped by question in this order: when, where, the route, the cost, the age, "no registration needed" where it applies, and the partners. There is no list, no bullet and no empty item. "Când" is one line: the date with its weekday, a middle dot hidden from a screen reader, and the time (a race's two named times on the same line), with no "începe la". "Unde" is the place, as the one link to the map when there is one, with the address on the line under it. The route is one wrapping row of small outlined pills (distance, climb, difficulty, surface, in that order, each with its glyph), a pill only for what the club stated, and the surface never makes a route row on its own. The cost is its own row with one pill ("Gratuit", the club's amount, "Cu taxă", "Donație"), followed by where to pay or give as a link. Every row's leading glyph is the same size (20 px), colour and alignment. Below 600 px the label sits over its answer; from 600 px the labels are a column. Labels stay a `<dt>` and values a `<dd>`, and every link keeps its 44 pixels. The hero and the listing cards keep their one-line forms (2026-09-24, `DECISIONS.md` §356).
27. Given any sub-navigation inside a backoffice section (the configuration screen's panels, the to-do screen's panels, the gallery's albums and pictures, the email previews' language), when it renders, then it is the one `SubNav`: a labelled `<nav>` of plain links drawn as secondary tabs under a thin rule, with no button, fill, shadow or glyph. The current entry alone carries `aria-current="page"` and is marked by a 2-pixel underline in the primary colour and a heavier weight, styled from that attribute. Each entry is 44 pixels tall with a visible keyboard focus ring. At 320 pixels the row stays one line that scrolls sideways inside itself, never wrapping and never widening the page (2026-09-24, `DECISIONS.md` §360). Verification: unit `shared/sub-nav.test.ts`; e2e `config-panels.spec.ts` (mobile).
28. Given any public page at any width and in any environment, when the footer renders with its fold closed, then the build stamp is not on screen. It is the last line of the "Despre club" fold's panel, and no stamp is rendered outside the footer. With the fold open, the stamp sits inside the footer and is never wider than the screen. It is still the staff entrance: a double-click, a long press or Enter opens sign-in, and a single tap does nothing (§34, §365).
29. Given any public page below 600px, when the footer renders, then the language switcher on its second line shows RO and EN side by side on one row, each a 44-pixel target. The whole bar, both lines including the privacy notice and the language, is on screen at every scroll position, and nothing is rendered under it (§365; criteria 21 to 23 unchanged).
30. Given the public listing, when a single-date card or a series card renders, then both have one structure: the type and marks as chips at the top, the title as the card's only link to the event inside its heading (the theme's primary colour, the same colour once visited, underlined only under a pointer or keyboard focus, one size and weight on both kinds of card), a summary clamped to three lines with every web address printed as its host and no link in it, the facts, and the door to the page. No card is one link around the whole card, and no link holds another (2026-09-24, `DECISIONS.md` §366).
31. Given a listing card's facts, when they render, then they have no labels and no middle dots. The date line leads with the calendar glyph and puts a clock of the same 20-pixel size before the time. On a series card, «Următoarea:» starts that same line and is never a line of its own. The place is one line with its pin on its first line, and is the link to the map (opening in a new tab) when the club pasted one. The route, the surface and the cost are the event page's small outlined pills, each only for what the club stated, with the surface said once and not repeated as a chip at the top. The partner is not among the facts. The state of registration comes last on an event that takes registrations (2026-09-24, `DECISIONS.md` §366).
32. Given a row of listing cards at any width, when one card is shorter than its neighbour, then the cards keep one height and the room left over is below the door, which sits no more than eight pixels under the facts or a series' fold. A card's pieces are separated only by its two gaps, 8 pixels between the lines of a group and 12 between groups, so the first line under a title starts 8 or 12 pixels under the title's words. Nothing is wider than a 320-pixel phone (2026-09-24, `DECISIONS.md` §366).
33. Given every link and fold on a listing card (the title, the place's map link, a series' fold, each of its dates, the door), when it is pressed two pixels inside any of its four edges on a 320-pixel phone or a desktop, then it receives the press itself. Each is at least 44 by 44 pixels, and nothing later on the card sits on any part of it. A series' dates are 44-pixel links around small pills, with their rows 44 pixels apart. The title's and the place's links give back their extra height as a negative margin no larger than the gap on that side, with the padding inside a `border-box` 44, so the line each stands on is as tall as its words (2026-09-24, `DECISIONS.md` §366).
34. Given the «Când» row on an event's own page and the featured hero, when they render, then a clock stands before the first time, the size of the glyphs around it: the row glyph's 20 pixels on the page, and the hero's own 18 (2026-09-24, `DECISIONS.md` §366).
35. A press of a heavy form's primary button (event create, event editor, registration, email wording, legal draft) paints its pending state within 200 ms median at 4x CPU on a mobile viewport, and inserts no CSS rule during the interaction (tests/e2e/perf/inp.spec.ts, tests/e2e/press-adds-no-style.spec.ts).
36. Given any interactive element in a participant journey, when its rendered size is measured, then it is at least 44 by 44 CSS pixels. The one exception is the items on the footer's bar below 600 pixels: the scheme switch, the fold's summary, the social marks, the privacy link and each language item. Each of them is at least 24 by 24 pixels below 360 pixels wide (WCAG 2.2 SC 2.5.8, AA) and at least 28 by 28 pixels from 360 to 599 pixels; the summary is a label whose width is its words, with the same height. From 600 pixels every item on the bar is 44 pixels again, and the links inside the footer's open fold are 44 pixels at every width (2026-09-25, `DECISIONS.md` §372).
37. Given any public page, when it renders, then the light/dark switch is the first control on the footer's row, in the bar's own bottom-left corner (not the page column's), exactly as tall and as wide as the bar's target: 24 pixels below 360 pixels wide, 28 pixels from 360, 44 pixels from 600. The header carries no switch (2026-09-19, `DECISIONS.md` §115, §119; 2026-09-24, `DECISIONS.md` §372).
38. Given any public page at any width, when the footer renders, then the privacy notice link is on the always-visible bar, outside the fold, and overlaps nothing. From 600 pixels it reads "Confidențialitate" / "Privacy" and is a 44-pixel target. Below 600 pixels it is a lock glyph with no word beside it, at the bar's target size (24 pixels below 360, 28 from 360), linking to the same notice. At every width its accessible name and its tooltip are the notice's name, "Nota de confidențialitate (GDPR)" / "Privacy notice", which contains the visible word where one is shown (§323; 2026-09-24, `DECISIONS.md` §372).
39. Given any page with the sticky footer, when the browser scrolls something into view (keyboard focus, an anchor, a scripted click), then it stops above the footer, never behind it. The document reserves 40px at the bottom below 600px, where the footer is one row at most 28px tall plus its border, and 52px from 600px up, next to the header's reserve at the top (2026-09-23, `DECISIONS.md` §324; 2026-09-24, `DECISIONS.md` §372).
40. Given any public page below 600px in either locale, when the footer renders, then its bar is one row, in this order: the scheme switch, the fold's summary with its words ("Despre club" / "About the club", never cut or ellipsised), the social marks, the privacy notice as a lock, and the two languages as flags without letters. Each language item is a square of the bar's target, and the current one is marked by `aria-current="true"` and a visible ring. Every item's top is the switch's, whether the fold is closed or open, and nothing on the bar overlaps. The bar is one target tall plus its border. Opened, the fold's panel is inside the `<details>` and sits below the whole row. The DOM order is the same at every width, and from 600px the bar is the same single 44-pixel row (2026-09-23, `DECISIONS.md` §324; 2026-09-24, `DECISIONS.md` §372).
41. Given any public page below 900 pixels in any environment, when the footer renders with its fold closed, then the build stamp is not on screen: it is the last line of the "Despre club" fold's panel. With the fold open it sits inside the footer and is never wider than the screen. From 900 pixels a second copy is pinned to the bar's own bottom-right corner, inside the bar, over none of the row's items, and the panel's copy is hidden. No stamp is rendered outside the footer. Each copy is the staff entrance: a double-click, a long press or Enter opens sign-in, and a single tap or click does nothing (§34, §365; 2026-09-24, `DECISIONS.md` §372).
42. Given any public page below 600px, when the footer renders, then the language switcher is the last item on the bar's one row, RO and EN side by side as flags. Each is at least the bar's target in width and height: 24 pixels below 360, 28 from 360. Each is named, and its tooltip is, by the language in its own words. The whole bar, including the privacy lock and the flags, is on screen at every scroll position, and nothing is rendered under it (§365; 2026-09-24, `DECISIONS.md` §372).
43. Given a listing card on a phone (below `sm`) whose date is within the coming twelve months, when the card renders, then its «when» row reads the date with its weekday and without the year («Duminică, 27 sept. · 18:30»), on one line at 320, 360, 390 and 412 pixels in both languages, each piece kept whole; from `sm` up the year is shown (2026-09-25, `DECISIONS.md` §375).
44. Given a series card, when its «when» row renders, then the lead «Următoarea:» / «Next:» stands in front of the date from 376 pixels up — the widest row with the lead, measured over every day of a year in both languages, needs 368 — and below 376 it is visually hidden but kept in the markup for a screen reader; the lead gives way, never the time (2026-09-25, `DECISIONS.md` §375).
45. Given a listing card whose row cannot fit one line — a race's two named times, or a date that keeps its year on a phone (already past, or more than a year out) — when it renders at a phone's width, then the row wraps between whole pieces and nothing in it runs past the card: no time is clipped by the card's own overflow (2026-09-25, `DECISIONS.md` §375).
46. Given an event with route facts, when its listing card or its event page renders the route, then the pills read in the order surface, difficulty, distance, elevation (the card's cost pill after them), from one shared ordering, and the featured hero's route line reads difficulty, distance, elevation in the same order (2026-09-25, `DECISIONS.md` §375).
47. Given any public page at any width, when the footer renders, then the privacy notice link is on the always-visible bar, outside the fold, right after the "Despre club" fold and before the social marks. Below 600px it is a circled question mark (`help_outline`) with no visible word. From 600px it reads "GDPR" in both languages. It is the bar's target size (24px below 360, 28px from 360, 44px from 600) and overlaps nothing. Its accessible name and tooltip are the notice's, "Nota de confidențialitate (GDPR)" / "Privacy notice (GDPR)", and contain the visible word (§323, §378).
48. Given any public page, when the footer renders with its fold closed or open, then the bar's items have one DOM order at every width: the theme switch, the "Despre club" fold, the privacy notice, Facebook / Instagram / Strava, then RO and EN. Below 600px every item is on the switch's row at 320, 360, 390 and 412px in both languages, neighbouring items 6px apart (was 0), the summary not cut, and nothing overlapping. From 600px up the bar is one 44px line (§324, §372, §378).
49. On a phone (below `sm`), every public page's main container, including the listing, an event page, the calendar, a standing page, contact, the gallery, the legal texts, the registration form and the participant's link pages, has 12 pixels of vertical padding, taken from one density scale rather than a number written in the component. Only the error and not-found screens keep their own padding (2026-09-25, `DECISIONS.md` §380).
50. On a phone, the listing's cards are 8 pixels apart and each card's top padding is 12 pixels. The card's horizontal padding stays 16 pixels at every width, so the §366/§375 width budget of the "when" row still holds, and that row stays whole with nothing past the card at 320, 360, 390 and 412 pixels in both languages (2026-09-25, `DECISIONS.md` §380).
51. On a phone, the featured event has 16 pixels of padding and its facts rows are 6 pixels apart. On an event page there are 6 pixels under one answer before the next question and 8 pixels between two partner cards. The 4 pixels between a question and its answer and the answer's 28-pixel indent are kept (2026-09-25, `DECISIONS.md` §380).
52. From `sm` up, every spacing value the density scale touches keeps exactly the value it had before; a unit test holds a table of every converted site against its pre-change value (2026-09-25, `DECISIONS.md` §380).
53. Below `sm`, no spacing value on the public pages or the event components is a written number instead of a `DENSITY` step, unless it is on a named allowlist with its reason; a revert to an old value fails the unit test (2026-09-25, `DECISIONS.md` §380).
54. On the listing card's «when» row the time has the date's weight: a single time is bold, and a race's two named times bold only their numbers, never the word in front ('întâlnire', 'start', 'gather', 'start'). The calendar's `.ics` description keeps the plain text (2026-09-25, `DECISIONS.md` §381).
55. A race card's «when» row takes a 4-pixel gap between its pieces and before each separator, where every other card row keeps 6, so the two bold times fit one line under the date at 320 pixels on the widest weekday in both languages (222.83 pixels against 226 in Romanian) and the row is two lines at 320, 360, 390 and 412. The series row and its lead's 376-pixel breakpoint are unchanged (2026-09-25, `DECISIONS.md` §381).
56. Every backoffice success shows one toast at a time for 5 to 6 seconds, above the sticky bars, with a close button of at least 44 px, announced through a polite status region that is mounted before the toast. A refresh never repeats it.
57. An irreversible or outward-facing staff verb asks first. The safe button has the focus, Enter confirms only a non-destructive dialog, and Escape and the backdrop cancel. A verb that emails participants states the number of real participants from the send's own query; for a series save, that is the sum over the dates ticked, with a date already run counted nowhere.
58. (Replaced 2026-09-25, §385.) Given any public page at any width, when the footer renders, then the privacy notice link is on the always-visible bar, outside the fold, right after the fold's summary and before the social marks, and overlaps nothing. Its visible text is "GDPR" at every width and in both languages (`Legal.privacyLinkShort`). There is no glyph. Its accessible name and its tooltip are the notice's name, "Nota de confidențialitate (GDPR)" / "Privacy notice (GDPR)", which contains the visible word (WCAG 2.5.3). From 600 pixels it is a 44-pixel target. Below 600 pixels it is the bar's target tall (24 pixels below 360, 28 from 360) and as wide as the word plus 2 pixels a side (§323, §372, §378).
59. (Replaced 2026-09-25, §385.) Given any public page below 600 pixels, when the footer renders with its fold closed or open, then the bar is one row, in this order: the scheme switch, the fold's summary with its words, "GDPR", Facebook, Instagram, Strava, a rule, then RO and EN as flags. The rule is one pixel of the theme's divider colour, hidden from assistive technology, 16 pixels tall on the 24-pixel bar and 18 on the 28-pixel bar, and centred on the row. Neighbouring items are 4 pixels apart below 360 and 6 pixels apart from 360. That includes both sides of the rule, and excludes the space after the summary, whose fold takes what the row leaves. The summary's words are never ellipsised at 320, 360, 390 or 412 pixels, in Romanian or English. Every item's top is the switch's, nothing overlaps, and the last flag ends inside the viewport. From 600 pixels the languages are in the header and the rule is not shown (§372, §378).
60. (Replaced 2026-09-25, §385.) Given any public page at any width and in any environment, when the footer renders, then the build stamp is a small outlined chip in the secondary text colour. It shows the environment prefix where there is one, "app-ver", the baseline, the short commit and the build's date and time, and its label wraps rather than being cut. Below 900 pixels it is the last item of the "Despre club" fold's panel and is not on screen while the fold is closed. From 900 pixels it is pinned to the bar's own right-hand corner. It is never wider than the screen, and no stamp is rendered outside the footer. The chip stands in a 44-pixel box that carries the accessible name and the exact build as its tooltip. The box is the staff entrance: a double-click, a long press or Enter opens sign-in, and a single tap does nothing. Where staff sign-in is disabled it is an inert label. Opened, the fold's panel is one wrapping row of 44-pixel links, 8 pixels apart on a phone, with no margin between lines. "Scrie-ne" appears once, as the contact form's link followed by the club's address as a mail link when one is configured (§34, §365, §372).

**Verification:** e2e `registration-form.spec.ts` and `registration-entry.spec.ts` under both Playwright viewport projects, `event-pages.spec.ts` (criterion 12); unit `registrations/form-errors.test.ts`, `events/listing.test.ts`, `theme/brand.test.ts`; release check on a real device

#### BR-REQ-001-01 — One platform boundary

- **Source:** BR-BUS-001
- **Implements:** AGENTS.md §3.4
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given the repository, when it is built, then one Next.js application serves the public site, the CMS, and the backoffice.
2. Given a proposed change introducing a second frontend, a separate API service, a message broker, or an external CMS, when it is reviewed, then it is rejected unless a decision recording it exists in `DECISIONS.md`.

**Verification:** review gate; architecture test `architecture/boundaries.test.ts`

### 4.2 Events and capacity

#### BR-REQ-010-01 — Event types and surfaces

- **Source:** BR-BUS-010
- **Implements:** AGENTS.md §10.1
- **Priority:** MUST
- **Release:** M1

Two closed sets where there was one (`DECISIONS.md` §61): the **type** says what the event is —
group run, race, hike, coffee, equipment testing, other event, external event (§121) — and the
**surface** says what it is run on — asphalt, trail, mixed — and may be absent, because a
coffee is run on nothing.

**Acceptance criteria**

1. Given an event of each supported type, when it is displayed, then its type is presented with a localized label in both locales, and its surface beside it when one is stated — as a chip on the listing and the featured hero, and in the overline of the event page.
2. Given an event of type `RACE`, when it is registered for, then it uses the same registration model as any other type.
3. Given a request to create an event with an unsupported type or surface, when it is submitted, then it is rejected — by the form with a message, and by the database enum whatever the source.
4. Given the editor, when it renders, then the type is required and the surface offers an empty "not stated" option, in that order, before the event status.
5. (Amends criterion 1.) On a listing card the surface is a pill among the card's route pills rather than a chip beside the type; the featured hero and the event page's overline keep it beside the type (2026-09-24, `DECISIONS.md` §366).

**Verification:** integration `events/configuration.test.ts`, `events/structural-constraints.test.ts`; unit `i18n/messages.test.ts`; e2e `event-route.spec.ts`

#### BR-REQ-011-01 — Minimal and full event configurations

- **Source:** BR-BUS-011
- **Implements:** AGENTS.md §10.1, §12.3
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given an event with only kind, start time, meeting point, short description, and registration mode `NONE`, when it is published, then it renders without any capacity, registration, or waiting-list element.
2. Given an internal event, when capacity is absent, then registration is open without any numeric place count.
3. Given an internal event, when `registration_closes_at` is absent, then registration closes at event start.
4. Given an internal event, when `registration_opens_at` is absent, then registration opens when the event is published in that locale.
5. Given a race with a gathering time and a gun time, when its page renders, then both are shown, each labelled, in the event's timezone; and when only one time is stated, only that one is shown. `starts_at` remains when the event begins and continues to drive ordering, the upcoming/past cut-off, the sitemap and the listing.
6. Given a race start earlier than the event start, or later than the event end where one exists, when it is submitted, then the database refuses it.
7. Given an event with a map link (`events.map_url`, pasted by the organizer — a Google Maps link or any other https map page), when its page renders, then the meeting point and the address link to it with `rel="noopener noreferrer"`, and the `SportsEvent` block carries it as `hasMap`. The link is stored, never assembled: `AGENTS.md` §8 forbids a map hostname under `src/` and exempts no provider. An event with no map link shows the meeting point as text and no `hasMap`. There are no coordinates and no `geo` any more (`DECISIONS.md` §61).
7a. Given a map link, when it is saved, then it must be https at the form and again at the database, and a stored `javascript:` or `data:` value is impossible whatever the source.
7b. Given the editor, when it renders, then the distance, the climb, the difficulty and the route link are all settable on it; and given an event with any of them stated, when its page and its listing card render, then the distance, the climb and the difficulty appear as text on both, and the route link on the page alone (criterion 8).
8. Given an event with a route link (`events.route_url` — a Strava route or activity, or any other https link), when its page renders, then the route is offered as its own labelled fact, separate from the meeting point and its map link, opening in a new tab with `rel="noopener noreferrer"` and a tap target of at least 44 pixels; and when the link's host is `strava.com`, the Strava mark is shown beside the words — the mark only, never Strava's embed script, which is a third-party processor the privacy notice does not name (`DECISIONS.md` §61). `events.route_url` must be https at the form and again at the database; it is a link and never an uploaded file, since media storage is deferred (`AGENTS.md` §17). It is absent from the listing card, where the whole card is already one link. An event with no route link says nothing about a route, and duplicating an event carries it (`DECISIONS.md` §49).
8. Given two events, when both are marked as the featured event, then the database refuses the second; and when one is featured, the landing page leads with it, above the ordinary listing, ordered featured → race → soonest.
9. Given an event with a video link (`events.video_url` — a YouTube link in any share shape: `watch?v=`, `youtu.be/`, `shorts/`, `embed/`, `live/`), when it is saved, then the link is refused unless an eleven-character video id can be read from it; and when the event page renders, then the film is offered behind one press — a native disclosure whose closed state fetches nothing from YouTube — and, opened, plays from `youtube-nocookie.com` from the id alone, with a line saying the player is YouTube's. Absent from the listing card and from a duplicate or a repeated edition, because a film is of one edition (2026-09-18, `DECISIONS.md` §69).
10. Given an event with a Strava event link (`events.strava_event_url` — the club's group event page on `strava.com`, refused on any other host), when its page renders, then it is offered as its own labelled fact with the Strava mark, opening in a new tab with `rel="noopener noreferrer"`; absent from the card, and never carried onto a duplicate or a repeated edition, because a Strava group event is one occurrence's page (2026-09-18, `DECISIONS.md` §71). The same, for a Facebook event link (`events.facebook_event_url` — a page on `facebook.com`, `fb.com` or `fb.me`, refused on any other host): its own labelled fact with the Facebook mark, absent from the card, never carried onto a duplicate or a repeated edition (2026-09-19, `DECISIONS.md` §144).
11. Given a translation with a full description — a rich-text document written in the editor of AGENTS.md §11.3, validated against the same allowlist as a standing page — when the event page **and its preview** render, then it appears in the short description's place — **one slot, directly under the title, above the divider and the facts** (2026-09-20, `DECISIONS.md` §187), the two screens sharing one component so they cannot show it in different places. The short one is the card's, and stands on the page only while the full description has no **words** (2026-09-20, `DECISIONS.md` §156, §187) — so a full description that is only a picture or only a film renders under the summary rather than replacing it, which is what `isRichTextEmpty` alone used to do to it. Rendered through the allowlisted renderer and nothing else; an empty document renders nothing (2026-09-18, `DECISIONS.md` §71).

12. Given the featured event within seven calendar days of its start — counted on the event's own calendar, never the server's — when the homepage renders, then the hero carries a countdown line ("Mâine, sâmbătă 07:00"; "În 3 zile, …") above the registration control; while registration is open the free places show as before, and once it has closed the sentence says to come to the desk with the QR. Server-rendered, no script. On a phone, "Alte evenimente" under the hero is a native disclosure, open when there are four or fewer and folded when there are more; on a wide screen it is always open (2026-09-18, `DECISIONS.md` §78).
13. Given a published internal event whose `registration_opens_at` is ahead, when the hero, the event page, a listing or series card and the calendar feed render, then each says when registration opens in the event's zone — "Înscrierile se deschid pe <date>" at the countdown's size where the button will stand, one short line on the card, the same sentence with the form's address after it in the calendar entry (2026-09-20, `DECISIONS.md` §159) — and the event page carries a box under it, only while an approved privacy notice exists for the locale (BR-REQ-053-01; no notice, no box, and a submission past the page is refused): one address, "Anunță-mă", the sentence that one email follows and the address is then deleted, and the link to the privacy notice. Submitting keeps one row per event and canonical identity (`registration_interests`, the versioned canonicalizer of BR-REQ-032), answers "Te anunțăm pe email" whether the row was new or already there, refuses only a malformed address — timing the corrected form from the render it corrects — and takes the registration form's honeypot, timing check and Turnstile with the form's silence; nothing of the address ever goes into a URL. The box is gone, and a late submission redirected to the plain page, once the window is no longer ahead. In the backoffice an Administrator sees how many addresses wait, never which, and can withdraw one by the address the person wrote from, by its canonical identity (2026-09-19, `DECISIONS.md` §146).

14. Given a listing with nothing upcoming, when it renders the club's most recent event so the page is not blank, then that event is an ordinary card under the "no upcoming events" notice and never the featured hero, whatever its featured flag says — a race that has been run is not the club's answer to what is next (2026-09-20, `DECISIONS.md` §167).

15. Given an event marked as a special edition (`events.is_special` — an anniversary, a charity run, a date the club joins somebody else's race), when its card, the hero and its page render, then each carries a badge saying so; when the listing is ordered, then a special edition stands above the ordinary ones of its own band, never above the featured event and never changing which event is featured; and the calendar entry and the share cards say nothing new. Any number of events may be special, including one date of a series alone, so the database puts no limit on it; the mark is not carried to the other dates by a series save, nor by a duplicate or a repeated occurrence (2026-09-20, `DECISIONS.md` §168). A repeated event is one card (BR-REQ-020-01 criterion 9), so that card carries the badge when any of its dates is special and its folded date list marks which date it is; the draft preview carries it as the public page does (2026-09-20, `DECISIONS.md` §169).
16. Given an event held with other organizations (`events.co_hosts` — an ordered list of a name and an optional page, at most eight, each name 1–200 characters and each page https and at most 2 000), when its page and its listing card render, then they say "Împreună cu A, B și C" joined the way the reader's language joins a list, each partner with a page being a link to it; the `SportsEvent` block names every one as an `Organization` after the club, and the calendar entry writes one line per partner. Given a row saved before the list existed, when it is read, then `co_host_name` and `co_host_url` are read as its one partner, and the next save writes the list; given a saved list that is empty, then the event has no partners and those two columns stay unread. They are not written and not dropped in this release: their removal is a later contraction (`AGENTS.md` §7.6). Partners are the series', so a series save carries them to its other dates and a duplicate keeps them (2026-09-20, `DECISIONS.md` §168). Wherever the facts may carry links at all — the page, a series card — each partner with a page is a link there too; inside a card that is itself one link they are words. Given a stored partner carrying a key this release does not know, then the key is ignored and the partner is named; given one whose stored page is not https, then the name is kept and the link dropped, as the two old columns have always done. Given a caller that says nothing about the partners, then the column is not written at all — only an editor's empty list means "no partners" — and a series save compares what the rows mean, so a null column and an empty list are one value and a save that changed nothing applies nothing (2026-09-20, `DECISIONS.md` §169).
17. Given an event whose translation in the page's language carries a `location_name` (migration `0058`), when the event page, its preview, the calendar entry, the share card and the emails render in that language, then the meeting point is called by that name; given a translation whose name is blank, then the event row's own name is used — never the other language's translation — so a Romanian name on the English page needs the club to have written none in English, and BR-REQ-040-02 is untouched. The meeting point itself stays one fact on the event row, required once before publication (2026-09-23, `DECISIONS.md` §294) (2026-09-23, `DECISIONS.md` §303).
18. Given an event whose registration is open, when its listing card renders, then the card's last piece names until when — "Înscrieri deschise până pe 14 nov., 23:59" / "Registration open until 14 Nov, 23:59", in the event's time zone — using the stated closing or, when none is stated, the event's start (criterion 3), read through the same rule that turns the state to CLOSED, so the date on the card is the instant the button goes away; before the window opens the card names the opening instead (criterion 13), and an external, absent, cancelled or completed registration names no closing (2026-09-23, `DECISIONS.md` §308).
19. Given an event with `events.location_to_be_announced` true (the editor's "Locația se anunță mai târziu"), when it is published with no meeting point, then publication succeeds; and with the flag false, a blank meeting point is still refused. When its page, preview, listing card, hero, series card, share picture, registration form, calendar file and feed, Google Calendar link, structured data and emails render, then each says "Locația se anunță în curând" / "Location to be announced soon" where the place would be, with no map link, no address, no programme-row place and no `LOCATION`; the structured data's `location` is a `Place` named "Brașov" with only a locality and a country; the declaration's `{{eventLocation}}` is "Brașov"; and a place typed meanwhile appears on none of them. When the flag is turned off and the event saved with a place, then every surface shows the place at once and no email is queued. The editor's meeting-point box is `required` exactly while the switch is off.
20. Given an event with links and files (`events.links` — an ordered list of at most twelve `{ kind, url, labelRo, labelEn }` rows: a GPX track, a map on a platform, a document, a photo album, results, or anything else; `kind` one of six closed values, `url` https and at most 2048 characters on any host, each label optional and at most 80 characters), when its page renders, then a "Linkuri și fișiere" / "Links and files" section appears under `#links`, after the route and map facts and before the programme, only when at least one link exists; each row shows the kind's own glyph, the club's label in the reader's language or, when none was given, the kind's own word in that language (never the other language's label), and the link's host in small text beneath it, opening in a new tab with `rel="noopener noreferrer"` and a tap target of at least 44 pixels. An entry with no https address is dropped rather than rendered, and an unrecognised kind is read as "other" rather than dropping the link. A link's label is never required for publication (criterion 11's rule, unaffected). The links are the series' and a duplicate's, carried like the route link (criterion 8, `DECISIONS.md` §49); a caller that says nothing about them leaves the column as it was (the discipline criterion 16 set for partners). The confirmation and the race-week reminder each carry one line, "Linkuri și fișiere: pe pagina evenimentului" / "Links and files: on the event's page", deep-linking `#links` only when the event has links — never the addresses themselves.
21. Given the editor or the create page with "Locația se anunță mai târziu" switched on, when it renders, then the meeting point and the map link are hidden and not required, their values stay in the form and are saved unpublished, and switching it off shows them again as typed (`DECISIONS.md` §339).
22. an event's cost is FREE, PAID (with a required amount and an optional https payment link) or DONATION (with a required https donation link and an optional suggested amount); a PAID or DONATION event with no stated cost_url emits no JSON-LD offers.url, and no offer ever states a price parsed from the free-text amount.
23. 16 (revised for the card of links). Given an event held with other organizations (`events.co_hosts` — an ordered list of at most eight `{ name, links }` cards, each name 1–200 characters and each of at most eight `{ kind, url, labelRo, labelEn }` links — `kind` one of SITE, EVENT, REGISTRATION, FACEBOOK, INSTAGRAM, STRAVA or OTHER, `url` https and at most 2000 characters, each label optional and at most 80 characters), when the compact card and a series card render, then they say "Împreună cu A, B și C" joined the way the reader's language joins a list, each partner's name linking to its own SITE link if it named one, else its first link, else no link; when the full event page renders, then each partner is its own row naming every link it carries, with the link kind's own glyph, the club's label or the kind's own word, and the link's host underneath, opening in a new tab with `rel="noopener noreferrer"` and a tap target of at least 44 pixels. The `SportsEvent` block names every partner as an `Organization` after the club with that same primary link as its `url`, and the calendar entry writes one line per partner with the same link. Given a row saved before this list existed — the two old columns, or the release before's `{ name, url }` list — when it is read, then it is read as the one link it always meant, the partner's own site; a saved list that is empty means the event has no partners. Given a stored partner or link carrying a key or kind this release does not know, then the key is ignored and an unknown kind is read as OTHER, rather than the partner or link being dropped; given a link that is not https, then it is silently absent, the name kept, exactly as the two old columns always did. Given a caller that says nothing about the partners, then the column is not written at all (unchanged from §169). Partners and their links are the series' (unchanged from §168): a series save and a duplicate carry them to every date.
24. A create and an editor save that carry these fields together each write every one of them once: the cost kind with its amount and link, the partners with their links, the event's links, the place to be announced, and the wall-clock times. A refusal of any one of them writes none of the others and names its own posted box (`tests/integration/cms/event-fields-together.test.ts`).
25. Each partner link row and its move and remove buttons name the partner in their accessible name ("Linkul 1 al partenerului 1" / "Link 1 of partner 1"). No row or button of the event form shares an accessible name with the event's own links (`tests/unit/content/event-form-together.test.ts`, `tests/e2e/co-host-links.spec.ts`, `tests/e2e/event-route.spec.ts`).
26. The listing's featured event names its partners in the one-line sentence the listing card uses, with one link per partner. Only the event page lists each partner's links (`tests/unit/events/event-facts-co-hosts.test.ts`).
27. Criterion (new, §352): Given an event partner whose description is stored in both languages, when the event page or its preview renders in a language, then the partner's row shows its name, then that language's description, then its links, with any REGISTRATION link first. A REGISTRATION link without a club label reads "Înscriere la {partner}" / "Register with {partner}" as an ordinary link, never a button. Given a stored description in one language only, then neither page shows a description. The listing card, series card and featured hero keep the names-only sentence. The event's JSON-LD partner Organization carries the description in the page's language only when both are written. Verification: unit `events/event-facts-co-hosts.test.ts`, `events/co-hosts.test.ts`, `events/structured-data.test.ts`; e2e `co-host-links.spec.ts`.
28. Criterion (amends §332's label rule, §352): Given a "Linkuri și fișiere" row or a partner's link whose label is typed in one language only, when the event is saved (draft or not), then the save is refused naming the empty label's box by its row (and partner), and nothing is written. A row with no label in either language is saved and shows the kind's own word. Verification: unit `content/event-links-field.test.ts`, `content/event-co-hosts-field.test.ts`; integration `cms/both-languages.test.ts`.
29. (Amended.) Given an event with a map link (`events.map_url`), when its page renders, then the meeting point links to it with `rel="noopener noreferrer"`, and the street address stands on the line under the meeting point in the facts' "Unde" row, as text, so the map is offered once. The address is no longer a separate block of its own (2026-09-24, `DECISIONS.md` §356). The `SportsEvent` block carries the link as `hasMap`, as before.
30. Given the event editor or the create page, when the Locul box renders, then "Punct de întâlnire" is asked once per language: two boxes side by side under one heading, Română (`event.locationName`, which is also the event's own meeting point, `events.location_name`) and English (`event.locationNameEn`). Both are `required` with the same 200-character ceiling, read off the schema, exactly while "Locația se anunță mai târziu" is off. The language tabs carry no other place-name box. A save stores the Romanian box on the event and on the Romanian row, and the English box on the English row even when it says the same, under the event row's version; the rows' own versions do not move. A save posting no English box leaves the English row as it is. A blank name in either language is refused, naming that language's box ("Locul › Punct de întâlnire (English)"), unless the place is to be announced; then whatever was typed is kept, unpublished. "Același nume și în engleză" copies the Romanian into an empty English box only, never over a name already there. While the two boxes say the same place (spacing aside), typing in Romanian writes the English too. When the Romanian moves away from an English name of its own, a line under the English box says the English still names the old place. The server never fills a blank English box with the Romanian. For an event saved before this criterion, whose English row has no name, both boxes open with what its pages show (the address folded in). A save that moves only the Romanian moves the English with it, unless the Romanian row had a name of its own or the editor's box posted `event.placeNamesAsTyped`; then both names are kept as posted. Each language's page, preview, calendar file, structured data, closed-box summary, declaration `{{eventLocation}}` and each half of a bilingual email reads that language's name, else the event's, never the other language's (BR-REQ-040-02). A series save for all dates carries a place moved in either language to every date it reaches, comparing what each page shows rather than the columns, and gives each date a new version. The participants' notice counts a place moved in English alone and ignores a first save that only writes the pages' own names into the columns. Verification: unit `content/place-one-name-per-language.test.ts`, `content/location-to-be-announced.test.ts`, `content/publish-check.test.ts`, `content/create-page.test.ts`; integration `cms/location-name-per-language.test.ts`, `cms/both-languages.test.ts`; e2e `cms-publish.spec.ts`, `event-notices.spec.ts`, `location-to-be-announced.spec.ts` (2026-09-24, `DECISIONS.md` §362).
31. (Amended by criterion 30.) Given an event with `events.location_to_be_announced` true (the editor's "Locația se anunță mai târziu"), when it is published with no meeting point, then publication succeeds; and with the flag false, a meeting point missing in either language is refused, naming that language's box, like any missing translation. An event saved before criterion 30, whose English page shows the event's meeting point, is not refused for it. When its page, preview, listing card, hero, series card, share picture, registration form, calendar file and feed, Google Calendar link, structured data and emails render, then each says "Locația se anunță în curând" / "Location to be announced soon" where the place would be, with no map link, no address, no programme-row place and no `LOCATION`. The structured data's `location` is a `Place` named "Brașov" with only a locality and a country; the declaration's `{{eventLocation}}` is "Brașov"; and a place typed meanwhile, in either language, appears on none of them. When the flag is turned off and the event saved with a place in both languages, then every surface shows the place at once and no email is queued. The editor's two meeting-point boxes are `required` exactly while the switch is off (2026-09-24, `DECISIONS.md` §362).
32. (Amends criterion 16.) The listing card no longer says "Împreună cu A, B și C" among its facts. The page and the featured hero keep it, and the card's partner mark is its chips' (2026-09-24, `DECISIONS.md` §366). The clause "inside a card that is itself one link they are words" is withdrawn: no listing card is one link.
33. (Amends criterion 18.) "the card's last piece" reads "the card's last fact line, after the pills" (2026-09-24, `DECISIONS.md` §366).
34. Each partner's card on the event page is its own outlined box with a wash behind it (`partnerCardSurface`: the theme's `divider` border and `action.selected` background, never a literal colour), so it reads correctly in both colour schemes, and a card with a description in both languages and a link stays inside its row at 320 pixels (2026-09-25, `DECISIONS.md` §381).
35. The route / training description ('Traseul', under #route) is the one place the page, the staff preview, the facts' route row and every email's deep link agree about which links sit in the route section versus 'Linkuri și fișiere' — an email offers #links only when partitionEventLinks(links, hasRouteDescription(...)).other is non-empty for the rendered language, never from a raw count of the event's links. (2026-09-25, `DECISIONS.md` §387.)

**Verification:** integration `events/configuration.test.ts`, `registrations/interest.test.ts`, `cms/series-edit.test.ts`; unit `events/zoned-time.test.ts`, `events/ical.test.ts`, `events/co-hosts.test.ts`, `content/event-co-hosts-field.test.ts`; e2e `event-pages.spec.ts`; unit `events/registration-window.test.ts` (13, 18)

#### BR-REQ-020-01 — Publication and cancellation visibility

- **Source:** BR-BUS-020
- **Implements:** AGENTS.md §10.1, §11.2
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given an event whose translation for a locale is in Draft or In review, when that locale's public URL is requested, then the response is 404.
2. Given an event with `event_status = CANCELLED` and a published translation, when its page is requested, then it renders with a clearly visible cancelled status.
3. Given a cancelled or completed event, when a registration is attempted, then it is rejected.
4. Given an event with `event_status = COMPLETED` (set by the organizer in the editor), when its page or card renders, then it says "S-a încheiat" in words and offers no registration control; when a check-in is attempted at the desk, then it is refused with a sentence and the desk shows the rows without buttons; and the maintenance job no longer touches the event (2026-09-18, `DECISIONS.md` §82).
5. Given the listing, when it renders, then it carries, right under the featured event, a row of type filters (`?type=`, one of the closed set; only the kinds with a published event in view are offered, as small chips inside 44-pixel links, and no row at all when there is fewer than two — 2026-09-19, `DECISIONS.md` §133) and a month view of the published events — the month `?month=YYYY-MM` names or the current one, in the club's time zone, Monday first, each event a link, a cancelled one struck through — as a grid on every width, each event a chip with its type's and its surface's glyph, the time, the title where there is room and the whole in a tooltip, and as an agenda of the month's days when `?view=list` asks for it (a chip pair, "Calendar" / "Listă", kept by the month links like the filter — 2026-09-19, `DECISIONS.md` §137); the filter applies to the month and to the cards and is kept by the month links (2026-09-18, `DECISIONS.md` §89).
6. Given an event whose translation has rules or a programme (`event_translations.rules_json`, `schedule_json`, written in the description's editor, folded), when its page or preview renders, then the programme appears under `#schedule` and the rules under `#rules` below the description, in the reader's language; an event without them shows no section, and the emails link to each only when it exists (2026-09-18, `DECISIONS.md` §96).
7. Given a published event, when `/<locale>/events/<slug>/calendar.ics` is requested, then it is a valid RFC 5545 calendar with one VEVENT — UTC start and end (the start again when the event has no end), the title, the meeting point, the short description and the programme as plain text, the event's page as URL, lines folded under 75 octets, text escaped — and the event page offers it and Google Calendar's add-event address beside the share links; given `/<locale>/events/calendar.ics`, then it is the same for every published event from a month ago to a year ahead, named "🏃 BVR", with an hourly refresh hint, **never cached** — every read is the current data — and the listing offers it under "Adaugă în calendarul tău", beneath the month, as three 44-pixel buttons — Google Calendar, `webcal://`, the download — with the "when each app re-reads it" sentence behind an "i" and the plain address folded away (2026-09-19, `DECISIONS.md` §139); the place (`LOCATION`, and Google's add-event link) is the event's map link when it has one, the meeting point's name then first in the description, and a line is folded at 75 octets without ever splitting a character (`DECISIONS.md` §107, §129); the description carries every detail the page has, in the reader's language and the page's words, each line only when the event has the thing — the cancelled or finished notice first, the meeting point with its map link ("Vezi pe hartă" for a map without a name) and the street address, the short description, the long one's first 600 characters, the gathering and gun times when the race has both, one facts line (type, distance, climb, surface, difficulty, cost), where registration stands with the form's address (open, the opening date while it is ahead, closed, at the organizer's link; nothing when the event takes none or is over), the page, the rules as `#rules`, the programme as `#schedule`, the route, the film, the Strava and Facebook events, the programme under "Programul evenimentului", "Ce să aduci", "Împreună cu" — and the same as minimal HTML in `X-ALT-DESC;FMTTYPE=text/html`, escaped and folded like every other line, which Outlook renders (Apple and Google make the plain text's addresses tappable); a cancelled event's entries carry `STATUS:CANCELLED`; `DTSTAMP` and `LAST-MODIFIED` move when the row changes and when the window's opening or closing passes; Google's add-event link carries the same text as the HTML its dialog renders, within 1,500 characters — cut at a word, the page's link last when the cut took it (2026-09-20, `DECISIONS.md` §159).
8. Given an event's type, surface, difficulty or cost, wherever it is shown as a word — the listing's filter and cards, the featured hero, the event page's overline, the facts — then a glyph from one fixed set per value stands before the word, decorative (`aria-hidden`) and never in place of it (2026-09-19, `DECISIONS.md` §112).
9. Given two or more upcoming events of the same type with the same title in the listing's language, when the listing renders, then they are one card: the title once, linking to the next occurrence's page; how it recurs — "every Monday and Wednesday at 18:30" when the dates on the event's wall clock are weekly or fortnightly on a set of weekdays, "N dates, until …" otherwise; the next occurrence's facts; a chip saying the rhythm — "Săptămânal", "La două săptămâni", or "N date" when there is none; and every coming date as a link, each 44px tall, behind a closed "Toate datele (N)" disclosure (2026-09-19, `DECISIONS.md` §138, §154); the month view still shows every date; a single event is a card as before (2026-09-19, `DECISIONS.md` §113).
10. Given the calendar, when it renders, then a month select and a year select (two years either way) go straight to the chosen month, the arrows step one month, and a "Month | Year" switch shows `?year=YYYY` as the agenda of every month of that year that has an event — each month a bordered box, in columns from `sm`, its heading linking to its month view, with its count — where the arrows step one year; every entry in any view carries its type's glyph before the time; the year wins when the address names both a year and a month (2026-09-19, `DECISIONS.md` §116).
11. Given an event with programme rows (`events.schedule_items`: a start, an optional end, a label in each language, an optional place), when its page or preview renders, then `#schedule` lists them soonest first — the time, the label in the reader's language, the place — under a day heading when they span days, with the programme's text beneath; when the reminder is sent, then it repeats them as one line per row in each language's half; when the event's `.ics` or the club's feed is produced, then each row is its own VEVENT after the event's — "<title> — <label>", at the row's time, at its place or else the event's, UID `<event id>-<n>` — and the event's own description lists the rows before the text (2026-09-19, `DECISIONS.md` §117).
12. Given any time the site shows, in either language, then it is on a 24-hour clock; and given an event with a map link, wherever its facts may carry a link (the page, the hero, a series card), then the meeting point's name is that link, while inside a card that is itself one link it stays words (2026-09-19, `DECISIONS.md` §120).
13. Given a series on view — the listing's card, the calendar, the backoffice's folded dates — when one of its dates is cancelled, at another place than most of them, or at another hour, then that date is struck through (cancelled) and carries a mark whose tooltip and accessible name say which ("Anulată", "Nu în locul obișnuit: …", "Nu la ora obișnuită: …"); a date like the others carries none (2026-09-19, `DECISIONS.md` §122). A date marked as a special edition carries the sparkle and "Ediție specială"; one date wears one mark, ranked cancelled, special, elsewhere, at another hour (2026-09-20, `DECISIONS.md` §169).
14. Given a calendar file or feed produced on QA, when it is opened or subscribed to, then its name and every entry's title carry a `[QA] ` mark, so a copy sitting beside the production one in the same calendar app says which it is; production is never marked (2026-09-20, `DECISIONS.md` §175).
15. Given an event with `event_status = CANCELLED`, when a place frees, an address is confirmed, the desk confirms, promotes or checks somebody in, staff resend a link, a number is typed by hand, the thank-you is sent, or the maintenance job runs, then nothing is offered or allocated, no hold is expired, no number is settled, and no message is queued. The exceptions are the participant's own withdrawal notice and the state notice staff may resend; a hand-typed number is written but not emailed. The registrations keep the status they had. "Înscrierile mele" and the manage page show that status with an "Eveniment anulat" chip and no desk code, QR or self check-in. The confirmation page says the event was cancelled or is over (2026-09-23, `DECISIONS.md` §331, amending §160). Verification: integration `registrations/cancelled-event.test.ts`, `registrations/maintenance.test.ts`.
16. Given the listing, an event page, the calendar and the feeds were served from the public cache, when an organizer saves the event as Cancelled, unpublishes, archives or deletes it, then the next request shows it cancelled or answers 404: the save expires every cached event read before its request ends, and a refused save expires nothing (§333). Verification: integration `public-cache/revalidation.test.ts`; e2e `cms-publish.spec.ts` (unpublished → 404).
17. (Amended.) The event page's route pills give the distance and the climb glyphs of their own, a ruler and a rising line, beside the difficulty's and the surface's, and the cost's pill carries the cost's glyph, so every pill in the facts has one (2026-09-24, `DECISIONS.md` §356).
18. Given an event held with at least one partner (`events.co_hosts`, read through `readCoHosts`), when its listing card, series card (the next date's partners) or the listing's featured hero renders, then the chips row carries one small outlined chip with the handshake glyph and "În parteneriat cu X" / "With X". Two partners read "… cu X și Y" / "… with X and Y". From three on, the first is named and the rest counted: "… cu X și încă N parteneri" / "… and N more partners", Romanian taking "de" from twenty. The chip wraps inside the card at 320 px and never widens the page. When the calendar renders, grid or agenda, then the entry carries the handshake at its end and the same words in its tooltip and accessible name. When the event page renders, then its overline carries "·", the handshake and the same words after the type and the surface, wrapping on a phone. Each surface uses the reader's language and never the other's. An event with no partners, or whose partners were all removed, carries none of these (2026-09-24, `DECISIONS.md` §367). Verification: unit `events/partner-marker.test.ts`; e2e `partner-marker.spec.ts`.
19. Given a month-grid calendar entry, when a pointer rests on it or on any mark inside it, or the keyboard focuses it, then exactly one tooltip opens. It shows the time and the whole title, then the date's note when it has one, then the partner line when it has one, each on its own line. No element of any calendar entry, grid or agenda, carries a `title` attribute. The link's accessible name carries every line and stays its name while the tooltip is open. In the agenda, which has no tooltip of its own (criterion 5, `DECISIONS.md` §261), each mark keeps its own tooltip and is a named image a screen reader reads (2026-09-24, `DECISIONS.md` §367). Verification: unit `events/partner-marker.test.ts`, `events/calendar.test.ts`; e2e `partner-marker.spec.ts`, `event-pages.spec.ts`.
20. (Amended.) "At another place than most of them" compares the place the reader's page names, in the reader's language, without the street address. Two dates are at the same place when their map links are the same link (scheme, "www.", host case, a trailing slash, the fragment and `g_st`/`utm_*` ignored), or when their names are equal once folded: diacritics, case, and every run of punctuation or spacing dropped, then trailing comma-separated address parts removed from the end, never the first part. Those parts are exactly: the club's city; its county; the country; a six-digit postcode; a Romanian street by its first word (strada, str, bulevardul, bd, b-dul, calea, aleea, șoseaua, șos, splaiul); an English street by its last word (street, st, road, rd, avenue, ave, boulevard, blvd); a house number. So "Parcul Sportiv Tractorul – intrarea dinspre Patinoarul Olimpic, Brasov" and the same name without ", Brasov" carry no mark. A different entrance, a square, another park, another city or another kilometre still does (2026-09-24, `DECISIONS.md` §367). Verification: unit `events/same-place.test.ts`, `events/series.test.ts`, `events/partner-marker.test.ts`.
21. Given an event held with one or more partners, when its listing card, series card, featured hero, calendar entry (grid, agenda, tooltip) or event page overline renders, then it carries one handshake glyph and the generic label "Eveniment în parteneriat" / "Partnered event" in the reader's language — never a partner's name and never a count — and the partners themselves, each named with its links, appear only in the event page's partner cards (2026-09-25, `DECISIONS.md` §375).
22. The partner marker's emoji glyph is aria-hidden by default wherever no caller-supplied aria-label or role names it, matching every other glyph on the site, while a caller that does name it (PartnerMark) is still read aloud. (2026-09-25, `DECISIONS.md` §379).
23. A marked event shows a headlamp pill (glyph and word, in the reader's language) after the route's numbers and before the cost on the listing card, the event page and the featured hero, and a line in the calendar entry and the .ics description; an unmarked event shows none of it.
24. An event held with a partner (`events.coHosts`) carries a generic marker — one gray handshake glyph and the words "Colaborare" / "Partnership", never a partner's name or count — on the listing card's own chip, the event page's overline, and the calendar's grid and agenda entries; the full partner list stays the event page's own partner cards. The handshake's ink is a grayscale filter matched to `text.secondary` in each colour scheme, except on a **filled** (race) calendar entry, where it instead matches `primary.contrastText` — the near-white or near-black tone that entry's own fill uses in that scheme — so the marker reads there too rather than nearly vanishing against `primary.main` (2026-09-25, `DECISIONS.md` §379).
25. A calendar entry opens exactly one tooltip at a time: in the month grid the entry's own tooltip carries every line (time, title, the date's note, the partner marker) and its marks are drawn bare with no tooltip or accessible name of their own; the agenda row carries no tooltip of its own, so its handshake keeps the only one, naming itself with the generic marker's words (2026-09-25, `DECISIONS.md` §379).

**Verification:** integration `events/publication.test.ts`; e2e `event-cancelled.spec.ts`

#### BR-REQ-030-01 — Exactly one registration mode

- **Source:** BR-BUS-030
- **Implements:** AGENTS.md §10.1
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given an event with mode `NONE`, when its page renders, then no registration action is offered.
2. Given an event with mode `EXTERNAL`, when its page renders, then it links to the external provider URL over HTTPS, and no local registration is created by following it.
3. Given an event with mode `EXTERNAL`, when a local registration is attempted through the API, then it is rejected.
4. Given an attempt to set capacity or a declaration on a non-internal event, when it is saved, then it is rejected.

**Verification:** integration `events/registration-mode.test.ts`

#### BR-REQ-012-01 — A race groups child distance events

- **Source:** BR-BUS-012, BR-BUS-032
- **Implements:** AGENTS.md §10.1, §12.3, §12.6
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a race with three child events, when the race page is requested in a published locale, then it renders the shared name, date, and place once, and lists each distance with its own free-place count.
2. Given a participant with an active registration on one child event, when they submit for another child event of the same race, then it is treated as a duplicate and no second registration is created.
3. Given the database, when a second active registration for the same participant and race is inserted directly, then the partial unique index rejects it.
4. Given an event with no `race_id`, when it renders, then nothing about races appears.
5. Given a race, when its structured data renders, then it is a `SportsEvent` whose `subEvent` entries are the child events.
6. Given M1, when the registration form for a child event renders, then it is the ordinary single-event form; distance selection within one page is M2.

**Verification:** integration `events/race-grouping.test.ts`; e2e `race-page.spec.ts`

#### BR-REQ-034-01 — Public free-place count is exact

- **Source:** BR-BUS-034
- **Implements:** AGENTS.md §10.6
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a capped internal event with capacity 20, 15 confirmed registrations, 1 unexpired declaration hold, and 0 waiting-list entries, when a visitor opens the event page, then 4 available places are displayed.
2. Given the same event with 3 eligible waiting-list entries, when a visitor opens the event page, then 1 available place is displayed.
3. Given a hold whose deadline has passed but which the maintenance job has not yet processed, when the page is read, then that hold is not counted as occupied.
4. Given an event without capacity, when the page renders, then no numeric count is displayed and registration is shown as open.
5. Given a pending email confirmation, when the count is computed, then it does not reduce the count.
6. Given the free-place count was shown on the event page and on the listing's featured event, when a registration then takes or gives back a place — a hold, a confirmation, a cancellation, an erasure, an offer lapsing through the maintenance job — then the next visitor to either page sees the allocator's new count: the public cache the count is read from is expired by the transition itself (`registrations/repository.ts#transitionRegistration`, §333). Verification: e2e `registration-entry.spec.ts`; integration `public-cache/revalidation.test.ts`.
7. Given a waiting-list offer whose deadline passes with nothing written, when the page is read after the deadline, then the count is not answered from before it: the cached count is keyed by the next offer expiry (`public-cache/clock.ts`), so criterion 3 holds with the cache in front of the count (§333). Verification: unit `public-cache/clock.test.ts`.
8. Given a capped internal event, when a visitor opens the event page with the register button showing N places left, then a second line reads "(capacity − N) înscriși din capacity locuri" — the same two numbers already on the page, arithmetic only, never a second query; the line is absent for an uncapped event.
9. Given an event where a TEST registration holds a place alongside REAL ones (only possible outside production), when the fill line and the free-place count are read, then both derive from the same `readPublicAvailability` figure and cannot disagree; `kind` is not a condition anywhere in the computation (AGENTS.md §12.6).
10. Beside the register button of an open, capped event, a line states the taken places out of the capacity ("12 înscriși din 50 de locuri" / "12 of 50 places taken"). It comes from the same cached read as the free places, so taken plus free equals the capacity. An uncapped event shows neither number (`tests/integration/registrations/registration-fill-render.test.ts`, `tests/e2e/registration-entry.spec.ts`).

**Verification:** integration `capacity/public-availability.test.ts`; e2e `event-page.spec.ts`

#### BR-REQ-034-02 — Capacity can never be exceeded

- **Source:** BR-BUS-034
- **Implements:** AGENTS.md §10.6
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a capped event with 1 free place, when 20 confirmations — or 20 restarts of cancelled registrations by verified participants (2026-09-19, `DECISIONS.md` §151) — are attempted concurrently, then exactly 1 succeeds and the rest are waitlisted or rejected, and the final occupied count equals capacity.
2. Given any capacity-changing transaction, when it runs, then it locks the event row or an equivalent serialization point.
3. Given an attempt to lower capacity below the current occupied count, when it is submitted, then it is rejected with a clear message.
4. Given capacity is increased, when the transaction commits, then existing waiting-list entries are allocated before any later direct registration.
5. Given an internal event with people on its waiting list, when the editor saves a higher number of places — or no number — then, in the save's own transaction and after the event row is locked, the new places are offered through the one allocator to the first in line, in order, each a 24-hour offer with its `WAITLIST_SPOT_OFFER` queued; a lifted cap offers to everyone waiting; the same number again offers nothing; a series save "for all dates" or "this and following" does the same on each date it reaches, against that date's own line and places; the save answers how many were offered and the editor's banner says so ("Salvat — locuri oferite listei de așteptare: 12."); a save that is not a raise never calls the allocator, so a lapsed offer stays for the job that notifies it; an event cancelled — in the same save or before — offers nothing, whatever its number; one date of a series too full refuses the whole save and undoes the offers already made; lowering below the places taken, an offer among them, is still refused by criterion 3, counted behind the event row's lock; and every allocation that locks the row reads the places from the locked row, never from the page that rendered before the raise (2026-09-19, `DECISIONS.md` §147).
6. The club's deadlines are one setting ("Termene") holding the email-link hours, the declaration-hold minutes, the waiting-list offer hours, the reminder hours (0 = none), the self-check-in hours, the race-week days and the series horizon days. Each has a default equal to the former constant and fixed bounds. A stored value outside its bounds, or unreadable, is read as its default (2026-09-25, `DECISIONS.md` §377).
7. A declaration hold, a waiting-list offer or an email-confirmation link created after a change takes the new length. One created before keeps the deadline it was given, however the setting moves afterwards. The email link's lapse is written on the registration, and a restart gets a lapse of its own (2026-09-25, `DECISIONS.md` §377).
8. The allocator's offer step (`fillAvailableSpots`) takes the club's deadlines as a required argument and reads none itself. Every caller reads them before its transaction and passes them in: the registration paths, the editor's capacity raise for one date or for every date of a series, and the maintenance job once per run. No read of `platform_settings` happens inside the transaction that holds the event row lock, even when the instance's memo has expired (2026-09-25, `DECISIONS.md` §377).
9. The backoffice queue panel's help sentences name the club's hold and offer as currently set, read once per request from the database, and its times stay in the event's own zone (§369). A public page reads the setting from the data cache and never wakes the database (§333) (2026-09-25, `DECISIONS.md` §377).
10. The public form sent again with a registered address and a different name creates no registration and answers with the same screen as any other submission. The address receives one `REGISTER_ANOTHER_PERSON` message instead: a single-use link, hashed at rest, valid for the club's email-link window, to the event's form with the address fixed. When the address is at the club's limit, the message has no link (2026-09-25, `DECISIONS.md` §389).
11. The club's limit on registrations per address per event (default 4, range 1-10) is read and enforced under the event's lock, which `submitRegistration` takes before it reads which runners the address holds. Five emailed links pressed at once with one slot left produce exactly one registration and four `addressAtCap` refusals, proven against a real PostgreSQL server by `tests/concurrency/family.test.ts` on every run (2026-09-25, `DECISIONS.md` §389).
12. Two members of one family pressing the public form at once produce one registration and no error, on today's schema and after the contract release (2026-09-25, `DECISIONS.md` §389).
13. The family flow's gate reads the catalogue: with `registrations_event_participant_unique` absent the flow is on, with it present the flow is dormant — proven both ways by `tests/integration/registrations/family-gate.test.ts` (2026-09-25, `DECISIONS.md` §390).

**Verification:** integration `capacity/concurrency.test.ts` against real PostgreSQL; integration `cms/capacity-raise.test.ts`

#### BR-REQ-034-03 — No queue leapfrogging

- **Source:** BR-BUS-034, BR-BUS-035
- **Implements:** AGENTS.md §10.6, §10.7
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a full event with 3 eligible waiting-list entries, when a confirmed participant cancels, then the released place is offered to the first waiting entry and not to a new registrant.
2. Given the same moment, when a new visitor submits a registration, then that person joins the end of the waiting list.
3. Given a released place and a concurrent new registration, when both transactions run, then the waiting entry wins deterministically.
4. Given a CANCELLED event, when a place is freed, an address is confirmed, the registration closes or staff try to confirm on paper, give a place or check in, then no place is allocated, no number is settled and no message is queued. The desk verbs are refused, and resend sends only the state notice. Verification: integration registrations/cancelled-event.test.ts.

**Verification:** integration `capacity/queue-priority.test.ts`

#### BR-REQ-039-01 — The public participant list is opted into, off by default, and names only

- **Source:** BR-BUS-039, BR-BUS-070
- **Implements:** AGENTS.md §10.10, §12.3, §12.6
- **Priority:** SHOULD
- **Release:** M1
- **Status:** built, and recorded in `DECISIONS.md` §32; switched off in every
  environment. The wording of the approved privacy notice that would allow the club to switch it
  on is still the club's to write, and until it exists the setting stays HIDDEN everywhere.

**Acceptance criteria**

1. Given a newly created or newly duplicated event, when its participant-list setting is read, then it is `HIDDEN`.
2. Given an event whose setting is `HIDDEN`, when its public page renders, then nothing about who is registered appears — no list, no heading and no count.
3. Given an event whose setting is `NAMES`, when its public page renders, then it lists the registered name of every `CONFIRMED`, `REAL` registration whose participant asked to be on it, ordered by confirmation time, and nothing else about any of them.
4. Given a registration that is not `CONFIRMED`, of kind `TEST`, or that did not ask to be listed, when the list renders, then that person does not appear and no count reveals them.
5. Given the registration form of an event whose list is switched on, when it renders, then it offers a plainly worded, unticked "I want to appear on the participant list" — a tick puts the name on, no tick keeps it off, and the row's `list_opt_out` is the tick's opposite; the staff entry form asks the same way (2026-09-19, `DECISIONS.md` §143; asked only where a list exists since §85).
6. Given an event whose registration mode is not `INTERNAL`, when `NAMES` is saved, then it is refused by the service and again by a database constraint.
7. Given the public queries, when they are read, then no participant email address can be returned by any of them.
8. Given a confirmed participant, when the confirmation email is sent, then it carries a second action link worded by their current choice — "Nu vreau să apar pe lista publică de participanți", or "Vreau să apar" for someone who did not tick the box — minted at send time with the `LIST_CONSENT` purpose, hashed at rest, single use; when the link is opened, then the page shows the current choice and one button, and the GET changes nothing; when the button is pressed, then `list_opt_out` flips, one audit row `registration.list_consent_changed` records from/to and never a name, the token is consumed, a fresh one is minted in the same transaction and the page re-renders under it; a used, expired or wrong-purpose token gets the generic refusal with the resend path; the same switch is offered on the participant's status page and on "Înscrierile mele"; the public list excludes a participant who opted out after confirmation and includes one who opted back in (2026-09-23, `DECISIONS.md` §302).
9. Given a registration row written without an answer to the list question, when it is stored, then `list_opt_out` defaults to true and the row is absent from the public participant list (migration 0060, §323).
10. Given an event whose participant list is NAMES, when the list renders, then a confirmed registrant who did not opt in is one row reading "Participant (nume ascuns)", with no name, club or position, grouped after every named row; the heading's total count includes it.
11. Given an event, when an Administrator sets its participant-list visibility to NAMES, then the save is refused unless an approved privacy notice is currently in force (closing the gap §32 left open until production approved one on 2026-09-22).

**Verification:** integration `privacy/public-surface.test.ts`

### 4.3 Participant identity

#### BR-REQ-031-01 — Registration without an account

- **Source:** BR-BUS-031
- **Implements:** AGENTS.md §10.3, §15.1
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given the registration form, when it renders, then it asks only for full name, email, and acknowledgment of the privacy notice, and offers no password field or login link.
2. Given a completed registration, when the participant record is inspected, then it holds no password, no provider token, and no staff role.
3. Given a submitted registration, when the response renders, then it states that an email has been sent, without revealing whether that address was already registered.
4. Given `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` both set, when the public form renders, then it carries the Cloudflare Turnstile widget, and a submission whose token Cloudflare does not confirm — or that carries none, or when Cloudflare cannot be reached — is refused with a field error the person can act on; with either key unset nothing is shown or checked, and the honeypot and the timing check stand either way; the staff form never shows it (2026-09-18, `DECISIONS.md` §97).

5. Given the registration form, when it renders, then under its title it states the event's date and time in the event's zone and its meeting point, and offers as links, each a 44 px target: the event's page, its rules when the organizer wrote any, the terms and the privacy notice — so what is being signed up for and under which terms is on the form itself (`DECISIONS.md` §102).
6. Given a registration submitted again for the same event by the same address, when the re-sent message renders, then its opening sentence says the person is already registered, with that phrase underlined in the HTML part and plain in the text part, while the screen after the form stays the same for everybody (criterion 3) (2026-09-23, `DECISIONS.md` §309).
7. Given Turnstile switched on and a too-fast refusal, when the registration form's "Trimite din nou înscrierea" is pressed before Cloudflare's token exists, then the press is held with the same waiting sentence as the main send button and is sent once the token arrives, or once the eight-second release opens; it is never dropped (2026-09-23, `DECISIONS.md` §324).
8. Criterion 3 is extended. Given the same submission posted to the public form for an address holding no registration, one registration, or the club's limit of registrations at the event, when the response is compared, then the redirect and every cookie set are byte-for-byte identical. Only the outbox differs (§389).

**Verification:** e2e `registration-submit.spec.ts`, `registration-form.spec.ts` (5); integration `participants/identity.test.ts`; unit `registrations/turnstile.test.ts`

#### BR-REQ-031-02 — Privacy-notice acknowledgment is recorded

- **Source:** BR-BUS-031, BR-BUS-053
- **Implements:** AGENTS.md §15.1, §12.6
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a submission without the acknowledgment, when it is posted, then it is rejected and no registration row is created.
2. Given a submission carrying a superseded privacy-notice version, when it is posted, then it is rejected.
3. Given an accepted submission, when the registration row is inspected, then it stores the acknowledged version and a server timestamp.
4. Given a later privacy-notice version, when it is approved, then existing registrations keep the version they acknowledged.

**Verification:** integration `registrations/privacy-acknowledgment.test.ts`

#### BR-REQ-072-01 — Public-results consent is captured at registration

- **Source:** BR-BUS-072, BR-BUS-070
- **Implements:** AGENTS.md §12.6, §15.1
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given the registration form, when it renders, then it presents a clearly worded choice about appearing in public results by name, defaulting to the value decided in `BUSINESS.md` §9.
2. Given a submission missing the choice, when it is posted, then it is rejected.
3. Given an accepted submission, when the registration row is inspected, then it stores the choice and the wording version.
4. Given the registration management page before results are published for that event, when the participant changes the choice, then the new value is stored and audited.
5. Given M1, when any public page renders, then no results and no participant names appear; the consent exists only so M2 can publish lawfully.
6. Given M1, when the registration form renders, then it does not ask the public-results consent. A box posted anyway is ignored, and new rows store false. The column stays until M2 decides.

**Verification:** integration `registrations/results-consent.test.ts`

#### BR-REQ-031-03 — Confirmation link lifetime

- **Source:** BR-BUS-031, BR-BUS-033
- **Implements:** AGENTS.md §8, §16.2
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a confirmation link, when it is opened within 48 hours, then it presents an explicit confirmation action.
2. Given a confirmation link, when it is opened after 48 hours, then it explains that the link expired and offers to start again while registration is open.
3. Given an expired pending registration, when maintenance runs, then its status becomes `EXPIRED` with `expiry_reason = EMAIL_CONFIRMATION_LAPSED`.
4. Given a registration close time earlier than the 48-hour window, when the link is created, then its expiry is capped at registration close.

**Verification:** integration `registrations/confirmation-ttl.test.ts`

#### BR-REQ-031-04 — Race entry details

- **Source:** BR-BUS-031
- **Implements:** AGENTS.md §12.6, §15.1
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given the public registration form, when it renders, then it asks for first name, last name, public display name, date of birth, sex, nationality, city, phone, emergency contact name, emergency contact phone, t-shirt size and club, and still offers no password field and no login link.
2. Given a public submission missing any of first name, last name, date of birth, sex, nationality, city, phone, emergency contact name or emergency contact phone, when it is posted, then it is rejected and no registration row is created.
3. Given an accepted public submission whose display name is blank, when the row is inspected, then the display name equals the legal name, and is never empty. Shortening it is the participant's own choice, offered in a collapsed section of the form and never applied for them.
4. Given a date of birth in the future, or earlier than 120 years before the event, when it is posted, then it is rejected.
5. Given a registration an organizer enters for somebody who asked in person (BR-REQ-037-05), when a detail is unknown, then it may be left blank and the registration is still accepted — an organizer records what the person said on the telephone, and refusing the row would lose the registration entirely.
6. Given any stored registration, when the legal name is read, then it is the pair of name fields, and the declaration is signed against that name and not against the display name.

7. Given the public form, when it renders, then it offers the language of the emails and the declaration — Romanian or English, the page's language preselected — and the registration is kept in that language: the declaration is signed in it and it comes first in every message (2026-09-18, `DECISIONS.md` §97).

8. Given the public form, when it renders, then a folded, optional "Socials" section offers a Strava profile link and an Instagram username; a link is accepted only on Strava's own hosts, a username is stored without its `@`, both may be empty; they are shown to Administrators on the registration's page and in the export, never published, and the privacy notice names them (`DECISIONS.md` §106).

9. Given a birth date under eighteen years before today, when the public form is submitted without a parent or legal guardian's name, then it is refused naming `guardianName`; given the name, then it is kept on the registration, shown at the desk and on the registration's page and in the export, and the declaration's `{{declarant}}` reads "<guardian> (parent/legal guardian of the minor <participant>)" in the text's language — the signer's own identity document beside it — while an adult's entry in the field is dropped (`DECISIONS.md` §108).
10. Given a submission refused by the anti-bot check, when the form renders again, then it says so in its own words — naming the check, not the data — both in the summary at the top and beside the widget; the check itself is unchanged and an unconfirmed token is still refused in every environment (2026-09-20, `DECISIONS.md` §176).
11. Given a birth date by which the participant is under fourteen on the event's start date in the event's own time zone, when a registration is submitted by any door (the public form, a staff entry or the desk's walk-in, a TEST row, or a restart of a cancelled registration), then it is refused naming `birthDate`, nothing is written and the submission throttle is not spent. The public form's date picker carries the youngest allowed birth date as its `max` and says the rule. The refusal says the rule in words, on the public form with every answer kept and in the backoffice with every box kept. A staff entry that gives no birth date is not counted (criterion 5), and the guardian rule of criterion 9 is unchanged (2026-09-23, `DECISIONS.md` §321). Verification: unit and integration `registrations/minimum-age.test.ts`; e2e `registration-form.spec.ts`.
12. Given a birth date under eighteen years before today, when the public form is submitted, then no Strava link or Instagram username is stored, whatever was posted. On the form, once the birth date says under eighteen, the socials section is hidden and its controls disabled, so a value typed before the date neither blocks the browser's submission nor is posted. A refusal naming either field shows the section whatever the date (§323).
13. Given the public registration form or the staff entry form, when it renders, then the phone prefix select's order (Romania first, then by country name in the page's language) is computed on the server and only drawn in the browser, so the page hydrates without a mismatch in either language at 320px and on desktop, and nothing typed before hydration finishes is lost (2026-09-23, `DECISIONS.md` §324).
14. Given an event whose minimum age is N (`events.min_age`, 0 to 99, 14 by default and for every event created before the column), when a registration is submitted by any door (the public form, a staff entry or the desk's walk-in, a TEST row, or a restart), then a birth date under N on the event's day in its own time zone is refused as in criterion 11, and N = 0 refuses nobody for age. The public picker's `max` is the last birth date that reaches N on that day, or today when N = 0. The line before the first field reads "Participanți de la {N}; sub 18 ani, înscrierea o face un părinte." for 1 to 17, "Participanți de la {N}." for 18 or more, and only "Sub 18 ani, înscrierea o face un părinte." for 0. The birth date's help, the public refusal and the staff refusal name N. The staff form shows "N+" beside each event's name. The number is written with Romanian's "de" ("20 de ani", "101 ani") by `yearsPhrase` (2026-09-23, `DECISIONS.md` §329, amending §321). Verification: unit and integration `registrations/minimum-age.test.ts`; e2e `registration-form.spec.ts`.
15. Nationality and city are optional, offered under «De unde ești — opțional» with a sentence saying why they are asked, and the country field starts unanswered. A blank value is stored as null. The sex and emergency-contact fields explain why they are asked (§322).
16. Criterion 16: the telephone field is rendered as one box — a country flag and caret at its start, chosen through a native select laid invisibly over them, with the national number after it grouped into a live mask as it is typed. The mask reads a typed value exactly the way the server's composePhone parses it (a leading +, a 00 international prefix, a trunk zero dropped except where the country keeps it) and never reformats a value composePhone would refuse into one that looks valid. Typing is capped, digit by digit, to the longest national number that leaves the stored E.164 number at fifteen digits for the chosen country. A country selected by the visitor, restored by the browser on reload, or already present before the page has hydrated is reflected consistently in the flag, the mask and the live validity verdict — the three never disagree with what the select itself would post.

**Verification:** integration `registrations/entry-details.test.ts`, `registrations/minors.test.ts` (9); unit `registrations/socials.test.ts` (8); e2e `registration-submit.spec.ts`; unit and integration `registrations/minimum-age.test.ts` (11); e2e `registration-form.spec.ts` (11)

#### BR-REQ-031-05 — Health information is consented separately and never published

- **Source:** BR-BUS-031, BR-BUS-053
- **Implements:** AGENTS.md §12.6, §14.5, §15.10
- **Priority:** MUST
- **Release:** M1

Health data is a special category under GDPR Article 9. It is collected because a race organizer
may need it on the day, and it is therefore kept apart from every other field: its own consent,
its own absence from the export, and no public surface at all.

**Acceptance criteria**

1. Given the registration form, when it renders, then the health field is optional and carries its own explicit consent checkbox, worded separately from the privacy-notice acknowledgment.
2. Given a submission carrying health text without that consent ticked, when it is posted, then it is rejected and no registration row is created.
3. Given an accepted submission with health text, when the row is inspected, then it stores the consent version and a server timestamp alongside the text.
4. Given the registrations CSV export, when it is produced, then the health column is absent.
5. Given any public page, including the participant list and any event page, when it renders, then no health text appears in the markup under any condition.
6. Given a participant who withdraws the consent, when the registration is inspected afterwards, then the health text is cleared rather than merely flagged.
7. Given a participant's manage link or their "My registrations" link, when they press "Delete my health note" (POST), then the note, its consent version and its consent timestamp are cleared (nulled, not flagged). The link is not spent, and status, place, number and messages are unchanged. One audit row names the fields and the door, never the text. A second press writes nothing, and two concurrent presses write one row.
8. Given an Organizer, Administrator or Superadministrator, when they open a registration's emergency section or an event's emergency sheet, then the phone, emergency contact and health note are shown and each opening is audited without values. Every other role is refused on the server. The desk and every export never carry them.
9. Given an Administrator or Superadministrator, when they withdraw a participant's optional consents on the registration's page — the ticked groups among the health note, the socials and the results name — with a reason, then those fields are cleared; status, place and number are untouched and no message is sent; the audit row records the field names and never their values; any other role is refused FORBIDDEN, and a request naming no group VALIDATION_ERROR (`DECISIONS.md` §322).

**Verification:** integration `registrations/health-consent.test.ts`; privacy `public-surface.test.ts`

#### BR-REQ-031-06 — The club's own people can say so, and it grants them nothing

- **Source:** BR-BUS-031
- **Implements:** AGENTS.md §12.6, §15.1, §15.10
- **Priority:** SHOULD
- **Release:** M1

The club's members and its organizers enter its races like anybody else, and the club wants to
know which entries are theirs. The answer is a self-declaration, not a lookup: `staff_users`
holds only the handful of people with backoffice access, so matching against it would answer
"no" for most of the members the question exists to find (`DECISIONS.md` §48).

**Acceptance criteria**

1. Given the public registration form, when it renders, then it offers an optional "I am a Brașov Runners team member" choice, and the disclosure it sits in names the club in its summary.
2. Given a submission that does not answer it, when the row is inspected, then the stored value is `false` and never null, and the submission is accepted.
3. Given the value, when any capacity, hold, waiting-list or queue-ordering path is inspected, then it appears in no condition in any of them — a declared member and a stranger reaching a full event get the same answer.
4. Given any backoffice screen that shows the value, when it renders, then it is worded as a declaration and never as a verified fact, and the registrations list can be narrowed to the people who declared it.
5. Given the CSV export, when it is produced, then the column reads "Yes" for a declared member and is empty for everybody else, never "No" — an unanswered question and a negative answer are the same stored value and must not be printed as the same statement.
6. Given a registration an organizer enters for somebody who telephoned, when the form renders, then the same choice is offered.
7. criterion (new): the member tick's label and its section's summary read the club's name from `CLUB_NAME` in both languages, the same string the registration records (§215, §369).

**Verification:** integration `registrations/club-member.test.ts`; unit `registrations/csv.test.ts`; e2e `registration-form.spec.ts`

#### BR-REQ-036-03 — A participant can see where they are

- **Source:** BR-BUS-031, BR-BUS-035, BR-BUS-036
- **Implements:** AGENTS.md §10.5, §12.8, §16.3
- **Priority:** MUST
- **Release:** M1

A registration moves through six states and, until this exists, the only evidence a participant
has of any of them is whichever email happened to arrive. Participants have no accounts
(BR-BUS-031), so the page is reached by the same single-use-minted, hashed action token every
other participant link uses — never by a password.

**Acceptance criteria**

1. Given any registration email, when it renders, then it carries a link to that registration's status page.
2. Given a valid status link, when it is opened, then the page names the event, the current state in the participant's own locale, and the one action that is theirs to take next — or states plainly that there is nothing to do.
3. Given a waitlisted registration, when the status page renders, then it states the position in the queue.
4. Given a status page, when it renders, then it shows no other participant's name, address, position or count.
5. Given an invalid, expired or already-used token, when the page is opened, then it renders the same generic message as every other participant token surface, revealing nothing about whether the registration exists.
6. Given the status page, when it is requested by any method, then it mutates nothing (AGENTS.md §12.8).

**Verification:** integration `registrations/status-page.test.ts`; e2e `registration-status.spec.ts`

#### BR-REQ-036-04 — One link, all my registrations

- **Source:** BR-BUS-031, BR-BUS-036
- **Implements:** AGENTS.md §10.3, §12.8, §15.9 (steps 1–2), §16.3
- **Priority:** SHOULD
- **Release:** M1 (2026-09-18, `DECISIONS.md` §77)

A runner with two entries and no account has two emails to find. `/inscrieri/ale-mele` takes an
address and sends one link, and that link lists every active registration of that address. It
is the first use of the `MANAGE_PROFILE` token purpose — scoped to a participant, never to a
registration — and it lists registrations and never changes an address.

**Acceptance criteria**

1. Given the form, when any address is submitted — known, unknown, malformed or throttled — then the response is the same sentence, the request is counted before anything is looked up, and a `PROFILE_MANAGE_LINK` message is queued only when a participant with that identity exists; the message carries no registration.
2. Given the message, when it is rendered, then it mints a `MANAGE_PROFILE` token scoped to the participant alone (`registration_id` null), hashed at rest, single use, fourteen days, and links to `/inscrieri/ale-mele/<token>`.
3. Given a valid link, when it is opened, then the page lists every *active* registration of that participant and nobody else's — the event (linked), the state in the reader's locale, the desk code and its QR once confirmed, "I am here" from the day before the start, and cancel — and nothing for cancelled or expired ones. A GET mutates nothing.
4. Given "I am here" for one listed registration, when it is pressed, then that registration is checked in through the same service the desk uses, the registration must be the token holder's own (a registration id is not a secret), and the link stays valid.
5. Given cancel for one listed registration, when it is pressed, then the registration is unregistered through the allocator (the place released, source `PARTICIPANT`), it must be the token holder's own, and the token is consumed — a second cancellation needs a fresh link, which the page says. A refused attempt (not theirs, event started) leaves the token live.
6. Given an invalid, expired, used or registration-scoped token, when the page is opened, then it renders the same generic sentence as every other participant token surface.
7. Given the public footer, when it renders, then it carries "Înscrierile mele" so the form is findable without an email.
8. Given a participant's "Înscrierile mele" link, when a registration of theirs is over (checked in, cancelled or expired) but still holds a health note or socials, then it is listed with the buttons that delete each; once nothing optional is left it drops off the list (2026-09-23, `DECISIONS.md` §324).
9. New criterion. Given an address with several registrations at events, when "Înscrierile mele" is opened from its link, then every active registration is listed with its runner's name. Asking for the link again for an event queues one message per person on the address who still owes a step (§389).

**Verification:** integration `registrations/my-registrations.test.ts`; integration `cms/boundary.test.ts` (the routes)

#### BR-REQ-039-02 — The public list publishes the display name

- **Source:** BR-BUS-039
- **Implements:** AGENTS.md §10.10, §12.6
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given an event whose participant list is `NAMES`, when the list renders, then each row is the registration's display name and nothing else.
2. Given a registration whose display name differs from its legal name, when the list renders, then the legal name appears nowhere in the markup.
3. Given the rules of BR-REQ-039-01, when the list renders, then they are unchanged: confirmed and real registrations only, opt-outs excluded, ordered by confirmation.
4. Given a registration that named a club, when the list renders, then the club appears beside the display name — the only thing beside it; the list is a folded section, closed, with the count in its summary; and the privacy notice that allows the list names the club as published (2026-09-18, `DECISIONS.md` §85). The opt-out box is asked only on an event whose list is switched on.

**Verification:** privacy `public-surface.test.ts`

#### BR-REQ-032-01 — Whitespace and case are ignored

- **Source:** BR-BUS-032
- **Implements:** AGENTS.md §10.4
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given `" Ana.Pop@Example.RO "`, when it is canonicalized, then the canonical value is `ana.pop@example.ro`.
2. Given the same input, when the participant is stored, then `delivery_email` preserves the submitted spelling minus surrounding whitespace.
3. Given two submissions differing only in case or surrounding whitespace for one event, when both are posted, then the second is treated as the same participant and the same registration.
4. The participant is still the canonical email address. On an address that already holds a registration at an event, a second runner can be registered under the same participant. Each registration is told apart by the runner's name folded with `foldName`, stored as `registrations.name_key`, and unique per (event, participant, name_key) (2026-09-25, `DECISIONS.md` §389).

**Verification:** unit `participants/canonicalize.test.ts`

#### BR-REQ-032-02 — Gmail dots and tags

- **Source:** BR-BUS-032
- **Implements:** AGENTS.md §10.4
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given `a.n.a@gmail.com` and `ana@gmail.com`, when both are canonicalized, then they produce **different** canonical values (version 2, 2026-09-18, `DECISIONS.md` §74; version 1 collapsed them, and migration `0030` re-canonicalized every stored row).
2. Given `ana+club@gmail.com` and `ana@gmail.com`, when both are canonicalized, then they produce the same canonical value.
3. Given `ana@googlemail.com` and `ana@gmail.com`, when both are canonicalized, then they produce the same canonical value, while each participant's `normalized_email` keeps its submitted domain.
4. Given `a.n.a@example.ro` and `ana@example.ro`, when both are canonicalized, then they produce different canonical values.
5. Given `ana+club@example.ro`, when it is canonicalized, then the tag is preserved.

**Verification:** unit `participants/canonicalize.test.ts`

#### BR-REQ-032-03 — One registration per participant per event

- **Source:** BR-BUS-032
- **Implements:** AGENTS.md §10.5, §12.6
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given an active registration for an event, when the same canonical identity submits again, then no second registration row is created and the participant is guided to their current state.
2. Given the database, when a duplicate `(event_id, participant_id)` insert is attempted directly, then a unique constraint rejects it.
3. Given a participant registered for one event, when they register for a different event, then it succeeds.
4. Given a participant registered for one distance of a race, when they register for another distance of the same race, then it is refused (BR-REQ-012-01).
5. Given the one-per-address constraint has been dropped and an active registration on an address, when the public form is submitted again with the same address and a different runner's name, then no registration is created, the screen is the generic success, and the address receives one REGISTER_ANOTHER_PERSON email with a single-use link (or, at the limit, no link).
6. Given the database, when a second row with the same (event_id, participant_id, name_key) is inserted directly, then the unique index registrations_event_participant_name_unique rejects it.
7. (Amends criterion 2.) A duplicate insert for the same event, participant and runner's name key is rejected by the database (`registrations_event_participant_name_unique`); two runners with different name keys on one address are allowed, up to the club's limit per address. The old (event, participant) unique index is gone since migration `0073` (2026-09-25, `DECISIONS.md` §390).

**Verification:** integration `registrations/uniqueness.test.ts`

#### BR-REQ-032-04 — Canonicalization is versioned and immutable

- **Source:** BR-BUS-032
- **Implements:** AGENTS.md §10.3, §10.4
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a stored participant, when it is inspected, then it records the canonicalization version used.
2. Given a verified participant, when an administrator attempts to change the email or merge two participants, then no interface offers it and any direct attempt is rejected.
3. Given an unverified typo, when an administrator resolves it, then the path is to cancel the pending registration and start again with the correct address.

**Verification:** integration `participants/immutability.test.ts`

### 4.4 Registration and declaration

#### BR-REQ-033-01 — Confirmation, hold, declaration, confirmed

- **Source:** BR-BUS-033
- **Implements:** AGENTS.md §10.5, §15.1–§15.3
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a submitted registration for an event with a free place, when the participant confirms their email, then a place is held for 30 minutes and the status becomes `PENDING_DECLARATION`.
2. Given the hold, when the participant accepts the declaration and types their full name, then the status becomes `CONFIRMED` and a confirmation email containing a management link is queued.
3. Given the hold, when 30 minutes pass without acceptance and the waiting list wants the place — or the event has started or is `COMPLETED` — then the status becomes `EXPIRED` with `expiry_reason = DECLARATION_HOLD_LAPSED` and the place is released to the queue; exactly `waiting − free` holds are released, the earliest deadline first, so one person joining the list takes back one place and no more; and given a lapsed hold the queue does not want, then the status stays `PENDING_DECLARATION`, the place stays occupied in the count, the maintenance job does not select the event, and the participant may still sign online at any time before the start (the email's link lives until the start, read from the event's own row) or on paper at the desk — including after the start, where `confirmByStaff` re-allocates the hold the start expired rather than refusing it. A registration that joins the waiting list behind such a hold is offered the place in the same transaction; two days before the start the declaration email goes once more to whoever still owes a signature; and a signature against a `CANCELLED` event is refused (`DECISIONS.md` §160). Given a `CANCELLED` event, then no hold or offer is expired, no waiting-list entry is closed and nobody is offered a place — by the allocator, the maintenance job or the desk — and every read still counts an offer past its deadline as lapsed (`DECISIONS.md` §331, amending §160).
4. Given a hold that would extend past registration close or event start, when it is created, then it is capped at the earlier of the two.
5. Given a registration that has not reached `CONFIRMED`, when the participant list is inspected, then that person is not counted as attending.

6. Given an event further away than its participation window (`confirmation_opens_days_before`, default 7; deadline `confirmation_deadline_days_before`, default 2 — both per event, zero switches the window off), when a registration clears email verification, then its hold lasts until the deadline rather than 30 minutes and is not capped by registration close; the declaration email says the deadline and that the signature is the confirmation of participation; when the window opens the maintenance job queues that email once more per waiting registration; a signature at any point confirms; an unsigned hold lapses at the deadline through criterion 3, which is to say only when somebody is waiting for the place (§160) — the email says the place is held, that the registration is complete only with the signed declaration, online or on paper at the desk, and that the place is held until the deadline if a waiting list forms. Inside the window, and on an event without one, criterion 3's thirty minutes stand. The wizard's third step says which applies (`DECISIONS.md` §104).
7. The email link's lifetime, the hold for signing the declaration and the waiting-list offer's lifetime come from the club's "Termene" setting at the moment each is given. A later change of the setting never moves a deadline already given, and the email link's lapse is stored on the registration (`email_link_expires_at`) at submission and at a restart (2026-09-25, `DECISIONS.md` §377).
8. Unset, the setting reads exactly as the constants it replaced: 48 hours, 30 minutes, 24 hours, a 48-hour reminder, check-in 24 hours before, race week 7 days, a 56-day series horizon. A save outside a field's bounds, blank, fractional or naming an unknown key is refused, names the box and saves nothing (2026-09-25, `DECISIONS.md` §377).

**Verification:** integration `registrations/lifecycle.test.ts`, `registrations/confirmation-window.test.ts` (6), `registrations/maintenance.test.ts` (3), `registrations/race-day.test.ts` (3), `notifications/event-mail.test.ts` (3), `notifications/render.test.ts` (3); unit `registrations/hold-deadlines.test.ts`; e2e `registration-happy-path.spec.ts`

#### BR-REQ-033-02 — Declaration acceptance evidence

- **Source:** BR-BUS-033, BR-BUS-053
- **Implements:** AGENTS.md §10.8, §12.7
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a declaration page, when it renders, then it shows the exact approved version bound to that event in the participant's locale.
2. Given acceptance, when it is stored, then it records the legal document version, the content hash, the locale, the typed name, and a server timestamp.
3. Given acceptance, when it is stored, then no raw IP address or user agent is stored by default.
4. Given an acceptance form submitted without the explicit checkbox or without a typed name, when it is posted, then it is rejected.
5. Given any surface presenting the declaration, when it renders, then it does not describe the acceptance as a qualified electronic signature.
6. Given a declaration page that rendered one version, when a newer version is approved before the form is posted, then the signature is refused, nothing is recorded, the action link is not spent, and the participant is shown the current text to read and sign again — so the stored acceptance always names the version the participant read (`DECISIONS.md` §57).
7. Given a declaration text with merge fields (`{{participant}}`, `{{idDocument}}`, `{{event}}`, `{{eventDate}}`, `{{eventLocation}}`, `{{signedAt}}`), when the page renders for one registration, then the fields are filled from the registration and the event and an unfilled one shows as a dotted blank; what is signed — id and hash — is the template, and the fill-ins are recorded beside it (2026-09-18, `DECISIONS.md` §95).
8. Given a declaration text that names `{{idDocument}}`, when the form is posted without an identity document, or with one that is not a series and a number (4–30 letters, digits, spaces, dots, dashes), then it is refused; when posted with one, then it is stored on the acceptance as typed, shown on the desk row and in the export, and printed into the declaration. Never a scan or an image. A text without the field asks for none and stores null.
9. Given a signature — by link or on paper — when it is recorded, then the participant receives the signed declaration as an attached PDF (the merged text, the typed name in the signature face, the instant, the method, the version and the hash) **on the confirmation** — since 2026-09-19 no `DECLARATION_SIGNED` message of its own is queued (`DECISIONS.md` §126); the type stays for a resend — and a link to the same PDF from the manage token; the participant's manage page offers it.
10. Given an Administrator, when they request an event's declarations, then every signed one of its real registrations is one PDF, one per page, oldest first, and one registration's is its own PDF; any staff role may print the event's blank form on the current approved text. All three are renderings of the stored rows, never files kept elsewhere; a registration and its acceptance are deleted three years after the event's start by the retention sweep (`jobs/retention.ts`).

11. Given a club mailbox named for the declarations — on `/admin/emails` since 2026-09-21, otherwise `DECLARATIONS_ARCHIVE_TO` — when a real registration's declaration is signed, by link or on paper, then a `DECLARATION_ARCHIVE` message is queued to that address with the signed PDF attached, its identity document masked (criterion 16), a subject naming the participant and the event, and no action link or token; with neither named, or for a test registration, no such message exists (`DECISIONS.md` §99, §244, `DECISIONS.md` §320).

12. Given Cc or Bcc addresses on `/admin/emails`, when that copy is queued, then the addresses ride in the row's payload — so a list edited afterwards cannot redirect a message already queued — and the message carries them as envelope recipients; outside production each copy faces `EMAIL_ALLOWLIST` on its own and an unauthorized one is dropped while the rest of the message goes; a mailbox named twice receives one copy; a Cc list with no "to" sends nothing (`DECISIONS.md` §244).

13. Given addresses under "anunță-ne când cineva confirmă" on `/admin/emails`, when a real registration is confirmed — by signature or at the desk — then one `CLUB_CONFIRMATION_NOTICE` is queued per address (`registration:<id>:club-confirmed:<address>:<time>`), naming the participant, the event and the race number, with no token, no QR and no attachment; none is queued for a test registration or when no address is named. The allowance forecast counts six messages per completed registration because of it (`DECISIONS.md` §245).
14. Given addresses under „Copie ascunsă la emailurile către participanți” on `/admin/emails`, when a message of a participant type (every type but `DECLARATION_ARCHIVE`, `CLUB_CONFIRMATION_NOTICE`, `STAFF_INVITATION` and `REGISTRATION_OPENED`) is queued for a REAL registration, then the participant's own row carries no club address. In the same transaction, one club-copy row per address is queued for the same registration and type: the participant's own address is left out, each address once, compared without regard to case. Each copy has no participant, `clubCopy: true` in its payload and the key `<participant key>:club-copy:<address>`, so a list edited afterwards cannot redirect a message already queued. When rendered, a club copy mints no token and has no action button, no link holding a token (manage, list switch, declaration PDF), no check-in code or QR and no attachment. Each language's half of its subject starts with "[Copie club] " / "[Club copy] ", and its body opens with the sentence that the personal links, the QR code and the attachments were removed. No copy is queued for a TEST registration's message or for a message with no registration. A participant message queued with an older Bcc payload is sent to the participant alone. A bounced club copy does not mark the registration's email as rejected, and the registration's email history labels each copy. The allowance forecast counts one more message per address for each of the five participant messages (2026-09-22, 2026-09-23, `DECISIONS.md` §293, §320).
15. Given a declaration being signed by link, with JavaScript or without, when the typed signature is not the declarant's name, then it is refused. The declarant's name is the registered name, or for a minor the parent or guardian name given at registration (§108). The comparison ignores case, runs of whitespace, diacritics, the typographic shape of an apostrophe or hyphen, and invisible characters; every letter, digit, hyphen and apostrophe and the order of the names must match. The refusal comes before any hold expiry or allocation runs: nothing is recorded, the action link is not spent, and the same link then signs with the right name. What is recorded is what was typed. The box shows the expected name in bold as its hint and again, in bold, in its red state, and the browser refuses the press with the same sentence in plain text. A refusal by the server returns to a focusable summary above the form (`?invalid=name`, with no name in the address). The summary says that nothing was recorded and the link works, links to the box, and says how a wrong registered name is put right: the club corrects an adult's; a minor's registration is cancelled and made again. It does not repeat the mismatch sentence shown under the box. The tick, the document type, the series and number and the signature come back from a sealed ten-minute cookie that never holds the link's secret (2026-09-23, `DECISIONS.md` §314).
16. Given a signed declaration, when its PDF is attached to the club's archive copy (`DECLARATION_ARCHIVE`, with its Cc and Bcc), then the identity document is masked everywhere the page prints it, in the text's `{{idDocument}}` and on the signature line. The mask is the first two and the last two non-space characters around "••••" ("BV 123456" becomes "BV ••••56"), and just "••••" when there are fewer than eight non-space characters. The archive email says the copy is without the series and number, and that the whole document is in the event's declarations PDF in the backoffice until seven days after the event. The participant's own copies (the confirmation, the declaration's own message, the PDF from their manage link), the backoffice's single-registration PDF and the event's bundle print it whole (2026-09-23, `DECISIONS.md` §320).
17. Given a staff member downloading an event's signed declarations as one PDF, or one registration's signed declaration, when the file is returned, then an audit row records it — event.declarations_downloaded with the event and the count, or registration.declaration_downloaded on that registration — naming the staff member and never a participant's name or identity document. The registration's timeline shows the download with its own label in both languages (2026-09-23, `DECISIONS.md` §324).
18. Given a minor's registration (a parent or guardian named at registration), when the declaration is signed by link, then it is signed at one press by both: the minor's typed name must match the registered name and the parent's must match the guardian name, each by the rules of criterion 15. Each box is refused on its own field, before any hold expiry or allocation, so nothing is recorded and the link is not spent. The acceptance keeps the parent's name in `typed_name` and the minor's in `minor_typed_name`. An adult signs once, as before.
19. Given a declaration text naming any identity-document field (`{{idDocument}}`, `{{participantIdDocument}}`, `{{guardianIdDocument}}`), when a minor's declaration is posted, then both the minor's and the parent's documents are required, each by the rules of criterion 8. A missing or malformed one returns to the page naming that box, with what was typed kept. Both are stored (`minor_id_document`, `id_document`), shown on the desk row and the registration page, exported, printed on the signed PDF, masked on the club's archive copy (criterion 16), and cleared seven days after the event.
20. Given a minor's registration confirmed on paper at the desk, when it is recorded, then the guardian is recorded as `typed_name` and the minor as `minor_typed_name`, and the confirmation says before the press that the paper must carry both signatures. The event's blank form has a minor variant with both signature and document lines.
21. Given a declaration text, when it is merged, then `{{participantIdDocument}}` is the participant's own identity document (the adult's, or the minor's) and `{{guardianIdDocument}}` the parent's or guardian's (an em dash for an adult, like `{{guardian}}`); `{{idDocument}}` stays the declarant's (the adult's own, the parent's for a minor), so every text approved before reads as it did; a text naming any of the three asks for the identity documents at signing (2026-09-23, `DECISIONS.md` §330).
22. Given a minor's registration (a parent or guardian named) and a declaration in effect in the registration's language that names `{{participantIdDocument}}`, when the declaration is signed by link, then it is signed at one press by the minor, with the name they were registered under and their own identity document, and by the parent or guardian, with the guardian name and their own document; each name is checked against its own box as in criterion 15, and each wrong or missing piece is refused on its own field (`minorTypedName`, `typedName`, `minorIdDocument`, `idDocument`) before any hold expiry or allocation, with nothing recorded and the link unspent; the acceptance stores the minor's in `minor_typed_name` and `minor_id_document`, while `typed_name` and `id_document` stay the declarant's (2026-09-23, `DECISIONS.md` §330).
23. Given a minor's registration and a declaration in effect in the registration's language that does not name `{{participantIdDocument}}` (every text approved before 2026-09-23, production's among them), when the page renders and the form is posted, then the declaration is signed as under §108 and §314: one signature, the guardian name, and one document, the declarant's; the page shows no minor's box, the server requires none, and nothing is stored in `minor_typed_name` or `minor_id_document` even when a post carries them (2026-09-23, `DECISIONS.md` §330).
24. Given a declaration being signed, when the server decides who signs and which documents are asked, then it reads the current approved version in the registration's language after binding it to the id and hash the page posted (a mismatch is the refusal of criterion 6, before any name is compared), and never a flag the page posts; the page asks the same function of the same translation, so its boxes are the boxes the server asks for (2026-09-23, `DECISIONS.md` §330).
25. Given a minor's acceptance carrying the minor's signature, when its PDF is rendered, then it prints both signatures and both documents under one date, the minor's first, and the club's archive copy masks both documents as in criterion 16; an acceptance without the minor's signature (an adult's, or a minor's signed under a text that does not ask the minor) prints the one signature block it always did (2026-09-23, `DECISIONS.md` §330).
26. Given the event's blank paper form requested for a minor (`?for=minor`), when the declaration in effect in that language names `{{participantIdDocument}}`, then it prints two signature lines and two identity-document lines, the minor's and the parent's; otherwise it prints the one-signature form, and the event page offers the minor's form only in the first case (2026-09-23, `DECISIONS.md` §330).
27. Given a minor's acceptance, when the desk row, the registration's page or the export shows its identity documents, then each is labelled as the minor's or the parent's or guardian's; a minor's acceptance recorded without the minor's document carries the parent's alone, never presented as the child's; retention clears both documents seven days after the event and keeps both names for the three years (2026-09-23, `DECISIONS.md` §330).
28. Given `/admin/emails`, when the card "Emailurile trimise participanților" is opened, then it holds one closed card per message type, EVENT_UPDATE_NOTICE and EVENT_CANCELLED included, each with its short "when" in the summary and its full "when", subject and preview inside. The three types nothing queues are listed last and say "nu se mai trimite" on the closed card.
29. Given the platform's declaration template, when it is read in either language, then it carries, as bullets in the text's own style, the informed acceptance of the terrain and falls, of wild animals and dogs (with the basic rules: keep a distance, never feed or approach, never run from a bear, back away calmly, tell the organiser, call 112) and of the weather and darkness, and the runner's own obligations: equipment suited to the terrain and the weather, a charged phone, a working headlamp after dark and reflective elements on roads, the start refused without the mandatory equipment the event's rules announce, their own pace and limits, the marked course, telling the organiser on dropping out, protected areas and personal belongings. The bullets are closed by "Îmi asum responsabilitatea pentru propria siguranță, pentru echipamentul meu și pentru deciziile pe care le iau pe traseu." No new bullet promises the organiser immunity, the liability paragraph keeps "în limitele permise de lege" / "to the extent the law allows", and the merge fields are exactly those of §330 (§357). Verification: unit `legal-documents/declaration-risks.test.ts`.
30. Given a declaration signed under the platform's text, by an adult or by a minor with a parent, when its merged text or PDF is rendered, then every merge field reads filled and none is a dotted blank. The event's blank form fills the event, its date and its place and leaves the person's own fields dotted. The signed and blank PDFs, the minor's variant included, flow onto a second page with every line between the top margin and the footer (§357). Verification: integration `registrations/signed-declaration.test.ts`.
31. Every email and page that names a deadline takes its words from the setting ("48 de ore", "30 de minute", "o zi"), in the reader's language. No former constant name remains in `src/`, and no message catalogue types a deadline a setting could change (2026-09-25, `DECISIONS.md` §377).
32. The emails' field legend (§373) lists `{confirmationHours}`, `{holdMinutes}`, `{offerHours}` and `{reminderHours}` with a row each in both languages. Each row says that the unit comes with the value, and `{reminderHours}` is marked as possibly missing. Every one of the four has a non-empty sample value in both languages, taken from the default deadlines through the same words helper the send uses. On `/admin/emails` each example is the deadline in force, the same words the preview above it prints (2026-09-25, `DECISIONS.md` §377).

**Verification:** integration `registrations/lifecycle.test.ts` (criterion 6), `registrations/signed-declaration.test.ts` (7–10), `registrations/declaration-archive.test.ts` (11), `notifications/club-notices.test.ts` (11–13), `jobs/retention.test.ts`; unit `legal-documents/merge-fields.test.ts`, `notifications/club-notices.test.ts`, `notifications/delivery.test.ts` (12); e2e `registration-form.spec.ts`; integration `notifications/club-copy.test.ts` (14, 16); unit `notifications/club-copy.test.ts` (14), `registrations/mask-id-document.test.ts` (16)

#### BR-REQ-033-03 — Staff cannot sign for a participant

- **Source:** BR-BUS-033, BR-BUS-037
- **Implements:** AGENTS.md §10.8, §15.8
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given the backoffice, when a registration in `PENDING_DECLARATION` is opened, then no action marks the declaration as signed.
2. Given an administrator, when they attempt to move a registration directly to `CONFIRMED` through the API, then it is rejected.
3. Given a restart of a cancelled registration, when it completes, then the registration re-enters the flow before declaration acceptance.

**Verification:** integration `backoffice/declaration-guard.test.ts`

#### BR-REQ-033-04 — Restart matches verification state

- **Source:** BR-BUS-033, BR-BUS-037
- **Implements:** AGENTS.md §10.5, §15.1
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a cancelled registration whose participant is not verified, when it is restarted while registration is open, then the status becomes `PENDING_EMAIL_CONFIRMATION` and a verification email is queued.
2. Given an expired registration whose participant is verified, when it is restarted and a place is free, then the status becomes `PENDING_DECLARATION` without a new verification email.
3. Given the same case when the event is full, then the status becomes `WAITLISTED` at the end of the queue.
4. Given any restart, when it runs, then it passes through the same capacity transaction and cannot leapfrog an existing waiting-list entry.
5. Given any restart, when it completes, then the status is never `CONFIRMED`.

**Verification:** integration `registrations/restart.test.ts`

### 4.5 Waiting list and promotion

#### BR-REQ-035-01 — Joining the waiting list

- **Source:** BR-BUS-035
- **Implements:** AGENTS.md §10.7
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a full capped internal event with registration open, when a visitor opens it, then the waiting list is offered instead of direct registration.
2. Given a waiting-list submission, when the email is confirmed, then the status becomes `WAITLISTED` and no place is consumed.
3. Given an entry on the waiting list, when it is created, then no declaration is requested yet.
4. Given a closed or started event, when a waiting-list join is attempted, then it is rejected.
5. Given a capped event whose waiting list has a limit, and a line (WAITLISTED plus offers still open) already at it, when a registration would join the line, then it is refused at every door (the public form, the email confirmation, a restart, a staff entry, the desk, a batch of test rows) and the refusal writes nothing, the token spend included.
6. Given an event whose waiting-list limit is 0, when its places are gone, then registration closes as full and neither the event page nor the form mentions a waiting list.
7. Given a limit lowered below the current line, when it is saved, then nobody already waiting is removed, and the next registration is refused until the line is shorter than the limit.
8. Given a waiting list with no room and a declaration hold past its deadline, when a newcomer registers, then exactly one lapsed hold (the oldest deadline first) is released and the newcomer gets the place directly, and the event page and the form count that place as free before they register.
9. Given two registrations racing for the last slot in a limited line, when both are confirmed at once, then exactly one joins it and the other is refused.

**Verification:** integration `waitlist/join.test.ts`; e2e `waitlist.spec.ts`

#### BR-REQ-035-02 — FIFO offers

- **Source:** BR-BUS-035
- **Implements:** AGENTS.md §10.7
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given three waiting entries, when a place is released, then the entry with the earliest `waitlisted_at` is offered, ties broken by stable ID.
2. Given an offer, when it is created, then the status becomes `WAITLIST_OFFERED`, a hold with a 24-hour deadline is set, a scoped token is created, and an offer email is queued.
3. Given an offer, when the deadline would fall after registration close or event start, then it is capped at the earlier of the two.
4. Given concurrent promotion attempts, when they run, then exactly one offer is created for one place.
5. Given the club's offer window (unset = 24 hours), when a waiting-list place is offered, then the offer lasts the club's hours at that moment, capped by the close and the start; an offer already out keeps its deadline when the setting changes (2026-09-25, `DECISIONS.md` §377).

**Verification:** integration `waitlist/promotion.test.ts`

#### BR-REQ-035-03 — Accepting, declining, and expiring an offer

- **Source:** BR-BUS-035
- **Implements:** AGENTS.md §10.7, §15.7
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given an active offer, when the participant signs the declaration before the deadline, then the status becomes `CONFIRMED`.
2. Given an active offer, when the participant declines, then the place is released immediately and the next eligible entry is offered.
3. Given an active offer, when the deadline passes, then the status becomes `EXPIRED` with `expiry_reason = WAITLIST_OFFER_LAPSED`, an expiry email is queued, and the next entry is offered.
4. Given a held offer, when the public count is read, then the held place is not shown as available.
5. Given an expired offer, when registration is still open, then the participant may rejoin at the end of the queue.

**Verification:** integration `waitlist/offer.test.ts`; e2e `waitlist-claim.spec.ts`

#### BR-REQ-035-04 — Queue closes at event start

- **Source:** BR-BUS-035
- **Implements:** AGENTS.md §10.5, §16.2
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given waiting-list entries on an event that has started, when maintenance runs, then each becomes `EXPIRED` with `expiry_reason = EVENT_STARTED`.
2. Given that transition, when it occurs, then no email is sent.
3. Given a started event, when the backoffice is opened, then no registration remains in `WAITLISTED`.

**Verification:** integration `waitlist/closure.test.ts`

#### BR-REQ-035-05 — Exceptional promotion is audited

- **Source:** BR-BUS-035, BR-BUS-037
- **Implements:** AGENTS.md §10.7, §15.8
- **Priority:** SHOULD
- **Release:** M2

**Acceptance criteria**

1. Given the backoffice, when an administrator promotes the next entry, then no reason is required.
2. Given the backoffice, when an administrator promotes a specific entry out of order, then a reason is required and the action is refused without one.
3. Given an exceptional promotion, when it completes, then an audit row records the actor, the target, the reason, and the time.
4. Given any promotion, when it runs, then it cannot exceed capacity or bypass declaration acceptance.

**Verification:** integration `backoffice/promotion.test.ts`

### 4.6 Participant self-service

#### BR-REQ-036-01 — Unregistration requires an explicit action

- **Source:** BR-BUS-036
- **Implements:** AGENTS.md §15.5
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a management link, when it is opened, then the registration is not changed and a confirmation page is presented.
2. Given the confirmation page, when the participant confirms, then the status becomes `CANCELLED`, the place is released, a cancellation email is queued, and waiting-list promotion is evaluated.
3. Given a link that has already been used to cancel, when it is opened again, then the current state is shown and no duplicate action occurs.
4. Given an event that has started, when unregistration is attempted, then it is refused with an explanation.
5. Given a pending declaration, a waiting-list entry, or an active offer, when the participant cancels, then the same explicit-confirmation behavior applies.

**Verification:** integration `registrations/unregister.test.ts`; e2e `unregister.spec.ts`

#### BR-REQ-036-02 — Email action tokens are safe

- **Source:** BR-BUS-036, BR-BUS-070
- **Implements:** AGENTS.md §12.8, §13.2
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a token, when it is stored, then only its hash is persisted.
2. Given a token, when it is used for a purpose other than the one it was issued for, then it is rejected.
3. Given a token, when it is past its expiry, used, or invalidated, then it is rejected.
4. Given any GET request carrying a token, when it is handled, then no state is mutated.
5. Given a new token for the same purpose and registration, when it is issued, then previous active tokens for that purpose are invalidated.
6. Given repeated validation attempts presenting the same token, when they exceed the limit for the window, then further attempts are refused with the same generic response an unknown token receives, and the limit is keyed on the token's hash rather than on the caller.
7. Given a consent withdrawal, when the manage token names no registration, or the form posts a registration id that is not a uuid, then it is refused as NOT_FOUND like any bad token, and never reaches the database as a cast error (2026-09-23, `DECISIONS.md` §324).
8. Each runner on an address confirms, signs their own declaration, gets their own race number and QR code, and is erased on their own. "Înscrierile mele" names each runner, and every email greets the runner of the registration it is about (2026-09-25, `DECISIONS.md` §389).

**Verification:** integration `tokens/action-tokens.test.ts`, `tokens/token-throttle.test.ts`

### 4.7 Backoffice

#### BR-REQ-037-01 — Registration detail shows the full picture

- **Source:** BR-BUS-037
- **Implements:** AGENTS.md §14
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a registration, when an administrator opens it, then the view shows name, delivery email, canonical duplicate identity, status, email confirmation state, declaration version and acceptance time, waiting-list time or offer deadline, hold deadline, confirmation and cancellation times, email delivery history, and audit history.
2. Given an Author or Editor, when they attempt to open any registration view, then access is refused.

**Verification:** integration `backoffice/registration-detail.test.ts`

#### BR-REQ-037-02 — Resend is state-derived

- **Source:** BR-BUS-037, BR-BUS-080
- **Implements:** AGENTS.md §15.8, §16.3
- **Priority:** MUST
- **Release:** M2

**Acceptance criteria**

1. Given each registration status, when an administrator resends, then the message type matches the mapping in `SETUP.md` §21 and no other type can be selected; for a confirmed registration that is the confirmation itself (`REGISTRATION_CONFIRMED`, with the desk code, its QR and the manage link — "retrimite QR-ul" in the list), not a bare manage link (2026-09-18, `DECISIONS.md` §79); and, while the registration is confirmed and the event has not started, the reminder by name ("Trimite reminderul", `EVENT_REMINDER`) — refused otherwise (`DECISIONS.md` §81).
2. Given a resend, when it completes, then a new outbox row is created, marked as a manual resend with the acting administrator recorded.
3. Given a resend, when it completes, then the registration status is unchanged and no deadline is extended.
4. Given a cancelled or expired registration, when an administrator resends, then a `REGISTRATION_STATE_NOTICE` is queued that contains no confirmation link and no scoped token.
5. Given repeated resends, when they are attempted, then a rate limit applies and the refusal is recorded.

**Verification:** integration `backoffice/resend.test.ts`

#### BR-REQ-037-03 — Administrative corrections are bounded

- **Source:** BR-BUS-037
- **Implements:** AGENTS.md §14, §10.3, §15.11
- **Priority:** MUST
- **Release:** M1
- **Status:** built, and recorded in `DECISIONS.md` §33. The administrative changes to a
  registration are entering one, correcting its name, cancelling it, and — since `DECISIONS.md`
  §44 — erasing it (BR-REQ-037-06). There is deliberately no fifth: no verified-email edit and
  no participant merge.

**Acceptance criteria**

1. Given a registration, when an administrator corrects the participant name, then the change is audited.
2. Given the backoffice, when it renders, then it offers no verified-email edit and no participant merge.
3. Given any administrative state change, when it completes, then an audit row records actor, action, entity, and time.
4. Given a cancellation by an administrator, when it commits, then the released place is offered to the front of the waiting list, exactly as a participant's own cancellation is.
5. Given a registration, when the backoffice shows it — on its own page and as the "Etapă" column of the list — then its journey is derived from the row as six ordered steps (submitted, email confirmed, place reserved, declaration signed, place confirmed, present), with the step the person is at marked current, a waiting-list entry waiting at the reservation step, a signed declaration recognised whether it was signed online or on paper, the race number on the confirmation and on the check-in, a cancelled or expired row keeping the steps it reached and naming how it ended, and a registration restarted on the same row showing only the steps of its current cycle; the list's cell names the last step done, never the one awaited, and reads the acceptance with one probe per row, never a query per row (added 2026-09-19, `DECISIONS.md` §145).
6. Given a public submission for an event by an address that already holds an active registration for it, when it is accepted, then exactly one `audit_logs` row `registration.resubmitted` is written in the same transaction as the re-send, on that registration, with the participant, no staff actor, and metadata holding only the state found and the message type re-sent (null when nothing was queued); the public answer is identical to a first submission's; the registration's timeline shows each such row as a dated line naming the state and the re-sent message; and the registrations list marks the row "Reînscriere ×N" with the last date, read in one grouped query for the page's rows and counted in no figure the club is given (2026-09-23, `DECISIONS.md` §312).
7. A staff name correction that would give a registration the same folded name as another registration on the same address and event is refused on the name field. The check and the update run under the event's lock, so a rename racing a family-link registration of the same name gets that refusal and never a database error (2026-09-25, `DECISIONS.md` §389).

**Verification:** integration `registrations/staff-crud.test.ts`; unit `registrations/journey.test.ts`; integration `registrations/admin-list.test.ts`

#### BR-REQ-037-04 — The queue can be exercised without reaching anyone

- **Source:** BR-BUS-037, BR-BUS-060
- **Implements:** AGENTS.md §12.6, §10.6, §15.10
- **Priority:** SHOULD
- **Release:** M1
- **Status:** built, and recorded in `DECISIONS.md` §30. No participant account type
  is added and the staff role enum stays at three: this is a property of the registration.

**Acceptance criteria**

1. Given a registration of kind `TEST`, when it moves through the lifecycle, then it occupies a place, expires on the same hold deadlines, and is promoted from the waiting list by the same allocator as a `REAL` one; running the same scenario as each kind produces identical transitions.
2. Given the capacity formula and the queue allocator, when they are read, then neither contains any condition on the kind.
3. Given the CSV export, when it is produced, then `TEST` rows are absent from it.
4. Given any screen that lists a registration, when a `TEST` row is shown, then it is labelled unmistakably.
5. Given an Administrator in an environment other than production, when they add N test registrations to an event, then N synthetic participants go through the ordinary submission and confirmation path, each on a distinct address in a reserved domain that can never receive mail.
6. Given the same Administrator, when they remove the test registrations for that event, then those rows and the synthetic participants behind them are deleted and every real registration is left standing.
7. Given `APP_ENV=production`, when a test registration is attempted, then it is refused in two independent places.
8. Given an Administrator on an event with internal registration, when the event page renders, then it shows the queue as the allocator counts it — places, confirmed, held, free, waiting — and the waiting list numbered in the order it is served, with an offer's deadline where one is out (2026-09-18, `DECISIONS.md` §92).
9. Given `FEATURE_DISPLAY_NAME` unset or not `true`, when the public or the staff form renders, then no display-name field is offered and a posted value is ignored, so the list shows the registered name; the CSV export always carries the first name, the last name and the identity document beside the registered name (2026-09-18, `DECISIONS.md` §95).
10. Given an event held in a time zone other than the club's, when its queue panel renders, then an offer's deadline and the time a runner joined the waiting list are written in the event's own zone, as the runner's email writes them, in the reader's language with the weekday (2026-09-24, `DECISIONS.md` §369, §92, §349). Verification: integration `registrations/queue-panel-zone.test.ts`.

**Verification:** integration `registrations/test-kind.test.ts`

#### BR-REQ-037-05 — An Administrator registers somebody who asked in person

- **Source:** BR-BUS-037, BR-BUS-060
- **Implements:** AGENTS.md §15.11, §12.6, §12.12
- **Priority:** SHOULD
- **Release:** M1
- **Status:** built, and recorded in `DECISIONS.md` §33.

**Acceptance criteria**

1. Given an Administrator and an event whose registration mode is `INTERNAL`, when they enter a name and an email, then a registration is created in `PENDING_EMAIL_CONFIRMATION`, of kind `REAL` and source `STAFF`, carrying the staff user who entered it.
2. Given that registration, when it is created, then the participant receives the ordinary verification email and nothing about it is confirmed by staff.
3. Given a full event with a waiting list, when an Administrator enters a registration and its address is confirmed, then it joins the back of that waiting list and no existing entry loses its position.
4. Given the form, when the relay confirmation is not ticked, then the registration is refused and nothing is written.
5. Given an address that already holds an active registration for that event, when an Administrator enters it, then they are told so plainly rather than receiving the public form's generic answer.
6. Given an Author or an Editor, when any of this is attempted, then it is refused.
7. Given any of these changes, when it completes, then an `audit_logs` row records the actor, the action, the entity and the time.
8. Given the registrations list, when a row renders, then it offers the verbs that apply to its status and the reader role — open, resend, confirm on paper, give a place, check in or undo, cancel — as a menu of the existing actions and never as a free status select, so no transition bypasses the allocator, the signed declaration or the audit row; and given no event in the query, then the list and its export are both filtered to the featured event, with every event one press away (2026-09-20, DECISIONS.md section 178).
9. Given the registrations list with a name search and no event chosen in the address — no `eventId`, an empty one, or an id no longer listed — when it renders, then it searches every event, says so in one line, and the event select shows its automatic option rather than submitting the featured event's id; given an explicit event id or `all`, then that is honoured as it is; and the export follows the same rule, `all` included, so the file is the set on screen (2026-09-23, `DECISIONS.md` §312).
10. Given a staff member entering a registration on /admin/registrations/new (the form the desk's walk-in opens), when the birth date typed says the person is under eighteen today, then a box for the parent's or legal guardian's full name appears, as on the public form, and a refusal that names it opens it whatever the date then says. Given a birth date, fourteen or over on the event's day and under eighteen, with the parent named, the registration is entered and keeps the parent's name. Without the name it is refused for guardianName alone, never for age. Given an adult with a name in that box, the row keeps no guardian (2026-09-23, `DECISIONS.md` §324).
11. Given the staff entry form, when an event is chosen, then the birth-date box's max is the latest birth date that is still fourteen on that event's calendar day in its own time zone, never later than today, and its min is 120 years ago. The limit follows the event select without a reload and matches the server's own age rule (2026-09-23, `DECISIONS.md` §324).

**Verification:** integration `registrations/staff-crud.test.ts`

#### BR-REQ-037-06 — An Administrator erases a registration

- **Source:** BR-BUS-037, BR-BUS-070
- **Implements:** AGENTS.md §15.11, §12.12, §10.3
- **Priority:** MUST
- **Release:** M1
- **Status:** built, and recorded in `DECISIONS.md` §44, which supersedes the "there is no
  delete" of §33. Cancelling keeps the row, which is right for a withdrawal and wrong for an
  erasure request; this is the second case.

**Acceptance criteria**

1. Given a registration that holds a place, when an Administrator erases it, then the place is released through the ordinary allocator and offered to the front of the waiting list before the row is removed.
2. Given a registration with a signed declaration, when it is erased, then the declaration acceptance is deleted with it, and so are its action tokens and queued messages.
3. Given any erasure, when it completes, then an `audit_logs` row records the actor, the reason, the status it was in and the time — and contains neither the participant's name nor their address.
4. Given that audit row, when the registration no longer exists, then the row is still readable: it carries no foreign key to the thing it describes.
5. Given an erasure, when it completes, then no message is sent to the participant.
6. Given any role below Administrator, when an erasure is attempted, then it is refused and nothing is removed.
7. Given an unknown registration, when an erasure is attempted, then it is refused rather than reported as a silent success.
8. Given an erasure from the registrations list, when the Administrator types the row's name to confirm it, then the typed name is compared with that registration's name using the same fold as the declaration's signature (`domain/name-fold.ts`). Forgiven: case, runs of whitespace (a non-breaking space included), diacritics (any combining mark, with a comma below or a cedilla), the typographic shape of an apostrophe or a hyphen, and invisible characters (zero-width spaces, soft hyphens). Nothing else is forgiven: every letter and digit, every hyphen and apostrophe, and every word, in order. A blank name never matches, and a name that does not match erases nothing (2026-09-23, `DECISIONS.md` §314).
9. Given an erasure, when it completes, then no earlier audit row of that registration has a participant_id, a name correction has no before or after, and no row but the deletion's keeps a typed reason. When it was the person's last registration, no row about the person (participant.data_exported) keeps the participant's id in participant_id or entity_id. All of this happens in the delete's transaction.
10. Given the erase panel (single or batch) and the banner after a single, batch or whole-event erase, when they render, then they list the copies the erase cannot reach: the archive mailbox and its Cc/Bcc copies, downloaded exports, the paper declaration, Mailgun suppressions, and the database backups' restore window.
11. Given an erasure of a registration that holds a place, when it completes, then no cancellation message is queued, not even transiently.
12. Given the event erase page for an event with real registrations, when it renders, then the list of what the platform cannot delete stands before the typed-title confirmation, as on the other three erase panels. The list names the archive mailbox and its copies, downloaded exports and downloaded declarations PDFs, any printed emergency sheet, the paper declaration, Mailgun suppressions, and backups kept at most 7 days (2026-09-23, `DECISIONS.md` §324).

**Verification:** integration `registrations/staff-crud.test.ts`

#### BR-REQ-037-07 — The desk confirms: address vouched for, declaration on paper

- **Source:** BR-BUS-037, BR-BUS-033
- **Implements:** AGENTS.md §15.11, §10.8, §12.6
- **Priority:** MUST
- **Release:** M1 — 2026-09-18, `DECISIONS.md` §67, which amends §33's "consent cannot be
  relayed": it still cannot, and this is not a relay. The participant signs a printed copy of the
  approved declaration; staff record that they did.
- **Status:** built.

A race morning has people at a table whose email never arrived, whose QR is on a phone that died,
or who never registered at all. Every one of them is standing in front of a member of staff — the
one situation in which "verify the address" is answered by looking up. The desk therefore has a
way through every step, and none of them is a way around the allocator.

**Acceptance criteria**

1. Given a registration in `PENDING_EMAIL_CONFIRMATION`, `PENDING_DECLARATION` or `WAITLIST_OFFERED`, when a member of staff confirms it at the desk, then it goes through the ordinary allocator under the event's capacity lock: to `CONFIRMED` when a place is free, to `WAITLISTED` when the event is full, and the outcome is stated as a sentence. Nothing at the desk can place anybody past capacity.
2. Given the address was never clicked, when the desk confirms, then `registrations.email_confirmed_at` is set and `email_confirmed_by_staff_user_id` names who vouched for it; the participant's own `email_verified_at` is deliberately left unset, because an attestation is a different fact from a delivered click.
3. Given the declaration, when the desk confirms, then a `declaration_acceptances` row is written with `method = PAPER`, `attested_by_staff_user_id` set, the registered name as the typed name, and the current approved version's id and hash — the same row shape the email path writes, so every reader downstream treats it identically; the database refuses a `PAPER` row with no attester and an `EMAIL_LINK` row with one. Without an approved declaration in the participant's locale the confirmation is refused, exactly as the email path is.
4. Given a registration entered by staff with the fast track ticked, when it is created, then no verification email is queued, the registration is confirmed as in criteria 1–3 in the same request, and the public registration window is not consulted — the desk decides — while a cancelled event and a non-local registration mode still refuse it.
5. Given a waiting-list registration, when the desk gives it a place, then it is refused with a sentence while `occupied >= capacity` under the lock, and otherwise confirmed on paper as in criterion 3; the audit row says the queue was jumped and by whom.
6. Given any of the above, when it completes, then an `audit_logs` row names the actor and the transition and never the participant; and given a confirmation, then the `REGISTRATION_CONFIRMED` email is queued as for any confirmation.
7. Given every staff role, including Contributor, when a desk verb (enter, confirm, give a place, set a number, check in) is attempted, then it is allowed; and given any role below Administrator, when cancel, erase, rename, resend or the printing mark is attempted, then it is refused. The list and the export are the Organizer's to read since `DECISIONS.md` §289 and nobody else's below Administrator (BR-REQ-060-01).
8. Given a `PENDING_DECLARATION` registration whose hold deadline has passed and which was kept because the queue did not want its place (BR-REQ-033-01 criterion 3, `DECISIONS.md` §160), when the desk confirms it on paper, then it is confirmed as in criterion 3 — the place was never released, so no capacity check is needed and none is made; and given the same registration after the event's own start released the hold, when the desk confirms it, then the allocator decides again under the lock and confirms it into a place that is still free rather than refusing it. The backoffice journey shows "termen depășit, locul se ține cât nu așteaptă nimeni" for such a hold — the condition in the words, because the row is rendered in a list that spans many events and reads no queue of its own.
9. Given a minor's registration confirmed on paper at the desk, when the declaration in effect in the registration's language names `{{participantIdDocument}}`, then the acceptance records the parent or guardian as `typed_name` and the minor as `minor_typed_name`, and the desk row, the registration's page and the list's confirmation say before the press that the paper carries both signatures, each with its own document, and the desk row offers the minor's paper form; otherwise the acceptance records the parent or guardian alone and nothing is said about a second signature (2026-09-23, `DECISIONS.md` §330).
10. A staff verb's confirmation dialog states an email count that matches what the send actually queues for that row's kind — never a participant count for a TEST row, which the club is told nothing about elsewhere. (2026-09-25, `DECISIONS.md` §384.)

**Verification:** integration `registrations/race-day.test.ts`, `registrations/staff-crud.test.ts`

#### BR-REQ-037-08 — Race day: the desk code, its QR, check-in

- **Source:** BR-BUS-037, BR-BUS-036
- **Implements:** AGENTS.md §15.11, §16.3, §12.6, §8
- **Priority:** MUST
- **Release:** M1 — 2026-09-18, `DECISIONS.md` §67.
- **Status:** built.

**Acceptance criteria**

1. Given a registration reaching `CONFIRMED` by any path, when it is confirmed, then `registrations.checkin_code` is set: ten characters from an alphabet without 0/O/1/I, unique across every event, stored in clear — an identifier that confers nothing, not a credential; a confirmed registration from before codes existed receives one the first time it is needed.
2. Given the `REGISTRATION_CONFIRMED` message, when it renders, then it carries the code as text in both bodies and, in the HTML body, a hosted PNG of the QR at `/api/registrations/qr/<code>.png` — never a data URI. The QR encodes the address of `/admin/checkin/<code>`, so a phone's camera opens the desk page for that runner. The route answers 404 for a code nobody has and for anything that is not a code; no other message type carries a code.
3. Given `/admin/checkin` and `/admin/checkin/<code>`, when requested with any staff session, then they render; when requested without one, then sign-in — a participant scanning their own code sees the sign-in page and nothing else. The desk shows for each runner the registered name, the state, the number and the check-in state, and never an email address or any other detail.
4. Given the desk, when a code is scanned (the browser's own `BarcodeDetector`, where it exists) or typed, then the one registration it names is shown from any event; when a name fragment is typed, or nothing, then the chosen event's registrations that are not cancelled or expired are listed, pending ones included, matched with the same diacritics-blind search as the list; when a race number is typed, then the registrations of the chosen event wearing it as a settled number are listed in any state — a settled number is never reused, so a cancelled or expired runner is found by it — and a provisional number finds only a registration that is not cancelled or expired; and the event's counts — confirmed, checked in, without a number, not yet confirmed — are on the page (2026-09-23, `DECISIONS.md` §311).
5. Given a confirmed registration, when staff mark it here, then `checked_in_at` and `checked_in_by_staff_user_id` are set, idempotently; undoing clears both; anything not confirmed is refused; each writes an audit row. Given the participant's own manage link from twenty-four hours before the start, when they press "I am here", then `checked_in_at` is set with no staff id, the token is read and not spent, and the same page shows their code and QR.
6. Given a walk-in on the desk, when "add somebody" is used, then the staff entry form opens with the fast track ticked and returns to the desk with the outcome (BR-REQ-037-07 criterion 4).
7. Given the whole of race day, when a volunteer opens the desk, then the steps — before, at the table, after, and what to do when each thing goes wrong — are on the page itself, and the guide at `/admin/guide` says the same for every role.
8. Given a scanned code or a typed settled race number that names a `CANCELLED` or `EXPIRED` registration, when the desk renders the row, then it says so first, in the error colour — the state and the date it left the live states — and, when a printed bib with that number exists, that the number was printed, is not to be handed out and is never reused; the row offers no verb, no number field and no bib picture, and every staff role sees it as a name, a state and a number and never an address. The desk's own how-to names the red box and what to do (2026-09-23, `DECISIONS.md` §311).
9. "Am ajuns" opens the club's check-in lead before the start, in the event's zone, and the manage page says from when, starting with "începând cu … înainte de start" (2026-09-25, `DECISIONS.md` §377).
10. Race week, for both the homepage countdown and the editor's bib-printing card, counts whole calendar days on the event's wall clock with the start still ahead. 0 means race day only, and the two always agree (2026-09-25, `DECISIONS.md` §377).
11. Check-in at the desk, in the list menu and on the registration page asks nothing: it emails nobody and is undone from the same row.

**Verification:** integration `registrations/race-day.test.ts`; unit `registrations/checkin-code.test.ts`, `notifications/templates.test.ts`; e2e `race-day.spec.ts`; integration `registrations/void-bibs.test.ts` (4, 8); e2e `race-day.spec.ts` (8)

#### BR-REQ-071-01 — Participant export

- **Source:** BR-BUS-071, BR-BUS-070
- **Implements:** AGENTS.md §15.10
- **Priority:** MUST
- **Release:** M2

**Acceptance criteria**

1. Given an Author or Editor, when an export is attempted, then it is refused.
2. Given an administrator, when an export is produced, then it contains only the fields needed for the stated organizer purpose.
3. Given a cell value beginning with `=`, `+`, `-`, or `@`, when it is written to CSV, then it is neutralized.
4. Given an export, when it completes, then it is delivered through a short-lived authorized response, is not written to public storage, and is audited.
5. Given any registrations export (CSV or spreadsheet), when it is produced, then an audit row records who exported, which event, the format and the row count, never a row. Given the Administrator's JSON of everything held about an address, when it is downloaded, then it is recorded as participant.data_exported with counts only.

**Verification:** integration `backoffice/export.test.ts`

#### BR-REQ-038-01 — Race numbers, assigned as a batch and printed as a sheet

- **Source:** BR-BUS-037
- **Implements:** AGENTS.md §12.6, §9.2
- **Priority:** SHOULD
- **Release:** M1 — pulled forward from M2 on 2026-09-17 (`DECISIONS.md` §65); the rest of M2's
  bib story (one number per race across its distances, results keyed by bib) stays M2.
- **Status:** built.

**Acceptance criteria**

1. Given a registration of a real kind, when it is confirmed — by the participant's signature or at the desk — then it receives a number drawn at random from those never worn at that event (three digits while they last, four after), inside the transaction that holds the event row; and given an Administrator on an event that takes registrations here, when they assign race numbers, then every confirmed, real registration without one receives such a number, in order of confirmation, and the outcome states how many were assigned and how many the event has (2026-09-18, `DECISIONS.md` §87, §94).
2. Given a registration that already has a number, when numbers are assigned again, then its number is unchanged; a number once worn at the event — by any registration, cancelled included — is never drawn again.
3. Given a test registration, a waitlisted, pending, cancelled or expired one, when numbers are assigned, then it receives none; a cancelled registration that had a number keeps it, so the number is never given to somebody else.
4. Given two registrations of one event, when both would carry the same number, then the database refuses the second.
5. Given assigned numbers, when the sheet is requested — all of them, or a range `from`/`to` for a reprint or a late batch — then the response is a PDF, Administrator only, of A4 pages with two bibs each and a dashed cut line between them, or, with `layout=one` ("câte unul pe pagină"), the same A5-sized bib centred one per A4 page (2026-09-18, `DECISIONS.md` §79); each bib carries the club's lockup, the number in the club's blue as large as the paper allows, the participant's registered name, and the event's title and date in the requested language. Only confirmed, real registrations are printed.
6. Given the assignment, when it completes with at least one number given, then one audit row records who, for which event, and the range assigned — never a participant.
7. Given one confirmed registration, when any staff role types a number for it — or clears it — then the number is a whole number from 1 to 99999, a number already worn at that event is refused with a sentence rather than a stack trace, and an audit row records the number before and after (2026-09-18, `DECISIONS.md` §67); the registration's page lists the first free numbers beside the field, and a number given or changed by hand on a confirmed registration queues `BIB_ASSIGNED` to the participant — the number, the QR code and the manage link — while clearing one sends nothing (`DECISIONS.md` §105).
8. Given a registration for which Mailgun reported `permanent_fail` or `complained` on any message (BR-REQ-080-04), when the desk row or the registration page renders, then it carries an "email respins" chip with the provider's short reason, so the organizer knows before race day who never got the email and calls them; the participant sees nothing (2026-09-18, `DECISIONS.md` §76). The registrations list filters to those rows ("doar email respins"), shows the same chip, and its CSV export carries `Checked in` and `Email bounced` columns; the events list shows confirmed and checked-in counts beside an event within a day of its start (`DECISIONS.md` §83).
9. Given numbered registrations, when an Administrator opens the event page, then each confirmed, real registration's bib can be seen as a picture — the club's lockup, the event's title and date, the number in the club's blue, the registered name — drawn on request at `/api/admin/events/<id>/bibs/preview?registration=<id>`, Administrator only (2026-09-18, `DECISIONS.md` §94).
10. Given an event, when a registration is confirmed or the batch runs, then it is given the lowest free race number at or above that event's own `bib_start_number` (1 by default) — in order, never at random (2026-09-20, `DECISIONS.md` §173, reversing §94) — under the same event-row lock capacity uses; a number once given is never renumbered and a cancelled registration keeps it.
11. Given a confirmed registration that already has a race number, when a staff member tries to change or clear it, then it is refused: the runner has been emailed it and it may already be printed. Given a confirmed registration with no number, then one may still be given by hand and the runner is told. Given a registration that is not yet confirmed, then a preferential number may be set among the free ones, and no email goes out until confirmation carries it (2026-09-20, `DECISIONS.md` §173, §105).
12. Given an event, when an organizer sets where its numbers start and what colour they print, then both are stored on the event and checked at the database — a start a four-digit bib can reach, and a colour that is six hex digits after a hash — and the free-number suggestions count from that start rather than from 1 (2026-09-20, `DECISIONS.md` §173).
13. Given an event's page, when an organizer opens "cum arată numărul de concurs" and saves, then the event stores what is printed (the runner's name, the event's title, the date, the club's logo), the number's size, where the name sits, a header picture, a sponsors' strip and whether the sheet carries cut marks; the A4 sheet and the preview picture both render exactly that, and a form that does not carry the panel — the create form, an older caller — leaves the stored design untouched (2026-09-21, `DECISIONS.md` §249).
14. Given a header or sponsors' picture, when it is chosen, then it must be one this site stored — its own WebP variant, on the store's public host or the local media route — and anything else is refused or dropped; when the sheet prints, each picture is fetched with a five-second deadline and a four-megabyte ceiling, and one that cannot be fetched prints the coloured band rather than failing the sheet. The band's own text is white or ink, whichever can be read on the chosen colour (2026-09-21, `DECISIONS.md` §249).
15. Given the event editor's bib-design panel, when it renders, then it shows a picture of the bib drawn by the same renderer that prints — a placeholder runner, the event's start number, its real title and date, the unsaved design read from the picture's own address through the schema the save uses — and redraws it about 300 ms after any design box, the band colour or the start number changes, before a save; the sample is a staff-only GET that reads no participant row, mutates nothing and is never cached; a garbage design value falls back field by field and a third party's picture is refused (2026-09-23, `DECISIONS.md` §301).
16. Given a real registration with a settled, printed race number, when it is cancelled — by an Administrator, in bulk, or from the participant's own link — or expires, then the number stays retired and the printed mark stays on the row; `voidBibsFor(eventId)` lists it — number, registered name, status and the row's own `cancelled_at` or `expired_at` — sorted by number, and lists no unprinted, provisional, test or confirmed row; the registrations list's bibs panel shows one visible line per such bib, the whole line a link to its registration naming the number, the name, the state in the page's language and the date, and its "printed / total" figures count confirmed registrations only and say so; the sheet prints none of them, in the batch or in a range (1–50 around a cancelled printed 27 renders 49); the printing mark is offered only on a confirmed row; the registration's page shows a "BID N tipărit — de retras" chip and the timeline's cancelled or expired line says it; a staff cancellation's audit row carries `bibNumber` and `bibPrinted: true`, and an erasure's carries the event, the number and the printed fact — never the name; the single cancel's confirmation names the printed number before the press, the bulk cancel names the printed numbers among the rows it shows before the press, and its saved banner names the printed numbers that press retired (2026-09-23, `DECISIONS.md` §311).
17. Given a registration that is `CANCELLED` or `EXPIRED`, when any staff role — through the desk action or otherwise — tries to clear its number, replace it or give it one, then the server refuses it and nothing is written; given a registration whose settled number is printed, in any status, then a change or a clear is refused the same way. Given a registration that was erased while wearing a settled number, printed or not, then that number stays taken at its event for as long as the erasure's audit row is kept: the confirmation's draw, the batch, the provisional draw, the settle at the close and the free-number suggestions never produce it, and typing it by hand is refused with nothing written (an erased printed 27 in a band from 1: thirty draws give 1–26 and 28–31) (2026-09-23, `DECISIONS.md` §311).
18. Given the registrations list, when the race-number column renders, then its header carries a tap-friendly hint saying that a number with an asterisk is provisional (it can change until registration closes and is emailed and printed only once settled), that a bold number is final and that a tick means printed; the asterisk is hidden from a screen reader and followed by the word "provizoriu" (2026-09-23, `DECISIONS.md` §313).
19. Given an event's bib design, when an organizer switches the footer's pieces — the club's mailbox, the partners, the site's bare host from `APP_BASE_URL`, the event's title and date — and types a line of the club's own, then the A4 sheet and the preview picture print them in that order: event, partners, the club's line, site, mailbox. The club's line is stored as plain text on one line, normalised to composed characters, with only characters the bib's font can draw, at most 120. The event's title or date is printed only where the header actually drawn does not show it; a sheet whose header picture could not be fetched prints the band and does not repeat them. The platform's own design, and any design stored before these keys existed, prints exactly the partners, then the mailbox. The footer takes one line, or two with whole pieces moved to the second, the second cut with "…" when even two are not enough. It never takes a third line and is never shrunk. Both renderers break it at the same characters. No footer line is wider on the paper than its 503.28-point box by pdfkit's own measurement, kerning included, and the sheet gives pdfkit no width to wrap in. Nothing about a participant is ever printed in it (2026-09-23, `DECISIONS.md` §317).
20. Given assigned numbers, when the sheet is requested — all of them, or a range from/to for a reprint or a late batch — then the response is a PDF, Administrator only, of A4 pages with two bibs each and a dashed cut line between them, or, with layout=one ("câte unul pe pagină"), the same A5-sized bib centred one per A4 page (2026-09-18, DECISIONS.md §79); each bib carries the club's lockup, the number in the club's blue as large as the paper allows, the participant's registered name, and the event's title and date in the requested language. Only confirmed, real registrations are printed. (Criterion 5 — this fix restores compliance: the branch had drifted `layout=one` to an upper-half, cut-lined bib before this pass.)
21. Criterion 5 (addition): with `layout=one` the A5 bib stays centred on its A4 page with no dashed cut line and no frame; when the design's cut marks are on, the page carries the trim guide — short solid rules at each end of the bib's top and foot — and with them off it carries no line at all (§79, §340). Verification: unit `registrations/bibs-pdf.test.ts`.

**Verification:** integration `registrations/bibs.test.ts`, `registrations/race-day.test.ts`, `cms/bib-design.test.ts`; unit `registrations/bibs-pdf.test.ts`, `registrations/bib-design.test.ts`; integration `registrations/void-bibs.test.ts` (16, 17); unit `registrations/race-number.test.ts` (16); unit `registrations/bib-footer.test.ts` (19); e2e `bib-design.spec.ts` (19)

### 4.8 Public runner profiles

#### BR-REQ-038-01 — Profiles are private by default

- **Source:** BR-BUS-038, BR-BUS-070
- **Implements:** AGENTS.md §10.9, §15.9
- **Priority:** SHOULD
- **Release:** M4

**Acceptance criteria**

1. Given a newly created profile, when its public URL is requested, then the response is 404 until the participant explicitly publishes it.
2. Given a published profile, when it renders, then it shows only display name, biography, and allowlisted links, and never an email address or registration history.
3. Given a published profile, when the page is served, then it carries `noindex, nofollow` and does not appear in the sitemap or any directory.
4. Given a participant who is not verified, when profile management is attempted, then it is refused.

**Verification:** integration `profiles/visibility.test.ts`; e2e `runner-profile.spec.ts`

#### BR-REQ-038-02 — Social links are validated

- **Source:** BR-BUS-038
- **Implements:** AGENTS.md §10.9
- **Priority:** SHOULD
- **Release:** M4

**Acceptance criteria**

1. Given a link for a supported provider, when it is saved, then it must be HTTPS and match that provider's host allowlist.
2. Given a link to a non-allowlisted host, when it is saved, then it is rejected.
3. Given a published profile, when links render, then each carries `rel="noopener noreferrer nofollow"`.
4. Given a Strava link, when it is saved, then no OAuth flow, token, or activity import occurs.

**Verification:** unit `profiles/social-links.test.ts`

#### BR-REQ-038-03 — Moderation

- **Source:** BR-BUS-038
- **Implements:** AGENTS.md §10.9
- **Priority:** SHOULD
- **Release:** M4

**Acceptance criteria**

1. Given a published profile, when an administrator unpublishes it with a reason, then the public URL returns 404 and the action is audited.
2. Given an unpublished profile, when the participant opens their management link, then they can see that it was unpublished.

**Verification:** integration `profiles/moderation.test.ts`

### 4.9 Mini CMS

#### BR-REQ-050-01 — CMS boundary

- **Source:** BR-BUS-050
- **Implements:** AGENTS.md §11.1, §11.4
- **Priority:** MUST
- **Release:** M5
- **Status:** the event slice is built and in use — including creating, duplicating, archiving
  and deleting an event, and every column an organizer owns (`BR-REQ-050-02`). Articles, static
  pages, galleries and the Tiptap body contract of criterion 3 are not. Built during M1 by a
  recorded reordering of the plan (`DECISIONS.md` §25, §28), which is why the release field
  still reads M5.

**Acceptance criteria**

1. Given the CMS, when it is used, then it can edit articles, event editorial fields, the fixed static page keys, and gallery text, and nothing else.
2. Given the CMS, when a new route or page layout is attempted, then no interface offers it.
3. Given editorial content, when it is stored, then the canonical body is validated Tiptap JSON and arbitrary HTML is rejected.
4. Given an event whose every registration is a test row, when an Administrator deletes it outside production, then those rows are removed with it and the event goes; given one real registration among them, then the delete is refused, nothing is cleared, and the count shown names the real registrations only (2026-09-20, `DECISIONS.md` §176).
5. criterion (new): the event editor's Cost select refuses to save PAID without an amount or DONATION without an https link, naming the box in the refusal; the amount and link typed for one kind are kept, unpublished, when the club switches to another kind and back.
6. Criterion (new, §352): Given the event editor's save or create, when a partner's description, or the event's description, rules, programme notes, what to bring, SEO title or SEO description is written in one language and empty in the other, then the save is refused with VALIDATION_ERROR on the empty side's box (`event.coHosts[p].descriptionRo|En` or `translations.<locale>.<field>`), nothing is written, and every box comes back as typed. A text the save does not store (a group run's programme notes) is never refused, and a save carrying only one language is not refused over the other language's stored text. Verification: integration `cms/both-languages.test.ts`; unit `content/co-host-description-editor.test.ts`; e2e `co-host-links.spec.ts`.
7. Criterion (new, §352): Given a partner card in the event editor, when it renders, then "Despre parteneriat" shows a Română and an English multiline box under the partner's name. Their maxLength (300) is read from the schema, line breaks are collapsed to spaces before the limit is counted, and a stored one-language description opens as stored. Verification: unit `content/co-host-description-editor.test.ts`, `content/event-co-hosts-field.test.ts`.

**Verification:** integration `cms/boundary.test.ts`

#### BR-REQ-050-02 — An organizer owns the whole event, without a developer

- **Source:** BR-BUS-050
- **Implements:** AGENTS.md §11.1, §12.3
- **Priority:** MUST
- **Release:** M5
- **Status:** built during M1 (`DECISIONS.md` §28). Until it existed, configuring an event meant
  editing `src/db/seeds/pilot.ts` and re-running a seed.

**Acceptance criteria**

1. Given an Editor or an Administrator, when they create an event, then they supply its type and surface, its status, its times and time zone, its map link and route link, its distance and climb, the featured flag and the whole registration block, plus a title, address and description in every language, and the event is created as a draft.
2. Given an existing event, when it is edited, then every one of those fields is editable through the interface, and no field of `events` requires a developer.
3. Given an event, when it is duplicated, then the copy is a draft, is not featured, has never been published, and carries its own page address in each language.
4. Given an Administrator, when they delete an event that has no registration against it, then it and its translations are removed.
5. Given an event that has any registration against it, when deletion is attempted, then it is refused with a reason and nothing is removed; archiving is the supported answer.
6. Given an Author, when they attempt to create, duplicate or delete an event, then it is refused at the server.
7. Given an event, when it is repeated — weekly, every two weeks or monthly, on chosen days of the week ("every Monday and Wednesday") or its own, **until a date or for ever** — then the rule is kept on the event and always names the event's own weekday beside the chosen ones (a Sunday run with Wednesday ticked runs on Sundays and Wednesdays; the editor shows that day ticked and locked, `DECISIONS.md` §128), and every occurrence is its own copy with the same wall-clock time in the event's own zone (a Sunday 08:00 run stays 08:00 across a clock change), every other time moved by the same interval, a page address carrying its date in each language, no featured flag, no start list and no rule of its own, naming the event it repeats; the next eight weeks are created at once and the maintenance job keeps every series eight weeks ahead, creating each date once — a date whose address already exists is skipped — with at most 104 in one pass; the copies are drafts unless the source is published and publishing was asked for by a role that may publish, in which case they go live as they are made; "stop the series" ends the rule and leaves the dates; a date of a series cannot itself be repeated; the same fields are on the creation form; and the events list publishes the ticked events together, each through the ordinary transitions, counting the ones that could not be (`DECISIONS.md` §64, §122).
8. Given any time an organizer enters — the start, the race start, the end, the registration window — when the editor renders, then it is a date field and a separate time field on a 24-hour clock (`HH:MM`, refused otherwise by the browser and again by the service), whatever clock or date order the organizer's browser locale would have shown in a combined picker; a date with no time is midnight, and no date is no value (2026-09-18, `DECISIONS.md` §70).
9. Given the editor, when it renders, then the event's end is entered as a **duration in minutes** (1 to a week) from which `ends_at` is derived, never as a second date; and the race start (the gun time) is shown only while the type is a race, and ignored on any other type (2026-09-18, `DECISIONS.md` §71).
10. Given a group run, when the editor renders, then neither the registration block nor the programme editor is offered, and when one is saved — through the form or with the hidden fields still posting a mode, a capacity or a programme — then it is written with `registration_mode = NONE`, no capacity, window, declaration, public list or external fields, and no programme in either language; a race, a hike, a coffee and a meetup keep both (2026-09-19, `DECISIONS.md` §111).
11. Given events of the same type with the same title, when the backoffice list renders, then they are one row: the title (linking to the next date's editor), a count of dates, how the series recurs, and the dates folded with each one's state and entries; the state column counts each state, the date column is the range; ticking the row selects every date for the bulk verbs, each with its own version; the type's glyph stands before every title (2026-09-19, `DECISIONS.md` §113).
12. Given the events list, when it renders for a role that may create events, then a bar above the table offers "all", how many rows are ticked, "Publish the ticked ones" and "Archive the ticked ones", and — for an Administrator — "Delete the ticked ones" behind a confirmation; when delete is confirmed, then every ticked event with no registration is removed and the ones with registrations are counted and left; the row ticks belong to that form (the `form` attribute on the `<input>`), so a verb posts exactly the ticked rows and a series row posts every one of its dates (2026-09-19, `DECISIONS.md` §114).
14. Given the editor, when it renders, then the type, surface, difficulty and cost selects show each option with its glyph, the type offers Group run, Race, Hike, Coffee, Equipment testing, Other event and External event, and the organizations the event is held with may be entered as a repeated group — a name and an optional page per row, added and removed one at a time, at most eight — shown as "Together with A, B and C" in the facts and carried by a duplicate, a repeat and a series save (2026-09-19, 2026-09-20, `DECISIONS.md` §121, §168). Beside the box that leads the site with an event there is a second one marking a special edition, which any number of events may carry (`DECISIONS.md` §168).
13. Given the editor of any type but a group run, when it renders, then a "Programme" section offers rows — a date, a 24-hour time, an optional end time, the label in Romanian and in English, a place — with "Add a row" and a remove control per row; when saved, then each row's wall-clock time in the event's zone is stored as an instant, the rows sorted soonest first, a row left entirely blank is dropped, and a row missing its date, its time or either label — or ending before it starts — is refused naming the row's number, with nothing written; when the event is duplicated, then the rows go with it; when it is repeated, then each occurrence's rows are moved by the same interval on the wall clock (2026-09-19, `DECISIONS.md` §117).
15. Given the editor of an event that is in a series — a date, or the source with the rule — when it renders for a role that edits event settings, then three radios above Save offer "this date only" (the default), "this and the following dates" and "all dates of the series"; when a save is made with either of the last two, then, in the same transaction, only the fields this save changed are written to those dates — a changed instant at the same wall-clock time on each date's own day, the programme's rows shifted by the same days — while the featured flag, the rule, the publication state, a film, a Strava event and every slug stay each date's own, a date's own one-off place or status stays unless that is what changed, a capacity below one date's places taken refuses the whole save naming the day, "following" is by the day this date had before the save, every touched row takes a new version, and the banner says how many other dates were written (2026-09-19, `DECISIONS.md` §130).
16. Given the editor of an event that is in a series, when it renders, then a framed header names the series, says in words which date is open (weekday, date, time), its position ("date 3 of 9"), shows every date of the series as a chip linking to its editor — the open one filled and current, a cancelled or moved one marked as on the public card — and offers the previous and the next date by name, and from a date the way to the source (2026-09-19, `DECISIONS.md` §131).
17. Given the editor of an event that is in a series, when the organizer saves, then the save reaches exactly the other dates ticked in the header — each chip a tick, its arrow the way to that date's editor, "Toate" ticking every one — and the framed, folded box above Save says the choice in words and offers "this date only", "this and the following dates" and "all dates" as one exclusive control that sets the ticks; the service ignores an id outside the series and treats no tick as this date only (2026-09-19, `DECISIONS.md` §134).
18. Given a published event page, when a signed-in staff member who may edit the words opens it, then an "Editează" button, 44 pixels tall, leads to that event's editor; a visitor, a volunteer, and every deployment with staff sign-in disabled see no such button (2026-09-19, `DECISIONS.md` §135).
19. Given the editor of an event, when it renders, then the words come first — one panel of language tabs holding the title, the full description, the summary under it, the rules, the programme and what to bring, with the page address and the search-engine fields folded — and the event's settings follow it in four open panels ("Când și unde", "Înscrieri", "Traseu și detalii", "Film"); publication, the series header and repeat stand in a column of their own, to the right from `md` up and above everything on a phone; the tabs stay in view while the text scrolls; and no field is renamed — every input posts the name it posted before (2026-09-20, `DECISIONS.md` §170).
20. Given a save or a publication that is refused, when the screen says so, then it names the field as the screen labels it and the language in its own endonym ("Română: Rezumat", never "RO: excerpt"); given an event with registrations against it, then the editor replaces Delete with the count and, when every row is test data, says so and points at the button that clears them; given a queue made only of test registrations, then the race-number section says numbers are for real, confirmed registrations rather than "none yet"; given nothing ticked in the events list, then the bulk verbs are dimmed wherever the counter is running, and still post where it is not (2026-09-20, `DECISIONS.md` §170).
21. Given the public registration form, when it renders, then one sentence above the first field says what is published and what is not — naming the start list as the single exception, and only for an event that has one — each block of fields repeats it beneath its heading, the answers for sex carry a glyph and every country its flag, and the medical block is a required "I declare I am medically fit to take part" among the consents with the optional free-text note folded beneath its own consent; a registration an organizer enters, and a walk-in at the desk, make that statement on paper instead (2026-09-20, `DECISIONS.md` §171).
22. Given the editor of one date of a series, when the header's chips render, then the date being edited is filled and current and carries no tick box — the save always reaches it — while every other date carries the box that ticks it into the save (2026-09-20, `DECISIONS.md` §175, §134).
23. Given an event whose programme rows carry dates, when the event's start date is changed in the editor from one day to another, then every dated row moves by the same number of calendar days before anything is saved — a two-day programme keeps its second day — a row with no date is untouched, a new row starts on the event's day, and the shift is a pure function with an injected clock, tested across month and year boundaries and a change of zero days; and given the editor's per-language "Programul evenimentului" fold, when it renders, then it is titled as the notes beneath the programme and its hint says the timed rows in "Când și unde" are the programme itself (2026-09-22, `DECISIONS.md` §295, §294).
24. Given an event that carries a repeat rule and a Strava or Facebook event link, when the rule creates its dates — at the press or by the standing job — then every date carries both links, because a recurring Strava club event and a Facebook event with several dates keep one address for all their dates; given a change to either link on one date saved with "this and the following" or "all", then the change travels like a changed place, and saved with "this date" it stays on that date; given an event duplicated for another edition, then neither link is copied (2026-09-23, `DECISIONS.md` §300).
25. Given `/admin/events/new`, when it renders, then it is built from the editor's own pieces — one panel of language tabs holding `TranslationFieldsForm` for every locale (title, rich-text summary, description, rules, programme, what to bring, the page address folded), the settings panels after it, and repeat as the first panel — and no piece of its own; the action reads each language with the save's own reader and the service writes both through the one function the save uses. Given a required field behind a hidden tab or a closed fold, when the browser refuses the submit, then the tab holding it comes forward and the folds on the way up open, so the browser can focus and name it instead of doing nothing. Every time box is the browser's own time input, posting HH:MM (2026-09-23, `DECISIONS.md` §294) (2026-09-23, `DECISIONS.md` §303).
26. 19 (amended). The settings follow the words in three open panels — "Când și unde", "Înscrieri", "Traseu și detalii"; the "Film" panel is gone on both pages, a film being a figure in the description (§266). A caller that says nothing about `videoUrl` writes no column, so an older event's stored link survives every save; the column is dropped by a later contraction, and until then an event with a stored link and a film in its text shows two players (2026-09-23, `DECISIONS.md` §294) (2026-09-23, `DECISIONS.md` §303).
27. Given `/admin/events/new` and a role that may publish, when it renders, then a second button, "Creează și publică", posts the same form and walks DRAFT → IN_REVIEW → PUBLISHED through the same guards inside the create's own transaction, both languages going live together; while a publication requirement is visibly unmet the button says what is missing; when the publication guard refuses, the draft is kept with everything typed and the editor names what publication still needs; a role that may not publish is not offered the button and the server answers it with a draft (2026-09-23, `DECISIONS.md` §315).
28. Given the create form with "Repetă evenimentul" ticked, when the service refuses the rule — an end on or before the event's start, an end that is not a date, a weekday outside Monday to Sunday — then nothing is written, because the event, its publication and its series are one transaction; the refusal names the repeat end or the weekdays as the form labels them, and the form comes back with every box as typed, the repeat tick, cadence, end and weekdays included; given a rule the service accepts, then the series is created with the event, live exactly when the event went live and drafts otherwise (2026-09-23, `DECISIONS.md` §315).
29. Given the editor or the create page of an event that takes registrations, when it renders, then the registration panel offers "Vârsta minimă (ani)", a whole number from 0 to 99 with a helper saying it is reached on the event's day, that under 18 a parent registers and that 0 means none; it is prefilled with the event's value or 14, an empty box saves 14, a value outside the bounds is refused naming the box with every value kept (§315). A group run does not show it. A duplicate, every date a repeat rule creates, and a series edit with "following" or "all" carry it (2026-09-23, `DECISIONS.md` §329). Verification: integration `cms/crud.test.ts`, `cms/series-edit.test.ts`; unit `shared/form-constraints.test.ts`; e2e `registration-form.spec.ts`.
30. Given the editor of an event that takes registrations here, for a role that edits its settings, when it renders with the status "Programat", then beside Save there is an unticked "Anunță participanții despre schimbare", a 44-pixel target, with the optional note shown once it is ticked. Beneath it, a sentence says before the press how many real registrations would be written to, how many messages that makes with the club's copies and test rows, and what the Mailgun plan has left today or this month. After a save, the banner says how many were queued or that nothing was sent. When the status select says "Anulat" on an event that was not cancelled, the box is replaced by a required reason and a ticked "tell the participants" box with its own count. On a completed or already-cancelled event neither appears (2026-09-23, `DECISIONS.md` §331). Verification: e2e `event-notices.spec.ts`.
31. Given a series whose new dates are drafts — the rule's own automatic-publish switch is off, or its source is not published — when the backoffice list renders that row, then a line beneath it names how many dates are drafts (only the ones still ahead; a past draft is not named), links each to its own editor, and a "?" explains what a draft date is and, when the list can tell, why this series makes them, checking whether the source itself is published before the rule's own flag (a series started from a draft source always stores publish:false on the rule whatever was ticked, so the flag alone cannot distinguish the two causes); when the source is published and its own flag is off, the editor offers "Publică datele noi automat", which switches future dates to publish without a stop-and-restart, and that switch cannot be raced by a concurrent "stop the series" (`DECISIONS.md` §341).
32. Amends criterion 8. Given any date or time an organizer enters in the backoffice — the start, the race start, the registration window, a programme row's date, time and end, a series' end on the create page and on the editor — when the editor renders in either language, then the date shows day, month and year as `DD.MM.YYYY` and the time shows `HH:mm` on the 24-hour clock with no AM/PM section, on MUI's picker with a calendar and a clock in the backoffice's language, whatever date order or clock the organizer's browser locale would show; an e2e test on an afternoon hour reads the picker's sections (`["30", "09", "2027"]`, `["19", "00"]`) and its own value (`30.09.2027`, `19:00`) before and after a save and a real full page load, on both viewports (2026-09-23, `DECISIONS.md` §345).
33. Given a backoffice date or time picker, when its form is submitted, then exactly one input posts under the field's unchanged name — a hidden one, carrying `YYYY-MM-DD` or `HH:mm`, or "" for an empty or half-typed box — and the picker's own input carries no name; a refused submit brings every value back as it was posted (§315), and a half-typed box stops the press with a sentence naming what is missing, as a native box's bad input did; a server-rendered unit test checks the posted input in both languages (2026-09-23, `DECISIONS.md` §345).
34. Given a backoffice date or time box and a browser that runs no JavaScript, when the page renders, then the box is a plain text input under the same name whose `pattern` accepts only the posted shape (`YYYY-MM-DD`, or `HH:mm` from `00:00` to `23:59`), with a placeholder saying the shape, so the form still saves and the server's parse is untouched (2026-09-23, `DECISIONS.md` §345).
35. Given the date and time pickers and their date library, when any route is built, then they reach only `/admin` routes — the one `PickerProvider` is mounted by the backoffice layout — and a unit test that walks every value import back from the picker modules fails if a public route or `/devs` would carry them (2026-09-23, `DECISIONS.md` §345).
36. Given a birth date — the public registration form's or the staff form's — when the form renders, then it stays the browser's own date box, never the backoffice picker: a date decades back is typed faster than it is paged to, and the public form never loads the picker (2026-09-23, `DECISIONS.md` §345).
37. Given the create page or the editor of an event with a programme, opened as a new document rather than by a client navigation, when the event's start date moves from one day to another, then every programme row with a date moves by the same number of days even though the picker replaced the scriptless box during hydration; the e2e test proves each page was a new document, and fails against the code as it was before the fix (2026-09-23, `DECISIONS.md` §345).
38. Given any time the backoffice displays rather than asks for — the stale-data notice included — when it renders in either language, then it is on the 24-hour clock (`hourCycle: "h23"`), never AM/PM (2026-09-23, `DECISIONS.md` §345).
39. The draft line's explanation says where automatic publication is switched on: the source event's "Evenimentul se repetă", with its button's own label. It says one date is published from its own editor, and that ticking a series on the list ticks every date, which "Publică cele bifate" then publishes. The texts appear on both projects, with line breaks kept (`tests/unit/content/series-drafts-line.test.ts`, `tests/e2e/series-drafts.spec.ts`).
40. Given `/admin/events/new` and the editor of an event, when either renders, then both are one page (`EventEditorLayout`). A side column holds "Publicare" and "Recurență", first in the document on a phone and pinned to the right from `md` up. The main column holds the boxes in three labelled groups: "Evenimentul", "Ziua evenimentului și participanții" and "Traseu, legături și prezentare". Each box answers one question and shows its answer on its closed line. The create page leaves out only what needs a saved event: the status box (it posts `SCHEDULED`), allocation and printing, the series' details, the registrations, copy and delete. No field is renamed: every input posts the name it posted before (amends criteria 19, 25 and 26) (2026-09-23, `DECISIONS.md` §350).
41. Given a box that holds text per language — title and summary, description, place, programme, rules, page address — when it renders, then it has its own Română | English tabs, and each tab carries a live "· incomplet" mark. That mark follows the box's own rule: required, or blank while another language has the text. It agrees on first paint and on every keystroke. There is no page-wide language switch (2026-09-23, `DECISIONS.md` §350).
42. Given the box "Participare și înscrieri", when it renders, then it holds everything about registration. First comes the cost, on every type, with its amount and its payment or donation link shown only while the chosen kind needs one (§343). Then comes the mode. "Pe site" shows the places with the waiting list's length beside them (`capacity-row`), then five named cards: 8.1 the period; 8.2 conditions and the declaration, with the minimum age; 8.3 the confirmation window, with its three days on the calendar; 8.4 the race numbers, with the bib design on the create page too and, on the editor, allocation and printing; and 8.5 the public list. "La organizator" shows the organizer's name and link. "Fără înscrieri" shows one sentence. A group run shows only its sentence under the cost (2026-09-23, `DECISIONS.md` §350).
43. Given a box that the chosen type, the chosen registration mode or "Locația se anunță mai târziu" hides, when it holds a value — blank or wrong — and the organizer presses Salvează or a create button, then two things hold. The browser does not refuse the press over it: a hidden box is read-only, which the browser does not check, and it is still posted and kept. The service does not refuse it either (`ignoreHiddenFields`, before the schema): it stores what the hidden box is stored as — no capacity, waiting-list length, declaration or public list outside "Pe site", no organizer fields outside "La organizator", nothing of the block on a group run. What every mode keeps — the confirmation days, the minimum age, the bib band — is checked as typed. A refusal about one of those shows its block until the type or mode changes, and changing it clears that reveal (extends criterion 10) (2026-09-23, `DECISIONS.md` §350).
44. Given "Locația se anunță mai târziu" switched on, when a map link typed as `www.harta.ro` while the place was shown is hidden by the switch, then the browser does not validate the hidden box, and the save goes through with the place still to be announced. The unusable link is stored as no link, while a valid hidden link is saved as typed. Given the switch turned off again, then the box is on screen with what was typed, and both the browser and the service refuse it (2026-09-23, `DECISIONS.md` §350).
45. Given the waiting list's length, when the mode hides it — "Fără înscrieri", "La organizator" or a group run — then the save stores no length, as it stores no capacity. Given a caller that does not post the box, then nothing is written, so a save that never mentioned the limit never lifts it. Where it is shown, a value that is not a count of people is refused, naming the box (amends BR-REQ-035-01's "refused like the capacity") (2026-09-23, `DECISIONS.md` §350).
46. Given the editor of a date in a series, when it renders for a role that edits settings, then the Salvare box asks "Doar această dată / Această dată și următoarele / Toate datele seriei" as one radio group, with "this and the following" preselected (reversing §240). A sentence counts the dates the save reaches and names the first and the last, and the dates one by one are folded under it, open while the ticks are hand-picked. The header's date chips are gone. The service contract is unchanged: exactly the ticked dates, only the fields that changed (amends criteria 15, 16, 17 and 22) (2026-09-23, `DECISIONS.md` §350).
47. Given any date of a series, when the editor renders, then the "Recurență" box is open. It shows the rule as a sentence with its end, the next five dates from midnight in the event's zone, and how the series renews itself. It holds the tick "Publică datele noi automat" with its own "Salvează setarea": a draft source stores the switch and waits, and switching it on asks for the role that publishes. It also offers "Oprește recurența", confirmed, which resolves a copied date to its source. On the create page the box's tick "Publică datele noi automat" is ticked by default and posted as `repeat.publish`, and the rule stores the flag that was asked (2026-09-23, `DECISIONS.md` §350).
48. Given an event with at least one real registration, when the editor renders, then the boxes a change reaches — "Data și ora", "Locul", the programme, "Participare și înscrieri" and the status — turn amber with the count of real registrations. Each box's first line says what a change there does to those people. A test registration is counted nowhere in this (`AGENTS.md` §12.6) (2026-09-23, `DECISIONS.md` §350).
49. Given a refusal from the server, or the browser's own refusal of a box inside a closed box, card or unselected tab, when the page says so, then every fold and tab around the named box opens, so it can be focused. The refusal summary's label starts with the title of the box that holds the field, for example "Participare și înscrieri › Suma" or "Locul › Română › Numele locului". A partner's link is named by card and row (2026-09-23, `DECISIONS.md` §350).
50. Given the create page, when an organizer types a title, then the page address fills itself in each language until it is edited by hand, and "Titlu și rezumat" is open as the page's primary fold. A weekly group run is the title, the summary, the date, the place, the repeat tick and "Creează și publică". A Volunteer who opens the editor is sent back. Repeat, stop and duplicate are offered only to the role the service allows (2026-09-23, `DECISIONS.md` §350).
51. Given the box "Parteneri — „Împreună cu”", when it renders, then each partner is a card of its own: a name and its typed links (§344). The cards are read through the one function that understands every earlier stored shape, and are carried by a duplicate, a repeat and a series save as before (2026-09-23, `DECISIONS.md` §350).
52. Given any date the editor or the create page displays — box summaries, risk sentences, the confirmation card's three days, the series' dates, the Salvare sentence, the rule's end, the renewal horizon, "thanks sent on" — when it renders in either language, then it is written by `src/i18n/dates.ts` in the short form with its weekday. It uses the reader's language and the event's own zone, capitalised where it starts a line and in lower case inside a sentence. No client island formats a date: the series' dates reach the islands as server-written strings, and the live rule sentence is handed its weekday names. While the rule's end is being typed, that sentence echoes it in the pickers' `DD.MM.YYYY` (2026-09-23, `DECISIONS.md` §350).
53. The draft line's explanation on the events list says where automatic publication is switched on: on any date of the series, in the "Recurență" box, tick "Publică datele noi automat" and press "Salvează setarea" — the controls' own labels, read from the catalogue. It also says that one date is published from its own editor, and that ticking a series on the list ticks every date, which "Publică cele bifate" then publishes (amends criterion 39) (2026-09-23, `DECISIONS.md` §350).
54. Amends criterion 31. Given a series row with drafts still ahead, when the backoffice list renders, then the line's words name why they are drafts: "N date noi, create automat, nu sunt pe site:" (singular "1 dată nouă, creată automat, nu e pe site:") when the source is published and the rule's automatic publication is off; "N date ale seriei nu sunt pe site — seria nu e publicată:" when the source is not published; "N date în ciornă, nu sunt pe site:" otherwise. Noun, adjective and verb agree with the count in both languages. Each date still ahead links to its own editor. A "?" carries at most one sentence of about 25 words, and appears only in the first two cases (`DECISIONS.md` §351). Verification: unit `content/series-drafts-line.test.ts`, `events/series-drafts.test.ts`; e2e `series-drafts.spec.ts`.
55. Given that line on a series whose source is published, or whose drafts were made by hand, and a role that may publish, when "Publică" is pressed and confirmed, then exactly the drafts still ahead that the line counts are published. That is every one of them, not only the linked ones, and never a past, published or archived date. They go through the list's bulk publication, each with the version it was loaded with, so a refused date is counted and left. The browser returns to the list with the published and failed counts, and the line disappears once no draft is left. Given a source that is not published, then no "Publică" is offered, and "Deschide seria" leads to the source's editor instead (`DECISIONS.md` §351). Verification: unit `content/series-drafts-line.test.ts`; e2e `series-drafts.spec.ts`.
56. Given that line on a series whose source is published and whose automatic publication is off, and a role that may create events and publish, when "Publică automat de acum" is pressed and confirmed, then the rule on the series' source is switched on, and the browser returns to the events list, not the editor. The list's banner says the dates already created stay drafts until "Publică" is pressed, and the dialog says the switch acts on the dates created from now on. The action reads `returnTo` only as the exact word `list`: any other value, an address included, returns to the editor as before (`DECISIONS.md` §351). Verification: unit `content/repeat-publish-action.test.ts`; e2e `series-drafts.spec.ts`.
57. Given the event editor, when the note or the reason is shown, then it is two boxes, Română and English, side by side, each at most 500 characters. The same words typed in both show an amber "is it translated?" line (§354, amending criterion 30's single note). Verification: e2e event-notices.spec.ts.
58. Given an event whose summary, description, rules, programme notes, what to bring or a partner's description says the same words in English as in Romanian (normalized, longer than 40 characters), when the editor or the create page renders or is typed into, then the box shows an amber warning, the English tab reads "· identic cu româna", the closed line reads "EN identic cu RO", and the Publicare box lists it under "De verificat" with a link to the English box. The save and publication are never refused for it. A short identical text, a title for example, is not flagged (§354). Verification: unit content/bilingual-everywhere.test.ts, content/box-summaries.test.ts; e2e identical-languages.spec.ts.
59. Amends criterion 40. The main column's three groups are "Evenimentul", "Ziua evenimentului și participanții" and "Parteneri și prezentare". The create page shows the status card read-only ("Programat", disabled, posting nothing, with a hidden `SCHEDULED` beside it) instead of leaving it out (2026-09-24, `DECISIONS.md` §358).
60. Given `/admin/events/new` or the editor of an event, when the box "Ce fel de eveniment" renders, then under the type and its help it holds three named level-3 cards, in this order: "Starea evenimentului", "Traseul", "Linkuri și fișiere". Each card is closed by default and shows its own closed line, and each keeps its id (`#box-status`, `#box-course`, `#box-links`) and posts the names it posted before. The box's closed line shows the type, the status, the course's surface, difficulty and distance, and the number of links, plus "etichetă într-o singură limbă" when a link row carries a label in one language only. A refusal of a field inside a card opens the box and the card. Verification: unit `content/editor-first-card.test.ts`, `content/editor-order.test.ts`, `content/create-page.test.ts`; e2e `event-route.spec.ts`, `forms-keep-values.spec.ts` (2026-09-24, `DECISIONS.md` §358).
61. Amends criterion 48. Given an event with at least one real registration, when the editor renders, then "Ce fel de eveniment" is also amber and shows the count while closed, because the status card inside it is one of the boxes a change reaches. The sentence about what a change does stays in the status card, and the course and links cards are not marked. Verification: unit `content/editor-first-card.test.ts`, `content/editor-order.test.ts` (2026-09-24, `DECISIONS.md` §358).
62. Given the event editor or the create page, when a fold inside a language tab (the summary, the description, the programme's notes, the rules) is opened or closed in one language, then the same fold in the other language is open or closed when its tab comes forward. This holds for as long as the page is open, and across a refused save. The server's HTML is unchanged: every such fold arrives closed. The other language's editor mounts when its tab is shown. Closing a fold never discards what was typed in it, and the form posts the typed document (§363). Verification: unit shared/twin-folds.test.ts; e2e editor-language-folds.spec.ts.
63. An event may set its own reminder lead in the editor (as usual, 24, 48 or 72 hours, or none): null is the club's number and zero is no reminder. The database refuses anything outside 0–168, and a series edit and a copy carry the choice (2026-09-25, `DECISIONS.md` §377).
64. The event editor offers "Necesită frontală" / "Headlamp required" in the "Traseul" card; it is stored per event, false by default, carried by the series scope and kept by a duplicate and every date a series makes.
65. Given the event editor or the create page, when the "Traseul" card renders for a reader who may write a language's texts, then it holds, under its own Română | English tabs, the rich-text field "Descriere traseu / antrenament" / "Route / training description", posted as `translations.<locale>.routeDescription`. It is the description's editor, folded until opened and taking pictures, with the help line "Punctele de oprire, pantele, ce să aștepți — și o hartă, dacă ai una". A description in one language only is refused at save and on create, naming the empty language's box. The same words in both languages (over 40 characters) are warned about and never refused. The card's closed line adds "cu descriere" / "with a description", or "descriere într-o singură limbă". A Redactor, who may not change the settings, gets the card as a fold with only these tabs. A series edit carries the text to the dates the scope radio names; a duplicate and every date a series makes keep it. A picture in it (or in the rules or the programme's notes) counts as used, so the orphan sweep never deletes it. Verification: unit `events/route-section.test.ts`, `content/editor-order.test.ts`; integration `cms/route-description.test.ts`, `cms/both-languages.test.ts`; e2e `route-description.spec.ts` (2026-09-25, `DECISIONS.md` §387).

**Verification:** integration `cms/crud.test.ts`, `cms/workflow.test.ts`, `cms/repeat.test.ts`, `cms/turn-up-events.test.ts`, `cms/programme-rows.test.ts`; e2e `cms-publish.spec.ts`, `event-route.spec.ts`, `events-bulk.spec.ts`

#### BR-REQ-050-03 — The club writes its own standing pages

- **Source:** BR-BUS-050
- **Implements:** AGENTS.md §9.2, §11.2, §11.5, §12.9
- **Priority:** SHOULD
- **Release:** M1

"About Brașov Runners" and its like: text that is not an event and not legal wording. A
deliberately small content type — no galleries, no media library and no cover image. The body is
written in the editor of `AGENTS.md` §11.3 and stored as validated JSON; it was the legal
editor's plain-text format until 2026-09-17, when the club needed to write an About page and the
format was what stood in the way (`DECISIONS.md` §58, following §51 and §46).

**Acceptance criteria**

1. Given an Editor, when they create a page, then it is a draft with a translation in every locale, reachable from no public URL until published.
2. Given a page, when it is published, then every locale is complete or the transition is refused, naming the language and what it is missing — the same rule an event follows (AGENTS.md §11.2).
3. Given a published page, when it is requested at its own locale's address, then it renders; and when it is requested at another locale's address, then it is a 404 rather than the other language's text (BR-REQ-040-02).
4. Given a published page, when the language switcher is used, then it lands on the same page's address in the other language.
5. Given a page saved with a version somebody else already superseded, when it is submitted, then it is a CONFLICT and neither the page row nor either translation is written (AGENTS.md §11.5).
6. Given a published page, when its address is edited, then it is refused: links already shared have to keep working.
7. Given a page address, when it is submitted, then it is lowercase letters, digits and hyphens, is not a reserved word, and is not already in use in that locale.
8. Given published pages, when the public header renders, then each appears as a navigation entry in the order the club set, and when the sitemap is produced, then each published locale's address is listed.
9. Given a volunteer, when they attempt to create or edit a page, then it is refused; given a copywriter or an Editor, then it is allowed; deleting a page and ordering the navigation stay with the Editor (§103).
10. Given the rich-text editor — on a page, on an event's description or on its short description — when a staff member presses the picture control and chooses a JPEG, PNG or WebP (or pastes or drops one as a file), then the browser shrinks it to at most 2000px, `POST /api/admin/media` stores it exactly as a gallery photo is stored (two WebP variants through the §17 adapter, one `media_assets` row naming who uploaded it), and the editor inserts an image block carrying the stored variant's address and size, an empty alt and no caption; the schema refuses an image whose address is not one of this site's stored variants (a third party's image, a data URI, a pasted `<img>` from another site); the page renders it as a lazy `<img>` sized by its stored dimensions; a picture is a block between paragraphs, never inline (2026-09-18, `DECISIONS.md` §72).
11. Given a picture in the editor, when it is clicked, then a panel beside it offers its alt text, an optional caption, one of four widths (100, 75, 50 or 33 percent of the text column on a wide screen; always the full width on a phone), removal, and the pictures already stored to choose from instead of uploading again; the page renders the caption as a `<figcaption>` and the width as the figure's; and while any picture in the body has no alt text, a dimmed sentence under the editor says how many — a sentence, never a block on saving (2026-09-18, `DECISIONS.md` §73).
12. Given the page editor, when a body is written, then headings, bold, italic, links, bulleted and numbered lists and quotations are available, each with a keyboard-reachable control carrying its own name; and when the page renders, it shows what the editor showed.
13. Given a body posted to the server, when it contains any node, mark or attribute outside the allowlist of `AGENTS.md` §11.3 — or a link that is not http, https, mailto or a path on this site — then the save is refused, whatever produced it.
14. Given a stored picture referenced by no gallery item, no album cover and no body — a draft page or event counts as a reference — for more than seven days, when the registration-maintenance job runs, then its row and both objects are deleted, last in the run and in its own try/catch, and `/devs` shows how many pictures are stored, how many are used nowhere and how many the next run will take; given the pictures page (`/admin/gallery/pictures`), when an editorial role opens it, then every stored picture is listed with where it is used, each use a link to that page, event or album, and a picture in use cannot be deleted from there (2026-09-18, `DECISIONS.md` §73).
16. Given the editor, when a YouTube address is entered in its "YouTube" control, then only the eleven-character video id and a caption are stored as a `youtube` block — any other host or a malformed address is refused under the field — and when the body renders, the film is a closed disclosure with the `youtube-nocookie.com` embed lazy inside it, the caption as its summary and beneath it, so nothing is fetched from YouTube until the reader presses (`DECISIONS.md` §110).
15. Given a page, when it is deleted, then it and both translations go — permitted where deleting an event is not, because nothing a participant owns hangs off a page.
16. Given the standing-page editor, when a page is saved with its search-engine title or description written in one language and empty in the other, then the save is refused on the empty box and the rest of the form comes back as typed. Both or neither is accepted (§354). Verification: unit content/bilingual-everywhere.test.ts.
17. Given the rich-text editor (a standing page, an event's texts, an email's words), when its toolbar, the bar over a selection or the table's bar renders, then every button shows a filled Material glyph at 20 px in the button's own colour, except "H2" and "H3", which are words at the same height. Each button carries its full name as its accessible name and as a tooltip shown on hover and on a long press that never takes the pointer, keeps a 44-pixel target and its pressed state, and no button's face is an emoji, an arrow or a box-drawing character. The table's bar and the selection's bar draw above the sticky toolbar (§361). Verification: unit `content/editor-toolbar-icons.test.ts`; e2e `pages.spec.ts`, `rich-text-tables.spec.ts` (buttons found by the same names).
18. Amends criterion 17. Given the rich-text editor in a production build (a standing page, an event's texts, an email's words), when a word on the first line is selected, or the caret is inside a table, then every button of the bar that appears shows its glyph above the sticky toolbar. The glyph has a size, a colour that is neither transparent nor the bar's surface, and the point at its centre belongs to its own button. Nothing the bars need is passed to Tiptap's BubbleMenu beyond the plugin's own props (§363). Verification: unit content/editor-toolbar-icons.test.ts; e2e rich-text-tables.spec.ts, editor-language-folds.spec.ts.

**Verification:** integration `cms/pages.test.ts`; integration `cms/boundary.test.ts`; integration `cms/media-references.test.ts`; unit `content/rich-text.test.ts`; e2e `pages.spec.ts`

#### BR-REQ-054-01 — The photo gallery: albums on R2, light by construction

- **Source:** BR-BUS-050, BR-BUS-052
- **Implements:** AGENTS.md §12.10, §17, §9.2, §8
- **Priority:** SHOULD
- **Release:** M1 — pulled forward from M5 on 2026-09-17 as the small version (`DECISIONS.md` §66); the media library for other content, captions and the Tiptap image node stay M5.
- **Status:** built; needs the R2 bucket of `SETUP.md` §32 on a deployed environment.

**Acceptance criteria**

1. Given an editorial role, when they create an album, then it has a date the photos were taken, an optional event it is from, and a title, address and optional description in every language; it is a draft with no photos.
2. Given an album, when a photo is uploaded, then the browser first shrinks it to at most 2000px on its long side and posts it as WebP, one request per photo; the server decides the format from the bytes, refuses anything but JPEG, PNG and WebP (SVG included), refuses a file over 6 MB or under 200px on a side, rotates it upright, drops every EXIF field including the GPS position, and stores exactly two WebP variants — `web` (≤1600px) and `thumb` (≤480px) — under an opaque key prefixed with the environment. The original is not kept.
3. Given an album's first photo, when it is stored, then it becomes the album's cover; any photo can be made the cover later; removing the cover moves it to the first remaining photo.
4. Given an album with no photo, when publication is attempted, then it is refused with a reason. Given one with photos, when it is published, then both languages go live together and its address stops changing (§11.5).
5. Given the public gallery, when it renders, then it lists published albums newest first with cover, title, date and count, and an album page shows its photos as thumbnails in upload order, each a plain link to its `web` variant, every image with its dimensions and lazy loading, and no script — a locale with no translation is a 404, never the other language (BR-REQ-040-02). The "Galerie" section appears in the site navigation only while a published album exists.
6. Given a photo or an album that is removed, when the removal completes, then its rows are gone first and its objects are deleted from storage afterwards — an object without a row is a cost nobody notices, a row without an object is a broken image somebody does.
7. Given a deployed environment without the five `R2_*` variables, when it boots, then it boots; albums can be created, uploads are refused with a sentence, `/admin/tasks` shows the storage task open with the steps, and the site's public gallery is simply empty. Locally photos live under `.media/` and in tests in memory, so neither needs a bucket.
8. Given the images the site serves, when they are loaded, then they come from `R2_PUBLIC_BASE_URL` (Cloudflare, egress free) and never through a function; a hostname appears nowhere in `src/` — the S3 endpoint and the public base are configuration.
9. Given a photograph uploaded through the editor or the gallery, when it is stored, then it has been encoded lossily once and not twice — the browser sends the original whenever the server will accept it — and the web variant is 2400px at quality 88, which is what a full-width picture needs on a 2× screen (2026-09-20, `DECISIONS.md` §176).
10. Given the album form, when it renders, then the album's day is the backoffice date picker (`30.09.2026`), posting `takenOn` as `YYYY-MM-DD` exactly as before and coming back after a refused submit (2026-09-23, `DECISIONS.md` §345).
11. Given the album editor, when an album is saved with its description in one language only, then the save is refused on the empty box and the rest is kept. Both or neither is accepted (§354). Verification: unit content/bilingual-everywhere.test.ts; integration cms/gallery.test.ts; e2e gallery.spec.ts.

**Verification:** unit `media/images.test.ts`; integration `cms/gallery.test.ts`; e2e `gallery.spec.ts`

#### BR-REQ-051-01 — Editorial workflow and permissions

- **Source:** BR-BUS-051, BR-BUS-060
- **Implements:** AGENTS.md §11.2, §13.1
- **Priority:** MUST
- **Release:** M5
- **Status:** built for events during M1 (`DECISIONS.md` §25); it applies to articles and pages
  when those exist. Criterion 2 changed with `DECISIONS.md` §28: publication is one state for
  the whole event rather than one per language (`DECISIONS.md` §28).

**Acceptance criteria**

1. Given a copywriter (`COPYWRITER`), when they work in the CMS, then they can edit the text of any event or page at any status — with the live-edit acknowledgement on published content — create page drafts and submit any draft for review, and cannot publish, configure an event, or touch the gallery; given a volunteer (`CONTRIBUTOR`), then every text is refused and their backoffice is the desk and the guide (`DECISIONS.md` §103).
2. Given an **Administrator**, when they review a submission, then they can publish, unpublish, and archive the event, and both languages go live or come down together; given an Organizer (`MODERATOR`), then those four moves are refused — they prepare, submit and return work, and archive what was never published — because every move that crosses into or out of public view belongs to the Administrator (2026-09-20, `DECISIONS.md` §201). *Editing the text of an already-published page is not yet part of this and remains the copywriter's with the acknowledgement of criterion 4: raising it would reverse criterion 3, and §201 records why that is the club's decision rather than the platform's.*
3. Given published content, when a volunteer attempts to edit it, then it is refused; a copywriter's live edit is accepted with the acknowledgement of criterion 4.
4. Given a save that affects live content, when it is submitted, then the interface warns before it takes effect.
5. Given two editors saving the same record, when the second save carries a stale version, then it is rejected as a conflict, and the first editor's save survives intact. This is verified with two real database connections, not the in-process test database, which is single-connection and cannot express the race. The event row carries a version of its own, so a publish that races a change to the event is a conflict too.
6. Given an event where any language is missing a field the public page renders, or has no translation at all, when publication is attempted, then it is refused with the language and the missing fields named, and nothing goes public.
7. Given a save refused as a CONFLICT, with JavaScript on or off, when the form renders again, then each version guard (the event row, each translation, a page, an album) is recalled with the boxes rather than re-read from the database, so a second press is refused as well and the colleague's save survives; the summary says to copy what is needed and reload rather than send again (2026-09-23, `DECISIONS.md` §315).
8. Only the chosen registration mode's fields are shown in "Participare și înscrieri"; a capacity, declaration or public list posted with a mode other than on-site registration, and an organizer name or link posted with a mode other than elsewhere, are saved as none rather than refused.
9. A refusal of the event form — by the browser or the server — opens every closed box and card around each field it names and brings that field's language tab forward, with every value kept (e.g. a missing declaration on an on-site registration opens "Participare și înscrieri" › "Condiții de participare și declarația").
10. Given a role without settings rights (Redactor) on the event editor, when "Ce fel de eveniment" renders, then "Setările le schimbă un Organizator sau un Administrator." appears exactly once, in place of the type. Its three cards are shown as their headings and closed lines with nothing to open, and no `event.*` field is posted. Verification: unit `content/editor-first-card.test.ts`; e2e `cms-publish.spec.ts` (2026-09-24, `DECISIONS.md` §358).
11. Migration `0072_family_registration` is expand-only: it adds the name key and its unique index beside the one-registration-per-address constraint. The family flow stays closed, and no link is offered, until a later contract migration drops that constraint. `family-gate.ts` reads the catalogue, so the flow opens with no flag and no deploy of its own (2026-09-25, `DECISIONS.md` §389).

**Verification:** integration `cms/workflow.test.ts`; concurrency `cms-conflict.test.ts` (`yarn test:concurrency`); e2e `cms-publish.spec.ts`

#### BR-REQ-051-02 — Protected preview

- **Source:** BR-BUS-051
- **Implements:** AGENTS.md §11.5
- **Priority:** MUST
- **Release:** M5
- **Status:** built for event translations during M1 (`DECISIONS.md` §25).

**Acceptance criteria**

1. Given a preview URL, when it is opened without staff authorization, then access is refused before any row is read, so the response does not reveal whether the draft exists.
2. Given a preview page, when it renders, then it carries `noindex`, is absent from the sitemap, and is not publicly cached.
3. Given a preview URL, when it is opened by staff, then it renders the translation of the locale in that URL, whatever its editorial status.

**Verification:** integration `cms/preview.test.ts`; unit `seo/private-paths.test.ts`; e2e `cms-publish.spec.ts`

#### BR-REQ-052-01 — Publication quality gates

- **Source:** BR-BUS-052
- **Implements:** AGENTS.md §11.6, §20
- **Priority:** SHOULD
- **Release:** M5

**Acceptance criteria**

1. Given an image without alternative text, when publication is attempted, then it is blocked or clearly warned.
2. Given content generated with AI assistance, when it is created, then it remains in Draft until a human publishes it.
3. Given a published article, when it renders, then it carries a title, summary, SEO description, and locale metadata.

**Verification:** integration `cms/quality.test.ts`

#### BR-REQ-052-02 — Structured data for events, articles, and the club

- **Source:** BR-BUS-052, BR-BUS-010, BR-BUS-034
- **Implements:** AGENTS.md §18.1
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given the homepage, when it renders, then it contains one `SportsOrganization` JSON-LD block with a stable `@id`, the club name, logo, URL, and `sameAs` entries for the club's official profiles. `sameAs` comes from `CLUB_FACEBOOK_URL`, `CLUB_INSTAGRAM_URL` and `CLUB_STRAVA_URL` and is omitted where none is configured; `logo` is still absent and needs an approved raster (`DECISIONS.md` §58).
2. Given a published event page, when it renders, then it contains a `SportsEvent` block whose start and end times carry the event timezone offset, whose `organizer` references the club `@id`, whose `location` includes a postal address, and whose `image` lists the event's two cards (2026-09-19, `DECISIONS.md` §155).
3. Given a capped event, when the block renders, then `remainingAttendeeCapacity` equals the free-place count displayed on the same page.
4. Given a cancelled event, when the page renders, then the block is still present with `eventStatus` set to cancelled.
4a. Given a race with a gun time distinct from the event start, when the block renders, then `startDate` is the race start and `doorTime` is the event start; with no distinct gun time, `startDate` falls back to the event start.
5. Given a published article (M5), when it renders, then it contains an `Article` block with `datePublished` and `dateModified`.
6. Given any structured data block on any page, when it is inspected, then it contains no participant name, email, registration list, or declaration content.
7. Given the test suite, when it runs, then it parses the emitted JSON-LD and asserts the required properties are present.
8. Given a published event page, when it renders, then its `og:image` is a 1200×630 card drawn on the server from the event's own facts (title, date and time, meeting point, distance), absolute under `APP_BASE_URL`, with `twitter:card = summary_large_image`; every other public page carries the site's card; and the event page offers, as 44-pixel buttons, the phone's own share sheet where `navigator.share` exists, Facebook, WhatsApp and, under "Instagram", the same card shared through the phone's own sheet where a file can be shared from a coarse pointer — otherwise offered as a download and labelled as one — with "add to calendar" as its own row; and the footer's three social marks are 44×44 items of one wrapping row, never drawn over the text or the build badge at any width (2026-09-18, `DECISIONS.md` §90; 2026-09-19, §140; 2026-09-23, §299).
9. given a DONATION event, when its block renders, then it carries `isAccessibleForFree: true` and the free event's `Offer` at price `0` in `RON` at the event's own page. A donation link, when given, is a `DonateAction` target and never the offer's `url`, and no price is parsed from the free-text amount. A PAID event is unchanged: `isAccessibleForFree: false`, and an `offers.url` only for an https payment link (§369, amending §343).
10. Given a published event that the club registers itself (registration mode INTERNAL, not a group run) with a minimum age N above 0, when its block renders, then it carries `typicalAgeRange: "N-"`; with N = 0, or for an event registered elsewhere or not at all, the property is absent (2026-09-23, `DECISIONS.md` §329). Verification: unit `events/structured-data.test.ts`; e2e `registration-form.spec.ts`.
11. criterion (new): the SportsOrganization and SportsEvent organiser name, the page title, the header link's and wordmark's accessible names, the share pictures, the calendar's PRODID and feed file name, the legal PDF's Author and the EMAIL_FROM_NAME default are all `CLUB_NAME`. No string under `src/` outside `theme/brand.ts` and the seeds names the club, and a test fails otherwise (§369).

**Verification:** integration `seo/structured-data.test.ts`; e2e `event-page.spec.ts`

#### BR-REQ-070-03 — Public content is machine-readable and crawler policy is explicit

- **Source:** BR-BUS-052, BR-BUS-070
- **Implements:** AGENTS.md §18.4
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given any public page, when its server HTML response is fetched without executing JavaScript, then the page's substantive content is present in that response.
2. Given an event page, when its text is extracted, then the date, start time, meeting point, cost, and registration requirement are present as text rather than only as component styling or an image. Cost is `events.cost_type`, `FREE|PAID`, rendered in the reader's language; when it is null the page states nothing about cost rather than assuming the event is free.
3. Given a cancelled or full event, when its text is extracted, then that status is stated in words.
4. Given production `robots.txt`, when it is fetched, then admin, API, participant action and manage paths, declaration pages, preview, and runner profiles are disallowed for every user agent.
5. Given production `robots.txt`, when it is inspected, then the training-crawler policy recorded in `DECISIONS.md` is reflected, with the verification date of the user-agent names recorded.
6. Given a request identifying as a crawler, when a public page is served, then the content is identical to what a person receives.

**Verification:** integration `seo/machine-readability.test.ts`; e2e `robots.spec.ts`

#### BR-REQ-053-01 — Legal documents are versioned and immutable

- **Source:** BR-BUS-053
- **Implements:** AGENTS.md §12.5, §11.1
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a legal document key, when a version is approved, then it carries a version number, an effective date, an approval record, a content hash, and Romanian and English bodies.
2. Given a version that a participant has accepted, when any edit is attempted, then it is rejected.
3. Given a new version, when it becomes effective, then earlier acceptances continue to reference the version that was accepted.
4. Given a version that is approved or referenced, when any interface attempts to change its text, then it is refused — editing is confined to unapproved, unreferenced drafts (BR-REQ-053-02). An approved version is also never deleted and its approval is never withdrawn (`DECISIONS.md` §53) — which is not the same as taking a version out of circulation: one that nothing relied on, and that is not the text in force, may be **withdrawn**, keeping its row, its number and its words (BR-REQ-053-02 criteria 16–19, `DECISIONS.md` §181).
5. Given the public site, when any page renders, then the privacy notice and terms are reachable in the current locale.
6. Given any environment other than production, when it is seeded, then a clearly marked sample version of each key exists, whose own rendered body opens — in both languages — with a banner saying that it is sample text, is not approved by the club, is not legal advice, and must be replaced before a real participant registers.
7. Given `APP_ENV=production`, when the sample text is seeded, then it is refused outright rather than skipped quietly; the club's approved wording is written in the backoffice (BR-REQ-053-02) or, where a migration is preferred, per `docs/RUNBOOKS.md` § Legal document version.
8. Given a sample document, when it is read, then every club-specific fact — the controller's legal name, address and contact, any representative, retention periods, and the lawful basis for each purpose — is an obvious placeholder rather than an invented value.

9. Given a legal text, when a paragraph carries `[the words](https://…)` or `![what it shows](https://…)` on a line of its own, then the page renders a link (https, mailto or a path on this site; anything else stays words) and a picture (https only, lazy, at most the column's width, its words as the caption); the PDFs render the link as "the words (address)" and the picture as its words; the stored body, its hash and the merge fields are the plain text as typed (2026-09-19, `DECISIONS.md` §127).
10. Given the approved privacy notice or terms, when its public page renders, then it says "Versiunea N, în vigoare din <date>" / "Version N, in force since <date>" under the title, and every section heading carries an id (#s1, #s2, …, prefixed per language where both languages are shown side by side) (§323).
11. Given the terms or the privacy notice served from the public cache, when a version is approved, withdrawn or deleted — or a version approved for a later date reaches its effective date with nothing saved — then the next visitor reads the version in force: the approval expires the cached text, and the text is keyed by the stretch between effective dates (§333). Verification: integration `public-cache/revalidation.test.ts`; unit `public-cache/clock.test.ts`.
12. Given the platform's declaration template, when it is read in either language, then it names the risks the runner accepts — terrain and falls, wild animals and dogs with what to do on meeting one, weather and darkness, the runner's own equipment including a working headlamp after dark, their own pace and decisions, protected areas and personal belongings — and every sentence in which the organiser does not answer for something is limited "în limitele permise de lege" / "to the extent the law allows"; none promises immunity.
13. Given any of the platform's legal templates or a seeded sample, when it is read, then it names no event, place, date, time, distance, amount or club fact as words: an event's facts are merge fields and a club's facts are placeholders; only the laws cited, the supervisory authority's statutory contact, 112 and the platform's own fixed periods are written in.
14. Given the sample seed or "start from the platform's text", when a text is produced, then every merge field of the template stays a merge field and every club fact the environment does not know stays its placeholder; re-seeding a changed template inserts the next version, and an unchanged one inserts nothing.
15. Given any string, template or JSX text under `src/` outside `theme/brand.ts` and the seeds, when it is read, then it does not name the club. The default sender name of every email and of the contact form, the share picture's heading, the calendar's product id and feed file name, and every PDF's Author read `CLUB_NAME`, and `EMAIL_FROM_NAME` still overrides the sender's name when it is set (2026-09-24, `DECISIONS.md` §369, §357). Verification: unit `notifications/no-hardcoded-values.test.ts`.
16. The notice on `/admin/legal` states the two refusals the service enforces, separately and without more: registration is refused while no approved privacy notice is in effect, and no place can be confirmed while no approved declaration is; a version somebody relied on is frozen and a correction is the next version; a version nobody relied on may be deleted. The notice folds closed by default and opens from `/admin/legal#legal-versions` (2026-09-25, `DECISIONS.md` §376).
17. The platform's templates of the terms and the privacy notice state the email link, the hold, the offer and the reminder through `{{confirmationHours}}`, `{{holdMinutes}}`, `{{offerHours}}` and `{{reminderClause}}`, merged from the setting when the text is shown. The approved text and its hash are untouched (2026-09-25, `DECISIONS.md` §377).
18. `{{reminderClause}}` never promises what one event can break. With a club default above zero it reads ", un memento cu <lead> înainte (sau cât alege evenimentul)" / ", a reminder <lead> before (or as the event chooses)". With a default of none it reads ", un memento înainte de start, dacă evenimentul trimite unul" / ", a reminder before the start where the event sends one", with no number and no dotted blank. A value given as "" leaves nothing behind (2026-09-25, `DECISIONS.md` §377).
19. The token legend in `/admin/legal` lists the four deadline tokens with an example in each language, written by the same function that fills the text in that language, and describes the reminder clause as it behaves (2026-09-25, `DECISIONS.md` §377).

**Verification:** integration `legal/versions.test.ts`; unit `legal/inline.test.ts`; e2e `legal-pages.spec.ts`

#### BR-REQ-053-02 — The club writes its own legal text

- **Source:** BR-BUS-053
- **Implements:** AGENTS.md §12.5, §11.1, §10.2
- **Priority:** MUST
- **Release:** M1
- **Status:** built, and recorded in `DECISIONS.md` §46 and §53. It narrows BR-REQ-053-01
  criterion 4 rather than reversing it: what may never be edited is a version somebody has
  accepted, and requiring a developer and a migration to *create* one was an accident of that
  rule rather than a consequence of it. §53 adds deletion for a version that was never approved,
  and records why un-approving an approved one is not offered.

**Acceptance criteria**

1. Given an Administrator, when they write a new version of a legal document, then it is created as the next version number for that key, unapproved, with its content hash computed from the text saved.
2. Given a draft that is unapproved and unreferenced, when it is rewritten, then the text and the content hash are replaced together, and neither can describe the other's contents.
3. Given a version that is approved, when an edit is attempted, then it is refused with a conflict and the words are unchanged.
4. Given a version that a participant has accepted or an event points at, when an edit is attempted, then it is refused with a conflict.
5. Given a draft, when it is approved, then it becomes public from the moment of approval, records who approved it, and can no longer be edited.
6. Given an approved version, when approval is attempted again, then it is refused.
7. Given a document written in only one language, or with an empty body in either, when it is saved, then it is refused — a public page cannot fall back to the other language (BR-REQ-040-02).
8. Given any role below the one that administers staff, when any of this is attempted, then it is refused.
9. Given a version that was never approved and that nothing references, when it is deleted, then the version and its text in every language are removed together, and the version number becomes available again.
10. Given a Superadministrator on `/admin/legal` while any of the three documents has no approved version, when the club's four facts are set (`CLUB_LEGAL_NAME`, `CLUB_REGISTRATION_NUMBER`, `CLUB_REGISTERED_ADDRESS`, `EMAIL_REPLY_TO`), then one press creates and approves version 1 of each missing document from the platform's text with the facts written in, in the presser's name and effective at that moment; a document already in force is left alone; a fact still unknown refuses the whole act naming the placeholder, and the page names the missing variable instead of the button; below the Superadministrator it is refused (`DECISIONS.md` §132).
11. Given a version that is approved, when deletion is attempted, then it is refused with a conflict whether or not anything references it — the record of what the club published outlives whether anybody acted on it.
12. Given a version that an acceptance names, an event points at, or a registration recorded the number of as the privacy notice it acknowledged, when deletion is attempted, then it is refused with a conflict.
13. Given the backoffice list of versions, when it renders, then each row states how many acceptances, events and registrations depend on that version, and a version that cannot be deleted states which of those reasons applies rather than omitting the control.
14. Given a version deleted between the moment approval was checked and the moment it was written, when approval completes, then it is refused rather than reporting success.
15. Given an approved version, when withdrawing *the approval itself* is attempted — moving which version is current — then there is no such operation: `DECISIONS.md` §53 records that a declaration is bound to the participant at submission rather than at render, so changing which version is current would let somebody sign text they never read.
16. Given an approved version that no acceptance, event or registration depends on and that is not the version currently in force for its key, when an Administrator withdraws it, then the row, its number and its text in every language stay exactly as they were; it is no longer resolved as the version in force, no longer offered to the event editor, and no longer counted as “this key already has approved text”; and an audit row is written first, in the same transaction, naming the key, the version, its effective date, who approved it and the content hash of each language — never the text (`DECISIONS.md` §181).
17. Given the version currently in force for its key, when withdrawal is attempted, then it is refused whatever the counts say: zero acceptances is what a quiet week looks like, and taking the notice down would refuse every registration in the same instant (BR-REQ-053-01).
18. Given a version that is already withdrawn, or a draft, or a version something depends on, when withdrawal is attempted, then it is refused and no audit row is written; a withdrawn version still cannot be deleted, and the next version number still counts it.
19. Given the backoffice list of versions, when it renders, then withdrawn versions are folded behind a count rather than removed — a version that vanished from the screen that administers it would read as deleted, which is the impression withdrawal exists to avoid.
20. Given an approved terms version that is not the version in force and that no registration was submitted under, and no declaration was signed under, while it was the text in force, when a Superadministrator deletes it with the typed confirmation and a reason, then it is deleted, its number is retired and the audit row keeps its hash. This holds whether it was withdrawn first or not, and whether it was superseded before it ever took effect.
21. Given an approved terms version during whose time in force any registration was submitted (counting a registration whose first and latest submissions straddle that time) or had its declaration signed, of any kind and any source, when deletion is attempted, then it is refused with a conflict naming the count and the window, nothing is written, and withdrawal is still open to it.
22. Given the backoffice list of versions, when it renders, then each row offers deletion exactly when the service would delete it, because both ask the same function. A terms version shows how many registrations agreed while it was in force instead of "not used yet". One the service would refuse shows the reason, with the count and the dates, instead of the link.
23. Given the legal document editor, when its toolbar renders, then it is a toolbar named after its box. The heading and paragraph buttons read "H2" and "Text", and the link, the picture, undo and redo are filled Material glyphs of one size and colour. Each button is 44 pixels square and named by its `aria-label` and a tooltip (§361). Verification: unit `content/editor-toolbar-icons.test.ts`; e2e `legal-versions.spec.ts`.
24. Given the platform's privacy-notice template, when it is read, then its section 5 names the organizers' announcements about the event registered for (a change of place or time, a cancellation, or a message they write) under art. 6(1)(b), not marketing. The notice in effect on a deployment changes only when the club approves a new version in `/admin/legal` (2026-09-24, `DECISIONS.md` §364).
25. Given the legal document editor, when the page is first painted and before the editor has mounted, then the writing area already holds the stored text, drawn with the editor's own box and rules. It is hidden from assistive technology and holds nothing to focus, press or follow. When the editor mounts, the writing area keeps its height and nothing under it moves (2026-09-24, `DECISIONS.md` §369). Verification: unit `legal-documents/legal-body-reserved-height.test.ts`; e2e `legal-versions.spec.ts`.
26. Given the declaration's token legend, when it renders, then every token's example is made up and names neither the club, its wordmark nor its town. Each example is given in both languages where they differ, the reader's first. The dates are written by the helper a signature uses, and the declarant reads as a minor's signature produces it (2026-09-24, `DECISIONS.md` §369). Verification: unit `legal-documents/no-hardcoded-values.test.ts`.

**Verification:** integration `legal/editor.test.ts`, `legal/deletion.test.ts`, `legal/withdrawal.test.ts`

#### BR-REQ-053-03 — A legal document version downloads as a PDF

- **Source:** BR-BUS-053
- **Implements:** AGENTS.md §12.5, §9.2
- **Priority:** SHOULD
- **Release:** M1
- **Status:** built (`DECISIONS.md` §63). A rendering of a stored version — never a source of
  text — for the owner to read on paper, send to the club's adviser, or file.

**Acceptance criteria**

1. Given an Administrator on a version's page, when it renders, then it offers one download per language the version has, as a plain link to `GET /api/admin/legal/<id>/pdf?locale=<locale>` that works with JavaScript off.
2. Given that request, when it is answered, then the response is `application/pdf`, named `<key>-v<version>-<locale>.pdf`, not cached, and nothing was written anywhere but the response.
3. Given the file, when it is opened, then it carries the club's lockup, the version's title, its version number and effective date, and the text — headings and paragraphs as stored — with the club's name, the version, the content hash and the page number on every page; the metadata names the version and the full hash.
4. Given an unapproved version, when its PDF renders, then a band under the title says it is a draft with no effect; an approved version carries no such band.
5. Given the text, when it is set, then it is set in the site's own font with every Romanian diacritic, embedded in the file — the standard PDF fonts cannot spell ș or ț.
6. Given a role below Administrator, or no session, when the address is requested, then it is refused (403, 401) before any row is read.
7. Given the words on the file — "Version", "Effective from", the draft notice, "Page n of N" — when they render, then they are in the document's language, not the backoffice reader's.

**Verification:** unit `legal-documents/pdf.test.ts`; e2e `legal-versions.spec.ts`

### 4.10 Transactional email

#### BR-REQ-080-01 — Message coverage

- **Source:** BR-BUS-080
- **Implements:** AGENTS.md §16.3
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given each message type in `AGENTS.md` §16.3, when it is rendered, then complete Romanian and English HTML and plain-text bodies exist.
2. Given a message, when it renders, then dates use the recipient's registration locale and the event timezone, and all links are localized absolute URLs derived from `APP_BASE_URL`.
3. Given the message catalog, when CI runs, then no message type lacks a template in either locale.
4. Given the confirmation or the reminder, when it renders, then it opens with one bold line — the event's date, time and meeting point — followed by the map link and the Strava event link when set, carries the translation's one-line "what to bring" (`event_translations.checklist`, ≤ 300 characters) when written, the desk code with its hosted QR, and the manage link; every message ends with "Reply to this email with questions" when `EMAIL_REPLY_TO` is set; text-first, no image but the QR, well under 100 KB (2026-09-18, `DECISIONS.md` §81).
5. Given a CONFIRMED registration to a SCHEDULED event with local registration, when the maintenance job runs within 48 hours of the start, then one `EVENT_REMINDER` is queued for it with the key `registration:<id>:reminder`, and a job that runs again queues nothing more; a WAITLISTED entry, a cancelled or completed event, an event further out, and a registration confirmed within the last 24 hours (its confirmation carries the same facts, §126) get none; the registration's state is untouched (`DECISIONS.md` §81).
6. Given an event that has started, when an Administrator presses "Trimite mulțumirile" on its page and confirms, then one `EVENT_THANKS` is queued for every registration checked in at that event — with the optional `https://` link the organizer typed — `events.thanks_sent_at` is set so the button is gone afterwards and a second press is refused, and an audit row names the event and the count, never a recipient; never automatic (`DECISIONS.md` §82).
7. Given any message, when it renders, then it carries both languages — the registration's own first, the other under a rule, the two subjects joined by " / " — as one branded card with the action as a button and the deep links beneath: the event's page, its rules when it has them, "I can't make it any more" (the manage page's `#cancel` section, a GET that mutates nothing) on the confirmation, and the signed declaration's PDF on the confirmation and the declaration message (2026-09-18, `DECISIONS.md` §96).
8. Given a signature, when it is recorded, then the confirmation queued for it carries the signed declaration attached as a PDF, rendered at send time from the rows (`DECISIONS.md` §95, §126); the Mailgun adapter posts attachments as `attachment` parts.
9. Given addresses left in "Anunță-mă" on a published internal event, when the maintenance job first runs after `registration_opens_at`, then one `REGISTRATION_OPENED` is queued per address — key `interest:<id>:opened`, no participant, the event's id in the payload, the interest row deleted in the same transaction — in the row's language, with the facts line and the ordinary registration page as the action, no token; a run before the opening queues nothing and keeps the rows; an event that is cancelled, has started, or was moved to another form loses its rows with no message; an unpublished event's rows wait (2026-09-19, `DECISIONS.md` §146).
10. Given any message the platform sends, when it renders, then its header band carries the club's lockup as a hosted PNG whose `alt` is the club's name, so a reader with images blocked sees what the band said before; the address derives from `APP_BASE_URL` (2026-09-20, `DECISIONS.md` §174).
11. Given the confirmation or the reminder for a **published** event, when it renders, then the event is attached as an `.ics` file built by the same function the event page uses — beside the signed declaration on the confirmation, never instead of it. Given an event that is not published, then the message goes without one (2026-09-20, `DECISIONS.md` §174).
12. Given any message the Mailgun adapter sends, when it posts to the provider, then `o:tracking`, `o:tracking-clicks` and `o:tracking-opens` are each set once, to `no`. No link, action links included, is rewritten through the provider's redirect host and no open pixel is added, whatever the domain's own tracking setting is (2026-09-23, `DECISIONS.md` §320).
13. Given any message to a participant about their registration (every type except DECLARATION_ARCHIVE, CLUB_CONFIRMATION_NOTICE and STAFF_INVITATION), when it renders, then each language half ends with who sends it (the club's legal name from CLUB_LEGAL_NAME, else "Brașov Runners") and the privacy notice's absolute address in that half's own language, derived from APP_BASE_URL. In the plain-text part nothing follows the address. REGISTRATION_OPENED says it was asked for rather than that it concerns a registration. The three club and staff types carry no such line, and the staff invitation says in its body what the club keeps about its team, linking the notice (§323).
14. Given a participant email copied to the club's address (§320's club copy), when it is rendered, then it carries no "this message is about your registration" privacy line, which is addressed to the participant; the participant's own message keeps it (2026-09-23, `DECISIONS.md` §324).
15. Given an organizer who may save the event row, when they save the event with "Anunță participanții despre schimbare" ticked and the save moved the place as a page shows it, the start or the race's gun time, or the programme's times or places, or put a cancelled event back on, or carries a note of at most 500 characters, then one EVENT_UPDATE_NOTICE is queued per active registration (PENDING_DECLARATION, WAITLIST_OFFERED, CONFIRMED, WAITLISTED) in its own language, in the save's transaction, keyed by the save and the registration, with no token. The row carries only which kinds changed, the values are read at send time, and it is audited as event.update_notice_sent with the kinds, the note and the count. Unticked, or with nothing of that kind changed and no note, nothing is queued and the banner says so. A series save tells each future date's own registrants once. Verification: unit events/event-changes.test.ts; integration cms/event-notices.test.ts; e2e event-notices.spec.ts.
16. Given an event whose place is to be announced, when a ticked save changes the name, the map link, a language's own name or a programme row's place while the place stays hidden, then no place or programme change is counted. When the save announces the place, then a place change is counted whatever else changed. When the save hides an announced place, then none is counted. Verification: unit events/event-changes.test.ts.
17. Given a save that moves an event to CANCELLED, when it has no reason, then it is refused naming cancel.reason and nothing is written. With a reason and "tell the participants" left ticked, then one EVENT_CANCELLED carrying the reason is queued per active registration, no registration changes status, and event.cancelled is audited with who, why, whether and how many were told. There is one row per date the save cancelled, including a series date already begun, which is told nobody. An event that takes no registrations here is reported as having nobody to tell. Verification: integration cms/event-notices.test.ts.
18. Given an organizer who ticks "Anunță participanții despre schimbare" with a note, or cancels an event with a reason, when the save is posted, then the note is written in Română and English or in neither, and the reason in both. One side only is refused on the empty box (notice.noteRo/En, cancel.reasonRo/En), with the rest of the form kept. Each EVENT_UPDATE_NOTICE / EVENT_CANCELLED row carries note/reason as { ro, en }. Each registrant's message reads its registration's language in the first half and the other language's own text in the second, never the same text twice. A row queued before, with one string, renders that string in both halves as before. A stored row with only one side of the pair renders no note or reason in either half (§354, amending §331). Verification: integration cms/event-notices.test.ts; unit notifications/event-notices.test.ts, content/bilingual-everywhere.test.ts.
19. Given any message the platform sends, when it renders, then the club is named only through the platform's constant and an event only through its data; no sentence states a number that is the event's or the send's own ("a week before", "two days away"), and a cancellation without a title names no event. The same holds for the name Zitadel's invitation carries and for the declaration and bib PDFs' metadata.
20. Given a message the club has written no words for, when a Redactor opens its editor on `/admin/emails`, then the box starts from the platform's subject and paragraphs with every field of the closed set written as its placeholder and no value of the page's sample, one paragraph block per paragraph with the platform's bold as bold; saved unchanged, it sends the platform's own message for every type and language, but for a paragraph break before a sentence the platform adds only when a fact exists (`DECISIONS.md` §359).
21. Given a subject or paragraph holding a value of the page's sample (the runner's name, the event's title, place or start, the desk code, the checklist, the sample inviter; the bib and the status inside the platform's own sentence), when it is saved, then it is refused naming the box, the value and the field to use, what was typed is kept, and nothing is written; a text already stored with one still sends (`DECISIONS.md` §359).
22. Given a saved text that holds sample values in either language, when a Redactor opens `/admin/emails` on either language's tab, then the card of cards and that message's card open and the closed card names the language affected; in that language's editor the values are listed with their fields, and "Înlocuiește cu câmpurile" saves the text with each value rewritten to its field, audited like a save (`DECISIONS.md` §359).
23. Given a club text with a paragraph, heading, list item or quoted paragraph whose only fields are among the place, the start, the number, the desk code, the hold's deadline, the time of signing and what to bring, when the message has none of them, then that block is not sent; a block with one of them present, with any other field, or with no field is sent as written (`DECISIONS.md` §359).
24. Given an Organizer, an Administrator or a Superadministrator on an event that takes registrations here, when they open "Trimite un mesaj participanților" (`/admin/events/[id]/mesaje`, linked from the event's immediate actions and from the registrations list filtered by that event), then they choose who receives it: everybody active, only the confirmed, only the waiting list (open offers included) or only those who owe the declaration. Each choice shows its live count of real registrations, with test rows counted apart, and a cancelled, expired or `PENDING_EMAIL_CONFIRMATION` registration is in no group (2026-09-24, `DECISIONS.md` §364).
25. Given the composer, when the message is sent, then the subject (at most 150 characters) and the body (at most 4,000, plain text) are required in both Română and English. A box that is empty, over its limit, or holds a `{field}` outside {participantName}, {eventTitle}, {eventStartsAtFormatted}, {eventLocationName}, {bibNumber} and {eventChecklist} is refused on the server, naming every box to fix. The rest of the form comes back as typed and nothing is queued (2026-09-24, `DECISIONS.md` §364).
26. Given the composer, when words are typed, then after a pause in typing the page shows the real email. It is rendered on the server through the template the outbox sends with, over the event's own facts, as a Romanian or an English registrant would receive it, as the tab chooses. It is addressed to the same sample runner as every `/admin/emails` preview, and the help line above it names her and her number from that one sample (`EMAIL_SAMPLE`), never a second copy. Picking a tab shows that tab's copy at once, and a pause still running from typing never replaces it with the other language's copy. A field the message cannot fill is named above the preview (2026-09-24, `DECISIONS.md` §364).
27. Given an ORGANIZER_MESSAGE, when it renders, then each half reads its own language. The registrant's comes first, and under the rule comes the other language's own subject and body, never the same text twice, with that half's event title, place and what to bring filling its placeholders. The organizer's text is escaped plain text: a blank line starts a paragraph, a line break is kept, and no emphasis is read. {bibNumber} is the settled number of a confirmed registration and empty otherwise. The platform adds only the facts line, one sentence saying who writes and why this person receives it, the event's page as the button, "Înscrierile mele" by address and the privacy line. Without a title, neither the subject nor that sentence names an event or the club (§357) (2026-09-24, `DECISIONS.md` §364).
28. Given `/admin/emails`, when it renders, then "Mesaj de la organizatori" has its own card. It previews the sample message from the same sample every other preview uses, with the English half reading the English title as the send does. In place of the words editor, it says the text is written per send on the event's page. It shows no stored words and no sample-value marker. A save of words for it is refused, and any stored wording for it is ignored by the send (2026-09-24, `DECISIONS.md` §364).
29. Given an event's message page, when it renders, then "Mesaje trimise" lists the event's sends newest first, read from their audit rows. Each shows the date, the subject in the backoffice's language, the group, how many it reached and who sent it, and never who received one (2026-09-24, `DECISIONS.md` §364).
30. Every outbound email's bilingual second half renders its event texts, its status word and its organizer-message fields in that half's own language, never the registrant's repeated under the other language's sentence (2026-09-25, `DECISIONS.md` §373).
31. The reminder goes at the event's lead, its own or the club's, and not at all when that is zero; the last call to sign goes with it. The email says the event is coming, never a number of days. In the club's own words {reminderHours} is a conditional fact, so a paragraph whose only field is the lead is not sent when there is no reminder (2026-09-25, `DECISIONS.md` §377).
32. Every page, email, the signed declaration's PDF and the platform's terms and privacy templates state the configured numbers as words that agree with them in both languages ("o oră", "2 ore", "20 de ore"). No catalogue key, email template or legal template states one of the former constants. The `/admin/emails` preview takes the participation window from the named default the column is held to (2026-09-25, `DECISIONS.md` §377).
33. The declaration email for a place held until the participation window offers "or when we remind you, N before the start" only while the window is still ahead. Once the window is open, the send when it opens and any resend after it say only "sign now", in both languages (2026-09-25, `DECISIONS.md` §104, §377).
34. The club can read ahead every email the platform sends participants on its own. /admin/emails lists, for the next 14 days and sorted by moment, each automatic send: the reminder, the participation confirmation, the last call to sign, the offer to the next in line after a lapse, the race number at the close, and "registration is open". Each row shows the moment with its weekday in the event's zone, the event (linked to its editor), the message (linked to its preview) and the recipients the job would pick now, with test registrations counted apart. The moment comes from the same function the maintenance job uses to decide the send, and at that moment the job queues exactly the registrations listed, none a minute before (tests/integration/notifications/forecast.test.ts). Staff-triggered messages and replies to a runner's own action are not listed.
35. Under the list of upcoming automatic emails, one line says whether the club receives a copy of each participant email and to which addresses ("Copiile clubului", §320), with a link to the panel that sets it. With no address set, the line says no copy is sent.

**Verification:** unit `notifications/templates.test.ts`, `notifications/mailgun-adapter.test.ts`; integration `notifications/event-mail.test.ts`, `registrations/signed-declaration.test.ts`, `registrations/interest.test.ts`

14. Given a Redactor, an Administrator or a Superadministrator, when they write a subject and paragraphs for one message type in one language on `/admin/emails`, then those words are stored under `platform_settings.emailCopy`, audited with that one key and its before and after, and used by every later send of that type in that language — the other language and every other type keeping the platform's text; an Organizer or a volunteer is refused (`DECISIONS.md` §103, §247).

15. Given words containing `{field}`, when they are saved, then a field outside the closed placeholder set — including any URL — is refused, naming it; a field the message does not carry renders as nothing, with the spacing closed up; and the greeting, the facts line, the action button and its token, the QR, the attachments, the links and the sign-off are unchanged by any rewrite. "Revino la textul platformei" removes the override rather than storing an empty one, and the next send sees that at once (`DECISIONS.md` §247).

**Verification:** unit `notifications/email-copy.test.ts`; integration `notifications/email-copy.test.ts`

#### BR-REQ-080-02 — Outbox is authoritative and idempotent

- **Source:** BR-BUS-080
- **Implements:** AGENTS.md §16.1
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a registration transaction, when it commits, then the outbox row is committed atomically with it and no provider call happens inside the transaction.
2. Given a provider failure, when it occurs, then the committed registration state is unchanged and the outbox row is retried with bounded backoff up to a maximum attempt count.
3. Given concurrent workers, when they claim work, then no message is sent twice for the same trigger.
4. Given a permanent failure reported by the provider, when it is received, then further sends to that address for that trigger are suppressed and the failure is visible in the backoffice.
5. Given an Administrator on `/admin/registrations`, when the outbox panel shows what is waiting and the day's count against the provider's allowance, and they press "Trimite acum", then the same worker the scheduled job runs drains the queue in batches — never past the day's remaining allowance, at most a hundred in one press, stopping when the provider defers — audited with the counts, throttled per Administrator apart from the job's own bucket; and when nothing is waiting or the allowance is spent, then a sentence says which, and there is no button (2026-09-18, `DECISIONS.md` §80).

6. Given an outbox row deferred by the provider's allowance, one whose turn passed more than ninety minutes ago, or one that spent every attempt in the last seven days, when `/api/health` answers, then it reports `email.status = stalled`, an overall `degraded`, and HTTP 503 — every status but `ok` is a 503 — so an external monitor that notifies on a non-2xx tells the club that email has stopped through a channel that is not email; the same counts, the reason and the resume time are shown on `/admin/tasks` and `/devs`; a bounce alone is not a stall (`DECISIONS.md` §98).

7. Given an Administrator on `/admin/emails`, when they set the Mailgun plan the account is on — Free, Basic, Foundation, Scale, or a custom one with the ceilings typed — then the setting is stored once (`platform_settings.emailPlan`) with an audit row naming who changed it from what; every figure that says how much can still be sent (the outbox panel, `/devs`, `/admin/tasks`, the "send now" stop) counts against that plan's ceiling over its own period — Free's day, a paid plan's month, none at all — and the cost table carries the plan's price; a Moderator is refused by the service and, since `DECISIONS.md` §291, is not shown the form at all — they read the figures and one sentence saying the plan is the Administrator's; an unreadable stored value reads as Free (`DECISIONS.md` §100).
8. Given `/admin/emails` and the cost table on `/admin/tasks`, when either says how much can still be sent, then it says plainly that the allowance belongs to one Mailgun account shared by QA and production — what one environment sends comes off what the other can send — and that the count beside it is this environment's own outbox rows (`DECISIONS.md` §164).
9. Given the plan's figures on `/admin/emails`, when the club has named hidden-copy addresses for the participants' emails or a declarations archive, then the forecast prints what one completed registration costs on the allowance from the one function behind `/admin/tasks` (five to the runner, one to the club, one more for the archive, and one more per Bcc address on each of the runner's five), says how many of those are the hidden copies, and the figure follows the setting the moment it is saved (2026-09-22, `DECISIONS.md` §293).
10. /admin/emails shows one closed card per participant message type — all twenty in `email_message_type`, EVENT_UPDATE_NOTICE and EVENT_CANCELLED included — each with a short "when" in its summary, and exactly the types nothing queues say "nu se mai trimite" (§331, §340). Verification: unit `notifications/emails-page-folds.test.ts`, e2e `email-plan.spec.ts`.
11. Given the question "Trimiți mesajul la N participanți?" answered with Send, when the send is posted, then one ORGANIZER_MESSAGE is queued per registration in the chosen group, in one transaction under the event row's lock. Each row is in the registration's own language, carries both languages' subject and body, and holds no token. Test rows are written to and counted apart, and club copies follow §320 for real rows only. An `event.participant_message_sent` audit row names who sent it, the group, the counts, the subject and the send's id, never an address or the body. A second press of the same form queues and audits nothing, and an empty group queues nothing and says so (2026-09-24, `DECISIONS.md` §364).
12. Given the composer, when a group is chosen, then it says how many emails the send costs against the Mailgun plan, club copies included. When the allowance left is smaller, it says how many leave now and how many wait for the allowance to come back. It never refuses the send for it (§40) (2026-09-24, `DECISIONS.md` §364).
13. /admin/emails shows one closed card per participant message type, all twenty-one in `email_message_type`, EVENT_UPDATE_NOTICE, EVENT_CANCELLED and ORGANIZER_MESSAGE included. Each has a short "when" in its summary, and exactly the types nothing queues say "nu se mai trimite". This amends criterion 10's twenty (§331, §340) (2026-09-24, `DECISIONS.md` §364).
14. Given `/admin/emails`, when an Administrator or Superadministrator saves "Termene", then every deadline is a whole number inside its bounds (a blank box is refused, not read as zero), the save is audited as `deadlines.changed` naming what moved from and to, and a lower role is refused on the server with nothing written; any staff role reads the values in force (2026-09-25, `DECISIONS.md` §377).

**Verification:** integration `notifications/outbox.test.ts`; integration `notifications/send-now.test.ts`; integration `notifications/email-health.test.ts`; integration `notifications/email-plan.test.ts` (7); unit `notifications/email-plan.test.ts`; e2e `email-plan.spec.ts` (8)

#### BR-REQ-080-03 — Environment-appropriate delivery

- **Source:** BR-BUS-080, BR-BUS-090
- **Implements:** AGENTS.md §16.4, §7.1
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given `APP_ENV` of `local` or `test`, when email is sent, then it is captured and never transmitted.
2. Given `APP_ENV=qa`, when email is sent, then delivery is captured or restricted to an allowlist and the subject is visibly marked as QA.
3. Given an unsafe combination such as QA configured for live delivery, when the application starts, then startup fails.

**Verification:** integration `notifications/modes.test.ts`

#### BR-REQ-080-04 — Webhook handling

- **Source:** BR-BUS-080
- **Implements:** AGENTS.md §16.5
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a webhook with an invalid or stale signature, when it is received, then it is rejected.
2. Given a duplicate webhook delivery, when it is received, then processing is idempotent.
3. Given a webhook, when it is processed, then delivery metadata is updated and no message body, secret, or action token is logged.

**Verification:** integration `notifications/webhooks.test.ts`

### 4.11 Security, privacy, roles, SEO, and accessibility

#### BR-REQ-060-01 — Role boundaries are enforced server-side

- **Source:** BR-BUS-060
- **Implements:** AGENTS.md §10.2, §13.1
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given an Author, when they request any participant, registration, export, or role-management endpoint, then it is refused regardless of what the interface shows.
2. Given an Editor — the Organizer — when they request participant or export endpoints, then they are **served**, read-only, since `DECISIONS.md` §289; see criterion 14. Given a copywriter, a volunteer or the Tehnic role, when they request those endpoints, then it is refused.
3. Given an unauthenticated request to any `/admin` route, when it is made, then it is refused.
4. Given each guarded endpoint, when tests run, then authorization is asserted at the server, not only in the UI.
5. Given an Administrator, when they administer staff, then they may add a colleague by email address and role, change a colleague's role, and revoke access; an Author or an Editor is refused every one of those operations.
6. Given an Administrator, when they attempt to change their own role, remove their own access, or leave the club with no Administrator at all, then it is refused.
7. Given the development staff switcher, when `APP_ENV` is qa or production, then it is unavailable, and a process configured to use it there does not start.
8. Given a volunteer, a copywriter or an Editor, when they attempt to delete an event or to add or remove test registrations, then it is refused at the server; both are the Administrator's alone. Given a volunteer, when they open `/admin`, then they land on the desk, and the tabs offer the desk and the guide only; given any staff role, when they open `/admin/guide`, then their own role's sections come first and open (§103).
9. Given `APP_ENV=production`, when a test registration is created by any path, then it is refused — at the feature's entrance and again at the statement that would write the row.

10. Given a Superadministrator adding a person on Echipa where Zitadel is the provider and `ZITADEL_MANAGEMENT_PAT` is set, when the row is added, then the person's Zitadel account is created with that address (verified) and Zitadel sends them the invitation to choose a password, and the page says so; an account that already exists is left as it is and reported; a missing key or a refusal by Zitadel still adds the row and says what to do in the console; a row that has never signed in offers "Resend the invitation" (2026-09-19, `DECISIONS.md` §123).
11. Given an Administrator adding a person on Echipa, when the row is added, then `STAFF_INVITATION` is queued in the same transaction — to that address, in the person's language, naming who added them, the role and the sign-in page, with no token — and goes out through the club's own outbox whether or not a Zitadel key is set; "Resend the invitation" on a row that never signed in queues it again with a new key, and is refused once they have signed in (2026-09-19, `DECISIONS.md` §141).
12. Given a staff member on Echipa and a deployment with the management key set, when an Administrator adds somebody whose provider account already exists, then that account is sent the invitation rather than skipped; when they press "send a password reset", then the provider emails a reset link and nothing here ever holds a password or its code; when they press "deactivate the account", then the provider account is switched off while the allowlist row stays, because withdrawing access and disabling sign-in are two different decisions; every one of these looks the account up by email address first and login name second, and answers "no account with this address", "not configured" or the provider's own reason rather than one sentence for all four (2026-09-20, `DECISIONS.md` §171).
13. Given the registrations list with a filter applied, when an Administrator asks for the Excel export, then the file is a real `.xlsx` — a bold header frozen at the top, readable column widths, dates written as dates and the race number as a number — carrying the same rows the comma-separated export would, plus the registration id and the runner's club, with test registrations omitted; the file and its sheet are named after the event that was filtered for and the day, the sheet name reduced to what Excel accepts; a cell beginning with `=` is written as text and never as a formula; and an empty list still produces a file (2026-09-20, `DECISIONS.md` §172).

14. Given an Organizer, when they open the registrations list, one registration's page, the CSV or Excel export, the bib sheet, an event's signed declarations or a single signed declaration, then each is served; and when the same session attempts to cancel, erase, rename, resend, assign the race numbers, mark a bib printed, drain the outbox or send the thank-you, then every one is refused at the server, and none of those controls is drawn — the screen says once, in a sentence, what this role may not do here rather than refusing after a press. Given the Tehnic role, when they request any of the same read endpoints, then it is refused, because the role exists to be given to a helper without the club's participants (2026-09-22, `DECISIONS.md` §289).
15. Given an Organizer on `/admin/emails`, when the page renders, then they see the plan's figures, the outbox queue and the club's copies — read-only, with no form and no "send now" — and one sentence per panel saying the setting is the Administrator's; given a Redactor or the Tehnic role on the same page, then the figures and the words are shown and neither the queue nor the club's copies, because both name people; given any of them submitting one of those forms by hand, then the service refuses as before (2026-09-22, `DECISIONS.md` §291).
16. Given any backoffice button, link or "⋮" item that names an action, when it renders, then it shows that action's icon from the one list (`shared/ui/action-icons.ts`), looked up by name on the client: the same icon for the same label wherever it is written; one icon for the actions that are the same action under several labels (erase, cancel, save, send, send again, mark printed, mark unprinted, print, PDF, add a person, a race number); never one icon for two names; and a navigation button its tab's icon. Every icon is `aria-hidden`, so no accessible name changes. The registrations list's per-row compact "Retrimite" shows none, because an icon widens its column (2026-09-23, `DECISIONS.md` §318).
17. Given a role that may not save the event row (a Redactor), when it posts the notice box or a cancellation, then the save is refused FORBIDDEN, whatever the page drew. Verification: integration cms/event-notices.test.ts.
18. The event editor redirects a role that may not read the club's content (the volunteer) to the events list, and shows the repeat, stop-recurrence and duplicate controls only to the roles the service allows (Administrator and up).
19. Given the events list's draft line, when it renders for a role that may not publish (Organizator, Redactor, Tehnic), then it shows the words, the date links and the "?" with no "Publică", "Publică automat de acum" or "Deschide seria" button. The bulk publication and the series' switch still assert the role at the server for any post that arrives anyway (`DECISIONS.md` §351). Verification: e2e `series-drafts.spec.ts` (a Redactor sees the line and no button); unit `content/series-drafts-line.test.ts`.
20. Given a Tehnic, a Redactor or a Voluntar, when they open an event's message page, post a send or ask for a preview, then the page answers 404 and the server refuses with FORBIDDEN, whatever the page showed. No link to the page is drawn for them (2026-09-24, `DECISIONS.md` §364).
21. Given an admin `/…/[id]` route and a malformed id — not shaped like the uuid column it names — when it is requested by any signed-in staff role, then the response is 404, identical to an id that is shaped right but names no row, never a 500 from the database's own refusal; the id-shape check runs only after the role assertion, so it never discloses to an unauthorized role whether a well-formed id would exist (2026-09-25, `DECISIONS.md` §376).
22. Only a role that manages registrations (Administrator and above) may change the deadlines, asserted on the server. Other staff roles read the numbers in force and are offered no form. A save that changes nothing writes no row, no audit, no cache expiry and no job wake, and a save that changes something writes one audit row naming the keys changed (2026-09-25, `DECISIONS.md` §377).
23. Given a backoffice action that succeeds, when it answers or redirects, then a toast says what happened, in the reader's language, from a key under `Feedback.toast`. Every `saved` code an admin action writes has a sentence in both catalogues, as a plain string or as the three counted forms. The toast never repeats the page's banner word for word, is shown once, is not shown again by a refresh, and carries only numbers through its cookie. A refusal is never a toast: it keeps the focusable summary naming each box (2026-09-25, `DECISIONS.md` §384).
24. Given a staff verb that reaches Zitadel (invite, re-invite, password reset, deactivate, reactivate), when Zitadel refused, found no account or was never asked for want of a key, then no toast says it worked and the banner says why. Given `STAFF_AUTH_MODE` other than `provider`, when an Administrator adds a colleague, then the toast says the person was added to the team (2026-09-25, `DECISIONS.md` §384).
25. Given any irreversible or outward-facing staff action, when it is pressed, then one confirmation dialog asks first and names the consequence. The actions are: publish, take off the site, archive, cancel an event, tell the participants, send a message or the thank-you, resend, cancel, erase or rename a registration, give a place, set a number, approve or withdraw a legal version, add or remove a colleague, delete an album, a picture or a page, drain the outbox, and change the Mailgun plan, the Neon plan or limits, the job interval, the club's deadlines, the contact recipients, the club's copies or an email's wording back to the platform's. The safe button has the focus. Enter confirms only a question that is not destructive; in a destructive one Enter reaches the cancel button, and only the red button confirms. A held key's repeats neither confirm nor cancel. Escape and the backdrop cancel. Every other backoffice Server Action is listed with the reason it asks nothing, and a test fails for one that is neither (2026-09-25, `DECISIONS.md` §384).
26. Given a question for an action that queues email to participants, when it opens, then it says "An email will be sent to N participants". N is read with the same query the send uses and counts real registrations only; test rows are named on a line of their own or not at all. It says nothing about email when N is 0. For a series save, N is summed over the dates ticked at the press. For the registrations list's bulk cancel, N is summed over the ticked rows the cancel can reach, and the toast afterwards counts the same real rows cancelled (2026-09-25, `DECISIONS.md` §384).
27. Given the thank-you, a participant message, an update notice or a cancellation, when it is sent, then the number the toast and the banner state equals the dialog's number. A test registration is written to and counted in neither. Verification: integration `notifications/confirm-counts.test.ts` (2026-09-25, `DECISIONS.md` §384).
28. Given the registrations list, when an Administrator ticks rows and presses the bulk cancel or the bulk erase, then the ticked ids are posted with the form: each tick's `form` is on its `<input>`. Verification: e2e `bulk-cancel-count.spec.ts` on both projects (2026-09-25, `DECISIONS.md` §384).
29. Given the race-day desk, when a volunteer checks a runner in or undoes it, then no dialog asks first and a toast says it happened. Given any question, when it is answered, then the server still asserts the role, the version and every rule as before: the dialog is a courtesy and never a permission (2026-09-25, `DECISIONS.md` §384).
30. Only an Administrator can change the limit per address, in the "Termene" fold. The change asks for confirmation first, is audited, and a save that changes nothing writes nothing. An Organizer sees the limit and is offered no form (2026-09-25, `DECISIONS.md` §389).

**Verification:** integration `auth/role-boundaries.test.ts`, `cms/crud.test.ts`, `registrations/test-kind.test.ts`; unit `staff/roles.test.ts`, `staff/zitadel-users.test.ts`, `registrations/row-verbs.test.ts`; e2e `cms-publish.spec.ts`

#### BR-REQ-070-01 — Participant data is never public

- **Source:** BR-BUS-070
- **Implements:** AGENTS.md §19
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given any public page or public API response, when it is inspected, then it contains no participant email address, registration list, declaration record, or management link.
2. Given a public event page, when it renders, then it shows counts only, never names.
3. Given application logs, when they are inspected, then they contain no raw action token and no unnecessary email address.
4. Given the data model, when it is reviewed, then no phone number, birth date, emergency contact, health data, address, or identity document is collected.
5. Given the retention sweep deleting lapsed unconfirmed registrations or registrations past three years, when it runs, then in the same transaction it removes from their audit rows the participant id, a rename's before and after names and any typed reason, as a manual erase does. On every run it clears the Strava link and Instagram handle of any registration whose person was under eighteen on the day the row was written (2026-09-23, `DECISIONS.md` §324).
6. Given /admin/tasks, when an event with a real registration here started between 30 and 7 days ago, then the shredder reminder names it whatever its publication state now — published, unpublished or archived — each title once (2026-09-23, `DECISIONS.md` §324).
7. Given an Administrator, when they look a person up by email address, then an Administrator-only person view finds them by the canonical identity, keeps the address sealed rather than in the URL, and audits every view and every JSON download (the access copy of art. 15 GDPR); exports are audited, and throttle keys for an email identity are hashed (`DECISIONS.md` §322).

**Verification:** integration `privacy/public-surface.test.ts`; review gate

#### BR-REQ-070-02 — SEO and accessibility fundamentals

- **Source:** BR-BUS-052, BR-BUS-070
- **Implements:** AGENTS.md §20
- **Priority:** SHOULD
- **Release:** M1

**Acceptance criteria**

1. Given any public page, when it renders, then it has a unique title, a meta description, a canonical URL, and `hreflang` alternates for published locales.
2. Given the sitemap, when it is generated, then it contains published public content only, and excludes participant action pages, previews, and runner profiles.
3. Given a keyboard-only user, when they navigate the registration flow, then every step is operable and focus order is sensible.
4. Given a page, when it is audited, then colour contrast, form labels, and error announcements meet the agreed accessibility baseline.
5. Given any public page, when it renders, then it has a unique title, a meta description, a canonical URL, and hreflang alternates for published locales.
6. Given the sitemap, when it is generated, then it contains published public content only, and excludes participant action pages, previews, and runner profiles.
7. The contact page and the gallery listing each declare their own canonical in both languages, whatever query the address carries, with hreflang to both languages and `x-default` on the Romanian address. The sitemap lists the gallery listing in both languages whether or not an album is published (`tests/e2e/seo.spec.ts`, `tests/integration/seo/sitemap.test.ts`).

**Verification:** e2e `seo.spec.ts`; accessibility audit in CI

#### BR-REQ-070-04 — Contact form

- **Source:** BR-BUS-070
- **Implements:** AGENTS.md §16, §19.4
- **Priority:** SHOULD
- **Release:** M1
- **Status:** built (`DECISIONS.md` §149). `/contact` in both locales; the message leaves by SMTP through the club's own mailbox account and never through the outbox or Mailgun.

**Acceptance criteria**

1. Given a visitor on `/<locale>/contact`, when the page renders, then it offers a name, an email address and a message (at most 2 000 characters — the longest a rejection can hand back in the draft cookie, proven by a unit test), the same bot defences as the registration form (trap field, fill-time check, Turnstile when configured), a 44 px submit control and a sentence linking the privacy notice; it is linked from the header (while the page has a form or the club's address to show — a deployment with neither has no entry, as the gallery has none without an album; the header asks the page's own two-part question since `DECISIONS.md` §164 — a transport *and* a resolved recipient — and a database that cannot answer falls back to `CONTACT_FORM_TO` rather than failing the header) and the footer in both locales, and is in the sitemap.
2. Given a submission, when it is validated, then the address is validated like the registration form's and canonicalized; a rejection returns to the page with the field names only in the URL, the typed values kept in the encrypted draft cookie, and a focusable summary naming each box.
3. Given a valid submission from a person, when it is sent, then one message reaches every resolved recipient — from the configured account with the club's name, `Reply-To` the visitor with their name, subject `Mesaj de pe site: <name>`, a plain-text body carrying the name, the address, the message and the page, and an HTML twin with the visitor's text escaped — over SMTP, not through the email outbox, not through `EMAIL_DELIVERY_MODE`, and never through Mailgun; on QA the subject carries the outbox's `[QA] ` mark (AGENTS.md §16.4); the platform stores no copy.
4. Given a submission that trips the trap field or the fill-time check, when it is answered, then the answer is the same "sent" page and nothing is sent.
5. Given more than five submissions in an hour from one canonical email identity, when the next arrives, then it is refused with a plain sentence saying so and the typed message is kept — never silently, because a person is not a bot; the counter is `rate_limit_buckets` scope `contact-message`, keyed on a hash of the canonical identity (the address itself is never stored), never on an IP; a deployment with no way out answers before anything is counted, and a send the SMTP server refused is given back, so a retry on a day the mailbox is down never turns into "too many messages".
6. Given `APP_ENV` local or test, when a message is sent, then it is captured in memory and no SMTP connection is opened; given a deployment without `CONTACT_SMTP_USER` and `CONTACT_SMTP_PASSWORD`, or with no recipient resolvable at all, when the page renders, then it shows the club's contact address as a link instead of the form, and the process starts; given a send the SMTP server refuses, when the action answers, then the page says so and names the club's address to write to, and the function log carries the failure's code (`smtp EAUTH`, `smtp ESOCKET`) and never the password or the server's reply.
7. Given `/admin/tasks` and `/devs`, when they render, then the contact form's state (SMTP, capture, off, or "can send and has nobody to send to") is reported with the steps to configure it, which half of the resolution order answered for the recipients, and the missing variables named, and no value of any variable is ever shown.
8. Given the privacy-notice template, when it is read in either language, then it says what the form collects, that the message goes to the club's mailbox and stays there as ordinary correspondence, the legal basis (legitimate interest in answering the request, art. 6(1)(f) GDPR), and that the details are used for nothing else.
9. Given an Administrator on `/admin/emails`, when they set the contact form's "to" and "cc" lists, then each address is validated like a participant's, the pair is stored once (`platform_settings.contactRecipients`) with an audit row naming who changed it from what, and every message the form sends afterwards goes to that "to" list with that "cc" as a real `Cc` header and the visitor still as `Reply-To`; a Moderator is refused by the service and, since `DECISIONS.md` §291, sees the list in force and no boxes to change it; an address that is not one is refused whole, leaving the stored pair untouched; a "to" list saved empty falls back to `CONTACT_FORM_TO`, and with neither the form is off; an address typed into both lists, or twice into one, is stored and sent once, compared without regard to case; the sending account (`CONTACT_SMTP_USER`, `CONTACT_SMTP_PASSWORD`) is named on the page and never editable there, and its password is never rendered; and given a database that does not answer, when `/contact` or the header renders, then the recipients resolve to `CONTACT_FORM_TO` and the page still shows the club's address rather than an error (`DECISIONS.md` §164, §165).
10. Given Bcc addresses under „Cine primește mesajele de contact” on `/admin/emails`, when a contact message is sent, then they are handed to the SMTP sender as envelope recipients and appear in no header, an address also in „Către” or „Copie (Cc)” is sent to once, compared without regard to case, and a row stored before the box existed reads as no Bcc; the sentence in force above the boxes names the Bcc whenever a recipient is in force (from the row or from `CONTACT_FORM_TO`) and names nobody when neither is set; an Organizer reads the list in force and is offered no form, and only a role with `canManageRegistrations` changes it, asserted on the server, with an audit row naming who changed what from what (2026-09-22, `DECISIONS.md` §293).
11. Given a submission that passed the trap, the fill-time check and Turnstile — or whose challenge could not run — when it carried no Turnstile token at all while the club's challenge was on (the switch on and both keys set), or its sender's address is at a domain that contains the club's name (the label before the ending of `APP_BASE_URL`'s host, hyphens ignored) without being the club's own domain or a subdomain of it, then it is delivered like any other and answered with the same "sent" page, its subject begins `[posibil spam] ` (after QA's `[QA] `), `Reply-To` is still the visitor, and its plain-text and HTML bodies end, below the message, with a Romanian footer naming each reason in one line and the signals — seconds from page load to submit, how many links and their hosts (at most five), the hidden field's state and the challenge's outcome; a token that was sent but that Cloudflare did not answer for marks nothing; the name rule is off on `localhost`, an IP address, a provider's shared domain and a label under four characters; a message with neither reason is byte-for-byte what criterion 3 describes; no IP address is used, stored or written into the message, and the function log names the reasons only (2026-09-23, `DECISIONS.md` §310).
12. Given Turnstile switched on, when the contact form, the registration form or the "Anunță-mă" box renders, then a caption under the widget says Cloudflare runs the check and sees the IP address and browser details for that purpose only. The contact form says a message arrives in the club's Gmail (Google) mailbox and is deleted after at most 12 months (§323).

**Verification:** unit `contact/fields.test.ts`, `contact/message.test.ts`, `contact/recipients.test.ts`, `config/env.test.ts`, `diagnostics/configuration.test.ts`, `diagnostics/owner-tasks.test.ts`; integration `contact/service.test.ts`, `contact/recipients.test.ts`; e2e `contact.spec.ts`, `email-plan.spec.ts`; unit `contact/suspicion.test.ts` (11); unit `contact/message.test.ts` and integration `contact/service.test.ts` also cover 11

#### BR-REQ-090-04 — A deployment can say what it is configured to do

- **Source:** BR-BUS-090, BR-BUS-101
- **Implements:** AGENTS.md §9.2, §8, §14.5
- **Priority:** SHOULD
- **Release:** M1
- **Status:** built. `/devs`, Administrator only.

**Acceptance criteria**

1. Given an Administrator, when `/devs` is requested, then it names the environment, the build, the mode of each configured subsystem, and for each mode the variables that mode requires with whether each is set.
2. Given any variable, when the page renders, then its **name** appears and its **value never does** — no key, no connection string, no secret, in the markup or in the page's data.
3. Given a subsystem missing something its own mode requires, when the page renders, then it is marked as blocked and the missing variables are named.
4. Given `EMAIL_DELIVERY_MODE=capture` on a deployed environment, when the page renders, then it is reported as limited rather than correct, because captured messages on a serverless host reach nobody.
5. Given an Author or an Editor, when `/devs` is requested, then the response is 404, the same answer a route that does not exist gives.
6. Given the route, when a crawler requests it, then it is disallowed in `robots.txt`, carries `noindex`, and is served with a private, no-store cache policy.
7. Given `/devs` and its pages, when a staff member who may see them opens one, then it carries the backoffice's own chrome — the title, who is signed in, sign out and the section tabs — the same as every `/admin` page, from one shared component (2026-09-19, `DECISIONS.md` §119).
8. Given `APP_ENV` is `local` or `test`, when `/devs` renders, then it lists the messages the platform captured instead of sending — the last fifty, newest first, each with its subject, recipient, time and the links in its text as links; on any other environment the section is absent (2026-09-19, `DECISIONS.md` §124).

**Verification:** unit `diagnostics/configuration.test.ts`; unit `seo/private-paths.test.ts`

#### BR-REQ-090-05 — The club can see what it may spend, and what the free plans refuse

- **Source:** BR-BUS-090, BR-BUS-101
- **Implements:** AGENTS.md §1.2, §9.2
- **Priority:** SHOULD
- **Release:** M1
- **Status:** built. `/admin/tasks`, Administrator only.

`/devs` reports configuration to somebody who reads a status enum, and the task list says what is
owed. Neither answers the question a volunteer treasurer asks before a race: **can we keep
running this for nothing, and what do we buy on the day we cannot?** That answer existed only in
`docs/PLATFORM.md`, which no organizer will open.

**Acceptance criteria**

1. Given an Administrator, when `/admin/tasks` is requested, then it states whether the platform can run for free, naming the domain as the one certain cost, and the verdict is derived from this deployment rather than asserted.
2. Given a published event whose `cost_type` is `PAID`, when the page renders, then it reports that the free hosting plan no longer applies, because taking an entry fee is outside the provider's non-commercial terms.
3. Given the page, when it renders, then it states how many further registrations today's remaining email allowance covers, computed from the allowance, what has been sent today, and the messages one completed registration costs — and that figure is a floor, never a ceiling.
4. Given each limit the club can actually meet, when the page renders, then it says whether the limit applies to this deployment and whether it has been reached today.
5. Given every price on the page, when it renders, then it is a figure recorded in `docs/PLATFORM.md`, shown with the date those figures were last verified against the vendors, and a cost the club has not decided renders as "to be decided" rather than as a plausible number (`AGENTS.md` §1.2).
6. Given each upgrade the page recommends, when it renders, then it names what triggers it, what it costs, and whether it is meant to be reversed — and at least one is marked as not reversible.
7. Given an Author or an Editor, when `/admin/tasks` is requested, then the response is 404.
8. Given the to-do half of the page, when it renders, then a line under the heading counts the rows shown — "De făcut: N · Gata: M", N every row not done (a blocking row is pending too) and M the rest — and says "Tot ce se vede aici este rezolvat." when nothing among them is pending — a sentence without the figure, because the figure is on the line above and a Romanian numeral in a sentence needs a form the catalogue does not carry (no ICU plurals); the count follows the filter in force, so it describes the list under it, while the "blocks real registrations" box counts the whole board whatever the filter; and the count is on the page alone, never in the section tab, because the tab renders on every backoffice request and the count would cost it five reads (2026-09-19, `DECISIONS.md` §150).
9. Given the to-do half, when it renders, then every task carries a kind from a closed set of four — account, decision, text, check — typed so a task added without one does not compile; two rows of chip links above the list filter by owner ("Cine: Toate · Clubul · Dezvoltatorul") and by kind ("Tip: Toate · Cont · Decizie · Text · Verificare"), each link keeping the other row's choice so the two combine in the address (`?owner=club&kind=account`), the active chip marked `aria-current="page"`, each link 44 px tall, no client code; a query value outside the closed sets reads as "all"; a combination with no row says so; and the done rows still follow the open ones (2026-09-19, `DECISIONS.md` §150).
10. Given a published event with registration on the site that started seven to thirty days ago, when /admin/tasks renders, then an open club row naming the event(s) asks to destroy exports and printed sheets, with steps; with no such event the row is absent (§323). Verification: unit `diagnostics/owner-tasks.test.ts`.
11. Given the same project-row reading `/admin/tasks` already makes for Costuri, when no quota is set, then the row is `open`, except on production, where it reads `done` with its own sentence, matching the Costuri panel's own recommendation not to set one there; when the period's spend reaches 80% of a quota that is set, then the row is `broken` (red), with its own sentence naming the suspension; the row never blocks a registration on any environment or reading.

**Verification:** unit `diagnostics/platform-plans.test.ts`; unit `diagnostics/owner-tasks.test.ts`; e2e `tasks-cost.spec.ts`, `tasks.spec.ts`

#### BR-REQ-090-06 — The theme lab: the site with other type, in one browser

- **Source:** BR-BUS-090
- **Implements:** AGENTS.md §3.2, §9.2
- **Priority:** COULD
- **Release:** M1 — 2026-09-18.
- **Status:** built. `/devs/theme`, DEV and above.

**Acceptance criteria**

1. Given `/devs/theme`, when a DEV or above applies a text size (90–150% of the browser default), a heading face, a body face (Roboto, Inter, Nunito, the system face, Georgia) or a corner radius, then every page of the site renders with it in that browser and in no other, and "back to normal" removes it; below DEV the page is 404.
2. Given the preview, when any page renders on the server, then it is unchanged and exactly as cacheable as before: the setting is a cookie the browser alone reads, applied at the theme boundary after hydration, and a value naming anything outside the allowlist is ignored.
3. Given the lab's faces, when no preview is set, then no visitor downloads a font file for them.

**Verification:** unit `theme/preview.test.ts`

#### BR-REQ-090-07 — The database's month, on `/devs`

- **Source:** BR-BUS-090, BR-BUS-101
- **Implements:** AGENTS.md §9.2, §16.2
- **Priority:** SHOULD
- **Release:** M1 — 2026-09-18, `DECISIONS.md` §68.
- **Status:** built. Criteria 1, 2 and 5 were rewritten on 2026-09-23, when the Neon plan
  became a setting (`DECISIONS.md` §306, the follow-up §280 recorded); criteria 3–4 are unchanged.

**Acceptance criteria**

1. Given `NEON_API_KEY` and `NEON_PROJECT_ID`, when `/devs` renders, then it shows this project's CU-hours used in the current billing period, the hours the compute was awake against the hours elapsed and the period's end — read from Neon with a five-second timeout, a sentence rather than an error when Neon does not answer, and how to set the variables when they are not set — and reads them against the plan the `neonPlan` setting states: on Free against the plan's 100 CU-hours and 0.5 GB, red past 80%, with "stops until next month"; on Launch with no ceiling and nothing red, the hours as an estimated charge at the catalogue's rate (`diagnostics/domain/neon-plan.ts`, dated), the storage at its GB-month rate, the restore rate named, and the word "estimate", because Neon's API gives consumption and not invoices (2026-09-23, `DECISIONS.md` §306).
2. Given the Neon row on `/admin/tasks` → Costuri and the block on `/devs`, when the setting says Launch, then both name Launch, show neither 100 CU-hours nor 0.5 GB as a ceiling, and the cost row is a usage estimate — this month's pace projected to a full month at the catalogue rate, beside the daily rate it was made from — marked an estimate, with no next plan quoted while Scale's price is not recorded, and the year's total that includes it marked estimated; when the setting says Free, both show exactly the Free block and row, and Launch is the next plan at its per-hour rate. Every rate the pages print comes from the one catalogue through a placeholder; a literal rate in the Neon messages fails the unit test (2026-09-23, `DECISIONS.md` §306).
3. Given the outbox, when a request queues a message, then that request drains the outbox once after its own response is sent, so delivery does not wait for the scheduler; the scheduler's cadence in production is fifteen minutes by day and hourly by night (23:00–07:00 `Europe/Bucharest`, `jobs/quiet-hours.ts`), the health threshold is twice the cadence in force plus five minutes, and the compute may sleep between runs. The cadence limits Launch spend and preserves queue timing; it no longer protects against a 100-CU-hour suspension.
4. Given `VERCEL_API_TOKEN` and `VERCEL_PROJECT_ID`, when `/devs` renders, then it shows this month's deployments, today's against Hobby's 100 a day, and the build minutes against Hobby's 6,000 a month, warning at eighty percent of either, summed from Vercel's deployments list across its pages; without them it says how to set them; and it says that bandwidth and invocations are not in Vercel's API and links to the dashboard's Usage page (`DECISIONS.md` §101).
5. Given `platform_settings.neonPlan`, when it is absent or holds a value this code cannot read, then it reads as FREE; an Administrator (`canManageRegistrations`) sets FREE or LAUNCH with a note on `/admin/tasks` → Costuri, the change is audited as `neon_plan.changed` (from, to, note), any other role is refused on the server, `/devs` links to the panel for a reader who may open it and names who sets it for one who may not, and the setting is read per environment. `/api/health` reads no Neon figure, so no monitor warns at 80% on either plan. (2026-09-23, `DECISIONS.md` §306).
   *Amended 2026-09-24 (§335, §340):* `/api/health` reads no Neon *plan*: whichever plan is in force, no monitor is warned about the plan. Its only Neon figure is the early warning on the monthly quota in criterion 10 (2026-09-23, `DECISIONS.md` §335). `/api/health` is dynamic on every call and probes the database every time; with `NEON_API_KEY`/`NEON_PROJECT_ID` it adds a `neon` block `{ status, percent }` read from Neon at most every 15 minutes, and degrades at 80% of a quota Neon holds. `E2E_DISABLE_NEON` is honoured everywhere but production, where it is ignored with a startup warning. Verification: unit `api/health-route.test.ts` (three calls, three probes), `config/env.test.ts`.
6. Given `NEON_API_KEY` and `NEON_PROJECT_ID`, when Neon's project row answers with `owner.subscription_type`, then a value beginning `free` reads as Free and one beginning `launch` as Launch, and that plan — not `platform_settings.neonPlan` — is what `/admin/tasks` (the Neon panel, the cost row, the verdict) and `/devs` read the month against; the panel says the plan was read from Neon and `/devs` says "citit de la Neon" without a link into the costs panel. When the key is not set, Neon does not answer, or the subscription is one this code does not know, the stated setting is used and the panel says so. Verification: unit `diagnostics/neon.test.ts`, `diagnostics/neon-plan.test.ts`; e2e `neon-plan.spec.ts` (the fallback path, no key in CI).
7. Given `platform_settings.jobCadence`, when it is absent or holds a value this code cannot read, then it reads as 0 ("la nevoie"); an Administrator (`canManageRegistrations`) sets 0, 15, 30, 60 or 120 minutes on `/admin/tasks` → Costuri, any other role is refused on the server, the change is audited as `job_cadence.changed` (from, to) and forgets every cached schedule; a ping inside the interval answers from the cache; an interval longer than the hour-long cap replaces it; the card and `/devs` show each job's last real run, next check and last ping. Verification: integration `jobs/cadence.test.ts`, `jobs/job-sleep.test.ts`; e2e `job-cadence.spec.ts`.
8. Given `NEON_API_KEY` and `NEON_PROJECT_ID`, when an Administrator opens `/admin/tasks` → Costuri, then the card "Limitele bazei de date" next to the Neon plan shows what Neon holds now, with a five-second timeout on each request: the size ceiling of the read-write computes, with its memory and its worst hour and worst month at Launch's rate from the one catalogue; the project's default for a recreated compute; the monthly compute-time quota; this period's CU-hours and hours awake; and the end of the period. Without the variables it names the missing ones and where to set them (`SETUP.md` §33). When Neon refuses, times out or answers with something unreadable, it says so in one sentence. In neither case does it offer a form. The key needed to change the limits is named the way Neon documents it: a project-scoped key, which has Editor access to its project. The end-to-end suite never calls Neon (`E2E_DISABLE_NEON`). Verification: unit `diagnostics/neon-limits-api.test.ts`, `diagnostics/neon-limits-panel.test.ts`; e2e `neon-limits.spec.ts` (2026-09-23, `DECISIONS.md` §335).
9. Given the card's form, when an Administrator saves, then:
- the ceiling is one of 0.25, 0.5, 1, 2, 4 or 8 CU and never above the plan's own autoscaling limit (Free 2, Launch 16), and the floor stays 0.25 CU;
- a monthly limit is optional;
- a new or changed limit must be above this period's CU-hours plus 5;
- on production, a new or changed limit needs the ticked confirmation that reaching it suspends the site until the next period, and that box comes back empty after a refusal;
- the limit Neon already holds is neither new nor changed: the box shows it to four decimals so it converts back to the exact seconds, so a save that changes only the size needs no confirmation on production and sends no quota.
The card recommends, on every environment, a limit with room (100 CU-hours on production, 30 elsewhere, the figures `SETUP.md` §40 records) together with Neon's spending notification, and never recommends leaving production without a limit. Verification: unit `diagnostics/neon-limits.test.ts`, `diagnostics/neon-limits-panel.test.ts` (2026-09-23, `DECISIONS.md` §335).
10. Given a save, then `updateNeonLimits`:
- refuses every role but the Administrator (`canManageRegistrations`) on the server, before asking Neon anything;
- reads Neon afresh and checks the rules against that reading;
- sends only what differs: first one PATCH for the project's defaults and quota, sending back every other key of those objects as it was, with zero meaning no limit; then one for each read-write compute not already at the chosen range, retrying 423 Locked after 0.3, 0.7 and 1.5 s;
- reads Neon back and records `neon_limits.changed` in the audit log, with the before and after values as Neon stated them, what was requested, the environment, and whether all of it applied.
When nothing needs changing, the page says "nothing to change" and no audit row is written. A refusal keeps the chosen values and names the reason: a rule, the missing variables, a key that can read but not write (with a project-scoped key as the fix), Neon busy, Neon refusing the values, or Neon unreachable. Afterwards the card shows what Neon holds. Verification: integration `diagnostics/neon-limits.test.ts`; unit `diagnostics/neon-limits-api.test.ts` (2026-09-23, `DECISIONS.md` §335).
11. Given a monthly compute-time quota on this environment's Neon project, when this period's CU-hours reach 80% of it, then `/api/health` answers `degraded` with a 503 and a `neon` block holding only `status` and the whole-number `percent`, never the quota or the hours, because the endpoint is public. The reading comes from the same project row the pages read, is cached for fifteen minutes, and is requested alongside the connection probe. A missing key, a refusal or no answer reads `ok` with `percent: null`; none of them fails the check on its own. This replaces the last sentence of criterion 5 for the quota. Verification: unit `api/health-route.test.ts`, `diagnostics/neon.test.ts` (2026-09-23, `DECISIONS.md` §335).
12. Given `/admin/tasks`, then the row "Limita lunară de calcul a bazei de date" (owned by the club, kind decision, never blocking) reads the same project row as the Costuri panel, with no second request. It is open when this environment has no quota, production included, or when Neon could not be read. It is broken (red, with its own sentence) once the period has spent 80% or more of the quota, and done otherwise. Its steps name the card and the project-scoped key. Verification: unit `diagnostics/owner-tasks.test.ts`; e2e `neon-limits.spec.ts` (2026-09-23, `DECISIONS.md` §335).
13. On production, removing the compute-time quota Neon holds needs the same ticked confirmation as setting or changing one and is refused with NEON_QUOTA_REMOVAL_UNCONFIRMED without it; saving "no limit" where none was set asks nothing, and QA asks nothing. Verification: unit `diagnostics/neon-limits.test.ts`, integration `diagnostics/neon-limits.test.ts`, e2e `neon-limits.spec.ts`.
14. Criterion 7 (amendment, §355): an interval at least as long as the hour-long cap replaces it and ends on a boundary of its own length (BR-REQ-090-03 criterion 14); the card says, in both languages, that the safety look happens on the hour together with the /api/health monitor, so an hour costs at most one wake of the database. Verification: unit `jobs/job-cadence-panel.test.ts`.

**Verification:** unit `diagnostics/neon.test.ts`; unit `diagnostics/vercel.test.ts` (4); integration `jobs/health.test.ts`; unit `diagnostics/neon-plan.test.ts`, `diagnostics/platform-plans.test.ts` (1, 2, 5); integration `diagnostics/neon-plan.test.ts` (5); e2e `neon-plan.spec.ts` (5)

#### BR-REQ-100-01 — AI reviewer permission boundary

- **Source:** BR-BUS-100
- **Implements:** AGENTS.md §22
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given the review workflow, when its permissions are inspected, then it holds only read scopes and no write scope.
2. Given the review job, when it runs, then it cannot push, merge, dispatch workflows, deploy, alter settings, or read secrets.
3. Given a comment relay, when it is enabled, then it is a separate job or app holding only the minimum comment permission, and it does not check out or execute pull-request code.
4. Given the reviewer, when it produces findings, then it is not a CODEOWNER and is not a required approval.

**Verification:** review gate; workflow permission audit in `DECISIONS.md`

### 4.12 Environments, release, and hosting

#### BR-REQ-090-01 — QA is isolated

- **Source:** BR-BUS-090
- **Implements:** AGENTS.md §7.4, §7.5
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given the QA database, when it is inspected, then its environment marker is `qa` and startup aborts if it does not match `APP_ENV`.
2. Given QA, when any page is served, then it carries `X-Robots-Tag: noindex, nofollow`.
3. Given QA, when data is inspected, then it contains only synthetic participants.
4. Given QA, when credentials are inspected, then none of them reach production resources.

**Verification:** integration `environments/isolation.test.ts`; deployment checklist

#### BR-REQ-090-02 — Release flow

- **Source:** BR-BUS-090
- **Implements:** AGENTS.md §6, §21
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given the repository, when branches are inspected, then only `qa` and `main` are long-lived and direct pushes to both are blocked.
2. Given a feature pull request, when it is merged, then it is squash-merged into `qa`.
3. Given a release, when `qa` is promoted, then it is a reviewed pull request into `main` merged with a merge commit.
4. Given a hotfix from `main`, when it is deployed, then it is merged back into `qa` before the next release.
5. Given any pull request, when CI runs, then `docs:check` is part of the required checks.
6. Given a clone on which `yarn setup` has been run, when a commit is made and `yarn check` fails, then the commit is blocked and the failure is reported.
7. Given the CI workflow and the pre-commit hook, when both are inspected, then they invoke the same `yarn check` command, so a change cannot pass locally and fail in CI.
8. When `yarn check` runs, no Server Component passes a React element as a prop, other than `children`, to a client component. Client components here are anything from `@mui/*`, a `next` client component, next-intl's `Link`, or a local `"use client"` module. The one exception is a prop the installed library is shown, by its own source, to render as a child: `Alert`'s `action`. `yarn test:e2e:dev` runs on demand and not in CI. It requests every backoffice route (as a Superadministrator) and every public route under `next dev`, twice each, and fails on any 5xx. Verification: unit `shared/server-element-props.test.ts`; e2e `dev-routes.spec.ts` with `E2E_DEV=1` (2026-09-24, `DECISIONS.md` §370).

**Verification:** repository settings audit; CI configuration; `.githooks/pre-commit` and `.github/workflows/docs-check.yml` compared

#### BR-REQ-101-01 — Hosting portability

- **Source:** BR-BUS-101
- **Implements:** AGENTS.md §7.3
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a clean checkout, when `yarn install --immutable && yarn build && yarn start` runs, then the application starts and honours `process.env.PORT`.
2. Given the source tree, when it is inspected, then no provider-specific business API and no Vercel-only runtime API is used.
3. Given the running application, when it writes, then no durable business data is written to the local filesystem.
4. Given QA and production, when their configuration is compared, then they share no database, bucket, authentication instance, or secret.
5. Given a public page — the listing, an event page, the calendar, the gallery, a standing page, the terms, the privacy notice, the contact page, the sitemap, the calendar feeds, the share pictures, the language switch, a 404 — requested again with nothing written in between, then it issues no database query. The cache is Next's own data cache, with no provider service; it is keyed per deployment on Vercel and per process under `next start`, and `next build` never writes it, so CI still builds with no database (§333). Verification: unit `public-cache/cache.test.ts` (no public route imports the pool; build and dev read through); measured with statement logging (§333).
6. Criterion 5 (addition): the by-slug public reads — an event page, a standing page, an album — cache their answer, a miss included, only for a slug of the shape every saved slug has (lowercase words joined by single hyphens) and at most 200 characters; any other slug is answered by the database and leaves no cache entry, as the language switch does for a path over 300 characters (§340). Verification: unit `public-cache/slug-key.test.ts`, `public-cache/locale-switch-key.test.ts`.

**Verification:** integration `hosting/portability.test.ts`; deployment checklist

#### BR-REQ-101-02 — Domain binding is a configuration change

- **Source:** BR-BUS-101
- **Implements:** AGENTS.md §8, SETUP.md §26
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given the source tree, when CI runs, then no hostname literal exists under `src/`.
2. Given a change of `APP_BASE_URL`, when the application restarts, then email links, canonical tags, `hreflang` alternates, sitemap entries, Open Graph URLs, authentication callbacks, and the webhook URL all reflect the new host with no code change.
3. Given cookies, when they are set, then no `domain` attribute is used.
4. Given the binding runbook, when it is completed, then exactly one canonical production host serves the site and the other redirects to it.
5. Given a second domain the club holds, when it is bound as an alias, then it and its `www` redirect permanently to the canonical host; and making it the canonical host instead is the same configuration change in reverse — `APP_BASE_URL` and the host-level redirects — with no code change.

**Verification:** integration `hosting/base-url.test.ts`; `docs/RUNBOOKS.md` § Domain binding; `scripts/bind-domain.mjs`

#### BR-REQ-090-03 — Scheduled work is a liveness concern only

- **Source:** BR-BUS-034, BR-BUS-035, BR-BUS-090
- **Implements:** AGENTS.md §10.6, §16.2
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given a hold whose deadline has passed and a maintenance job that has not run for an hour, when the public availability is read, then the expired hold is not counted as occupied.
2. Given the same conditions, when a new registration is submitted, then it receives the released place through the normal capacity transaction.
3. Given a job invocation that runs for real, when it completes, then a `job_runs` row records the outcome; a ping answered from the cache (criterion 9) writes no row and leaves a ping slot instead.
4. Given a job whose pinger has not called within twice the cadence in force plus five minutes — measured against the cached pings, or the last real run when the cache remembers none — or whose last real run is older than max(60 minutes, the minimum interval) plus that threshold, when the health endpoint is read, then it reports degraded.
5. Given a job endpoint, when it is called without a valid `JOB_SECRET` or scheduler identity, then it is refused.
6. Given a job endpoint called with a valid secret more often than the limit for the window, then further calls are refused with `429` and a `Retry-After`; and given calls refused at criterion 5, then they are not counted against that limit.
7. Given the retention sweep, when a step throws, then the other steps still run, each in its own transaction, with the 7-day clearing first. The failing steps are written to job_runs.last_error by name. Given two consecutive runs that wrote a retention failure, when /api/health is read, then the job reports failing and the endpoint answers 503.
8. Given the registration-maintenance job running on time whose retention sweep failed two runs in a row, when /admin/tasks renders, then a red developer-owned retention-sweep row names the job and points at /devs; the scheduler row stays done, and a clean run clears the row (2026-09-23, `DECISIONS.md` §324).
9. Criterion 9: Given a real run that left its plan in Next's data cache, when a job endpoint is called with a valid secret before the plan's instant (the soonest work, capped at 60 minutes, or at the minimum interval when that is longer) or inside the Administrator's minimum interval, then it answers 200 with `ran: false`, the reason and the instant, opens no database connection and writes no `job_runs` row. The secret is checked before the cache is read; a missing slot runs for real; the cap and the interval end two minutes early so the pinger's call a whole period later runs even when it lands just before the boundary; and a run with a retryable failure (retention included) promises no quiet. Verification: unit `jobs/schedule.test.ts`, `jobs/schedule-cache.test.ts`; integration `jobs/job-sleep.test.ts`.
10. Criterion 10: Given a real run, when it finishes, then it computes from the database the earliest instant its job next has work — for maintenance the soonest hold or offer deadline, email-link lapse, event start, registration close, reminder window, participation-window opening and interest opening; for the outbox the soonest claimable row — and null when nothing waits, which the plan caps. Verification: integration `jobs/next-work.test.ts`.
11. Criterion 11: Given a write path that creates work sooner than the longest quiet any run can promise — registration submit (a verified restart including any offer made on the way), email confirmation, signing, desk confirmation, promotion, cancellation and erasure, the interest box, event saves and transitions, a new series, the drain that leaves rows behind or runs in scheduled delivery, the delivery-timing and cadence settings — when its transaction commits, then that job's cached quiet is invalidated and the next ping runs for real; work further away invalidates nothing. Verification: integration `jobs/job-sleep.test.ts`; unit `notifications/drain-wakes-outbox.test.ts`.
12. Criterion 12: Given pings that all answer from the cache, when `/api/health` is read, then the job reports ok while the last ping is within the threshold and a real run within max(cap, interval) plus it; and email health widens "overdue" by the full minimum interval whenever one is set, so a retry 110 minutes overdue at night under a 60-minute interval is not stalled. Verification: integration `jobs/health-pings.test.ts`, `jobs/health.test.ts`.
13. Criterion 10 (amendment): the maintenance job's next work is computed from scheduled events only, as the job itself acts on them; a cancelled event's holds, start, close and reminders are no instant, and putting the event back on is a save that wakes the job. Verification: integration `jobs/next-work.test.ts`.
14. Given a real run, when it plans its quiet, then the hour-long cap ends two minutes before the latest top of the hour on the club's clock that is at most sixty minutes after the run, and never later than the run plus sixty minutes less the grace. The Administrator's minimum interval ends two minutes before the first boundary of its own length (quarter-hours for 15, :00/:30 for 30, the hour for 60, even hours for 120, on the club's clock through daylight saving) that is at least the interval after the run. It never ends sooner than the interval less the grace, and at most one pinger period (15 minutes) later than the interval: a boundary further away is reached over several runs, each at most that late. A deadline the work itself has (`nextWorkAt`) is never moved. No health threshold of criteria 4 and 12 moves, and the job threshold holds with any one pinger call dropped (2026-09-24, `DECISIONS.md` §355). Verification: unit `jobs/schedule-alignment.test.ts`, `jobs/schedule.test.ts`, `jobs/job-cadence-panel.test.ts`; integration `jobs/job-sleep.test.ts`.
15. 9 (amendment, 2026-09-24, `DECISIONS.md` §355): the plan's instant is the soonest work, or the cap on the pinger's top of the hour at most 60 minutes after the run, or the minimum interval's aligned end when that interval is at least the cap (criterion 14). The cap and the interval end two minutes before their boundary, so the pinger's call on the boundary runs even when it lands just before it. This replaces "capped at 60 minutes" and "the pinger's call a whole period later".

**Verification:** integration `jobs/maintenance.test.ts`, `jobs/job-throttle.test.ts`

---

## 5. Traceability

| Business rule | Requirements |
| --- | --- |
| BR-BUS-001 | BR-REQ-001-01 |
| BR-BUS-010 | BR-REQ-010-01, BR-REQ-052-02 |
| BR-BUS-011 | BR-REQ-011-01 |
| BR-BUS-012 | BR-REQ-012-01, BR-REQ-032-03 |
| BR-BUS-020 | BR-REQ-020-01, BR-REQ-040-02 |
| BR-BUS-030 | BR-REQ-030-01 |
| BR-BUS-031 | BR-REQ-031-01, BR-REQ-031-02, BR-REQ-031-03 |
| BR-BUS-032 | BR-REQ-032-01, BR-REQ-032-02, BR-REQ-032-03, BR-REQ-032-04, BR-REQ-012-01 |
| BR-BUS-033 | BR-REQ-033-01, BR-REQ-033-02, BR-REQ-033-03, BR-REQ-033-04, BR-REQ-031-03 |
| BR-BUS-034 | BR-REQ-034-01, BR-REQ-034-02, BR-REQ-034-03, BR-REQ-052-02, BR-REQ-090-03 |
| BR-BUS-035 | BR-REQ-035-01, BR-REQ-035-02, BR-REQ-035-03, BR-REQ-035-04, BR-REQ-035-05, BR-REQ-034-03, BR-REQ-090-03 |
| BR-BUS-036 | BR-REQ-036-01, BR-REQ-036-02 |
| BR-BUS-037 | BR-REQ-037-01, BR-REQ-037-02, BR-REQ-037-03, BR-REQ-037-04, BR-REQ-037-05, BR-REQ-037-06, BR-REQ-037-07, BR-REQ-037-08, BR-REQ-038-01, BR-REQ-033-03, BR-REQ-033-04, BR-REQ-035-05 |
| BR-BUS-038 | BR-REQ-038-01, BR-REQ-038-02, BR-REQ-038-03 |
| BR-BUS-039 | BR-REQ-039-01 |
| BR-BUS-040 | BR-REQ-040-01, BR-REQ-040-02, BR-REQ-040-03, BR-REQ-040-04 |
| BR-BUS-041 | BR-REQ-041-01 |
| BR-BUS-050 | BR-REQ-050-01 |
| BR-BUS-051 | BR-REQ-051-01, BR-REQ-051-02 |
| BR-BUS-052 | BR-REQ-052-01, BR-REQ-052-02, BR-REQ-070-03, BR-REQ-070-02 |
| BR-BUS-053 | BR-REQ-053-01, BR-REQ-053-02, BR-REQ-033-02, BR-REQ-031-02 |
| BR-BUS-060 | BR-REQ-060-01, BR-REQ-051-01 |
| BR-BUS-070 | BR-REQ-070-01, BR-REQ-070-02, BR-REQ-070-03, BR-REQ-070-04, BR-REQ-036-02, BR-REQ-038-01, BR-REQ-039-01, BR-REQ-041-01, BR-REQ-071-01, BR-REQ-072-01 |
| BR-BUS-071 | BR-REQ-071-01 |
| BR-BUS-072 | BR-REQ-072-01 |
| BR-BUS-080 | BR-REQ-080-01, BR-REQ-080-02, BR-REQ-080-03, BR-REQ-080-04, BR-REQ-037-02 |
| BR-BUS-090 | BR-REQ-090-01, BR-REQ-090-02, BR-REQ-090-03, BR-REQ-090-04, BR-REQ-080-03 |
| BR-BUS-100 | BR-REQ-100-01 |
| BR-BUS-101 | BR-REQ-101-01, BR-REQ-101-02 |

---

## 6. Later milestones and unplanned items

Milestones M2 to M5 are in scope and scheduled, in that order. Their requirements are written
when each milestone starts, except for the M1 footprints already in section 4. Do not
implement a later milestone's behavior early, and do not create its routes, enum values, or
abstractions in advance.

The unplanned list in `BUSINESS.md` §8 is authoritative. Nothing in it may be built without an
owner decision recorded in `DECISIONS.md` and reflected here.

Three items deserve emphasis because they look small and are not:

- **Verified-email change and participant merge.** They need a verification workflow, a
  migration plan, and an audit design. Cancel and restart is the answer until decided.
- **A legal-document editor screen.** Approved versions load through the runbook. An editor
  implies approval workflow, preview, and rollback.
- **Result categories by age or gender.** They require collecting birth year and gender,
  which is a privacy decision with a stated purpose, not a feature toggle.

---

## 7. Document synchronization

Operational guidance for satisfying these requirements lives in
[`docs/PRACTICES.md`](./docs/PRACTICES.md). Those guides are not authoritative: if one
disagrees with this document, this document wins.

A change to any requirement here follows the change-type matrix in `AGENTS.md` §1.4: the complete set of edits across every affected document, in one pull request, with the baseline marker bumped in the same commit and a rationale appended to `DECISIONS.md`.
