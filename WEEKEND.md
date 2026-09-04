<!-- PROJECT_BASELINE: BR-V1.16-2026-09-04 -->

# WEEKEND.md — the pilot scope

**Baseline `BR-V1.16-2026-09-04`** · [agent entry point](./CLAUDE.md) · [why](./DECISIONS.md)

One weekend of AI-assisted building. This file says exactly what that weekend produces, in
what order, and what it deliberately does not. When it conflicts with `SETUP.md` §29, this file
wins for the pilot; §29 remains the plan for M1.

## What ships

**Romanian event pages, live on Vercel, read from Neon.** A list at `/ro/evenimente` and a
detail page at `/ro/evenimente/<slug>` showing kind, date and time in Europe/Bucharest, meeting
point, distance, and cost — as text, mobile-first. Two or three real upcoming events, seeded
from a file. Both locales are published: the owner decided the site ships bilingual, so every
event carries a complete English translation as well as a Romanian one. BR-REQ-040-02 is
unchanged and still enforced — an unpublished locale is a 404, never a fallback.

That replaces the Facebook post as the canonical event record. It is the half of M1 with zero
legal risk, and it is useful to the club on Monday.

**Not shipping:** registration, email, login, legal pages, the CMS, capacity, waiting lists.
Reasons below.

## Why so narrow

The full M1 is 49 MUST requirements over ten pull requests, on the order of 180–260 hours, and
is *defined* as done only when it is on production with club-approved legal text and one real
registration. A weekend is 16–25 hours. Two things make even the registration half impossible
this weekend, and neither is about typing speed:

- **No domain yet.** Resend and Mailgun both refuse to send to strangers without a verified
  sending domain. A Mailgun sandbox domain lets you *build and test* the flow against your own
  inbox — it "can only send to authorized recipients", up to five — so it de-risks the work but
  cannot serve a single real club member. No domain, no registration flow.
- **No approved declaration or privacy notice.** `AGENTS.md` §10.8 and §29 forbid inventing
  either. Storing a participant's name and email without a published notice is a compliance
  failure, not an unfinished feature.

The moment the domain exists and the club has approved two Romanian texts, the registration
slice becomes buildable — see "Next weekend" at the end.

## Before Saturday (30 minutes, no code)

| Sign up for | Plan | Settings that cannot be changed later |
| --- | --- | --- |
| **Neon** | Free | Region **Frankfurt `aws-eu-central-1`** — fixed at project creation. Copy the **pooled** connection string. |
| **Vercel** | Hobby | Two projects from the same repo: one with production branch `qa`, one with production branch `main`. Function region `fra1`. |

Hobby is "restricted to non-commercial personal use only" and counts donations as commercial.
A club site sits in a grey area. If Vercel objects, the app moves to Render Free (Frankfurt)
in ten minutes — nothing in the code is Vercel-specific, by rule.

Nothing else. No Resend, no Zitadel, no R2, no domain — yet.

## Build order

Each step ends with something you can see. Hours are estimates from the scope review; expect
one of them to double.

**0. Verify before you install (30 min).** Next 16, MUI 9, next-intl 4, Drizzle 0.45 are all
newer than any model's training. Pull the current setup for each from Context7 or the official
docs *before* writing the scaffold, and pin exact versions. This is the step that saves the
afternoon.

**1. Scaffold that runs (4–5 h).** Next.js App Router, TypeScript strict, `src/`, no Tailwind.
MUI with the official App Router cache provider, `ThemeProvider`, `CssBaseline`, a placeholder
palette that is not default blue, Roboto through `next/font`. `next-intl` with `[locale]`
routing, `ro` default, `localePrefix: always`, an unknown locale → 404. Zod-validated env with
`APP_ENV`, `APP_BASE_URL`, `DATABASE_URL`. `yarn dev` shows a page in Romanian.
BR-REQ-001-01, BR-REQ-040-01, BR-REQ-101-01.

**2. Two tables and a seed (2 h).** `events` and `event_translations` only, but with the *full*
column set from `AGENTS.md` §12.3 and §12.4 — including `capacity`, `race_id`,
`registration_mode` and the rest you will not use. Columns are free now and a migration later.
Drizzle over `node-postgres` with a `pg.Pool` on the pooled Neon URL — **not** `neon-http`,
which cannot do the interactive transactions capacity will need. `db:generate`, `db:migrate`,
`db:seed`.

**3. The guard rail (20 min).** A `CHECK (capacity IS NULL)` on `events` plus a server-side
refusal. This is the highest-leverage line of the weekend: deferring the capacity engine is safe
*only* if the system is physically incapable of accepting a capacity number. Without it someone
types 30 into a field in October and the count is computed outside a locked transaction, in
public. BR-REQ-011-01 criterion 2, BR-REQ-034-01 criterion 4.

**4. The two pages — DONE.** List and detail, Server Components, from the DB, `ro` only.
Date and time formatted for `ro-RO` in Europe/Bucharest. Meeting point, distance, cost as text.
Canonical and `hreflang` only for locales actually published — so `ro` alone. Renders at 320 px
with no horizontal scroll (BR-REQ-041-01 criteria 1–3 — claim only those).
BR-REQ-010-01, BR-REQ-011-01, BR-REQ-020-01, BR-REQ-030-01, BR-REQ-040-02.

**5. Structured data and robots — DONE.** `SportsEvent` JSON-LD on the detail page, sitemap for
published `ro` pages only, `robots.txt`. QA project sends `X-Robots-Tag: noindex, nofollow`
(BR-REQ-090-01). BR-REQ-052-02, BR-REQ-070-03.

**6. Deploy (1–2 h, do this Saturday evening with a stub, not Sunday night).** Push to `qa`,
watch the Vercel build, set `DATABASE_URL` and `APP_BASE_URL` per project, run the migration,
open it on a phone. Then the same for `main`. Every integration surprise lives here.

**7. Tests — DONE.** 57 unit and database tests plus 16 end-to-end.
Originally scoped as: Named by requirement: locale 404 on Draft (040-02), capacity CHECK
refuses a number (034-01), event detail renders required fields (011-01), unknown slug → 404,
`APP_BASE_URL` drives canonical (101-02), and one Playwright pass on the list page at a mobile
viewport (041-01). Vitest and a real disposable Postgres, per `AGENTS.md` §20.

**8. Write it down (30 min).** One `CHANGELOG.md` line. Update the "Now" row in
`README.md` § Current status. That is the entire documentation cost of the pilot — see the fast
lane in `CLAUDE.md`.

## Done when

- The QA project's default `vercel.app` URL lists the seeded events at `/ro/evenimente` on a phone.
- The production project does the same from `main`.
- `/en/events` serves English words, never Romanian ones under an English URL.
- `yarn check` is green on the branch; CI is green on `qa`.
- The six tests pass.
- A club organizer has opened it on their own phone and not asked "where is the date".

## Deferred, with the reason

| Deferred | Why it is safe to wait | Unblocked by |
| --- | --- | --- |
| Registration, confirmation, declaration, manage/cancel; **the code now exists** | Built after the pilot, against real PostgreSQL under concurrent load — see `CHANGELOG.md` BR-V1.16. What remains is not code: no event is `INTERNAL` mode with a real capacity yet, no legal text is approved outside a developer's machine, and live email needs the domain | two approved Romanian texts + the domain |
| Email delivery to real people; **the pipeline now exists** | Ten message templates, the outbox jobs and the Mailgun webhook are built and tested in capture mode. Live delivery needs a verified sending domain; a sandbox reaches only five authorized addresses | the domain |
| Staff **login**; the backoffice itself is now built | The backoffice, the three roles and the editorial workflow shipped after the pilot (`DECISIONS.md` §25), because a developer editing a seed file is not a way for a club to run a race. Staff sign-in now exists too, through Auth.js and Zitadel (`DECISIONS.md` §26) — it does not need the sending domain the way an emailed link would have, only a Zitadel tenant. Local and test use the development switcher; qa and production run `STAFF_AUTH_MODE=disabled` until a tenant exists for them | a Zitadel tenant |
| Privacy notice and terms pages; **the versioning and the routes now exist** | A `PLACEHOLDER` version is seeded in local and test only (`DECISIONS.md` §27) and registration itself refuses when nothing is approved. The routes 404 nowhere they shouldn't — they simply have nothing real to show yet | club approval of real Romanian and English text |
| Capacity and the waiting list; **no longer deferred** | The locked capacity transaction exists and its concurrency suite (`tests/concurrency/capacity.test.ts`) passed before the pilot's `CHECK (capacity IS NULL)` guard was removed. An event may carry a real capacity now | — |
| CMS, media, profiles, races, bibs, results | M2–M5 | — |

## The email progression, corrected

The intended path was sandbox → Vercel domain → `<domain>`. The middle step does not
exist: verifying a sending domain means adding SPF and DKIM records to its DNS, and nobody
controls the `vercel.app` zone. There are two steps, not three.

| Step | What it gives you | What it does not |
| --- | --- | --- |
| **Mailgun sandbox**, free, today | The whole pipeline built and tested against your own inbox | Reaches at most five authorized addresses. No club member can register |
| **`<domain>`**, once registered | Real participants, real verification email | Needs DNS records and days for sender reputation to settle |

So the sandbox is a development tool, not a launch step. The outbox, the adapter and the token
layer are built and tested without it; the three message types can be written against it.
Launch still waits on the domain.

## Spam protection on the registration form

The form collects an email address, so it will be found by bots. Start with a honeypot field,
a submission-timing check and per-IP rate limiting: no third-party script, no additional
processor to disclose, and enough for a club expecting a few hundred registrations a year.

Escalate to **Cloudflare Turnstile** only if that proves insufficient. It embeds on any site
without routing traffic through Cloudflare and processes "only the data strictly necessary",
explicitly not form entries — the best third-party option for an EU club. The reason to wait:
it is a script from a processor the privacy notice must disclose, and the club has not approved
that notice yet. Adding Turnstile later is an hour's work; adding a processor to an approved
legal document is not.

## The domain, when you get to it

`.ro` is registered through a ROTLD-accredited registrar; the owner intends to move it to
Cloudflare Registrar later if that TLD becomes available there. Nothing in the app cares which
registrar holds it. What matters for the next slice is DNS access at whichever registrar it is,
because Resend's verification records go there, and sender reputation on a new domain takes
days to settle — register early, verify early, send later.

## Done ahead of schedule, while the accounts were pending

**Email canonicalization** (BR-REQ-032-01, -02, -04) — the participant's entire identity, since
they have no account. A pure versioned function per `AGENTS.md` §10.4, the `participants` table
with `UNIQUE(canonical_email)`, 29 unit tests and 7 integration tests proving the *database*
rejects an alias rather than trusting application code to notice. Built now because §10.3 makes
the canonical email immutable with no merge path: get it wrong and the organizer's list shows
one runner twice, permanently.

**Email action tokens and the transactional outbox** (BR-REQ-036-02, BR-REQ-080-02,
BR-REQ-080-03) — the half of the registration slice that needs neither the domain nor a
provider account. `email_action_tokens` stores only a SHA-256 hash, scoped to one purpose and
one registration, expiring, single use, and previous active tokens die when a new one is
issued. `email_outbox` commits with the change that caused it, and the provider is called
afterwards, from a separate transaction. The adapter has two implementations: capture, which is
the mailbox in local and test, and a Mailgun stub with no network call in it. Built now because
none of it was blocked on anything, and because the two rules it carries — a mail scanner's GET
must not confirm a registration, and a rolled-back registration must not send email — are
cheaper to build into the schema than to retrofit onto a working flow.

## Next weekend, done

Everything this section once described as blocked has since been built: the registration form
with privacy acknowledgment and results consent, confirmation → declaration → confirmed →
manage/cancel, capacity and the waiting list with a real concurrency suite, ten message
templates in both languages, and a server-authorized backoffice page listing who is coming,
with a state-aware resend and CSV export. `CHANGELOG.md` BR-V1.16 and `DECISIONS.md` §26–§27
are the record.

What genuinely still blocks a real participant from using any of it: the club's approved
Romanian and English privacy notice and declaration text, a Zitadel tenant for staff sign-in,
and the sending domain for live email. None of those are code.
