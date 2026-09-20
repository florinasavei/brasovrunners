<!-- PROJECT_BASELINE: BR-V1.38-2026-09-18 -->

# Brașov Runners — Requirements and Acceptance Criteria

**Baseline `BR-V1.38-2026-09-18`** · versioned with the whole set · [changelog](./CHANGELOG.md)


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

**Verification:** e2e `registration-form.spec.ts` and `registration-entry.spec.ts` under both Playwright viewport projects; unit `registrations/form-errors.test.ts`; release check on a real device

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
11. Given a translation with a full description — a rich-text document written in the editor of AGENTS.md §11.3, validated against the same allowlist as a standing page — when the event page (and its preview) renders, then it appears in the short description's place — the short one is the card's, and stands on the page only while no full description exists (2026-09-20, `DECISIONS.md` §156) — rendered through the allowlisted renderer and nothing else; an empty document renders nothing (2026-09-18, `DECISIONS.md` §71).

12. Given the featured event within seven calendar days of its start — counted on the event's own calendar, never the server's — when the homepage renders, then the hero carries a countdown line ("Mâine, sâmbătă 07:00"; "În 3 zile, …") above the registration control; while registration is open the free places show as before, and once it has closed the sentence says to come to the desk with the QR. Server-rendered, no script. On a phone, "Alte evenimente" under the hero is a native disclosure, open when there are four or fewer and folded when there are more; on a wide screen it is always open (2026-09-18, `DECISIONS.md` §78).
13. Given a published internal event whose `registration_opens_at` is ahead, when the hero, the event page, a listing or series card and the calendar feed render, then each says when registration opens in the event's zone — "Înscrierile se deschid pe <date>" at the countdown's size where the button will stand, one short line on the card, the same sentence with the form's address after it in the calendar entry (2026-09-20, `DECISIONS.md` §159) — and the event page carries a box under it, only while an approved privacy notice exists for the locale (BR-REQ-053-01; no notice, no box, and a submission past the page is refused): one address, "Anunță-mă", the sentence that one email follows and the address is then deleted, and the link to the privacy notice. Submitting keeps one row per event and canonical identity (`registration_interests`, the versioned canonicalizer of BR-REQ-032), answers "Te anunțăm pe email" whether the row was new or already there, refuses only a malformed address — timing the corrected form from the render it corrects — and takes the registration form's honeypot, timing check and Turnstile with the form's silence; nothing of the address ever goes into a URL. The box is gone, and a late submission redirected to the plain page, once the window is no longer ahead. In the backoffice an Administrator sees how many addresses wait, never which, and can withdraw one by the address the person wrote from, by its canonical identity (2026-09-19, `DECISIONS.md` §146).

**Verification:** integration `events/configuration.test.ts`, `registrations/interest.test.ts`; unit `events/zoned-time.test.ts`, `events/ical.test.ts`; e2e `event-pages.spec.ts`

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
13. Given a series on view — the listing's card, the calendar, the backoffice's folded dates — when one of its dates is cancelled, at another place than most of them, or at another hour, then that date is struck through (cancelled) and carries a mark whose tooltip and accessible name say which ("Anulată", "Nu în locul obișnuit: …", "Nu la ora obișnuită: …"); a date like the others carries none (2026-09-19, `DECISIONS.md` §122).

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

**Verification:** integration `registrations/entry-details.test.ts`, `registrations/minors.test.ts` (9); unit `registrations/socials.test.ts` (8); e2e `registration-submit.spec.ts`

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
3. Given the hold, when 30 minutes pass without acceptance and the waiting list wants the place — or the event has started or been cancelled — then the status becomes `EXPIRED` with `expiry_reason = DECLARATION_HOLD_LAPSED` and the place is released to the queue; exactly `waiting − free` holds are released, the earliest deadline first, so one person joining the list takes back one place and no more; and given a lapsed hold the queue does not want, then the status stays `PENDING_DECLARATION`, the place stays occupied in the count, the maintenance job does not select the event, and the participant may still sign online at any time before the start (the email's link lives until the start, read from the event's own row) or on paper at the desk — including after the start, where `confirmByStaff` re-allocates the hold the start expired rather than refusing it. A registration that joins the waiting list behind such a hold is offered the place in the same transaction; two days before the start the declaration email goes once more to whoever still owes a signature; and a signature against a `CANCELLED` event is refused (`DECISIONS.md` §160).
4. Given a hold that would extend past registration close or event start, when it is created, then it is capped at the earlier of the two.
5. Given a registration that has not reached `CONFIRMED`, when the participant list is inspected, then that person is not counted as attending.

6. Given an event further away than its participation window (`confirmation_opens_days_before`, default 7; deadline `confirmation_deadline_days_before`, default 2 — both per event, zero switches the window off), when a registration clears email verification, then its hold lasts until the deadline rather than 30 minutes and is not capped by registration close; the declaration email says the deadline and that the signature is the confirmation of participation; when the window opens the maintenance job queues that email once more per waiting registration; a signature at any point confirms; an unsigned hold lapses at the deadline through criterion 3, which is to say only when somebody is waiting for the place (§160) — the email says the place is held, that the registration is complete only with the signed declaration, online or on paper at the desk, and that the place is held until the deadline if a waiting list forms. Inside the window, and on an event without one, criterion 3's thirty minutes stand. The wizard's third step says which applies (`DECISIONS.md` §104).

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

11. Given `DECLARATIONS_ARCHIVE_TO` set to the club's mailbox, when a real registration's declaration is signed — by link or on paper — then a `DECLARATION_ARCHIVE` message is queued to that address with the same PDF attached, a subject naming the participant and the event, and no action link or token; unset, or for a test registration, no such message exists (`DECISIONS.md` §99).

**Verification:** integration `registrations/lifecycle.test.ts` (criterion 6), `registrations/signed-declaration.test.ts` (7–10), `registrations/declaration-archive.test.ts` (11), `jobs/retention.test.ts`; unit `legal-documents/merge-fields.test.ts`; e2e `registration-form.spec.ts`

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
7. Given every staff role, including Contributor, when a desk verb (enter, confirm, give a place, set a number, check in) is attempted, then it is allowed; and given any role below Administrator, when cancel, erase, rename, resend, the list or the export is attempted, then it is refused as before (BR-REQ-060-01).
8. Given a `PENDING_DECLARATION` registration whose hold deadline has passed and which was kept because the queue did not want its place (BR-REQ-033-01 criterion 3, `DECISIONS.md` §160), when the desk confirms it on paper, then it is confirmed as in criterion 3 — the place was never released, so no capacity check is needed and none is made; and given the same registration after the event's own start released the hold, when the desk confirms it, then the allocator decides again under the lock and confirms it into a place that is still free rather than refusing it. The backoffice journey shows "termen depășit, locul se ține cât nu așteaptă nimeni" for such a hold — the condition in the words, because the row is rendered in a list that spans many events and reads no queue of its own.

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
4. Given the desk, when a code is scanned (the browser's own `BarcodeDetector`, where it exists) or typed, then the one registration it names is shown from any event; when a name fragment or a race number is typed, then the chosen event's registrations that are not cancelled or expired are listed, pending ones included, matched with the same diacritics-blind search as the list; and the event's counts — confirmed, checked in, without a number, not yet confirmed — are on the page.
5. Given a confirmed registration, when staff mark it here, then `checked_in_at` and `checked_in_by_staff_user_id` are set, idempotently; undoing clears both; anything not confirmed is refused; each writes an audit row. Given the participant's own manage link from twenty-four hours before the start, when they press "I am here", then `checked_in_at` is set with no staff id, the token is read and not spent, and the same page shows their code and QR.
6. Given a walk-in on the desk, when "add somebody" is used, then the staff entry form opens with the fast track ticked and returns to the desk with the outcome (BR-REQ-037-07 criterion 4).
7. Given the whole of race day, when a volunteer opens the desk, then the steps — before, at the table, after, and what to do when each thing goes wrong — are on the page itself, and the guide at `/admin/guide` says the same for every role.

**Verification:** integration `registrations/race-day.test.ts`; unit `registrations/checkin-code.test.ts`, `notifications/templates.test.ts`; e2e `race-day.spec.ts`

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

**Verification:** integration `registrations/bibs.test.ts`, `registrations/race-day.test.ts`; unit `registrations/bibs-pdf.test.ts`

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
14. Given the editor, when it renders, then the type, surface, difficulty and cost selects show each option with its glyph, the type offers Group run, Race, Hike, Coffee, Equipment testing, Other event and External event, and a co-host's name and page may be entered — shown as "Together with …" in the facts and carried by a duplicate and a repeat (2026-09-19, `DECISIONS.md` §121).
13. Given the editor of any type but a group run, when it renders, then a "Programme" section offers rows — a date, a 24-hour time, an optional end time, the label in Romanian and in English, a place — with "Add a row" and a remove control per row; when saved, then each row's wall-clock time in the event's zone is stored as an instant, the rows sorted soonest first, a row left entirely blank is dropped, and a row missing its date, its time or either label — or ending before it starts — is refused naming the row's number, with nothing written; when the event is duplicated, then the rows go with it; when it is repeated, then each occurrence's rows are moved by the same interval on the wall clock (2026-09-19, `DECISIONS.md` §117).
15. Given the editor of an event that is in a series — a date, or the source with the rule — when it renders for a role that edits event settings, then three radios above Save offer "this date only" (the default), "this and the following dates" and "all dates of the series"; when a save is made with either of the last two, then, in the same transaction, only the fields this save changed are written to those dates — a changed instant at the same wall-clock time on each date's own day, the programme's rows shifted by the same days — while the featured flag, the rule, the publication state, a film, a Strava event and every slug stay each date's own, a date's own one-off place or status stays unless that is what changed, a capacity below one date's places taken refuses the whole save naming the day, "following" is by the day this date had before the save, every touched row takes a new version, and the banner says how many other dates were written (2026-09-19, `DECISIONS.md` §130).
16. Given the editor of an event that is in a series, when it renders, then a framed header names the series, says in words which date is open (weekday, date, time), its position ("date 3 of 9"), shows every date of the series as a chip linking to its editor — the open one filled and current, a cancelled or moved one marked as on the public card — and offers the previous and the next date by name, and from a date the way to the source (2026-09-19, `DECISIONS.md` §131).
17. Given the editor of an event that is in a series, when the organizer saves, then the save reaches exactly the other dates ticked in the header — each chip a tick, its arrow the way to that date's editor, "Toate" ticking every one — and the framed, folded box above Save says the choice in words and offers "this date only", "this and the following dates" and "all dates" as one exclusive control that sets the ticks; the service ignores an id outside the series and treats no tick as this date only (2026-09-19, `DECISIONS.md` §134).
18. Given a published event page, when a signed-in staff member who may edit the words opens it, then an "Editează" button, 44 pixels tall, leads to that event's editor; a visitor, a volunteer, and every deployment with staff sign-in disabled see no such button (2026-09-19, `DECISIONS.md` §135).

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
2. Given an Editor or Administrator, when they review a submission, then they can publish, unpublish, and archive the event, and both languages go live or come down together.
3. Given published content, when a volunteer attempts to edit it, then it is refused; a copywriter's live edit is accepted with the acknowledgement of criterion 4.
4. Given a save that affects live content, when it is submitted, then the interface warns before it takes effect.
5. Given two editors saving the same record, when the second save carries a stale version, then it is rejected as a conflict, and the first editor's save survives intact. This is verified with two real database connections, not the in-process test database, which is single-connection and cannot express the race. The event row carries a version of its own, so a publish that races a change to the event is a conflict too.
6. Given an event where any language is missing a field the public page renders, or has no translation at all, when publication is attempted, then it is refused with the language and the missing fields named, and nothing goes public.

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
8. Given a published event page, when it renders, then its `og:image` is a 1200×630 card drawn on the server from the event's own facts (title, date and time, meeting point, distance), absolute under `APP_BASE_URL`, with `twitter:card = summary_large_image`; every other public page carries the site's card; and the event page offers, as 44-pixel buttons, the phone's own share sheet where `navigator.share` exists, Facebook, WhatsApp and the same card as a square picture under "Instagram", with "add to calendar" as its own row (2026-09-18, `DECISIONS.md` §90; 2026-09-19, §140).
9. Given an event not marked as charging a fee, when its block renders, then it carries `isAccessibleForFree: true` and an `Offer` at price `0` in `RON` at the event's own page, valid from its publication; a `PAID` event carries neither; and given an event with a co-host, then `organizer` is the club followed by the co-host as an `Organization` with its page (2026-09-19, `DECISIONS.md` §121).

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
4. Given a version that is approved or referenced, when any interface attempts to change its text, then it is refused — editing is confined to unapproved, unreferenced drafts (BR-REQ-053-02). An approved version is also never deleted and its approval is never withdrawn (`DECISIONS.md` §53).
5. Given the public site, when any page renders, then the privacy notice and terms are reachable in the current locale.
6. Given any environment other than production, when it is seeded, then a clearly marked sample version of each key exists, whose own rendered body opens — in both languages — with a banner saying that it is sample text, is not approved by the club, is not legal advice, and must be replaced before a real participant registers.
7. Given `APP_ENV=production`, when the sample text is seeded, then it is refused outright rather than skipped quietly; the club's approved wording is written in the backoffice (BR-REQ-053-02) or, where a migration is preferred, per `docs/RUNBOOKS.md` § Legal document version.
8. Given a sample document, when it is read, then every club-specific fact — the controller's legal name, address and contact, any representative, retention periods, and the lawful basis for each purpose — is an obvious placeholder rather than an invented value.

9. Given a legal text, when a paragraph carries `[the words](https://…)` or `![what it shows](https://…)` on a line of its own, then the page renders a link (https, mailto or a path on this site; anything else stays words) and a picture (https only, lazy, at most the column's width, its words as the caption); the PDFs render the link as "the words (address)" and the picture as its words; the stored body, its hash and the merge fields are the plain text as typed (2026-09-19, `DECISIONS.md` §127).

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
10. Given a version that is approved, when deletion is attempted, then it is refused with a conflict whether or not anything references it — the record of what the club published outlives whether anybody acted on it.
11. Given a version that an acceptance names, an event points at, or a registration recorded the number of as the privacy notice it acknowledged, when deletion is attempted, then it is refused with a conflict.
12. Given the backoffice list of versions, when it renders, then each row states how many acceptances, events and registrations depend on that version, and a version that cannot be deleted states which of those reasons applies rather than omitting the control.
13. Given a version deleted between the moment approval was checked and the moment it was written, when approval completes, then it is refused rather than reporting success.
14. Given an approved version, when withdrawing its approval is attempted, then there is no such operation: `DECISIONS.md` §53 records that a declaration is bound to the participant at submission rather than at render, so changing which version is current would let somebody sign text they never read.

**Verification:** integration `legal/editor.test.ts`, `legal/deletion.test.ts`

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

**Verification:** unit `notifications/templates.test.ts`, `notifications/mailgun-adapter.test.ts`; integration `notifications/event-mail.test.ts`, `registrations/signed-declaration.test.ts`, `registrations/interest.test.ts`

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

7. Given an Administrator on `/admin/emails`, when they set the Mailgun plan the account is on — Free, Basic, Foundation, Scale, or a custom one with the ceilings typed — then the setting is stored once (`platform_settings.emailPlan`) with an audit row naming who changed it from what; every figure that says how much can still be sent (the outbox panel, `/devs`, `/admin/tasks`, the "send now" stop) counts against that plan's ceiling over its own period — Free's day, a paid plan's month, none at all — and the cost table carries the plan's price; a Moderator is refused; an unreadable stored value reads as Free (`DECISIONS.md` §100).

**Verification:** integration `notifications/outbox.test.ts`; integration `notifications/send-now.test.ts`; integration `notifications/email-health.test.ts`; integration `notifications/email-plan.test.ts` (7); unit `notifications/email-plan.test.ts`

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
2. Given an Editor, when they request participant or export endpoints, then it is refused.
3. Given an unauthenticated request to any `/admin` route, when it is made, then it is refused.
4. Given each guarded endpoint, when tests run, then authorization is asserted at the server, not only in the UI.
5. Given an Administrator, when they administer staff, then they may add a colleague by email address and role, change a colleague's role, and revoke access; an Author or an Editor is refused every one of those operations.
6. Given an Administrator, when they attempt to change their own role, remove their own access, or leave the club with no Administrator at all, then it is refused.
7. Given the development staff switcher, when `APP_ENV` is qa or production, then it is unavailable, and a process configured to use it there does not start.
8. Given a volunteer, a copywriter or an Editor, when they attempt to delete an event or to add or remove test registrations, then it is refused at the server; both are the Administrator's alone. Given a volunteer, when they open `/admin`, then they land on the desk, and the tabs offer the desk and the guide only; given any staff role, when they open `/admin/guide`, then their own role's sections come first and open (§103).
9. Given `APP_ENV=production`, when a test registration is created by any path, then it is refused — at the feature's entrance and again at the statement that would write the row.

10. Given a Superadministrator adding a person on Echipa where Zitadel is the provider and `ZITADEL_MANAGEMENT_PAT` is set, when the row is added, then the person's Zitadel account is created with that address (verified) and Zitadel sends them the invitation to choose a password, and the page says so; an account that already exists is left as it is and reported; a missing key or a refusal by Zitadel still adds the row and says what to do in the console; a row that has never signed in offers "Resend the invitation" (2026-09-19, `DECISIONS.md` §123).
11. Given an Administrator adding a person on Echipa, when the row is added, then `STAFF_INVITATION` is queued in the same transaction — to that address, in the person's language, naming who added them, the role and the sign-in page, with no token — and goes out through the club's own outbox whether or not a Zitadel key is set; "Resend the invitation" on a row that never signed in queues it again with a new key, and is refused once they have signed in (2026-09-19, `DECISIONS.md` §141).

**Verification:** integration `auth/role-boundaries.test.ts`, `cms/crud.test.ts`, `registrations/test-kind.test.ts`; unit `staff/roles.test.ts`, `staff/zitadel-users.test.ts`; e2e `cms-publish.spec.ts`

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

**Verification:** e2e `seo.spec.ts`; accessibility audit in CI

#### BR-REQ-070-04 — Contact form

- **Source:** BR-BUS-070
- **Implements:** AGENTS.md §16, §19.4
- **Priority:** SHOULD
- **Release:** M1
- **Status:** built (`DECISIONS.md` §149). `/contact` in both locales; the message leaves by SMTP through the club's own mailbox account and never through the outbox or Mailgun.

**Acceptance criteria**

1. Given a visitor on `/<locale>/contact`, when the page renders, then it offers a name, an email address and a message (at most 2 000 characters — the longest a rejection can hand back in the draft cookie, proven by a unit test), the same bot defences as the registration form (trap field, fill-time check, Turnstile when configured), a 44 px submit control and a sentence linking the privacy notice; it is linked from the header (while the page has a form or the club's address to show — a deployment with neither has no entry, as the gallery has none without an album) and the footer in both locales, and is in the sitemap.
2. Given a submission, when it is validated, then the address is validated like the registration form's and canonicalized; a rejection returns to the page with the field names only in the URL, the typed values kept in the encrypted draft cookie, and a focusable summary naming each box.
3. Given a valid submission from a person, when it is sent, then one message reaches every address in `CONTACT_FORM_TO` — from the configured account with the club's name, `Reply-To` the visitor with their name, subject `Mesaj de pe site: <name>`, a plain-text body carrying the name, the address, the message and the page, and an HTML twin with the visitor's text escaped — over SMTP, not through the email outbox, not through `EMAIL_DELIVERY_MODE`, and never through Mailgun; on QA the subject carries the outbox's `[QA] ` mark (AGENTS.md §16.4); the platform stores no copy.
4. Given a submission that trips the trap field or the fill-time check, when it is answered, then the answer is the same "sent" page and nothing is sent.
5. Given more than five submissions in an hour from one canonical email identity, when the next arrives, then it is refused with a plain sentence saying so and the typed message is kept — never silently, because a person is not a bot; the counter is `rate_limit_buckets` scope `contact-message`, keyed on a hash of the canonical identity (the address itself is never stored), never on an IP; a deployment with no way out answers before anything is counted, and a send the SMTP server refused is given back, so a retry on a day the mailbox is down never turns into "too many messages".
6. Given `APP_ENV` local or test, when a message is sent, then it is captured in memory and no SMTP connection is opened; given a deployment without `CONTACT_SMTP_USER`, `CONTACT_SMTP_PASSWORD` and a non-empty `CONTACT_FORM_TO`, when the page renders, then it shows the club's contact address as a link instead of the form, and the process starts; given a send the SMTP server refuses, when the action answers, then the page says so and names the club's address to write to, and the function log carries the failure's code (`smtp EAUTH`, `smtp ESOCKET`) and never the password or the server's reply.
7. Given `/admin/tasks` and `/devs`, when they render, then the contact form's state (SMTP, capture, off) is reported with the steps to configure it and the missing variables named, and no value of any variable is ever shown.
8. Given the privacy-notice template, when it is read in either language, then it says what the form collects, that the message goes to the club's mailbox and stays there as ordinary correspondence, the legal basis (legitimate interest in answering the request, art. 6(1)(f) GDPR), and that the details are used for nothing else.

**Verification:** unit `contact/fields.test.ts`, `contact/message.test.ts`, `config/env.test.ts`, `diagnostics/configuration.test.ts`, `diagnostics/owner-tasks.test.ts`; integration `contact/service.test.ts`; e2e `contact.spec.ts`

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
- **Status:** built.

**Acceptance criteria**

1. Given `NEON_API_KEY` and `NEON_PROJECT_ID`, when `/devs` renders, then it shows this project's CU-hours used in the current period against the Free plan's 100, the hours the compute was awake against the hours elapsed, and the period's end — read from Neon with a five-second timeout, and a sentence rather than an error when Neon does not answer; when they are not set, it says how to set them and shows the rest of the page.
2. Given eighty percent of the allowance used, when the figure renders, then it is shown as a warning.
3. Given the outbox, when a request queues a message, then that request drains the outbox once after its own response is sent, so delivery does not wait for the scheduler; the scheduler's cadence in production is fifteen minutes by day and hourly by night (23:00–07:00 `Europe/Bucharest`, `jobs/quiet-hours.ts`), the health threshold is twice the cadence in force plus five minutes, and the compute sleeps between runs.

4. Given `VERCEL_API_TOKEN` and `VERCEL_PROJECT_ID`, when `/devs` renders, then it shows this month's deployments, today's against Hobby's 100 a day, and the build minutes against Hobby's 6,000 a month, warning at eighty percent of either, summed from Vercel's deployments list across its pages; without them it says how to set them; and it says that bandwidth and invocations are not in Vercel's API and links to the dashboard's Usage page (`DECISIONS.md` §101).

**Verification:** unit `diagnostics/neon.test.ts`; unit `diagnostics/vercel.test.ts` (4); integration `jobs/health.test.ts`

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
3. Given a job invocation, when it completes, then a `job_runs` row records the outcome.
4. Given a job that has not succeeded within its agreed threshold, when the health endpoint is read, then it reports degraded.
5. Given a job endpoint, when it is called without a valid `JOB_SECRET` or scheduler identity, then it is refused.
6. Given a job endpoint called with a valid secret more often than the limit for the window, then further calls are refused with `429` and a `Retry-After`; and given calls refused at criterion 5, then they are not counted against that limit.

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
