<!-- Platform inventory. Operational fact, not authority. See the first section. -->

# Platform inventory

**Baseline `BR-V1.45-2026-09-22`** · versioned with the whole set · [changelog](../CHANGELOG.md)

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

Four accounts exist today: **Vercel, Neon, Mailgun and Zitadel**, plus GitHub. Cloudflare R2 and
the domain registrar have no account yet. A row that says "not created" is a row somebody is
waiting on.

| Service | Plan / SKU | What it holds | Console | State |
| --- | --- | --- | --- | --- |
| **Vercel** | Hobby | Account exists. Both applications. One project per environment, function region `fra1` — QA's was `iad1` until read back on 2026-09-16 (`SETUP.md` §26) | vercel.com/dashboard | QA live; production project created 2026-09-16, configured, **never deployed** |
| **Neon** | Free | PostgreSQL, Frankfurt. Region is fixed at project creation. Free allows 100 projects, so the second one costs nothing (checked 2026-09-16) | console.neon.tech | QA project live, migrated, seeded; production project created 2026-09-16, **never migrated** — `SETUP.md` §25 |
| **Zitadel** | Free | Staff identity. `staff_users` is the allowlist; Zitadel never decides who may in | `brasov-runners-8iqx8c.eu1.zitadel.cloud/ui/console` | One instance, one project, one application per environment. QA live since 2026-09-04; production application created 2026-09-17. Own mail through Mailgun SMTP (`smtp.mailgun.org:587`, US sandbox, working 2026-09-05). Setup, traps and limits: `docs/RUNBOOKS.md` § Staff sign-in |
| **Mailgun** | *to record* — sandbox until a domain is verified | Transactional email, the delivery webhook, and Zitadel's SMTP | app.mailgun.com | Created 2026-09-05, **US region** (see limit 2); sandbox domain only, no domain verified |
| **GitHub** | Free (public repository) | Code, Actions: `docs-check`, `migrate`, `scheduled-jobs` | github.com | Live, under the maintainer's personal account |
| **Domain registrar** | ROMARG, one `.com` for one year | `<domain>` and its DNS, edited in ROMARG's Zone Editor — a `.com` first, a `.ro` a year later (`DECISIONS.md` §55) | ROMARG client area | **`.com` registered 2026-09-16, DNS live**, renews 2027-09-16; the invoice amount is still to be recorded below. `.ro` not registered. `.com` registry wholesale $10.26/year, **$10.97 from 2026-11-01** (Verisign, checked 2026-09-16); the registrar charges more and adds VAT |
| **Team mail** | *provider not chosen* — a nonprofit grant from **Google** (applied 2026-09-16, pending) or **Microsoft**; **Zoho Mail** only if neither is granted | Team mailboxes on `<domain>`, and a shared `contact@` — never application mail, which stays on a subdomain (`SETUP.md` §26, `DECISIONS.md` §56) | — | **Not created.** No entitlements quoted for either grant until one is granted (§1.2). Zoho free plan checked 2026-09-16: up to 5 users, 5 GB each, one domain, web access only — its paid tier is why it is the fallback rather than the plan |
| **Cloudflare R2** | *no account* | Media, when a non-developer needs to upload — the photo gallery the owner asked for on 2026-09-17 | — | **Not signed up.** Next: `SETUP.md` §32 is the ten-minute procedure. Free for the club's size (below), with one catch: Cloudflare asks for a **payment method on file to enable R2**, even on the free plan; nothing is charged inside the allowance |

Hostnames: `SETUP.md` §26, which is the only file allowed to name one.
Secrets: each Vercel project's own environment; the two GitHub Environments used by
`migrate.yml`; repository secrets for `scheduled-jobs.yml`. `SETUP.md` §26 lists which
environment contributes what.

---

## Subscriptions, limits and cost — Neon re-checked 2026-09-22

**How these were established, because it matters for how far to trust them.** Each vendor was
researched against its own pricing and documentation pages, then a second, independent pass tried
to *refute* every figure. That pass earned its place: it caught a fabricated quotation and several
tier-attribution errors in the first pass. What survived is below. Vendor pricing changes without
notice — **re-check before spending, and update the date in this heading when you do.**

### What each service gives away, and what the first upgrade costs

| Service | Plan in use | What it includes or costs | Next paid tier or trigger |
| --- | --- | --- | --- |
| **Mailgun** | Free, $0 | **100 emails/day.** Sandbox: 5 authorized recipients. 1 day log retention, 2 API keys, 1 inbound route. No monthly figure is published | **Basic $15/mo** — 10,000 emails/mo, **and no daily limit**. Then Foundation $35/mo (50k), Scale $90/mo (100k) |
| **Vercel** | Hobby, $0 | 100 GB bandwidth, 1M function invocations, 1M edge requests, 100 deployments/day, 1 concurrent build, 300s max function duration | **Pro $20/month per developer seat.** Viewer seats free and unlimited. $20 usage credit included; overage uncapped by default |
| **Neon** | **Launch**, usage-based; active since 2026-09-22 | No monthly minimum; $0.106/CU-hour, $0.35/GB-month storage, $0.20/GB-month of changes retained for Instant Restore; 100 projects, 10 included branches/project, 500 GB public transfer, autoscale to 16 CU, scale-to-zero after 5 idle minutes | **Scale** when the club needs the 99.95% SLA or its additional security/compliance controls; not required by today's load |
| **Zitadel** | Free, $0 | **100 daily active users**, 5,000 management API requests, 1 instance, **1 administrator**, **0 custom domains**, 1 day audit trail | Paid tier — required for a custom domain and for more than one administrator |
| **GitHub Actions** | Free | **Unlimited on public repositories** — standard runners consume no minutes. Private: 2,000 min/month | Metered only for private repos or larger runners. Team $4/user/month |
| **`.com` domain** *(registered 2026-09-16)* | **none — this is the one line with no free plan** | — | **$10.97 per year** at the registry from 2026-11-01 ($10.26 until then) — Verisign's wholesale price, checked 2026-09-16; the club buys through a registrar, which adds its margin and Romania's 21% VAT and invoices in its own currency. The `.ro` that follows a year later is 12 EUR + VAT at ROTLD (checked 2026-09-07 on rotld.ro/prices), invoiced in lei |
| **Cloudflare R2** *(no account yet)* | Included allowance | 10 GB-month storage, 1M Class A ops, 10M Class B ops, **egress always $0** — which is why R2 and not S3: a gallery viewed a thousand times costs nothing extra. A club gallery of ~2,000 photos at ~500 KB after the thumbnails the site makes is ~1 GB, inside the allowance indefinitely. **A payment method must be on file to enable R2**; nothing is charged inside the allowance (checked 2026-09-17) | Usage-based: $0.015/GB-month storage, $4.50/M Class A (writes), $0.36/M Class B (reads) |

Running cost today: the `.com` registration plus **Neon Launch usage**. The console showed 1.8
CU-hours and $0.19 in the Sep 22–Oct 1 partial period. If 1.8 CU-hours is representative of one
day, 30 days is 54 CU-hours or about **$5.72 compute**, before storage and restore history. A
0.25 CU compute kept warm for all 720 hours of a 30-day month is **$19.08 per project**; two
always-warm projects would be $38.16. These are projections, not a fixed subscription or invoice.
The next separate cost likely to arrive is a month of Mailgun Basic around a real race.

**Review in December 2026.** Launch is not assumed permanent. The owner may return Neon to Free
after comparing the invoices with actual use. Nothing changes automatically: at the review,
re-check Free's current compute, storage, branch, restore and production constraints, confirm both
projects fit, and only then make and document the plan change. Until that explicit decision,
every operational page and estimate must treat Launch as current.

**This table, the limits below it and the bump order now render on `/admin/tasks`** for an
Administrator, as **one row per service** rather than three overlapping lists, with the email
headroom computed from what this deployment has actually sent today (BR-REQ-090-05). This
document stays the source: a figure changes here first, and
`modules/diagnostics/platform-plans.ts` quotes it. A club treasurer should never have to open a
repository to find out what the club may spend.

Three things about how that page treats these figures, decided in that file and recorded here so
they are not re-argued. Each row carries **its own** check date, because the domain price was
established two days after the rest and one shared date would have claimed a re-check that never
happened. The page **ages** the oldest of those dates rather than only printing it — fresh under
90 days, ageing to 270, too old to quote after that — so a year-old quotation stops being
asserted at full confidence. And amounts stay in **each vendor's own currency**, with no exchange
rate: none of them invoices in lei except the domain registry, which converts at the National
Bank's rate on the invoice date, so a leu figure printed here would be arithmetic no invoice ever
confirms. The page also separates a **fact** from a **question somebody owes an answer to** —
which registrar and what it actually cost, whether an event will ever charge, whether to buy a
month of Mailgun before a race — and lists, per service, the alternative that was researched and
not taken, so the club can see it is not locked in.

### The four that will actually bite this club

**1. Mailgun's 100 emails/day is the binding constraint on registration day.** This application
sends **six emails per completed registration** — verify the address, sign the declaration,
confirmed, the signed declaration as a PDF (`DECISIONS.md` §95), the reminder two days
before (§81), and the notice to the club that somebody confirmed (§245) — and a waitlisted
entrant costs two more. Every address the club names under "copie ascunsă la emailurile către
participanți" on `/admin/emails` adds one more per participant message — five per registration
— and `/admin/emails` and `/admin/tasks` count it. So the free plan supports roughly
**16 registrations per day**, and a race that
opens entries to a hundred people exceeds it before lunch. Basic at $15/mo removes the daily limit and includes 10,000/month. **Budget one month of
Basic per race, not a permanent subscription.**

**2. Vercel Hobby cannot run the scheduler, and fails loudly.** Hobby cron is limited to *once
per day*, and a more frequent expression **fails at deploy time**, not at runtime. This is the
documented reason `.github/workflows/scheduled-jobs.yml` exists. GitHub's own cron minimum is 5
minutes, so five minutes is the floor either way.

**3. Vercel Hobby cannot connect to a Git organization's repository.** "You can either switch to
an existing Team or create a new one." BR-BUS-101 requires the repository to move to a
club-owned organization — **doing that forces a paid Vercel plan**, or a move to the recorded
fallback. That is a dependency nobody had noticed between two things the club wants.

**4. Zitadel Free includes zero custom domains and one administrator.** Staff sign-in on the
club's own domain, and a second person able to administer identity, both need a paid tier. At
three to five staff the DAU cap (100) is irrelevant; these two are not.

**The price, re-checked on 2026-09-17 because the owner was about to act on it:** a custom domain
is Zitadel's **PRO tier, US$100/month**, and the Free tier includes none. That is roughly a
hundred times the club's entire running cost, for a hostname a volunteer reads for two seconds
while signing in. What it buys is cosmetic; what it costs is the largest line the club would
have. The alternatives, in the order they are worth considering: keep the provider's own
hostname (free, and nothing about access changes, because `staff_users` is what decides who may
sign in); or drop Zitadel for Auth.js against Google or Microsoft directly, which is free and
becomes natural if the nonprofit grant lands and the staff already have club accounts
(`DECISIONS.md` §56 tracks that application).

### Two more worth knowing

- **Exceeding a Hobby cap pauses the feature for 30 days and you cannot buy your way out.** Not a
  bill — an outage with a fixed sentence. Upgrade *before* the window, never during it.
- **Vercel Pro is per seat.** Three organizers who deploy is $60/month. Viewer seats are free and
  can see dashboards and deployments, so only people who actually deploy need a paid seat.

### The commercial clause, precisely — re-verified 2026-09-07

Read against the page itself rather than paraphrased, because the club is a **non-profit (ONG)**
and the obvious assumption — that this exempts it — is wrong.

Commercial usage is any deployment "used for the purpose of financial gain of **anyone** involved
in **any part of the production** of the project, including a paid employee or consultant writing
the code". The listed examples are: requesting or processing payment from visitors; **advertising
the sale of a product or service**; receiving payment to create, update or host the site;
affiliate linking as the site's primary purpose; and advertisements.

**The word "non-profit" does not appear anywhere in the guidelines.** Legal form is not the test.
Two things are:

- **Donations are explicitly carved out.** The page carries the note, verbatim: "Asking for
  Donations **does not** fall under commercial usage." A contribution the club presents as a
  donation is therefore fine on Hobby.
- **"Advertising the sale of a service" is not.** This is the sharp edge, and it is wider than
  "does the site take money" — which this one never does, having no payment integration at all.
  An event page stating a **mandatory entry fee** announces the sale of a service, whoever
  collects the money and by whatever means. A suggested donation does not.

A third trigger is independent of both and easy to overlook: **the day anybody is paid to build,
update or host this site, that alone is commercial usage** — the clause names a paid consultant
writing the code. For a club whose site is built by a professional developer, this is the more
likely trigger of the two.

Where a specific case is unclear, the guidelines ask you to contact Vercel support rather than
guess. If Hobby does stop applying, the choice is Pro or the fallback already recorded in
`DECISIONS.md` — Render Free in Frankfurt, which runs the literal `yarn start` contract and needs
no code change.

**Product consequence, not yet built:** `events.cost_type` is `FREE|PAID`, which cannot express
the distinction the clause turns on. If the club intends to ask for contributions and stay on
Hobby, the enum needs a third value — a donation is not a price. Recorded in `DECISIONS.md` §50.

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
case a club site quiet for a season would trip. **Since `DECISIONS.md` §98 there is an alert
on `degraded`:** `/api/health` answers 503 for every status but `ok`, and a cron-job.org
monitor on it with "notify on failure" emails the club — from cron-job.org's own mail, which
is the point, because the commonest reason is that the club cannot send any.

### 5. Neon Launch scales to zero and bills what stays awake

The first request after an idle period pays a cold start, which colleagues testing QA will feel
as a slow first page. Launch keeps the five-minute scale-to-zero option but removes Free's hard
100-CU-hour monthly suspension. The arithmetic still matters because every awake interval is now
billed: a job monitor every five minutes prevents sleep, 0.25 CU × 24 h = 6 CU-hours a day,
180 a month, or **$19.08 per project** at $0.106/CU-hour — QA had spent 74 CU-hours by the 18th
before the upgrade. So the monitors remain every fifteen minutes in production and hourly in QA,
the outbox drains itself after the request that filled it (`DECISIONS.md` §68), and `/devs`
reads the period when `NEON_API_KEY` is set (`SETUP.md` §33). Its current 100-hour denominator,
80% warning and Free label are stale implementation, explicitly tracked by BR-REQ-090-07.

The cold start is also the reason the pool sets no connection timeout: see the next section.

### Connections are not the ceiling, and a long query is — checked 2026-09-05

`db/client.ts` opens the pool with `max: 10`. The question that has to be answered before a
registration window opens is whether that number can exhaust the database under load, and the
answer is no — but not for the reason it looks like.

**`max: 10` is per warm function instance, not per deployment.** Vercel's own guidance is
explicit: "Define your pool globally, so multiple requests within the same instance can reuse
it", and the concurrency limit is per instance — under load Vercel adds instances, each with
its own pool. So the deployment's total is `10 × warm instances`, a number nobody sets.

**What sits on the other end.** `DATABASE_URL` points at Neon's *pooled* host (the one
containing `-pooler`), so every one of those connections lands on PgBouncer, not on PostgreSQL.

| Layer | Limit at the measured 0.25 and 2 CU compute sizes |
| --- | --- |
| PgBouncer client connections | **10,000** |
| Concurrent server transactions (`default_pool_size`, 90% of `max_connections`) | **93** at 0.25 CU |
| Direct connections, if the non-pooled host were ever used | 104 at 0.25 CU (97 usable), 839 at 2 CU |

**The arithmetic.** Saturating PgBouncer's client side needs 1,000 simultaneously warm
instances. Saturating the 93 concurrent transactions behind it needs 93 requests *executing a
statement at the same instant* — not 93 visitors, because a request that is rendering, waiting
on the network or idle between statements holds a client slot and no server slot. A club race
opening entries to a few hundred people over an hour does not approach either. **`max: 10`
stays.** Vercel names `max: 1` as the wrong correction: it does not lower the total and removes
concurrency inside the instance.

**So the risk is duration, not count** — one statement holding one connection. A Vercel function
may run 300 seconds, and one unbounded query would occupy a connection, and the invocation
budget, for all of it while everything behind it queues. `db/client.ts` now sets
`statement_timeout` to **10 seconds** and `idle_in_transaction_session_timeout` to **30**. The
first is enforced by PostgreSQL, so it holds even when the Node process is frozen or the request
was abandoned; the second covers what the first cannot see — a serverless instance killed
between two statements of an open transaction, leaving a capacity lock (§10.6) held by nobody.

**No connection timeout, deliberately.** Neon Launch scales to zero and the first request after an
idle period waits for the compute to wake. That wait is connection time, not statement time, so
`statement_timeout` does not touch it — and bounding it would make the guard itself the outage,
failing a visitor's first page load to enforce a deadline.

### 6. The repository is owned by a person, not the club

BR-BUS-101 requires the club to own the domain, hosting, repository, database, staff
authentication, email and media accounts, and that no single person be the only one able to
recover the platform. Today the repository is under the maintainer's personal GitHub account and
the transfer to a club-owned organization is still outstanding.

**Lift:** create the club organization, transfer the repository, and give a second person
recovery-capable access to every account in the table above.

---

## Registration day: surge on purpose, then come back down

The club's load is not a curve, it is a spike. A race opens and a few hundred people arrive in an
hour; the rest of the month is a handful of visitors a day. Paying for the spike all year is the
expensive mistake, and being throttled during the spike is the embarrassing one.

**Rate limiting is the first line, and it is free.** It is what stops one script, one retry loop
or one accidental double-submit from turning into the traffic that makes an upgrade necessary.
The current policy is on `/devs`, read from the code rather than restated. Raising a plan to
absorb load that a limit should have refused is paying for abuse.

### Before a registration window opens

- [ ] Read `/devs`. Everything blocked or limited there will be worse under load, not better.
- [ ] **Read the email-volume figure on `/devs`** and compare it with the number of people you
      expect. It does the arithmetic below for you — registrations today × 3 against the daily
      allowance, with what is left of today — so this check is now a glance rather than a
      dashboard visit. It turns red when the allowance is spent and amber when the projection
      exceeds what is left.
- [ ] Confirm the scheduled jobs actually ran in the last ten minutes. Under a spike the outbox
      is what delivers confirmations, and it runs about every two hours here (limit 4) — that is
      the single worst thing about a busy registration day, and it is not fixed by any upgrade in
      this table.
- [ ] Decide the capacity **before** opening, not during. A capacity raised mid-window reallocates
      the waiting list, which is correct and surprising.

### When the daily allowance runs out — decided, and it is not a bounce

This will happen: six messages per completed registration against 100 a day is 16
registrations, and a race opening entries to a hundred people crosses it before lunch (limit 1).
What happens then is now a decision rather than an accident. **Which plan the account is on is
a setting since `DECISIONS.md` §100** — `/admin/emails`, Administrator, audited — and every
figure on `/admin/tasks`, `/devs` and the outbox panel counts against that plan's ceiling over
its own period: a day on Free, a month on Basic and above. The month of Basic before a race is
therefore two clicks and no deploy: pay at Mailgun, set the plan; cancel, set it back.

**The messages wait, and go out when the allowance resets.** Mailgun refuses a send whose
allowance is spent, the adapter classifies that refusal as `throttled`, and the outbox leaves the
row `PENDING` and schedules the next attempt for **just after the next UTC midnight** rather than
applying its ordinary backoff. Nobody loses a confirmation; some people get theirs the next
morning.

**The defect this replaced is worth knowing, because the same shape will recur with the next
provider.** Mailgun refuses a spent allowance with the *same HTTP 400* it uses for a malformed
message — `Domain <domain> is not allowed to send: recipient limit exceeded` — and the adapter
mapped every 400 to a permanent failure. Permanent means `BOUNCED`, and `BOUNCED` is terminal:
the outbox never retries out of it. So on the club's busiest day, every message queued after the
cap would have been **discarded**, not delayed. Mapping alone was not enough either: the retry
schedule spends all six attempts in about an hour, so even a transient classification would have
marked a good message `FAILED` around ninety minutes later. It needed a third outcome with a
day-scale reset, which is what `throttled` is.

The statuses now, checked against Mailgun's own documentation on 2026-09-05 — whose table lists
only 400, 401, 403, 404, 429 and 500, so anything else here is observed rather than inferred:

| Status | Treated as | Why |
| --- | --- | --- |
| 401, 403 | permanent | Bad credentials, or a sending domain that is not verified. Every retry fails identically |
| 400 with limit wording | **throttled** | The allowance, not the message. Retry after the reset |
| 400 otherwise | permanent | A malformed message, or a sandbox recipient who is not authorized. Waiting authorizes nobody |
| 402, 420 | **throttled** | Undocumented by Mailgun. 420 is its own code for "not allowed to send: … limit exceeded"; 402 is a plan or payment refusal |
| 429 | transient | The *hourly* rate limit (300/hour on free), which clears within the hour. Ordinary backoff, deliberately not a day |
| 404, 5xx, network | transient | Not clearly the caller's fault |

The pattern that moves a 400 out of permanent is **narrow on purpose** and must stay narrow:
widening it to "not allowed to send" would sweep in a disabled domain and an unauthorized sandbox
recipient, and retrying those once a day forever is exactly how a sending domain's reputation is
spent. `tests/unit/notifications/mailgun-classification.test.ts` asserts both directions.

**The upgrade this makes an informed choice rather than a panic.** One month of Mailgun Basic
($15) removes the daily limit entirely. Deferral means the club can decide that at leisure the
next morning instead of during the window — but a race whose confirmations arrive a day late is
still a bad race, so if `/devs` shows the projection above the remaining allowance, upgrade
**before** opening.

### What to bump, and in what order

| If | Bump | Back down |
| --- | --- | --- |
| A few hundred registrations expected | Nothing. This is well inside every free tier | — |
| Mailgun's monthly allowance is close | Mailgun tier, for that month | The month after |
| The database is the bottleneck — slow pages, connection errors | Neon, to an always-on compute | After the window closes |
| Vercel throttles or the club takes money | Vercel Pro | Only if it was purely for load |

Bump one thing, watch, bump the next. Two at once means never learning which one was binding.

### Coming back down

The point of a temporary bump is that it is temporary, and nothing will remind you. Put the
downgrade date in the same place as the upgrade — and record both in the cost table below, so
next year's registration window starts from what actually happened rather than from memory.

## Scheduled debt

Things already decided and owed, so they are not rediscovered.

| Owed | Why | Where it is recorded |
| --- | --- | --- |
| A decision on whether the backoffice stays bilingual or becomes Romanian-only | The owner raised it; the enum labels were the smaller half and are done | `DECISIONS.md` §35 |
| The approved privacy notice must describe the participant list before `NAMES` may be used | Publishing participants' names is a disclosure | `DECISIONS.md` §32 |
| No way to discard a registration whose address was never confirmed | §10.5 has no such transition; it lapses in 48 hours instead | `DECISIONS.md` §33 |
| ~~An alert on `/api/health` going `degraded`~~ | Done 2026-09-18: 503 on anything but `ok`, a cron-job.org monitor with failure notifications watches it | `DECISIONS.md` §98 |
| Rate limiting on the one surface with no route yet | §19.4 names five. Built: submission, admin resend, token validation, the job endpoints as the auth-adjacent one, and the participant's own link request — `/registrations/resend` landed in `BR-V1.22`, throttled on the canonical email identity. Only uploads remain, and media storage is deferred (`AGENTS.md` §17), so there is nothing yet to guard | `AGENTS.md` §19.4 |

---

## Cost

Nothing is on a paid plan today, so the running cost is the domain registration alone. Record a
row the day a plan is taken **and the day it is dropped** — a temporary upgrade nobody reverses is
the expensive failure here.

| Service | Plan | Cost | Taken | Dropped |
| --- | --- | --- | --- | --- |
| `.com` domain, one year | registration at the club's registrar | *record the invoice: amount, currency, VAT* | 2026-09-16 | renews 2027-09 |

Expected first spend, in the order it will arrive: the domain ($10.97 a year at the `.com`
registry plus the registrar's margin and VAT; record what the registrar actually charged in the
row above), then one month of
Mailgun Basic ($15) around the first real race, then a Vercel paid plan if and only if the
repository moves to a club organization or the club starts charging entry.
