<!-- Operational runbooks. Each is run once, or rarely. -->

# Runbooks

**Baseline `BR-V1.31-2026-09-17`** · versioned with the whole set · [changelog](../CHANGELOG.md)


| Runbook | When |
| --- | --- |
| [Repository bootstrap](#repository-bootstrap) | Once, at the first push |
| [Staff sign-in: Zitadel tenant](#staff-sign-in-zitadel-tenant) | Once per environment, before that environment's staff can sign in for real |
| [Domain binding](#domain-binding) | Once, at the end of M1 before launch |
| [Legal document version](#legal-document-version) | Whenever an approved privacy, terms, or declaration version changes |
| [Deploy a release](#deploy-a-release) | Every merge to `qa`, and every promotion to `main` |


---

## Repository bootstrap

For the first push of the documentation baseline to
`https://github.com/florinasavei/brasovrunners`. Run once. The mechanics are in `SETUP.md`
§4; this is the exact sequence for the clone-then-push flow.

Everything below assumes the extracted `brasov-runners-docs/` tree is on your machine and
that `node` is installed.

### Step 1 — Create the repository on GitHub

- [ ] Name `brasovrunners`, under `florinasavei`.
- [ ] **Do not** let GitHub add a README, `.gitignore`, or license. The tree already contains
      the first two, and an initialised repository would force a merge on the first push.
- [ ] Private or public is the club's call. Public is simpler for read access and is normal for
      a club website; private needs a token for any reader. Either works with this runbook.
- [ ] If public, add a `LICENSE` before the first push. That is an owner decision, not
      something to pick by default; the code and the club's content may want different terms.

### Step 2 — Clone and populate

```bash
git clone git@github.com:florinasavei/brasovrunners.git
cd brasovrunners

# the archive unzips to a versioned folder; copy its contents in, including dotfiles
cp -r /path/to/brasovrunners-<baseline>/. .

# confirm the hidden files arrived
ls -la .github .gitignore .editorconfig .gitattributes package.json

# the check must pass before anything is committed
node scripts/docs-check.mjs
```

Expected: `docs:check passed (6 root documents).`

### Step 3 — First commit on `main`

```bash
git add -A
git status              # 20 files, nothing unexpected
BASELINE=$(sed -n '1s/.*\(BR-V[0-9.]*-[0-9-]*\).*/\1/p' README.md)
git commit -m "docs: baseline $BASELINE"
git branch -M main
git tag "baseline/$BASELINE"
git push -u origin main --tags
```

### Step 4 — Create `qa` and make it the default

```bash
git switch -c qa
git push -u origin qa
```

Then in the repository settings:

- [ ] Default branch → `qa`.
- [ ] Delete head branches after merge: on.
- [ ] Squash merge: allowed. Merge commits: allowed. Rebase merge: off.
- [ ] Secret scanning and Dependabot alerts: on.

### Step 5 — Rulesets

Both rulesets per `SETUP.md` §4.1 and §4.2, with one adjustment for a single maintainer:

- [ ] `qa`: pull request required, `docs-check` required, direct and force pushes blocked,
      deletion blocked.
- [ ] `main`: the same, plus merge-commit only for the release pull request.
- [ ] **Do not** require an approval or a code-owner review yet. With one maintainer, that
      makes every pull request unmergeable. The required `docs-check` status is the gate.
      Add approvals when a second person exists.

`docs-check` appears as a selectable required check only after the workflow has run once,
so open a trivial pull request against `qa` (a comment change is enough) before configuring
the ruleset.

### Step 6 — Verify

- [ ] The Actions tab shows `docs-check` green on `main` and `qa`.
- [ ] A test pull request into `qa` shows the `docs-check` status and the pull-request
      template.
- [ ] `CODEOWNERS` renders without a syntax warning in Settings.
- [ ] `git log --oneline` shows exactly one commit.

### Step 7 — Read access for the AI reviewer

The reviewer needs to read code, pull requests, checks, and logs, and nothing else
(`AGENTS.md` §22).

- **Public repository:** nothing to do. Read access is implicit.
- **Private repository:** a fine-grained personal access token scoped to this one repository
  with `Contents: read` and `Metadata: read`, and an expiry. Do not paste a token into a chat
  transcript; use a connector or a secret store instead, and revoke it when the reviewer
  changes.

Treat this as the reviewer boundary, not as write access. Pull requests come from the
maintainer's own branches and credentials.

### What is deliberately not in this push

- No application code. That is PR 1 (`SETUP.md` §29).
- No `.nvmrc`. Pin it in PR 1 after verifying the hosting runtime (`DECISIONS.md` §5).
- No `yarn.lock`. There are no dependencies yet.
- No secrets, no `.env`. `.env.example` arrives with PR 1.
- No pinned action SHAs in the workflow. Pin them in PR 1 per `SETUP.md` §5 once verified.


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

- [ ] Add the sending domain in Mailgun and create the SPF, DKIM, and tracking records.
- [ ] Wait for verification. Allow up to 48 hours, though it is usually much faster.
- [ ] Point the Mailgun webhook at the production host and confirm signature verification
      still passes.
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

A push to `qa` starts the Vercel build and the migration workflow at the same moment. For a few
seconds the deployed code and the schema disagree. So:

| The migration | Ships |
| --- | --- |
| Adds a column, table, index or constraint | In the same release as the code that uses it |
| Drops or renames anything | In the release **after** the code that stopped using it, as its own migration and its own pull request |

That is `AGENTS.md` §7.6's expand/contract rule, stated as the thing you actually decide. Get it
right and the overlap window is harmless; get it wrong and the site returns 500 for as long as
the two disagree.

### Deploying to QA

1. **Merge the pull request into `qa`.** Vercel builds; if the change touched
   `src/db/migrations/**`, `.github/workflows/migrate.yml` applies it to the QA database at the
   same time.
2. **Watch the migrate run** if there was one. It prints the target host, the pending
   migrations, and the head it finished on. A failure exits non-zero and the run is red.
3. **Smoke it.** The workflow does this automatically where the environment has an
   `APP_BASE_URL` secret; do it by hand otherwise:

   ```bash
   yarn smoke https://<the QA hostname from SETUP.md §26>
   ```

   `ok` is what you want. `degraded` immediately after a deploy is normal — the scheduled jobs
   tick every five minutes and report as stale until the first one lands. Anything else, read
   the report: it names which of the database, the schema and the jobs is unhappy.
4. **If the schema is behind**, the smoke output says so and names the migration. Run the
   migrate workflow for `qa` from the Actions tab, then smoke again. This is the state that used
   to present as an unexplained 500 on the landing page.

### Deploying to production

Everything above, plus the gate. `AGENTS.md` §6.4 is the promotion flow; this is the database
half of it.

1. **Confirm QA has accepted the change**, including the migration.
2. **Open the `qa → main` release PR.** Review the complete diff *and the migration plan* — the
   pending list the QA run printed is that plan.
3. **Merge with a merge commit.** Do not squash: §6.4 preserves ancestry.
4. **Run the migrate workflow manually**, choosing `production`. It waits for the environment's
   required reviewer. Production is never migrated by a push.
5. **Smoke production**, and this time without `--allow-degraded` once the schedulers have had a
   tick.

### The first production deployment

`main` has never carried the M1 code, so the first production deployment *is* the first release
PR. In this order — the order matters more than any one step:

1. **Prerequisites, all true since 2026-09-16 (`SETUP.md` §25–§26):** the production Vercel
   project exists and tracks `main`; the production Neon project exists and its pooled URL is that
   project's `DATABASE_URL`; its direct URL is the GitHub `production` environment's
   `DATABASE_URL`; the environment has a required reviewer and a `main`-only branch policy.
2. **Open and merge the `qa → main` release PR** (`AGENTS.md` §6.4, merge commit, never squash).
   Vercel builds `main` on the production project the moment it lands. That deployment answers
   `down` on `/api/health` — schema behind — until step 3, and nothing points at the hostname yet,
   so that is acceptable exactly once.
3. **Run the migrate workflow for `production`, from `main`** — the branch policy refuses any
   other ref, and `migrate.yml` does not exist on `main` until the release PR lands:

   ```bash
   gh workflow run migrate.yml --ref main -f environment=production
   ```

   Approve it in the Actions tab — the required reviewer is the owner. The run prints the pending
   list, applies it, and smokes the provider hostname with `--allow-degraded`.
4. **Insert the first Administrator's `staff_users` row by hand** (§ Staff sign-in above): one
   row, the address lowercased, role `ADMIN`. There is no other way in.
5. **Wire the scheduler:** the two repository secrets `PRODUCTION_APP_BASE_URL` and
   `PRODUCTION_JOB_SECRET` (`SETUP.md` §26), and the two pinger monitors. Both jobs move from
   `stale` to `ok` within five minutes.
6. **Smoke:** `yarn smoke https://<production host>` — `degraded` until the first tick, `ok`
   after. Then bind the domain (§ Domain binding) if it was not bound before this deployment, and
   redeploy once more so `APP_BASE_URL` takes effect.
7. Staff sign-in comes with the production Zitadel application (§ Staff sign-in); email to real
   people with the sending domain (§ Domain binding, step 2). Production correctly refuses every
   registration until the club's legal text is loaded (§ Legal document version) — that is the
   rule working, not a defect.

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
  destructive migration must never run because somebody requested a page.
- A drop shipped in the same release as the code change that made it possible.
- A deployment finished without a smoke check. "The build went green" is not "the site works".
- `yarn db:seed` against a deployed database: it deletes every event and translation before
  re-seeding. Use `yarn db:seed:legal` for the sample legal documents alone.


---

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

An AI agent may format approved text and prepare the migration. It must never write,
paraphrase, translate, or "improve" the substance of legal wording.

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
