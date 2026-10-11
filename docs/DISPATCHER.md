# The dispatcher

How one orchestrating session turns the owner's asks into small reviewed releases: it writes a
card for each piece of work, hands the card to subagents with the model that fits, lands their
documentation, ships one batch at a time, and watches the usage while doing it (`DECISIONS.md`
§368). The two workflows it runs are `.claude/workflows/br-chain.js` and
`.claude/workflows/br-fix-round.js`; the two scripts are `yarn docs:land` and `yarn ship`;
`docs/QUEUE.md` is the list it keeps.

The repository is public. Nothing on this page, in a card, a brief, a commit or a PR names a
secret, a key, a token, a database URL, a personal address, an account id or a local path;
values live in `.env.local` and on the Vercel projects, and the club's domain only in `SETUP.md`
§26.

## The prompt

Paste this into a new session (Fable, ultracode on), from the repository's root:

```text
You are the dispatcher for this repository. Read CLAUDE.md, docs/VIBECODING.md,
docs/DISPATCHER.md and docs/QUEUE.md, then your memory's latest handoff note if you have one.
Verify the state before acting: `yarn handoff` (production's and qa's baselines, the open pull
requests, every unmerged branch, the next free migration number, local work not on GitHub),
then production's /api/health.

Then run the loop in docs/DISPATCHER.md § The loop until the queue's "building" and "ready"
rows are shipped or blocked on the owner: one card per item, the model the card's table names,
at most four chains at once, one release at a time with `yarn ship`, docs/QUEUE.md updated in
every batch. Ask me only what the club alone can decide; choose the sensible default for the
rest and list it in the report. After every release, one report line: what shipped, what is
building, what waits on me, and the usage band you are working in.
```

## The loop

1. **Intake.** Each ask becomes a row in `docs/QUEUE.md` § Building, in the owner's words.
2. **Card.** Pick the card below, fill its brief: what, where in the code, the acceptance
   criteria, the `BR-REQ-*` it touches, and "cite the decision as `§NNN`".
3. **Dispatch.** Run the card's workflow with the models the card names, in the background.
   Save every result, as returned, to the session's scratchpad as `item-<tag>.json` —
   `yarn docs:land` reads those files.
4. **Integrate.** When two to four branches are `ship` (or `ship-with-fixes` with nits only), branch
   `batch/<date>-<letter>` from `origin/qa` with `--no-track`, check it out, and
   `yarn batch:merge feat/a feat/b …`: the journal, the catalogues and the tests resolved by rule,
   sibling snapshots re-linked, `yarn migrations:check` and `yarn typecheck` at the end; any
   other conflict stops it (the Conflict merge card), and the same command resumes. Then `yarn lint`.
5. **Land.** A manifest beside the results, `yarn docs:land <manifest> --apply`, then the
   `docs/QUEUE.md` rows by hand, `yarn check`, commit, push, PR
   into `qa`.
6. **Ship.** `yarn ship <PR> <new baseline> <previous baseline> "<title>"`, in the background.
7. **Report.** One line to the owner; move the rows to § Released.

Small batches: two to four items, one release at a time, never a release while the previous one
is still on its way to production.

## Choosing the model

The workflows take `models: { impl, review, fix }` and `effort: { impl, review, fix }` in their
args; a stage left out uses the session's model. The rule: **the cheapest model that does the
task well, and never a cheap review.**

| Task | Model | Effort | Why |
| --- | --- | --- | --- |
| The dispatcher itself | Fable | high | Holds the queue, the rules and every result; decides |
| Mechanical: docs rows, a rename, a status sweep, reading a CI log | Haiku | low | Nothing to design; speed |
| A well-specified implementation (a clear brief, a handful of files) | Sonnet | medium | Follows a precise brief well, at a fraction of the cost |
| A fix round with concrete findings | Sonnet | medium | The findings are the spec |
| Cross-cutting implementation: several modules, a migration, a new flow | Fable or Opus | high | Design and code together |
| Anything touching the rules that cannot be broken (capacity, legal texts, staff authorization, email tokens, erasure) | Opus | high | The cost of a subtle error is trust |
| Adversarial review and re-review — always | Opus | high | The review is what makes a cheap implementer safe |
| An investigation with no known cause (production-only, hydration, a flaky spec) | Opus | high | Reading and reasoning, not typing |
| A conflict merge across branches | Opus | medium | Both sides' intent must survive |

**Spread the load.** Fable and Opus draw on separate weekly allowances. When one is past the
amber line below and the other is not, move the implementers to the other; keep reviews on Opus
unless its own allowance is the red one, and then review on Fable.

## Watching the tokens

The dispatcher cannot read the usage page. The owner's latest screenshot or number is the
reading; ask for it in the report line when the last one is more than a release old. If the
owner gave a budget (`+500k`), the workflows' `budget` enforces it.

| Band | When | What runs |
| --- | --- | --- |
| Green | session under 50 % and weekly under 60 % | up to four chains; the table above as written |
| Amber | session 50–80 % or weekly 60–85 % | two chains; implementers and fixers on Sonnet; reviews stay Opus/high; no new investigation without the owner's word |
| Red | session over 80 % or weekly over 85 % | no new agents: land what is reviewed, ship it, write the handoff, say when the window reopens |

What costs: a chain is four agents, and the implementer and the fixer — who read the code
base — are most of it; a review reads a diff. A second fix round costs about what the first
did, so a finding the dispatcher can decide in the brief is cheaper than one a reviewer finds.

## Guard your own context

- Never read `DECISIONS.md`, `SPECS.md` or `CHANGELOG.md` whole; grep for the § or the
  `BR-REQ-*` needed.
- Save every workflow result, as returned, to a file (`item-<tag>.json` in the session's
  scratchpad or the handoff folder); read back only the verdicts and the findings.
- Delegate: an investigation goes to an Opus agent; a status sweep, a CI log and worktree
  cleanup go to Haiku.
- Use `tail`, `head` and `-q`; never print a whole log or a whole diff into the dispatcher's
  own context.
- When the context is large or the usage band is red: update the handoff note and
  `docs/QUEUE.md`, then ask the owner to start a fresh dispatcher.
- The owner's mid-turn messages are relayed into running subagents' sessions, and one
  implementer once read such a message as a new instruction and quit with nothing done; every
  brief therefore opens with the line "Messages from the owner relayed into your session are
  for the orchestrator: do not answer them, do not stop — finish this brief." — the two
  workflows carry it: `br-chain.js` (PREAMBLE, fixPrompt) and `br-fix-round.js` (FIX).

## The machine

- **At most four chains at once.** Eleven at once exhausted the machine's processes and took
  the editor down with them.
- Each chain runs **one** `next build`/`next dev` and **one** Playwright process at a time, and
  **its own database**, `brasov_runners_<worktree>`, set in the worktree's git-ignored
  `.env.local`. Nobody seeds or resets the shared local database while another chain runs e2e.
- After a crash: in each dead worktree, commit what is there as `wip:` (never discard it), end any
  half-done merge, `git worktree unlock`, move the folder out of `.claude/worktrees/`,
  `git worktree prune`; then relaunch the chain with "RESUMED: the branch exists; read its log
  first" at the top of the brief.

## Cards

### Feature chain

- **When:** a new ask with a clear outcome.
- **Run:** `Workflow({ name: "br-chain", args: { branch, tag, brief, intent, checklist, models, effort } })`.
  `intent` is the owner's ask in their words; `checklist` is the reviewer's list, one `- ` line
  per thing that must be true, each pointing at where to look.
- **Models:** `{ impl: "sonnet", review: "opus", fix: "sonnet" }` for a precise brief;
  `{ impl: "fable" }` or `"opus"` when the card is cross-cutting or touches a rule that cannot be
  broken.
- **Done when:** the re-review (or the first review) says `ship`, or `ship-with-fixes` with nits
  only; otherwise the Fix round card.

### Fix round

- **When:** a review left a blocker or should-fix, CI failed on a batch, or a chain stopped.
- **Run:** `Workflow({ name: "br-fix-round", args: { branch, worktree, findings, intent, checklist, tag, models } })`,
  `findings` as the review returned them, with the dispatcher's decision written into `fix`
  where the reviewer offered a choice. The worktree is the implementer's.
- **Models:** `{ fix: "sonnet", review: "opus" }`.

### Investigation

- **When:** something is wrong and nobody knows why.
- **Run:** one `Agent` (read-only unless the brief says otherwise) with the symptom, where it
  shows, what was ruled out, and the question; the answer is a cause with evidence and a
  proposed fix, which becomes a Feature chain card.
- **Model:** Opus, high.

### Conflict merge

- **When:** integrating a batch hits conflicts the dispatcher cannot resolve in a minute.
- **Run:** resolve by a script written with the Write tool (never inline shell edits: they
  mangle backslashes and the repository is CRLF), keeping both sides' intent; typecheck, lint,
  the specs of both branches. Past two files, one Opus agent in the batch's worktree.

### Land a batch

- **When:** the batch branch holds its reviewed branches.
- **Run:** a manifest outside the repository —
  `{ "baseline": { "from", "to" }, "date", "base": "origin/qa", "items": [{ "branch", "chain", "rounds" }] }` —
  then `yarn docs:land <manifest>` (a dry run: the numbers, the SPECS criteria, any `§NNN`
  written by a merge) and `--apply`. By hand after it: the `docs/QUEUE.md` rows and every `§NNN`
  it listed; CLAUDE.md keeps no batch lines. A branch's own `.release/` entry lands too, after the
  manifest's items (the manifest's item wins for a branch it names), and is deleted. With no
  saved results at all — a batch of branches that each carry their entry —
  `yarn docs:land --tree [--to BR-V2.NN]` needs no manifest: the next baseline, today in Brașov,
  and it writes the Released row itself.
- **Commit:** run `yarn docs:check`, then `git commit --no-verify` — not the hook's full
  `yarn check`, which took about ten minutes of every release (§504). CI runs the full
  `yarn check` on the batch PR minutes later, and every merged branch already passed the hook.
  The risk is a red batch PR instead of a red hook; a fix round fixes it. The hook still runs
  for every other commit — this is the one exception `AGENTS.md` §6.3 and `SETUP.md` § Contributing name.
- **Model:** the dispatcher, or Haiku with the manifest and the dry run's output.

### Ship

- **When:** the batch PR is open and the previous release is on production.
- **Run:** `yarn ship <PR> <new baseline> <previous baseline> "<title>"` in the background. It
  merges the batch into `qa`, opens and merges the release PR, approves the gated migration and
  waits for production's `/api/health` to name the new baseline. It stops, and says why, at
  the first red. An already-merged batch PR is not an error — the script says so and
  continues from step 3. It waits for the `qa` push's run by its status and opens the release
  PR only once that run is green, so the release PR's run finds the tree tested and skips; at
  the end, and at any stop, it prints each step's m:ss and appends one JSON line to
  `SHIP_TIMES_FILE` (§504).
- **Production's waits** (step 1, the previous baseline; step 7, the new one) print what production
  answers on the first reading and then every two minutes (§658): «no answer for N min: <the fetch
  error>» → the site does not answer at all, `docs/RUNBOOKS.md` § The domain stops answering;
  «production answers with <baseline>; waiting for <baseline>» → another build is live, check
  Vercel's production deployment; «production answers but its body carries no baseline» → a page
  that is not the application, treat it as no answer. The STOP names the case in the same words,
  and so do the times file's `outcome`, the summary page and the release workflow's comment. After
  step 1's STOP («never reported», nothing merged yet) run `yarn ship` again with the same
  arguments once production answers (from the phone: the label came off; tick **ship** again).
- **A STOP after the `qa → main` release merged** — the migration's («no migrate.yml run
  appeared», «was still … after an hour», «ended failure») or step 7's («did not report … in
  time») — is never followed by `yarn ship` or the label again (§658): a second run takes its
  starting baseline from `main`, now the new one, waits an hour for a baseline production does not
  run, and stops again. The times record lists the step «migration», which ship opens right after
  that merge, and the release workflow's comment says «The release is already in main». The
  migration: fix it, or approve and re-run `migrate.yml` on `main` by hand, then redeploy
  production if its build gave up waiting. Production: the domain triage, or fix or redeploy
  Vercel's production deployment. The release is done once `/api/health` reports the new
  baseline.

### Cloud loop

- **When:** the PC is off — the owner on holiday, working from a phone through Claude Code on
  the web or cloud agents.
- **Run:** one session per change, cut from `qa` (`docs/VIBECODING.md`: the cloud session sets
  itself up). The session commits the code, the documentation the change needs, and its
  `.release/<branch-slug>.json` (`.release/README.md`), pushes the branch and opens the pull
  request into `qa` through the GitHub tools. The pull request's `docs-check` checks the entry.
  Then the owner adds the label **ship** — `.github/workflows/release.yml` merges `qa` in by rule,
  lands the entry, pushes the landing and runs `yarn ship` (`docs/RUNBOOKS.md` § Release from the
  phone). One pull request per release; the next label waits for the running one.
- **Several changes in one release:** a session cuts `batch/<date>-<letter>` from `origin/qa`,
  runs `yarn batch:merge` with the branches, pushes, and opens one pull request carrying every
  entry; one label lands them all, numbered in the order the entries were added.
- **What a branch writes, and what that costs:** a branch writes its own README index row, its
  SETUP or `docs/*.md` section and its CLAUDE.md command line; the landing alone writes
  `DECISIONS.md`, `CHANGELOG.md`, `SPECS.md`, the baseline and `docs/QUEUE.md`'s Released row (§ Rules the
  dispatcher keeps). The cost: two siblings that touch the same README, SETUP or CLAUDE.md lines
  conflict, and `yarn batch:merge` stops on that file by design — no rule resolves prose — so a
  person or a merge agent resolves it, commits, and runs the same command again.
- **When the PC is back:** nothing to reconcile — every landed text is in the repository;
  `docs/QUEUE.md`'s Released rows were written by the landings.

### Status sweep

- **When:** the owner asks "where are we", or before a handoff.
- **Run:** `gh pr list`, `git worktree list`, production's and QA's `/api/health`, the running
  workflows; `docs/QUEUE.md` updated to match.
- **Model:** Haiku, low.

### Worktree sweep

- **When:** more than a dozen worktrees, or before a handoff.
- **Run:** `git worktree list --porcelain`; remove (`git worktree remove <path>`,
  then `git branch -d <branch>`) only a worktree that is unlocked, whose folder still exists,
  whose tree is clean (`git -C <path> status --porcelain` prints nothing) and whose branch is
  in `git branch --merged origin/qa`; never a locked, dirty, missing or unmerged one, nor one a running workflow's agent uses (skip any worktree changed in the last hour); `git
  worktree prune` at the end; report the counts.
- **Model:** Haiku, low.

### Handoff

- **When:** the session is long, the red band is near, or the owner asks.
- **Run:** a handoff note in the session's memory (not in the repository): what is on
  production, what is merged, each branch in flight with its tip and worktree, where the saved
  results are, the owner's open questions. `docs/QUEUE.md` in the repository says the same, in
  public words.

## Rules the dispatcher keeps

- A feature branch, a PR into `qa`, never a push to `qa` or `main`; the release is the `qa → main`
  PR (`SETUP.md` § Contributing).
- Every code PR bumps the baseline and opens its CHANGELOG section (`yarn docs:land` does it).
- Implementers never edit `DECISIONS.md`, `CHANGELOG.md`, `SPECS.md`, a baseline marker, or
  CLAUDE.md's baseline line; the dispatcher (or `release.yml`) lands their text from
  the branch's `.release/` entry. They do write the rest of the documentation their change needs,
  on the branch: a README index row for a new file, a SETUP or `docs/*.md` section, a line in
  CLAUDE.md's command list — so an unattended landing has nothing left for a person, and the
  entry's `docsNotes` stays empty.
- The owner's standing rules go into every brief: every text the club types is Română and
  English, both or neither; legal texts and emails carry placeholders, never a hardcoded value.
- The rules that cannot be broken (CLAUDE.md) outrank speed, and so does the public repository.
- A claim about the club's domain names its vantage point; the container's resolver is not one
  (2026-10-03, lesson 1). A dead name: the registry first, the code last (lesson 2).
- A wait longer than a few minutes prints what it waits on and what it last saw (lesson 3).
- A workflow's own comments and labels use `github.token`; the PAT only for what must start a
  workflow (lesson 4).
- A change on the maintenance job's critical path ships in two steps: `qa`, a soak, production on
  the owner's word (lesson 5).
- A brief embeds the intent and the checklist in full, names every persisted identifier, and checks
  who may use the mechanism it prescribes (lessons 6, 7).
- The load is read before each launch; a result from a run the machine rule forbids is not relied
  on (lesson 8). `src/db/migrations/meta` is backed up before any generate (lesson 9).
- After a name incident, `/devs` → Stare: the jobs ran, by the `vercel.app` address (lesson 10).

## Keeping branches mergeable — the lessons of 2026-09-29

On 2026-09-29 four landings stopped on merge conflicts or a red CI, and the dispatcher caused each of them, not the code. The rules that prevent them:

1. **Every round merges `origin/qa` first.** A round brief never says «do not merge origin/qa». The premerge relinks the migration snapshot chain anyway. A branch that skips qa for hours collects conflicts with every release that lands on the same files: the promotional-consent branch met eleven at its premerge.
2. **A follow-up to a branch that has already landed goes on a new branch**, cut from the current `origin/qa`, with a fresh `.release` entry that amends the landed decision. The landing deletes the landed branch's entry and qa carries its merged code, so more rounds on the old branch meet both as conflicts.
3. **Chains that touch the same files do not run in parallel.** Before launching, compare `git diff --name-only origin/qa...<branch>` of the running chains. The registration pages (manage, mine, declare), the CSV, workbook and export, the legal templates and the footer are hot. Serialize them, or land the first before the second implements.
4. **A batch worktree is never cleaned with `git checkout -- .`.** That throws away the premerge's own repairs, such as the snapshot relink. The premerge commits what it changes.
5. **A kit derived from a paired kit keeps the old gates.** Before running a landing, grep its baseline strings (`grep -oE 'BR-V2\.[0-9]+-2026-09-27'`) in both the premerge and the land script.
6. **E2E stays in CI.** Rounds do not run Playwright: the release PR’s eight CI shards are the e2e gate, and a red one is fixed on the batch before the ship restarts. The owner declined e2e in rounds: «cred că exagerezi cu E2E». The landing runs `yarn check` on the batch before it pushes, which catches the unit and docs failures locally.
7. **A hotfix follows `docs/RUNBOOKS.md` § Hotfix:** a branch from main, only the checks that break a deploy, `--admin` into main by the owner’s authorisation, main back into qa at once, the tests in the next batch.

## The day the name went away — the lessons of 2026-10-03

On 2026-10-03 the registrar held the club's domain for the ICANN contact verification from about
11:04 to 18:24 UTC (`docs/RUNBOOKS.md` § The domain stops answering has the timeline). The batch
that followed shipped the outage grace, the ship's own words for what production answers, and this
page. What the dispatcher keeps from it:

1. **A sandboxed container's answers about the club's own domain are not evidence.** The
   dispatcher's container blocks the public name (a CONNECT 403) and its resolver answered NXDOMAIN
   for it; the dispatcher read that as the world's answer, then doubted it when the owner saw the
   site, and was right after all — the owner's phone had the delegation cached. The rule: judge a
   dead name from outside — a GitHub runner's log, dnschecker.org, a phone on mobile data, the
   `vercel.app` address's `/api/health` — never from inside the container, and say which vantage
   point a claim rests on.
2. **A registrar hold has a shape.** NXDOMAIN at the `.com` registry's own servers; the site still
   visible to anyone whose resolver cached the delegation (up to two days); up to fifteen minutes of
   negative caching after the fix. The ICANN contact verification must be clicked within 15 days of
   the registration or of a contact change, and its email lands in spam. The runbook carries the
   steps; the dispatcher looks at the registry first and the code last.
3. **The ship step's silence cost an hour.** It printed the same two lines for «no answer» and
   «another build». The ship branch of this release makes it say what it sees. The rule: a wait
   longer than a few minutes prints what it is waiting on and what it last saw.
4. **The release's closing comment and label removal failed on the token's permissions**, so a
   stopped release could not be re-labelled; the ship branch moves them to the job's own token. The
   rule: a workflow's own write-backs (comments, labels) use `github.token`; the PAT is for what
   must start workflows.
5. **Two-step release for anything on the maintenance job's critical path:** into `qa` first, a
   soak while QA's jobs run, production after the owner's word. This release's batch is the first
   shipped that way — the label `ship` is added only after the soak.
6. **`br-chain` hands the implementer only the `brief`;** the intent and the checklist reach the
   reviewer and the fixer. A brief that says «as the intent says» leaves the implementer to invent
   names and semantics — the outage grace took six rounds partly for that. The rule: the brief
   embeds the intent and the checklist in full, and names every persisted identifier.
7. **A brief checks the preconditions of the house mechanism it prescribes.** The first brief told
   the job to seat a revived claim «outside the places»: that column is «Lista de invitați
   speciali», an Administrator's verb under the event's switch (§643, §648), and the supplementary
   place is an Administrator's confirmed press (§642) — a job may use neither. The rule: before
   prescribing a mechanism, read who may use it and under which switch; when none fits, the job
   records and the human presses.
8. **Fix agents still ran `yarn test`, `next build` and Playwright against the machine rule**, and
   the machine survived at a load of twelve. The rule stays in every stage's prompt, the dispatcher
   reads the load before launching the next workflow, and a result claimed from a forbidden run is
   not relied on.
9. **The drizzle probe overwrote an earlier snapshot again** (`0125_snapshot.json`) when a migration
   was regenerated; the fixer restored it from git. The rule of 2026-09-29 holds: back up
   `src/db/migrations/meta` before any generate, and check that
   `git diff --stat origin/qa -- src/db/migrations/` touches only the new migration and the journal.
10. **Pings on the public name die with the name.** cron-job.org's job pings called the public name,
    and the GitHub backstop called nothing (its base-URL secrets were unset, so it skipped green), so
    no job ran for seven hours. `SETUP.md` §40 moves both to the address no registrar can hold and
    adds the second health monitor; the dispatcher checks `/devs` → Stare after any name incident.

## When a session stops — credits, a usage limit, a closed laptop (§NNN)

On 2026-10-10 the owner moved between a phone session and a laptop session on another account,
and each ran out of credits or hit its limit with work in flight. Nothing was lost, but the
session that took over found two finished branches it had never heard of, three empty branches
whose purpose only the owner knew, and two migrations both numbered `0134`. A session can stop at
any minute, so it works as if it will.

**What every session does, all the time, so that a stop costs nothing:**

1. **Push after every commit.** A commit that lives only in a worktree dies with the container.
   `yarn handoff` lists any worktree with uncommitted or unpushed work; it should list none
   whenever the session is between steps.
2. **Write the branch's `.release/<branch>.json` with its first commit**, intent included in
   `decisionsSection`. A stranger can then review it, finish it and land it without the
   conversation that made it. A branch with no commits says nothing: if a branch is created for
   later, its first commit is the release entry with the owner's words, never an empty branch.
3. **Take the migration number from `yarn handoff`**, which counts `qa` and every unmerged branch.
   Two branches holding the same number are renumbered at batch time — the later one becomes the
   next number, its snapshot's `prevId` pointing at the one that landed.
4. **Keep `docs/QUEUE.md` § «Where things stand» true in every batch** — what production and `qa`
   carry, what is in flight on which branch, what waits on the owner. It is the one page a new
   session reads; a batch that changes the state and not the page is not done.
5. **One dispatcher merges into `qa` at a time.** When two sessions run, one owns the batches; the
   other builds on feature branches only, until the owner says it owns them.

**What the session that takes over does first:**

1. `yarn handoff`, and read its four lists.
2. `docs/QUEUE.md` § «Where things stand», then this page.
3. Review every unmerged branch it did not build before landing it (`.claude/workflows/br-fix-round.js`
   with the finding «review and finish»), and ask the owner what any branch without a release
   entry is for, rather than guessing.
4. Tell the owner in a few lines what it found and what it will do.

**The prompt to resume**, for the owner to paste into the new session:

```text
The previous session on this repository stopped (credits or a usage limit). Take over as the
dispatcher. First run `yarn handoff`, then read CLAUDE.md, docs/QUEUE.md § «Where things stand»
and docs/DISPATCHER.md § «When a session stops». Review and finish any unmerged branch before
landing it; ask me about any branch you cannot explain. Tell me in a few lines what you found
and what you will do next, then carry on.
```

**What the owner can do before a session stops**, when there is warning (a usage bar, a known
reset time): ask it for «status for the next session». It pushes everything, updates «Where
things stand», and answers with `yarn handoff`'s output and the open questions.
