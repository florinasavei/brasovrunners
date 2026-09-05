<!-- Platform inventory. Operational fact, not authority. See the first section. -->

# Platform inventory

**Baseline `BR-V1.19-2026-09-05`** · versioned with the whole set · [changelog](../CHANGELOG.md)

Every account the platform runs on: which plan, what it holds, who can recover it, and **what
its limits stop the club from doing**. One page, so that "why can we not do X yet" has an answer
that is not an afternoon of clicking through five dashboards.

**This is fact, not authority.** A rule lives in `AGENTS.md`; the reasoning behind a provider
choice lives in `DECISIONS.md`; the procedure for changing one lives in `docs/RUNBOOKS.md`. This
page records what is true of the accounts right now. When it disagrees with reality, reality is
right and this page is stale — fix it here.

**Two rules it inherits.** The club's own hostname appears in no file except `SETUP.md` §26, so
this page writes `<domain>` and points there for the real one (`docs:check` enforces it). And no
secret, key, connection string or password is ever written here — this page names *where* a
credential lives, never the credential.

---

## Accounts and plans

Fill a blank the day the account is created. A row that says "not created" is a row somebody is
waiting on.

| Service | Plan / SKU | What it holds | Console | State |
| --- | --- | --- | --- | --- |
| **Vercel** | Hobby | Both applications. One project per environment, function region `fra1` | vercel.com/dashboard | QA live; production project **not created** |
| **Neon** | Free | PostgreSQL, Frankfurt. Region is fixed at project creation | console.neon.tech | QA project live, migrated, seeded; production project **not created** |
| **Zitadel** | *to record* | Staff identity. `staff_users` is the allowlist; Zitadel never decides who may in | `brasov-runners-8iqx8c.eu1.zitadel.cloud/ui/console` | QA tenant live, `STAFF_AUTH_MODE=provider`; own mail through Mailgun SMTP (`smtp.mailgun.org:587`, US sandbox, working 2026-09-05) |
| **Mailgun** | *to record* — sandbox until a domain is verified | Transactional email, the delivery webhook, and Zitadel's SMTP | app.mailgun.com | Created 2026-09-05, **US region** (see limit 2); sandbox domain only, no domain verified |
| **GitHub** | Free (public repository) | Code, Actions: `docs-check`, `migrate`, `scheduled-jobs` | github.com | Live, under the maintainer's personal account |
| **Domain registrar** | *not chosen* | `<domain>` and its DNS | — | **Not registered** |
| **Cloudflare R2** | *not chosen* | Media, when a non-developer needs to upload | — | Deferred (`AGENTS.md` §17) |

Hostnames: `SETUP.md` §26, which is the only file allowed to name one.
Secrets: each Vercel project's own environment; the two GitHub Environments used by
`migrate.yml`; repository secrets for `scheduled-jobs.yml`. `SETUP.md` §26 lists which
environment contributes what.

---

## Limits that constrain the club, worst first

The point of this page. Each one is a thing the club cannot currently do, why, and what it would
cost to lift.

### 1. Production refuses every registration until the club's legal text is approved

Not a provider limit — the platform's own rule (BR-REQ-053-01), and the longest-lead item on the
whole list. Production is seeded with no legal documents at all and registration is refused while
no approved privacy notice exists. Sample text exists everywhere *except* production, deliberately
(`DECISIONS.md` §29).

**Lift:** the club, or its adviser, writes and approves the privacy notice, the terms and the
event declaration. Loaded by migration, per `docs/RUNBOOKS.md` § Legal document version. Nothing
technical is blocking; start it early, because it compresses less than anything else here.

### 2. A Mailgun sandbox reaches five people, and they must each accept first

Until a sending domain is verified, Mailgun sends only to **authorized recipients**, capped at
five, each of whom confirms by clicking a link. That caps a closed-group test at five testers.

Two sharp edges:

- **Capture mode is not a workaround on a deployed environment.** The capture adapter holds
  messages in memory and Vercel is serverless, so the process holding the confirmation link is
  gone before anyone could read it. A colleague who is not allowlisted registers and then simply
  never hears anything. Allowlist mode with a real provider is the only way somebody outside the
  code can complete a registration.
- **The two allowlists do not agree, on purpose.** This application compares *canonical*
  identities (`AGENTS.md` §10.4), so `ana.pop+qa@gmail.com` passes `EMAIL_ALLOWLIST`. Mailgun's
  authorized-recipient list is literal and will refuse that address unless it was authorized in
  exactly that spelling. Authorize what the tester will actually type.

**The sandbox is in Mailgun's US region, and a region is chosen per domain at creation.**
Proven rather than assumed on 2026-09-05: an SMTP AUTH probe with the sandbox's own credentials
answered `235` on `smtp.mailgun.org` and `535` on `smtp.eu.mailgun.org`. The console's EU badge
switches which region you are *looking at*; it does not move a domain. Two things follow. The
API base is `https://api.mailgun.net/v3` — the EU host rejects these credentials, and the adapter
maps that `401` to a **permanent** failure, so a misconfigured region silently kills every message
rather than retrying it. And message bodies, event logs and suppressions for anything sent
through this sandbox rest in the US, while the database rests in Frankfurt — acceptable for
colleagues testing QA, an owner decision to record before a real participant's address goes
through it. **The club's own sending domain should be created in the EU region**, which costs
nothing at creation and cannot be changed afterwards.

**Lift, without waiting for the club's domain:** verify **any** domain already owned — a
subdomain of a personal one is enough — as a Mailgun sending domain, and the cap disappears.
`MAILGUN_DOMAIN` is configuration; swapping it later for `<domain>` is one environment variable
and no code change. A `*.vercel.app` host cannot be verified, because its DNS is not the club's.

### 3. Vercel Hobby is non-commercial, and the club may not stay non-commercial

Vercel's fair-use guidelines say Hobby teams are "restricted to non-commercial personal use only"
and that asking for donations "fall[s] under commercial usage" (`DECISIONS.md`, hosting). A club
site taking no money is a grey area. **The day the club charges an entry fee or adds a donate
button, this stops being grey.**

**Lift:** Vercel Pro, or the fallback already chosen and recorded — Render Free in Frankfurt,
which runs the literal `yarn start` contract and needs no code change, because BR-REQ-101-01
keeps the application portable and CI exercises that path.

### 4. The only scheduler fires about every two hours, not every five minutes

Serverless functions have no persistent process, so there is no in-process interval, and Hobby
cron fires once a day with hour-level jitter — useless for a 30-minute declaration hold. The only
thing that drains the outbox and expires holds is `.github/workflows/scheduled-jobs.yml`, asking
for `cron: */5` (`AGENTS.md` §16.2).

**Measured, not assumed (2026-09-05).** In the fifteen hours to 09:35Z the workflow fired **six**
times on its schedule — 18:32, 21:01, 23:00, 00:52, 05:18, 09:10 UTC — gaps of 1h52 to 3h52
against a five-minute cron. GitHub delays scheduled workflows under load, and what this
repository actually gets is roughly two hours. Two consequences, worst first:

- **A confirmation email can sit in the outbox for hours.** The participant registers and hears
  nothing until the next fire. Nothing is corrupted — hold expiry is evaluated inside every
  capacity transaction (`AGENTS.md` §10.6), so a late run delays a message rather than
  overbooking an event — but a closed-group test is unrunnable at this cadence, and so is a real
  one.
- **`/api/health` reports `degraded` nearly always**, because the 15-minute staleness threshold in
  `src/modules/jobs/health.ts` is three times tighter than the cadence actually delivered. The
  signal the missing alert below would watch is currently stuck on.

**Lift:** either an external HTTP cron service calling the same two endpoints — `SETUP.md` §26's
own third option, one free account, no code change — or draining the outbox on the request that
enqueued it (Next 16 `after()`), which is application code and a decision against §16.2. Not yet
decided; the owner picks.

**Three things confirmed on the way, so they are not rediscovered.** Scheduled workflows run only
from the **default branch**, which here is `qa` — that is why the schedule fires at all. Every
scheduled run before `QA_APP_BASE_URL` and `QA_JOB_SECRET` existed (created 2026-09-05T02:34Z)
was a **green skip**, which is exactly the failure `DECISIONS.md` §31 records, and the two runs
straight after it returned **401** until the Vercel project's own `JOB_SECRET` matched, at about
05:47Z — a green tick is not evidence that a job ran. And GitHub documents that scheduled
workflows are disabled on repositories after a period of inactivity: still unconfirmed, still the
case a club site quiet for a season would trip, and **there is still no alert on `degraded`** —
somebody has to look.

### 5. Neon Free scales to zero

The first request after an idle period pays a cold start, which colleagues testing QA will feel
as a slow first page. Storage and compute allowances on the free plan are **not recorded here
because they have not been checked** — confirm them before production rather than discovering
them on a race morning.

### 6. The repository is owned by a person, not the club

BR-BUS-101 requires the club to own the domain, hosting, repository, database, staff
authentication, email and media accounts, and that no single person be the only one able to
recover the platform. Today the repository is under the maintainer's personal GitHub account and
the transfer to a club-owned organization is still outstanding.

**Lift:** create the club organization, transfer the repository, and give a second person
recovery-capable access to every account in the table above.

---

## Scheduled debt

Things already decided and owed, so they are not rediscovered.

| Owed | Why | Where it is recorded |
| --- | --- | --- |
| Migration `0015`: drop `location_name`, `location_address`, `difficulty_label`, `cost_text` from `event_translations`, and the third clause of `event_translations_required_fields_present` | The four moved to `events`; a drop ships in the release after the code that stopped needing it (`AGENTS.md` §7.6) | `DECISIONS.md` §36 |
| A decision on whether the backoffice stays bilingual or becomes Romanian-only | The owner raised it; the enum labels were the smaller half and are done | `DECISIONS.md` §35 |
| The approved privacy notice must describe the participant list before `NAMES` may be used | Publishing participants' names is a disclosure | `DECISIONS.md` §32 |
| No way to discard a registration whose address was never confirmed | §10.5 has no such transition; it lapses in 48 hours instead | `DECISIONS.md` §33 |
| An alert on `/api/health` going `degraded` | The health check is the detection; nothing watches it | this page, limit 4 |

---

## Cost

Recorded per service the day a paid plan is taken. Everything in the table above is currently on
a free plan or not yet created, so the platform's running cost is the domain registration and
nothing else — **which is worth re-checking against limits 3 and 5 before that is relied on.**

| Service | Plan | Cost | Renews |
| --- | --- | --- | --- |
| *to fill* | | | |
