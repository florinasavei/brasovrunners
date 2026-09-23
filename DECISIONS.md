<!-- PROJECT_BASELINE: BR-V1.59-2026-09-23 -->

# Brașov Runners — Decision History and Agent Handoff

**Baseline `BR-V1.59-2026-09-23`** · versioned with the whole set · [changelog](./CHANGELOG.md)


> This file summarizes the decisions made during planning so a freelancer or AI agent can understand **why** the current repository baseline looks the way it does. It is context, not a competing specification. If this file conflicts with `BUSINESS.md`, `SPECS.md`, `AGENTS.md`, or `SETUP.md`, the current authoritative documents win.

## 1. Original objective

Brașov Runners is a small local running club in Brașov, Romania. It organizes recurring social/training meetups, larger community events, and local running contests/races. The project started as a request for a modern, SEO-first, low-cost custom platform that could remain understandable and maintainable by one developer rather than becoming a generic race-management product.

The persistent design rule is:

> **Keep it simple, but not disposable.**

## 2. Decisions made during planning

### Custom modular monolith

Use one Next.js App Router application and one PostgreSQL data model per environment. Do not introduce a separate .NET API, microservices, Kubernetes, a generic external CMS, or another frontend unless a demonstrated requirement appears.

### Material UI instead of Tailwind/shadcn

The UI baseline was deliberately changed to Material UI so the frontend conventions remain closer to the stack already familiar to the project owner from Flyward. Use MUI Core + Emotion and the official Next.js App Router integration. The public website still needs a custom Brașov Runners visual identity; it must not look like a default MUI admin template.

### Internationalization is V1

Romanian (`ro`) and English (`en`) are supported from the start. Romanian is the default locale. Public routes are localized, and editorial translations are separate records so one language can remain draft while another is published. Operational data such as capacity, timestamps, and registration state is not duplicated per language.

### Simplified Git flow

There are exactly two long-lived branches:

```text
feature/* / fix/* / chore/*
            |
            v
           qa  -> QA
            |
            v
          main -> Production
```

Normal work branches from and merges into `qa`. Production is a reviewed `qa -> main` promotion. No `develop` branch. Hotfixes from `main` must be reconciled back into `qa`.

### Mini CMS inside the application

Non-technical contributors need to write articles and event/site descriptions. The CMS therefore lives inside the same Next.js application. Current scope includes articles, selected static content, event descriptions, translations, galleries/media, draft/review/publish/archive, protected preview, and revision-safe editing. Tiptap open-source core is the current editor choice; canonical editable content is Tiptap JSON.

### Authentication is for staff, not ordinary participants

Initial account-centric registration was intentionally removed to minimize friction. Zitadel/Auth.js is for staff roles (`AUTHOR`, `EDITOR`, `ADMIN`) who access the CMS/backoffice. Ordinary event participants do not create passwords or Zitadel accounts.

### Participant identity is verified email

Participants register with name + email and prove control through a secure email link. The platform stores a delivery email and a canonical comparison identity. Duplicate protection is per canonical email and per event.

Current comparison policy:

- trim surrounding whitespace;
- compare local part and domain case-insensitively as an explicit Brașov Runners product rule;
- for exact consumer `gmail.com`, remove dots in the local part for duplicate detection;
- for exact consumer `gmail.com`, ignore `+tag` for duplicate detection;
- do not apply Gmail-specific rules to arbitrary custom domains;
- preserve the verified submitted delivery address separately;
- version the canonicalization algorithm.

This prevents common duplicate-account aliases but does not claim to prove that two different email addresses belong to the same human.

### Registration is confirmation + declaration + capacity

The participant journey evolved to:

```text
submit registration
      -> confirm email
      -> place available?
          -> yes: temporary declaration hold
          -> no: waiting list
      -> sign approved declaration
      -> CONFIRMED
```

The actual declaration text is intentionally not invented by AI. It must be human-approved, versioned, localized, and stored with evidence of acceptance. Staff cannot sign it on behalf of a participant.

### Passwordless participant self-service

Email links let a participant:

- confirm registration email;
- sign the declaration;
- manage/unregister a registration;
- accept a waiting-list place offer;
- optionally manage a public runner profile.

Links are purpose-scoped, expiring, stored hashed, and must not mutate state simply by being opened.

### Backoffice registration management

Staff can inspect registration state/timeline, declaration state, waitlist state, emails, delivery failures, and audit history. Admins can resend the state-appropriate email, cancel/restart safely, waitlist/promote according to allowed transitions, and export participant data. Admins cannot bypass the declaration by marking it signed.

### Email resend is state-aware

There is no generic “confirmation email” resend. The backoffice derives the correct email for the current state: verify email, complete declaration, waitlist status, claim-place offer, confirmed/manage link, or terminal-state/restart notice. A resend gets a new delivery/outbox record and fresh scoped token when appropriate without silently changing registration state.

### Public free spots + waiting list

Everyone can see current immediate availability for capped events. Confirmed registrations and unexpired active holds occupy places. Ordinary waiting-list rows do not occupy physical capacity but have priority over later registrants. Capacity-changing operations allocate released places to the queue before allowing a later direct registrant to leapfrog it.

### “Gamification” means fair timed promotion, not points

The requested engagement/gamification concept is intentionally narrow in V1: when a place becomes available, the next eligible waiting participant receives a time-limited claim offer. If accepted and the declaration is completed in time, they become confirmed. If declined/expired, the next participant is offered the place. Points, badges, streaks, rankings, and leaderboards are deferred.

### Optional public runner profile

A verified participant may opt into a public profile with a display name, short bio, Strava link, and selected social links. Profiles are private by default. Email, declarations, and registration history are never public. Strava is a URL only in V1; no OAuth/activity sync.

### Managed services with clear boundaries

Current service split:

```text
GoDaddy Node.js Hosting  application runtime
GoDaddy                  domain + normal DNS initially
GitHub                   repository + CI
Neon                     PostgreSQL
Zitadel + Auth.js        staff authentication
Mailgun                  transactional email
Cloudflare R2            durable media/object storage
```

Each provider is an adapter around a clear capability. Provider replacement should not rewrite business rules.

### GoDaddy hosting became the preferred runtime

The original plan used Vercel. After revisiting hosting in August 2026, GoDaddy Node.js Hosting became the preferred V1 runtime because its current product supports ordinary Node.js/Next.js applications, GitHub-connected branch deployment, custom domains/SSL, and persistent Node.js processes.

Use two persistent applications:

```text
GoDaddy QA app          <- qa branch   <- qa.<domain>
GoDaddy Production app  <- main branch <- <domain>
```

Portability rules:

- root `package.json` + lockfile;
- clean `npm run build`;
- production `npm start`;
- runtime `PORT`;
- no provider-specific business APIs;
- no durable business state on local filesystem;
- no Vercel-only APIs;
- separate secrets/resources for QA and production.

GoDaddy may also remain the registrar and normal DNS host. Cloudflare is retained for R2 only unless a future feature specifically requires Cloudflare-managed DNS.

### Background work must survive restarts

Registration maintenance and email delivery cannot rely on an in-memory JavaScript interval merely because the host runs a persistent Node process. Outbox rows, holds, waitlist offers, and expirations live in PostgreSQL. Protected internal job endpoints perform bounded idempotent work and may be invoked by a minimal scheduler. Changing the scheduler must not change business logic.

### Read-only Claude/Codex repository access

AI reviewers may read repository contents, pull-request diffs/discussion, checks/statuses, Actions runs/logs, and execute tests in an ephemeral checkout. They must not receive permission to push, merge, dispatch/rerun workflows, deploy, edit settings/workflows, or read secrets. If PR comments are desired, use a separate tightly scoped trusted relay rather than giving the AI review job repository write access.

## 3. V1 product boundary

V1 includes:

- bilingual public website;
- events/races as one event domain;
- public capacity availability;
- no-account registration;
- verified email identity;
- declaration acceptance;
- cancellation/unregistration links;
- waiting list and timed promotion;
- backoffice registration management and resend;
- optional public runner social profile;
- articles/static content/gallery mini CMS;
- staff-only auth;
- transactional email/outbox;
- QA and production environments;
- SEO/accessibility/security/privacy fundamentals.

Not V1 unless explicitly approved:

- payments;
- timing/results/bibs/check-in;
- arbitrary registration form builder;
- emergency/health data;
- minors workflow;
- public participant directory/list;
- Strava/Garmin API sync;
- points/badges/leaderboards;
- full social network;
- generic page builder;
- separate backend/microservices.

## 4. Source-of-truth map

Read in this order:

1. `README.md` — entry point and current stack/release flow.
2. `BUSINESS.md` — non-technical behavior and business rules.
3. `SPECS.md` — requirements and acceptance criteria.
4. `AGENTS.md` — technical architecture and coding constraints.
5. `SETUP.md` — provider/repository/environment setup.
6. `DECISIONS.md` — this historical rationale only.

If a discussion item in this file is absent from the authoritative documents, do not implement it merely because it appears here. Resolve the discrepancy first.

## 5. Hosting verification references

The GoDaddy hosting choice was verified against GoDaddy's current official documentation during the August 2026 planning update. Before implementation, re-check the current provider documentation because hosting capabilities and plans can change.

- GoDaddy Node.js Hosting launch / supported frameworks and GitHub deployment: `https://www.godaddy.com/resources/news/godaddy-nodejs-hosting-launch`
- GoDaddy Node.js Hosting developer API overview: `https://developer.godaddy.com/en/docs/references/rest/nodejs-hosting`
- GoDaddy deployment reference: `https://developer.godaddy.com/en/docs/references/rest/nodejs-hosting/deployments`

Do not copy plan limits, Node versions, or provider-specific behavior into code without verifying the current official documentation first.

---

## 6. Baseline BR-V1.4 — audit resolutions (2026-08-27)

A cross-document audit of baseline `BR-V1.3-2026-08-27` found one missing authoritative
document, several rules present in only one file, and a number of behaviors that no
document decided. The resolutions below were applied across the affected documents in one
change set.

Decisions 1 to 9 are **provisional**: they are recorded defaults chosen so work can
continue, and any of them can be reversed by the project owner. Reversing one is an
ordinary documentation change and follows the change-type matrix in `AGENTS.md` §1.4.

### 6.1 `SPECS.md` was missing

Every other document treated `SPECS.md` as authoritative, `AGENTS.md` §1 ranked it above
`AGENTS.md`, and `docs:check` was specified to validate business-rule references from it.
It did not exist, so the acceptance layer was empty and the documentation check could not
pass. `SPECS.md` was written against the existing `BR-BUS-*` rules, and
`scripts/docs-check.mjs` now enforces the reference in both directions.

### 6.2 Decision 1 — the submit-time acknowledgment is privacy-notice acceptance

`SETUP.md` §19 required an acknowledgment at submission that no other document mentioned,
with no storage, no version, and no wording owner. It is now defined as acceptance of the
current approved privacy notice, validated at submission and stored on the registration
as a version and timestamp.

### 6.3 Decision 2 — privacy and terms are versioned legal documents

They previously had no route, no table, and no CMS home, while production readiness
depended on them. `declaration_templates` was generalized into `legal_documents` with the
keys `PRIVACY_NOTICE`, `TERMS`, and `EVENT_DECLARATION`. One versioning mechanism, one
approval path, one hashing rule, and public routes in both locales.

### 6.4 Decision 3 — a verified participant does not re-verify on restart

Restart previously always re-entered at `PENDING_EMAIL_CONFIRMATION`, although
`email_verified_at` lives on the participant and was already set. A verified participant
now restarts through the same capacity transaction directly into `PENDING_DECLARATION` or
`WAITLISTED`. Restart can still never leapfrog the queue or land on `CONFIRMED`.

### 6.5 Decision 4 — the waiting list closes when the event starts

`WAITLISTED` previously had no terminal transition, so entries would persist forever after
an event. Registration maintenance now expires them with `expiry_reason = EVENT_STARTED`.
No message is sent, deliberately: a "you did not get a place" email reads as a rejection
and adds no operational value in V1.

### 6.6 Decision 5 — `googlemail.com` collapses to `gmail.com`

Canonicalization was scoped to the exact string `gmail.com`, so the same inbox could
produce two identities. Both domains now collapse in the canonical value at
canonicalization version 1, which avoids a later migration and re-canonicalization pass.
`normalizedEmail` and `deliveryEmail` keep the submitted domain.

### 6.7 Decision 6 — no legal-document editor in V1

`SETUP.md` §18 offered a screen or a runbook without choosing. V1 chooses the runbook:
new approved versions arrive through migration or seed, and the backoffice shows legal
documents read-only. An editor screen is a later scope decision.

### 6.8 Decision 7 — scheduling is a liveness concern, not a correctness one

The documents depended on an unnamed scheduler for hold and offer expiry. The important
property was already present but unstated: every capacity-changing transaction evaluates
hold expiry against the current time, so capacity is correct whether or not the job ran.
That is now written down explicitly. Invocation uses an in-process interval as the primary
trigger and an external scheduler as a watchdog, with every run recorded in `job_runs` and
surfaced by the health check. The specific external scheduler is chosen before Phase 5.

### 6.9 Decision 8 — runner profiles are `noindex`

Three documents described profile visibility three different ways. Absent from the sitemap
and served with `noindex, nofollow` is now the single rule.

### 6.10 Decision 9 — the domain is bound at the end, but registered earlier

The domain is not registered yet, and binding it is deliberately the last step of V1.
`SETUP.md` §26 is the only place a hostname appears; everything else says "QA host" and
"production host", and `APP_BASE_URL` is the single source of every absolute URL, so
binding is a configuration and DNS change with no code impact.

Registration itself should not wait for the end. Mailgun cannot send from an unverified
sending domain, and verification needs SPF and DKIM records on a domain the club owns plus
propagation time. That places the domain on the critical path for the email phase, not the
launch phase. Development and QA are unaffected, since QA runs in capture or allowlist
mode.

### 6.11 Read-only AI scope was clarified

`AGENTS.md` §22 reads as a blanket prohibition but its content addresses GitHub App and
workflow permissions. It now states that it governs repository-connected integrations, and
that a local agent operated by a human developer on a short-lived branch, whose output goes
through normal pull-request review, is expected and unaffected.

### 6.12 Discoverability was raised from a footnote to a requirement

Baseline `BR-V1.3` mentioned "applicable JSON-LD" in one clause and said nothing about how AI
assistants read the site. For a club whose main job is to be found by local runners, that was
under-specified.

Two requirements were added: `BR-REQ-052-02` makes structured data explicit
(`SportsOrganization`, `SportsEvent` with real capacity and status, `Article`,
`BreadcrumbList`), and `BR-REQ-070-03` requires public content to be present in the server
HTML response, to state its facts in text rather than only in styled components, and to carry
an explicit crawler policy.

The crawler policy separates retrieval agents, which decide whether the club appears in AI
answers today, from training agents, which is a preference question. Retrieval is allowed by
default because it serves the club's purpose. Training is an owner decision added to
`BUSINESS.md` §9. User-agent names are deliberately not written into the documents, because
that landscape changes faster than this repository and §1.2 forbids implementing from memory;
they are verified at the time of use and re-checked quarterly.

Practice guides were added under `docs/PRACTICES.md` for SEO, AIO, accessibility, performance,
editorial writing, and the launch gate. They are guidance and carry no authority: each cites
the requirement IDs it serves, and the root documents win in any disagreement.

## 6b. Baseline BR-V1.5 — discoverability and engineering priorities (2026-08-28)

Two additions, both recorded here because they changed authoritative documents.

`BR-REQ-052-02` and `BR-REQ-070-03` made discoverability explicit: required structured data,
server-rendered public content, facts stated in text, and an explicit crawler policy. Section
6.12 has the reasoning. These were added to `SPECS.md` before the baseline was bumped, which
was a process error; the bump to `BR-V1.5` covers them.

`AGENTS.md` §1.5 adds a priority order for resolving conflicts between engineering goals,
with trust-carrying correctness first and legibility to a stranger second. The stated reason
is that most future changes to this codebase will be made by an AI agent prompted by someone
without the original context, which makes conventional, local, single-place code worth more
than elegant code. Detail is in `docs/PRACTICES.md` § Code priorities.

## 7. Open proposal — walking skeleton before the layered sequence

Not yet decided. `SETUP.md` §29 stands as written until it is.

The pull-request sequence and the phases in `AGENTS.md` §26 are layered: infrastructure,
then content, then registration. The weakness of a layered plan is that nothing is real until
late and the riskiest integration work lands last.

The proposal is to insert one thin end-to-end slice after the foundation pull requests: a
single seeded event, a registration form, email confirmation in capture mode, declaration
acceptance against a placeholder version, reaching CONFIRMED, deployed to QA and clicked
through by a person. Deliberately ugly and deliberately incomplete. Its purpose is to expose
every integration risk in the project in one small slice, on the real host, early enough to
react.

Rationale and the alternatives considered are in
`docs/PRACTICES.md` § Delivery §3. Accepting it is a documentation change affecting
`SETUP.md` §29, `AGENTS.md` §26, the implementation order in `README.md`, and this file.

## 8. Open proposal — race photo hosting

Not yet decided, and not in V1. Recorded so a future reader knows the intent exists and knows
what was considered.

The club currently shares race and event photos through Google Photos. There is interest in
hosting them on the platform at some point.

**What V1 already covers.** The mini CMS has galleries backed by Cloudflare R2, intended for a
curated set of images per event or article, each with a caption and alternative text. That is
the right home for the ten to thirty photographs worth putting on an event page. It is not a
race photo archive.

**Why bulk race photos are a different product.** A three-hundred-runner race produces
thousands of frames. Storage is the easy part, and R2 is a good fit for it because it does not
charge for egress, which is the cost that makes photo galleries expensive elsewhere. The hard
parts are the photographer upload workflow for large batches over unreliable connections,
derivative generation, a browsing experience that stays usable at that volume, and above all
the thing participants actually want, which is finding themselves. Bib-number recognition and
face matching are the entire business model of commercial race photo services, and building
either is far outside this platform's boundary.

**The obligation that changes.** Linking to a Google Photos album and hosting the photographs
are different positions. Hosting makes the club the controller of a large set of images of
identifiable people, with takedown requests to honour and a retention policy to hold. The
photo consent and removal procedure in `BUSINESS.md` §9 is already an open owner decision; it
becomes materially heavier if the platform hosts the archive.

**Current recommendation.** Keep bulk galleries on Google Photos or a comparable service. Use
the platform's gallery for the curated selection, which is also the version that helps the
club's own site in search and in AI answers, since photographs on someone else's domain
contribute nothing to it.

**Smaller proposal worth deciding on its own.** An external gallery link on an event or
gallery record, mirroring the existing external-registration pattern: the event page says
"full album" and links out. Low cost, no new obligation. It is still a V1 scope change and
needs a deliberate decision under `AGENTS.md` §1.4 rather than being slipped in.

**What keeps the future cheap.** Nothing needs building now. The existing rules already avoid
the traps: the storage adapter is narrow, media is described by database rows rather than
filesystem paths, durable media never touches the application filesystem, and provider
replacement is not supposed to reach business logic. A later photo archive would add a content
type, a derivative pipeline, a takedown workflow, and a retention policy, without rewriting
what exists.

## 9. Open proposal — announcements, and confirmation that three roles are enough

Not yet decided. The role model in `BUSINESS.md` BR-BUS-060 and `AGENTS.md` §10.2 stands.

The club needs several core members able to post announcements and event updates, with an
approval step, because responsibilities inside the club are informal and a post going live
unreviewed is a real risk.

**Most of this already exists.** `AUTHOR` writes and submits but cannot publish. `EDITOR`
reviews, publishes, unpublishes, and archives, per locale. `ADMIN` does that plus
registrations, exports, and role assignment. Draft, In review, Published, Archived is the
approval process, and every state change is audited. It is deliberately simpler than a
general CMS: three roles, one workflow, no per-item permissions.

**Recommendation: keep three roles.** A fourth "moderator" role would overlap `EDITOR`
almost entirely. The one genuine gap is that unpublishing a runner profile is currently
`ADMIN`-only (`BR-REQ-038-03`); extending that to `EDITOR` is a smaller change than adding a
role. Roles are easy to add later and painful to remove once people identify with them.

**What is actually missing** is the announcement itself, in two parts:

1. A timestamped, localized update attached to an event, published through the existing
   Draft/In review/Published workflow, shown newest-first on the event page. Editing the
   description overwrites it, so today there is no way for a visitor to see that the meeting
   point changed on Thursday.
2. A way to tell people who registered. All ten message types in `BR-BUS-080` are tied to one
   participant's own registration state; there is no message to the participants of an event.

**The line to hold.** An operational notice to people who registered for a specific event,
about that event, is transactional: it arises from the registration relationship and needs no
separate consent model. A message to everyone who ever registered, about something new, is
marketing and stays deferred under `BUSINESS.md` §8. That sentence belongs in `BR-BUS-080`
when this is implemented, because it is exactly the distinction that erodes.

**Proposed shape.** An `event_updates` record with localized bodies following the existing
editorial workflow, plus an explicit publish-and-notify action restricted to `EDITOR` and
`ADMIN` that queues one `EVENT_UPDATE_NOTICE` per active registration in that participant's
registration locale, audited, never sent to cancelled or expired registrations. Notification
is a separate deliberate action rather than automatic on publish, so correcting a typo does
not email everyone.

Open with it: how weekly recurring runs are modelled. One durable page per recurring run
keeps administration low and is what `docs/PRACTICES.md` § SEO recommends; one event per
occurrence is required if a given week needs capacity or a declaration. A hybrid is viable.
Recurring-event generation remains deferred either way.

## 10. Open proposal — staff-created registrations and offline declaration acceptance

Not yet decided. `BR-REQ-033-03` stands: staff cannot sign a declaration on a participant's
behalf, and no administrative action moves a registration directly to `CONFIRMED`.

The need is real. Someone signs up in person at the meeting point, an organizer takes a name
by phone, an address bounces, or the mail provider is down on race morning. The backoffice
today manages registrations that already exist; it cannot create one.

This has to be split into two questions, because they have very different weight.

### 10.1 Creating the registration — low risk

An administrator creates a registration for a name and email, and it enters through exactly
the same path as any other:

- the same canonicalization and duplicate check;
- the same capacity transaction, so it lands on `PENDING_DECLARATION` when a place is free
  and `WAITLISTED` when it is not;
- the back of the queue, never ahead of it. Putting a manual entry in front of waiting
  participants is the leapfrog that `BR-REQ-034-03` forbids. Where the club genuinely
  intends to promote someone out of order, the existing exceptional-promotion mechanism with
  a recorded reason (`BR-REQ-035-05`) is the correct tool;
- `creation_source = STAFF` and the acting administrator recorded, audited like any other
  administrative action.

Nothing about capacity, queue order, or the declaration changes. This part could be added
without touching a business rule.

Note that a provider outage is largely already handled: the outbox commits with the
registration and retries, so a Mailgun failure delays messages rather than losing
registrations. The manual path exists for people who cannot use email, not for outages.

### 10.2 Completing it without the participant — the part that needs a decision

Creating the registration still leaves it at `PENDING_DECLARATION`. Three ways to finish it:

1. **Resend and let the participant sign.** Already supported. The right answer whenever the
   person has any working email address.
2. **Sign on the organizer's device at the event.** The participant opens their own scoped
   link on a phone or tablet held by the organizer and accepts it themselves. The evidence is
   identical to a normal acceptance because it is a normal acceptance. This is the
   recommended addition, and it needs no new rule beyond a convenient way to surface the link
   at the event.
3. **Record an offline acceptance.** A paper declaration is signed and an administrator
   records that fact. This is the only route that completes a registration without the
   participant touching the system, and it is the one that requires a decision.

If offline acceptance is adopted, it must never masquerade as a digital one. That means a
distinct `acceptance_method` of `DIGITAL` or `OFFLINE_WITNESSED`, with the witnessing staff
member, the time, and a reference to the paper record stored alongside the usual version and
content hash. Offline entries must be visibly marked in the backoffice, in exports, and in
any participant list, so an organizer can tell at a glance which entries have paper evidence
rather than a digital acceptance.

`BR-REQ-033-03` survives unchanged under this design: no staff action produces a digital
acceptance the participant did not make. What changes is that a second, clearly labelled
evidence type exists.

**This is a question for the club and whoever advises it on the declaration, not an
engineering choice.** It belongs on the `BUSINESS.md` §9 list: whether a paper declaration is
acceptable for the intended events, who may witness one, and how the paper is retained. If
the answer is no, options 1 and 2 still cover almost every real case.

### 10.3 Guardrail

Whatever is adopted, staff-created registrations and offline acceptances should be counted
and visible. A convenience path that quietly becomes the normal path is how the declaration
evidence chain erodes. If most entries for an event arrive this way, that is a signal about
the registration flow, not a reason to make the fallback easier.

## 11. Open proposal — multiple distances, bib numbers, and race results

Not yet decided. All three are currently on the deferred list in `BUSINESS.md` §8 as
"timing, results, bibs, check-in" and "public participant directory or list". Recorded on
2026-09-01 because the club wants them and because one of the three has to be decided
before Phase 3 regardless of when it ships.

These are three features with very different blast radius. They are treated separately.

### 11.1 Multiple distances in one race — decide before Phase 3

A race that offers 5 km, 10 km, and 21 km is one event to a visitor and three registration
domains to the system: separate capacity, separate free-place count, separate waiting list,
possibly separate declaration. The current model has one capacity per event.

Two ways to model it:

- **A. Parent race, child distance events.** A `race` groups several events that share name,
  date, place, and description. Each distance is an event in its own right, carrying its own
  distance, capacity, and declaration. The registration engine is untouched: capacity, holds,
  waiting list, and offers already work per event. The grouping is presentation plus one new
  rule. This is also exactly how schema.org expresses it, as a `SportsEvent` with
  `subEvent` entries.
- **B. Distances inside one event.** A `distance` entity under the event, with `distance_id`
  threaded through registrations, holds, the waiting list, the capacity query, structured
  data, bibs, and results. Larger blast radius for no additional capability.

**Recommendation: A.** One rule needs deciding with it: whether a person may register for
two distances of the same race. Almost certainly not, which means duplicate prevention for
child events applies at the race level rather than per child. That is a small change to
`BR-BUS-032` and `BR-REQ-032-03`.

This one cannot wait. Retrofitting a parent relationship after events, registrations, and
structured data exist is the expensive version. Deciding it now and shipping it in Phase 3
costs little; the parent is optional for events that have no siblings.

### 11.2 Bib numbers — after launch, with one V1 footprint

Assignment is straightforward: a number per confirmed registration, unique within the race,
in a range per distance, generated in a batch by an administrator close to race day rather
than at confirmation, so cancellations do not leave the sequence full of holes. Idempotent,
with manual override and an audit row. Output is a CSV or PDF for whoever prints the bibs.

The participant sees their number on the manage page and, if the club wants, receives it in
a message. That is a new message type and goes through `BR-BUS-080` when it arrives.

The V1 footprint is small: a nullable `bib_number` on registrations, so the first race can be
numbered without a migration on race week. Race-day check-in, meaning marking a bib as
collected, is a natural extension and can stay deferred until the club asks.

### 11.3 Results — after launch, with one V1 footprint that cannot be skipped

**Where results come from.** For a club this size, a spreadsheet: manual timing, or a timing
provider's export. So the mechanism is a CSV import keyed by bib, with per-row status
(finished, did not start, did not finish, disqualified), validated against confirmed
registrations, and published through the same Draft, In review, Published workflow as
editorial content, per distance. Corrections after publication are a republish, not an edit
in place.

Results pages are, incidentally, the most valuable pages the club will ever have for search
and for AI answers. "rezultate <race> 2027" is a query with exactly one right answer.

**The footprint that has to be in V1.** A results list is a public list of participants by
name. `BR-BUS-070` says participant data is never public, and that rule is correct. The way
through is consent at registration: a clearly worded option to appear in public results by
name, recorded with a version like the privacy acknowledgment, defaulting to whatever the club
and its adviser decide. Anyone who declines appears in results as an anonymous entry with
distance and time and no name.

That consent has to be collected from the first registration onward. If it is not, the first
race's participants never gave it and their results cannot be published. This is the one
item in this section that must be in V1 even though results publishing is not.

**What to keep out for now.** Age and gender categories require collecting birth year and
gender, which `BR-REQ-070-01` currently forbids and which are a privacy decision with a stated
purpose, not a feature toggle. Overall results per distance first; categories when and if the
club decides to collect what they need.

### 11.4 Suggested sequencing

| Item | When | Why |
| --- | --- | --- |
| Race parent with child distance events | V1, Phase 3 | Structural; expensive to retrofit |
| One-distance-per-race duplicate rule | V1, with the above | Small, belongs with it |
| Results consent at registration | V1, Phase 4 | Cannot be collected retroactively |
| `bib_number` column | V1, Phase 4 | Trivial now, awkward on race week |
| Bib batch assignment and export | V1.1 | Needed for the first race only |
| Results import and publishing | V1.1 | Needed after the first race only |
| Bib message, check-in, categories | Later, on request | Each needs its own decision |

Adopting this changes the V1 boundary and therefore touches every document in the
scope-change row of the matrix: `README.md`, `BUSINESS.md` §8, `SPECS.md` §3 and §6,
`AGENTS.md` §2, `SETUP.md` §29, and this file, plus `MANIFEST.txt`. It is the largest of the
open proposals and the one with a deadline.

## 12. Decided — priority 1 is the event page and event registration (2026-09-01)

Owner decision. Everything else is sequenced after it. The pull-request order in
`SETUP.md` §29 and the phases in `AGENTS.md` §26 will be rewritten once the remaining
priorities are confirmed; until then they stand, read in the light of this section.

### 12.1 What "ready" means

A real person registers for a real capped event on the production host, receives the
confirmation email, signs the declaration, is confirmed, and can unregister. A second person
registering when the event is full joins the waiting list and is offered the place when the
first cancels. An organizer can log in, create the event, and see who registered.

That is the exit criterion. Not a demo on QA.

### 12.2 Scope of priority 1

In:

- foundation: repository, Next.js, Material UI, i18n shell, database, migrations, `docs:check`;
- staff login and a minimal backoffice: create and edit an event, list registrations, see one registration's state and timeline;
- the public event page, localized, with the free-place count and structured data;
- the full registration lifecycle: submit with privacy acknowledgment, confirm email, hold, declaration, confirmed, unregister, waiting list, timed offer, expiry, restart;
- the outbox with the capture adapter from the first registration, and live Mailgun delivery before real use;
- the three legal documents loaded through the runbook, with placeholders during development;
- the structural footprints from §11 that are cheap now and expensive later: race parent for child distance events, results consent at registration, nullable `bib_number`;
- the production gate for exactly these pages, from `docs/PRACTICES.md` § Launch checklist.

Deliberately out, and sequenced later:

- articles, static pages, galleries, and the rest of the mini CMS;
- event announcements and participant notices (§9);
- resend, export, staff-created registrations (§10), exceptional promotion;
- runner profiles;
- bib assignment, results import and publishing (§11);
- multi-distance registration UI, although the data model supports it.

### 12.3 Hard external dependencies of priority 1

Priority 1 cannot be finished by writing code. It is blocked on:

- the domain, because Mailgun cannot verify a sending domain that does not exist, and live
  email is part of "ready";
- the approved declaration text, in both languages;
- the approved privacy notice, in both languages, because the registration form
  acknowledges it.

Request all three now. Build against placeholders in the meantime.

### 12.4 Relationship to the walking skeleton (§7)

Priority 1 as defined here is the walking skeleton, deepened until it is real. The §7
proposal is therefore adopted in substance: the first deployable slice is one event and one
registration end to end, and everything in 12.2 grows from it.

## 13. Decided — milestone order after M1 (2026-09-01)

Owner decision, ranked:

1. **M2 — Race features:** multi-distance UI, bibs, results.
2. **M3 — Announcements:** event updates with approval, notices to registered participants.
3. **M4 — Runner profiles.**
4. **M5 — Mini CMS:** articles, static pages, galleries.

Two placements were made by the maintainer rather than the owner and are reversible:
backoffice completeness (resend, export, staff-created registrations, exceptional promotion)
sits in M2 because bib printing needs the export and race day needs the manual path; and the
Author role becomes meaningful only in M5, since M1 to M4 have Editor and Admin managing
events.

The "V1" vocabulary was retired in favour of milestones. "V1" now means M1 where it still
appears in older sections of this file. `BUSINESS.md` §8, `SPECS.md` §3 and §6, `AGENTS.md`
§2 and §26, `SETUP.md` §29, and the README were rewritten as one set. Proposals §7, §9, §11
are adopted by this ordering; §8 and §10 remain open.

Baseline bumped to `BR-V1.6-2026-09-01`.

## 14. Decided — mobile-first (2026-09-02)

Owner decision. The phone is the design target; larger layouts derive from it. Previously
the documents assumed this in scattered places (a success condition, a deadline-readability
note, the performance targets) without stating it as a rule, which meant nothing enforced it.

`BUSINESS.md` BR-BUS-041 states the rule in plain language. `BR-REQ-041-01` makes it
testable: no horizontal scroll at 320 pixels, essential event facts in the first screen at
360 pixels, reachable primary actions and visible deadlines on the time-limited pages, correct
phone keyboards, 44-pixel targets in participant journeys, a phone-usable registration list
for race morning, and a mobile Playwright project on every registration journey.
`AGENTS.md` §18.5 carries the implementation rules, including the review rejection of
desktop-first components patched for small screens. `docs/PRACTICES.md` § Mobile-first is the guide.

Baseline bumped to `BR-V1.7-2026-09-02`.

## 15. Decided — repository location (2026-09-02)

The repository is `https://github.com/florinasavei/brasovrunners`, under the maintainer's
personal account, because the club has no GitHub organization yet. The maintainer clones
and pushes; the AI reviewer receives read access only.

This is a bus-factor exception to `BUSINESS.md` BR-BUS-101, which requires the club to own
the repository. It is accepted for now and closed by transferring the repository to a
club-owned organization before handover. GitHub preserves history and redirects the old URL
on transfer, so nothing in the documents needs to change except `SETUP.md` §4 and
`CODEOWNERS`.

Added for the first push: `.gitignore`, `.editorconfig`, `.gitattributes`, a minimal
`package.json` exposing only `docs:check`, a read-only `docs-check` workflow, and
`docs/RUNBOOKS.md` § Repository bootstrap. `CODEOWNERS` names the maintainer directly, with a
note not to require code-owner review while there is one maintainer.

Baseline bumped to `BR-V1.8-2026-09-02`.

## 16. Decided — simpler documentation structure (2026-09-02)

Owner request: fewer files and folders. Applied:

- the ten practice guides became one file, `docs/PRACTICES.md`, one section per guide with
  the same content and checklists;
- the three runbooks became `docs/RUNBOOKS.md`;
- the separate ADR directory was retired. Its single record, on agent-assisted development,
  is already §6.11 of this file. From now on this file is the only decision record; §25 of
  `AGENTS.md` says how to append to it.

The repository went from 31 files in seven directories to 18 files in three. Every reference
was rewritten to the new locations, `docs:check` validates them, and the README index rule
still holds.

Baseline bumped to `BR-V1.9-2026-09-02`.

## 17. Decided — everything is versioned by the baseline (2026-09-02)

Owner request: version everything, starting with the archive.

The baseline marker already versioned the documents; what was missing was a visible history,
a naming rule for artefacts, and a tag. `CHANGELOG.md` now carries one entry per baseline,
newest first, and `docs:check` fails if its top heading differs from the marker. Archives are
named `brasovrunners-<baseline>.zip`; an unnamed archive is not a release. On merge to
`main` the commit is tagged `baseline/<baseline>`. Application code, when it exists, gets
semantic versions and `v<semver>` tags, and each code release names the baseline it
implements. The policy is `README.md` § Versioning and `AGENTS.md` §1.6.

The changelog was backfilled from BR-V1.3 to now so the history is not lost at the moment
versioning starts.

Baseline bumped to `BR-V1.10-2026-09-02`.

## 18. Decided — visible version in every document; versioned filenames for distribution (2026-09-02)

Owner request: version the filenames and show the version inside the README.

The marker on line 1 is an HTML comment, invisible when a document is rendered, printed, or
pasted. Every root document and both consolidated documents now carry a visible baseline line
directly under their title, and `docs:check` requires it.

Filenames **inside** the repository deliberately stay stable. GitHub renders `README.md` by
that name; every link, `CODEOWNERS` line, and check keys on the current names; renaming per
version would break all of them on every bump and destroy file history in git. Filenames
**outside** the repository are versioned instead: `npm run release` builds
`dist/brasovrunners-<baseline>/`, `dist/brasovrunners-<baseline>.zip`, and
`dist/share/<NAME>-<baseline>.md` copies of each document for people who do not use git. The
script refuses to run when the check fails, so a release is always consistent.

Baseline bumped to `BR-V1.11-2026-09-02`.

## 19. Decided — local checks and CI are one command (2026-09-02)

Owner request: get the local development workflow running as the first slice of PR 1.

**The check was broken before it was extended.** `npm run docs:check` failed on a clean clone
on Windows with eight false failures, and `npm run release` refused to run behind it. The
cause was in `scripts/docs-check.mjs`: the README coverage check compared `path.relative`
output, which uses `\` on Windows, against Markdown link targets, which use `/`, so no file
outside the repository root ever matched. The same comparison made the `docs/history`
exclusion inert on Windows, meaning the requirement-ID scan covered different files locally
than in CI. Both are now normalized through one `repoPath` helper. This mattered more than a
platform annoyance: a pre-commit hook running a check that fails on the maintainer's own
machine would have blocked every commit.

Once the gate passed, `npm run release` ran for the first time and exposed a second defect of
the same shape: it handed `tar` an absolute `D:\...\dist\<name>.zip` while already running
with `cwd` set to `dist/`, and bsdtar read the drive letter as a remote `host:path`. The
archive was skipped, a warning was printed, and the script exited 0 — a release that
`README.md` § Versioning says is not a release. The archive name is now relative to `cwd`.
Both bugs were invisible to CI, which is Linux; nobody had run either command to completion
on the maintainer's machine.

**Hooks without a dependency.** The hook is a plain `.githooks/pre-commit` script installed
by `npm run setup`, which sets `core.hooksPath`. Husky was rejected. It is a runtime
dependency and an install-time side effect for something git does natively in one config
line, and `AGENTS.md` §1.5 ranks conventional patterns and less code above convenience.
`.githooks` is tracked, so the hook is reviewed like any other file, and `.gitattributes`
already normalizes it to LF so the shebang survives a Windows checkout.

**One command, not two.** The CI workflow previously ran `node scripts/docs-check.mjs`
directly. That is equivalent to `npm run check` only for as long as `check` contains nothing
else, and `SETUP.md` §8 plans to grow it to cover format, lint, typecheck, and tests. Both
now invoke `npm run check`, and the rule that they must is recorded in `AGENTS.md` §21 and
`SETUP.md` §8 rather than left as a coincidence.

**The requirement.** A local hook implemented no `BR-REQ-*`, which `README.md` § If you are
an AI agent forbids. Rather than create a requirement for tooling, BR-REQ-090-02 gained
acceptance criteria 6 and 7: a failing `npm run check` blocks the commit, and the hook and CI
invoke the same command. Release flow already owned "docs:check is a required check", so the
local half of the same guarantee belongs there and the rule stays in one place.

`BUSINESS.md` is unchanged apart from the baseline. BR-BUS-090 is about QA preceding
production in language the club reads; a git hook has no participant-visible or club-visible
behavior and would only dilute it.

**Not done here, deliberately.** The Node version is not pinned and no `.nvmrc` was added:
the owner is verifying the GoDaddy runtime first, so CI keeps `node-version: lts/*`. The
workflow still pins `actions/checkout@v4` and `actions/setup-node@v4`; both were checked
against the GitHub API on 2026-09-02, when the current releases were checkout v7.0.1 and
setup-node v7.0.0. v4 remains maintained, neither v7 changes anything used here, and bumping
majors belongs with the commit-SHA pinning already scheduled in `SETUP.md` §5. `package-lock.json`
was added because `README.md` § Local setup contract and BR-REQ-101-01 both begin with
`npm ci`, which fails without it.

**Publishing readiness.** The owner decided to make the repository public in order to get
branch protection, which GitHub Free provides on public repositories but not on private ones.
An audit ahead of that found the club's intended domain written out in full in `DECISIONS.md`
and twice in `docs/history/ORIGINAL_PLAN_2026-08.md`, while `DECISIONS.md` itself records that
the domain is not registered yet. Publishing would have announced an unowned `.ro` name, its
registrar, and its binding date; a `.ro` costs a few euro to squat, and the domain gates
Mailgun sending-domain verification, so losing it would block M1 rather than merely the
branding. All four occurrences now use `<domain>`, the placeholder `SETUP.md` §26 already
used.

The rule existed and was not enforced. `SETUP.md` §26 claimed to be the only place a hostname
appears, but `checkHostnameLiterals` only ever walked `src/`, which does not exist yet, so no
Markdown hostname could be caught — and `docs/history/` is excluded from the requirement scan
entirely. `docs:check` now fails on the club's own hostname in any file except `SETUP.md` §26,
scanning `docs/history/` too. It matches subdomains and any TLD, and excludes `.git` clone
URLs and the GoDaddy application names, which are not hostnames.

The first version of that guard was weak, and an adversarial review defeated it. Two failures
needed no trickery: the pattern lacked the `i` flag while DNS is case-insensitive, so a
camel-cased spelling passed — the likeliest way the leak actually recurs, given the repository
directory is itself camel-cased — and the scan inferred what gets published from an extension
allowlist, so five files that ship today, `.github/CODEOWNERS` and `.githooks/pre-commit`
among them, were never read. A silent 2 MB size cap, a UTF-16 file decoded as UTF-8, a
fullwidth dot that the WHATWG URL parser maps back to `.`, zero-width characters, percent and
source-code escapes, and a line wrap splitting the hostname each defeated it as well. The
structural fix was to stop inferring: the scan is driven by `git ls-files`, which already
knows exactly what publishing exposes, and matching runs over a normalized copy. A 23-case
bypass matrix now passes with no false positives. The lesson worth keeping is that a guard
which infers its own scope from extensions and size heuristics reports clean for the wrong
reason, and reads exactly like one that works.

§26's sentence was also
corrected: it claimed to be the only place *any* hostname appears, which was untrue —
`github.com` appears in four documents — and an overstated rule is one nobody trusts.

**Licence.** The owner chose MIT with copyright held by Brașov Runners, not by the maintainer.
`docs/RUNBOOKS.md` § Repository bootstrap makes this an explicit owner decision, and the MIT
file GitHub generated at `18a2e06` — deleted in the next commit but still reachable in history
— named the maintainer instead, which contradicts BR-BUS-101. Naming the club now matches the
ownership the documents have always asserted and the handover in `README.md` § Ownership.

**Tone before publication.** Four passages written for an internal audience read differently
under the club's own name. Three in `docs/PRACTICES.md` § Delivery framed adoption and
maintainer risk as predictions about the club's organizers; they now describe the same risks
as design and scheduling problems, and the ranking is unchanged because the analysis was
correct. The fourth, "the project will be heavily vibe-coded" in the retained original plan,
was the single most quotable line against a platform that will hold participants' names, email
addresses, and declaration acceptance evidence. It now reads as AI-assisted coding and carries
a superseded note pointing at the human-review requirement in `AGENTS.md` §1.5. The wording
changed; no risk, decision, or ranking was removed, and this paragraph records the edit so the
history document's traceability survives it.

**History rewrite.** Publishing exposes every commit, and the domain redaction above only
touched the working tree: `98f981b` and `0003d2a`, both already pushed, still contained the
hostname. A force-push would not have helped, because GitHub keeps unreachable commits
fetchable by SHA until it garbage-collects, which the owner cannot trigger — the orphaned
`c08e00f` from an earlier force-push was still retrievable through the API. The repository is
therefore being rebuilt: a parentless root carrying the redacted baseline, the whole PR 1
change set replayed onto it, and the GitHub repository deleted and recreated so no old object
survives. The repository had no pull requests, issues, tags, stars, forks, webhooks, or other
collaborators, so recreating it costs nothing. Commit identity moves to the club name and a
noreply address, removing two of the maintainer's real addresses from metadata permanently.

Deferred by the owner: registering the domain. Until that happens the name stays out of every
file by check, but nothing prevents it being typed into a GitHub issue or pull-request
description, which the check cannot see.

Baseline bumped to `BR-V1.12-2026-09-02`.


## 20. Decided — a weekend pilot on Vercel and Neon; GoDaddy reversed; a fast lane for application code (2026-09-02)

Owner request: the fastest and cheapest way to host this, built in one weekend of AI-assisted
coding, with the repository made "vibe-coding ready".

**The weekend cannot be M1.** A scope review against `SPECS.md` put the documented M1 at
180–260 focused hours plus weeks of wall-clock that belong to other people: the club approving
the declaration and privacy notice, and a registered domain with a verified sending address.
A weekend is 16–25 hours. Two of the five conditions in the M1 release gate are calendar items,
not code. The owner then chose to keep delaying the domain, which removes email and therefore
registration from the weekend entirely. What remains is real and worth shipping: Romanian event
pages, mobile-first, from the database, on a public URL, with the English translation left in
Draft so `/en` returns 404 as BR-REQ-040-02 already requires. `WEEKEND.md` holds that scope,
its build order, and every deferral with its reason; `CLAUDE.md` is the entry point an agent
reads cold. Both are root documents, indexed in `README.md`, and carry the visible baseline.

**GoDaddy is reversed.** Section 2 recorded GoDaddy Node.js Hosting as the preferred runtime
because its launch material promised a persistent Node process, GitHub deploys, and a Europe
region. All of that is true and the product is better than its reputation. It still cannot host
this stack. GoDaddy's own deploy contract limits outbound traffic to "HTTP (80), HTTPS (443),
and GoDaddy managed MySQL only" — Neon on port 5432 does not connect — and states "no
nodemailer, no external SMTP", which excludes Mailgun as specified. There is no free public
tier: free is two private, login-gated previews and zero published apps, and two published apps
need the Deluxe web-hosting plan at €15.99/month list. No scheduled-jobs feature is documented.
The Help Center still calls the product beta and contradicts the launch article on whether
previews expire. The earlier verification cited the launch blog and API reference; it did not
read the Help Center FAQ or the deploy contract, both GoDaddy's own, and those two documents
invalidate the choice. This is exactly the failure `AGENTS.md` §1.2 exists to prevent, and it
is recorded here so the next provider decision reads the boring pages too.

**Vercel Hobby, function region `fra1`, one project per environment.** Chosen by the owner
for deploy ergonomics after the alternatives were laid out from the vendors' own pricing pages
on 2026-09-02. Two facts are recorded because they will matter later. First, Vercel's fair-use
guidelines say "Hobby teams are restricted to non-commercial personal use only" and "Asking for
Donations fall under commercial usage"; a club site is a grey area, and if Vercel objects the
fallback is Render Free in Frankfurt, which runs the literal `npm start` contract and needs no
code change. Second, Vercel never runs `npm start` — it builds the app into serverless
functions — so BR-REQ-101-01's portability contract is no longer exercised by the host and must
be exercised by CI instead; `SETUP.md` §26 now says so. Hobby cron runs once a day with
hour-level jitter, which rules it out as the maintenance trigger when jobs arrive. Cloudflare
Workers was excluded because it is not Node: no `npm start`, no `PORT`, ten milliseconds of CPU
per request on the free plan, which MUI server rendering cannot meet.

**Neon Free, Frankfurt.** Unchanged provider, one new rule: the region is fixed at project
creation, so it is chosen once and correctly. Drizzle connects over `node-postgres` with a
`pg.Pool` on the pooled connection string, never `neon-http`, because the capacity transaction
needs interactive `BEGIN … SELECT … FOR UPDATE … COMMIT`, which the HTTP driver cannot express.

**Deferred providers keep their documentation but gain a direction.** Zitadel, Mailgun and R2
stay in `AGENTS.md` §3.1 because nothing that uses them is being built yet and rewriting ninety
mentions for a decision that is not being exercised is churn, not clarity. When each is built,
the research points elsewhere and the change-type matrix applies then: for three to five staff
who never self-register, Auth.js alone with a server-side allowlist and no external identity
provider (Zitadel's custom domain sits on its $100/month tier); Resend in the Ireland region
for email, free at this project's volume, with Mailgun as the EU-headquartered alternative;
images committed under `public/` until a non-developer needs to upload. None of this is a
decision yet. It is written down so it is not re-researched.

**The domain.** A `.ro` is registered through a ROTLD-accredited registrar; the owner intends
to transfer it to Cloudflare Registrar later if that TLD becomes available there. The
application never learns which registrar holds it. What the next slice needs is DNS access,
because the sending domain's verification records live there and sender reputation on a fresh
domain takes days. Registering early and sending later is the cheap order.

**The fast lane.** The six-document sync rule, the baseline bump, and the change-type matrix
exist so that a rule change is never a single-file edit. They were never meant to tax a code
change, but with no code in the repository the distinction had not been drawn. It is drawn now:
during the pilot, application code needs no baseline bump and no multi-document edit, only a
`CHANGELOG.md` line when something user-visible ships. A change to a documented rule still
follows the matrix in full. The trust-carrying rules in `AGENTS.md` §1.5 — capacity,
declaration, authorization, participant privacy, token handling, email canonicalization — are
not relaxed by a single word, and `CLAUDE.md` lists them where an agent will read them first.
`npm run check` keeps running before every commit; it guards requirement IDs, the club's
hostname, and the README index, none of which application source under `src/` touches.

**Two guard rails carried into the pilot on purpose.** The `events.capacity` column exists but
a database `CHECK` refuses any non-null value, so an administrator cannot cap an event before
the locked capacity transaction and its twenty-way concurrency test exist. And Next 16, MUI 9,
next-intl 4 and Drizzle 0.45 are all newer than any model's training, so `WEEKEND.md` step 0 is
to verify each integration against current documentation before installing it. An attempt to
pre-verify them for this baseline was cut short by a session limit; the instruction stands on
its own.

Baseline stays `BR-V1.12-2026-09-02`: this change set belongs to the same, still unmerged pull
request as §19, and one pull request carries one baseline.

## 21. Done — the scaffold runs (2026-09-02)

`WEEKEND.md` step 1, built on `feature/pilot-event-pages`. Nothing here overrides a rule; it
records what was verified rather than assumed, because four of these libraries are newer than
any model's training data and three of the four differ from what a model would have written.

Versions were read from the npm registry and every integration from the library's own current
documentation before installing: Next 16.3.4, React 19.2.8, MUI 9.4.0, next-intl 4.14.2,
Zod 4.5.4, all pinned exactly.

Four things that would have been wrong from memory:

- **`middleware.ts` is `proxy.ts` in Next 16.** The named export is `proxy`, and the runtime is
  Node.js only — the edge runtime is not supported there. `src/proxy.ts` holds the next-intl
  middleware.
- **The MUI App Router provider is version-suffixed.** `@mui/material-nextjs` ships
  `v13-appRouter` through `v16-appRouter` side by side; the installed package must be imported
  at the subpath matching the Next major, so `v16-appRouter`. Guessing the wrong one compiles
  and then misbehaves.
- **`component={Link}` cannot be written in a Server Component.** Passing a component across
  the boundary fails at prerender with "Functions cannot be passed directly to Client
  Components". The build caught it. `src/components/ButtonLink.tsx` is a client component that
  keeps both halves on the same side; that is the reason it exists.
- **`create-next-app` defaults to Tailwind**, which `AGENTS.md` §3.2 forbids. `--no-tailwind`
  is required, and the generated `globals.css` was deleted because `CssBaseline` owns the reset.

Behaviour verified against a running production server rather than inferred from the build:
`npm start` honours `PORT`; `/` redirects to `/ro`; `/ro` and `/en` prerender; `/en` serves
English rather than falling back to Romanian; `/de` redirects to a path that 404s rather than
serving Romanian content, which is BR-REQ-040-02; and Romanian diacritics render, which is why
the Roboto subset list includes `latin-ext`.

`npm run check` grew from `docs:check` alone to `docs:check && typecheck && lint`. That is the
aggregate gate `SETUP.md` §8 describes, and because the pre-commit hook and CI both invoke that
one command, both grew with it and neither needed editing.

One check was too strict and is now correct: `docs:check` required a README index row for every
file on disk, which failed the moment a build produced `tsconfig.tsbuildinfo`. It now excludes
files git ignores, since those are never published. Application source under `src/` was already
outside the index rule.

The palette in `src/theme/theme.ts` is a placeholder. Final branding is an owner decision
(`AGENTS.md` §29); it is deliberately not the MUI default blue so nobody mistakes it for one.

Baseline bumped to `BR-V1.13-2026-09-02`.

## 22. Decided — Yarn 4, a pinned Node, and a test database that needs nothing (2026-09-03)

Three toolchain decisions, taken together because they interact.

**Yarn 4.18.0 replaces npm.** The owner's other project runs Yarn 4 with Corepack, a pinned
Node, and exact dependency pins, and the same reasoning that put Material UI in this project
applies to the package manager: one set of habits across both repositories. `.yarnrc.yml`
carries `defaultSemverRangePrefix: ''`, so an added dependency is pinned exactly by default
rather than by remembering a flag — which is what `AGENTS.md` §1.2 asks for and what a range
quietly undermines on the next install. `nodeLinker: node-modules` keeps a real tree, since
Plug'n'Play buys nothing here and costs tooling compatibility. This is a change to a documented
rule (`AGENTS.md` §3.1 said npm), so it carries the full change set.

Yarn earned its place within the hour. Its stricter peer-dependency resolution surfaced a
conflict npm had silently hoisted past: `typescript-eslint`, pulled in by `eslint-config-next`,
does not support TypeScript 7 and requests `>=4.8.4 <6.1.0`. The other project runs TypeScript
7.0.2 successfully because it uses Vite and its own ESLint setup. Here, TypeScript 7 typechecks
and builds but makes `yarn lint` fail outright — and lint is part of `check`, so a broken linter
is not a trade worth making. TypeScript stays at **5.9.3**, which is a deliberate deviation from
the other project rather than an oversight, and it should be revisited when typescript-eslint
ships TS 7 support.

**Node is pinned to 22.14.0**, matching that project and the machine this was built on.
`.nvmrc` and `engines.node` agree, and CI reads `.nvmrc` instead of `lts/*`, so the runtime
stops drifting under the build. `SETUP.md` §29's note about pinning to a verified host runtime
is satisfied: Vercel supports Node 22.

**The test database is PGlite, and that choice has a boundary that must not be crossed.**
`AGENTS.md` §20.3 requires integration tests against real PostgreSQL. PGlite is real
PostgreSQL compiled to WebAssembly running in the test process, so constraints, enums,
transactions and MVCC behave as they do in production, and the same migrations apply. It was
chosen over `pg-mem`, which emulates PostgreSQL in JavaScript and treats `SELECT ... FOR
UPDATE` as a no-op — the exact failure mode that would let a capacity test pass while
production overbooks. The result is a suite that needs no database, no Docker and no
configuration, which for a weekend project is the difference between tests existing and not.

The boundary: PGlite is single-connection and cannot express two transactions racing. Every
concurrency requirement — BR-REQ-034-02's twenty simultaneous confirmations against one free
place, BR-REQ-034-03, parallel waiting-list promotion — must run against a real PostgreSQL
server. Writing those against PGlite yields a green suite and an overbooked event. When the
capacity work starts, Docker or Testcontainers is added *alongside* this harness, not instead
of it. This is recorded in `tests/helpers/db.ts` and `docs/DEVELOPMENT.md` as well, because a
rule that lives only in a decision log is a rule someone will miss.

**The capacity guard rail is now a database constraint**, not an intention.
`events.capacity` exists with the full M1 column set but a `CHECK` refuses any non-null value,
and tests assert that refusal at insert and at update. Deferring the capacity engine is only
safe while the system is physically incapable of storing a capacity; removing that constraint
is the last step of building the locked transaction, never the first.

Two smaller things worth recording because they cost time. Drizzle wraps driver errors, so a
test asserting `.rejects.toThrow(/constraint_name/)` passes for any failure at all, including a
typo in the query — the constraint name is on `error.cause`. `tests/helpers/constraints.ts`
checks the SQLSTATE code and the constraint name instead, and writing it exposed a test of mine
that was asserting the wrong constraint entirely. And `tsconfig.json` excluded only
`node_modules`, so `yarn typecheck` walked the `dist/` release output and failed on a stale
pre-restructure copy of `src`; `dist` and `coverage` are excluded now, but `.next` deliberately
is not, since `include` pulls Next's generated route types from there.

Baseline bumped with the same change set; `WEEKEND.md` steps 1 to 3 are done.

## 23. Done — public event pages, and a field the specs required but the model lacked (2026-09-03)

`WEEKEND.md` steps 4 and 5. The pilot's visible half now exists: a Romanian event list and
detail page, structured data, a sitemap and a robots policy.

**Localized pathnames, not just a locale prefix.** `AGENTS.md` §9.2 maps `/events` to
`/ro/evenimente` and `/en/events`. That needs next-intl's `pathnames`, where the folder under
`src/app/[locale]/` is the internal route and each locale gets its own external path. Building
these URLs by hand is what produces an `hreflang` pointing at a page that does not exist, so
the navigation helpers are the only sanctioned way to construct one.

**A specification that no field could satisfy.** BR-REQ-041-01 criterion 2 and BR-REQ-070-03
criterion 2 both require an event page to show *cost* as text. `AGENTS.md` §12.3 and §12.4
defined no column for it — the requirement had been written and accepted with nothing to store
the value. `event_translations.cost_text` closes that: free text, per locale, because "Gratuit"
and "Free" are wording rather than a number, and nullable because null must mean "the club has
not said" rather than "free". Assuming free on the club's behalf would be exactly the invention
`AGENTS.md` §1.2 forbids, and it would be wrong the first time a race charges an entry fee.

**Structured data that stops short of the requirement, on purpose.** BR-REQ-052-02 criterion 1
asks for the club's logo and `sameAs` entries for its official profiles. Neither exists —
BUSINESS.md §9 still lists the club's public identity as an owner decision. A plausible-looking
Facebook URL would actively misinform search engines, so the block ships without them and the
requirement is recorded as not yet met. Criterion 3, `remainingAttendeeCapacity`, is absent for
the same reason it must be: it has to equal the free-place count shown on the page, the pilot
has no capped events, and the database refuses a capacity at all.

**The hostname rule gained its first exception.** `docs:check` flagged `https://schema.org` in
the JSON-LD as a leaked hostname. It is not one: a vocabulary namespace is an identifier fixed
by a published standard, identical in every environment, and deriving it from `APP_BASE_URL`
would emit a context no consumer understands. The check now allows exactly two such namespaces
and still rejects everything else — verified with a negative test that a provider URL is caught.
`AGENTS.md` §8 states the exception and its limit: never a provider, a CDN, or anything the
club could plausibly host.

**Rendering strategy.** The event pages and the sitemap read the database, so they render per
request rather than at build. Two reasons, and the second is the load-bearing one: organizers
publish and cancel events between deploys, so a build-time snapshot would show a cancelled run
as scheduled; and keeping the database out of the build is what lets CI build without one. The
connection is now established on first use rather than at module import, which is what made
that possible — an eager pool failed `yarn build` on any machine without a database.

**Local PostgreSQL.** `docker-compose.yml` per `SETUP.md` §9, pinned to a specific Postgres
patch so every machine runs the same server. The test suite deliberately does not use it and
still needs nothing installed.

Two mistakes worth recording because both were already written down as traps. `component={Link}`
in a Server Component fails with "Functions cannot be passed directly to Client Components" —
`docs/DEVELOPMENT.md` warns about it, and it still cost a 500 on the list page until a
`CardLink` client boundary was added. And `formatDistance` returned a string built with
`toFixed`, which would have rendered "14.5 km" to Romanian readers, where the separator is a
comma; distances now go through next-intl's number formatter, which is what BR-REQ-040-03 asks
for. Neither was caught by types or by tests — both were caught by looking at the running page.

Baseline bumped to `BR-V1.14-2026-09-03`.

## 24. Decided — Auth.js alone for staff, no external identity provider (2026-09-04)

Two documents disagreed, and the disagreement was encoded in a column name. `AGENTS.md` §13.1
said "use the Auth.js Zitadel provider" and §12.1 called the column `zitadel_subject`, while
`CLAUDE.md` and `WEEKEND.md` both recorded the direction as Auth.js alone with a server-side
allowlist and no external IdP. Nothing had been built either way, so this was the last cheap
moment to settle it: a column rename after rows exist is a migration nobody wants to write, and
the name is what every later reader would have believed.

**Decided: Auth.js alone. The `staff_users` table is the allowlist, and the column is
`auth_subject`.** `AGENTS.md` §13.1 and §12.1 are corrected accordingly, along with the provider
tables in §3.1, §7.1 and §7.2, `SETUP.md` §15, and the environment lists.

The reasoning, in the order it mattered:

- **Scale.** Zitadel is an identity platform. The club has, at most, a handful of staff
  accounts, and it would be operating that platform — instances, projects, applications,
  callback registrations per environment — for them. `AGENTS.md` §1.3 forbids exactly this kind
  of structure without a population.
- **Cost and ownership.** A custom domain on Zitadel sits on its paid tier (recorded in §20),
  and every provider added is another account the club must own, pay for and recover
  (`AGENTS.md` §24). The identity of five volunteers does not justify it.
- **The provider was verified before it was dropped, not instead.** Auth.js does ship a Zitadel
  provider — `@auth/core/providers/zitadel`, with `AUTH_ZITADEL_ID` and `AUTH_ZITADEL_SECRET` —
  so this is a decision about what the club should run, not a discovery that the documented path
  was impossible.
- **Nothing about the boundary changes.** Participants still never receive accounts or passwords
  (§10.3), the three roles are unchanged, and the server helpers are the ones §13.1 already
  named: `getCurrentStaffUser`, `requireStaff`, `requireStaffRole`.

**What was built, and what deliberately was not.** The table, the roles, the helpers, staff
administration and the development switcher exist. The sign-in method does not, and that is the
uncomfortable half of this decision: the method that suits volunteers with no passwords is an
emailed link, and delivery to a real person needs the club's sending domain — the same blocker
registration waits on. So `STAFF_AUTH_MODE` is `dev-switcher` in local and test and `disabled`
everywhere else, where every staff request is answered by nobody and the backoffice returns 404.
**The backoffice is therefore usable on a developer's machine and unusable on production until
the domain exists.** Recorded plainly rather than papered over: the organizer story is complete
except for the door.

The switcher itself is guarded twice, because a development-only feature that reaches production
is how a backoffice loses its lock: the process refuses to start with that mode outside local
and test, and every function it exposes refuses again when it is called.

**The invitation model that fell out of it.** With no external directory to consult, the table
*is* the directory: an Administrator adds a colleague by email address and role, the row waits,
and the first sign-in from that address binds the provider's subject to it. So `auth_subject` is
nullable, `email` is unique and lowercased, and two checks hold the shape — an address that is
not lowercase is refused, and a sign-in timestamp without a subject is refused. No row, no
access, whatever any provider asserts. An Administrator cannot change their own role, remove
their own access, or leave the club with no Administrator at all; those three refusals are the
difference between a mistake and a locked-out club.

## 25. Decided — the event half of the CMS, built during M1 rather than M5 (2026-09-04)

`SPECS.md` §3 puts the mini CMS in M5, and `WEEKEND.md` defers it explicitly. It was built now
anyway, and the reordering is recorded here rather than hidden by relabelling the requirements:
BR-REQ-050-01, BR-REQ-051-01 and BR-REQ-051-02 keep `Release: M5` and gained a **Status** line
naming the part that exists.

**Why it could not wait.** Until this shipped, changing an event meant editing
`src/db/seeds/pilot.ts` and re-running the seed — a developer, a laptop and a deploy for a
sentence about a start time. The site exists so people can find the club's next race, and the
club could not correct that race without a programmer. Everything else left in M1 is blocked on
the domain or on approved legal text; this was blocked on nothing.

**What shipped:** both of an event's times, its map link, the featured flag, and every editorial
field on `event_translations` per locale, with DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED, a
staff-only preview, and optimistic concurrency.

**What did not, and why the boundary is exactly there:** no articles, static pages, galleries or
media library, and **no rich text**. §11.3 makes the canonical body validated Tiptap JSON with an
allowlisted schema, and a body editor built without that contract is the arbitrary-HTML problem
the rule exists to prevent. Legal documents have no editor screen in any form (§11.1), and the
backoffice says so in place of one.

**Three decisions inside it worth keeping.**

*The featured flag is a database constraint, not a convention.* A partial unique index over
`featured` refuses a second featured row, in the same spirit as the pilot capacity guard.
Application code that remembers to clear the previous flag is a race between two organizers, not
a rule. Setting a new one clears the old inside a single transaction, so there is never an
instant with two, and never a clear that survives a failed set.

*The map link is stored, never assembled.* §8 forbids a hostname literal anywhere under `src/`
and exempts no provider, so the application cannot build a maps URL from the latitude and
longitude it already holds, nor allowlist a map host — `yarn docs:check` fails on the literal
either way. The organizer pastes the link they already share. https is required at the form and
again by a check constraint, so a `javascript:` URL cannot be stored by a seed or a hand-written
`UPDATE` either, and the link renders with `rel="noopener noreferrer"`. The coordinates stay
where they are and are not a substitute: they are a point, not the named place a club shares
before a run.

*A second time, without touching the first.* `starts_at` keeps its meaning exactly — when the
event begins — because the ordering, the upcoming/past cut-off, the sitemap and the listing all
read it, and redefining it would have moved every one of those. `race_starts_at` is the gun
time, constrained to fall inside the event, and the page shows one time or two, each labelled.
In the JSON-LD, `startDate` is the race start and `doorTime` is the event start: a search result
showing the gathering time as the start is how somebody misses a race. The two times are
converted in the event's own timezone, twice — a single pass uses the offset of the wrong
instant, which is wrong by an hour on exactly the two Sundays a year the clocks change, and one
of those is the last Sunday in March.

**The concurrency rule got the test it actually needs.** BR-REQ-051-01 criterion 5 says a stale
save is a conflict. Proving that requires two connections racing, and PGlite — the in-process
PostgreSQL the rest of the suite runs on — has one. `tests/concurrency/` therefore runs against a
real server through `yarn test:concurrency`, with its own Vitest configuration, excluded from
`yarn check` for the same reason the end-to-end suite is: that gate has to work on a machine with
no database. It fails loudly rather than skipping when `DATABASE_URL` is unset, because a
concurrency suite that quietly passes with nothing connected is worse than no suite at all. The
test holds one transaction open, watches the second organizer's save block on the row lock,
commits the first, and asserts the second comes back as a conflict with the first save intact.

**A cycle the schema created, and the file that broke it.** `events` needs `staff_users` for its
attribution columns; `staff_users` needed the `locale` enum, which lived in `events`. Drizzle
loads schema modules eagerly, so that is not a style problem — it is
`Cannot access 'locale' before initialization` at migration time. The enum now lives in
`src/db/schema/locale.ts`, which imports nothing.

Baseline bumped to `BR-V1.15-2026-09-04`.

## 26. Decided — staff sign-in is Auth.js with the Zitadel provider, superseding §24 (2026-09-04)

§24 decided "Auth.js alone, no external identity provider," and corrected `AGENTS.md` §13.1
and §12.1, the provider tables in §3.1/§7.1/§7.2, `SETUP.md` §15 and the environment lists to
say so. Nothing built against that decision ever ran anywhere but a developer's own machine:
`staff_users.auth_subject` never held a row with a subject, because the sign-in method §24
itself deferred — the emailed link — was never built either. This section reverses §24, and it
is a correction of an unshipped plan, not a migration of live identities. The same six
documents §24 touched are corrected again, back the other way, in the same pull request as
this entry.

**Decided: Auth.js with the Zitadel OAuth provider.** `staff_users` stays exactly what §24 made
it — the server-side allowlist — and the boundary is unchanged: an unknown Zitadel account is
refused before a session is ever issued, the same as an uninvited address was refused under the
switcher. The column is `zitadel_subject` again; the rename is a real migration
(`0007_drop_staff_auth_subject.sql`, `0008_add_staff_zitadel_subject.sql`) because migrations
after `0004` are shipped and column renames are not silently rewritten, even when — as here —
the column being renamed has never held a production row. A local database that had used the
development switcher keeps its `staff_users` rows; the migration only clears the now-orphaned
`first_signed_in_at` on any row whose subject did not survive the rename, so those identities
simply bind again on next sign-in rather than violating the table's own "a subject and a
sign-in arrive together" check. `ensureDevStaffUser` needed the same fix `resolveZitadelSignIn`
already has: an insert guarded only by `ON CONFLICT (zitadel_subject)` cannot see a row that
already claims the identity's address with no subject yet — exactly the shape that rename just
produced — so it now looks up by subject, then by email, and binds rather than inserting when
it finds the row by email. The end-to-end suite caught this the same afternoon it was written.

The reasoning, in the order it matters now:

- **Passwordless sign-in no longer waits on the sending domain.** §24's blocker was structural:
  the only method AGENTS.md §13.1 considered for volunteers with no passwords was an emailed
  link, and delivery needs the club's domain — the same blocker registration itself waits on.
  Zitadel's login policy offers both password and passwordless (passkey/magic-link-style)
  sign-in configured entirely on Zitadel's side, so the backoffice can have a real door before
  the domain exists at all.
- **Standing up the identity provider is an account-creation task, not application work.** §24
  weighed "operating an identity platform for a handful of volunteers" against the club's
  actual population and found it disproportionate. That calculus does not change; what changes
  is who does the operating. A Zitadel tenant is configured once, by the owner, the same way
  Neon and Vercel projects are — it is not code this repository runs, maintains, or scales.
  `AGENTS.md` §1.3's warning against structure without a population is about engineering
  effort inside this codebase, and this decision adds none: the provider table in §3.1 grows by
  one row, not by a subsystem.
- **Nothing about the boundary or the helpers moves.** Participants still never receive
  accounts or passwords (§10.3), the three roles are unchanged, and `getCurrentStaffUser`,
  `requireStaff`, `requireStaffRole` are the same functions, now with a second branch (session
  strategy JWT, no adapter, no `accounts`/`sessions` tables) alongside the switcher's cookie
  branch. `staff_users` is still the only persisted identity state this application owns.

**What §24 got right and this section keeps.** The invitation model — an Administrator adds a
colleague by email and role, the row waits, first sign-in binds the subject — needed no change
at all: it was never really about which provider issues the subject, only about `staff_users`
being the thing that grants access regardless of what any provider asserts. The three
self-protection refusals (no changing your own role, no removing your own access, no leaving
the club with no Administrator) and the double-guarded development switcher are untouched.

**Verified before written, not discovered by trying.** `next-auth@5.0.0-beta.32` ships
`next-auth/providers/zitadel`; `AUTH_ZITADEL_ID`, `AUTH_ZITADEL_SECRET` and (by Auth.js's
environment-variable inference) `AUTH_ZITADEL_ISSUER` are its configuration, alongside
`AUTH_SECRET` for the JWT session itself — checked against Auth.js's current documentation
before `src/auth.ts` was written, the same discipline §24 applied when it verified the provider
existed before dropping it.

`STAFF_AUTH_MODE` gains a third value, `provider` — named for the mechanism rather than the
vendor, matching `EMAIL_DELIVERY_MODE`'s own style, so a future change to what Zitadel's login
policy offers is a Zitadel console change, not an environment-variable rename. `dev-switcher`
is unchanged; `disabled` remains the safe default until an operator explicitly turns `provider`
on for an environment.

## 27. Decided — legal document versioning ships now; no placeholder ever reaches qa or production (2026-09-04)

`AGENTS.md` §12.5's versioning machinery, `legal_documents` and `legal_document_translations`,
is built in this same change set as registration itself, ahead of the club approving real
privacy-notice, terms or declaration wording. Building the machinery early is safe; the
question this section settles is what a database with no approved text yet should do, in every
environment that is not a developer's own machine.

**Decided: a clearly marked `PLACEHOLDER` version is seeded in local and test only.**
`seedPlaceholderLegalDocuments` (`src/db/seeds/legal-placeholder.ts`) refuses to run — throws,
does not silently skip — when `APP_ENV` is anything but `local` or `test`, and `pilot.ts` never
calls it for any other environment either. This is the same double-guard shape as the
development staff switcher: refused at the call site, and refused again inside the function
itself if some future caller forgets the first refusal.

The reasoning:

- **`AGENTS.md` §1.2 forbids inventing legal text that could reach a real person.** A
  placeholder is invented text by construction — it says so in both languages, in the body
  itself — so the only safe environments for it are the ones no real participant's browser ever
  reaches.
- **Registration's own refusal is the correctness guarantee; the seed guard is defense in
  depth.** `submitRegistration` calls `findCurrentApprovedDocument` and refuses with
  `VALIDATION_ERROR` when it finds nothing (BR-REQ-053-01's acceptance criteria). That is what
  actually stops a qa or production registration from proceeding with no approved privacy
  notice — a property of the data, true regardless of what any seed script does. The seed guard
  exists so the *invented* text specifically can never exist outside local and test, which is a
  stronger and separate promise than "registration merely refuses when nothing is approved."
- **The real approved versions are a migration, not a seed.** When the club approves Romanian
  and English wording, whoever writes that migration is a person accountable for the words —
  `docs/RUNBOOKS.md` § Legal document version is the procedure. `pilot.ts` and its placeholder
  are exactly the seed data WEEKEND.md already called out as needing replacement before
  anything reaches a real participant; this is the same rule extended to legal text.

Baseline bumped to `BR-V1.16-2026-09-04`.

## 28. Decided — publication is one state per event, superseding the per-locale rule of §25 (2026-09-04)

`AGENTS.md` §11.2 said "publishing per locale", and `event_translations.editorial_status` was
where it lived: Romanian could be PUBLISHED while English was still a draft, and BR-REQ-040-02
existed partly to describe what the public site must do in that state. That is reversed here.
**An event is published or it is not, and both languages go live together.**

**Why.** The per-locale rule solved a problem the club does not have. It exists for an editorial
team large enough that one language's translation lags the other's by weeks — a newsroom, not a
running club with three volunteers. What it actually produced was a race advertised in Romanian
whose English page 404'd, which reads to an English-speaking visitor as a broken site rather than
as unfinished content, and which nobody notices because the person who published Romanian was
looking at the Romanian page. Publishing both together turns "the English half is missing" from a
state the site has to survive into a thing the interface refuses to let you do.

**What changed.**

- `editorial_status` and `published_at` moved from `event_translations` to `events`, in migration
  `0011`. `event_translations.version` stayed: a save of one language's text is still guarded on
  its own row, and `events.version` was added so an event-level save or transition is guarded the
  same way.
- Reaching PUBLISHED requires a complete translation in **every** locale — every field a public
  page renders, present in each (`fields.ts` `REQUIRED_PUBLIC_TRANSLATION_FIELDS`: title, slug,
  meeting point, description). The transition refuses otherwise and names the language and the
  fields.
- The database asserts the two halves it can state honestly: a PUBLISHED event has a
  `published_at`, and a translation's required fields are non-blank rather than merely NOT NULL.
  The set-level rule cannot be a CHECK — it reads rows in another table — so it lives in
  `transitionEvent` and has its own tests.
- BR-REQ-040-02 was rewritten rather than left to be read the old way. The rule it protects is
  unchanged and is now stronger: an unpublished event 404s in both languages, and a language with
  no translation 404s in that language, but never by serving the other language's text.

**What happened to rows already in the half-published state.** The migration carries the state up
to the event and takes the conservative reading: an event becomes PUBLISHED only if it has a
translation in each locale, all of them PUBLISHED, and a first-publication date to record.
Anything else becomes a DRAFT — including an event that was live in Romanian only. That
unpublishes a page somebody could read this morning, and that is the intended answer: the
alternative is a Romanian event quietly beginning to serve an English stub, which is exactly what
BR-REQ-040-02 forbids. `published_at` is carried across regardless of the resulting status,
because slug stability keys on it and it is never cleared. In practice the blast radius was nil:
QA's seed publishes both languages for every event.

**Full CRUD came with it, and it is the larger half of the change.** §25 built an editor over
three fields and left `src/db/seeds/pilot.ts` as the only way to set the rest. Now every column
of `events` an organizer owns is editable through the backoffice — kind, event status, both times
and the timezone, the end time, the coordinates, the map link, distance, climb, the featured flag,
and the whole registration block including the capacity, the window and the approved declaration
version an internal event points at — and there is a create form, a duplicate, an archive and a
delete.

Three decisions inside that worth keeping:

*A new event needs both languages before it exists.* The create form asks for a title, a page
address, a meeting point and a description in each. A form that let one language be skipped would
produce an event that cannot be published, and nobody would remember why.

*A duplicate copies the configuration and none of the standing.* Not the publication, not the
first-publication date, not the featured flag, and not the slugs — the copy takes the first free
`-2`, `-3` suffix in each language, asked of the database rather than assumed, because
`UNIQUE(locale, slug)` would otherwise reject the whole copy. A copy that led the landing page the
moment it was made is not a starting point, it is an incident.

*Deleting is the Administrator's, and is refused for an event anybody has registered for.*
Archiving is what an event that happened gets; deletion is for a row that should not exist —
a duplicate, a mistake made five minutes ago. A registration carries the privacy-notice version
its participant acknowledged and, once signed, the declaration they accepted; cascading those away
to tidy up is destroying the evidence §10.8 exists to keep.

Baseline bumped to `BR-V1.17-2026-09-04`.

## 29. Decided — sample legal documents everywhere but production, superseding §27 (2026-09-04)

§27 seeded a clearly marked two-sentence `PLACEHOLDER` version of each legal document in local
and test only, and refused every other environment outright. This narrows that rule rather than
widening it in spirit: **sample text is permitted in every environment except production, and
production is refused hard.**

**Why the old rule was wrong at the edge.** Registration correctly refuses when no approved
privacy notice exists (BR-REQ-053-01), and QA had none. So the whole participant journey — the
thing QA exists to let a colleague look at — was unreachable there, and the only way to see it was
a developer's laptop. §27's reasoning was that invented legal text must never reach a real
person's browser; QA is a system no real participant reaches, on a hostname nobody has been given.
The line that matters is production, and it was drawn one environment too early.

**Why production is different in kind, not in degree.** Everywhere else, sample text is a draft
somebody is reviewing on a system nobody has entered a race on. In production it would be the
wording a real person is told they have agreed to: text that says of itself that it has no legal
effect, presented as the notice under which their data is processed. There is no configuration
that makes that acceptable. `assertSampleLegalDocumentsAllowed` throws rather than skipping
quietly — a seed that silently did nothing is indistinguishable from one that worked, and the
difference matters on exactly one deployment — and the refusal has its own test.

**What the samples are.** Three documents, `PRIVACY_NOTICE`, `TERMS` and `EVENT_DECLARATION`, in
Romanian and English, each language written as its own complete text rather than translated
sentence by sentence, and both marked as drafts awaiting one named reviewer. Two properties carry
the whole thing:

*Complete in structure, blank in substance.* Every section such a document normally carries is
present; every club-specific fact is an `<ANGLE BRACKET>` placeholder rather than a plausible
invention — the controller's legal name, address and contact, any representative, each retention
period, the lawful basis for each purpose, the governing law. AGENTS.md §1.2 forbids inventing
legal wording, and a well-formed invention is far more dangerous than a visible gap: a lawyer
edits a concrete draft in an afternoon and never notices a fabricated retention period. The point
is that the club faces a draft rather than a blank page, and that nobody can mistake the draft for
the real thing.

*The banner is in the rendered body, in both languages.* Not a code comment, not a column nobody
renders: the first section of each document, on the public page, says that this is sample text,
not approved by the club, not legal advice, and that it must be replaced before any real
participant registers. The person who most needs to know is whoever opens the page.

The privacy notice describes what this application actually does, read from the schema rather than
guessed: the name, address and language a participant gives; the normalized and canonical forms of
the address and why they exist; the consent for a name in results and the notice version it was
given under; the lifecycle and every timestamp it records; the declaration acceptance and its
hash; the transactional messages. The processors are named by role — database host, application
host, email provider, staff identity provider — as `<PROVIDER>` placeholders. It says plainly that
no medical information, emergency contact or data about minors is kept, because §12.13 has no
tables for any.

**The seed is version-aware rather than destructive.** Unlike the event seed, it never deletes:
a version an acceptance references is immutable (§12.5), and QA will have acceptances against
these rows. Re-running with unchanged text does nothing; re-running after the text changes inserts
the next version, which is what a correction is.

Baseline bumped to `BR-V1.17-2026-09-04`.

## 30. Decided — a registration kind, so the queue can be exercised without ten mailboxes (2026-09-04)

The waiting list is the part of the registration lifecycle nobody sees until it is too late to
find a mistake in it. Exercising it by hand needs a capacity's worth of real inboxes, which nobody
has, so in practice it was exercised only by tests.

**Decided: `registrations.kind`, a database enum, `REAL` by default and `TEST`.** Not a "test
user" account type — participants have no accounts at all by design (§10.3) — and not a fourth
staff role. It is a property of the registration.

**The rule that gives it its point: a test registration is a real registration in every way that
affects the queue.** It goes through `modules/registrations/service.ts` like any other, occupies a
place, expires on the same hold deadlines, and is promoted from the waiting list by the same
allocator. `kind` appears in no condition inside the allocator or the capacity formula — that is
the whole of it, and `tests/integration/registrations/test-kind.test.ts` asserts it by running the
same scenario as each kind and comparing the transitions. A demonstration that behaved differently
from the real thing would be worse than no demonstration: it would be a rehearsal of a system
nobody ships.

**The export omits them; every screen labels them.** Both were possible; the reasoning for the
split is that context travels differently. Inside the backoffice, a chip sits next to the row and
the person reading it is looking at this application. An export is a file that leaves: it is
opened in a spreadsheet, sorted, filtered, and printed at a start line by a volunteer who never saw
that screen, and a column they filtered away an hour ago is not a warning. A row that is not there
cannot be miscounted.

**It cannot exist in production, guarded twice** — in `test-registrations.ts` at the feature's own
entrance, and again in `repository.ts` at the only statement that can write such a row. The same
belt and braces §13.1 gives the development staff switcher, for the same reason: one guard
eventually gets refactored away by somebody who can see only one of them.

**The address is a third layer.** Synthetic participants use `@test.invalid`, reserved by RFC 2606
so that it can never be registered or delivered to — the participant-side equivalent of the
switcher's `.test` identities. `kind` carries the meaning; the domain is what guarantees that a
bug in email-mode selection still cannot reach a stranger's inbox. Each gets a distinct local
part, because `canonicalizeEmail` collapses dots and `+` tags for Gmail (BR-REQ-032-02) and
because the per-event uniqueness index would refuse the second registration of one participant
anyway.

**It stops at email confirmation, deliberately.** The next step is signing the declaration, and
§10.8 says staff cannot sign on a participant's behalf — stated flatly, with no exception for a
participant who does not exist. So a test registration sits on a declaration hold exactly as a
real one does: occupying a place, expiring on the same deadline, releasing it to the front of the
queue when it lapses. That is the queue behaviour worth watching anyway.

Baseline bumped to `BR-V1.17-2026-09-04`.

## 31. Decided — deployment is a procedure with a mechanism, not a habit (2026-09-04)

`BR-V1.17` merged to `qa`, Vercel built it, the build went green, and every public page returned
500. The cause was not in the change: migration `0011` had never been applied to the QA database,
so code that selects `events.published_at` was running against a schema that has no such column.

**Nothing in this repository applied migrations to a deployed database.** `yarn db:migrate` runs
against whatever `DATABASE_URL` `.env.local` happens to hold; CI runs it against a disposable
container; the Vercel build does not run it at all. The QA database had been migrated exactly
once, by hand, months of commits ago, using an incantation recorded in a comment in a git-ignored
file. `AGENTS.md` §7.6 already said "QA before production" and "production migration is
explicit/gated/observable" — it simply never said by what, and a step with no mechanism is a step
that eventually does not happen.

Two things made it worse than it needed to be, and both are fixed here.

**`/api/health` reported `database: ok` throughout.** It ran `select 1`, which succeeds perfectly
well against a stale schema. The one endpoint whose job is to say whether a deployment works was
green while the deployment was entirely broken, so the only symptom was a 500 with nothing to
point at.

**Migration `0011` dropped two columns in the same release as the code change.** §7.6 already
asks for expand/contract "when app/schema overlap is possible", and a push to `qa` starts the
Vercel build and any migration at the same instant, so overlap is not merely possible — it is
guaranteed for a few seconds. An additive migration survives that window. A destructive one
cannot, in either direction: old code breaks on the new schema, and new code breaks on the old.

### What was built

- **`scripts/db-migrate.mjs`, run as `yarn db:migrate:env <local|qa|production>`.** The target
  environment is an argument, so the connection string cannot be whatever was exported in this
  shell; it prints the host with credentials masked and the exact pending migrations before
  applying anything; production requires `--yes`; it exits non-zero on failure. It deliberately
  does not read `drizzle.config.ts`, because that file loads `.env.local` and a migration tool
  whose target depends on which dotenv file is present is the accident being prevented.
- **`.github/workflows/migrate.yml`.** QA applies automatically when a migration lands on `qa`;
  production is a reviewed `workflow_dispatch`. It uses **GitHub Environments rather than
  repository secrets**, unlike `scheduled-jobs.yml`, for one reason: the secret could live either
  way, but a required reviewer is the "gated" half of §7.6 and only an Environment provides one.
- **Schema-drift detection in `/api/health`.** `next.config.ts` inlines the journal's head into
  the build — the same pattern the build badge already uses — and `checkSchemaVersion` compares
  it against Drizzle's own bookkeeping table. `behind` reports `down` with a 503, because in that
  state the site is already failing. `ahead` is degraded rather than down: that is what a
  rollback looks like, and whether it breaks anything depends on what the migration did.
- **`scripts/smoke.mjs`, run as `yarn smoke <base-url>`.** `/api/health` as an exit code, run by
  the workflow after a migration and by a person after any deploy. When the schema is behind it
  says so and names the migration, because that is the failure whose remedy is a command rather
  than an investigation.
- **`yarn db:seed:legal`.** A second, smaller consequence of the same incident: the sample legal
  documents could only be seeded by `pilot.ts`, which deletes every event and translation first.
  That is right on a laptop and destructive on an environment an organizer has been editing, so
  QA had no privacy notice and registration there refused everyone — nobody was going to run the
  seed that would wipe their work. The legal seed now has its own entry point and never deletes.
- **`docs/RUNBOOKS.md` § Deploy a release**, which is the procedure itself, and the ordering rule
  written as the thing a person actually decides: an additive migration ships with its code, a
  drop ships in the release after.

### What was deliberately not built

**Migrating from the Vercel build, or from application startup.** It would have prevented this
exact incident and it is forbidden by §7.6 for better reasons than this one: a build runs on
every preview deployment of every branch, so a preview of an unmerged experiment would migrate
the shared database, and a destructive migration would then run because somebody opened a pull
request. Startup is worse — it runs because a page was requested. The mechanism has to be
something a person or a reviewed workflow triggers, which is what the above is.

**Blocking the Vercel deploy on the migration.** GitHub Actions cannot order itself against
Vercel's own trigger, and building that coupling would mean taking deployment away from Vercel
entirely. The honest answer is the ordering rule plus detection: with expand/contract the overlap
window is harmless, and when somebody gets it wrong the health check says which migration is
missing within seconds instead of after an afternoon.

Baseline bumped to `BR-V1.18-2026-09-04`.

---

## 32. Decided — the public participant list exists, and is off (2026-09-05)

**Context.** The event page said nothing about who was coming, and the club asked for a start
list: the ordinary thing a race page carries, and the thing that makes a small club's event look
like an event. The data is already in the database — a `CONFIRMED` registration carries the name
the participant typed.

That is exactly what makes it a decision rather than a screen. Publishing those names is a
disclosure of personal data by the club, under a privacy notice that is presently sample text
with `<PLACEHOLDER>` facts and no approval from anybody. `AGENTS.md` §10.8 and §29 already say
the club's own wording is the club's to write, and BR-REQ-053-01 already refuses registration in
production while nothing is approved.

**Decision.** Build the whole thing, and ship it switched off.

- `events.participant_list_visibility` is `HIDDEN` | `NAMES`, default `HIDDEN`. Every event that
  exists has it; every event created or duplicated after it has it. A duplicate never inherits
  `NAMES` — the decision was made about the people who entered the original event, not about a
  copy of its columns.
- The published set is `CONFIRMED`, `REAL`, not opted out, in confirmation order, and the select
  list is the registered name alone. Not "the name for now": there is no query behind this page
  that can return an address, a status, an identifier or a count of who is still deciding, and
  `tests/privacy/public-surface.test.ts` fails if one appears.
- `registrations.list_opt_out` is the participant's own refusal, and the form asks **on every
  event**, including the ones with no list today. An organizer can switch a list on months after
  somebody registered, and a question that was never put to that person cannot be answered later
  on their behalf. The label says "if the club publishes one" for that reason.
- `NAMES` is refused for `NONE` and `EXTERNAL`, in the service and again as a CHECK. For `NONE`
  there is nobody to list; for `EXTERNAL` the entrants are the other organizer's and the club
  holds none of them.
- The sample privacy notice gains section 5, "the public participant list", describing the
  disclosure with the legal basis and the retention period as placeholders.

### The open question, which is the club's and not this repository's

**The approved privacy notice must describe this before the switch may be used.** No environment
has an approved notice at all, so nothing is blocked today; what is being recorded is that
turning it on is not a UI decision. The wording — the legal basis for publishing, and how long a
list stays up — is section 5 of the sample notice, with the facts in angle brackets. Until the
club or its adviser fills those in and approves the version, `HIDDEN` is the only correct value
everywhere, which is what it already is.

### Why opt-out rather than opt-in

Opt-in is the safer default in the abstract, and it is the wrong shape here. The event-level
switch is already an opt-in — by the club, deliberately, per event, with the disclosure spelled
out next to the checkbox — and a second opt-in underneath it would produce a start list that is
mostly absent and therefore useless, which is how a feature ends up switched on with the list
padded by hand. The participant's control is real: it is asked on the form, before they submit,
and it can be exercised afterwards through the club. That is recorded here rather than argued
again later.

### What was deliberately not built

**A count of who has not confirmed.** "12 registered, 8 confirmed" is a second disclosure with a
second decision behind it, and it tells a reader something about people who never agreed to
appear at all. The free-place count the CTA shows is a different number: it is about the event's
capacity, not about anybody.

**Removing a name from the backoffice.** A participant who asks to be taken off is handled by
the club today, and the correction path for it belongs with the rest of the registration
corrections (BR-REQ-037-03) rather than as a one-off button here.

Baseline bumped to `BR-V1.19-2026-09-05`.

---

## 33. Decided — the registrations backoffice can change a registration, within three moves (2026-09-05)

**Context.** The registrations screen could list, filter, export and resend. It could not change
anything, which meant the club's actual working day — somebody asks to be signed up after a run,
somebody's name is spelled wrong on the start list, somebody drops out by text message — ended
with "ask a developer". The owner's words: "not much I can do with the registrations list, I
need a full CRUD on them."

The obvious reading of that request is dangerous, and the interesting part of this decision is
what "full" was allowed to mean.

**Decision.** Three administrative changes exist, and no fourth.

- **Create.** `createRegistrationByStaff` calls the same `submitRegistration` the public form
  calls. The same allocator, the same event-row lock, the same place in the queue, the same
  `PENDING_EMAIL_CONFIRMATION` start. `source = STAFF` and `created_by_staff_user_id` record how
  the row arrived, and `tests/integration/registrations/staff-crud.test.ts` asserts that a
  staff-entered registration lands behind everyone already waiting.
- **Update.** The registered name, and nothing else. No verified-email edit and no participant
  merge, which is BR-REQ-037-03 criterion 2 asking for exactly that absence: the verified address
  *is* the identity (§10.3), and a typo is fixed by cancelling and registering again.
- **Delete.** There is none. "Remove this registration" means cancelled — the same transition a
  participant makes from their own link, with `cancellation_source = ADMIN`, releasing the place
  to the front of the waiting list. A registration is the record of what somebody agreed to and
  when; deleting it would destroy the evidence §10.8 exists to keep, and `deleteEvent` already
  refuses an event that has one for the same reason.

`audit_logs` arrives with them. AGENTS.md §12.12 has described the table since the first
baseline and nothing ever created it; it was owed the moment the backoffice started changing
things rather than only reading them.

### Consent cannot be forged, and this is where that was decided

A staff-entered registration reaches `CONFIRMED` by exactly one route: the participant opens the
link in their own email and signs the declaration. Nothing in the admin service touches that
transition, and there is no argument that could make it. §10.8 is unambiguous — staff cannot sign
on a participant's behalf — and the whole feature is built so that the queue cannot tell a
staff-entered registration from an online one.

The privacy notice is the harder half. The row carries `privacy_notice_version` and
`privacy_acknowledged_at`, both NOT NULL, and the person at the desk did not click a checkbox.
Rejected: leaving them null (the column is the record of which version applies, and a null is a
registration nobody can later say anything about), and inventing a separate "acknowledged by
staff" version scheme (a second consent model for six registrations a year). Decided: the
organizer ticks one box saying they are relaying a request from that person — the service refuses
the registration without it, so the box is binding rather than decorative — and the `audit_logs`
row names who ticked it. What the columns then record is honest: this version was in force, and
this member of staff is on record as having relayed it.

### The open question, for the club rather than for this repository

**There is no way to discard a registration whose address was never confirmed.** §10.5 has no
edge from `PENDING_EMAIL_CONFIRMATION` to `CANCELLED`, deliberately: such a row occupies no
place and expires by itself after 48 hours. An organizer who mistypes an address at a desk
therefore has to wait it out, and the interface says so rather than failing with a bare conflict.
Adding that edge is a change to the state machine and to §10.5, with the matrix that implies, and
it should be made only if the club actually finds the 48 hours a problem.

### What was deliberately not built

**Exceptional waiting-list promotion (BR-REQ-035-05).** It is a real requirement and it is not
one of the three above: promoting one person over another is a different act from correcting a
name, and it needs its own reason field, its own audit action and its own thinking about what it
does to the people it skipped.

**Removing one name from a published start list.** BR-REQ-039-01's opt-out is set at
registration, and a later request goes through the club today. The button belongs with this
group of corrections when it exists, not as a one-off on the public page.

Baseline stays `BR-V1.19-2026-09-05`; this section is part of that bump.

---

## 34. Decided — the staff entrance is the build badge, not a link in the footer (2026-09-05)

**Context.** Every public page carried a "Staff" link in the footer, and the sign-in button read
"Sign in with Zitadel". Neither is wrong exactly, and both are things a small club's website
should not say. The link advertises a backoffice to every visitor for the benefit of three people
who already know the URL; the button names an identity provider the club has no relationship
with — Zitadel is an implementation detail of how the three of them get in, and a person reading
it learns only that there is something else they are supposed to recognise.

**Decision.**

- **The footer link is gone.** `SiteFooter` renders the two public legal routes and nothing else,
  which is what AGENTS.md §9.2 actually requires of it.
- **The build badge is the way in.** A double-click on it, or `Enter` when it has focus, opens
  `/sign-in`. A single click does nothing: the badge sits in the bottom-right corner, which on a
  320px screen is where a thumb lands, and a fixed element that navigates on one tap is a trap
  rather than a shortcut. Where `STAFF_AUTH_MODE=disabled` the badge stays exactly what it was —
  a label with `pointerEvents: "none"` — because there is no door to open.
- **The badge says less.** The visible text is the environment (except in production, where it is
  noise) and when the code was last changed. The baseline and the commit moved into its `title`
  and its accessible name: four facts in a corner label is three too many to read at a glance,
  and `/api/health` reports the same values exactly to anybody who needs them.
- **The sign-in button reads "Autentificare" / "Sign in".** The provider id in
  `signIn("zitadel", …)` is code and stays; no user-visible string names it.

**This is not a security change, and must not be read as one.** The backoffice is guarded on the
server on every request (BR-REQ-060-01 criterion 4), `robots.txt` disallows the path, and a link
to a locked door was never a weakness. What changed is what the club's public pages advertise.
For the same reason the badge is a `role="button"` with an accessible name that says what the
gesture does: a control only a sighted mouse user can discover would be a worse answer than a
discreet one everybody can reach.

### What was deliberately not built

**A keyboard shortcut, or a URL only staff know.** Both are the same mistake in a smaller font:
an entrance whose safety depends on nobody finding it. The guard is the server, and it already
holds.

Baseline stays `BR-V1.19-2026-09-05`; this section is part of that bump.

---

## 35. Decided — the backoffice's enum labels are Romanian, once (2026-09-05)

**Context.** The owner, mid-way through `BR-V1.19`: *"enums and stuff should not be in 2
languages, the entire bilingual admin management is confusing."*

They are right about the cost. `Admin.status.PUBLISHED` existed in `ro.json` and again in
`en.json`, and so did the transitions, the staff roles, the event status, the registration mode
and the seven registration statuses — six enums, two copies each, kept in step by a parity test,
for a screen three people in one club use, all of whom speak Romanian. Every one of those pairs
is a place where a change has to be made twice and a review has to check both.

**Decision.** Those six sets of labels move out of both catalogues into
`modules/staff-identity/domain/staff-labels.ts`, in Romanian, as `Record<Enum, string>` — so
adding a value to an enum is a TypeScript error at the label map rather than a raw token
appearing on an organizer's screen.

**What did not change, and this is the whole boundary.** The public site is fully bilingual and
stays so: every word a visitor or a participant reads, on a page or in an email, is a key in both
catalogues. `Event.kind.*` is the edge case and it stays in the catalogues, because a public page
reads it too — the rule is "who is reading it", not "which screen renders it". Error messages stay
bilingual as well; they are sentences addressed to a person, not names for the club's own
vocabulary.

The backoffice itself is still locale-prefixed and still reachable at `/en/admin`; what an English
URL now gets is English chrome with Romanian names for Romanian things. That is the smaller,
reversible half of the owner's question. **The larger one — whether the backoffice should be
Romanian-only, with no `/en/admin` at all — is deliberately still open**, and the owner asked for
it to be considered separately from this baseline.

BR-REQ-040-04 is amended rather than quietly broken: criterion 3 gains the exception in words,
criterion 4 is new and asserts the catalogues carry none of these labels, and
`tests/unit/i18n/messages.test.ts` checks the label maps against the enums instead of checking two
copies against each other. That is a stronger test than the one it replaced — the old one proved
the two files agreed, and could not prove either of them was complete.

Baseline stays `BR-V1.19-2026-09-05`; this section is part of that bump.

---

## 36. Decided — what is written twice is only what a translator would change (2026-09-05)

**Context.** The owner, on the backoffice: *"I have to do everything twice… the common stuff
should be just 1 time, it's not like the English version of the event has a different time or a
different type than the Romanian version, just the descriptions should be different."*

The times, the type, the capacity and the registration window were already on the event row and
entered once. What was still being asked twice was `event_translations`: the meeting point, the
street address, the difficulty and the cost. The club's own seed proves the point — the street
address is byte-for-byte identical in both rows, and "Mediu"/"Moderate" and "Gratuit"/"Free" are
one decision the club made once, wearing two words.

**Decision.** `location_name`, `location_address`, `difficulty_label` and `cost_text` move to
`events`. What stays per language is what a translator would actually change: the title, the page
address, the short description and the two search-engine fields.

The split is now a question with an answer rather than an accident of which table a column landed
in: **would a translator change this?** A title yes; a street address no.

### The consequence, accepted rather than discovered

Those four render on the English page in the club's own words. `/en/events/tampa-trail` shows
"Stația de telecabină Tâmpa" and "Gratuit". The owner was shown this before choosing and chose it
over entering every event's meeting point twice.

It is worth being precise about what it is not. It is **not** a cross-locale fallback, and
BR-REQ-040-02 is unchanged: nothing borrows another row, a locale with no translation is still a
404, and no English page will ever show a Romanian *title* or *description*. It is one stored
value, written once, rendered wherever it is asked for. `tests/e2e/event-pages.spec.ts` now
asserts exactly that, so a later reader who thinks they have found a translation bug finds the
decision instead.

The alternative that keeps both — difficulty as an enum and cost as an amount-or-free, each
rendered per locale from the message catalogue — was offered and not chosen. It remains the way
to get the English words back without reintroducing the retyping, if the club ever wants them.

### Expand and contract, because this is a move and not an addition

Migration `0014` **adds** the four columns and carries the values up from the Romanian
translation. It does **not** drop the old ones: AGENTS.md §7.6 ships a drop in the release *after*
the code that stopped needing it, so a rollback finds a schema its code can still run against.
Until that release, `event_translations.location_name` is still NOT NULL and still named by
`event_translations_required_fields_present`, so `createEvent` and `duplicateEvent` keep writing a
*copy* of the event-row value into every translation. Nothing reads it. **The next baseline owes
migration `0015`: drop the four columns and that CHECK's third clause.**

**Done in `BR-V1.21`, as migration `0017`.** 0015 and 0016 were taken by work that shipped
in between, so the number this section predicted is not the number it got. The drop itself is
exactly as described: the four columns and the CHECK's third clause, one release after the
code stopped reading them, per §7.6.

`location_name` is required by the field schema on every save and by `transitionEvent` before
publication; the column is nullable only so it could be added to rows that predate it.

### The tabs, while we were here

The content tabs said "Conținut (RO)" and "Conținut (EN)", which named the panel and said nothing
about whether anybody had filled it in — so a missing English translation was found at the moment
publication was refused, which is the worst moment to find it. They now read "Română" and
"English", carry an "incomplet" mark when that language is not ready, and the section says in one
line that these are the same event in two languages and that everything factual is in Settings
above.

Baseline stays `BR-V1.19-2026-09-05`; this section is part of that bump.

---

## 37. Decided — Mailgun is wired, and it is tested on a sandbox before the domain exists (2026-09-05)

**Context.** The owner: *"I want the domain to be last… first I wanna test and then I do the
bindings."* And, on being asked which sender address to use: *"minimize these decisions, AI was
supposed to help and make decisions for me."*

Both are reasonable, and the second is a fair complaint. The decisions below were made rather
than asked, with defaults chosen so that nothing has to be decided again to start testing.

**Decision.**

- **The Mailgun adapter is wired**, over `fetch` and `FormData`, with no SDK. §1.5 ranks "prefer
  nothing, then the platform" above convenience, and what the official client adds here is a
  dependency and its own error shapes in exchange for four form fields and a status code. Its
  stated blocker — "the Romanian and English templates of BR-REQ-080-01, which do not exist yet"
  — had been stale since `BR-V1.16`; all ten message types exist in both languages.
- **Testing happens on a Mailgun sandbox domain, before the club buys anything.** A sandbox needs
  no DNS and reaches only addresses authorized in Mailgun, which is precisely what
  `EMAIL_DELIVERY_MODE=allowlist` was built for — `delivery.ts` has said so in a comment since
  `BR-V1.16`. QA is the only environment where this is permitted, and it already marks every
  subject `[QA]`.
- **The sender identity is configuration with a working default.** `EMAIL_FROM_ADDRESS` falls
  back to `noreply@<MAILGUN_DOMAIN>`, valid on a sandbox from the moment the account exists;
  `EMAIL_FROM_NAME` defaults to the club's name. The club's real sender address remains an owner
  decision (`BUSINESS.md` §9) and changing it is one environment variable.
- **Replies go wherever `EMAIL_REPLY_TO` points**, sent as Mailgun's `h:Reply-To`. Unset, a reply
  to a `noreply@` sender goes nowhere, which is the state to avoid: these messages are the club's
  side of a conversation with somebody about to run a race, and "do not reply" is a poor answer to
  "can I still change my mind?". Mailgun inbound routing was considered and not built — a
  `Reply-To` pointing at a mailbox the club already reads needs no machinery.
- **A failure's meaning is mapped conservatively.** 400, 401 and 403 are permanent, because
  retrying an unchanged message that was already refused destroys a sending domain's reputation
  (§16.1). 429, 5xx, a timeout and any network error are transient. Everything else that is not
  clearly the caller's fault is retried.

### What a test caught, and it was not the test's fault

The first version of the adapter truncated a provider error into `email_outbox.last_error`
without redacting it. Mailgun's commonest rejection on a sandbox domain is *"…is not among the
authorized recipients"* — **with the participant's address in it** — and that column is read by an
organizer in the backoffice and shipped into logs. §14.5 forbids exactly that. The sanitizer now
redacts anything address-shaped and the API key before truncating, and the test that found it
asserts both.

`docs:check` caught the first draft of the adapter with `https://api.mailgun.net` written into
it, and the check was right: §8 forbids a hostname under `src/` and exempts no provider, which is
the same rule that keeps the map service's URL in configuration. `MAILGUN_API_BASE_URL` is now
required by any transmitting mode — and it is not ceremony, because Mailgun's EU region is a
different host and a club storing European participants' data may well have to move to it.

### Order of operations, since the domain is last

1. Mailgun account, sandbox domain, API key. No purchase, no DNS.
2. Authorize the two or three real addresses that will do the testing. **Authorize the exact
   spelling**: this application's allowlist compares canonical identities, so `ana.pop+qa@gmail.com`
   passes it, while Mailgun's authorized-recipient list is literal and will refuse that address
   unless it was authorized as typed.
3. QA gets `EMAIL_DELIVERY_MODE=allowlist`, `EMAIL_ALLOWLIST=<those addresses>`,
   `MAILGUN_API_KEY`, `MAILGUN_DOMAIN=sandboxNNN.mailgun.org`. Nothing else changes.
4. Walk the participant journey on QA against a real inbox. Test registrations stay on
   `@test.invalid`, are not on the allowlist, and are captured — so filling a queue still costs no
   authorized-recipient slots.
5. The webhook works on the provider-assigned QA hostname: Mailgun needs a reachable HTTPS URL,
   not a domain the club owns.
6. When the domain exists: verify it in Mailgun, swap `MAILGUN_DOMAIN`, and production moves to
   `live`. No code change.

Zitadel's own email — staff invitations, address verification, password reset — is a separate
pipeline that shares only a sending domain. It is configured in Zitadel's own SMTP settings and
nothing in this repository affects it.

Baseline stays `BR-V1.19-2026-09-05`; this section is part of that bump.

---

## 38. Decided — five staff roles that nest, and where the personal-data line falls (2026-09-05)

**Context.** The owner asked for a hierarchy: *"superadmin (me), admins (Amalia & Marius),
moderator (Dani: can edit events and approve edits) and contributors (can propose edits but needs
approval)… superuser - admin - dev - moderator - contributor"*.

Three roles existed — AUTHOR, EDITOR, ADMIN — and the workflow they drove was already the right
shape: an author edits their own drafts and submits them, an editor approves. What was missing
was the two ends: somebody above ADMIN who alone decides who is on the staff, and a role for
technical help that does not come with the participant list.

**Decision.** `CONTRIBUTOR < MODERATOR < DEV < ADMIN < SUPERADMIN`, strictly nesting, with the
rank written in exactly one place and every capability expressed as `atLeast(role, MINIMUM)`.

That last part is the load-bearing bit. A capability written as a list of roles is a capability
somebody forgets to add the next role to; a threshold inherits correctly by construction.
`session.ts` kept its own second copy of the rank and now imports the one in `domain/roles.ts`.

### The two decisions inside the decision

**What DEV is for.** The owner named it in the hierarchy and did not describe it, so it is
defined here: DEV is a moderator plus the configuration report, and **no participant data**. The
line between DEV and ADMIN is exactly personal data — below it is the club's own content and its
own configuration, at and above it are the people who registered. That is what makes it possible
to give somebody technical access to diagnose a problem without handing them the club's
participant list, which is the actual reason to have the role at all. It is why `/devs` sits at
DEV rather than at ADMIN.

**Every existing ADMIN migrates to SUPERADMIN.** Staff administration moved from ADMIN to
SUPERADMIN, so mapping ADMIN to ADMIN would have removed a power those accounts have today — and
could have left the club with nobody able to manage staff at all. A role migration must never
take away access somebody already had. Demoting Amalia and Marius to ADMIN afterwards is a click;
being locked out of the staff screen is not.

### What the change found

`canManageStaff` was doing two jobs. The registrations list, the detail page, the CSV export and
the new-registration form all gated on it — so "may read the participant list" and "may decide
who is on the staff" were the same permission. Splitting them into `canManageRegistrations`
(ADMIN) and `canManageStaff` (SUPERADMIN) is what the hierarchy required, and it is a real
tightening: an administrator can now read every registration and still cannot promote themselves.

The lockout guards moved with it. They counted `role = 'ADMIN'`; they count SUPERADMIN now,
because the role that can be lost is the one that can administer staff.

Drizzle's generated migration would have aborted on real data — it casts the old column straight
into the new enum, and `'AUTHOR'` is not a value in it. `0016` is hand-written: remap while the
column is still `text`, then convert.

### What was deliberately not built

**Per-event or per-section permissions.** "Dani moderates the trail races, Amalia the road races"
is a real thing clubs want and a different model entirely — it is authorization on rows, not on
roles, and it would touch every query rather than one file. If the club asks, that is its own
decision with its own migration.

Baseline stays `BR-V1.19-2026-09-05`; this section is part of that bump.

## 39. Decided — the throttle covers every surface that exists, and the key is never a caller (2026-09-05)

`AGENTS.md` §19.4 names five surfaces to protect. Two were built in `BR-V1.19`; the debt table in
`docs/PLATFORM.md` carried the rest. Two of the three remaining are real endpoints today, so they
are guarded now. The fifth, uploads, has nothing behind it: media storage is deferred (§17).

### Token validation is keyed on the token, not on whoever presents it

The obvious reading of "rate-limit token validation" is a brute-force defence, and it is the wrong
one. An action token is 32 random bytes (`token-secret.ts`); nobody guesses one, and a limit that
made guessing harder would be defending against a threat that does not exist. Worse, that reading
leads straight to a per-IP key — and `rate_limit_buckets.key` is *persisted*, so a per-IP throttle
would write visitors' addresses into the database to defend against nothing, which §19.4 forbids
in the same sentence it asks for the limit.

The threat that does exist is **one token being hammered**. A link that reached a mailing list, a
scanner in a retry loop, a captured URL replayed: each request is a SHA-256, an indexed query and
a serverless invocation the club pays for. So the key is the presented token's **hash** — one
bucket per link. A hammered link cannot slow anybody else's, and the hash is precisely what
`email_action_tokens` already stores, so this adds no secret at rest. Keying on the secret would
have put working links in a stolen backup, which is the thing §14.5 and the hashing exist to
prevent.

**Ten per hour, at the route boundary.** Not in `action-tokens/repository.ts`, where its own
comment had invited it, for two reasons that only appear when you try:
`readActionTokenContext` runs inside a read-only transaction and PostgreSQL refuses a write in
one; and `consumeAndSignDeclaration` calls `consumeActionToken` twice for a single click — once
for `COMPLETE_DECLARATION`, once for `WAITLIST_OFFER` (§15.7) — so a throttle there would charge
one participant two attempts on the only surface where the actor is definitely a human. It lives
in `modules/action-tokens/throttle.ts`, called once per request from
`registrations/token-actions.ts`, and outside the caller's transaction so a rollback cannot erase
the count. A throttle a failing request resets is a throttle an attacker resets by failing.

A refusal returns `TOKEN_NOT_FOUND`. That is not a shortcut: §13.2 already required one generic
invalid-or-expired answer, so telling a stranger "you are being rate limited" would be new
information this application had decided not to give.

### The job endpoints authenticate and now also throttle

`JOB_SECRET` answers *who*. Nothing answered *how often*, and that gap is worth more than it
looks: an unlimited outbox drain is every message the club will ever send, in somebody else's
hands, and Mailgun's daily allowance gone in an afternoon (`docs/PLATFORM.md`, limit 1 of the
four that bite).

Keyed on the **job name** — one bucket per endpoint, not per caller, because there is exactly one
legitimate caller and no identity to key on beyond the secret already checked. Thirty an hour,
against a scheduler asking for twelve and actually delivering about one every two hours
(`docs/PLATFORM.md` limit 4), leaves room for a manual run and a catch-up burst. Each endpoint
gets its own bucket: a hammered maintenance run must not stop confirmations going out.

**Counted after the secret check, never before.** This is the one ordering that matters here. A
bucket an unauthenticated caller can fill is a way to switch the club's scheduler off with a
loop and no credentials — a strictly worse outage than the flood it would be refusing, and it is
asserted end to end in `tests/integration/jobs/job-throttle.test.ts` rather than left as a
comment.

### What was deliberately not built

**A shared refusal helper for the two job routes.** §1.5 abstracts on the third occurrence, not
the second. Four lines twice, each naming its own job, reads better than an indirection.

**Per-IP limiting anywhere.** Named here so it is not proposed again as an improvement. §19.4
forbids IP as participant identity, and this table persists its key.

Baseline bumped to `BR-V1.21-2026-09-05`.

## 40. Decided — a spent allowance defers a message; it does not throw it away (2026-09-05)

`docs/PLATFORM.md` has said since `BR-V1.19` that Mailgun Free's 100 messages a day is the limit
that binds on registration day. What it had never said is what actually *happens* when the club
crosses it, and the answer turned out to be the worst available one.

### The defect, because its shape will recur with the next provider

Mailgun refuses a send whose account allowance is spent with the **same HTTP 400** it uses for a
malformed message: `Domain <domain> is not allowed to send: recipient limit exceeded`. The
adapter mapped every 400 to `permanent_failure`, which the outbox records as `BOUNCED`, which is
terminal — nothing ever retries out of it.

So on the club's busiest day, every message queued after the cap would have been **discarded**.
Not delayed: discarded, silently, while the registrations themselves committed perfectly well and
the participants waited for confirmations that no longer existed anywhere. Three messages per
completed registration against a hundred a day is about 33 registrations, so a race opening
entries to a hundred people would have reached that before lunch.

### Why the mapping alone was not the fix

Reclassifying it as `transient_failure` looked like a one-line change and would not have worked.
The retry schedule is bounded exponential — 1, 2, 4, 8, 16, 32 minutes, six attempts — and spends
itself in about an hour. A message queued when a **daily** cap was reached would have burned all
six attempts by mid-afternoon and been marked `FAILED` around ninety minutes later, roughly eight
hours before the allowance it was waiting for came back.

Two guards were in tension and both are real: retries must be bounded, because an unbounded retry
against a provider that is rejecting messages is how a sending domain's reputation is spent
(§16.1, §16.5); and a confirmation the club owes a participant must not be thrown away because of
a limit that clears at midnight.

### The decision: a fourth outcome, on a day scale

`SendResult` gains `throttled` — *the provider refused because this account's allowance is spent,
and nothing was transmitted*. It is not a shade of transient and the distinction is the point:

- **Nothing left the building**, so no reputation was spent and there is nothing to back off from.
- **What there is, is a reset to wait for.** The outbox leaves the row `PENDING` and schedules the
  next attempt for just after the next UTC midnight (`nextAllowanceResetAt`), or for the instant
  the adapter names if it knows one.
- **The attempt still counts.** Six attempts a day apart outlast any daily cap and keep this
  bounded: a message nobody has delivered in six days needs a person, which is the same judgment
  `MAX_SEND_ATTEMPTS` already makes on its own scale. It does not become a message that retries
  forever.
- **A deferral is not an error.** `job_runs.errorCount` counts failures and bounces, not
  deferrals, because a plan's limit is the plan working as bought. `/devs` shows the volume
  against the allowance, which is where that belongs.

UTC midnight is an assumption, stated rather than buried: Mailgun publishes the daily limit and
not the instant it resets. Being wrong costs one attempt out of six, not a message.

### The narrow pattern is a guard, not a detail

Only a 400 whose body carries **limit** language moves out of permanent. Widening it to "not
allowed to send" would sweep in a disabled domain and — worse — the sandbox's own "is not among
the authorized recipients", and retrying *those* once a day forever is precisely the reputation
cost the permanent/transient split exists to prevent. Both directions are asserted in
`tests/unit/notifications/mailgun-classification.test.ts`, and neither may be relaxed to make the
other pass.

429 is deliberately left transient. It is Mailgun's *hourly* rate limit, which clears within the
hour; deferring it to the next daily reset would delay a confirmation by a day to avoid waiting a
minute.

### And it is visible before the day, not after it

`/devs` now carries the arithmetic `docs/PLATFORM.md` could only describe: registrations today ×
3 against the daily allowance, with what is left of today, amber when the projection exceeds the
remainder and red when it is spent. Test registrations are counted and counted **separately** —
§12.6 keeps them out of every count the *club* is given, and this is not one of those: it is an
operator's forecast of what will reach the provider, and a synthetic participant on an
`@test.invalid` address consumes the allowance exactly like a real one. A number that excluded
them would be the only number on the page that was wrong.

Baseline stays `BR-V1.21-2026-09-05`; this section is part of that bump.

## 41. Decided — the diagnostics page explains a setting, not just its value (2026-09-05)

`/devs` could say which mode a deployment was in and had no way to say what the alternatives
were, or what choosing one would do. Somebody asking "what else could `EMAIL_DELIVERY_MODE` be,
and what would that mean?" had to open the source — which defeats a page whose whole purpose is
that nobody should have to.

The values now live in `shared/config/env-enums.ts`, defined **once**: `env.ts` builds its
`z.enum` from those arrays and `/devs` renders them. Before this, a second list would have been a
second place to forget, and a diagnostics page that lies about what the process accepts is worse
than no diagnostics page.

Each setting and each of its values carries a sentence saying what it is and what it does, in
`messages/*.json` under `Devs.setting.*` — not in the module, which `env.ts` imports and which
therefore runs before anything is translated, and because §9.3 keeps user-facing prose out of
code anyway. The value in force is marked rather than merely listed.

**Nothing here can print a value.** The page pairs a list of allowed *tokens* with the current
setting it already held; no secret is in scope, which is the same structural argument
`modules/diagnostics/configuration.ts` makes for itself.

Also corrected on the way, because it was the same class of mistake: `APP_BASE_URL` defaulted to
`http://localhost:3000` and `scripts/dev.mjs` has always started the dev server on **47821**,
deliberately far from 3000, 5173, 8000 and 8080 so it does not collide with another project.
Every absolute URL this application emits derives from `APP_BASE_URL` (§8), so a locally rendered
confirmation link pointed at a port with nothing listening on it. The default is the real port
now.

Baseline stays `BR-V1.21-2026-09-05`; this section is part of that bump.

## 42. Decided — navigation is gated by capability, because one equality operator hid four features (2026-09-06)

The owner reported, over the course of an afternoon, that the registrations page was not in the
menu, that they could not see who was registered for an event, that unconfirmed registrations
were not listed, and that the legal documents were not visible — and concluded, reasonably, that
"a lot of features are half-baked".

**All four were one bug, and none of the four features was missing.** `admin/layout.tsx` decided
which tabs to render with `staffUser.role === "ADMIN"`, a raw equality test against a hierarchy of
five nesting roles (§38). `"SUPERADMIN" !== "ADMIN"`, so **a Superadministrator was shown only the
Events tab** — and migration `0016` had turned every existing ADMIN into a SUPERADMIN precisely so
that nobody lost access. The people most likely to be running the club were the only ones who
could not navigate to the registrations, the legal documents, the staff screen or `/devs`.

It was wrong in the other direction too, quietly: a DEV was offered no `/devs` link although that
screen exists for exactly that role, and an ADMIN was offered a Staff tab that 404s on arrival.

### What this was not

**Not a security defect, and worth being precise about that.** Every one of those pages asserts
its own capability on the server and answers 404 to a typed URL — `canManageRegistrations`,
`requireStaffRole("ADMIN")`, `canManageStaff`, `canSeeDiagnostics`. BR-REQ-060-01 held throughout;
nothing was reachable that should not have been. What failed is the other half of a backoffice:
navigation is how a person learns what the system can do, and a section nobody can see is a
feature nobody knows exists.

**Not a missing filter, either.** The registrations list has always taken an `eventId` query
parameter and has never filtered by status by default, so "per event" and "including unconfirmed"
both already worked — the screen was simply unreachable. The one real gap was direction: the only
way to ask "who entered this race" was to open the list and pick from a dropdown, so the event
row now links to its own registrations. That link is gated on `canManageRegistrations` and only
appears for an event that takes entries.

### The decision

Which sections a role may see is a **rule**, so it is a pure function — `visibleAdminSections` in
`domain/roles.ts`, beside the capabilities it composes — rather than a conditional inside a React
component. §1.5 already required that of every rule that can be one; this is what it costs to
skip it. Each entry names the capability the page behind it asserts, so the two cannot drift.

The test that matters is not the per-role list but the property: **a higher role is offered every
section a lower one is**, asserted across every pair in the hierarchy. An equality test against a
role name fails that immediately, which is why it is written as a property and not as four
expectations. Any future role added to the middle of the hierarchy is checked by it for free.

### Also

The backoffice header now shows the signed-in **address** as well as the display name. A display
name does not distinguish a personal Zitadel account from a club one, and the address is what the
`staff_users` allowlist actually matches on. It is the reader's own address shown to themselves —
§10.3's protections concern participants, and a member of staff seeing their own sign-in is not
that.

Baseline stays `BR-V1.21-2026-09-05`; this section is part of that bump.

---

## 43. Decided — the difficulty and the cost are closed sets; the price is not one of them (2026-09-06)

**Status:** Decided. Narrows §36, which is otherwise unchanged.

Two of the four fields §36 moved onto the event row were free text: `difficulty_label` and
`cost_text`. §36 accepted a consequence for all four — that the English page would show
whatever Romanian the club typed — because a street address and the name of a park genuinely
are the club's own words, and retyping them per language was asking the same question twice.

For the other two that reasoning does not hold. "Mediu" is not a name; it is one of three
answers to a question with three answers, and the only reason an English reader saw it in
Romanian was that the column happened to be `text`. Migration `0018` makes them
`event_difficulty` (`EASY|MODERATE|HARD`) and `event_cost_type` (`FREE|PAID`), backfilled from
the words already stored, and `0019` drops the text columns behind them. The organizer still
answers once; the page now says it in the reader's language. §36's trade stands for
`location_name` and `location_address`, which is where it always belonged.

### Why the cost enum says whether and not how much

The owner asked for "cost as an enum". A price is not an enum — it is an amount, a currency,
and usually a deadline, and inventing a shape for money nobody charges yet would be exactly the
speculative structure §1.3 warns against. `cost_type` answers the question every event page has
to answer today: does a runner need their wallet. The day the club runs an event that charges,
`PAID` is what the amount column hangs off, and adding it is a migration against three rows.

The migration keeps the fact and loses the figure: "50 lei" becomes `PAID`, and the number is
gone. Nothing in either database charges money — every row read "Gratuit" — so this discards no
figure anyone has published, and the alternative was inventing the amount column now to avoid a
loss that does not exist.

### Null is a third answer, and it is not the safe default of the other two

Neither column has a default. An event with no stated cost is **not** free, and one with no
stated difficulty is **not** easy — the page omits the row entirely rather than answering on the
club's behalf, which is §1.2 applied to a dropdown. `optionalEnum` in
`content/events/fields.ts` reads `""` and null as "not stated" and **refuses** anything else,
rather than `.catch(null)`: a value outside the set cannot have come from the dropdown that
posts the field, and silently calling it "not stated" would hide a stale or tampered form
instead of refusing it.

Baseline bumped to `BR-V1.22-2026-09-06`.

---

## 44. Decided — a registration can be erased, because cancelling was never an answer to "remove me" (2026-09-06)

**Status:** Decided. Supersedes the "there is no delete" of §33 and of `AGENTS.md` §15.11.

§33 settled that staff may enter, rename and cancel a registration and nothing else, on the
reasoning that a registration records what somebody agreed to and when, so "remove them" means
cancelled — the place goes back to the queue and the record stays. That is right for the case it
was thought about: a runner who drops out.

It is wrong for the case it was not. A cancelled registration still holds a name, an email
address and a signed declaration. Somebody who writes to the club asking to be removed from its
records is not asking to be cancelled, and "we cannot delete you" is not an answer the club may
give. A rule that forbids erasure is not a safeguard; it is a defect with a principle in front
of it.

The owner asked for this twice. The first refusal cited §15.11 correctly and stopped there,
which was the mistake — the rule deserved re-examining rather than restating.

### What erasing does, and the order it does it in

Each step is load-bearing and the order is not arbitrary:

1. **Release the place through the ordinary allocator** (`unregister`), so a deletion behaves in
   the queue exactly as a withdrawal does. Deleting the row first would strand the place until
   something noticed the count no longer matched, and the person at the front of the waiting
   list would pay for the difference.
2. **Write the `audit_logs` row second**, while the registration still exists to be described.
3. **Delete the declaration acceptance and the registration last**, in one transaction. Action
   tokens and outbox rows cascade at the database.

No message is sent. A deletion is not a notification, and the person who asked for it does not
want one.

### What the audit row may say

Who, when, why, and the status it was in. **Never the name and never the address** — those are
what the deletion exists to remove, and a log that keeps a copy of them has not erased anything.
It survives the row it describes because `audit_logs.entity_id` carries no foreign key, which
was already true and is now load-bearing rather than incidental.

### Why the declaration acceptance goes too

It is the record of a consent given by a person who is being erased. Keeping it would preserve
exactly the link the erasure is meant to break. The count of accepted declarations is not worth
more than the request.

### What is still refused

No verified-email edit and no participant merge (§10.3): the verified address is the identity,
and a typo is still fixed by cancelling and registering again. No staff-signed declaration.
Erasing is Administrator-only, asks for a reason, and says plainly that it cannot be undone —
it is meant to be the heavier of the two, because it is.

Baseline bumped to `BR-V1.23-2026-09-06`.

---

## 45. Decided — a retention sweep deletes what is spent, and never what belongs to a person (2026-09-06)

**Status:** Decided.

The owner asked for hard deletes "to keep the DB light". Two answers, because the request
contains two different things.

**Deletes here were already hard.** Erasing a registration (§44) is `DELETE`, and cancelling is
a status rather than a hidden row: nothing in this schema is soft-deleted, so there was no
tombstone to sweep up.

**What actually grows is mechanism, not data.** Measured against the QA database, the whole
thing is under a megabyte and `job_runs` holds 67 rows — but it gains one every five minutes
whether or not anybody registers. That is 288 a day and roughly 105,000 a year, to answer a
question that only ever reads the newest row. Three other tables grow with traffic and then
never shrink: throttle buckets whose window has passed, action tokens that are spent, and
messages sent months ago.

So the sweep takes four tables and no others:

| Table | Window | Why that window |
| --- | --- | --- |
| `job_runs` | 30 days | `/api/health` and `/devs` read the newest run only |
| `rate_limit_buckets` | 1 day | a bucket outside its window can never be read again |
| `email_action_tokens` | 30 days, spent or long expired | the row holds a hash and a link, and cannot be accepted again |
| `email_outbox` | 90 days, `SENT` only | a delivered row keeps the recipient's address; a bounced one is evidence |

Two of those are privacy improvements rather than housekeeping. A sent message keeps a
participant's address and a token keeps the link between a participant and a registration;
holding either for years because nothing deleted them was not a decision anybody made.

### What it must never touch, and why that is not squeamishness

`registrations`, `participants`, `declaration_acceptances`, `audit_logs` and `events` are
untouched, and a test asserts it ten years past every window. **How long the club keeps a
runner's entry after a race is a policy question with legal weight**, and it belongs to the club
(`BUSINESS.md` §9) rather than to a sweep that runs every five minutes and would answer it by
accident. Erasing one person is §44: deliberate, per-row, audited, and asked for.

### Where it runs

Inside the registration-maintenance job, last, in its own `try`/`catch`. Last because expiring a
hold is that job's actual duty and deleting month-old rows must never delay it; caught
separately because a failure here is untidiness that no participant would notice, and marking
the whole run failed for it would make `/api/health` cry wolf.

Baseline bumped to `BR-V1.24-2026-09-06`.

---

## 46. Decided — the club writes its own legal text; immutability is about acceptance, not authorship (2026-09-06)

**Status:** Decided. Narrows §6.7 and `AGENTS.md` §12.5; BR-REQ-053-01 criterion 4 is rewritten
rather than removed.

The rule said V1 has no editor screen for legal documents, and the reasoning behind it was
sound: a participant signed version 3, `declaration_acceptances` records that they signed
version 3, and rewriting its words afterwards would leave every one of those signatures
pointing at text nobody ever agreed to.

But the rule was broader than its reason. It also prevented *creating* a version, which put a
developer and a migration on the critical path of a decision that is entirely the club's — and
the club's approved wording was, at the time this was written, the single item still blocking a
real registration on a deployed and otherwise working system. Nothing about immutability
requires that a lawyer's paragraph reach the database through a pull request.

### The line, stated once

A version is a **draft** until approved. A draft may be rewritten freely. The moment it is
approved — or accepted by a participant, or pointed at by an event — it is frozen, and a
correction is the next version. Approval is one-way: un-approving would mean somebody could
accept a version on Monday that the club treats as never in force by Wednesday, while their
acceptance row still says they signed it.

That is asserted in exactly one function, `service.ts#assertStillADraft`, and the repository
deliberately exports no update, delete or approve at all — so there is no path to a bare UPDATE
that skips the check. `tests/integration/cms/boundary.test.ts` asserts that shape as a property
rather than trusting it.

### The editor is a textarea, and that is a decision

The body is structured JSON, and the Tiptap contract that will eventually own it is M5. Pulling
that dependency forward to type a privacy notice would decide the body schema for the wrong
reason. So the format is the one everybody already writes in: a blank line between paragraphs,
`## ` for a heading, converted by `domain/body-text.ts`, which round-trips — nothing an
organizer typed is reshaped behind their back.

### What did not change

Inventing legal wording is still forbidden (§1.2), and the editor says so above the fields every
time it is opened. Sample text still refuses to seed in production (§29). Both languages are
still required before a version can exist at all, because BR-REQ-040-02 forbids falling back to
the other and the alternative to both is a public page that cannot render.

Baseline bumped to `BR-V1.25-2026-09-06`.

## 47. Decided — the registration form stays one page; what was cut is the half nobody has to answer (2026-09-06)

**Status:** Decided. Adds a rule to `AGENTS.md` §15.1 and §18.5, and a criterion to
BR-REQ-041-01. Nothing in §10.5, §12.6 or the allocator changes, which is most of the point.

The public registration form asked fifteen things on one screen. On a 390-pixel phone that is a
very long page, and it is the only page in this product a stranger is asked to complete. The
question put was whether to make it a multi-step form.

### Why not a wizard, in the three shapes a wizard could take

An anonymous visitor has no account and no session, so any form split across steps has to keep
partial answers somewhere. There were three candidate somewheres and each costs more than the
scrolling it saves.

**Hidden fields carried forward through server round-trips.** No JavaScript, no storage — and
it puts `healthNotes` into a hidden input on the rendered HTML of every step after the one that
asked for it. That is special-category data under GDPR Article 9, and BR-REQ-031-05 criterion 5
says plainly that no public page renders health text in its markup under any condition. The
design is refused by a rule that already exists, before anyone weighs the ergonomics.

**A partial registration row, completed as they go.** Durable and resumable, and wrong in three
places at once. `registrations` has a `UNIQUE(event_id, participant_id)` and a status enum with
no draft in it (§10.5), so a half-finished entry either invents an eighth status or consumes
the uniqueness of a real one. BR-REQ-031-02 criterion 1 refuses a submission with no privacy
acknowledgment and says no registration row is created — a row written at step one is created
before that acknowledgment exists. And the row would then have to be invisible to the
allocator, the capacity formula and the export, which is exactly the sort of condition
`AGENTS.md` §12.6 keeps out of the allocator: the rule there is that `kind` appears in no
condition inside it, and a `status = DRAFT` check would be the same mistake with a different
column.

**A client-side stepper.** One island, sections shown and hidden, everything posted together.
It works, and the cost is not the kilobytes. Native `required` on a field inside a hidden step
stops the submission with no visible message — the browser refuses to focus what it cannot show
— so a wizard has to reimplement validation in JavaScript, which means reimplementing the
browser's own messages, in Romanian and English, with the focus management and the screen-reader
announcements that come free today. That is a large amount of new code, on the one page that
must work everywhere, to replace something that already works. `AGENTS.md` §1.5 makes that
trade a bad one before the accessibility argument is even reached.

### What the page's length actually was

Fifteen questions, of which four are optional data (`displayName`, `tshirtSize`, `clubName`,
`healthNotes` with its consent) and two are optional consents. Measured at 390 pixels wide, the
page was 2,697 pixels tall — more than three phone screens — and a fifth of that was things
nobody has to answer to be registered.

So the optional data is behind native `<details>`, closed, each summary naming what is inside —
the pattern already used for the display name and for the destructive actions on the
registrations list. It needs no JavaScript, no island and no new component. What loads is the
required set, the consents and the button: 2,117 pixels rather than 2,697. That is not what a
wizard would have saved, and it was bought without any of what a wizard would have cost.

The optional *consents* stay open, and that asymmetry is deliberate: BR-REQ-072-01 criterion 1
and BR-REQ-039-01 require the choice to be **presented**, and a question behind a summary
somebody never opens has not been put to them. Collapsing a t-shirt size loses nothing;
collapsing a consent quietly turns "asked and declined" into "never asked".

### The round trip, which was the real accessibility failure

Native validation catches almost everything before a request is made. What it cannot catch —
and what somebody without JavaScript always meets — was answered by a redirect that put a
person back at the top of a long form with a red box listing field names as plain text.

The redirect now carries `#registration-errors`, the summary at that anchor is focusable, and
each field it names is a link to that field's own anchor. Following one moves focus to the
input. No JavaScript is involved in any of it; a fragment and `tabindex="-1"` are the whole
mechanism. The field is also marked at the field, with a message under it that MUI wires to
`aria-describedby`, because a summary at the top is a route and not a replacement for saying
what is wrong where it is wrong.

The `fields` parameter is matched against a known list (`modules/registrations/form-errors.ts`)
rather than trusted. It is a query string anybody can type, and it was reaching
`t("fieldNames.<x>")` directly.

### The rest of the journey

The declaration page did not show its deadline. §18.5 has required one in the first screen
since the rule was written, and BR-REQ-041-01 criterion 3 says so too; the page showed the
declaration and a button and nothing about the thirty minutes running underneath. It now names
the event and the instant the hold expires, in the event's own timezone, above the declaration
body — read from the registration row and not from the token that opened the page, because a
message rendered by a late outbox batch gives its token a fourteen-day default rather than the
hold's expiry, and printing that would be a wrong deadline on the one page whose subject is a
deadline. Absolute time and no countdown: a countdown alone is unusable for somebody who
stepped away, and a server-rendered "29 minutes left" is stale before it is read.

Touch targets are the other thing that had quietly drifted. MUI's medium button is about 37
pixels tall and its checkbox is 42 by 42, both under the 44 that BR-REQ-041-01 criterion 6 makes
a hard rule; `RegistrationCta` had already noticed and fixed it locally. That local constant is
now `shared/ui/tap-target.ts` and every control in the four participant pages carries it. A
theme-level `MuiButton` default was considered and rejected: it would enlarge the backoffice
too, where density is worth more than reach, and would put the rule in a file nobody opens while
looking at the registration form.

### What this costs

The optional questions are one tap further away than they were. Somebody who wants a t-shirt
has to open a summary that says "T-shirt and club". That is the trade, and it is accepted
because the required path is what a stranger walks and the optional path is what a returning
club member goes looking for.

Baseline bumped to `BR-V1.26-2026-09-06`.

## 48. Decided — the club's own people declare themselves, and the declaration grants nothing (2026-09-06)

**Status:** Decided. Adds `registrations.club_member_declared` and BR-REQ-031-06; adds a rule to
`AGENTS.md` §12.6 and to `BUSINESS.md` BR-BUS-031. The allocator and the capacity formula are
untouched, deliberately.

The request was for a tick on the registration form — "I am a Brașov Runners team member" — so
that the club's own administrators and moderators could sign up for races.

### The premise was wrong, and the want underneath it was not

Nothing has ever stopped a staff member registering. `participants` and `staff_users` are
separate tables with no shared constraint and no foreign key between them, and the public
registration form reads no session at all: an organizer opens it, enters their own address,
confirms their own email and signs their own declaration, exactly like a stranger. There was
nothing to unblock.

What the club actually lacked was a way to **tell its own people apart from strangers in a list
of entries**. The only existing signal was the free-text `club_name`, which depends on somebody
choosing to type "Brașov Runners" and spelling it the same way twice.

### Why it is a claim and not a lookup

The obvious implementation is to match the registration's canonical email against `staff_users`
and store a fact rather than a claim. It was rejected, because **app staff and club members are
not the same population and the smaller one is the wrong one**. `staff_users` holds the handful
of people with backoffice access. A member who pays dues, wears the vest and runs every event
has no row there and never will — so a verified flag would answer "no" for most of the people
the question exists to find, and it would answer it confidently.

A second reason: a staff member signs in with whatever address the club's identity provider
knows, and races with whatever address they actually read. Matching the two is a guess.

So the value is what the person said about themselves, stored as given. The column is named
`club_member_declared` rather than `club_member` for that reason, and every screen that shows it
says "declared". A future reader who takes it for a verified fact will hand a member's benefit
to whoever ticked a box, and the name is the cheapest defence against that.

### It grants nothing, and that is the load-bearing part

A self-ticked box that decided a price, a reserved place or a position in the queue would decide
it for anybody at all. The rule is therefore the same one `kind` already carries: **it appears
in no condition in the allocator or the capacity formula** (§12.6, §10.6). One of the tests in
`club-member.test.ts` exists purely to fail if that changes — a declared member and a stranger
reaching a full event both land on the waiting list.

If the club ever does want a member price or a members' allocation, the thing it needs first is
a real roster and a decision recorded here, not this column.

### "False" is not "no"

Somebody who never opened the optional section and somebody who is not in the club produce the
same stored `false`. Two surfaces are shaped around that:

- **the export prints "Yes" or an empty cell, never "No"** — a volunteer sorting the file at a
  start line cannot tell a missing answer from a negative one, and printing "No" against both
  turns a question nobody answered into an answer;
- **the backoffice filter only ever narrows to the people who declared it.** There is no
  "show me the non-members" option, because that list would be "everybody who did not tick a
  box" presented as something else.

### Where it sits on the form

Inside the optional disclosure with `club_name` and the t-shirt size, whose summary now reads
"Brașov Runners member, club and t-shirt". That keeps §47's rule intact — optional data is
collapsed, consents are not — and it puts the club's name in the summary, so a member scanning
the page finds it without opening anything. It sits beside `club_name` because they are the same
question asked twice: somebody who ticks this is in the club whose name they would have typed.

Asked on the staff-entered form too. An organizer taking a registration over the telephone is
usually taking it from somebody in the club.

Baseline `BR-V1.26-2026-09-06`, alongside §47.

## 49. Decided — the route is its own link, not an overloaded map link (2026-09-07)

**Status:** Decided. Adds `events.route_url` and BR-REQ-011-01 criterion 8; narrows what
`map_url` is for. No decision here is reversed — `map_url`'s docstring simply claimed a job it
should not have had.

The club wanted a link to the track for each race. There was already a column that could hold
one: `map_url`, whose own comment listed "a route the club has already drawn" among the things
it exists for.

### Why that column could not be the answer

Because a runner asks two questions and they have two answers. *Where do I turn up* is a pin on
a corner of a park. *Where does it go* is a drawn line on Strava, Komoot, or whatever the club
mapped it with. An event that has both — which is every race the club puts on — could store only
one of them, and whichever the organizer pasted, the label on the page was "meeting point".

`map_url` is now documented as the meeting-point override and nothing else, and `route_url` is
the course. Two columns, two questions, two labels.

### A link and not a file

Media storage is deferred (`AGENTS.md` §17): there is no adapter, no bucket, and no upload
surface, so a GPX has nowhere to go. That is the reason today. The reason it would still be a
link afterwards is that the route already lives on the service the club drew it on, where it can
be re-drawn, followed on a watch, and looked at on a phone by somebody standing at the start —
and a GPX copied into this application is a second copy that goes stale the first time the
course changes.

If the club later wants the file as well, that is an upload feature with its own decision, and
this column is not in its way.

### https, twice

Same as `map_url`: `httpsUrl` in the form schema so an organizer gets a message naming the
field, and `events_route_url_is_https` at the database so a seed, a migration or a hand-written
`UPDATE` cannot store `javascript:` behind a link a visitor is invited to click. Neither check
is redundant; they defend different doors.

### Where it renders, and where it does not

Beside the distance and the climb on the event page, because it belongs with "how far" rather
than with "where do I meet" — and the meeting point stays above them, where BR-REQ-041-01
criterion 2 wants the first-screen facts.

Not on a listing card. The card is already one link (`CardLink`, for the 44-pixel tap target)
and an anchor inside an anchor is invalid HTML that the browser silently splits — the same
reason the map link waits for the detail page.

No `SportsEvent` property carries it. schema.org has `hasMap` for a place and nothing for a
course, and inventing a property that no consumer reads would be worse than omitting one.

### Carried on a duplicate

Duplicating last year's event is how the club creates this year's, and last year's race is run
on last year's route. It copies, like the distance and the climb, and unlike the publication
state, the date and the featured flag.

Baseline `BR-V1.26-2026-09-06`.

## 50. Decided — being a non-profit is not the carve-out; how the money is framed is (2026-09-07)

**Status:** Decided. Narrows the commercial-usage reasoning in `docs/PLATFORM.md`, and records a
product consequence that is **not built**: `events.cost_type` cannot express the distinction the
rule turns on.

The club is a Romanian **ONG**, and the owner's reasonable position was that a race contribution
is a donation or cost recovery rather than profit, so Vercel's non-commercial Hobby plan still
applies. Re-reading the guidelines against that claim changed what the platform page says.

### What the terms actually test

Verified against Vercel's fair-use guidelines on 2026-09-07. Commercial usage is any deployment
"used for the purpose of financial gain of **anyone** involved in **any part of the production**
of the project, including a paid employee or consultant writing the code", with five listed
examples: requesting or processing payment from visitors; advertising the sale of a product or
service; receiving payment to create, update or host the site; affiliate linking as the primary
purpose; and advertisements.

**"Non-profit" does not appear in the document.** Legal form is not a test, and an ONG that
advertises a priced service is in the same position as a company that does.

What *is* explicit is the opposite of what was assumed: **"Asking for Donations does not fall
under commercial usage."** The carve-out the club needs exists, and it is about framing rather
than about the club.

### Three consequences, in the order they will bite

1. **A contribution presented as a donation is allowed.** This is the club's actual intent and
   the terms accommodate it directly.
2. **A mandatory entry fee is not**, and the reason is wider than payment processing — this site
   has no payment integration and never touches money. "Advertising the sale of a service" is on
   the list, and an event page stating a required fee does that whoever collects it and however.
3. **Paying anybody to build or host this site is commercial usage on its own.** The clause names
   a paid consultant writing the code. For a club whose platform is built by a professional
   developer this is the likelier trigger, and it is unaffected by anything the club charges.

### What this changed in the software

The `/admin/tasks` verdict previously flipped to a flat "not free" on any `PAID` event, which
overstated a rule the club can satisfy by wording. It is now a **caution** that states the
donation carve-out, the advertising clause and the paid-developer trigger, so an organizer reads
what to do rather than only that something is wrong.

### What is owed, and deliberately not built here

`events.cost_type` is `FREE|PAID` (`DECISIONS.md` §43). A donation and a price are the same value
in that enum, and they are on opposite sides of the rule above — so the platform cannot currently
tell an organizer whether their own event is inside the carve-out, and the caution has to hedge.

The fix is a third value, and it is a business decision rather than a schema one: what the club
intends to ask for, in the club's own words, before a column is named after it. Not built, not
guessed. Until then the caution says "check how this is worded", which is honest about what the
data supports.

Baseline `BR-V1.26-2026-09-06`.

### Settled by the owner, 2026-09-07

**Brașov Runners sells nothing and takes no money.** The owner confirmed it after the analysis
above, and that is the fact this record ends on: four of Vercel's five examples of commercial
usage cannot apply to a club that requests no payment, advertises the sale of nothing, carries no
affiliate links and runs no advertisements. The deployment is inside the Hobby plan, and
`/admin/tasks` reports it that way rather than hedging.

The reasoning is kept for two reasons rather than deleted. The first is the one trigger that is
**independent of anything the club sells** — payment to create, update or host the site — which
stays worth knowing for a platform built by a professional developer. The second is that "should
we ask for a contribution towards costs" is a question a volunteer committee will raise again, and
when it does, the answer should be read rather than re-derived: a donation is explicitly carved
out, a mandatory fee is not, and the difference is wording rather than intent.

## 51. Decided — standing pages are a small content type, not the start of the M5 CMS (2026-09-07)

**Status:** Decided. Adds `pages`/`page_translations`, BR-REQ-050-03 and `AGENTS.md` §12.9.
Narrows nothing; M5 keeps articles, galleries, the media library and the Tiptap body contract.

The club needs to say things that are not events and are not legal wording: "About Brașov
Runners" first, "Contact" soon after. `CLAUDE.md` scoped all non-event content to M5, which
would have meant no About page until a content system existed.

### The thing that made this small

`DECISIONS.md` §46 already faced the same fork for legal documents and chose a textarea over
Tiptap, on the grounds that pulling the M5 body contract forward to type a privacy notice would
decide that schema for the wrong reason. That reasoning transfers exactly, and so does the
implementation: `domain/body-text.ts` converts a blank-line/`## ` document to the stored section
shape and back, round-trips, and is already the format the club writes in.

So a page is a title, an address, a body and two SEO fields, per language. That is the whole
type. There is no cover image, no gallery, no layout choice and no block editor, and adding any
of them is M5's job rather than this one's.

### What was reused, and the one thing that reuse costs

The editorial status enum is `events`', not a second one with the same four values. So are
`allowedTransitions`, `canTransition` and the role predicates. "May this person publish" has one
answer in this product, and a second copy of it is a second place for it to go wrong — which is
the failure `AGENTS.md` §1.5 rule 3 exists to prevent.

The cost is a naming smell: `canEditEventFields` and `canCreateEvent` now gate pages too, and
read oddly at those call sites. Renaming them touches the event editor, which is about to run a
real registration window, so it is written down here and deliberately not done today.

The body converter and its renderer are **imported** from `legal-documents` rather than moved to
a shared module. §1.5 rule 6 abstracts on the third occurrence, not the second; the third is when
that move becomes right.

### What it inherits rather than reinvents

Publication is one state for the whole page and requires every locale complete, because a page
that renders in Romanian and 404s in English is exactly BR-REQ-040-02's failure. A slug is fixed
once published (§11.5): links already shared have to keep working. A save carries the version it
was loaded with, so two organizers produce a CONFLICT rather than one silently losing the English
half — and the page row and both translations are one transaction, so a stale version anywhere
writes none of it.

### Two differences from an event, both deliberate

**A page may be deleted.** An event with a registration against it is refused because somebody's
entry hangs off it (§15.11). Nothing hangs off a page, so deleting one made by mistake loses only
what its author typed. Archiving remains the answer for a page that was real and is now over.

**Both languages are on one screen**, where the event editor uses a tab each. An event carries
thirty fields and two panels of thirty do not fit; a page carries four. Seeing both at once is
what makes "the English one is empty" obvious before somebody presses publish and is told so by
a validation error.

### The navigation stopped being a constant

`SiteNav` held a literal list with a comment saying the club's own pages were M5. They are not
any more, and they are created by an organizer rather than a developer, so the header reads them.
That is one indexed query on every public page — a cost worth naming, since the header is what
every visitor pays for (§1.5) — and it buys a menu the club can change without a deployment. It
fails soft: a page that cannot be loaded costs a navigation entry, never the header itself,
because a site whose header throws has no way out of any page at all.

Baseline `BR-V1.26-2026-09-06`.

## 52. Decided — two error boundaries, Next's own digest, and one gap named rather than hidden (2026-09-07)

**Status:** Decided. Adds `src/app/[locale]/error.tsx` and `src/app/global-error.tsx`, and a rule
to `AGENTS.md` §14.3, which covered domain error codes and said nothing about boundaries.

There was no error boundary anywhere in this application. Any unhandled throw — a database blip,
a Neon instance waking from scale-to-zero, the pool's `statement_timeout` — gave a stranger
Next's default production page: "Application error: a server-side exception has occurred",
unstyled, in English, with no way back and no hint whether to try again.

### Two boundaries, because they do different jobs

`[locale]/error.tsx` catches everything below the layout, which is almost every failure. It has
the locale, the theme and the catalogue, so it apologises in the reader's own language.

`global-error.tsx` catches the failures *above* it — a broken locale resolution, a provider that
threw, a layout that never rendered — and it replaces the whole document. There is no translator
at that point, because replacing the root layout replaces `NextIntlClientProvider` with it, so
it says everything twice: Romanian first, English under it. That is the documented exception to
§11.3 rather than an oversight, and the styles are inline for the same reason the strings are
hard-coded — the theme is gone too.

### The correlation id already existed

The question was whether to show one, and the answer is that Next already generates it. Every
server error is hashed into `digest`, logged beside the stack, and handed to the boundary — so a
runner can say "it said 2060393594" and the owner can find that line. No id generator, no new
logging decision, and no temptation to write a participant's address into a log to make it
findable (§14.5). The message and the stack are never shown: they carry SQL, provider text and
sometimes an address (§14.3).

A retry is offered because `reset()` is free and the failures this application will actually meet
— a cold start, a dropped connection — are the kind a second attempt fixes.

### The gap, measured rather than assumed

**A visitor with JavaScript disabled sees a blank page, not the error page.** Verified against a
production build pointed at a dead database, in a real browser: with JavaScript the club's page
renders in full; without it the body is empty. `error.tsx` is a Client Component by Next's design
and cannot render on the server, so a server-side throw streams a shell and the boundary only
appears on hydration.

That is worth stating plainly because this site is built to work without JavaScript, and it means
the boundary is a safety net for the common case rather than a guarantee. **The only thing that
produces server-rendered HTML on a failure is catching the failure where it happens** — guarding
the data read on the route and rendering a degraded page, the way `SiteHeader#navigationPages`
now does for the standing pages. Doing that route by route is the next piece of work; the
boundary is what stops the default page appearing in the meantime.

Baseline `BR-V1.26-2026-09-06`.

## 53. Decided — reliance freezes a legal version, and an unapproved draft may be deleted (2026-09-07)

**Status:** Decided. Adds `deleteDraftVersion` to `modules/legal-documents/service.ts`, a third
reliance count to `listVersionsForBackoffice`, and a row-count check to `approveVersion`.
Narrows §46 rather than reversing it. `AGENTS.md` §12.5, BR-REQ-053-02.

§46 froze an approved legal version, and gave one reason: a participant signed version 3, and
rewriting version 3 leaves their signature describing text nobody agreed to. That reason is
about **reliance**, not about approval — so the obvious next move was to let the club edit,
un-approve and delete any approved version nothing had relied on. Three of those four verbs are
not being built, and the reasons are worth recording, because each one looks safe until the
codebase is read.

### What is built: delete, for a version that was never approved

A draft has never been in force. `findCurrentApprovedDocument` filters on `is_approved`, so no
public page has rendered it; a registration records whichever version was current, so none can
name it; and an acceptance is written only against what was current, so none can point at it.
Nothing can have relied on it, and without this the club's document list grew by a row every
time somebody started typing and thought better of it, with no way back.

An approved version is still never deleted, whatever its counts say — and that is a *different*
rule from "nothing relies on it". Approval is the club publishing words as its own; the record
of what it published, and when, outlives whether anybody happened to act on it.

### The reliance nobody could see

`listVersionsForBackoffice` showed two counts, one per foreign key: acceptances and events.
Both are real, and together they were wrong about the most relied-upon document the club has.

A privacy notice is referenced from `registrations` by **version number** —
`privacy_notice_version`, `results_consent_version` and `health_consent_version` are all plain
`integer` columns with no foreign key at all. Only `EVENT_DECLARATION` versions ever get a
`declaration_acceptances` row, so a privacy notice that four hundred people had acknowledged
appeared on the backoffice screen as "not used yet", and PostgreSQL would have raised nothing
whatsoever if it were deleted. The third count exists so the screen stops saying something
false, and it is checked before any deletion.

### Why un-approve is not built, which is the substantive finding

Withdrawing an approval is the verb the club would actually want, and it cannot be made safe
here without changing the registration lifecycle.

**A declaration is bound to the participant at POST, not at render.**
`registrations/declare/[token]/page.tsx` resolves the text with
`findCurrentApprovedDocument(...)` and renders it. The form posts four fields — `locale`,
`token`, `accepted`, `typedName` — and no version, no document id and no hash. Then
`registrations/service.ts` calls `findCurrentApprovedDocument` **again**, independently, and
writes the acceptance from whatever *that* returned. So the row records the version that was
current when the button was pressed, not the version the person read.

Un-approving exists precisely to change which version is current, on the next request, with no
deploy. It would therefore let somebody read version 3 and have version 2 recorded as the text
they signed — the exact failure §46 exists to prevent, arrived at from the other direction. The
same split applies to the privacy notice at submission, and there the fallback is worse: every
environment but production seeds a **sample** notice whose own first heading reads "SAMPLE TEXT
— NOT APPROVED", so withdrawing a real version can silently promote that back into force and
stamp real consent records against it.

The fix is to bind the signature where it is read: carry the resolved document id and
`content_sha256` as hidden fields and refuse a signature against anything else. That is a change
to the registration lifecycle, it needs its own requirement and its own tests, and it must land
before un-approve is worth revisiting. **This is a pre-existing defect** — approving a *new*
version between a participant's GET and POST already triggers it today — and it is recorded here
rather than fixed here because the console work was scoped to exclude the lifecycle.

Editing an approved-but-unreferenced version is refused for a smaller reason: `content_sha256`
is published under a version number and `docs/RUNBOOKS.md` verifies against it, so text that
changes under a fixed number makes that check meaningless.

### One thing the new verb broke, and the guard for it

Until a `legal_documents` row could be deleted, `approveVersion`'s `UPDATE ... WHERE id = $1`
could never match zero rows, so it ignored the count. It now asserts one row and refuses
otherwise: a draft deleted in another tab would have left the update matching nothing and the
screen reporting that the club's legal text was in force when no such row existed.

Baseline `BR-V1.27-2026-09-07`.

## 54. Decided — a loading boundary may not sit above a `notFound()` (2026-09-07)

**Status:** Decided, after the end-to-end suite caught it. Shapes where `loading.tsx` files live
under `src/app/[locale]/admin`, and adds a `layout.tsx` per gated section. BR-REQ-060-01.

The application had no `loading.tsx` anywhere, so every backoffice click left the old page on
screen — unchanged and unmarked — until the server answered. Adding one per route is the
obvious fix and it quietly broke authorization.

### What happened

`loading.tsx` wraps what is below it in Suspense, and Next flushes the shell as soon as it has
one. The status line goes out with that flush. Every `/admin` page authorizes by calling
`notFound()` — deliberately, because §10.2 refuses to confirm that a screen an Author may not
open exists at all — and a `notFound()` raised *after* the flush cannot change a status that has
already been sent.

So an Author requesting `/admin/staff` got **200, with the not-found page in the body**. It looks
identical in a browser and is not the same thing at all: a 200 is not a refusal to a crawler, a
monitor, an uptime check or a script. Two end-to-end tests assert `404` on exactly those two
routes, which is how this was caught rather than shipped.

### Two rules, and the route groups that follow from them

**A `loading.tsx` must not sit above a `notFound()`.** It applies to its own segment *and every
descendant*, so:

- the root `admin/loading.tsx` is gone. It covered all six sections, and defeated every gate
  beneath it — including gates written into section layouts specifically to outrank it;
- a section's role gate moved into a `layout.tsx` beside its boundary, which renders **before**
  there is anything to flush. The page still asserts the same rule, because a page is a request
  of its own and a guard that depends on a parent is one that disappears the first time the page
  is rendered from somewhere else. The layout is there for the status code alone;
- the lists that have `[id]` and `new` siblings — registrations, pages, legal, and the events
  overview — moved into a `(list)` route group, so their boundary covers the list and nothing
  else. A route group changes no URL, which is why `routing.pathnames` is untouched and the
  architecture test that pins it still passes;
- the editor and detail routes get **no** boundary at all. Their `notFound()` is a missing row —
  a deleted event's URL — and that has to stay a 404. They are also the routes where a stale
  page on screen is least confusing, because the organizer arrived by clicking a specific row.

The trade is explicit: the longest waits in the backoffice are the editors, and they are the
routes that keep no loading state. Fixing that means moving the row lookup into a layout and
querying twice, which buys a skeleton with a duplicated query on the slowest page. Not worth it
today, and written down so the next person does not rediscover the constraint by breaking a
status code.

Baseline `BR-V1.27-2026-09-07`.

## 55. Decided — the production half of the topology, and a domain that will change (2026-09-16)

**Status:** Decided and largely done. Creates the production Vercel and Neon projects and the
GitHub gate; records the domain plan; corrects what the documents claimed and the providers did
not. BR-REQ-101-01, BR-REQ-101-02, BR-REQ-080-03, BR-BUS-101. Written to the owner's standing
instruction, restated today as "the entire codebase must be vibecode friendly": every step below
is a command, every value is where a command can read it, and the reasoning sits next to both.

### What was true before anything was touched — read back, not assumed

- **GitHub.** A `qa` environment with `DATABASE_URL` and `APP_BASE_URL`; `Production` and
  `Preview` environments created by Vercel's GitHub app on 2026-09-04, empty, with no protection
  rules. Environment names are case-insensitive, so `migrate.yml`'s `production` already resolved
  to that `Production` — and with no reviewer on it, the "gate" §7.6 promised was a formality.
  The repository is public, which is what makes required reviewers available on the Free plan.
- **Vercel.** One project. `serverlessFunctionRegion: iad1` and Node `24.x`, while every
  document said `fra1` and the database sits in `eu-central-1`. The documents described the
  intent; nobody had read the setting back.
- **Neon.** The QA project in AWS Frankfurt; no production project; no Neon credential on the
  machine. The CLI authenticates through a browser, which an agent's shell cannot open — and a
  login it starts prints a callback link on a port that is closed by the time a person clicks it.
  The owner ran `npx neonctl auth` in his own terminal; that is the one step that stays his.
- **Mailgun.** An account since 2026-09-05 with exactly one domain, the sandbox. `CLAUDE.md`
  still listed "a Mailgun account" as owed. What is owed is a *verified sending domain*.
- **Domains.** Neither candidate resolved on the morning of 2026-09-16 (RDAP 404, NXDOMAIN). By
  the afternoon the owner had bought the `.com`, and `yarn domain:bind production` bound it —
  apex serving, `www` redirecting, `APP_BASE_URL` moved — with Vercel accepting the domain on a
  project that had never deployed.
- **`main`** is sixty commits behind `qa` — the last promotion was PR #7 — and `migrate.yml` does
  not exist there. The first production deployment is therefore the first release PR, and the
  production database cannot be migrated by the workflow until that PR lands.
- **`scripts/bind-domain.mjs`** read the token from the Vercel CLI's credentials file. CLI 59
  stores an OAuth access token with an expiry — 2026-09-07, in this case — refreshes its copy in
  memory and never rewrites the file, and the REST API answers 403 `invalidToken` to the stale
  one. The script also took the project from `.vercel/project.json`, which links this checkout to
  QA: `yarn domain:bind production` would have bound the club's domain to the QA project.
- **The environment marker of `AGENTS.md` §7.4** — `app_environment_metadata`, checked at
  startup, migrate, seed and reset — is not implemented. Nothing under `src/db` creates or reads
  it. Named in §7.4 and in `SETUP.md` §25 rather than ticked.

### What was done

- **GitHub `production`:** required reviewer (the owner), deployment branch policy `main` only,
  `APP_BASE_URL` and `DATABASE_URL` secrets. `can_admins_bypass` stays true — a dashboard-only
  setting, and the owner is both admin and reviewer, so the gate is a deliberate click either way.
- **Vercel `brasov-runners-production`:** Next.js, `fra1`, Node `22.x`, GitHub-linked with
  production branch `main`, and an ignored build step that builds only `main` — a pull-request
  branch would otherwise get a preview deployment on the production project running with no
  variables at all, that is, with `APP_ENV`'s local defaults. Variables: `APP_ENV=production`,
  `APP_BASE_URL`, `DATABASE_URL` (Neon production, pooled), `MAP_LINK_BASE_URL`,
  `ENABLE_EXPERIMENTAL_COREPACK=1`, a fresh `JOB_SECRET`, a fresh `AUTH_SECRET`,
  `STAFF_AUTH_MODE=disabled`, `EMAIL_DELIVERY_MODE=capture`. Nothing copied from QA. Set through
  a scratch directory linked to the production project, so this checkout stays linked to QA.
- **Neon `brasov-runners-production`** (`lively-haze-50960748`), `aws-eu-central-1`, PostgreSQL
  18, on the Free plan — which allows 100 projects (checked 2026-09-16), so the second one costs
  nothing. Pooled URL to Vercel, direct URL to the GitHub environment, neither anywhere else.
- **Production email is `capture`, on purpose,** until a sending domain is verified. `env.ts`
  deliberately does not force `live` in production — its own comment says why — and `/devs`
  reports capture on a deployed environment as *limited* (BR-REQ-090-04). §7.2 now says so.
- **The QA region fix was refused** by the agent's permission layer as a change to a shared
  resource; the command is in `SETUP.md` §26 for the owner. Production was created correctly
  from the start.
- **`bind-domain.mjs` rewritten:** every call through `vercel api`, the project by the
  environment's name, `www` → apex as a 308 set on the host at add time, `--alias-of` for a
  second domain. The DNS records come from Vercel's domain-config endpoint rather than from a
  literal in the script.
- **`scheduled-jobs.yml`** gained the production row; it skips with a notice until the two
  repository secrets exist. They are set on deployment day, not before — a host that is not
  serving yet turns every five-minute run red, and a red run nobody reads is how the next real
  failure gets missed.
- **Smoke and scheduler targets stay on the provider hostname**, which resolves whether or not
  the club's DNS does yet. `/api/health` does not care which host it is asked on.

### The domain: `.com` now, `.ro` in a year, both alive

The owner's decision, 2026-09-16: register the `.com` for a year, add the `.ro` later, keep
both, and **switching must be easy**. Everything needed already followed from rules in force:
`APP_BASE_URL` is the one canonical host (§8); every other hostname is a permanent redirect to it
(BR-REQ-101-02 criterion 4, now criterion 5 for the second domain); cookies are host-only, so a
switch costs each staff member one more sign-in and participants nothing — they hold no session,
and every email link is built from `APP_BASE_URL` at send time. The Mailgun sending domain need
not match the site's host; DKIM alignment is about the `From` address. So the switch is
`yarn domain:bind production <new> --apply`, `yarn domain:bind production <old> --alias-of <new>
--apply`, the new redirect URI in Zitadel, a redeploy, `yarn smoke`. `docs/RUNBOOKS.md` § Switching
the canonical domain is the checklist; nothing under `src/` moves.

Price, so it is not re-researched: Verisign's `.com` wholesale is $10.26 a year until 2026-11-01
and $10.97 from then on (announced 2026-04-23; checked 2026-09-16). `/admin/tasks` and
`docs/PLATFORM.md` quote it in USD, the registry's own currency, and keep asking what the
registrar actually charged.

### Zoho Mail beside Mailgun — asked, answered, not decided

The owner asked whether the club can also have mailboxes on the domain. Zoho Mail's free plan
(checked 2026-09-16): up to five users, 5 GB each, one domain, web access only. It coexists with
Mailgun cleanly if the domain is split by function: Zoho owns the apex — its MX, its SPF include,
its DKIM — and Mailgun sends from a subdomain, `mail.<domain>`, which `MAILGUN_DOMAIN` and
`EMAIL_FROM_ADDRESS` then carry, with `EMAIL_REPLY_TO` on a Zoho mailbox somebody reads. Two
services on one apex would fight over the MX and the SPF record; two hostnames never do.
Configuration only. It becomes a decision on the day the DNS is edited
(`docs/RUNBOOKS.md` § Domain binding, step 2).

### Two questions asked during this work, recorded so they are not re-researched

- **"Next, we need to be able to edit documents."** The next task. Not *edit*: §46 and §53 fix an
  approved version's words for good, because a participant relied on them. What is wanted is
  drafting the next version in the backoffice and approving it there — which exists for drafts
  today — with the ergonomics of an editor rather than a JSON body, and the §53 binding defect
  fixed with it, because a version change between a participant's GET and POST records the wrong
  text today.
- **"What is a good solution for online document signing?"** The declaration acceptance already
  built — a typed name, a verified email address, the `content_sha256` of the version shown, the
  time — is what eIDAS calls a *simple* electronic signature: admissible as evidence, not
  presumed equivalent to a handwritten one. Whether that suffices for a race declaration is the
  club's adviser's call, not this repository's, and the runbook already forbids calling it
  *qualified*. A qualified signature needs a qualified trust-service provider from the EU trusted
  list, costs per signer, and is an integration rather than a rule change — disproportionate for
  a start-line declaration unless the adviser says otherwise.

### What is still owed, and who

| Owed | Who | How |
| --- | --- | --- |
| DNS records for the `.com` at the registrar — an A record on the apex, a CNAME on `www` | owner | printed by `yarn domain:bind production <domain> --apply`, which on 2026-09-16 bound the apex and `www` to the production project and moved `APP_BASE_URL`; the records are in the owner's `.env.local` copy and on the Vercel Domains screen |
| Zitadel production application | owner, console | `docs/RUNBOOKS.md` § Staff sign-in; the four variables by the commands there |
| Mailgun sending domain, EU region, on `mail.<domain>` | owner, console + registrar DNS | § Domain binding, step 2 |
| Release PR `qa → main`, gated migration, `staff_users` row, smoke | owner + agent | § The first production deployment |
| `PRODUCTION_APP_BASE_URL`, `PRODUCTION_JOB_SECRET`, two pinger monitors | owner | deployment day, `SETUP.md` §26 |
| QA function region `fra1` | owner | one command, `SETUP.md` §26 |
| Approved legal text | the club | § Legal document version |
| Environment marker (§7.4) | a future task | not built; named, not ticked |

Baseline `BR-V1.28-2026-09-16`.

## 56. Owner direction — team mail on Zoho, application mail on a subdomain, a signed declaration PDF by email (2026-09-16; planned, not specified)

**Status:** Recorded, not decided into a rule. Nothing here is built, and nothing here changes a
requirement yet. It arrived as a handoff from a conversation the owner had elsewhere and is written
down so the next task starts from the facts and the contradictions, not from a second conversation.

### CURRENT, verified on 2026-09-16

- `<domain>` (the `.com`) is registered at ROMARG for one year, on ROMARG's nameservers, edited in
  its cPanel Zone Editor. The zone holds exactly three records — the apex `A`, the `www` CNAME and
  a `qa` CNAME — and the registrar's default FTP, `mail` CNAME and MX records were removed on
  purpose. No MX, no `mail.` record: nothing on the domain receives mail. HTTPS is Vercel's; FTP
  is not used. `SETUP.md` §26 has the table, and is the only file allowed to.
- Production: apex serves, `www` answers 308 to it, `APP_BASE_URL` is the apex. QA: the `qa`
  hostname is attached and verified on the QA project, but QA's `APP_BASE_URL` still names the
  provider host, so QA's sitemap and email links do too; the switch waits on the QA Zitadel
  application's redirect URI (`SETUP.md` §26). The handoff's "QA is `qa.<domain>`" is therefore
  half true today.
- The deployment `<domain>` serves is a **production-target build of the feature branch**
  (`c600e2e`, 2026-09-16 11:15Z, source `git`), made before `main` carried any of it, against an
  unmigrated database — `/api/health` answers 500. How Vercel came to treat that push as
  production while `productionBranch` reads `main` was not determined. It is superseded the
  moment the release PR lands and the gated migration runs; nothing points a visitor at the
  domain yet.

### PLANNED, in the owner's words, and what each collides with

1. **Team mail on Zoho Mail** — mailboxes for the administrator and two organizers, and a public
   `contact@<domain>` all three read (a shared mailbox, or a group if the plan lacks one). No
   collision: Zoho takes the apex MX, SPF include and DKIM. Free plan checked 2026-09-16: five
   users, 5 GB each, one domain, web access only. **Reopened 2026-09-17: the provider is not chosen.** Zoho's usable
   tier is paid, so it is now the fallback rather than the plan. The club has applied for a
   nonprofit grant from **Google**, and **Microsoft** is the other candidate; whichever is granted
   first takes the apex. No entitlement of either grant is recorded until one is granted (§1.2).
   The split with application mail is identical whichever provider wins, which is why this stays
   one open question rather than three designs.
2. **Application mail on a subdomain, planned name `mail.<domain>`** — not configured, no DNS
   values exist, none invented. §55 had said `mg.<domain>`; the owner's name wins and the runbook
   now says `mail.<domain>`. **The provider is Mailgun**: the adapter is built, the account exists,
   the webhook verifies Mailgun's signature. The handoff says "Mailgun/Brevo". Brevo is a
   different HTTP API, a different failure vocabulary for the outbox (§40 mapped Mailgun's), and a
   different webhook — an adapter and a rule change (`AGENTS.md` §16, BR-REQ-080-*), not a
   configuration switch. Not decided; Mailgun stands until it is.
3. **A signed declaration PDF by email.** Desired: form → read and accept the declaration → draw a
   signature with mouse or touch → the server renders a PDF in memory → emails it to the
   participant and a copy to `contact@<domain>` → stores no PDF, no signature image, only
   `accepted / signedAt / version`. Four collisions, none fatal, all to be settled before it is
   specified:
   - **Where signing happens.** Today the declaration is signed from the participant's own
     verified email link, inside the 30-minute hold, never straight after the form — that is what
     makes "no registration without a verified address and a declaration" true (`AGENTS.md`
     §10.8, §15.3; BR-REQ-035-*). A drawn signature can sit on that page; it cannot move the step
     before verification.
   - **What is already stored.** `declaration_acceptances` (§12.7) records the version, its
     `content_sha256`, the timestamp, the typed name and the request context — more than the
     handoff's three fields, and it *is* the evidentiary record. Adding a drawn signature adds a
     picture, not proof: typed name plus verified email is already a simple electronic signature
     (§55). The picture is a product choice, and the rule that no signature binary is persisted is
     compatible with today.
   - **The copy to the club mailbox is a disclosure.** A PDF naming a participant and their
     address, sent to a shared inbox and kept there as the archive, is personal data processed
     for a purpose the privacy notice has to name, with a retention period `SETUP.md` §30 still
     lists as owed (BR-REQ-070-*; `AGENTS.md` §19.2). A mailbox is also a place three people can
     forward from. This is the club's decision to make with its adviser, added to `BUSINESS.md`
     §9.
   - **The §53 defect comes first.** The PDF must carry the exact version the participant
     accepted; today the accepted version is resolved twice, at GET and at POST, and can differ.
     Fixing that binding is a prerequisite, not a follow-up.
   Suggested subject `Declaratie - <event> - <participant>` and attachment
   `declaratie-<participant>-<event>.pdf`, PDF content: name, address, event, declaration text,
   signing time, visual signature, version — recorded as the owner's sketch, to be made a
   requirement in `SPECS.md` with the collisions above resolved. Rendering a PDF in a serverless
   function is also a dependency decision under `AGENTS.md` §1.5; no library is chosen here.

### Storage decision, as stated and as it maps

No signed PDF in PostgreSQL, Vercel Blob, R2, S3, the filesystem or a base64 column; the
participant's inbox and the club's mailbox are the archive. Compatible with everything built: the
application stores an acceptance row and never a document. If a requirement later wants the PDF
reproducible, it is regenerated from the stored version and hash, not retrieved.

Baseline `BR-V1.28-2026-09-16`.

## 57. Decided — a signature is bound to the text that was read, and "editing" legal text is the next version, prefilled (2026-09-17)

**Status:** Decided and built. Closes the defect §53 recorded. BR-REQ-033-02 criterion 6,
BR-BUS-033, `AGENTS.md` §15.3. The owner's ask was "we need to be able to edit documents".

### What was wrong, restated in one sentence

The declare page resolved the current declaration and rendered it; the form posted a token, a
checkbox and a typed name; the service resolved the current declaration *again* and recorded that
— so a version approved between GET and POST was recorded as the text the participant signed.

### What changed

- The page posts `documentId` and `contentSha256` of the version it rendered. `signDeclaration`
  compares both with the version current at signing time and throws `CONFLICT`
  (`DECLARATION_CHANGED`) on a mismatch. The throw happens inside the transaction that also
  consumed the action token, so the token is not spent; the action redirects to the same page
  with `?changed=1`, which shows the current text and a notice to read and sign again. Two
  integration tests in `registrations/lifecycle.test.ts`: a version approved between render and
  post is refused with nothing written and the registration still `PENDING_DECLARATION`, then
  re-reading records version 2 and its hash; a tampered hash or id is refused.
- Nothing else in the lifecycle moved: the hold check, the allocation on a lapsed hold and the
  waiting-list acceptance path run exactly as before, one `if` earlier than the insert.

### What did not change, and why

- **The privacy notice at submission** has the same GET/POST split (§53 named it). It is left as
  is: the notice is *linked*, not read inline, the participant acknowledges "the current notice",
  and approving a newer version is monotonic — the version recorded is at least as new as the one
  linked. Binding it would need the notice rendered inline or its hash carried through a page the
  participant never sees. Named here rather than done.
- **Un-approving a version** is still not built. §53 made this fix its precondition; the
  precondition is now met, and the verb is not asked for. If it is, it is a small change now.

### "Editing", as the owner meant it

Approved words are fixed by §46 and §53, because participants relied on them. What the owner ran
into was not the rule but the ergonomics: version n+1 began as an empty form, so a one-word
correction meant pasting the whole text back in. An approved version's page now offers *Start the
next version from this one*, which opens the new-version form prefilled from it, key locked. A
draft was and is editable in place. The notice on an approved version used to say legal text "is
not edited from the backoffice" — false since §46 — and now says what the fixed text means and
what to do instead.

Baseline `BR-V1.29-2026-09-17`.

## 58. Decided — the editor arrives for standing pages, allowlisted end to end (2026-09-17)

**Status:** Decided and built. Implements the Tiptap contract of `AGENTS.md` §11.3 for standing
pages, and only for them. BR-REQ-050-03 criteria 10-11, BR-REQ-052-02 criterion 1.

### Why now, when §51 said the opposite

§51 chose a plain-text body for standing pages and gave a good reason: pulling the Tiptap contract
forward to write one About page would decide the M5 schema for the wrong reason. What changed is
that the owner sat down to write the About page and the format was the obstacle — "I need to
create and edit the about page", 2026-09-17. The reason §51 gave has also weakened: the contract
in §11.3 was already written and agreed, so implementing it decides nothing that was still open.

### Three files, because they do three different jobs

- **`domain/schema.ts` is the allowlist**, and the only thing that decides what may be stored. It
  runs on the server, because the editor runs in somebody else's browser and what arrives is
  whatever that browser chose to post.
- **`ui/RichText.tsx` renders it**, by walking the document. This is the stronger half of the
  security property: a node type with no `case` here cannot appear on a page whatever is in the
  column. No `dangerouslySetInnerHTML`, no HTML generation, no virtual DOM on the server, and no
  third dependency to do it.
- **`ui/RichTextEditor.tsx` is the one client island**, and it switches off everything StarterKit
  ships beyond §11.3's list. Not for safety — the schema already refuses them — but so that an
  organizer is never offered a control whose output the save would then reject, at the end of a
  long edit, with no explanation.

### Decisions inside that are worth stating once

- **Links are the dangerous part, and are treated as such.** An `href` is one of the few places a
  string becomes code. `javascript:`, `data:` and `vbscript:` are refused; so is `//host`, which
  parses as protocol-relative and leaves the site without looking like it. `target`, `rel` and
  `class` are **dropped** on the way in and decided by the renderer on the way out, so every
  external link carries `noopener noreferrer` — including in a body written before that rule.
- **Attributes are stripped, node types are refused.** Dropping an unknown attribute loses nothing
  the club wrote; dropping an unknown *node* would silently delete a paragraph. So one is a
  `z.object` and the other a discriminated union.
- **A read-time adapter, not a migration.** A deployment and its migration start together, so for
  a few seconds code and rows disagree (§7.6). Converting the old section shape on read means old
  and new rows both work during that window and for as long afterwards as nobody edits them.
- **Legal documents are not touched and will not be.** `content_sha256` is computed over their
  shape and published under a version number; changing it would invalidate every hash an
  acceptance names (§12.5, §46). Their textarea stays.
- **Events are not touched either.** They carry a `body_json` column no editor writes and no page
  renders. Giving events a body is a product decision about what an event page says, not a
  consequence of this one.
- **No nested lists, no images, no hard breaks.** Nesting is one `z.lazy` away and nobody asked.
  Images need a media library, which needs R2 and an upload route, and uploads are the one
  unguarded surface §19.4 still names. Hard breaks, code, strikethrough and underline are simply
  not in §11.3; adding one is a rule change in two places at once, which is the point.
- **Words on the toolbar, not icons.** `@mui/icons-material` would be a dependency for one screen
  (§1.5). "B", "I", "H2" also read without hovering.

### Four smaller things the owner asked for in the same session

- The footer is one line: legal links and "about the club" share it, the club block opens beneath,
  and the club's Facebook and Instagram sit in it. Those two are **configuration**
  (`CLUB_FACEBOOK_URL`, `CLUB_INSTAGRAM_URL`), because §8 forbids a hostname under `src/` and
  exempts no provider — and the same values complete the `sameAs` that BR-REQ-052-02 has wanted
  since it was written, and that `structured-data.ts` said in a comment it was waiting for.
  `logo` is still absent: it needs a raster the club has approved for the purpose, and the SVG is
  not one.
- The "not production" banner links to the club's real site (`PRODUCTION_SITE_URL`, qa only). A
  visitor sent a QA link had no way to reach the real one, which is the entire reason §7.5 asks
  for the banner.
- The build badge says `app-ver`, the version and an ISO date. "ultima actualizare · 17 sept.
  2026" was read as the date the *club* last posted something. ISO also reads identically in both
  languages, which a month name does not.
- The header shows the club's name once, and by 2026-09-17 evening it shows it in the club's own
  lettering. Three arrangements were tried in one day, which is worth recording because each
  failure explains the next: the **lockup at mark height** (28px) rendered its wordmark about
  four pixels tall; the **mark plus live text in the kit face** put the name on the row twice, in
  two typefaces, unalignable because one is baked into a 2.42:1 image; the **lockup at 44px** is
  what shipped, because the problem was never which wordmark to show but how much room it had.
  The browser tab showed the lockup throughout. With nothing rendering the kit face, its 36 kB is
  no longer loaded — the saving that `BR-V1.29` claimed and `BR-V1.30` reversed.

Baseline `BR-V1.30-2026-09-17`.

## 59. Decided — the optional groups open, the page widens, and the consents are reworded rather than removed (2026-09-17)

**Status:** Decided by the owner from the running site; built. Reverses the collapse in §47.
BR-REQ-041-01, BR-REQ-031-06, BR-REQ-072-01, BR-REQ-039-01.

### The optional groups are open by default

§47 folded the t-shirt, the club, the display name and the health note behind native `<details>`,
closed, and saved 580px on a 390px-wide phone. The owner's report today was that the form was
missing a field for the runner's own club. It was not missing; it was folded, and a field behind
a summary nobody opens is a field nobody fills. The groups open by default now and stay
`<details>`, so anybody who wants the page shorter can fold one. The consents were never folded
(§47's own rule) and are unchanged in that respect.

### The page is `lg`, and prose keeps its measure

The header's navigation overflowed at `md` and grew a scrollbar; the owner asked for a wider
page. The shell and the content pages are `lg` (1200px). Prose pages — standing pages, the
legal texts — cap their column at `PROSE_MEASURE` (44rem, about 75 characters), because a wider
page must not buy longer lines. Left edges therefore align with the logo, and paragraphs stay
readable. Forms stay narrow and centred, which is what a form is.

### Three consents remain, and why

"Sunt prea multe acorduri." Each of the three exists because a rule says it must:

| Consent | Rule | What removing it costs |
| --- | --- | --- |
| Privacy notice acknowledgement (required) | BR-REQ-070-01, GDPR Art. 13 | Cannot be removed |
| Name in public results (optional) | BR-REQ-072-01 criterion 1 | M2 could not publish results for anyone who registered before it, without asking each again — criterion 5 says this consent exists *only* so M2 can publish lawfully |
| Public participant list opt-out (optional) | BR-REQ-039-01 criterion 5: "on every event, whatever that event's current setting" | An organizer turning the list on after registrations closed would list people who never saw an opt-out — the exact case criterion 5 was written for |

The one that *could* go with a rule change is the results consent, deferred to M2 and collected
from the management page when results exist (criterion 4 already allows changing it there). The
cost is asking again later; the benefit is one checkbox fewer now. Not done: it is the owner's
call, recorded here so it is a decision rather than a rediscovery. What was done is wording —
each optional consent now says the same thing in half the words.

Baseline `BR-V1.32-2026-09-17`.

## 60. Decided — no React element crosses the server/client boundary as a prop (2026-09-17)

**Status:** Decided and applied everywhere it occurred. Adds a rule to `AGENTS.md` §14.1.
Found while laying the registration form out in two columns.

### What happened

Two wrapper elements were added around the registration form's sections. Nothing else changed
in what the page rendered, and the page began answering 500 with
`TypeError: Cannot read properties of undefined (reading 'disabled')` from inside MUI's
`FormControlLabel`. The production build and the development server failed identically, from
a clean `.next`. Bisecting one piece at a time — the responsive spacing, the summary's style,
the container width, the heading, the wrappers as MUI `Stack`, as a CSS-grid `Box` — took
five builds and pointed only at "any wrapper at all", which made no sense until the browser's
error overlay gave the frame the server log hides.

### The mechanism

`FormControlLabel` reads `control.props.disabled`. `control` is a prop, and the page is a
Server Component, so `control={<Checkbox />}` is a React element crossing the server/client
boundary **as a prop**. React serialises it. For a small tree the element arrives whole. Once
the tree passes a certain depth, React outlines the subtree into a later row of the payload and
the client component receives a lazy reference — an object with no `props` — in its place.
The two wrappers were the depth that tipped it.

The development server had been failing on this page since `BR-V1.26`, recorded in the local
notes as a Turbopack manifest quirk with the advice to use a production build. It was this. The
production build was one wrapper short of it the whole time.

### The rule, and the fix

Children are the channel React designs for; an element-valued prop is not. So: **a React element
is never passed as a prop from a Server Component to a Client Component.** Where a client
component's API demands one, a small client component makes the element on its own side of the
boundary. `shared/ui/CheckboxField` does that for the checkbox-and-label pair and takes the
label as children — which may carry a link, as the privacy acknowledgement does. Every Server
Component that built a checkbox the old way now uses it: the registration form, the declaration
page, the staff-entered registration, the event editor's live-edit acknowledgement, the legal
approval and the registration delete confirmation. The declaration page is on a trust-carrying
path and was one deep tree away from the same 500.

### Why it is a rule rather than a fix

The failure has no local symptom: the code that breaks is not the code that changed, the error
names a library internal, the log hides the frame, and the trigger is the *shape* of a tree
that any unrelated edit can alter. A rule at the boundary is the only thing that catches it
before a build.

Baseline `BR-V1.32-2026-09-17`.

## 61. Decided — an event has a type and a surface, the map is a pasted link, Strava is a mark and never a script, and the task board is today's list (2026-09-17)

**Status:** Decided and built. Changes BR-BUS-010, BR-REQ-010-01, BR-REQ-011-01 criteria 7–8,
BR-REQ-050-01 criterion 1, BR-REQ-052-02 criterion 1; `AGENTS.md` §8, §10.1, §12.3; migration
`0023`. Owner direction, given in one sitting on 2026-09-17, with the reasoning recorded here so
none of it has to be re-argued.

### One enum was answering two questions

`event_kind` had seven values — community run, trail run, interval session, long run, meetup,
race, other — and the list mixed what an event *is* with *where* and *how* it is run. "Trail run"
said the surface; "interval session" and "long run" said the session shape; and the club had to
pick one chip for a long run on trail. It is two columns now:

- **`events.type`** (`event_type`, NOT NULL): `GROUP_RUN`, `RACE`, `HIKE`, `COFFEE`, `MEETUP`.
  The owner's first cut was three (group run, race, meetup — "special meetups like shoe testing
  are MEETUP with the theme in the title, no fourth value"). Hike and coffee were added the same
  afternoon, on his word that the club holds both regularly enough for each to be its own thing;
  `MEETUP` is what is left. The session shape — intervals, the long run — is the title's job.
- **`events.surface`** (`event_surface`, nullable): `ASPHALT`, `TRAIL`, `MIXED`. Null means the
  club has not said, or it is a coffee and there is nothing to say.

Conversion, in the migration: `COMMUNITY_RUN`, `INTERVAL_SESSION`, `LONG_RUN` → `GROUP_RUN`;
`TRAIL_RUN` → `GROUP_RUN` with surface `TRAIL`; `RACE` → `RACE`; `MEETUP`, `OTHER` → `MEETUP`.
Every old value maps to exactly one new one, and `TRAIL_RUN` is the only one that carried a
surface. The `race_id ⇒ RACE` check moved from `kind` to `type` under a new name, and so did the
`(kind, starts_at)` index.

**The owner said he will "vibecode this later" and wants it flexible.** So, for the next person:
a sixth type or a fourth surface is one migration — `ALTER TYPE "event_type" ADD VALUE 'X'` — plus
the value in `src/db/schema/events.ts`, in `EVENT_TYPES` or `EVENT_SURFACES`
(`modules/events/domain/event-type.ts`), and a label under `Event.type.*` or `Event.surface.*` in
both catalogues. `tests/unit/i18n/messages.test.ts` fails until the label exists, which is the
whole of the exhaustiveness check. Nothing else names a value: the editor, the chips and the
overline iterate the arrays.

### The migration is one file, against §7.6, on purpose

`AGENTS.md` §7.6 prefers expand/contract: add in one release, drop in the next. `0023` adds,
converts and drops in one step, by the owner's instruction, and the reason it is safe enough to
record rather than refuse: `type` is NOT NULL from the first release that reads it, so no version
of the code can run against both shapes — the split would buy a window in which `kind` is
written and `type` is not, not a window in which both work. The cost is honest: on QA, the
seconds between the migration finishing and the build going live serve 500s. Production has never
served a request, so its first migration run applies the whole chain before any code reads the
table. A future rename should still split; this one was a rename of a NOT NULL column with a
data conversion, which is the case the split does not help.

### Coordinates were "stupid — just a Google Maps link"

`latitude` and `longitude` were two decimal numbers an organizer typed by hand so the application
could assemble a link they could have pasted from the map they were already looking at. They are
dropped in the same migration with their two CHECKs, and `map_url` — already there, already
https-checked, already what the page preferred when set — is the meeting point on a map, full
stop. `MAP_LINK_BASE_URL` went with them: it existed only to keep the assembled link's hostname
out of `src/`, and a pasted link has no hostname in `src/` to keep out. `modules/events/domain/
map-link.ts` is deleted rather than reduced to `return event.mapUrl`. The `SportsEvent` block no
longer emits `geo`; `hasMap` stays and is the same link the page renders. A pin guessed from a
place name would be wrong, and wrong is worse than absent.

### Distance, climb, difficulty, route: all settable, and on the card

All four were already on the editor and the event page. What was missing was the climb and the
difficulty on the listing card, where only the distance showed; both are text and both render on
the card now. The route link stays off the card, and that is not an omission: the card is one
link (`CardLink`), and an anchor inside an anchor is invalid HTML the browser silently splits
(BR-REQ-011-01 criterion 8, §49).

### Strava: the mark, never the script

The route link is labelled "link către traseu — a Strava route or activity, or any https link",
and when its host is `strava.com` the page shows Strava's mark beside "Vezi traseul".
**No Strava embed script**, for the same reason Turnstile is not built (`CLAUDE.md` § Spam): an
embed is a third-party script that runs on the visitor's browser and reports to Strava, which
makes Strava a processor the privacy notice does not name. The mark is an inline SVG path in
`shared/ui/SocialIcon.tsx`, ships in the HTML, and phones home to nobody. The host check
(`isStravaLink`) is a *comparison* of what an organizer pasted, not an emitted address, which is
the distinction §8 draws — and `docs:check`'s scan is scheme-anchored, so it does not flag it.

The club's Strava club page joins Facebook and Instagram in the footer and in `sameAs`:
`CLUB_STRAVA_URL`, optional like the other two, set in `.env.local` and in both Vercel projects,
never in a tracked file.

### The task board is today's list

`/admin/tasks` said the domain was not bought (it was, on 2026-09-16, and QA already answers on
`qa.<domain>`), argued about a Zitadel custom login domain (decided against: the provider
hostname, free tier — `docs/RUNBOOKS.md` § Staff sign-in), and carried a "decisions" section
of answered questions and an "alternatives" section that was a history. It is six tasks now,
every one still read from the system and none ticked by hand:

- approve the legal texts — blocking until a non-sample privacy notice is approved;
- the Mailgun sending domain `mail.<domain>` and `EMAIL_DELIVERY_MODE=live` — blocking; the
  detail names the current mode;
- the two production monitors — blocking, read from job health, naming the late job;
- invite the team from `/admin/staff` — open until `staff_users` has more than the one row
  inserted by hand;
- publish events — open until the listing has one;
- the `.ro` domain in a year — open, never blocking, done when `APP_BASE_URL` ends in `.ro`.

The service rows stay where they read true: the domain row says *bought* and which hostname
this deployment answers on; Zitadel's says the one limit that matters is the single account
administrator; the scheduler row names cron-job.org as the clock and GitHub Actions as the
backstop. "Decisions" lists only what is still open — the Mailgun month before the first race,
and the entry-fee question only if a `PAID` event reopens it — and disappears when nothing is.
The alternatives and the Cloudflare box are gone; they are this file's, and a re-decision would
start here anyway.

Baseline `BR-V1.33-2026-09-17`.

## 62. Decided — a deployment never runs against the wrong schema: the build waits, and expand and contract never share a file (2026-09-17)

**Status:** Decided and built, after QA went down for the length of a build the same afternoon.
Changes the mechanism half of `AGENTS.md` §7.6 and `docs/RUNBOOKS.md` § Deploy a release; adds
`scripts/wait-for-migration.mjs`, `scripts/migration-check.mjs` and `yarn migrations:check`;
`migrate.yml` now also fires on a push to `main`. The owner's instruction: "we need to prevent
this from ever happening".

### What happened

PR #40 landed on `qa` with migration `0023`, which added `type` and `surface`, converted every
row, and dropped `kind` — in one file, at the owner's request, and §61 recorded why that was
tolerable: "the seconds between the migration finishing and the build going live serve 500s".
The migration finished at 17:25:00Z in 25 seconds. The build took longer. For that gap the old
code selected `events.kind` from a table that no longer had it, and every public page answered
500. Tolerable on paper; not to the person who opened the site.

The order could have gone the other way and been no better. A push to `qa` starts the Vercel
build and `migrate.yml` at the same moment, and §7.6 said so, then asked people to keep the
overlap harmless by hand: adds now, drops later. That is a rule with nothing enforcing it, and
§61 is what a rule with nothing enforcing it looks like on a day somebody has a reason.

### Two mechanisms, one per direction

**New code never meets an old schema: the build waits.** `scripts/wait-for-migration.mjs` is the
first step of `yarn build`. On a Vercel production deployment (`VERCEL_ENV=production`, which is
the `qa` branch on the QA project and `main` on the production project) it reads the journal
head the build is about to be compiled against and polls Drizzle's bookkeeping table in the
environment's own database — the same comparison `/api/health` makes — until the database is at
or beyond it. Then, and only then, `next build`. It **applies nothing**: "no migration from a
build" (§7.6, and the runbook's must-never list) is untouched, because the thing that was wrong
with migrating from a build — a destructive change running because somebody triggered a
deployment — is not what waiting does. A migration that never arrives fails the build after
`MIGRATION_WAIT_MINUTES` (20) and Vercel keeps the previous deployment serving, which is the safe
state. Locally and on previews it exits immediately. The common case, a build with no migration,
costs one query.

**Old code never loses what it reads: expand and contract never share a migration.**
`scripts/migration-check.mjs`, in `yarn check` and therefore in CI and the pre-commit hook,
classifies every migration from `0024` on. A file that adds — table, type, column, index, enum
value, constraint, backfill — may not also drop, rename, change a type, or make an existing
column NOT NULL. A file that does any of those must carry a `-- contract:` line naming the
release whose code stopped using what it removes, so the author answers that question before
CI does. `0023` is left as it is and is the test's example of what is refused.

Together: the migration runs while the old code serves, and the old code does not care,
because an expand migration takes nothing away; the new code goes live only once the schema is
there, because the build waited. There is no window in either order.

### Production

`migrate.yml` now runs on a push to `main` as well, targeting the `production` environment, whose
required reviewer holds the run until the owner approves it. The production build is waiting
for that click. That is the same gate §31 set up, reached by a merge rather than by a
`workflow_dispatch` somebody has to remember — and the first production deployment loses a
step: merge the release PR, approve the run, done (`docs/RUNBOOKS.md` § The first production
deployment). Approve within the wait, or the build fails safe and a redeploy after the green run
finishes the job.

### What was considered and not done

- **Migrating from the build command.** The vibe-friendliest shape — merge is the whole
  deploy — and the one the runbook forbids by name. It also does not fix the incident: the
  migration would run at the *start* of the build, and the old code would serve the dropped
  column for the build's whole duration. Waiting fixes the ordering without touching the rule.
- **Building in GitHub Actions and promoting with `vercel deploy --prebuilt`** after the
  migration. Correct, and heavier: a Vercel token, a workflow that owns deployment, and the
  Git integration switched off for two branches. The wait script gets the same guarantee from
  one file and no new secret.
- **Enforcing "the drop ships in the release after" mechanically.** A script cannot see releases.
  The `-- contract:` line is the forcing function: a drop has to be written down as later than
  something, and the reviewer can read whether that is true.

Baseline `BR-V1.34-2026-09-17`.

## 63. Decided — a legal document version downloads as a PDF, rendered by `pdfkit` from the stored text (2026-09-17)

**Status:** Decided and built. Adds BR-REQ-053-03, one dependency (`pdfkit`, pinned), one route
(`/api/admin/legal/[id]/pdf`), and three assets under `src/theme/pdf/`. The owner's words: "I
should have the BVR logo in the participation declaration PDF, and the document's version — and
be able to generate and download a PDF for preview."

### What it is, and what it is not

A **rendering** of a legal document version — the same rows the public page reads, the same
content hash — as a file: the club's lockup, the title, "Version n · Effective from <date>", a
draft band when the version is unapproved, the sections, and on every page the club's name, the
version, the hash's first sixteen characters and "Page n of N". The metadata carries the full
hash, so the file says what it is without being opened. Downloaded from the version's page in the
backoffice, one link per language, Administrator only.

It is **not** a place legal text is written (`AGENTS.md` §11.1 stands), not the signed
declaration §56 sketches (that is a participant's acceptance rendered with their name, and it
waits on the decisions §56 lists), and not public. But it is the renderer that one would use:
the module takes a version and a set of labels and returns bytes, so a per-participant copy is
one more caller, not a second PDF stack.

### The dependency, argued for (`AGENTS.md` §1.5)

Prefer nothing: a PDF cannot be written by hand in any quantity of code worth maintaining.
Then the platform: there is none — a browser's print-to-PDF needs a browser, and a headless
Chromium is a 50 MB binary a serverless function cannot carry. Then what is installed: nothing
writes PDF. So one library, and the choice among them:

- **`pdfkit`** (chosen): pure JavaScript, no native binary, text wrapping and page breaks built
  in, TrueType embedding built in, `bufferPages` for page numbers, PNG images. Maintained.
  Loaded by exactly one server module; no visitor pays a byte for it.
- `pdf-lib`: lighter and pure, but no text wrapping — every line break would be ours to compute
  — and no maintained release since 2021.
- `@react-pdf/renderer`: JSX for documents, which is legible, and a layout engine, a bundling
  story with Next that needs care, and several times the size, for a document that is headings
  and paragraphs.

### The font is embedded and is the site's own

PDF's fourteen standard fonts cannot encode ș, ț, ă, â or î, so any Romanian document needs an
embedded TrueType face. Two static weights of **Roboto** — the site's body face — subset to
Latin Extended, 47 kB each, SIL OFL, licence beside them in `src/theme/pdf/`. The lockup is the
same artwork as the header, rasterised once to a 1200px transparent PNG (46 kB), because PDF
images are bitmaps. `pdfkit` is given the font buffer as its default, so it never loads
Helvetica and never reads a metrics file from disk. `next.config.ts` keeps `pdfkit` a real
package (`serverExternalPackages`) and traces `src/theme/pdf/*` into the route's function
(`outputFileTracingIncludes`): a file read with `fs` at runtime is invisible to the bundler, and
a function shipped without its font renders nothing.

### Colours and words come from where they already live

The PDF uses `COLOR` from `theme/brand.ts` — the one file allowed a hex value — and the draft
band is the secondary orange at 14% rather than a new tint. Every label arrives translated from
the catalogue in the **document's** language, not the reader's: a Romanian declaration
downloaded from the English backoffice is still a Romanian document.

Baseline `BR-V1.34-2026-09-17`.

## 64. Decided — a recurring event is a series of copies, not a rule the calendar evaluates (2026-09-17)

**Status:** Decided and built. BR-REQ-050-02 criterion 7; `repeatEvent` in
`modules/content/events/service.ts`. The owner asked "do recurring events work?"; they did not.

Two shapes were possible. A **recurrence rule** on one row — "every Sunday at 08:00" — that the
listing expands into occurrences at read time is how calendars do it, and it is wrong here: every
occurrence of the club's weekly run is its own event in every way that matters — its own
registrations, capacity, waiting list, cancellation, start list, page address, structured data —
and the whole registration lifecycle keys on `event_id`. A rule would put a second notion of
"which Sunday" inside the allocator. So a recurring event is **N ordinary events**, made in one
press from a source, and nothing downstream knows they are related.

What the copies keep and what they get: the same wall-clock time in the event's own zone, added
on the calendar rather than to the instant (`addWallClockInterval`) — a run at 08:00 stays at
08:00 across the March and October changes; every other time — the end, the gun time, the
registration window — shifted by the same interval; a slug carrying the date in each language,
so the URL says which Sunday it is and next year's series cannot collide with this year's;
never the featured flag or the start list switch, for the reasons duplicating never copies them.
Drafts, unless the source is published and publishing was asked for by a role that may publish:
a published source has both languages complete, so its copies can go live without a review each.
One transaction — a collision on the ninth slug leaves no eight events behind.

Three cadences and a ceiling of 52, because a weekly run for a year is the largest series the
club holds; a fourth cadence is one line in `REPEAT_CADENCES` and a label. Baseline
`BR-V1.34-2026-09-17`.

**Addendum, 2026-09-18 — days of the week, and recurrence at creation.** "On the event
creation page I see no recurrence; we should have events that are every Monday and every
Wednesday." Two things were true: the repeat form lived only on an existing event's page,
where nobody creating one would look, and it knew one day a week. Now `repeatEvent` takes
`weekdays` (ISO 1–7): with them, `count` is a number of weeks from the source's own week, and
every chosen day *after* the source, at the source's wall time, is an occurrence — the source is
never duplicated and a series never runs backwards, so a Sunday event ticked "Monday and
Wednesday" starts the Monday after. The same fields sit on the creation form, "does not repeat"
by default; a series made there is drafts, because the event is. Which raised the real problem:
fifty-two drafts published one page at a time is not a workflow. So the events list gained
"publish the ticked ones" beside "archive the ticked ones" — each event walks DRAFT → IN_REVIEW
→ PUBLISHED through `transitionEvent`, so the role check and both-languages-complete check
hold on every one, and a copy that cannot be published is counted and skipped. A rule engine
("second Tuesday of the month") was refused again: two cadences, seven boxes and a number cover
what the club runs.

## 65. Decided — race numbers arrive in M1: per event, as a batch, printed two to a page (2026-09-17)

**Status:** Decided and built. BR-REQ-038-01; migration `0024`; `modules/registrations/bibs.ts`
and `bibs-pdf.ts`; `/api/admin/events/[id]/bibs`. The owner's words: "I need to see and generate
the race bibs to print them, and as a batch — the BVR logo is super important."

**What moved and what did not.** Bibs were M2 in every plan, alongside multi-distance races and
results, because a bib is one number *per race* across its child distances and results are keyed
by it. That coupling is real and it is still M2. What the club needs on a race morning is
simpler: every confirmed runner of *this* event has a number, and the numbers are on paper. That
half needs nothing from M2 — an event has confirmed registrations, and `bib_number` has sat on
the row since the first migration, kept empty by a CHECK exactly as `capacity` once was — so it
moves, and the CHECK goes the way the capacity guard went: only once the transaction that makes
the column safe exists and is tested.

**Assignment, not entry.** Numbers are never typed. An Administrator presses "assign", and every
confirmed, real registration without a number gets the next one, in order of confirmation,
inside a transaction that locks the event row — the same serialization point the capacity
transaction uses, for the same reason: two organizers pressing at once would both read 17. A
number once given never changes, so Friday's sheet is right on Sunday; a later batch continues
after the highest ever given, whoever confirmed when. A cancelled registration keeps its number
off the sheet and keeps it from anyone else — reuse is how two people wear 17. Test registrations
get nothing: they are omitted from every count the club is given (§30), and a bib is the most
physical count there is. The partial unique index on `(event_id, bib_number)` is the guarantee;
the lock is what keeps the guarantee from surfacing as an error.

**Printed two to an A4 page** with a dashed cut line, because that is what a club prints at
home and an A4 halved is the size a number is worn at. The lockup, the number in the club's blue
as large as the width allows, the registered name — the legal name, this is staff-facing — and
the event's title and date. The same `pdfkit`, Roboto and rasterised lockup as the legal PDF
(§63): one PDF stack. A `from`–`to` range reprints one bib or prints the late batch without
reprinting everything.

**Audit.** One row per batch, about the event, with the range — never about a participant;
`entity_type` gains `event` for it. Baseline `BR-V1.34-2026-09-17`.

## 66. Decided — the gallery arrives as the small version: albums, two WebP variants, R2 through the §17 adapter, shrunk in the browser (2026-09-17)

**Status:** Decided and built. BR-REQ-054-01; migration `0025`; `modules/media/{storage,images}.ts`,
`modules/content/gallery/*`; `/galerie`, `/admin/gallery`; `STORAGE_MODE` derived in `env.ts`.
The owner's words: "the photo gallery must be super light, an admin section, and let's not leave
photos lying around on Vercel taking up space."

### Why now, and why this shape

The M5 media library — a picker for every content type, captions, the Tiptap image node — is
still M5. What the club needs this season is an album per event that a phone can fill and a
page can show, and that is a subset with a clean edge: `media_assets`, `gallery_albums`, their
translations and `gallery_items`, in the shape §12.10 named, with `gallery_item_translations`
left for the captions M5 will add. The editorial workflow, the version guard, the two-locale rule
and the stable slug are the standing pages' verbatim; the one gallery rule added is that an album
with no photo cannot be published.

### "Super light" is three decisions

1. **The original is never stored.** The browser shrinks each photo to 2000px WebP before it
   leaves the phone — a client island that earns its place (§1.5): there is no server-only way to
   make a file smaller before it is sent, the platform accepts 4.5 MB a request, and a bucket of
   originals is twenty times a bucket of what the site shows. The server then re-encodes what
   arrives into `web` (≤1600px) and `thumb` (≤480px), both WebP, with `sharp` — already on the
   machine as Next's own image dependency, now pinned. `.rotate()` first, so a portrait photo is
   upright; then nothing kept, so every EXIF field goes, the GPS position included (§17, §19.2).
2. **Cloudflare serves the photos, never a function.** `R2_PUBLIC_BASE_URL` is the read side —
   the bucket's `r2.dev` subdomain to start — and egress there is free. Keys are opaque and
   prefixed with the environment, so QA and production share one bucket without seeing each
   other, and nothing is listable.
3. **No lightbox, no script on the public page.** A thumbnail is a link to the larger variant;
   the back button returns. Every image carries its dimensions so the grid does not jump.

### The adapter, and the fourth state

§17's narrow adapter, three methods — `put`, `delete`, `publicUrl`; metadata is the row's — over
R2's S3 API (`@aws-sdk/client-s3`, pinned; the S3 endpoint is configuration because §8 forbids
assembling a hostname), a local directory, or memory, chosen by `STORAGE_MODE`. The mode is
**derived**, never set: `local` on a laptop, `fake` under test, `r2` when the five variables are
all present, and `unconfigured` when a deployed environment has not got them yet. That last
state is the point: QA and production boot without a bucket, refuse an upload with a sentence,
and `/admin/tasks` lists the bucket as an open task with the steps — read from the environment,
not ticked by hand (§61). `R2_ACCOUNT_ID` in §8's contract became `R2_ENDPOINT`: the endpoint is
what the client needs, and the account id was only ever a way to assemble it.

### Deletions delete objects

A photo removed is its rows, then its two objects; an album removed is every photo's. Rows first
and objects after, deliberately: an object without a row is a cost nobody notices, a row without
an object is a broken image somebody does. `sharp`'s check of the bytes stands whatever the
client claimed, SVG refused outright (§17: a document that can carry script needs its own
sanitizer before it may be served).

## 67. Decided — the race-day desk: the address is vouched for, the declaration is signed on paper, every step has a way through, and no step has a way around the allocator (2026-09-18)

**Status:** Decided and built. BR-REQ-037-07, BR-REQ-037-08, BR-REQ-038-01 criterion 7;
migration `0026` (expand-only); `registrations/{service,admin-service,admin-repository,
checkin-code,token-actions}.ts`, `registrations/ui/{DeskRow,QrScanButton}.tsx`;
`/admin/checkin`, `/admin/checkin/<code>`, `/admin/guide`, `/api/registrations/qr/<code>.png`.
The owner's words: "skip email registration and verification and just add people; generate bibs
manually; see and change the registration status; sign on behalf of participants and basically
bypass any step; a check-in status — they can check in or I can; a QR code sent via email that
they present to pick up the bib; volunteers at pickup must use the app to scan; the process must
leave room for errors — no email, no QR — and volunteers can bypass any step and just give people
their bib."

### What was asked, and the one word that was refused

Everything on that list is built except "sign on behalf of participants", and the refusal is a
matter of wording, not of function. §33 decided that consent cannot be relayed: a declaration
somebody else signed protects nobody, and the club's own liability rests on the participant
having agreed. That still holds. What a race desk actually does is different from relaying: the
participant is standing there, reads a printed copy of the *approved* declaration, and signs it
with a pen. The system's job is to record that this happened, under the id of the person who
watched it. So `declaration_acceptances` gained `method` (`EMAIL_LINK` | `PAPER`) and
`attested_by_staff_user_id`, with a check that the two agree, and a paper row carries the same
version and hash an email-link row does. Every reader downstream — the count on the legal page,
the timeline, the export — treats the two identically. The signer is the participant in both;
the evidence differs.

The address is handled the same way. "Skip verification" does not mean the row lies about it:
`email_confirmed_at` is set and `email_confirmed_by_staff_user_id` says who vouched, while the
participant's own `email_verified_at` stays null. A vouched-for address is a fact about a
person at a table; a verified one is a fact about a mailbox. The confirmation email — with the
QR — goes to the address anyway, so a mistyped one shows up as a bounce rather than a lie.

### What "bypass any step" may not bypass

The allocator. A fast-tracked walk-in at a full event lands on the waiting list exactly as an
online entry would, and "give a place" is refused with a sentence while `occupied >= capacity`
under the event lock. The alternative — a desk that can put a two-hundred-and-first runner into
two hundred places — would make BR-REQ-034-01 a rule about the website rather than about the
race, and the race is what the rule is for. The desk also cannot confirm anybody without an
approved declaration in their locale: a paper copy of a text that was never approved is a paper
copy of nothing.

The public registration window *is* bypassed by the fast track, deliberately: it exists for the
public, and on race morning it has closed. A cancelled event and a non-local registration mode
still refuse, because those are facts about the event, not about the window.

### Who works the desk

Every staff role, including the lowest. A volunteer handing out numbers is a CONTRIBUTOR — a
role that until now could do nothing but draft — and the desk is their whole backoffice: a
tab, a search box, a scan button, one row per runner with one or two buttons. The row shows a
name, a state, a number and a check-in state; it never shows an address, and it cannot cancel,
erase, rename, resend, list or export, which stay Administrator-only. That boundary is the same
one §38 drew between DEV and ADMIN — personal data — moved one notch: a name said out loud at a
table is not the participant list. `createRegistrationByStaff` moved to the desk side of it
too, because the walk-in on race morning is entered by whoever is at the table. The rules table
in `CLAUDE.md` says so now.

### The code and the QR

`registrations.checkin_code` is ten characters from an alphabet without 0/O/1/I, so it can be
read out over a counter as well as scanned, unique across every event, minted at confirmation
and stored in clear. It is an identifier, not a credential — holding it opens a page that is
behind staff sign-in and confers nothing — so it is not hashed like an action token (§12.8),
and a participant who scans their own QR sees the sign-in page. The QR encodes the address of
`/admin/checkin/<code>` and is served as a hosted PNG the confirmation email links to, never a
data URI: enough mail clients strip inline images that a runner would arrive with a blank
square. Scanning inside the app uses the browser's own `BarcodeDetector` where it exists
(Android Chrome); everywhere else the phone's camera app opens the same link, because the QR
*is* a link — no scanning library, no bundle.

### What was considered and refused

- **A separate "volunteer" role.** Five roles nest; a sixth that is "CONTRIBUTOR plus the desk"
  would either sit below CONTRIBUTOR (then CONTRIBUTOR could not work the desk, which is
  backwards) or beside it (then the hierarchy stops being one). `canWorkTheDesk` is a
  capability of every role instead.
- **Staff check-in without a code — a checkbox on the list.** Built too, on the desk's search
  and on the registration page; the code is what makes the *scan* path a three-second
  interaction, not the only path.
- **A scanning library.** `jsQR` is 40 kB and would serve iOS Safari, which has no
  `BarcodeDetector`. The camera app serves iOS Safari already, with zero bytes.
- **Self check-in at any time.** From twenty-four hours before the start only. "I am here" a
  week early is not information, and the manage token is read rather than spent for it, so the
  same link still cancels.

## 68. Decided — the outbox drains itself after the request that filled it, and the scheduler runs every fifteen minutes, because five minutes exhausts Neon's free month (2026-09-18)

**Status:** Decided and built. BR-REQ-090-07; `notifications/drain.ts`, called from
`enqueueEmail`; `JOB_STALENESS_THRESHOLDS_MS` 35 minutes; `SETUP.md` §26 rewritten, §33 added;
`/devs` shows the figure. The owner's words: "make sure my website does not crash; I must prevent
the app from failing; I need to know load and status on Vercel and Neon."

### The arithmetic

Neon's Free plan: 100 CU-hours a month per project, the compute suspended when they are spent
until the next month, scale-to-zero after five idle minutes and not configurable. A monitor
every five minutes never lets it idle: 0.25 CU × 24 h × 30 d = 180 CU-hours. QA had used 74 by
18 September, on course to be suspended around the 22nd — the QA site down for nine days, and
production would have followed the moment its monitors were set up. Vercel is not the
constraint: 20 minutes of the Hobby plan's 4 CPU-hours, 19k of a million invocations.

### Why not simply ping less often

Because the five-minute cadence was chosen for a reason: a verification link that arrives in
five minutes is bearable and one that arrives in fifteen is a registration abandoned. The cadence
was doing two jobs — sending mail promptly and expiring holds — and only the second tolerates
fifteen minutes. So the first job moved: `enqueueEmail` now schedules one drain of the outbox
with Next's `after()`, run once the response has gone out. The verification link is in the inbox
in seconds, whatever the scheduler is doing. This is not the in-process interval §16.2 forbids
(serverless has no process for one to live in); it is one shot, per request, for that request's
own message, and a failure leaves the row PENDING for the scheduler. Concurrent drains are safe
because `claimOutboxBatch` already used `FOR UPDATE SKIP LOCKED` for two schedulers.

With that, fifteen minutes is the cadence for what remains — expiring holds, promoting a queue
on an idle event, retrying a failed send — and a hold that expires up to fifteen minutes late
releases a place fifteen minutes late to the *right* person (§16.2's promptness-versus-
correctness line). The compute is awake about 37% of the time: ~65 CU-hours a month plus real
traffic. QA runs hourly.

**And the night is slower on purpose** (the owner, the same day: "optimize per hours, Romania
time — the app can run slower during off hours"). From 23:00 to 07:00 `Europe/Bucharest` the
production monitors run hourly instead of every fifteen minutes; nobody is registering, no
hold is expiring that a runner is waiting on, and a warm database at 03:00 costs exactly what
it costs at noon. The first request after an idle hour pays Neon's cold start — a second or
two, once — and that is the whole price. The health check reads the clock the same way
(`jobs/quiet-hours.ts`): the threshold is twice the cadence in force plus five minutes, so a
fifty-minute gap is `ok` at 03:00 and `stale` at noon, and the check stays honest at both. By
day the compute is awake ~5.9 hours and by night ~0.75: about 50 CU-hours a month. A finer
schedule — different cadences per weekday, or a race-morning burst — was refused as a rule
nobody would remember; two cadences and one boundary are enough, and the boundary is a
constant with a name.

### Seeing it

`/devs` reads the project's row from Neon's API when `NEON_API_KEY` and `NEON_PROJECT_ID` are
set — CU-hours against 100, hours awake against hours elapsed, the period's end, red past 80% —
with a five-second timeout and a sentence when Neon does not answer. Vercel's usage has no
comparable single figure worth a key; the page says where it is and that it is under 1%.

### Refused

- **Upgrading Neon to Launch ($19/month, 300 CU-hours).** It would have hidden the cause. The
  club may still choose it later for the restore window (six hours on Free); the task page says
  what it buys.
- **Disabling scale-to-zero.** Not available on Free, and the wrong direction: the point is to
  let the compute sleep.
- **A one-shot in-process timer after enqueue.** `after()` is the platform's own hook for
  work after the response and extends the function's life on Vercel; a `setTimeout` in a
  function that has already returned is a coin toss.

## 69. Decided — a film on the event page is a YouTube link behind one press, and the page fetches nothing from YouTube until it is pressed (2026-09-18)

**Status:** Decided and built. BR-REQ-011-01 criterion 9; migration `0027` (expand-only);
`events/domain/video.ts`, `events/ui/EventVideo.tsx`. The owner's words: "I must be able to
embed YouTube videos on the event page — I have a pretty cool one from last year's event."

The link is stored as pasted and refused unless an eleven-character id can be read from it, in
any of the share shapes YouTube produces. The page renders a native `<details>` whose closed
state is a line of text: the iframe inside is `loading="lazy"`, which a closed disclosure keeps
out of the viewport, so no request, no cookie and no script until the visitor opens it. Open, it
plays from `youtube-nocookie.com`, built from the id alone. A thumbnail facade was refused
because the thumbnail is itself a request to Google on load, which is the thing being avoided;
a client island was refused because `<details>` does it with none. The embed is a third party
the privacy notice describes as "loaded when you press" — the same line §61 drew for Strava,
where the mark is shown and the script is not. A duplicate or a repeated edition does not carry
the link: a film is of one edition.

## 70. Decided — a time is typed on a 24-hour clock, in its own field, because the browser's combined picker speaks the browser's language and not the club's (2026-09-18)

**Status:** Decided and built. BR-REQ-050-02 criterion 8; `content/events/ui/WallTimeField.tsx`,
joined back into the wall-clock string in `admin/actions.ts`. The owner's words, over a
screenshot of "06:30 PM" and a month-first calendar: "time pickers should be 24h, not AM and PM."

`<input type="datetime-local">` renders the clock and the date order of the *browser's* locale.
An English-language Chrome — which is what the owner and most Romanian laptops run — offers
AM/PM and MM/DD/YYYY, and no attribute on the input changes that: `lang` is ignored by Blink and
WebKit for this control. The choices were to tell every organizer to change their browser
language, to add a picker library (`@mui/x-date-pickers` and a date library, a client island of
some hundred kilobytes on the editor), or to stop asking one control to do two jobs. The last is
what was built: the date keeps the native picker, whose calendar is unambiguous whatever order it
prints the digits in, and the time is a text field that accepts `HH:MM` on a 24-hour clock and
nothing else — which is how every start time in Brașov is written, said and printed on a bib. The
two fields post separately and the action joins them into the `<field>WallTime` string the
service has read since `0011`, so nothing below the form changed and the old single field is
still accepted. A date with no time is midnight; no date is no value.

## 71. Decided — a duration, not an end; a gun time for races only; the description is the editor; a Strava event link (2026-09-18)

**Status:** Decided and built. BR-REQ-050-02 criterion 9, BR-REQ-011-01 criteria 10 and 11;
migration `0028` (expand-only, `strava_event_url`); `EventFieldsForm`, `OnlyForType`,
`TranslationFieldsForm`, `translationFieldsSchema.body`. The owner's words, four messages in a
row: "event start date and race start date are kind of redundant — event start should be the
driver; race is only for races"; "instead of event end date I should just have a duration";
"all descriptions should be WYSIWYG and soon I can add pictures"; "an optional Strava event link".

- **Duration.** Nobody thinks "it ends at 10:30"; they think "it takes ninety minutes". The
  form asks for minutes and the service derives `ends_at` from the start — an instant plus a
  duration, which is right across a clock change where a wall-clock end would not be. The old
  `endsAtWallTime` is still accepted underneath, so nothing that posted it breaks; a duration
  wins when both arrive.
- **Race start only for a race.** The field follows the type select (a client island watching
  MUI's hidden input — the select is MUI's and the form is one save, so a server round-trip was
  the worse option) and the service ignores a gun time on anything that is not a race, rather
  than refusing it: a form that hid the field cannot be blamed for what it still posted.
- **The description is the editor.** `event_translations.body_json` existed from the pilot with
  no editor writing it; `RichTextEditor` and the §11.3 allowlist existed for standing pages. The
  two met: each language has a "full description" in the same editor, validated as `body` on the
  way in and rendered by the same server renderer under the short description. The race-day
  schedule the owner asked for is a list in it, not a new structure. Pictures follow when the
  image node lands on top of the gallery's storage (§66) — the contract in §11.3 already names it.
- **A Strava event link.** The club's group events live on Strava, where members RSVP; the
  event page now offers that page as a fact with the mark, like the route. A Strava page only
  (`isStravaLink`), and one occurrence's — never carried onto a duplicate or a repeat, because
  next week's occurrence has its own address.

## 72. Decided — pictures go in the editor, between paragraphs; the gallery stays, but it was not what was asked for (2026-09-18)

**Status:** Decided and built. BR-REQ-050-03 criterion 10; `rich-text/domain/schema.ts` (the
`image` node), `rich-text/ui/RichTextEditor.tsx` (the picture control),
`/api/admin/media`, `media/service.ts`, `media/browser-shrink.ts`. The owner's words: "you
completely misunderstood the gallery concept — I don't want photos from events, I want photos
in posts! I should be able to put pictures in that editor."

§66 read "a photo gallery" as albums of race photos and built that. What the owner meant was
the ordinary thing every publishing tool does: a picture in the text, where the text is. Both
are now true, and §66's storage is what made the second cheap: the picture control shrinks the
file in the browser (the same helper the gallery uploader uses), posts it to a route that
stores it exactly as a gallery photo — two WebP variants, one `media_assets` row — and inserts
an image block carrying the address the route answered. The schema accepts that address and
no other: not a third party's image, not a data URI, not a page. So a body can never fetch
from anywhere but the club's own store, which is what lets the renderer emit a plain lazy
`<img>` without a second thought. A picture is a block between paragraphs, never inline: a
page is text with pictures, not a layout tool.

What was not built: alt text editing (the file name, without its extension, is the alt; a
caption or a real alt is a follow-up), and a sweep for pictures removed from a body — they
stay in the store, §17's "reference check before delete" is that sweep, and until it exists
the cost is a few hundred kilobytes per forgotten picture. The gallery stays as built; nobody
is made to use it.

Baseline `BR-V1.35-2026-09-18`.

## 73. Decided — a picture has words, a caption, a size and a home; a picture nobody uses is swept; the short description is a body too (2026-09-18)

**Status:** Decided and built. BR-REQ-050-03 criteria 10, 11, 14; `rich-text/domain/schema.ts`
(`caption`, `widthPercent`, `fromPlainText`), `rich-text/ui/RichTextEditor.tsx` (the picture
panel, the stored-pictures picker, paste and drop), `rich-text/ui/RichText.tsx`
(`<figcaption>`, the figure's width), `media/references.ts`, `/admin/gallery/pictures`,
`event_translations.excerpt_json`, migration `0029` (expand-only).

§72 shipped a picture with the file name as its alt, no caption, no way to size it, no way to
see it again and no way to get rid of it. The owner's three asks the same afternoon: "I should
be able to resize pictures"; "I don't see these uploaded pictures in the gallery so I can
review and delete them — I need to know what picture and where it's used"; "in the short
description I should be able to add pictures"; and the brief asked for alt and caption, the
orphan sweep, and a nag rather than a block for a missing alt.

**Words.** A click on a picture opens a small panel beside it: the alt text (empty until
written — "IMG_4021" is not what a screen reader should say, so the file name is no longer
the default), an optional caption rendered as `<figcaption>` under the picture, one of four
widths, "remove", and "done". While any picture in the body has no alt, a dimmed sentence
under the editor counts them; it never blocks a save, because a page with a picture that lacks
a description is still a better page than the one the organizer gave up on.

**Size.** Four shares of the text column — 100, 75, 50, 33 — rather than a drag handle or a
free number: a drag handle is a node view and a dependency, and a free number is a layout
tool, which §72 said a page is not. On a phone every picture is the full width whatever was
chosen, and a picture is a block in the flow, never floated, so two pictures are never side by
side. The editor shows the same width the page will.

**Home.** `/admin/gallery/pictures` lists every stored picture — thumbnail, file, size, when
and by whom — with every place it is used, each a link to that page, event or album, and
offers "choose one already uploaded" from the editor's own picture control so a picture is
stored once and used twice. A picture in use cannot be deleted from the list: the page it is on
would show a broken image. One SQL predicate answers "is it referenced" for the list, the
delete and the sweep — a gallery item, an album cover, a page body, an event body or excerpt,
**drafts included** — so the three can never disagree.

**Swept.** `media_assets.last_referenced_at`, set at upload and advanced by the sweep while a
reference exists. A picture nothing has referenced for seven days, and that is at least seven
days old, is deleted with its objects — last in the registration-maintenance run, in its own
try/catch, row first with the reference re-checked in the same statement, then the objects,
exactly as the gallery deletes a photo. Seven days from *last seen referenced*, not from
upload: a picture removed from a body today can still be put back tomorrow, and a picture
uploaded into an editor that is saved next week is not an orphan. `/devs` shows the figures;
after a run, "to be deleted on the next run" reads zero.

**The short description.** It was a plain textarea; it is the same editor now, pictures
included, stored as `excerpt_json`. The plain `excerpt` column stays and is *derived* on save
— the words of the rich excerpt, pictures left out, cut at 500 — because the listing card, the
meta description, the JSON-LD and the publish check all read a string, and a card that is one
big link cannot contain the links a body may. So the hero and the event page render the rich
excerpt, the card shows its words, and an event written before this reads its plain text as a
one-paragraph document. No migration of rows: `excerpt_json` is null until the editor saves
it.

**Refused.** A migration rewriting old bodies to carry the new attributes (the schema
defaults them on read). Pasting a picture by URL (§72's rule stands: a body fetches from the
club's store and nowhere else, and the editor now drops a pasted `<img>` outright rather than
letting the server refuse it at save time). Deleting a referenced picture with a warning: a
warning nobody reads is a broken page nobody meant.

Baseline `BR-V1.36-2026-09-18`.

## 74. Decided — Gmail dots are two addresses now; the plus tag is still one (canonicalization version 2, 2026-09-18)

**Status:** Decided and built. BR-REQ-032-02 criterion 1 reversed; AGENTS.md §10.4;
`participants/domain/canonical-email.ts` (`CANONICALIZATION_VERSION = 2`); migration `0030`
(a backfill, expand-only).

The owner: "I want to allow the same Gmail account if I have for example
`asavei.florin@gmail.com` and `a.saveiflorin@gmail.com` — not many people know about this
hack, so we should allow it; this will help me test the app receives email." Version 1
collapsed Gmail dots because Gmail delivers every dotted spelling to one inbox, and one inbox
should be one runner. That is still true, and it is exactly what makes the dotted spellings
useful: they are the only way one person gets several distinct identities that all land in the
club's own inbox, which is how a registration is rehearsed end to end on QA — the verification
link, the declaration, the confirmation with its QR — without asking friends for addresses.

The plus tag still collapses. It is the trick everybody knows, and BR-REQ-032-02 exists so
that one person cannot enter a full race twice from one inbox; a dotted spelling is a
deliberate act few people know of, and the club accepts that risk for the rehearsal it buys.
`googlemail.com` still collapses to `gmail.com`. Nothing else in §10.4 changed — except that
the QA delivery allowlist (`EMAIL_DELIVERY_MODE=allowlist`) now compares on `inboxEmail`, the
canonical value with the dots removed as well, because what it guards is *whose inbox* may
receive mail, and the dotted spellings are that inbox. Otherwise the rehearsal would have
minted the identities and captured every one of their messages.

Versioned as §10.4 requires: the constant is 2, every row records it, and migration `0030`
re-canonicalizes every version-1 row from the delivery address it stored — keeping dots can
only separate values, never merge them, so the unique constraint cannot trip — rather than
leaving old rows at version 1 and letting a returning runner become two people. There were no
real participants anywhere when this ran (production refuses every registration until the
club's legal texts exist), so the backfill cost nothing and the rule is one rule.

Baseline `BR-V1.36-2026-09-18`.

## 75. Decided — the facts of an event are three lines, not nine rows (2026-09-18)

**Status:** Decided and built. `events/ui/EventFacts.tsx`.

The owner, with a screenshot of the nine-row table — date, gathering time, race start,
meeting point, distance, climb, difficulty, cost, registration: "these details should be
better organised. THE UX MUST BE SIMPLE AND EASY!" The rows were correct and unreadable: a
reader scanned top to bottom to answer "when and where do I show up", which is the whole
question.

So the same facts are grouped by the question they answer, each line a row of short pieces
separated by a middle dot, and the labels are the questions. *Când*: the date, then "întâlnire
la 09:00 · start la 10:00" for a race and one time for anything else. *Unde*: the meeting
point and the map link. *Traseu*: distance, climb ("180 m urcare" — a number alone said
nothing), difficulty, cost, the route link, the Strava event. Still a `<dl>`, so a screen
reader hears the question before the answer; the separators are hidden from it. On a listing
card the same two lines carry no labels and end with the state of registration, because a card
has no button to say it; on the page the button says it, and the facts mention registration
only for an event that has none — "no registration needed" is worth one sentence.

Fixed with it: the duration field refused 120 minutes ("the two nearest valid values are 116
and 121") because `step` counts from `min`, and `min` was 1 with a step of 5. Any whole minute
is a duration now.

Baseline `BR-V1.36-2026-09-18`.

## 76. Decided — the desk knows who never got the email (2026-09-18)

**Status:** Decided and built. BR-REQ-037-08 criterion 8; `admin-repository.ts`
(`emailRejectedReason`), `DeskRow.tsx`, the registration page.

Mailgun already told the outbox when a message bounced (`permanent_fail`) or the recipient
complained, and the outbox row kept the reason (§16.5); the registration's own timeline in the
backoffice showed it, three screens away from where it matters. On race week the question is
"who do I call", and the answer belongs on the row the organizer is already looking at.

So one subselect — the newest bounced or complained message *of any type* for the registration
— feeds a chip, "email respins", on the desk row and beside the status on the registration
page, with Mailgun's short reason. Any type, because a verification that bounced means exactly
what a bounced confirmation means: this person never got the email. No participant-facing
change, and the desk still sees no address (§67): a reason is not an address.

Baseline `BR-V1.36-2026-09-18`.

## 77. Decided — one link, all my registrations; the first use of `MANAGE_PROFILE` (2026-09-18)

**Status:** Decided and built. BR-REQ-036-04; `registrations/my-registrations.ts`,
`/inscrieri/ale-mele` and `/inscrieri/ale-mele/[token]`, `notifications/render.ts`
(`MANAGE_PROFILE` has a route), the footer.

Participants have no accounts (§10.3) and never will in V1; a runner with entries in two
events has two confirmation emails to keep, and the one who lost both had "send me my link
again" per event. The brief asked for one link that lists everything: type the address, get
one message, open a page with every active registration — the state, the code and its QR once
confirmed, "I am here" when open, cancel.

The token purpose was already there. `MANAGE_PROFILE` was reserved in §12.8 for the M4 public
profile, is the one purpose scoped to a participant rather than a registration (the check
constraint says so), and had no route. This is its first use; the profile, when it comes,
shares it — the same link can grow a "your profile" section without a second purpose. The
request side is the resend form's oracle rule, unchanged: one sentence whatever the address
means, counted before the lookup.

What a link may do: read, mark the holder present, and cancel — each on a registration that
must be the holder's own, checked against the token's participant and never trusted from the
form (a registration id is not a secret). Cancel consumes the token, as every manage link's
cancel does (§12.8: single use); "I am here" does not, because arriving is not the end of a
link's usefulness, and it never changes state past what the desk could do. The link lists
registrations and never changes an address: §10.3 holds here as everywhere.

**Refused.** A persistent "session" from the link (a cookie that keeps the page usable for a
week): it is an account by another name. Cancelling several at once: two cancellations are two
decisions, and the second needs a fresh link.

Baseline `BR-V1.36-2026-09-18`.

## 78. Decided — the homepage counts down the last week, on the event's own calendar (2026-09-18)

**Status:** Decided and built. BR-REQ-011-01 criterion 12; `events/domain/race-week.ts`,
`FeaturedEventHero.tsx`, `RegistrationCta.tsx` (`raceWeek`), `events/page.tsx`.

The week of the race the homepage is opened by people who already know about it, and what
they want is one line: when, exactly, and whether there is still a place. So within seven
calendar days the hero says "În 3 zile, sâmbătă 07:00" — "Mâine", "Azi" — above the button,
the free places stay as they were while registration is open, and once it has closed the
sentence stops at "closed" no longer: "come to the desk with the QR from your email", which
is the one thing a registered runner needs that week. Server-rendered, no script, no clock
ticking on the page: a countdown that changes by the second is a widget, and a line that
changes by the day is information.

The days are counted on the event's own wall clock (§9.4), not the server's: Vercel's clock
says UTC, where a Saturday 07:00 race in Brașov is still Friday 04:00, and "in 0 days" on a
Friday evening would be a lie. `daysUntilOnWallClock` reads both instants as Brașov dates
before subtracting, and the unit test walks the midnight where the two disagree.

"Alte evenimente" folds on a phone. Under a highlighted lead event a scroll of six cards
buries the page; a native `<details>` — open when there are four or fewer, closed past that,
no script — keeps the phone's first screen to the one event that matters that week. On a wide
screen the same element is forced open (`::details-content`, the marker hidden): there is
room, and a reader there cannot tell a heading from a control.

Baseline `BR-V1.36-2026-09-18`.

## 79. Decided — three small things reported and done: one bib per page, "resend the QR", the current tab in view (2026-09-18)

**Status:** Decided and built. BR-REQ-038-01 criterion 5, BR-REQ-037-02 criterion 1;
`bibs-pdf.ts` (`layout`), `registrations/domain/resend.ts`, `AdminTabs.tsx`.

**One bib per page.** The sheet stays two per A4 with a cut line; a second button asks for
the same A5-sized bib centred one per page, for a printer that will not take a cut or a club
that pins the whole page. The bib itself does not grow: an A5 number on a shirt is the size
that reads from the finish line.

**"Retrimite QR-ul".** A confirmed registration's resend was a bare manage link; it is the
confirmation itself now — the desk code, its QR and the manage link in one message — because
that is what "send it again" means the week of the race, for the organizer in the list and for
the runner who asks for their link back. `REGISTRATION_MANAGE_LINK` stays in the catalogue,
unsent. Bulk "assign bibs to selected" was asked about and refused: numbers are assigned in
order of confirmation, and a selection is an order somebody else chose.

**The current tab in view.** MUI scrolls the selected tab into view once, on mount; on a slow
phone the fonts and the hydration land after that, and "Ziua cursei" sat off the right edge.
The tab bar scrolls its own scroller to centre the selected tab again after hydration — the
scroller's `scrollLeft`, never `scrollIntoView`, which also moves the *page* and yanked the
viewport from under a tap. MUI's scroll arrows were tried on the phone and dropped: they
re-lay the bar out after mount, and the desk's e2e story lost a click to it three times.

**And the tests themselves.** The owner, the same afternoon: "tests are taking way too long
in general." `yarn test` ran its 94 files one at a time because each opens a PGlite database
in WebAssembly and memory was the worry; on a 32-core machine that was five minutes for a
one-line change. Eight workers now — a few hundred megabytes, forty-six seconds — and CI's
four cores get four. The e2e suite gained a `hydrated()` wait for the places a test clicks
right after a navigation, because the backoffice pages carry four editors now and a click that
lands mid-hydration is prevented by the router and never replayed.

Baseline `BR-V1.36-2026-09-18`.

## 80. Decided — the outbox can be sent by hand, and the day's counter is the ceiling (2026-09-18)

**Status:** Decided and built. BR-REQ-080-02 criterion 5; `notifications/send-now.ts`, the
panel on `/admin/registrations`, the `admin-send-now` throttle, `outbox.sent_by_staff` in the
audit trail.

The owner: "I want to force sending emails, not wait for the cron if needed — but I must keep
the counter for Mailgun, because I might want to send out newsletters and stuff." Since §68 a
request that queues a message drains the outbox after its own response, so most mail already
leaves in seconds; what the button is for is the rest — a batch deferred by a spent cap, a
retry waiting on its backoff, a queue filled by the desk on race morning — and the wish to
see it go without watching a clock.

**The same worker.** `processOutboxBatch`, the function the job endpoint and the after-response
drain call, called from a Server Action with an Administrator's session instead of
`JOB_SECRET`. One code path (§16.2): a message sent by hand is claimed, rendered, retried and
deferred exactly as it would be at 03:00. Its own throttle, per Administrator, so a person at
the button and the monitor never spend each other's allowance; an audit row with the counts,
so the trail says who emptied the queue before a window.

**The counter is the ceiling.** The panel shows what is waiting and what went out today
against the free plan's hundred (`readEmailVolumeToday`, the same figures `/devs` forecasts
from). The button runs batches only while the day's remaining allowance is above zero, sizes
each batch to what is left, and stops at five — a hundred, the whole of a free day, in one
press. That is the counter the owner asked to keep: a newsletter, when one exists, will have
to fit under the same number, and the provider's own refusal on a spent cap still defers the
rest rather than losing it (§40). When nothing is waiting, or nothing may go, there is no
button: a sentence says which, because a disabled button cannot (`SubmitButton`'s rule).

**Refused.** A "send to everybody" — the newsletter itself. That is a message type, a consent,
an unsubscribe link and a privacy-notice paragraph, not a button; it goes on top of this
counter when the club asks for it.

Baseline `BR-V1.36-2026-09-18`.

## 81. Decided — email that people will actually read: the facts line, the checklist, the footer, and a reminder two days before (2026-09-18)

**Status:** Decided and built. BR-REQ-080-01 criteria 4–5, BR-REQ-037-02 criterion 1;
`notifications/templates.ts` (`facts`, `footer`, `eventReminder`), `notifications/render.ts`,
`notifications/event-mail.ts` (`queueEventReminders`), `event_translations.checklist`
(migration `0031`, expand-only), `registrations/maintenance.ts`.

The confirmation is the one email a participant keeps, and it said "we look forward to seeing
you at Parcul Tractorul, Saturday 26 September 2026 07:00" inside a sentence. The morning of,
on a phone, the eye wants the facts, not the sentence: so the confirmation and the reminder
open with one **bold line** — date, time, meeting point — followed by the map link and the
Strava event link when the organizer set them, then "what to bring" as one line the organizer
writes per language (`checklist`, ≤ 300 characters, on the translation because it is
editorial), then the QR and the code, then the manage link. Text-first: the plain-text body
reads the same, the HTML adds `<strong>` and three anchors, and nothing else — no image but
the QR, and a whole message is a few kilobytes against the 100 KB the brief allowed.

**The footer.** Every message ends "Răspunde la acest email pentru întrebări" when the club
has a reply address (`EMAIL_REPLY_TO`, `contact@mail.<domain>` since §35's route); without
one the line is absent rather than promising an inbox nobody reads.

**The reminder.** `EVENT_REMINDER`, queued by the maintenance job for every CONFIRMED
registration of a SCHEDULED event that starts within the next 48 hours — the event's own
instant, not a calendar day — with the idempotency key `registration:<id>:reminder`, so every
run inside the window after the first inserts nothing (§16.1: a job that runs twice sends
once). Never a WAITLISTED entry, never a cancelled or completed event, never a state change.
It carries the same facts line, the checklist, the QR and "can't come? cancel here" — the
manage link, because a place freed two days before goes to the waiting list in time. It is
also the second message an Administrator may resend by name for a confirmed registration
while the event is ahead (§15.8). The forecast on `/devs` counts four messages per completed
registration now, not three: 25 registrations fit a free Mailgun day, not 33
(`docs/PLATFORM.md`).

**Refused.** A reminder for the waiting list ("you are still 4th") — a queue position two days
out is a promise the allocator does not make. Images of the route in the email — a link is
what a phone opens.

Baseline `BR-V1.37-2026-09-18`.

## 82. Decided — after the race: COMPLETED means over, and the thank-you is sent by a person, once (2026-09-18)

**Status:** Decided and built. BR-REQ-020-01 criterion 4, BR-REQ-080-01 criterion 6;
`events.thanks_sent_at` (migration `0031`), `notifications/event-mail.ts` (`sendEventThanks`),
`registration-window.ts` (`EVENT_COMPLETED`), `registrations/service.ts` (`checkIn`),
`registrations/repository.ts` (`findEventsNeedingMaintenance`), the event page's "După cursă".

`event_status = COMPLETED` existed as a value and did nothing distinct: the window rule folded
it into "cancelled", so a race that had happened read as a race that had not. Now the organizer
sets COMPLETED in the editor and three things follow. The page and the card say **"S-a
încheiat"** — its own sentence, not "anulat" — and offer no registration control. The desk
refuses a check-in with a sentence, and shows the rows without buttons: nobody arrives at an
event that is over, and a check-in after the organizer closed it would count somebody who was
never there. The maintenance job leaves the event alone — a cancelled event still expires its
holds, because nobody should keep a place on a race that will not run; a completed one has
nothing left to expire.

**The thank-you.** `EVENT_THANKS`, to everyone who was checked in — the people who came, not
the people who registered — with an optional `https://` link to the results or the photos.
Sent by an Administrator from the event page, behind a confirmation dialog, **once per event**:
`thanks_sent_at` is claimed in the same transaction as the rows, so two organizers pressing at
once produce one send, and the button is replaced by the date afterwards. Never automatic — a
thank-you the system sent is not a thank-you. The audit row names the event and the count,
never the recipients (§12.12).

**Refused.** Sending the thank-you to everyone confirmed: the people who did not come are not
thanked for coming. A COMPLETED status set by the job at the end time: the organizer knows
when a race is over; the clock does not.

Baseline `BR-V1.37-2026-09-18`.

## 83. Decided — the organizer's numbers where the organizer is: bounces in the list and the export, the desk's counts in the events list (2026-09-18)

**Status:** Decided and built. BR-REQ-037-08 criterion 8; `admin-repository.ts`
(`emailBounced`, `checkedInAt`, `emailRejectedReason` on the list), `csv.ts`,
`content/events/repository.ts` (`countConfirmedAndCheckedInByEvent`).

§76 put "email respins" on the desk row and the registration page. The organizer preparing the
call list works from the registrations list, so the list filters to the bounced rows and shows
the chip; the CSV export — the file that leaves the application and is read at a start line —
gains `Checked in` (the time) and `Email bounced` (Yes or empty, like the club-member column,
never "No"). The events list shows **confirmed · here** beside an event within a day of its
start: `countDesk`'s two numbers, for the organizer watching from the office without opening
the desk.

`/devs`'s "Neon not configured" sentence now carries the two-minute procedure itself (the API
key, the project id, the two `vercel env add`), so the person who sees it can act without
opening SETUP §33 — and both deployed projects have their keys since this evening, so the
sentence should not be seen again.

Baseline `BR-V1.37-2026-09-18`.

## 84. Decided — a telephone number is a country and digits, stored as one thing a phone can dial (2026-09-18)

**Status:** Decided and built. `registrations/phone.ts`, `ui/PhoneField.tsx`, `fields.ts`,
`form-mapping.ts`; BR-REQ-031-04.

The form accepted any three characters as a phone; "asdasdasdas" registered and the organizer
would have found out on race morning. Now both phone fields are a country (a native select,
Romania first, every nationality that has a calling code) and the digits; the server composes
E.164 (`+40712345678`) and refuses what cannot be a number — fewer than four digits, letters,
an international form for a different country than the one chosen. Tolerant of what people
type (spaces, dots, dashes, a `00`, a repeated `+40`, the trunk zero before a mobile), strict
about the one thing that matters. Not a per-country format check: a runner from anywhere may
enter, and refusing a valid foreign number is worse than storing one nobody rings.

Baseline `BR-V1.38-2026-09-18`.

## 85. Decided — who is coming, folded, with the club; the opt-out asked only where a list exists (2026-09-18)

**Status:** Decided and built. BR-REQ-039-02 criterion 4; `events/ui/StartList.tsx`,
`listPublicStartList`, the sample privacy notice.

Three consent boxes in two directions — agree, may appear, keep me off — read as a puzzle;
the owner: "people usually accept all." The opt-out is now asked only on an event whose list
is switched on (every event starts off), so most forms have two boxes in one direction.
Switching a list on later is a question for the people already registered, and the answer is
the notice and a message, not a box they never saw. The list itself is a folded section with
the count in its summary, and shows the club beside the name — "who is coming" at a race is
answered by clubs as much as by names. That widens the disclosure of §32 by one field, so the
privacy notice that allows the list must name it: the sample notice does; the club's real one
must before the list is switched on. The select list in the repository stays the guarantee,
and the surface test names both columns and no third.

Baseline `BR-V1.38-2026-09-18`.

## 86. Decided — the signature looks like one, and what happens next is said (2026-09-18)

**Status:** Decided and built. The declaration page, the registration page's acceptance line,
`layout.tsx` (Caveat, self-hosted).

The owner asked for the typed name to appear in a hand, "or people should be able to draw, so
it is compliant with Romanian law." The law first: under Legea 455/2001 and eIDAS a typed name
with a click, a timestamp and the hash of the text signed — `declaration_acceptances` records
all three, and refuses a signature against any other text (§57) — is a simple electronic
signature; a drawn scribble is the same category and no stronger. So the hand is presentation,
and presentation matters: the name is typed in a handwriting face (Caveat, self-hosted like
every other font, loaded only where named) and shown the same way in the backoffice. A drawing
pad — a canvas island, an image column, a size cap — is not built; it would add nothing but
work, and is recorded here as refused for that reason, open to reversal if the club's lawyer
says otherwise.

After signing, the page said "confirmed" and stopped; the first person through asked "what is
next?". It now says: the confirmation email with the QR is on its way, a reminder comes two
days before, cancel from the link. The desk row says what its controls do, in one line above
the rows, because the same person asked "what do I do here".

Baseline `BR-V1.38-2026-09-18`.

## 87. Decided — the race number is given at confirmation (2026-09-18)

**Status:** Decided and built. BR-REQ-038-01; `bibs.ts` (`nextBibNumber`), the two
confirmation paths in `registrations/service.ts`, the confirmation and reminder emails, the
runner's pages.

"Bib numbers should be generated automatically." They are: the moment a registration is
confirmed — by the participant's signature or at the desk on paper — it takes the next number
after the highest ever given at that event, inside the transaction that already holds the event
row locked for capacity, which is what makes "max + 1" safe; the unique constraint is the
backstop. A cancelled number stays taken. A test registration wears none, as in the batch. The
number goes in the confirmation email ("you collect it at the desk"), the reminder and "my
registrations"; the batch assignment stays for events confirmed before this, and the hand-typed
number at the desk stays for the day somebody swaps.

Baseline `BR-V1.38-2026-09-18`.

## 88. Decided — erased means gone; the database's size where the organizer looks; the repository's documents in the app (2026-09-18)

**Status:** Decided and built. `admin-service.ts` (erase), `diagnostics/database-size.ts`,
`/admin/tasks`, `/devs`, `/devs/docs/<name>` (`marked`, pinned).

**Erase.** BR-REQ-037-06 deleted the registration and its acceptance and left the participant
row — the address — behind. Now the participant goes with their last registration, and with it,
by cascade, their tokens and outbox rows; a participant with another registration stays. The
audit row's `participant_id` is null from then on, which is the point.

**Size.** `pg_database_size` against the Free plan's half gigabyte, read from Postgres itself
with no key, on `/devs` and on the Neon row of `/admin/tasks` — "measured", where it said "not
measured". CU-hours still come from Neon's API.

**Docs.** The repository's Markdown, rendered at `/devs/docs/<name>` for `DEV` and above — the
owner asked to read them "straight from the repo" without a checkout. A closed list of names,
never a path from the URL; the files are traced into the function; `marked` renders GFM. One
dependency, pinned, for one screen, because a Markdown renderer written by hand is the worse
choice.

Also: the email task on `/admin/tasks` reads done on QA in allowlist mode, where live is
refused by rule (§16.4) — it read "blocking" for ever there and meant nothing.

Baseline `BR-V1.38-2026-09-18`.

## 89. Decided — the listing has a month view, because the club runs on a week (2026-09-18)

**Status:** Decided and built. `events/domain/calendar.ts`, `events/ui/EventCalendar.tsx`,
`listPublishedEventsBetween`; BR-REQ-020-01 criterion 5.

The owner: "I need a calendar on the events page, similar to Google Calendar — we usually
have at least two events per week (every Monday and every Wednesday) and sometimes weekend
long runs," and, of a series he had just published, "I still can't see recurring events."
The list showed them, one card each, under the featured race, folded on a phone past four —
a list is the wrong shape for a schedule. The month is now on the listing under the hero:
`?month=YYYY-MM`, server-rendered, links only, so it costs no script and a crawler reads
next month. From `sm` up a seven-column grid, Monday first, today ringed, a race in the brand
blue and everything else quiet; at 320px an agenda of the month's days, because forty pixels
a column holds a number and nothing a thumb can hit. Wall-clock arithmetic in the club's zone
throughout — the month begins at midnight in Brașov — and the cards below stay, because the
next race deserves more than a cell.

Baseline `BR-V1.38-2026-09-18`.

## 90. Decided — an event shared is a card; icons throughout (2026-09-18)

**Status:** Decided and built. `events/share-image.tsx`, `[locale]/opengraph-image.tsx`,
`events/[slug]/opengraph-image.tsx`, `events/[slug]/share-image` (route),
`events/ui/ShareLinks.tsx`; `@mui/icons-material` pinned; BR-REQ-052-02 criterion 8.

"The posts and events should be Facebook and Instagram shareable, and should look nice on
social media." A link pasted anywhere showed the title and no picture, because an event has
no cover picture. Now every event page has an Open Graph card drawn on the server from its
own facts — title, date and time, meeting point, distance, in the brand's blue with the kit
orange — and every other page the site's own card; X gets the large-card tag. Instagram takes
no link, so the event page offers the same card as a square PNG to save and post, beside
"share on Facebook" and "send on WhatsApp", which are the networks' fixed share addresses
and load nothing from them (`docs-check` allows the two hosts as it allows YouTube's). No
photograph is stored and none is needed: a card that says when and where is what a runner
wants from a share.

**Icons.** `AGENTS.md` §1.5 prefers nothing over a dependency, and `SocialIcon.tsx` refused
the icon package for three glyphs. The owner asked for icons — on the admin tabs, on the
facts, "overall I need more icons in the app" — and the package is the honest answer:
`@mui/icons-material`, pinned, imported one file per glyph so the bundle carries the dozen
used and not the two thousand. The brand marks stay inline, because the package's brand
glyphs are deprecated and not the networks' current shapes.

Baseline `BR-V1.38-2026-09-18`.

## 91. Decided — the flow in five steps, the emails on a page, and four smaller things the test asked for (2026-09-18)

**Status:** Decided and built. `registrations/ui/RegistrationSteps.tsx`, `/admin/emails`,
`content/events/ui/EventRowMenu.tsx`, `EventFieldsForm.tsx`, `/admin/tasks`.

**The flow.** "It must be super clear for users what the flow is." The journey strip on the
form says where they stand; it did not say the whole of it. Five steps with a glyph each —
form, email, declaration, confirmed with QR and number, race day — and one aside about the
waiting list, folded on the event page under the button and on the form under the strip. The
deadlines in it are the lifecycle's own constants, so the page cannot promise what the
allocator does not keep.

**The emails.** "I must be able to see the email templates that get sent to them."
`/admin/emails`, for any staff role, renders every message type in both languages through
the same `buildTemplateContent` and `renderContent` the outbox uses, with a made-up runner
and links that go nowhere, each in a sandboxed `<iframe srcdoc>` — an email has its own
`<html>`. Linked from the guide. There is no second copy of the wording to drift.

**The row menu.** "More actions should be a context menu." The events list's native
`<details>` held two buttons open under the row; it is now `⋮` with a menu anchored to it —
preview, registrations, duplicate, delete or the reason it cannot be — and the verbs stay the
same Server Actions on hidden forms the menu submits after its confirmation. The third client
island on that page, and the first that earns it by doing what every app on the phone does.

**One place.** "Meeting point and address are a bit redundant." One field, a name or a street
or both; `location_address` stays for the rows that have one and nothing writes it. The map
field is "Meeting point link", which is what it is.

**The Neon row.** "That is a bit vague, I need a monthly cost." The row on `/admin/tasks`
projects this month's CU-hours to a full month at Launch's rates read from Neon's pricing on
2026-09-18 — no monthly fee, $0.106 a CU-hour, $0.35 a GB-month — and says the figure in
dollars; without `NEON_API_KEY` it says the rates and what 100 CU-hours would cost.

Baseline `BR-V1.38-2026-09-18`.

## 92. Decided — the queue is visible, in the order it is served (2026-09-18)

**Status:** Decided and built. `registrations/ui/QueuePanel.tsx`, `listQueueForEvent`;
BR-REQ-037-04 criterion 8.

"I need to see and simulate the waiting list." Simulating existed — test registrations on
`@test.invalid` addresses, §30 — but nothing showed the queue they filled: the list screen
shows rows and statuses, not places. The event page now has the queue as the allocator sees
it — places, confirmed, held, free by the public formula, waiting — and the waiting list
numbered in exactly the order `lockOldestWaitlisted` serves it (oldest `waitlisted_at`, `id`
on a tie), each with its offer deadline when one is out; and one paragraph saying how to make
it move. Administrator only, because it names people. Reads through `countOccupied` and
`computeOccupied`, so the panel and the public "free places" cannot disagree.

Baseline `BR-V1.38-2026-09-18`.

## 93. Decided — a dark scheme, chosen by the visitor or by the device (2026-09-18)

**Status:** Decided and built. `theme/brand.ts` (`COLOR_DARK`), `theme/theme.ts`
(`colorSchemes`), `layout.tsx` (`InitColorSchemeScript`), `shared/ui/ThemeModeToggle.tsx`,
the header's lockup.

"I need a dark theme switcher as well." MUI's own mechanism, nothing added: two colour
schemes on the one theme, selected by `data-light` / `data-dark` on `<html>`, a script in the
body that sets the attribute before the first paint from what the visitor chose (kept in
`localStorage` under MUI's key) or, until they choose, from the device's setting; a button in
the header beside the language that flips it, showing the mode it would switch *to*. The dark
palette is the brand after dark, not an inversion: pure blue on near-black is 2.4:1, so the
primary lifts to a lighter blue of the same hue, the paper is a warm grey rather than black,
and every text-on-surface pair is asserted at AA in `brand.test.ts` exactly as the light ones
are. The header shows the white lockup after dark, swapped by CSS on the same attribute so it
changes with the scheme and never after it. `brand.ts` remains the only file with a hex in it.
Amended the same evening (§95): light by default, never the device's setting — dark is what
the switch chooses.

Baseline `BR-V1.38-2026-09-18`.

## 94. Decided — race numbers are drawn at random, and every bib can be seen before it is printed (2026-09-18)

**Status:** Decided and built, reversing the order half of §65 and §87. `bibs.ts`
(`pickBibNumber`), `bib-image.tsx`, `/api/admin/events/<id>/bibs/preview`, the event page;
BR-REQ-038-01 criteria 1, 2 and 9.

"The bibs must be generated randomly." They were the next number after the highest ever
given — sequential, which tells everybody who registered first and hands the club's own
runners the low numbers. Now a registration draws, the moment it is confirmed, a number at
random from those never worn at the event: three digits while they last, four once most of
the three-digit ones are gone, so a number stays readable on a shirt; a cancelled number is
still taken, because reuse is how two people end up wearing 17. Drawn from the free set, not
"draw until unused", which is slow exactly when the range is nearly full. Under the same lock
as before; the unique constraint remains the backstop. The batch button numbers, at random,
whatever was confirmed before §87. The audit row lists the numbers given rather than a range,
because there is no range.

"I should be able to preview and see bibs for each participant — a pretty bib, with our logo,
participant name, race." Each numbered, real, confirmed registration is drawn as a picture on
request — the lockup, the race and its date, the number in the club's blue as large as the
card allows, the name — in a folded grid on the event page, Administrator only like the
sheet, since a bib carries a name. Roboto Regular and Bold, the PDF's own files, are embedded
in every picture `next/og` draws (§90's cards included), because Satori's fallback has one
weight and a race number that is not bold is not a race number.

Baseline `BR-V1.38-2026-09-18`.

## 95. Decided — the club's declaration, as the paper one reads: tokens, the identity document, a copy by email, the archive, and the texts the club approves (2026-09-18)

**Status:** Decided and built, amending §29 and AGENTS.md §1.2 on legal text.
`legal-documents/domain/merge-fields.ts`, `legal-documents/templates/*`,
`registrations/declaration-pdf.ts`, `registrations/signed-declaration.ts`, migration `0032`
(`id_document`) and `0033` (`DECLARATION_SIGNED`), `jobs/retention.ts`, `FEATURE_DISPLAY_NAME`;
BR-REQ-033-02 criteria 7–10, BR-REQ-037-04, BR-REQ-053-01.

**What the club handed over.** The declaration it used this year: "Subsemnatul/a …, posesor al
CI seria … nr. …, declar că particip pe proprie răspundere la concursul …, care va avea loc în
data de …, în locația …", the bullets, the photographs, the minors, GDPR, "DREPT PENTRU CARE
SEMNEZ, Semnătura, Data". "Exactly this is what we must do too." And, the same evening: it
must be reusable across events, so the blanks must be tokens; the identity document is needed
because kits are handed out against it, but no scan is ever kept; the signed declaration must go
back to the participant by email, as its own message; the club needs somewhere to keep them;
everything must comply with Romanian law; and the platform's legal texts should be written out,
GDPR-compliant, rather than left as outlines.

**Tokens.** A version approved in `/admin/legal` is one fixed text whose hash a signature binds
to (§57). The blanks are six named fields inside it — `{{participant}}`, `{{idDocument}}`,
`{{event}}`, `{{eventDate}}`, `{{eventLocation}}`, `{{signedAt}}` — filled in when the text is
shown to one person for one event, when it is printed, and never in what is signed: the template
is signed, the fill-ins are recorded beside it, and neither drifts from the other. A field with
no value renders as the paper form's dotted blank, which is what the blank form for the desk
shows. Six and no more; the organiser's legal name is the text's own words.

**The identity document.** Asked at signing only when the text names it (`mergeFieldsIn`), as
the series and number typed — "BV 123456", or a passport — validated for shape and nothing
else, stored on the acceptance (`id_document`), shown on the desk row and in the export beside
the two halves of the name, printed into the declaration. Never a scan, never a photograph:
the club's own words, "we can't save ID documents as scans, so even if we require it, it's just
in that declaration." Null for a paper acceptance, where the paper has it.

**The copy.** Signing enqueues `DECLARATION_SIGNED`, its own message with the PDF attached —
the participant's copy, found by its subject — and the confirmation carries a link to the same
PDF from the same manage token, read without spending it. The adapter learned attachments
(Mailgun takes repeated `attachment` parts); the PDF is rendered at send time from the rows,
never stored in the outbox. A paper signature at the desk sends the same message, saying so.
Five messages per completed registration now, and PLATFORM.md's arithmetic says twenty a day.

**Where they live.** In the database, as rows: the acceptance, the version, the fill-ins. The
PDF — the lockup, the title centred, the merged text, the typed name in Caveat, the date, the
method, the version and the hash — is a rendering, reproducible for as long as the rows exist,
and never a file on R2, whose reads are public. The club's archive is `Declarațiile semnate
(PDF)` on the event page: every signed declaration of the event in one file, one per page,
oldest first — two hundred runners are about two megabytes and a few seconds, in one query —
downloaded after the race and kept wherever the club keeps its papers, with restricted access.
Not sent to a club mailbox by attachment, because the club has no mailbox yet.

**Retention, made true.** §45 left how long a registration is kept to the club. The privacy
notice now says three years from the event — Codul civil art. 2517, the general limitation
period, within which the declaration is the evidence — so the sweep enforces it: the
registrations of events that started more than three years ago go, with their declarations,
and then every participant left with none. Erase by hand does the same sooner.

**The texts.** §29 kept every club fact a placeholder and AGENTS.md §1.2 forbade inventing
legal wording; the owner asked for the opposite — "just invent all those documents, we must be
GDPR compliant." The line drawn: the platform ships **complete texts** (`templates/`) — a
privacy notice written from the schema and satisfying GDPR art. 13 item by item, with the
processors, the periods, the rights and the ANSPDCP; terms for a free platform; the declaration
above — and the club **approves** them in `/admin/legal` after filling exactly four facts (its
legal name, address, registration number, contact address), which stay `<LIKE THIS>` because
nobody here knows them. "Start from the platform's text" prefills the draft. The seed wraps the
same texts in the not-approved banner everywhere but production, as before, and production is
still refused a seed. What gives a text effect is the club's approval, not its authorship; the
banner still says "not legal advice".

**The display name.** The organiser's other complaint: "kits are handed out against the ID
card, I do not want nicknames on our list." `FEATURE_DISPLAY_NAME`, off unless `true`, hides
the field on both forms and ignores a posted value; the list falls back to the registered name
as it always did; the export carries first name, last name and the identity document.

**Also.** Dark is chosen only by the switch, never by the device (§93 amended: "by default we
are on white"). Pictures were already compressed (two WebP variants, no original); there are
no uploaded documents — the PDFs are generated, and pdfkit deflates them.

Baseline `BR-V1.38-2026-09-18`.

## 96. Decided — the emails as the runner keeps them: bilingual, branded, with the deep links; the rules on the event page; Romanian at the root; the short texts (2026-09-18)

**Status:** Decided and built. `notifications/templates.ts` (`renderBilingual`, `card`),
`notifications/render.ts`, `event_translations.rules_json` (migration `0034`), `i18n/routing.ts`
(`localeCookie: false`), `/devs`; BR-REQ-080-01 criteria 7–8, BR-REQ-020-01 criterion 6,
BR-REQ-040-01 criterion 8.

**The mail.** The owner, reading the confirmation from QA: "we need better email, with deep
links (including 'I can't make it any more'); links to the event and the event rules; make it
bilingual by default." Every message is now one card — the club's name on a blue band, the
one action as a button in the club's blue, the deep links as a list beneath it — and carries
both languages, the registration's own first and the other under a rule, with the two subjects
joined by " / ": a runner from abroad registered in English still shows the mail to a Romanian
friend, and a Romanian who chose English by accident reads the top half. Inline styles only,
no table layout, still text-first and under 100 KB. The links: *Vezi înscrierea* (the
button), *Nu mai pot veni — anulez înscrierea* (the manage page's `#cancel` section; the GET
still mutates nothing, the cancel is the form there), *Pagina evenimentului*, *Regulamentul
evenimentului* when the page has rules, *Declarația semnată (PDF)* (§95). The reminder and
the declaration request carry the same page and rules links. Five messages per completed
registration stay five.

**The rules, and the programme.** "Also on the event page I need to show the rules" and,
later, "I need to organize race pick-up and stuff like the event schedule — treat this like a
UTMB trail race." `rules_json` and `schedule_json` per language, written in the same editor
as the description, shown under `#rules` and `#schedule` on the event page and in the preview
— kit pickup hours, the briefing, the start, the cut-offs, the awards; the declaration's own
words — "I have read the rules on the event's page" — point somewhere now, and so do the
emails. Empty stays absent. Both editors are folded and mount on opening
(`LazyRichTextEditor`): six Tiptap instances at once made the editor slow to wake on a phone,
and a save that never opened the fold posts the stored text back unchanged. Each half of a
bilingual message formats the date in its own language ("Sunday 11 October", not
"duminică"); the meeting point stays in the club's words. The bib pictures moved to their own
page (`/admin/events/<id>/bibs`) for the same reason: drawn on request, not on every visit
to the editor.

**Romanian at the root.** "The default language must be Romanian." `localeDetection` was
already off (§ the switcher); the locale cookie still sent a visitor who had once chosen
English back to `/en` from the bare root, which the owner read as the site defaulting to
English. `localeCookie: false`: every page carries its locale in its address, so English
survives navigation, and the root is Romanian for everybody, every time. The privacy notice
names no locale cookie any more.

**Also.** `/devs` shows the running Vercel deployment (environment, region, commit, branch,
deployment id) and links to the usage dashboard — Vercel publishes no usage figure to a
Hobby project's own code, so the link is the honest most. The nationality field is labelled
*Cetățenie* / *Citizenship*, which is what it asks. And the legal texts of §95 were cut to a
third at the owner's word — "short, but match the legal stuff" — by a second pass that kept
every GDPR art. 13 item and every citation and dropped the explanations: a runner reads them
on a phone, and a document nobody reads protects nobody.

Baseline `BR-V1.38-2026-09-18`.

## 97. Decided — a captcha the club can switch on, the language a runner asks for, the texts cut to a third, and the page for whoever codes next (2026-09-18)

**Status:** Decided and built. `registrations/turnstile.ts` (`TURNSTILE_SITE_KEY`,
`TURNSTILE_SECRET_KEY`), the form's `preferredLocale`, `legal-documents/templates/*`,
`docs/VIBECODING.md`; BR-REQ-031-01 criterion 4, BR-REQ-031-04 criterion 7.

**The captcha.** §19.4 built a honeypot and a timing check and said Turnstile only if those
fail. The owner: "I need a captcha when people register — I need to be safe from bots." So
Cloudflare Turnstile, behind two keys and off without them: with both set the public form
shows the widget and the server refuses a submission whose token Cloudflare does not confirm
(a network failure is a failure — a bot's token is not waved through on a bad day), and the
refusal is a field error a person reads and retries. The honeypot and the timing check stay
in front either way; the staff form has no widget. It is the one script the public site
loads from anybody else, and the visitor's address goes to Cloudflare with the challenge,
which the privacy notice says, in the sentence that only applies when the keys are set.

**The language.** "Users should be able to set a preferred language, so they may receive
the declaration in English." The registration's language was the page's; now the form asks
— "the language for your emails and the declaration", the page's language preselected — and
that is the language the declaration is signed in and the one that comes first in every
(bilingual, §96) email. The switcher in the header stays for the site itself.

**The texts, short.** §95 shipped complete texts at four thousand words; the owner: "the
terms and the GDPR notice should be short, but match the legal stuff." A second pass cut
them to a third — the notice to about 1,300 words a language in eleven sections, the terms
to under 900 in ten — and two audits checked afterwards, item by item, that every GDPR
art. 13 point and every citation survived, and that nothing said contradicts the code. What
went: explanations of why a rule exists, the same point said twice, the sections that belong
to the other document. What changed on the way, because the audits caught it: Legea 214/2024
replaced 455/2001 in October 2024 and is what the signature cites now (§86 cited the old
law); the public list and the photographs rest on legitimate interest with the right to
object, not consent; the identity document's series and number and the health note leave the
rows seven days after the event (the sweep does it), the audit log after three years; a minor
is registered by a parent, who signs for them — the declaration says so in its first line.

**The page for whoever codes next.** "This entire app must be more vibecoder friendly."
`docs/VIBECODING.md`: the loop, where things live, adding a field end to end, the rules that
bite — one page, first in the read order. `CLAUDE.md` stays the long form.

**The queue, on the board.** "Add them in the TODO section — basically all the queued work,
so I can continue tomorrow." `/admin/tasks` now carries the Turnstile row for the club (open
until the two keys exist) and, developer-owned and open by design, the work asked for and not
built: a parent
registering a minor online, the programme as timed rows with an `.ics`, each signed
declaration sent to a club archive mailbox too, Vercel usage in figures, the documentation
shortened. Static rows (`BACKLOG` in `owner-tasks.ts`) with the plan as their steps; whoever
finishes one removes it there and writes the §. The first came off the same night: the club's
mailbox is `brasovrunners@gmail.com` (a Gmail of the club's, not a person's), reading
`contact@mail.<domain>` through the Mailgun route and replying from it through Mailgun's SMTP
— free, and the privacy notice already says the mailbox is at Google. Migadu Micro ($19/year,
a mailbox on the domain with a GDPR contract) stays the upgrade if the club wants one; Zoho's
free plan is web-only now and not worth the account.

Baseline `BR-V1.38-2026-09-18`.

## 98. Decided — the club is told when email stops, the public repository's guard rails, and a race the CI found (2026-09-18)

**Context.** Three things from the last hours of the evening. The owner: "I must be notified
when I can't send emails anymore!" — the outbox keeps every message Mailgun refuses (§40:
a spent allowance defers, a socket error retries, an exhausted message is `FAILED` and kept),
and nothing tells anybody, because the only channel the platform has *is* email. Then "make
sure this public repo is safe": the repository has been public since it was created, and the
weekend put more provider credentials in play than any week before it. And PR #57's end-to-end
job failed four times on one test, `tasks-cost.spec.ts`, which passed on every laptop run.

**Email has stopped — decided.** `modules/notifications/health.ts` reads three counts from
the outbox rows the worker leaves behind: **deferred** (`PENDING` with a next attempt more
than an hour away, which only the allowance reset produces), **overdue** (`PENDING` whose turn
passed more than ninety minutes ago — longer than six backoffs and the hourly night cadence
can explain, so the scheduler is not draining), and **failed** (every attempt spent, in the
last seven days). Any of them above zero is `stalled`. `/api/health` carries the block as
`email`, reports `degraded`, and — the change that matters — **answers 503 for every status
but `ok`**, where it used to answer 200 for `degraded`. The word stays (a stalled job still
delays a notification rather than breaking the site, §16.2); the code changes because a
monitor that emails on a non-2xx is the one notification path that does not go through
Mailgun. The third cron-job.org monitor, `GET /api/health` every thirty minutes with
"notify on failure", is now a step in the "Monitors" row of `/admin/tasks` and in `SETUP.md`
§26; cron-job.org sends its failure mail from its own servers. `yarn smoke` reads the JSON
body, so `--allow-degraded` is unchanged. The same answer is red on `/admin/tasks` (the club's
screen: how many, why, and when they resume) and on `/devs`. Bounces are not in it: a bounce
is one address, and BR-REQ-080-04 shows it on the registration.

*Rejected:* failing the outbox job endpoint instead — cron-job.org disables a job that keeps
failing, which would stop the drain that clears the condition; a message to the club's
mailbox — through the channel that is down; a Vercel or Neon alert — neither sees the outbox.

**The public repository — decided.** The audit found nothing to rotate: no credential shape
in any tracked file or in the whole history, no `.env` ever tracked, the owner's name and
address in no file, phones only as the `+40712345678` examples. What it changes: GitHub's
**secret scanning and push protection** are switched on (free on a public repository; they
know Mailgun, Vercel, GitHub and AWS formats), Dependabot vulnerability alerts too, and
`yarn secrets:check` runs inside `yarn check` — the local half, before the commit exists,
knowing the shapes GitHub does not scan for: Neon (`npg_`, `napi_`), Turnstile, a
`JOB_SECRET`, a connection string with a password that is not the local one. No allowlist
file, deliberately: a false positive is escaped by writing the example differently. The
Zitadel issuer hostname and client ids stay in `docs/RUNBOOKS.md`; both are in every
sign-in redirect a browser makes and secure nothing on their own. Dependabot's first alert
(esbuild ≤ 0.24, pulled by `@esbuild-kit/core-utils` under `drizzle-kit` to bundle
`drizzle.config.ts`) is dismissed as *not used* with the reason on the alert: the advisory is
about esbuild's development server, which nothing here runs.

**The CI race — understood, not fought.** `/admin/tasks` streams behind `loading.tsx`.
React 19.2 reveals a streamed Suspense boundary on the next animation frame rather than in
the script that delivers it (`$RC` queues, `$RV` reveals). On a slow CI machine the frame
comes after hydration, and MUI's colour-scheme provider — there since §93, which is exactly
when the failures began — re-renders once on mount (`useCurrentColorScheme`'s
`setIsClient`); that update reaches the still-dehydrated boundary and React client-renders
it from the RSC payload instead of waiting. For a frame the page holds two copies of every
paragraph: the rendered one in `#main`, and the streamed one still parked in `<div hidden
id="S:0">` at the end of `<body>`. Invisible to a person; a strict-mode violation for
`getByText`. Traced from the retry's Playwright trace, which CI now keeps (the `github`
reporter alone wrote nothing to disk — hence "no valid artifacts"). The test scopes its text
locators to `#main`. MUI's `noSsr`, which removes that re-render, was rejected: it exposes the
stored mode on the client's first render, so a visitor who chose dark would hydrate against
a light server tree and React would throw the whole page away instead of one boundary.

**Consequences.** `checkEmailHealth`; `/api/health` `email` block and 503 on `degraded`;
the red alert on `/admin/tasks` and `/devs`; the fifth step of the "Monitors" row;
`scripts/secrets-check.mjs` in `yarn check`; the repository settings; the Playwright HTML
report and traces uploaded on failure; `tests/integration/notifications/email-health.test.ts`.
BR-REQ-080-02 criterion 6.

Baseline `BR-V1.38-2026-09-18`.

## 99. Decided — the archive copy of every signed declaration, to the club's mailbox (2026-09-19)

**Context.** §95 gave the runner a PDF of what they signed and gave the club one PDF per
event, rendered from the rows on request; "where do the declarations live" was answered with
"in the database, three years, and in every runner's inbox". The owner asked for the archive
to build itself once the club had a mailbox, and the club has one since the evening of
2026-09-18 (`SETUP.md` §35). This was the first of the developer rows on `/admin/tasks`.

**Decision.** `DECLARATIONS_ARCHIVE_TO`, an email address, optional. Set, every signature —
by link or on paper at the desk — queues a second message, `DECLARATION_ARCHIVE`, to that
address with the same PDF the runner receives, a subject that names the participant and the
event so the mailbox is searchable, a greeting for the club rather than the runner, and **no
action link**: the runner's copy carries their manage token, and a manage token in the club's
mailbox is a secret handed to the wrong person (§12.8). Not for a test registration: a
synthetic runner's declaration is not a record the club keeps. Unset, nothing changes — the
per-event bundle on the event page is the archive. One more message per registration on
Mailgun's allowance, so `messagesPerCompletedRegistration(archive)` is what the projections
and the task board now use; the constant stays the floor. The row on `/admin/tasks` is the
club's switch: open until the variable is set, never blocking. The migration is one enum
value, expand-only, as `0033` was.

*Rejected:* a shared mailbox the platform reads or writes to (nothing reads incoming mail,
§35), a Drive or Dropbox folder (another processor for a document that is already in two
places), and reusing `DECLARATION_SIGNED` with a payload flag — the emails page lists every
type by name, and "the club's copy" is a type.

**Consequences.** `enqueueDeclarationCopies` in `registrations/service.ts` (both paths);
`declarationArchive` in `templates.ts` (a subject and a greeting can be functions of the
data now); the attachment in `render.ts`; migration `0036`; `.env.example`; `/devs`; the
row's steps; `tests/integration/registrations/declaration-archive.test.ts`. BR-REQ-033-02
criterion 11.

Baseline `BR-V1.38-2026-09-18`.

## 100. Decided — the Mailgun plan is a setting an Administrator changes, not a constant (2026-09-19)

**Context.** `notifications/volume.ts` said, since `BR-V1.19`: "a constant and not
configuration, deliberately … an environment variable would invite it being set to whatever
makes the page look calm." The owner's request on 2026-09-19 — "I need to know the Mailgun
SKU so I know the queue limit; this should be a setting on the admin side so I can change it
dynamically when I temporarily enable Mailgun paid" — is the case that argument did not
cover: the club *will* buy a month of Basic around a race (`docs/PLATFORM.md` has said so
since limit 1 was written), and the day it does, every page that says "100 a day" is wrong
until a developer deploys, "Trimite acum" stops at a hundred that no longer binds, and the
cost table shows a free plan the club is paying for. Mailgun's API does not tell a domain
sending key which plan the account is on, so the platform cannot read it; somebody has to
say it.

**Decision.** A `platform_settings` table — key, JSON value, when, by whom; not for secrets,
ever — and its first key, `emailPlan`: one of Free, Basic, Foundation, Scale (the catalogue
in `notifications/domain/email-plan.ts`, read from mailgun.com/pricing on 2026-09-19: $0
with 100 a day; $15 with 10,000 a month; $35 with 50,000; $90 with 100,000; no daily ceiling
on any paid plan) or `CUSTOM` with the ceilings typed from Mailgun's own Account → Plan page,
both empty meaning none. An Administrator sets it on `/admin/emails`, above the messages,
next to the day's and the month's counts that would expose a wrong answer; an audit row
records who, from what, to what, and the note ("Basic for October's race, cancel on the
20th"). A stored value this code can no longer read falls back to Free, the smallest ceiling.

Every figure follows it. `readEmailVolumeToday` now returns the plan, the period that binds
(day, month, none), the ceiling and what is left of it over that period — null when nothing
binds, and the pages print the word rather than a big number. The outbox panel, `/devs`, the
task board's Mailgun row (its price as a paid line in "what the club pays today", its "next"
column from the catalogue) and the "send now" loop's stop all read the same answer. The worker
itself is unchanged: Mailgun's 402/420 still defers a message to the reset (§40), whatever
the setting says — the setting is the club's claim, the provider's refusal is the fact, and
`/api/health` (§98) tells the club when the two disagree.

*Rejected:* an environment variable (the original objection stands for a value nobody sees;
this one is on the screen that sets it, with the counts beside it, and changes with the
month, which a deploy should not have to); reading the plan from Mailgun (the sending key
cannot); a dropdown of plans without `CUSTOM` (Mailgun's catalogue changes more often than
this code).

**Consequences.** `db/schema/platform-settings.ts` and migration `0037` (expand-only);
`notifications/domain/email-plan.ts`, `notifications/email-plan.ts`, `EmailPlanPanel`,
`admin/emails/actions.ts`; `volume.ts` (`allowance`/`remaining` nullable, `period`,
`sentThisMonth`), `send-now.ts`, `platform-plans.ts` (`emailAllowance` nullable, the plan
facts); the audit action `email_plan.changed` on entity `platform_setting`; the three pages;
the guide; `tests/unit/notifications/email-plan.test.ts`,
`tests/integration/notifications/email-plan.test.ts`. BR-REQ-080-02 criterion 7.

Baseline `BR-V1.38-2026-09-18`.

## 101. Decided — Vercel's month on `/devs`, as far as Vercel's API allows (2026-09-19)

**Context.** §88 put the database's month on `/devs` from Neon's API. The owner asked for
Vercel's figures beside it ("as a dev I should also see the DB usage and Vercel usage, if
possible"), and the row on `/admin/tasks` promised "a call to the usage API, with the same
thresholds as Neon's". There is no such API: Vercel's public REST endpoint index (read
2026-09-19) has deployments, projects, domains, billing charges for paid teams — and nothing
that returns bandwidth, invocations or CPU for an account. Those exist on the dashboard's
Usage page and nowhere a token can reach.

**Decision.** Read what a token can read — the deployments list, `GET /v6/deployments` for the
project since the first of the month, paged by `until` — and derive the two Hobby ceilings a
club can actually meet: deployments a day (100) and build minutes a month (6,000, summed from
each deployment's `buildingAt` → `ready`), plus how many builds failed and when the last one
finished. Warning at eighty percent of either, as the Neon card does. The card says in plain
words that bandwidth and invocations are not in the API and links to the dashboard for them,
because a figure a page cannot show should be named as missing rather than left out. Three
optional variables: `VERCEL_API_TOKEN` (an account token, read-only in effect since nothing
here writes), `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` for a team account. The row on
`/admin/tasks` is the club's switch, done when the first two exist; `secrets:check` refuses a
token with a value in a tracked file.

*Rejected:* scraping the dashboard (a session cookie in the environment, and a page that
changes), the observability endpoints (Pro), and dropping the row as impossible — the two
ceilings above are the ones an evening of pushes spends, and a vibecoder deploying forty
times is exactly who reads this page.

**Consequences.** `diagnostics/vercel.ts`; the three variables in `env.ts` and
`.env.example`; the card on `/devs`; the row and its steps; `SETUP.md` §33;
`tests/unit/diagnostics/vercel.test.ts`. BR-REQ-090-07 criterion 4.

Baseline `BR-V1.38-2026-09-18`.

## 102. Decided — the form names what it is for, and the terms name the list, the results and the photographs (2026-09-19)

**Context.** The owner, 2026-09-19: "make sure to show the race date, details and TOS on the
sign-up form as links; on the TOS & GDPR also note your public name appearance, race photos
and race results." The form's title carried the event's name and nothing else; the terms
were linked from the footer only; and while the privacy notice's §4 already covered the
public list, the results and the photographs in full, the terms' §7 covered copyright and
photographs and said nothing about a name.

**Decision.** Under the form's title: the event's date and time in the event's own zone, the
meeting point, and four links with 44 px targets — the event's page, its rules (only when the
organizer wrote any), the terms and the privacy notice. Nothing else moves; the consents stay
where they were. The terms' §7 is now "Your name, the results, the photographs": a name is on
the public list only when the club switches the list on for that event and the person did not
opt out, and in results only with the separate consent; both withdrawable from the
registration's page without losing the registration; the copyright and photograph paragraphs
follow unchanged. The privacy notice is untouched — it said this already (§4, since §95).
The templates are not yet approved anywhere, so the change reaches the club's texts the day
it approves them; a club that already approved would take it as the next version.

**Consequences.** `events/[slug]/register/page.tsx`; `Registration.facts.*`;
`legal-documents/templates/terms.ts` §7 in both languages. BR-REQ-031-01 criterion 5.

Baseline `BR-V1.38-2026-09-18`.

## 103. Decided — six roles the club can name: the volunteer has the desk, the copywriter has the words (2026-09-19)

**Context.** The owner, 2026-09-19: "I need the copywriter role — someone who can edit texts —
because people will argue about who edits what; this needs to be simple and self-explanatory;
and volunteers who scan codes and handle registrations can do just that." And, minutes later:
"in the backoffice I need a how-to page depending on each role." Five roles existed (§10.2):
the lowest, `CONTRIBUTOR`, drafted its own texts and submitted them, and also worked the desk
(§67) and saw the events list; a volunteer handed a phone on race day was offered pages they
had no business in, and nobody's job was "the words".

**Decision.** Six roles, one new value in the `staff_role` enum (`COPYWRITER`, migration
`0038`, expand-only, placed before `MODERATOR`), and a new meaning for the lowest:

- **Voluntar** (`CONTRIBUTOR`) — the desk and the guide, nothing else. `/admin` takes them to
  the desk; the tabs offer two sections; every text is refused. The enum value keeps its name
  because Postgres does not rename enum values and nothing is gained by a second migration.
- **Redactor** (`COPYWRITER`) — `canEditTexts`: the text of any event and any page, theirs or
  a colleague's, at any status — a live edit with the same acknowledgement an organizer gives
  — page drafts, and submitting any draft for review. Not the event row, not publication, not
  the gallery, not deleting or reordering pages, nothing about registrations.
- **Organizator** (`MODERATOR`), **Tehnic**, **Administrator**, **Superadministrator** as
  before; the labels change so the staff form reads as a job description. The form's role
  select says what each role is for in one line, and its default is a role that exists (it
  said `AUTHOR`, a value from before `0016`, so nothing was selected).
- `/admin/guide` carries a copywriter's section and puts the reader's own sections first and
  open, the colleagues' after and folded (`roles` on every section in the catalogue).

The own-draft rule of BR-REQ-051-01 criterion 1 goes: "whose draft is it" was a rule for a
role that no longer writes, and a copywriter correcting a colleague's typo is the point.
`canEditTranslation` and `canTransition` keep their signatures — the callers compute the
author and the status, and a future rule may read them again.

*Rejected:* a seventh role for "publishes but does not configure" (the organizer does both and
the club is small); scoping the copywriter to drafts only (the commonest text edit is a live
typo); renaming the enum value (a migration with a lock on `staff_users` for a label).

**Consequences.** `roles.ts` (`canEditTexts`, `canCreatePage`, the rank, the sections),
`staff-labels.ts`, the dev switcher's `Dev Copywriter`, `pages/service.ts`, the pages
routes, the events list's redirect, the staff form, the guide, the catalogues; `AGENTS.md`
§10.2, `BUSINESS.md`'s role table, `SETUP.md` §34; BR-REQ-051-01 criteria 1 and 3,
BR-REQ-050-03 criterion 9, BR-REQ-060-01 criterion 8; `tests/unit/staff/roles.test.ts`,
`tests/integration/cms/{workflow,one-save,pages}.test.ts`, `tests/e2e/cms-publish.spec.ts`.

Baseline `BR-V1.38-2026-09-18`.

## 104. Decided — a free race is confirmed a week before: the participation window (2026-09-19)

**Context.** The owner, 2026-09-19: "Before the race people need to confirm their
participation (since it is free); this will be the same step as signing the declaration, one
week before the race; this needs to be clear from the sign-up wizard." The pilot's rule
(§10.5, BR-REQ-033-01): email verified → a place held thirty minutes → the declaration
signed → confirmed. Right for a Wednesday run announced on Monday. Wrong for a race
published in June: everyone who clicks in June is confirmed in June, and the club learns
who is actually coming on the morning of the race.

**Decision.** Two integers on the event, the organizer's: `confirmation_opens_days_before`
(default 7) and `confirmation_deadline_days_before` (default 2); zero on the first switches
the window off, and a deadline at or after the opening is no window. For an event further
away than the opening, a registration that clears email verification enters
`PENDING_DECLARATION` with its hold at the **deadline** — not thirty minutes, and not capped
by registration close, because closing entries ten days out while confirmations are owed two
days out is exactly the shape a race wants. The declaration email goes at once, says the
deadline and that the signature is the confirmation ("the race is free, so we ask for a
confirmation"), and the maintenance job queues it again, once per registration, when the
window opens (`queueParticipationConfirmations`, key `registration:<id>:confirm-participation`).
A signature at any point confirms. An unsigned hold lapses at the deadline through the hold
expiry that has always existed, and the place goes to the front of the waiting list with the
ordinary twenty-four-hour offer. Inside the window, and on an event without one — every
weekly run — the thirty minutes stand untouched: the person is present and the place is
scarce now. The wizard's third step reads "confirm a week before" only while that week is
still ahead; otherwise its old sentence.

Nothing in the allocator changed but the number a hold is given. `kind` still appears in no
condition; the capacity formula still counts unexpired holds; the desk still confirms on
paper; a waiting-list offer is still a signature within a day. The two columns have defaults,
so every existing event carries the window from the migration on.

*Rejected:* a second "I am coming" click separate from the declaration (two confirmations
for one fact, and the owner named them the same step); a declaration window on the waiting
list's offers (an offered place is wanted now); reading the window from the club's calendar
rather than the event (a race and a run differ, and the organizer knows which is which).

**Consequences.** Migration `0039` (expand-only, defaults 7 and 2);
`hold-deadlines.ts` (`confirmationWindow`, the `window` on `computeDeclarationHoldExpiry`);
`EventForRegistration` and every full-row construction of it; the `COMPLETE_DECLARATION`
template and `render.ts`; `queueParticipationConfirmations` on the maintenance job;
`RegistrationSteps` with a `window`; the editor's two fields; the catalogue; `AGENTS.md`
timing defaults, `BUSINESS.md`; BR-REQ-033-01 criterion 6;
`tests/unit/registrations/hold-deadlines.test.ts`,
`tests/integration/registrations/confirmation-window.test.ts`.

Baseline `BR-V1.38-2026-09-18`.

## 105. Decided — a preferential race number, picked among the free ones, and told to the runner (2026-09-19)

**Context.** The owner, 2026-09-19: "in the backoffice I can give preferential bibs (from the
available ones, avoiding conflicts); the participant will receive the bib in the email."
Numbers are drawn at random at confirmation (§94) and the confirmation email carries the
number (§87); the desk and the registration's page could already type one (§67), refused a
duplicate with a sentence, and told nobody — a number changed after the confirmation lived on
the desk's screen only.

**Decision.** Beside the field on the registration's page, the first free numbers at the event
(`suggestFreeBibNumbers`), so a preferential number is picked rather than guessed; the
uniqueness constraint and its sentence stay the guard. A number given or changed by hand on a
confirmed registration queues `BIB_ASSIGNED` (migration `0040`, one enum value): the number,
the event's facts, the QR code and the manage link, and a line saying it replaces any earlier
number. Clearing a number sends nothing — there is nothing to hand over. A number set at the
desk on the race morning sends the same message; the runner standing there reads their phone
or does not, and the record is right either way.

**Consequences.** `bibs.ts#suggestFreeBibNumbers`; `admin-service.ts#setBibNumberByStaff`;
the `bibAssigned` template and the token map in `render.ts`; the registration's page; the
catalogue; `tests/integration/registrations/race-day.test.ts`. BR-REQ-038-01 criterion 7.

Baseline `BR-V1.38-2026-09-18`.

## 106. Decided — an optional "socials" section on the form: a Strava link and an Instagram username (2026-09-19)

**Context.** The owner, 2026-09-19: "optionally, when they sign up people can put their Strava
link; make a 'socials' section (optional)." The club runs on Strava and posts on Instagram;
following a new runner back and tagging them in the race's photos is how a club of this size
keeps people. The form had no place for it and a member typed handles into the club field.

**Decision.** Two columns on the registration (`strava_url`, `instagram_handle`; migration
`0041`), a folded disclosure at the end of the optional block — closed by default, the one
section a person skips without the form being less complete — and two rules on what they
may hold: a Strava link is one of Strava's own addresses (a profile, or the app's share link)
and nothing else, so the field cannot become a link to anywhere; a username is letters,
digits, dots and underscores, stored without the `@` whichever way it was typed. Shown to
Administrators on the registration's page as links and in the export as two columns; never
on the public site, never in an email. The privacy notice template names them under the data
we keep, with consent as the basis and deletion on request; retention is the registration's
(§95). On the registration row rather than the participant: what somebody offers for one
race is not a profile, and the M4 profile can lift it when it exists.

**Consequences.** `fields.ts` (`STRAVA_URL`, `INSTAGRAM_HANDLE`), `form-mapping.ts`,
`form-errors.ts`, `names.ts`, `repository.ts`, `service.ts`, the form, the registration's
page, `admin-repository.ts`, `csv.ts` and the export route, the privacy-notice template, the
catalogue; `tests/unit/registrations/socials.test.ts`, the CSV test. BR-REQ-031-04 criterion 8.

Baseline `BR-V1.38-2026-09-18`.

## 107. Decided — events as a calendar: one `.ics` per event, and a feed the phone subscribes to (2026-09-19)

**Context.** The owner, 2026-09-19: "Can the events be iCal, so they appear in Google Calendar
and other calendars?" The listing had a month view (§89) and the backlog row for the
structured programme promised "one .ics per event". A club that runs every Monday and
Wednesday is a club whose members want the runs in the calendar they already look at.

**Decision.** `modules/events/ical.ts` writes RFC 5545 by hand — twenty lines, and the two
things that go wrong (folding at 75 octets, escaping) are the two things the unit test pins.
Instants in UTC, so no VTIMEZONE block has to be right about DST; every calendar shows the
same moment in the reader's zone. Two routes, public like the events: one event
(`/<locale>/events/<slug>/calendar.ics`, `attachment`) and the club's feed
(`/<locale>/events/calendar.ics`, every published event from a month back to a year ahead,
a calendar name, a daily refresh hint, an hour of cache). The event page offers Google
Calendar's own add-event address — one tap, no file — and the `.ics` for Apple, Outlook and
the phone's app, beside the share links; the listing offers the feed as `webcal://` and as a
download, with the sentence that it updates by itself. The description carries the short
description, the programme as plain text (§96) and the page's address, so the calendar entry
is enough on the morning. UIDs are `<event id>@<site host>`: stable across edits, so a
changed time updates the entry rather than adding a second, and distinct between QA and
production.

*Rejected:* a library (`ics` and friends bring more code than the format); per-locale
duplicate UIDs (a person who subscribes to both would see every run twice — the UID is the
event's, and the two feeds differ only in words); structured programme rows *before* the
calendar (the rows are still owed; the calendar did not have to wait for them).

**Consequences.** `events/ical.ts`; the two routes; `ShareLinks` with a `calendar` prop;
the listing's subscribe line; `updatedAt` in the public columns; `calendar.google.com` in the
provider hosts; the catalogue; `tests/unit/events/ical.test.ts`. BR-REQ-020-01 criterion 7.

Baseline `BR-V1.38-2026-09-18`.

## 108. Decided — a parent registers a minor online: the guardian's name, and who the declaration names as declarant (2026-09-19)

**Context.** The terms and the declaration have said since §95 that a minor is registered by
a parent or legal guardian who signs on the child's behalf — and the form had no place for
that person, so a parent typed their own name as the runner's or the child's as the signer's.
The first developer row on `/admin/tasks` since §97.

**Decision.** `registrations.guardian_name` (migration `0042`). The public form carries a
folded disclosure, "Registering a minor — parent or legal guardian", opened automatically when
the server named it; under eighteen by the calendar on the day of submission
(`isMinorOn`), a submission without the name is refused with `guardianName` in the fields,
so the error summary links to it. An adult's entry in the field is dropped at the service —
nobody's guardian was named. Two merge fields join the declaration's: `{{declarant}}`, which
reads the runner's name for an adult and "<guardian> (părinte/tutore legal al minorului
<runner>)" for a minor, in the text's language, and `{{guardian}}`, the bare name or an em
dash; the templates open with `{{declarant}}` and keep the clause that says in which capacity
one signs. The identity document typed at signing is the signer's — the parent's. The desk
row and the registration's page show "Minor — parent/guardian: <name>" (the kit goes to that
person), and the export has a `Guardian` column. The staff-entered form is unchanged: an
organizer entering a child at the desk records the parent on paper, as before.

*Rejected:* the age at the event's date (the schema parses a birth date without the event in
hand, and a runner who turns eighteen between the two loses nothing by having named a
parent); a separate guardian identity document field (the signer types theirs at signing,
which is where the document is asked); a guardian email (the parent's address is the one on
the form — it is the parent filling it in).

**Consequences.** `fields.ts` (`isMinorOn`, `guardianRule`), `form-mapping.ts`,
`form-errors.ts`, `names.ts`, `repository.ts`, `service.ts`, the form; `merge-fields.ts`
(`declarant`, `guardian`), `signed-declaration.ts#declarantValues`, the declare page, the
templates; `DeskRow`, the registration's page, `admin-repository.ts`, `csv.ts` and the export;
the catalogue; `tests/integration/registrations/minors.test.ts`. BR-REQ-031-04 criterion 9.

Baseline `BR-V1.38-2026-09-18`.

## 109. Decided — `CLAUDE.md` says where each thing is decided, not what it is (2026-09-19)

**Context.** "The documentation, shortened" was the last developer row on `/admin/tasks`:
every document grew at the pace of the decisions, and `CLAUDE.md` — the first thing an agent
reads — carried three hundred lines of prose under "What exists right now", each paragraph a
summary of a `DECISIONS.md` section that already existed. The owner's standing instruction is
"vibecoder friendly": the first page must say where to look, not repeat what is there.

**Decision.** The section is a map: one line per built thing, the `DECISIONS.md` section that
records why, and the `AGENTS.md` subsection or `BR-REQ` where the rule is stated. The hard
rules stay in the table above it, untouched. An adversarial check compared the old text with
the map and the pointed sections for facts an agent would need and could no longer reach; the
six it found (the one-count rule and `readPublicAvailability`, the `EMAIL_DELIVERY_MODE`
values, erase taking the acceptance in one transaction, `STAFF_AUTH_MODE=disabled` answering
404, the two pool timeouts, the wordmark's one place) were written back as one line each, and
three `§` references that pointed at `AGENTS.md` subsections were labelled so. `SETUP.md` is
not shortened: its numbered sections are procedures with values, still valid, and its length
is the record of every account the club opened; the row on `/admin/tasks` narrows to it.

**Consequences.** `CLAUDE.md` (429 → ~290 lines); the `docsSimplify` row's text; nothing else.

Baseline `BR-V1.38-2026-09-18`.

## 110. Decided — a YouTube film in the editor: the id and a caption, shown behind one press (2026-09-19)

**Context.** The owner: "in the WYSIWYG editor add the option to add YouTube videos." An
event already had one film (§69): a `videoUrl` column, shown as a closed `<details>` so the
page fetches nothing from Google until pressed, and the privacy notice describes YouTube as
"loaded when you press". The editor's allowlist (§11.3) has "no raw HTML node, scripts,
iframes, arbitrary embeds" — a rule worth keeping while adding the one embed the club wants.

**Decision.** A `youtube` block in the schema: `videoId` (eleven characters, the regex) and
`caption`, strict — never an address, never markup, never another host. The editor's control
opens a field for the film's address; `youtubeVideoId` (the same parser the event uses)
turns `watch?v=`, `youtu.be/`, `shorts/`, `embed/` and `live/` addresses into the id and
refuses anything else under the field; the address itself is kept nowhere. In the editor the
block is the film's own thumbnail with a play mark — a request to YouTube's image host in the
backoffice, by the organizer who placed the film, not on a reader's page. The renderer emits
the same closed disclosure `EventVideo` does, the `youtube-nocookie.com` embed lazy inside it,
the caption as the summary and beneath it. A click on the block opens a panel: caption, or
remove. The plain text of a body counts the caption as its words; a body holding only a film
is not empty.

*Rejected:* Tiptap's own YouTube extension (it stores the address and renders an iframe in
the editor — the rule says no iframe reaches a page from a document, and the parser here
already existed); a thumbnail-first "click to load" on the public page (the same request to
Google the disclosure avoids); any other video host (one host, one parser, one privacy
sentence).

**Consequences.** `rich-text/domain/schema.ts` (`youtubeNode`, the plain-text walker,
`hasRichTextContent`), `ui/RichTextVideo.tsx`, `ui/RichText.tsx`, `ui/RichTextEditor.tsx`
(the node, the control, the panel), `ui/labels.ts`, the catalogue, `i.ytimg.com` in the
provider hosts; `AGENTS.md` §11.3; `tests/unit/content/rich-text.test.ts`,
`tests/e2e/pages.spec.ts`. BR-REQ-050-03 criterion 16.

Baseline `BR-V1.38-2026-09-18`.

## 111. Decided — a group run is simply turned up to: no registration, no participants, no programme (2026-09-19)

**Context.** The owner, reading the editor: "group runs don't have registrations or participants,
and they don't have an event schedule … races are the most complex ones." Every event type
offered the whole registration block — the mode, the capacity, the window, the participation
window, the declaration, the public list, the external provider — and a programme editor per
language, and an organizer who is not technical (the owner's word for the club's organizer)
scrolled past all of it to publish Monday's run.

**Decision.** `event-type.ts` names the types one turns up to — `GROUP_RUN`, one list — and two
questions over it, `takesRegistrations` and `hasProgramme`. The editor's registration block
and each language's programme editor follow the type select (`OnlyForType`, which now takes a
list), with a sentence under the select saying which type has what. Hidden is not absent: a run
that was once a race still posts INTERNAL and its programme, so the service normalizes a save
of a turn-up type — `NONE`, no capacity, no window, no declaration, list `HIDDEN`, no external
fields, no programme in either language — the same way it ignores a gun time on anything but a
race (§71). Not a database CHECK: the tests and the seeds insert group runs with registrations
directly to exercise the allocator, and the rule is about what an organizer is offered, not
about what a row may hold. A hike, a coffee and a meetup keep both blocks until the club says
otherwise; moving one is a one-word change to the list.

*Rejected:* refusing the save (the organizer cannot see the field the refusal would name); a
seventh type "race with registration" (the type already says it); clearing existing rows by
migration (what is stored stays until the event is saved again, and the page shows what is
stored).

*Amended the same evening* (the owner: "group runs don't have registrations!"): the page and
the card say nothing about registration on a group run — not even "none needed"; the
question does not arise, and neither do test registrations, which the editor offers only on
an event that takes registrations. Repeat sits right under Publication on the editor
("repeating the event should be more on the top"), before the settings, the queue and the
test data; and the Save bar is sticky at the bottom of the window, above the footer, while
the long form scrolls ("this save button should be sticky at the bottom").

**Consequences.** `event-type.ts` (`takesRegistrations`, `hasProgramme`), `OnlyForType`,
`EventFieldsForm`, `TranslationFieldsForm` (`eventType`), `content/events/service.ts`
(`normalizeForType`, `applyTranslationSave#eventType`), the catalogue (`editor.typeHelp`);
`tests/integration/cms/turn-up-events.test.ts`. BR-REQ-050-02 criterion 10.

Baseline `BR-V1.38-2026-09-18`.

## 112. Decided — a glyph beside every closed-set word: type, surface, difficulty, cost; the Instagram mark in its gradient (2026-09-19)

**Context.** The owner, looking at the listing: "I also need icons for event type, surfaces,
etc", then, pointing at the featured hero's chips, "these pills should have icons", and, at the
footer, "the instagram icon should be colored." §90 brought `@mui/icons-material` for the admin
tabs and the facts' three questions; the four closed sets an event is described with — what it
is, what it is run on, how hard, whether it costs — were still bare words on chips.

**Decision.** `events/ui/glyphs.ts` holds one glyph per value of the four sets, chosen as
metaphors and written down there: a run, a chequered flag, a hiker, a cup, a group; the city,
the mountain, the fork; one, two, three bars; a coin and a crossed-out coin — and a flat map of
them by name (`type:RACE`, `surface:TRAIL`, …, `featured`). `EventKindChips` renders the type
and surface chips, once, for the listing card and the hero — whose "Featured event" chip gets
a star; the type filter carries them; the event page's overline shows them before the words;
the facts show them before the difficulty and the cost. The word stays the label everywhere —
BR-REQ-070-03 says nothing by colour alone, and nothing by shape alone follows — the glyph is
`aria-hidden` and what the eye finds first. The Instagram mark is its gradient (yellow, pink,
violet, corner to corner) as a `<defs>` in the same inline SVG, because one flat pink beside
Facebook's blue disc and Strava's orange read as the odd one out.

**What a chip's icon cannot be.** `icon={<StarIcon />}` from a Server Component typechecks,
renders in the browser, and fails hydration on every chip: during server rendering the element
reaches MUI's `Chip` as a lazy Flight reference, `React.isValidElement` says no, the icon is
dropped from the HTML, and the browser then renders it. So `GlyphChip` is a client component
that takes the glyph's *name* and makes the element on its own side of the boundary — the same
rule as the filter chips' string `href` (`AGENTS.md`: a Server Component hands MUI strings,
never component references, and now never elements either where MUI inspects them).

*Rejected:* a glyph without the word (a riddle on a phone, and nothing for a screen reader);
an icon element through a chip prop from a Server Component (above); Instagram's five-stop
official gradient (three stops are the same picture at 22 pixels).

**Consequences.** `events/ui/glyphs.ts` (`GLYPHS`, `GlyphName`), `events/ui/GlyphChip.tsx`,
`events/ui/EventKindChips.tsx`, the listing, the hero, the event page, `EventFacts`,
`shared/ui/SocialIcon.tsx`. BR-REQ-020-01 criterion 8.

Baseline `BR-V1.38-2026-09-18`.

## 113. Decided — a repeated event is one line: the same title and type, grouped, on the listing and in the backoffice (2026-09-19)

**Context.** The owner, at a listing with a Monday-and-Wednesday run made for the season
(§64): "I hate that editions are duplicated … I want to see a single line for 'Running up that
hill' like in Google Calendar." Fifty-two cards for one run, and fifty-two rows in the
backoffice, is what Repeat produced; the month view (§89) was the one place the series read as
a series.

**Decision.** Occurrences stay rows — capacity, holds and the waiting list are per event — and
the *display* groups them. The series is recognised, not recorded: `events/domain/series.ts`
groups events of the same type with the same title (trimmed, case-folded, in the language
shown), in the order the first occurrence had, and reads the recurrence off the dates on the
wall clock — weekly or fortnightly on a set of weekdays with a shared time, or "N dates until
…" for anything else. `series-sentence.ts` says it in the reader's words with `Intl`'s weekday
names and list conjunction: "În fiecare luni și miercuri, la 18:30". On the listing a
`SeriesCard` shows the title once as a link to the next occurrence, the sentence, the next
occurrence's facts, and the coming dates as 44px chips, each its own page, the rest "in the
calendar" — the month view keeps every date, like Google's grid. In the backoffice a series is
one row: the title, a "N dates" chip, the sentence, the dates folded with each one's state and
entries; the state column counts the states; the date column is the range; the tick selects
every date (the refs joined by commas, which the bulk verbs split); Edit opens the next date;
deleting a series is the bulk verb's job (§114). The type's glyph (§112) now stands before
every title in the list.

*Rejected:* a `series_id` set by Repeat (a migration and a backfill for what the title already
says; a hand-made second edition would not carry it); grouping the month view (that is the one
view where every date belongs); a card that is one big link (a card with date links inside
cannot be a link itself — the title is the link).

**Consequences.** `events/domain/series.ts`, `events/ui/series-sentence.ts`,
`events/ui/SeriesCard.tsx`, `glyphs.ts` (`series`), the listing, the events list,
`admin/actions.ts` (`selectedEventRefs`), the catalogues; `tests/unit/events/series.test.ts`.
BR-REQ-020-01 criterion 9, BR-REQ-050-02 criterion 11.

Baseline `BR-V1.38-2026-09-18`.

## 114. Decided — the bulk verbs in a bar above the list: all, N ticked, publish, archive, delete — and the ticks that never posted (2026-09-19)

**Context.** The owner, at the events list: "these batches are strange … I should be able to
batch delete all!" The bulk verbs were a fold *below* the table, out of sight of the ticks
they acted on; there was no way to tick everything and no delete. And they were stranger than
they looked: the row checkbox carried `form={BULK_FORM}` as a prop of MUI's `Checkbox`, which
puts unknown props on its wrapping span, never on the `<input>` — so no tick belonged to the
form, every bulk publish and archive posted nothing and answered "you did not tick any". Found
by the e2e test written for the new bar, whose counter stayed at zero.

**Decision.** `BulkBar`, a client island above the table, owns the form: a "select all"
checkbox (indeterminate when some), "Ticked: N" (a template string filled on the client — a
function cannot cross from a Server Component), and three submit buttons each with its own
Server Action as `formAction`: publish and archive as before, and **delete**, Administrator
only, with a dialog first; `requestSubmit(button)` names the submitter so the right action
receives the ticks. `bulkDeleteEventsAction` refuses the whole batch for a role that may not
delete, then takes each event through `deleteEvent`, which refuses one with a registration —
counted and reported, never forced. The row checkbox's `form` moved to
`slotProps.input`, where it reaches the `<input>`; a series row's tick is its dates' refs joined
by commas (§113), so deleting a whole test series is one tick. Without JavaScript the buttons
still post — the counter and "all" go quiet, and the server answers "nothing ticked".

*Rejected:* buttons disabled at zero ticks (without JavaScript zero is all the bar knows);
keeping the fold with a delete added (the fold was the strangeness); a confirmation on publish
and archive (a click away from being undone).

**Consequences.** `content/events/ui/BulkBar.tsx`, the events list (the bar, `slotProps.input.form`,
the deleted alert), `admin/actions.ts` (`bulkDeleteEventsAction`), the catalogues;
`tests/e2e/events-bulk.spec.ts`. BR-REQ-050-02 criterion 12.

Baseline `BR-V1.38-2026-09-18`.

## 115. Decided — the light/dark switch in the bottom-left corner (2026-09-19)

**Context.** The owner: "the theme switcher should be in the bottom left corner!" §93 put it in
the header beside the language switcher — the header is what every visitor pays for, and a
control used once sat on its most expensive line.

**Decision.** `ThemeModeToggle` moves to the footer's one visible line, positioned in its
left corner the way the social marks are positioned in its middle: the line is the summary's,
and a flex row cannot hold a third thing between a summary and its panel. The summary starts
after the switch; on a phone its label gives up the switch's width as well as the marks'. The
bar grows from 40 to 44px: it was thinner than a tap target while it held a disclosure and
three marks, and it holds a control now (BR-REQ-041-01). The header keeps the language
switcher alone on its right.

*Rejected:* a floating button fixed to the viewport corner (it would cover the summary on a
phone and float away from the page's column on a wide screen); keeping a second switch in the
header (one control, one place).

**Consequences.** `shared/ui/SiteFooter.tsx` (`SWITCH_WIDTH`, `BAR_HEIGHT` 44),
`shared/ui/SiteHeader.tsx`, `ThemeModeToggle`'s words. BR-REQ-041-01 criterion 11.

Baseline `BR-V1.38-2026-09-18`.

## 116. Decided — the calendar picks a month or a year, and every entry wears its type's glyph (2026-09-19)

**Context.** The owner: "the calendar should be smart, showing icons, and I should be able to
select per month, or per year!" The month view (§89) stepped one month at a time with two
arrows and "today", and each entry was a time and a title.

**Decision.** Two native selects — the month and the year, two years either way, the same
bound `parseMonth` had — go straight to the chosen month (`CalendarPicker`, the one island
the calendar has; `useRouter().push`, so the listing's loading state shows rather than a blank
page). A "Month | Year" pair of chips switches the view: `?year=2027` shows the whole year as
the agenda of every month with something on it, each month a heading (a link to its month
view) with its count, then the days — the same agenda the phone shows for a month, so the
year view needs no second design. The arrows step a year in that view. *Amended the same
evening* (the owner: "the year calendar is not boxed enough"): each month is a card — a
bordered box with the month on a tinted band — in two columns from `sm` and three from `lg`,
so the year reads as a shelf of months rather than one long list. Every entry, in the
grid, the agenda and the year, carries the type's glyph (§112) before the time. The year wins
when the address names both.

*Rejected:* twelve mini-months (at 320px a mini-month is dots nobody can tap, and the club's
year is a schedule to read, not a heat map); a range picker (two selects say it); a
JavaScript-only calendar (every address here is a link a crawler follows).

**Consequences.** `events/domain/calendar.ts` (`parseYear`, `yearsAround`, `yearRange`,
`groupByMonth`, `YEARS_EITHER_WAY`), `events/ui/CalendarPicker.tsx`,
`events/ui/EventCalendar.tsx` (`CalendarView`), the listing, the catalogues;
`tests/unit/events/calendar.test.ts`. BR-REQ-020-01 criterion 10.

Baseline `BR-V1.38-2026-09-18`.

## 117. Decided — the programme as data: timed rows on the event, a list on the page, in the reminder, one calendar entry each (2026-09-19)

**Context.** The last developer row on `/admin/tasks` but one: since §96 the programme was
free text per language, and §107's calendar carried it as text in the description. A trail
race publishes kit pickup on Saturday, the briefing at 09:30, the start at 10:00, the cut-offs
— rows with a time, and a runner wants the briefing in the phone's calendar, not only the
start.

**Decision.** `events.schedule_items` (migration `0043`, `jsonb`, null for none): `[{ startsAt,
endsAt, label: { ro, en }, place }]`, instants as ISO strings. On the event rather than the
translation because the time and the place are the same fact in either language (§36) and
only the label is a translation — so the row carries both, and a save through the editor
requires both, the way publication requires both languages (§28). `events/domain/schedule.ts`
is the one reader (`readScheduleItems` drops what is not a row), the one localizer, the one
shifter for a repeated event (§64: on the wall clock, so 09:30 stays 09:30 across the clock
change) and the one line-writer for the plain places. The editor's rows
(`ScheduleRowsEditor`, the settings' one island: add a row, remove one) post
`event.schedule[i].<box>`; a blank row is the spare line and is dropped, a half row is refused
with its number. The page shows the rows under `#schedule` as a list — the time, what, where,
with a day heading when they span days — and the free text beneath (`EventProgramme`, shared
with the preview). The reminder repeats them as one sentence per language. The `.ics` — the
event's file and the club's feed — carries one VEVENT per row after the event's own, "Crosul
aniversar — Kit pickup" at the row's time and place, UID `<event id>-<n>`, and the event's
description lists the rows before the text. Not on a group run (§111).

*Rejected:* a table (`event_schedule_items` — a join, an order column, ids to edit by, for
rows that are saved with the event in one version-guarded write anyway); rows per
translation (two lists that drift — the time is one fact); a label in one language with a
fallback (a row on one page and not the other is what §28 exists to prevent); a rich-text
table (the editor's allowlist has no table, and a table is not data).

**Consequences.** `schema/events.ts`, migration `0043_event_schedule_items`,
`events/domain/schedule.ts`, `content/events/fields.ts` (`scheduleRows`), `service.ts`
(`resolveTimes`, `normalizeForType`, `copiedEventValues`, `repeatEvent`),
`admin/actions.ts#eventFieldsFrom`, `ScheduleRowsEditor`, `EventFieldsForm`,
`events/ui/EventProgramme.tsx`, the event page and the preview, `events/repository.ts`,
`ical.ts` (`programme`), the two `.ics` routes, `notifications/render.ts` and `templates.ts`
(`eventProgramme`), the catalogues, the `scheduleStructured` row retired; `tests/unit/events/schedule.test.ts`,
`tests/unit/events/ical.test.ts`, `tests/integration/cms/programme-rows.test.ts`,
`tests/integration/notifications/render.test.ts`. BR-REQ-020-01 criterion 11, BR-REQ-050-02
criterion 13.

Baseline `BR-V1.38-2026-09-18`.

## 118. Recorded — the build plan `SETUP.md` carried, and the bootstrap it opened with, retired from the setup document (2026-09-19)

**Context.** The last developer row on `/admin/tasks`: "the documentation, shortened". §109
made `CLAUDE.md` a map and left `SETUP.md` as it was — 1,831 lines in which the numbered
procedures still valid (the topology, the accounts, the environment, Neon, Vercel, the
domain, R2, the volunteers, the sending domain) sat beside the M1 build plan: "scaffold the
application", "implement registration and capacity", nineteen sections and a ten-pull-request
list describing code that has been on production since 2026-09-17. `docs/RUNBOOKS.md` opened
with the repository's first push, step by step, and kept the first production deployment as a
runbook beside the one every release follows.

**Decision.** `SETUP.md` §6–§8 and §11–§24 are two tables — the section number, what it
asked for, where that thing lives now — under headings that keep the numbers, so every
`SETUP.md §19` in this document and the changelog still lands on a line that says where to
look; §29's M1 list is one paragraph. 1,831 lines become 1,162, and nothing an operator still
needs moved. `docs/RUNBOOKS.md` opens with "Repository settings" — what must still be true in
Settings — instead of the bootstrap, and "The first production deployment" is the two things
it added once and the one lesson, since the order is § Deploying to production's. 806 lines
become 691. The full text is in the repository's history (`git show 7ecd060:SETUP.md`,
`git show 7ecd060:docs/RUNBOOKS.md`); this section is the record of what the plan was.

**What the plan was.** The bootstrap (2026-09-02): the repository created empty, the
documentation baseline copied in with its dotfiles, `docs:check` run, one commit on `main`
tagged `baseline/BR-V1.0`, `qa` branched and made the default, the two rulesets, the AI
reviewer's read access, and deliberately no application code, no `.nvmrc`, no lockfile and no
secrets in that push. Then M1 as ten vertical pull requests:

| PR | Was to deliver |
| --- | --- |
| 1 Foundation | Root docs and `docs:check` in `yarn check`, the pre-commit hook, Next.js and MUI, the i18n shell, CI, `CODEOWNERS`, local PostgreSQL, environment validation, `.nvmrc` |
| 2 Database | Drizzle, migrations, seeds, the M1 schema with the M2 footprints (`races`, `events.race_id`, results consent, `bib_number`) |
| 3 Walking skeleton | One seeded event, the form with privacy acknowledgment and results consent, the capture outbox, a placeholder declaration, `CONFIRMED` reached on QA, clicked through by a person |
| 4 Staff auth and backoffice | Auth.js with the `staff_users` allowlist, roles, the development switcher, event edit/publish, the registration list and timeline |
| 5 Event pages | The public list and detail per locale, the exact free-place count, structured data, sitemap, robots, canonical and hreflang |
| 6 Identity, tokens, legal documents | Canonical email, hashed scoped tokens, `legal_documents` with the runbook, acceptance evidence |
| 7 Registration lifecycle | Verification, holds, the declaration, confirmed, unregistration, concurrency tests against real PostgreSQL |
| 8 Waiting list and jobs | FIFO, offers, expiry, closure at the start, the maintenance and outbox jobs, `job_runs`, the scheduler, the health check |
| 9 Live email | The Mailgun adapter, templates in both locales, delivery modes and the QA allowlist, webhooks, delivery history |
| 10 Launch gate | Domain binding, the approved legal documents, backups with a tested restore, monitoring, one real registration on production |

Sections 11–24 planned the same slices one module at a time — MUI, i18n, the database,
canonical email first, staff auth, the mini CMS, action tokens, declarations, registration and
capacity, the waiting list, the backoffice, runner profiles (M4, still not built), email and
the outbox, R2 and media — and the tables in `SETUP.md` say where each one is.

*Rejected:* renumbering the sections that stay (eighty references to §26 alone, and the
history in this document cites the old numbers); moving the retired text into this document
whole (seven hundred lines of a plan that the code superseded, when a table says the same);
deleting the M2–M5 roadmap in §29 (it is still the plan for what is not built).

**Consequences.** `SETUP.md`, `docs/RUNBOOKS.md`, the `docsSimplify` row retired from
`/admin/tasks`; `CLAUDE.md`'s note on `SETUP.md`'s length.

Baseline `BR-V1.38-2026-09-18`.

## 119. Decided — `/devs` wears the backoffice's chrome; the switch in the bar's own corner (2026-09-19)

**Context.** The owner, testing: "the config page is missing the navbar" — the Configurație tab
led to a page with no tabs to come back by, because `/devs` is its own route (BR-REQ-090-04)
outside `/admin`'s layout, and the title, the signed-in line, sign out and the tabs were that
layout's body. And, at the footer: "the theme switcher should be all the way to the left" —
§115 had put it at the page column's edge, not the bar's.

**Decision.** `BackofficeShell` (`staff-identity/ui`) is the chrome — the title, who is signed
in, sign out, the tabs — and both `/admin`'s layout and a new `/devs` layout render it; the
sign-out action is handed in, so the module never imports the app's actions. The `/devs` layout
applies the same gate (sign in, or 404 where there is no sign-in) and the diagnostics
threshold, which each page still asserts for itself. The three `/devs` pages drop their own
`<main>` and title; their headings are section headings under the shell's. The scheme switch
sits in the footer bar's corner (`left: 0` on the bar, not the column); the summary keeps
clear of it below `xl`, where the column's own margin does.

**Consequences.** `staff-identity/ui/BackofficeShell.tsx`, `admin/layout.tsx`,
`devs/layout.tsx`, `devs/page.tsx`, `devs/theme/page.tsx`, `devs/docs/[name]/page.tsx`,
`shared/ui/SiteFooter.tsx`. BR-REQ-090-04 criterion 7, BR-REQ-041-01 criterion 11.

Baseline `BR-V1.38-2026-09-18`.

## 120. Decided — a 24-hour clock in English too; the meeting point is the map link (2026-09-19)

**Context.** The owner, on the English listing: "in the calendar the time should be 24H
format" — `en` formats through `Intl` as 12-hour ("06:30 PM") while §70 already decided a
runner in Brașov reads a start time on a 24-hour clock. And, at a card: "this address should
be a link if I set that in the console" — the meeting point was plain text, with a separate
"Open the map" only on the full page.

**Decision.** Every time the site formats — the calendar, the facts, the programme, the hero,
the button, the share card, the backoffice lists, the participant's pages — carries
`hourCycle: "h23"`, so both languages read 18:30. `next-intl` has no global switch for it and
the routing locale must stay `en`, so the option sits at the calls (twenty, one `sed`). The
meeting point is itself the map link wherever a link may sit — the page, the hero, a series
card — and stays words inside an event card, which is one link itself (`EventFacts#links`);
"Open the map" appears only when there is a link and no name to carry it.

**Consequences.** the twenty call sites; `events/ui/EventFacts.tsx`, the listing's card.
BR-REQ-020-01 criterion 12.

Baseline `BR-V1.38-2026-09-18`.

## 121. Decided — two more types, "other event", a co-host, "always free", and glyphs in the editor's selects (2026-09-19)

**Context.** The owner, testing the editor and the listing, in one evening: "on the event
types I need an equipment testing type; meetup is a bit vague, and I need a special event
type" — then "eveniment special e un pic ciudat, zi doar 'alt eveniment'" — "add the
equipment testing type, co-host, external and special events"; "a co-host race — this year we
had a featured co-host event with another ONG"; "state somewhere that Brașov Runners events
are always free — this also helps us pass the Google verifications"; "these drop-downs should
also have icons"; "I hate the asphalt icon, I need something like a road".

**Decision.** Migration `0044`, expand-only: `GEAR_TEST` and `EXTERNAL` join `event_type`;
`MEETUP` keeps its value (Postgres does not rename one) and is labelled *Alt eveniment* /
*Other event*. `co_host_name` and `co_host_url` (https, checked) on the event: shown as
"Împreună cu <name>", a link to its page, in the facts on the page, the hero and a series
card; carried by a duplicate and a repeat (a series held with a partner is held with them
every time); named as a second `organizer` in the JSON-LD after the club. Every club event
not marked `PAID` says so to Google — `isAccessibleForFree` and an `Offer` at price 0 in
lei, at the event's own page, valid from its publication — and the listing's intro and the
footer's description say "always free" in words. The editor's four closed-set selects take
their options' glyphs (`GlyphSelect`, a client component for the reason `GlyphChip` is). The
asphalt glyph is a road drawn here (`RoadIcon`: two edges to the horizon, a dashed centre) —
Material has none without a plus, a pencil or a minus on it — and `Glyph` is any component
that takes `SvgIconProps`, so a drawn one sits beside Material's.

*Rejected:* renaming `MEETUP` in the database (a migration with a lock for a label, §103's
reasoning); removing `MEETUP` (every row keeps its value; a contract migration for a word); a
co-host on the translation (a name is the same in both languages, §36); "free" only in words
(Google reads the offer, not the sentence).

**Consequences.** `schema/events.ts`, migration `0044_event_types_cohost_repeat` (which also
carries §122's columns), `event-type.ts`, `glyphs.ts` (`Glyph`, `RoadIcon`), `GlyphSelect`,
`EventFieldsForm`, `fields.ts`, `service.ts`, `actions.ts`, `repository.ts`, `EventFacts`
("Together with"), `structured-data.ts`, the preview, the catalogues, `AGENTS.md` §10.1;
`tests/unit/events/structured-data.test.ts`. BR-REQ-010-01, BR-REQ-052-02 criterion 9,
BR-REQ-050-02 criterion 14.

Baseline `BR-V1.38-2026-09-18`.

## 122. Decided — a standing series: until a date or for ever, kept eight weeks ahead by the job; a date unlike the others wears a mark (2026-09-19)

**Context.** The owner, at the Repeat form: "I should basically have the repeated events
indefinitely, not set how many weeks … so basically for a recurring event I need a start and
end date, but I also need to update a certain edition — it might be cancelled or relocated!
So I need a strikethrough for that status and a warning sign with tooltip." And: "all of
this must be super DB efficient." §64's Repeat made N copies once; a season of Mondays was a
number to guess, and a run that goes on for ever was a series to re-make every few months.

**Decision.** The source event carries a rule — `repeat_rule`: cadence, weekdays, `until` (a
date, or null for ever), publish — and every occurrence is still its own row, naming its
source in `repeat_of`, so one date is cancelled or moved like any event and the rest stand.
Repeat writes the rule and creates the next eight weeks at once; the maintenance job
(`materializeStandingRepeats`, every quarter hour by day) brings every source with a rule up
to the horizon — one read off a partial index for the sources, then per source the latest
occurrence off `(repeat_of, starts_at)` and the slugs of the dates it would add, and on most
runs no write. Every occurrence is a whole number of periods from the source, so two passes
never disagree and a series stopped and started lands on the same dates; a date whose
address exists is skipped, never duplicated. "Stop the series" clears the rule and leaves the
dates (the bulk verbs remove them). The editor shows one of three things: on a date of a
series, the note and the way to the source; on a source with a rule, the sentence ("În
fiecare luni și miercuri, la 08:00 — la nesfârșit") and Stop; otherwise the form, whose
"until" is a date or nothing. Cancelled and moved dates are *read*, not recorded: the
series' usual place and time are the most common among the dates on view, and a date that
differs — cancelled first, else another place, else another hour — is struck through and
wears a mark with the sentence in a tooltip and as its name (`EditionMark`), on the series
card, in the calendar and in the backoffice's folded dates.

*Rejected:* one row with an RRULE and virtual occurrences (capacity, holds and the waiting
list are per event, and a runner registers for a date); a "moved" flag set by hand (the
organizer already changed the place; asking again is a second truth); creating the whole
series to the end on day one (a year of Mondays is 52 rows nobody has looked at, and "for
ever" has no end to create to); an unbounded horizon (eight weeks is what a runner plans and
what a listing shows).

**Consequences.** `events/domain/repeat.ts` (the rule, `occurrencesBetween`, `horizonEnd`),
`schema/events.ts` (`repeat_rule`, `repeat_of`, two indexes; migration `0044`),
`content/events/service.ts` (`repeatEvent`, `materializeSeries`,
`materializeStandingRepeats`, `stopRepeat`), `registrations/maintenance.ts`, `admin/actions.ts`
(`stopRepeatAction`), `RepeatFields` ("until"), the editor, `events/domain/series.ts`
(`usualOf`, `editionDifference`), `EditionMark`, `SeriesDates`, `SeriesCard`,
`EventCalendar`, the events list, `series-sentence.ts` (`ruleSentence`, `editionNote`), the
catalogues; `tests/integration/cms/repeat.test.ts`. BR-REQ-050-02 criterion 7 (rewritten),
BR-REQ-020-01 criterion 13.

Baseline `BR-V1.38-2026-09-18`.

## 123. Decided — "Add" on Echipa creates the Zitadel account and Zitadel sends the invitation (2026-09-19)

**Context.** The owner added himself on Echipa and waited: "I tried to invite someone
(myself) and I did not receive the code … I should have seen that email in the Zitadel
console!" Adding a person wrote the allowlist row and nothing else; the Zitadel account was
theirs to create, and the page's sentence blamed a sending domain that has been live since
§98. Zitadel's own mail goes through that domain (§35), and a test message from it arrived.

**Decision.** With a Zitadel service user's personal access token on the deployment
(`ZITADEL_MANAGEMENT_PAT`, `SETUP.md` §37; the role Org User Manager, `user.write` and no
more), `inviteStaffAction` follows the allowlist row with two calls to Zitadel's User API v2
(`staff-identity/zitadel-users.ts`): create the human user with the address marked verified —
the invitation proves the mailbox — then an invite code that Zitadel sends, the link to choose
a password. The outcome is said on the page: sent; the account already existed, sign in now;
not configured, create it in the console; refused, with Zitadel's reason and the console as
the way out. "Resend the invitation" on a row that has never signed in looks the account up
by its login name and sends a new code, which replaces the old. Locally, where the switcher is
the provider, nothing is sent. Nothing here decides who is staff: `staff_users` still does
(`AGENTS.md` §13), and a Zitadel account without a row is refused as before.

*Rejected:* the platform's own invitation email (a second link to the same door, and a
password flow that is Zitadel's to run); creating the account through the console by hand as
the documented way (it was, and the owner did not find it); the address unverified (a second
mail to click before the invitation, for a mailbox the invitation itself proves).

**Consequences.** `staff-identity/zitadel-users.ts`, `env.ts` (`ZITADEL_MANAGEMENT_PAT`),
`admin/actions.ts` (`inviteStaffAction`, `resendStaffInviteAction`), the staff page, the
catalogues, the "Invite the team" row, `SETUP.md` §37; `tests/unit/staff/zitadel-users.test.ts`.
BR-REQ-060-01 criterion 10.

Baseline `BR-V1.38-2026-09-18`.

## 124. Decided — the messages a local machine would have sent are shown on `/devs`, with their links (2026-09-19)

**Context.** The owner, testing locally: "why did I not receive the email?" Locally nothing
is sent — `EMAIL_DELIVERY_MODE=capture` keeps every message in memory (§37) — and the memory
was the drain's own, gone with the request; there was no way to click the verification link
without reading the database.

**Decision.** One capture adapter for the process (`sender.ts#sharedCapture`), the last fifty
messages kept, and a section on `/devs` — on `local` and `test` only — listing them newest
first with the links found in their text, each clickable: the participant's journey can be
walked on a laptop. Never on QA or production, where a captured message is one the allowlist
held back and carries a live token.

**Consequences.** `infrastructure/email/sender.ts` (`sharedCapture`, `capturedEmails`),
`devs/page.tsx`, the catalogue; `tests/integration/notifications/modes.test.ts` clears the
shared capture between tests. BR-REQ-090-04 criterion 8.

Baseline `BR-V1.38-2026-09-18`.

## 125. Decided — `.nvmrc` names the major, `22`, not a patch (2026-09-19)

**Context.** The owner: "Vercel is complaining about the fixed node version." `.nvmrc` said
`22.14.0` exactly; Vercel runs a major line (`22.x`, as `engines.node` already said) and warns
about a patch it will not honour, and every developer's `nvm use` failed the day a newer 22
was installed.

**Decision.** `.nvmrc` says `22`. CI (`node-version-file`) and a version manager take the
latest 22; `engines.node` stays `22.x`. Nothing in the repository depends on a patch of 22.

**Consequences.** `.nvmrc`, `README.md`, `docs/DEVELOPMENT.md`, `CLAUDE.md`.

Baseline `BR-V1.38-2026-09-18`.

## 126. Decided — fewer messages: the signed declaration rides on the confirmation, and no reminder to somebody confirmed yesterday (2026-09-19)

**Context.** The owner: "we need to minimize the number of emails sent by the platform." A
completed registration sent five — verify, sign, confirmed, the signed declaration, the
reminder — and §96 had kept it at five on purpose. Two of them said what another already said.

**Decision.** The signed declaration's PDF is attached to the confirmation — the one message
a runner keeps, which already linked the PDF — and `DECLARATION_SIGNED` is no longer queued
(the type stays, for a resend from the registration's page and for rows already queued). The
reminder 48 hours before is not sent to a registration confirmed within the last 24 hours:
that confirmation carries the same date, place, QR and number, and a copy an hour later is the
mail people learn to ignore. Four messages on the common path; three when the runner
registers on the eve. The club's archive copy (§99) is unchanged: it is the club's, and
opt-in.

*Rejected:* dropping the reminder altogether (a runner who registered a month ago wants it);
folding the verification into the sign-in link (the address is proven before anything is
held, §12.8); a "no more emails" switch per participant (unsubscribing from the mail that
carries your race number is not a favour).

**Consequences.** `registrations/service.ts#enqueueDeclarationCopies`,
`notifications/render.ts` (the attachment on `REGISTRATION_CONFIRMED`),
`notifications/event-mail.ts#queueEventReminders`; `tests/integration/registrations/
signed-declaration.test.ts`, `declaration-archive.test.ts`, `notifications/event-mail.test.ts`.
BR-REQ-033-02 criterion 9, BR-REQ-080-01 criteria 5 and 8.

Baseline `BR-V1.38-2026-09-18`.

## 127. Decided — links and pictures in a legal text, as two marks in the plain text (2026-09-19)

**Context.** The owner: "I must be able to put pictures and links in these documents." A
legal body is plain paragraphs on purpose (§46, §53): what is hashed, signed and merged is
text, and the editor is a textarea with `## ` for a heading and a blank line between
paragraphs.

**Decision.** Two marks inside a paragraph, read at render time and never stored as anything
else: `[the words](https://…)` is a link — https, mailto or a path on this site; anything else
stays words — and `![what it shows](https://…)` on a line of its own is a picture, https only,
its words the caption. `LegalDocumentBody` renders them as an `<a>` and an `<img>` with the
attributes the parser allowed and no markup; the two PDFs write the link as "the words
(address)" and the picture as its words; the hash, the merge fields and the acceptance
evidence see the text as typed. The form's help says the two marks and where a picture's
address comes from (Gallery → Pictures).

*Rejected:* the rich-text editor for legal texts (a document a person signs is hashed as
text, the PDF is drawn from paragraphs, and §46 chose that deliberately); an image without
an https address (a data URI is a file in a database column); http links (the site is https
and so are the pages it should point at).

**Consequences.** `legal-documents/domain/inline.ts`, `ui/LegalDocumentBody.tsx`,
`legal-documents/pdf.ts`, `registrations/declaration-pdf.ts`, the catalogues;
`tests/unit/legal/inline.test.ts`. BR-REQ-053-01 criterion 9.

Baseline `BR-V1.38-2026-09-18`.

## 128. Decided — the event's own day is always in its series (2026-09-19)

**Context.** The owner made a Sunday run repeat and ticked Wednesday: nine dates — the
Sunday, then only Wednesdays — and the card read "În fiecare miercuri și duminică", which
is what the sentence infers from a Sunday followed by Wednesdays (§113). "These next
occurrences are strange." §122's form took the ticked days as the whole rule, and the
event's own day, unticked, made the source a one-off before a series of other days.

**Decision.** A series always contains the event it starts from, on that event's weekday:
the ticked days are *added* to it. `repeatEvent` unions the source's wall-clock weekday into
the rule when any day is ticked (none ticked still means the event's own day at the chosen
interval; monthly has no weekdays), so the stored rule says every day the series runs on. On
the event page, where the date is known, `RepeatFields` shows that day ticked and locked and
posts it from a hidden input (a disabled box posts nothing); on the creation form the date
is not typed yet, and the service adds the day. The help text says so.

*Rejected:* moving the event to the first ticked day, as Google Calendar does (a source may
carry registrations, and its date is a fact the club published); refusing a rule without
the event's day (a second click for what the club always means); leaving it as it was with
a better sentence (the sentence was right about the dates and the dates were wrong).

**Consequences.** `content/events/service.ts` (`repeatEvent`), `RepeatFields`
(`ownWeekday`), `CheckboxField` (`disabled`), the event editor, the catalogues;
`tests/integration/cms/repeat.test.ts`. BR-REQ-050-02 criterion 7.

Baseline `BR-V1.38-2026-09-18`.

## 129. Decided — the calendar feed is fresh on every read, is called "🏃 BVR", and its place is the map link (2026-09-19)

**Context.** The owner subscribed Google Calendar to the QA feed, moved a run from 19:00 to
18:50, and Google kept 19:00 — even after removing the calendar and adding it back. The feed
was not stale at Google: it was stale at our door. §107 gave the feed `Cache-Control:
public, max-age=3600`, and Vercel's edge honours `max-age` — the copy Google fetched was
the CDN's, made before the edit (`X-Vercel-Cache: HIT`, `Age: 413`). Three more asks from the
same minute: the calendar should be called "BVR" with a runner emoji ("we love emojis"), the
place should be the Google Maps location, and "is the iCal a live update?".

**Decision.** Both `.ics` routes answer `Cache-Control: no-cache`: no copy at the edge, one
database read per fetch — a subscriber's app asks a few times a day at most, and a stale hour
is a runner at the wrong time. The feed's name is "🏃 BVR" in both languages, and its refresh
hint is an hour (`REFRESH-INTERVAL`, `X-PUBLISHED-TTL`) — Outlook reads it; Google fetches
on its own clock, about daily, and Apple as the subscriber set it, so the listing says so under
the subscribe links ("a change shows on the next read"). `LOCATION` is the organizer's map
link when the event has one (§61's `map_url`): one tap opens the map in every calendar,
where a bare address is only a promise to geocode; the meeting point's name then opens the
description as "📍 Aleea de sub Tâmpa". A programme row with its own place keeps the text;
one without takes the event's link. Google's add-event link does the same. Folding now counts
octets per code point — a four-octet emoji at the 70th character was cut in half by the old
character slice.

*Rejected:* purging the CDN on save (`revalidatePath` does not reach a route handler's
`max-age` copy, and a purge that must be remembered at every write is a bug waiting);
`s-maxage=60` (a minute is still a minute, and the read it saves costs nothing); both the
name and the link in `LOCATION` (Google shows text with a link inside as text); a
`X-APPLE-STRUCTURED-LOCATION` (needs coordinates, which §61 removed).

**Consequences.** `events/ical.ts` (`calendarPlace`, `icalFold`, `mapUrl`, the hint),
both `calendar.ics` routes, the events listing (`calendar.refreshNote`), the catalogues
(`feedName`; the unused `subscribeLink` removed); `tests/unit/events/ical.test.ts`.
BR-REQ-020-01 criterion 7.

Baseline `BR-V1.38-2026-09-18`.

## 130. Decided — a save on one date of a series reaches the following dates or all of them, and only what changed travels (2026-09-19)

**Context.** The owner, on a series of Wednesdays: "how do I edit just one occurrence instead
of all? This needs to be more like Google Calendar edits." §122 made every date its own row so
one could be cancelled or moved on its own, and that half was there: open the date, edit it,
save. The other half was not — the run moved to 18:50 had to be moved on eight Wednesdays,
one page each, and the source's new description reached only dates not yet made.

**Decision.** The editor of any event in a series — a date, or the source with the rule —
carries three radios above Save, Google Calendar's question in its words: this date only
(the default), this and the following dates, all dates of the series. The save writes the one
event as before, and then, in the same transaction, applies to the chosen dates *the
difference* this save made: every row column an organizer sets and every word of every
language posted, compared before and after, and only the columns that changed are written to
the others. So a date moved to another place on its own keeps that place unless the place is
what was edited, and a cancelled date stays cancelled unless the status is. An instant that
changed lands at the same wall-clock time on each date's own day — the day offset each date
had from this one — so 18:50 is 18:50 on every Wednesday across the clock change; the
programme's rows are shifted by the same days, as when the date was made. What never travels:
the featured flag (one event is featured), the rule and `repeat_of` (the series' own
bookkeeping), the publication state and date (publishing is a transition, per event), a film
and a Strava event (one edition's), and a slug (a public address carrying its own date). A
capacity that travels is checked against each date's own places taken, and one date too full
refuses the whole save naming its day — nothing is written, not even this date. "Following" is
by the day this date had before the save, so moving a date does not change which dates follow.
Every touched row takes a new version; the acknowledgement of a live edit given for this
date covers the others. Only a role that edits event settings may reach the series. The banner
says how many other dates were written. Dates the job has not yet made still start from the
source, which is what "all" and "following" from the source update.

*Rejected:* one row with exceptions (§122's reasons stand: capacity, holds and a runner's
registration are per date); copying every field to the other dates (a save of the title would
have un-cancelled a cancelled date and moved a moved one back); a dialog after Save as Google
has (a radio needs no script and is read before pressing, not after); "following" by the new
date (a date pulled a week earlier would have dragged its old neighbour along).

**Consequences.** `content/events/service.ts` (`applyToSeries`, `SERIES_EDIT_SCOPES`,
`saveEventAndTranslations` returns how many), `admin/actions.ts` (`scope`), the event
editor (the radios, the banner), `shared/ui/RadioField`, the catalogues;
`tests/integration/cms/series-edit.test.ts`. BR-REQ-050-02 criterion 15.

Baseline `BR-V1.38-2026-09-18`.

## 131. Decided — the editor of a date says which date it is, and shows the others one press away (2026-09-19)

**Context.** The owner, editing a Wednesday of a series: "it must be clear which edition I am
editing; the recurring ones must be easier to edit." The editor opened on a date of a series
with a blue note — "this is one date of the series …, open the series" — and the date itself
was a field far down the settings form. Eight Wednesdays meant eight trips through the list.

**Decision.** Any event in a series — a date or the source — opens under a framed header:
the series' title as a kicker, "Editing the date Wednesday 23 September 2026, 18:50" as the
heading, "date 3 of 9", every date of the series as a chip (this one filled and
`aria-current`, a cancelled or moved one marked and struck as on the public card, §122),
and "previous date" / "next date" links with the full date, plus the way to the source from
a date. The chips are `SeriesDates`, the public card's own component, with a `currentId`;
the dates come from one read (`listSeriesDates`: the source and every row naming it).

*Rejected:* a select of dates (a chip row shows the whole series and its marks at a glance,
and is what the card already taught); hiding past dates (a past date is where last week's
cancellation is undone).

**Consequences.** `content/events/repository.ts` (`listSeriesDates`), `SeriesDates`
(`currentId`), the event editor, the catalogues (`editor.series.*`, `repeatOfNote`).
BR-REQ-050-02 criterion 16.

Baseline `BR-V1.38-2026-09-18`.

## 132. Decided — the templates arrive with the club's facts written in, from the environment (2026-09-19)

**Context.** Approving the three legal texts on production was the last step between the
club and its first registration, and the owner's patience with "fill the four facts" ran out:
"AI was supposed to do it all for me." He then shared the club's ANAF fiscal registration
certificate — the legal name, the CIF and the registered seat — with two instructions:
"remember this" and "remember the repo is public".

**Decision.** The four facts reach the templates from the environment, never from source.
`CLUB_LEGAL_NAME`, `CLUB_REGISTRATION_NUMBER` and `CLUB_REGISTERED_ADDRESS` are set on both
Vercel projects and kept in `.env.local`; the contact address is `EMAIL_REPLY_TO`, which every
email already says to reply to. `templates/club-facts.ts#fillClubFacts` writes whatever the
deployment knows into a template body before the "start from the platform's text" page shows
it, leaves an unknown fact's `<PLACEHOLDER>` standing, and the page's intro names what is
still blank (`remainingPlaceholders`). With all four set, the intro says the draft is
complete, and approving is: New version → start from the platform's text → read → save →
approve, three times, no typing. The seed's sample texts keep every blank: a sample must not
look approved. The same reasoning that keeps the club's domain out of `src/` (§8) keeps a
registered seat — somebody's address — out of a public repository (§98), even though the
approved privacy notice will show it on the site: the site is the club's to publish, the
repository is everyone's to clone.

**And one press.** "Do it for me" is not a thing a page can do for the person who must take
responsibility, but it can be one act instead of fifteen: `approvePlatformTemplates` creates
and approves version 1 of every document that has no approved version, from the platform's
text with the facts written in, by the Superadministrator who presses — the same
`createDraftVersion` and `approveVersion` the long way uses, so the number is derived, the
hash is of what is stored, `effective_at` is the moment and the approver is on the row. A
document already in force is left alone (§46, §53), a fact still unknown refuses the whole act
naming the placeholder, and the page shows the facts it would write before the button, so a
wrong CIF is caught on the backoffice and not on the public notice. The row on
`/admin/tasks` and the runbook lead with it.

*Rejected:* a constant in the source (the first cut of this decision, reversed within the
hour on "the repo is public"); asking the club to type the facts (the point was not to);
approving from a seed or a script (production is refused a seed by rule, §29, and the act
must carry a person's name).

**Consequences.** `env.ts` (three optional variables), `.env.example`, `club-facts.ts`,
`admin/legal/new/page.tsx`, `service.ts#approvePlatformTemplates`, the action and the box on
`/admin/legal`, the catalogue, the task row's steps, the runbook;
`tests/unit/legal-documents/club-facts.test.ts`,
`tests/integration/legal/platform-approve.test.ts`; the values on both Vercel projects.
BR-REQ-053-02 criterion 10.

Baseline `BR-V1.38-2026-09-18`.

## 133. Decided — the type filter offers only the kinds on the calendar, as small chips (2026-09-19)

**Context.** The owner, looking at the listing on QA with two events on it: "these filters
should be smaller and I should not show for types that do not exist". Seven 44-pixel pills
— every kind the platform knows — stood above a calendar that held a run and a race.

**Decision.** The filter row is made of the kinds that have a published event in what the
page shows — the upcoming list and the month or year in view — plus the kind the address
names, so a filtered page can still say what it is filtered by. Fewer than two kinds is
nothing to choose between, and the row is not rendered. Each chip is MUI's small size, the
glyph in front, inside a 44-pixel-tall link: the tap target is the rule (BR-REQ-041-01
criterion 6, measured by the e2e suite on every link of the page), the pill's size is not.

*Rejected:* a 32-pixel chip as the link (the suite fails, and rightly: a thumb is the same
size on a filter as on a card); hiding the active kind when it has no event (the page would
be filtered by something it does not show).

**Consequences.** `app/[locale]/events/page.tsx`; BR-REQ-041-01 criterion 5 amended.

Baseline `BR-V1.38-2026-09-18`.

## 134. Decided — the dates a save reaches are ticked in the header; the three presets set the ticks (2026-09-19)

**Context.** The owner, on the header of §131: "here I should have a select all!" — and on
the three radios of §130: "this does not work correctly, they should be radios! I can
select 'this date only' but also 'this and the following dates' and 'all dates'?? does not
make sense!", then "should be more boxed and collapsible, it looks ugly on mobile!". The
radios were three standalone MUI `Radio`s sharing a `name`: the browser unticks the others,
MUI's own state does not follow, and all three showed ticked at once.

**Decision.** The chips are the choice. Every other date of the series is a chip with a tick;
a press ticks it, the arrow on it opens that date's editor, and "Toate" in front ticks every
one (or none). Above Save, a framed `<details>` says the choice in words — "doar această
dată", "această dată și următoarele (7)", "toate datele seriei (8)", or "această dată și încă
3 alese sus" — and offers the three presets as one exclusive `ToggleButtonGroup` that sets
the ticks; its explanation is inside the fold. Both read one piece of state
(`SeriesScopeProvider`, a context around the page) so the header and the box cannot disagree,
and the ticked ids reach the form as hidden `dates` inputs. The service's `SeriesEditScope`
gained `{ ids }`: exactly those dates, an id outside the series ignored, none is "this". The
three words stay for the API and the tests. The date the page is about is always in.

*Rejected:* a `RadioGroup` alone (fixes the tick, not "select all"); chips that open on
press with the tick on the icon (a tick nobody can reach from the keyboard); the box open
by default (the phone was the complaint).

**Consequences.** `content/events/ui/SeriesScope.tsx` (new; `RadioField` no longer used by
the editor), the editor page, `admin/actions.ts`, `service.ts#applyToSeries`, four keys in
both catalogues; `tests/integration/cms/series-edit.test.ts`, `tests/e2e/series-edit.spec.ts`.
BR-REQ-050-02 criterion 17.

Baseline `BR-V1.38-2026-09-18`.

## 135. Decided — the event page offers its editor to a signed-in staff member (2026-09-19)

**Context.** The owner: "when I am signed in as an admin or editor and I have the rights, I
should be able to edit events from the event page!" The way was the backoffice list, then
the row, then Edit.

**Decision.** The public event page reads the staff session — it is rendered per request
already (`dynamic = "force-dynamic"`), so this costs nothing — and, for a role that may edit
the words (`canEditTexts`: Redactor and above), shows an "Editează" button beside "back to
events", 44 pixels tall, leading to `/admin/events/<id>`. Nothing else changes for a
visitor: no session, no button, and where `STAFF_AUTH_MODE` is `disabled` the session is not
even asked for. The editor asserts the role for itself (BR-REQ-060-01); the button is a
door, not a permission.

*Rejected:* a client island that asks `/api/…` who is signed in (worth it only when the page
stops being per-request — see the caching decision, when it comes); showing the button to a
volunteer with the editor refusing (a door that does not open is a bug report).

**Consequences.** `app/[locale]/events/[slug]/page.tsx`, one key in both catalogues;
`tests/e2e/event-edit-link.spec.ts`. BR-REQ-050-02 criterion 18.

Baseline `BR-V1.38-2026-09-18`.

## 136. Decided — the three legal texts are called GDPR, the racing terms and the declaration (2026-09-19)

**Context.** The owner, on `/admin/legal`: "these documents are not named correctly! privacy
notice => GDPR, TOS => Racing TOS, declaration is fine" — and, asked whether the public
links change too: everywhere, with "Termeni de concurs" as the Romanian.

**Decision.** Wherever a reader sees the *name* of a document — the backoffice list, the
footer, the registration form's links and its consent line, the error summary — the privacy
notice is "GDPR" in both languages and the terms are "Termeni de concurs" / "Racing TOS";
the participant declaration keeps its name. The document *kinds* and their keys
(`PRIVACY_NOTICE`, `TERMS`, `EVENT_DECLARATION`), the routes (`/legal/privacy`,
`/legal/terms`), the vocabulary in `BUSINESS.md` and the prose that explains what a privacy
notice *is* do not change: a name is what the club calls the thing, not what the thing is.
The texts' own titles are the club's, written in `/admin/legal`.

*Rejected:* renaming only the backoffice list (the owner chose everywhere); "Racing TOS" in
Romanian too (an English abbreviation on a Romanian consent line).

**Consequences.** Seven keys in each catalogue; `tests/e2e/legal-versions.spec.ts`,
`tests/e2e/registration-form.spec.ts`.

Baseline `BR-V1.38-2026-09-18`.

## 137. Decided — the month is the grid on a phone too, with the surface's glyph and a tooltip; the list by choice (2026-09-19)

**Context.** §89 gave a phone the agenda because seven columns at 320px are 40px each. The
owner, on QA: "calendar looks bad on mobile: use the same calendar view man, we can have
tooltips", then "or we can choose compact view but by default I need calendar view!", and
"the icons in the calendar should also contain the type of terrain … we love icons and
emojis".

**Decision.** The month is the grid on every width. A chip in a cell is the type's glyph and
the surface's (§112) over the time on a phone, the two glyphs, the time and the title in one
line from `sm` up, the whole sentence in a tooltip and as the link's accessible name — 44px
tall wherever it is. The agenda stays, as the choice: `?view=list`, a chip pair
"Calendar" / "Listă" in the header, kept by the month links and the filter like `?type=`.
The chip is a client island (`CalendarEventChip`) because `Tooltip` needs a ref on its child
and the glyphs are made on that side of the boundary, by name.

*Rejected:* the agenda by default on a phone (§89, reversed on the owner's word); a tooltip
that opens on tap (a tap on a link is the link — the page is the tooltip on a phone);
remembering the choice in a cookie (a link says it, and a link can be shared).

**Consequences.** `events/ui/EventCalendar.tsx` (`layout`), `events/ui/CalendarEventChip.tsx`
(new), `app/[locale]/events/page.tsx` (`?view=`), two keys in both catalogues;
`tests/e2e/event-pages.spec.ts`. BR-REQ-041-01 criterion 5 amended.

Baseline `BR-V1.38-2026-09-18`.

## 138. Decided — a series card says "Săptămânal", and shows every date (2026-09-19)

**Context.** The owner, on the listing: "8 dates here is redundant, just show weekly", and
"'2 more in the calendar' does not mean anything".

**Decision.** The card's chip says the rhythm the dates have — "Săptămânal", "La două
săptămâni" — and only a set with no rhythm keeps "N date". Every coming date is a chip; the
six-and-a-count of §113 is gone, because a series is made eight weeks ahead (§122) and
eight chips wrap fine. The backoffice list keeps "8 date": there the number is the point.

**Consequences.** `events/ui/SeriesCard.tsx`, two keys added and one removed in both
catalogues. BR-REQ-041-01 criterion 9 amended.

Baseline `BR-V1.38-2026-09-18`.

## 139. Decided — "Adaugă în calendarul tău" is a small region under the month, the address and the explanation folded (2026-09-19)

**Context.** The owner: "I hate how this ics is shown: make it smaller and with a collapsed
'i'"; "should be a region like 'Add to my calendar', and this info [when each app re-reads]
should be in a tooltip". The line above the month spelled the feed's address out and
explained Google's refresh in a sentence, every visit.

**Decision.** Under the month, a bordered region titled "Adaugă în calendarul tău" with the
three doors of §107 as small 44-pixel buttons — Google Calendar, Apple/Outlook/phone
(`webcal://`), the download — an "i" (`shared/ui/InfoTip`, a tooltip whose sentence is also
its accessible name) carrying the refresh note, and the plain address inside a `<details>`
for the app that wants it pasted. Below the month rather than above: the month is what the
page is for.

**Consequences.** `app/[locale]/events/page.tsx`, `shared/ui/InfoTip.tsx` (new), two keys
replace one in both catalogues. BR-REQ-041-01 criterion 7 amended.

Baseline `BR-V1.38-2026-09-18`.

## 140. Decided — sharing is buttons, the phone's own sheet first; the picture is "Instagram" (2026-09-19)

**Context.** The owner: "the picture for Instagram should be just 'Instagram', and sharing on
social media should look nicer." §90's row was five text links in a line.

**Decision.** Two rows of 44-pixel pill buttons: "Dă mai departe" — the phone's own share
sheet (`NativeShareButton`, rendered only where `navigator.share` exists, through
`useSyncExternalStore` so the HTML and the first client render agree), Facebook, WhatsApp,
"Instagram" (the square card to save, as before) — and "Adaugă în calendar" — Google
Calendar, the `.ics`. The share sheet is the honest answer to "nicer on social media": on a
phone it reaches Instagram stories, Messenger, Telegram and whatever else is installed, which
no list of links can.

*Rejected:* a script from a network (§90's reason stands); an Instagram deep link (there is
none that takes a picture).

**Consequences.** `events/ui/ShareLinks.tsx`, `events/ui/NativeShareButton.tsx` (new), two
keys added and two reworded in both catalogues. BR-REQ-052-02 criterion 8 amended.

Baseline `BR-V1.38-2026-09-18`.

## 141. Decided — the platform emails the staff invitation itself; Zitadel's key is a bonus (2026-09-19)

**Context.** The owner, testing Echipa on QA: "my top priority is to invite users to the
platform, which did not work". It did what §123 says without the key: added the row and
said to create the account by hand. The key (`SETUP.md` §37) is a Zitadel-console step only
he can do, and until he does, "Add" sent nothing — the one thing he expected it to do.

**Decision.** A sixteenth message type, `STAFF_INVITATION`, queued in the transaction that
inserts the staff row and sent through the club's own outbox like every other message: to
the address, in the colleague's language, saying who added them (the actor's name), as what
(the role's label) and where to sign in — the sign-in page as the action, no token, because
the sign-in page is what asserts who they are. The Zitadel account is still created by the
action when the key is set (§123), and Zitadel still sends its password link then; without
the key the person creates the account at the sign-in page with that address, as the email
says. "Resend the invitation" queues the message again (a new key; a resend is a new
trigger, §12.11) and Zitadel's code where configured; refused once they have signed in.
The page's sentences say what happened in each case, and the To-do row's steps lead with the
email.

*Rejected:* waiting for the key (the row without a word to the person is what "did not
work"); sending through Zitadel's SMTP (that is Zitadel's message about a password, not the
club's about the team); a token in the invitation (nothing to act on — the allowlist row is
the grant).

**Consequences.** `email-outbox.ts` (enum), migration `0045`, `templates.ts`, `render.ts`,
`staff-identity/service.ts` (`inviteStaffUser` in a transaction, `resendStaffInvitation`),
the two actions, the preview's sample, six sentences in both catalogues, the task row's
steps; `BUSINESS.md` BR-BUS-080, `AGENTS.md` §16.3, `SETUP.md` §37;
`tests/integration/auth/role-boundaries.test.ts`. BR-REQ-060-01 criterion 11.

Baseline `BR-V1.38-2026-09-18`.

## 142. Decided — a rejected registration form comes back filled in, from an encrypted cookie (2026-09-19)

**Context.** The owner, on the QA form: "the fields are cleared after submit! super
annoying! also I can't see that the phone was not valid…". §47's rejection is a redirect
back to the form with the field *names* in the address — never the values (§14.5: a URL is
logged by every proxy between here and the phone) — so the person arrived at a summary that
named the field and a form with nothing in it, and the phone's message read like an
instruction rather than a verdict.

**Decision.** On a rejection the action keeps what was posted in a cookie for ten minutes:
AES-256-GCM under a key derived from the deployment's secret (`AUTH_SECRET`, or
`JOB_SECRET` where there is no sign-in), `httpOnly`, `sameSite=lax`, on the form's own path.
The page reads it once, only when the address says `error=`, and prefills every box — text,
the MUI selects (whose choice lives in React state, which is why the DOM could not be
refilled after the fact), the ticks, both halves of each phone. Left out: the bot fields,
the address of the form, and the privacy consent, which is re-read every time. Health notes
ride in it, which is why it is encrypted and short rather than plain and long; a draft past
the cookie's size (~3.8 KB) is dropped, not truncated, and the person retypes as before. A
submission that goes through clears it. The phone's message now opens with "the number is
not valid".

*Rejected:* the values in the URL (§14.5); a client-side form with `useActionState` (the
whole 700-line Server Component would become a client one to keep four selects); a
`sessionStorage` island (cannot refill a MUI select either); a server-side store keyed by a
cookie (a table for a ten-minute draft).

**Consequences.** `registrations/form-draft.ts` (new), the register action and page,
`ui/PhoneField.tsx` (`draft`), one sentence in both catalogues;
`tests/unit/registrations/form-draft.test.ts`, `tests/e2e/registration-form.spec.ts`.
BR-REQ-041-01 criterion 10 amended.

Baseline `BR-V1.38-2026-09-18`.

## 143. Decided — the participant list is opted into: "Vreau să apar pe lista de participanți" (2026-09-19)

**Context.** The owner, on the form's consents: "here it should be the other way round: 'I
want to appear on the participant list'". §32 made the list an opt-out — a refusal box,
legitimate interest with the right to object — beside two consents that ask the other way,
and the one box that read backwards was the one people got wrong.

**Decision.** The box reads "Vreau să apar pe lista de participanți", unticked; a tick puts
the name on, no tick keeps it off. The row keeps `list_opt_out` — the column, the published
set (`list_opt_out = false`) and the privacy test are unchanged — and the form writes the
tick's opposite. The staff entry form asks the same way. The platform's privacy notice and
terms say consent (art. 6(1)(a)) rather than objection (art. 21), withdrawn by writing to
the club; the club approves the texts on production, none is in force yet, so the wording
changes with the box. Existing rows keep what they answered.

*Rejected:* renaming the column (a migration and every query for a word); keeping the
objection wording with a consent box (the texts would say the opposite of the form).

**Consequences.** The register page and `form-mapping.ts`, the staff entry page and its
action, `templates/privacy-notice.ts`, `templates/terms.ts`, two keys in both catalogues;
`BUSINESS.md` BR-BUS-039, `AGENTS.md` §10.10, `CLAUDE.md`; `tests/unit/registrations/form-mapping.test.ts`,
`tests/e2e/registration-form.spec.ts`. BR-REQ-039-01 criteria 3–5 amended.

Baseline `BR-V1.38-2026-09-18`.

## 144. Decided — a Facebook event link on the event, beside the Strava one (2026-09-19)

**Context.** The owner: "we also need a field for the Facebook event and the Strava event".
The Strava event existed (§71, criterion 10 of BR-REQ-011-01); Facebook is where most of
the club says "going".

**Decision.** `events.facebook_event_url`, the twin of `strava_event_url` in every respect:
a page on `facebook.com`, `fb.com` or `fb.me` and nothing else (`isFacebookLink`, the same
hostname comparison as `isStravaLink` — a comparison, not an emitted address, so §8 stands),
`https://` by CHECK, its own box in the editor under the Strava one, its own labelled fact
with the Facebook mark on the event page, absent from the card, never carried onto a
duplicate or a repeated edition because it is one occurrence's page. Migration `0046`.

**Consequences.** `db/schema/events.ts`, migration `0046`, `domain/event-type.ts`,
`content/events/fields.ts`, `service.ts` (save and duplicate), the editor form and action,
`events/repository.ts`, the preview, `ui/EventFacts.tsx`, three keys in both catalogues;
`tests/integration/cms/workflow.test.ts`. BR-REQ-011-01 criterion 10 amended.

Baseline `BR-V1.38-2026-09-18`.

## 145. Decided — the backoffice shows each registration's journey (2026-09-19)

**Context.** The owner: "I wanna see as a workflow what step each participant is in, if he
signed the declaration, if he checked in and picked up his bib" — and, on the order, "there
should be a 'place reserved' first, then declaration signed and then 'place confirmed'". The
registration's page had a status chip and a timeline of timestamps (§33); the list had the
chip. Neither said, in one glance, how far a person had come, and whether the declaration
was signed had to be read off the acceptance rows at the bottom of the page.

**Decision.** Six steps, in the lifecycle's order (AGENTS.md §10.5): Înscriere trimisă,
Email confirmat, Loc rezervat, Declarație semnată, Loc confirmat, Prezență marcată — each a
fact about the registration, never about the person, so no word has to agree with whose name
it stands under. One pure derivation, `domain/journey.ts`, reads them off the row — status
first, timestamps only to date a step; a terminal row is read from its timestamps, an
expired one from its reason. **A restart reuses the row and clears nothing** (the schema's
"timestamps are historical facts"), so an old `confirmed_at`, offer or check-in outlives a
later cancellation: the derivation therefore takes `privacy_acknowledged_at` — the one
column every restart rewrites, and the insert sets — as the start of the current cycle, and
reads anything dated before it as absent. Confirmed once, cancelled, back on the waiting
list and cancelled again is "2/6", not "5/6" with a bib; a direct hold this time is not
dated with the offer of the cycle before. The participant's own email verification is one
click per person, months before a later registration, so that step is dated at this
submission and never earlier — the list is a chronology. A terminal row is read as a
ladder, each rung needing the one below it: a stale hold deadline that outlives a restart
inside one participation window cannot lift a waiting-list cancellation to "3/6".
The reservation is the hold ("până la <deadline>", dated at the email step, whose
transaction places it), the offer ("loc oferit, până la …"), or where a waiting-list entry
waits ("pe lista de așteptare", nothing after it moves). The declaration is the latest
acceptance, online or on paper — the method does not matter. The confirmation carries the
number ("nr. 42"); the desk step says "a ridicat nr. 42", because there is no separate
pickup event: the number is handed over where the person is marked present
(BR-REQ-037-08), so the check-in is the pickup. A cancelled or expired row keeps the steps
it reached, strikes the rest, and ends with "Anulată la …" / "Expirată la …".
`ui/StaffJourney.tsx` renders it — a hand-rolled `<ol>` with `aria-current="step"`, as
the participant's own journey is, no client island — in full under the name on the
registration's page, and as "3/6 · Loc rezervat" in a new "Etapă" column of the list: the
count and **the last step that is done**, which is always true, where the step being waited
on ("Declarație semnată" on a row waiting for exactly that, "Prezență marcată" on every
confirmed row on race morning) would read as its opposite; "urmează: …" and how the row
ended are in the hover title, and the status chip beside it says Anulată already. The list
row carries what the derivation needs — the cycle's start, the participant's own
verification, the hold and offer columns, and the latest acceptance's date through the same
one-probe subquery `idDocument` uses — never a query per row. The six step names are names
for the lifecycle's states, like the status chip's, so they live in `staff-labels.ts` in
Romanian, once (§35: "enums and stuff should not be in 2 languages"); the sentences around
them — the deadline, the number, "urmează", "Anulată la" — are chrome and stay in both
catalogues. Test registrations show the same journey: the backoffice is where they are
looked at.

*Rejected:* MUI's `Stepper` (a client island for six words); a "declaration signed" column
on the registration (the acceptance table is the record, and a copy would drift); a status
→ step lookup with no timestamps (the dates are what the owner reads next); sorting on the
column (the status beside it is ordered already); clearing the cycle's timestamps on a
restart (it would change the schema's documented rule for one reader, and a cycle marker
already exists); reading a terminal row by its latest-dated marker (a hold has no date of
its own, only a deadline).

**Consequences.** `registrations/domain/journey.ts` (new), `ui/StaffJourney.tsx` (new),
`staff-labels.ts` (`JOURNEY_STEP_LABEL`), `admin-repository.ts` (the list row and the
detail carry `cycleStartedAt`, `emailVerifiedAt`, `declarationAcceptedAt` and the hold,
offer and ending columns), the registration page and the list page, one column header and
one caption and a `journey` block of sentences in both catalogues;
`tests/unit/registrations/journey.test.ts`,
`tests/integration/registrations/admin-list.test.ts` (a restart driven through the
service), `tests/unit/i18n/messages.test.ts`. BR-REQ-037-03 criterion 5.

Baseline `BR-V1.38-2026-09-18`.

## 146. Decided — the opening date shown big, and "Anunță-mă când se deschid înscrierile" (2026-09-19)

**Context.** The owner: "I need 'registrations open at (date)' because first I advertise the
event, then I need to let them know when registrations are opened." The event page said
"Înscrierile se deschid pe 4 octombrie 2026, 18:00" in one quiet sentence
(`RegistrationCta`); the cards said "Înscrierile nu s-au deschis încă" with no date; the
calendar feed said nothing; and there was no way for the people the advertisement reached to
be told when the moment came, short of checking the page. He chose both halves: the date,
everywhere the event shows, and an address box that sends one message when the window
opens — on the maintenance job's first run after it, which the pinger drives every fifteen
minutes by day and hourly at night (§68); no page and no request stands at the opening
instant, and every text that describes the message says so rather than promising the minute.

**Decision.** *The date.* While `registrationState` is `NOT_YET_OPEN`, `RegistrationCta`
renders the existing sentence at the countdown's size and in the club's blue — it is the
one thing a visitor wants before the window, and it stands exactly where the button will —
on the hero and the event page alike, since the hero already renders the component. The
compact facts on the listing and series cards replace the state word with
"Înscrierile se deschid pe 4 oct., 18:00" (`cta.opensOnShort`, short month, the event's
zone). The calendar feed and the per-event `.ics` write "Înscrieri din 4 octombrie 2026
la 18:00" above the programme, from a new `registrationOpensAt` on `CalendarEvent` that the
routes set through `upcomingRegistrationOpening` — the public row's own column would also
name an opening long past, so the caller decides and the pure module writes. The card
reads the same helper; the sentence on the page is `registrationCta`'s own `opensAt`.

*The box.* Under the sentence on the event page, only while the window is ahead **and an
approved privacy notice exists for the locale** — the registration form's own gate
(BR-REQ-053-01) and the participant list's (§32): an address is personal data taken under
consent, and the notice is what describes it, so the page reads
`findCurrentApprovedDocument` once before rendering the box and `registerInterest` refuses
(CONFLICT, the plain page) whoever posts past it. On production today, with no approved
texts, there is no box. `RegistrationInterestForm`, a Server Component around a Server
Action (`events/[slug]/actions.ts`) — one email field, "Anunță-mă", the line "Îți trimitem
un singur email când se deschid înscrierile; adresa se șterge după aceea." and the link
"Detalii în nota de confidențialitate." to `/legal/privacy`. It is a public form, so it
takes the registration form's defences unchanged: the honeypot and the rendering time as
hidden fields, `looksLikeSpam` (now exported from `service.ts`) with the same silent answer,
and Turnstile through the same `verifyTurnstile` when the keys are set. One field is
retyped in under three seconds, so the `invalid` redirect carries the original rendering
time back as `?since=` (`parseInterestSince`: a timestamp, never a value, ignored when
unparseable or ahead of the clock) and the corrected form is timed from the render it
corrects, not from the redirect. `registerInterest`
canonicalizes the address with the versioned canonicalizer (AGENTS.md §10.4) and inserts
into **`registration_interests`** — event, delivery address, canonical address and its
version, the page's locale — `ON CONFLICT DO NOTHING` on `(event_id, canonical_email)`;
migration `0047`, expand only. The action redirects to `?interest=1#registration-interest`
whether the row was new, already there or a bot's, and the page says "Te anunțăm pe email
când se deschid înscrierile." — the resend-oracle rule, BR-REQ-031-01 criterion 3; a
malformed address is the one fixable error (`interest=invalid`), a failed widget the other
(`interest=captcha`); never a value in the URL (§14.5). Once the window is no longer ahead
the service answers CONFLICT and the action lands on the plain page, where the button now
is. No rate-limit bucket: the limit is keyed on the identity, and the identity's second
submission is already a no-op.

*The message.* `REGISTRATION_OPENED`, the seventeenth type — "Înscrierile la <event> s-au
deschis" / "Registration for <event> is open", the facts line, one paragraph, one paragraph
saying why they got it and that the address is gone, "Înscrie-te" as the action, the event's
page and its rules beneath. No participant and no token, like `STAFF_INVITATION`: the
renderer loads the event by the `eventId` in the payload, so a renamed event renders right,
and the action is the ordinary registration page, which asks everything itself. The greeting
names nobody ("Salut,"). Previewed on `/admin/emails` with the other sixteen; the two labels
that page reads (`types`, `when`) were also missing for `STAFF_INVITATION` and are added.

*The job.* `queueRegistrationOpenedMessages`, a step of the registration maintenance after
the participation confirmations (§104), in its own try/catch: one read joins the events that
have interest rows; per event `registrationState` decides — `NOT_YET_OPEN` waits; `OPEN` on a
published event queues one message per row (`interest:<id>:opened`, participant and
registration null, `{ eventId }`) and deletes the rows in the same transaction; `OPEN` on an
unpublished event waits for the page to come back; anything else — cancelled, completed,
started, closed before it opened, moved to another form or to none — deletes the rows with
no message. So an address exists until the message that is its purpose is queued, and not a
minute longer; the outbox row keeps `recipient_email` like every other message, under the
outbox's own ninety days. There is no `notified_at`: a row that has been notified does not
exist.

*The notice.* One paragraph in section 5 of the platform's privacy-notice template, both
languages: the purpose, the one message "shortly after" the opening, the address kept on
the notification list only until it is sent and deleted from that list with it — the
message itself keeps the address like every other message, which the paragraph above
already says — consent (art. 6(1)(a) GDPR), withdrawal by writing to the club before it
goes. The terms need nothing — nothing is entered.

*Withdrawal.* The notice's promise has a verb in the backoffice, or the club could keep it
only from the database console: on the event's page, under the queue and only while the
window is ahead, "Adrese care așteaptă anunțul deschiderii: N" (`countInterests`, the count
and never an address) and one small form, the address typed and "Șterge din listă" —
`withdrawInterestAction`, Administrator like the queue, `withdrawInterest` deleting by the
canonical identity so the address as the person wrote it finds the row as they typed it.
The answer says whether a row went: the person asking is staff.

*Rejected:* a second count or a second formula for the date (the sentence is
`registrationCta`'s own `opensAt`, read through one helper); a client island for the box
(a form and a redirect need no script; `SubmitButton` is the one shared island); the
address in a cookie or the URL on a rejection (one field, retyped); a participant row for an
address that registered nothing; keeping the row with a `notified_at` (a list of who was
told is a list the club never asked for, and the notice promises deletion); a rate-limit
scope (see above); Google Calendar's `details` (a one-tap link, not a subscription — the
feed is where the date matters); a request-time trigger at the opening instant (nothing
runs then; the job's cadence is the promise, and the texts say so); skipping the timing
check on the corrected render (a flag a bot could post — the original time is carried
instead); a list of the waiting addresses in the backoffice (a count and a withdrawal are
what the notice needs).

**Consequences.** `db/schema/registration-interests.ts` (new), `db/schema/email-outbox.ts`,
migration `0047_registration_interests`; `registrations/interest.ts` (new: `registerInterest`,
`countInterests`, `withdrawInterest`, `queueRegistrationOpenedMessages`), `interest-box.ts`
(new), `ui/RegistrationInterestForm.tsx` (new), `service.ts` (`looksLikeSpam` exported),
`maintenance.ts` (the step, `interestsNotified`); `app/[locale]/events/[slug]/actions.ts`
(new) and `page.tsx`; `app/[locale]/admin/actions.ts` (`withdrawInterestAction`) and
`admin/events/[id]/page.tsx`; `events/domain/registration-window.ts`
(`upcomingRegistrationOpening`), `events/ical.ts` (`CalendarLabels`, `registrationOpensAt`),
both `calendar.ics` routes, `ui/RegistrationCta.tsx`, `ui/EventFacts.tsx`;
`notifications/templates.ts`, `render.ts`; `legal-documents/templates/privacy-notice.ts`;
twenty-one keys in both catalogues (eleven under `Event`, four under `Admin.emails` — two of
them the `STAFF_INVITATION` labels that were missing — six under `Admin.queue`);
`tests/integration/registrations/interest.test.ts` (new), `tests/unit/events/ical.test.ts`,
`tests/unit/events/registration-window.test.ts`, `tests/helpers/db.ts`. BR-REQ-011-01
criterion 13, BR-REQ-080-01 criterion 9; AGENTS.md §16.3; BUSINESS.md BR-BUS-080; CLAUDE.md's
count.

Baseline `BR-V1.38-2026-09-18`.

## 147. Decided — more places go to the waiting list at once (2026-09-19)

**Context.** The owner: "we have 200 spots but first I give 100, then I have a waiting
list and give 100 more." The editor already refused a number below the places taken
(BR-REQ-034-02 criterion 3) and wrote a higher one, but nothing happened to the people
waiting: `fillAvailableSpots` runs on a confirmation, a cancellation, an offer's lapse and
the maintenance job's sweep of events with a hold past its deadline — and an event whose
capacity grew has no lapsed hold, so its queue stood until somebody cancelled or the job
happened to pass. Criterion 4 ("given capacity is increased, when the transaction commits,
then existing waiting-list entries are allocated before any later direct registration") was
true only because the next direct registration would fill the queue first. The owner chose:
the offers go out on save, and a sentence in the editor says so.

**Decision.** *The save.* `saveEventAndTranslations` compares the row before and after
(`capacityRaised`: INTERNAL, and either a higher number or a number turned to none) and,
when raised, calls `offerRaisedCapacity` **inside the same transaction**, after the guarded
update — which already row-locks the event — and once more through `lockEventForCapacity`,
the serialization point every capacity-changing decision takes (AGENTS.md §10.6), reading
the row as it now stands; then `fillAvailableSpots` with it, the one thing that offers.
The new number and the offers it makes commit together or not at all. `fillAvailableSpots`
now returns how many it offered; its other callers ignore the number. A series save (§130)
does the same per date it touches, when the capacity travelled and is higher than *that
date's* own number — each date has its own line and its own places — and the two counts add
up. *Not on a cancelled race.* `capacityRaised` asks for SCHEDULED too: a race cancelled and
widened in the same press — the status and the number are one form — would otherwise email
24-hour offers whose link answers only that the event is cancelled; cancelling expires
nobody, so the same holds for a later edit of a cancelled event with people still waiting.
On the series path each date's own status counts, as it now stands. *The count behind the
lock.* Criterion 3's count of the places taken now runs after `lockEventForCapacity`, on
the event and on every series date: a plain SELECT inside the transaction waited for
nothing, so a confirmation committing between the count and the guarded update could leave
the number one below the places taken — the version guard only ever caught another save.
*The locked row's places.* The allocator's locked paths — the email link, the signature, the
desk's confirmation and promotion, a cancellation — handed `allocateOrWaitlist` the
caller's row, whose `capacity` was read before the lock; now that a raise is an everyday
save, a person confirming while it lands would be waitlisted against the old number with the
new places standing free until the allocator's next visit. `withLockedCapacity` gives them
the locked row's number instead. *The lifted cap.* Nothing is ever waitlisted against an uncapped event, so
`fillAvailableSpots` returned at once for one — which would have left the people waiting
under the old number stranded the moment it was removed. For an uncapped event the waiting
count now stands in for the available places: zero on every ordinary visit, everyone waiting
on the visit that lifts the cap. AGENTS.md §15.6 says so. *The words.* The service answers
`{ appliedTo, offered }`; the action carries `offered=N` beside the existing `saved` and
`applied`, and the editor's banner reads "Salvat — locuri oferite listei de așteptare: 12."
or, with a series, "Salvat — și pe încă 3 date ale seriei; locuri oferite listei de
așteptare: 12."; nothing new when nobody was offered. The count stands after a colon
because "1 locuri" and "100 locuri" are both wrong in Romanian and the catalogues carry no
ICU plurals (`docs/VIBECODING.md`). Under "Număr de locuri", while anyone
waits: "Pe lista de așteptare: N. Dacă mărești numărul, locurile noi se oferă imediat, în
ordine, câte 24 h fiecare." — the organizer's word on that screen is the number, not the
capacity — the count is read once on the page (`countEligibleWaitlisted`)
and handed to both the queue panel, which counted it itself before, and the settings form,
as a number; the form is a Server Component and builds the sentence. The queue panel's
"how to simulate" note names the raise beside a cancellation and a lapse.

*Rejected:* offering from the action after the commit (a second transaction, a second lock,
and a save that succeeds while its offers fail); a count taken from the outbox or the rows
after the call (the allocator knows what it did); calling the allocator on every save (the
sentence promises offers on a raise, and a lapsed hold's offer belongs to the job that
notifies it); a new message type or a different hold for the raise (a place is a place; the
runner's email is the same offer); a second formula for "raised" on the series (the same
function, each date's own number); offering on a cancelled event because the allocator's
other doors are status-blind (they are reached by a person's act on a live event; the editor
is the one door where the status changes in the same transaction); an ICU plural for the
banner's count (the catalogues carry none; the colon needs no agreement).

**Consequences.** `registrations/service.ts` (`fillAvailableSpots` returns the offers,
fills a lifted cap; `withLockedCapacity` in every locked path); `content/events/service.ts`
(`capacityRaised` — SCHEDULED and INTERNAL, `offerRaisedCapacity`, the row locked before
criterion 3's count in `saveEventFields`, `saveEventAndTranslations` and `applyToSeries`,
`applyToSeries` over a `Transaction` returning `{ applied, offered }`,
`saveEventAndTranslations` returning `offered`); `app/[locale]/admin/actions.ts`,
`admin/events/[id]/page.tsx`; `content/events/ui/EventFieldsForm.tsx` (`waiting`),
`registrations/ui/QueuePanel.tsx` (`waiting` as a prop); three keys under `Admin.editor`
in both catalogues and `Admin.queue.simulate` extended;
`tests/integration/cms/capacity-raise.test.ts` (new). BR-REQ-034-02 criterion 5;
AGENTS.md §15.6. The concurrency contract (`tests/concurrency/capacity.test.ts`) is
untouched: the raise takes the same lock, in the same place, and nothing bypasses
`transitionRegistration`.

Baseline `BR-V1.38-2026-09-18`.

## 148. Decided — the health check measures each deployment against its own pinger cadence (2026-09-19)

**Context.** The owner's inbox: nine "Cronjob failed: QA health" emails in an evening,
while `yarn smoke` on QA said `ok` every time it was asked. §68 pings QA's job endpoints once
an hour to spare its free CU-hours, but §98's health check called a job stale after twice
production's fifteen minutes plus five — thirty-five minutes — so QA was "degraded" (a 503,
which is what a monitor treats as failed) for the last twenty-five minutes of every hour by
day, and the thirty-minute health monitor caught it about half the time.

**Decision.** The day cadence is the deployment's own: `PINGER_CADENCE_MINUTES` (default 15,
production's; QA carries 60, set on its Vercel project on 2026-09-19). The threshold stays
twice the cadence plus five; the night stays hourly everywhere, never faster than the day.
The owner's proposed workaround — move QA's health monitor to minute 2 of the hour, right
after the ping — would have halved the false alarms and kept the lie; a deployment should
say how often it is pinged.

*Rejected:* deriving the cadence from `APP_ENV` (a monitor's schedule is set in a console,
not in the code, and the two have drifted once already); relaxing the threshold everywhere
(production's alarm would fire an hour late).

**Consequences.** `env.ts` (`PINGER_CADENCE_MINUTES`), `jobs/quiet-hours.ts`
(`pingerCadenceMinutes`, `jobStalenessThresholdMs(now, dayCadence?)`), `.env.example`,
`SETUP.md` §36 and the variable table; `tests/unit/jobs/quiet-hours.test.ts`. The QA
project's variable takes effect on its next deployment — the release of PR #64.

Baseline `BR-V1.38-2026-09-18`.

## 149. Decided — a contact form that reaches the club's Gmail without Mailgun (2026-09-19)

**Context.** The owner: "Email communication must be minimal so we meet the quota. A
contact form on the website that submits to the club's Gmail and bypasses Mailgun.
Protected against bots. We configure as devs where the emails go, because Amalia has a
Yahoo account too." The footer already showed `EMAIL_REPLY_TO` as a `mailto:`; on a phone
without a mail app that is a dead end, and every message the platform sends today goes
through Mailgun's 100 a day (§98, §100), which the registrations need. He chose Gmail SMTP
with an app password over a second Mailgun route, and bot protection alone — no account,
no login, no privacy-notice gate beyond the sentence on the form.

**Decision.** `/contact` in both locales — "Scrie-ne" — a Server Component with the
registration form's shape: name, email (validated like the form's, then canonicalized),
message (2 000 characters — the longest the draft cookie hands back on a rejection, with the
longest name and address; a unit test seals one), the honeypot, the fill-time check and
Turnstile when its keys are set, a 44 px "Trimite", and one line — "Mesajul ajunge în căsuța
clubului; datele nu se folosesc pentru altceva. Detalii în nota de confidențialitate." — the
notice named as the registration form names it, not the footer's bare "GDPR". "Contact" in
the header (one more entry for the priority+ fold, so the 320 px row is unchanged; offered,
like the gallery's, only while the page has a form or an address to show) and "Scrie-ne" in
the footer beside the legal links, each 44 px. The Server Action verifies Turnstile,
validates, answers a bot with the same `?sent=1` and sends nothing, says "no way out" before
anything is counted, counts the sender in `rate_limit_buckets` under `contact-message` (five
an hour on a SHA-256 of the canonical email — the notice says no copy of the address is kept,
and the row lives a day) and — unlike the form's silence — tells a person who hit it so,
plainly, because a person is not a bot; then sends and redirects to `?sent=1`, "Mesajul a
plecat. Îți răspundem pe <adresa>." A rejection is `?error=VALIDATION_ERROR&fields=…` with
the typed values in the encrypted draft cookie (§142), never a value in the URL; a refused
send is `?error=DELIVERY` with "Scrie-ne direct la <EMAIL_REPLY_TO>", its code (`smtp EAUTH`,
`smtp ESOCKET` — never the password or the server's reply) in the function log, and the
attempt given back to the sender (`refundRateLimit`): a message that reached nobody is not
one of their five, so a wrong-password day never turns "we could not send" into "too many
messages". After a send the cookie keeps the address alone, for that sentence.

*The transport.* A second adapter beside Mailgun's, `infrastructure/email/smtp-adapter.ts`,
over **nodemailer 10.0.10** (pinned; Node has no SMTP client, and a hand-written one over
`node:tls` is the code that works until Google changes a greeting): host and port from
`CONTACT_SMTP_HOST`/`CONTACT_SMTP_PORT` (defaults `smtp.gmail.com`, 465, implicit TLS;
`smtp.gmail.com` joins `PROVIDER_HOSTS` in `docs:check` as Google's own fixed host), the
account and its 16-character app password in `CONTACT_SMTP_USER`/`CONTACT_SMTP_PASSWORD`,
the recipients in `CONTACT_FORM_TO` (comma-separated, each validated at startup). The
message: from the account with the club's name, to every recipient, `Reply-To` the visitor
with their name, subject "Mesaj de pe site: <name>" — `[QA] ` in front of it on QA, the
outbox's own mark (AGENTS.md §16.4), because the club's real mailboxes are on both projects
and a question typed on the public `qa.` host must not read as a real one — a plain-text
body — name, address, the form's language, the page, the message — and an escaped HTML
twin. Nodemailer's four waits are all bounded (DNS included; its default is thirty seconds
on its own, longer than the function). It is **not** an
`EmailAdapter`, goes through **neither the outbox nor `EMAIL_DELIVERY_MODE`**, and is
never retried: it is correspondence, not transactional mail, and a failure is told to the
visitor on the spot. `CONTACT_FORM_MODE` is derived like `STORAGE_MODE`: `capture` in
local and test (in memory, readable, no socket ever), `smtp` on a deployment with the three
variables, `off` otherwise — the page then shows "Scrie-ne la <EMAIL_REPLY_TO>" as a
`mailto:`, and no startup refusal. Nothing is stored: the message is the email.

*The rest.* `/admin/tasks` gets "Formularul de contact" (club, open until the three
variables exist; `capture` counts, as the local media store does) with the Google → Vercel
steps; `/devs` reports the mode and names the missing variables, never a value; the
privacy-notice template says what the form collects, that it lands in the club's mailbox as
ordinary correspondence, under art. 6(1)(f), and for nothing else; `SETUP.md` §38 is the
procedure; AGENTS.md §16 records the one message that skips the outbox.

*Rejected:* a Mailgun route with a tag (it is exactly the quota the owner wants spared, and
it would make the club's inbound mail a transactional message with an outbox row); the outbox
with a second adapter (retries and idempotency keys for a message whose failure the visitor
is standing there to read); an SMTP client over `node:tls` by hand (§1.5 prefers the
platform, but not a protocol implementation); a startup refusal when the variables are
partial (a page that shows the address is the honest state of a deployment the club has not
finished); silence for the throttled sender (the honeypot's silence is for scripts; a person
told nothing writes again and again); the privacy-notice gate the interest box has (§146:
the form collects an address to *answer* it, the sentence on the form says so, and the
notice's paragraph is in the template for the approved text to carry); storing the message
(a copy nobody reads is a copy to erase); a shorter nav label or footer-only on `xs` (the
priority+ fold already answers a narrow row — measured, not guessed).

**Consequences.** `package.json` (nodemailer 10.0.10); `env.ts` (`CONTACT_SMTP_HOST`,
`CONTACT_SMTP_PORT`, `CONTACT_SMTP_USER`, `CONTACT_SMTP_PASSWORD`, `CONTACT_FORM_TO`,
`CONTACT_FORM_MODE`), `.env.example`; `infrastructure/email/smtp-adapter.ts` (new);
`modules/contact/{fields,message,service,delivery}.ts` (new); `app/[locale]/contact/{page,actions}.tsx`
(new); `i18n/routing.ts` (`/contact`), `app/sitemap.ts`; `shared/ui/SiteNav.tsx`,
`SiteFooter.tsx` (the links row is 44 px per link now); `rate-limit/service.ts`
(`contact-message`, `refundRateLimit`); `diagnostics/owner-tasks.ts` (`contactForm`), `configuration.ts`
(`contactFormMode`, the three variables), `admin/tasks/page.tsx`, `devs/page.tsx`;
`legal-documents/templates/privacy-notice.ts` (§5's third paragraph, §6's sentence, both
languages); `scripts/docs-check.mjs` (`smtp.gmail.com`); `Contact`, `Site.nav.contact`,
`Footer.contactPage`, `Admin.tasks.items.contactForm`, `Devs.checks.contactForm*` in both
catalogues; tests `unit/contact/{fields,message}.test.ts`, `integration/contact/service.test.ts`,
`e2e/contact.spec.ts`, and the env, diagnostics fixtures. BR-REQ-070-04 (new) under
BR-BUS-070; `SETUP.md` §38; AGENTS.md §16.

Baseline `BR-V1.38-2026-09-18`.

## 150. Decided — the task board counts its rows and filters them by owner and by kind (2026-09-19)

**Context.** The owner, on the evening's second pass: "on the TODOs show a counter of how
many items are pending, and a filter by issue type and owner!" `/admin/tasks` was eleven
boxed rows in state order with one figure above them — how many block a real registration —
and no way to see only the club's rows, or only the accounts still to create, without reading
every box. A task carried an owner and a state and nothing that said what *sort* of work it
was.

**Decision.** Three things on the to-do half, all server-rendered, no client code:

*The counter.* Under the heading, "De făcut: N · Gata: M" — N every row not done (a blocking
row is pending too, only more so), M the rest — and, when nothing is pending among the rows
shown, "Tot ce se vede aici este rezolvat." beneath it — no figure in that sentence: the
line above carries it, and "Toate 1 sunt rezolvate" is not Romanian (the catalogue carries no
ICU plurals, `docs/VIBECODING.md`). **It counts the rows the list shows**: with a
filter on, the counter describes the list under it, not the board; a counter that says four
above a list of two is a counter to distrust. The amber "Blochează înscrierile reale: N" box
stays over the whole board whatever the filter — what blocks a real registration is not a
matter of view. **The tab's label does not carry the count.** `BackofficeShell` renders on
every backoffice request and knows nothing today; the count needs the privacy notice, two
job-health checks, the published events and the staff count — five reads on every admin
page, for a figure on one tab. The page has it; the tab does not.

*The kind.* A closed set of four on every task, `TaskKind`: **account** (an account or a key
to create at a provider — Mailgun's domain, R2, Turnstile, Vercel's token, the Gmail app
password, the team's accounts), **decision** (the archive mailbox, the `.ro`), **text** (the
legal texts, the events to publish) and **check** (the monitors seen running). Each id's
kind is one entry in `TASK_KIND: Record<TaskId, TaskKind>`, and `OwnerTask.id` is the
`TaskId` union, so a task added without a kind does not compile; `ownerTasks` pushes every
row through one helper that looks the kind up and never takes one as an argument. The kind
is a third outlined chip on the row, the same word the filter uses. The ids are English in
code and in the address (`?kind=account`), like every other query value; the Romanian —
Cont, Decizie, Text, Verificare — is in the catalogue.

*The filters.* Two rows of chips above the list, each a plain link with a string href from
`getPathname` (the events listing's pattern, §133: a Server Component hands MUI's client
chip a string and nothing else): "Cine: Toate · Clubul · Dezvoltatorul" and "Tip: Toate ·
Cont · Decizie · Text · Verificare". Each link keeps the other row's choice, so the two
combine (`?owner=club&kind=account`); the active chip is filled and `aria-current="page"`;
each link is 44 px tall with a small chip inside. A value outside the closed sets — typed,
stale, misspelt — reads as "all", checked by `isTaskOwner`/`isTaskKind` and never echoed. No
state filter: it was not asked for, and the done rows already sit last. A combination with no
row says "Niciun rând pentru acest filtru." The narrowing and the counting are two pure
functions beside the list (`filterTasks`, `countTasks`), tested without a browser.

*Rejected:* the count in the tab label (five reads on every backoffice page for one tab; if
the club asks, the answer is a cheap counter table, not the page's reads in the shell); a
`Badge` on the tab (the same cost, plus a component prop into a client island); a form with
selects (the registrations list's shape is right for five fields with free text, wrong for
two closed sets of two and four — a chip is one press and the address says what is on);
counting the whole board under a filter, or "2 din 4 afișate" (the list and the figure
above it must agree at a glance); Romanian ids in the address (`?kind=cont` beside
`?type=RACE` on the listing); a state filter (not asked, and the order already answers it);
a kind derived from the state or the owner (it is a third axis: the club's rows are of every
kind).

**Consequences.** `diagnostics/owner-tasks.ts` (`TaskKind`, `TASK_KINDS`, `TASK_OWNERS`,
`TaskId`, `TASK_KIND`, `isTaskOwner`, `isTaskKind`, `filterTasks`, `countTasks`; `OwnerTask.kind`;
`BACKLOG: readonly TaskId[]`); `admin/tasks/page.tsx` (`searchParams`, the counter, the two
chip rows, the kind chip, `aria-label` on the list); `Admin.tasks.summary`, `allDone`,
`noneMatch`, `listLabel`, `filter.*`, `kind.*` in both catalogues; tests
`unit/diagnostics/owner-tasks.test.ts` (the kinds, the counts, the narrowing, the guards),
`e2e/tasks.spec.ts` (the counter, the chips combining, no sideways scroll on the phone).
BR-REQ-090-05 criteria 8–9. The cost half and `tasks-cost.spec.ts` are untouched.

Baseline `BR-V1.38-2026-09-18`.

## 151. Decided — a verified participant's restart locks the event row like every other allocation (2026-09-19)

**Context.** A reviewer of §147 noticed, in passing, that `submitRegistration`'s restart
branch — a participant whose address is already verified coming back after a cancelled or
expired registration — called `allocateOrWaitlist` without `lockEventForCapacity`, against
the capacity the page had read. Every other door into the allocator locks first (rule 1 of
the module, §10.6). Under the two-connection suite the door held only by luck.

**Decision.** The restart locks the event row first and allocates against the locked
capacity, exactly as `confirmEmail` does. The concurrency suite gains the case: twenty
verified people restarting cancelled rows at once on a one-place event, one hold, nineteen
waiting. No behaviour changes for anyone but the two people who would have shared a place.

**Consequences.** `registrations/service.ts`; `tests/concurrency/capacity.test.ts`.
BR-REQ-034-02 criterion 1.

Baseline `BR-V1.38-2026-09-18`.

## 152. Decided — only the Save button is sticky in the editor (2026-09-19)

**Context.** The owner, on a phone: "I do not like how the bottom save footer keeps showing
on mobile, it takes too much space." Since §130 and §134 the sticky bar held the
"I understand I am editing published content" box, the folded "Salvează pentru" box and the
button — a third of the screen, pinned.

**Decision.** The box and the fold sit in the flow at the end of the form; only the button
is sticky, above the footer's bar, with less padding. The button's own hint ("tick the box
to save") still names the box, which is now right above it when the end of the form is in
view.

**Consequences.** `app/[locale]/admin/events/[id]/page.tsx`.

Baseline `BR-V1.38-2026-09-18`.

## 153. Decided — the event's timezone is chosen from a list (2026-09-19)

**Context.** The owner: "the timezone must be selectable, not free text." The editor took a
typed IANA name and refused a wrong one only on save.

**Decision.** A native select over every zone the runtime knows
(`Intl.supportedValuesOf("timeZone")`), the club's `Europe/Bucharest` first, then Europe,
then the rest; a stored zone the runtime no longer lists is kept as an option so an old event
still saves. Native rather than MUI's menu: four hundred options are a scroll nobody wants,
and a native select is searched by typing. Validation on save is unchanged.

**Consequences.** `content/events/ui/EventFieldsForm.tsx`, the help sentence in both
catalogues.

Baseline `BR-V1.38-2026-09-18`.

## 154. Decided — a series card folds its dates (2026-09-19)

**Context.** The owner, on the listing on a phone: "these date pills take too much space" —
eight 44-pixel chips in four rows under every series card, which §138 had unfolded.

**Decision.** The chips sit behind a native disclosure, "Toate datele (8)", closed by
default, 44 pixels tall; the card is the next date and the rhythm, the rest one press away.
No JavaScript.

**Consequences.** `events/ui/SeriesCard.tsx`, one key replaces one in both catalogues.
BR-REQ-041-01 criterion 9 amended.

Baseline `BR-V1.38-2026-09-18`.

## 155. Decided — the event's structured data carries its cards as images (2026-09-19)

**Context.** Google's Rich Results test on a QA event page: valid, with a warning for the
missing `image`. The page already draws two cards of the event (§90) — the 1200×630 Open
Graph card and the square one for Instagram.

**Decision.** `SportsEvent.image` lists both, absolute under `APP_BASE_URL` — Google asks
for more than one aspect ratio, and these are two. Nothing is drawn that was not drawn
before.

**Consequences.** `events/structured-data.ts` (an `images` argument), the event page;
`tests/unit/events/structured-data.test.ts`. BR-REQ-052-02 criterion 2 amended.

Baseline `BR-V1.38-2026-09-18`.

## 156. Decided — the short description is the card's; the page reads the long one (2026-09-20)

**Context.** The owner: "Major inconsistency! The short description should show on the card
and the long one when I open the event page." Since §71 the page showed both, the short one
under the title and the long one after the facts — the same opening sentence twice for
anyone who had written both.

**Decision.** The card and the hero keep the short description. The event page (and its
preview) render the short one only while no long description exists; with a long one, the
page reads that. The metadata, the Open Graph card, the structured data and the emails keep
the short one — that is what an excerpt is for. The editor's help sentences say which is
which.

**Consequences.** `app/[locale]/events/[slug]/page.tsx`, the preview, two help sentences
in both catalogues. BR-REQ-011-01 criterion 11 amended.

Baseline `BR-V1.38-2026-09-18`.

## 157. Decided — the footer's switch sits above the footer's fold (2026-09-20)

**Context.** The owner, on a phone: "the theme switcher does not work on mobile, nothing
happens when I click." A Playwright tap said why: the footer's own "Despre club" fold — a
44-pixel summary across the bar — was the element under the finger. The switch is positioned
absolutely in the bar's corner (§115); the column beside it is positioned too and comes later
in the DOM, so it painted on top.

**Decision.** The switch's box carries `zIndex: 1`. Nothing else moves. The e2e suite taps
the switch on the phone project from now on, because a pointer test at the button's centre is
the one thing that would have caught this.

**Consequences.** `shared/ui/SiteFooter.tsx`; `tests/e2e/event-pages.spec.ts`.

Baseline `BR-V1.38-2026-09-18`.

## 158. Decided — smaller chrome and smaller pills, the tap targets unchanged (2026-09-20)

**Context.** The owner, three messages on a phone: "the header and the footer must be
smaller in general, and on mobile smaller still"; "the pills and the selects here are too
big" (the calendar's month/year, Lună/An, Calendar/Listă); "pretty much all the pills must be
smaller." Every pill on the public site was a 44-pixel chip because every link must be a
44-pixel target (BR-REQ-041-01 criterion 6), and the chip had become the target.

**Decision.** The target and the pill part ways everywhere, the way §133 did it for the type
filter: `shared/ui/ChipLink` is a 44-pixel link around MUI's small chip, and it is what the
calendar's four choices, the type filter and the series card's dates use; the editor's
header chips are small too (the backoffice has no 44-pixel rule). The header's lockup goes
from 44 to 40 pixels with less padding, the sections a step under the body size; the
footer's summary a step smaller, its marks 20 pixels. Nothing a thumb hits got smaller.

*Rejected:* shrinking the links themselves (the suite measures every link under `main` and
would say so, rightly).

**Consequences.** `shared/ui/ChipLink.tsx` (new), `events/ui/EventCalendar.tsx`,
`events/ui/SeriesDates.tsx`, `content/events/ui/SeriesScope.tsx`, the listing,
`theme/brand.ts`, `SiteHeader`, `SiteNav`, `SiteFooter`.

Baseline `BR-V1.38-2026-09-18`.

## 159. Decided — the calendar carries every detail the page has (2026-09-20)

**Context.** The owner: "in iCal I need as many details as possible, including links to the
post." Since §107 a calendar entry carried the meeting point, the short description, the
programme and the page's address; since §146 the opening date while it was ahead. A runner
reading the entry on a phone still had to open the page for the distance, the rules, the
route, whether entries are open, and what to bring.

**Decision.** The description says what the page says, in the reader's language and the
page's own words (the "Event" catalogue), one group per blank line, each line only when the
event has the thing: the page's notice first when the event is cancelled or over ("Acest
eveniment a fost anulat.", "Evenimentul s-a încheiat. …"); the meeting point with the map
beside it — "Vezi pe hartă" when the organizer gave a map and no name, as on the page — and
the street address on the next line ("Adresă: …"); the short description; the long one's
first six hundred characters, cut at a word (§156 — the page has the whole, and the entry
links it); the two times when the race has a gun time — "întâlnire la 08:00 · start la
09:00"; the facts as one line — "Concurs · 🏃 10 km · ↗ 300 m urcare · Trail · Mediu ·
Gratuit"; where registration stands, with the door — "Înscrierile sunt deschise — <form>",
"Înscrierile se deschid pe <date> — <form>" (the page's sentence, which replaces §146's
"Înscrieri din"), "Înscrierile s-au închis", "Înscriere pe site-ul organizatorului — <link>"
(`registrationState` and the CTA's own strings; the calendar has none of its own), nothing
for an event that takes none or is over; the links, with short labels — the page, the rules
(`#rules`), the programme (`#schedule`), the route, the film, the Strava event, the Facebook
event; the programme rows and text (§117) under the page's heading, "Programul
evenimentului"; "Ce să aduci"; "Împreună cu". A cancelled event's entries — the event's and
each programme row's — carry `STATUS:CANCELLED` (RFC 5545 §3.8.1.11), which Google, Apple and
Outlook strike through, so a subscriber's phone does not ring for a race the club called off.
The same text as minimal HTML — paragraphs and links — in `X-ALT-DESC;FMTTYPE=text/html`,
which Outlook renders with the words as the links; Apple and Google ignore the property and
make the bare addresses of the plain text tappable, which is why the plain twin writes
"words — address"; a TEXT value like the rest, escaped and folded by octets. `URL` stays the
page, `LOCATION` the map link (§129), or "name, address" without one. Google's add-event
link carries the same groups as the HTML its dialog renders (the organizer's `<` and `&`
escaped), within a budget of 1,500 characters of text: the programme's text has no ceiling,
Romanian letters cost six characters each once encoded, and Google refuses an address past a
few kilobytes — whole lines while they fit, the line that does not cut at a word with an
ellipsis, and the page's link last when the cut took it; the `.ics` keeps the whole text.
Nothing is queried for it: the public row already has every fact, and gains the
translation's checklist. Where registration stands is decided by `calendarRegistration` from
the same window rule the page uses, against the clock the route passes; `DTSTAMP` and
`LAST-MODIFIED` are `calendarStamp` — the later of the row's change and the last boundary of
an internal window the clock has passed — because the registration line flips at the
opening and the closing without the row changing, and an app that re-reads an entry only
when its stamp moves would keep the old sentence; the three callers build the calendar's
event through one `toCalendarEvent`.

*Rejected:* a full HTML document with the site's styles in `X-ALT-DESC` (Google ignores the
property, Apple strips the styles, and it doubles the feed); the free-place count on the
registration line (a query per event on a feed read every hour by every subscriber, for a
number that is stale the moment it is written); the whole long description in the entry (a
feed of fifty events would carry fifty articles twice over, plain and HTML, for a reader who
has the page one tap away); calendar-only strings for "open" and "at the organizer" (the
page's sentences exist, and two catalogues drift).

**Consequences.** `events/ical.ts` (`calendarDescription`, `calendarDescriptionHtml`,
`googleCalendarDetails`, `calendarRegistration`, `calendarStamp`; `CalendarLabels` is the
catalogue's `t`), `events/calendar.ts` (new, `toCalendarEvent`), both `calendar.ics` routes,
the event page's Google link, `events/repository.ts` (`checklist` in the public columns), the
preview, four keys under `Event.calendar` in both catalogues (`registrationOpens` gone; the
editor's help for "Ce să aduci" names the calendar); `tests/unit/events/ical.test.ts` reads
the real catalogues and pins the budget. BR-REQ-020-01 criterion 7 and BR-REQ-011-01
criterion 13 amended.

Baseline `BR-V1.38-2026-09-18`.

## 160. Decided — the declaration's deadline is lenient while nobody waits (2026-09-20)

**Context.** The owner, three messages: "we must emphasise that the declaration must be
signed, but be more lenient — it often happens that people forget and sign it right on race
day before picking up the kit"; "we must keep their bib until the last moment"; and on race
day "there can be entries right on the spot". Until now a hold — the thirty minutes, or the
participation window of §104 — lapsed at its deadline and the place went back to the pool,
whether or not anybody wanted it: on a race with places to spare, a person who forgot was
expired by the next maintenance run, their link answered "nu mai este valabil", the desk could
not find them, and their only way back was to register again from the start. The deadline
exists for one reason, the queue: a place held by somebody who may not come is a place
somebody waiting cannot have. Where nobody waits it protects nothing.

**Decision.** A declaration hold past its deadline is released only when the place is
wanted, and then only as many holds as are wanted. With nobody waiting the row stays
`PENDING_DECLARATION` — the place is the person's until the start, it keeps occupying its
place in the count, and the declaration is signed online at any time before the start (the
email's link now lives until the start, not until the hold) or on paper at the desk on race
day, which confirms it as it always confirmed a hold. **One waiter releases one hold**, the
oldest deadline first, and only when the event has no free place to give them anyway:
`wanted = waiting - free`, counted under the lock, where `free` is what the event has without
touching a single hold. A boolean here — release everything the moment anybody waits — would
have made one walk-in on race morning evict every other unsigned runner on the event and put
their places back on public sale, which is the outcome the *Rejected* paragraph below
forbids. The rule lives in `expireStaleHolds`, under the event lock every allocator path
already takes, so a waiting-list entry arriving at the same moment is serialised against it;
the count (`countOccupied`) takes a declaration hold by status, deadline or none, because the
count must say what the allocator will do. When the queue grows — somebody confirms an email
on an event whose places are held by a lapsed hold — the same transaction releases that one
hold and offers the place to the front of the line: they get the offer, not a "you are on the
waiting list" and a wait for the job. When enough people already wait, the deadline is
enforced as before: it was told to the person and to the queue. A waiting-list offer lapses
at its deadline as it always did — an offer is a promise made to the queue. An event that has
started closes every hold as before, **and so does a cancelled one**: nobody is left holding
a place on a race that will not run, and a declaration signed against a `CANCELLED` event is
refused outright (`signDeclaration`, under the lock, on the locked row's own status) rather
than drawing a race number for a race nobody will start.

Three things follow from keeping somebody in a state nobody visits any more. The person who
forgot is the one population that heard nothing between the deadline and race day — the
reminder goes to the confirmed, and §104's participation confirmation stops at the deadline
— so the declaration email goes **once more, two days before the start**, to every
registration that still owes a signature: the same `COMPLETE_DECLARATION`, whose words
already say the registration is complete only with the declaration and that it may be signed
on paper at the desk, and whose deadline line the renderer drops once the deadline is behind.
The desk, second: the start releases these holds while the kit table is still open, so
`confirmByStaff` re-allocates a row expired with `DECLARATION_HOLD_LAPSED` instead of
refusing it — the person standing there with their paper is confirmed if the place is still
free and told they are on the list if it is not. And the words, third: the page and the
backoffice say the place is kept only where that is true — the declaration page shows "the
deadline has passed but the place is still yours" only for a `PENDING_DECLARATION` hold with
nobody waiting (an offer's deadline is always enforced), and the backoffice journey, rendered
once per row of a list spanning many events, carries the condition in its own words
("termen depășit, locul se ține cât nu așteaptă nimeni") rather than counting a queue per row. The maintenance job's scan no longer selects an
event whose only lapsed holds have nobody waiting, rather than locking it to do nothing on
every run until the race. The words say it everywhere: the declaration email (both variants)
— the place is held, the registration is complete only with the signed declaration, sign now
online or on paper at the desk on race day before picking up the number, and "if a waiting
list forms, the place is held until <deadline>"; the five steps and the journey's third step
say "online, or on paper at the desk"; the backoffice journey says "termen depășit, locul se
ține" for a kept hold; the declaration page says the deadline has passed but the place is
still theirs; the guide and the queue panel's help say when the deadline counts.

*Rejected:* keeping holds even when people wait (the queue was promised the place, and a
person who was told "until Friday" and a person told "you are next" cannot both be right); a
separate "grace period" number (a rule with no number is one fewer thing to configure, and
any number would be wrong for somebody — the desk on race morning is the only deadline that
matters); a public count that shows a kept hold as a free place (the person who took it
would silently evict somebody the owner asked to be lenient with; "full — waiting list" and
an offer at once to whoever joins says the same thing without the surprise).

**Consequences.** `registrations/repository.ts` (`expireStaleHolds` takes the event —
start, status and capacity — and releases what `lapsedDeclarationHoldsToRelease` decides,
oldest deadlines first; `countOccupied` counts `PENDING_DECLARATION` by status,
`pendingDeclarationHolds`; `findEventsNeedingMaintenance` narrowed to a lapsed hold somebody
waits for, or one on a cancelled event), `service.ts` (`withLockedRow` now refreshes
`starts_at` and `event_status` with `capacity`, because since this decision all three are
capacity decisions; `allocateOrWaitlist`'s second pass whenever the queue grows;
`enqueueAllocationEmail`; `signDeclaration` refuses a non-`SCHEDULED` event and offers what
its own expiry freed, as `promoteFromWaitlistByStaff` does; `confirmByStaff` re-allocates a
hold the start expired), `domain/capacity.ts`, `notifications/event-mail.ts`
(`queueDeclarationReminders`, two days out), `notifications/render.ts` (the declaration
token's life is the event's start, read from the event row rather than through the
translation join, so a secret's lifetime does not depend on who has written the text; a
passed deadline is not named on a resend), `events/repository.ts` (`findEventStartsAt`),
`templates.ts`, `ui/StaffJourney.tsx`, the declaration page, both catalogues. AGENTS.md
§10.5 invariant 5, §10.6, §15.3, §16.2; BUSINESS.md BR-BUS-033, BR-BUS-034; SPECS.md
BR-REQ-033-01 criteria 3 and 6, BR-REQ-037-07 criterion 8. Tests: `maintenance.test.ts` (one
waiter releases one hold of three; the scan tells a waited-on event from its quiet
neighbour; a cancelled event's hold closes), `lifecycle.test.ts`,
`confirmation-window.test.ts` (the late signature refused when somebody waits; the cancelled
race), `race-day.test.ts` (the desk after the gun; a number given by hand survives the
expiry), `notifications/render.test.ts` and `event-mail.test.ts`;
`tests/concurrency/capacity.test.ts` unchanged and green.

Baseline `BR-V1.38-2026-09-18`.

## 163. Decided — a QA deployment may address anyone, through the allowlist, not through `live` (2026-09-20)

**Context.** The owner could not invite a colleague on QA: the invitation of §141 was queued
and captured, because QA transmits only to `EMAIL_ALLOWLIST` (§37, AGENTS.md §16.4) and the
colleague was not on it. Asked whether to add the two addresses or to let QA mail anyone, he
chose anyone: the people testing are more than a handful, and every new one was a Vercel
round trip.

**Decision.** `EMAIL_ALLOWLIST` accepts one entry that is not an address, `*`, and it
authorizes every recipient. The mode stays `allowlist`: the subject keeps its `[QA]` mark
(BR-REQ-080-03 criterion 2), the rule that only production sends `live` is untouched (§37),
and the star is one character to remove. A star anywhere but in allowlist mode is refused at
startup, because on production the list is not read and a star there would read as a
permission the code never consults. A malformed recipient is still captured: the star is
checked after canonicalization, since an address that is not one has nowhere to go.

*Rejected:* `EMAIL_DELIVERY_MODE=live` on QA (it would drop the `[QA]` mark and reverse the
one email rule that has never bent); a per-address editor in the backoffice (worth building,
but not what unblocks him this morning — and with a star it is no longer needed for QA).

**The star had to be let through twice.** The first cut taught `decideDelivery` and the
mode rule about it and left the per-entry address check refusing it, so the QA build of
2026-09-20 failed at `envSchema.parse` — the deployment could not boot at all. The constant
now lives in `shared/config/env-enums.ts`, the leaf both the schema and the delivery decision
import, and `tests/unit/config/env.test.ts` parses a starred environment.

**Consequences.** `infrastructure/email/delivery.ts`, `shared/config/env.ts`,
`.env.example`, `AGENTS.md` §16.4; `tests/unit/notifications/delivery.test.ts`. The QA
project carries `EMAIL_ALLOWLIST=*` from 2026-09-20. **Every QA message now spends the
club's shared Mailgun allowance** — one account, 100 messages a day, QA and production
together (§100).

Baseline `BR-V1.38-2026-09-18`.

## 164. Decided — the club says who reads its mail, in the app; the platform says how it leaves (2026-09-20)

**Context.** Three things the owner said this morning, and they are one thing. „I wanna
allow CC on the contact form so that Amalia can receive emails”; then, when told it was an
environment variable, „I need these CC's to be configurable in the app”; and, of the number
on `/admin/emails`, „please note Mailgun is shared by QA and PROD”. The contact form's
recipients were `CONTACT_FORM_TO` on two Vercel projects (§149), so adding a colleague meant a
developer, two environment writes and two redeploys — and there was no copy list at all. The
same page said „99 din 100 mesaje” as though the allowance were this deployment's, when it is
one Mailgun account both environments spend from (§100, and since §163 QA spends it freely).

**Decision.** Who receives is the club's; how it leaves is the platform's.

The “to” and “cc” lists move into `platform_settings.contactRecipients` — the Mailgun plan's
own shape (§100): one row, one fixed audit entity id (`…e002`), an Administrator's gate
asserted by the service as well as the action, an audit row naming who changed it from what.
They are edited on `/admin/emails`, under the plan, because both answer „what does the club's
email do”. Each address is validated by the platform's own canonicalizer, the same one a
participant's address meets.

The reading order is **the setting when it names at least one “to”, otherwise
`CONTACT_FORM_TO`, otherwise the form is off** — so a deployment never loses its way out
because somebody saved the screen empty, and a fresh environment works before anybody signs
in. The cc list is app-only: there is no `CONTACT_FORM_CC` and there will not be one, and it
applies whichever half answered for the “to” list. It is a real `Cc` header, not a second
`To`: a colleague should see she was copied, and „Reply all” should keep the club together
on the thread. `Reply-To` is still the visitor — that is the whole workflow.

`CONTACT_FORM_MODE` consequently stops asking about recipients, which a startup-time
derivation cannot see anyway, and answers for the transport alone: `capture` locally,
`smtp` with the Gmail account and its app password, `off` without them. „Can it send” and
„is there anybody to send to” are two questions now, and the page, `/devs` and `/admin/tasks`
ask both — `/devs` naming which half answered (`smtp/setting`, `smtp/env`), and carrying a
fourth state for the deployment that can send and has nobody to send to, whose fix is a
screen and not a redeploy. **The sending account does not follow the recipients into the
database**: `CONTACT_SMTP_USER` and `CONTACT_SMTP_PASSWORD` stay environment variables, named
on the page and shown nowhere, because a value in `platform_settings` is read by every page
that needs it and printed on the screen that sets it (AGENTS.md §14.5).

And the allowance says what it is: one Mailgun account, shared by QA and production, counted
here from this environment's own outbox rows — on `/admin/emails` under the plan's figures,
and in the cost table's Mailgun row on `/admin/tasks`. Wording only; there is no second
query, and none is possible — Mailgun's API does not tell a domain sending key what the
account has spent.

**The fold, while the page was open.** „Adresa pentru alte aplicații” (§139) did not look
expandable, and the reason was already written down in this repository: a `<summary>` with
`display: flex` loses its disclosure triangle in Chrome and Safari, which the registration
page's `disclosureSx` says in a comment and the calendar fold did anyway. So the affordance
becomes one shared thing — `shared/ui/disclosure.ts`: the marker back (`listStyle: revert`),
height from padding and never from a flex box, the pointer, an underline on hover and on
keyboard focus, and the 44-pixel rule carried along. Used by the calendar feed's address, the
footer's „Despre club” and the series card's „Toate datele”, so a fold looks like a fold
everywhere. The listing's „other events” heading keeps its deliberate exception: on a wide
screen it is always open and is not a control.

*Rejected:* keeping the recipients in the environment and letting the app add only a cc (it
answers „CC” and not „configurable in the app”, and leaves the main list a redeploy away);
`Bcc` for the copy (a club is not a blind list — the people copied should see one another);
putting `CONTACT_SMTP_PASSWORD` on the same screen for symmetry (a password in a table the
backoffice reads is the one thing §14.5 forbids, symmetry or not); reading Mailgun's own
usage to make the shared count exact (the sending key cannot ask, and a wrong exact number
is worse than an honest sentence); a per-fold fix on the calendar alone (the same flaw sat
in three other places, and would have come back in the fifth).

**Consequences.** `modules/contact/domain/recipients.ts` (new — the schema, the typed-line
parser, `resolveContactRecipients`), `modules/contact/recipients.ts` (new — read/update with
the audit row), `modules/contact/ui/ContactRecipientsPanel.tsx` (new), `shared/ui/disclosure.ts`
(new), `modules/contact/{delivery,message,service}.ts`, `infrastructure/email/smtp-adapter.ts`
(`cc` on `SmtpMessage`), `shared/config/env.ts`, `modules/audit/repository.ts`
(`contact_recipients.changed`), `modules/diagnostics/{configuration,owner-tasks}.ts`, the
`/admin/emails`, `/contact`, `/admin/tasks` and `/devs` pages, `modules/notifications/ui/EmailPlanPanel.tsx`,
`modules/events/ui/SeriesCard.tsx`, `shared/ui/SiteFooter.tsx`, the events listing, both
catalogues. No migration: `platform_settings` is one row per key. AGENTS.md §16.4; SPECS.md
BR-REQ-070-04 criteria 3, 6, 7 and 9, BR-REQ-080-02 criterion 8; SETUP.md §38. Tests: unit
`contact/recipients.test.ts`, `contact/message.test.ts`, `config/env.test.ts`,
`diagnostics/configuration.test.ts`; integration `contact/recipients.test.ts`,
`contact/service.test.ts`; e2e `email-plan.spec.ts`.

Baseline `BR-V1.38-2026-09-18`.

## 165. Decided — the menu asks what the page asks, and the fallback works when nothing else does (2026-09-20)

**Context.** The review of §164, the same morning. Splitting "can this deployment send" from
"has it anybody to send to" left four places still holding the old, single question, and two
of them were the ones a visitor meets first. `SiteHeader` gated „Contact” on
`CONTACT_FORM_MODE !== "off"`, which used to imply a recipient and since §164 does not — so
the configuration SETUP §38 now steers to (the Gmail account set, `CONTACT_FORM_TO` dropped,
nobody typed on `/admin/emails` yet) put an entry in the menu leading to a page that says
there is no address, which BR-REQ-070-04 criterion 1 forbids in as many words. `/devs` still
listed `CONTACT_FORM_TO` as a requirement on every branch, so a club that had done exactly
what the new copy instructs read „e citită din aplicație” above a red `✗ CONTACT_FORM_TO`.
`/contact` gained an unguarded database read — on the page whose whole job is to show the
club's address when something is broken, and on a free Neon plan whose compute suspends once
the month's 100 CU-hours are spent (§68). And nothing compared the two address lists, so the
club Gmail typed into both boxes — the obvious thing to type — would have been a second
`RCPT TO` and a name in two headers.

**Decision.** The question is asked in one shape, wherever it is asked.

`contactFormReaches(env, recipients)` is that shape, and the header now calls it too: one
primary-key read on `platform_settings`, beside the two the header already makes for the
navigation and the gallery, guarded exactly as those are. The guard is
`readContactRecipientsOrNull()`, one function used by the header, the page and the action:
a `try` around `getDb()` *and* the await, because `getDb()` throws synchronously as an
argument, and `null` as the answer — which `resolveContactRecipients` reads as "the club has
named nobody" and hands to `CONTACT_FORM_TO`, which is precisely how the deployment behaved
before §164. A database that is not answering therefore costs the club nothing it had.

`/devs` names what is actually missing: the transport's two variables on the branches about
the transport, and `CONTACT_FORM_TO` on the one branch where it is genuinely one of the two
ways out — the deployment that can send and has nobody to send to, whose other way out is a
screen with no variable to name. A green row never prints a red cross again.

The same mailbox is written once. Deduplication is by spelling, lower-cased, within each
list and of the copy list against the resolved „to” — the environment's included — and not
through the canonicalizer, because `a.b@gmail.com` and `ab@gmail.com` are two addresses by
§74 and a club that typed both meant both. `CONTACT_FORM_TO`'s own entries now go through
`headerSafe` like the copy list's: the setting's addresses met the canonicalizer, an
operator's typed variable met nothing.

And the fold: it sat in five places, not four. The backoffice's series-dates fold and the
task board's „Cum fac asta” take the shared affordance too, at the backoffice's own 36-pixel
density — the height from padding, never from a flex box, which is what removes the triangle.

*Rejected:* leaving the header on the environment alone and relaxing criterion 1 instead (the
criterion is the promise — a menu entry that leads nowhere is the bug, and the read is one
indexed lookup on a page that already makes two); caching the recipients in module scope to
avoid it (a setting the club changes and a serverless process that outlives the change is the
class of bug §100 was careful to avoid); deduplicating through `canonicalizeEmail` (§74 says
those are different mailboxes, and silently dropping one would be worse than sending twice);
`test.describe.serial` for the e2e that writes the recipients row (serial orders a worker,
and the two viewport projects are two workers against one database — the row is global, so
the test runs on one project, and `contact.spec.ts` still walks the visitor's journey on
both).

**Consequences.** `shared/ui/SiteHeader.tsx`, `modules/contact/recipients.ts`
(`readContactRecipientsOrNull`), `modules/contact/domain/recipients.ts` (deduplication),
`modules/contact/message.ts` (`headerSafe` on „to”), `modules/diagnostics/configuration.ts`,
`infrastructure/email/smtp-adapter.ts` (the header comment), the `/contact` page and its
action, `/admin/tasks` and the backoffice events list (the two folds). No migration, no new
message key, no new variable. SPECS.md BR-REQ-070-04 criteria 1 and 9, BR-REQ-080-02's
verification line; SETUP.md §38 (the steps are numbered `1`–`6` — `4b` was not a list marker
and rendered as part of step 4). Tests: unit `contact/recipients.test.ts`,
`contact/message.test.ts`, `diagnostics/configuration.test.ts`; e2e `email-plan.spec.ts`
(the shared-allowance sentence, and the recipients test in its own block).

Baseline `BR-V1.38-2026-09-18`.

## 166. Decided — the calendar changes month without the page blinking (2026-09-20)

**Context.** The owner, this morning: "There is flickering when changing calendars! I need
skeletons and loading screens! I need more animations, I need a runner showing as a loader!
And I need more gradients and shiny Front-End stuff!"

The flicker was two separate faults wearing one coat. The month arrows were
`IconButton component="a"` and the pills were `Box component="a"` — both plain anchors, both
written that way because a component reference cannot cross from a Server Component into a
MUI client component (`GlyphChip` records the hydration failure that rule came from). A plain
anchor is a **document** navigation: the browser tears the page down, paints white, and
rebuilds it, header and all. And the listing was one server render that awaited three queries
in its own body before returning a single character, so even the soft navigations that did
exist — the two selects, "Azi" — held the old page for the length of the slowest query with
nothing to say. `CalendarPicker` had carried a comment since §116 promising that
`router.push` would let "the listing's `loading.tsx`" show. There was no `loading.tsx`.

**Decision.** The page stops being one render, and the controls stop being anchors.

*The shell owes the database nothing.* `events/page.tsx` now awaits no query at all. It starts
two — the upcoming events and the month on view — and hands the promises down, so Next sends
the header, the wordmark, the heading and every calendar control the instant the request
arrives. Three regions fill in behind `<Suspense>`: the lead (hero and filter chips), the
calendar's body, and the list of other events. The two that need the same rows share one
promise, so streaming costs no extra query. The gallery is the same shape, one boundary.

*Only the grid is replaced.* `EventCalendar` was split: `CalendarHeader` is the title, the two
selects, the arrows and the pills, and it reads the address and never the database, so it
renders with the shell and stays where a thumb last found it. Pressing "next" three times
quickly is three presses on the same button. The body is what costs a query and the body is
what the boundary wraps.

*The boundary is keyed.* React will not hide already-revealed content during a transition, so
an unkeyed boundary would leave last month's grid on screen until the new one landed. The key
is `calendarBoundaryKey(view, layout)` and it names exactly what the query and the drawing
depend on — the period and the layout, never the type filter, which narrows the list and not
the calendar. The lead and the list are deliberately **not** keyed: the club's next race does
not change because somebody looked at December, so those two keep their content and never
blink.

*The wait is a shape.* `shared/ui/PublicSkeleton.tsx` holds the fallbacks, and each is built
from the same boxes as the thing it stands in for — the calendar's seven columns and its
`minHeight: { xs: 56, sm: 80 }` cells, six week rows because `monthGrid` always returns six,
the card's outlined box, the gallery's 4:3 covers. Same box, so nothing reflows; the e2e
measures the grid's width across a month change rather than trying to catch the fallback
mid-flight. `AdminSkeleton` keeps the shapes it had and joins the same vocabulary.

*The runner.* `shared/ui/RunnerLoader.tsx` is `DirectionsRunIcon` — already
`TYPE_GLYPH.GROUP_RUN`, so the figure that means "a run" on every chip is the figure that
means "a run is being fetched". Inline SVG from one icon file, no library, no image. It bobs
and leans on the spot for 900ms a cycle: longer than anything else on the site because it is
the one animation that repeats and a 250ms loop is a twitch rather than a stride. It appears
once per boundary, beside words, never once per shape.

*Reduced motion, without exception.* Every new rule sits inside `MOTION_OK`, the opt-*in*
guard `theme/motion.ts` already uses, so the static state is what a browser renders when it
evaluates nothing. MUI's skeleton wave is the one animation this site does not own, so it
gets the guard added the other way round (`shimmerOffForReducedMotion`). A reader who asked
for less motion gets a still figure and still shapes — and never less information, because
the movement is never the only signal: every fallback carries `role="status"` and an
`aria-label` that says the page is loading, in the reader's language.

*The gradients.* Three, and that is the budget: past three a page stops having a lead surface
and becomes a paint chart. `SURFACE_GRADIENT` in `brand.ts` names them — the hero's surface,
the accent under a pointer, the bar under a section heading — and `theme/surfaces.ts` turns
each into a plain `sx` fragment a Server Component can spread. Plain, because
`theme.applyStyles` is a function and a function cannot cross into a MUI client component; the
dark variant is selected by the valueless `data-dark` attribute MUI already writes onto
`<html>`. Two new hexes in the whole change, both in `brand.ts`, both a step from a card
colour towards the club's blue and no further: body text, muted text and the countdown are
asserted against **both stops of both ramps** in `tests/unit/theme/brand.test.ts`, and the
CSS strings are asserted to be made of palette tokens so a stop typed by hand cannot hide in
one.

*Rejected:* a `loading.tsx` on the listing — twice over. §54 forbids a loading boundary above
a `notFound()`, and `events/loading.tsx` would sit above `[slug]` and `[slug]/register`,
turning three 404 assertions in `event-pages.spec.ts` into 200s; an `events/(list)/` route
group would dodge that and still be the wrong instrument, because `loading.tsx` replaces the
*whole page* — hero, chips and all — for a change to one grid. Adding one to the remaining
`/admin` routes that stream without one was rejected for the first reason alone: every one of
them (`gallery/pictures`, `emails`, `checkin`, `guide`) refuses a role with `notFound()` in
the page itself, so no boundary can sit above it and no route group helps. A motion library,
or MUI's `Fade`/`Grow`: every animation here is CSS emitted with the page, and none of this
is worth a client island (`AGENTS.md` §18.3). Animation on every card: `riseIn` already
staggers the first five and stops, for the reason it always did. `prefetch` on the
neighbouring months: Next skips prefetching a dynamic route by design, forcing it would buy a
database query per link in the viewport, and Neon's free plan is 100 CU-hours a month (§68) —
the shell now arrives before the query either way, which is the part a reader feels. Keying
the lead and the list boundaries as well: that is the flicker, reintroduced by hand. A
fourth gradient on the backoffice’s page header: the one shared heading there
(`BackofficeShell`) has its subtitle directly beneath it — who you are signed in as, and with
which address — and a rule between a title and its own caption separates the two rather than
marking a section. The backoffice joins the change through the runner and the shimmer in
`AdminSkeleton` instead, which is the part of it a reader there actually waits on.

**Consequences.** `theme/brand.ts` (`GRADIENT.heroTint`, `heroTintDark`, `SURFACE_GRADIENT`),
`theme/surfaces.ts` (new), `theme/motion.ts` (`KEYFRAMES.run`, `fadeInSoft`, `runInPlace`,
`shimmerOffForReducedMotion`), `theme/theme.ts` (the `br-run` keyframes),
`shared/ui/RunnerLoader.tsx` and `shared/ui/PublicSkeleton.tsx` (new), `shared/ui/ChipLink.tsx`
(now a client island over `next/link`), `shared/ui/SubmitButton.tsx` (the runner in place of
`CircularProgress`), `modules/events/ui/CalendarHeader.tsx` and `CalendarStepLink.tsx` (new),
`EventCalendar.tsx` (body only; `events` may now be a promise), `FeaturedEventHero.tsx` and
`RegistrationCta.tsx` (the two gradients), `modules/events/domain/listing.ts` (new),
`modules/staff-identity/ui/AdminSkeleton.tsx`, the events listing and the gallery pages. New
message key `loading` in the `Events` and `Gallery` namespaces, both catalogues. No migration,
no new variable, no new dependency. SPECS.md BR-REQ-041-01 criterion 12. Tests: unit
`events/listing.test.ts` (new) and `theme/brand.test.ts` (the gradients at both ends); e2e
`event-pages.spec.ts` — the controls do not move and the grid does not reflow across a month
change.

Baseline `BR-V1.38-2026-09-18`.

## 167. Decided — the review's pass over the loading states (2026-09-20)

**Context.** §166 shipped the listing's streamed regions, the skeletons, the runner and the
three gradients, and a review of it found nine things wrong before the owner pressed
anything. Four of them were the mechanism contradicting its own comment, which is the worst
kind: a later reader trusts the sentence and not the CSS.

**Decision.** Each one fixed where it is, and the sentence that was wrong corrected rather
than quietly deleted.

*A past race is never the hero.* Between seasons the listing is handed the club's last event
so the page is not blank, and that row still carries the `featured` flag it had while it was
next. §166 moved the division into `listingSections`, which looks only at `events[0].featured`
— so the finished race became a full hero, two-pixel border, "Recomandat" chip and an entry
button, under a notice saying there is nothing upcoming; and because a hero with an empty
list renders nothing, its own card vanished. `listingSections` now takes `hasUpcoming` as its
third argument and both regions pass it. The page advertises a race it is going to run, and
nothing else.

*The skeleton is the grid's own height.* `monthGrid` emits as many week rows as the month
spans — four, five or six — and the fallback drew six always, so in ten months of twelve
everything below the calendar jumped up a row or two when the real grid landed. The row count
is handed in now, `monthGrid(view.month).length`, which is arithmetic on the address and costs
no query.

*A fallback may only reserve what the region is certain to need.* The lead's fallback drew the
hero's own bordered box, and the hero is the one region of the listing that may not exist: at
most one event can be featured, none is by default, and between seasons there is none by rule.
A club without one saw a 230-pixel box appear and collapse — the reflow the skeletons exist to
prevent, on the page every visitor lands on. It is the loading band and a row of chip shapes
now, and the list's fallback is one card rather than three. Both are smaller than the smallest
real case, so the page only ever grows into them, which nobody reads as a fault.

*The calendar's key names the kind filter.* §166 wrote that the filter is not in the key
"because the calendar shows every kind". The calendar does not: `events/page.tsx` has narrowed
the month's rows by kind since §89, so the filter is an input of the very query the boundary
suspends on. Pressing "Cursă" changed the grid's contents while the key stood still, and React
kept the previous kind's grid on screen for the whole round-trip — the "too coarse" failure the
same comment names. The key is `kind:period:layout:type` now, and the comment, the test's
rationale and this paragraph say the true thing.

*Two gradients that were not doing what they said.* `heroSurface` used the `background`
shorthand, which resets `background-color`, so the `bgcolor` beneath it that the hero's comment
called "the fallback" was being erased rather than kept; it is `backgroundImage` now, and the
comment is true. `accentOnHover` declared `transition: background-image 150ms` — dead twice
over: `background-image` has a discrete animation type, so no browser ever ran the curve, and
`transition` in an `sx` fragment is the whole shorthand, so it replaced the four properties
MUI's own Button fades and made *those* snap instead. The line is gone; MUI's transition is
left intact and the gradient arrives at once, as it always did.

*The biggest fold on the listing gets its triangle.* §164 gave every fold the shared
affordance and "Alte evenimente (N)" kept `display: flex` for its 44 pixels — and a flex
`<summary>` has no marker in Chrome or Safari, which is the exact fault §164 was written to
fix. Its height comes from the shared padding now. The wide-screen exception, where it is
always open and is not a control, stays.

*The month arrow says the press landed.* Next holds a soft navigation to a dynamic route until
the server answers when the route carries no `loading.tsx`, and the two unkeyed boundaries then
keep React from committing the shell early — they suspend on a fresh promise every navigation
and React will not hide already-revealed content. So between the press and the new month the
page is correct, still, and silent for the length of the slowest query. `useLinkStatus` is
Next's documented answer to exactly that case; the club's runner takes the chevron's place
inside the same 44-pixel button while the press is travelling. Same box, so nothing moves; the
button keeps its `aria-label`, so the control never loses its name.

*And the test that could not fail.* The new e2e measured the arrow and the grid, clicked, and
measured again — but `toBeVisible()` on the grid passes on the first poll, because a soft
navigation keeps the old one mounted. Every assertion compared a render with itself. It waits
for the month in the address, for the title to change and for no `role="status"` to be left
under `main` before either measurement now, which is what gives the geometry its teeth.

*Rejected:* a `loading.tsx` for the listing, again, and for the same reason §166 gave — an
`events/(list)/` route group would dodge the `notFound()` rule of §54, and it would still
replace the whole page, hero and chips and all, for a change to one grid, which is a bigger
blink than the one being removed. Keying the lead and the list so the commit is not held: that
re-introduces the flicker by hand. `useLinkStatus` on every `ChipLink` as well: the hook must
be a descendant of the link, so each pill would need a wrapper component, and the pills are
already the whole site's chips — the arrows are the control the owner pressed and the control
the report named. Restoring the month-on-view kinds to `presentEventTypes`: the chip row sits
above the streamed calendar, so recomputing it per month would blink the row on every arrow
press; the loss stands as §166 recorded it, and is now stated here so it is not found by
surprise.

**Consequences.** `modules/events/domain/listing.ts` (`listingSections` takes `hasUpcoming`,
`calendarBoundaryKey` takes the kind), the events listing page (both call sites, the week
count, the "other events" summary), `shared/ui/PublicSkeleton.tsx` (`weeks`, a smaller lead
fallback, one card by default), `theme/surfaces.ts` (`backgroundImage`, no `transition`),
`modules/events/ui/CalendarStepLink.tsx` (`useLinkStatus` and the runner) and
`CalendarPicker.tsx` (the comment that promised a `loading.tsx` that never existed). No
migration, no new variable, no new dependency, no new message key. SPECS.md BR-REQ-041-01
criterion 14 and BR-REQ-011-01 criterion 14. Tests: unit `events/listing.test.ts` (a past featured row, the kind in the
key); e2e `event-pages.spec.ts` — the month change is waited for before it is measured.

Baseline `BR-V1.38-2026-09-18`.

## 168. Decided — a special edition, several partners, and the facts one under another (2026-09-20)

**Context.** Four things the owner asked for on the same pass over QA. "I need to define
special events as well" — asked what he meant by one, he chose "a 'special' mark on any event
— a badge on the card and the page, and the listing can lead with it, separate from featured",
and gave the case: "some dates can be special events where we overlap with, say, Brașov
Marathon on the same Wednesday". Then the co-host, which §121 built as one name and one link:
he wants "any number of partners on one event, each with a name and an optional link". Then
the series card, whose fold says "Toate datele (8)" over a list that holds only the coming
ones. And a screenshot of an event page on a phone, where "Când — sâmbătă, 21 noiembrie 2026 ·
întâlnire la 09:00 · start la 10:00" wraps into a run-on line: he wants bullet points, one
under another.

**Decision.**

*A special mark on any event.* `events.is_special`, a boolean beside `featured` in the editor
with a helper saying what it is for, a chip with a sparkle on the card, the hero and the event
page, and one clause in the listing's order. It is deliberately **not** a second featured
flag, and every difference follows from that: no unique index, because any number of editions
may be apart; no clearing of anybody else's mark when one is ticked; and no effect on which
event the page leads with — `listingSections` reads `events[0].featured` and nothing else, and
`SPECIAL_FIRST` sits third in the ordering, behind the featured flag and behind races, so it
decides the order *within* a band and never the hero. The calendar entry and the Open Graph
card say nothing new: a badge is a thing to see on the page, not a fact to carry into
somebody's calendar. And the mark does not travel: it joins the film, the Strava event and the
featured flag in what §130 leaves alone when a save reaches the other dates of a series, and a
duplicate or a repeated occurrence starts ordinary — which is exactly the owner's Wednesday,
special once because another club's race is passing through.

*Several partners.* A jsonb `events.co_hosts` holding `[{ name, url }]` in the club's own
order, at most eight, validated at the form (a name, 1–200 characters; a page https and at
most 2 000) and again when it is read. `co_host_name` and `co_host_url` stay exactly where
they are, unwritten and unread — this release expands only, and dropping them is a later
contraction (`AGENTS.md` §7.6). One function decides what a row means, `readCoHosts`: an
array is the answer, **including an empty one**, and only a null column falls back to the two
old columns as the one co-host they always were. That asymmetry is the whole of the migration
— a save writes `[]` when the club removes every partner, and falling back there would put
the deleted name back on the page. The editor is a repeated group modelled on
`ScheduleRowsEditor`, the same island with the same two reasons to exist and no state beyond
them. The page and the card say "Împreună cu A, B și C" through `format.list`, so the join is
the reader's language's own and each partner is still its own link inside the sentence; the
structured data names every one as an `Organization` after the club, and keeps a bare object
rather than a list of one when the club hosts alone; the calendar writes one line per partner,
the first carrying the label, so each keeps its link. A partner is the series', not one date's,
so it travels where the single co-host travelled.

*"Următoarele date (8)".* The fold holds the coming dates and said "all" of them. Two words in
both catalogues, no key renamed, no code touched.

*The facts one under another.* On the event page only, each row of the `<dl>` renders its
pieces as a real `<ul>`, one line each with a bullet the screen reader does not hear, instead
of a row separated by middle dots. A row with a single piece is not a list of one — it is just
the fact. Nothing about the words changes, the `<dt>`/`<dd>` structure two e2e specs read is
untouched, and the links keep their 44 pixels. The hero and the cards keep the one-line form:
they are summaries above the fold, and stacking the hero's facts would push the button the
hero exists for off a phone's screen.

*Rejected:* a `co_hosts` child table — a partner has no identity of its own, is never queried
across events and never ordered by anything but the club's own hand, so a row per partner buys
a join and a migration for nothing; the list is exactly what `schedule_items` is, and is read
the same way. Dropping `co_host_name` in this release: it is a contraction, and
`migrations:check` is right to refuse it in the same change that adds the column replacing it.
Writing the first partner back into `co_host_name` for a rollback's sake: two places holding
the same fact is how they disagree, and a rollback that shows one of three partners is not a
better failure than a rollback that shows none. A second unique index or a "clear the others"
transaction for the special mark: there is nothing to keep unique. Stacking the facts
everywhere: the cards would double in height for no question anybody asks of a card. Renaming
`Event.series.allDatesCount`: the key's name is not the words it holds, and moving it would
touch a call site to change a sentence.

**Consequences.** Migration `0048` (`events.co_hosts`, `events.is_special`); the schema, the
public columns and the listing's order (`modules/events/repository.ts`); a new
`modules/events/domain/co-hosts.ts` that everything reading a partner goes through — the facts
block, the structured data, `calendar.ts` for the feed, and the editor; the form fields and the
service (`coHosts` and `isSpecial` written, `coHosts` in `SERIES_COLUMNS` and carried by a
copy — a partner is the series'; `isSpecial` carried by neither, because a copy is a different
edition); `admin/actions.ts` gathers the rows by index as it gathers the programme's;
`CoHostRowsEditor.tsx` is new and `EventFieldsForm` has two checkboxes where it had one;
`GlyphChip` accepts the club's orange, `glyphs.ts` gains `special`; `EventFacts` gains
`stacked`, which the event page and the preview pass. Eleven message keys, both catalogues.
SPECS.md BR-REQ-011-01 criteria 15 and 16, BR-REQ-041-01 criterion 15, BR-REQ-050-01
criterion 14 and BR-REQ-052-02 criterion 9. Tests: unit `events/co-hosts.test.ts`,
`content/event-co-hosts-field.test.ts`, `events/structured-data.test.ts`; integration
`events/configuration.test.ts` (the order, and no limit on how many are special),
`cms/series-edit.test.ts` (the partners travel, the mark does not, the old columns are
untouched).

Baseline `BR-V1.38-2026-09-18`.

## 169. Decided — the review's pass over the special edition and the partners (2026-09-20)

**Context.** The review of §168 found nine things, and four of them are the same thing seen
from four sides: the badge the decision promises is rendered on every surface except the one
the owner's own example lands on. §113 folds a repeated event into **one** card, and that card
is `SeriesCard`, which wears the kind chips, the rhythm chip and the cancelled chip and
nothing else — so an organizer who ticks "Ediție specială" on one Wednesday, having read a
helper that says a badge will show on the card, sees nothing on the listing at all. Worse, the
new `SPECIAL_FIRST` clause lifts that whole series line above the ordinary lines of its band,
so the card moves for a reason the reader cannot see and still advertises the soonest,
ordinary date. The draft preview carries `isSpecial` into its synthetic event and never renders
it. Then the smaller ones: `coHostSchema.strict()` makes a stored partner all-or-nothing;
`coHosts` defaulting to `[]` lets a caller that never mentioned the partners erase one;
`sameValue(null, [])` makes the first series save of every legacy event report a change nobody
made; `list-style: none` on the stacked facts takes the list semantics away in WebKit, which
is the one platform the stacking was done for; a bare "• 09:00" on its own bullet; a partner
on a series card that is words where the meeting point beside it is a link; the Romanian chip
reading "Special" where everything else calls it "o ediție specială"; and the English helper
quoting a join that `Intl.ListFormat` does not produce.

**Decision.**

*The badge goes where the card is.* `SeriesCard` wears the special badge whenever **any** of
its dates is special, and `editionDifference` gains a fourth kind, `special`, so the folded
"Următoarele date" list says *which* date it is, with the same sparkle in the club's orange
that the badge wears. The marks are ranked — cancelled, special, the place, the hour — and the
ranking is written down: cancelled outranks everything because there is nothing to come to, and
a special edition outranks "elsewhere" and "at another hour" because it is the reason those
differ and it is the one difference the organizer *stated* rather than the reader inferring it.
With both marks the lift `SPECIAL_FIRST` gives the line is legible, so the lift stays and
`groupSeries`' comment stops describing an ordering that no longer exists. The preview renders
the badge exactly as the public page does, because the preview is the only way to read a draft.

*A stored partner is read leniently.* `coHostSchema` drops `.strict()` — an unknown key is
stripped, never a reason to drop the partner, so the day a later release adds a logo or an id
the other deployment still running today's code reads those rows as having their partners
rather than none — and a page that is not https falls back to `null` instead of taking the
name down with it. That is exactly what the two old columns have always done: the club loses
the link, never the partner. A name is still required; a partner without one is nothing to
render.

*"Say nothing" and "no partners" are two different answers.* `eventFieldsSchema.coHosts` loses
its `[]` default and is simply optional, and `eventColumnsFrom` writes no column when it is
absent. The editor always posts its boxes, so an empty list from it still means the club
removed every partner and is still written as `[]` — which is what `readCoHosts` needs. But a
caller that never mentioned the partners (a script, a fixture, a form from before §168) may
not erase one, and on a row saved before the list existed `[]` would have erased the partner
its two old columns still hold — through the whole series, since `coHosts` is in
`SERIES_COLUMNS`. And the series comparison asks `readCoHosts` what the rows *mean* rather than
comparing the raw columns, so `null` and `[]` on an event with no partners are one value and
the first series save of a legacy event no longer reports and applies a change nobody made.

*The stacked facts are a list on the phone they were made for.* `role="list"` and
`role="listitem"` are stated although `<ul>` and `<li>` already mean them: WebKit drops the
implicit roles from a list whose computed `list-style-type` is `none` with no marker of its
own, and `display: flex` on the item drops `display: list-item` with it, so on iOS Safari
VoiceOver would have read three unrelated lines. And on the page the lone time of a non-race
gets a name — "începe la 09:00" — because on its own bullet under "Când" a bare number is a
second, unnamed fact; on one line, where the date stands right before it, it stays as it was.

*The words.* The public chip is "Ediție specială" in Romanian, agreeing with the noun the whole
feature is named after and with the box the organizer ticks, and "Special edition" in English.
The Romanian helper says "o singură ediție dintr-o serie" rather than "o singură dată", which
reads as "only once", and says "marcaj" throughout rather than "insignă". The English partners
helper quotes "Together with A, B, and C", which is what `Intl.ListFormat` produces for `en`.
And a partner on a series card is a link again: the compact facts go through the same
`coHostSentence` the page does, which already falls back to plain words where the card is
itself one link (`EventCard`).

*Rejected:* excluding series members from `SPECIAL_FIRST`, or sorting the grouped lines by
each series' soonest date — the lift is what §168 decided ("a special edition stands above the
ordinary ones of its own band"), a line holding a special edition is such a line, and the
answer to "the reader cannot see why" is to show them, not to hide the order. Combining marks
on one date ("specială, în alt loc") — one date is one chip with one tooltip, and the date's
own page says the rest. Labelling the single time everywhere, on the cards and the hero too:
a card has no room for a word it does not need, and "sâm, 21 nov · 09:00" was never ambiguous.
Writing the first partner back into `co_host_name` so that "say nothing" could be safe — §168
already rejected two places holding one fact. A new e2e for any of it: the suite is not run in
this pass, and a spec written blind is worse than the gap it closes; the coverage added is
unit and integration, and the e2e gap is named here so the next pass over `event-pages.spec.ts`
can close it with a seeded special event and two partners.

**Consequences.** `modules/events/domain/series.ts` (`EditionDifference` gains `special`,
`editionDifference` takes `isSpecial` and ranks the marks, `groupSeries`' comment),
`ui/EditionMark.tsx` (a table of icon and colour, the sparkle in `secondary.main`),
`ui/series-sentence.ts`, `ui/SeriesCard.tsx`, `ui/EventFacts.tsx` (the roles, the named start
time, the compact partners through `coHostSentence`), `preview/events/[id]/page.tsx`,
`domain/co-hosts.ts`, `content/events/fields.ts` and `content/events/service.ts` (the absent
column, the comparison through `readCoHosts`). Four message strings change (`Event.special` and
one helper in each catalogue) and two keys are new — `Event.startAt`, `Event.series.specialMark`
— in both catalogues. No migration, no new variable,
no new dependency. §168's Consequences paragraph said `coHosts` was not carried by a copy,
which the code and SPECS both contradict; it is corrected there. SPECS.md BR-REQ-011-01
criteria 15 and 16, BR-REQ-020-01 criterion 13, BR-REQ-041-01 criterion 15. Tests: unit
`events/series.test.ts` (the fourth mark and the ranking), `events/co-hosts.test.ts` (the
lenient read), `events/ical.test.ts` (several partners, the label said once),
`content/event-co-hosts-field.test.ts` (absent is not `[]`); integration
`cms/series-edit.test.ts` (a row nobody has saved since keeps its partner, and an empty list
on it is no change).

Baseline `BR-V1.38-2026-09-18`.

## 170. Decided — the editor reads like an editor, and every refusal names what it wants (2026-09-20)

**Context.** The owner asked for a WordPress-like event editor on 2026-09-20 and the work
never happened — the run that was to do it stopped on a credit limit. What was there instead
was a single column of roughly forty inputs under two headings, in the order the columns had
been added to the `events` table, with publication at the very top and the words the organizer
came to write about two screens below it. The same session's walkthrough turned up the rest,
and they are not separate complaints: "aparent nu pot publica un eveniment" (the alert reads
`Lipsesc: RO: excerpt` — a *column* name, for a box labelled "Rezumat" that sits under nothing
and above the long description that dwarfs it); "aparent nu pot șterge evenimente" (the button
fires and `VALIDATION_ERROR` comes back, where the list has explained the same refusal with a
count since §114); "textul ăsta trebuie să fie collapsed" (six lines describing all seven event
types, under every type); "repetă evenimentul trebuie să fie o bifă și abia apoi pot să setez
frecvența"; "am nevoie de iconițe și aici" on the publication row; "și butoanele astea au
nevoie de iconițe și trebe să fie active doar dacă selectez ceva" on the bulk bar; "this part
should be sticky" on the language tabs; "aceste butoane sunt mult prea mari" on the share
pills; and "«Deschide la masă» e confusing? ce e asta? e gen check-in?".

Every one of them is the same defect in a different place: **the screen knows something it
does not say.** It knows which field is missing and says a column name; it knows the event has
three registrations and says nothing until you press; it knows you are choosing a type and
explains the other six; it knows nothing is ticked and offers three live buttons.

**Decision.**

*The words first, the settings in named panels, publication in its own column.* The editor is
two columns from `md` up and one on a phone. The main column is the single save form it has
been since §28 — one `<form>`, one button, one transaction — and inside it the **content**
panel comes first, then four settings panels: "Când și unde", "Înscrieri", "Traseu și detalii",
"Film". The second column is "Publicare": the state and version chips, the live-edit warning,
what is still missing, the transition buttons, the series header with its date chips, and
repeat. On a phone that column is **first**, because on a phone it is what somebody opened the
page to check. The two are siblings and never nested: the save is one form and every
publication verb is a form of its own, and a form inside a form is not a thing HTML has.

Nothing was renamed. Every field posts the name it posted before, so `eventFieldsFrom` and
`translationFieldsFrom` read exactly what they read yesterday and every end-to-end locator
still finds what it looked for. This is a rearrangement, and it is written down as one so that
the next person does not go looking for the migration.

*Within a language: the order somebody writes in.* Title, then the long description
("Conținut — apare pe pagina evenimentului"), then the summary under it ("Rezumat — apare pe
card și în distribuiri"), then rules, programme, what to bring. The page address and the two
search-engine fields are folded at the bottom: set once, never looked at again. The summary
was **above** the description, which asked for a one-sentence summary of something not yet
written — and an empty summary is precisely what refuses publication. The labels now say where
each one shows up, because "Descriere scurtă" and "Descriere completă" differ by one adjective
and nothing about what they are for.

*A refusal names the field on the screen, not the column in the table.* "Not ready to publish"
maps every key `missingPublicFields` and `missingPublicEventFields` return through
`editor.fields.*`, and names the language in its own endonym: `Română: Rezumat — apare pe card
și în distribuiri`, not `RO: excerpt`. The service's own message keeps the column names; it is
a developer's log line, and this is the sentence a person reads.

*Delete explains itself before it is pressed.* The editor counts the registrations against the
event and replaces the button with the reason, exactly as the list has. When every row in the
way is test data it says so and points at the button that clears them, one section above,
because "three registrations" on a QA event the organizer filled themselves is a dead end and
"three registrations, all of them test data" is a next step.

*Race numbers say why there are none.* A queue made entirely of test registrations gets no
numbers and never will (§30, `AGENTS.md` §12.6). The screen said "no numbers yet", which reads
as a broken button. It now says the rule and names the way to rehearse: a walk-in at the desk,
which writes a real row.

*The type note is about the type you chose.* One sentence for the chosen type, under the
select; the comparison of all seven folded beside it. A comparison is for choosing and belongs
one press away; the description of six types you did not choose is noise on every event.

*Recurrence is a tick.* "Repetă evenimentul" is a checkbox, and the cadence, the weekdays, the
end date and the button appear under it once it is ticked. The `NONE` cadence existed only
because the control was always shown; the creation form and the event page both read the tick
now, and both actions refuse a series without it. The fields are hidden, never unmounted, so a
date typed and then unticked is still there when the box goes back on.

*Glyphs on the verbs, dimmed when there is nothing to act on.* One registry,
`shared/ui/action-icons.ts`, keyed by name — because an icon passed from a Server Component as
an element-valued prop is the defect `CheckboxField` documents, and the fix is the same: the
name crosses, the client makes the element. The bulk bar's three buttons dim while nothing is
ticked, and the test for "this island is running" is `total > 0`: without JavaScript the count
is never taken, the buttons stay live, and the server answers "nothing ticked" as it always
did. No guard moved to the client.

*The language tabs stay put.* The content panel is the tallest thing on the page, and by the
bottom of the Romanian text the way to the English one was a page and a half above.

*Two sizes for a pill.* The share and calendar buttons are 44 pixels on a touch screen and 32
from `sm` up. A finger needs the 44; a pointer does not, and eight finger-sized pills across a
desktop row are the loudest thing on a page where they are the least important. 32 is still
well over the 24 WCAG 2.2 asks for.

*A link says where it goes.* "Deschide la masă" is "Deschide la masa din ziua cursei
(check-in)".

**Rejected.** *Folding the settings panels.* A `<details>` would hide a required field from
somebody who has never seen this screen, and the whole of this section is about a publication
refusal naming a field nobody was shown. The panels are boxes, not folds; the folds are for
what is genuinely optional — SEO, the type comparison, how a series works.

*Showing the type help only for `RACE`*, which is the literal reading of "trebuie să apară
doar la concurs, nu la toate". It would hide the explanation of what a race is from somebody
sitting on `GROUP_RUN` wondering which to pick. The substance of the ask — do not show me six
paragraphs about types I did not choose — is met by the one-line note, and the comparison stays
reachable.

*Moving the featured and special marks into "Publicare"*, where they belong by meaning. They
are `event.*` columns and post with the save form; the publication column holds the transition
forms, which are separate forms. Putting them there would have meant either a form inside a
form or a second save, and both are worse than a mark at the bottom of "Traseu și detalii".

**Consequences.** `EventFieldsForm` returns four `EditorPanel`s instead of one `Stack`;
`TranslationFieldsForm` is reordered and gains a fold; the event page's `return` is a grid with
two children. `RepeatFields` loses `withNone` and both actions gain a tick to read, so a form
posted by an older cached page creates no series — which is the safe direction. Two message
keys change wording (`editor.fields.body`, `editor.fields.excerpt`) and one link does
(`registrations.openDesk`); the rest are additions. `tests/e2e/series-edit.spec.ts` ticks the
new box before it fills the cadence.

Tests: `tests/e2e/series-edit.spec.ts` (the repeat tick), `tests/unit/i18n/messages.test.ts`
(both catalogues carry every new key), `tests/integration/cms/workflow.test.ts` (the excerpt
derivation the reordered panel now makes obvious).

Baseline `BR-V1.38-2026-09-18`.

## 171. Decided — the whole account workflow, and a form that says where its answers go (2026-09-20)

**Context.** Two clusters from the same walkthrough, and they meet in the same place: a screen
that knows something it does not say, and a workflow that stops one step short of being usable.

*The accounts.* The owner: "but the zitadel workflow is not complete… I need to invite users to
create accounts man! and set passwords and stuff", then "I must invite users and stuff, and I
can also deactivate, send password resets, etc". What existed was half of it — create the human
user, ask Zitadel for an invite code — with three holes. An account that already existed
returned 409 and the story ended there: the row joined the allowlist, the screen said "they
already have an account", and **nobody ever sent them the link that sets a password**, which is
the common case rather than the rare one. There was no way to send a password reset to somebody
who had signed in before and could not now. And there was no way to switch an account off at
the provider — "Retrage accesul" removes the `staff_users` row, which is what stops the
*backoffice* letting somebody in, and says nothing about whether they can still sign in at all.

*The form.* "La formularul de înscriere trebuie să fie clar ce date sunt publice și ce date sunt
confidențiale"; "nu e clar cu informațiile medicale, trebuie să bifeze doar «declar că sunt
apt»"; "pune iconițe chiar și la sex"; "și la cetățenie pune steaguri man". The registration
form asks for a birth date, a phone number, a next of kin and a health note, and said nothing
anywhere about where any of it goes — while the answer is unusually good and worth saying. The
medical block asked for free text first with a consent under it, which reads as "tell us your
conditions", so the one thing the club actually needs from everybody — that they consider
themselves fit — was nowhere and the Article 9 box was everywhere.

**Decision.**

*An existing account is invited, not skipped.* A 409 on create falls through to the same
invitation a new account gets, so the person receives the link that sets their password either
way. The outcome still reports `exists`, because the screen should say "they already had an
account" rather than claim one was made.

*Two more verbs, each its own button.* **"Trimite resetare de parolă"** asks Zitadel to email a
reset link (`POST /v2/users/{id}/password_reset` with `sendLink`) — offered only to somebody who
has signed in at least once, because before that the invitation is the right email and it sets
the first password anyway. **"Dezactivează contul"** deactivates at the provider
(`/deactivate`, with `/reactivate` behind the same function). It is deliberately *not* folded
into "Retrage accesul": they answer two different questions — "may they use the backoffice" and
"may they sign in at all" — and a colleague who changed job inside the club wants the first
without the second. Nothing here ever holds a password or a code; Zitadel sends, Zitadel owns.

*Every lookup is by email.* One `findZitadelUserId`, shared by all three verbs, because each is
"find the person, then do one thing to them" and a lookup that disagreed between two of them
would be the same defect twice. It searches `emailQuery` first and `loginNameQuery` second —
the fix §170 made for the resend, now the only implementation there is.

*The form says where its answers go.* One sentence above the first field, in two versions: the
ordinary one ("nothing you write here appears anywhere on the site") and the one for an event
that publishes a start list, which names the single exception and says what is *not* published
even then. Each block of fields carries its own marker underneath — "Confidențial. Nu se
publică." — so somebody who skipped the banner still meets the answer beside the question.

*The medical block becomes a statement and a note.* **"Declar pe propria răspundere că sunt apt
medical să particip"** is a required tick among the consents, stored as `fitness_declared_at`.
It is **not health data**: no condition, no diagnosis, nothing Article 9 covers — which is
exactly why it can be required where `health_notes` cannot, and why it needs no separate
consent. The free text and its own consent stay, folded and closed, under a sentence saying it
is optional, what it is for and that it is deleted seven days after the event. A test
registration ticks it like everything else (§30); a staff entry and a desk walk-in do not —
there the paper declaration carries it, and no staff member declares fitness on somebody's
behalf (`AGENTS.md` §15.11).

That fold **reverses §59 for this one group**, and only this one. §59 opened the optional
sections because "a field nobody sees is a field nobody fills", and that argument is right for
the runner's own club — the field people reported as missing. It is wrong here: the thing that
must be filled is the tick, which is now among the consents where nothing hides it, and an open
free-text box asking about conditions was reading as an instruction rather than an offer. Every
other optional group stays open.

*Glyphs on the closed sets.* Female, male and person beside the three answers for sex; the
country's flag before its name, from the set `scripts/sync-flags.mjs` already copies into
`public/flags/` — which that script was written for ("will show many when a participant can
state their country"), normalised to 4:3 so a column of two hundred names does not wobble
between Romania's 2:3 and the United Kingdom's 1:2. A regional-indicator emoji was tried first
and dropped: Windows draws it as two boxed capitals, and Windows is what the club's laptop runs.
Both as **children** of the menu item, never as an element-valued prop — the defect
`CheckboxField` documents. The flags degrade to boxed letters on Windows, which is accepted:
the country's name is the label and this is the mark beside it.

**Rejected.** *Making the fitness statement part of the privacy acknowledgment.* They are
different things — one is "I have read what you do with my data", the other is "I am fit to run"
— and a single box covering both would let a refusal of either be read as agreement to the
other.

*Shipping flag images.* 249 SVGs, or a package, to fix a rendering choice one desktop platform
makes, on a page every phone loads. The name is the label; the flag is decoration.

*Deactivating the account inside "Retrage accesul".* It would make the common case (somebody
moving between roles) destructive, and the destructive case is one extra press away.

**Consequences.** Migration `0049_fitness_declared` adds one nullable column — expand only,
null for every row taken before it existed. `registrationSubmissionSchema` gains a
`z.literal(true)`, so every fixture that builds a valid public submission carries it, and
`REGISTRATION_FORM_FIELDS` carries it too, because an unticked literal is a rejection the error
summary must be able to name and link to. The CSV export gains a "Medically fit (declared)"
column. `zitadel-users.ts` goes from two exported functions to four, over one connection helper
and one lookup.

Tests: `tests/unit/staff/zitadel-users.test.ts` (an existing account is invited; the reset asks
for a link and never a code; deactivate and reactivate; each verb without the key),
`tests/unit/registrations/*` and `tests/integration/registrations/*` (the new required tick, and
that a test registration makes it like a real one).

Baseline `BR-V1.38-2026-09-18`.

## 172. Decided — the start list as a spreadsheet, named after its race (2026-09-20)

**Context.** The owner: "the participants list must be exported to an excel (nicely formatted)
and also re-imported", then, flatly: "CSV is stupid! I want excel! and export just for a
particular race!"

He is right about the file and half right about the filter. The per-race export already
existed — the button carries the list's filters, so setting "Evenimente" and pressing it
produces that race's entrants and nothing else (§15.10) — but the file it produced was called
`registrations.csv` whichever race it was about, which is how three of them end up in a
downloads folder telling you nothing. And a comma-separated file is not what a volunteer opens
on race morning: a Romanian Excel splits on semicolons rather than commas, renders `07` as `7`,
reads a timestamp as whatever the machine's locale thinks it is, and arrives with no header
frozen and every column one character wide. The club's actual use — sort by club, scan down the
numbers, tick people off — is a spreadsheet's job, and the file was making it hard.

**Decision.**

*The same rows, as a real `.xlsx`.* `format=xlsx` on the same route, and the button on the list
asks for it; the comma-separated file stays behind a quieter link, because it is what a script
reads and the one format nothing can misinterpret. The sheet has a bold header frozen at the
top, columns wide enough to read, dates written as dates so they sort as dates, and the race
number as a number so it sorts as one. Two columns the CSV never had: the registration's `id`,
first and narrow, and the runner's own club — the thing a start list is actually sorted by.

*The file is named after the race.* The event's title as filtered for, plus the day, so two
exports of one race a week apart are two files. The sheet inside carries the same name, reduced
to what Excel accepts: at most 31 characters and none of `: \ / ? * [ ]`.

*`write-excel-file`, not ExcelJS.* 1.8 MB against 21, in a function whose whole bundle has a
ceiling on the plan this runs on. ExcelJS is the better-known answer and would have been the
lazy one. This writes; it does not read, and the reader — the other half of what was asked —
is chosen on its own merits when the import is built, because reading somebody's edited
spreadsheet is a different problem from writing a clean one.

*Every cell is typed, and that is the formula guard.* A name beginning with `=` is a formula to
a spreadsheet, and a start list is exactly where one arrives from a public form. The CSV
prefixes an apostrophe (`neutralizeCsvValue`); here the cell is declared as text, which is the
stronger version of the same guarantee — a text cell is never evaluated, whatever it starts
with — and the test asserts that no `<f>` element exists anywhere in the sheet.

*The tests read the bytes.* Not a round trip through the same library, which would agree with
itself and with nothing else: the test opens the ZIP through its central directory, checks the
four parts without which no spreadsheet opens the file, and reads the sheet's own XML for the
header, the frozen pane and the values. A writer that passes this produces a file Excel opens.

**Deferred — the re-import, deliberately, and it needs a decision the owner has to make.**
Reading the file back is easy; deciding what it is *allowed to do* is not. An imported row must
never create a registration, because a place comes from the allocator under lock (§10.6,
BR-REQ-034-01) and a spreadsheet row that becomes a confirmed entrant is an overbooking with
extra steps. It must never set a status, because a confirmation requires an approved declaration
somebody signed (§10.8). So an import can only be "update these columns on rows that already
exist, matched by the `id` the export wrote" — a spelling corrected, a club filled in, a t-shirt
size — with a preview of exactly what would change before anything is written. That is the
shape; which columns are editable is the owner's call, and building it before that answer would
be building the wrong thing.

**Rejected.** *Replacing the CSV.* It costs nothing to keep, it is what anything automated
should consume, and the one property it has that the workbook does not — being readable by
every tool ever written — is worth a second button.

*Putting the filters in the filename beyond the event.* "Confirmate" and "necăutate" are how
the file was made, not what it is about; the event is what it is about.

**Consequences.** One dependency, pinned. `RegistrationListRow` carries `clubName`. The export
route grows a branch rather than a second route, because everything before the branch — the
role check, the filters, the omission of test rows — is identical and must stay identical.

Tests: `tests/unit/registrations/workbook.test.ts` (the container and its parts, every header,
the frozen pane, a number that stays a number, a name that never becomes a formula, a sheet
name Excel would refuse, and an empty list that still produces a file).

Baseline `BR-V1.38-2026-09-18`.

## 173. Decided — race numbers in order, from the race's own band (2026-09-20, reversing §94)

**Context.** The owner, having asked for a random draw on 2026-09-18 ("the bibs must be
generated randomly", §94), reversed it: "cred că ar fi mai ușor să dăm numerele de concurs în
ordinea înscrierii, așa se face de obicei, dar există un prefix de cursă — spre exemplu numerele
pot începe cu 1 acum dar la alte curse sunt de la 100 în funcție de distanță și au altă
culoare". And, separately: "nu ar trebui să mai pot schimba numărul de concurs odată
confirmat!"; and "nu văd BID-ul" of the registrations list.

He is right, and the reasons are not aesthetic. A random number is a number nobody can check
off: a volunteer with an envelope of pre-printed bibs hands them out in order, a start list is
read down a column, and "is 47 here yet" is a question a sequential list answers and a scattered
one does not. The band is the other half: a club running a 5 km and a 10 km gives one 100–199
and the other 500–599, in two colours, and the number a runner wears says which start line they
belong on before anybody reads a name.

**Decision.**

*Numbers run in order, from the event's own start.* `pickBibNumber` returns the lowest free
number at or above `events.bib_start_number`, which defaults to 1. Not "the last one plus one":
the lowest free one, so a gap left by a number typed by hand out of order is filled by the next
registration rather than skipped past. Everything that made §94 safe is untouched — the draw
happens under the event row's lock, the same serialization point capacity uses (§10.6); a number
once given is never renumbered; a cancelled registration keeps its number so it is not handed to
somebody else.

*Two columns on the event: the band and its colour.* `bib_start_number` (1 by default, at most
99000) and `bib_colour` (a hex triplet, or nothing for the club's own). Both on the event
because the club runs one distance per event today — multi-distance races are M2 — so an event
is exactly the unit a band belongs to. Both are checked at the database: a start that a
four-digit bib can reach, and a colour that is six hex digits after a hash, because the sheet
paints the value straight into the printed band and a stored `red; background: url(…)` would be
a style injection into a PDF the club hands to two hundred people.

*A confirmed runner's number is settled.* §105 put a preferential number in an organizer's
hands; that stays, before confirmation, which is when nothing is printed and nobody has been
told. Once a registration is confirmed the runner has the number in their inbox, it is on a
sheet and possibly on a bib in an envelope, and changing it there produces two people who each
believe they are 214. The one exception is a confirmed registration with **no** number: filling
that gap is not moving anybody, and it is what a row confirmed before §87 looks like.

*The number is a column of the list.* It was inside the journey chip, which is where somebody
looks for "how far along is this person" and not for "which number is this". It sorts, nulls
last — a row with no number is not "before 1", it is not in the list the sort is about — and the
step column is called "Unde a ajuns" rather than "Etapă", which named the concept and not the
question.

**Rejected.** *Keeping the random draw behind a setting.* Two allocation strategies is two
things to reason about at the one point in the system where two organizers press a button at
once, for a choice nobody will change twice.

*A band per distance rather than per event.* It is the right model and it is M2's, when an event
can hold several races. Building the column now would mean a shape with one row in it forever
and a migration anyway when the real thing arrives.

*Letting an Administrator override the lock.* Every override becomes the normal path within a
month. The desk can already give a number to somebody who has none, which is the case that
actually arises.

**Consequences.** Migration `0050_bib_band`, expand only: two nullable-or-defaulted columns and
two checks. `suggestFreeBibNumbers` counts from the event's band unless the caller says
otherwise, so the backoffice stops offering 1, 2, 3 at a race whose numbers start at 500.
`assignBibNumbers` reads the band once under the lock it already takes.

Tests: `tests/integration/registrations/race-day.test.ts` — numbers in order from 1 and from
100, a confirmed number that cannot be changed or cleared, a preferential number before
confirmation with its duplicate and nonsense refusals, the gap-filling exception with its email,
and suggestions that start where the race does.

Baseline `BR-V1.38-2026-09-18`.

## 174. Decided — the lockup where it belongs, and the event in the runner's calendar (2026-09-20)

**Context.** The owner, of the declaration PDF: "logo-ul nu apare colorat frumos cu albastru în
declarație", with a picture of the club's mark drawn as a thin hollow outline; then, with the
filled mark attached: "logo trebuie să apară așa: și în mail și în declarații și peste tot!".
Separately: "în mailul de înregistrare am nevoie de logoul BVR și de link către eveniment și
site", "și de iCal ca să poată pune în calendar".

Two different defects wearing one complaint.

*The PDF.* `src/theme/pdf/logo.png` was already the filled blue lockup — but it carried an
**alpha channel**. An alpha PNG does not reach a PDF as one image: pdfkit writes the colour and
a separate soft mask, and the viewer composites them. Several viewers, and most printers,
composite that badly, and what comes out is edges — the outline the owner photographed. The
file was also 600×248 against the `495/1200` ratio the three renderers use to place what
follows it, so the layouts were each off by a hair.

*The email.* The card's header was the club's name as letter-spaced text on a blue band. No
logo anywhere, in the one message a runner keeps.

**Decision.**

*One script, two rasters, both committed.* `scripts/brand-assets.mjs` renders
`public/brand/logo.svg` and its white twin into the two places that cannot take an SVG: the
PDFs, and the email. The SVG stays the source of truth — it is what the site serves and what a
review can read as text. The outputs are committed rather than built, because rasterising at
build time would put a native dependency in front of `next build` for a file that changes once
a year.

*The PDF raster is flattened onto white.* No alpha, so there is no soft mask and nothing to
composite: no viewer and no printer can get it wrong. White because every page these are drawn
on is white. And 1200×495, which is finally the ratio the code already assumed.

*The email header carries the lockup as a PNG.* White on the club's blue, hosted under
`APP_BASE_URL` — a **raster**, because half the mail clients in use refuse SVG, and hosted
rather than inlined, because a data URI is what the rest of them strip. Its `alt` is the club's
name, so a reader with images off sees exactly what the band said before: nothing is lost when
the picture is blocked, which is the common case on a first message from an unknown sender.

*The confirmation and the reminder carry the event as a calendar file.* The same `.ics` the
event page offers (§107, §159), from the same function, attached. Every phone and desktop
client opens it with one tap, including the ones that will not follow a link out to the site —
which on race week is the point. **Published events only**: an `.ics` for a draft would put an
unpublished page's details into somebody's calendar, and a message for an unpublished event
simply goes without one. It rides beside the signed declaration on the confirmation, never
instead of it.

*A translator without a request.* The outbox renderer drains from the scheduler, long after the
request that queued a row has gone, so `getTranslations` is not available to it —
`calendarLabels` uses next-intl's own `createTranslator` over the statically imported
catalogues. The public routes keep `getTranslations`; both produce the same words.

**Rejected.** *Keeping the alpha and fixing the viewer.* There is no viewer to fix; the file is
handed to whoever the club hands it to.

*Inlining the logo as a data URI.* Gmail and Outlook both strip them, which trades a picture
that renders badly in some clients for one that renders in none.

*Attaching the `.ics` to every message.* The verification email is about confirming an address,
not about a date; the state notice is about a place being lost. Two messages carry it, and both
are ones somebody acts on.

**Consequences.** `findPublishedEventBySlug` becomes generic in its schema, like its neighbours,
because the renderer reaches it with the application's own database handle. Three test
assertions that said "this message has no image" or "no link" now ask that of the **body**: the
header band has a picture on every message, and the claim was always about the content.
`README.md` indexes the new script.

Tests: `tests/integration/registrations/signed-declaration.test.ts` (the confirmation carries
both attachments; the calendar file is a real VCALENDAR naming the event), and the three scoped
assertions above.

Baseline `BR-V1.38-2026-09-18`.

## 175. Decided — the QA calendar says so, and a tick that cannot be untied is not offered (2026-09-20)

**Context.** Two findings from the owner's walkthrough, both about a control saying something
untrue about itself.

"The QA iCal needs to be named differently!" — the `.ics` files two deployments produce carry
different UIDs, because a UID takes its host from the site's own address, so a QA copy and a
production copy of the Sunday run never merge into one entry. What they do instead is sit side
by side in the same calendar app, same title, same hour, with nothing on screen to say which
one is real. The club's own people subscribe to both while rehearsing, which is exactly the
situation §163 already solved for email with the `[QA]` subject mark.

"E ciudat că aici nu pot deselecta ediția curentă, e un pic redundant sincer" — the series
header shows every date as a chip with a tick box, and the date whose editor is open is ticked
and cannot be unticked (§134: the save always reaches it). A box that refuses to change is not
a choice; it is a picture of one, and it invites the press that does nothing.

**Decision.**

*The environment goes on the calendar's name **and** on every entry.* `[QA] ` in front of
`X-WR-CALNAME` and in front of each `SUMMARY`, idempotent, QA only — production is never
marked, and local and test never leave the machine. Both halves are needed: a subscribed feed
shows its calendar name, while a single event added from the confirmation's attachment lands in
a calendar that already has a name of its own, and the only thing on screen is the entry's
title.

*The current date's chip drops its box.* It stays filled, keeps `aria-current="page"` and keeps
the arrow that opens it; the checkbox role and the tick belong to the dates where ticking is a
decision. Nothing about the rule changed — a save still reaches the date whose editor is open —
only the claim the control was making about itself.

*A tap target is 44 pixels on a phone and 24 on a desktop.* The owner, twice: "aceste butoane
sunt mult prea mari", "these buttons must be smaller as well and have icons". The share row, the
add-to-calendar row and the month/year pickers are 44 on a touch screen and 32 from `sm` up.
BR-REQ-041-01 criterion 6 asks for 44 on **event links**, and those are whole cards —
comfortably over it at either width. The end-to-end check that enforces it measured *every* link
in `main` at 44, on both projects, which is stricter than the criterion and is what caught this:
it now asks 44 of the phone, which is the design target and where a finger is the pointer, and
WCAG 2.2's own 24 of the desktop, where it is not. The cards are unchanged and still measured.

**Rejected.** *Marking the QA `.ics` by UID alone.* Already true, and invisible: a UID is not
something anybody reads.

*Leaving every control at 44 on a desktop.* Eight finger-sized pills across a desktop page are
the loudest thing on it, and they are the least important thing on it.

*Letting the current date be unticked.* It would mean "save this event, but not this event".

**Consequences.** `qaMarked` lives in `ical.ts` beside the builder, because both the feed and
the per-event file pass through it. The one test that asserts the mark sets `APP_ENV` around a
fresh import rather than mutating a module's view of the environment behind its back.

Tests: `tests/unit/events/ical.test.ts` (production unmarked, QA marked on the calendar name
and on the entry).

Baseline `BR-V1.38-2026-09-18`.

## 176. Decided — three things that were silently impossible (2026-09-20)

**Context.** Three reports in one afternoon, on the day the owner meant to finish and test the
site. Each is the same failure: the platform knew exactly what was wrong and said something
else, or nothing.

*Registration.* "Trebuie să ne putem înscrie man!" — the form returned "Înscrierea nu a putut fi
trimisă. Verifică datele completate", on a form where every field was correct. The rejection was
Turnstile: a token Cloudflare will not confirm redirects with `fields=captcha`, and `captcha` is
not one of the form's fields, so `parseInvalidFields` dropped it and the summary fell through to
the generic sentence. The catalogue has had the right words (`errors.captcha`) since §97 and
nothing could reach them. A visitor is sent hunting through twenty correct inputs for a failure
that is about none of them — and the club cannot register anybody.

*Deleting an event.* "Încerc să șterg un eveniment și nu merge! E destul de grav! Asta o să îmi
umple baza de date." The refusal was correct — an event with registrations is archived, not
deleted — and its advice was a dead end: it said "arhivează-l" to somebody looking at an event
that was **already archived**, about rows he had created himself to rehearse with. A QA database
fills with events nobody can remove.

*Pictures.* "Pictures look really bad and compressed now", then "în continuare imaginile sunt
super pixelate, hyper-comprimate, big issue."

*Staff sign-in.* "That invitation email code does not work, I am still asked to sign in but I
don't have the option to create an account." The invitation said the colleague makes their own
account on the sign-in page. They cannot: that page is one button that hands off to the
provider, and the provider offers no self-registration for this organization. Without
`ZITADEL_MANAGEMENT_PAT` nothing creates the account, so the sentence described something
impossible.

**Decision.**

*The anti-bot refusal says what it is.* `captcha` is read from the raw parameter — it is a
rejection about nothing the person typed, so it is deliberately not a form field — and the
summary shows `errors.captcha` first and alone, with the same sentence under the widget. The
check itself is unchanged: an unconfirmed token is still refused, in every environment. What
changed is that the person is told, and the club is not left thinking the form is broken.

*An event takes its own test registrations with it.* When every registration blocking a delete
is `kind = TEST`, they are removed and the event goes. Nothing new is permitted: clearing test
rows is already an Administrator's verb on the event page, already refused in production, and
already exactly this code (`removeTestRegistrations`) — this is the two presses in one. **A
single real registration still blocks the delete**, and the count in the list now names the real
ones only, so "3 persoane sunt înscrise" never again means three rows the organizer invented.
The evidence rule is untouched: a real registration carries the privacy notice its participant
acknowledged and, once signed, their declaration (`AGENTS.md` §10.8).

*A picture is encoded lossily once, not twice, and at a size a screen actually has.* The browser
re-encoded every upload to WebP at 0.86 before sending it, and the server decoded that and
re-encoded to WebP at 80 — two lossy generations, the second working from detail the first had
already discarded. The browser now sends the file **untouched** when the server will accept it,
and shrinks only what is too large, at 0.95, because that output is an intermediate whose
artefacts become permanent. The stored width goes from 1600 to **2400** and quality from 80 to
**88** with `effort: 6`: the editor and the event page render a picture across about a thousand
CSS pixels, and every screen the club uses is 2×, so 1600 was being *upscaled* — magnifying the
artefacts of a double encode. The thumbnail follows, 480 → 640.

*Echipa says the real step when it cannot create an account.* A warning names
`ZITADEL_MANAGEMENT_PAT`, and the help text stops promising self-registration: it says to set
the key or to create the account in the provider's console. Nothing about the auth model
changed — `staff_users` is still the allowlist (`AGENTS.md` §13).

**Rejected.** *Waving through a missing Turnstile token outside production.* It would make QA
disagree with production about whether a registration succeeds, which hides the problem until
the day it matters. The owner can switch the keys off in thirty seconds if he wants the form
open, and the honeypot and the timing check stay in front of it either way (§19.4).

*Letting a delete clear real registrations.* That is the evidence the platform exists to keep.

*Fixing the pictures by raising quality alone.* The double encode was the larger half; quality 95
on a twice-encoded 1600px file is a bigger file that still looks soft.

**Consequences.** `countRegistrationsByEvent` returns `{total, test}` per event, so the list can
say how many real registrations are in the way. `deleteEvent` calls `removeTestRegistrations`,
which brings the environment gate with it — in production the refusal is unchanged whatever the
rows are. Pictures already stored keep the artefacts they were given; re-uploading is what fixes
them, and the owner has been told so.

Tests: `tests/integration/cms/crud.test.ts` (an event with only test rows is deleted with them;
one real row still refuses, and nothing is cleared on the way to being refused).

Baseline `BR-V1.38-2026-09-18`.

## 177. Decided — the review's pass over the band, the banner and the message count (2026-09-20)

**Context.** An adversarial survey of the day's work, run before the next batch, found three
things the tests had not.

*The band never reached the row.* §173 added `bib_start_number` and `bib_colour` to the event,
the editor's two controls, the zod fields and the migration — and `eventColumnsFrom`, the one
place the event's columns are written, was not touched. Both values were parsed, validated and
dropped. SPECS BR-REQ-038-01 criterion 12 ("both are stored on the event") was false on the
day it was written; the integration test that would have caught it inserted the column by hand.

*The banner lied by omission.* §171's "Nimic altceva nu se publică: nici emailul, nici telefonul,
nici data nașterii" on the registration form — while `club_name` has been on the public start
list since §85. The tick was consent to one field where two are published.

*The message count was one too many.* `MESSAGES_PER_COMPLETED_REGISTRATION = 5` counted
`DECLARATION_SIGNED`, which nothing has enqueued since §126 folded the PDF into the
confirmation (§171 confirmed it). Every headroom and cost figure on `/devs` and
`/admin/tasks` over-projected by a quarter.

**Decision.** Both band columns are written by `eventColumnsFrom` and carried by a series save
(`SERIES_COLUMNS`): one race, one band, on every date. The colour control becomes a **palette**
rather than `<input type="color">`, which has no empty state — every save would have written a
colour whether or not the organizer chose one, and null, §173's "the club's own", would have
been unreachable. Six print-safe colours plus the club's own; a stored colour outside the palette
is kept as its own option so a save never silently changes it. The banner names the club. The
constant is four, and its comment says why.

**Consequences.** `tests/integration/cms/one-save.test.ts` saves the band and reads it back, and
saves it empty and reads null. The next batch's builders start from this commit — the review
also found their worktrees had been cut from an old `main`, which is recorded here so the next
run checks its base before it writes a line.

Baseline `BR-V1.38-2026-09-18`.

## 178. Decided — the registrations list gets verbs, not a status select (2026-09-20)

**Context.** The owner, of the registrations screen: "trebe sa pot face management de inscrieri
mai eficient!", "CRUD participants", "and statuses should be drop-down", and separately "aș vrea
să filtrez by default după evenimentul principal (pt că ar trebui să existe doar unul la un
moment dat)".

Everything he is asking for already exists as a verb — confirm on paper, give a place, check in,
undo, resend, cancel — on the registration's *own* page, one at a time, behind a click into the
row and a click back. Eighty registrations on race morning is eighty round trips. What the list
offered was a resend button and nothing else.

The sentence that needed a decision is "statuses should be drop-down".

**Decision.** *The drop-down is a menu of verbs, never a status select.* Picking a state and
saving would be a second write path into `registrations`, and it would go past three things at
once: the allocator that hands out places while holding the event row (`AGENTS.md` §10.6), the
approved declaration a confirmation requires (§10.8), and §15.11's closed list of what staff may
do, which ends "there is no fourth". A free select could confirm somebody who never signed
anything — quietly, with no audit row naming who did it and no place taken from the queue in the
proper order. So each row carries a "⋮" holding the verbs that apply to *that* row, each one
submitting a hidden form the Server Component already rendered, each reaching the same Server
Action and the same service as the registration's own page, each authorized there again
(BR-REQ-060-01).

*Which verbs appear is one pure function.* `rowVerbsFor(status, role, {checkedIn})` — tested
against `state-machine.ts` rather than against a list copied into a test. The assertion that
matters: it never offers to confirm a registration the state machine cannot move to CONFIRMED,
which is precisely how "no confirmation without a signed declaration" survives a new surface.
Spread across JSX, that property would have been something a reader had to reconstruct.

*The list is about the featured event unless told otherwise.* `defaultEventFilter` is pure and
shared by the page and the export link, because a filter applied on screen but not in the
download hands the club a spreadsheet of a different set than it was looking at (§15.10). "Toate
evenimentele" is the literal `all`, one press away — a default that cannot be escaped is not a
default. An id no longer in the list falls back rather than showing an empty page filtered by
something the select cannot display.

**Rejected.** *A status select, as asked.* See above. The owner's underlying complaint —
too many clicks — is answered without it.

*Inline editing of a participant's details in the row.* The detail page owns the name correction
and its audit trail; a second editor for the same field is a second place for it to be wrong.

**Consequences.** `listEventsWithRegistrations` returns `featured` so the default can be
derived without a second query. The row's actions cell grows one icon button; the resend button
stays where it was, because on race week it is the one verb pressed most and a menu would cost it
a click.

Tests: `tests/unit/registrations/row-verbs.test.ts` (never a verb the state machine refuses;
never confirm before the declaration; check-in only for confirmed; the destructive verbs withheld
from a role that may not manage registrations; resend exactly where a message exists) and
`tests/unit/registrations/default-event-filter.test.ts`.

Baseline `BR-V1.38-2026-09-18`.

## 179. Decided — erase is gated on the role, not on "can this still be cancelled" (2026-09-20)

**Context.** Twice over, an hour apart: "tot nu pot sterge evenimente!" and then "nu pot sterge
inscrieri!". The second explains the first. He had two registrations he had made himself while
walking the form, the event refused to be deleted because of them, the refusal told him to
archive the event instead — and when he went to remove the registrations, the screen that erases
one was not there.

It was not there because the whole destructive section of a registration's page — cancel *and*
erase — sat behind one condition: `canTransition(status, "CANCELLED")`. A registration that is
already CANCELLED or EXPIRED has no such edge. So the verb disappeared from exactly the rows most
likely to need it, and the more carefully somebody cleaned up after a test — cancel first, then
remove — the more certainly he locked himself out.

The service never had that limitation. `deleteRegistrationByStaff` releases the place only
`if (canTransition(current.status, "CANCELLED"))` and erases either way. This was the UI hiding
a verb the domain supports, which is the failure mode §15.11 is written against from the other
direction: a screen must not offer what the domain refuses, and it must not withhold what the
domain allows either.

**Decision.** *Erase is its own section, on its own gate:* `canManageRegistrations(actor.role)`
— the same condition the Server Action asserts (BR-REQ-060-01). Cancel keeps its own gate, and
the two are no longer nested, because they answer different questions. Cancel asks "can this
registration still be withdrawn"; erase asks "may this person remove a person's data at all"
(BR-REQ-037-06). Nesting them made the second a special case of the first, which it never was.

*The two refusals now name the path.* "Nu se poate șterge: {count} înscrieri reale" used to end
"arhivează evenimentul" and stop — advice for a club with a real field of runners, addressed to
somebody looking at three rows he had typed himself. Both messages now name the way through:
open the registrations, erase each one with a reason, then delete the event. A refusal that does
not say what would work is a dead end, and the owner walked into it twice.

**Rejected.** *Letting the event delete take its registrations with it.* §176 already sweeps
`kind = TEST` rows, which is safe because a test registration is not a person. A real one is,
and erasing it is a decision with an audit row and a reason attached — it does not belong
underneath a button labelled "delete the event".

**Consequences.** `registrations/[id]/page.tsx` has two sections where it had one nested pair.
The cancel help text sits with cancel rather than after both.

Baseline `BR-V1.38-2026-09-18`.

## 180. Decided — a race number is a picture, and the picture is the same everywhere (2026-09-20)

**Context.** "Ar trebui să văd BID-ul ca și poză! BID-urile sunt super importante!", then "trebuie
să pot descărca BID-ul!", then "trebe să pot descărca toate BID-urile pentru a le printa!", and
"folosește termenul «Număr de concurs (BID)»".

**Decision.** *One module decides what a bib looks like; two renderers draw it.* `bib-design.ts`
holds the band colour and the footer line and imports nothing but the palette — no `node:`
builtin, no pdfkit, no React — because `bibs-pdf.ts` draws A4 with pdfkit and `bib-image.tsx`
draws 900×600 with `next/og`, and the picture is the club's preview of the paper. They must
agree; a shared constant is how, and it is pure for the same reason `media/limits.ts` is (§178).

*Three ways out, one route.* The event's whole sheet, one participant's own page, and the picture
— the same handler, the same design, authorized the same way. A volunteer printing a replacement
at the desk and an Administrator printing eighty the night before are the same act at different
counts.

*The term is "Număr de concurs (BID)" wherever the club reads it*, because that is what the club
says out loud on race morning.

**Consequences.** `bibs.ts`, `csv.ts` and `workbook.ts` follow the same wording. Tests:
`bib-design.test.ts` (the fallback colour, a malformed hex), `bib-image.test.ts`,
`bibs-pdf.test.ts`, `bibs.test.ts`.

Baseline `BR-V1.38-2026-09-18`.

## 181. Decided — an approved legal version is withdrawn, never deleted (2026-09-20)

**Context.** "Trebuie să pot șterge documente! Trebuie să le refac cu placeholders!"

**Decision.** *Almost yes.* §46 and `AGENTS.md` §12.5 say an approved version is never deleted,
and underneath the principle sits arithmetic that makes it load-bearing:
`registrations.privacy_notice_version` is a plain integer with no foreign key, and
`createDraftVersion` takes `max(version) + 1`. Delete version 4 and the next draft is version 4
again, with different words — and every registration that recorded "privacy notice 4" becomes a
consent to text nobody was ever shown, with nothing in the database able to notice.

So: **withdrawal.** The row, the number and the words stay; what goes is the offering. A withdrawn
version is not resolved as current, not offered to the event editor, not counted as "this key
already has approved text", and not on the club's list unless the club asks. What withdrawal can
never touch is a version something relied on, or the text the site is serving right now —
`assertWithdrawable` is the whole of that rule, and it is called twice: once outside the
transaction so the screen names the actual obstacle, once inside it so the decision is taken on
rows nothing can have changed underneath. Two calls of the same function, never a cheap check and
a thorough one, because a guard that differs between them is a guard that can be talked past.

*A draft is still deleted outright.* Nothing ever relied on it.

**Consequences.** Migration `0051_legal_withdrawal` adds `withdrawn_at` and
`withdrawn_by_staff_user_id` — expand-only. Test:
`tests/integration/legal/withdrawal.test.ts`.

Baseline `BR-V1.38-2026-09-18`.

## 182. Decided — a select that is centred in both places MUI renders it (2026-09-20)

**Context.** "Aceste inputuri sunt super descentrate!!", of the sex and citizenship fields, after
§171 put a mark before each option's words.

**Decision.** *Lay the row out twice, deliberately.* The cause is MUI's own mechanism, not a stray
margin: a `Select` shows the chosen option by reusing the matching `MenuItem`'s **children** —
`SelectInput.js` computes `displaySingle = child.props.children` — and the item's `sx` is not
among them. A row laid out only on the `MenuItem` is laid out nowhere in the closed field, where
the glyph falls back to an inline box on the text's baseline, about five pixels below the middle
of a 56-pixel field. A flag was worse: `Flag` renders `display: block` and took a line of its
own. So `shared/ui/select-option.ts` lays the row out on the item *and* through the Select's own
slot class.

*A picture written into the short description shows on the card.* The cards rendered `excerpt`,
the plain-text shadow of the document, which drops exactly what the owner had put there.

**Consequences.** `select-option.ts` is shared by the two fields that have marks. Tests:
`select-options.test.ts`, `card-excerpt.test.ts`, `registration-panel.test.ts`.

Baseline `BR-V1.38-2026-09-18`.

## 183. Decided — the bucket's pictures are a tab, not a grey line of text (2026-09-20)

**Context.** "I should be able to see and manage the pictures stored in Cloudflare as well." The
list existed. It was reachable through one grey line under the albums' intro paragraph, which is
where a link goes to be missed.

**Decision.** *Two buttons at the top of both pages*, the current one filled — albums, and every
picture the bucket holds. A Server Component with no pathname lookup: `AdminTabs` is a client
island because a layout cannot know which page it wraps, but there are two pages here and each
knows which it is. No icons: an icon element passed from a Server Component to a client one is the
defect `shared/ui/action-icons.ts` documents, and a two-word label needs no glyph.

*Each row carries the absolute address as well as the stored one.* A body stores a path when the
bucket is this app, because a body outlives a hostname (§8, BR-REQ-101-02) — and somebody pasting
a picture into a newsletter needs the whole address. *The total is summed from the rows the page
already read*, never asked of the database again, so the figure at the top and the rows under it
cannot disagree.

Baseline `BR-V1.38-2026-09-18`.

## 184. Decided — the bib is visible where the bib is handed over (2026-09-20)

**Context.** "Numerele de concurs sunt frumoase, dar trebuie să le văd și din zona de înscrieri și
din ziua cursei."

**Decision.** *The desk shows the picture, folded.* A volunteer holding an envelope checks it
against the screen; the desk's own job is the large digits and the buttons, so the picture sits
behind a summary and is fetched only when the fold is opened — `<details>` does not load what it
does not render, which matters on a phone at a start line.

*Every desk role may ask for one participant's picture.* The preview route was Administrator-only,
like the sheet. It is now `canWorkTheDesk`, and the sheet is not: the picture carries a name and
a number, which is exactly what `AGENTS.md` §15.11 already says every staff role sees at the
desk. One registration at a time, by id, on the event it belongs to — this is not the list, and
two hundred single requests is not the export.

**Rejected.** *Putting the printable sheet at the desk too.* A volunteer needs the one envelope in
front of them; the whole field is the club's print run, and it carries every name at once.

Baseline `BR-V1.38-2026-09-18`.

## 185. Decided — the anti-bot check is rendered explicitly, and the guardian is a tick (2026-09-20)

**Context.** Two screenshots an hour apart, the registration form and the contact form, both
showing "Verificarea anti-bot nu a reușit. Bifează din nou căsuța «Nu sunt robot»" printed above
**nothing to tick**. "Plus faza asta cu robotul man!!! implementează corect!!"

**Decision.** *Turnstile renders explicitly, from its own client island, and resets on every
attempt.* The implicit mode — `<div class="cf-turnstile">` in the server's markup and `api.js`
loaded beside it — works exactly once. `api.js` scans the document when it loads and never
again, and the token it produces is single use. So the first thing that goes wrong with a
submission takes the widget with it: the server re-renders the form, React reuses the same empty
div, no script load happens, no challenge is drawn, and every further attempt fails on a missing
token whatever else the person fixes. The instruction to tick the box again was, by then, an
instruction to tick nothing.

`TurnstileWidget` injects `api.js?render=explicit` once per document, draws the widget into its
own element when the script is ready, and calls `reset()` whenever `attempt` changes — the
server passes its render time, a new value on every response. Thirty lines of client island,
which §1.5 asks a client island to justify: what is being fixed is what happens to the DOM
*after* the server has answered, and nothing on the server can reach that.

*The guardian is a tick, not a fold.* "Mă disperă faza cu tutorele! Aparent dacă expandez acel
câmp deja trebe să completez!!! Vreau să fie o bifă acolo man." He was right about the shape even
though the field was never required by the browser: a fold asks "is there more here", while the
actual question — "is the runner under eighteen" — has an answer, and the answer decides whether
anything under it applies. The tick reveals the name field through `:has()`, with no client
island and with JavaScript switched off.

*The rule does not move.* The server still requires a guardian when the birth date gives under
eighteen, whatever the box says: a legal requirement cannot be untickable. The tick is checked for
them when a rejection names the field, which is how somebody who is a minor and did not tick is
shown the box they have to fill.

Baseline `BR-V1.38-2026-09-18`.

## 186. Decided — a participant who opted out is counted, never named (2026-09-20)

**Context.** "Trebuie să văd care participanți sunt vizibili pe site și care nu! Și cumva să îi
afișez cenzurați… gen «participanți surpriză»… sau «participanți anonimi»."

**Decision.** *The public list gains a row per opted-out runner, reading "Participant anonim".*
The list had been dropping them silently, so an event with forty-two confirmed runners showed
thirty-nine names under a heading that said forty-two — a page contradicting itself, and the
count is what most readers came for.

*It is a count, never a row.* `countAnonymousStartListEntries` selects a number and nothing
else: no name, no club, no identifier, so there is nothing to leak and
`tests/privacy/public-surface.test.ts` keeps its grip on `listPublicStartList` exactly as it
was. One row each rather than "and 3 others", because "a person is coming and asked not to be
named" is true of each of them individually.

*The backoffice marks the ones who are not on the list.* Only those: on an event that publishes a
list most rows are on it, and a chip on every row is a chip nobody reads. The mark is shown
whatever the event's own visibility, because it records what the person asked for, not what the
club has switched on today.

**Rejected.** *Initials, or a censored name.* "M. P." on a start list of a hundred is a name to
somebody who knows the field, and §32 puts the participant's refusal ahead of the page's
symmetry. The platform holds their name; the page does not have to.

Baseline `BR-V1.38-2026-09-18`.

## 187. Decided — one description slot, under the title, on the page and in its preview (2026-09-20)

**Context.** The owner, straight out of the editor he had just asked for: "pagina de edit event și
main e diferită… rezumatul apare înainte descrierii full! Fi consistent man!"

Four readers went over every surface that renders either field — the page, the preview, the
listing and its hero, the cards, the Open Graph description, the JSON-LD, the calendar feed, the
emails — and three reviewers were asked to refute what they concluded. All three refuted the first
proposal, on file and line; what survived is smaller than what was proposed and is recorded here.
Three separate things were true at once, and one edit answers all three.

**1. The order contradicted the editor.** §170 put *Conținut* first and *Rezumat* under it, because
asking somebody to summarise what they have not written yet is what left summaries empty — and an
empty summary is what refuses publication. The page kept the summary's slot under the title and
rendered the long description eighty lines and six rendered blocks lower: after the divider, the
facts, the registration call to action, the interest box, the five-step panel, the share and
calendar row and the street address.

**2. The one description moved half a page depending on which field was filled.** With only a
summary, the page's prose sat under the title. With a long description, it sat below the address.
Same editorial role, two positions — and the more an organizer wrote, the further down the reader
had to scroll to find any prose at all.

**3. A long description that was only a picture or only a film was silently dropped.** The page
guarded *both* of its slots with `isRichTextEmpty`, which is defined over the plain text;
`EventExcerpt` has always guarded itself with `hasRichTextContent`, which counts a picture. So a
picture-only *Conținut* was "empty": it did not render, and the *Rezumat* rendered in its place.
That is the owner's sentence exactly — the summary where the full description should have been.

**Decision.** *One slot, directly under the title, shared by one component.* `EventDescription`
renders it and the page and the preview both call it, because the preview is the only way to read
a draft before publication and it had been showing the body five blocks higher than the live page
did — an organizer checked one layout and shipped another.

*The rule takes two predicates, and that is the point.* `planEventDescription` is pure and
tested: `hasRichTextContent` decides whether the long description renders at all,
`isRichTextEmpty` decides whether it contributed any **words**, and the summary stands in when it
did not. So a picture-only *Conținut* now renders *under* its summary rather than instead of it —
the page keeps its prose and the organizer keeps his picture. Reading one question with one
predicate is what produced defect 3, so the pair lives in a function with a test rather than in
two JSX guards eighty lines apart.

*The editor's order stands; the page moves to meet it.* §170 is one day old and has a reason
behind it. The page's order was never decided — it is where the body block happened to sit when
§71 added it. Reversing the editor would restore the empty-summary trap §170 removed, and it would
not even answer the complaint, because the *Conținut* would still render below the address.

**Rejected.** *Changing the calendar entry.* The `.ics` carries the summary and then the long
description's first six hundred characters, which is the owner's sentence in a file the page's own
button hands him — but §159 decided that deliberately, and the change breaks three golden-string
tests whose fixtures the first proposal had not read. It is a separate decision with a separate
cost, and it is named here so it is not lost rather than folded in quietly.

*Changing the structured data to prefer `seoDescription`.* §156 says the metadata, the Open Graph
card, the structured data and the emails keep the short one. They do.

*Using `hasRichTextContent` for both questions.* That is what loses the summary: an event with a
sentence in *Rezumat* and a picture in *Conținut* would render the picture and no words at all,
while its own card, hero, search result and share preview all carried the sentence.

**Consequences.** `AGENTS.md` §11.3 said the full description is "rendered on the event page
under the short description" — stale since §156 and wrong after this; amended. `SPECS.md`
BR-REQ-011-01 criterion 11 now states the position and the words-not-content distinction. The
long description now pushes the facts and the registration button down the page: on a phone a
long one puts "Înscrie-te" below the prose. That is the one visible trade, and it is the order the
editor implies. Publication is untouched — `REQUIRED_PUBLIC_TRANSLATION_FIELDS` is still title,
slug and excerpt, and `bodyJson` is still optional.

Test: `tests/unit/events/event-description.test.ts` — including the property that there is no
document for which the page renders neither field.

Baseline `BR-V1.38-2026-09-18`.

## 188. Decided — the guardian's name appears when the birth date says minor (2026-09-20)

**Context.** §185 had turned a fold into a tick, because the fold read as a demand. The owner,
the same evening: "aș vrea ca asta cu «Participantul are sub 18 ani» să apară doar când data
nașterii indică faptul că e minor… sau să fie ceva bifă doar atunci."

**Decision.** *No tick. The birth date is the answer.* The form already asks for it, and asking
the same question twice only invites the two answers to disagree — with the server then refusing
an unticked minor over a field nobody had been shown. `GuardianForMinor` subscribes to the
birth-date input and opens when it gives under eighteen.

*The rule does not move.* The server still requires a guardian when the birth date says so,
whatever the browser drew, and `forceOpen` is that verdict coming back: a rejection naming the
field opens the block whatever the date box now holds, so an error never points at something
invisible.

*Without JavaScript the field is simply always there.* A `<noscript>` rule forces it open. The
alternative — hidden and unreachable — would lock out exactly the person who has to fill it, and
`AGENTS.md` §1.5 says this form works with JavaScript off.

*It subscribes to the input rather than owning it.* `useSyncExternalStore`, not an effect
writing state: the date field is a Server Component's MUI `TextField` carrying native validation
(`min`, `max`, `required`), and lifting it into the island would trade all of that for
hand-written validation on the one form that has to work everywhere.

**Consequences.** `isMinorOn` moved to `registrations/domain/age.ts`, which imports nothing, so
the browser gets four lines of date arithmetic instead of the form's whole Zod schema — the
reasoning of `media/limits.ts` in §178. `fields.ts` re-exports it, so nothing else moved.

Baseline `BR-V1.38-2026-09-18`.

## 189. Decided — three small things the owner asked for, and why each is where it is (2026-09-20)

**The claim is about a group, and it says where its line is.** "Sunt membru al echipei Brașov
Runners" became "…al **grupului**…", with a "?" beside it reading "Am fost la cel puțin 3 alergări
de grup în ultimul an." The club is a group somebody runs with, not a squad somebody is selected
for; and the claim decides nothing on its own (§48) but the club reads it, so it needs a
definition. A definition printed under every tick would lengthen the form whose length is the
thing people complain about, so it is a tooltip: `shared/ui/Hint`, which opens on hover, on
focus and — `enterTouchDelay={0}` — on a tap, because a `title` attribute does none of those on
a phone. The icon is imported inside the island; a Server Component passing `<Icon />` as a prop
is the defect `CheckboxField` documents.

**The whole field's numbers download from the page that shows the whole field.** The link already
existed, several folds down in the event's editor, and the owner — standing on the bib page,
looking at every number he wanted to print — asked for it again: "vreau să pot exporta toate
BID-urile!". A verb belongs where its object is. A plain link to the same route, so it works with
JavaScript off.

**The race number is bold, and the email's header is white.** "În mail, numărul de concurs trebuie
făcut bold, e super important!" — it is the one line a runner reads on a phone at the desk. The
card's paragraphs are escaped plain strings, so bold arrives as `**like this**` converted
**after** escaping: the marker can therefore only ever wrap text this codebase wrote, and a
participant whose name contains asterisks or angle brackets gets asterisks and angle brackets.
The plain-text half strips the markers rather than printing them.

"Nu îmi place headerul ăsta albastru, nu se potrivește cu logo-ul BVR." He is right about what it
looked like: the lockup already contains a blue field, so a blue band around a blue field reads as
a sticker on a wall rather than as a letterhead. The band is white now, with the lockup in its own
colours — which is what the site's own header does — and `scripts/brand-assets.mjs` grows the
matching `logo-email.png`, without alpha, because several mail clients composite a transparent
PNG onto whatever they please.

Tests: `tests/unit/notifications/emphasis.test.ts`, including the assertion that nothing a
participant typed can ask for bold.

Baseline `BR-V1.38-2026-09-18`.

## 191. Decided — an event can be erased with everyone on it, once its title is typed (2026-09-20)

**Context.** Three times, an hour apart: "tot nu pot sterge evenimente!" The club's own data
controller had an archived event carrying two registrations he had entered himself, and no way to
remove either. "It cannot be deleted" is not an answer a controller can be given about his own
records.

**Decision.** *A second verb, not the same one made permissive.* `deleteEvent` still refuses an
event with registrations against it; `hardDeleteEvent` takes the event **and** everyone on it,
and it is a different button in a different place with a different colour.

*Administrator, not Superadministrator.* `canHardDeleteEvent` is `canDeleteEvent &&
canManageRegistrations`. The hierarchy's line is personal data and that line is ADMIN — an
Administrator may already erase each of these rows one at a time, so the gate answers "may this
person erase participants", which is the question actually being asked.

*The confirmation is the event's exact title, typed, plus a reason.* Checked on the server, no
`window.confirm`, and the screen works with JavaScript off. A dialog with a button is answered
yes by reflex; a transcription cannot be.

*Every registration leaves through the path a single erasure takes.* `eraseRegistration` is
factored out of `deleteRegistrationByStaff` rather than copied — the place released through the
allocator, the declaration acceptance with the row, one audit row each naming who and why and
never who was erased — plus one audit row for the event carrying its title, its date and the
counts, written first, all in one transaction. Two implementations of "remove a person from the
system" is how one of them forgets the audit row.

*The screen says what will be destroyed before anything is pressed*: how many registrations, how
many confirmed, and how many are real people rather than test rows.

**Rejected.** *A bulk hard delete over ticked rows.* That is how somebody loses a season.

Tests: `tests/integration/events/hard-delete.test.ts` (11).

## 192. Decided — erase from the registrations list, with the name typed (2026-09-20)

**Context.** "Vreau să pot șterge și participanții!", also three times. Erasing existed only on a
registration's own page, so clearing eighty test rows meant eighty round trips through a list that
re-sorts underneath you.

**Decision.** Erase is the last verb on the row menu, below a rule, in the error colour,
Administrator-only. *It is not a one-press verb*: it opens a panel at the top of the list asking
for a reason and for that row's name, typed. In a list where the row you meant and the row above
it are one line apart, a confirm dialog is answered by reflex — and the reflex is how the wrong
person gets erased.

*One erase path, not two.* `deleteRegistrationByStaff` does exactly what it did and gains one
optional argument, the typed name, checked against the row the deletion is already built on rather
than against a second fetch. The panel is a link, a server-rendered form and a redirect, so it
behaves the same with JavaScript and without; a `<noscript>` link covers the only part that
needs JavaScript, which is opening the menu.

## 193. Decided — a picture the text flows around, reversing "never floated" (2026-09-20)

**Context.** "Vreau să pot seta imaginile ca și «inline» ca să pot scrie text în stânga sau
dreapta lor! Adică vreau un rich text editor mai smart!" §73 decided the opposite in as many
words: four widths, "and a picture is a block in the flow, **never floated**, so two pictures are
never side by side."

**Decision.** The image node gains `align`: `block` (the default), `left`, `right` — a closed
set of three literals in the allowlist, exactly as `widthPercent` is a closed set of four
numbers, so the attribute names a rendering the renderer knows rather than a CSS value somebody
typed. Absent means `block`, so every stored document renders unchanged and no migration is
needed.

Three fences keep the reversal from becoming the layout tool §72 refused:

1. **A phone never floats.** The float is a media query from `sm` up. 320 pixels is a hard target
   here, and a third of 320 beside a paragraph is two words a line.
2. **Two pictures are never side by side.** Every figure in a body that floats anything also
   clears, so a second picture drops below the first instead of forming a row. §73's invariant
   survives its own reversal.
3. **The float ends with the body.** One clearing element after the last block, so a float never
   reaches the registration panel or the programme — and a body that floats nothing emits no
   clearing rules at all, not rules that happen to be no-ops.

*What is left of "never floated" is a habit.* §73's argument was about narrow columns, which is
now a breakpoint rather than a ban on everybody; its consequence was two pictures in a row, which
is now `clear` rather than never floating at all.

*The listing card puts every picture back in the flow* — a card has one column and a cropped,
capped picture, so a float there is two words a line, and a float at the end of an excerpt would
reach into the date beneath it.

Tests: `tests/unit/content/rich-text-image-layout.test.ts`, `rich-text.test.ts`,
`card-excerpt.test.ts`.

Baseline `BR-V1.38-2026-09-18`.

## 194. Decided — a guess about a person is a question, not a silent refusal (2026-09-20)

**Context.** Somebody the owner had asked to test QA registered, saw "Ți-am trimis un email cu un
link de confirmare", and nothing arrived. He did not appear in the registrations list either. The
owner reported it as an email problem — "Dani nu a primit mail", and then, reasonably, "so Yahoo
doesn't receive registrations but Gmail does".

It was not an email problem. A query against QA's `email_outbox` returned **zero rows** for his
address: nothing had ever been queued for him, because no registration had ever been created. The
only path in the codebase that produces exactly that — the confirmation page, and nothing written
anywhere — is `service.ts`'s answer to a suspected bot: `if (origin.source === "PUBLIC" &&
looksLikeSpam(input, now)) return { ok: true };`

He has autofill. The form went back in under three seconds. He was classified as a script and
discarded, silently, and the club was told he had been sent a link.

**What made it expensive** was not the rule but its silence: no registration, no outbox row, no
log line, nothing on any screen. Which of the two checks had fired could not be established from
the data at all — it had to be reasoned out of the source by eliminating every other path.

**Decision.** *The two defences answer separately, because they are not equally certain.*

- **The trap keeps its silence.** A hidden field is filled by a machine and by nothing else, so a
  distinct error would only tell a script what to stop doing (BR-REQ-031-01 criterion 3). It now
  writes a log line naming the event and the verdict — never the address.
- **The timing check asks again.** Under three seconds, or with no render time at all, is a
  *guess* about a person — one that is wrong about anybody who types quickly, uses autofill, or
  comes back to a cached page. The submission is refused with a field marker rather than
  swallowed, the form comes back whole with every answer in it (§142), and one sentence says to
  press again. A script that posts instantly gets the same sentence and still has to wait, which
  is the entire benefit a timing check ever offered. What it no longer buys is a vanished
  participant.

**Rejected.** *Loading screens*, which the owner suggested and which would change nothing: the
three seconds are measured from when the page rendered to when it was posted, so a spinner after
the press is on the wrong side of the measurement.

*Dropping the timing check.* It is cheap and it works on the submissions it was written for; what
was wrong was the penalty, not the test.

*Recording the dropped submission's address so the club could recover the person.* That would
store personal data from a submission the platform decided not to accept. The log line carries the
event and the verdict, and the participant is now told to press again, which recovers them without
keeping anything.

**Consequences.** `classifySubmission` replaces `looksLikeSpam` at the registration form;
`looksLikeSpam` stays as a wrapper for the contact and interest forms (§146, §149), which keep
the older single answer. `AGENTS.md` §19.4's "answered exactly like success" now describes the
trap alone.

Tests: `tests/unit/registrations/submission-verdict.test.ts` (6, including the boundary at
exactly three seconds), and `lifecycle.test.ts`, whose single test became two — the trap still
answers like success and creates nothing; the quick submission is refused and creates nothing.

Baseline `BR-V1.38-2026-09-18`.

## 195. Decided — the race's conditions are opened before they can be agreed to (2026-09-20)

**Context.** The owner: "oamenii trebuie să deschidă condițiile concursului într-un pop-up, să dea
scroll până jos și să confirme, **dar fă safe!** Adică unii oameni nu sunt așa tech-savvy
(afișează «dă click aici») mai întâi, ca să poată bifa că sunt de acord."

Two requirements in one sentence, and the second is the harder one. A gate that keeps somebody
out of a race because a script did not load is a worse failure than the one it prevents.

**Decision.** *Before anything is read there is a button, not a box.* A checkbox beside a link
asks somebody to notice the link, decide to follow it, come back, and then tick — four steps,
three of them skippable, and every one invisible to a person who does not already know how forms
work. "Citește condițiile concursului" is one step with one meaning. The box appears in its
place, already ticked, once the text has been read to its end.

*The gate is an enhancement, never a requirement.* `ReadAndAgree` renders the **plain, tickable
checkbox** on the server and on the first client render, and takes over only after React has
hydrated. No JavaScript, a script that failed to load, a browser the dialog does not suit — the
entrant gets an ordinary required checkbox and an ordinary link, and registers. This is the whole
of "fă safe", and it is the reason the island uses `useSyncExternalStore` rather than an effect:
the server's own markup has to be the usable one.

*The scroll rule is a pure function with its own test* (`domain/read-gate.ts`), because the
interesting case is not scrolling to the end — it is the two ways the measurement can be wrong.
A short set of rules on a tall screen has nothing to scroll, so the button opens at once; a gate
waiting for a gesture that cannot happen is a gate nobody passes. And the last pixel is forgiven
by eight, because zoom, device pixel ratio and an overlay scrollbar each land
`scrollTop + clientHeight` a little short of `scrollHeight` while the reader is looking at the
final line.

*What is recorded is a timestamp, and it claims only what it can.* `rules_acknowledged_at`
(migration 0052, expand-only) says the person was shown the text and said they had read it, at
that moment. Scrolling is a measurement of a browser and is not evidence of reading; the column
does not pretend otherwise. It is the same thing a paper form records, and it is what lets the
club answer "was this person shown the conditions" with a row rather than a recollection.

*Required on the public path only.* Like §171's fitness statement, and for the same reason: at
the desk the participant signs a paper declaration that already says they have read the rules
(§67, `AGENTS.md` §15.11), and a staff member does not make the statement on somebody's behalf.

*An event with no rules of its own gets the plain checkbox and a link to the club's terms.* There
is nothing to open, and a panel containing an empty document would be worse than a link.

**Rejected.** *Enforcing the reading server-side.* It cannot be done — nothing in an HTTP request
distinguishes a page that was read from one that was scrolled past — and a check that cannot be
performed should not be implied by the record it writes.

*Disabling the checkbox until the panel is closed.* A disabled input posts nothing, so a browser
that never ran the script would post nothing either, and the refusal would be silent. The input
exists from the start, unticked: the browser's own validation refuses the form and names the
control, with no JavaScript involved in producing the refusal.

**Consequences.** Every fixture that builds a public submission learnt the new tick — the same
sweep §171 needed, fifteen test files and the synthetic-registration generator.
`form-errors.ts` names it, so a rejection can point at it, and both catalogues carry the name.

Tests: `tests/unit/registrations/read-gate.test.ts` (6),
`tests/integration/registrations/rules-acknowledgement.test.ts` (3).

**Also, from the same sitting:** the calendar feed's address on the listing is a link now, not
only a string to copy ("ăsta trebuia să fie link"). It is still selected whole by one click for
the applications that want it pasted, and the anchor is `webcal://` — the same address handed to
the operating system as a subscription rather than as a file downloaded once, which is the
difference between a calendar that keeps up and a snapshot of today.

Baseline `BR-V1.38-2026-09-18`.

## 196. Decided — tables in the editor, and the one dependency they cost (2026-09-20)

**Context.** "Ar fi fain să pot face tabele în editor!", twice. What a running club puts in one is
a schedule of waves, a price list, a table of cut-offs — a few columns of short facts that a
paragraph cannot hold straight.

**Decision.** *One package, and it is the platform's own.* `@tiptap/extension-table` at the
version already installed for everything else, pinned exact. The standing instruction is to prefer
nothing over a dependency; the alternative here is a table editor written by hand against
ProseMirror's transforms, which is a worse trade by a wide margin. It has **no dependencies of its
own** — its peers, `@tiptap/core` and `@tiptap/pm`, are already here — and its `./kit` export
carries the row, the cell and the header, so the count really is one.

*The allowlist is the smallest table that carries those facts.* A cell holds a paragraph or a
list, which is what a fact with a note under it looks like. **No table inside a table**: nesting is
where a text editor becomes a spreadsheet, and where a phone runs out of width. `colspan` and
`rowspan` are kept and bounded, because Tiptap emits them for a merged header and a table that
lost its merges on the way through the allowlist would be silently rearranged. `colwidth` is
dropped: it is a pixel width chosen on somebody's laptop, and the hard target here is a 320-pixel
column — so the editor's resize handles are switched off rather than left to produce a value that
is thrown away.

*The table keeps its shape and the wrapper scrolls.* A table cannot reflow — four columns of times
and distances are four columns whatever the screen — so one element scrolls sideways inside a page
that does not, which is the single arrangement a phone handles without the whole layout sliding
under a thumb. The scrolling box is focusable, because a region that scrolls and cannot be reached
from a keyboard is unreadable to anybody not using a pointer, and browsers do not make it focusable
on their own.

*Header cells are `<th scope>`* — "col" on the first row, "row" elsewhere — so a screen reader
announces "Ora de start, 10:00" rather than "10:00".

*In plain text a table becomes lines, cells separated by a tab.* The excerpt, the calendar entry
and the search index are single-column text; a tab is what a spreadsheet takes if somebody pastes
the line, and it is invisible where the line is only being counted for words.

*The toolbar shows the table verbs only inside a table.* One button inserts one; add and delete
row and column appear when the caret is in one. Four dead controls beside somebody writing a
paragraph is the opposite of a toolbar with words on it rather than icons.

**Rejected.** *Column resizing.* See `colwidth` above.

*Writing the extension by hand to avoid the dependency.* Table editing is selection and transform
work — merging, splitting, navigating with the keyboard — and a hand-rolled version would be a
worse table and a larger thing to keep.

Tests: `tests/unit/content/rich-text-table.test.ts` (9), including the refusals — a nested
table, an empty row, a span that is not a small positive number — and the assertion that a body
written before tables existed parses to exactly itself.

Baseline `BR-V1.38-2026-09-18`.

## 197. Decided — the two legal texts open in a tab of their own (2026-09-20)

**Context.** "Termenii de concurs și nota de confidențialitate trebe să se deschidă în ceva pop-up
sau new tab (iconiță diferită pt new tab)."

**Decision.** *A new tab, marked as one.* Both links sit in the middle of a registration form
somebody has half filled in, and a privacy notice is a long text — the platform's own runs to a
dozen sections. A reader who follows it in the same tab and presses Back is relying on the browser
to restore a form it never stored. The race's **conditions** do open in a panel (§195), and that is
right *there*: they are short, they are about this race, and reading them is a step in the flow.
These two are reference texts, read out of order and sometimes at length, so they get a place of
their own and the form stays exactly as it was left.

*The icon is the honest part.* A link that opens a new tab without saying so is a small trap:
somebody presses Back, finds the page unchanged, and presses again. The accessible name carries
the same fact in words — an `aria-label`, not a `title`, because a title attribute is invisible
on a touch screen, which is most of this form's traffic. `rel="noreferrer"` keeps the new tab
from reaching back through `window.opener`.

## 198. Decided — a telephone number is judged as it is typed, by the server's own rule (2026-09-20)

**Context.** "Faptul că telefonul nu e valid trebuie să fie vizibil instant."

**Decision.** `PhoneField` becomes a client island that runs `composePhone` — *the function the
server validates with* — on every keystroke. It was a Server Component with a `pattern`
attribute, so the browser said nothing until submission, and the pattern is not the real rule
anyway: `composePhone` strips the separators people type, handles a `00` prefix and a repeated
country code, drops a trunk zero everywhere except Italy, and then insists on four to fourteen
digits. A pattern loose enough to admit all of that cannot tell somebody their number is too short.

*One rule, imported, never a second one approximated in a regular expression* — which is how the
two drift and a form starts refusing what the server accepts.

*Before hydration and without JavaScript, nothing changes.* The same markup with the same
`pattern`, `minLength` and `required`; the live verdict is consulted only once hydrated, so the
server renders what it always rendered and nothing shifts under somebody already typing.

*The message waits until the field is left, or until six digits have been typed.* Turning a box
red on the first digit of a number that is obviously unfinished is scolding somebody for typing.

## 199. Decided — filling the form again always sends something to the address (2026-09-20)

**Context.** "De asemenea trebuie să verificăm dacă acel email a mai fost folosit pt înscrieri."

**Decision.** *Not on the screen.* Telling a visitor "this address is already registered" turns
the public form into a way to ask who is entered, which is the oracle `AGENTS.md` §19.4 exists to
refuse. The screen's answer stays the one everybody gets.

*In the inbox, which only its owner reads* — and now for every state, not one. A second submission
used to re-send the verification link **only** while the first registration was still waiting for
it; everybody past that point got "we have sent you a confirmation link" and no message at all.
Somebody who confirmed a month ago, forgot, and filled the form again saw exactly what a failure
looks like — and so did every re-entered test registration, which is what the owner kept hitting.

It now sends whatever the state can offer, through the same `deriveAllowedResendMessageType` the
backoffice's "send it again" uses: the verification link, the declaration, the waiting-list offer,
or the confirmation with its QR. A state with nothing to resend still sends nothing. The throttle
in front of the form is what keeps this from being a mailer.

Tests: `tests/integration/registrations/resubmitted.test.ts` (3).

## 200. Decided — a column whose values are shorthand explains itself (2026-09-20)

**Context.** Of "3/6 · Loc rezervat" in the registrations list: "de asemenea trebuie să fie clar
un pic ce sunt acești pași 3/6".

**Decision.** `AdminColumn` takes an optional `hint`, shown behind a "?" beside the heading
(`shared/ui/Hint`, §189). A heading cannot say what six steps are, and a legend above the table
is a legend nobody reads twice — where the reader's question is, the answer is one press away and
out of the way otherwise.

Baseline `BR-V1.38-2026-09-18`.

## 201. Decided — crossing into public view is the Administrator's (2026-09-20)

**Context.** The owner, naming his two colleagues: "Organizatorul trebuie să primească aprobare de
la Administrator pt orice. Amalia e Administrator, Dani e Organizator dar poate face prostii, deci
trebuie manageuit de Amalia."

"Pt orice" is the hard part, and the honest answer is that this codebase has no approval queue: a
change an Organizer makes takes effect when they make it. Building one — a pending revision beside
every live record, a screen where Amalia reads the difference, an apply-on-approve path, a story
for two pending revisions of the same page — is a feature, not a flag.

**Decision.** *The line that is available today, and it is a true one: below Administrator,
nothing crosses into or out of public view.* Four rows of `TRANSITIONS` move to `ADMIN` —
IN_REVIEW → PUBLISHED, PUBLISHED → DRAFT, PUBLISHED → ARCHIVED — and everything that never touches
the public stays with the Organizer: writing, submitting, returning a submission to its author,
archiving a draft that was never live.

That is the smallest possible change to the table, and the table is the right place: its
interesting property has always been which moves are *absent*, and this adds "absent below
Administrator" to the three that matter.

**What was deliberately not done, and why it is written here rather than decided here.** Editing
the **words** of an already-published page is the remaining way something reaches the public
without the Administrator. Closing it is one line —
`if (isLiveContent(status)) return atLeast(role, "ADMIN")` in `canEditTranslation`. It was
written, tested, and then taken out again, because it reverses BR-REQ-051-01 criterion 3 in as
many words: "a copywriter edits live text with the acknowledgement; a volunteer never" (§103). The
club asked for the *Organizer* to be managed by the Administrator, and the Organizer sits **above**
the copywriter in the hierarchy, so the restriction cannot be applied to one without the other. A
Redactor losing the ability to fix a typo on a live page is a decision about how the club works.
It waits for the club.

What stands in the meantime is criterion 4's acknowledgement, which the server checks rather than
merely displaying.

**Rejected.** *An approval queue over every write.* It is the literal reading of "pt orice" and it
is a large, separate piece of work; it is named here so that choosing it later is a decision and
not a rediscovery. Roughly: a `pending_revisions` row carrying the proposed fields and who
proposed them, a diff screen, an apply that re-runs the same validation the direct save runs, and
a rule for what happens when a pending revision is overtaken by a direct one.

*Raising `canEditEventFields` and `canCreateEvent` as well.* Neither is public until something
is published, which is now gated.

**Consequences.** Five test suites drove their whole flow with an Organizer, because publishing
was theirs; they drive it with the Administrator now, and the role boundary is asserted where it
belongs — `roles.test.ts`, from both sides, and `boundary.test.ts`. BR-REQ-051-01 criterion 2
is narrowed in `SPECS.md` and says what criterion 3 still allows.

Baseline `BR-V1.38-2026-09-18`.

## 202. Decided — a spent email link says where you are, not that you failed (2026-09-20)

**Context.** QA. A tester registered; the rows say what happened:

```
19:29:37  VERIFY_REGISTRATION_EMAIL   queued, SENT
19:36:36  that token used
19:36:39  COMPLETE_DECLARATION        queued, SENT
21:37     she opened the SAME verify link again
```

Her confirmation had worked. Two hours later the same link answered "Acest link nu mai este
valabil". She read it as failure, reported that the button did not work, and **never signed her
declaration** — whose token is still unused, because the screen had told her she had failed and
she had no reason to open the second email. The owner: "ar trebui să fie refolosibil acel link…
să fie stupid proof", and then: "trebe să știe userul că a confirmat deja".

**Decision.** *The link is not made reusable, and that refusal is half the decision.* An email
sits in an inbox for years, gets forwarded, and turns up on a phone somebody loses. A verify or
manage link that still worked would be a standing authorization to confirm or cancel somebody's
place, held by whoever ends up with the message. Single use stays (`AGENTS.md` §12.8,
BR-REQ-036-02).

*What is added is idempotence at the level of the page.* Pressing a spent link performs nothing;
it reports the registration's **current** state — read from the registration, never inferred from
the token — and names the next step.

*`ALREADY_USED`, and only that, gets the status page.* This amends `AGENTS.md` §13.2's single
generic response for exactly one refusal reason on four purposes, and the argument is structural:
that reason is reachable only by an exact match on `token_hash`, a SHA-256 of 32 random bytes,
so whoever got there holds the secret from the email and learns nothing the link in their hand
did not already say. NOT_FOUND has no state to report; PURPOSE_MISMATCH must stay
indistinguishable from it, or a link issued for one thing could be confirmed as real by aiming it
at another; EXPIRED was never used, so the work was never done; INVALIDATED is not the holder's
business.

**What review found and what was changed because of it.** Three adversarial passes; no critical
finding, and four that were fixed here:

- **The stepper told a waitlisted person they were confirmed.** `stepForSpentLink` mapped
  WAITLISTED to the last step, which carries "Înscrierea ta este confirmată. Ne vedem la start!"
  in the largest text on the page. It draws no stepper now.
- **The declaration page charged the throttle twice per request** — it reads the same token as a
  declaration link and as a waiting-list offer — and an exhausted bucket answers NOT_FOUND, which
  is not eligible for the status page. So reloading a spent link five times restored exactly the
  message this feature exists to remove. One request now pays one attempt.
- **A live token with a failed press was reported as a dead link**, with an offer to send a new
  one. The press failed because a box was unticked; the link is fine. Said where the press
  happened.
- **The event's slug could come from the other language's translation**, producing a link that
  404s. This locale's words or none.

Tests: `tests/unit/tokens/spent-link-status.test.ts`,
`tests/integration/tokens/spent-link-page.test.ts` (81 together), including that a second GET
performs nothing — no token spent, no email queued, no row changed.

## 203. Decided — an approved legal version can be deleted, and its number never comes back (2026-09-20)

**Context.** "Am zis că vreau să fac curățenie în documente și să le pot șterge, mă refer la
astea!", of five approved versions made while testing. Withdrawal (§181) keeps the row for ever,
folded away, which is not what "curățenie" means.

**Decision.** *Deletion is allowed, and the hazard that forbade it is removed at its root rather
than tolerated.* `registrations.privacy_notice_version` and its two siblings are plain integers
with no foreign key, and the next version number was `max(version) + 1` — so deleting version 4
made the next draft version 4 again, with different words, and every registration that recorded
"privacy notice 4" silently became a consent to text nobody was shown.

Migration `0053` adds `legal_document_numbering`: one retired-number floor per key, upserted
with `GREATEST` inside the delete's own transaction. `nextVersionNumber` is now the single
place a number is derived, and it reads `max(max(version), highest_retired_version) + 1`. A
draft's deletion retires nothing: its number never left the backoffice.

*The same guard as withdrawal*, extracted so the two verbs cannot come to disagree about what
"unused" means, plus the typed confirmation (`GDPR 2`) and a reason, on a page rather than a
dialog — the consequence is four sentences, the form must work with JavaScript off, and a
mistyped confirmation needs somewhere to land.

**What review found, and the guard it produced.** *For TERMS there is no dependant signal at
all.* The three counts are real for two keys and vacuous for the third: acceptances and events
only ever see the declaration, and the acknowledgement count is restricted to the privacy notice
— because **a registration records no terms version**. Every TERMS row therefore reads as unused,
including one a hundred people accepted.

So a terms version that has **ever been in force** is refused deletion. The refusal sits on the
deletion path alone, not in the shared guard, because the two verbs ask different questions:
withdrawal keeps the row, its number and its words, so nothing is lost if the counts are blind;
deletion destroys the words, and afterwards the audit row's hash is the only evidence of what the
club published — so it has to be able to show nobody relied on them, and for this key it cannot.
A terms version that never took effect was accepted by nobody and may go.

*The proper repair is a `terms_version` on the registration* — a migration and a change to what
the form records. Until it exists, this refusal is the honest answer.

Tests: `tests/integration/legal/hard-deletion.test.ts` (18), including the terms refusal, the
retired number, and that deleting a middle version leaves numbering alone.

Baseline `BR-V1.38-2026-09-18`.

## 204. Decided — the Administrator creates events (2026-09-21)

**Context.** "Administratorul crează evenimente", in the same breath as §201.

**Decision.** `canCreateEvent` moves to `ADMIN`. It had been the same power as configuring one,
on the reasoning that both decide what the club advertises — and that reasoning holds for
*configuring*, which stays with the Organizer. Creating is the act that decides there is a race
at all, and because the registration block lives on the same row, it decides whether the club
takes entries.

An Organizer opens an event the Administrator created and does everything to it: the date, the
place, the route, the capacity, the registration window, the queue, the desk. What they cannot do
is invent a race, publish one, or take a published one down (§201).

**Consequences.** Twenty test suites created their fixtures with an Organizer, because creating
was theirs. They create with the Administrator now; the files that *assert* the boundary — an
author refused, an organizer refused — keep their Organizer, and that is where the boundary is
tested.

## 205. Decided — somebody who gets no email must still be able to register (2026-09-21)

**Context.** Two people in one evening got no message. The owner: "trebuie să lăsăm oamenii să se
înscrie cu orice preț!!! Asta e scopul principal al site-ului. Dacă nu primesc mail trebuie să le
apară opțiunea de retrimite sau să ne dea mail prin formularul de contact."

**Decision.** *A second way out, beside the resend.* The resend answers the case where a message
was lost in transit. It does nothing for the cases that actually strand somebody: a spam filter
swallowing every one, a provider refusing the sending domain, or an address typed wrongly and no
longer correctable. In all three the person sits on "check your email" with no way to tell
anybody, and the club never learns they tried.

So the screen carries a link to the contact form, which reaches a human, and it carries the event
— `?about=<slug>` — so the message box opens with the sentence they would otherwise compose
while annoyed: which event, and that nothing arrived. They can delete every word of it; what it
saves is the blank page, which is where somebody gives up. The slug is matched against the club's
published events rather than printed, because anybody can type one into a URL and this text goes
into an email the club reads.

It is deliberately second and quieter than the resend — most people need the resend — and
deliberately present, because "the message never arrives" is not a rare case in a club's first
season on a new sending domain.

## 206. Decided — the address is typed twice, and the match is the form's business (2026-09-21)

**Context.** "În formularul de înscriere și de contact, pune oamenii să reintroducă mailul de
mână, fără auto-complete, și fă verificarea live ca mailurile să se potrivească."

The evidence was already in QA's outbox: three BOUNCED messages to `…@gmail.con`. One letter,
and the person is gone — the link is sent into nothing, the screen says to check the inbox, and
the club never learns. A resend does not help, because it resends to the same wrong address.

**Decision.** *Two boxes, both `autoComplete="off"`.* The point of the second is a second act of
typing, and a browser filling it from the first defeats the exercise. **Paste is left alone**: a
password manager holds the address somebody uses everywhere, and refusing a paste pushes them to
type from memory, which is worse than pasting the right thing.

*The comparison is the canonicalizer's, not `===`.* `canonicalizeEmail` is what the platform
uses to decide whether two addresses are the same person (`AGENTS.md` §10.4), so
`Ana@Gmail.com` matches `ana@gmail.com` — the same row once stored — while two Gmail spellings
differing in dots do not, because the club treats those as two people (§74). Comparing raw
strings would refuse the first pair and accept the second: wrong in both directions.

*The check lives in the action, not in the submission schema.* This is the part worth recording,
because it was built the other way first. Putting `emailConfirm` in
`registrationSubmissionSchema` made every caller of the service carry a field only one screen
has — the desk, the telephone entry, the synthetic queue and forty fixtures — for a check none of
them can fail, and it turned a form concern into a domain one. `assertEmailTypedTwice` runs in
the public action, where the two boxes exist; the service's schema is unchanged. A missing second
box means "this form does not ask twice", which is exactly true of the desk.

*Live, but not nagging:* the mismatch is silent until the second box has something in it, and the
verdict is consulted only once hydrated, so the server's markup is what it always was and nothing
shifts under somebody already typing.

Baseline `BR-V1.38-2026-09-18`.

## 207. Decided — one deliberate gap in the role ladder: the Organizer is not a Redactor (2026-09-21)

**Context.** The owner, after §201 raised publication to the Administrator: "e ok ca redactorul să
aprobe, tot ce vreau e ca organizatorul să nu fie și redactor… Redactorul scrie, Organizatorul
organizează", and then, asked to confirm what that costs: "da, așa vreau".

**Decision.** `canEditTexts` becomes a **set** — `COPYWRITER`, `ADMIN`, `SUPERADMIN` — where
every other capability in `roles.ts` is a threshold.

That is worth stating plainly, because the file's own comment says why thresholds are used: "a
rule written as a list of roles is a rule somebody forgets to add a new role to". A gap has to
earn itself, and this one does: the club is asking for two jobs that do not contain each other. A
rank ladder cannot express that. Rank would hand the Organizer the Redactor's work simply for
sitting above them, which is exactly what the club asked not to happen.

*`DEV` is out too*, for the reason it is out of everything editorial: "Tehnic" is diagnostics,
and it sits where it does in the ladder only so `canSeeDiagnostics` can stay a threshold.
*`ADMIN` and `SUPERADMIN` keep it*, because the Administrator is who both of the others ask.

**Consequences.** An Organizer no longer writes an event's title, its description, its rules or a
standing page. The suites that wrote text with an Organizer now write it with a role that may, and
`roles.test.ts` asserts both halves of the gap. One existing invariant — "a higher role is
offered every section a lower one is" — survives, but only because of §208.

## 208. Decided — reading the club's content is its own question (2026-09-21)

**Context.** Immediately after §207: "organizatorul vede cam tot (dar în readonly), practic Dani
îi zice Amaliei să modifice X, Y lucru."

And §207 had just made that impossible by accident. Every capability in `roles.ts` answered "may
you change this", the backoffice navigation was built out of those answers, and so the moment the
Organizer stopped writing texts he also stopped being able to **see** the events list. A person
who cannot see what the club publishes cannot tell the Administrator which line is wrong.

**Decision.** `canReadContent` — the capability this file did not have. The navigation asks it,
and the pages that show the club's own content open on it: the events, the standing pages, the
gallery, the legal texts. Every control inside continues to ask its own question, and every
Server Action asserts again (BR-REQ-060-01). That the pages needed almost no change is the
happier half of this: they were already written with a capability check per button rather than one
gate at the top, so separating the two questions was a change to the *gates*, not to the screens.

*It stops at the club's content, deliberately.* The participant list, the export and
`/admin/tasks` stay behind `canManageRegistrations`, because the line this hierarchy actually
draws is personal data and that line is ADMIN (§10.2). "Vede cam tot" is not an instruction to
hand a volunteer four hundred addresses. What every staff role does see of a participant is the
desk: a name, a state and a number, never an address (`AGENTS.md` §15.11).

**Rejected.** *An approval queue*, again — §201 records what it would take. A read-only observer
who asks the Administrator is what the club actually described, and it needs no pending-revision
machinery at all.

**Consequences.** The section list for a Redactor and an Organizer is now the same five plus the
desk; the difference between them is what the buttons do, not what the navigation shows. The
invariant "a higher role is offered every section a lower one is" holds again, and it holds for a
better reason than before.

**Not finished, and said rather than implied:** the read-only screens were verified by reading the
gates, not by walking every control on every page. A button that is still rendered for a reader
and then refuses on the server is a rough edge, not a hole — the server refuses either way — and
the remaining pages are worth a pass.

Baseline `BR-V1.38-2026-09-18`.

## 209. Decided — a pull request runs one viewport, a release runs both (2026-09-21)

**Context.** "These e2e tests in the pipeline take way too long, we need a lighter pipeline
suite", and then, when asked: "da, dar nu scoate de tot, consideră rulează alt suite in
pipeline."

Measured rather than guessed. `docs-check.yml` has two jobs: `docs-check` runs `yarn check`
(docs, secrets, migrations, typecheck, lint, 1550 unit and integration tests) plus `yarn build`
plus a probe that the app serves on `PORT` — and `e2e`, which stands up PostgreSQL and Chromium
and runs `test:concurrency` and `test:e2e`. The e2e job is the long pole: **9.5 minutes** of
Playwright alone, on 163 specs across two projects, on every pull request and every push.

**Decision.** *A pull request runs the `desktop` project; a push to `qa` or `main` runs both.*

The two projects are the same specs at two viewports, so a pull request was paying twice for one
set of behaviours. The second pass is also the one that catches least often: what differs at 320
pixels is layout, and layout is what the mobile project's own assertions are *about* — the
sideways-scroll checks, the 44-pixel tap targets — rather than something the other specs discover
as a side effect. A release is where both run, and a push to `qa` or `main` is not a moment
anybody is waiting on.

*`yarn test:concurrency` stays on every pull request.* Five tests, seconds, and they guard the
one rule that cannot be tested any other way: no overbooking under real concurrent load, on two
real connections, which PGlite cannot express (BR-REQ-051-01 criterion 5, `AGENTS.md` §10.6).
That is a rule CLAUDE.md lists among the ones that carry trust, and it is cheap.

*`docs-check` is untouched and still runs on every commit.* 1550 tests in fifty seconds is the
best value in this repository, and it catches most regressions before a browser is involved.

**Rejected.** *Deleting or skipping any spec.* The owner asked for this explicitly — "nu scoate
de tot" — and he is right: a spec that stops running is a spec that rots. Nothing is deleted,
nothing is marked skip, and `yarn test:e2e` with no argument is still the whole suite locally,
which is what runs before a PR is opened.

*Sharding across parallel runners.* It would halve the wall clock without giving anything up, and
it is the better answer for a repository with a larger budget. Here it doubles the number of
containers that must each install Chromium and migrate a database, for a suite whose real cost is
those two steps as much as the specs.

**Consequences.** A pull request's e2e job drops from about 9.5 minutes of Playwright to about
half that. A mobile-only regression is caught at the release rather than at the pull request,
which is the trade being made, and it is named here so that somebody who finds one knows where to
look.

Baseline `BR-V1.38-2026-09-18`.

## 210. Decided — a newer build is offered, never taken (2026-09-21)

**Context.** "Site-ul trebuie să își dea refresh automat când apare o versiune nouă, și trebuie
ceva banner când s-a făcut deploy", and then the correction that made it safe: "vreau de fapt
banner cu confirmare de auto-refresh, proiectul flyward are așa ceva."

He was right to correct it. This site's purpose is a registration form with twenty fields, a
signature drawn with a finger and a declaration somebody is reading; a reload nobody asked for
destroys exactly the work the platform exists to collect, and the club deploys several times an
evening.

**Decision.** *A notice with a control, and no automatic reload by any path.*
`GET /api/build-id` answers one twelve-character identity and nothing else — its only import is
`build-info.ts`, which imports nothing, so the poll can never wake the database. Deliberately
**not** `/api/health`: that one opens a connection, reads the schema version and the email
allowance, answers 503 on any of it, and is the club's cron-job.org alarm.

*The identity is the commit **and** the deployment, hashed.* `BUILD_COMMIT` alone cannot answer
the question, because this club redeploys the same commit with changed environment variables —
a Turnstile key arriving, a contact address being set — and that is a genuinely different running
site. Hashing keeps it opaque, fixed-length and, the load-bearing part, **deterministic**: a build
timestamp would differ between the several processes `next build` evaluates the config in, and
would inline two identities into one build.

*The running build arrives as a string prop from a Server Component*, never a value the client
bundle computed for itself — that would be the identity of whichever chunk the browser happens to
hold, which is the very thing suspected of being stale.

**What review found, and what changed because of it.** Three lenses, no critical finding, three
majors — all fixed here:

- **The notice could never be retracted.** The store moved one way, on the reasoning that a
  deployment cannot un-happen. True, and the wrong conclusion: what a tab compares itself against
  is "does this address serve something else now", which **can** go back — a rollback does it, and
  so does an alias moved by hand. Once raised it told somebody to reload onto the build they were
  already running.
- **The reload cooldown could never fire.** It was one minute and the poll interval was one
  minute, so the first check of a reloaded document always landed past it. Five minutes now: a
  guard that cannot be reached is not a guard.
- **The notice occupied a band of the viewport at every scroll position.** It was absolutely
  positioned inside the header's *sticky* box, which reads well — it tracks the header — and
  behaves badly, because a positioned descendant of a sticky element travels with it. It covered
  whatever the reader had scrolled to, including a field they were reaching for. It is in the flow
  below the header now, and a slim bar rather than a card: one layout shift when it appears, and
  then nothing covered, ever. The shift is momentary; the occlusion was permanent.

## 211. Decided — an island must not take the value back (2026-09-21)

**Context.** Found by the e2e suite, not by review, and it is the most valuable thing the suite
did all night. Two specs failed with an empty *first* field and every later field intact.

`EmailTwice` (§206) and `PhoneField` (§198) were written as **controlled** inputs —
`value={state}` with state starting at the server's default. The server's HTML carries the
fields, somebody starts typing immediately, React hydrates a moment later, and a controlled input
rendered from state that began empty **replaces what they typed with nothing**. It is invisible in
development, where hydration is instant, and it is exactly what happens to the first visitor on a
cold edge.

`GuardianForMinor` (§188) had a second form of the same fault: a `<noscript>` element with JSX
children. With scripting enabled — every case React hydrates in — the browser parses the inside of
a `<noscript>` as **text**, not as elements, so the two trees disagreed about its contents and
React answered the mismatch by discarding the subtree, taking the typed values with it.

**Decision.** *An island that sits over a form lets the DOM own the value.* `defaultValue`, never
`value`; state exists for the comparison and for nothing else, so it can never contradict what is
on screen. And a `<noscript>` is written with `dangerouslySetInnerHTML`, which is the form both
sides agree about.

*The specs wait for hydration before typing*, which the suite already does for the backoffice and
documents there: "a form submitted mid-hydration is queued by React and sometimes lost". A person
takes seconds to reach the first field; Playwright takes milliseconds, and that difference is the
bug's whole surface.

## 212. Decided — CI runs the end-to-end suite one spec at a time (2026-09-21)

**Context.** After §209 halved the work, six specs still failed in CI and two failed locally under
two workers — and every one of them passed alone.

**Decision.** `workers: 1` in CI. The cause is the fixture, not the machine: several suites drive
the **same** featured event — `ensureRegistrationIsOpen` sets its mode, its window and its fifty
places, and then a spec registers against it — so two workers on one database interleave. One
opens registration while another submits; one fills the last place another is counting. A handful
of specs that pass alone and fail together is the most expensive kind of red, because it teaches
people to re-run rather than to read.

*The honest fix is a fixture per worker* — an event of its own, created and torn down — and that
is a change to every backoffice spec's setup rather than a line of configuration. It is named here
so it is a known debt rather than a rediscovery. Until then CI is serial and says why.

It costs little: since §209 a pull request runs one viewport, so serial-desktop is roughly what
parallel-both-projects cost before. Measured: **91 specs, 2.7 minutes.**

Baseline `BR-V1.38-2026-09-18`.


## 213. Decided — a paragraph or a heading can be centred (2026-09-21)

**Context.** "Centrare / aliniere elemente în rich text editor."

**Decision.** A closed set of three words — `left`, `center`, `right` — on the two nodes that
hold prose, exactly as a picture's `align` is a closed set of three (§193) and its
`widthPercent` a closed set of four numbers. `justify` is deliberately not in it: justified
text in a 320-pixel column is rivers of white space, and that column is a hard target here.

*No dependency.* `@tiptap/extension-text-align` is one `addGlobalAttributes` block and a
command around `updateAttributes`, and the standing instruction is to prefer nothing over a
package (`AGENTS.md` §1.5). §196 took the table package on the opposite reasoning and the two
are consistent: table editing is selection and transform work nobody should re-implement, and
this is an attribute.

**Two silences, and they are the whole of the care taken here.**

*`attrs` is optional on a paragraph*, so every body written before today parses to exactly
itself — no `align: "left"` appears, no migration is needed, and the next save does not rewrite
every page the club has ever written. The heading keeps its required `attrs` for `level` and
gains an optional `align` beside it, with the same property.

*The renderer emits `text-align` only where somebody chose one.* Left is already what the theme
does, so declaring it would put a rule on every paragraph on every page and change no pixel.
The same discipline as §193's clearing rules, which are absent rather than no-ops in a body
that floats nothing.

*The editor's `parseHTML` clamps to the same three words.* A paste from Word or Google Docs
carries `text-align: justify`, `start`, or an inherited value, and a body the server then
refuses is a refusal the organizer meets at the end of a long edit. Anything unrecognised
reads as no alignment at all.

*Alignment is a rendering, not content.* The plain-text projection is untouched, so the
excerpt, the `.ics`, the Open Graph description and the search index do not learn that a line
was centred.

Tests: `tests/unit/content/rich-text-align.test.ts` (7), including that a body written before
this parses byte-for-byte to itself and that the default emits no rule at all.

Baseline `BR-V1.40-2026-09-21`.

## 214. Decided — the race number is reserved when the place is, and settled when registration closes (2026-09-21)

**Context.** The owner, looking at his own registration stuck on "waiting for the email":
"I need the BID to be reserved ASAP because I still did not receive this email." And Dani,
on why it cannot be a manual step: "procesul trebuie să fie automat, să nu pierdem timp să
facem noi înscrieri manuale… ca nimeni nu face așa ceva. Și mai ales că vor fi gratis, cu nr
limitat de înscrieri… să vezi ce discuții și hate ne luăm dacă nu l-am înscris pe unul la
timp și i-a luat altul locul."

§87 drew the number at confirmation — "the moment the place is certain". That was true when
nothing existed earlier, and it put the number behind the two steps most likely to strand
somebody: an email that does not arrive, and a declaration nobody has read yet. The club could
not plan and the runner could not ask.

**Decision.** *Two columns, and the difference between them is the whole design.*

`provisional_bib_number` is drawn **at submission**, under the event row's lock, for any real
registration that occupies a place. `bib_number` is the settled one: printed, emailed, never
reissued, never renumbered.

*The provisional number is released.* It belongs to a registration **exactly while it occupies
a place**, so cancelling, expiring or being pushed back onto the waiting list hands it straight
back to the next person. That is safe only because it is printed nowhere and emailed to nobody
— nothing in the world has to keep matching it — and it is what keeps the sequence dense, which
is what makes most people's number survive the settle unchanged. `bib_number` stays the
opposite and always will: a cancelled runner keeps theirs, because reuse is how two people end
up wearing 17.

The release lives in `transitionRegistration`, the one guarded transition every state change
already goes through, so there is no path that moves a registration out of a place and forgets.
The *draw* cannot live there — it needs the event lock and the band — so it sits in the
allocator's own paths, which hold both. Losing a release is the failure that matters: a number
nobody holds that nobody can take.

*A place is held from submission, and always was.* `PENDING_EMAIL_CONFIRMATION` is in
`ACTIVE_REGISTRATION_STATUSES`, so nobody waiting on an email can have their place taken by
somebody faster. What was missing was anything the runner or the club could **see**. That is
also why the insert now takes the event lock: the row occupies a place from the instant it
exists, so the number that goes with the place has to be drawn under the same serialization
point capacity uses (§10.6, §151), and it was the one door into the allocator that took no lock.

*Confirmation draws nothing while the window is open.* The provisional number stands, and
`REGISTRATION_CONFIRMED` carries no number before the close — which is the trade: a number that
is emailed is a number that cannot move afterwards. Once the window has shut, confirmation
draws immediately, because a late paper signature or a walk-in on race day needs a bib within
the minute and the sequence is settled by then.

*The settle is a recompaction, and it is the one moment a number moves.* The provisional
sequence is dense while it is handed out and full of holes by the end — cancellations, lapsed
confirmations, expired holds. Printing that is a sheet reading 1, 2, 5, 6, 9 and a box of bibs
a volunteer cannot count off. So at the close every runner still holding a place is renumbered
into one unbroken run from the event's own band, in provisional order, which is registration
order. A number already given by hand (§105) is kept and the sequence closes around it.
`events.bibs_settled_at` makes it once-only: the job sees the same closed event every few
minutes, and a second pass would renumber people who have already been told.

*Everybody holding a place is numbered, not only the confirmed.* A declaration can be signed on
paper at the desk on race morning (§67), so an unsigned registration is a person who may well
run, and a race with no bib for them is the failure this is trying to avoid.

**Consequences.** `findEventsNeedingMaintenance` gains a fourth clause, and it is load-bearing:
an event that filled up cleanly has no expired hold and no waiting list, so none of the three
existing conditions would ever name it and the settle would never run on the event that needs
it most. `suggestFreeBibNumbers` now skips provisional numbers too, or it would offer an
organizer a number somebody is already looking at. Every screen reads `raceNumberOf`, one
accessor over the two columns, because answering "which number does this runner have" in eight
places is how one of them ends up showing a dash on race morning. The printed bib and its
picture stay on the settled column alone — a provisional number is never printed.

**Rejected.** *Keeping one column and letting its value change.* It cannot be told apart from a
settled number by any reader, so nothing downstream could know whether it was safe to print or
send. *Two visible numbers per runner* — a provisional one beside a final one — which is what a
naive second column gives, and what the settle's clearing of the provisional column avoids.

Tests: `tests/integration/registrations/provisional-bibs.test.ts` (9), including the release
and reuse, the unique index, that a test registration gets none, that the settle closes the
holes, that it runs exactly once however often the job does, and that nothing is emailed before
it.

Baseline `BR-V1.40-2026-09-21`.

## 215. Decided — a member's club is the club's own name (2026-09-21)

**Context.** "If people check that they are brasov runners members, the club input must be
auto-filled and readonly", with a screenshot of `BRASOV RUNNERS` typed in by hand.

**Decision.** The tick and the club box are the same question asked twice (BR-REQ-031-06), and
typing the answer by hand is how one club becomes "BRASOV RUNNERS", "Brasov runners" and "BvR"
— three clubs in the export, sorted apart on the start list. Ticking the box fills the field
with the club's own name and makes it read-only; unticking gives back whatever was typed before.

*The tick still grants nothing.* §48 is untouched: this writes a name, not a capability.

*`readOnly`, never `disabled`.* A disabled input posts nothing, so ticking the box would
silently clear the club from the submission.

*The value is written imperatively and the input stays uncontrolled* (§211). A controlled input
over a server-rendered form wipes what somebody typed before hydration; the box keeps its
`defaultValue`, the DOM owns the value, and the island writes only in response to the checkbox
changing, which is after hydration by definition.

*The same rule runs on the server*, so a submission with JavaScript off — or from anything that
is not this form — records the same string. `CLUB_NAME` is a constant in `theme/brand.ts`
rather than `Site.name` from the catalogue, because what is stored is a fact and not a
translation: it must not differ between a Romanian and an English submission. A test asserts
the constant equals `Site.name` in both catalogues, so the two cannot drift.

Baseline `BR-V1.40-2026-09-21`.

## 216. Decided — a challenge that cannot run is not a reason to refuse a registration (2026-09-21)

**Context.** Dani could not register, on two different addresses. Diagnosing it turned up
something worse than the bug being looked for: `verifyTurnstile` answered `failed` for **no
token at all** and for **Cloudflare not answering**, and the action refused the submission on
`failed`.

So anybody whose browser never ran the widget could not register: a content blocker or a
privacy browser that refuses `challenges.cloudflare.com`, a corporate proxy, a phone on a bad
connection, JavaScript switched off. They were told to tick a box that was not on their screen.
And a bad five seconds at Cloudflare locked out every visitor at once.

**Decision.** *Three verdicts where there were two.* `failed` is a token Cloudflare looked at
and rejected — evidence, and it still stops a submission. `unavailable` is the **absence** of
evidence: no token, a 5xx, a timeout. It refuses nobody, and it is logged so the club can see
how often the widget does not run. The line never carries an address, as §194's does not.

The original comment argued the other way — "a bot's token is not waved through on a bad day" —
and it was wrong about which failure costs more. A bot that omits the token still has to get
past the honeypot, the timing check and the per-identity throttle (`AGENTS.md` §19.4). A person
who cannot register is the thing this site exists to prevent, and §205 says so in the owner's
own words: "trebuie să lăsăm oamenii să se înscrie cu orice preț!!! Asta e scopul principal al
site-ului."

An over-long token stays `failed`: nothing legitimate produces one, and it *was* submitted.

*The contact form and the interest box are fixed by the same change*, because both already
refused only on `failed`.

**This was not Dani's bug**, and the distinction is worth recording. His widget ticks itself,
so Turnstile was passing for him all along. What discarded him is §194's silent drop, which is
fixed on `qa` and has never been deployed — production still runs `if (looksLikeSpam(input,
now)) return { ok: true }`, which writes no registration, queues no email, and tells the person
to check their inbox. The evidence was in the registrations list: no row for him at all. This
section is a second hole found while looking for the first.

Tests: `tests/unit/registrations/turnstile.test.ts` — each way the check can fail to run, and
the one way it can fail.

Baseline `BR-V1.40-2026-09-21`.

## 217. Decided — nobody is told to wait for an email that was never sent (2026-09-21)

**Context.** Dani could not register. On the same afternoon he registered successfully in
DuckDuckGo and failed repeatedly in Edge, which is the whole diagnosis in one sentence: Edge
holds his details and fills the form instantly, and production answers an instant submission
with the confirmation page and nothing else.

The owner, on being shown why: "people need to know that they were identified as bots! it's
very bad for a user to tell him he is waiting for an email but he never receives it!" And then:
"so the anti-spam/bot verification must be way more loose... so that we don't mistakenly mark
real people as spam and they never receive the mail! and they need visuals on this!"

**Decision, stated as an invariant because that is what it is:** *nothing may show the "check
your email" screen unless a message was actually queued.*

Three changes carry it.

**1. Neither defence is answered with silence.** §194 moved the timing check from silence to a
visible refusal and deliberately left the honeypot silent, on the argument — a good one — that
a distinct error tells a script exactly what to stop doing (BR-REQ-031-01 criterion 3). The
argument is sound and it is outweighed: a hidden field is filled by machines and, rarely, by a
password manager or an accessibility tool that does not know the field is hidden, and that
person was told to wait for an email nobody had sent.

What a script still cannot learn is *which* check fired. Both verdicts throw the same error
with the same field marker, so the trap and the timer are indistinguishable from outside, and a
bot that omits the honeypot still has to wait out the timer — which is the whole of what a
timing check ever bought. The log keeps the distinction, by event and reason, never by address.

**2. The timing check is much looser.** One second, not three, and **a missing or unreadable
render time is no longer suspicious at all**. Three seconds is well inside what somebody with
autofill takes; one second is not reachable by hand and slows a script exactly as much. And the
things that lose the timestamp are a page restored from the back-forward cache, an extension
that rewrites the DOM, a proxy that strips a hidden field and a tab left open since yesterday —
all of them people. There is nothing to time, so there is nothing to judge.

The asymmetry is the argument. A lost registration is the thing this site exists to prevent; a
spam registration is a row an Administrator deletes in two seconds. The real defences on this
form are the honeypot, Turnstile (§97, §216) and the per-identity throttle (§19.4); the timer
is the cheapest of the four and the only one that has ever refused a real person.

**3. The refusal is where the person is looking.** `tooFast` is not one of the form's fields, so
the error summary — the element the redirect anchors to and moves focus to — filtered it out and
fell through to "verifică datele completate", a red box sending somebody hunting through twenty
inputs that are all correct, while the sentence that explains what happened sat at the far end
of a long form beside the button. That is the same trap §176 fixed for the captcha, and it is
fixed the same way: said first, on its own, with its own title. The sentence names a second
press and then the contact form, because a person whose password manager fills the trap will
trip it again on the retry and would otherwise have a new dead end. The honeypot is in
`form-draft.ts`'s `SKIPPED` set, so its value never travels back into the retry.

**Consequences.** BR-REQ-031-01 criterion 3's "answered exactly like success" now describes
neither check; `AGENTS.md` §15.1 is amended and states the invariant above it. The contact form
and the interest box follow the same loosened rule through `looksLikeSpam`, and the contact form
matters most of the three: it is the escape hatch somebody reaches for *because* the rest of the
site would not take them (§205), so refusing it silently is the worst failure on the one page
that exists to catch the others.

**The second finding, and it is the expensive one.** While looking for what blocked Dani it
turned out that **production has never had §194**: `main` is forty-one commits behind `qa` and
still runs the silent drop. Every symptom matched — the widget ticked itself, the form
submitted, the page said to check the inbox, no email arrived, and there was no row for him in
the registrations list at all, because none was ever created. A fix that is written, tested and
undeployed is not a fix, and nothing in this repository was measuring the distance between the
two branches.

Tests: `tests/unit/registrations/submission-verdict.test.ts` (6 — the one-second boundary and
the passing of a missing render time), `tests/integration/registrations/lifecycle.test.ts` (the
trap refuses out loud and creates nothing, and the two verdicts produce the identical answer),
`tests/integration/contact/service.test.ts` and `tests/integration/registrations/interest.test.ts`.

Baseline `BR-V1.40-2026-09-21`.

## 218. Decided — the last two silent drops, found by auditing for them (2026-09-21)

**Context.** §217 stated the invariant — nothing shows "check your email" unless a message was
queued — and fixed the two anti-bot checks. An audit run immediately afterwards, seven readers
over the public journey with three adversarial verifiers each, found that the invariant was
still false in two more places. Both were missed for the same reason: §217 fixed the paths
that had just failed in front of somebody, and these two had not failed yet.

**1. The per-address throttle.** `submitRegistration` refused the sixth submission in an hour
with `return { ok: true }` — no row, no message, no log line, and the confirmation screen. Its
own comment justified the silence in these words: *"Refused the same way the honeypot and the
timing check are refused"* — pointing at two behaviours §217 had reversed thirty lines above
it. A comment that cites a rule which no longer exists is how a fix half-lands.

It now refuses out loud, with its own sentence and its own field marker.

*It leaks nothing, and that is why this is allowed.* The bucket is keyed on the canonical
identity of the address the person has just typed, so telling them "we have had several of
these from you" tells them about themselves. The oracle `AGENTS.md` §19.4 forbids is one that
answers *whether somebody else is registered*, which this cannot. The contact form has
answered this way from the start, and `rate-limit/service.ts` already said why: "the sixth is
told so plainly, because a person is not a bot."

*Five an hour is reachable by ordinary use* — a re-test, two family members on one mailbox,
somebody who cancelled and registered again — which is exactly the population that must not
meet silence. The sentence names the hour and then the contact form, because somebody who
needs to register now cannot wait one.

**2. A waiting-list entry re-submitting the form.** `deriveAllowedResendMessageType` returns
null for `WAITLISTED`, so §199's already-registered branch queued nothing and returned, and the
screen said to check an inbox nothing had been sent to.

The null is **right for the backoffice** and stays: "send it again" hands somebody a link they
must act on, and a queued person has none. It is wrong for the public form, where the question
being asked is not "send me the link again" but "did my registration go through at all". That
question has an answer and a message type for it, so the public path re-sends
`WAITLIST_JOINED`. The throttle in front of the form is what stops it being a mailer.

**What the audit cost, and what it is worth saying about it.** Seven finders produced findings
across the whole journey; the verification pass was cut short by an account limit, so 150 of
172 agents died and most findings are **swept but unverified**. The two recorded here are the
ones that survived three independent adversarial lenses with quoted code. The rest are a
backlog, not a clean bill of health, and this paragraph exists so that nobody reads §218 as
"the journey was audited and found sound".

Tests: `tests/integration/registrations/lifecycle.test.ts` — the sixth submission is refused
with a named field and somebody else's hour is untouched; a waitlisted re-submission queues
`WAITLIST_JOINED`.

Baseline `BR-V1.40-2026-09-21`.

## 219. Decided — the email header is a white banner, and the message says it is a light document (2026-09-21)

**Context.** Dani, of the verification email: "this email header looks ugly! it should be a
banner with white background", with a screenshot of the lockup sitting in a white rectangle on
a dark card.

**Decision.** The card was **already** `#ffffff`, so in an ordinary inbox nothing was wrong.
The screenshot was Gmail's dark mode, which re-colours what it can and cannot re-colour a
raster: the card went dark, the logo's own white background did not, and the lockup ended up
looking like a sticker on a dark wall — which is the exact failure §189 changed the blue band
to avoid, arriving by a different route.

*The message now declares itself a light-scheme document*, in a `<meta>` and again in a
`:root` rule, because most clients read the meta and Gmail strips `<head>` but keeps a
`<style>`. That is what stops Apple Mail, Outlook and Gmail's webmail inverting it at all.

*The banner is a table cell with a `bgcolor` attribute*, not a styled `<div>`. A client that
inverts anyway has to override an HTML attribute rather than a CSS declaration, which is the
last lever that still works where `color-scheme` is ignored. The logo is centred in it, so a
band wider than the picture reads as a letterhead rather than as a picture with space beside
it.

*The card is a full HTML document now rather than a fragment*, for the plain reason that there
was no `<head>` to put any of this in.

Baseline `BR-V1.40-2026-09-21`.

## 220. Decided — the audit turned on the code the audit was written for (2026-09-21)

**Context.** §218 recorded two silent drops the audit found in old code. It found two more in
the code written the same afternoon — §214, the provisional race number — and those are worse,
because they shipped with twelve passing tests and a decision record asserting the very
invariant they broke.

**1. The three bulk expiry sweeps never released the number.** §214 put the release inside
`transitionRegistration`, "the one guarded transition every state change already goes through",
and said so in as many words. Three state changes do not go through it:
`expireStalePendingEmailConfirmations`, `expireStaleHolds` and `closeWaitlistForStartedEvent`
are bulk `UPDATE ... SET status = 'EXPIRED'` statements — which is exactly why they are fast,
and exactly why they were missed. An expired row kept its provisional number for ever, and
`pickProvisionalBibNumber` treats any non-null provisional as taken, so the sequence this whole
design exists to keep dense would grow a permanent hole every time somebody let a hold lapse.

Invisible until somebody counts, which is the kind of defect that survives a release.

**2. `pickBibNumber` was blind to the provisional column.** It reads the numbers already worn,
and since §214 that is only half of the numbers that are spoken for. Reachable after the
settle: registration has closed, two walk-ins are entered at the desk and each is given a
provisional number, and the first of them to be confirmed draws a final one — which, reading
`bib_number` alone, is the number the *other* one is looking at. The partial unique index
cannot catch it, because the two numbers live in different columns, so the first anybody would
know is two runners at one start line wearing 51.

It reads both columns now. And a late confirmation **adopts its own provisional number** rather
than drawing a fresh one — which it would otherwise now skip, the number being held by the very
person asking for it. Adopting is also what the runner expects, because the desk has been
showing them that number since they registered.

**What this says about the method, and it is why the section exists.** Both defects are in code
that passed its own tests. Tests written by the author of a change cover the cases the author
thought of; an adversarial reader given the *invariant* rather than the diff found both in one
pass, and found them on the day the code was written rather than on the morning of a race.

Tests: `tests/integration/registrations/provisional-bibs.test.ts` — a lapsed hold releases its
number through the sweep, a final draw never lands on a held provisional one, and a late
confirmation keeps the number it was shown.

Baseline `BR-V1.40-2026-09-21`.

## 221. Decided — the club chooses when email leaves (2026-09-21)

**Context.** The owner asked for a switch: messages go out instantly, or only through the
scheduler.

**Decision.** One `platform_settings` row, `immediate` by default, read by the drain.

The two failure modes are opposite and the club cannot know in advance which one it is in.
`immediate` is what has always happened — `drainOutboxAfterResponse` sends after the response,
so a confirmation link arrives in seconds, which is why a registration feels instant. Its cost
is a burst: eighty people registering when a popular race opens is eighty sends in a few
minutes, which is where a daily allowance goes fastest and where a provider's rate limiter
answers 429. `scheduled` sends nothing from the web request and leaves it all to the pinger —
late by up to fifteen minutes by day (§68), and in exchange paced, predictable, and unable to
take the site's own response times with it.

*Superadministrator only*, unlike the Mailgun plan beside it, which is the Administrator's
(§100). The plan is a fact about the club's account that its data controller knows; this is an
operational trade that makes **every** message on the platform arrive later, and getting it
wrong is invisible until somebody asks why their link took a quarter of an hour.

*The setting is read inside `after()`, never at the call site.* `enqueueEmail` calls the drain
from within the caller's transaction, and a settings read there would put one more query
between a registration and its commit. Inside `after()` the response has gone and the
transaction is closed, so it costs one indexed lookup on a path that was about to open a
connection anyway. Nothing is lost when the answer is `scheduled`: the row stays PENDING and
whoever reaches it first claims it under `FOR UPDATE SKIP LOCKED`.

Baseline `BR-V1.40-2026-09-21`.

## 222. Decided — §208 finished: every control asks the question its own action asks (2026-09-21)

**Context.** §208 said it plainly and left it: "the read-only screens were verified by reading
the gates, not by walking every control on every page… the remaining pages are worth a pass."
This is the pass — one reader per admin page, twenty-four of them, each finding then attacked
by a verifier that had to refute it against `roles.ts`. Thirty findings, seventeen survived.

**What it found, and the two shapes it came in.**

*A control rendered and then refused.* The Mailgun plan form and the contact-recipients form on
`/admin/emails`, the "create album" button, the withdraw and delete buttons on the legal list,
"start the next version", and three event-series controls. None is a security hole — every
action asserts again on the server (BR-REQ-060-01) — and each is a person pressing a button on
a screen they were invited to open and being told their role does not permit it.

*A screen an Organizer may read and could not open*, which is worse, because the work simply
cannot be done. `/admin/pages/[id]` and `/admin/legal/[id]` both gated on **writing**, so the
one role §208 exists for could see the list and open nothing on it. "Organizatorul vede cam tot
(dar în readonly), practic Dani îi zice Amaliei să modifice X" is impossible if X cannot be
read.

**Decision.** *Every screen opens on `canReadContent`; every control inside is guarded on the
capability its own Server Action asserts.* Stated that way rather than as a list of fixes,
because the list is what drifts — the general rule is the thing worth keeping.

The standing-page editor is the case that proves it. One flag, `mayEdit`, answered two
questions, and answered one of them wrongly: it read `canEditEventFields`, while `savePage`
asserts `canEditTexts`. Opening the screen without splitting that flag would have *created* a
rendered-but-refused control where there had been a locked door. `deletePage` genuinely does
assert `canEditEventFields`, so delete keeps the wider gate — an Organizer may delete a
standing page and not edit its words, which is odd and is what §207's deliberate gap says.

Baseline `BR-V1.40-2026-09-21`.

## 223. Decided — the telephone box takes digits and nothing else (2026-09-21)

**Context.** "In the phone field I should be able to type only numbers!"

**Decision.** Non-digits are **stripped as they are typed**, not refused. The country code is
chosen in the select beside the box, so what belongs in it is the national number; and a person
pasting `0721 234 567` or `+40 721-234-567` out of their own contacts keeps the digits and
loses the punctuation, where a refusal would leave them retyping a number they had correctly in
the clipboard. `composePhone` on the server already strips exactly this, so the box now shows
the answer the server would have reached.

*The `pattern` still admits separators, and that is deliberate.* With JavaScript off nothing
strips anything, and the server accepts a number written with spaces. A pattern narrowed to
digits would make the browser refuse, without JavaScript, a number the server would have taken
— the form working worse for the person least able to recover from it (`AGENTS.md` §1.5).

`inputMode` moves from `tel` to `numeric`: a telephone keypad offers `+ * #`, and none of them
can be typed here any more.

## 224. Decided — the screen that says "check your email" says which one (2026-09-21)

**Context.** "On this page I should show the email again", and "I should underline that 5
minutes rule".

**Decision.** The address is the one fact that screen was missing, and it is the cheapest catch
there is. "Check your email" is useless to somebody who typed `@gmail.con` — they check the
inbox they meant, find nothing, and conclude the site is broken. QA's outbox holds three bounced
messages to that exact misspelling (§206), and one of the owner's own registrations went to a
domain with a letter added. Reading their own address back is what stops them walking away.

*In a sealed cookie of its own, never the URL.* Nothing a participant typed goes into a URL,
which every proxy in between logs (§14.5), so the redirect's query string is out. It is not the
draft cookie either: that one is cleared on a successful submit and carries twenty fields
including health notes. This carries one field, is written only on success, and uses the same
key and the same ten minutes, because an address is still personal data sitting in a browser.

*The wait is bold, and said once.* It was on the screen three times — the stepper's sentence,
the alert, and the resend prompt beneath — which is how a sentence stops being read. The
stepper keeps "we have sent you a confirmation link" and gives up its copy of the delay; the
alert carries the address, then the five minutes in bold, then the spam advice in plain text.
Somebody who does not know a wait is normal fills the form in again within thirty seconds, and
§218 is what that used to cost them.

Baseline `BR-V1.40-2026-09-21`.

## 225. Decided — the declaration sets its fill-ins in bold (2026-09-21)

**Context.** "În declarație trebuie să fac bold la datele care sunt din binding (datele
participantului, datele concursului)."

**Decision.** He is right, and the reason is not decoration. A declaration is one approved,
hashed text with a handful of named blanks filled in for one person and one race (§95). What
the signer has to check before signing is exactly the blanks — their own name, who declares,
the identity document, the race, its date and its place. Everything around them was approved
once and reads the same for everybody. Setting the two apart is the difference between reading
a contract and checking a form.

*The merge returns segments now, not a string.* `mergeTextSegments` says which spans came out
of a `{{field}}`, and `mergeText` is that function joined back together — defined as such, so
the two cannot come to disagree about what a merge produces.

*The dotted blank counts as filled*, because it occupies a field too. On the blank form the
desk prints, the emphasised parts are then the gaps somebody writes into, which is what a
paper form does with a rule under a space.

*Nothing about the signature changes.* `content_sha256` is computed over the **unmerged**
template (§12.5, §46) and that is what an acceptance binds to. This is a rendering of the same
template; no approved text and no recorded signature is touched.

**A hardening that came free.** On screen the merge now happens **inside** `LegalDocumentBody`,
after the inline marks are parsed rather than before. Merging first fed a participant's own
name to `parseInline`, so a name written with the square-bracket link mark was read as a link — the parser
restricts the protocol, so it was never script, but a person's own data has no business
becoming markup. A filled-in value is plain text now, always, and a `{{field}}` written inside
a link's label still merges inside that link, where the author put it.

**In the PDF** the paragraph is drawn a run at a time with pdfkit's `continued`, so the line
breaking and the justification stay the paragraph's rather than each run's, and the two
callers hand the renderer the template and the values apart instead of a merged body.

Tests: `tests/unit/legal-documents/merge-fields.test.ts` — which spans are filled, the blank
counting as one, an unknown name staying plain, and the join being exactly `mergeText`.

Baseline `BR-V1.40-2026-09-21`.

## 226. Decided — two bugs in one field, and only one of them was visible (2026-09-21)

**Context.** The owner, with a screenshot: "the brasov runners text is overlapping with the
placeholder here". Looking into it turned up a second bug underneath, which nobody had seen and
which was much worse.

**1. The label sat on top of the text.** MUI floats a label by watching the input's own events,
and `ClubForMember` writes the value **imperatively** through a ref — which fires none of them.
So the field had the club's name in it and the label was still in its resting position, the two
drawn over each other. That is the price of letting the DOM own the value, and §211 is why
holding it in state is not an option here.

`shrink` is forced only when there is something to shrink for, and left undefined otherwise so
MUI keeps deciding on focus and blur as it does everywhere else. Forcing `false` would be worse
than the bug: the label would refuse to move even while somebody typed.

**2. The digit filter was silently corrupting telephone numbers.** §223 stripped every
non-digit as it was typed, the `+` among them. `composePhone` reads a leading plus as "the
international form was typed" and then *insists* the number carries the selected country's
dialing code — so Romania selected and a French `+33712345678` pasted in was **refused**, and
the person fixed the country. With the plus gone the same digits fall into the national-number
branch, which bolts the chosen country's code onto whatever it is given: the refusal became a
silently accepted `+4033712345678`, a number belonging to nobody.

A wrong telephone number is worse than a rejected one, because nothing ever tells the club —
they find out on race morning, ringing somebody who does not answer. The filter keeps a leading
plus now and strips everything else, which is still "only numbers" to anybody typing and is the
one character that changes what the rest of them mean.

*It was found by a test the owner had already patched.* The end-to-end spec asserted the box
held `+40711111111`; the filter made it `40711111111`, and the natural repair was to update the
expectation — which he did, and which was correct for the code as it then stood. That assertion
was the only thing in the repository pointing at the plus disappearing, so the note beside it
now says that a failure there is a stored-number bug rather than a test to adjust.

**Worth stating once, because it has happened twice in two days.** §211, §215's missing ref and
this label are all the same trade: an island over a server-rendered form must let the DOM own
the value, and every consequence of that — the label, the validation state, anything MUI infers
from events — has to be driven by hand. That is the cost of the rule, and it is still cheaper
than wiping what somebody typed before hydration.

Tests: `tests/unit/registrations/phone.test.ts` — the French number under Romania stays
refused, the corrupted form is pinned as what the bug produced, and the five ordinary ways a
Romanian number is written all still compose to the same E.164. The end-to-end spec asserts the
label carries MUI's `shrink` class, which is the overlap stated as a fact rather than a
screenshot.

Baseline `BR-V1.40-2026-09-21`.

## 227. Decided — the second address is typed, not pasted, and there is a door (2026-09-21)

**Context.** "În căsuța de reconfirmare mail nu ar trebui să pot face copy-paste, trebe să scriu
de mână! dar să fie safe!"

**Decision, and it reverses §206.** That section left paste alone, reasoning that a password
manager holds the address people use everywhere and that refusing it pushes somebody to type
from memory. The reversal is right for a reason §206 did not weigh: the paste that matters is
not from a password manager, it is **from the box above**. Copy, paste, done — and the second
box has confirmed nothing whatever. It is the cheapest way to defeat the check and the one
every hurried person reaches for.

*Only the second box refuses.* The first is where a password manager legitimately fills in the
address, and §206 was right about that half.

*"Dar să fie safe"* is the same instruction §195 got about the rules gate, and it is answered
the same way: **the block is an enhancement with a door in it.** A refused paste says why —
never a silent no-op (§217) — and offers "paste it anyway", which lets that person through for
that field. Voice input, an assistive tool, a keyboard that only pastes: none of them is locked
out of registering, and the person copying from the box above still has to stop and read a
sentence telling them why not to.

*Both `paste` and `drop` are refused*, because dragging the address down from the box above is
the same act without the keyboard.

The door is not persisted anywhere. The next form asks again, and the cost of saying so twice
is one press.

Baseline `BR-V1.40-2026-09-21`.

## 228. Decided — an emergency contact is somebody else (2026-09-21)

**Context.** Amalia, testing: "și poți pune la persoana de contact numele tău și nr tău."

**Decision.** You could, and the field was then worth nothing. Its whole purpose is a number
somebody can ring when the runner cannot answer their own; a contact who *is* the runner is not
a contact, it is a blank the form let through.

*The number is the rule and the name is not.* Both were considered and only the number is
refused. Two people at one race genuinely share a name — a father and a son, two Ion Popescus —
and refusing that would turn a real entry away for no gain. Nobody shares a telephone that
answers in an emergency. By the time the schema sees them both numbers are E.164, so the
comparison is exact rather than a guess about how somebody wrote it.

**Consequences.** The synthetic registration generator gave every fake participant the same
number twice and now gives two, because a test row goes through the public schema unchanged —
that is the whole point of it (§30).

Baseline `BR-V1.40-2026-09-21`.

## 229. Decided — the confirmation screen stops asserting a registration it did not make (2026-09-21)

**Context.** Amalia, testing: "te poți înscrie cu fix același mail de 2 ori, primești și QR și
tot."

**What actually happens, because it is not what it looks like.** No second registration is ever
created: `registrations_event_participant_unique` forbids it, the service declines before
reaching the database, and a query of QA's rows found not one address with two registrations.
What she met is §199 working as designed — re-submitting an address that is already confirmed
re-sends `REGISTRATION_CONFIRMED`, **QR and all** — while this screen said "check your email to
confirm your registration". A second email carrying a QR, under a screen asserting a new
registration, is indistinguishable from having registered twice.

So the defect is the sentence, not the data.

**Decision.** It cannot be fixed by saying "you are already registered" here. That would answer
a question about *somebody else's* address to anybody who types it, which is precisely the
oracle `AGENTS.md` §19.4 forbids and which §199 chose the inbox to avoid.

So the sentence is made **true for everybody** instead: the screen now adds that if the address
was already registered, the email is the existing confirmation and no second registration was
created. It reads identically whether or not the address is on the list — no oracle — and the
person who owns the inbox is the only one who learns which case they are in.

*Recorded because the diagnosis is the valuable part.* Three people looked at this and read it
as a duplicate-registration bug. The database was never in doubt; the screen was. A test that
proves the constraint holds is now beside the one that proves the service declines, so the next
person can answer the question in a second rather than an afternoon.

Baseline `BR-V1.40-2026-09-21`.

## 230. Decided — the screens that hand out numbers had not noticed that numbers arrive earlier now (2026-09-21)

**Context.** The owner, on a registration detail page showing "nr. 2" in the journey and an
empty "give this runner a number" box underneath: "I would like the BIDs to be reserved from
the first stages (I've already said that!) Cuz this input does not make any sense now! Amalia
already has number 2 reserved."

The reservation was already working — that is where the "nr. 2" came from. What had not caught
up was the screen around it.

**What was wrong.** The hand-entry control asks "has a number been settled", and reads that as
`bib_number === null`. Since §214 that is true of *every* place-holding registration until the
window closes, so the box rendered for somebody who already held a number, invited an organizer
to give them one, and listed the free numbers with the runner's own left out of it. Correct by
its old question, nonsense by the new one.

**Decision.** The box stays — a preferential number is still typed by hand (§105) — and it
stops pretending the runner has nothing. It says which number they hold, comes prefilled with
it, and is a **change** rather than a gift.

*And setting one by hand now clears the provisional column.* §220 says the recompaction closes
around a number given by hand, and it skips rows that already have a final one — so a row left
holding both would keep a provisional number reserved to somebody who no longer needs it. That
is a hole in the sequence, which is precisely the failure §220 found in the bulk sweeps, and it
would have been reintroduced by a different verb. One runner, one number, whichever verb
produced it.

**The pattern, because this is the second time.** §214 changed *when* a number exists, and
every screen that had encoded "no number yet" as `bib_number IS NULL` was quietly wrong from
that moment. `raceNumberOf` was written for exactly this and the reads were moved onto it; the
two places that decide whether to *offer* a number were missed, because they are not reads of a
number, they are questions about its absence. Worth naming: when a column stops meaning what it
meant, the dangerous callers are the ones testing it for null.

Baseline `BR-V1.40-2026-09-21`.

## 231. Decided — a rule the browser can enforce is enforced by the browser (2026-09-21)

**Context.** The owner, with a screenshot of the emergency-contact field refused *after* a round
trip: "I want validations on the FE first, I should not be able to submit an invalid form. Eg:
here I put the same number for emergency contact but I only knew that after submitting."

**Two defects, and the second one is mine from an hour earlier.**

*The rule only existed on the server.* §228 put "an emergency contact is somebody else" in the
submission schema, which is where it has to be — a browser check is a courtesy and the schema
is the guarantee. But it was *only* there, so the first anybody heard of it was a rejected
form, after the page had round-tripped and scrolled them to a summary.

*And the sentence was wrong.* The field's helper text is `errors.phone` — "the number is not
valid, type only the digits" — which about their own correctly-typed number is simply untrue,
and sends somebody hunting for a formatting mistake that is not there.

**Decision.** *`setCustomValidity`, not a red border.* A message drawn beside a field is a
picture; a custom validity makes the **browser** refuse the submission, name the control and
move focus to it — the same machinery that already handles a missing required field, in the
reader's own language, with none of this application's JavaScript in the refusal path. That is
what "I should not be able to submit an invalid form" actually asks for, and it is why the
check is not merely rendered.

It is cleared the moment the numbers differ, or the control stays refused for ever.

*The field is watched, not owned.* `PhoneField` subscribes to the other number's input the way
`GuardianForMinor` subscribes to the birth date (§188): lifting the other field into this island
would trade its own validation for a second copy of the rule.

*The comparison is `composePhone`'s, on both sides.* The same discipline as §198: one rule,
imported, never a regular expression approximating it. `0752189098` and `+40752189098` are the
same telephone, and a check that could not see that would be a check people learn to ignore.

*A second marker says which rule refused.* The issue keeps the field path, so the error summary
can still link to the field; a second, non-field marker rides beside it so the page can choose
the true sentence. The same shape the captcha and the timing check already use (§176, §194).

**The server keeps the rule, unchanged.** With JavaScript off, or from anything that is not
this form, §228 still refuses. The browser check is the courtesy that makes it not hurt.

Tests: `tests/e2e/registration-form.spec.ts` — the message is the right one, `checkValidity()`
is false, a press does not leave the page, and correcting the number lifts the refusal.

Baseline `BR-V1.40-2026-09-21`.

## 232. Decided — the race number is one line, and changing it is folded away (2026-09-21)

**Context.** "I wanna simplify that part with the BID changing."

**Decision.** The block had grown, one correct addition at a time, into four things stacked up:
a sentence explaining what the runner holds, a prefilled input, a save button, and a list of
every free number at the event. Each was added for a reason — §105's preferential number, §230's
"say what you would be replacing" — and together they answered a question nobody was asking. The
question this screen is almost always open for is *what number does this person have*.

So the answer is one line, and the change is a `<details>` underneath it.

*The same idiom the rest of the backoffice uses* for a rare verb: the registrations list folds
its destructive actions this way and the public form its optional groups. It costs no client
island, it opens with JavaScript off, and the disclosure triangle says there is more without
spending a line saying so.

*The free numbers stay — inside.* They are exactly what somebody who has decided to change a
number needs, and noise to everybody else. Hiding them behind the same press that reveals the
box puts them where the decision is.

*The sentences are shorter too*, which is half of what "simplify" meant. "Numărul de concurs: 2
— provizoriu până la închiderea înscrierilor" replaces a sentence that also explained what
would happen if you typed another one; the box below says that by existing.

Nothing about the rules moved: changing by hand is still §105, it still settles the number and
releases the provisional one (§230), and the service still refuses a change once the number is
settled (§173).

Baseline `BR-V1.40-2026-09-21`.

## 233. Decided — the email box says what is wrong, and what you probably meant (2026-09-21)

**Context.** "Ar trebui să văd live dacă emailul e invalid sau nu corespunde cu cel reintrodus…
mailul e cel mai important!"

**Decision, in two halves, and the second is the one that matters.**

*Live invalidity* is the small half: the first box says "that does not look like an address"
once it has been left, by the platform's own `canonicalizeEmail` rather than a second rule
approximated in a regular expression (§198's discipline). It waits for the blur, because
saying it on the fourth character is scolding somebody for typing.

*"Did you mean gmail.com?"* is the half that is worth building. **Every address that has cost
this club a registration was syntactically perfect.** QA's outbox holds three bounced messages
to `…@gmail.con`, and one of the owner's own attempts went to `prinicipal33.com`, refused by
Mailgun with "No MX". A validity check accepts all of them, the server accepts all of them, and
the person is told to go and read an inbox that will never receive anything. Nothing downstream
recovers them: a resend goes to the same wrong address, and the club never learns they tried.

So the useful question is not "is this an address" but "is this the address you meant", and the
only moment it is cheap to ask is while they are looking at it.

*A table, not an edit-distance guess.* The usual approach measures the domain against a list of
popular ones, and it guesses — it will offer `gmail.com` to somebody at a real company domain
one letter away, and a suggestion that is wrong once teaches people to dismiss the next one.
The table only fires on spellings that are **nobody's domain**: `gmail.con` and its like, plus
endings that are not delegated at all, of which `.con` is the one that matters. It is therefore
never wrong about a real address, only silent about a typo it has not seen.

*A suggestion, never a refusal.* `prinicipal33.com` is not in the table and cannot be: it is a
plausible domain, and only DNS knows it has no mail server. Refusing what cannot be verified
turns a typo into a lockout, which §205 forbids.

*The suggestion does not wait for the blur, and the invalidity does.* One needs the address to
parse and the other needs it not to, so they are mutually exclusive by construction — and the
moment a complete address can be questioned is the moment the question is most useful.

*Accepting it corrects both boxes.* The second was typed to match the first, so fixing one
alone would turn a helpful press into a mismatch error. Written through the DOM, because the
boxes are uncontrolled (§211).

Tests: `tests/unit/registrations/email-suggestion.test.ts` (8) — most of them assert the
silence, which is the property that keeps the suggestion worth reading.

Baseline `BR-V1.40-2026-09-21`.

## 234. Decided — the live email checks had never run (2026-09-21)

**Context.** Found while building §233: the new "not an address" message fired for *every*
address in the browser, including correct ones.

**What it was.** `canonicalizeEmail` imported `domainToASCII` from `node:url`. There is no
`node:url` in a browser; Next substitutes a shim whose `domainToASCII` answers `""`, and `""`
is exactly what this function treats as "domain is not valid". So the canonicalizer threw on
every address on the client.

**Why nobody saw it.** `EmailTwice` compares the two typed addresses with that function and
catches a throw as "not an address yet, so nothing to compare" — a sensible-looking guard that
turns a total failure into silence. The live mismatch check of §206, which the owner asked for
in as many words, **has never fired in a browser since the day it shipped.** The server-side
`assertEmailTypedTwice` was carrying the whole feature, which is why no test and no person
noticed: the rule still worked, just a round trip later than intended.

**Decision.** `new URL("http://" + domain).hostname` does the same IDNA-to-punycode conversion
in Node and in every browser. One rule that genuinely runs in both, which was the point of
importing the server's function into the island rather than writing a second one.

*The test is a source-level assertion*, not a behavioural one: vitest runs in Node, where the
old import worked perfectly. Nothing about the behaviour could catch this, so the test reads
the module and fails if it imports from `node:` at all.

**The lesson, and it is why this is its own section.** A `catch` that turns an error into a
benign default will hide a total failure as effectively as it hides the edge case it was
written for. This one read "not an address yet" and meant "this module cannot run here".

Baseline `BR-V1.40-2026-09-21`.

## 235. Decided — the re-sent message says it is one (2026-09-21)

**Context.** §229 made the confirmation screen stop asserting a registration it had not made,
and the owner still said: "I was still able to sign up with the same email again and I had no
idea." He was right that the screen alone does not settle it, and the reason is that the
*email* did not either: filling the form again while confirmed re-sends
`REGISTRATION_CONFIRMED`, QR and all, which reads exactly like a first confirmation. Two of
those in an inbox is indistinguishable from two registrations.

**Decision.** One sentence in front of the body of a re-sent message: you were already
registered for this event, no second registration was created, and what follows is the
registration you already have.

*The inbox is the only place this may be said*, and that is the whole shape of the decision.
Saying it on the form would answer "is this address registered" about **anybody's** address to
anybody who types one — the oracle `AGENTS.md` §19.4 forbids, and the throttle does not help,
because it is keyed on the address being submitted, so a hundred probes are a hundred separate
allowances. What leaks is "this named person will be at this place on Saturday", which is
nothing to almost everybody and is not nothing to somebody avoiding an ex-partner. The inbox
answers the same question to the one person entitled to the answer.

*The sentence is added centrally, not in one template*, because the re-send picks its type
from the state: confirmed gets the confirmation, unsigned gets the declaration, queued gets the
waiting-list notice. All three needed it.

*A registration still waiting for its email confirmation gets no such sentence*, and that is
deliberate rather than an omission: nothing was finished, so "you were already registered" would
be untrue. The right answer there is the verification link again, which is what it already
sends.

*The flag rides in the outbox payload* rather than being derived at render time. Only the
caller knows why a row was queued, and the row is the record of that.

**What this does not fix, said plainly.** Somebody who fills the form twice and never opens
their email still sees a generic screen. §229's sentence is what covers them, and that is as
far as this can go without becoming the oracle.

Tests: `tests/integration/registrations/resubmitted.test.ts` — the queued row carries the flag
and the rendered message leads with the sentence, in both the HTML and the plain text.

Baseline `BR-V1.40-2026-09-21`.

## 236. Decided — the country selector is a flag and a dialling code (2026-09-21)

**Context.** The owner, on a phone: "pe mobil nu arată bine aceste selectoare, scrie doar
codul țării prescurtat, și steagul."

**Decision.** At 132 pixels "România (+40)" renders as "România (+4…" — and the part that
gets cut is the part worth reading. The option is now the flag and the code, which always
fit, and the control gives the width back to the number beside it, which was the field
actually being squeezed.

*An emoji rather than the `Flag` component this form uses elsewhere.* That one is an
`<img>`, and an `<option>` may contain text and nothing else — which is also why this stays
a native select (§84: it works before hydration, a phone knows how to open it, and two
hundred options in a popover is a scroll nobody wants).

*It degrades exactly where it must.* Windows draws no flag for a regional-indicator pair
and falls back to the two letters, so a desktop reads "RO +40" — the abbreviated country
code, which is the other half of what was asked for.

*Still ordered by the country's name*, Romania first. The names are no longer drawn, but the
order they give is the one somebody scanning flags expects; sorting by the emoji would order
by codepoint, which is ISO order and looks arbitrary to anybody not reading the letters.

**The trade, named.** Somebody hunting for a country they cannot picture the flag of now has
only the dialling code to go on. For a club whose entrants are overwhelmingly Romanian —
and Romania is the first option — that is a good trade, and it is reversible in one line if
the club finds otherwise.

Baseline `BR-V1.40-2026-09-21`.

## 237. Decided — the race number goes in the message, labelled while it can move (2026-09-21)

**Context.** The owner, with a confirmation email in front of him: "în acest mail trebuie să
confirm BID-ul. Peste tot trebuie să apară BID-ul!!"

He was right and the omission was mine. §214 stopped writing `bib_number` until registration
closes; the renderer read only that column, so a confirmation went out with a QR, a check-in
code and **no number** — to somebody who had been looking at number 2 on their own page
since the day they registered.

**Decision.** The message carries whichever number the runner has, and says so when it is the
provisional one.

*Absent is worse than provisional.* A missing number reads as "you have not been given one",
and the place they find out otherwise is the desk. A number with a sentence attached reads as
what it is.

*The label is the condition §214 attached to sending it at all.* That section said the
provisional number is never emailed, because a number in an inbox cannot move afterwards.
The rule it was protecting is not "do not send it" but "do not let somebody believe a number
is final when it is not" — which a sentence satisfies, and which the `BIB_ASSIGNED` message
at the settle then completes.

*Appended after the body rather than in front of it*, because the number is already in the
body and this only qualifies it — and centrally rather than in each template, so the
confirmation, the reminder and the rest all gained it at once.

*Nothing is qualified once it is settled.* After the close the number cannot move, and saying
"provisional" then would invite somebody to wait for a second number that is never coming.

Baseline `BR-V1.40-2026-09-21`.

## 238. Decided — the confirmation link presses its own button (2026-09-21)

**Context.** The owner: "when I click from the mail I wanna auto-confirm the email." The link
landed on a page with a Confirm button, which is one press more than anybody expects from a
link that exists to confirm something.

**Decision.** The GET still changes nothing; the page submits the existing POST itself, from
the client, as soon as it has hydrated.

*Why the route cannot just do it.* "Email action links: token hashed at rest, single use, GET
never mutates" is in the unbreakable table in `CLAUDE.md` (`AGENTS.md` §12.8, BR-REQ-036-02),
and the reason is this club's own inboxes rather than purity: **Microsoft 365 Safe Links
fetches every URL in a message before the recipient sees it**, and both work addresses tested
this week are Microsoft tenants. A confirming GET is spent by Defender, and the human clicks a
minute later and is told the link is used. Every mail antivirus and prefetcher behaves the
same way.

*A scanner does not run JavaScript.* That is the whole of the trick: the automatic press is a
`requestSubmit()` in an effect, so it needs a real browser that has hydrated a real page. The
token is spent by a POST, by a person, which is exactly the rule.

*The button is still there.* It is what renders before hydration and the only thing with
JavaScript off — the page behaves as it did, and the press is an enhancement on top of it
(`AGENTS.md` §1.5). The press is fired once, guarded by a ref, because React mounts effects
twice in development.

*The prompt changed with it.* "Press the button below" is no longer true; it now says the
address is being confirmed, and to press the button if nothing happens.

Baseline `BR-V1.40-2026-09-21`.

## 239. Decided — the email's band is the picture, and every message ends with the same links (2026-09-21)

**Context.** The owner, with a confirmation open in Gmail's dark theme: "the email banner must
be edge-to-edge", and "I need more links in that email".

**The banner.** §218 made the header a white table cell with `bgcolor`, which is the strongest
lever CSS has — and it is still not enough. Gmail's dark theme re-colours the cell and cannot
re-colour a raster, so the white band shrank to a white rectangle the size of the 180-pixel
lockup: a sticker on a dark wall, the exact thing §189 and §218 each set out to remove.

So the band **is** the picture. `logo-email-banner.png` is a white canvas the width of the
card with the lockup centred on it, generated by `scripts/brand-assets.mjs` at 1200×340 for a
retina screen. A client may invert everything around it; it cannot invert the inside of a PNG,
and there is no longer an edge between two whites for it to expose. The cell keeps its
`bgcolor` underneath and pads nothing, so with images blocked — the common case on a first
message from an unknown sender — the reader sees the white band and the club's name as `alt`.

**The links.** They were built per template, so which links a message carried depended on
which message it happened to be, and the confirmation of an address — the first mail anybody
gets, and often the only one read carefully — carried none at all.

Every participant message now ends with the same list: the event, its rules, its programme,
the reader's own registrations, the other races, and a way to reach a human. Each is dropped
when there is nothing to point at, and the list is deduplicated against whatever the template
already named, with the template's own wording winning — the reminder calls the event page
something that fits its own sentence.

*Not on the club's archive copy or the staff invitation.* Neither is a participant's message,
and a manage link in either would be a link into somebody else's registration.

Baseline `BR-V1.40-2026-09-21`.

## 240. Decided — editing a repeated event edits the whole series by default (2026-09-21)

**Context.** The owner, on the editor of a weekly run: "by default when I edit a repeated
event, I wanna edit all!"

**Decision.** The date chips open ticked — every date of the series — instead of opening on
"just this date".

*§131 chose the calendar's default and chose wrong for this club.* A weekly run is one event
repeated: the description, the place, the rules and the programme belong to the series, not to
the Monday. Fixing a typo on one date and leaving it on the other seven is the mistake that is
easy to make and hard to notice, and the board currently holds eight Mondays.

*The opposite mistake is louder, which is why this is the safer default.* The ticks are in the
header, above the save; the box over the button says in words how many dates the save reaches.
Somebody who means one date unticks the rest or presses "Niciuna", and is told what they chose
before pressing Save. Nobody can widen a save by accident without the page having said so.

*The scope widened; the merge rules did not.* Only what was changed travels, and a date moved
or cancelled on its own stays that way unless the place or the state is what is being edited
(§131).

*The sentence under a repeated event's header said the opposite* and now says this.

Baseline `BR-V1.40-2026-09-21`.

## 241. Decided — the organizer draws the crop, instead of the code guessing it (2026-09-21)

**Context.** The owner: what the organizer sees in the editor is not what the site renders. The
editor showed the whole photograph; the listing card cut it to 180 pixels from the centre
(`CARD_EXCERPT_SX`, §73). A portrait photograph of a runner became a slice of their chest, and
nobody could see that happen while choosing the picture.

**Decision.** *The crop is four fractions on the image node* — `x`, `y`, `w`, `h` of the stored
photograph — drawn by dragging a box over the picture in the editor's own panel, and honoured by
everything that renders that picture: the event page, the listing card, and the editor itself.

*Fractions, never pixels.* The same document is drawn in a text column, in a card and at 320
pixels. A rectangle measured on somebody's laptop means nothing in any of them; four fractions
mean the same thing in all three.

*The photograph is never touched.* Nothing is re-encoded, no second variant is stored, and
removing the crop restores the whole picture — the stored file is exactly what was uploaded.
This is a rendering decision, so it lives in the document, next to the alignment and the width
share it sits beside in the panel.

*A window, not `object-position`.* `object-fit: cover` can pan a picture inside a box, but the
visible part always keeps the whole of one dimension — you cannot zoom into a corner with it,
and a corner is exactly what somebody cropping a group photograph wants. The arrangement that
can is a window that keeps the rectangle's shape and hides the rest, with the photograph
magnified inside it: `100 / w` per cent of the window's width, pulled left by `x / w` and up by
`y / h`. One function, `cropGeometry`, and two rules built from it — as `sx` for the renderer
and as inline CSS for Tiptap — so the editor cannot drift from the page.

*No dependency.* Every cropper on npm brings a canvas, a zoom gesture, a rotation and an export
pipeline, and each of them is larger than this editor (§1.5: prefer nothing). What was needed is
a pointer listener and a box: drag outside the rectangle to draw a new one, drag inside it to
move it, arrows and `Shift`-arrows for a keyboard, and a line underneath that says in words
where it is — because a control only a pointer can use is not a control everybody has.

*Absent means the whole picture, and that is what every existing body says.* A rectangle dragged
back out to the edges is stored as no crop at all (`meaningfulCrop`), and a picture with no crop
renders the markup it rendered yesterday — a plain `<img>`, no window, byte for byte. A crop is
also refused for a picture whose own size was never stored: the window is shaped from the
photograph's ratio, and a guessed one is a band of background under the picture.

*The card's cap survives as a ceiling.* 180 pixels still bounds a card's picture, but it is now
the exception rather than the rule: a crop wider than about 8:5 never reaches it. The selector
became a child selector in the same change, or it would have reached the photograph inside the
window and fought the magnification that draws the crop.

**What this does not do.** The Open Graph card is drawn from the event's facts — the title, the
date, the place, the distance, in the brand's blue (§90) — and carries no photograph at all, so
there was no second crop there to honour. Putting the cropped picture on the share card is a
product decision of its own and is not taken here.

Tests: `tests/unit/content/rich-text-crop.test.ts` — the geometry, the refusals, the defaults,
and that the editor and the renderer draw from the same function;
`tests/unit/events/card-excerpt.test.ts` — the card caps the window and never the photograph.

Baseline `BR-V1.40-2026-09-21`.

## 242. Decided — the dense cards under the hero keep dropping the summary, and the editor says so (2026-09-21)

**Context.** The owner asked whether it was right that the card under the hero drops the short
description entirely (`underHero`, `SeriesCard.tsx`, `EventCard`), given that the field is
labelled "apare pe card".

**Decision.** *The density stays.* The list under a featured event is "other events" and exists
to be scanned: a heading, a title, a date and a place. §78 already decided that the lead event
must not be followed by a scroll of cards — that is why the list is a disclosure on a phone —
and a summary with a picture in it on every row is exactly the scroll that decision avoided.
The summary is not lost, either: the featured event shows it on the hero, the event's own page
shows it, and the shares carry it.

*The label was the thing that was wrong.* "Apare pe card" promised something that is true on a
filtered listing and false under a hero, and an organizer who writes a summary and cannot find
it has been misled by this application. The field now says where it appears, and the help names
the exception in words.

*What the alternative would have been.* Rendering the excerpt under the hero as words only —
no picture, clamped to two lines — is a real option and a smaller change than it sounds. It is
not taken because nobody asked for the front page to grow, and because the honest label costs
nothing and can be reversed in one line if the club would rather have the words.

Tests: `tests/unit/events/card-excerpt.test.ts` — the rule and the sentence that explains it are
asserted together, so one cannot change without the other.

Baseline `BR-V1.40-2026-09-21`.

## 243. Decided — the club can see what is queued, not only how much (2026-09-21)

**Context.** The owner: "the outbox in /admin — not only /devs. What is actually queued:
message type, recipient, queued at, attempts, last error, and a send now."

The registrations list has had "N waiting" and a "Trimite acum" since §80, and `/devs` has had
counts since §88. Neither answers the question somebody actually asks at 08:40 on race
morning, which is *which* message is stuck and why. A count also hides the worst row: a
`FAILED` message has spent every attempt and will not move again on its own, and it is not
"waiting" — so a club watching the waiting number would never learn it exists.

**Decision.** *A queue panel on `/admin/emails`*, above the templates: the unsent rows oldest
first — type, recipient, when it was queued, how many attempts, the provider's last sanitized
word — with the same "Trimite acum" the list has, bounded by the same allowance.

*Fifty rows, and a sentence for the rest.* The count beside them is the whole queue.

*Rows, not a table.* Five facts about a message do not fit a table at 320 pixels, and a table
that scrolls sideways is worse than a paragraph — the same reasoning §196 applied to the one
place a table is unavoidable.

*Administrator only.* The panel names recipients, which is participant data (§15.11), and
"send now" spends the club's allowance (§80). A Redactor opening the page sees the plan and
the templates exactly as before, and the read is not even issued for them.

*One service, two doors.* The button posts to its own action on this page, and that action
calls the same `sendOutboxNow` the list's button calls — the throttle, the ceiling, the audit
row and the role check are all in one place, and neither door can drift from the other.

**Not included:** no per-row retry, no cancel, no body preview. A body does not exist until
send time (§14.5), and a row nobody can render is a bug to fix rather than a button to press.

Tests: `tests/integration/notifications/club-notices.test.ts` — the queue holds what is unsent,
oldest first, with a `FAILED` row in it and a `SENT` row out of it.

Baseline `BR-V1.41-2026-09-21`.

## 244. Decided — who receives a signed declaration is the club's setting, not the deployment's (2026-09-21)

**Context.** The owner: "CC/BCC for the signed declaration, configurable in the backoffice like
the contact recipients panel (§164), replacing the env-only `DECLARATIONS_ARCHIVE_TO` (§99).
Warn in the UI: the declaration carries the participant's identity document, so a BCC delivers
personal data invisibly."

**Decision.** *The same shape §164 already proved*: one `platform_settings` row, an
Administrator's panel on `/admin/emails`, every address validated by the platform's own
canonicalizer, an audit row naming who changed it and from what. The mailbox for the
declarations, plus a `Cc` list and a `Bcc` list.

*The environment stays as the fallback*, exactly as `CONTACT_FORM_TO` did: the setting wins
when it names a mailbox, `DECLARATIONS_ARCHIVE_TO` answers when it does not, and with neither
no copy is sent — which is what §99 did before this existed. A deployment nobody touches keeps
behaving identically, and `declaration-archive.test.ts` is still the proof of it.

*One "to", many copies.* A message has one address it is *for*; a Cc list with no "to" sends
nothing, because promoting a copy to the recipient would send a participant's declaration
somewhere the club did not choose.

*The copies travel on the row.* They are resolved when the declaration is signed and stored in
the outbox payload, so a list edited tomorrow changes tomorrow's copies and not the ones
already queued. Addresses only — §14.5 keeps bodies and tokens out of the row, and an address
is neither.

*Every copy faces the allowlist on its own.* Outside production, an unauthorized Cc or Bcc is
dropped and the rest of the message still goes. The failure this prevents is the quiet one: an
authorized archive mailbox carrying a colleague's address in Bcc, and QA mailing a real
participant's signed declaration to somebody nobody authorized.

*The warning is above the box, not in a tooltip.* A Bcc hands the participant's name and the
identity document they typed at signing to a mailbox nobody on the message can see. That is
exactly why somebody wants it and exactly why the person setting it should be reading those
words while they do. The platform allows it; the club decides.

**A copy is a message.** Each address spends one of the Mailgun allowance, and the panel says
so — the forecast on `/admin/tasks` counts the archive as one, as it always has.

Tests: `tests/unit/notifications/club-notices.test.ts` (the reading order, the deduplication,
the refusals), `tests/unit/notifications/delivery.test.ts` (the copies face the allowlist),
`tests/integration/notifications/club-notices.test.ts` (what is queued and what is rendered).

Baseline `BR-V1.41-2026-09-21`.

## 245. Decided — the club is told when somebody confirms (2026-09-21)

**Context.** The owner: "tell the club when somebody confirms — a new message type, and
`MESSAGES_PER_COMPLETED_REGISTRATION` 5 → 6 so the Mailgun cost table stays true."

**Decision.** *`CLUB_CONFIRMATION_NOTICE`*: queued in the transaction that confirms a real
registration — by signature or at the desk — to each address the club named on
`/admin/emails`. Who, which event, which race number, and nothing else.

*One row per address*, unlike the declaration's copies above. These are separate notices to
separate people: none of them needs to see who else was told, and a mailbox that bounces must
not hold up another. The address is part of the idempotency key, or the second recipient's row
would collide with the first's and never be written.

*Nothing a participant could act on.* No token, no QR, no check-in code, no attachment — none
of it means anything in a club mailbox, and a manage token there is a secret handed to the
wrong person (§12.8). No test registration, ever (§12.6).

*The cost table follows, and is deliberately one high.* `MESSAGES_PER_COMPLETED_REGISTRATION`
is six, so 100 messages a day is ~16 registrations rather than 20 — `docs/PLATFORM.md` says
the same in prose and a test holds the two together. A club that has named nobody actually
sends five, and the forecast overstating by one is the safe direction for a number whose whole
job is to answer "is there headroom for the window I am about to open?".

Tests: `tests/integration/notifications/club-notices.test.ts` — one notice per address, the
right words, nothing for a test registration; `tests/unit/diagnostics/platform-plans.test.ts`
— the arithmetic the platform document states in prose.

Baseline `BR-V1.41-2026-09-21`.

## 246. Decided — the registrations list opens with a counter, and it costs one query (2026-09-21)

**Context.** The owner: "on the registrations tab I should have a counter! but I wanna make
sure it's performant and light on the DB."

The list has always said how many rows *match the current filter* — which is the pager's
number, not the club's. "How many have signed up for the race" meant filtering by state, four
times, and writing the numbers down.

**Decision.** *A strip above the list*: how many real registrations there are, then each state
it is made of, then the test rows apart.

*One grouped query, and that is the whole of the performance argument.* A strip of five
numbers invites five `SELECT count(*)`, each re-scanning the same rows. This is
`GROUP BY status, kind` over the `WHERE` the list already builds, so the page costs one round
trip more than it did rather than five — which matters on Neon's free compute-hours (§68) as
much as it does in milliseconds.

*Blind to the status filter, and only to that one.* The strip answers "how does this event
stand", so it must not collapse to a single number the moment somebody filters by "confirmate".
Every other filter — the event, the search, the club member, the bounced — narrows it, because
those *are* the question being asked.

*Test rows apart, never inside.* §12.6 keeps a synthetic runner out of every number the club is
given, and hiding them altogether would make the strip disagree with the list underneath, which
does show them with their own chip. So: counted, labelled, and outside the club's own figure.

**Not the navigation tab.** A badge on the tab would be a query on every backoffice page,
including the ones that are about something else entirely — the opposite of what was asked for.

Tests: `tests/integration/registrations/admin-list.test.ts` — each state counted once, the test
rows apart, and the same filters the list uses.

## 247. Decided — the club writes the words, the platform keeps the machinery (2026-09-21)

**Context.** Dani's ask, carried by the owner: the email templates should be editable in the
backoffice. Today every word is in `templates.ts`, so "Ne vedem duminică!" instead of "Ne
vedem la eveniment" is a pull request, a review and a deployment — for a club whose voice is
the whole point of a club.

**Decision.** *The subject and the paragraphs are editable*, per message type and per language,
in the same disclosure on `/admin/emails` that already previews the message, with the preview
directly above the box that changes it.

*Everything else stays in code, and the line is not arbitrary.* The greeting, the facts line,
the action button and the token behind it, the QR, the attachments, the links and the sign-off
are what makes a message **work**: they carry secrets, files and addresses (§12.8, §14.5). A
club that could edit the button's address could send a participant to a link this platform
never minted; a club that could edit the QR could send them to the desk with nothing to scan.
Words are words; machinery is machinery.

*A closed set of placeholders, and no URL among them.* `{participantName}`, `{eventTitle}`,
`{bibNumber}` and nine others. Anything else between braces is refused **when it is saved**,
naming itself — the alternative is a participant receiving literal braces, which is the failure
this kind of feature is famous for. A field a given message does not carry renders as nothing,
with the spacing closed up, and the preview under the editor is where somebody sees that.

*A Redactor's verb, not an Administrator's.* §103 decided that the Redactor writes and the
Organizer organizes; this is writing. The panels beside it — who receives a copy (§244), which
plan the club is on (§100) — stay the Administrator's, because those are about money and
personal data rather than about words.

*One `platform_settings` row, one entry at a time.* The shape §100, §164 and §244 proved. The
audit row names the one message that changed and its before and after, rather than a map of
seventeen types nobody could read in a trail. "Revino la textul platformei" deletes the entry
instead of storing an empty one, so there is exactly one way to be on the shipped text.

*Read once per batch on the send path.* A memo of half a minute, dropped the moment anybody
saves, so a batch of twenty messages reads the setting once and a save is visible on the next
send rather than in thirty seconds. The preview reads straight through, because somebody who
has just pressed Save is looking at it.

*The platform's two framing sentences survive a rewrite.* "You were already registered" (§235)
and "this number is provisional" (§237) are statements about the state of a registration, not
about how the club likes to write, and a rewritten confirmation would otherwise silently lose
them.

Tests: `tests/unit/notifications/email-copy.test.ts` — the placeholders, the refusals, and that
only the words move; `tests/integration/notifications/email-copy.test.ts` — who may write, what
the worker renders, the audit row, and the reset.

Baseline `BR-V1.41-2026-09-21`.

## 249. Decided — the club designs its own race number (2026-09-21)

**Context.** The owner: "I wanna be able to design the BIDs." A bib had exactly one decision on
it — the band's colour (§173) — and everything else was `bib-design.ts`'s opinion: the club's
lockup at the left, the race and the date at the right, the number filling the card, the name
under it, the partners along the foot.

**Decision.** *Three things at once, because they are one question.* What is printed (the
runner's name, the event, the date, the logo, cut marks); how large the number is and where the
name sits; and a picture of the club's own instead of the coloured band, with a strip of
sponsors above the small print.

*One JSON column, `events.bib_design`.* None of it is ever queried — a bib is drawn, never
filtered — and eight columns would be eight migrations before the ninth setting. `readBibDesign`
is the only reader and it **never throws**: every field falls back on its own, and a column
written by an older release reads as the platform's design. A bib that prints plainly beats a
bib that does not print.

*The two renderers stay in step through a factor, not a font size.* `bibs-pdf.ts` measures in
points on A4 and `bib-image.tsx` in pixels for the screen, so a shared size is impossible; a
shared **multiplier** is not. That is what keeps the preview a preview of the paper, which is
the property §180 bought and this must not spend.

*A picture is one this site stored.* The same rule the editorial body's images follow. A third
party's address would be a request to somebody else's server every time the club prints, and a
way to make this application fetch an arbitrary URL on an operator's behalf. The sheet fetches
each picture with a five-second deadline and a four-megabyte ceiling, and anything that fails
prints the coloured band — the sheet is what a volunteer is waiting for at a printer.

*White or ink on the band, worked out rather than assumed.* The palette offers yellow, and a
white event title on yellow was a race nobody could read at the start line.

*The panel posts a marker.* A checkbox that is off posts nothing, so a form without the panel —
the create form, an older caller — would read as "every switch off" and silently redesign a
bib. `present=1` says the design was on screen; without it the save writes no column at all,
exactly as the partners' list has done since §169. The integration test is what caught this:
the first version wrote `null` whenever the key was absent.

*No JavaScript.* Checkboxes, two selects and radio buttons over the pictures already uploaded.
The preview is the picture the bibs page already draws, after a save.

**What is not offered.** Free positioning, fonts, a colour per element: a bib is read across a
field, and the decisions that matter are the ones above. Portrait bibs and a design per distance
wait for multi-distance races (M2).

Tests: `tests/unit/registrations/bib-design.test.ts` — the fallbacks, the picture rule, the
contrast, the factor; `tests/integration/cms/bib-design.test.ts` — saved, read back by what the
renderers call, and left alone by a form without the panel.

Baseline `BR-V1.42-2026-09-21`.

## 250. Decided — the entry list is a table, and a long one is paged (2026-09-21)

**Context.** The owner, looking at "Cine vine" on an event page: "I want the participants table
to be a real table! with pagination."

It was two columns of flowing names — which is what a class list looks like, not what an entry
list looks like — and it rendered every confirmed runner at once. At forty names that is a
paragraph; at four hundred it is four hundred rows on a phone, fetched in full on every view of
the event page.

**Decision.** *Three columns*: the position in the confirmed order, the name, the club. That is
what somebody scans an entry list for — am I on it, and who else from my club is — and the
position is also what tells two runners with the same name apart.

*Fifty to a page, and the page is a link.* `?lista=2` on the event's own address, server-side,
plain anchors: no JavaScript, and the disclosure renders **open** when a page is asked for, or
a reader following a page link would arrive at a closed box.

*Two counts, then one slice.* The page asks how many are named and how many are unnamed, works
out what it holds, and fetches only those rows. A list of four hundred costs fifty rows, not
four hundred — the same discipline the registrations counter took (§246).

*The unnamed runners come last, and keep their line each.* §186's rule is unchanged: somebody
who asked to be left off is counted, never named, and gets a row of their own rather than being
summed into "and 3 others". They sit after the named rows so that nobody *else* changes page
when one more runner opts out.

**What did not change, deliberately.** Who is listed (confirmed, real, opted in — §32, §143),
and what a row may carry: the display name and the club, which is the repository's select list
and what `tests/privacy/public-surface.test.ts` refuses to let widen. No race number, no state,
no address. A public list is a disclosure and this widened the *format*, not the disclosure.

Tests: `tests/unit/registrations/start-list-page.test.ts` — the slice each page asks for, the
boundary where named rows give way to unnamed ones, and a page number typed by anybody.

Baseline `BR-V1.41-2026-09-21`.

## 251. Decided — the front page is the events; the calendar is a tab (2026-09-21)

**Context.** Three instructions in one evening, all about the same page. "On the event card I
wanna be able to see pictures in the preview." "The calendar should be a tab, after events, and
not show on the homepage." "The hardcoded pages should be: Events, Calendar, Contact, then
separators and the rest of the custom pages."

**Decisions.**

*Every card carries the summary, pictures and all — §242 is reversed.* §242 kept the list under
the featured event dense, on §78's reasoning that a lead event must not be followed by a scroll.
That reasoning was sound when a picture in a summary was whatever height the photograph
happened to be; §241 gave the organizer the crop, so the card's picture is now a decision rather
than an accident. With that, the owner wants the pictures, and the honest label — "apare pe
card" — is true again on every card. The list's heading follows: "Toate evenimentele", not
"Alte evenimente", because with the summaries back it is simply the list.

*The calendar is `/calendar`.* It lived at the top of the listing, which is the site's front
page, above the events themselves — so the first thing a visitor met was a grid of squares
rather than the next run. The grid is what somebody planning a month wants, and that is worth
an address of its own and a bookmark. `CalendarSection` is the whole of it, moved unchanged;
what *did* change is that every control inside it takes the page it is on as a prop. They were
written against `/events` and would otherwise navigate away from the calendar — which the e2e
caught, pressing "next month" and landing on a page with no calendar at all.

*The menu is the platform's sections, then a rule, then the club's pages.* Events, Calendar,
Gallery, Contact — the four this application ships, in that order — a hairline, and then
whatever the club has written. The gallery stays with the four rather than with the pages
because it is a section this application ships, and it is still offered only when a published
album exists. The rule is an item in the row like any other, so the priority+ fold measures its
width and folds it with everything else; in the folded menu it is a divider.

Tests: `tests/unit/events/card-excerpt.test.ts` — the summary is on every card and the editor's
help text no longer claims otherwise; `tests/e2e/event-pages.spec.ts` — the month, the list and
the arrows on their new page; `tests/integration/cms/boundary.test.ts` — the route list.

Baseline `BR-V1.41-2026-09-21`.

## 252. Decided — a wider page that carries less air (2026-09-21)

**Context.** The owner, with a screenshot of a 2560-pixel screen: "the website can span a bit
wider and there is too much whitespace overall and padding", then "pagina poate fi chiar și mai
lată", then "folosește spațiul mai eficient".

**Decision.** *One number for the width.* `PAGE_WIDTH` is `xl` and every page reads it, so the
page's width is the theme's `xl` breakpoint: **2040 pixels**, up from MUI's 1536. Nineteen
`maxWidth` props stay exactly as they are.

*Prose does not get wider.* `PROSE_MEASURE` still holds anything read line by line to about
seventy-five characters. What gained room is what benefits from it: the cards, the calendar grid
and the backoffice tables.

*A third less vertical padding*, everywhere at once: every page's `py` went from 3/6 to 2/3, and
a card's inside from MUI's 16 and 24 to 12 — one theme override rather than a number in each
card.

*And the listing is a grid.* One column on a phone, two from `md`, three at `xl`. A single
column of full-width cards on a 2040-pixel page is a stripe of text with a field of nothing
beside it, which is exactly what "folosește spațiul mai eficient" was pointing at. A CSS grid,
so the rows line up whatever length the summaries are, and still a `<ul>` of `<li>` cards for a
screen reader and for a reader with no CSS.

**What this must not break**, and what the tests hold: 320 pixels stays the hard target — the
grid is one column there and nothing scrolls sideways — and every tap target keeps its 44
pixels. `tests/e2e/event-pages.spec.ts` asserts both on the listing.

Baseline `BR-V1.41-2026-09-21`.

## 253. Decided — the club's email has a tab (2026-09-21)

**Context.** The owner, with a screenshot of the backoffice navigation: "I am missing the email
templates config and email CC/BCC stuff in this navbar."

He was right, and the reason was worse than an ordering mistake: `/admin/emails` had **no entry
at all**. It was reachable from one link inside `/admin/guide` and from nowhere else — so the
plan (§100), the contact recipients (§164), the outbox queue (§243), the club's copies (§244)
and the editable wording (§247) had all been built onto a page nobody could navigate to.

**Decision.** *"Emailuri", after the legal documents*, offered to the roles that may read the
club's content (`canReadContent`) — because the words in a message are the Redactor's work
(§103, §247). Each panel on the page keeps asking its own question behind that: the queue and
the club's copies name recipients, which is participant data, so they are read only for a role
that may see it (§243, §244), and the plan is an Administrator's to change (§100).

**The lesson worth writing down.** `ADMIN_SECTIONS` is the list the navigation is built from, and
a page can exist for weeks without being in it. A new backoffice route is not finished until it
has an entry there and a line in `tests/unit/staff/roles.test.ts`, which asserts that every role
is offered every section the role below it is.

Baseline `BR-V1.43-2026-09-21`.

## 254. Decided — the anti-bot check is a switch, not a deployment (2026-09-21)

**Context.** The owner: "I wanna be able to enable/disable the captcha from the backoffice."

Turnstile has been behind `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` since §97, so turning
it off meant editing two Vercel projects and waiting for a build. The day that is needed is the
day the widget is refusing real people — which happened on 2026-09-21, twice, to Dani (§216) —
and on that day a deployment is the wrong unit of response.

**Decision.** *One stored flag, `platform_settings.botCheck`, default **on**.* A missing row does
not remove a defence, and a database that cannot be reached answers "on": a form that refused to
render because a settings table was unavailable would fail the one thing this site exists to do,
and a challenge is the safe side of that failure.

*Off means what "no keys" already meant.* The widget is not rendered and no token is verified —
the same path a deployment without keys takes, which is code that already existed and is already
tested. Nothing new had to be taught about refusing or accepting.

*The quieter defences are untouched.* The honeypot, the timing check and the per-address throttle
(§19.4) cost a visitor nothing and stay on whatever this says. The panel says so, because
"switch off the captcha" should not read as "switch off the door".

*One function, four callers.* `activeBotCheckSiteKey` for the two forms and `botCheckIsOn` for
their two actions, memoized for half a minute and dropped the moment the switch moves. A switch
that half the entry points ignored would be worse than none — the club would believe the check
was off while the registration form still refused people — so a test asserts all four read it.

*Administrator only, audited both ways.* The same gate as the Mailgun plan (§100) and the club's
copies (§244); the trail records the direction, because turning a defence off is exactly the
decision a trail is for.

*It lives on `/admin/tasks`.* That page already carried the row that says whether the check is
configured, and that row now reads "done" only when the check is configured **and** on — a task
board that called it done while it was off would be lying about a defence.

Tests: `tests/integration/registrations/bot-check.test.ts` — the default, the switch, the role,
the audit row, and that all four entry points consult it.

Baseline `BR-V1.43-2026-09-21`.

## 255. Decided — the tab says how many are signed up, for about one query a minute (2026-09-21)

**Context.** The owner, of the backoffice navigation: "can I see a counter of registered people
here? but DB efficiently! please note we use a light DB."

I had declined exactly this an hour earlier — a badge in the shell is a query on every
backoffice page, including the pages that are about something else — and he asked for it with
the cost named. So the answer is the badge *and* the arithmetic that makes it cheap.

**Decision.** *A memo with a minute's life.* One indexed count, kept for sixty seconds in the
process. An evening of backoffice work costs a handful of queries instead of several hundred,
which is the difference that matters on Neon's free plan — it bills compute time (§68). The
badge may be a minute stale; the list itself is always exact, and nobody reads a tab that way.

*Only for the roles that may open the list*, so for everybody else there is no query at all.

*What it counts is what a club means by "signed up"*: active registrations — waiting for an
email, waiting to sign, offered a place, on the waiting list, confirmed — of real people, on
events that have not started. Cancellations are gone, last month's race is history, and a test
registration is never inside a number the club is given (§12.6).

*The figure is part of the label rather than a badge element.* A badge is absolutely positioned
and would sit over the tab's own underline at 320 pixels; "Înscrieri 42" is what somebody wants
to read.

*A failure means no badge.* The shell renders on every backoffice page, including the ones whose
purpose is to work when something is broken — `/admin/tasks`, `/devs`. A count is not worth a
500, so an unreachable database renders the tab exactly as it did before this existed.

Tests: `tests/integration/registrations/nav-count.test.ts` — what is counted, what is left out,
and that the memo answers instead of the database.

Baseline `BR-V1.43-2026-09-21`.

## 256. Decided — every list has the same verbs in the same place (2026-09-21)

**Context.** The owner: "I wanna be able to do CRUDs everywhere, and have more consistency!"

The audit was the surprise: the verbs were **all there already**. Events, pages, albums, photos,
staff and registrations each had create, save and delete in their services and their actions.
What differed was the shape a club member meets:

- the **events** list had a ⋮ with confirmations (§118);
- the **pages** list had two position arrows and no verbs at all — editing meant opening the
  row, publishing meant opening it too, deleting meant finding the button inside it;
- the **albums** list had nothing in the row;
- the **staff** list had five controls in one row, stacked on a phone, and two of them —
  "dezactivează contul" and "retrage accesul" — fired on a single press with no question;
- the **pictures** list had one verb with a proper confirmation.

**Decision.** *One rule, three shapes.* Every list is an `AdminTable`. A row with two or more
verbs puts them in one shared ⋮ (`shared/ui/RowMenu`, moved out of the events module and given
the glyphs the other lists need). A row with exactly one verb keeps it as a button that
confirms — a menu for a single action is a press for nothing. And anything destructive asks,
wherever it lives.

*So:* pages gained edit, publish/unpublish and delete in the row; albums the same; staff moved
its four verbs into the menu and each now asks, which is the part that matters — a
single-press "take their access away" in a table is a mis-tap away from locking somebody out.
The role select stays inline on the staff row, because a role is a value rather than a verb.

*Two list rows grew a version column* (`pages`, `gallery_albums`) so the list can publish
without opening the row: the transition already refused a stale version, and that guard is what
keeps two open tabs from fighting.

**What was not done, deliberately.** No new verbs. "CRUD everywhere" was a request about reach,
and the reach was there; inventing a verb nobody asked for — a bulk delete on pages, say — would
be a new rule rather than a consistent surface for the rules that exist.

Tests: `tests/unit/staff/admin-lists.test.ts` — every list an `AdminTable`, the ⋮ wherever a row
has more than one verb, a confirming button where it has one, and no destructive verb on a plain
button.

Baseline `BR-V1.43-2026-09-21`.

## 257. Decided — a tooltip with a list in it puts each item on its own line (2026-09-21)

**Context.** "Unde a ajuns" on a registration row explains six states in one tooltip, and the
legend arrived as one paragraph of dashes: the owner, looking at it — "acest tooltip ar trebui sa
aiba liniute una sub alta". A legend read as prose is not a legend.

**Decision.** The tooltip renders `pre-line` at a 360-pixel ceiling, and the strings carry their
own line breaks (`\n– ` per item). No list markup inside a tooltip: MUI's tooltip is a single
text node by design, and the alternative is a popover with a focus trap for six words a line.

*So:* `shared/ui/InfoTip` sets `whiteSpace: "pre-line"` and `maxWidth: 360` on the tooltip slot,
once, and every legend on the platform gets it. The bounded width is the part that is not
cosmetic — a tooltip as wide as a desktop is unreadable whatever the line breaks say.

Baseline `BR-V1.43-2026-09-21`.

## 258. Decided — the picture's panel in the editor can be closed, and stays next to its picture (2026-09-21)

**Context.** Selecting a picture in the rich-text editor opens a panel — the crop box, the width,
the side, the caption, remove. Two complaints, one screen apart: "editorul de poze ramane
floaiting ind reapta random" and "ar trebui sa pot anula sau inchide pur si simplu".

Both came from the same root: the panel's only open/closed state was Tiptap's own selection. It
had no way out that did not also deselect the picture the organizer was working on, and its
`Popper` had one overflow modifier, so a picture near the right edge pushed the panel over the
header and the navigation.

**Decision.** *Closing is a dismissal, not a deselection.* The panel remembers the document
position it was dismissed at; pressing the same picture again opens it, moving to another picture
opens that one's. An ✕ with a heading, and Escape — which is what somebody nudging the crop box
with the arrow keys will reach for.

*Anchoring is three Popper modifiers and nothing clever:* `offset` for eight pixels of air so it
reads as attached rather than part of the picture, `flip` to go above when there is no room
below, and `preventOverflow` with `boundary: "clippingParents"` so it is kept inside the writing
area instead of the viewport. A `maxHeight` of `calc(100vh - 32px)` with its own scroll, because
the panel is taller than a laptop once the crop box is in it.

"Gata" stays and is a different verb: it moves the caret past the picture so typing continues
after it.

Baseline `BR-V1.43-2026-09-21`.

## 259. Decided — every editor shows the two languages as tabs (2026-09-21)

**Context.** The owner: "in pagina de eveniment pot vedea continutul biling unul sub altul, pe
alte eveniment eil vad in tabs, hai sa fim consistenti!". The event editor has had a tab per
language since §170. The standing-pages editor and the album editor stacked them, and argued for
it in a comment: a page carries four fields, and both languages at once makes "the English one is
empty" obvious *before* publication is refused.

**Decision.** Tabs everywhere. The argument stopped being true when a page's body became a
rich-text editor — two editors stacked is two screens of scrolling to reach the English title —
and the incompleteness it protected is caught twice over anyway: by the publish rule
(`AGENTS.md` §11.2) and by the "incomplet" mark the tab itself carries.

*So:* `LocaleTabPanels` moved from the events module to `shared/ui`, unchanged, because the
thing that makes it safe is already in it: **the hidden panel stays in the form.** A panel that
unmounted on a tab change would post nothing for that language and the save would write empty
strings over somebody's English text. With JavaScript off the first tab shows and the rest are
unreachable — a degradation, not a data loss, since every hidden field still carries its
`defaultValue`.

Baseline `BR-V1.43-2026-09-21`.

## 260. Decided — the summary comes first, both descriptions fold, and a card's picture keeps its shape (2026-09-21)

**Context.** Three messages about the same panel. "de asemenea partea de rezumat si descoere
completa trebuie sa gie in acordeoane colapsabile", then the reason for the order — "si prima
oara vad rezumat, apoi descriere full, asta e flow-ul logic" — and then, about the picture inside
the summary, "cumva editorul nu e perfect, imainea arata diferit in card preview fata de cum e in
editor" and "practic pe card au o inaltime fixa, ceea ce e cam gresit".

§170 had decided the other order: the description first, "because it is what the writer came here
to write", with the summary under it. The cost was a language panel two screens tall with two
Tiptap instances mounted before anybody typed a character, and a *required* field sitting below
the description that kept being left empty.

**Decision.** *The panel is the visitor's order.* Title, summary, full description, rules,
programme, what to bring, then the folded search-engine fields. The card, the hero and every
share carry the summary; the description is what somebody reads after deciding to look.

*Every long text is a fold.* Both descriptions are `LazyRichTextEditor` now, like the rules and
the programme: the editor mounts when the section is opened, and until then the stored document
rides in a hidden field — so a save that never opened a section never changes it. Ten Tiptap
instances across two languages became none until asked for.

*The emptiness §170 was worried about is answered on the closed fold*, not by the save: the
summary's fold says "obligatoriu înainte de publicare" while it is empty, which is earlier than
the refusal ever was.

*A picture on a listing card has the shape it has.* The card capped every picture at 180 pixels
and cut the rest from the centre — a crop nobody asked for, nobody could see, and which is why
the editor and the card disagreed. It is gone: `height: auto` and no ceiling. The organizer's own
crop box (§241) is where a portrait photograph becomes a band, and that is a choice made while it
can be seen. The two card rules that remain are about the *column* — a figure takes the whole card
whatever share of a page's column it was given, and a float goes back into the flow — because a
card has one narrow column and no side.

Tests: `tests/unit/content/editor-order.test.ts` (the order, four folds, no eager editor, the
required hint in both languages) and `tests/unit/events/card-excerpt.test.ts` (no fixed
measurement left in either direction).

Baseline `BR-V1.43-2026-09-21`.

## 261. Decided — a tooltip only where the row cannot show the words itself (2026-09-21)

**Context.** The owner, on the calendar's list view: "pe calendar tooltipurile nu ar trebui să
apară pe list view, sunt destul de enervante" — with a screenshot of a tooltip lying across two
agenda rows, repeating the line underneath it word for word.

**Decision.** `CalendarEventChip` keeps its tooltip in the month grid and drops it everywhere
else. In a grid column some 40 pixels wide the chip is a stack of glyphs over a time and the
title is cut or not drawn at all, so the tooltip is the only place the title exists. An agenda
row carries the whole sentence, and `enterTouchDelay={0}` — right for a grid, where a tap is how
a phone reads a chip — made the repetition pop up on every tap there.

The link's `aria-label` is the whole sentence in both cases, so nothing is lost for a screen
reader where the tooltip is gone.

*The general rule, worth stating once:* a tooltip is for what does not fit, never a second copy
of what does. §257 is the same rule about a tooltip's shape; this is about whether it should
exist at all.

Tests: `tests/unit/events/calendar.test.ts` — the dense case keeps the tooltip, the agenda case
returns before it, and the accessible name is on the link either way.

Baseline `BR-V1.43-2026-09-21`.

## 262. Decided — the phone's header row carries all three sections; the language moves to the bottom bar (2026-09-21)

**Context.** The owner, with a screenshot of his own phone: "ar putea oare încăpea 'evenimente,
calendar, contact' în toolbarul de sus pe mobil? ar fi fain să le avem pe toate, eventual mutăm
selectorul de limbi în dreapta jos?" The row showed Evenimente and Calendar; Contact was in the ☰.

The row is measured rather than broken at a breakpoint (2026-09-17), so this was never a rule to
change — it was a width to find. At 393 pixels the container is 361 of which the lockup takes 63
and the stacked RO/EN switcher 46.

**Decision.** *The language switcher is the header's on a desktop and the footer's on a phone.*
It goes in the bottom-right corner of the bar whose bottom-left corner already holds the scheme
switch (§115), positioned on the bar for the same reason the social marks are — the line belongs
to the `<summary>`, and a flex row cannot put a sibling between a summary and its panel. The
build badge is `static` on a phone, so nothing else wants that corner at that width.

*Two instances, one announced.* The header's copy is `display: none` below `sm` and the footer's
above it, which keeps each in the tree exactly where it is drawn — so a screen reader finds one
"Limbă" navigation at every width, and no page has two ways to change the language.

*The sections' words are 14 pixels on a phone* rather than 15 (§158 set the step). Fifteen pixels
across three labels, spent on whether "Contact" is on the row.

*What did not change:* the lockup's size — 30 pixels tall on a phone is already the floor at which
the club's own lettering inside it still reads (§158) — and the folding itself, which still decides
from measurement. At 320 pixels three sections genuinely do not fit and the ☰ is the right answer.

Tests: `tests/e2e/header-nav.spec.ts` — the three sections visible on the row at 393, nothing
overflowing sideways at 320, and exactly one language switcher, in the footer on a phone and in
the header on a desktop.

Baseline `BR-V1.43-2026-09-21`.

## 263. Decided — a table says how it is drawn, and the editor draws it that way (2026-09-21)

**Context.** The owner, twice. First "tabelele arată strange", and then the ask: "la tabele ar
trebui să pot alege border and stuff, ca să pot folosi tabelele și ca și layout, și să pot centra
info în ele".

Two separate things were wrong. **The editor had no table rules at all** — the page drew a full
grid with a shaded header row, the writing area drew whatever a browser does with an unstyled
`<table>`, which is nothing — so a table was arranged against one drawing and published as
another. And a table could only ever be a grid, which is why using one to lay two columns of text
side by side looked like a spreadsheet somebody had left in the page.

**Decision.** *Two attributes on the table node, and one description of the drawing.*

- `borders`: `all` (the grid every table already has), `rows` (horizontal rules only — what a
  price list or a printed timetable wants), or `none` (no lines, which is what makes a table
  usable as a layout). In `none` the header row keeps its weight and loses its shading: bold is a
  heading, shaded is a table's chrome.
- `valign`: `top` as before, or `middle`.

*Horizontal centring needed nothing.* A cell holds paragraphs and a paragraph has carried its own
alignment since §213, so the toolbar's centre button already centres a cell's words — and finding
that out was cheaper than adding a second alignment that would have fought it.

*`table-layout.ts` is the one description*, the way `image-layout.ts` is for a picture: the page
takes an `sx` from it, and the editor takes a block of rules keyed on `data-borders` /
`data-valign`, which is how a ProseMirror node carries a choice into CSS. A borderless table gets
a dashed outline **in the editor only**, because a writer still has to see where the cells are.

*The default writes nothing.* `all` and `top` emit no attribute, so a table stored before today
parses to exactly itself — no migration, and the golden-string tests stay green. The editor's
`parseHTML` validates rather than trusting, because an unknown word would become an attribute the
server's allowlist then refuses, which is a save that fails for a reason nobody can see.

*Three controls, and they only appear inside a table* (§196's rule): one that cycles the borders
and is **named after the state it is in** ("Linii: doar orizontale (apasă pentru niciuna)"), one
for the vertical middle, and Tiptap's own header-row toggle — a layout table has no header row,
and a table that grew one by accident had no way to lose it.

*Also, since it was the same complaint:* the pages and album editors called English "Engleză"
while the event editor called it "English". One name now, the language's own, from `Site` (§259).

Tests: `tests/unit/content/rich-text-tables.test.ts` (the allowlist, the defaults, each variant's
rules, and that the page has no rules of its own) and `tests/e2e/rich-text-tables.spec.ts` — a
table drawn in the editor, restyled, saved, published, and the computed border width of a real
cell read back as zero.

Baseline `BR-V1.43-2026-09-21`.

## 264. Decided — the bibs are downloaded in batches from the registrations list, and the club marks them printed (2026-09-21)

**Context.** The owner: "ar trebui să pot descărca BID-urile din pagina de înscrieri ca și batch!
și să pot marca 'BID printat'". The sheet existed — `/api/admin/events/<id>/bibs`, with a preview
page of its own since §180 — but only from the event's own screen, and it had no memory. Numbers
arrive in waves: somebody registers on Thursday, the sheet went to the printer on Wednesday. The
club's only choices were reprinting everything or remembering.

**Decision.** *One column and one scope.*

- `registrations.bib_printed_at` — **a timestamp, not a flag**, because "when" answers what a
  flag cannot: a bib printed before the design changed has to be printed again.
- `only=unprinted` on the sheet route, and `countBibs` for the two numbers the list shows. The
  scope is one `WHERE` used by the list, the count and the marking, so they cannot drift apart.

*The mark is its own press, beside the download and not inside it.* The sheet is a `GET` so it can
be opened in a tab, saved, mailed to whoever has the printer and opened again — and a GET does not
mutate (`AGENTS.md` §12.8). It is also honest: a PDF that downloaded is not a bib that printed,
and only the club knows whether the printer had paper.

*Marking is idempotent over the scope.* A row already marked keeps the timestamp it had, so a
second press does not rewrite when the first batch went out — which is the fact that distinguishes
"printed with Wednesday's sheet" from "printed just now". One audit row per batch, naming the
event, the scope and the count and **no participant**: a printing record is not a record of who
was printed (§67's rule about what an audit row may carry).

*On the registrations list*, because that is the screen the club works from on race week: how many
of the event's bibs are printed, a button for the unprinted batch, one for all of them, and the
mark. Only with a single event selected — "all events" has no sheet — and only when it has numbers.

*On the row*, a green tick beside a settled number with the date in its title, and the verb in the
⋮ to mark one printed or not, which is the reprint of a single creased bib. Never on a provisional
number (§214): that one is printed nowhere by design.

*Who:* whoever may manage registrations, asserted in the service — the sheet is already
Administrator-only, and the record of having printed it is the same information.

Tests: `tests/integration/registrations/bibs-printed.test.ts` (the unprinted scope, the
idempotence with two dated batches, the single-bib mark, the refusals, the role) and
`tests/unit/registrations/row-verbs.test.ts` (offered only with a settled number, one direction
at a time, before erase).

Baseline `BR-V1.43-2026-09-21`.

## 265. Decided — the configuration screens are panels, not one scroll (2026-09-21)

**Context.** The owner: "partea de configurare ar trebui să aibă subtaburi, pt status, general,
mailuri, captcha, etc". Two screens had each grown to six or seven sections on one scroll —
`/devs` is six hundred lines, `/admin/tasks` seven hundred — so "where do I turn the anti-bot
check off" meant scrolling past Neon's compute hours or the price of every service the club uses.

**Decision.** *A `?panel=` query and a row of sub-tabs, on both screens.*

- `/devs`: **status** (the verdict, the schema and the jobs, Neon's month, Vercel's month, what
  each limit does, the runtime), **general** (which variables are present — never a value, §8 —
  the rate limits, what each setting can be, who may do what), **email** (today's volume against
  the plan, and what was captured locally).
- `/admin/tasks`: **todo** (what is owed, its filters, the open decisions), **botCheck** (the one
  switch that lives here, §254), **costs** (what the club pays and what the next thing costs).

*A query parameter rather than a route each.* Every panel needs the same session and the same
reading of the system — `/devs` maps `env` to booleans before it renders anything, which is the
last code in the repository worth duplicating — so three routes would be three copies of one
page's head. Anything unknown in `panel` reads as the first panel, never as an empty screen.

*The two screens name each other.* `/devs` offers "Anti-robot", which is the club's switch on the
other screen; the to-do screen offers "Sistem", when the reader's role may see it. They are two
halves of one question the club asks together, and a sub-tab that crosses a route is cheaper than
moving a control away from the people who need it.

*`shared/ui/SubNav`* is a Server Component of plain anchors — the same decision `GallerySubNav`
records: `AdminTabs` is a client island only because a layout cannot know which page it wraps,
and a page always knows which panel it is showing. So this works with JavaScript off, and the
current panel carries `aria-current="page"` rather than colour alone.

Tests: `tests/e2e/config-panels.spec.ts` — each panel shows its own sections and not the others,
a bare URL opens the first, a nonsense panel falls back, and the cross-screen sub-tab lands on the
switch. `tests/e2e/tasks-cost.spec.ts` now opens the costs panel by its URL.

Baseline `BR-V1.43-2026-09-21`.

## 266. Decided — a film in the text is a figure, sized like a picture (2026-09-22)

**Context.** The owner: "that YouTube video must be embedded and resizable, not as a separate
section". §110 put a film in the editorial body behind a closed disclosure with a bordered frame
and a play line above it — which is a *section*, always the full width of the column, whatever
the organizer wanted, because the node had no width to choose.

**Decision.** *The film takes the picture's two attributes and the picture's own geometry.*
`widthPercent` (100 / 75 / 50 / 33) and `align` (block / left / right), the same closed sets, read
through the same defaults, and drawn by the same function — `imageFigureSx`. So a film beside a
paragraph behaves exactly as a photograph beside one, down to becoming a full-width band below
`sm`, and choosing a side from a full-width film halves it in the same transaction, which is the
picture's rule (§193).

*What did not change is the part that carries trust:* nothing is fetched from Google until the
reader presses. The privacy notice says so ("YouTube, loaded when you press"), so the player is
still a native `<details>` with a lazy iframe inside it — a closed disclosure keeps the iframe
out of the viewport, so there is no request, no cookie, no script on load.

*What changed is that the summary **is** the player's frame*: a 16:9 rectangle in the event's ink
with a ▶ in the middle, and opening it hides the summary so the film fills exactly the box the
poster filled. No border, no heading line, no thumbnail from `i.ytimg.com` — that last one would
be the very request this shape exists to avoid. The editor keeps its thumbnail, where the request
is the organizer's own doing (§110), and draws the film at the chosen width, because a film sized
to half the column and shown full-width in the editor is the editor lying (§263's lesson).

The notice under the frame is a caption now rather than a panel, joined to the organizer's own
caption by a middle dot: it still says what pressing will load.

Tests: `tests/unit/content/rich-text.test.ts` — the two attributes survive the allowlist, the
defaults are filled as a picture's are, and anything outside the closed sets is refused.

Baseline `BR-V1.43-2026-09-21`.

## 267. Decided — the events already held are a section at the foot of the listing (2026-09-22)

**Context.** The owner: "old or closed events must be shown at the bottom on a different
category". The listing shows what is still to come and nothing else (§167 added one exception:
between seasons it leads with the club's last event so the page is not blank). Everything the
club has held was therefore reachable only through the calendar's month view — so somebody
looking for last month's race, or for the page with its photographs, had nowhere obvious to go.

**Decision.** *A section of its own, at the foot, folded at every width.*

`listPastEvents` is the query — finished, newest first, a limit — and the newest-first order is
the point: the page above asks "what is next", this asks "what did we just do". Races do not come
first here, unlike the listing proper; once an event is over its kind no longer ranks it.

*Folded at every width*, unlike the "other events" fold above it, which opens from `sm` up (§78).
The difference is the meaning: what is to come is what the page is for, and what is past is
something a reader goes looking for. A closed `<details>` also costs a phone nothing to scroll by.

*Twelve, and the calendar for the rest.* A weekly run is fifty rows a year, so the section is a
window rather than an archive, and its own line says where the rest lives (§107, §116) instead of
growing a pager nobody would page through.

*Its own `<Suspense>` boundary and its own query*, so nothing above it waits for it — the lead
and the list keep the two-query page they had (§166). Between seasons it skips the one row the
lead is already showing, which would otherwise be the same card twice on one page.

Tests: `tests/integration/events/publication.test.ts` — finished only, newest first, and never
more rows than asked for.

Baseline `BR-V1.43-2026-09-21`.

## 268. Decided — which language a message is previewed in is a tab, and the tab row has no bare words (2026-09-22)

**Context.** Two things the owner saw on one screen this morning. On `/admin/emails`, "Română
English" under the intro: two underlined words in a row, the current one told apart by being
bold. "These need to be tabs." And on the backoffice tab row itself, "Emailuri" was the one
entry with no glyph in a row of eleven, and the registration count sat in the label in the same
ink as the word — "I am missing the icons for the email … for the registries I need a different
color for the number".

**Decision.** *The language switch is `SubNav`*, the row §265 already uses for a panel switch
inside a section. Two of them now exist for the same job, so there is one control for "which
view of this page am I looking at" rather than a different one per screen. It stays anchors
rendered on the server, so the preview still works with JavaScript off, and the current tab is
`aria-current="page"` rather than bold alone — colour or weight by itself is the signal
BR-REQ-041-01 refuses.

*The icon record is keyed by `AdminSection`.* The missing glyph was not an oversight anybody
could have caught by reading: `Record<string, …>` accepts a table with a section missing, and
the tab then renders as a plain word. Keying it by the union makes the next section added
without a glyph a build failure. Eleven glyphs, one file each, as before.

*The count is the club's secondary colour on a filled pill*, inside the label rather than a
`<Badge>` — §255's reasoning stands, because a badge is positioned over the tab's own underline
at 320 pixels. Orange under dark ink is the one accent pair `theme.ts` keeps identical in both
schemes, so the pill needs no dark variant and clears AA on either.

**Consequences.** `AdminTabs.tsx` (the `AdminSection` key, `ForwardToInboxIcon`, the pill),
`admin/emails/page.tsx` (`SubNav` in place of the two `Link`s).

Baseline `BR-V1.43-2026-09-21`.

## 269. Decided — a backoffice screen is boxes, and the ones that are not today's work fold (2026-09-22)

**Context.** The owner, 2026-09-22: "overall I want the admin area to have more boxes and
collapsables." The registrations screen is the case for it. Between the heading and the table
sat a bib toolbar, a counter strip, an outbox line and eight filter fields, separated by nothing
but vertical space — about a screen and a half of controls, most of them read once a week,
above the list that is read every time. The configuration screens got sub-tabs for the same
problem (§265); the screens that are one section each needed the smaller move.

**Decision.** *One component, `shared/ui/Panel`.* A bordered section with a heading, an
optional line saying what it is for, and an optional **aside** — a figure that stays visible
while the panel is shut, because a closed fold that says nothing is a fold nobody opens. With
`collapsible` it is a `<details>`; without it, the same box the panels on `/admin/emails`
had each been drawing by hand.

*A `<details>`, never client state.* The backoffice works with JavaScript off, and a panel
whose open state lived in React is a panel that does not open before hydration — on the screens
a volunteer opens on a phone at the desk, where §68's note about hydration windows was written.
`DISCLOSURE_SUMMARY_SX` (§164) is what makes the summary read as a control, and it carries the
44-pixel target. The summary is never `display: flex`: Chrome and Safari drop the marker when
it is.

*What folds is decided by whether it is today's work, and it opens itself when it is.* The bib
panel opens when something is unprinted; the outbox when something is waiting; the filters when
the list is actually narrowed, so nobody loses a filter behind a fold they cannot see; the
invitation form on Echipa folds but starts open, for the accessibility reason below. The
counter strip does not fold at all — it is what the screen is for.

*The heading is a real `h2`, inside the `<summary>`.* A screen reader's heading list is how
somebody skips to a section, and a folded section that is not in it cannot be skipped to.

*Two things the e2e suite caught, and both are the rule now.* A panel that holds a form
**starts open**: a closed `<details>` is not in the accessibility tree at all, so the contact
recipients were a heading no screen reader and no test could find. And the heading goes *inside*
the summary rather than being a summary with a heading's typography — `component="summary"` with
`variant="h2"` styles the text and carries no heading role at all, which takes the section out of
the list a screen reader navigates by. What may start closed is what is read rather than acted
on, and only when there is nothing in it to act on: the outbox queue with nothing waiting.

**Consequences.** `shared/ui/Panel.tsx`; the registrations list (bibs, the counter strip, the
outbox, the filters); `EmailPlanPanel`, `OutboxQueuePanel`, `ClubNoticesPanel` and
`ContactRecipientsPanel`, which now draw no frame of their own — the plan stays open, the other
three fold; the invitation form on `/admin/staff`. Four message keys under `Admin.panels`,
plus `registrations.filtersInUse` and `outbox.waitingShort` for the asides.

Baseline `BR-V1.43-2026-09-21`.

## 270. Decided — the club writes an email in the same editor it writes a page, minus what an inbox cannot draw (2026-09-22)

**Context.** The owner, 2026-09-22: "the email template editors must also be rich text." §247
gave the club the subject and the paragraphs of every message, as one textarea with a blank line
between paragraphs. What it could not write was the thing a club actually wants in an email: a
bold line, a link to the event, a list of what to bring.

**Decision.** *The same editor, a narrower vocabulary.* `RichTextEditor` is mounted on the copy
panel with a new `features` prop, and the email body allows paragraphs, two heading levels, the
two lists, a quote, bold, italic, links and alignment. **A picture, a film and a table are
refused**, each for its own reason rather than for tidiness: a picture in an email is a request
to a server the moment it is opened, which is the tracking pixel every client blocks by default;
a film cannot play in an inbox at all; a table is how a mail client lays out a whole message and
the hard target is a 320-pixel phone. `features` hides the buttons; the **server** is what
refuses the nodes, whatever a browser posts.

*Its own renderer, not the page's.* `RichText.tsx` emits MUI `sx`, which is classes in a
stylesheet, and a stylesheet is what Gmail and Outlook drop. `domain/email-rich-text.ts` writes
the same inline `style` attributes `templates.ts` already writes by hand, so a paragraph the
club wrote and a paragraph the platform ships are the same paragraph on the screen.

*Both halves of a message come from one document.* A message is HTML and plain text, and the
plain half is still built from `paragraphs` — which is now **derived from the document at save
time** rather than typed separately. A club that edited the formatted words and left a stale
textarea behind would otherwise have sent one wording to a reading client and another to a plain
one. An `EmailBodyPart` carries the two halves of one block together, because the platform's own
sentences ("you are already registered", "this number is provisional") sit among the club's
paragraphs and are plain strings.

*A mark may only wrap text that is already escaped*, which is the order §189 established for the
`**bold**` markers, and a link's `href` was checked against the safe-protocol rule when the
document was stored.

*Nothing breaks on the way in or out.* `body` is optional on the stored entry: every entry
written before today has none and reads exactly as it did. A document that cannot be parsed —
an older browser posting the textarea, a node an email may not carry — falls back to the plain
paragraphs beside it, the same direction `readEmailCopy` takes with an unreadable setting. A
message still goes out.

Tests: `tests/unit/notifications/email-rich-text.test.ts` — the three refusals, inline styles and
no classes, escaping before marks, placeholders filled in the message and kept in the store, both
halves of a list agreeing, and the club's bold line arriving in a rendered message.

Baseline `BR-V1.43-2026-09-21`.

## 271. Decided — a table is a layout tool: columns are dragged, the lines and the header are coloured, and the editor shows where the cells are (2026-09-22)

**Context.** The owner, 2026-09-22: "tabelele ar trebui să fie mai smart, resizable și să pot
seta culoarea borderului și headerelor, ca să pot face layout din tabele … practic am nevoie să
pun căsuțe în text ca să împart text și poze în stânga și în dreapta, cumva e deja posibil dar
nu am separatoarele clare." And, separately: "in the editor I want lines visible for layout but
I also want a preview in a pop-up." §263 gave a table three border choices, one of which is
"none" precisely so a table can be a layout. What it did not give was the two things a layout
actually needs — column proportions and a way to see the cells while filling them.

**Decision, four parts.**

*Columns are dragged, and what is stored is a proportion.* `resizable` was false and `colwidth`
was dropped, for a reason that still holds: a pixel width is measured on somebody's laptop and
this site's hard target is a 320-pixel column. But what dragging an edge **says** is "this column
is about twice that one", which is scale-free. So ProseMirror's own resizing is on, the pixels it
writes are stored, and `tableColumnFractions` divides them by the row's total: the page emits a
`<colgroup>` of percentages and switches to `table-layout: fixed`, which is what makes a browser
honour them. Read from the **first row**, and only when no cell in it is merged — a colgroup
built from a row with a `colspan` would be wrong. A table nobody sized keeps the automatic layout
it has always had.

*The lines and the header row have a colour, chosen from four names.* `borderColour` is
`default`, `strong`, `blue` or `orange`; `headerFill` is `default`, `none`, `blue` or `orange`.
**Names of the club's palette, never a value somebody typed** — the discipline every other
attribute in the schema follows. A colour picker would put the brand in the hands of whoever is
writing a page that day and would produce white on yellow the first week; a filled header also
carries its own `contrastText`, so the pair clears AA in both schemes without anybody checking.
A borderless table still drops the shading by default (§263) and keeps a fill that was actually
chosen: that is a decision rather than a table's chrome.

*The writing area always shows where the cells are.* The dashed guide that a borderless table
had now covers a table of rows as well — both leave the writer typing into an invisible grid.
It is an `outline`, so switching the lines moves nothing, and dashed, so it does not read as a
line that will be published. ProseMirror's resize handle is drawn for the same reason: it renders
an element with no styles of its own, so without a rule the gesture is undiscoverable.

*A preview in a pop-up, and it is the same description.* The dialog shows the editor's own markup
under `PREVIEW_CONTENT_SX` — the identical table rules, keyed under the dialog instead of under
`.tiptap`, with the editing aids left out. That difference is the preview: the question it
answers is "which of these lines will the reader see", and a preview that kept the guides could
not answer it. The markup is this browser's own editor state rendered back to its author; what is
*saved* still passes the server's allowlist, which is where the boundary is.

*Rejected:* a colour picker (above); storing percentages rather than pixels (ProseMirror writes
pixels and a translation on the way in would fight its own resizing); a preview that round-trips
to the server to render the page's real components (a request per keystroke's worth of curiosity,
for a drawing §263 already makes identical).

Tests: `tests/unit/content/rich-text-table.test.ts` — the width kept and read as two thirds and
one third, and no proportions when nobody sized a column; `rich-text-tables.test.ts` — the four
defaults, palette names rather than values, the contrast pair, a layout table keeping a chosen
fill, and the guide covering both line-less variants.

Baseline `BR-V1.43-2026-09-21`.

## 272. Decided — the past section obeys the kind filter, and a special event is the whole card (2026-09-22)

**Context.** The owner, 2026-09-22: "și la evenimentele trecute trebuie să pot pune tipul lor,
vreau să fac hilight la evenimentele speciale, testări de papuci, etc." The section of events
already held (§267) ignored the kind filter above it entirely: choosing "Testare de echipament"
narrowed what is to come and left twelve mixed rows underneath. And an event marked special wore
a chip (§168) — one line among four on a card, which is not what "highlight" means when the
thing being looked for is one shoe testing among eleven Monday runs.

**Decision.** *The filter reaches the foot of the page.* `listPastEvents` takes the kind, and
the filter is applied **in the query** rather than after it: the limit is the database's, so
filtering a page of twelve mixed rows down to the two gear tests among them would show two and
call them all of them. The heading names the kind while one is chosen, so a filtered section is
never read as "this is everything the club has held".

*A special event is drawn as one.* `specialCard` in `theme/surfaces.ts`: the club's secondary
colour on the border and a four-percent wash of it behind, on the listing's card and on a series
card whose any date is special. A wash **over** the card's own background rather than a fill
instead of it — a replaced surface would put body text on a tint nobody has checked for
contrast, and four percent reads the same in both schemes because it is a wash rather than a
colour. The chip stays: colour alone is not a signal (BR-REQ-041-01), and the chip is what a
screen reader announces.

*The kind of a past event was never the thing missing* — every event has carried one since §112
and the editor has always offered it. What was missing was being able to *see* the past by kind,
which is what this adds. If the club also wants past events to carry a kind the list does not
have, that is a new value in `EVENT_TYPES` and its own decision.

**Consequences.** `listPastEvents` (the `type` argument), the listing's `PastEvents` section,
`Events.pastCountOfType` in both catalogues, `theme/surfaces.ts`, `SeriesCard`.

Baseline `BR-V1.43-2026-09-21`.

## 273. Decided — the editor behaves like the ones people already know: a sticky toolbar, a bar over the selection, a word count (2026-09-22)

**Context.** The owner, 2026-09-22: "I want that rich text editor to be almost as good as word
doc editing", and then the sentence that decides the shape of it — "or at least close to
WordPress, Amalia is used to WordPress." This is a usability requirement with a named user, not
a feature list: what matters is that somebody who has written in WordPress finds their habits
work here.

**Decision.** Three habits, and nothing that widens what a document may contain.

*The toolbar is sticky.* A description runs to several screens and the toolbar sat at the top of
it, so making a word bold two screens down meant scrolling up, losing the selection, and
scrolling back. Every editor people know keeps it in view.

*A bar appears over the selection*, with bold, italic and link — the three verbs that are about
the words somebody has just selected. Everything structural stays in the toolbar above.
`@tiptap/react/menus` is a subpath of a package already installed, so this is no new dependency
(§1.5), and it is the one part of "like WordPress" that is a recognisable gesture rather than a
button in a different place.

*A word count under the box*, counted from the editor's own text rather than from Tiptap's
`CharacterCount` extension — one line against another package to install and configure.

**What was deliberately not done.** Underline, strikethrough, text colour, font size and a
colour picker: each is a widening of `domain/schema.ts`, which is the allowlist every stored
body is validated against, and each is a way for a page to stop looking like the club's site.
§263, §271 and §213 already gave the two decisions that carry a layout — how a table is drawn
and where a line of text sits. "Close to WordPress" is about the *gestures*, and those are what
this changes.

**Consequences.** `RichTextEditor.tsx` (the sticky bar, `BubbleMenu`, `countWords`), one
message key in each catalogue, the labels helper.

Baseline `BR-V1.43-2026-09-21`.

## 274. Decided — the editor's toolbar is shorter, the table's verbs sit over the table, and three glyphs earn their place (2026-09-22)

**Context.** The owner, an hour after §273 reached QA: "I am not too satisfied in the editor, the
preview icon should [be] last and it should actually have an eye icon; the pictures inside the
editor should have borders so I know how they wrap; the tables icons should appear above the
table, I have way too many icons now; and the alignment icons for the text should resemble
microsoft word." Four complaints, all about the same thing: the toolbar had grown to twenty
buttons and said too little about each.

**Decision.**

*The table's six verbs leave the toolbar and appear over the table.* They only ever apply inside
one, and they were being read by somebody writing a paragraph. A bubble menu keyed on
`isActive("table")` puts them where the table is and takes them out of the row entirely — the
toolbar is eighteen controls now, and six of those are conditional on nothing.

*Three glyphs, and only three.* The rule has been "words, not icons" since the picture emoji
rendered as a broken box on the owner's machine, and it still holds for verbs whose names are
the clearest thing about them. The exception it was always going to have is the one the owner
named: the three alignments are the same picture in every editor anybody has used, and "S", "C",
"D" are three letters to decode. The eye is the fourth, for the same reason. They come from
`@mui/icons-material`, which the backoffice already imports for its tab row, and only the
backoffice loads this file — no public page pays for them.

*The preview is last.* It is about the whole body rather than about the caret, so it does not
belong among the verbs that change text.

*A picture shows its own edges while writing.* A photograph with a pale sky ends somewhere the
eye cannot find, and where it ends is exactly the question when it is floated and the paragraphs
run beside it. The same dashed hairline a table's cells wear (§271), as an `outline` so nothing
shifts when a picture is resized or moved to the other side, and on the crop window too — a
cropped picture is the one whose boundary is hardest to guess.

**And the defect this batch shipped, which is the part worth keeping.** §272's `specialCard` was
written as `backgroundImage: (theme) => …`, MUI's own documented `sx` callback. It is a
*function*, the object is spread into the `sx` of MUI's `Card` from a **Server** Component, and
React refuses to serialize a function across that boundary (`AGENTS.md` §14.1). Every card on the
listing threw; the page still answered 200, so nothing was red — the owner saw it as "ENV-ul de QA
e picat". The colour is `var(--mui-palette-secondary-main)` inside a `color-mix` now: a string,
which crosses any boundary, and still one value per scheme.
`tests/unit/theme/surfaces.test.ts` walks every export of that module at any depth and fails on
a function, because the same mistake is available to every future surface written there.

Baseline `BR-V1.43-2026-09-21`.

## 275. Decided — the listing is rows of equal cards, a picture has a ceiling, and a weekly run is not history (2026-09-22)

**Context.** Three things the owner said while looking at the live listing: "these cards are
ugly", with a screenshot of a short race card beside a seven-hundred-pixel photograph and a hole
under it; and "weekly events should not be treated as past events, only the non-weekly ones".

**Decision.**

*Every card in a row is as tall as the tallest.* The three grids said `alignItems: "start"`, so
each card was its own height and the gaps between them were holes in the page. Stretched, the
white space is **inside** a bordered card, which reads as a card with room in it rather than as
a layout that failed.

*A picture on a card has a ceiling of 420 pixels, and no crop.* §260 removed the 180-pixel band
every card's picture used to be cut to, and that stands — this scales a tall photograph down
whole rather than cutting it, with `width: auto` keeping its proportions. The difference matters
and is the reason the ceiling is generous: a band *chooses* a shape for somebody, a ceiling only
says how much of the screen one card may take. The crop box in the editor (§241) is still the
only thing that cuts anything, and it is a choice made while looking at it.

*A date of a standing series is not a past event.* Last Monday's Happy Monday is not something
the club held and moved on from; it is the run that happens again on Monday, and it is already
the first card on the page. `listPastEvents` excludes a source with a `repeat_rule` and every
occurrence with a `repeat_of` (§122), so the section is what it was meant to be: the race, the
gear test, the hike — the things that happened once.

## 276. Decided — the editor's floating bars keep their props, and CI stops paying for the same bytes twice (2026-09-22)

**Context.** Two failures on one morning, neither of them in a test's own logic.

**The editor took itself down the moment it mounted.** §274 moved the table's verbs into a
`BubbleMenu` and gave it an inline `shouldShow` and an inline `options` object. `BubbleMenu`
registers a ProseMirror plugin from those props, so a new identity on every render re-registers
it, which dispatches a transaction, which renders again: React error #185, "maximum update depth
exceeded". The island died before the toolbar appeared, which is why the e2e suite failed on "no
tab named English" — a message about language tabs, from a defect about tables. `useCallback`
for the predicate and a module constant for the options fix it, and the rule generalises: **a
prop that a Tiptap menu registers a plugin from must keep its identity between renders.**

**CI failed on a font.** `next/font/google` downloads its files during the build, a runner could
not reach Google, and twenty-one identical "cannot resolve
`@vercel/turbopack-next/internal/font/google/font`" errors made a pull request red with nothing
wrong in it. Three changes, in the order of how much they save: `.next/cache` is cached, which
skips that request entirely on a warm key and gives Turbopack something to build from; the build
is retried once before it is called a failure, because one bad minute at somebody else's service
is not a release-blocking event; and Chromium — 170 MB of identical bytes every run — is cached
on the resolved Playwright version, with only its apt dependencies installed on a hit.

*Not done: sharding the suite.* The obvious way to halve the wall clock is to run the specs in
parallel, and §212 already explains why CI runs one worker — the specs share one database and
one seeded event. Sharding would buy minutes and pay for them in the most expensive currency
there is, a suite that fails differently every run. The caches buy their minutes without that.

Baseline `BR-V1.43-2026-09-21`.

## 277. Decided — the registrations screen says what it is counting, and its filter is not hidden (2026-09-22)

**Context.** The owner, within minutes of §269 reaching QA: "how can I have 4 registered as a
counter but 3 in the list? And I am missing the event filter on that registrations admin page."

**Both numbers were right, which is the problem.** The tab's badge counts every active
registration of a real person on every event still to come (§255). The list opens on the
**featured event** and nothing else, because that is what an organizer wants on arrival (§178).
Four people are signed up across two events; three of them are on the featured one. Nothing on
the screen said so, so the two numbers read as a contradiction — and the control that would have
explained it, the event filter, was inside a fold §269 had closed.

**Decision.** *The filter panel starts open*, like every other panel with a control in it. The
rule §269 arrived at for a screen reader turns out to be the same rule for a person: a control
nobody can see is a control nobody has.

*The counter says its scope, in its own heading and in a sentence under it*, with a link to
every event. "Cine s-a înscris — la Crosul de toamnă" cannot be mistaken for the club's total.

*The badge says what it counts, as its tooltip.* One sentence: how many are signed up across
every event still to come.

*What was rejected: making the two numbers the same.* They answer different questions, and the
club needs both — "how many are coming to this race" on the screen it works from, and "is
anything happening" on a tab it can see from any page. Two numbers that disagree are fine when
each says what it is; one number that answers neither question well is not.

Baseline `BR-V1.43-2026-09-21`.

## 278. Fixed — a formatted email paragraph keeps the spaces between its runs (2026-09-22)

**Context.** The owner, of the preview on `/admin/emails`: "whitespaces are not read properly in
the email template". The confirmation message read *"Ai început înscrierea la**Crosul de
toamnă**din data de**duminică, 4 octombrie 2026, 09:00**ce va avea loc la**Stația de telecabină
Tâmpa**"* — every bold fact welded to the words either side of it.

**What it was.** A rich-text paragraph (§270) is not one string but a list of runs: the plain
words, then the placeholder in bold, then the plain words again. `fillPlaceholders` ends with a
`trim()` — right for a whole paragraph, because a placeholder that vanishes should not leave the
sentence starting with a space — and `email-rich-text.ts` was calling it **once per run**. Each
run lost the space at its two ends, and a run made of nothing but the space between two bold
facts was trimmed to the empty string and dropped altogether. The document the club typed was
correct throughout; only the render was wrong, which is why it showed in the preview and would
have shown in every message sent from a formatted body.

**Decision.** *`fillPlaceholders` takes `edges: "trim" | "keep"`, and a run asks for `"keep"`.*
Closing up doubled spaces and the space before a comma stays in both modes: those are about what
a vanished placeholder left behind, not about the edges.

*The paragraph's own two edges are trimmed where they belong* — in `inline()`, on the first and
last run only. So the rule §270 wanted is kept whole, at the level it is actually about.

*What was rejected: trimming nothing.* A paragraph beginning with a stray space the club typed
in the editor would then reach an inbox with it, and the plain-text half — built from the whole
line — would disagree with the HTML one.

Baseline `BR-V1.43-2026-09-21`.

## 279. Decided — a legal document is written in an editor, and stores exactly what it stored before (2026-09-22)

**Context.** The owner, 2026-09-22: "this declaration must be WYSIWYG". `/admin/legal` was the
last screen in the backoffice still writing into a monospace textarea, in a format the club had
to learn — `## ` for a heading, a blank line between paragraphs, square brackets round the words
and the address in the parentheses after them for a link —
to write the three texts that carry the most trust in the product.

**The constraint that shaped it.** `body_json` is `{ sections: [{ heading?, paragraphs }] }`, and
that is not merely a storage detail: it is what `content-hash.ts` hashes, what an approval points
at, what `merge-fields.ts` fills per participant and event, and what `pdf.ts` draws into the
declaration somebody signs. The club's terms, privacy notice and declaration are **approved on
production against those exact bytes**. A rich-text body would have moved the hash of documents
already in effect.

**Decision.** *The editor is a view over the stored text, not a new storage format.*
`LegalBodyEditor` opens the stored text as a document, and posts the same plain text back under
the same field name. `actions.ts`, the validation, the hash, the public page and the PDF are all
untouched, and a version approved before this existed opens and saves byte for byte identically —
which `editor-doc.test.ts` asserts against all three of the platform's templates in both
languages, by comparing the content hash either side of a round trip.

*The toolbar offers exactly what the format can store*: a heading, a paragraph, a line break, a
link and a picture. **Bold, italic and lists are deliberately missing.** The body has nowhere to
put them, so a button for them would produce formatting the save drops without saying so — and on
a document somebody signs, "what you saw is not what it says" is the one failure that matters.

*Its own island rather than the pages' editor.* `RichTextEditor` writes Tiptap JSON and is sixteen
hundred lines of toolbar built for a page; threading a second serializer and a second allowlist
through it would make both harder to read than two files that each do one thing (`AGENTS.md` §1.5,
rules 2 and 3). The two share Tiptap, which is already installed — no dependency was added.

*What was rejected: real rich text, with marks and lists.* It was offered and declined for now.
It changes the stored shape, the hash's input, the public renderer and the PDF, and it needs a
compatibility path for the three approved versions — a month before registrations open for
21 November, on the documents a registration is refused without.

Baseline `BR-V1.43-2026-09-21`.

## 280. Decided — Neon Launch is the current plan; watch money, not Free's old cutoff (2026-09-22)

**Context.** The owner supplied the Neon billing console on 2026-09-22. It names **Launch** as
the active plan and the partial billing period Sep 22–Oct 1. At that moment 1.8 compute hours
cost $0.19. The same panel names 100 projects, 10 branches per project, 500 GB public network
transfer, autoscaling to 16 CU, scale-to-zero after five minutes, storage at $0.35/GB-month and
Instant Restore at $0.20/GB-month. Neon's official pricing announcement gives Launch compute as
$0.106/CU-hour; 1.8 × 0.106 = $0.1908, which reconciles the console rather than guessing from it.

**Decision.** The Neon account containing the separate QA and production projects is documented
as Launch from this date. It is usage-based with no monthly minimum. At the observed pace of
1.8 CU-hours a day, a 30-day month is 54 CU-hours and **$5.72 compute**. A 0.25 CU compute kept
awake for all 720 hours is 180 CU-hours and **$19.08 per project**; two such projects are $38.16.
Storage and retained restore changes are additional, so each number is an estimate rather than
an invoice or a fixed subscription.

The scheduler stays at fifteen minutes by day and hourly at night. §68 chose that cadence to
avoid Free's 100-CU-hour suspension; Launch removes the suspension but not the waste. A five-minute
ping still keeps a quiet database awake and now turns the same 180 CU-hours into a bill. The
cadence is therefore cost control and still leaves room for the outbox and waiting-list deadlines.

Launch fits M1: the two projects, branch count, transfer and autoscaling headroom exceed the
club's present needs. It has no SLA. Scale is considered when the club needs its 99.95% SLA or
additional security/compliance controls, not because Launch accumulated ordinary usage.

**December is a review, not a scheduled downgrade.** The owner may return the account to Free
in December 2026 after seeing real invoices and usage. Launch remains active unless the owner
explicitly decides otherwise. Before a downgrade, re-check the Free plan as it exists then and
confirm both projects fit its compute, storage, branch and restore constraints and that its
production trade-offs are accepted. A downgrade changes the active operating rule, so the
diagnostics, BR-REQ-090-07, setup and platform inventory change with it rather than before it.

**The code did not change in this documentation task.** `diagnostics/neon.ts` still divides by
Free's 100 CU-hours; `database-size.ts` still measures against Free's 0.5 GB; and
`platform-plans.ts` still says the current plan is Free and Launch is next. BR-REQ-090-07 now
states the follow-up: name Launch, show an estimated charge, remove both former ceilings and
distinguish the estimate from Neon's invoice. Until then those UI labels are stale, not evidence
of the provider plan.

**Synchronized documents.** `README.md`, BR-BUS-101, BR-REQ-090-07, `AGENTS.md` §§3.1, 7 and
16.2, `SETUP.md` §§2, 25, 26 and 33, `docs/PLATFORM.md`, `CLAUDE.md`, `MANIFEST.txt`, and this
history. Pricing was verified against the owner-supplied console and Neon's official pricing and
SLA pages on 2026-09-22; it must be re-checked before another plan decision.

Baseline `BR-V1.44-2026-09-22`.

## 281. Decided — a public page keeps its last good copy, so an outage costs a page rather than the site (2026-09-22)

**Context.** The owner, 2026-09-22, after asking what happens when the database is down: "I want
to gracefully handle DB failures … we want the website to keep running so that we don't break our
reputation." Until now every public page read the database per request and had nothing behind it:
Neon suspended, a provider incident or a migration mid-flight took the whole site's content with
it, and a stranger deciding whether to enter the 21 November race met an error page.

**What was already true, and kept.** `error.tsx` (§52) means that failure was never Next's raw
"Application error": the header, the footer and the navigation survived, and the page offered a
retry, a way home and a reference. What it could not do is show the event.

**Decision.** *Each public read keeps its last good answer, and serves it when the live read
throws.* `modules/resilience/last-good.ts`. Normally **nothing is stale**: the copy is consulted
only after a failure, so this is not a cache in front of the database — it is a copy behind it.

*The copy lives in two places, for one reason each.* In the instance's memory, which costs nothing
and covers the ordinary case; and in R2, because a serverless instance is not a server and the
first request after a quiet hour lands on a cold one with an empty memory. R2 is the right second
place precisely because it is not Neon: the two do not fail together. It is written after the
response, as the outbox drain is (§68), and at most once every ten minutes per key.

*A stale page says so, and says when.* `LastGoodNotice`, naming the hour the copy was taken — a
reader can judge a page from twenty minutes ago and one from nine hours ago differently, and that
judgement is not the platform's to make. Serving an old page silently is what would actually cost
the club its reputation.

*A copy older than twelve hours is not shown at all.* Past that the error page is the honest
answer: "the site kept working" is not worth telling somebody to come to a race that was called
off yesterday.

*The free places are never served from a copy.* The rest of an event page is the same facts it was
an hour ago; how many places are left is the number somebody decides on, and the allocator is the
only thing that knows it (`AGENTS.md` §10.6). When that one query cannot be answered, that one
block says so and the page around it stands — rather than sending somebody through a form to be
refused at the end of it. The owner chose this over caching the count.

*`notFound()` and `redirect()` are put straight back.* They work by throwing, and answering a 404
with the previous visitor's page would turn it into a wrong 200. Every loader is data only, and
`unstable_rethrow` guards the boundary.

*Nothing under `/admin` and no write path is wrapped in this.* Staff need to know the database is
away, and a stale answer on a decision screen is worse than no answer.

**Two things that came with it.** The storage adapter gained the read leg `AGENTS.md` §17 always
described — `get(key)` — because a snapshot is read back by this application rather than handed to
a browser, on the very request whose database read just failed. And `/api/health` was fixed: it
probed the connection, then called `checkJobHealth` twice whatever the probe had said, so a
database that was actually away made the route throw and answer Next's generic server error —
destroying the one alarm the club has (§98), since the monitor's alarm *is* the non-2xx with a
readable body.

**What was rejected: ISR, or caching the pages outright.** Next would serve a stale page happily,
but the pages take search parameters, the freshness rule of §28 (a cancelled event must never read
as scheduled) would then depend on invalidation being right everywhere, and being wrong would show
stale pages *while the database was healthy*. The mechanism above cannot do that: it is reached
only by a throw.

**Verified against a stopped database**, not a mocked one: with `docker compose stop db`, the
listing, the calendar, both legal texts, the gallery, a standing page and an event page all
answered 200 with their content and a dated banner; the event page's registration block said the
places could not be checked; `/api/health` answered 503 with its structured body; and a page with
no copy yet answered the error page, as intended.

Baseline `BR-V1.44-2026-09-22`.

## 282. Decided — the hidden trap may suspect a person, but it no longer refuses one on its own (2026-09-22)

**Context.** Two of the club's own testers registered and never received the confirmation email;
the WhatsApp thread reads "nu primeam mailul de confirmare a adresei… nu am descoperit 100% care
este motivul" and, from the other side, "prea multă securitate". The owner, the same afternoon:
"we need to test with auto-fill properly", "I want clear visual feedback when people are not let
through", "I also want to give real people the option to fix it", and — of the red panel —
"trebuie să fie mai subtilă".

**What the honeypot meets in the real world.** A password manager fills every input it recognises,
and an offscreen input is still an input. What lands in the trap is then *that person's own* name
or address, spelled exactly as they typed it above. §217 had already stopped the silent failure —
a refusal is said out loud, with the answers kept — but the refusal itself was still a dead end:
the browser refills the trap on every render, so pressing the button again was refused for the
same reason, forever.

**Decision.** *A trap holding the submitted address or name is `autofill`, not `trap`.* A bot has
no reason to put the submitted address in a field the form never showed; it puts a link or a
keyword. That verdict is accepted, and logged.

*Suspicion and consequence are separated.* `refusesSubmission` weighs the guess against what else
is known: **Cloudflare's verdict outranks the hidden field** — a measurement beats a guess, and a
bot that can pass Turnstile was never going to be stopped by an offscreen input — and **a second
attempt is let through**, because somebody who has been told they looked automated and pressed
again is a person.

*A token Cloudflare rejected ends it, and no second press undoes that.* The owner: "nu vreau ca
oamenii să ajungă la ecranul ăsta și să fi fost roboți." The escape exists for a person the
guesses caught by accident; it must not become the way past the one check that measured the
browser. A script that posted twice would otherwise reach the "check your email" screen and spend
a message out of an allowance that is sixteen registrations a day on the free plan (§100).

*The refusal is quieter, and says three things it did not.* Information rather than error —
nothing is wrong with what they typed — and: nothing was registered, no email is coming (the
promise §217 forbids making falsely), and the consents below must be ticked again before pressing
send. That last is not a defect to fix: a consent is given on purpose and is deliberately never
restored (§142), so the button would otherwise be pressed and nothing would happen, which is
exactly what the e2e case found.

*The way out is a button inside the form.* It was first placed in the alert above it with
`form="registration-form"`, which is valid HTML and submits nothing here: a Server Action is
driven by React from the form's own submit handler, and a submitter outside the element never
reaches it. One refusal in the log and no second request at all — found by the browser test, not
by reading.

*And the trap has its own switch in the backoffice*, beside the captcha's (§254; the owner: "I
want this honeypot setting to be a toggle in the admin area as well"). Its own, because the two
fail differently: the captcha refuses somebody in front of a widget they can see, and the trap
refuses them invisibly — which is exactly why being able to switch it off alone is worth having
on the day a browser keeps filling it. Off, the field is still rendered and still logged; it
simply stops refusing anybody, and the timing guess and Turnstile are untouched. It needs no keys
and no third party, so it can be switched on a deployment that has no Turnstile at all.

**What was rejected: making the trap harder to autofill.** More attributes on a hidden input is an
arms race against browsers whose behaviour is not documented and changes. Deciding what the
*value* means is stable, and it is the thing that distinguishes the two cases.

**Verified in a browser**, `registration-autofill.spec.ts`: the trap filled with the runner's own
address goes through first time; filled with somebody else's link it is refused, the panel says
so, and the second press — consents re-ticked, trap still filled — is accepted.

Baseline `BR-V1.44-2026-09-22`.

## 283. Decided — the telephone and the declaration say what they want before they refuse it (2026-09-22)

**Context.** Amalia, testing on QA: the telephone number needs a maximum and a clearer answer as
it is typed; and signing the declaration should "give some hints on the ID document or select ID
doc type", and should say that the name typed as a signature is the one used at registration —
"as a hint, not a hard validation".

**The telephone.** The live check has run the server's own `composePhone` since §198, so what was
missing was not correctness but arithmetic a person can see. E.164 is fifteen digits **including**
the country code, so the room left in the box depends on the country chosen beside it — thirteen
after Romania's `+40`, twelve after `+373`. That ceiling is now applied at the keystroke, and the
`maxLength` attribute follows the country rather than being one number for everybody.

*And the box answers in three ways instead of one.* "That is not a number this country uses" is
true and useless when the number is simply unfinished: it reads as a refusal of what was typed
rather than as a count. So a number too short to judge says keep going, and a number that works
says so — by showing the exact E.164 that will be stored. `+40712345678` on the screen is the one
thing that proves the country beside it was understood.

**The declaration.** The identity-document box asked for "seria și numărul", and people typed
whatever their own document calls those, under a label naming a Romanian identity card. The kind
of document is a closed list, so it is a list — identity card, passport, residence permit, other —
and the action composes the kind and the number into the one `{{idDocument}}` merge field the
club's approved text carries, in the language the person is signing in. A native select, like the
telephone's country (§198): it works before hydration and a phone knows how to open it.

*The signature box shows the name they registered with, and refuses nothing.* The hint is the
whole of it: somebody whose document reads "Ana-Maria" and who registered as "Ana Maria" must
still be able to sign. Comparing the two strings and refusing would be this platform deciding what
a person's name is, on the one field where typing it **is** the act (§86).

**What was rejected: validating the signature against the registered name.** It was asked for as a
hint and it is right that it stays one. A declaration refused because a middle name was left out
is a participant who cannot enter a race, and the club already knows who signed — the row is the
registration's own.

Baseline `BR-V1.45-2026-09-22`.

## 284. Fixed — a Turnstile widget is handed back when its form goes away (2026-09-22)

**Context.** The owner, from the browser console: `[Cloudflare Turnstile] Cannot find Widget
cf-chl-widget-hn2ug, consider using turnstile.remove() to clean up a widget.`

**What it was.** The island drew the widget with `render` and kept its id to `reset()` between
attempts (§185), and never called `remove`. Cloudflare keeps its own registry keyed by that id and
does not notice the element leaving the document, so a form unmounted by a client navigation left
an orphan behind. The warning is the visible half; the half that matters is that the next mount
drew a **second** widget beside the ghost, and which of the two answered for the token a
submission carried was not decided by anything here.

**Decision.** *`remove(id)` on unmount, in an effect of its own with no dependencies.* Not in the
drawing effect's cleanup: that one runs between attempts as well, and keeping one widget alive and
resetting it is exactly what §185 decided — a fresh challenge is the point, a fresh widget is not.
A `remove` that throws because Cloudflare has already forgotten the id is swallowed: a console
line of ours on top of theirs helps nobody.

Baseline `BR-V1.45-2026-09-22`.

## 285. Decided — the send button waits for the anti-bot check, and a dimmed button looks it (2026-09-22)

**Context.** The owner, watching the form: "butonul de trimitere nu ar trebui sa fie vizibil daca
Cloudflare Turnstile nu a terminat, corect?" and, separately, "butoanele disabled ar trebui sa fie
mai transparente, si cu cursor interzis".

**He is right about the first.** Pressing send before Turnstile has produced a token buys a
refusal for no reason at all — the token is missing, the server sees `failed`, and the person is
told the anti-bot check refused them when in truth they were merely quick. The widget usually
answers in well under a second, which is exactly the window in which somebody who has finished
typing presses the button.

**Decision.** *The button waits while the token is missing*, dimmed, with a sentence saying why,
and a press in that moment does nothing but keep the reason on screen. Cloudflare writes its token
into a hidden input inside its own element, so the form is where it appears and the DOM is what is
watched — the shape `PhoneField` already uses to watch the other telephone (§231), rather than
lifting a third party's element into React.

*With a release valve of eight seconds.* A blocked script, an offline moment, a bad minute at
Cloudflare — none of them may end with somebody unable to press send. §205 is not negotiable:
people register at all costs, and a check that never answers must not be the thing that stops
them. The same reason the server treats "unavailable" as acceptable and only a *rejected* token as
a refusal.

*And only where a widget is actually drawn.* No keys, or the club's switch off (§254), means there
is no token to wait for; waiting then would be a button dimmed for a check that is not running.

**The second is a plain interface defect.** A dimmed button at 0.55 opacity read as a colour
choice rather than as a state. MUI's own disabled opacity is 0.38, and with `cursor: not-allowed`
nobody mistakes it for a button that is merely quiet. It stays pressable, for the reason §047 and
the button's own notes give: a press is what produces the specific answer — the browser focuses
the first unfilled field and names it, which a truly disabled control could never do.

Baseline `BR-V1.45-2026-09-22`.

## 286. Fixed — four things found by watching two people use the form (2026-09-22)

**Context.** Amalia and the owner, testing on QA within an hour of each other.

**"Anumerarea in batch nu merge!"** It was working and saying nothing. A number is given to a
**confirmed, real** registration that has none — a number follows the declaration and never
precedes it, and a test row never wears one (§30). An event whose entrants are all still
confirming their email therefore assigned nought and reported "0 numere alocate", which reads
exactly like a broken button. *The screen now names what it skipped*: how many have not confirmed
yet, and how many are test rows.

**And the batch ignored the numbers the desk had already given.** Found from a screenshot of a row
reading "Prezență marcată · 5*" — the owner: "cum pot avea prezenta marcata dar numar cu
steluta?". The desk writes a number into `provisional_bib_number` on race morning and the list
draws it with an asterisk because it is not settled. Confirming one registration promotes it
(`service.ts`); the batch looked only for rows with no *final* number and handed them the next
free one. So a runner told "you are 5", with 5 written on their hand, was quietly given 100 while
the screen still showed 5 beside them — two numbers for one person, neither visibly wrong.
*The number somebody was told is the number they keep*, and it stops being provisional.

**The consents survive a rejected submission**, reversing that part of §142. The owner, watching
it happen: "vreau sa persist inclusiv bifele, sa nu se enerveze Dani … gen vreau ca dani sa mai
apese inca o data submit si atat!" The reasoning for dropping them was thinner than it looked: the
tick that counts is the one on the submission that **succeeds**, and that is the one the row
records with its version and timestamp. Making somebody re-tick three boxes to recover from a
refusal that was about none of them is friction charged to the wrong person. The e2e case asserts
it by re-ticking nothing.

**The refusal is red, and said once.** §282 made it information, since nothing the person typed
was wrong; what a reader needs first is that the submission did not go through, and blue reads as
a remark. And §194's second copy beside the button is gone: the summary at the top now carries
the title, the sentences and a button that sends the form, so the older panel was the same words
twice on one screen ("exista un pic de reduntanta la butoanele alea").

**"You are already registered" says so warmly, and names the number — in the email.** The owner:
"ne bucuram ca esti entuziasmat dar esti deja inscris cu numaru …", and then, unprompted: "don't
tell they on the screen, tell them in the email ;-)". Which is exactly the line §19.4 draws: the
screen's answer stays generic for everybody, because a form that says "this address is already
registered" is a way to ask who is entered; the inbox is the one place the question can be
answered, to the one person entitled to the answer.

**One incidental repair.** The register page's `typed()` helper is now `prefill()`: the i18n
checker reads every `t…(` call as a translation lookup (`t\w*\(`), so `typed("privacyAcknowledged")`
counted as a missing message key. It had passed for months only because every name it had been
given — `email`, `city` — also happened to exist in the catalogue.

Baseline `BR-V1.45-2026-09-22`.

## 287. Decided — a selection can be erased, behind the count typed by hand (2026-09-22)

**Context.** The owner: "de asemenea stergerea in batch ar trebui sa mearga! dar cu super extra
confirmare!"

**What §67 decided, and why it is being changed.** Cancel is offered in bulk and erase one row at
a time, because cancelling is recoverable — the person registers again — and erasing is not. That
reasoning still holds. What it did not account for is the club clearing a test season or a race
set up twice: eighty rows, eighty dialogs, and the twentieth confirmation is read by nobody. A
guard that is always in the way stops being a guard.

**Decision.** *The confirmation is the number of rows, typed.* A single erase asks for the
registered name (§180), which cannot scale to forty. The count is the thing that can: it is a fact
the screen has just shown, it changes with the selection, and it cannot become muscle memory the
way a fixed word or a second "yes" does. The owner chose it over typing ȘTERG for exactly that
reason.

*Asserted in the service, not in the dialog.* `bulkDeleteRegistrationsByStaff` refuses a count
that is not the size of the selection, and refuses an empty selection outright — so the rule
survives a second caller and a dialog somebody rewrites later. A dialog is UX; this is the rule.

*Everything else is the single erase, once per row.* The same `eraseRegistration`: the audit row
first, the declaration acceptance with the row in one transaction, the place released through the
allocator (§33, §44, §67). A row that refuses is counted and the rest continue, as the bulk cancel
already does — a batch that stops on the first surprise leaves the club unable to say what
happened.

*One form, two verbs.* A checkbox's `form` attribute names exactly one form, so one selection
cannot feed two; the erase button carries the second Server Action through `formAction`, and
`ConfirmSubmitButton` now submits **through the button** when it does, because React reads the
action from the submitter.

**What was rejected: two ordinary confirmations.** Offered and declined. The second click becomes
reflex, which is the failure mode this is supposed to prevent rather than a slower version of it.

Baseline `BR-V1.45-2026-09-22`.

## 288. Fixed — the invitation key could authenticate and do nothing (2026-09-22)

**Context.** The owner invited Dani as an Administrator from Echipa, and Dani met Zitadel's own
screen: **"User not found in the system"**. The `staff_users` row existed; the Zitadel account did
not.

**What it was.** `SETUP.md` §37 step 2 asks for the service account to be made an **Org User
Manager**, and on the club's instance that step had never been done — the token was created,
written to both Vercel projects (§123, 2026-09-20), and granted a role on the *project* under
"Role Assignments" instead, which is about access inside an application and confers no permission
over users. The token authenticated perfectly and could do nothing: `orgs/me/members/_search`
answered `membership not found (AUTHZ-cdgFk)`, and a search for human users returned **none**
while the console showed one.

**Why nobody noticed for two days.** `inviteZitadelUser` reports `failed` with the provider's
reason, and the Echipa page says so — in a banner, once, which is gone at the next click. The
allowlist row is written either way, by design (§123: the platform decides who is staff, Zitadel
only authenticates), so the screen afterwards looks exactly like success. The first person to
learn is the colleague, at the sign-in page, in words that sound like their own mistake.

**Decision.** *The procedure names the console's own words and its trap* (§37): the panel is
**Organization → Managers**, the dialog is "Add an Administrator", and **Role Assignments is not
it** — a service account can sit there Active and configured-looking while being unable to create
anybody.

*And a check that needs no volunteer.* Asking the token to list human users answers it in one
call: none, where the console shows some, is a missing membership. It went into §37 because the
existing check — "add yourself with a second address" — only works for somebody who already has a
second address and the nerve to test in production.

**What is still owed, and deliberately not built here.** Two things this would have caught earlier,
both code rather than documentation:

- a staff row whose Zitadel account does not exist should say so **on Echipa, permanently**, beside
  the resend button — not in a banner that disappears;
- `/admin/tasks` should check the invitation key the way it checks the other providers, so "the key
  works but has no permissions" is a row on the board rather than a discovery made by a colleague
  who cannot sign in.

Baseline `BR-V1.45-2026-09-22`.
## 289. Decided — the Organizer reads who signed up, and changes nothing (2026-09-22)

**Context.** The owner, watching his Organizer use the backoffice: "ca si organizator ar trebui sa
vad cine s-a inscris!", and a minute later "organizer should also be able to see BIDs and export
them". Asked how far it should go — a list with no contact details, the whole list read-only, or
everything but erasure — he chose **the whole list read-only, with the export**.

**What §10.2 decided, and why it is being changed.** The hierarchy's line was personal data, with
ADMIN on the far side of it: "registrations, participants, waitlist... exports" were the
Administrator's, and §208 restated it when the Organizer was given read access to the club's
*content* — "vede cam tot" is not an instruction to hand somebody four hundred addresses.

That was the right line for the question it answered, and it is the wrong line for the job. An
Organizer sets the date, the capacity, the participation window and the bib band, runs the queue
and works the desk on race morning. A person who cannot see the start list cannot do any of it,
and the club's answer had become "ask the Administrator to send you a screenshot", which is a
worse outcome for the same data.

**Decision.** *The boundary is reading against changing.* `canReadRegistrations` is the new
capability: the list, one registration's timeline, the CSV and Excel exports, the race numbers,
the bib sheet and the signed declarations. `canManageRegistrations` keeps every verb that
changes a registration — cancel, erase, resend, correct a name, assign the numbers, mark a bib
printed, send the thank-you, fill a queue with test rows — and each of those already asserts
itself in its own service, which is what makes the split safe rather than cosmetic
(BR-REQ-060-01).

*A set, not a threshold, and `DEV` is the reason.* Every rule in `roles.ts` but one is
`atLeast(role, …)`, deliberately, so that adding a role cannot silently drop a permission. A
threshold at MODERATOR would have handed the participant list to `DEV` as well, and `DEV`
exists precisely so that somebody helping with the platform can read `/devs`, reproduce a
problem and fix an event **without** the club's participants coming with them (§38). It outranks
MODERATOR only so `canSeeDiagnostics` can be a threshold. So this is the second earned gap in
the ladder, after `MAY_EDIT_TEXTS` (§207), and `roles.test.ts` asserts that it is exactly one
cell wide — the monotonicity property that caught the original §38 defect is kept, with the one
exception named rather than deleted.

*The volunteer stays where they are.* `CONTRIBUTOR` gets the desk, which shows one runner at a
time with a name, a state and a number and never an address (`AGENTS.md` §15.11). Nothing here
touches that.

*`/admin/tasks` stays the Administrator's.* It is not participant data; it is the club's own
worklist, and the role that answers for it is the one that owes it.

**The hole this opened, and closing it is half the change.** `rowVerbsFor` pushed `resend`
with no role check at all, on a comment that read: the list is Administrator-only, "so anybody
reading this row already passed that gate". That is an authorization rule leaning on a screen, and
the day the screen changed it stopped being true with nothing failing — an Organizer would have
been offered a button whose service answers FORBIDDEN. Which is exactly the complaint that started
this session from the other end: "e un pic confusing faptul ca pot edita dar nu mi se salveaza
modificarile ca si Organizator". Every verb on the list and on the registration's own page now
asks `canManageRegistrations` for itself, and the screen says once, in a sentence, what this
role may and may not do here — rather than letting somebody find out by pressing something.

**What was rejected.** *A list without contact details.* Offered as the recommended option and
declined: the owner wanted the whole list. *Everything but erasure.* Also offered and declined —
he did not ask for verbs, he asked to see.

Baseline `BR-V1.46-2026-09-22`.

## 290. Fixed — a delete screen that promised what the server refused (2026-09-22)

**Context.** The owner, on `/admin/legal/<id>/delete` for *Termeni de concurs, versiunea 2*:
"inca nu pot sterge unele ducmnete...". The screen said, in the club's own words, "Se poate șterge
pentru că nimic nu depinde de ea: nicio semnătură, niciun eveniment, nicio înscriere — și nu este
textul în vigoare acum", took the typed phrase and the reason, and answered **"Altcineva a salvat
între timp. Reîncarcă pagina"** — a sentence about a concurrent save by somebody who does not
exist.

**What was actually happening.** Nothing was broken in the delete path. §203 had added a fourth
obstacle to `assertDeletable` and to nothing else: a TERMS version that has ever been in force is
refused, because the three dependant counts are vacuous for that key — a registration records
`privacy_notice_version`, `results_consent_version` and `health_consent_version` and **never a
terms version** — so every TERMS row reads as unused, including one a hundred people accepted.
The version in front of him had been in force since 20 September. The rule was right; the screen
had never been told about it, and `CONFLICT` is rendered in the backoffice as a concurrent save.

**Decision.** *The rule becomes a pure function, `termsHasBeenInForce`, and both callers ask it.*
The service keeps its refusal and the delete screen gains a fourth `blocked` branch, last because
it is the narrowest — a version that is also in force should be told that first, since withdrawing
it is the step that moves. §1.5's "one rule implemented in exactly one place" is what this restores:
the screen had a *copy* of the obstacle list, three of four items long, and a copy is a thing that
drifts silently.

*The refusal names itself in `fields`.* `CONFLICT` stays the code — nothing about the request is
malformed, and a real race is possible if the version takes effect between the screen and the press
— but the action now tells this case apart, exactly as it already told a mistyped confirmation from
a missing reason, and says what the rule is rather than inventing a colleague who saved.

*The sentence says what can be done instead.* Withdrawal: the version stays on the record with its
number and is offered to nobody. A refusal that names no alternative is where this started.

**The wider lesson, and it is the second time today.** Both of this session's user-visible defects
were a screen and a server disagreeing about a rule, with the screen inviting the press: this one,
and the event editor's "pot edita dar nu mi se salveaza" (§289). Neither was a missing check. The
pattern worth naming: when a rule is added to a service, the screen that offers the verb is part of
the change, and a guard duplicated in prose on a page is a guard that will drift.

**What was rejected.** *A new `DomainErrorCode`.* The union is deliberately five values wide and
an unused one would be a value the code claims to produce; `fields` is the mechanism this action
already used for the same purpose. *Deleting the §203 rule.* It is correct, and the proper repair
is still a `terms_version` on the registration — a migration and a change to what the form
records — which is not this fix.

Baseline `BR-V1.46-2026-09-22`.

## 291. Decided — the emails page reads for the Organizer and writes for the Administrator (2026-09-22)

**Context.** Two messages from the owner, minutes apart, on the same screen. First: "organizatorul ar trebui sa vada (readonly) chiar si pagina de status unde vede cate mailuri s-au trimis si asa mai departe". Then, with a screenshot of `/admin/emails` as an Organizer showing **Salvează planul** and **Salvează destinatarii** in full colour: "Dar organizatorul nu ar trebui sa poata edita cine primeste mesajele CC si BCC".

**What was there.** The page is open to every role that may read the club's content (§253), and it drew every form for every reader. Each form's service refused anybody below Administrator — `updateEmailPlan`, `updateContactRecipients`, `updateClubNotices`, the outbox's "send now" — so nothing was exposed, and the e2e even asserted the shape: a Moderator presses Save and *is refused by a sentence*. That assertion was the defect written down as a feature. It is the same shape as §289's sibling and §290, for the third time in one evening: a screen offering a verb the server will refuse, and the reader learning the rule from the refusal.

The queue and the club's copies were the other half of the wrong answer. Both name people — a recipient's address, the addresses a signed declaration goes to — so both were read only for `canManageRegistrations`, which meant the Organizer who since §289 reads every registration could not read the queue of messages *to* those registrations, nor see whether Ana's confirmation was stuck. That is the status page the owner meant.

**Decision.** *Two gates on one page.* Reading follows `canReadRegistrations` (§289): the plan's figures for everyone who may open the page, the outbox queue and the club's copies for whoever may read the registrations — the Organizer included, the Redactor and Tehnic excluded, exactly as the list itself. Writing follows `canManageRegistrations`: the plan's form, "Trimite acum", the club's copies and the contact recipients are the Administrator's, and each panel takes `mayEdit` so that a role that may not press is not shown the button — it is shown one sentence saying whose the setting is and that the figures above are current for them too.

*The e2e turns around.* "A Moderator does not get the page's form to act on" asserted a press and a refusal; it now asserts that the Organizer sees the figures, the queue and the copies with no form, and a new case asserts the Redactor sees the figures and neither the queue nor the copies. The test that pinned the wrong behaviour is the test most worth rewriting.

**What was rejected.** *Leaving the forms and relying on the server.* Correct, and what BR-REQ-060-01 requires — but a rule the reader meets only as an error is a rule they cannot plan around, and the owner's screenshot is what that looks like. *Opening the plan's form to the Organizer.* The plan decides what the club pays and what "send now" may spend; it stays with the role that answers for the money.

Baseline `BR-V1.47-2026-09-22`.

## 292. Decided — the kit-face wordmark heads the calendar and the contact page too (2026-09-22)

**Context.** The owner, looking at the listing with `BRASOV RUNNERS` in the kit face above it: "trebuie sa vad acest scris frumos cu Brasov Runners si pe pagina de contact si pe cea de calendar".

**What `BR-V1.32` decided, and why it is being changed.** The wordmark had a day of arrangements in the header — beside the lockup, at mark height, side by side — and each was wrong for a reason `SiteHeader.tsx` still records: the name twice on one row in two typefaces, one of them baked into an image, unalignable. The answer was to take it out of the header altogether and give it the room a display face wants, above the listing, **on the homepage and nowhere else** — `CLAUDE.md` carried that sentence, `shared/ui/Wordmark` and `theme/brand.ts` repeated it. "Nowhere else" was a guard against the header, not a judgement about other pages; it stood because nobody had asked for another page.

The calendar and the contact page are the club's own pages in the same sense the listing is — what the club does and how to reach it — and the owner wants the club's signature on them. An event page or a legal text is the event's or the text's, not the club's, and keeps the heading it has.

**Decision.** *Three pages, as a page heading.* `shared/ui/Wordmark` heads the listing, the calendar and the contact page — the same component, the same 2rem cap ("way too big" at 4rem, 2026-09-17), the same Server Component, so the two new pages pay no client island and no second request for Facón, which the locale layout already loads for every page. It is a paragraph that is an image to assistive technology named from the catalogue ("Brașov Runners", spelled properly), never an `<h1>`, so each page keeps exactly one heading of the first level: "Calendar", "Scrie-ne".

*Never back into the header.* §58's lockup stays alone on the row; that is the half of `BR-V1.32` that was a judgement, and it stands.

*A fourth page is a decision, not a copy-paste.* `tests/unit/theme/wordmark.test.ts` pins the three files that render `<Wordmark />`, that each puts it before its one `<h1>`, and that the component stays a Server Component — source-level, like `events/card-excerpt.test.ts`, because the rule is about which files carry one line.

**What was rejected.** *Putting it in the layout for every public page.* An event page's heading is the event's title and a legal text's is the text's; the club's signature above "Termeni și condiții" would read as a letterhead, and the owner named two pages, not the site.

Baseline `BR-V1.48-2026-09-22`.

## 293. Added — a hidden copy (Bcc) of the contact form's messages and of every participant email (2026-09-22)

**Ask.** The owner: "să putem seta și unde mai merg în BCC mailurile de înregistrare" — the club wants a mailbox that silently receives what the contact form sends and every email a participant receives, without redeploying and without the addresses showing on the message.

**Decision.** Two Bcc lists on `/admin/emails`, both settings in `platform_settings`, both read by whoever may read the page and written only through the service that asserts `canManageRegistrations` — the gate §164 and §244 already use — with an audit row naming who changed what from what.

1. **The contact form** gains "Copie ascunsă – Bcc" beside "Către" and "Copie – Cc" (`contactRecipients.bcc`; a row stored before the box existed reads as none). The SMTP sender hands the list to Nodemailer as `bcc`, so the addresses are envelope recipients and appear in no header — neither the visitor's Reply-To thread nor the Cc'd colleagues learn of them. An address typed in two boxes is sent to once, compared without regard to case. The sentence in force above the boxes names the Bcc; `/admin/tasks`'s contact step names the third box.

2. **The club's copies** gain "Copie ascunsă la emailurile către participanți" (`clubNotices.participants.bcc`). Every message a `REAL` registration's participant receives carries the list in its outbox payload from the moment it is queued — stamped in `enqueueEmail` (`clubCopiesFor`) and nowhere else, so a message type added tomorrow for a participant is copied without anybody remembering, and a list edited afterwards cannot redirect a message already queued (§244's rule). The render step already reads `payload.bcc`, the Mailgun adapter already puts it on the envelope, and outside production each address already faces the allowlist on its own. The participant is never Bcc'd on their own message. A `TEST` registration's message carries none, nor does a message with no registration behind it (§12.6); the club's own archive copy and confirmation notice, the staff invitation and the "registration is open" notice are named out (`isParticipantMessage`).

**What it costs.** A copy is a message: every Bcc address is one more message against the Mailgun allowance for each of the runner's five messages. `messagesPerCompletedRegistration` takes the archive flag and the Bcc count, `volume.ts` computes it once, and `/admin/emails` says what a registration costs and how many of those messages are the hidden copies, as `/admin/tasks` does; `docs/PLATFORM.md` states the rule beside the six-per-registration floor.

**The warning.** The declaration's Bcc box already warns (§244) that a hidden copy hands the participant's name and identity document to a mailbox nobody on the message sees. The participants' box warns in the same place and shape, because its copy is the stronger: those emails carry the participant's own action links and, on the confirmation, the QR for the start, so whoever reads the Bcc mailbox can take those steps in the participant's place (§12.8). The platform allows it, as §244 allows the other; the person switching it on reads those words while they do.

**Why not per-caller, why not a cached read.** Stamping at the twenty `enqueueEmail` call sites was rejected for the reason above. Reading the setting once per batch in `event-mail.ts` was considered in review and left: two primary-key reads per row, the second only when a list is set, on a scheduler job at launch volumes — a pre-read parameter would give every batch caller a second way to be right.

**Tests.** Unit: `notifications/volume.test.ts`, `notifications/club-notices.test.ts`, `contact/recipients.test.ts`, `contact/message.test.ts`. Integration: `notifications/club-notices.test.ts` (queued after the list is set carries it, queued before does not, a TEST registration never), `contact/recipients.test.ts`, `contact/service.test.ts`. E2e (`email-plan.spec.ts`, desktop only, one shared row): the Administrator sets and clears both boxes and watches the forecast move by five per address; the Organizer reads the sentence in force — whichever state the shared row is in — and is offered no form.

Baseline `BR-V1.49-2026-09-22`.

## 294. Fixed — the programme reads as one thing in the editor: the rows are the programme, the text is the notes under it (2026-09-22)

**Status:** Fixed. `TranslationFieldsForm.tsx`, `EventFieldsForm.tsx`, `Admin.editor.fields.scheduleNotes`, `Admin.editor.scheduleHelp`, `Admin.editor.programmeNotesHint` in both catalogues; `tests/unit/content/programme-notes.test.ts`. Not a rule change.

**The report.** The owner, in the event editor: "programul evenimentului e duplicat!". His screenshot showed, in each language's Content panel, a fold "Programul evenimentului (niciunul încă — apasă ca să scrii)" and, further down in "Când și unde", a table "Program" with timed rows (Data / Ora / Până la / Ce (română) / Ce (engleză) / Unde / Adaugă un rând).

**What they are.** Two features that both render under `#schedule` on the event page: the timed rows (§117 — on the event row, one list for both languages, one calendar entry each, repeated in the reminder) and a rich text per language (§96, §71 — what does not fit a row). Not a duplicate in function, but the same word in two panels far apart, with nothing in either saying what the other was for, and a reader could not tell which to fill in.

**The fix.** The rows are the programme; the text is the notes beneath it, and each panel now says so about the other. The fold is titled *Note sub program* / *Notes under the programme* (a new key, `fields.scheduleNotes`; `fields.schedule` stays as the preview's heading, so the preview and the public page still both read *Programul evenimentului*), its hint says the rows in "Când și unde" → "Program" are the programme itself, shared by both languages, that this text appears beneath them on the page, and that the reminder repeats the rows and points here; its empty hint is the neutral "(nimic încă)" rather than the rules' "(niciunul încă)", which does not agree with *Note*. Under the rows table stands one caption saying what does not fit a row is written on the Content panel, per language, in that fold, and appears on the page beneath these rows. Both hints take the panel, section and fold names from the catalogue by interpolation, so a renamed panel cannot leave them pointing at a name that no longer exists.

**Checked, not changed.** `EventProgramme` (shared by the page and the preview) already draws the rows first and the rich text after; the reminder repeats the rows as one sentence per language and links `#schedule` — the notes are one tap away, not a second copy in the mail. No input is renamed, nothing moves between `events.schedule_items` and `event_translations.schedule_json`, neither feature is removed. *Rejected:* merging the two into one editor (the rows are data with a time and a place, the text is prose — §117 already refused a rich-text table for the same reason); renaming `fields.schedule` in place (it is the preview's public heading and would have made the preview say "notes" over the programme).

**Follow-ups outside this branch** (files carrying the baseline marker): `SETUP.md` §39's click list has a row "Română / English | Programul evenimentului | kit pickup, briefing, start, cut-offs — each row becomes a calendar entry" that names the fold but describes the rows; it should become two rows — "Când și unde | Program | kit pickup, briefing, start, cut-offs — each row becomes a calendar entry" and "Română / English | Note sub program | optional free text beneath the rows". `SPECS.md` BR-REQ-050-02 criterion 13 could add: "the section carries a caption naming where the per-language notes under the programme are written, and each language panel's rich text is titled as notes under the programme, never as the programme".

Baseline `BR-V1.50-2026-09-23`.

## 295. Fixed — the programme's rows follow the event's date (2026-09-22)

**Context.** The owner, in the event editor, moving the race: "data e de obicei în aceeași zi, deci dacă schimb o dată ar trebui să se schimbe toate datele evenimentului". Since §117 the programme is timed rows, each with its own `Data` box; moving the event by a week meant retyping the date on every row, and a row left on the old day is a wrong calendar entry and a wrong line in the reminder.

**Decision.** In the editor, the programme's rows follow "Începutul evenimentului". `ScheduleRowsEditor` — already the settings' one island (§117) — listens to the form's own start-date box (`event.startsAtDate`, the box `WallTimeField` posts, found by name through the `form` element the way `OnlyForType` reads the type select) and, when it moves from one complete date to another, shifts every row that has a date by the same number of calendar days: a row on the old start lands on the new one, kit pickup the day before stays the day before. A row with no date is left alone; an incomplete date (a date box reads "" while a segment is retyped) is waited out, not measured, so retyping the day is one move and never wipes the rows' dates; a new row opens on the event's day. The arithmetic is `shiftProgrammeDates` in `events/domain/schedule.ts`, pure — it takes the two dates and never reads the clock — on the form's `YYYY-MM-DD` strings, in calendar days rather than instants because the clock change is the service's business when the boxes are read at save time (§117), and reading a year as written (`setUTCFullYear`, not `Date.UTC`, which makes "0002" 1902) so a chain of moves through a half-typed year telescopes to the last one. The date box is the island's one controlled input; the rest stay uncontrolled, the form posts whatever is in the boxes, and nothing changed server-side. The programme help in both languages says so.

*Rejected:* a shared store or context between the start date and the rows (the start is a Server Component's field; the form is the only thing the two share, and a name-based lookup is what `OnlyForType` already does); shifting on the server at save time (the organizer would not see the rows move before saving, and a row meant to stay on another day could not be told from one forgotten); shifting rows that carry no date; moving the rows on the first date entered on a new event (there is no day to measure from, and a row dated before the event was is the organizer's own).

**Consequences.** `events/domain/schedule.ts` (`shiftProgrammeDates`), `content/events/ui/ScheduleRowsEditor.tsx` (`startDateName`, the `change` listener, a controlled date box, a new row's default), `EventFieldsForm` (`startDateName="event.startsAtDate"`), `editor.programmeHelp` in both catalogues; `tests/unit/events/schedule.test.ts` — same-day and two-day programmes, empty and malformed boxes, month, year and leap-day boundaries, a delta of zero, an anchor that is not a date, the telescoping chain. BR-REQ-050-02 criterion 13.

Baseline `BR-V1.50-2026-09-23`.

## 296. Changed — every fold in the backoffice is a box, drawn by one object (2026-09-22)

**Context.** The owner, looking at the bib-design panel ("Cum arată numărul de concurs") and the event editor: "toate aceste acordeoane din zona de backoffice trebuie sa fie mai 'boxed'". §164 had made a `<summary>` read as a control — marker, pointer, underline, 44 pixels — and §269 had put the registrations screen into boxes with `Panel`; but the folds themselves were styled in fourteen places by hand. Some had a border and some had none, `SeriesScope` had a different radius, the tasks' steps and the series dates stood at 36 pixels, the desk's bib picture had lost its marker, and the erase panel and the batch cancel each drew their own. The same gesture looked different on every screen, and most of the time it looked like a line of grey text with a triangle in front of it.

**Decision.** *One object, `BOXED_DISCLOSURE_SX` in `shared/ui/disclosure.ts`, and every fold in the backoffice spreads it.* A 1-pixel border in `divider`, `borderRadius: 1`, horizontal padding, the surface (`background.paper`) behind the body, and the summary as a bar: the §164 summary — marker, pointer, underline, `minHeight: 44` — with a wash of `action.hover` behind it. Open, the box stays: the summary squares its bottom corners, gets a rule under it and a margin below; the body gets bottom padding on `[open]` only, so a closed fold is exactly its summary. Theme tokens throughout, so the dark scheme follows without a second rule and `brand.ts` stays the only file with a colour.

*The box pads; the summary un-pads itself.* The children of a fold are whatever the screen puts there — a form, an ordered list, a `Stack` — so the horizontal padding is on the `<details>` and the summary reaches the border with a negative margin of the same size, padding itself back so its text lines up with the body's. A padding rule on `> :not(summary)` would have beaten every `pl` an ordered list sets; a wrapper element would have meant twenty edits. `listStylePosition: inside` is written out so the marker sits in the summary's own padding rather than outside the border the margin just reached.

*A fold that is deliberately a different colour keeps the colour on the same box.* The erase panel on a registration spreads the object and overrides `borderColor` to `error.light`; the batch cancel on the list, to `warning.light`. They say what is different about them and nothing else.

*`Panel` is the same box.* Its collapsible frame is now `BOXED_DISCLOSURE_SX` plus `scrollMarginTop`, so Înscrieri's panels, the four on `/admin/emails` and Echipa's "add a colleague" changed with everything else; its open, non-collapsible frame gained the same `background.paper` surface so a screen of both reads as one system. The summary carries no `sx` of its own any more — its look is addressed from the `<details>`, and it is still never `display: flex` (Chrome and Safari drop the marker when it is).

*Public pages did not change.* A fold on the registration form or in the footer is a line in a column of prose, and a box there would be a card in the middle of a sentence; `DISCLOSURE_SX` and `DISCLOSURE_SUMMARY_SX` are as they were, and the test refuses the boxed object in any public file.

**Consequences.** `shared/ui/disclosure.ts` (the object), `shared/ui/Panel.tsx`; the event editor's `LazyRichTextEditor`, `BibDesignPanel`, `EventFieldsForm` (type help), `TranslationFieldsForm` (SEO), `SeriesScope` and the repeat help on `/admin/events/[id]`; the previews on `/admin/emails`; the sections of `/admin/guide`; the how-to on the desk and the bib picture in `DeskRow`; the steps under each task on `/admin/tasks`; the series dates on the events list; the number change and the erase panel on a registration; the batch cancel on the list. Redundant per-site spacing (`pb`, `mt`, `my`) went with the one-off rules. `EditorPanel` is an open section, not a fold, and was left alone. Not a rule change; no baseline bump (§20).

Tests: `tests/unit/shared/boxed-disclosure.test.ts` — the object's shape (tokens, 44 pixels, marker inside, no `display`, no hex, the open state), and a scan of the admin tree and the backoffice modules asserting that every `component="details"` is drawn by the object, that no `"& > summary": { cursor` rule returns, that the two coloured panels override only the border, and that no public file imports it.

Baseline `BR-V1.50-2026-09-23`.

## 297. Added — Echipa says who has no sign-in account, and the board tests the invitation key (2026-09-23)

**Context.** §288 recorded two days during which every "Add" on Echipa wrote the `staff_users` row and created no Zitadel account, because the invitation key authenticated and could do nothing — the service account had a role on the project, not the Org User Manager membership. The page said so once, in a banner gone at the next click; `/admin/tasks` asked "is `ZITADEL_MANAGEMENT_PAT` set" and said done. §288 left two follow-ups owed in code. Both are built here.

**What was built.**

*One probe, the call §37 recommends.* `listZitadelHumanAccounts` (`staff-identity/zitadel-users.ts`) asks the key for the organization's human users — `POST /v2/users`, `TYPE_HUMAN`, one page of 200, bounded by `AbortSignal.timeout` at 4 s, `cache: "no-store"` — and answers a value, never a throw: `listed` with every name each account answers to (address, username, each login name, lowercased), `refused` with Zitadel's own words and status, `unreachable` for a timeout or no network, `unconfigured` without a key. It is the same endpoint `findZitadelUserId` uses before every resend, reset and deactivation (§171), so it exercises the permission the invitation needs rather than merely proving the token is valid.

*The reader is the control.* The trap in §288 is that a key without the membership is not refused — Zitadel narrows the search to what the caller may read and answers **200 with nobody**. So a listing cannot be read at face value: an empty one may be the key's blindness rather than an empty club. `checkInviteKey` (`diagnostics/invite-key.ts`) has one fact Zitadel does not: the person reading the page is signed in through Zitadel, so their account exists. A listing that does not contain the reader's own address is `blind`, whatever the status code; only a listing that finds the reader is `ok`, and only then does `hasNoAccount(check, email)` say anything about a row. `staff_users.email` is trim + lowercase and the listing is lowercased, so the comparison is exact.

*Echipa, permanently.* Each row whose address the key cannot find carries a warning Chip — "Fără cont de autentificare" / "No sign-in account" — in the name cell (the status column hides below `lg`, and this is the fact the row exists to carry), with the remedy once under the list: ⋮ → Revoke access, then Add again with the same address. When the check was blind, refused or unreachable, one Alert above the table says the accounts could not be checked and why, in Zitadel's words (the blind case says how many accounts the key saw and that yours was not among them); no row is marked and none is presumed to have an account. A missing key is not repeated — the existing `inviteKeyMissing` warning already says it (§176).

*The board tests the key.* `/admin/tasks` gains the row "The invitation key (Zitadel)", derived from the same probe on every open: no key → `open` with the whole of `SETUP.md` §37 as steps; `blind` or `refused` → **`broken`**, red, with §37 step 2 as its steps — Organization → Managers, role Org User Manager, the dialog called "Add an Administrator", and the trap spelled out: "Role Assignments" is not it; found the reader → `done` ("checked just now with a real search, it found your account"); no answer → `open` with the provider's words and no verdict, because a timeout says nothing about the key. Where the development switcher is the provider there is no row: a laptop has no key to owe. `OwnerTask` gains optional `text` and `steps` so a row can name the catalogue sentence and step list for a state that neither `todo` nor `done` describes; the page falls back to the old keys when they are unset.

**Decision — a fourth `TaskState`.** `blocking` is reserved for what stops a real person registering today (§150), and the line above the list — "nothing blocks a registration" — must go on being true. A key that authenticates and can create nobody stops no registration, yet "open" with an amber chip is how it went unnoticed for two days. So `broken`: red like blocking, sorted after it and before open, counted as pending. Telling a missing key (open) from a set key that does not work (broken) is the whole reason the row exists.

**Decision — no cache across requests.** No other probe in `diagnostics/` caches across requests, and a check the club is asked to act on must be the check of *this* page load; the pages that call it are dynamic. One request per page render, bounded inside; Echipa and the board each make their own.

**Refused.** A lookup per row (one request for the list is enough at the club's size and gives the same answer); trusting a 200 with an empty result as "nobody has an account" (it is the §288 failure itself); a `blocking` state for the key (it stops no registration); a banner that names who is missing an account (the row is where the fact lives, for as long as it is true); `SETUP.md` §37 step 2 paraphrased rather than copied into the row's steps.

**Tests.** `tests/unit/diagnostics/invite-key.test.ts` (BR-REQ-060-01 criterion 10, §288): the exact request and its signal; 200 with the reader and the per-row verdicts by address, case and login name; 200 without the reader as `blind`, never an empty club, with nothing claimed about anybody; 401 and 403 carried in Zitadel's words, a non-JSON body still naming the status; a network error, a `TimeoutError` and a garbled 200 as `unreachable`; a fetch that really hangs given up within the timeout; nothing called without a key or on the dev switcher. `tests/unit/diagnostics/owner-tasks.test.ts`: the row's states, text and steps for every answer; it never blocks; no row on the switcher; both catalogues carry every dynamic key (`blind`, `refused`, `unreachable`, `howBroken`, `howUnreachable`, `state.broken`), since the static scan cannot see keys built from the row. `tests/unit/staff/zitadel-users.test.ts`: the listing's shape.

`CLAUDE.md` item 10 no longer owes these two in code.

Baseline `BR-V1.51-2026-09-23`.

## 298. Decided — the check-your-email screen greets by name and says when no email is coming (2026-09-23)

**Context.** The owner, on the screen a runner lands on after pressing "Trimite înscrierea": it "should be more fun". It read like a receipt — a heading, the address, two sentences about the wait and the spam folder — and it said the same thing on every environment. Two testers registered on QA and waited for a message that was never coming: QA transmits through the allowlist and a laptop captures everything (`AGENTS.md` §16.4), and the form said "check your email" to both as if it were production. The rule that only production sends `live` did not bend; the screen did.

**Decision.** *A screen, not a receipt.* `src/modules/registrations/ui/CheckYourEmail.tsx`, a Server Component like the rest of the flow (`AGENTS.md` §1.5), replaces the success panel on the register page. "Aproape gata, Ana!" / "Almost there, Ana!" — the first token of the first-name box, sealed in the same ten-minute cookie as the address (`stashSubmittedFacts`, `readSubmittedFacts`, `firstNameOf` in `form-draft.ts`; the plain heading when there is none); the event's title and its date; the address read back (§224), because "check your email" is useless to somebody who typed `@gmail.con`; what happens next in three steps with the glyphs `RegistrationSteps` gives the email, the declaration and the confirmation (§91), rendered here as children and never handed to a client component as a prop; the wait in bold and once (§224); the spam folder and how long the link lives, taken from `EMAIL_CONFIRMATION_HOLD_HOURS` so the screen cannot promise what the allocator does not keep; the sentence that keeps it true for a repeat registration (§229); the resend and the contact form, each carrying the event (§205); and a 44px `Button component="a"` back to the event.

*It reads the same for a first and a repeat registration.* Everything on it comes from the form just posted and the event it was posted to; nothing is read from the registrations table, so the screen cannot answer whether an address was already on it — the oracle `AGENTS.md` §19.4 forbids. The warmer answer for a second registration stays in the email (§286).

*An environment that does not deliver says so, before anybody waits.* `emailDeliveryNotice(env)` in `src/modules/notifications/delivery-notice.ts` returns null on `live`, `deliveryNotice.capture` or `deliveryNotice.allowlist` otherwise; `EmailDeliveryNotice.tsx` renders the key as a warning Alert above the journey strip on the form and on the check-your-email screen, reading `env` from `@/shared/config/env`. Production shows nothing. The owner's Romanian wording is in both catalogues under `Registration.deliveryNotice.*`, and the three keys the receipt used (`submitted`, `submittedDelay`, `submittedSpam`) are gone from both.

*What the tests are named by.* The helper's suite is titled by the rule it reads, `AGENTS.md` §16.4, and not by BR-REQ-080-03: that requirement's three criteria state the modes and the startup refusal (`notifications/modes.test.ts`) and none names a notice to the participant, so a suite carrying its number would claim a coverage the requirement does not ask for. A fourth criterion — "given a mode other than live, the registration form and the check-your-email screen say so" — belongs to the next docs pass. Unit: the helper across the three modes, every non-live key resolving in both catalogues, `firstNameOf`, the sealed-cookie round-trip. E2E: `registration-entry.spec.ts` asserts the capture notice on the form and on the screen, the named greeting, the address and a ≥44px way back, under both the 320px and the desktop project; `registration-form.spec.ts` asserts the new heading where it used to assert the removed text, and asserts its absence where it proves a form was not posted.

**What was rejected.** *"You are already registered" on the screen.* It would answer a question about somebody else's address to anybody who types it (§19.4); the §229 sentence reads the same for everybody and only the inbox's owner learns which case they are in. *The confirmation deadline in the third step.* `done.next.declare.bodyLater` names how many days before the start the confirmation is asked and nothing more; the deadline is `RegistrationSteps`'s longer telling, so the screen reads only `opensDays` from the window and the caller passes the steps' object as is. *A client island for the greeting.* The name is in the same cookie as the address and is read on the server; nothing on the screen needs JavaScript.

Baseline `BR-V1.51-2026-09-23`.

## 299. Fixed — the footer wraps and Instagram shares the card; two of the four reports were not the site (2026-09-23)

Four reports from one evening, all on a phone or a tablet: the footer's Strava mark could not be tapped on an iPhone; between 600 and 750 pixels the social marks sat on the summary's last word and on the build badge; a Facebook share opened a "Create post" whose card was the bare domain, no title and no picture; "on iPhone the share buttons do not work"; and the owner wanted Instagram to be "an actual share, not just create a picture". Two were the site's; two were not, and the review is what told them apart.

**The footer is one wrapping flex row** (`shared/ui/SiteFooter.tsx`). The marks, the scheme switch and the language were absolutely positioned over the bar, so they had no width in the layout and were drawn over whatever sibling reached them — which is both the overlap and why Amalia's tap on Strava landed on something else. Now every control is an item of its own: the scheme switch (44 px), the `<details>` fold, the three 44×44 marks and, on a phone, the language. The fold gets `flex: 1 1 0%` on `xs` — a wrapping row assigns lines by hypothetical size, and a summary-sized basis pushed the language to a second line at 320 px — and `0 1 auto` from `sm`; `&[open]` takes the rest of the line so the marks step under the panel. `BuildBadge` floats from `md` rather than `sm`, since 600–900 px is where it sat on the Instagram mark. `tests/e2e/footer.spec.ts` measures the bar at five widths: 44 px targets, every control on the bar's first 44 px while closed, no two controls intersecting (the badge included), a trial click on every mark, the open-fold state, the badge on its own line at 640.

**Instagram is a share where the phone can take a file** (`events/instagram-share.ts`, `ui/InstagramShareButton.tsx`). Instagram has no share URL; what it takes is a picture from the phone's own sharing sheet. The island renders on the server as the download anchor, "Descarcă poza pentru Instagram", and becomes a button once the browser says it can share a file (`canShareFiles`, probed with a real `File`) **and the pointer is coarse** — a deliberate narrowing of the ask, recorded here: a desktop Safari can share files too, but its sheet has no Instagram in it, so a mouse keeps the download and the label says so. The click fetches the square card and calls `navigator.share({ files })` in the fetch's `.then`, inside the user activation iOS demands; `AbortError` (the sheet was closed) does nothing, anything else falls back to `location.assign(imageHref)` — the route answers `Content-Disposition: attachment`. `NativeShareButton` is unchanged in behaviour and shares the pill style through `share-pill.ts`. New key `Event.share.instagramDownload` in both catalogues. Playwright's `webServer` sets three placeholder `CLUB_*_URL`s so the footer's marks exist under test — CI configured none, and a footer with no marks has nothing to measure.

**The empty Facebook card was not the site, and the first fix for it was withdrawn.** The implementer's diagnosis was a trailing slash in `APP_BASE_URL` making `u=` read `https://host//ro/…`. The reviewer checked the live QA it was reported from: the button already sent `sharer.php?u=https%3A%2F%2Fqa.<host>%2Fro%2Fevenimente%2F…` — absolute, one slash, encoded once — with a matching canonical, `og:url`, `og:title` and an `og:image` answering 200 to `facebookexternalhit`. What QA answers every crawler is `robots.txt` → `Disallow: /` (`src/app/robots.ts`), on purpose for every environment but production, so Facebook's scraper is refused and draws the bare domain. **Production's robots allows, and production's event page serves the same correct card.** Nothing in this change alters that, and nothing should: a QA that search engines and scrapers index would be worse than a QA whose share preview is blank. What stays from the withdrawn fix is hygiene: `APP_BASE_URL` drops a trailing slash once, where it is validated (`shared/config/env.ts`, `z.url()` then a transform; a path prefix is kept), because forty `${env.APP_BASE_URL}${pathname}` joins would each mint a second spelling of every address if somebody ever typed one — normalised rather than refused, since a slash is a spelling and not an unsafe combination like the startup guards. `tests/unit/config/env.test.ts` covers the strip, the kept prefix and the join.

**"On iPhone the share buttons do not work" was not reproduced.** On `origin/qa` the Facebook and WhatsApp buttons were already plain `<a href target="_blank" rel="noopener noreferrer">`, and `NativeShareButton` already called `navigator.share` synchronously in its click handler; there was no `window.open` after an `await` to remove. The share builders were still consolidated (`events/share-links.ts`: `absoluteUrl`, `eventPageUrl`, `facebookShareUrl`, `whatsappShareUrl`, also feeding the canonical, `og:url` and the JSON-LD image), and the event page's share row is asserted by `share-links.spec.ts` (`u=` equals `page.url()` encoded once, the WhatsApp text, the Instagram control, 44 px on a phone). **Open, and only a real iPhone answers it:** the event page's share row — Facebook, WhatsApp, "Distribuie", Instagram share-then-fallback — tapped on Amalia's phone. If the report stands after this lands, the cause is something the emulator does not have (a content blocker, an in-app browser), and that is where to look.

**Tests.** 18 unit tests (the URL builders against a fixed base; the `File` construction and the fallback decision) plus the env strip; `footer.spec.ts` and `share-links.spec.ts`; 79 e2e runs green on both projects against a production build. BR-REQ-052-02 criterion 8 now reads: shares the square card through the phone's sheet where a file can be shared from a coarse pointer, otherwise offers it as a download labelled as such.

**What this section is also for.** Two of four reports were symptoms of something that was already right, and the first draft of this text claimed both as fixed. The reviewer's job was to refute, and it did; the honest record is worth more to the club than a fourth "fixed" — the next person who sees a blank card on QA now knows to look at `robots.txt` and not at the share button.

Baseline `BR-V1.52-2026-09-23`.

## 300. Decided — a series inherits its source’s Strava and Facebook event links, a duplicate still does not; and the series says what it did (2026-09-23)

**Context.** The owner, of the weekly run: "if I put the root links (https://www.strava.com/clubs/…/group_events/…, https://www.facebook.com/events/…) somehow strava and facebook should be smart enough to inherit this (I hope)" — after asking that the series be "super efficient from a DB perspective" and that what differs between dates (the place, the time, and these two links) be editable per date.

**What §71 and §130 decided, and why the half about the links is being changed.** §71 added the Strava event link as "one occurrence's — never carried onto a duplicate or a repeat, because next week's occurrence has its own address"; §130 listed "a film and a Strava event" among what never travels when a save on one date reaches the following ones; the Facebook link (§106-era) followed the same rule. The premise was wrong for a *series*. A **recurring Strava club event** keeps one `group_events/<id>` address for every occurrence, and a **Facebook event with several dates** keeps one `events/<id>` — the platforms themselves treat the series as one thing with one page. So the address typed on the source event *is* the address of every date, and a rule that refuses to copy it makes the Organizer paste the same link into eight rows and again every week the job makes a new one.

**Decision.** *A repeat inherits both links; a duplicate inherits neither.* `repeatEvent` and the standing job (`materializeStandingRepeats`, §122) put the source's `stravaEventUrl` and `facebookEventUrl` on every date they make; `duplicateEvent` — next year's edition — still leaves both empty, because next year's race has its own Strava and Facebook pages, exactly as §71 said. The distinction is the one the platforms make: the same event on another date, against another event.

*The links travel with a scoped save.* Both columns join `SERIES_COLUMNS` (§130): change the link on one date and "this and the following" or "all" carry the change like a changed place; save with "this date" and only that date has the new address — which is how a single date that really does have its own page (a special edition run under somebody else's event) keeps it. Nothing new is stored: each date is still its own row (§122), and the copy is made once, when the row is.

*The hints say so.* "Doar pentru această ediție; nu se copiază" becomes "Un eveniment Strava recurent are o singură adresă pentru toate datele, așa că seria o moștenește de la evenimentul de bază; o dată anume o poate schimba pe a ei" — and the same for Facebook — in both languages.

**What was rejected.** *Inheritance by reference* — members store no link and readers resolve through the source — offered when the owner asked for DB efficiency. It would make every reader of the link (the event page, the calendar's entries, the reminder) look up the source, for a saving of two short strings per row on a series the job keeps eight rows deep. The row-per-date model is the efficient one at this scale; what was inefficient was the Organizer's evening, and that is what this fixes. *Carrying the film too.* Left as it was: a film is of one edition, and last year's on this year's date is wrong (§71).

**And the banner says what the series did.** The same hour: "ce se intampla cu seriile? se creaza automat? nu e clar cand creeze si zice ‘urmatoarele 7 serii’". "{created} ediții create." was a number that depends on the day of the press — how many dates fit in the next eight weeks (§122) — with nothing about the weeks after it, so it read as a job half done. It now names the horizon it reached ("până pe 18 noiembrie") and says the platform creates the rest by itself, always eight weeks ahead, until the chosen date or for ever. The create page’s repeat hint still described §64’s world — "the following editions are created as drafts, publish them all from the list" — and now describes §122’s: eight weeks made with the event, the job keeps it ahead, drafts unless publish is ticked. Copy only; the mechanism was always right and never explained itself.

Baseline `BR-V1.53-2026-09-23`.

## 301. Added — the bib is previewed in the design panel as the boxes change (2026-09-23)

**Context.** The owner, on the event editor's "Cum arată numărul de concurs" panel (§249): "la BID
îmi trebuie un preview aici". The panel had five switches, two selects and two picture pickers,
and §249 had deliberately given it no JavaScript — the preview was the bibs page's picture,
after a save. Designing a bib by saving, opening another page, coming back and saving again is
not designing it.

**Decision.** *One picture, the renderer's own, with the unsaved design in its address.* The
panel opens with an `<img>` whose `src` is the existing picture route,
`/api/admin/events/<id>/bibs/preview`, in a new `?sample=1` mode: the card `bib-image.tsx` draws
for every participant, drawn for a placeholder runner — "Nume Prenume", numbered with the
event's start number (or the box's current value), the event's real title and date from the
row — with the design read from the query string rather than from the row. It is the same
`renderBibImage`, never a second drawing of the bib: the property §180 bought, that the preview
is a preview of the paper, is exactly what would have been spent by a client-side sketch.

*The unsaved design is validated by the schema the save uses.* `bibDesignFromQuery` turns the
query into a design through `readBibDesign` and `bibDesignSchema`, field by field: a query that
says nothing draws the platform's design, a query with one nonsense value draws the platform's
choice for that one field, and a picture from somebody else's server is refused where every
stored one is (§249). The sample carries no participant — a placeholder name and a number the
club chose — so the gate is the one every staff role already passes for a real bib; it is a GET
that mutates nothing (`AGENTS.md` §12.8) and is never cached, because the title and the date in
it belong to the row and a preview that lags a save is a preview of the wrong thing. With a
`registration=` named, the design parameters are ignored and the stored design is drawn — that
is what will print.

*One reader for the form, shared by the save and the preview.* `bib-design-query.ts` holds the
wire shape and imports nothing: `readBibDesignForm`, which `admin/actions.ts` had inline since
§249 and now shares, so the picture on the screen is drawn from exactly what the save would
post; the encoder and the decoder, whose keys are the schema's own field names so the round trip
is exact; the number bound; the address builder. It is a file of its own rather than part of
`bib-design.ts` because that module carries Zod and this one is imported by a client island —
no client module in this application carries Zod, and a preview is not the reason to start.

*The island is the panel's only JavaScript.* `BibDesignPreview` renders the `<img>` and a
caption, "Previzualizare — așa se tipărește", and keeps one debounced listener (300 ms) on the
`<form>` it sits in, for `input` and `change` from the panel's boxes, the band's colour and the
start number — the two live a little above the panel in the same form, and a colour the preview
ignored would be a surprise. It reads the form with `new FormData(form)`, the way the action
does; a keystroke in the title asks for no picture. The Server Component computes the first
address from the stored design, so the picture is on the page before any script runs and the
island only rebuilds it. 320 px wide at most, the card's 900×600 proportion declared so the
panel does not jump while a fresh picture loads, lazy so a closed fold costs nothing.

**Rejected.** *Drawing the bib in the browser* (CSS, canvas): a second renderer that would drift
from the paper — the thing §180 exists to prevent. *A separate route for the sample*: the same
handler, the same authorization, the same renderer; a mode is one branch, a route is a second
place to keep in step. *Posting the design and reading a response*: a GET whose address is the
design is cacheable, linkable and honest, and the URL is the round trip's own test. *Shipping
Zod to the client so `bib-design.ts` could be imported whole*: the island only reads boxes and
writes a query; validation is the server's, once.

**Consequences.** `bib-design-query.ts` (new); `bibDesignFromQuery` in `bib-design.ts`;
`findEventForBibs` returns `bibStartNumber`; the preview route's sample mode;
`BibDesignPreview.tsx` (new island) mounted by `BibDesignPanel`, which now takes the event's id,
start number and colour from `EventFieldsForm`; `readBibDesignForm` in `admin/actions.ts`;
`editor.bibDesign.previewCaption`, `previewAlt` and a reworded `previewNote` in both catalogues.
Tests: `tests/unit/registrations/bib-design-query.test.ts` — the round trip exact for the
platform's design and for one with every choice away from its default, through a real address;
garbage to defaults field by field, a third party's picture refused; the form reader; which
inputs the preview follows; the number bound. `bibs.test.ts` asserts the start number
`findEventForBibs` returns.

Baseline `BR-V1.53-2026-09-23`.

## 302. Decided — a participant leaves or rejoins the public list from their own link (2026-09-23)

**Context.** The owner: "people should be able to choose to not be shown on the public list if they don't want to, even after the registration, basically they can do that via email."

§32 built the public participant list and shipped it `HIDDEN`, with `registrations.list_opt_out` as the participant's own refusal, asked on every event; §143 turned the box round — "Vreau să apar pe lista de participanți", unticked, a tick puts the name on — and recorded that the answer is withdrawn "by writing to the club"; §186 made the opted-out runner a counted "Participant anonim" rather than a silently missing row. What none of them gave the participant was a way to change the answer themselves after pressing Submit. This completes that: the consent already exists, and this is the door for changing it. Not a rule change — the column, the published set (`list_opt_out = false`), the privacy test and the wording of the box are all exactly as §143 left them.

**Decision.** *One column, one write, three doors.*

- `registrations/list-consent.ts#setListConsent` is the only writer: it **sets** `list_opt_out` (never "toggles" — the form carries the answer it is making, so a double submission or two tabs land on the state the button said), bumps `updated_at`, and writes one audit row `registration.list_consent_changed` with **no staff actor** and metadata `{from: LISTED|NOT_LISTED, to, via}` — the shape of the change and the door, never the name (AGENTS.md §12.12). The same answer twice is one change and one row. The audit row is written inside the same transaction as the change: nothing here goes through the allocator or takes the event-row lock, so §12.12's reason for writing it afterwards does not apply.
- **The confirmation email carries a second link**, under a sixth token purpose, `LIST_CONSENT` (migration `0058`, expand only). Its own purpose rather than a second use of the manage token beside it, because spending one must not spend the other, and one active token per (registration, purpose) is what the table enforces. The link is worded by the row at send time: "Nu vreau să apar pe lista publică de participanți" when the name is on, "Vreau să apar…" when it is not. Same fortnight lifetime as the manage link; a resent confirmation supersedes it.
- **`/registrations/list/[token]`** (`/inregistrari/lista/[token]`): the GET says how the answer stands for this registration and event and shows one button; the token read and the page's own reads run in READ ONLY transactions, so a mail scanner opening the link changes nothing (BR-REQ-036-02 criterion 4). The POST spends the token in one statement, sets the answer, mints a fresh `LIST_CONSENT` token in the same transaction and lands on the same page under it — "I changed my mind" is the same button a second time. A used, expired or wrong-purpose link gets the one generic notice every token page gives, with the resend path; `mayReportState` was deliberately not widened to it.
- **The manage page and "Înscrierile mele"** carry the same button, under their own `MANAGE_REGISTRATION` / `MANAGE_PROFILE` links, **read and never spent** — the §77 precedent for "I am here": the choice is reversible and low-stakes, and spending a link on it would cost the person the cancel button on the same page. The registration must be the holder's own, checked against the token's participant, never trusted from the form; a stranger's id gets NOT_FOUND.
- The public list and the §186 count already read the column, so a name leaves the list the moment the row changes and returns the same way; no second query and no cache stand between the choice and the page (§281). The backoffice timeline labels the action and reads a null actor on it as "participantul, din linkul propriu" rather than "cont șters".

**Rejected.** *A preferences centre* (one page, many switches): one link, one flip is what was asked, and the manage page is where a second switch would go if one ever exists. *A new column*: `list_opt_out` is the answer; a second column would let the two disagree. *Spending the manage or profile link on the change*: it would take the cancel button away for a flip the person can undo a minute later. *Minting a `LIST_CONSENT` token on the GET of the manage or "mine" page so they could link to the list page*: a token insert on a GET is a mutation on a GET (§12.8).

**Consequences.** `registrations/list-consent.ts` (new), `app/[locale]/registrations/list/[token]/{page,actions}.tsx`, the manage and "mine" pages and actions, `my-registrations.ts` (`listed` on each row), `notifications/render.ts` and `templates.ts`, the `/admin/emails` preview data, `audit/repository.ts` (the action; `actorStaffUserId` on `AuditEntry`), `events/locale-switch.ts`, `i18n/routing.ts`, `schema/email-action-tokens.ts` + migration `0058_list_consent_purpose`, the `Registrations.list.*` and two `Admin` keys in both catalogues; `tests/integration/registrations/list-consent.test.ts`. BR-REQ-039-01 gains, in effect, a criterion — "after registration, the participant changes the answer from the link in the confirmation, from the manage page or from 'Înscrierile mele'; the list follows the row at once" — which `SPECS.md` should carry.

Baseline `BR-V1.53-2026-09-23`.

## 303. Decided — the create page is the editor's own pieces, a film lives in the text, the time is picked, and the place has a name per language (2026-09-23)

**Context.** The owner, on `/admin/events/new` with a screenshot: "This event create page is a bit inconsistent with the event edit: first of all, there is no rich text editor?? per language content should be tabbed; link video should not be present anymore since we have the rich text editor." Earlier, of the same page: "«Repetă evenimentul» ar trebui să apară sus de tot, la început." Of the time boxes: "timepickerul ar trebui să fie tot element MUI, nu să bag eu de mână timpul." And, in the same breath about the languages: "și tot legat de multi-lingual, ar trebui să pot pune și denumirea locației în română și în engleză."

The create page had drifted because it rendered pieces of its own: two stacked "Conținut (RO)" / "Conținut (EN)" sections with a plain title, slug and one-line excerpt, then the settings panels, then recurrence at the very bottom. The editor had long since moved to tabs (§36), a rich summary (§73, §260), folds (§260) and boxed disclosures. Two pages, two sets of inputs, one action reading them — and the second set was never going to keep up.

**Decision.** *The create page is built from the editor's own pieces, and only those.* `LocaleTabPanels` over `TranslationFieldsForm` per locale, each handed a blank translation (no row id, no version, so the panel posts neither), then `EventFieldsForm`, then the button. `createEventAction` reads each language with the save's reader (`translationInputFrom`, which `translationFieldsFrom` now wraps) and the service writes both through one function (`translationColumnsFrom`, which the save uses too), so "the excerpt is the summary's words" is true from the first insert rather than the first save. `newEventSchema` takes the whole `translationFieldsSchema` per language; the three fields an older caller sends still parse, because everything else is optional in the input. What the two pages post is now read by the same two readers, and a field added to one panel is on both pages by construction.

*Recurrence first.* Whether this is one date or a series is the first thing decided, before the date itself. On the editor the repeat panel already stands at the top of the right-hand column under "Publicare" — first on a phone — and stays there.

*The film box is gone, from both pages.* A film is a figure in the description since §266, placed and sized like a picture with the rich text's own YouTube button; a second way in was one too many. Found while removing it: `eventFieldsFrom` never read `event.videoUrl`, so the box had never saved a link, and every save wrote `null` over any link the row carried. `videoUrl` absent from a save now means "not editing the film" — the discipline `coHosts` (§169) and `bibDesign` (§249) follow — so an older event's link survives every save, and the public page still embeds it. **The column stays.** Dropping `events.video_url` is a contraction for a later release, one after the code stopped writing it, per AGENTS.md §7.6.

*The time is picked, not typed — amending §70.* Every time box on the event form — the start, the gun time, the registration window, the programme rows' "Ora" and "Până la" — is `<input type="time">`: a clock on a phone, spinners on a desktop, the same family as the date box beside it, and no dependency. §70 refused `datetime-local` because it prints the *date* in the browser's order, which is ambiguous; a time has no such ambiguity, and what the input **posts** is `HH:MM` on the 24-hour clock whatever face the browser shows, which is what the service reads and every bib prints. `@mui/x-date-pickers` was considered and not added: a client island of some hundred kilobytes on the editor for a clock the browser already has (AGENTS.md §1.5). If the owner wants a clock that always *shows* 24 hours, that is the separate decision.

*The place has a name per language — taking back one piece of §36.* §36 moved the meeting point to the event row because "the second copy was not a translation, it was the same fact again", and accepted that the English page shows "Parcul Tractorul". The owner now wants the name in both languages. The *fact* stays where §36 put it: `events.location_name`, required once in "Când și unde", read by the desk, the calendar, the declaration PDF, the series' "moved" mark and every reader without a translation at hand. The *name* is a translation: `event_translations.location_name` (migration `0058`, nullable, expand only), asked on each language's tab after the title as "Denumirea locului (în această limbă)", optional. The public page, the preview and the emails read the language's name when the club gave one and the event's otherwise — `COALESCE(NULLIF(btrim(translation), ''), event)` in `PUBLIC_COLUMNS` and `findEventNotificationDetails`. It is **not** a cross-locale fallback: a blank English name reads the event row, never the Romanian row; BR-REQ-040-02 is untouched. A save that does not mention the field leaves it as it is (the `checklist` rule); a blank clears it. Series edits and duplicates carry it like any other word.

*A required box behind a tab or a fold.* Rendering the editor's panel on create exposed something the editor had been spared by its pre-filled rows: an empty required English title sits in a `hidden` tab panel, the browser refuses the submit, tries to focus the box, cannot, logs "an invalid form control is not focusable" — and the organizer sees a button that does nothing. `LocaleTabPanels` now listens to `invalid` on each panel: the panel holding the control comes forward *during* the event (the DOM attribute set by hand, since React's re-render lands after the browser has looked for something to focus), and every closed `<details>` on the way up is opened. The address fold is open while there is no address yet, for the same reason.

**Refused.** A separate short create form kept "simple" (it was the drift itself); posting the language's name from the settings panel (it is a word, and the Redactor's, not the Organizer's); requiring the English name for publication (the event's own name is a complete answer, as §36 said); dropping `video_url` in this release.

**Consequences.** The four create e2e specs click the English tab before filling the English fields; the slug lives in the address fold, open on create. "Ora (24h)" reads "Ora": the label no longer promises a face the browser chooses. `Admin.editor.translationSection`, `videoUrl`, `videoUrlHelp` and `panels.video` are gone from both catalogues.

Tests: `tests/unit/content/create-page.test.ts` (the pieces, the order on both pages, no video input, every time box native, the location field, the reveal), `tests/integration/cms/crud.test.ts` (a create stores the rich summary's words as the excerpt and the body for both languages), `tests/integration/cms/location-name-per-language.test.ts` (the language's name on the public page and in the notification details, the event's where none was given, absent leaves it, blank clears it, never the other language's), `tests/integration/cms/boundary.test.ts` (the allowlist gains `locationName`).

Baseline `BR-V1.54-2026-09-23`.

## 304. Fixed — a press held for the anti-bot check is sent, not dropped; a slow submit says so (2026-09-23)

**Context.** Amalia, from her laptop, 11:26: "cu autofill nu am reusit nici eu sa ma inscriu … nu am eroare … ramane blocat … ca si cum m-am inscris … dar nu apare pe lista." The owner: "fix Amalia's issue ASAP".

**What the database said.** Read-only, QA, three days back: Amalia registered on 2026-09-22 at 14:13, was confirmed, and every message to her — verification, declaration, confirmation, and the cancellation at 17:22 — was `SENT`. So the Mailgun sandbox was not her problem. For 11:26 on the 23rd there is **no registration, no outbox row, no audit row**: whatever she pressed never reached the server. The form has exactly three exits — a red summary, the check-your-email screen, or a request that never returns — and none of them had run.

**What swallowed the press.** §285 made the send button wait for Cloudflare's token: a press made before the token existed was held — `event.preventDefault()`, a sentence under the button, "Se verifică o secundă că nu ești robot — apoi poți trimite" — and when the token landed the sentence simply went away. Nothing sent the form. The person had to press again, and nothing said so. That was tolerable for somebody typing: the token arrives in the half-second between the last field and the button. It is the *normal* case for autofill, which fills the whole form and lets the person press in the same second the widget starts. Amalia's press was held, the sentence vanished, and she read a quiet form as a form that had gone through — "ca si cum m-am inscris".

**Decision.** *The held press is replayed.* `SubmitButton` remembers the early press and, the moment `waiting` turns false — the token arrived, or §285's eight-second valve opened because the widget never answered — calls `form.requestSubmit(button)`: the browser's own submit, with this button as the submitter, so constraint validation and the Server Action run exactly as for a fresh press. Once, and never while a request is in flight. The sentence now promises it: "Verificăm o secundă că nu ești robot — trimitem noi înscrierea imediat ce răspunde; nu mai apăsa."

*A submit that takes too long says so.* `pending` comes from the form's status and lasts as long as the request; a request a proxy swallowed lasts for ever, and the runner beside the label was the only sign — which reads as success. After fifteen seconds a second sentence appears: it is taking longer than usual, wait, and do not press again — a second press would only queue behind the first. The request cannot be cancelled from the button; honesty is what it can offer. The register page passes both sentences; every other `SubmitButton` is unchanged.

**What was rejected.** *Submitting immediately with no token when the person presses early.* The server accepts an `unavailable` verdict on the other defences, so it would work — and it would turn every quick press into a submission that skipped the check, which is the one thing §285 was for. Waiting up to eight seconds and then sending is the same outcome for a blocked widget and the intended one for a working widget. *A browser test.* The unit suite has no DOM; `tests/unit/shared/held-press-is-sent.test.ts` pins the replay, the valve, the slow sentence and both catalogues at source level, and `registration-autofill.spec.ts` keeps proving the autofill path in a browser — where Turnstile is not configured under test, so the wait never engages; the replay is exercised only where a widget exists, which is QA and production.

**Left open.** Whether Amalia's widget ever answered on her laptop is unknown (a work network can block `challenges.cloudflare.com`); either way the press is now sent within eight seconds. Her earlier registration was cancelled by staff on the 22nd, so her retry was a genuine re-registration — the server handles that (§235) and would have emailed her; staff still have no marker for a repeated submission, which is queued separately.

Baseline `BR-V1.55-2026-09-23`.

## 305. Changed — every listing card has a door to its page in words, and a standing series says on the backoffice list that it renews itself (2026-09-23)

**Context.** Two reports from the owner, minutes apart, both about a list that did not say what it meant. On the public listing, with the two weekly runs in front of him: "am nevoie de un buton pe carduri pentru 'descrierea completa a evenimentului'". On the backoffice events list, whose series row read "În fiecare luni, la 18:30 · Publicat · 9 date · 21 sept. – 16 nov. 2026": "I need to know here that the event is gonna be auto-renewed".

**The card.** The title was the card's only link, and a title does not announce that a page exists behind it — a reader who wants the rules or the programme has no word telling them where to press. A plain anchor styled as a button now sits at the card's foot: "Descrierea completă a evenimentului" / "Full event description", 44 px, to the next date's page — the same door the title opens, and `listing-card-button.spec.ts` asserts the two agree. A Server Component still: `Button component="a"` with a string `href` from `getPathname`, no client island (§1.5). The card's height rule (§275, equal heights in a row) is untouched: the button is the last child of every card alike.

**The series row.** "21 sept. – 16 nov. 2026" was the span of the dates the standing job had materialised so far — eight weeks (§122) — and it read as an end date; "9 date" read as a total. The rule itself was on the row's source event and nowhere on the screen. `renewalOf` (pure, `series-sentence.ts`) looks through the group for the one row that carries a `repeat_rule` and answers with its `until`; the row then says, under the cadence: "Se reînnoiește automat: platforma creează datele mereu 8 săptămâni înainte, la nesfârșit" — or "până pe 14 decembrie 2026" for a rule with an end. A set of dates made once (§64) has no rule and gets no line, because it really does end. The number of weeks is `HORIZON_DAYS / 7`, the constant the job reads, so the sentence cannot drift from the mechanism. This completes what §300's banner did for the moment of creation: the list is where the club looks afterwards.

**What was rejected.** *Changing the date column to "de la 21 sept." for a ruled series.* The span is true — those dates exist — and the sentence beneath it now says what it is; rewriting the column would have hidden useful information to fix a misreading a sentence fixes better. *A tooltip.* It repeats the line it covers and pops on every tap (§261).

Baseline `BR-V1.56-2026-09-23`.

## 306. Decided — the Neon plan is a setting, and every Neon figure follows it (2026-09-23)

**Context.** The owner, on 2026-09-23, with two screenshots side by side: `/devs` saying "Planul gratuit dă 100 ore-CU pe lună pe proiect; când se termină, baza de date se oprește… 2.6 din 100 ore-CU folosite (3%)… Spațiu ocupat: 11 MB din 512 MB", and Neon's billing page saying **Plan: Launch**, "Free limits are removed", "Compute 6.43 compute hours $0.68", period Sep 22 → Oct 1. "faza asta cu DB-ul Neon nu e actualizata! pt ca am zis ca am cumparat urmatorul plan! In 2 zile am gen 60 de centi." §280 had recorded the account as Launch since 2026-09-22 and left the labels as an owed follow-up; this is it.

**Why a setting and not a constant.** Neon's API gives a project key the consumption — `compute_time_seconds`, `active_time_seconds`, the period — and neither the plan nor the invoice. Somebody has to say which plan the account is on, and the last time the answer was a constant (`platform-plans.ts` said Free, `neon.ts` divided by 100) the owner bought a plan and every page went on saying the old one until a deploy. §280 also says the owner may return the account to Free in December after real invoices. That decision must cost one select on a screen, not a release — exactly the argument §100 made for the Mailgun plan, and the same shape is used.

**Decision.** `platform_settings.neonPlan`: `FREE` or `LAUNCH`, a note ("Launch since 22 September; review in December"), who and when; audited as `neon_plan.changed` with from, to and the note. An Administrator (`canManageRegistrations`) sets it on `/admin/tasks` → Costuri, above the figures that follow it, once per environment — the Neon account holds both projects but each deployment reads its own row. `/devs` reads it, prints which plan the figures are read against, and links to the panel for a reader who may open it or names who sets it for one who may not (the Tehnic role reads `/devs` and not `/admin/tasks`; a link into a 404 is worse than a sentence). No `CUSTOM`: Neon has two plans the club can be on, and a third the club has no reason for; adding one is a row in the catalogue and a value in the enum.

**The default is Free, not Launch**, although the account has been on Launch since 2026-09-22. A fresh deployment has no reason to assume money, and a default that assumed it would hide a Free project's real cutoff behind a calm "pay as you go" until the site was down; a stored value this code cannot read falls back the same way. The Administrator states the plan once on QA and once on production, and the row is then the deployment's truth.

**One catalogue.** `modules/diagnostics/domain/neon-plan.ts` holds every Neon figure with the date it was checked (`NEON_PLANS_CHECKED_ON = 2026-09-22`, the owner's console and neon.com/pricing): Free — 100 CU-hours a month per project, 0.5 GB, suspends when spent; Launch — $0.106 per CU-hour (1.8 hours for $0.19 reconcile to it), $0.35 per GB-month of storage, $0.20 per GB-month of changes kept for Instant Restore, no monthly minimum. `NEON_FREE_CU_HOURS`, `NEON_FREE_STORAGE_BYTES`, `NEON_LAUNCH_USD_PER_CU_HOUR` and `NEON_LAUNCH_USD_PER_GB_MONTH` are now re-exports of it. Every rate a page prints comes through a placeholder (`{rate}`, `{storageRate}`, `{of}`), and a test refuses a literal rate or ceiling in the Neon messages of either catalogue, so a page and a constant cannot disagree — the property `platform-plans.test.ts` already held for `/devs` and prices.

**What each plan shows.** `describeNeonBlock` is pure and returns numbers; the page picks the sentence. *Free:* exactly the block that existed — the CU-hours against the plan's hundred with a percentage, red past eighty percent (a hundred percent is the site going down), the storage against half a gigabyte, "stops until next month". *Launch:* no ceiling and nothing red; the same hours as an **estimated** charge at the catalogue rate ("6.4 ore-CU; cost estimat: 0,68 $ (0,106 $/oră-CU)"), the storage at its GB-month rate (a club database is megabytes, so "under a cent" rather than a zero), the restore rate named, and the word "estimate" — because the API gives consumption and Neon's invoice adds the restore history over the whole period and rounds its own way. On both plans the "compute awake N h of M h elapsed" line and the period's end stay: they are what explains the hours, and therefore the bill, and the fifteen-minute cadence of §68 is now cost control rather than cutoff avoidance (§280).

**The cost table follows the setting.** On Free the Neon row is unchanged: free, storage measured against the half gigabyte, Launch as the next plan at its per-hour rate. On Launch it is a new kind of cost, `usage`: this month's pace projected to a full month (`projectedNeonLaunchUsdPerMonth`, pure, unchanged) beside the daily rate it was made from (`neonCuHoursPerDay` — "1.8 CU-hours a day" is what §280 reasoned from), "ok" when a key measures the pace and "unknown" when none does, its own wording under `services.neon.launch.*` (a `variant` on the row, so the "first limit" sentence stops describing a limit that no longer exists), and no next plan: Scale is for an SLA the club does not need and its price is not recorded here, so it is not quoted (§1.2). The bump stays "temporary" and its wording is the way *down* — December, one select on this panel. `annualCostToday` adds twelve of the monthly estimate and marks the total `estimated`; unmeasured usage adds nothing and still marks it, so the total is known to be incomplete rather than looking whole. `freeTierVerdict` gains `paysForUsage`, read as a choice the club made (a blue notice), not a limit met (amber). `nextSpend` is still email.

**Health.** `/api/health` and the monitors never read Neon's hours — the Free eighty-percent warning lived on `/devs` alone — so there was nothing to gate on the setting and nothing to fall back to when the database is away. Said in `docs/PLATFORM.md` rather than coded.

*Rejected:* an environment variable (§100's objection stands: a value nobody sees, changed by a deploy — and this one changes with the December review); reading the plan from Neon (the API does not say it); defaulting to Launch because the account is on it (a fresh deployment assuming money, and a Free cutoff hidden behind a calm sentence); a `CUSTOM` plan with typed ceilings (nothing to type — Neon's plans are two, and the catalogue is one row per plan); dropping the estimate from `/devs` to keep "no money on `/devs`" (§88's split) — BR-REQ-090-07 criterion 1 asks for the estimated charge there, the owner's complaint was that page, and the property the test protected (no price literal in the `Devs` messages) is kept by passing the rate as a value; quoting Scale as the next plan (no verified price).

**Consequences.** `diagnostics/domain/neon-plan.ts` (catalogue, schema, `describeNeonBlock`), `diagnostics/neon-plan.ts` (`readNeonPlan`, `updateNeonPlan`, entity id `…e006`), `diagnostics/ui/NeonPlanPanel.tsx`, `admin/tasks/actions.ts` (`updateNeonPlanAction`, lands on `?panel=costs`), the two pages, `platform-plans.ts` (`AnnualCost.usage`, `ServiceRow.variant`, `PlatformFacts.neonPlan` replacing `databaseStorageAllowanceBytes`, `neonCuHoursPerDay`, `paysForUsage`), the audit action `neon_plan.changed`; `Admin.tasks.neonPlan.*`, `services.neon.launch.*`, `Devs.neon.*` in both languages; the Administrator's guide step; the monitor steps no longer quote the hundred hours; `docs/PLATFORM.md`. Tests: `tests/unit/diagnostics/neon-plan.test.ts`, `tests/integration/diagnostics/neon-plan.test.ts`, `tests/unit/diagnostics/platform-plans.test.ts` (extended), `tests/e2e/neon-plan.spec.ts`. BR-REQ-090-07 criteria 1, 2 and 5. Still owed by the owner: set Launch on QA and on production (`/admin/tasks` → Costuri → Planul Neon), once each; `SETUP.md` §33 and `README.md` still describe the labels as stale and are corrected with this baseline.

Baseline `BR-V1.56-2026-09-23`.

Baseline `BR-V1.57-2026-09-23`.

## 307. Changed — QA sends through the club's domain with its own key, and its notice says the mail is real (2026-09-23)

**Context.** §163 let a QA deployment address anyone through the allowlist's star, and QA's notice (the one §37's two waiting testers produced) kept saying "only the addresses the club authorized receive mail", because QA still sent through Mailgun's US sandbox, which delivers to five confirmed recipients and nobody else. Amalia's second registration on 2026-09-23 made the owner say it outright: "we need to drop that allowlist, and both us and the user needs to know he is trying to re-register". The application's allowlist was already the star; the gate that remained was the provider's.

**Decision.** QA sends through the club's verified domain, `mail.<club domain>` in Mailgun's EU region, with **its own sending key** (`brasovrunners-qa`), not production's: a key revoked on one environment must not stop the other. The key lives on the QA Vercel project as `MAILGUN_API_KEY` and in the owner's `.env.local` as `MAILGUN_API_KEY_QA`, never in the repository. `EMAIL_DELIVERY_MODE` stays `allowlist` and the list keeps its star (§163): `live` outside production is still refused at startup, and every QA subject still carries `[QA] ` (`QA_SUBJECT_PREFIX`).

**The notice follows the list.** `emailDeliveryNotice` now reads `EMAIL_ALLOWLIST` as well as the mode. With the star it returns `deliveryNotice.everyone` — "emailurile pleacă de aici cu adevărat, marcate „[QA]” în subiect — dar înscrierea de aici nu este una reală și nu îți ține un loc la cursă" — because telling a tester they will receive nothing while the message is already in their inbox is §37's failure in reverse. A list of named addresses keeps `deliveryNotice.allowlist`, which is still exactly true for it. Capture and live are unchanged.

**What it costs, and what it does not cover.** QA and production now share one sending domain, so they share its plan's daily allowance (the Free plan's hundred a day, §100): a QA rehearsal that sends thirty messages leaves seventy for real runners that day. The domain's webhooks point at production, so a bounce of a QA message is recorded on production's outbox, not QA's; a rehearsal that needs to see a bounce on QA does not get one. Neither is worth a second domain while the club is on Free; both are named here so nobody is surprised.

**Reverses nothing.** §37 (sandbox first, before the domain existed) described the order of work and is complete; §163's star is unchanged.

Baseline `BR-V1.58-2026-09-23`.

## 308. Changed — the listing card says until when registration is open (2026-09-23)

**Context.** The owner, on 2026-09-23: "I also need to show when registrations are closing on the event card." While a window was ahead, the card already said when it opens (§146, "Înscrierile se deschid pe 1 oct., 09:00"); once it opened, the card said only "Înscrierile sunt deschise" — true, and no help to somebody deciding whether to register tonight or at the weekend. The date the button disappears was on no public surface at all.

**Decision.** While registration is open, the card's last piece reads "Înscrieri deschise până pe 14 nov., 23:59" / "Registration open until 14 Nov, 23:59", in the event's time zone, in the same short form as the opening's sentence. The date is **the instant `registrationState` turns `CLOSED`** — the stated `registration_closes_at`, or the event's start when none is stated (BR-REQ-011-01 criterion 3) — read through one pure helper, `openRegistrationClosing`, beside `upcomingRegistrationOpening`, using the same expression the state uses. So the card's date and the moment the button goes away cannot disagree, and a test pins that at the boundary. Before the window opens the card keeps the opening's sentence (one date at a time); an external, absent, cancelled or completed registration names no closing, whatever its columns hold. A series card reads it for its next date.

**Where it is not, on purpose.** The event page and the listing's featured hero render the full facts, where the registration button and its free places stand for the state; the owner asked for the card. Adding the same line there is one call to the same helper if wanted.

**The same card, one more change.** The owner, the same afternoon: "'Full description' buttons should be smaller and not in caps." §305's button now reads in sentence case, in a smaller type with tight padding (`CARD_DOOR_SX`, `events/ui/card-door.ts`, shared by the series card and the single-date card so the two stay alike). It keeps the 44-pixel height BR-REQ-041-01 criterion 6 asks of every control a thumb must hit: what shrinks is what the eye sees, not what the finger gets.

Baseline `BR-V1.59-2026-09-23`.
