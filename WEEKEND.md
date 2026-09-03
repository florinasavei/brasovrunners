<!-- PROJECT_BASELINE: BR-V1.14-2026-09-03 -->

# WEEKEND.md — the pilot scope

**Baseline `BR-V1.14-2026-09-03`** · [agent entry point](./CLAUDE.md) · [why](./DECISIONS.md)

One weekend of AI-assisted building. This file says exactly what that weekend produces, in
what order, and what it deliberately does not. When it conflicts with `SETUP.md` §29, this file
wins for the pilot; §29 remains the plan for M1.

## What ships

**Romanian event pages, live on Vercel, read from Neon.** A list at `/ro/evenimente` and a
detail page at `/ro/evenimente/<slug>` showing kind, date and time in Europe/Bucharest, meeting
point, distance, and cost — as text, mobile-first. Two or three real upcoming events, seeded
from a file. `/en/…` returns 404 because the English translation is Draft, which is exactly
what BR-REQ-040-02 prescribes rather than a compromise.

That replaces the Facebook post as the canonical event record. It is the half of M1 with zero
legal risk, and it is useful to the club on Monday.

**Not shipping:** registration, email, login, legal pages, the CMS, capacity, waiting lists.
Reasons below.

## Why so narrow

The full M1 is 49 MUST requirements over ten pull requests, on the order of 180–260 hours, and
is *defined* as done only when it is on production with club-approved legal text and one real
registration. A weekend is 16–25 hours. Two things make even the registration half impossible
this weekend, and neither is about typing speed:

- **No domain yet.** Resend and Mailgun both refuse to send to anyone but the account owner
  without a verified sending domain. No domain, no verification email, no registration flow.
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

**7. Six tests (1.5 h).** Named by requirement: locale 404 on Draft (040-02), capacity CHECK
refuses a number (034-01), event detail renders required fields (011-01), unknown slug → 404,
`APP_BASE_URL` drives canonical (101-02), and one Playwright pass on the list page at a mobile
viewport (041-01). Vitest and a real disposable Postgres, per `AGENTS.md` §20.

**8. Write it down (30 min).** One `CHANGELOG.md` line. Update the "Now" row in
`README.md` § Current status. That is the entire documentation cost of the pilot — see the fast
lane in `CLAUDE.md`.

## Done when

- The QA project's default `vercel.app` URL lists the seeded events at `/ro/evenimente` on a phone.
- The production project does the same from `main`.
- `/en/evenimente` is a 404, not a fallback.
- `yarn check` is green on the branch; CI is green on `qa`.
- The six tests pass.
- A club organizer has opened it on their own phone and not asked "where is the date".

## Deferred, with the reason

| Deferred | Why it is safe to wait | Unblocked by |
| --- | --- | --- |
| Registration, confirmation, declaration, manage/cancel | Needs email and approved legal text; neither exists | domain + two approved Romanian texts |
| Email, outbox, tokens | Needs a verified sending domain | the domain |
| Staff login and the backoffice | Nothing to administer; events are seeded. Direction when built: Auth.js alone with a server-side allowlist, no external IdP | first registration |
| Privacy notice and terms pages | No personal data is collected by the event pages. Needed the day registration opens | club approval |
| Capacity and the waiting list | The pilot is uncapped and the DB enforces it. Half-built capacity overbooks in public | the locked transaction and its concurrency test |
| English | Draft, so `/en` 404s. Never ship English chrome with Romanian body text | translated content |
| CMS, media, profiles, races, bibs, results | M2–M5 | — |

## The domain, when you get to it

`.ro` is registered through a ROTLD-accredited registrar; the owner intends to move it to
Cloudflare Registrar later if that TLD becomes available there. Nothing in the app cares which
registrar holds it. What matters for the next slice is DNS access at whichever registrar it is,
because Resend's verification records go there, and sender reputation on a new domain takes
days to settle — register early, verify early, send later.

## Next weekend, if the domain exists by then

Resend (Ireland region) with the domain verified; the outbox and three Romanian message types;
hashed single-use tokens with GET-never-mutates; the registration form with privacy
acknowledgment and results consent; confirmation → declaration → confirmed → manage/cancel; one
server-authorized admin page listing who is coming; a retention rule and a named erasure
contact. The scope review estimated ~20 hours for that slice against an *uncapped* event.
