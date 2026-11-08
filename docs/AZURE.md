# Moving to Azure: the plan (2026-11-08)

**Status: a plan. Nothing is provisioned, no code is changed, and nothing moves before the 21 November
race.** Written for the owner, who decides, and for the session that later carries it out. The facts below
were read from the providers' own pages on 2026-11-08 (§ Sources); a price or a limit is re-read before
anyone relies on it. Where this plan and `docs/PLATFORM.md` disagree, PLATFORM records what runs and this
records what is proposed.

The goal is the owner's: **pay less**. Today the platform costs about $66 a month: Mailgun Foundation at $35,
one Vercel Pro seat at $20 and Neon Launch at about $11 for both databases (PLATFORM § Cost). The
Microsoft Nonprofits **Azure Grant** gives $2,000 of Azure credit a year (PLATFORM § Nonprofit offers).

## In one screen

| Piece | Today | Proposed | Why | When |
| --- | --- | --- | --- | --- |
| **Application email** | Mailgun Foundation, $35 a month; Free from December: 100 a day | **Azure Communication Services Email**, over SMTP | About $0.25 per 1,000 messages, so roughly a dollar a month **even with no grant**. It sends 100 an hour by default, which can be raised, against Mailgun Free's 100 a day. It replaces every paid Mailgun month | December, after the race |
| **Database** | Neon Launch, about $11 a month | **Azure Database for PostgreSQL, Burstable B1ms, if the grant is approved**; Neon Free if not | Azure gives 7 to 35 days of point-in-time restore, is never suspended for hours used, and costs $0 cash inside the grant. Neon Free needs no migration but caps at 100 CU-hours per project and 6 hours of restore | Decided in December; moved in January |
| **Hosting** | Vercel Pro, $20 a month | **Stays on Vercel** | PLATFORM § (c) already has the rule for returning to Hobby. Moving hosting is the biggest change on this list and saves nothing that rule does not | Only if Hobby does not fit (Part 3) |
| **Staff sign-in** | Zitadel Free, $0 | **Stays on Zitadel** | Microsoft Entra ID would also cost $0, but every staff member would have to be invited again and `DECISIONS.md` §26 would change, for no saving | Not planned (Part 4) |

## The grant, and what a missed renewal really costs

From Microsoft's renewal page:

- The grant is **$2,000 a year** and **must be renewed every year**. Renewal is possible only on the expiry
  date or in the 30 days before it, and unused credit does not roll over.
- **If it is not renewed, nothing is switched off. Usage converts to pay-as-you-go** and is charged to the
  card on the billing profile; a card may be required at setup even inside the grant. Microsoft emails
  before the account converts.
- Renewal may be refused to an organisation that does not meet Microsoft 365 utilisation requirements. The
  club's team mail is on Google (PLATFORM § Nonprofit offers), so **ask about this when applying**.

So the risk is a bill, not an outage. With this plan's sizing the bill is about $20 to $35 a month for
the database and about $1 for email. **Mitigation:** the renewal date becomes a dated row on
`/admin/tasks` the day the grant is taken (PLATFORM already requires that), plus a budget alert on the
subscription (Part 2, step 1). Email alone on Azure costs about a dollar a month, so a lapse there hardly
matters.

## Gates before any move

1. **The race is over.** Nothing here touches production before 22 November.
2. **The club approves a new privacy notice** naming Microsoft (Azure) as the email provider and, for the
   database, as the host. The template names Mailgun and Neon (`legal-documents/templates/privacy-notice.ts`),
   and no legal text may be in force that the club did not approve (`AGENTS.md` §10.8, `DECISIONS.md` §29).
   Draft the new version, have the club approve it in `/admin/legal`, then switch.
3. **A `DECISIONS.md` section** records each move. The email move amends PLATFORM's «application mail is
   Mailgun's whatever the team uses». Each move also changes the stack table in `CLAUDE.md`.
4. **QA first, a week of real use, then production.**
5. **The database move only:** the grant is approved and its subscription exists.

## Part 1: application email to Azure Communication Services

### What Azure gives (read 2026-11-08)

- **Default limits on a custom domain, per subscription:** 30 emails a minute and 100 an hour. A support
  request raises them; it can take up to 72 hours and requires a failure rate under 1%. Microsoft advises
  ramping volume up over two to four weeks. An Azure-managed domain is capped at 10 an hour and cannot be
  raised, so a custom domain is required.
- **Limits are per subscription, so QA and production share them.**
- 50 recipients per message and 10 MB per request, attachments included. The signed-declaration PDF fits.
- **SMTP relay:** Microsoft's SMTP host on port 587 with STARTTLS. The username is an «SMTP Username»
  resource linked to a Microsoft Entra application, and the password is that application's client secret.
- **Price:** $0.00025 per email and $0.00012 per MB, which Microsoft calls illustrative.
- Microsoft's pages carry a banner about breaking changes and retirements in Communication Services.
  **Check that guide for Email** before starting.

**Why SMTP and not the REST API:** the calendar invitation (§672) must be a `text/calendar; method=REQUEST`
part inside `multipart/alternative`. Nodemailer already composes that for the Gmail road
(`calendar-mime.ts`, `gmail-adapter.ts`). Sending the same MIME over SMTP keeps it, and the REST API
builds its own body.

### The owner's clicks (Azure portal), about an hour

1. Create an **Email Communication Service** resource with its data location set to **Europe**.
2. Add the custom domain on the existing `mail.` subdomain. Azure asks for a verification TXT record,
   an SPF include and two DKIM CNAMEs. **Mailgun's records stay**: the DKIM selectors differ, and the SPF
   record lists both includes during the switch. Whether Azure's check accepts a merged SPF record is open
   question 2 below.
3. Create one **Communication Services** resource per environment (QA and production) and connect the
   domain to each.
4. Create one **Entra application** per environment, give it the «Communication and Email Service Owner»
   role on its resource, create a client secret, and add an **SMTP Username** linked to it.
5. Create one **Event Grid subscription** per environment for `EmailDeliveryReportReceived`. It points at
   that environment's `/api/webhooks/acs` with a long random key in the query string, because Event Grid
   does not sign webhooks the way Mailgun does.
6. Once the domain is verified, **file the quota increase**. Give the race-day peak as the reason.
7. Put the values on each Vercel project: the SMTP username, the secret and the webhook key.
   `.env.local` gets QA's.

### The code: one PR, medium-sized

The provider boundary was built for this. `src/infrastructure/email/adapter.ts` says a new provider is
«a new file next to `mailgun-adapter.ts` and one line in `createEmailSender`». In practice:

| Where | What |
| --- | --- |
| `src/infrastructure/email/acs-adapter.ts` (new) | Sends over `smtp-adapter.ts`'s `createSmtpConnection` with `calendar-mime.ts`'s `composeMime`, the Gmail road's pattern. It maps SMTP replies to `SendResult`: a 4xx or a 429-like refusal is `throttled` with `retryAfter`, a 5xx about the address is `permanent_failure`, and a 5xx about the account is `permanent_failure` with `notTheAddress` |
| `sender.ts` → `createEmailSenderForEnvironment` | Chooses this adapter when its variables are set |
| `adapter.ts` → `EmailTransportName` | Adds the new road beside `"mailgun" \| "gmail"`. If `email_outbox`'s transport column is a PostgreSQL enum, an expand-only migration adds the value (`AGENTS.md` §7.6) |
| `delivery.ts` | The road order (§443, §622): Azure first, Gmail as the spill, and Mailgun kept as a road until it is closed |
| `src/app/api/webhooks/acs/route.ts` (new) | Answers Event Grid's validation handshake, checks the key, and maps `Delivered` / `Bounced` / `Suppressed` / `Failed` / `FilteredSpam` / `Quarantined` onto the outbox row. It reuses `applyMailgunEvent`'s logic in `outbox.ts`, generalised to any provider. The `env:` tag (§670) is not needed, because each environment has its own resource and subscription |
| `notifications/domain/email-plan.ts`, `hourly-pace.ts` | Azure's 30 a minute and 100 an hour, or the raised quota, as a plan the outbox paces against. The «Setări» → «Emailuri» plan select gains it |
| `shared/config/env.ts` | `ACS_SMTP_USERNAME`, `ACS_SMTP_PASSWORD`, `ACS_WEBHOOK_KEY`: optional and validated together, the way the Mailgun variables are |
| Tests | Adapter classification, the webhook (handshake, wrong key, each status) and the env combinations |

About 140 files name Mailgun, most of them in Romanian screen text and comments. **This PR does not
rename them.** The screens keep working, and a wording sweep can come after Mailgun is closed.

### Switch-over and rollback

1. QA in `allowlist` mode: send every message type, including a declaration with its PDF and an
   invitation with its calendar part, and check that the delivery events land on the rows.
2. Production with Azure first and Mailgun still configured, for the two-to-four-week ramp. Mailgun can be
   on Free by then.
3. After a clean month, close Mailgun and remove its DNS records.

**Rollback** at any point: unset the Azure variables and redeploy. The sender falls back to Mailgun, whose
records never left the DNS.

### Open questions to settle on QA

1. **Which id the delivery report carries for SMTP-sent mail.** The outbox must match the event to its
   row. If the report carries only Azure's own operation id and not the `Message-ID`, the adapter must use
   the REST API, with the calendar part as an attachment instead (§672 then needs a decision).
2. **Whether domain verification accepts an SPF record with both includes.** If not, verification and the
   Mailgun cut-off happen on the same day.

## Part 2: the database to Azure Database for PostgreSQL

### What Azure gives (read 2026-11-08)

- **Burstable B1ms:** 1 vCore and 2 GiB, about $15 a month in Germany West Central. That price comes from
  a third-party tracker, so read it in the pricing calculator. Storage starts at 32 GiB and can grow but
  never shrink.
- **35 user connections on B1ms** (50 minus 15 reserved); B2s has 414.
- **The built-in PgBouncer does not run on Burstable.** Today `DATABASE_URL` is Neon's pooled address,
  and PLATFORM § Connections relies on it. On Azure every pool connection is a real one.
- It never scales to zero and never suspends for hours used. A stopped server restarts by itself after
  seven days.
- **Point-in-time restore for 7 to 35 days**, into a new server. That new server does not get the
  original's firewall rules.
- At 95% storage the server becomes read-only; storage autogrow prevents that.
- Someone reported Burstable as unavailable in Germany West Central on some subscriptions. If the portal
  refuses it, use **West Europe**: a few milliseconds farther from Vercel's `fra1`.
- **No migration creates an extension**, so nothing needs Azure's extension allow-list.

### Sizing

**B1ms for both QA and production, and the pool cut to 3 per instance.** Vercel's instances times 3 must
stay under 35. For a registration window, scale production up the way PLATFORM § «Registration day»
surges Neon: change it to B2s beforehand and back afterwards. Each change is a restart of a few minutes.
`max_connections` keeps the value it was provisioned with, so set it by hand after each change (Microsoft's
limits page). Expected total: about $30 to $40 a month for both servers with storage, plus about $1 for
email. That is under a quarter of the grant.

### The owner's clicks (Azure portal)

1. In the grant's subscription, add a **budget** of $160 a month with alerts at 50%, 80% and 100%. That is
   the grant spread over twelve months, and it replaces the role Neon's CU-hour limits play today
   (SETUP §40).
2. Create a resource group in Germany West Central and one flexible server per environment with these
   values:
   - **PostgreSQL major version:** the same as Neon's (`select version()` on each project).
   - **Compute and storage:** B1ms, 32 GiB, storage autogrow on.
   - **Backups:** 14 days retention, not geo-redundant. **High availability:** off.
   - **Network:** public access with a firewall rule from 0.0.0.0 to 255.255.255.255, because Vercel has
     no fixed addresses. Neon is reachable from anywhere today too. `require_secure_transport` stays on.
   - **Credentials:** a generated admin password kept in the club's password manager.
3. Create the database and an **application role** that is not the admin. The app connects as that role.
4. Add Azure Monitor alerts on **storage percent above 80** and on **CPU credits remaining**. A Burstable
   server that runs out of CPU credits is slowed, not stopped.
5. Put the grant's renewal date on `/admin/tasks`.

### The code: one small PR

| Where | What |
| --- | --- |
| `src/db/client.ts` | The pool's `max: 10` becomes a variable (`DATABASE_POOL_MAX`, default 10 so Neon is unchanged), set to 3 on Azure. `statement_timeout` and `idle_in_transaction_session_timeout` stay |
| `shared/config/env.ts` | That variable |
| `.github/workflows/migrate.yml` | Its comment names Neon's direct URL. The secret becomes Azure's URL on port 5432 with `sslmode=require` |
| Docs | The `CLAUDE.md` stack table, PLATFORM (accounts, cost, limit 5, § Connections, § Idle cost), SETUP §33 and §40, the privacy template, a `DECISIONS.md` section and `CHANGELOG.md` |

**What goes quiet by itself:** every Neon reader (`/devs`, `/admin/tasks` → Costuri, the 80% warning on
`/api/health`, and the month's governor in `diagnostics/neon-budget.ts`) is keyed on `NEON_API_KEY`.
Without the key the governor reads «unknown», which behaves as a green month (`budget-level.ts`). So the
move removes `NEON_API_KEY` and `NEON_PROJECT_ID` and needs no code for this. Retiring the Neon panels and
`yarn idle:measure` (Neon-only), and adapting `yarn db:sizes`, comes in a later PR.

### Moving the data, per environment

The database is about 0.04 GB (PLATFORM § (a)), so dump and restore take a minute or two. The window is
for checking.

1. **Freeze.** For production, pick 03:00 Romania time. Pause the external pinger's monitors, and on every
   event open for registration untick «Înscrieri publice deschise» (§906).
2. **Dump** from Neon's *direct*, non-pooled URL, with a `pg_dump` at least as new as the server:
   ```text
   pg_dump --format=custom --no-owner --no-privileges --dbname "$NEON_DIRECT_URL" --file br.dump
   ```
3. **Restore** into Azure as the application role:
   ```text
   pg_restore --no-owner --no-privileges --exit-on-error --dbname "$AZURE_URL" br.dump
   ```
   Drizzle's migration journal travels with the data, so nothing is migrated again.
4. **Check:** `count(*)` matches on every table on both sides, and the journal's last row is the newest
   migration in `src/db/migrations/meta/_journal.json`.
5. **Switch:** set `DATABASE_URL` and `DATABASE_POOL_MAX=3` on the Vercel project and the migrate secret on
   the GitHub environment. Remove the two Neon variables, redeploy, then run `yarn smoke`.
6. **Unfreeze:** tick the events again and resume the monitors. Then walk through one registration, one
   email and the desk.
7. **Keep Neon for 14 days**, untouched and moved to the Free plan so it costs nothing, then delete the
   projects.

**Rollback:** inside the window, put Neon's URL back and redeploy, because Neon was not written to. After
the window, Azure holds newer rows, so rolling back means the same dump and restore in the other direction.

## Part 3: hosting, only if Vercel Hobby does not fit

PLATFORM § (c) decides first: Hobby comes back after two months under 3 Active CPU-hours. Otherwise Pro
stays at $20. Two things would make Azure hosting worth its cost: Hobby not fitting, and the
non-commercial clause biting (the members' shop, sponsors' logos). Azure **Container Apps** would then run
Next.js's standalone build in Germany West Central, with the database on a private network instead of an
open firewall, all inside the grant.

That would cost more than the other parts:

- a Dockerfile and `output: "standalone"`;
- the ISR cache on one replica or a shared store;
- `sharp` in the image;
- a GitHub Actions deploy instead of Vercel's;
- `yarn ship`, `wait-for-migration.mjs` and the release workflows rewritten;
- no preview deployments;
- the Vercel readers on `/devs` retired.

**Not prepared now.** Revisit at the December review with the CPU numbers.

## Part 4: staff sign-in stays on Zitadel

Zitadel Free costs nothing and works. Its limits are 100 daily active users, one administrator and no
custom domain (PLATFORM's table). Microsoft Entra ID's free tier could replace it, but:

- it would change `DECISIONS.md` §26;
- it would re-invite every staff member;
- it would put sign-in behind a tenant tied to the grant;
- it saves nothing.

Reconsider only if Zitadel's single administrator or its missing custom domain becomes a real problem.

## Sources (read 2026-11-08)

- Microsoft for Nonprofits, «Renew your Azure grant»:
  https://learn.microsoft.com/en-us/industry/nonprofit/microsoft-for-nonprofits/renew-azure-grant
- Azure Communication Services, service limits (Email):
  https://learn.microsoft.com/en-us/azure/communication-services/concepts/service-limits
- Azure Communication Services, SMTP authentication:
  https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/send-email-smtp/smtp-authentication
- Azure Communication Services, email pricing:
  https://learn.microsoft.com/en-us/azure/communication-services/concepts/email-pricing
- Azure Database for PostgreSQL, limits:
  https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-limits
- Azure Database for PostgreSQL, PgBouncer:
  https://learn.microsoft.com/en-us/azure/postgresql/connectivity/concepts-pgbouncer
- B1ms price (third-party, indicative): https://www.bytebase.com/dbcost/azure-flexible/instance/B1ms/
- Neon plans (Free: 100 CU-hours and 1 GB per project, 6 hours of restore; page dated 2026-11-04):
  https://neon.com/docs/introduction/plans
