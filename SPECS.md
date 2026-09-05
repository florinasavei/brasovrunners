<!-- PROJECT_BASELINE: BR-V1.21-2026-09-05 -->

# Brașov Runners — Requirements and Acceptance Criteria

**Baseline `BR-V1.21-2026-09-05`** · versioned with the whole set · [changelog](./CHANGELOG.md)


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
| M2 — Race features | Multi-distance UI, bibs, results with consent, backoffice completeness | Written at milestone start; M1 carries the schema footprints (BR-REQ-012-01, BR-REQ-072-01) |
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

**Acceptance criteria**

1. Given an event that is not published, when either language's URL is requested, then both 404, and the event is absent from both listings and from the sitemap.
2. Given a published event that has no translation in one language, when that language's URL for it is requested, then the page 404s and does not display the other language's body.
3. Given the same event, when that language's listing is requested, then the event is absent from it, and the sitemap contains only the language it has a translation for.
4. Given a published event with a translation in both languages, when it is unpublished, then both languages stop being reachable in the same moment.
5. Given the language switcher on a page whose event has no translation in the target language, when it is used, then it lands on that language's event listing rather than on a 404.
6. Given an event's meeting point, street address, difficulty or cost, when either language's page renders, then it shows the one value stored on the event — this is a shared field, not a translation, and not a fallback (AGENTS.md §11.7).

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

**Verification:** e2e `mobile/*.spec.ts` with a mobile Playwright project; release check on a real device

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

#### BR-REQ-010-01 — Event kinds

- **Source:** BR-BUS-010
- **Implements:** AGENTS.md §10.1
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given an event of each supported kind, when it is displayed, then its kind is presented with a localized label in both locales.
2. Given an event of kind `RACE`, when it is registered for, then it uses the same registration model as any other kind.
3. Given a request to create an event with an unsupported kind, when it is submitted, then it is rejected.

**Verification:** unit `events/kind.test.ts`; e2e `events-listing.spec.ts`

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
7. Given an event with coordinates, when its page renders, then the meeting point and the address link to that exact point, and the `SportsEvent` block carries `geo` and `hasMap`. The link is built from `MAP_LINK_BASE_URL`, which is configuration: `AGENTS.md` §8 forbids a map hostname under `src/` and exempts no provider, so a club with no map service configured sees the meeting point as text rather than a guessed link.
7a. Given coordinates, when they are saved, then latitude and longitude are present together and within ±90 and ±180; the database refuses half a pair, a value out of range, and a transposed pair. A stored `map_url` overrides the built link, must be https at the form and at the database, and renders with `rel="noopener noreferrer"`.
8. Given two events, when both are marked as the featured event, then the database refuses the second; and when one is featured, the landing page leads with it, above the ordinary listing, ordered featured → race → soonest.

**Verification:** integration `events/configuration.test.ts`; unit `events/zoned-time.test.ts`; e2e `event-pages.spec.ts`

#### BR-REQ-020-01 — Publication and cancellation visibility

- **Source:** BR-BUS-020
- **Implements:** AGENTS.md §10.1, §11.2
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given an event whose translation for a locale is in Draft or In review, when that locale's public URL is requested, then the response is 404.
2. Given an event with `event_status = CANCELLED` and a published translation, when its page is requested, then it renders with a clearly visible cancelled status.
3. Given a cancelled or completed event, when a registration is attempted, then it is rejected.

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

1. Given a capped event with 1 free place, when 20 confirmations are attempted concurrently, then exactly 1 succeeds and the rest are waitlisted or rejected, and the final occupied count equals capacity.
2. Given any capacity-changing transaction, when it runs, then it locks the event row or an equivalent serialization point.
3. Given an attempt to lower capacity below the current occupied count, when it is submitted, then it is rejected with a clear message.
4. Given capacity is increased, when the transaction commits, then existing waiting-list entries are allocated before any later direct registration.

**Verification:** integration `capacity/concurrency.test.ts` against real PostgreSQL

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

#### BR-REQ-039-01 — The public participant list is opt-out, off by default, and names only

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
3. Given an event whose setting is `NAMES`, when its public page renders, then it lists the registered name of every `CONFIRMED`, `REAL` registration that has not opted out, ordered by confirmation time, and nothing else about any of them.
4. Given a registration that is not `CONFIRMED`, of kind `TEST`, or opted out, when the list renders, then that person does not appear and no count reveals them.
5. Given the registration form, when it renders, then it offers a plainly worded opt-out, on every event, whatever that event's current setting is.
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

**Verification:** e2e `registration-submit.spec.ts`; integration `participants/identity.test.ts`

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

**Verification:** integration `registrations/entry-details.test.ts`; e2e `registration-submit.spec.ts`

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

#### BR-REQ-039-02 — The public list publishes the display name

- **Source:** BR-BUS-039
- **Implements:** AGENTS.md §10.10, §12.6
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given an event whose participant list is `NAMES`, when the list renders, then each row is the registration's display name and nothing else.
2. Given a registration whose display name differs from its legal name, when the list renders, then the legal name appears nowhere in the markup.
3. Given the rules of BR-REQ-039-01, when the list renders, then they are unchanged: confirmed and real registrations only, opt-outs excluded, ordered by confirmation.

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

1. Given `a.n.a@gmail.com` and `ana@gmail.com`, when both are canonicalized, then they produce the same canonical value.
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
3. Given the hold, when 30 minutes pass without acceptance, then the status becomes `EXPIRED` with `expiry_reason = DECLARATION_HOLD_LAPSED` and the place is released.
4. Given a hold that would extend past registration close or event start, when it is created, then it is capped at the earlier of the two.
5. Given a registration that has not reached `CONFIRMED`, when the participant list is inspected, then that person is not counted as attending.

**Verification:** integration `registrations/lifecycle.test.ts`; e2e `registration-happy-path.spec.ts`

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

**Verification:** integration `declarations/acceptance.test.ts`; e2e `declaration.spec.ts`

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

1. Given each registration status, when an administrator resends, then the message type matches the mapping in `SETUP.md` §21 and no other type can be selected.
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
- **Status:** built, and recorded in `DECISIONS.md` §33. The three administrative changes to a
  registration are entering one, correcting its name, and cancelling it; there is deliberately no
  fourth, and no delete.

**Acceptance criteria**

1. Given a registration, when an administrator corrects the participant name, then the change is audited.
2. Given the backoffice, when it renders, then it offers no verified-email edit and no participant merge.
3. Given any administrative state change, when it completes, then an audit row records actor, action, entity, and time.
4. Given a cancellation by an administrator, when it commits, then the released place is offered to the front of the waiting list, exactly as a participant's own cancellation is.

**Verification:** integration `registrations/staff-crud.test.ts`

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

1. Given an Editor or an Administrator, when they create an event, then they supply its kind, its status, its times and time zone, its coordinates, its distance and climb, the featured flag and the whole registration block, plus a title, address and description in every language, and the event is created as a draft.
2. Given an existing event, when it is edited, then every one of those fields is editable through the interface, and no field of `events` requires a developer.
3. Given an event, when it is duplicated, then the copy is a draft, is not featured, has never been published, and carries its own page address in each language.
4. Given an Administrator, when they delete an event that has no registration against it, then it and its translations are removed.
5. Given an event that has any registration against it, when deletion is attempted, then it is refused with a reason and nothing is removed; archiving is the supported answer.
6. Given an Author, when they attempt to create, duplicate or delete an event, then it is refused at the server.

**Verification:** integration `cms/crud.test.ts`, `cms/workflow.test.ts`; e2e `cms-publish.spec.ts`

#### BR-REQ-051-01 — Editorial workflow and permissions

- **Source:** BR-BUS-051, BR-BUS-060
- **Implements:** AGENTS.md §11.2, §13.1
- **Priority:** MUST
- **Release:** M5
- **Status:** built for events during M1 (`DECISIONS.md` §25); it applies to articles and pages
  when those exist. Criterion 2 changed with `DECISIONS.md` §28: publication is one state for
  the whole event rather than one per language (`DECISIONS.md` §28).

**Acceptance criteria**

1. Given an Author, when they work in the CMS, then they can create and edit their own drafts and submit for review, and cannot publish.
2. Given an Editor or Administrator, when they review a submission, then they can publish, unpublish, and archive the event, and both languages go live or come down together.
3. Given published content, when an Author attempts to edit it, then it is refused.
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

1. Given the homepage, when it renders, then it contains one `SportsOrganization` JSON-LD block with a stable `@id`, the club name, logo, URL, and `sameAs` entries for the club's official profiles.
2. Given a published event page, when it renders, then it contains a `SportsEvent` block whose start and end times carry the event timezone offset, whose `organizer` references the club `@id`, and whose `location` includes a postal address.
3. Given a capped event, when the block renders, then `remainingAttendeeCapacity` equals the free-place count displayed on the same page.
4. Given a cancelled event, when the page renders, then the block is still present with `eventStatus` set to cancelled.
4a. Given a race with a gun time distinct from the event start, when the block renders, then `startDate` is the race start and `doorTime` is the event start; with no distinct gun time, `startDate` falls back to the event start.
5. Given a published article (M5), when it renders, then it contains an `Article` block with `datePublished` and `dateModified`.
6. Given any structured data block on any page, when it is inspected, then it contains no participant name, email, registration list, or declaration content.
7. Given the test suite, when it runs, then it parses the emitted JSON-LD and asserts the required properties are present.

**Verification:** integration `seo/structured-data.test.ts`; e2e `event-page.spec.ts`

#### BR-REQ-070-03 — Public content is machine-readable and crawler policy is explicit

- **Source:** BR-BUS-052, BR-BUS-070
- **Implements:** AGENTS.md §18.4
- **Priority:** MUST
- **Release:** M1

**Acceptance criteria**

1. Given any public page, when its server HTML response is fetched without executing JavaScript, then the page's substantive content is present in that response.
2. Given an event page, when its text is extracted, then the date, start time, meeting point, cost, and registration requirement are present as text rather than only as component styling or an image. Cost is `event_translations.cost_text`, localized free text; when it is absent the page states nothing about cost rather than assuming the event is free.
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
4. Given any staff role, when the CMS is used, then no interface edits legal document text.
5. Given the public site, when any page renders, then the privacy notice and terms are reachable in the current locale.
6. Given any environment other than production, when it is seeded, then a clearly marked sample version of each key exists, whose own rendered body opens — in both languages — with a banner saying that it is sample text, is not approved by the club, is not legal advice, and must be replaced before a real participant registers.
7. Given `APP_ENV=production`, when the sample text is seeded, then it is refused outright rather than skipped quietly; the club's approved wording arrives through a migration, per `docs/RUNBOOKS.md` § Legal document version.
8. Given a sample document, when it is read, then every club-specific fact — the controller's legal name, address and contact, any representative, retention periods, and the lawful basis for each purpose — is an obvious placeholder rather than an invented value.

**Verification:** integration `legal/versions.test.ts`; e2e `legal-pages.spec.ts`

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

**Verification:** unit `notifications/templates.test.ts`

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

**Verification:** integration `notifications/outbox.test.ts`

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
8. Given an Author or an Editor, when they attempt to delete an event or to add or remove test registrations, then it is refused at the server; both are the Administrator's alone.
9. Given `APP_ENV=production`, when a test registration is created by any path, then it is refused — at the feature's entrance and again at the statement that would write the row.

**Verification:** integration `auth/role-boundaries.test.ts`, `cms/crud.test.ts`, `registrations/test-kind.test.ts`; unit `staff/roles.test.ts`; e2e `cms-publish.spec.ts`

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

**Verification:** unit `diagnostics/configuration.test.ts`; unit `seo/private-paths.test.ts`

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

**Verification:** integration `hosting/base-url.test.ts`; `docs/RUNBOOKS.md` § Domain binding

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
| BR-BUS-037 | BR-REQ-037-01, BR-REQ-037-02, BR-REQ-037-03, BR-REQ-037-04, BR-REQ-037-05, BR-REQ-033-03, BR-REQ-033-04, BR-REQ-035-05 |
| BR-BUS-038 | BR-REQ-038-01, BR-REQ-038-02, BR-REQ-038-03 |
| BR-BUS-039 | BR-REQ-039-01 |
| BR-BUS-040 | BR-REQ-040-01, BR-REQ-040-02, BR-REQ-040-03, BR-REQ-040-04 |
| BR-BUS-041 | BR-REQ-041-01 |
| BR-BUS-050 | BR-REQ-050-01 |
| BR-BUS-051 | BR-REQ-051-01, BR-REQ-051-02 |
| BR-BUS-052 | BR-REQ-052-01, BR-REQ-052-02, BR-REQ-070-03, BR-REQ-070-02 |
| BR-BUS-053 | BR-REQ-053-01, BR-REQ-033-02, BR-REQ-031-02 |
| BR-BUS-060 | BR-REQ-060-01, BR-REQ-051-01 |
| BR-BUS-070 | BR-REQ-070-01, BR-REQ-070-02, BR-REQ-070-03, BR-REQ-036-02, BR-REQ-038-01, BR-REQ-039-01, BR-REQ-041-01, BR-REQ-071-01, BR-REQ-072-01 |
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
