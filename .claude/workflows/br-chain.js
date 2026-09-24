export const meta = {
  name: 'br-chain',
  description: 'One Brașov Runners change: implement in its own worktree, review adversarially, fix, re-review — brief and per-stage models come in args',
  whenToUse: 'Every change the dispatcher (docs/DISPATCHER.md) hands to subagents: one branch, one brief, one reviewed result ready for a batch.',
  phases: [
    { title: 'Implement', detail: 'one agent, own worktree, branch off origin/qa (or the existing branch)' },
    { title: 'Review', detail: 'adversarial read-only review of the diff' },
    { title: 'Fix', detail: 'every blocker and should-fix, same worktree' },
    { title: 'Re-review', detail: 'the same pass on the fixed branch' },
  ],
}

/*
  args: {
    branch, tag, brief, intent, checklist,          — required
    models?: { impl?, review?, fix? },               — 'fable' | 'opus' | 'sonnet' | 'haiku'; omitted = the session's model
    effort?: { impl?, review?, fix? },               — 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    implModel?                                       — kept for older callers: sets models.impl and models.fix
  }
  The dispatcher (docs/DISPATCHER.md § Choosing the model) decides these per task.
*/
const A = args || {}
const BRANCH = A.branch
const TAG = A.tag || 'chain'
if (!BRANCH || !A.brief || !A.intent || !A.checklist) return { error: 'args need branch, brief, intent, checklist' }
const M = Object.assign({}, A.implModel ? { impl: A.implModel, fix: A.implModel } : {}, A.models || {})
const E = Object.assign({ review: 'high' }, A.effort || {})
const opts = (stage) => Object.assign({}, M[stage] ? { model: M[stage] } : {}, E[stage] ? { effort: E[stage] } : {})

const PREAMBLE = `You are working alone on the Brașov Runners repository, in YOUR OWN git worktree (check with \`git rev-parse --show-toplevel\`).

SETUP, in this order:
1. \`git fetch origin\`. If \`git rev-parse --verify ${BRANCH}\` succeeds, \`git checkout ${BRANCH}\` (never -B, never rebase) and \`git merge origin/qa\` (keep both sides); otherwise \`git checkout -b ${BRANCH} --no-track origin/qa\`.
2. \`yarn install --immutable\`.
3. Read docs/VIBECODING.md, then what the brief names.

THE MACHINE IS SHARED (several agents at once): run at most ONE \`next build\`/\`next dev\` and ONE Playwright process at a time; never the whole e2e suite unless the brief asks; use your OWN database — a \`DATABASE_URL\` to \`brasov_runners_<your worktree name>\` in the worktree's git-ignored \`.env.local\` (copied from the main checkout's), created and migrated by you; never \`yarn db:seed\` or reset the shared \`brasov_runners\` database. Pick a free port.

RULES THAT BITE (always):
- The repository is PUBLIC: never write a secret, a key, a token, a database URL, a personal email, an account or organisation id, or a local path with a user name into any tracked file, commit message or PR text.
- Do NOT edit DECISIONS.md, CHANGELOG.md, SPECS.md or any file with a PROJECT_BASELINE marker (SETUP.md, README.md, AGENTS.md, CLAUDE.md, BUSINESS.md, WEEKEND.md, docs/*.md). Return the § body, the changelog line and the SPECS criteria in your structured output. Cite the new decision in code as \`§NNN\` (the orchestrator numbers it at landing).
- messages/ro.json and messages/en.json: every key in BOTH; one-word namespaces; no helper named t-something; no ICU plurals (use countForm). Both must parse.
- The owner's standing rules: every text the club types is Română AND English, both or neither (\`src/shared/forms/both-languages.ts\`); nothing hardcoded in legal texts and emails — placeholders only.
- Server Components by default. Never pass a component or a React element (an icon!) from a Server Component to a client component — pass a NAME (\`src/shared/ui/action-icons.ts\`, \`GlyphChip\`). Icons: one file per glyph from \`@mui/icons-material/<Name>\`, never the barrel.
- Authorization is asserted on the server; a hidden button is not a permission.
- No hostname literal in src/ and never the club's domain anywhere (\`yarn docs:check\`); absolute URLs from APP_BASE_URL.
- The repo is CRLF; use the Write/Edit tools (or a script written with Write and run by path) — inline shell edits mangle backslashes. Verify with \`git diff\`.
- No new dependency. Migrations expand only, generated with drizzle-kit, and prefer none.
- 44-pixel tap targets on anything a thumb must hit (BR-REQ-041-01 criterion 6).

THE BRIEF.
${A.brief}

VERIFY: \`yarn typecheck\`, \`yarn lint\`, \`yarn docs:check\`, \`yarn vitest run <your test files> tests/unit/i18n\` plus the existing tests of what you touched; the e2e specs you changed, on both projects, against a production build (\`yarn build && yarn start\`). Report honestly what ran.

COMMIT on ${BRANCH}: \`git add -A && git commit --no-verify -F <message-file>\` (a message file of your own, not a shared one), Conventional Commits, the body says why, and the last line is the Co-Authored-By line your session's instructions give. Do NOT push, do NOT open a PR.

Finish the whole thing; if part is impossible, do the rest and say exactly what and why in \`blockers\`. Owner-level decisions — choose the sensible default and list them in \`questionsForOwner\`. Your final structured output is data for the orchestrator.`

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    worktree: { type: 'string' },
    committed: { type: 'boolean' },
    commitSha: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    ruleChanged: { type: 'boolean' },
    migrationAdded: { type: 'boolean' },
    decisionsTitle: { type: 'string' },
    decisionsSection: { type: 'string', description: 'Markdown body without the "## NNN." line' },
    changelogLine: { type: 'string', description: 'one English bullet, bold lead, ending with "§NNN."' },
    specsCriteria: { type: 'array', items: { type: 'object', properties: { requirement: { type: 'string' }, text: { type: 'string' } }, required: ['requirement', 'text'] } },
    docsNotes: { type: 'string', description: 'text other baseline documents need (SETUP/CLAUDE/README), and where — or empty' },
    checks: {
      type: 'object',
      properties: {
        typecheck: { type: 'string', enum: ['pass', 'fail', 'not-run'] },
        lint: { type: 'string', enum: ['pass', 'fail', 'not-run'] },
        tests: { type: 'string', enum: ['pass', 'fail', 'not-run'] },
        e2e: { type: 'string', enum: ['pass', 'fail', 'not-run'] },
        testFiles: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['typecheck', 'lint', 'tests', 'e2e', 'testFiles', 'notes'],
    },
    blockers: { type: 'array', items: { type: 'string' } },
    questionsForOwner: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'worktree', 'committed', 'filesTouched', 'summary', 'ruleChanged', 'migrationAdded', 'decisionsTitle', 'decisionsSection', 'changelogLine', 'specsCriteria', 'docsNotes', 'checks', 'blockers', 'questionsForOwner'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ship', 'ship-with-fixes', 'do-not-ship'] },
    findings: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'integer' }, severity: { type: 'string', enum: ['blocker', 'should-fix', 'nit'] }, summary: { type: 'string' }, fix: { type: 'string' } }, required: ['file', 'severity', 'summary', 'fix'] } },
    intentMet: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['verdict', 'findings', 'intentMet', 'notes'],
}

const reviewPrompt = (impl) => `Review ONE branch of the Brașov Runners repository, read-only, from the main checkout (no worktree, no checkout, no edits).

Branch: ${impl.branch}   Base: origin/qa
Implementer's summary: ${impl.summary}
Files: ${impl.filesTouched.join(', ')}
Their blockers: ${impl.blockers.join(' | ') || 'none'}

\`git fetch origin\`, then \`git diff origin/qa...${impl.branch}\` — read all of it; open surrounding code where needed.

INTENT: ${A.intent}

CORRECTNESS — check each, cite file:line:
${A.checklist}
- messages: both files, same keys, no orphaned keys, no t-prefixed helper, no dots in namespaces, no ICU plurals.
- No component/element passed from a Server Component to a client component; icons imported one file per glyph.
- No new dependency; migrations expand-only and generated; no DECISIONS/CHANGELOG/SPECS/baseline edits; no hostname literal; CRLF whole-file rewrites.
- PUBLIC repository: no secret, key, token, database URL, personal email, account id or user-named local path in any tracked file.
- Bilingual (both or neither) and no hardcoded values in legal texts or emails.
- Tests present and meaningful; the e2e the change needs actually ran.

Be adversarial; report only what you can point at. "ship" only with zero blockers and zero should-fix.`

const fixPrompt = (impl, review) => `Fix ONE branch after review. \`cd "${impl.worktree}"\` (branch ${impl.branch} is checked out there); confirm with \`git branch --show-current\`. Do not create a worktree, do not touch the main checkout. The machine is shared: ONE build and ONE Playwright process at a time, your own database.

Findings, most severe first — fix every blocker and should-fix:
${review.findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}${f.line ? ':' + f.line : ''} — ${f.summary}\n   Fix: ${f.fix}`).join('\n')}
${review.intentMet ? '' : `\nIntent NOT fully met per the reviewer: ${review.notes}. Close that gap.`}

Same rules as the implementer (public repository; no DECISIONS/CHANGELOG/SPECS/baseline edits; both message files; no t-helper; icons by name across the boundary; Write/Edit tools; cite §NNN). Verify: typecheck, lint, docs:check, the touched vitest files, the touched e2e specs. Commit on the branch (--no-verify, Conventional Commits, body naming the findings answered, the Co-Authored-By line your session's instructions give). Do NOT push.

Return the implementer's structured shape; carry the § text, changelog line, SPECS criteria and docsNotes forward unless a finding changed the story; say in summary which findings you fixed and which you did not, and why.`

phase('Implement')
const impl = await agent(PREAMBLE, { label: `impl:${TAG}`, phase: 'Implement', schema: IMPL_SCHEMA, isolation: 'worktree', ...opts('impl') })
if (!impl) return { error: 'implementer returned nothing' }
// A resumed run whose saved draft needed no change commits nothing new, yet the branch still
// carries unreviewed work: review it whenever there is a commit to review.
if (!impl.committed && !impl.commitSha) return { impl, review: null, fixed: null, rereview: null }

phase('Review')
const review = await agent(reviewPrompt(impl), { label: `review:${TAG}`, phase: 'Review', schema: REVIEW_SCHEMA, ...opts('review') })
if (!review) return { impl, review: null, fixed: null, rereview: null }
if (review.verdict === 'ship' && review.intentMet) { log(`${TAG}: clean ship on first review`); return { impl, review, fixed: null, rereview: null } }

phase('Fix')
const fixed = await agent(fixPrompt(impl, review), { label: `fix:${TAG}`, phase: 'Fix', schema: IMPL_SCHEMA, ...opts('fix') })
if (!fixed || !fixed.committed) return { impl, review, fixed, rereview: null }

phase('Re-review')
const rereview = await agent(reviewPrompt(fixed), { label: `rereview:${TAG}`, phase: 'Re-review', schema: REVIEW_SCHEMA, ...opts('review') })
return { impl, review, fixed, rereview }
