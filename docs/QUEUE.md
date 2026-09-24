# The work queue

What the owner has asked for, where each item stands, and where it lives. Updated with every
batch that ships (the owner, 2026-09-24: "document all! and commit in smaller batches and keep
track!"). The decisions are in `DECISIONS.md`, the shipped lines in `CHANGELOG.md`; this page
is the list in between — asked, building, waiting, done.

Legend: **building** — a change is being implemented, reviewed and fixed on its own branch ·
**ready** — reviewed, waiting for the next small release · **waiting on the owner** — a
decision or a click only the club can make · **released** — on production, with its baseline.

## Building

| Item | Branch | Notes |
| --- | --- | --- |
| Both rich-text toolbars (the content editor with its table and bubble menus, the legal document editor) use Material icons with tooltips instead of text characters and emoji (🖼 🔗 ↶ ↷ ¶ ❝ ⊞) | `fix/editor-toolbar-icons` | the owner: "I hate this image icon!" |
| The email editor starts from the placeholders (`{eventTitle}`…), never the preview's sample values; saving a sample value is refused; overrides already saved with sample values are flagged with one-click "Înlocuiește cu câmpurile" | `fix/email-copy-placeholders` | the owner: "all emails text must include these placeholders" |
| The meeting point once per language — Română and English side by side, both required unless "to be announced", "Același nume și în engleză" | `feat/place-one-name-per-language` | no migration: shared column = Romanian, each translation its own |
| "Termene": every participant-facing deadline a club setting — confirmation link, declaration hold, waiting-list offer, reminder (with a per-event override), self check-in, race week, series horizon — and every number in emails, pages and legal texts follows it | `feat/deadlines-config` | one expand-only migration (the per-event reminder); new values apply to new holds and offers only |
| The backoffice sub-navigation (Configurație, De făcut, the gallery) as secondary tabs — text with an underline on the active one — instead of pill buttons | `fix/admin-subtabs` | one shared component |
| "Trimite un mesaj participanților": a bilingual free-form message (bad weather, a change, a cancellation) to an event's participants by state, previewed, counted against the day's allowance, sent through the outbox, audited, with a send history | `feat/custom-participant-email` | one expand-only migration (a new message type) |

## Ready for the next release

| Item | Branch |
| --- | --- |
| — | nothing waiting: the last ready items shipped in `BR-V1.76` |

## Next, queued

| Item | Waits for |
| --- | --- |
| The email editor lists its placeholders like the documents' legend — each field as a code chip, what it is, an example — the ones this message uses first | `fix/email-copy-placeholders` (same files) |
| A bilingual email's second half reads the other language's event title, "what to bring" and place name (a Romanian registrant's English half shows the English ones) | the same |

## Waiting on the owner

| Item | What is needed |
| --- | --- |
| The three emails marked "nu se mai trimite" on `/admin/emails` | choose: fold them into one "Nu se mai trimit (3)" card, and/or send an email again when a waiting-list offer expires |
| cron-job.org | minute 45 on "prod maintenance day" (it reads 0,15,30); QA's „Cât de des verifică platforma" → 2 ore (`SETUP.md` §40) |
| The English "Happy Monday" description | its English box holds the Romanian text — replace it in the editor |
| Sunday 27 September, the shared event with the Brașov Running Festival | create it on production; the partner card: name, "Despre parteneriat" RO + EN, a "Site" link and an "Înscriere" link |
| The legal texts on production | `/admin/legal` → New version → "start from the platform's text" for all three (the GDPR rewrite, the per-event minimum age, the minor's own signature, and the declaration's risks, `BR-V1.76`; the sample versions are on QA since 2026-09-24 — read them there first) — **a Romanian lawyer should read the declaration first** (Civil Code art. 1355: a waiver cannot remove liability for bodily harm; the text is worded as informed acceptance of risk and the runner's own obligations) |
| The 21 November race on production | `SETUP.md` §39, field by field; the club decides the places and the confirmation window |
| Volunteer accounts for race day | Echipa → Add, and a rehearsal on QA |
| QA's Neon cap | 30 CU-hours may run out late in a month of heavy testing (QA only); raise to 40 if that matters |

## Later

- The newsletter and mailing alerts (the owner's weekend item).
- A donation event's structured data says it is not free (`isAccessibleForFree: false`) — confirm that is what the club wants.
- The queue panel's times are in the club's zone rather than the event's.
- Neon: re-measure after the first quiet night (the operations log, `SETUP.md` §40).

## Released

| Baseline | What |
| --- | --- |
| `BR-V1.77` | the editor's first card "Ce fel de eveniment" holds "Starea evenimentului", "Traseul" and "Linkuri și fișiere" as named cards, create and edit alike (the create page shows Programat, read-only); the third group is "Parteneri și prezentare" |
| `BR-V1.76` | the declaration names the risks the runner takes on (wild animals and dogs, falls, weather and the dark, own equipment incl. a headlamp after dark, own pace, belongings, protected areas), and no legal text or email carries a hardcoded club, place or date; the sample re-seeded on QA; the jobs' safety check on the hour, together with the health check — one database wake per idle hour; the event page's facts grouped by question — "Când" on one line, the address under the place, the route and the cost as pills; this queue |
| `BR-V1.75` | lighter public pages (the listing 119 → 39 KB on the wire) and a real 308 at `/ro`; bilingual everywhere — the organizer's note and the cancellation reason in both languages, page SEO and album descriptions both or neither, the same words in both languages warned; the series scope radio; `db:reset:local` in a worktree |
| `BR-V1.74` | the series' draft line says what the dates are and carries "Publică" / "Publică automat de acum"; a partner's description in both languages, its registration link first; every optional text both languages or neither; the cron-job record (`SETUP.md` §40) |
| `BR-V1.72`–`BR-V1.73` | the waiting list's length cap; the weekday on every date; the editor as one page of named boxes; the recurrence end date's weekday |
| `BR-V1.69`–`BR-V1.71` | links and files; the phone field with its flag and mask; the bib card; folds closed by default; Neon limits and throttling; costs with an amount and donations; partners as cards; the public fill count; canonical and hreflang; the date and time pickers |
