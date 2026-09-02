<!-- PROJECT_BASELINE: BR-V1.12-2026-09-02 -->

# Brașov Runners — Decision History and Agent Handoff

**Baseline `BR-V1.12-2026-09-02`** · versioned with the whole set · [changelog](./CHANGELOG.md)


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
