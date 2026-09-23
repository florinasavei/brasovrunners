<!-- Operational runbooks. Each is run once, or rarely. -->

# Runbooks

**Baseline `BR-V1.53-2026-09-23`** · versioned with the whole set · [changelog](../CHANGELOG.md)


| Runbook | When |
| --- | --- |
| [Repository settings](#repository-settings) | When a branch rule or a repository setting is in question |
| [Staff sign-in: Zitadel tenant](#staff-sign-in-zitadel-tenant) | Once per environment, before that environment's staff can sign in for real |
| [Domain binding](#domain-binding) | Once, at the end of M1 before launch |
| [Legal document version](#legal-document-version) | Whenever an approved privacy, terms, or declaration version changes |
| [Deploy a release](#deploy-a-release) | Every merge to `qa`, and every promotion to `main` |


---

## Repository settings

The repository was bootstrapped once (2026-09-02; `DECISIONS.md` §118 keeps the sequence).
What still has to be true, and is checked in Settings when something looks wrong:

- **Branches:** `qa` is the default; `main` is production and accepts the `qa → main` release
  pull request only. Head branches are deleted after merge; squash and merge commits allowed,
  rebase merge off.
- **Rulesets** (`SETUP.md` §4.1, §4.2): on both branches a pull request is required, the
  `docs-check` status (`yarn check`) is required, direct and force pushes and deletion are
  blocked; `main` takes merge commits only. No required approval while there is one
  maintainer — it would make every pull request unmergeable; add it when a second person
  exists.
- **Security:** secret scanning, push protection and Dependabot alerts on (§98).
- **The AI reviewer** reads code, pull requests, checks and logs, nothing else
  (`AGENTS.md` §22). The repository is public, so read access is implicit; were it private, a
  fine-grained token scoped to this repository with `Contents: read` and `Metadata: read`,
  with an expiry, never pasted into a transcript.


---

## Staff sign-in: Zitadel tenant

Run once per environment. Nothing here touches application code — `DECISIONS.md` §26 and
`AGENTS.md` §13.1 are the reasoning; this is the procedure, and it is written to be followed
without reading either.

**Zitadel does not decide who may sign in. `staff_users` does.** Zitadel proves an account is
who it says it is; the allowlist in this application's own database decides whether that account
is staff. An account Zitadel authenticates perfectly is refused if no row invites it. That split
is the whole design, and it is why every refusal below is *our* refusal, not the provider's.

### What exists today

| | |
| --- | --- |
| Instance | `brasov-runners-8iqx8c.eu1.zitadel.cloud` — one instance, both environments |
| Project | **Brasov Runners** — one project, one application per environment |
| QA application | **Brasov Runners QA**, id `389311611728311022`, client `389311611745088238` |
| Production application | **Brasov Runners Production**, id `391132995823612650` |
| Plan | Free. See "What the free tier refuses" below before planning anything on it |

One application per environment, never one shared: the same reasoning `AGENTS.md` §7.3 gives for
two Vercel projects. A shared application means a shared client secret, so rotating it for one
environment breaks the other, and a mistake in QA's redirect list is a mistake in production's.

### Creating an environment's application

Projects → **Brasov Runners** → Applications → **New** → type **Web** → auth method **Basic**.
Then set these, which are identical in both environments:

| Screen | Field | Value |
| --- | --- | --- |
| Settings | Response Types | `Code` |
| Settings | Grant Types | `Authorization Code` |
| Settings | Authentication Method | `Basic` |
| Settings | Refresh Token | unchecked |
| Settings | Use new Login UI | checked |
| Settings | Custom base URL for the new Login UI | **empty** — see below |
| Settings | Back-Channel Logout URI | empty |
| Token Settings | Auth Token Type | `Bearer Token` |
| Token Settings | User roles inside ID Token | unchecked |
| Token Settings | **Include user profile info in the ID Token** | **checked** — see below |
| Token Settings | ClockSkew | `0` |
| Additional Origins | Origins | empty |

And these, which differ:

| | QA | Production |
| --- | --- | --- |
| Development Mode | **on** — only so `http://localhost` is accepted | **off** |
| Redirect URIs | `https://qa.<domain>/api/auth/callback/zitadel`, `https://<the qa provider host>/api/auth/callback/zitadel`, `http://localhost:47821/api/auth/callback/zitadel` | `https://<domain>/api/auth/callback/zitadel`, `https://<the production provider host>/api/auth/callback/zitadel` |
| Post Logout URIs | `https://qa.<domain>`, `https://<the qa provider host>` | `https://<domain>`, `https://<the production provider host>` |

Keep the provider hostname in both lists alongside the club's domain. It is what still works when
DNS has a bad day, and it is the host the smoke check and the scheduler call.

**The redirect URI must match what the application sends, character for character.** Add a new
hostname to a Vercel project and you have created a second redirect URI that Zitadel has never
heard of; sign-in from that host is then refused until it is added. That is one of the two
failures below, and it is the reason the order in § Domain binding matters.

### The two settings that cost an afternoon each

**1. "Include user profile info in the ID Token" — tick it.** Without it the ID token carries no
`email` and no `email_verified`. This application's gate has nothing to match, so it refuses,
and Auth.js shows its own **"Access Denied — You do not have permission to sign in"** page. That
page is identical to the one an uninvited stranger sees, which is deliberate (§19.4: the screen
must not confirm whether an address is staff) and is exactly why the cause is invisible. It has
now cost an afternoon twice, on QA in September and on production the same month. The server log
says `NO_EMAIL_CLAIM` when it happens.

**2. "Custom base URL for the new Login UI" — leave it empty.** It points Zitadel at a
*self-hosted copy of Zitadel's own login application*, not at this site. Empty means Zitadel uses
its hosted login, which is what works. Putting the club's address there sends everyone signing in
to a page that does not exist. To make the sign-in page look like the club, use **Branding** on
the instance or organisation instead — logo, colours, background, free, and it leaves the URL
alone.

### Wiring the environment

Four variables, from the application's own screens. The issuer is the instance, identical
everywhere; it is on the application's **URLs** screen, without a path.

```text
AUTH_ZITADEL_ID      the Client ID from the application header
AUTH_ZITADEL_SECRET  shown once at creation; Actions → Generate new client secret to get another
AUTH_ZITADEL_ISSUER  https://brasov-runners-8iqx8c.eu1.zitadel.cloud
STAFF_AUTH_MODE      provider
```

Set them on that environment's Vercel project. The repository is linked to QA, so production is
addressed through an empty scratch directory rather than by relinking (`SETUP.md` §26):

```bash
npx vercel link --project brasov-runners-production --yes --cwd <empty directory>
npx vercel env add    AUTH_ZITADEL_ID     production --value "<client id>"     --yes --cwd <that directory>
npx vercel env add    AUTH_ZITADEL_SECRET production --value "<client secret>" --yes --cwd <that directory>
npx vercel env add    AUTH_ZITADEL_ISSUER production --value "<issuer>"        --yes --cwd <that directory>
npx vercel env update STAFF_AUTH_MODE     production --value provider          --yes --cwd <that directory>
```

**Order matters.** `src/shared/config/env.ts` refuses to start when `STAFF_AUTH_MODE=provider`
and any of the other three is missing. Setting the mode first does not merely break sign-in — the
next deployment fails to boot, and the whole site is down. Add the three, then the mode.

Variables reach a running application only on a **new deployment**. Before deploying, prove the
combination boots, from the repository root:

```bash
node --import tsx -e "import('./src/shared/config/env').then(({envSchema}) => console.log(envSchema.safeParse({APP_ENV:'production',APP_BASE_URL:'https://example.test',STAFF_AUTH_MODE:'provider',AUTH_SECRET:'x',AUTH_ZITADEL_ID:'x',AUTH_ZITADEL_SECRET:'x',AUTH_ZITADEL_ISSUER:'https://example.test',EMAIL_DELIVERY_MODE:'capture'}).success))"
```

`AUTH_SECRET` is Auth.js's own session secret, not Zitadel's. It is generated per environment and
shared with nothing.

### Zitadel's own emails

Invitations, password resets and verification codes are sent by Zitadel, not by the site, and
from whatever SMTP provider is active on the instance. Since 2026-09-18 that is the club's
Mailgun domain (`SETUP.md` §26 has the values), so a colleague invited from Zitadel gets a mail
from `noreply@mail.<domain>` with the club's reply address. If a new colleague reports "no
invitation arrived": Default Settings → SMTP Provider → the Mailgun provider must be the
**active** one, and Mailgun → Reporting → Logs shows the attempt. Deactivate rather than delete
an old provider; the delete confirmation wants the sender name character for character.

### The first administrator

**Insert the first `staff_users` row by hand.** The screen that invites people sits behind the
sign-in it would be granting, so the first row cannot come from the backoffice. One row, the
address lowercased, role `SUPERADMIN`, `zitadel_subject` and `first_signed_in_at` left null:

```sql
insert into staff_users (email, display_name, role)
values ('<the administrator address>', '<their name>', 'SUPERADMIN');
```

Run it in the Neon console's SQL Editor, against that environment's project. Every later
colleague is invited from `/admin/staff` normally.

### Verifying, without guessing

Each step proves one link in the chain, and they narrow a failure to one cause. Run them in
order against the environment's own host.

```bash
# 1. Is the provider configured in the running build at all?
curl -s https://<host>/api/auth/providers

# 2. Does Zitadel accept the redirect URI the application actually sends?
#    A 302 to the login page means yes. An error page names the mismatch.
CSRF=$(curl -s -c /tmp/j https://<host>/api/auth/csrf | grep -o '"csrfToken":"[^"]*"' | cut -d'"' -f4)
AUTH=$(curl -s -b /tmp/j -o /dev/null -w '%{redirect_url}' -X POST -d "csrfToken=$CSRF" https://<host>/api/auth/signin/zitadel)
echo "$AUTH"; curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "$AUTH"

# 3. Is the client secret right? invalid_grant/Code.Invalid = yes, the code was fake.
#    invalid_client = the secret is wrong.
curl -s -u "<client id>:<client secret>" \
  -d "grant_type=authorization_code&code=deliberately-invalid&redirect_uri=https://<host>/api/auth/callback/zitadel" \
  https://brasov-runners-8iqx8c.eu1.zitadel.cloud/oauth/v2/token
```

Then sign in for real, and confirm it bound rather than trusting the screen: the row must now
carry a `zitadel_subject` and a `first_signed_in_at`. Both fill together or neither does — a
CHECK constraint enforces it.

```sql
select email, role, zitadel_subject is not null as bound, first_signed_in_at from staff_users;
```

### Diagnosing "Access Denied"

That page is **Auth.js's, not Zitadel's**. It means Zitadel authenticated the account and this
application's gate refused the result. The screen says nothing more, on purpose. The server log
names which of four:

| Logged | Means | Fix |
| --- | --- | --- |
| `NO_EMAIL_CLAIM` | The token has no `email` | Tick "Include user profile info in the ID Token" |
| `EMAIL_NOT_VERIFIED` | The Zitadel user's address is unverified | Verify it in Zitadel → Users |
| `NOT_INVITED` | No `staff_users` row for that address | Insert it, or invite from `/admin/staff` |
| `EMAIL_BOUND_ELSEWHERE` | The row is already bound to a different Zitadel subject | Deliberate: one row, one account |

`npx vercel logs https://<host> --cwd <the linked directory>` reads them.

If the failure happens *before* the login page, it is Zitadel's own error and the cause is in
step 2 or 3 above — a redirect URI or the client secret, not the allowlist.

### What the free tier refuses

Checked 2026-09-17 on zitadel.com/pricing. These are limits, not warnings:

- **Zero custom domains.** Sign-in stays on `brasov-runners-8iqx8c.eu1.zitadel.cloud`. A
  `login.<domain>` needs the **PRO tier at US$100/month** — roughly a hundred times this club's
  entire running cost, for a hostname a volunteer reads for two seconds. It also buys a second
  domain migration every time the club changes domain, since the redirect URIs would follow.
  Decided against; **Branding** gives the club's look for nothing.
- **One administrator.** One person can administer identity. A second needs the paid tier. This
  is the club's real succession risk, not the domain: `BR-BUS-101` requires that no single
  person be the only one able to recover the platform, and today one person is. Recovery for
  Zitadel therefore rests on that account's own recovery, which must be in the password manager.
- **100 daily active users.** Irrelevant at three to five staff, and it counts staff only —
  participants never sign in at all (§10.3).
- **One instance, one day of audit trail.** The audit trail this product relies on is its own
  `audit_logs` table, not Zitadel's, so the one-day retention costs nothing here.

If the free tier ever stops fitting, the alternative recorded in `DECISIONS.md` is Auth.js
against Google or Microsoft directly — free, and natural if the club's nonprofit application
lands and staff already hold club accounts (§56).

### Rollback

Set `STAFF_AUTH_MODE=disabled` and redeploy. The backoffice answers 404 to every staff request —
the same honest state it was in before the application existed. No `staff_users` row is touched,
and no Zitadel configuration needs undoing.

## Domain binding

Run once, at the end of M1, before launch. Nothing here touches application code. If any step requires
a code change, something violated the rule in `AGENTS.md` §8 that `APP_BASE_URL` is the
single source of every absolute URL.

Related: `SETUP.md` §26 holds the hostname table. `BR-REQ-101-02` is the acceptance
criteria for this runbook.

### Prerequisites

- [ ] Domain registered and owned by the Brașov Runners account, not a personal one.
- [ ] DNS management location decided, and access recorded in the password manager.
- [ ] Both Vercel projects running on their default hostnames with green health checks.
- [ ] Two recovery-capable owners have access to the registrar.

### The scriptable half

Most of the binding is one command, so the day the domain exists is a paste of DNS records rather
than an afternoon across five consoles:

```bash
yarn domain:bind production <domain>                                      # dry run: prints what it would change
yarn domain:bind production <domain> --apply                              # canonical: apex + www, www → apex (308), APP_BASE_URL
yarn domain:bind production <second-domain> --alias-of <domain> --apply   # a second domain: apex + www → the canonical (308)
yarn domain:bind qa qa.<domain> --apply                                   # QA, when wanted — see step 1
```

It adds the hostnames to that environment's own Vercel project, sets each redirect on the host,
sets `APP_BASE_URL` for a canonical domain — the single source of every absolute URL the
application emits (`AGENTS.md` §8), which is why nothing else needs editing — and prints the DNS
records to create and the consoles it deliberately does not touch. An alias changes no variable.
It does not redeploy: `APP_BASE_URL` reaches a running application only on a new deployment, and
when that happens is the operator's call.

Needs `npx vercel login` once; every call goes through `vercel api`, so the token the CLI holds is
the token used (`SETUP.md` §26 says why the CLI's credentials file is not read directly). Vercel's
API documents a 400 for a project whose latest production deployment failed; a project with no
deployment at all accepted the club's domain on 2026-09-16. The checklist below is still the
record of what was done, and the steps the script prints are the same ones.

### Step 1 — QA first

Optional. QA works on its provider hostname indefinitely; moving it to `qa.<domain>` rehearses
step 3 but is not a prerequisite for it. If you do it, add the Zitadel redirect URI for the new
host *before* the redeploy that carries the new `APP_BASE_URL`, or QA sign-in is refused until you
do.

- [ ] Add `qa.<domain>` to the QA application and let the provider issue the certificate.
- [ ] Create the DNS record the provider's domain screen asks for. Do not guess the record
      type; use what the screen shows.
- [ ] Set `APP_BASE_URL=https://qa.<domain>` in the QA application environment and restart.
- [ ] Staff authentication QA: add the new callback and post-logout URLs and the new allowed origin. Auth.js derives these from `APP_BASE_URL`, so this is a configuration change and not a provider one.
      Keep the old entries until step 4.
- [ ] Verify HTTPS resolves and `/api/health` responds.
- [ ] Verify staff login completes end to end.
- [ ] Verify `robots.txt` and the `X-Robots-Tag` header still say `noindex, nofollow`.
- [ ] Send one test registration and confirm the email link points at the new host and works.

### Step 2 — Email

- [x] Add the sending domain in Mailgun and create the SPF, DKIM, and tracking records —
      done 2026-09-18, `mail.<domain>` (`SETUP.md` §26 has the records and the 255-character
      trap).
- [x] Wait for verification — minutes, once the DKIM record was whole.
- [x] Point the Mailgun webhook at the production host — four events, domain-level; the
      signing key is on the production project. A second webhook points at QA.
- [ ] Confirm the production sender name and address match what the club approved
      (`BUSINESS.md` §9).
- [ ] **If the club also wants mailboxes on the domain** — the provider is not chosen yet: a
      nonprofit grant from Google or Microsoft, or Zoho Mail as the fallback (`SETUP.md` §26) —
      split the domain by function so the two never share an MX or an SPF record: the mailbox
      provider takes the apex — its MX, its SPF include, its DKIM — and Mailgun takes a subdomain, `mail.<domain>`, as
      the sending domain. `MAILGUN_DOMAIN` and `EMAIL_FROM_ADDRESS` then carry the subdomain
      (`noreply@mail.<domain>`, so DKIM aligns), and `EMAIL_REPLY_TO` points at the club mailbox
      people should answer to. Configuration only; nothing under `src/` changes.

### Step 3 — Production

- [ ] Add the apex and `www` to the production application and issue certificates.
- [ ] Create the apex and `www` DNS records.
- [ ] Set `APP_BASE_URL=https://<domain>` in the production application and restart.
- [ ] The `www` to apex redirect exists — `yarn domain:bind` sets it on the host when it adds the
      apex; confirm with `curl -sI https://www.<domain>`, which answers 308 to the apex.
- [ ] Staff authentication production: the same callback, post-logout and origin entries, derived from `APP_BASE_URL`.

### Switching the canonical domain

Run once, on the day the club moves from one of its domains to the other — `.com` to `.ro`, or
back (`DECISIONS.md` §55). Everything needed is here; nothing below requires reading another
document, and **no application code changes**. If a step here turns out to need a code change,
something has violated `AGENTS.md` §8.

#### What follows automatically, and why

`APP_BASE_URL` is the single source of every absolute URL this application emits (§8), so moving
it moves all of these at once, on the next deployment:

- canonical tags, `hreflang` alternates and Open Graph URLs;
- `sitemap.xml` and `robots.txt`;
- every email action link — built when the message is rendered, not when it is queued, so even
  messages already waiting in the outbox go out with the new host;
- the authentication callback and the Mailgun webhook URL.

Two more things cost nothing by design. **Cookies are host-only** — no `domain` attribute — so the
old host's cookies simply stop being sent; the only effect is that each staff member signs in once
more, and participants hold no session at all. And **the identity provider's own hostname is not
the club's**, so it does not move: the sign-in page keeps the address it has, and only the list of
URIs it accepts changes. That is a direct consequence of staying on the provider's free tier
(`docs/PLATFORM.md`, limit 4); a custom identity domain would add a second domain migration to
every switch.

#### The two commands

```bash
# 1. The new canonical: its apex serves the site, its www redirects to the apex, APP_BASE_URL moves.
yarn domain:bind production <new-domain>            # dry run first — prints exactly what it will change
yarn domain:bind production <new-domain> --apply

# 2. The old one becomes a permanent redirect, so every link ever shared keeps working.
yarn domain:bind production <old-domain> --alias-of <new-domain> --apply
```

Both print the DNS records to create at the registrar. The script never redeploys: `APP_BASE_URL`
reaches a running application only on a new deployment, and choosing when is the operator's call.

QA is the same two commands with `qa` and the QA hostnames, and is worth doing first: it rehearses
the whole thing on a site nobody is reading.

#### What does not follow automatically

- [ ] **Identity provider redirect URIs.** Add `https://<new-domain>/api/auth/callback/zitadel`
      and the post-logout URI `https://<new-domain>` **before** the redeploy, or the first person
      to sign in afterwards is refused. Keep the old entries until sign-in is proven on the new
      host, then remove them.
- [ ] **`PRODUCTION_SITE_URL` in the qa project**, which is what the "this is not the real site"
      banner links to. It is the only variable that names the real site from somewhere else, so
      nothing else corrects it: miss it and QA keeps sending visitors to the domain you just left.
- [ ] **The Mailgun sending domain may stay where it is.** DKIM aligns with the `From` address,
      not with the site's host, so mail sent from a subdomain of the old name keeps delivering
      from the new site. Move it only if the club wants the address to match the site — and if it
      does, that is a fresh domain verification with its own SPF and DKIM records and its own
      propagation wait, so start it days ahead, not on the day.
- [ ] **Search Console**: add the new host as a property and submit its sitemap. Keep the old
      property — it is what reports that the redirect is being followed.
- [ ] **Anything printed.** A race number, a flyer or a shirt carries whichever address was
      current when it went to print, and a redirect cannot fix a QR code somebody photographs in
      a year. This is the reason to decide the final domain before the first print run rather
      than after.

#### Verify

```bash
yarn smoke https://<new-domain>
curl -sI https://<old-domain>            # 308, pointing at the new apex
curl -sI https://www.<new-domain>        # 308, pointing at the new apex
curl -s https://<new-domain>/sitemap.xml | head -5   # every URL is the new host
```

Then sign in as a member of staff, end to end, and send one test registration to confirm the email
link points at the new host and works.

#### Rollback

Run the two commands the other way round and redeploy. Certificates and DNS records for both names
can stay in place — holding two domains is the normal state here, and which one is canonical is
one variable and two redirects.

### Step 4 — Canonical cleanup

- [ ] Confirm canonical tags, `hreflang` alternates, `sitemap.xml`, `robots.txt`, and Open
      Graph URLs all render the new host. Any that do not indicate a literal escaped the
      configuration rule.
- [ ] Confirm production allows indexing and QA still does not.
- [ ] Confirm runner profile pages still carry `noindex, nofollow` and are absent from the
      sitemap.
- [ ] Remove the provider default hostnames from every allowlist.
- [ ] Decide whether the default hostnames stay reachable. Recommended: no, otherwise they
      are duplicate content.
- [ ] Submit the production sitemap to Search Console.

### Step 5 — Records

- [ ] Update the `SETUP.md` §26 hostname table to the final values and remove the current
      hostname column.
- [ ] Note the binding date and the DNS location in `DECISIONS.md`.
- [ ] Add the domain renewal date and owner to the operations handover in `SETUP.md` §30.

### Rollback

Set `APP_BASE_URL` back to the provider default hostname and restart. Certificates and DNS
records can stay in place. Because no application code references the domain, nothing else
needs undoing.


---

## Deploy a release

Every merge to `qa` and every promotion to `main`. Short, because the parts that used to be
remembered are now enforced — but read the ordering rule once, because it is the only part a
person still has to get right.

Related: `AGENTS.md` §6.3, §6.4, §7.6; `DECISIONS.md` §31.

### The rule that prevents the incident

A push to `qa` starts the Vercel build and the migration workflow at the same moment. Two things
keep the deployed code and the schema from ever disagreeing (`DECISIONS.md` §62):

1. **The build waits for the migration.** `scripts/wait-for-migration.mjs` is the first step of
   `yarn build`: on a production deployment it polls the environment's database until the
   migration the build was compiled against is applied, then builds. New code never goes live
   against an old schema. It applies nothing itself. If the migration never comes — it failed,
   or on production nobody approved it — the build fails after `MIGRATION_WAIT_MINUTES` (20)
   and the previous deployment keeps serving.
2. **Expand and contract never share a migration**, and `yarn migrations:check` refuses one that
   does. While the migration runs and until the new build is live, the *old* code is serving, and
   a drop it still reads breaks it for exactly that long — which is what happened on 2026-09-17.

| The migration | Ships |
| --- | --- |
| Adds a column, table, index, value or constraint, or backfills | In the same release as the code that uses it |
| Drops, renames, changes a type, or makes an existing column NOT NULL | In the release **after** the code that stopped using it, as its own migration, with a `-- contract:` line naming that release |

That is `AGENTS.md` §7.6's expand/contract rule, stated as the thing you actually decide, and the
check is what makes deciding it wrong impossible to merge.

### Deploying to QA

1. **Merge the pull request into `qa`.** That is the whole of it. If the change touched
   `src/db/migrations/**`, `.github/workflows/migrate.yml` applies it to the QA database, and
   the Vercel build waits for it before building, so the new code goes live only once the
   schema is there.
2. **Watch the migrate run** if there was one. It prints the target host, the pending
   migrations, and the head it finished on. A failure exits non-zero, the run is red, and the
   build fails twenty minutes later with a message naming the migration — the previous
   deployment keeps serving throughout.
3. **Smoke it.** The workflow does this automatically where the environment has an
   `APP_BASE_URL` secret; do it by hand otherwise:

   ```bash
   yarn smoke https://<the QA hostname from SETUP.md §26>
   ```

   `ok` is what you want. `degraded` immediately after a deploy is normal — the scheduled jobs
   tick every five minutes and report as stale until the first one lands. Anything else, read
   the report: it names which of the database, the schema and the jobs is unhappy.
4. **If the schema is behind**, the smoke output says so and names the migration. It should no
   longer happen — the build waits — but a migration applied by hand to the wrong database
   would produce it. Run the migrate workflow for `qa` from the Actions tab, then redeploy.

### Deploying to production

Everything above, plus the gate. `AGENTS.md` §6.4 is the promotion flow; this is the database
half of it.

1. **Confirm QA has accepted the change**, including the migration.
2. **Open the `qa → main` release PR.** Review the complete diff *and the migration plan* — the
   pending list the QA run printed is that plan.
3. **Merge with a merge commit.** Do not squash: §6.4 preserves ancestry.
4. **Approve the migrate run in the Actions tab** if the release carries a migration: the push
   to `main` starts it, the `production` environment holds it for its required reviewer, and
   the Vercel build is waiting for it. Approve within twenty minutes; the build then proceeds by
   itself. Miss the window and the build fails, the old deployment keeps serving, and a
   redeploy from the Vercel dashboard (or an empty commit) after the run is green finishes it.
5. **Smoke production**, and this time without `--allow-degraded` once the schedulers have had a
   tick.

### The first production deployment

Done on 2026-09-17 (`qa → main` #45, `BR-V1.34`) and again on 2026-09-18 (#47, `BR-V1.35`),
in the order § Deploying to production keeps. Two things it added, once: the first
Administrator's `staff_users` row by hand (§ Staff sign-in — there is no other way in), and
the scheduler's two repository secrets (`SETUP.md` §26) with the pinger monitors. What #47
taught: the build waits at most twenty minutes for the migration run to be approved; approved
later, the failed build is redeployed by hand (`vercel redeploy <deployment>`) and nothing was
lost — the previous deployment served throughout.


### Applying a migration by hand

For a one-off — a new environment, a database being repaired — the same script the workflow runs:

```powershell
$env:DATABASE_URL_QA = "<that environment's direct connection string>"
yarn db:migrate:env qa
Remove-Item Env:\DATABASE_URL_QA
```

It prints what it will do before it does it. `production` additionally requires `--yes`.

### What must never happen

- Migrating from the Vercel build command or from application startup (`AGENTS.md` §7.6). A
  destructive migration must never run because somebody requested a page. The build *waits*
  for a migration (`scripts/wait-for-migration.mjs`); it never applies one.
- A drop shipped in the same release as the code change that made it possible.
- A deployment finished without a smoke check. "The build went green" is not "the site works".
- `yarn db:seed` against a deployed database: it deletes every event and translation before
  re-seeding. Use `yarn db:seed:legal` for the sample legal documents alone.


---

## Email has stopped

The monitor mail from cron-job.org says `/api/health` failed, or `/admin/tasks` is red at the
top (`DECISIONS.md` §98). Three causes, told apart by the same page:

1. **Deferred by the allowance** — Mailgun Free's 100 messages a day are spent. Nothing is
   lost; the queue resumes at the time the alert names (the UTC reset, five minutes past).
   If it is registration day and people are waiting for confirmations: Mailgun → Billing →
   Basic removes the daily limit the moment it is paid; then `/admin/emails` → "The Mailgun
   plan" → Basic → save, so the counters and "Trimite acum" stop counting against a hundred
   (`DECISIONS.md` §100); the next scheduler tick — or "Trimite acum" — sends everything. When
   the month is over and the plan is cancelled, set it back to Free there. `docs/PLATFORM.md`
   has the price.
2. **Overdue** — messages waited more than ninety minutes for a scheduler. cron-job.org →
   the two job monitors: paused, disabled after failures, or the `JOB_SECRET` changed. Run
   `yarn smoke` on the environment; `jobs[].status` names which one is stale. Pressing
   "Trimite acum" on `/admin/registrations` drains the outbox by hand meanwhile.
3. **Failed** — Mailgun refused six times. The alert carries the last reason. A `401` is the
   `MAILGUN_API_KEY`; a `404` is the domain or the API base (`SETUP.md` §35: EU domains
   answer at `api.eu.mailgun.net`); "not allowed to send" is the account under review — open
   Mailgun → Sending → Logs. A failed message is not retried; once the cause is fixed, resend
   it from the registration's page (`/admin/registrations/<id>` → Retrimite).

The health page answers 200 again on its own once no row is deferred, overdue or failed in
the last seven days; a failed row that is not resent keeps the alert up for those seven days,
which is deliberate — it is the one the club still owes somebody.

## Legal document version

Applies to the privacy notice, the terms, and the event declaration. All three share the
`legal_documents` mechanism described in `AGENTS.md` §12.5. The backoffice drafts, edits and approves versions
(`DECISIONS.md` §46, §53, §57), and an approved version's page offers *the next version from this
one*, prefilled. This runbook is the other path — text arriving as a migration — which production's
first approved version may still use while no Administrator can sign in there.

Related requirement: `BR-REQ-053-01`.

### Who does what

| Step | Who |
| --- | --- |
| Provides the approved wording in Romanian and English | Club, or its legal adviser |
| Records the approval | Administrator |
| Prepares the migration or seed | Developer |
| Verifies the result in QA and production | Administrator |

An AI agent may draft the platform's templates (`src/modules/legal-documents/templates/`,
`DECISIONS.md` §95), format approved text and prepare the migration. It never marks a text
approved and never fills in a club fact; the club reads and approves.

### The shortest path: one press (2026-09-19, `DECISIONS.md` §132)

`/admin/legal` as a Superadministrator: the box "Într-un pas" lists the club's legal name,
CIF, seat and contact email as the deployment holds them (`CLUB_LEGAL_NAME`,
`CLUB_REGISTRATION_NUMBER`, `CLUB_REGISTERED_ADDRESS`, `EMAIL_REPLY_TO`). Check them, press
"Aprobă cele trei texte acum": version 1 of the privacy notice, the terms and the declaration
is created from the platform's text with those facts written in and approved in your name.
A document that already has an approved version is not touched. A missing variable shows in
red and the button is withheld — set it in Vercel, redeploy, come back.

### The short path: start from the platform's text (2026-09-18)

`/admin/legal` → "Versiune nouă" → the link for the document under "or start from the
platform's text". The draft is prefilled with the complete text in both languages; fill the
four facts in angle brackets (legal name, registered address, registration number, contact
email), read it, save, open the PDF, approve. The declaration's text carries tokens —
`{{participant}}`, `{{idDocument}}`, `{{event}}`, `{{eventDate}}`, `{{eventLocation}}`,
`{{signedAt}}` — that are filled per person and per event; leave them as they are.

### After a race: the declarations and the export

On the event page: "Declarațiile semnate (PDF)" — every signed declaration, one per page — and
"Export CSV" on the registrations list (first name, last name, identity document among the
columns). Keep both in the club's own archive with restricted access; they carry names and
identity documents. The platform keeps the rows three years from the event and then removes
them; the PDF can be regenerated at any time until then. Each participant already holds their
own copy, sent by email at signing. With `DECLARATIONS_ARCHIVE_TO` set to the club's mailbox
(`SETUP.md` §35), the club's copy arrives there at signing too, one email per declaration,
subject "Declarație semnată: <name> — <event>" — the archive builds itself (`DECISIONS.md` §99).

### Sample versions, and why the first approved one is not version 1

Every environment except production is seeded with a clearly marked **sample** version of all
three keys (`src/db/seeds/sample-legal-documents.ts`, `DECISIONS.md` §29): complete in structure,
every club-specific fact a visible `<PLACEHOLDER>`, and a not-approved banner as the first section
of each rendered page. Production is refused outright — the seed throws rather than skipping — so
production carries nothing until this runbook is followed there.

That means the club's first *approved* version is version 2 in an environment that already carries
a sample, and version 1 in production. Version numbers are per key and per database, never reused,
and step 1 below is where you find out which one to use. Do not delete the sample version to
"start at 1": a version an acceptance references is immutable (§12.5), and QA will have
acceptances against it.

### Before you start

- [ ] The wording is approved by a named person, with the date recorded.
- [ ] Both Romanian and English bodies exist. A missing locale blocks publication for that
      locale.
- [ ] For a declaration, confirm which events will reference the new version. Existing
      acceptances keep the version they accepted.

### Procedure

1. **Choose the key and version.** `PRIVACY_NOTICE`, `TERMS`, or `EVENT_DECLARATION`, with
   the next integer version for that key *in the database you are applying to* — which differs
   between production and an environment carrying a sample. Versions are never reused.
2. **Convert the approved text to Tiptap JSON** using the allowlisted schema. Do not paste
   arbitrary HTML.
3. **Compute `content_sha256`** as the deterministic hash over the canonical serialized
   JSON, using the same function the application uses. Do not compute it by hand.
4. **Write the migration or seed** inserting one `legal_documents` row and one
   `legal_document_translations` row per locale.
5. **Set `effective_at`** to the moment the version becomes current. Set `is_approved` and
   `approved_by_staff_user_id` from the recorded approval.
6. **Apply in QA first.** Verify the public legal route renders the new version in both
   locales, and that a new registration stores the new privacy-notice version.
7. **For a declaration**, repoint the intended events at the new
   `declaration_document_id`. Do not repoint an event whose registration is already open
   unless the club has decided to, because participants would then see different versions
   for the same event.
8. **Apply in production** through the normal gated migration path.

### Verification

- [ ] The public legal routes render the new version in both locales.
- [ ] The previous version is unchanged and still resolvable for existing acceptances.
- [ ] `content_sha256` matches a recomputation from the stored JSON.
- [ ] A new registration records the new privacy-notice version.
- [ ] An existing accepted declaration still references its original version and hash.
- [ ] No staff role can edit either version through any interface. The event editor's declaration
      field selects among approved versions and writes none of them.
- [ ] For a declaration, every event that should use it points at the new
      `declaration_document_id` — set from the event editor, not by hand.

### What must never happen

- Editing a version that a participant has already accepted.
- Publishing a version with only one locale present when both are required.
- Marking a declaration as accepted on a participant's behalf.
- Describing the acceptance as a qualified electronic signature.
