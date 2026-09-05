<!-- Practice guides. Guidance, not authority. See the first section. -->

# Practice guides

**Baseline `BR-V1.18-2026-09-04`** · versioned with the whole set · [changelog](../CHANGELOG.md)


## About these guides

Operational guidance for building and running the Brașov Runners website well. These
documents are **not** authoritative. They explain how to satisfy the rules that already
exist and give the checklists to work through.

Authority order is unchanged: `BUSINESS.md`, then `SPECS.md`, then `AGENTS.md`, then
`SETUP.md`. If a practice guide disagrees with any of those, the root document wins and
the guide is wrong. Fix it and note the correction.

Each guide cites the requirement IDs it serves, so nothing here is a free-floating opinion.

| Guide | Serves | Read when |
| --- | --- | --- |
| [Delivery](#delivery) | The whole plan; `SETUP.md` §29 | Before starting, and whenever sequencing, scope, or club involvement is in question |
| [Code priorities](#code-priorities) | AGENTS.md §1.5 | Before writing or prompting for any code |
| [Mobile-first](#mobile-first) | BR-REQ-041-01 | Building any participant-facing page, form, or email template |
| [SEO](#seo) | BR-REQ-070-02, BR-REQ-052-02, BR-REQ-040-01, BR-REQ-040-02 | Building public pages, metadata, sitemaps, or structured data |
| [AIO](#aio) | BR-REQ-052-02, BR-REQ-070-03 | Deciding crawler policy, writing content meant to be quoted by assistants |
| [Accessibility](#accessibility) | BR-REQ-070-02 | Building any interface, especially the registration and declaration flow |
| [Performance](#performance) | BR-REQ-070-02, BR-REQ-101-01 | Building pages, choosing client boundaries, reviewing bundle size |
| [Editorial](#editorial) | BR-BUS-052, BR-REQ-052-01 | Writing or reviewing event descriptions, articles, and translations. Written for club contributors, not developers. |
| [Launch checklist](#launch-checklist) | Release gate in `SPECS.md` §3 | Before promoting `qa` to `main` for the first time |

## How to use the checklists

Every guide ends with a checklist mapped to the implementation phases in `AGENTS.md` §26.
Work the rows for the phase you are in rather than the whole file. A row that cannot be
completed is either a scope decision or a defect; do not tick it and move on.

## What these guides deliberately avoid

- Repeating rules that live in the root documents. They link instead.
- Naming vendor products, plans, or prices. Those change and are verified at the time of use.
- Numeric targets the club has not agreed. `BUSINESS.md` §7 forbids inventing traffic or conversion numbers, and that applies here too.


---

## Code priorities

The ranked list that decides what wins when two good goals conflict, and the concrete rules
that follow from it. The ranking itself is normative and lives in `AGENTS.md` §1.5; this
guide is the reasoning and the detail. Not authoritative; see [About these guides](#about-these-guides).

The governing constraint is unusual and worth stating plainly: **most changes to this
codebase will be made by an AI agent, prompted by someone who did not write the original
code, possibly years from now.** That is a design input, not a footnote. It changes what
"good code" means here.

### 1. The priority order

When two of these conflict, the higher number wins. This ordering is deliberate and
occasionally uncomfortable.

1. **Correctness of the rules that carry trust.** Capacity, queue order, declaration
   acceptance, authorization, and participant privacy. Never traded for anything below.
   Someone loses a place at a race, or their data leaks, and no amount of elegance repairs it.
2. **Legibility to a stranger with no context.** A future agent has the repository and a
   prompt. It does not have the conversation you had, the pull request you remember, or your
   intent. Code that only makes sense with that context is broken code here.
3. **One rule, one place.** A rule implemented in two places will be changed in one of them.
   This is the single most common way an AI-assisted change introduces a bug.
4. **Conventional over novel.** An agent has seen the idiomatic Next.js, Drizzle, and MUI
   patterns ten thousand times, and your clever alternative once, in this repository. Boring
   code is cheaper to change.
5. **Tests as executable specification.** A change is safe when a test fails loudly if the
   rule breaks. Tests named after requirement IDs are what let an agent verify it understood.
6. **Less code over less duplication.** Two similar functions are easier to change safely
   than one abstraction covering both cases badly. Abstract on the third occurrence, not the
   second, and only when the cases are genuinely the same rule.
7. **Measured performance.** Real, measured, on the paths that matter. Not speculative.
8. **Elegance.** Last, honestly. Prefer the obvious version.

The uncomfortable ones are 4 over 8 and 6 over the instinct to abstract. Both are deliberate.
Cleverness and premature abstraction are the two things that most reliably make a codebase
resistant to being changed by someone, or something, that arrives later.

### 2. What makes code changeable by an agent

#### Requirement IDs are the index

`SPECS.md` gives every behavior a stable ID. Use it as the primary key of the whole project.

- Name the test after it: `describe("BR-REQ-034-02: capacity can never be exceeded")`.
- Reference it in a comment above any non-obvious rule implementation.
- Reference it in the pull request.

`scripts/docs-check.mjs` already fails when a `BR-REQ-*` referenced anywhere in the
repository does not exist in `SPECS.md`, so this traceability is enforced rather than
aspirational. The payoff is that a prompt like "change the waiting-list offer window" becomes
`grep -r "BR-REQ-035-02"`, which lands on the rule, the test, and the documentation together.

**The operational test:** given only a requirement ID, can a fresh agent find every place that
implements it with one grep? If not, the rule is spread too thin.

#### Vocabulary matches the documents exactly

`BUSINESS.md` says participant, registration, hold, waiting-list offer, declaration,
confirmed. So does the database, so do the types, so do the function names, so do the
variable names. No synonyms. Not "user" for participant, not "booking" for registration, not
"reservation" for hold, not "signup" for anything.

This sounds pedantic and it is the single cheapest thing on the list. When the words match, an
agent reading `BUSINESS.md` and an agent reading the code are reading about the same objects.

#### Rules are pure functions and time is injected

Every business rule that can be a pure function should be:

```ts
// BR-REQ-033-01: the direct declaration hold is capped by close and start
export function computeHoldDeadline(now: Date, event: EventTiming, minutes: number): Date
```

No database access, no `new Date()` inside. Pass the clock in. This matters more here than in
most projects, because half the domain is time-based: confirmation windows, holds, offer
deadlines, event start. A rule that reads the wall clock internally cannot be tested without
sleeping or mocking globals, and an agent asked to change it will guess.

Keep IO at the edges: route handler reads, service orchestrates, pure functions decide.

#### Locality over indirection

- A module folder holds its route, service, schema, and tests together. An agent should be
  able to open one directory and see the whole feature.
- No barrel files re-exporting through three hops. They defeat grep and they hide where a
  thing actually lives.
- No configuration-driven indirection where a literal would do. A registry mapping strings to
  handlers is unreadable to someone who cannot run the code.
- Files under roughly 300 lines. Not a rule to enforce mechanically, but a long file usually
  means several responsibilities that an agent will edit blindly.

#### No dynamic magic

Anything resolved at runtime rather than readable in the source is hostile to this project:
reflection, decorators carrying behavior, dynamically constructed queries, metaprogramming,
inheritance hierarchies more than one level deep. An agent cannot follow it and neither can a
freelancer at 11pm before a race.

Composition over inheritance. Explicit imports over dependency injection containers.

#### One way to do each thing

One HTTP client, one validation library, one date library, one way to define a route, one way
to handle an error, one way to write a test. Every alternative in the codebase is a decision
an agent has to make and can make wrong. When a second way appears in review, remove it or
document why both exist.

#### Errors name the rule

```ts
throw new CapacityExceededError("BR-REQ-034-02: confirmation would exceed event capacity");
```

An error message that names the rule turns a production log line into a documentation
lookup. This is worth more than a stack trace.

#### Types are explicit and boring

Explicit return types on exported functions. Discriminated unions for states, so the compiler
enforces the transition table in `AGENTS.md` §10.5. No conditional or deeply generic types
unless there is no alternative. `unknown` and a parse at the boundary rather than `any`.

#### Comments explain why, not what

The code says what. A comment earns its place by recording the reason, and the best comments
here cite a document:

```ts
// Case-insensitive local part is a deliberate Brasov Runners policy, not RFC behaviour.
// See BUSINESS.md BR-BUS-032 and DECISIONS.md 6.6.
```

That comment stops a future agent from "fixing" a rule it thinks is a bug.

### 3. Prompting patterns that work on this codebase

- **Anchor to the requirement.** "Implement BR-REQ-035-02" beats "build the waiting list".
- **Ask for the test first.** For anything in priority 1, have the failing test before the
  implementation.
- **Give the agent the boundary.** Name the module it may change. Broad prompts produce broad
  diffs, and broad diffs do not get reviewed properly.
- **Require verification, not recall.** Provider behavior, package APIs, and permission names
  change; `AGENTS.md` §1.2 requires checking current documentation.
- **Ask what it did not do.** A short list of assumptions and skipped cases at the end of a
  change is worth more than a summary of the diff.

### 4. What to review by hand, always

Priority 1 is not delegable. Read every line of:

- the capacity transaction and the queue allocator — including anything that touches
  `registrations.kind`, whose whole point is that it changes nothing there;
- email canonicalization;
- action tokens, sessions, and role checks;
- migrations, and a migration that carries data from one column to another most of all;
- anything producing or rendering legal text.

Everything else gets normal review.

### Checklist

**Per pull request**

- [ ] Tests named with the requirement IDs they cover.
- [ ] New rules implemented in exactly one place.
- [ ] Vocabulary matches `BUSINESS.md`; no synonyms introduced.
- [ ] Time-dependent logic takes an injected clock.
- [ ] No new barrel file, dynamic dispatch, or second way to do an existing thing.
- [ ] Exported functions carry explicit return types.
- [ ] Errors in trust-carrying paths name the rule.
- [ ] Comments on non-obvious rules cite the document that justifies them.
- [ ] Priority 1 code read line by line, not accepted.

**Per module, when it is finished**

- [ ] Given only a requirement ID, one grep finds the rule, its test, and its documentation.
- [ ] The module directory contains everything needed to understand the feature.
- [ ] A person who has never seen the repository could change one rule in it without reading
      anything else.


---

## Delivery

How to build and run this platform as a very small team. Not authoritative; see
[About these guides](#about-these-guides). Where this guide proposes changing a root document, it says so
and the root document stands until the change is made.

The plan in `SETUP.md` §29 says what to build. This guide is about the order, the risks that
are not technical, and the ways a project like this usually fails.

### 1. The risks, honestly ranked

Ranked by how often they kill a project like this, not by how interesting they are.

1. **Content upkeep has to fit how organizers already work.** The platform's premise is that
   contributors keep content current without a developer. If editing is heavier than the tools
   it replaces, content goes stale within a season. This is the most likely failure, and
   onboarding, training, and editor design decide it rather than code quality.
2. **Legal text never arrives.** Registration cannot reach confirmed without an approved
   declaration. It is the longest-lead item and it depends on someone outside the project.
3. **Single-maintainer dependency.** One developer builds it, understands it, and can recover
   production. `BR-BUS-101` requires that this ends before handover, so plan the second person
   into the schedule rather than after it.
4. **Scope creep from real requests.** The deferred list in `BUSINESS.md` §8 exists because
   these requests will come, individually reasonable, from people you like.
5. **Capacity and queue correctness.** The genuinely hard engineering problem, and the one
   that is embarrassing in public if it is wrong. It is fourth because it is well specified
   and testable, which the first three are not.
6. **Email deliverability.** Verification and offer emails landing in spam breaks the whole
   flow silently.

Notice that the first four are not solved by writing better code. Plan for them explicitly.

### 2. Sanity check before PR 1

The custom build was decided in `DECISIONS.md` §1 and this guide does not reopen it. But it
is worth being clear about what that decision costs, once, before code exists.

What the custom path buys, and why the obvious alternatives do not fit:

- Free events with no per-registration fee. Most race-registration platforms price per
  entrant or take a cut, which is aimed at paid races.
- A versioned, human-approved declaration bound to each registration with acceptance evidence.
  Generic tools either lack this or bolt it on as an unversioned checkbox.
- Genuine per-locale publication, where Romanian can be live while English is still a draft.
  Plugin-based bilingual setups usually fall back to the default language, which
  `BR-REQ-040-02` forbids.
- Passwordless participation. Most platforms require an account.
- Exact live availability with a waiting list and timed offers, without paying for a race
  product.

What it costs, permanently: dependency updates, security patches, provider changes, and
someone to answer when an organizer says the site is down on a Sunday morning. That cost does
not appear in any phase plan and does not stop.

The decision stays as it is. Review it once at a checkpoint before Phase 4 rather than after,
so that the permanent maintenance cost above is being carried for the feature set the club
actually uses.

### 3. Build order: get thin before you get deep

The phases in `AGENTS.md` §26 and the pull requests in `SETUP.md` §29 are layered: all of the
infrastructure, then all of the content, then all of the registration. Layered plans have a
known weakness. Nothing is real until late, and the riskiest work lands last, when there is
least room to react.

**Proposed amendment to `SETUP.md` §29, pending your decision.** After the foundation pull
requests, insert one thin end-to-end slice before the broad ones:

```text
PR 1-3   foundation, i18n shell, database   (unchanged)
PR 3b    WALKING SKELETON
         one hardcoded seeded event, published in Romanian only
         one registration form
         email confirmation in capture mode
         declaration acceptance against a seeded placeholder version
         CONFIRMED state reached
         deployed to QA and clicked through by a real person
PR 4+    resume the planned sequence, deepening each area
```

The skeleton is deliberately ugly and deliberately incomplete. Its only job is to prove that
the whole chain works on the real host: form to database to outbox to email link to state
transition to deployed QA environment. Every integration risk in the project shows up in that
one slice, and it can be built in a fraction of the time the full flow takes.

Until you decide, `SETUP.md` §29 stands as written. If you accept this, it is a documentation
change following the matrix in `AGENTS.md` §1.4: `SETUP.md` §29, `AGENTS.md` §26, the
implementation order in `README.md`, and an entry in `DECISIONS.md`.

Two other ordering notes:

- **Write the concurrency test before the concurrency code.** `BR-REQ-034-02` describes it
  precisely: twenty concurrent confirmations against one free place. Have it failing first.
  It is the one test that justifies the whole custom build.
- **Do not leave email until Phase 6 in practice.** The outbox and the capture adapter are
  needed from the first registration. Phase 6 is about Mailgun, templates, and webhooks, not
  about whether a message can be queued.

### 4. Working solo, with agents

You will do most of this with AI assistance. What actually works at this scale:

**Anchor every task to a requirement ID.** "Implement `BR-REQ-035-02`, FIFO offers" is a task
with acceptance criteria attached and a definition of done. "Build the waiting list" is an
invitation to invent. This is why `SPECS.md` exists and it is the highest-leverage habit in
the project.

**One vertical slice per pull request.** A slice that touches route, module, database, and
test is reviewable. A pull request that adds a layer across six features is not.

**Never delegate these without reading every line yourself:**

- the capacity transaction and the queue allocator;
- the email canonicalization function;
- anything touching action tokens, sessions, or role checks;
- migrations;
- anything that produces or renders legal text.

Everything else is fair game, reviewed normally.

**Make the agent verify rather than recall.** Provider behavior, package APIs, GitHub
permissions, and crawler names change. `AGENTS.md` §1.2 requires checking current
documentation; in practice that means telling the agent explicitly to look, and being
suspicious of a confident answer that cites nothing.

**Review your own output as if someone else wrote it.** The failure mode of solo agent-
assisted work is a large volume of plausible code that nobody has actually read. Merge less
per sitting than you can generate.

### 5. Testing, proportionate

The suite that matters here is small and specific:

- **Integration tests against real PostgreSQL** for capacity, queue order, transitions, and
  uniqueness. These are the tests worth their maintenance cost. `AGENTS.md` §20.3 lists them.
- **Unit tests** for the pure functions: canonicalization, deadline capping, transition
  validation, token purpose. Fast and stable.
- **A handful of Playwright journeys**, not a full matrix. Register, confirm, sign, unregister,
  waitlist, claim. Six journeys that run on every pull request beat sixty that are skipped.
- **Skip** snapshot suites, tests of MUI's behavior, and tests that mirror implementation.

If a bug reaches QA, add the test that would have caught it before fixing it. That is how the
suite earns its shape rather than being designed up front.

### 6. Scope control

The V1 boundary in `BUSINESS.md` §8 will be tested by real people with reasonable requests:
one more field on the form, a photo upload, a results list, a members page.

A workable answer: "Yes, and it goes after launch." Then write it down where they can see it.
A visible parked list is the difference between deferring and refusing, and it costs nothing.

The requests that deserve genuine reconsideration rather than parking are the ones that reveal
a wrong assumption: a paid race, an event needing minors' consent, or an organizer keeping a
parallel spreadsheet because the backoffice does not do something they need daily. Those are
signals, not creep.

### 7. Working with the club

- **Ask for the legal texts in week one**, not when the code needs them. Include the exact
  list from `BUSINESS.md` §9 and explain that registration cannot be completed without them.
- **Get real content early.** Build against three real events and two real articles, not lorem
  ipsum. Real content exposes layout, length, and translation problems immediately.
- **Pilot with one real event before launching the site.** One small, capped, free run, with
  the organizer running it through the backoffice while you watch and say nothing. Everything
  they hesitate over is a defect in the interface, not in them.
- **Train two people, not one.** An Editor and an Admin, each able to do their job unaided.
  Watch them do it once. [Editorial](#editorial) is written to be handed to them.
- **Agree who answers when something breaks**, before launch rather than during the first
  incident.

### 8. After launch

The project does not end at the release; it changes shape.

- **Reduce the bus factor deliberately.** Two people with provider recovery access, credentials
  in the club's password manager, runbooks written for someone who did not build the system.
  `SETUP.md` §30 covers the mechanics; the point is to do it before you need it.
- **Expect a seasonal rhythm.** Registration load spikes around race announcements and is quiet
  between them. Do maintenance in the quiet weeks.
- **Budget for dependency upkeep.** Next.js, MUI, and Drizzle all move. Small regular updates
  beat one large one a year later.
- **Watch the boring signals**: bounce rate on verification email, how many registrations
  expire without confirming, how many waiting-list offers lapse. Each is a usability problem
  wearing an operational costume.
- **Revisit the deferred list once a year** with the club, rather than never.

### Checklist

**Before PR 1**

- [ ] Legal text request sent to the club with the full list from `BUSINESS.md` §9.
- [ ] Three real events and two real articles collected for building against.
- [ ] Walking-skeleton amendment accepted or declined, and documented either way.
- [ ] Provider verification done: Vercel Node version and cron limits, Neon, Mailgun, R2 tiers.
- [ ] Second person identified for provider recovery access.

**During the build**

- [ ] Every pull request names the requirement IDs it implements.
- [ ] Concurrency test written before the capacity code, and failing first.
- [ ] Outbox and capture adapter exist from the first registration, not from Phase 6.
- [ ] Sensitive code read line by line rather than accepted.
- [ ] Parked-request list visible to the club and actually updated.
- [ ] Working against real content by the time events exist.

**Before launch**

- [ ] Pilot event run end to end by an organizer, unaided, while you watch.
- [ ] Two staff trained, one Editor and one Admin.
- [ ] Incident ownership agreed and written down.
- [ ] Full [Launch checklist](#launch-checklist) complete.

**First season after launch**

- [ ] Verification-email bounce rate reviewed after the first real capped event.
- [ ] Expired-before-confirmation and lapsed-offer counts reviewed.
- [ ] Dependency update pass done in a quiet week.
- [ ] Deferred list reviewed with the club.


---

## Mobile-first

Serves `BR-REQ-041-01`. Implements `AGENTS.md` §18.5. Not authoritative; see
[About these guides](#about-these-guides).

Mobile-first is not "it also works on a phone". It means the phone is the design target and
the desktop layout is derived from it, never the reverse. For this site that is simply the
truth of the audience: a runner reads an event on the way home, registers standing in a car
park, signs the declaration on the start line, and an organizer checks the list on their
phone at the meeting point. If any of those is awkward, the site has failed at its job even
if it is beautiful on a laptop.

### 1. The journeys that must be excellent on a phone

In order of how often they happen:

1. **Read an event and decide.** Date, time, meeting point, distance, cost, places left: all
   visible without scrolling on a small phone, as text, in the first screen.
2. **Register.** Two fields, two choices, one button. Under a minute on a phone with one hand.
3. **Confirm from email.** The link opens in the phone's browser, the page fits, the action is
   one tap, and the participant is not asked to log in to anything.
4. **Sign the declaration under a deadline.** Readable text, a checkbox, a name field, a
   button that stays reachable, and a deadline visible without hunting for it.
5. **Accept a waiting-list offer**, usually from a notification, usually in a hurry.
6. **Unregister.** One tap plus one confirmation.
7. **Organizer on race morning.** Find a participant by name, see their status, create a
   manual registration (M2), on a phone with a poor signal.

Everything else, including most of the backoffice, can be desktop-comfortable and
phone-tolerable. Those seven cannot.

### 2. Layout rules

- **Design at 360 pixels wide and 320 pixels wide first.** The 320 case is the check for
  Romanian strings; the 360 case is the common phone.
- **No horizontal scrolling, ever, at any width.** A table that cannot fit becomes cards on
  small screens.
- **Base styles are the mobile styles.** In MUI, the `xs` value in a responsive `sx` or the
  bare value with no breakpoint is the phone; `md` and up add, never subtract. A component
  written desktop-first and then patched for `xs` is the pattern to reject in review.
- **One column on phones.** Side-by-side layouts start at `md`.
- **The primary action stays reachable.** On registration, declaration, and offer pages the
  submit button is visible without scrolling back, either near the fields or sticky at the
  bottom. Never place the only button above a long declaration text.
- **Thumb zone.** Primary actions in the lower half of the screen; destructive ones not where
  a thumb rests.
- **Touch targets** at least 44 by 44 CSS pixels for anything a person must tap during
  registration, and never below the WCAG 24 pixel minimum anywhere.
- **Nothing hover-only.** Tooltips, hover menus, and hover reveals are invisible on a phone.
  Whatever they contain must be reachable by tap or be present in the page.
- **Modals are risky on phones.** Prefer a page. If a dialog is used, it must scroll
  internally, be dismissable, and not lose entered data on rotation.

### 3. Forms on a phone

- Correct `type` and `inputmode` per field: `email` for email, `text` with `autocapitalize`
  for names. This is the difference between the right keyboard and a fight with autocorrect.
- `autocomplete` attributes so the phone offers the person's own name and email.
- Labels above fields, not beside them; placeholders are not labels.
- Errors appear next to the field and the page scrolls to the first one.
- No CAPTCHA (see [Accessibility](#accessibility) §3).
- The privacy acknowledgment and results choice are real checkboxes with large tap areas, and
  the privacy link opens without discarding the form.
- After submit, the confirmation page says what to do next in one sentence: check your email.

### 4. Email to phone

Most participants open every email on a phone. Templates are therefore mobile-first too:

- single column, large type, one obvious button;
- the button is a real link with the full URL also printed below it, because some mail
  clients strip buttons;
- the deadline is stated in absolute local time in the email body, not only on the page;
- subject lines under about 45 characters so they are not truncated;
- diacritics verified in the phone mail clients people actually use.

### 5. The backoffice on a phone

The backoffice is desktop-first in general, with one carve-out: the race-morning surfaces.
The registration list, the search by name, one registration's state, and the manual
registration form (M2) must work on a phone. That means the list shows the few columns that
matter on `xs` (name, status, distance) and the rest on wider screens, and search is at the
top. Everything else in the backoffice, including the editor and the exports, is allowed to
be uncomfortable on a phone.

### 6. Testing

- Playwright projects for a mobile viewport and a desktop viewport; the registration journeys
  run on both on every pull request.
- A real mid-range Android phone over mobile data, not only emulation, for the release
  checks. Emulation does not reproduce slow networks, real keyboards, or real touch.
- Test with a Romanian keyboard and Romanian autocorrect at least once. Names with diacritics
  are the common case.
- Rotate the phone during the declaration. Entered text must survive.
- Test in the browser that opens from the phone's mail app, which is not always the
  default browser.

### Checklist by phase

**Phase 1.0 to 1.3, shell and event pages**

- [ ] Theme breakpoints and layout primitives written mobile-up; no desktop-first component.
- [ ] Viewport meta and responsive images in place.
- [ ] Event page shows date, time, place, distance, cost, and places left in the first screen at 360 pixels.
- [ ] No horizontal scroll at 320 pixels in either locale.
- [ ] Navigation usable one-handed; no hover-only affordance anywhere.

**Phase 1.4 to 1.5, registration and waiting list**

- [ ] Registration completes in under a minute on a phone, one-handed.
- [ ] Correct keyboards, autocomplete, and label placement on every field.
- [ ] Submit button reachable without scrolling back on registration, declaration, and offer pages.
- [ ] Deadline visible without hunting on declaration and offer pages.
- [ ] Dialogs, if any, scroll internally and survive rotation.
- [ ] Playwright mobile project runs every registration journey.

**Phase 1.6, email**

- [ ] Templates single column with one obvious button and the URL printed below it.
- [ ] Deadline in absolute local time in the body.
- [ ] Verified in the mail clients participants actually use, on a phone.

**Phase 1.7, launch**

- [ ] Every M1 journey completed on a real mid-range phone over mobile data.
- [ ] Registration list and registration detail usable on a phone.
- [ ] Romanian keyboard and autocorrect tested on the name field.


---

## SEO

Serves `BR-REQ-070-02`, `BR-REQ-052-02`, `BR-REQ-040-01`, `BR-REQ-040-02`. Implements
`AGENTS.md` §18.1. Not authoritative; see [About these guides](#about-these-guides).

The realistic goal for a local running club is to be the definitive answer for a small set
of queries: the club's own name, "alergare Brașov", "club alergare Brașov", "running club
Brasov", the names of its recurring runs, and each individual event or race. That is
winnable. Competing for generic national running terms is not, and chasing them wastes
effort that belongs on event pages.

### 1. The site's real ranking assets

In order of value:

1. **Event pages.** Each has a date, a place, and an intent. They are the pages people
   search for and the pages assistants quote.
2. **The homepage and About page** as the club's entity anchor.
3. **Recaps and articles** that accumulate over years and carry the club's name.
4. **Recurring run pages** for the weekly meetups, which earn repeat searches.

Runner profiles are excluded from search entirely by `BR-REQ-038-01`. Do not treat them as
an SEO asset.

### 2. Technical foundations

#### URLs and slugs

- Locale prefix is always visible: `/ro/...` and `/en/...` (`AGENTS.md` §9.2).
- Slugs are localized and human-readable: `/ro/evenimente/crosul-tampa-2027`.
- Romanian diacritics transliterate to ASCII in slugs: `ș` to `s`, `ț` to `t`, `ă` to `a`,
  `â` and `î` to `a` and `i`. Diacritics stay in titles and body text.
- Slugs are editable before first publication and stable afterwards (`AGENTS.md` §11.5).
  Changing a published slug without a redirect plan loses the page's history.

#### Canonical and hreflang

- Every public page carries a self-referencing canonical on its own locale URL.
- `hreflang` alternates list only locales that are actually published for that record, plus
  `x-default` pointing at the Romanian URL.
- Never emit an alternate to a locale that would 404, and never let Romanian content render
  on an English URL (`BR-REQ-040-02`).
- Never put an action token in a canonical, an alternate, an Open Graph URL, or an analytics
  parameter (`AGENTS.md` §18.1).

#### Robots and sitemap

- Production `robots.txt` allows the public site and disallows `/admin`, participant action
  and manage paths, declaration pages, preview, `/api`, and runner profiles.
- QA disallows everything and additionally sends `X-Robots-Tag: noindex, nofollow`
  (`BR-REQ-090-01`). Both layers, not one.
- The sitemap contains published editorial pages only, one entry per published locale, with
  `lastmod` taken from the content's publication or update time, not from the build time.
- Excluded from the sitemap: drafts, previews, admin, action pages, runner profiles.
- Keep past events online and indexed. Deleting them throws away the club's accumulated
  history and the links pointing at it. Mark them completed and keep the page.

#### Metadata

- Unique title and meta description per page and per locale. No template-only titles like
  "Events | Brașov Runners" repeated across pages.
- Title pattern that works here: `<event name> — <date>, Brașov | Brașov Runners`.
- Open Graph and Twitter card on every public page, with `og:locale` and
  `og:locale:alternate`, and an image that is not the club logo alone.
- One `h1` per page, headings in order, no heading used for styling.

### 3. Structured data

JSON-LD, server-rendered, one block per entity. This is the single highest-leverage item on
the list, because it serves classic rich results and AI extraction at the same time.

#### Club entity, on the homepage and About page

`SportsOrganization` with `name`, `url`, `logo`, `description`, `sport` set to running,
`areaServed` for Brașov, and `sameAs` pointing at every official social profile the club
controls. Give it an `@id` and reference that `@id` from every event's `organizer`, so the
whole site resolves to one entity rather than many.

#### Event pages

`SportsEvent` with:

- `name`, `description`, `url`, `inLanguage`;
- `startDate` and `endDate` as ISO 8601 with the correct offset for `Europe/Bucharest`;
- `eventStatus`: `EventScheduled`, and `EventCancelled` for a cancelled event, which must
  keep its markup rather than losing it;
- `eventAttendanceMode`: offline;
- `location` as a `Place` with a `PostalAddress` and, where known, `geo` coordinates;
- `organizer` referencing the club `@id`;
- `image`;
- `offers` as an `Offer` with price `0`, `priceCurrency` `RON`, a `url` pointing at the
  registration page, `validFrom` matching registration open, and `availability` reflecting
  whether places remain;
- `maximumAttendeeCapacity` and `remainingAttendeeCapacity` for capped events.

Two cautions. `remainingAttendeeCapacity` must be produced by the same computation as the
visible count in `BR-REQ-034-01`, never by a separate cached number, or the page and its
markup will disagree. And for an external-registration event the `offers.url` points at the
external provider, matching what the page actually offers.

#### Other types

- `Article` or `BlogPosting` for news, with `headline`, `datePublished`, `dateModified`,
  `author`, `image`, `inLanguage`, `mainEntityOfPage`.
- `BreadcrumbList` on event, article, and gallery pages.
- `ItemList` on listing pages, optional and low value.
- `FAQPage` where a page genuinely answers repeated questions. Be aware that FAQ rich
  results were restricted to a narrow set of site types, so the value now is mostly machine
  extraction rather than a visible result.

Never emit participant names, emails, counts of who registered, or anything from a
declaration into structured data. `BR-REQ-070-01` applies to JSON-LD as much as to visible
HTML.

Validate with the Schema Markup Validator and the Rich Results Test before release, and add
a test that asserts the JSON-LD parses and carries the required properties, so a refactor
cannot silently drop it.

### 4. Content and internal linking

- Every event page states date, start time, meeting point, distance, elevation, difficulty,
  cost, and whether registration is required, in the body text and not only in an image or
  a badge component.
- Recurring runs get one durable page each rather than a new page per week.
- Link events to their recaps and recaps back to the event.
- Link the About page from the footer sitewide; link the club's social profiles from it.
- Write the club name consistently, with diacritics, and include the undiacriticked spelling
  naturally at least once per key page, because people search both ways.

### 5. Local presence

A running club is a local entity even without premises.

- Keep name, contact address, and social URLs identical everywhere they appear. Inconsistency
  is the most common reason a small local entity fails to consolidate.
- Consider a Google Business Profile if the club has a stable public contact point. Verify
  current eligibility rules for organizations without a storefront rather than assuming.
- Race listing sites, the local council's event calendar, and running federations are the
  realistic link sources. One good local link beats twenty directory submissions.

### 6. Measurement

- Verify the production host in Google Search Console and Bing Webmaster Tools after domain
  binding, and submit the sitemap (see [Domain binding runbook](./RUNBOOKS.md#domain-binding)).
- Watch coverage errors and the query report for the club's own name first.
- Analytics is an open owner decision in `BUSINESS.md` §9, including what consent it needs.
  Do not add a tracking script before that decision.
- Do not set numeric traffic targets the club has not agreed (`BUSINESS.md` §7).

### Checklist by phase

**Phase 1, public shell**

- [ ] Locale-prefixed routing with `x-default` to Romanian.
- [ ] Self-referencing canonical per locale.
- [ ] `hreflang` emitted only for published locales.
- [ ] Title and description helpers that force per-page values.
- [ ] `robots.txt` route with environment-aware output.
- [ ] QA sends `X-Robots-Tag: noindex, nofollow`.

**Phase 3, events and CMS**

- [ ] Slug transliteration for Romanian diacritics, with a unit test.
- [ ] Sitemap generated from published content with real `lastmod`.
- [ ] Exclusions verified: admin, action pages, declaration, preview, profiles.
- [ ] `SportsOrganization` block with `@id` and `sameAs`.
- [ ] `SportsEvent` block including capacity, offers, and status.
- [ ] `Article` block for news, `BreadcrumbList` on detail pages.
- [ ] Structured data test asserting required properties exist.
- [ ] Cancelled event keeps markup with `EventCancelled`.
- [ ] Open Graph including locale and alternate.

**Phase 7 to 8, before launch**

- [ ] `remainingAttendeeCapacity` matches the visible free-place count under load.
- [ ] No action token appears in any canonical, alternate, or Open Graph URL.
- [ ] Runner profiles absent from sitemap and carrying `noindex, nofollow`.
- [ ] Search Console and Bing verified for the production host; sitemap submitted.
- [ ] Past events still reachable and indexed.
- [ ] Rich Results Test passes for one event, one article, and the homepage.


---

## AIO

Optimizing for AI assistants and answer engines. Serves `BR-REQ-052-02` and
`BR-REQ-070-03`. Implements `AGENTS.md` §18.4. Not authoritative; see
[About these guides](#about-these-guides).

The terminology is unsettled: AIO, AEO, GEO, LLM SEO all describe the same thing. This
guide uses AIO and means one concrete question:

> When someone asks an assistant "when does Brașov Runners meet?" or "are there places left
> for the Tâmpa race?", does the assistant find the club's site, parse it correctly, and say
> something true?

Three properties decide that. Content must be **retrievable**, **parseable**, and
**citable**. Most of the work is the same work SEO already requires, which is why this guide
is short and mostly points at [SEO](#seo).

### 1. Retrievable

- **Server-render everything public.** An assistant fetching a page usually reads the HTML
  it receives. Content that only appears after client-side hydration may not be seen at all.
  The Server Components default in `AGENTS.md` §3.1 already gives this; the failure mode is
  a well-meaning client component wrapping an event description.
- **No content behind interaction.** Facts that only appear after a tab click, an accordion
  expand, or a modal are frequently missed. Accordions are fine when the content is present
  in the HTML and only visually collapsed.
- **Stable URLs.** A URL that changes loses whatever assistants learned about it.
- **Do not cloak.** Serving different content to a bot than to a person is a policy
  violation with every provider and a reputational risk for a club.

### 2. Parseable

Structured data is what makes the difference between an assistant guessing at your event
and knowing it. The full markup specification is in [SEO](#seo) §3; it is the same
markup for both purposes.

Beyond markup:

- **Facts in prose, not only in components.** A visual badge reading "3 locuri" is invisible
  to a text extractor if it renders as an icon plus a number in a styled div with no
  sentence around it. Write the sentence: "Mai sunt 3 locuri disponibile."
- **Absolute dates.** "Duminică, 14 martie 2027, ora 09:00" survives extraction. "This
  Sunday" does not, and will be wrong forever once cached.
- **One idea per heading**, with the answer immediately below it. Assistants extract
  heading-plus-paragraph units.
- **Tables for structured facts** such as distances, categories, or start waves.
- **Explicit units and currency.** "10 km", "gratuit / free", "0 RON".

### 3. Citable

Assistants quote sources they can attribute and trust.

- **Entity consistency.** The club name, contact address, and official profile URLs must be
  byte-identical everywhere: the site, Strava, Instagram, Facebook, any race listing. The
  `sameAs` array on the `SportsOrganization` block is what ties them together. Inconsistency
  is the single most common reason a small local entity gets confused with another.
- **A real About page** stating what the club is, where it runs, since when, and who to
  contact. This is the page an assistant reads to answer "what is Brașov Runners".
- **Freshness signals.** `dateModified` in markup and a visible updated date on articles.
- **Cancelled and full states stated in text**, not only in a coloured chip, so an assistant
  does not tell someone to show up to a cancelled run.
- **Human review of anything published.** `BR-BUS-052` already requires it. Unreviewed
  generated text is the fastest way to become a source assistants learn to distrust.

### 4. Crawler policy

Two categories of crawler behave differently and the distinction drives the decision:

| Category | What it does | Effect of blocking |
| --- | --- | --- |
| Retrieval and search | Fetches pages when an assistant answers a live question, or builds an AI search index | The club stops appearing in AI answers |
| Training | Collects content to train future models | The club's content is not used in training; present-day answers are largely unaffected |

For a club whose goal is that runners find its events, allowing the retrieval category is
the obvious choice. The training category is a genuine preference question, not a technical
one, so it is an owner decision recorded in `BUSINESS.md` §9.

**Before writing the file, verify the current user-agent names against each provider's own
documentation.** This landscape changes faster than any document in this repository, agent
names have been renamed and split before, and `AGENTS.md` §1.2 forbids implementing from
memory. Treat the names below as a starting list to verify, not as truth. Review quarterly.

Providers to check at minimum: OpenAI, Anthropic, Google, Perplexity, Common Crawl, Apple,
Meta, ByteDance. Most publish both a bot documentation page and a list of IP ranges.

Shape of the resulting file, with the decision made explicit in comments:

```text
# Retrieval and AI search: allowed, so club events appear in AI answers
User-agent: <verified retrieval agent>
Allow: /

# Model training: <owner decision, dated>
User-agent: <verified training agent>
<Allow or Disallow>: /

# Applies to every crawler regardless of category
User-agent: *
Disallow: /admin
Disallow: /api
Disallow: <participant action and manage paths>
Disallow: <declaration paths>
Disallow: <runner profile path>
```

Notes worth carrying into the decision:

- `robots.txt` is a request, not enforcement. Some crawlers ignore it. Server or CDN rules
  are the only real control, and are out of scope for V1.
- When a person pastes a URL into an assistant, the fetch is usually treated as
  user-directed rather than crawling, and crawl rules may not apply.
- Blocking a training agent generally does not affect classic search ranking, but verify the
  specific agent, since some vendors combine concerns.
- Whatever is decided, the private paths above stay disallowed for everyone. That is a
  privacy rule (`BR-REQ-070-01`), not an AIO preference.

### 5. llms.txt

An `/llms.txt` file listing a site's key pages in Markdown is a proposed convention. No
major provider has committed to it as a standard, and its measured value is unproven.

For a site this size the honest position is: it costs almost nothing, so add it if you like,
generated from the same source as the sitemap rather than hand-maintained, and do not count
on it. Never let it become a second copy of the site's facts that can drift out of date.

### 6. Measuring whether any of this works

There is no console for AI visibility. Use three cheap proxies:

1. **Server logs.** Verified AI crawler user agents show which pages are being fetched and
   how often. Review with the same cadence as the crawler policy.
2. **Referrals.** Assistants that link out send referral traffic with identifiable sources.
   Available only once the analytics decision in `BUSINESS.md` §9 is made.
3. **Ask them.** Once a quarter, ask two or three assistants the questions the club cares
   about, in Romanian and English. Record the answers in `DECISIONS.md` or a club document.
   Wrong answers usually trace back to a missing fact on a page, not to a ranking problem.

The failure mode to watch for is an assistant confidently reporting stale availability. The
mitigation is already in the architecture: the free-place number is never cached as a source
of truth (`AGENTS.md` §10.6), and the page states registration status in words.

### Checklist by phase

**Phase 1 to 3, as pages are built**

- [ ] Every public page renders its content in the server HTML response.
- [ ] No fact exists only inside a client-only component, tab, or modal.
- [ ] Absolute dates and explicit units in body text, not only in components.
- [ ] Availability and cancellation stated in a sentence, not only as a chip.
- [ ] `SportsOrganization` `sameAs` lists every official profile, verified as correct.
- [ ] About page answers what, where, since when, and how to make contact.

**Phase 8, before launch**

- [ ] Crawler user-agent names verified against provider documentation, with the check date recorded.
- [ ] Owner decision on training crawlers recorded in `DECISIONS.md`.
- [ ] `robots.txt` reflects that decision, with commented reasoning.
- [ ] Private paths disallowed for all agents, verified by fetching one as a bot.
- [ ] Entity details identical across the site and every social profile.
- [ ] Optional `llms.txt` generated from the same source as the sitemap, or deliberately skipped.
- [ ] Baseline assistant answers recorded for the club's core questions.

**Recurring, quarterly**

- [ ] Re-verify crawler names and update `robots.txt`.
- [ ] Review AI crawler activity in server logs.
- [ ] Re-ask the assistant questions and correct any page that produced a wrong answer.


---

## Accessibility

Serves `BR-REQ-070-02`. Implements `AGENTS.md` §18.2, target WCAG 2.2 AA. Not
authoritative; see [About these guides](#about-these-guides).

Two things make this site's accessibility work specific rather than generic. It is bilingual,
so every rule applies twice and Romanian strings are longer than English ones. And the
registration flow is time-limited, which is the area where accessibility failures do real
harm: a person who cannot complete the declaration within the hold loses their place.

### 1. The flow that matters most

Walk the registration journey with a keyboard only, then with a screen reader, in both
locales. Everything else is secondary.

**Registration form**

- Every input has a programmatically associated visible label. Placeholder text is not a label.
- Errors are associated with their field, announced, and stated in words rather than colour.
- The privacy acknowledgment is a real checkbox with a real label, and its link opens the
  privacy notice without losing entered data.
- Do not ask for the same information twice across the flow (WCAG 2.2, 3.3.7 Redundant
  Entry). The participant already gave their name and email at submission.

**Declaration page**

- The declaration body is readable text, not an image, and is reachable and scrollable by
  keyboard.
- The acceptance checkbox and the typed-name field are separate, labelled, and both required
  with clear messaging.
- The hold deadline is announced through a polite live region, not only as a visual
  countdown, and the remaining time is stated in text a screen reader can read on demand.
- If the hold expires while the page is open, the failure is explained and the recovery path
  is stated, rather than silently rejecting the submit.

**Waiting-list offer page**

Same rules as the declaration, plus the offer deadline is stated as an absolute local time
in addition to any countdown. A countdown alone is unusable for someone who has stepped away.

**Free-place counter**

A status, so mark it as one. When it updates, announce politely. Never announce assertively;
it must not interrupt someone mid-form.

### 2. Bilingual specifics

- `<html lang>` matches the rendered locale on every page.
- The language switcher marks each option with its own `lang` attribute so a screen reader
  pronounces "English" in English.
- Romanian strings run roughly 15 to 25 percent longer than English. Test every button,
  label, and navigation item in Romanian at 320 pixels wide. Text must wrap, not clip or
  truncate with an ellipsis.
- Diacritics must render correctly in the chosen font at every weight, including in email
  templates. Check `ș`, `ț`, `ă`, `â`, `î` specifically, and beware fonts that substitute
  the comma-below characters with cedilla forms.
- Alt text, error messages, and live-region announcements are translated like any other
  string. They are the ones most often forgotten.

### 3. WCAG 2.2 additions worth naming

The newer success criteria happen to line up well with this project:

- **3.3.8 Accessible Authentication.** The passwordless design already satisfies this: no
  password to memorize, no cognitive test. Do not undermine it by adding a CAPTCHA to the
  registration form. If abuse mitigation is needed, prefer rate limiting (`AGENTS.md` §19.4).
- **2.5.8 Target Size.** Minimum 24 by 24 CSS pixels for interactive targets. Check MUI icon
  buttons, which default smaller in dense layouts.
- **2.4.11 Focus Not Obscured.** Sticky headers and cookie or consent banners must not cover
  the focused element. Test by tabbing down a long event page.
- **2.5.7 Dragging Movements.** Anything with drag reordering, such as gallery sort in the
  CMS, needs a non-drag alternative.

### 4. Components that need explicit attention

MUI gives reasonable defaults and then people override them.

- **Dialogs**: focus moves in on open, is trapped, returns to the trigger on close, Escape closes.
- **Menus and selects**: full keyboard operation, current option announced.
- **Snackbars**: use a live region; do not use them for anything a person must act on, since
  they disappear.
- **Tiptap editor**: reachable by keyboard, toolbar buttons labelled, and a documented way to
  reach content without a mouse. This is staff-facing and still in scope.
- **Custom-styled checkboxes and radios**: keep the native control, do not reimplement.
- **Icon-only buttons**: accessible name in both locales, not just a tooltip.

### 5. Visual

- Contrast 4.5:1 for body text and 3:1 for large text and meaningful UI boundaries. Check the
  brand palette early, because discovering a brand colour fails contrast after the design is
  approved is expensive.
- Never encode state in colour alone: full, cancelled, expired, and confirmed all need text
  or an icon with an accessible name.
- Respect `prefers-reduced-motion` for any countdown animation or transition.
- Support 200 percent zoom and 320 pixel width without horizontal scrolling.

### 6. Testing

- Automated checks catch perhaps a third of issues. Run them in CI on the key pages and treat
  a pass as a floor, not a result.
- Manual keyboard pass on the full registration journey, every release.
- Screen reader spot-check on the declaration and offer pages before launch. NVDA or VoiceOver
  is enough; a full matrix is not proportionate here.
- Add accessibility assertions to the existing Playwright journeys rather than a separate
  suite, so they run every time.

### Checklist by phase

**Phase 1, public shell**

- [ ] `<html lang>` correct per locale.
- [ ] Language switcher options carry their own `lang`.
- [ ] Skip link to main content.
- [ ] Focus visible everywhere, including on dark backgrounds.
- [ ] Brand palette contrast verified before the design is signed off.
- [ ] Romanian strings tested at 320 pixels with no clipping.

**Phase 4 to 5, registration and waiting list**

- [ ] Every field labelled and every error associated and announced.
- [ ] No redundant re-entry of name or email.
- [ ] Declaration acceptance and typed name independently labelled and validated.
- [ ] Hold and offer deadlines available as text and announced politely.
- [ ] Absolute deadline time shown alongside any countdown.
- [ ] Free-place counter is a polite live region.
- [ ] Expiry while the page is open explains itself and offers a path forward.
- [ ] No CAPTCHA added to the participant flow.

**Phase 3 and 7, CMS and media**

- [ ] Alternative text required before publication and translated per locale.
- [ ] Tiptap toolbar keyboard operable and labelled.
- [ ] Gallery reordering has a non-drag alternative.

**Phase 8, before launch**

- [ ] Automated audit passes on homepage, event, registration, declaration, article.
- [ ] Manual keyboard pass of the whole registration journey in both locales.
- [ ] Screen reader spot-check on declaration and offer pages.
- [ ] 200 percent zoom and reduced-motion verified.
- [ ] Diacritics verified in web pages and in both email templates.


---

## Performance

Serves `BR-REQ-070-02` and `BR-REQ-101-01`. Implements `AGENTS.md` §18.3. Not
authoritative; see [About these guides](#about-these-guides).

The audience is runners on phones, often on mobile data, often standing outside deciding
whether to register. The event page and the registration form are the two surfaces where
speed converts. An admin table that takes an extra second does not matter.

Two constraints shape every decision here. The application runs as a persistent Node process
on ordinary shared hosting, not on an edge network, so there is no CDN magic to hide slow
work. And Material UI with Emotion has a real client-side cost that has to be managed
deliberately.

### 1. Targets

Core Web Vitals at the 75th percentile on mobile:

| Metric | Target |
| --- | --- |
| LCP | 2.5 s or better |
| INP | 200 ms or better |
| CLS | 0.1 or better |

These are the published thresholds, not club targets. `BUSINESS.md` §7 forbids inventing
performance goals the club has not agreed; measured thresholds from the platform vendors are
a different thing and are fine to hold.

### 2. Rendering and client boundaries

- Server Components by default. A page becomes a client component only for a specific
  interaction, and then only the interactive part does.
- The event page's content, including the free-place count, renders on the server. The count
  is read fresh, never cached as a source of truth (`AGENTS.md` §10.6), so it is a database
  read on the critical path: keep the query indexed and narrow.
- Registration, declaration, and offer pages are forms. Keep them mostly static markup with a
  small interactive island rather than a fully client-rendered form.
- Never ship a participant dataset to the browser. Admin tables paginate on the server.

### 3. Material UI cost control

- Use the official App Router integration for the installed versions, so styles are extracted
  during server rendering rather than injected after hydration. Getting this wrong produces a
  visible flash and a CLS penalty.
- Import icons individually. A namespace import of the icon package pulls in an enormous
  module graph.
- Prefer `styled` for repeated patterns and reserve `sx` for one-off adjustments. Heavy `sx`
  usage inside lists creates style objects per row.
- Theme tokens over literal values, so the palette stays one object rather than repeated
  strings across the bundle.
- No wrapper component around every MUI component, which is already a rule in `AGENTS.md`
  §1.3 and happens to be a bundle-size rule too.

### 4. Images and fonts

- `next/image` everywhere, with explicit dimensions so nothing shifts as it loads.
- Event and article covers are the LCP element on their pages. Mark the above-the-fold one as
  priority and serve it at sensible responsive widths.
- Media is served from R2 via `R2_PUBLIC_BASE_URL`. Confirm that images arrive with long cache
  headers and a modern format.
- Galleries lazy-load below the fold and reserve space for each item.
- `next/font` with self-hosting and `display: swap`. Subset to Latin Extended so Romanian
  diacritics render without a fallback swap. Two weights are usually enough; every extra
  weight is another file on the critical path.

### 5. Third-party scripts

The most effective performance decision available is to add almost none.

- No external social embeds, which `AGENTS.md` §3.4 already forbids. Link out instead.
- No map embed unless a specific requirement appears; a static map image plus a link to
  directions is faster and simpler.
- No analytics until the owner decision in `BUSINESS.md` §9 is made, and when it is, prefer
  something lightweight and load it after interaction.
- No tag manager. It is an open door for unreviewed scripts on a site handling registrations.

### 6. Server and database

- Index every column used in the hot paths: event lookup by localized slug, registrations by
  event and status, the waiting-list ordering, and hold expiry.
- The capacity query runs on every event page view. Write it once, test it against realistic
  row counts, and keep it out of loops.
- Cache the parts that are safe to cache, which is editorial content, and never the
  availability number.
- Avoid N+1 queries in listings; fetch translations in one pass.
- A persistent Node process means an in-memory leak accumulates. Watch memory across a week
  in QA before launch.

### 7. Measuring

- Measure before optimizing. `AGENTS.md` §18.3 says this and it is the rule most often broken
  by well-meaning refactors.
- Run Lighthouse on mobile emulation against QA for the homepage, an event page, and the
  registration form. Record the numbers in the release notes so regressions are visible.
- Track bundle size for the public routes in CI once a baseline exists, and fail on a large
  unexplained jump rather than on an absolute number.
- After launch, real user data from Search Console's Core Web Vitals report is more honest
  than any lab run.

### Checklist by phase

**Phase 1, public shell**

- [ ] Official MUI App Router integration wired for the installed versions.
- [ ] `next/font` self-hosted, subset including Latin Extended, `display: swap`.
- [ ] Icon imports are individual, not namespace-wide.
- [ ] No third-party script on any public page.

**Phase 3, events and CMS**

- [ ] `next/image` with explicit dimensions across public pages.
- [ ] Above-the-fold cover image marked priority.
- [ ] Listings paginate on the server.
- [ ] No N+1 query when loading translations.
- [ ] Gallery items lazy-load with reserved space.

**Phase 4 to 5, registration and capacity**

- [ ] Availability query indexed and tested at realistic row counts.
- [ ] Registration and declaration pages are server-rendered with a small client island.
- [ ] No participant dataset reaches the browser.

**Phase 8, before launch**

- [ ] Lighthouse mobile run recorded for homepage, event page, registration form.
- [ ] LCP, INP, and CLS within target on a real mid-range phone over mobile data.
- [ ] R2 media served with long cache headers in a modern format.
- [ ] Memory stable across a week of QA running.
- [ ] Bundle baseline recorded for public routes.


---

## Editorial

For club contributors writing event descriptions, articles, and translations. Serves
`BR-BUS-052` and `BR-REQ-052-01`. Not authoritative; see [About these guides](#about-these-guides).

You do not need to know anything technical to use this guide. Everything here is about what
to write, not how the website works.

### 1. What a good event page contains

Someone reading on a phone, deciding in thirty seconds whether to come. Answer these in the
first paragraph, in sentences rather than only in the page's boxes and badges:

- **What** kind of run it is and who it suits.
- **When**, with the full date and start time. Write "duminică, 14 martie 2027, ora 09:00",
  not "this Sunday". People read the page months later, and so do AI assistants.
- **Where** you actually meet, precisely enough to find without asking. "În parcarea de la
  intrarea în parc, lângă chioșc" beats "in the park".
- **How far**, and how much climbing if it matters.
- **How hard**, in terms a newcomer understands. Give a pace range rather than only a
  difficulty label.
- **What it costs**, even when it is free. Say free.
- **Whether registration is needed**, and if places are limited, say so.

Then add what makes people come: what to bring, whether there is a slower group, whether
anyone waits at the back, where to park, whether it happens in rain.

The most common mistake is writing for people who already come. Write for the person who has
never met anyone in the club and is nervous about being too slow.

### 2. Writing so people find the page

- Use the words people actually search: "alergare", "cros", "antrenament", "tura de duminică".
- Write the club's full name at least once per page, with diacritics.
- Include "Brașov" in the text of every event page. Also write it once without diacritics
  somewhere natural on key pages, because many people search that way.
- Give each event a distinct title. Ten pages called "Weekly run" compete with each other.
- Do not put facts only inside an image. A poster with the date is invisible to search
  engines, to assistants, and to anyone using a screen reader. Put the date in the text too.
- Write a short summary for each article. It becomes the description in search results.

### 3. Images

- Every image needs alternative text describing what it shows, in the language of the page.
  "Grup de alergători pe Tâmpa, dimineața" is useful; "IMG_2043" and "poză" are not.
- Never publish a photo of a person who has not agreed to it. The club's photo consent
  procedure is an open decision in `BUSINESS.md` §9; until it exists, be conservative.
- Prefer landscape images for covers. Portrait ones crop badly in listings and link previews.
- Do not put important text inside an image.

### 4. Romanian and English

- Romanian is the default and can be published on its own. English can follow later.
- An English page must be a real translation, not machine output pasted in. If nobody has
  reviewed it, leave it unpublished. A missing English page is better than a wrong one; the
  site will simply not offer English for that item.
- Translate the meaning, not the words. Distances, difficulty descriptions, and directions
  often need rewriting rather than translating.
- Keep place names in Romanian in both languages: Tâmpa, Poiana Brașov, Parcul Nicolae Titulescu.
  Add a short explanation in English rather than inventing a translated name.
- Keep the club's name identical in both languages.

### 5. Keeping pages true

This matters more than usual here, because AI assistants read these pages and repeat what
they say.

- When an event is cancelled, say so in the text of the page as well as changing its status.
  Someone will read the description and not the badge.
- When something recurring changes, such as a new meeting point, update the page rather than
  writing a new article that contradicts it.
- Write recaps after events. They are the pages that build the club's presence over years.
- Keep past events on the site. Do not delete them.

### 6. What you must not write

- **Never write legal text.** Privacy, terms, and the participation declaration have approved
  wording, versions, and a separate process. Do not paraphrase or summarize them on an event
  page. If something is unclear, link to the document.
- **Never publish participant information.** No names of who registered, no photos identifying
  someone who has not agreed, no counts framed in a way that identifies a person.
- **Never invent facts.** Not results, not numbers of participants, not sponsor names, not
  safety instructions. If you do not know, ask, or leave it out.
- **Never publish AI-generated text without reading and correcting it.** AI can help with a
  first draft or a translation. A person is responsible for what appears on the site, and an
  assistant does not know that the meeting point moved last month.

### 7. Before you submit for review

- [ ] Date, time, meeting point, distance, difficulty, and cost are all in the text.
- [ ] The title is specific to this event.
- [ ] "Brașov" appears in the body.
- [ ] Every image has alternative text.
- [ ] No text-only-in-image facts.
- [ ] No participant names or unapproved photos.
- [ ] No legal wording written or paraphrased.
- [ ] The summary reads well on its own.
- [ ] Anything AI helped with has been read and corrected by you.
- [ ] If an English version exists, someone who reads English has checked it.

### 8. For editors, before publishing

- [ ] The facts match the event's actual settings: date, capacity, registration dates.
- [ ] Both languages, if both are published, say the same thing.
- [ ] Links work and point where they claim.
- [ ] The page is useful to someone who has never come before.
- [ ] Nothing on the page contradicts another page on the site.


---

## Launch checklist

The single gate before the first `qa` to `main` promotion. Serves the release gate in
`SPECS.md` §3. Not authoritative; see [About these guides](#about-these-guides).

Work top to bottom. Items are ordered by lead time, not importance: the first section
contains everything that depends on other people and therefore has to start weeks earlier.

### 1. Long lead time, start first

- [ ] Domain registered and owned by the club (`DECISIONS.md` §6.10).
- [ ] Approved privacy notice text, Romanian and English (`BUSINESS.md` §9).
- [ ] Approved terms text, Romanian and English.
- [ ] Approved event declaration text, Romanian and English.
- [ ] Confirmation from the club that typed-name acceptance suits the intended events.
- [ ] Retention, deletion, and historical-record policy agreed.
- [ ] Photo consent and removal procedure agreed.
- [ ] Production sender name and address agreed.
- [ ] Support and organizer contact addresses agreed.
- [ ] Initial staff named for Author, Editor, and Admin.
- [ ] Timing defaults confirmed or replaced: 48 hours, 30 minutes, 24 hours.
- [ ] Analytics decision made, including consent requirements.
- [ ] Training-crawler policy decided ([AIO](#aio) §4).
- [ ] "No place available" email decision made (`DECISIONS.md` §6.5).

### 2. Legal and privacy

- [ ] All three legal documents loaded through [Legal document version runbook](./RUNBOOKS.md#legal-document-version).
- [ ] Privacy and terms reachable from the footer in both locales.
- [ ] Registration form links the privacy notice and records the acknowledged version.
- [ ] Each internal event references an approved declaration version.
- [ ] No page describes acceptance as a qualified electronic signature.
- [ ] Data collected matches `BR-REQ-070-01`: nothing extra crept in.
- [ ] Export produces only necessary fields and is audited.

### 3. Correctness under load

- [ ] Concurrency test proves capacity is never exceeded.
- [ ] Queue-priority test proves no leapfrogging.
- [ ] Expired hold frees capacity without the maintenance job running.
- [ ] Offer expiry promotes the next participant.
- [ ] Waiting list closes at event start.
- [ ] Restart behaves correctly for verified and unverified participants.
- [ ] Duplicate Gmail forms, including `googlemail.com`, resolve to one identity.
- [ ] Every allowed state transition has a test; no undefined transition is reachable.

### 4. Email

- [ ] Mailgun sending domain verified with SPF and DKIM.
- [ ] All message types have Romanian and English HTML and text bodies.
- [ ] Links in email are absolute, localized, and derived from `APP_BASE_URL`.
- [ ] Webhook signature verification passes on the production host.
- [ ] QA cannot send to arbitrary addresses; production can.
- [ ] Bounce and complaint handling suppresses repeat sends.
- [ ] Diacritics render correctly in both templates and in subject lines.
- [ ] One real end-to-end registration completed on production before announcing the site.

### 5. SEO

Detail in [SEO](#seo).

- [ ] Canonical and `hreflang` correct, including `x-default`.
- [ ] Sitemap contains published content only, with real `lastmod`.
- [ ] Admin, action pages, declaration, preview, and runner profiles excluded.
- [ ] `robots.txt` correct for production; QA disallows everything and sends `noindex`.
- [ ] `SportsOrganization` and `SportsEvent` structured data validates.
- [ ] `remainingAttendeeCapacity` matches the visible count.
- [ ] Unique title and description on every public page in both locales.
- [ ] Search Console and Bing verified; sitemap submitted.
- [ ] No action token in any canonical, alternate, or Open Graph URL.

### 6. AIO

Detail in [AIO](#aio).

- [ ] Crawler user-agent names verified against provider documentation, with the date recorded.
- [ ] `robots.txt` reflects the owner's training decision with commented reasoning.
- [ ] Private paths disallowed for every agent and verified by fetching as a bot.
- [ ] Club entity details identical across site and all social profiles.
- [ ] Event facts present in prose, not only in components.
- [ ] Baseline assistant answers recorded for the club's core questions.

### 6b. Mobile

Detail in [Mobile-first](#mobile-first).

- [ ] Every M1 journey completed on a real mid-range phone over mobile data.
- [ ] No horizontal scroll at 320 pixels in either locale on any public page.
- [ ] Event page shows the essential facts in the first screen at 360 pixels.
- [ ] Primary action and deadline reachable on registration, declaration, and offer pages.
- [ ] Correct keyboards and autocomplete on the registration form.
- [ ] Registration list and detail usable on a phone.
- [ ] Email templates verified on a phone in the mail clients participants use.
- [ ] Playwright mobile project green for all registration journeys.

### 7. Accessibility

Detail in [Accessibility](#accessibility).

- [ ] Automated audit passes on the five key pages.
- [ ] Manual keyboard pass of the registration journey in both locales.
- [ ] Screen reader spot-check on declaration and offer pages.
- [ ] Deadlines available as text, announced politely, with absolute times.
- [ ] Contrast verified against the final brand palette.
- [ ] Romanian strings do not clip at 320 pixels.

### 8. Performance

Detail in [Performance](#performance).

- [ ] LCP, INP, and CLS within target on a real mid-range phone over mobile data.
- [ ] Lighthouse mobile numbers recorded for homepage, event page, registration form.
- [ ] No third-party script on public pages beyond an agreed analytics choice.
- [ ] Media served from R2 with long cache headers.
- [ ] Memory stable across a week of QA.

### 9. Security

- [ ] Action tokens stored hashed, purpose-scoped, single-use, expiring.
- [ ] No GET request mutates state anywhere in the participant flow.
- [ ] Rate limiting on registration, resend, and profile-link requests.
- [ ] CSP, security headers, and CORS configured from environment values.
- [ ] Role boundaries asserted server-side, not only in the interface.
- [ ] No secret in the repository, in logs, or in error output.
- [ ] Job endpoints refuse a request without valid credentials.
- [ ] Dependency audit clean, or exceptions recorded.

### 10. Operations

- [ ] Domain binding completed per [Domain binding runbook](./RUNBOOKS.md#domain-binding).
- [ ] QA and production share no database, bucket, auth instance, or secret.
- [ ] Database backup taken and a restore actually tested, not just configured.
- [ ] Scheduler configured with per-environment credentials; `job_runs` populating.
- [ ] Health check reports degraded when a job stalls.
- [ ] Error monitoring receiving events without participant data in payloads.
- [ ] Two people can recover every provider account.
- [ ] Domain renewal date and owner recorded.
- [ ] Runbooks readable by someone who did not build the system.

### 11. Documentation

- [ ] `yarn docs:check` passes.
- [ ] Baseline marker identical across all six root documents and `MANIFEST.txt`.
- [ ] No stale baseline literal anywhere (`docs:check` enforces this).
- [ ] `SETUP.md` §26 hostname table updated to final values.
- [ ] Provisional decisions in `DECISIONS.md` §6 confirmed or amended by the owner.
- [ ] `CODEOWNERS` names real people or a real team.
- [ ] Every requirement in `SPECS.md` marked MUST is met or explicitly waived in writing.

### 12. Day one

- [ ] One real event published in both locales.
- [ ] One real registration completed end to end by a person who did not build the site.
- [ ] An organizer has used the backoffice once, unaided, and can find a participant.
- [ ] Someone other than the developer knows how to cancel an event.
