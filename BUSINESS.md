<!-- PROJECT_BASELINE: BR-V1.18-2026-09-04 -->

# Brașov Runners — Business Guide

**Baseline `BR-V1.18-2026-09-04`** · versioned with the whole set · [changelog](./CHANGELOG.md)


**Audience:** Club organizers, event coordinators, content contributors, sponsors, and other non-technical stakeholders.

This document explains what the platform is for and how it behaves. Product acceptance criteria are in [`SPECS.md`](./SPECS.md); technical rules are in [`AGENTS.md`](./AGENTS.md); setup steps are in [`SETUP.md`](./SETUP.md); planning rationale is preserved in [`DECISIONS.md`](./DECISIONS.md).

## 1. Club context

Brașov Runners is a small local running club that organizes:

- regular social and training meetups;
- weekly and occasional community runs;
- larger local running events;
- local races and running contests;
- articles, announcements, and photo stories about the community.

The platform should help the club operate professionally without becoming a large commercial race-management product.

## 2. Product purpose

The platform has five main jobs:

1. Help people discover what Brașov Runners is organizing.
2. Give people clear information before they join or register.
3. Let people register with minimal friction and without creating a password account.
4. Let the club manage places, waiting lists, declarations, participants, and transactional email safely.
5. Let trusted contributors keep the website current without asking a developer for every change.

The guiding rule is:

> Build the smallest reliable platform that serves the real needs of the local running community.

## 3. Audiences

### Visitor

A person browsing the public website.

They can:

- understand what Brașov Runners is;
- browse upcoming runs, meetups, events, and races;
- read event information in Romanian or English;
- see how many places are currently available;
- see the distances offered by a race and choose one;
- read published race results (from M2);
- read articles and view public galleries (from M5);
- open an optional public runner profile when given its link.

### Participant

A person registering for an event. A participant does not need an application account or password.

They can:

- submit their name and email for an eligible event, acknowledging the privacy notice;
- choose whether their name may appear in public results;
- confirm control of that email address;
- sign the approved declaration when a place is available;
- join a waiting list when the event is full;
- accept a time-limited waiting-list offer;
- unregister through a secure email link before the event starts;
- request or receive a replacement management link;
- optionally create and publish a small public runner profile with selected social links.

### Author

A trusted club contributor who writes content.

They can:

- create article drafts;
- edit their own drafts;
- write or translate assigned descriptions;
- select or upload editorial images when permitted;
- preview content;
- submit drafts for editorial review.

They cannot publish content or access participant data.

### Editor

A trusted organizer or communications person.

They can:

- review and edit all editorial content;
- publish, unpublish, and archive content;
- manage event descriptions and translations;
- manage galleries and approved media;
- manage the public information needed for event publication.

### Administrator

A small number of trusted club operators.

They can additionally:

- manage registrations, participants, waiting lists, and public profiles;
- inspect declaration and email state;
- resend the email appropriate to the participant's current state;
- cancel, safely restart, waitlist, or promote a registration without bypassing email confirmation or declaration acceptance;
- export necessary participant data;
- manage staff roles;
- resolve failed transactional emails;
- perform sensitive operational actions with an audit trail.

## 4. Business rules

These IDs are stable references used by `SPECS.md` and `AGENTS.md`.

### BR-BUS-001 — One community platform

The public website, events, registration, waiting lists, declarations, participant administration, public runner profiles, articles, galleries, and mini CMS belong to one Brașov Runners platform.

The club should not need separate systems for ordinary free meetups unless an external registration provider is deliberately selected for a specific event.

### BR-BUS-010 — Event categories

The platform may present:

- community run;
- trail run;
- interval or training session;
- long run;
- meetup or social run;
- race or running contest;
- another explicitly named running activity.

A race is an event type, not a separate registration system.

### BR-BUS-011 — Small meetup and large event differences

A small meetup may need only:

- date and time;
- meeting point, and a link to it on a map;
- approximate distance or difficulty;
- short description;
- no registration or simple internal registration.

A larger event or race may additionally need:

- two times rather than one: when to be there, and when the race starts. Runners need both, and
  the difference is often an hour;
- longer description;
- capacity;
- registration opening and closing dates;
- a waiting list;
- an external registration link;
- participant export;
- stronger operational checks.

One event at a time may be the club's **featured** event. The website leads with that one, in
full, above the ordinary list — the anniversary cross rather than the fourth card down. Marking
a second event as featured is refused: two lead events is no lead event.

The map link is the one the organizer already uses and shares. The platform stores it rather
than building it, so the club is never tied to one map provider.

The same event model supports both without forcing race-only complexity onto weekly meetups.

### BR-BUS-012 — A race may offer several distances

A race such as a 5 km, 10 km, and 21 km event on the same morning is one race to a visitor
and several events to the system. It is modelled as a **race** that groups **child events**,
one per distance.

Rules:

- the race carries the shared name, date, place, and description, and has one public page;
- each distance is its own event with its own distance, capacity, free-place count, waiting
  list, and declaration;
- a person may hold at most one active registration across the distances of one race;
  registering for a second distance is treated as a duplicate;
- a race with a single distance is simply an event, and needs no race record;
- results, when published (M2), are per distance.

The registration behavior of a child event is identical to any other internal event. The
race only groups.

### BR-BUS-020 — Event publication

An event is published or it is not, and both languages go live together. Publishing is a decision
about the event, not about a language: the club advertises a race, not a Romanian race and an
English one.

Publishing is refused while either language is incomplete, and the interface says which language
and which fields. That is the same rule the club would apply by hand — a page that reads as
half-translated in one language is worse than a page that is not there yet.

An event that has no translation in a language simply does not exist in that language: the page
is not found, the listing does not carry it, and the sitemap does not list it. It must never
display the other language's text as if it were a translation.

Cancelled events remain visible with a clear cancelled status when that information is still
useful to visitors.

### BR-BUS-030 — Registration modes

Each event uses exactly one registration mode:

- **None:** information only; no registration action.
- **Internal:** Brașov Runners manages registration in this platform.
- **External:** the visitor follows a link to another registration provider.

An external event does not create a local participant registration unless a later explicit integration is built.

### BR-BUS-031 — No participant account required

Internal registration does not require a participant login, password, or account of any kind.

The participant supplies a full name and email address, and acknowledges the current approved privacy notice before the registration is accepted. The acknowledged privacy-notice version is recorded with the registration.

Control of the email address is confirmed through an emailed link before the registration can progress. The confirmation link is valid for 48 hours. When it is not used in time the registration expires, and the person may start again while registration is still open.

Sign-in exists only for staff using the CMS and backoffice.

### BR-BUS-032 — Email identity and duplicate prevention

The platform treats one canonical email address as one participant identity.

Rules:

- surrounding whitespace is ignored;
- email comparison is case-insensitive;
- for consumer Gmail addresses, dots in the part before `@` are ignored;
- for consumer Gmail addresses, a `+tag` suffix is ignored for duplicate detection;
- `gmail.com` and `googlemail.com` are the same inbox and collapse to one identity;
- Gmail-specific rules are not applied to custom domains or other providers;
- one participant may have only one registration for the same event;
- one participant may hold only one active registration across the distances of one race (BR-BUS-012);
- the same participant may register for different events;
- one email address cannot be used to represent several participants in the same event.

If two people share one inbox, they need separate email addresses to create separate participant identities.

These rules prevent common aliases of the same inbox. They do not prove that two unrelated email addresses belong to different humans. Stronger identity verification is not planned.

### BR-BUS-033 — Confirmation and declaration

For internal registration, the normal sequence is:

1. participant submits name and email and acknowledges the privacy notice;
2. participant confirms the email address within 48 hours;
3. if a place is available, the platform temporarily holds it;
4. participant reads and signs the approved declaration;
5. registration becomes confirmed;
6. a confirmation email containing a secure management/unregistration link is sent.

The declaration is versioned and tied to the event and registration. The participant signs by explicitly accepting the declaration and typing their full name.

V1 records electronic acceptance evidence. It must not be described as a qualified electronic signature unless a separate legally reviewed implementation is introduced.

Staff cannot sign the declaration on behalf of a participant.

### BR-BUS-034 — Capacity and public free places

Capacity is optional.

For a capped event:

- the public event page shows the exact number of places immediately available to a new registrant;
- confirmed registrations consume places;
- an unexpired temporary hold while a participant signs the declaration or accepts a waiting-list offer also consumes a place;
- ordinary waiting-list entries do not consume a place, but they have priority over later registrations;
- the displayed free-place number therefore respects both occupied places and existing waiting-list priority;
- pending email confirmations do not consume places;
- cancellations and expired holds release places;
- every capacity-changing action promotes eligible waiting participants before allocating a direct place to a later registrant;
- concurrent actions must never exceed capacity or let a later registrant jump the queue.

The initial direct declaration hold is 30 minutes. This is a configurable application setting and is always capped by registration closing and event start.

For an event without a capacity limit, the page shows that registration is open without displaying a fabricated number of places.

### BR-BUS-035 — Waiting list and promotion

A capped internal event automatically offers a waiting list when no free place remains and registration is still open.

Rules:

- a person confirms their email before entering the active waiting list;
- the declaration is signed only after a place is offered;
- the default queue order is first confirmed onto the waiting list, first offered;
- an existing eligible waiting list always has priority over a later direct registration;
- when a place is released, the next eligible participant receives a time-limited offer;
- the initial waiting-list offer window is 24 hours and never extends beyond registration closing or event start;
- an offered place is temporarily held and therefore reduces the public free-place count;
- the participant becomes confirmed only after signing the declaration;
- declining or cancelling the offer releases the place immediately;
- an expired offer leaves the active queue; the participant may rejoin at the end while registration remains open;
- when the event starts, any remaining waiting-list entries are closed; the participant receives no further message about that event;
- an administrator may exceptionally promote a different participant only with a recorded reason.

The “claim your place” prompt is the V1 engagement mechanism. Points, badges, streaks, rankings, and competitive gamification are not planned.

### BR-BUS-036 — Unregistration by email

A participant may unregister before the event starts through a secure link received by email.

The link opens a confirmation page. Opening the link alone must not cancel the registration; the participant confirms the action on the website.

Unregistration can apply to a pending declaration, waiting-list entry, waiting-list offer, or confirmed registration.

When a held or confirmed place is released, the next waiting-list promotion is evaluated automatically.

Repeated unregistration requests are safe and show the current state rather than creating duplicate actions.

### BR-BUS-037 — Backoffice registration management and resend

The backoffice shows, for each registration:

- participant name and email;
- canonical duplicate-detection identity;
- current registration state;
- email confirmation state;
- declaration version and signature time;
- waiting-list time or offer deadline;
- place-hold deadline;
- confirmation/cancellation times;
- email delivery and resend history;
- administrative audit history.

An administrator can:

- resend the email that matches the participant's current required action;
- cancel a registration, or restart an eligible cancelled/expired registration at the correct step for the participant's verification state; never jump it directly to Confirmed;
- place a registration on the waiting list;
- promote the next waiting participant;
- exceptionally promote a selected participant with a reason;
- resend a secure management link;
- correct a participant name;
- unpublish an inappropriate public profile.

The recommended resend follows the current state:

| Registration state | Recommended resend |
| --- | --- |
| Pending email confirmation | Confirm-email link |
| Pending declaration | Complete-declaration link |
| Waiting list | Waiting-list status and management link |
| Waiting-list offer | Claim-place offer with current deadline |
| Confirmed | Confirmation and management/unregistration link |
| Cancelled or expired | Current registration status notice, with an eligible restart link; never a confirmation |

A resend creates a new delivery record and a new action token where needed. It must not duplicate the registration, change its state, extend an offer without an explicit Admin action, or silently bypass declaration requirements.

The verified email is the participant identity. Staff must not overwrite a verified email directly or merge participant records in V1. An unverified typo is handled by cancelling the pending registration and restarting with the correct address. A verified identity change requires a later explicit verification workflow; it is never performed by an unaudited database edit.

### BR-BUS-038 — Optional public runner profile

A verified participant may choose to publish a small profile.

V1 profile fields are:

- public display name;
- short biography;
- optional Strava link;
- optional Instagram link;
- optional Facebook link;
- optional TikTok link;
- optional YouTube link;
- optional personal website link.

Rules:

- the profile is private by default;
- the participant manages it through a secure emailed link rather than a password account;
- email is never displayed;
- private registration history is never displayed;
- links are validated against approved HTTPS destinations;
- external content is not embedded or imported;
- an administrator may unpublish abusive or inappropriate content;
- profiles (M4) are public by direct URL but excluded from the public sitemap and runner directory, and served with `noindex, nofollow`;
- Strava support is an outbound profile link only, not OAuth or activity synchronization.

### BR-BUS-040 — Bilingual experience

Romanian and English are supported from V1.

- Romanian is the default language.
- Navigation, forms, validation messages, action pages, emails, declarations, and editorial content are localized.
- Content may exist in Romanian before an English translation is ready.
- Public URLs identify the language.
- Dates and numbers are formatted for the selected language.
- A registration keeps the language used when it was created so follow-up email remains consistent.

### BR-BUS-041 — The phone is the primary device

Most people will read events, register, confirm their email, sign the declaration, and accept
a waiting-list offer on a phone, often outdoors and often in a hurry. The website is designed
for the phone first; the larger layout is derived from it.

Rules:

- every participant journey can be completed on a phone with one hand, without horizontal
  scrolling, in either language;
- the essential facts of an event are visible on the first screen of a phone;
- deadlines on the declaration and offer pages are visible without searching;
- nothing important is available only by hovering with a mouse;
- emails are designed to be read on a phone;
- the organizer surfaces needed on race morning, finding a participant and seeing their
  status, work on a phone; the rest of the backoffice may be more comfortable on a laptop;
- release checks are done on a real phone over mobile data, not only in a desktop browser.

### BR-BUS-050 — Mini CMS purpose

The mini CMS exists so approved club members can maintain content without code changes.

It supports only:

- articles and announcements;
- event titles, descriptions, locations, images, and SEO text;
- selected static content such as About and homepage introduction;
- gallery descriptions, captions, and alternative text;
- Romanian and English versions;
- drafts, review, publication, unpublication, and archiving;
- protected preview;
- a small media library.

It is not a generic website builder.

Legal documents — the privacy notice, the terms, and the event declaration — are **not** CMS
content. No staff role edits them here in any form; new versions are loaded by the maintainer
following a written procedure, and the backoffice may only show them.

The event half of this is built and in use, and it is now the whole of an event: an organizer
creates a race, sets its times, its place, its distance and whether it takes entries at all,
duplicates last year's to make this year's, previews it, publishes it, archives it when it is
over, and deletes one made by mistake — without a developer. Deleting is refused for an event
anybody has registered for; archiving is the answer there. Articles, static pages, galleries and
the media library are not built yet.

### BR-BUS-051 — Editorial workflow

Editorial statuses are:

- **Draft:** work in progress and not public.
- **In review:** submitted by an author for an editor.
- **Published:** visible publicly, in every language the item has.
- **Archived:** no longer active and not public.

The status belongs to the event, not to one of its languages: publishing puts Romanian and
English live in the same moment, and unpublishing takes both down.

An author creates and updates drafts and submits them for review. An editor or administrator decides what is published.

Once content is published, only an editor or administrator may change the live version in V1. The interface clearly warns when a save affects the public site, and the warning has to be answered before the save is accepted.

When two people edit the same text at once, the second save is refused rather than silently overwriting the first, and the person is told to reload and reapply their change. Nothing is lost quietly.

A page address may be changed while the text has never been published. Once it has been public, it stays as it is: people and search engines have followed it.

Scheduled publication, comments, full revision history, and simultaneous collaborative editing are not planned.

### BR-BUS-052 — Content quality

Published content should be:

- accurate;
- written for runners rather than internal staff;
- clear about date, time, meeting point, distance, elevation, and required preparation where relevant;
- accessible, including meaningful image alternative text;
- free of private participant data;
- reviewed before publication when created by an author.

AI may help draft or translate content, but a responsible person reviews it before publication.

Published content must also be findable. Search engines and AI assistants both read these
pages and repeat what they say, so the essential facts of an event (date, time, meeting point,
distance, cost, whether registration is required, and whether it has been cancelled) belong in
the written text, not only in an image or a visual badge. A page that states its facts plainly
serves a newcomer, a screen reader, a search engine, and an assistant with the same words.

### BR-BUS-053 — Legal content and declarations

Privacy, terms, and declaration wording require human approval. AI must not invent legal text.

Each legal or declaration document has a version and effective date. A registration stores the exact declaration version and content hash accepted by the participant.

Changing a declaration creates a new version. It does not rewrite the historical record of people who accepted an earlier version.

Until the club approves its own wording, every environment except production carries a clearly
marked **sample** privacy notice, terms and declaration: complete in structure so the club or its
lawyer can edit a concrete draft rather than face a blank page, and blank in substance so nothing
in them can be mistaken for a decision the club made. Each one says so at the top of its own
page, in both languages. Production carries none, and registration there correctly refuses
everyone until the approved text is loaded.

### BR-BUS-060 — Staff roles and least privilege

| Staff role | Main purpose |
| --- | --- |
| Author | Write and translate drafts |
| Editor | Review and publish content; create, configure and duplicate events |
| Admin | Everything an editor may, plus participants, waiting lists, declarations, roles, exports, profiles, operations, and deleting an event |

Only an administrator manages the staff list: they add a colleague by email address and role,
change a role, and revoke access. Adding someone does not send them anything yet — the platform
has no sending domain — so the entry simply waits, and access begins at that person's first
sign-in with that address. Nobody outside the list can sign in at all.

An administrator cannot change their own role or remove their own access, and the club can
never be left without an administrator: those refusals exist so the club cannot lock itself out
of its own backoffice.

Participants are not application roles. Having permission to write articles does not grant access to participant data.

An administrator can also fill an event's queue with clearly labelled **test registrations**, so
the waiting list can be watched working without ten real mailboxes, and remove them again so the
demonstration is repeatable. They behave exactly like real entries — they take places and are
promoted in turn — and they are left out of every count the club is given. They cannot be created
in production at all, and the addresses behind them can never receive mail.

### BR-BUS-070 — Participant privacy

Participant lists are private.

The public website must not reveal email addresses, private registration lists, declaration records, management links, or backoffice details.

A public runner profile exposes only information the participant explicitly published. Public profile publication does not automatically publish event participation.

The platform collects only information needed by the active workflow. V1 normally needs name, email, language, registration state, declaration acceptance, transactional email state, and optional public profile fields.

### BR-BUS-071 — Participant exports

Only an administrator may export participant data.

Exports are created for a real organizer need, contain only necessary fields, and are not stored publicly. The action is recorded.

### BR-BUS-072 — Public results require consent given at registration

Published race results are a public list of people by name. That is only lawful and fair when
each person has agreed to it.

Rules:

- at registration the participant chooses whether their name may appear in public results;
  the choice and its wording version are recorded with the registration;
- the choice can be changed from the registration management page until the results for that
  event are published;
- a participant who declines appears in results as an anonymous entry with distance, result,
  and status only;
- after publication, a name-removal request is handled by the club through the privacy
  contact, and the results are republished;
- the consent is collected from the first registration onward (M1), even though results are
  published only from M2, because it cannot be gathered afterwards;
- the default for the choice is an owner decision recorded in section 9.

### BR-BUS-080 — Transactional email

V1 email is operational, not marketing.

Messages include:

- confirm your email;
- complete and sign the declaration;
- joined waiting list;
- a place is available from the waiting list;
- registration confirmed;
- registration cancelled;
- waiting-list offer expired;
- secure registration-management link;
- secure public-profile management link;
- current registration status notice for a cancelled or expired registration.

An administrator may resend the state-appropriate message. QA email is captured or restricted to approved testers. Production email goes to the intended participant.

Newsletters and promotional campaigns require a separate consent model and decision.

### BR-BUS-090 — QA before production

Every normal release is tested in QA before production.

- `qa` contains the integrated release candidate.
- `main` contains production.
- QA uses synthetic participant data.
- QA cannot send arbitrary live email.
- Production data is not copied into QA.

### BR-BUS-100 — AI review is advisory and read-only

Claude, Codex, or another AI reviewer may read repository content, pull requests, checks, and pipeline logs. By default it publishes findings only as a workflow summary or artifact.

When pull-request comments are desired, a separate trusted relay may post validated output. The AI review job itself remains read-only. Neither component may push code, modify branches or workflows, merge, deploy, alter settings, or read production secrets. Human maintainers remain responsible for release decisions.

## 5. Content types

### Articles and announcements

Examples:

- upcoming event announcements;
- event recaps;
- training or safety guidance;
- volunteer information;
- community stories;
- sponsor acknowledgements when approved.

Required publication information:

- language;
- title and slug;
- short summary;
- body;
- author attribution where desired;
- publication status and date;
- SEO title and description or approved defaults;
- cover image and alternative text when used.

### Event content

Operational details and editorial descriptions are related but different.

Operational details include:

- event type and status;
- start and end time;
- capacity;
- registration mode and dates;
- declaration version;
- waiting-list availability.

Editorial content includes:

- title and description;
- meeting-point wording;
- difficulty wording;
- image and alternative text;
- SEO text;
- localized slug.

Authors may work on assigned editorial content. Editors or administrators control operational registration settings.

### Legal documents

Privacy notice, terms, and the event declaration are versioned legal documents, not
ordinary editorial content. Each has a key, a version number, an effective date, an
approval record, and Romanian and English bodies.

Rules:

- an administrator introduces a new version; authors and editors cannot edit them;
- a version that a participant has already accepted is never modified;
- the privacy notice and terms are reachable from every public page;
- the wording is approved by a responsible person before production use.

### Static pages

V1 may allow editing a small fixed list:

- About;
- homepage introduction;
- community or organizer introduction;
- contact and social information when approved.

The CMS cannot create arbitrary site routes or page layouts.

### Galleries

Galleries include:

- title and description;
- optional link to an event;
- images;
- captions;
- alternative text;
- sort order;
- language-specific publication.

## 6. Main journeys

### Register when a place is available

1. A visitor opens the event page and sees the current free-place count.
2. They submit their full name and email without creating an account.
3. They receive and open the confirmation email.
4. The platform confirms the email and temporarily holds a place.
5. They read and sign the approved declaration.
6. Their registration becomes confirmed.
7. They receive a confirmation email with a secure unregistration link.

### Join and leave the waiting list

1. The event page shows zero free places and offers the waiting list.
2. The participant submits name and email and confirms the address.
3. They enter the waiting list without consuming a place.
4. They may unregister from the waiting list through the emailed management link.

### Claim a waiting-list place

1. A confirmed participant unregisters or another hold expires.
2. The next eligible waiting participant receives a time-limited offer.
3. The public free-place count remains zero while that place is held.
4. The participant opens the offer and signs the declaration before the deadline.
5. Their registration becomes confirmed.
6. If the offer expires or is declined, the place is offered again.

### Unregister a confirmed registration

1. The participant opens the management link from their email.
2. They review the event and current registration state.
3. They explicitly confirm unregistration.
4. The registration becomes cancelled and the place is released.
5. They receive a cancellation email.
6. The system evaluates the waiting list.

### Publish a runner profile

1. A verified participant requests or receives a profile-management link.
2. They add a public name, short biography, and selected social links.
3. They explicitly publish the profile.
4. The profile becomes available by its direct URL without exposing email or registration history.
5. They can later request another management link to edit or unpublish it.

### Publish an article

1. An author creates a Romanian draft.
2. The author or another contributor adds an English draft when required.
3. The author previews the page.
4. The author submits it for review.
5. An editor corrects and publishes each language independently.
6. The published language appears in listings, metadata, and sitemap entries.

## 7. Success conditions

The product is successful when:

- visitors can understand the next club activities quickly on a phone;
- a participant can register, confirm, and sign on a phone in under a minute of their own time;
- exact free-place counts are accurate under concurrent registration activity;
- participants register, confirm email, sign the declaration, waitlist, and unregister without an account;
- duplicate Gmail aliases do not create duplicate registrations;
- waiting-list offers are reliable and auditable;
- transactional email can be resent from the backoffice;
- optional public profiles expose only explicitly published information;
- trusted contributors keep content current without a developer;
- organizers manage participants privately;
- QA catches changes before production;
- one freelancer can maintain and hand over the system.

Do not define success using invented visitor, registration, or conversion numbers. Real targets may be added only after the club agrees them.

## 8. Scope, milestones, and deferred items

The launchable product is milestone **M1**. Later milestones are scheduled and ordered by the
owner (see `DECISIONS.md` §13). Everything is built in that order.

| Milestone | Delivers |
| --- | --- |
| M1 — Launch | Public event pages, the complete registration journey with waiting list, staff login with a minimal backoffice, live transactional email, legal documents, production on the custom domain |
| M2 — Race features | Multi-distance race pages and registration, bib assignment and export, results import and publishing with consent, backoffice completeness (resend, export, staff-created registrations, exceptional promotion) |
| M3 — Announcements | Timestamped event updates with editorial approval, and operational notices to registered participants |
| M4 — Runner profiles | Optional public runner profiles with social links, moderation |
| M5 — Mini CMS | Articles, static pages, galleries and media, the Author role in full |

Requirements for a milestone are written in `SPECS.md` when that milestone starts, not
before. M1 requirements are complete. The three M2 items that are cheap now and expensive
later are in M1: the race grouping (BR-BUS-012), results consent at registration (BR-BUS-072),
and a bib-number field on the registration.

### Not planned

These are not scheduled. Building any of them requires an owner decision recorded in
`DECISIONS.md` first.

- payments, refunds, and invoices;
- team, proxy, household, and minor registration;
- configurable event-question builders;
- emergency contacts, medical information, identity documents, and age verification;
- birth year and gender collection, and therefore age or gender result categories;
- paper/offline declaration capture (`DECISIONS.md` §10 proposes a bounded form);
- race-day check-in and timing integration;
- verified-email change and participant-record merge workflows;
- points, badges, streaks, rankings, and other gamification;
- recurring-event generation;
- route and GPX tools;
- Strava/Garmin OAuth, activity import, or statistics;
- searchable runner directory;
- public attendance history;
- participant-uploaded profile photos;
- bulk race photo hosting (`DECISIONS.md` §8);
- newsletter campaigns and marketing automation;
- scheduled publishing;
- content comments and collaborative editing;
- arbitrary page building;
- automatic unreviewed AI publication.

## 9. Owner decisions required before production

The club must approve:

- final brand identity and public wording;
- privacy, terms, and declaration text;
- whether typed-name acceptance is sufficient for the intended events;
- retention, deletion, and historical-record policy;
- support and organizer contact addresses;
- production sender name and email address;
- photo-consent and removal procedure;
- initial staff receiving Author, Editor, or Admin access;
- final confirmation-link, direct-hold, and waiting-list offer durations if different from the initial defaults of 48 hours, 30 minutes, and 24 hours;
- the domain name to be registered and bound at the end of M1;
- any future event requiring questions, minors, medical data, payments, or results;
- whether analytics is needed and what consent is required;
- the default for the public-results consent at registration, and its wording;
- whether AI training crawlers may use the club's published content; crawlers that retrieve
  pages to answer questions are allowed by default so the club's events can be found.

### BR-BUS-101 — Hosting and ownership stay simple

Brașov Runners should own the domain, hosting, repository, database, staff authentication, email service, and media storage accounts. A freelancer may be granted access but must not become the only person capable of recovering the platform.

The V1 application host is Vercel, with one QA project and one production project. This is an operational choice, not a product dependency: changing hosting later must not change registration, waiting-list, declaration, CMS, profile, or participant behavior.

The public domain and normal DNS stay with the club's registrar, which may change. Cloudflare is used for R2 media storage and does not need to control the main site's DNS unless a later feature requires it.

The source repository starts under the maintainer's personal GitHub account and is
transferred to a club-owned organization before handover, so that the club, not an
individual, owns the code.

The public domain is bound at the end of M1. Until then both applications run on their provider-assigned hostnames. Binding the real domain must be a configuration and DNS change only, with no change to application behavior.

## 10. Document synchronization

When a rule in this file changes:

1. update its requirements and acceptance criteria in `SPECS.md`;
2. update implementation constraints in `AGENTS.md`;
3. update provider or repository steps in `SETUP.md` when affected;
4. update the summary in `README.md`;
5. bump the shared baseline marker in all six documents;
6. append the reason to `DECISIONS.md` without rewriting existing history;
7. update `MANIFEST.txt` when the change is a headline decision.

A change is never a single-file edit. `AGENTS.md` §1.4 holds the change-type matrix that
says which documents each kind of change affects.
