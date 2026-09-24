export const meta = {
  name: 'br-fix-round',
  description: 'One more fix round on an existing Brașov Runners branch in its worktree, then an adversarial re-review — findings, intent and per-stage models come in args',
  whenToUse: 'After a review left should-fixes, after CI failed on a batch, or to resume a branch whose chain stopped (docs/DISPATCHER.md).',
  phases: [
    { title: 'Fix', detail: 'the listed findings, same worktree' },
    { title: 'Re-review', detail: 'adversarial read-only pass on the branch' },
  ],
}

/*
  args: {
    branch, worktree, findings: [{ file, line?, severity, summary, fix }], intent, checklist,   — required
    tag?, models?: { fix?, review? }, effort?: { fix?, review? }
  }
*/
const A = args || {}
if (!A.branch || !A.worktree || !A.findings || !A.intent || !A.checklist) return { error: 'args need branch, worktree, findings, intent, checklist' }
const TAG = A.tag || 'round'
const M = A.models || {}
const E = Object.assign({ review: 'high' }, A.effort || {})
const opts = (stage) => Object.assign({}, M[stage] ? { model: M[stage] } : {}, E[stage] ? { effort: E[stage] } : {})

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    committed: { type: 'boolean' },
    commitSha: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    decisionsAddendum: { type: 'string', description: 'paragraphs the § needs for what changed in this round, or empty' },
    changelogLine: { type: 'string', description: 'the whole changelog bullet as it should now read, ending "§NNN."' },
    specsCriteria: { type: 'array', items: { type: 'object', properties: { requirement: { type: 'string' }, text: { type: 'string' } }, required: ['requirement', 'text'] } },
    checks: { type: 'object', properties: { typecheck: { type: 'string' }, lint: { type: 'string' }, tests: { type: 'string' }, e2e: { type: 'string' }, notes: { type: 'string' } }, required: ['typecheck', 'lint', 'tests', 'e2e', 'notes'] },
    blockers: { type: 'array', items: { type: 'string' } },
    questionsForOwner: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'committed', 'filesTouched', 'summary', 'decisionsAddendum', 'changelogLine', 'specsCriteria', 'checks', 'blockers', 'questionsForOwner'],
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

const findingsText = Array.isArray(A.findings)
  ? A.findings.map((x, i) => `${i + 1}. [${x.severity}] ${x.file}${x.line ? ':' + x.line : ''} — ${x.summary}\n   Fix: ${x.fix}`).join('\n')
  : String(A.findings)

const FIX = `Fix ONE branch of the Brașov Runners repository after its review. \`cd "${A.worktree}"\` (branch ${A.branch} is checked out there); confirm with \`git branch --show-current\` and \`git status\`. If the tree is mid-merge or dirty from a stopped run, finish or redo that state deliberately (never discard committed work). Do not create a worktree, do not touch the main checkout, do not push.

Read \`git log --oneline origin/qa..HEAD\` and \`git diff origin/qa...HEAD\` first.

FIX THESE (verbatim from the review, with the orchestrator's decisions where noted):
${findingsText}

THE MACHINE IS SHARED: ONE \`next build\`/\`next dev\` and ONE Playwright process at a time; your own database (\`brasov_runners_<worktree>\` via the worktree's git-ignored \`.env.local\`); never seed or reset the shared one.

RULES (as for the whole branch): the repository is PUBLIC — no secret, key, token, database URL, personal email, account id or user-named local path in any tracked file; no DECISIONS/CHANGELOG/SPECS/PROJECT_BASELINE-marker edits (return text instead); both message files with the same keys; one-word namespaces; no helper named t-something; no ICU plurals; bilingual both-or-neither; no hardcoded values in legal texts or emails; no component or element passed from a Server Component to a client component; icons one file per glyph; server-asserted authorization; no hostname literal; CRLF — Write/Edit tools, verify with \`git diff\`; cite the decision as \`§NNN\`.

VERIFY: \`yarn typecheck\`, \`yarn lint\`, \`yarn docs:check\`, the touched vitest files and \`tests/unit/i18n\`; the branch's e2e specs on both projects against a production build. Report honestly.

COMMIT on the branch: \`git add -A && git commit --no-verify -F <a message file of your own>\`, Conventional Commits, body naming each finding answered, the last line the Co-Authored-By line your session's instructions give.

RETURN: decisionsAddendum for what changed now; changelogLine = the whole bullet as it should read now; specsCriteria = the full final list, each ending with "(<today's date>, \`DECISIONS.md\` §NNN)."`

const reviewPrompt = (fixed) => `Review ONE branch of the Brașov Runners repository, read-only, from the main checkout (no worktree, no checkout, no edits).

Branch: ${A.branch}   Base: origin/qa
Latest fixer's summary: ${fixed.summary}
Their blockers: ${fixed.blockers.join(' | ') || 'none'}

\`git fetch origin\`, then \`git diff origin/qa...${A.branch}\` — read all of it; open surrounding code where needed.

INTENT: ${A.intent}

CORRECTNESS — check each, cite file:line:
${A.checklist}
- messages: both files, same keys, no orphaned keys, no t-prefixed helper, no dots in namespaces, no ICU plurals.
- No component/element across the server/client boundary; no new dependency; migrations expand-only; no DECISIONS/CHANGELOG/SPECS/baseline edits; no hostname literal; nothing private in a public repository.
- Tests present and meaningful; the e2e the change needs actually ran.

Be adversarial; report only what you can point at. "ship" only with zero blockers and zero should-fix.`

phase('Fix')
const fixed = await agent(FIX, { label: `fix:${TAG}`, phase: 'Fix', schema: FIX_SCHEMA, ...opts('fix') })
if (!fixed || !fixed.committed) return { fixed, rereview: null }

phase('Re-review')
const rereview = await agent(reviewPrompt(fixed), { label: `rereview:${TAG}`, phase: 'Re-review', schema: REVIEW_SCHEMA, ...opts('review') })
return { fixed, rereview }
