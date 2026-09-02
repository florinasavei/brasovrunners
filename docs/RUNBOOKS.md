<!-- Operational runbooks. Each is run once, or rarely. -->

# Runbooks

**Baseline `BR-V1.11-2026-09-02`** · versioned with the whole set · [changelog](../CHANGELOG.md)


| Runbook | When |
| --- | --- |
| [Repository bootstrap](#repository-bootstrap) | Once, at the first push |
| [Domain binding](#domain-binding) | Once, at the end of M1 before launch |
| [Legal document version](#legal-document-version) | Whenever an approved privacy, terms, or declaration version changes |


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
- No `package-lock.json`. There are no dependencies yet.
- No secrets, no `.env`. `.env.example` arrives with PR 1.
- No pinned action SHAs in the workflow. Pin them in PR 1 per `SETUP.md` §5 once verified.


---

## Domain binding

Run once, at the end of M1, before launch. Nothing here touches application code. If any step requires
a code change, something violated the rule in `AGENTS.md` §8 that `APP_BASE_URL` is the
single source of every absolute URL.

Related: `SETUP.md` §26 holds the hostname table. `BR-REQ-101-02` is the acceptance
criteria for this runbook.

### Prerequisites

- [ ] Domain registered and owned by the Brașov Runners account, not a personal one.
- [ ] DNS management location decided, and access recorded in the password manager.
- [ ] Both GoDaddy applications running on their default hostnames with green health checks.
- [ ] Two recovery-capable owners have access to the registrar.

### Step 1 — QA first

- [ ] Add `qa.<domain>` to the QA application and let the provider issue the certificate.
- [ ] Create the DNS record the provider's domain screen asks for. Do not guess the record
      type; use what the screen shows.
- [ ] Set `APP_BASE_URL=https://qa.<domain>` in the QA application environment and restart.
- [ ] Zitadel QA: add the new callback and post-logout URLs and the new allowed origin.
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

### Step 3 — Production

- [ ] Add the apex and `www` to the production application and issue certificates.
- [ ] Create the apex and `www` DNS records.
- [ ] Set `APP_BASE_URL=https://<domain>` in the production application and restart.
- [ ] Configure the `www` to apex redirect so exactly one canonical host exists.
- [ ] Zitadel production: add the new callback, post-logout, and origin entries.

### Step 4 — Canonical cleanup

- [ ] Confirm canonical tags, `hreflang` alternates, `sitemap.xml`, `robots.txt`, and Open
      Graph URLs all render the new host. Any that do not indicate a literal escaped the
      configuration rule.
- [ ] Confirm production allows indexing and QA still does not.
- [ ] Confirm runner profile pages still carry `noindex, nofollow` and are absent from the
      sitemap.
- [ ] Remove the provider default hostnames from Zitadel and from any allowlist.
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

## Legal document version

Applies to the privacy notice, the terms, and the event declaration. All three share the
`legal_documents` mechanism described in `AGENTS.md` §12.5. V1 has no editor screen, by the
decision recorded in `DECISIONS.md` §6.7.

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

### Before you start

- [ ] The wording is approved by a named person, with the date recorded.
- [ ] Both Romanian and English bodies exist. A missing locale blocks publication for that
      locale.
- [ ] For a declaration, confirm which events will reference the new version. Existing
      acceptances keep the version they accepted.

### Procedure

1. **Choose the key and version.** `PRIVACY_NOTICE`, `TERMS`, or `EVENT_DECLARATION`, with
   the next integer version for that key. Versions are never reused.
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
- [ ] No staff role can edit either version through any interface.

### What must never happen

- Editing a version that a participant has already accepted.
- Publishing a version with only one locale present when both are required.
- Marking a declaration as accepted on a participant's behalf.
- Describing the acceptance as a qualified electronic signature.
