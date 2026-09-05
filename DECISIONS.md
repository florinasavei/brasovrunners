<!-- PROJECT_BASELINE: BR-V1.18-2026-09-04 -->

# Brașov Runners — Decision History and Agent Handoff

**Baseline `BR-V1.18-2026-09-04`** · versioned with the whole set · [changelog](./CHANGELOG.md)


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
