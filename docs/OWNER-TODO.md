# What the club still owes

The club's own work rather than code, moved verbatim from `CLAUDE.md` on 2026-10-29 (`DECISIONS.md` §NNN): `CLAUDE.md`
loads into every AI session, and this list was two fifths of it. `/admin/tasks` reads the same items from the live
system and is the authority; this file is the summary with its history.

**Still owed, all of it the club's own work rather than code** (checked against the live
systems on 2026-09-22; `/admin/tasks` shows the same list with the steps, read from the system —
it is the authority, this is the summary):

1. ~~cron-job.org monitors~~ — done 2026-09-18 evening: six jobs, both environments `ok`.
2. ~~Mailgun sending domain~~ — done 2026-09-18 evening: `mail.` subdomain verified,
   production sends live, webhook signed; `contact@mail.<domain>` forwards to the owner until
   the club has a mailbox; Zitadel's own mail goes through the same domain. QA sends through
   the same domain with its own key since 2026-09-23, to anyone, tagged `[QA]` (§307).
   Procedure: `SETUP.md` §35.
3. ~~Production Zitadel application~~ — done 2026-09-17: application, `STAFF_AUTH_MODE=provider`,
   the owner's SUPERADMIN row. Sign in at `/admin` on the production host.
4. ~~The club's approved legal texts~~ — the **terms** and the **privacy notice** are approved
   and live on production (verified 2026-09-22 at `/ro/termeni` and `/ro/confidentialitate`):
   the club's own text, carrying its legal name, seat and CIF, with no placeholder and no
   sample banner. The **declaration** is approved in the same screen and cannot be read from
   outside — `/admin/legal` on production says which of the three are in effect, and a
   registration is refused while it is not.
5. **Volunteer accounts** for race day (`SETUP.md` §34) and a rehearsal on QA. Since the
   invitation key is set (item 10), "Add" on Echipa creates the account and sends the
   invitation itself.
6. ~~Neon keys~~ — done 2026-09-18 evening: a project-scoped key on each Vercel project,
   `/devs` shows the database's month on both. Still optional: a custom domain for the R2
   bucket; the retention and support decisions of `SETUP.md` §30.
7. ~~The anti-bot check~~ — done 2026-09-19: the widget `brasovrunners-site`, both keys on
   both Vercel projects, the box shows on the QA form (`SETUP.md` §36). The row turns green
   on each project's next deployment.
8. **The five legal texts** approved on production — since `BR-V2.00` (§418) from the counsel-reviewed templates, all five in one sitting, BEFORE the race is published — from the platform's templates — **again, since Since `BR-V2.04` (§450) an Administrator approves them; the Superadministrator role is no longer needed for it.
   2026-09-24**: the templates now carry the GDPR rewrite (§322–§324), the per-event minimum age
   (§329) and the minor's own signature (§330); the texts in effect say none of it until the club
   approves new versions, and the minor's second signature stays off until it does (§330). Approved
   on production from the platform's templates
   (`/admin/legal` → New version → "start from the platform's text", four facts to fill) —
   the same item as 4, with the texts now written. Approving new versions from the templates also makes the terms and the privacy notice read their deadlines from "Termene" (§377); the production texts keep their literal numbers until then.
   **Since §393 two more texts:** the optional group-run declarations (asfalt, trail) — `/admin/legal` → Versiune nouă → «pornește de la
   textul platformei» → each of the two, four facts each; until the trail text is approved no run offers the button. **And the notice once more:** since §396 its section 4 describes the public list's states; until a notice from the new template is approved on production, public lists show confirmed names only (`/admin/tasks` shows the row `listStatesNotice`).
9. ~~The health monitor~~ — done 2026-09-19: `GET /api/health` every 30 minutes with failure
   notifications on production and QA (`SETUP.md` §36). Both answered `ok` on 2026-09-22.
10. ~~The invitation key~~ — done 2026-09-20, and **only actually working since 2026-09-22**:
    the token was on both Vercel projects from the start, but the service account had never been
    made an **Org User Manager**, so it authenticated and could create nobody. Every "Add" wrote
    the allowlist row, was refused by Zitadel, and said so in a banner that was gone at the next
    click — the first to find out was the colleague, meeting "User not found in the system" at
    sign-in. The membership is granted now (§288, `SETUP.md` §37, which carries the one-call
    check). The two code follow-ups §288 asked for are done (§297): Echipa marks a row whose
    sign-in account does not exist, and `/admin/tasks` probes the key with the call the invitation
    actually makes, so "authenticates but may not" is a red row rather than a colleague's surprise.
11. ~~The contact form's Gmail~~ — done 2026-09-20: `CONTACT_SMTP_USER`,
    `CONTACT_SMTP_PASSWORD` and `CONTACT_FORM_TO` on both projects, and `/ro/contact` shows
    the **form** on production and on QA rather than the address (§149, `SETUP.md` §38). Who
    receives a message is «Pagini» → «Contact» → "Cine primește mesajele de contact".
12. **The race itself, and this is the launch item.** Production publishes the weekly group run
    and nothing else: the 21 November race has no event there, so nobody can register for it.
    It is one save in `/admin/events` — the event, its capacity, its participation window, its
    bib band — and then publish. Everything under it is live already, which is what items 1–11
    were about. **The click list is `SETUP.md` §39**, field by field, with every value filled
    in; the two the club alone can decide are marked there (how many places, and how many days
    before the race a confirmation is asked and owed).
13. ~~**The monitors' cadence, for Neon's bill**~~ — set 2026-09-24, the eight jobs recorded in
    `SETUP.md` §40: production health hourly at :02 (not 02:02 or 03:02), QA's every six hours;
    the job monitors frequent, because an idle ping wakes nothing. **Two small things left:** tick
    minute 45 on "prod maintenance day", and QA's „Cât de des verifică platforma" → 2 ore. The
    Neon limits themselves are set (production 100 CU-hours a month, QA 30).

14. **The privacy notice, once more** — the template now says a person may register someone else on their own address, entering Since `BR-V2.03` (§445) the template also describes the newsletter and its topics — approve the notice after this release, once, to cover everything.
    that person's data on their behalf and receiving their messages (§389); the notice in force on production says none of it until
    the club approves a new version from the platform's text (`/admin/legal`, the same click as item 8).
    Since `BR-V1.96` (§393, §396) the template also describes the optional group-run declaration and the public list's states — one new version covers all of it.
15. ~~**The family flow's contract release, `BR-V1.94`**~~ — done 2026-09-25 (§390): — one contract-only migration drops `registrations_event_participant_unique`;
    the flow is on wherever migration `0073` ran; production got it with this release. What is left is item 14, the notice.
16. **Approve the legal texts again, from the new templates** — first on QA, then on production. Since `BR-V2.13`–`BR-V2.15`
    the templates carry the trail and the road race declarations (§515), the group-run declarations for a whole series (§523)
    and a privacy notice that describes the members' zone (§524). `/admin/legal` → «Aprobă acum textele care lipsesc…» approves
    in one press every text that has no approved version; a text already in force is «Versiune nouă» → «Pornește de la șablon»,
    one at a time. A Romanian lawyer should read the declarations first. This covers items 8 and 14 too.
    Since §639 every Administrator and Superadministrator is emailed «Șabloanele textelor legale s-au schimbat» at most once a
    club day, as a digest from 08:00 club time (§775) naming every text whose template is newer; `/admin/tasks` keeps the rows.
    Since §550 the notice's template also says that only the club's organizers and administrators see the newsletter's
    subscriber list with the addresses and may download it — approve that notice before an Organizer reads the addresses
    on production.
    Since §562 its section 5 also describes the optional «Vreau să primesc oferte și beneficii de la Brașov Runners și partenerii
    săi.» (`{{promotionalMaterials}}`): until a notice from that template is approved, the form shows no such box and nothing is
    kept (`/admin/tasks` carries the row `promoNotice`).
    Since §564 the four declarations' templates speak Romanian: «eveniment montan» for the mountain race, «teren accidentat»
    for the ground, not one «trail» — «Regenerează din șabloane» makes the drafts; the texts in force keep their words until approved.
    Since §568 the four declarations name serious injury and death among the inherent risks and waive the claims for them
    «în limitele permise de lege» (never for harm the club causes: Codul civil art. 1355) — the lawyer reads that paragraph first.
    Since §613 the notice's template also names the race number on the public list (`{{participantListNumbers}}`); until a
    notice from that template is approved, the list shows no numbers (`/admin/tasks` carries the row `listNumbersNotice`).
    Since §618 the terms' template says the club may refuse or cancel a registration on objective grounds only, told by email with the
    ground — approve the terms from the new template (`/admin/legal` → «Șablon nou»; the lawyer reads §3's last paragraph first, and decides whether the form's express-acceptance box, whose words (§421) name only the club's cancelling or changing of the event, must also name the cancelling of a registration).
    Since §636 the owner decided it must: once terms carrying that paragraph's grounds word for word are in force in both languages, the form's box also names «refuzarea sau anularea unei înscrieri de către club» and the fold «Cum funcționează înscrierea» says the club may refuse — until then `/admin/tasks` carries the row `refusalTerms`.
    Since §646 the terms' and the privacy notice's templates also describe the waiting list in both modes — freed places offered in order of confirmation when the event offers them automatically, otherwise by the organizers to one person on objective grounds they can state — and the places the club may seat outside the advertised ones; approve the terms and the notice from the new templates on production, in the same sitting, like every text.
    Since §741 the notice's template says that an event's route map loads with the page, and when an event has both a Strava and a Garmin Connect map only the chosen tab's loads (Strava first), the other when its tab is chosen, each provider seeing the visitor's IP address — approve the notice from the new template before relying on the maps opening by themselves, a lawyer reading that paragraph first (whether loading a provider's frame that may set cookies without a press needs the visitor's consent under Legea nr. 506/2004 art. 4(5) is the lawyer's question, not decided here).
    Since §754 the notice's template also describes the event volunteers (`{{volunteers}}`: what a sign-up keeps, why, who sees it, thirty days after the event) — approve the notice from the new template before an event's page can offer «Vreau să fiu voluntar», a lawyer reading section 5's paragraph and section 7's thirty days first; until then the form is not on any page and `/admin/tasks` carries the row `volunteersNotice` while an event ahead takes volunteers.
    Since §758 a seventh text, «Contract de voluntariat»: approve the volunteer agreement from the template (a lawyer reads it first, against Legea nr. 78/2014) — until it is in force in both languages no event page shows «Vreau să fiu voluntar» (`/admin/tasks` carries the row `volunteerAgreement`) — and, in the same sitting, a notice from the new template, whose volunteers' paragraph names the agreement's acceptance (`{{volunteerAgreement}}`; until then the form, the link and «Semnat pe hârtie» wait and `/admin/tasks` carries the row `volunteerAgreementNotice`; `SETUP.md` §44 steps 2–3). Before approving, the owner and the lawyer decide whether the club must keep a record of the agreements beyond the thirty-day deletion of the volunteers' rows, and how (a narrowed acceptance record, or an archive copy to the club like the declarations'): until then the text promises only the volunteer's copy by email and the proof kept as the notice says.
    Since §761 a volunteer ticks every role they would do and the organizers give one (or several, since §837): the agreement template names the roles offered for in its own sentence (`{{volunteerRoleChoices}}`, «Ce presupune fiecare rol») — approve the agreement from the new template, a lawyer reading the two new sentences first; until then a sign-up accepts «în rolul Masă, Traseu» and `/admin/tasks` carries the row `volunteerRoleChoicesAgreement`. The notice's volunteers paragraph now names the roles ticked, the role given and the short email naming it — approve the notice from the new template too.
    Since §771 the two race declarations carry five more clauses (insurance or the medical costs, the marked route and the volunteers' instructions, disqualification on objective grounds, litter, no vehicle) and the typed-name signature sentence, and the notice says an electronic signature keeps the IP address and browser — approve both on production from the new templates, the notice first, a lawyer reading the disqualification clause, the signature sentence and the notice's IP paragraph and section 10 first (`docs/RUNBOOKS.md`).
17. **Re-grade every event's difficulty** — migration `0104` put each event in the middle step of its old band (§526). Open each
    event in `/admin/events` and choose the band and «Nivelul» (one of the band's three levels, 1–15 in order); the guide («Ghid») explains the scale.
18. **Open the members' zone and the FAQ** — approve the members' zone address, `/ro/zona-membri` (it sits outside the backoffice,
    which departs from the brief: §524); add the first members on «Echipa» → «Adaugă mai mulți membri» (after the notice of item 16);
    write «Pagini» → «Pagini standard» → «Membri» and «Întrebări frecvente» (§525) in both languages, then publish them;
    add the partners' codes in «Membri» → «Coduri de reducere» → «Adaugă un cod».
19. **Keep the jobs and a monitor off the public name, and the domain's contact read** — from the
    registrar hold of 2026-10-03 (`docs/RUNBOOKS.md` § The domain stops answering). On cron-job.org: the job pings (two
    endpoints per environment, six jobs) moved to each project's `vercel.app` address, and two new health monitors on those
    addresses, production hourly and QA six-hourly, beside the ones on the public name (`SETUP.md` §40, with the addresses).
    On GitHub: the backstop's secrets `PRODUCTION_APP_BASE_URL` and `QA_APP_BASE_URL` set to the same addresses — unset,
    `scheduled-jobs.yml` skips green in zero seconds and guards nothing. At the registrar: the registrant and admin contact
    a mailbox outside the domain, read daily; the registrar's and its verification service's senders whitelisted there;
    auto-renew on with a valid card; `DOMAIN_REGISTERED_ON` and `DOMAIN_RENEWAL_YEARS` on both Vercel projects (`SETUP.md` §26).
20. **Open the members' shop** — approve a privacy notice from the template (section 5 names the shop,
    `{{membersShop}}`; a lawyer reads the accounting-records period first), then in the top bar's «Magazin»
    write how to pay and who receives the orders, and add the products. Payment is never on the site.
    The steps are `SETUP.md` §43; `/admin/tasks` carries the row `shopNotice` while a product is visible.
    A colleague who is not an Administrator runs it once given «Gestionează magazinul» on «Echipa».
21. **Confirm every upcoming race's «Timp limită»** — the duration box of a race is «Timp limită»
    since the checkpoints release (§757), counted from the gun, and the race's page shows «Timp limită:
    2 h 30 min» (with checkpoints, also «Sosire · se închide la 12:30») from the end saved under the
    old «Durata» meaning. No end moved; what the page says is the minutes from the gun to that end,
    and a race whose gun is after its meeting time now reads shorter than the box said. Before the
    release reaches production, open each upcoming race in `/admin/events` → «Când și unde» and confirm
    «Timp limită» — the 21 November race first.

**The values behind items 10 and 11 are in `.env.local` and on both Vercel projects**, never in
this repository — it is public, and `yarn secrets:check` blocks a commit that carries one. The
club's four legal facts live the same way (`SETUP.md` §30), which is why the approved texts on
production read with the club's real name and CIF while the templates in `legal-documents/` show
`<PLACEHOLDER>`.
