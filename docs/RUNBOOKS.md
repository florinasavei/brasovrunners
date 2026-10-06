<!-- Operational runbooks. Each is run once, or rarely. -->

# Runbooks

**Baseline `BR-V2.72-2026-10-06`** · versioned with the whole set · [changelog](../CHANGELOG.md)


| Runbook | When |
| --- | --- |
| [Repository settings](#repository-settings) | When a branch rule or a repository setting is in question |
| [Staff sign-in: Zitadel tenant](#staff-sign-in-zitadel-tenant) | Once per environment, before that environment's staff can sign in for real |
| [Domain binding](#domain-binding) | Once, at the end of M1 before launch |
| [Legal document version](#legal-document-version) | Whenever an approved privacy, terms, or declaration version changes |
| [Deploy a release](#deploy-a-release) | Every merge to `qa`, and every promotion to `main` |
| [Release from the phone](#release-from-the-phone) | A release with the PC off — the owner on holiday, GitHub's app in hand |
| [The domain stops answering](#the-domain-stops-answering) | The site, the backoffice and QA «cannot be found» at once; the monitor on the public name is red |


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

## Release from the phone

(«Release de pe telefon».) The PC is off; a change was made in a Claude Code on the web session
or by a cloud agent, and its pull request into `qa` is open. `.github/workflows/release.yml`
lands it and ships it to production, the same steps `docs/DISPATCHER.md` § Land a batch and
§ Ship do on the PC (`DECISIONS.md` §535). Set up once: `SETUP.md` § 41 — the `SHIP_TOKEN`
secret, the `SHIP_PRODUCTION_URL` variable, the `ship` label, and one dry run.

### Before the press: the pull request carries its release entry

The branch must hold one `.release/<branch-slug>.json` (`.release/README.md`: the § title and
text, the CHANGELOG bullet, the SPECS criteria) and write its own README, SETUP or docs text —
the phone's release refuses an entry that leaves `docsNotes` for a person. The pull request's
`docs-check` run already checks the entry: a red `docs-check` names what is wrong in it. A branch
with no entry is refused ("Nothing to release"); a branch already landed by hand (its CLAUDE.md
carries a newer baseline than `qa`'s) ships as it is.

### The first time: a dry run

1. GitHub app → the repository → **Actions** → **release** → **Run workflow**.
2. **pr**: the pull request's number. **baseline**: leave empty (the next `BR-V2.NN` after
   `qa`'s) or type one, like `BR-V2.18`. Tick **dry_run**. → **Run workflow**.
3. Open the run → **Summary**: the steps, the landing commit, the files it would change and the
   documents' diff. Nothing was pushed or shipped.

### Every release: the label

1. GitHub app → the pull request → **Labels** → tick **ship**.
2. The run starts (**Actions** → **release**). It merges `qa` in, lands the entry as one commit
   pushed to the branch, then runs `yarn ship`: the pull request's checks on the landed tree, the
   merge into `qa`, `qa`'s run, the `qa → main` release PR, the production migration approved,
   and production's `/api/health` reporting the new baseline. About an hour.
3. It ends with a comment on the pull request: "Released BR-V2.NN…" or "The release stopped",
   followed, when ship itself stopped, by ship's reason. The run's **Summary** page says, in a
   table, each step's outcome and ship's minutes. The comment and the label's removal are made
   with the run's own token, so a stopped release loses its label and the label can be ticked
   again (`DECISIONS.md` §658) — a run started by hand under **Actions** has no label to remove.

While ship waits for production — first for the baseline production runs, at the end for the new
one — its log says what production answers every two minutes, one of three lines:

- **«no answer for 12 min: TypeError fetch failed — ENOTFOUND …: a name or network failure»** —
  production does not answer at all: its name does not resolve, the connection is refused, or the
  certificate fails. It is not the release: follow § The domain stops answering.
- **«production answers with BR-V2.64-…; waiting for BR-V2.65-…»** — the site is up and runs
  another build. At the end of a release that means the new deployment is slow or failed: open
  Vercel → the production project → **Deployments** and look at the newest one.
- **«production answers but its body carries no baseline»** — something answers that is not the
  application: a parking or hold page, a proxy's error, an empty body. Treat it like no answer.

After an hour (at the start) or twenty minutes (at the end) ship stops with the same words after
«STOP:»; the comment on the pull request carries them too.

If the pull request shows **«This branch has conflicts»**, the label starts nothing — GitHub runs
no `pull_request` workflow while a branch cannot merge into its base, and no run, no summary and
no comment appear. Use **Actions** → **release** → **Run workflow** → the PR's number instead
(dry run off): a run by hand starts regardless, and its first step merges `qa` in by rule.

One release runs at a time, and one more can wait for it; a newer request replaces the one
waiting (GitHub keeps one pending run, the newest) — so release one pull request, then label the
next. A running release is never cancelled by a new request. Only a person with write access can
start one; anyone else's label stops at the first step.

### When it stops

The run's **Summary** says where, in words:

- **Nothing happened at all** after ticking **ship** — no run under **Actions**, no comment: the
  pull request has a merge conflict with `qa` («This branch has conflicts»). Run **release** by
  hand with its number; the merge step resolves the journal, the catalogues and the tests by rule
  and names anything else.
- **A batch's `yarn batch:merge` stopped on README.md, SETUP.md or CLAUDE.md**: two branches
  wrote the same lines of documentation — each branch writes its own index row, section or command
  line, and no rule merges prose, so the stop is by design (`docs/DISPATCHER.md` § Cloud loop).
  A Claude Code on the web session: "resolve the conflict in <file>, keep both sides' lines,
  commit, and run yarn batch:merge again"; then push and tick **ship**.
- **"qa has no scripts/merge-branches.mjs yet"**: the release tooling is not in `qa` yet — this
  one release goes from the PC (`docs/DISPATCHER.md` § Ship).
- **"Set once in … Secrets and variables"** or **"GitHub refused to say what … may do"**: the
  token or the variable is missing or expired — `SETUP.md` § 41.
- **"Bringing the branch up to date with qa stopped"**: a merge conflict no rule resolves (the
  files are named), two branches that took the same migration number, a migration production or
  QA already applied that the merge would move, or a typecheck that fails after the merge. Fix it
  on the branch — a Claude Code on the web session: "merge origin/qa into this branch and fix" —
  then tick **ship** again (the label came off at the stop).
- **"The landing stopped"**: the entry is incomplete, leaves `docsNotes`, names a requirement
  SPECS.md does not have, or a decision placeholder no branch wrote. Fix the entry on the branch
  and tick **ship** again.
- **"docs:check refused the landed tree"**: usually a new file without its README row — add it
  on the branch.
- A stop inside **Ship** before the `qa → main` release merged (a red check, the `qa` run, the
  release PR's checks): the table's last line names the step. If the pull request already merged
  into `qa`, running **release** again with its number continues from there — a merged pull
  request ships `qa` as it is.
- **"production never reported …"** (at the start, step 1): nothing has merged yet. The words
  after it say which case (above, under § Every release): no answer → § The domain stops
  answering; another build → Vercel's production deployment. Once production answers with the
  baseline `main` carries, tick **ship** again — the label came off at the stop.
- **A stop after the `qa → main` release merged** — the migration's or production's; the table
  lists the step «migration», and the comment says «The release is already in main»
  (`DECISIONS.md` §658). **Never tick ship again, nor run release again**: a second run takes its
  starting baseline from `main`, which is now the new one, waits an hour for a baseline production
  does not run, and stops with a second «The release stopped» for a release that went out. Instead:
  - **the migration** («no migrate.yml run appeared», «was still … after an hour», «ended
    failure; production still runs the previous build»): the summary names the run. Fix the
    migration, or approve and re-run **migrate** on `main` by hand (Actions → the run → **Review
    deployments** / **Re-run jobs**); then, if production's build gave up waiting for the
    migration, open Vercel → the production project → **Deployments** and redeploy the newest;
  - **"production did not report … in time"** (step 7): no answer → § The domain stops
    answering; another build → open Vercel → the production project → **Deployments**, fix the
    newest deployment or redeploy it.

  Either way the release is done once `/api/health` reports the new baseline.

Never push to `qa` or `main` by hand from the phone: the release PR and the production migration
are the run's to open, merge and approve.

## The domain stops answering

(«Domeniul nu mai răspunde».) The club's name does not resolve, or does not reach Vercel, while
the deployments behind it run on: the database, the outbox and the functions are fine, nobody can
find them by name (`DECISIONS.md` §659). The names are in `SETUP.md` §26's table; below, `<domain>`
is the club's `.com` and every time is UTC. The setup that keeps such an hour cheap — the contact
mailbox, the renewal, the monitors on the address no registrar can hold — is `SETUP.md` §26 and
§40.

### What it looks like

- **A browser says the server cannot be found** (`DNS_PROBE_FINISHED_NXDOMAIN` in Chrome, «Server
  Not Found» elsewhere) for the public site, the backoffice and QA at once: the apex, `www`, `qa.`
  and the `mail.` subdomain are one zone, and they go together. Mail from `mail.` fails its SPF and
  DKIM checks at the receiving end, and every link in an email names the dead host.
- **Not everybody sees it at once.** A phone or a network whose resolver cached the name keeps
  showing the site for up to two days (the `.com` delegation's cache), while new visitors see
  nothing; after the fix, a resolver that cached the «no such name» keeps it for up to fifteen
  minutes. One person who sees the site proves nothing, either way.
- **cron-job.org emails** a failed «brasovrunners PROD health» (and «QA health»): the monitors on
  the public name. The monitors on the `vercel.app` addresses stay green (`SETUP.md` §40) — that
  pair, one red and one green, is this runbook's case.
- **Ship's wait** prints «no answer for N min: TypeError fetch failed — ENOTFOUND …: a name or
  network failure», or «production answers but its body carries no baseline» when the registrar
  serves a hold or parking page in the site's place (§ Release from the phone).

### Two minutes from a phone

1. **Is the site alive?** Open `https://brasov-runners-production.vercel.app/api/health` —
   production's own `vercel.app` address, which no registrar can hold (QA's:
   `https://brasov-runners-qa-nu.vercel.app/api/health`). It answers with a `build` and a
   baseline → the site is alive and **the name is the problem**: go on. It does not answer either
   → not this runbook: Vercel's status page and production's deployments (§ Deploy a release).
2. **Is the name in the registry?** dnschecker.org → `<domain>` (the apex) → type **A** →
   **Search**.
   - **Red everywhere** → the name is gone from the registry: the registrar. Causes 1–3 below,
     in that order.
   - **Red in places, green in others** → propagation: records or nameservers changed in the last
     hours, or a hold lifted minutes ago. Recheck in fifteen minutes; if nobody changed anything
     and nothing was lifted, read it as red everywhere.
   - **Green everywhere**, with the address in `SETUP.md` §26's table → the name is fine and what
     fails is your own network's cache: switch the phone to mobile data, or wait fifteen minutes.
     Green everywhere and still nothing on mobile data → cause 6, Vercel.
3. **Since when, and do the jobs run?** cron-job.org → each job → **History**. The health monitor
   on the public name dates the start to the hour. The job pings and the `vercel.app` health
   monitor green → the jobs run and the outage grace (below) is watching the name; the job pings
   red too → they still call the public name, and nothing runs until it is back (`SETUP.md` §40
   moves them).
4. **From a computer, if one is at hand:** `dig +norecurse @a.gtld-servers.net <domain> NS` asks
   the `.com` registry itself. An answer naming the registrar's nameservers → the registry is fine,
   look at the zone (causes 4–6); `NXDOMAIN` → a hold or an expiry, whatever any phone shows.
   lookup.icann.org → `<domain>` shows the domain's status: `clientHold` or `serverHold` is a hold.

### The causes, likeliest first, and the fix for each

1. **The registrar's hold for the ICANN contact verification.** ICANN requires the registrant's
   email address to be verified within **15 days** of the registration and of every change of the
   registrant contact; unverified, the registrar suspends the domain (`clientHold`), the registry
   stops publishing it, and the records stay exactly as they were. The email comes from the
   registrar's verification service, not from the registrar's own name, and often lands in spam.
   Fix: search the contact mailbox (`SETUP.md` §26) — inbox, **Spam**, **All mail** — for the
   verification email and click its link; no email, or the link expired: the registrar's control
   panel → the domain → resend the verification, then click. The hold lifts at the registry within
   minutes; resolvers that cached the «no such name» answer keep it up to fifteen minutes more.
2. **The yearly renewal.** The expiry is in `SETUP.md` §26 (2027-09-16); once
   `DOMAIN_REGISTERED_ON` is set, «Sarcini» turns amber 90 days before it, and from 30 days before
   it `/api/health` answers 503 on every host, so the monitors alarm. Auto-renew fails on an
   expired or refused card; the domain expires and the registrar parks it (a parking page: «carries
   no baseline») or holds it. Fix: the control panel → renew, update the card; then raise
   `DOMAIN_RENEWAL_YEARS` on both Vercel projects and redeploy. Past the registrar's grace period a
   redemption fee applies, so the day it is seen, not later.
3. **An unpaid invoice** at the registrar — another service on the same account — can suspend the
   account's domains. Fix: pay it, and ask the registrar's support to lift the suspension.
4. **A nameserver change.** Someone changed the domain's nameservers away from the registrar's
   `ns1`–`ns4` (`SETUP.md` §26), and the new ones hold no zone. dnschecker red in places, then
   everywhere. Fix: put the registrar's four back; a nameserver change propagates for up to two
   days.
5. **A deleted zone or record.** The registrar's Zone Editor lost the apex `A`, a `CNAME` or the
   whole zone: the registry answers (step 4 above), the name has no address. Fix: enter the records
   again from `SETUP.md` §26's table (TTL 30) and §35's for `mail.`.
6. **Vercel's domain configuration.** The name resolves to Vercel and Vercel refuses it. Vercel →
   the production project → **Settings** → **Domains**: each domain «Valid Configuration»;
   «Invalid Configuration» names the record Vercel expects, and a domain missing from the list is
   added back. A «certificate failure» in ship's line: the same page shows the certificate's state;
   Vercel renews it on its own once the records are right again.

### What the platform does meanwhile, and what is left to do after

Nothing is lost: registrations, the desk and the outbox keep their data, and anybody whose
resolver still has the name keeps using the site. What a name outage does to the participants is
run their deadlines — an address link, a declaration hold, a waiting-list offer, an invitation, a
family form — while nobody can reach the page that keeps them. **The outage grace**, its own
decision in this release (`docs/PLATFORM.md` § When the name is gone), stops that clock:

- **While the name is gone**, if the job pings call the `vercel.app` addresses (`SETUP.md` §40),
  the maintenance job sees the name fail twice ten minutes apart, holds every running deadline
  still and emails the Administrators «Site-ul nu se găsește după nume». If the pings call the
  public name, no job runs at all and the grace sees the silence at the first run after.
- **After**, the Administrators get «Ceasul termenelor a stat pe loc»: how long, what was moved,
  and each claim that lapsed and could not be revived (its place was taken, or the platform had
  already expired it). «Sarcini» shows «Site-ul de negăsit: ceasul termenelor» in red until every
  one is handled. **That email is the list to work from:** under its bold line it names each claim
  not revived — the person, the event, what it was — with a link to its page in the backoffice, and
  under the list one sentence per kind with the verb its state has now. Without the email the list
  is incomplete: «Înscrieri» → the event and state **«Expirată»** → **Filtrează** finds the lapsed
  offers, declaration holds and address links (their history on the registration's page carries
  «Nereluat după întreruperea site-ului…»); a family's reservation is still awaiting its address,
  with the same history line; an expired invitation's line is in the event's own history; a place
  held for a family form has no row at all. Ask any Administrator for the email before relying on
  this. (The «Până când» column shows no deadline for an expired registration and does not sort by
  its expiry.) For each, as the email says it:
  1. **A lapsed offer, declaration hold or address link** — the registration is «Expirată», and no
     verb seats an expired row: the person registers again (or the staff use «Adaugă înscrierea»),
     and once they wait, **«Trimite-i oferta»** seats them (an Administrator; one supplementary
     place when none is free, confirmed and audited).
  2. **A family reservation** cleared while the address waited — the address is still unconfirmed:
     **«Dă-i un loc acum»** on that registration seats them, with one confirmed supplementary place
     when none is free.
  3. **An expired invitation** cannot be re-sent («Retrimite» is for an open one): send a new one to
     the same address from «Trimite invitații».
  4. **A place held for a family form** is nobody's registration yet: the person fills in the form
     again.
- `/devs` → Stare shows what the name answered at the maintenance job's last real run and the last
  three windows.

### A release during such an hour

Ship's first step waits **60 minutes** for production to name the baseline `main` runs, by the
public name; while the name is gone it waits the full hour and stops. Ship's lines say which case
it is (§ Release from the phone).

- **A STOP before the `qa → main` release merged** (the start, «production never reported …»):
  nothing merged. Once `/api/health` on the domain answers with a baseline, tick **ship** again on
  the pull request, or **Actions** → **release** → **Run workflow** with its number.
- **A STOP once the release is in `main`** (the comment says «The release is already in main»):
  **never tick ship again**. § When it stops says what instead — the migration's run, or Vercel's
  production deployment — and the release is done once `/api/health` reports the new baseline.

### The worked example: 2026-10-03

| UTC | What happened |
| --- | --- |
| 2026-09-16 | The domain is registered. The registrar's verification service sends the ICANN contact verification to the registrant mailbox; it lands in spam and is not seen. |
| 2026-10-03, about 11:04 | The registrar puts the domain on hold for the unverified contact. The `.com` registry answers «no such name»; the public site, the backoffice, QA and the `mail.` subdomain go with it. |
| about 12:02 | The hourly health monitor on the public name fails and cron-job.org emails. cron-job.org's job pings call the public name, and the GitHub backstop calls nothing — its base-URL secrets are unset, so its steps skip green — so no job runs from here on. |
| between about 12:00 and 18:00 | A release from the phone waits its hour in ship's first step and stops; its log said the same two lines it says for a slow build (since then it says what it sees). A phone that had the name cached keeps showing the site, while new visitors see nothing — which made a dead name look like a dead site to some and a live one to others. |
| about 18:24 | The verification email is found in spam and clicked; the registry publishes the domain again within minutes. |
| about 18:24–18:40 | A network's resolver keeps its cached «no such name» for about a quarter of an hour; mobile data sees the site at once. The jobs run at their next ping. |

Seven hours twenty minutes. What it leaves: the registrant contact is a mailbox outside the domain,
read daily, with the registrar's senders whitelisted (`SETUP.md` §26); the job pings and a second
health monitor call the `vercel.app` addresses (`SETUP.md` §40); and the deadlines' clock stops
while the name is gone (the outage grace).


---

## Email has stopped

The monitor mail from cron-job.org says `/api/health?deep=1` failed (the daily 04:02 check; the
hourly `/api/health` is shallow since §577 and says only whether the site answers), or
`/admin/tasks` is red at the top (`DECISIONS.md` §98), or its row «Emailuri pe care nu le duce nimeni»
is red (§622). First look at «Setări» → «Emailuri» → «Coada de trimitere»: its header says whether
Mailgun has said stop, until when, and who carries the mail meanwhile («Mailgun în pauză până la 10:15 —
Gmail preia», «… — Gmail nu e configurat»). **The switch:** «Prin ce pleacă emailurile» → «Gmail preia când
Mailgun se oprește» → Da → «Salvează drumurile» (greyed «până la aprobarea notei din șablonul nou» until the
privacy notice in force names `{{gmailFallback}}`: approve it from the template on «Documente legale» first): while Mailgun is paused or out of allowance, every group
leaves through the club's Gmail, within «Limita Gmail pe zi» (raise it there, 500 at most, if Gmail is
the one that is full), and returns to Mailgun on its own afterwards. While Gmail carries everything,
`/api/health?deep=1` answers 200 with `email.status: "degraded"` and the monitor stays quiet; it answers
503 once a row has waited ninety minutes with nothing to carry it.
Meanwhile the public pages say it themselves,
for as long as it lasts: every page that waits for an email shows «Emailurile noastre întârzie acum»
with how many messages wait, the oldest's wait, the estimate when there is one and that the deadline
runs from the send, and the event page and the form say it in one line (§623) — nothing to switch on
or off; it goes when the queue is through. Four causes, told apart by the same page:

1. **Deferred by the allowance** — Mailgun Free's 100 messages a day are spent. Nothing is
   lost; the queue resumes at the time the alert names (the UTC reset, five minutes past).
   If it is registration day and people are waiting for confirmations: Mailgun → Billing →
   Basic removes the daily limit the moment it is paid; then «Setări» → «Emailuri» (`/admin/settings/emails`, §516) → "The Mailgun
   plan" → Basic → save, so the counters and "Trimite acum" stop counting against a hundred
   (`DECISIONS.md` §100) — saving also reopens Mailgun's road at once and makes the allowance-deferred rows due, so Gmail stops carrying (§622); the next scheduler tick — or "Trimite acum" — sends everything. When
   the month is over and the plan is cancelled, set it back to Free there. `docs/PLATFORM.md`
   has the price. With «Gmail preia când Mailgun se oprește» on, the deferred rows leave through Gmail
   at once instead (§622), and «Trimite acum» says «N prin Gmail — cota Mailgun epuizată până la …».
2. **Overdue** — messages waited more than ninety minutes for a scheduler. cron-job.org →
   the two job monitors: paused, disabled after failures, or the `JOB_SECRET` changed (a history
   entry that is a 200 taking about twenty seconds is a long run that finished after the response,
   not a failure — the body says `continuing: true` only with the job's "save responses" on; Vercel's
   function log line `[jobs] <job>: finished after the response in <ms> ms` is the authority:
   `SETUP.md` §40, `DECISIONS.md` §667). Run
   `yarn smoke` on the environment; `jobs[].status` names which one is stale. Pressing
   "Trimite acum" on `/admin/registrations` drains the outbox by hand meanwhile.
3. **Paused by the provider** (§605) — `lastError` starts "paused by the provider:". Mailgun
   answered 429, or 400 "not allowed to send" with the probation's words («You are sending too fast.
   Your account is on probation…»): the message waits, due at `Retry-After` or fifteen minutes, and no
   attempt is spent, and no other Mailgun message is tried until the pause ends, so nothing fails.
   A row paused recently and queued longer ago than the overdue allowance turns **overdue**: ask
   Mailgun's support to lift the probation or check Sending → Logs, and lower «Limita pe oră» (90 while
   the probation lasts). With the switch on, Gmail carries the queue during the pause (§622) — no SQL,
   no setting by hand. Mailgun rows only waiting for the
   hour's pace (`hourPaced` in `/api/health`, «Limita pe oră» on «Emailuri») are not an alert while
   Mailgun's hour is full; a Gmail row, or a Mailgun row behind an hour with room, is.
4. **Failed** — since §622 only a refusal *of the message or the account*: a `401` or `403` (the
   `MAILGUN_API_KEY`, an unverified domain), a `400` that is not about the address ("not allowed to
   send" without the probation's words: an unverified or closed domain, an account under review), or a
   message that could not be rendered. A transient refusal (a 5xx, a timeout, a 404 — `SETUP.md` §35:
   EU domains answer at `api.eu.mailgun.net`) is never FAILED any more: it is retried hourly and shows
   as **overdue** instead (`retryingLate`, once past six attempts), and «Sarcini» turns
   red for it with the reason on the row. The alert carries the last reason; open Mailgun → Sending → Logs. Once the
   cause is fixed: «Setări» → «Emailuri» → «Coada de trimitere» → **«Reîncearcă emailurile eșuate»**
   puts every FAILED message of the last seven days back in the queue, from the first attempt, in one
   press (Administrator, three presses an hour, audited); an address problem stays BOUNCED. One message
   can still be resent from the registration's page (`/admin/registrations/<id>` → Retrimite).

The health page answers 200 again on its own once no row is deferred, overdue or failed in
the last seven days; a failed row that is not retried keeps the alert up for those seven days,
which is deliberate — it is the one the club still owes somebody. **«Trimite acum» during a stop**
says what it did: «N prin Gmail — Mailgun în pauză până la HH:MM» with the switch on, or a refusal
naming the remedy (the switch, Gmail's limit, or the hour Mailgun reopens) — never «0 trimise».

**People waiting for their declaration link** after the email was late or lost: the event's page
in the backoffice (`/admin/events/<id>` → «Înscrierile primite») →
«Retrimite declarația tuturor care nu au semnat», Administrator only (`DECISIONS.md` §606). The
dialog says how many wait to sign and how many it skips — anyone whose declaration email is still
queued or left in the last hour, and anyone whose five resends of the hour are spent — and every
email it queues carries a new link, so the link in the earlier email stops working. It queues;
the outbox sends at the road's pace. Three presses an hour per event; no state or deadline moves.

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

### The same facts on the site (2026-09-29, `DECISIONS.md` §565)

The legal name and the CIF also show on the site, from the same two variables: one line
«<legal name> (<site name>) · CIF <CIF>» at the end of every club page, «Echipa» and the contact
page, and the block under the footer's bar on every page (the legal name, «C.I.F.», «România»; the
social marks; «Contact»). Nothing to do but set `CLUB_LEGAL_NAME` and `CLUB_REGISTRATION_NUMBER` on
the Vercel project and redeploy; unset, the line and the block's first column are simply absent.
The seat is not shown. The phone under «Contact» is a setting, not a variable: «Pagini» →
«Contact» → «Telefon public», Administrator; an empty box shows no number. Never type any of these
values into the repository: `yarn secrets:check` refuses a commit that carries one your
`.env.local` holds.

### The short path: start from the platform's text (2026-09-18)

`/admin/legal` → "Versiune nouă" → the link for the document under "Sau pornește de la
șablon" / "Or start from the template". The draft is prefilled with the complete text in both languages; fill the
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

### Deleting a version (2026-09-29, `DECISIONS.md` §567)

`/admin/legal` → the version's row → «Șterge» (Administrator and above). What it does depends on
what stands on the version, and the screen says which before anything is pressed:

- **Nothing depends on it** — «Șterge definitiv»: the row and both texts go, the number is retired
  for good (§203). Type the phrase shown (`GDPR 2`) and a reason.
- **A signature, an event or a registration depends on it** — two steps: step 1 states what happens
  («1 semnătură, 0 evenimente și 0 înscrieri rămân valabile…») and asks a reason (at most 200
  characters); step 2 asks the version's number, typed by hand, then «Șterg versiunea N». The
  version leaves the list and moves into the closed fold «Versiuni șterse» under its text's card;
  it can never be put in force again. Its text is **kept**: the signatures still point at it, and
  the registration's page, the race desk and the signed PDF still show it. Nothing is restored from
  the fold — the same words again are a new version, approved like any other.
- **The version in force** is refused either way: approve the next version first.

Every deletion leaves an audit row (`legal_document.deleted` for the first kind,
`legal_document_version.deleted` for the second) naming who, when and why.

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

## Hotfix — a fix straight to production

When production shows something broken that must go now — the owner, 2026-09-29: «HOTFIX!!! fără teste»:

1. **Branch from main.** `git fetch origin`, `git worktree add --no-track -b hotfix/<what> .claude/worktrees/hotfix-<what> origin/main`, then `yarn install` in it.
2. **The smallest change, and only the checks that break a deploy:** `yarn typecheck`, `eslint` on the touched files, `yarn secrets:check` (the repository is public). A test that no longer compiles is made to compile; the tests themselves follow in the next batch.
3. **Into main with the owner's authorisation.** Commit, push, `gh pr create --base main`, then `gh pr merge <n> --merge --admin`. Nothing else is ever merged with `--admin`.
4. **Back into qa at once.** `gh pr create --base qa --head main`, then `gh pr merge <n> --merge --admin`, so the next batch starts from the fixed code.
5. **Production.** Vercel builds main by itself. After an instant rollback it no longer gives the domain to new deployments: promote the new production deployment once it is READY (`vercel promote <deployment url> --yes --scope <team>`), then read `/api/health`.
6. **The next batch, first item:** the tests the hotfix left behind, and a `.release` entry that records the hotfix as an amendment of the decision it changed.

An instant rollback (`vercel rollback <previous production deployment> --yes --scope <team>`) is the stop-gap while the hotfix builds, never instead of it: the owner wants the fix, not yesterday's site.
