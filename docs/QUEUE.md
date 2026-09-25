# The work queue

What the owner has asked for, where each item stands, and where it lives. Updated with every
batch that ships (the owner, 2026-09-24: "document all! and commit in smaller batches and keep
track!"). The decisions are in `DECISIONS.md`, the shipped lines in `CHANGELOG.md`; this page
is the list in between — asked, building, waiting, done.

Legend: **building** — a change is being implemented, reviewed and fixed on its own branch ·
**ready** — reviewed, waiting for the next small release · **waiting on the owner** — a
decision or a click only the club can make · **released** — on production, with its baseline.

## Building

Since the evening of 2026-09-24 at most four changes are built at once: eleven in parallel exhausted the development machine and every run had to be recovered.

| Item | Branch | Notes |
| --- | --- | --- |
| "Termene": every participant-facing deadline a club setting | `feat/deadlines-config` | migration `0069`; its own release |
| Toasts after every backoffice action and a confirmation dialog before every irreversible or outward-facing one — an action that emails participants says so, with the count | `feat/toasts-and-confirms` | |
| Tighter spacing on phones for the public pages | `fix/mobile-density` | after `BR-V1.83` |
| "Următoarele emailuri automate": the next 14 days of automatic sends per event, with recipient counts, on `/admin/emails` | `feat/email-forecast` | after the deadlines land |

## Ready for the next release

| Item | Branch |
| --- | --- |
| — | nothing waiting: the last ready items shipped in `BR-V1.85` |

## Next, queued

| Item | Waits for |
| --- | --- |

## Waiting on the owner

| Item | What is needed |
| --- | --- |
| Who may write to participants | "Trimite un mesaj participanților" is open to the Organizator and the Administrator (`BR-V1.81`); say if the Tehnic role should have it too |
| The three emails marked "nu se mai trimite" on `/admin/emails` | choose: fold them into one "Nu se mai trimit (3)" card, and/or send an email again when a waiting-list offer expires |
| The English "Happy Monday" description | its English box holds the Romanian text — replace it in the editor |
| Sunday 27 September, the shared event with the Brașov Running Festival | create it on production; the partner card: name, "Despre parteneriat" RO + EN, a "Site" link and an "Înscriere" link |
| The legal texts on production | `/admin/legal` → New version → "start from the platform's text" for all three (the GDPR rewrite, the per-event minimum age, the minor's own signature, and the declaration's risks, `BR-V1.76`; the sample versions are on QA since 2026-09-24 — read them there first) — **a Romanian lawyer should read the declaration first** (Civil Code art. 1355: a waiver cannot remove liability for bodily harm; the text is worded as informed acceptance of risk and the runner's own obligations) |
| The 21 November race on production | `SETUP.md` §39, field by field; the club decides the places and the confirmation window |
| Volunteer accounts for race day | Echipa → Add, and a rehearsal on QA |
| QA's Neon cap | 30 CU-hours may run out late in a month of heavy testing (QA only); raise to 40 if that matters |

## Later

- The newsletter and mailing alerts (the owner's weekend item).
- Neon: re-measure after the first quiet night (the operations log, `SETUP.md` §40).
- `yarn test:e2e:dev` (the `next dev` walk of every page, minutes) is on demand; say if it should also run nightly on qa.
- The public site's own toasts: the contact form's sent state, self-unregistration, the participation confirmation (after `feat/toasts-and-confirms`).

## Released

| Baseline | What |
| --- | --- |
| `BR-V1.85` | the listing card: one handshake glyph and never a partner's name, the next date and its time on one line on a phone, the pills in the order surface, difficulty, distance, elevation, cost · the `/admin/legal` notice folds closed on the legal page and says what the code enforces; a malformed admin id answers 404 everywhere in the backoffice |
| `BR-V1.84` | the phone footer in one row from 320 px — every item on it, a lock for the privacy notice, the languages as flags, 24-px targets below 360 and 28 up to `sm` · the email editor's placeholder legend and preview sample, the save guard, a bilingual email's second half entirely in its own language with the status in words · the dispatcher guards its own context, `yarn ship` continues past a merged batch PR, a worktree-sweep card, a resumed branch still gets its review |
| `BR-V1.83` | the club's name from one source and the last hardcoded values gone — a donation event reads as free to attend with a `DonateAction`, the queue panel in the event's zone, the legal editor keeps its height · the backoffice works under `yarn dev` again, a source-walk test refuses element props into client components, `yarn test:e2e:dev` · a save press paints "Se salvează…" first, every measured press under 200 ms at 4× CPU |
| `BR-V1.82` | the listing's cards are one structure — the title a blue link, the place a link to its map, a clock by the time, route and cost as the event page's pills, no empty bands · a handshake and the partner's name on a partnered event's card, calendar entry and page; one tooltip per calendar entry; a series' usual place read rather than compared letter for letter, so "Nu în locul obișnuit" appears only when the place really differs · the dispatcher in the repository (`docs/DISPATCHER.md`, `yarn docs:land`, `yarn ship`) |
| `BR-V1.81` | **hotfix** — the rich-text editor's selection and table bars show their buttons again (Tiptap's production build dropped their stacking order); a fold opened in one language tab stays open in the other; closing a fold no longer loses what was typed · "Trimite un mesaj participanților": a bilingual message to an event's participants by group, previewed, sent through the outbox, audited (migration `0068`) · the phone footer floats one line and rests two, RO \| EN side by side, the build stamp in the "Despre club" fold |
| `BR-V1.80` | the meeting point once per language — Română and English side by side, both required unless to be announced, "Același nume și în engleză" for an empty English box; every page, email, calendar file and the declaration name the place in the reader's language |
| `BR-V1.79` | both text editors' toolbars wear Material icons with tooltips, one shared button — no more 🖼 🔗 ↶ ↷ ¶ |
| `BR-V1.78` | the email editor starts from the placeholders, never the preview's sample values; saving a sample value is refused; texts already saved with sample values are flagged, with "Înlocuiește cu câmpurile"; every backoffice sub-navigation is one row of secondary tabs |
| `BR-V1.77` | the editor's first card "Ce fel de eveniment" holds "Starea evenimentului", "Traseul" and "Linkuri și fișiere" as named cards, create and edit alike (the create page shows Programat, read-only); the third group is "Parteneri și prezentare" |
| `BR-V1.76` | the declaration names the risks the runner takes on (wild animals and dogs, falls, weather and the dark, own equipment incl. a headlamp after dark, own pace, belongings, protected areas), and no legal text or email carries a hardcoded club, place or date; the sample re-seeded on QA; the jobs' safety check on the hour, together with the health check — one database wake per idle hour; the event page's facts grouped by question — "Când" on one line, the address under the place, the route and the cost as pills; this queue |
| `BR-V1.75` | lighter public pages (the listing 119 → 39 KB on the wire) and a real 308 at `/ro`; bilingual everywhere — the organizer's note and the cancellation reason in both languages, page SEO and album descriptions both or neither, the same words in both languages warned; the series scope radio; `db:reset:local` in a worktree |
| `BR-V1.74` | the series' draft line says what the dates are and carries "Publică" / "Publică automat de acum"; a partner's description in both languages, its registration link first; every optional text both languages or neither; the cron-job record (`SETUP.md` §40) |
| `BR-V1.72`–`BR-V1.73` | the waiting list's length cap; the weekday on every date; the editor as one page of named boxes; the recurrence end date's weekday |
| `BR-V1.69`–`BR-V1.71` | links and files; the phone field with its flag and mask; the bib card; folds closed by default; Neon limits and throttling; costs with an amount and donations; partners as cards; the public fill count; canonical and hreflang; the date and time pickers |
