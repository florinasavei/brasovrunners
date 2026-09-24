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
Verify the state before acting: `git worktree list`, `gh pr list`, production's /api/health.

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
   `batch/<date>-<letter>` from `origin/qa` with `--no-track`, merge them, resolve conflicts
   (the Conflict merge card), `yarn typecheck && yarn lint`.
5. **Land.** A manifest beside the results, `yarn docs:land <manifest> --apply`, then the
   `docs/QUEUE.md` rows and the CLAUDE.md batch line by hand, `yarn check`, commit, push, PR
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
  written by a merge) and `--apply`. By hand after it: the `docs/QUEUE.md` rows, the CLAUDE.md
  batch line, and every `§NNN` it listed.
- **Model:** the dispatcher, or Haiku with the manifest and the dry run's output.

### Ship

- **When:** the batch PR is open and the previous release is on production.
- **Run:** `yarn ship <PR> <new baseline> <previous baseline> "<title>"` in the background. It
  merges the batch into `qa`, opens and merges the release PR, approves the gated migration and
  waits for production's `/api/health` to name the new baseline. It stops, and says why, at
  the first red.

### Status sweep

- **When:** the owner asks "where are we", or before a handoff.
- **Run:** `gh pr list`, `git worktree list`, production's and QA's `/api/health`, the running
  workflows; `docs/QUEUE.md` updated to match.
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
- Implementers never edit `DECISIONS.md`, `CHANGELOG.md`, `SPECS.md` or a baseline marker; the
  dispatcher lands their text.
- The owner's standing rules go into every brief: every text the club types is Română and
  English, both or neither; legal texts and emails carry placeholders, never a hardcoded value.
- The rules that cannot be broken (CLAUDE.md) outrank speed, and so does the public repository.
