#!/usr/bin/env node
/**
 * Land one batch's documentation from the chains' structured results — the docs step of `docs/DISPATCHER.md`.
 *
 * Usage: yarn docs:land <manifest.json> [--apply]      (from the batch branch's checkout; a dry run without --apply)
 *        yarn docs:land --tree [--to BR-V2.NN] [--apply]
 *                                                     (no manifest: the release facts the branch carries in
 *                                                     `.release/`, the next baseline after CLAUDE.md's, dated
 *                                                     today in Brașov — what `.github/workflows/release.yml` runs)
 *
 * Branches cite their decision as `§NNN` and never edit DECISIONS.md, CHANGELOG.md, SPECS.md or the
 * baseline; this does it once per batch:
 *   1. bumps the baseline in every carrier (DECISIONS.md: marker and title only; CHANGELOG.md: a new section);
 *   2. numbers the items from the first free `§`, a literal `§N` above it rewritten to `§NNN` first;
 *   3. replaces each `§NNN` by the item whose commit wrote the line (blame); the rest are listed;
 *   4. appends each DECISIONS.md section and CHANGELOG bullet (`land-entry.mjs`);
 *   5. adds or amends SPECS.md criteria;
 *   6. with `--tree`, the CLAUDE.md batch line and the QUEUE.md row; always deletes the `.release/*.json` read.
 * It stops before writing on a blank title, bullet or fix report or a malformed entry; with `--tree`
 * (unattended) also on anything left for a person (`handWork`). Under Actions it writes the run's summary.
 *
 * manifest.json (it lives outside the repository, beside the saved results; it names local paths):
 *   {
 *     "baseline": { "from": "BR-V1.81-2026-09-24", "to": "BR-V1.82-2026-09-24" },
 *     "date": "2026-09-24",                      // the date in the SPECS criteria
 *     "base": "origin/qa",                       // optional; where the branches forked
 *     "items": [
 *       { "branch": "feat/x", "chain": "<br-chain result>.json", "rounds": ["<br-fix-round result>.json"] },
 *       { "branch": "feat/y", "chain": "…", "title": "optional: the § title", "changelog": "optional: the bullet" },
 *       { "branch": "feat/z" },                  // no chain: the branch's own `.release/feat-z.json`
 *       { "chain": "<the orchestrator's own entry, { impl: { decisionsTitle, decisionsSection, … } }>.json" }
 *     ]
 *   }
 * A result file is the saved Workflow return value (br-chain or br-fix-round); text before the first `{`
 * and a `{ result: … }` wrapper are ignored. A `.release/` entry a manifest item also names lands once.
 * With `--apply` and `GITHUB_OUTPUT` set, it writes `from`, `to` and `title` there.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { entryFromResults, requirementOf, rewriteFreeSectionRefs } from "./land-entry.mjs";
import {
  clauseOf,
  currentBaseline,
  duplicateBranches,
  ENTRY_DIR,
  nextBaseline,
  typedBaseline,
  handWork,
  numberForLine,
  orderEntries,
  releaseTitle,
  todayIn,
  validateEntry,
  withBatchLine,
  withReleasedRow,
} from "./land-tree.mjs";

/** Lines for the GitHub Actions run's summary page; nothing elsewhere. */
function summary(markdown) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  } catch {
    // A summary that cannot be written is not a reason to fail a landing.
  }
}

const FENCE = "`".repeat(3);

function fail(message) {
  console.error(`\n  ${message}\n`);
  summary(`### The landing stopped\n\n${FENCE}text\n${message}\n${FENCE}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const TREE = argv.includes("--tree");
const toAt = argv.indexOf("--to");
const TO_FLAG = toAt >= 0 ? argv[toAt + 1] : undefined;
if (toAt >= 0 && (!TO_FLAG || TO_FLAG.startsWith("--"))) fail("--to needs a baseline, like BR-V2.18");
const manifestPath = argv.find((a, i) => !a.startsWith("--") && (toAt < 0 || i !== toAt + 1));
if (!manifestPath && !TREE) fail("Usage: yarn docs:land <manifest.json> [--apply]   or   yarn docs:land --tree [--to BR-V2.NN] [--apply]");
if (manifestPath && TREE) fail("Either a manifest or --tree, not both: a manifest lands the tree's entries too");

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
const gitMay = (...args) => {
  try {
    return git(...args);
  } catch {
    return "";
  }
};
const BASELINE = /^BR-V\d+\.\d+-\d{4}-\d{2}-\d{2}$/;

/** Every `.release/*.json`, validated, in the order they were added. */
function readTreeEntries() {
  if (!existsSync(ENTRY_DIR)) return [];
  const found = [];
  const problems = [];
  for (const name of readdirSync(ENTRY_DIR).filter((n) => n.endsWith(".json")).sort()) {
    const file = `${ENTRY_DIR}/${name}`;
    let entry;
    try {
      entry = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      problems.push(`${file}: not JSON (${error.message})`);
      continue;
    }
    problems.push(...validateEntry(entry, file));
    const added = gitMay("log", "--diff-filter=A", "--format=%ct", "-1", "--", file).trim();
    found.push({ file, entry, addedAt: added ? Number(added) : undefined });
  }
  problems.push(...duplicateBranches(found));
  if (problems.length) fail(`${ENTRY_DIR}/ has entries that cannot land:\n    ${problems.join("\n    ")}`);
  return orderEntries(found);
}

const treeEntries = readTreeEntries();

let manifest;
let here = process.cwd();
if (TREE) {
  if (treeEntries.length === 0) fail(`--tree: no ${ENTRY_DIR}/*.json on this branch — nothing to land`);
  const date = todayIn();
  let from;
  try {
    from = currentBaseline(readFileSync("CLAUDE.md", "utf8"));
  } catch (error) {
    fail(error.message);
  }
  let to;
  try {
    to = TO_FLAG ? typedBaseline(TO_FLAG, from, date) : nextBaseline(from, date);
  } catch (error) {
    fail(error.message);
  }
  manifest = { baseline: { from, to }, date, base: "origin/qa", items: [] };
} else {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  here = dirname(resolve(manifestPath));
}
const { from, to } = manifest.baseline ?? {};
if (!BASELINE.test(from ?? "") || !BASELINE.test(to ?? "")) fail("manifest.baseline needs from and to, like BR-V1.81-2026-09-24");
if (from === to) fail(`the new baseline ${to} is the current one: give --to the next number`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.date ?? "")) fail("manifest.date needs YYYY-MM-DD");
if (!Array.isArray(manifest.items)) fail("manifest.items must be a list");
const BASE = manifest.base ?? "origin/qa";

// The manifest's items first, in its order; then every tree entry no manifest item names.
const treeByBranch = new Map(treeEntries.map((t) => [t.entry.branch.trim(), t]));
const named = new Set(manifest.items.map((i) => i.branch).filter(Boolean));
const items = [
  ...manifest.items.map((item) => {
    if (item.chain) return item;
    const own = item.branch && treeByBranch.get(item.branch);
    if (!own) fail(`manifest item ${item.branch ?? "(no branch)"} has no chain and no ${ENTRY_DIR}/ entry on this tree`);
    return { ...item, tree: own };
  }),
  ...treeEntries.filter((t) => !named.has(t.entry.branch.trim())).map((t) => ({ branch: t.entry.branch.trim(), tree: t })),
];
if (items.length === 0) fail(`nothing to land: the manifest has no items and ${ENTRY_DIR}/ no entry`);
for (const t of treeEntries) if (named.has(t.entry.branch.trim())) console.log(`${t.file}: the manifest's item for ${t.entry.branch} lands instead; deleted with the others`);

/** Files are written back with the line endings they were read with; the repository is CRLF. */
const files = new Map();
function read(file) {
  if (!files.has(file)) {
    const raw = readFileSync(file, "utf8");
    files.set(file, { eol: raw.includes("\r\n") ? "\r\n" : "\n", text: raw.replace(/\r\n/g, "\n"), dirty: false });
  }
  return files.get(file);
}
function write(file, text) {
  const f = read(file);
  if (f.text !== text) Object.assign(f, { text, dirty: true });
}

function loadResult(path) {
  const raw = readFileSync(resolve(here, path), "utf8");
  const json = JSON.parse(raw.slice(raw.indexOf("{")));
  return json.result ?? json;
}

/**
 * One item's title, body, bullet and criteria, by the rules in `land-entry.mjs`. A tree entry is an
 * implementer's result with no fix rounds: a fixer rewrites the file in place.
 */
function itemEntry(item) {
  const label = item.branch ?? item.chain;
  try {
    const chain = item.tree ? { impl: item.tree.entry } : loadResult(item.chain);
    const rounds = item.tree ? [] : (item.rounds ?? []).map(loadResult);
    const entry = entryFromResults(chain, rounds, item, label);
    for (const note of entry.notes) console.log(`  ${label}: ${note}`);
    return { branch: item.branch, source: item.tree?.file, raw: item.tree?.entry ?? chain.impl, ...entry };
  } catch (error) {
    fail(error.message);
  }
}

// 1. The baseline.
const changelogHasTo = read("CHANGELOG.md").text.includes(`## ${to}\n`);
if (changelogHasTo) console.log(`baseline: ${to} is already open in CHANGELOG.md, not bumped`);
else {
  const carriers = git("grep", "-l", "-F", from).trim().split("\n").filter((f) => f && f !== "DECISIONS.md" && f !== "CHANGELOG.md");
  for (const file of carriers) write(file, read(file).text.replaceAll(from, to));
  const decisions = read("DECISIONS.md").text;
  const marker = `<!-- PROJECT_BASELINE: ${from} -->`;
  const title = `**Baseline \`${from}\`**`;
  if (!decisions.includes(marker) || !decisions.includes(title)) fail("DECISIONS.md: marker or title line not found");
  write("DECISIONS.md", decisions.replace(marker, `<!-- PROJECT_BASELINE: ${to} -->`).replace(title, `**Baseline \`${to}\`**`));
  const changelog = read("CHANGELOG.md").text;
  if (!changelog.includes(`## ${from}\n`)) fail(`CHANGELOG.md: no heading ${from}`);
  write("CHANGELOG.md", changelog.replace(`## ${from}\n`, `## ${to}\n\n## ${from}\n`));
  console.log(`baseline: ${from} → ${to} in ${carriers.length} files, DECISIONS.md marker and title, a new CHANGELOG section`);
}

// 2. The numbers.
const last = Math.max(...[...read("DECISIONS.md").text.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1])));
const entries = items.map((item, i) => ({ n: last + 1 + i, ...itemEntry(item) }));
// A literal §N above `last` is a guess, not a citation of an existing decision — §NNN before it is numbered.
for (const e of entries) {
  for (const rewrite of rewriteFreeSectionRefs(e, last)) console.log(`  ${e.branch}: rewrote a free ${rewrite}`);
}
for (const e of entries) console.log(`§${e.n} ← ${e.branch ?? e.source}: ${e.title}`);

// 3. §NNN in the code, by the commit that wrote each line.
/** The commits an item wrote: its branch's, and for a tree entry those up to its file's last change. */
function commitsOf(e) {
  const tips = [];
  if (e.branch) {
    for (const ref of [e.branch, `origin/${e.branch}`]) {
      if (gitMay("rev-parse", "--verify", "--quiet", `${ref}^{commit}`).trim()) {
        tips.push(ref);
        break;
      }
    }
  }
  if (e.source) {
    const touched = gitMay("log", "-1", "--format=%H", "--", e.source).trim();
    if (touched) tips.push(touched);
  }
  if (tips.length === 0 && e.branch) console.log(`(no branch ${e.branch}: its §NNN lines will be listed for a hand decision)`);
  return tips.flatMap((tip) => gitMay("rev-list", `${BASE}..${tip}`).trim().split("\n").filter(Boolean));
}
const numberOf = new Map();
for (const e of entries) {
  if (!e.branch && !e.source) continue; // an entry written by the orchestrator itself cites its number directly
  for (const sha of commitsOf(e)) if (!numberOf.has(sha)) numberOf.set(sha, e.n);
}
// The files that explain the placeholder mention it on purpose.
const MENTIONS = new Set(["scripts/land-batch.mjs", "docs/DISPATCHER.md", ".claude/workflows/br-chain.js", ".claude/workflows/br-fix-round.js"]);
const mentionsOnPurpose = (file) => MENTIONS.has(file) || file.startsWith(`${ENTRY_DIR}/`);
// A line already on the base mentions the placeholder on purpose too; only this batch's lines are numbered.
const inBatch = new Set(git("rev-list", `${BASE}..HEAD`).trim().split("\n").filter(Boolean));
const UNCOMMITTED = "0".repeat(40);
// One item: every line this batch wrote is its own, the merge with qa included.
const onlyNumber = entries.length === 1 ? entries[0].n : null;
const manual = [];
let grep = "";
try {
  grep = git("grep", "-l", "-F", "§NNN");
} catch {
  // git grep exits 1 when nothing matches
}
for (const file of grep.trim().split("\n").filter((f) => f && !mentionsOnPurpose(f))) {
  const shas = [];
  for (const line of git("blame", "--line-porcelain", "--", file).split("\n")) {
    const m = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (m) shas[Number(m[2]) - 1] = m[1];
  }
  const lines = read(file).text.split("\n");
  lines.forEach((line, i) => {
    if (!line.includes("§NNN")) return;
    const sha = shas[i];
    const n = numberForLine({ sha, numberOf, inBatch, uncommitted: UNCOMMITTED, onlyNumber });
    if (n) lines[i] = line.replaceAll("§NNN", `§${n}`);
    else if (sha === UNCOMMITTED || inBatch.has(sha)) manual.push(`${file}:${i + 1} [${sha === UNCOMMITTED ? "uncommitted" : sha.slice(0, 7)}] ${line.trim().slice(0, 140)}`);
  });
  write(file, lines.join("\n"));
}

// 4. DECISIONS.md and CHANGELOG.md.
let decisions = read("DECISIONS.md").text.replace(/\n*$/, "\n");
const bullets = [];
for (const e of entries) {
  const number = (t) => (t ?? "").replaceAll("§NNN", `§${e.n}`);
  const title = number(e.title).replace(/^##\s*\d+\.\s*/, "").replace(/^(Decided|Changed) — (.)/, (_, _w, c) => c.toUpperCase()).replace(/ \(\d{4}-\d{2}-\d{2}\)$/, "").trim();
  const body = number(e.body).replace(/^##\s*\d+\..*\n+/, "").trim();
  decisions += `\n## ${e.n}. ${title}\n\n${body}\n\nBaseline \`${to}\`.\n`;
  let line = number(e.changelog).trim();
  if (!line.startsWith("- ")) line = `- ${line}`;
  if (!new RegExp(`§${e.n}\\.?\\s*$`).test(line)) line = `${line} §${e.n}.`;
  bullets.push(line);
}
write("DECISIONS.md", decisions);
const open = `## ${to}\n\n`;
write("CHANGELOG.md", read("CHANGELOG.md").text.replace(open, open + bullets.join("\n") + "\n"));

// 5. SPECS.md.
const specs = read("SPECS.md").text.split("\n");
const missing = [];
for (const e of entries) {
  for (const c of e.criteria) {
    const requirement = requirementOf(c);
    const h = specs.findIndex((l) => l.startsWith(`#### ${requirement} `) || l === `#### ${requirement}`);
    if (h < 0) {
      missing.push(`${requirement} (§${e.n})`);
      continue;
    }
    const v = specs.findIndex((l, i) => i > h && l.startsWith("**Verification:**"));
    const text = c.text
      .replace(/\((\d{4}-\d{2}-\d{2}|<today's date>), `DECISIONS\.md` §NNN\)/g, `(${manifest.date}, \`DECISIONS.md\` §${e.n})`)
      .replaceAll("§NNN", `§${e.n}`)
      .trim()
      .replace(/^Criterion (\d+) \((new|amended|replaces)[^)]*\):\s*/i, "$1. ($2) ");
    if (/^verification/i.test(text)) {
      specs[v] = `${specs[v]}; ${text.replace(/^verification( line)?:?\s*(add:?\s*)?/i, "").replace(/\.$/, "")}`;
      continue;
    }
    const m = text.match(/^(\d+)\.\s*(\((amended|new|replaces)\)\s*)?/i) ?? ["", "0", undefined, undefined];
    const clean = text.slice(m[0].length);
    const criteria = specs.map((l, i) => [l, i]).filter(([l, i]) => i > h && i < v && /^\d+\. /.test(l));
    const existing = criteria.find(([l]) => l.startsWith(`${m[1]}. `));
    if (/amended|replaces/i.test(m[3] ?? "") && existing) {
      specs[existing[1]] = `${m[1]}. ${clean}`;
      console.log(`SPECS ${requirement} criterion ${m[1]} amended (§${e.n})`);
      continue;
    }
    const lastCriterion = criteria.at(-1);
    const next = lastCriterion ? Number(lastCriterion[0].match(/^(\d+)\./)[1]) + 1 : 1;
    specs.splice(lastCriterion ? lastCriterion[1] + 1 : v, 0, `${next}. ${clean}`);
    console.log(`SPECS ${requirement} criterion ${next} added (§${e.n})`);
  }
}
write("SPECS.md", specs.join("\n"));

// 6. The batch line and the queue (--tree), the entries out of the tree.
const clauses = entries.map((e) => clauseOf({ decisionsTitle: e.title, batchLine: e.raw?.batchLine }, e.n));
const title = releaseTitle(clauses);
if (TREE) {
  try {
    write("CLAUDE.md", withBatchLine(read("CLAUDE.md").text, { to, date: manifest.date, clauses }));
  } catch (error) {
    fail(error.message);
  }
  if (existsSync("docs/QUEUE.md")) {
    try {
      write("docs/QUEUE.md", withReleasedRow(read("docs/QUEUE.md").text, { to, clauses }));
    } catch (error) {
      console.log(`(${error.message}: no Released row written)`);
    }
  }
}
const landedFiles = treeEntries.map((t) => t.file);

if (manual.length) console.log(`\n§NNN lines no branch wrote (a merge resolved them) — number these by hand:\n  ${manual.join("\n  ")}`);
if (missing.length) console.log(`\nrequirements not found in SPECS.md — add their criteria by hand:\n  ${missing.join("\n  ")}`);
const notes = entries.filter((e) => String(e.raw?.docsNotes ?? "").trim()).map((e) => `§${e.n}: ${e.raw.docsNotes.trim()}`);
if (notes.length) console.log(`\ndocsNotes — text other documents need, by hand:\n  ${notes.join("\n  ")}`);

// Unattended nobody reads a log: hand work stops the landing before a file is written.
if (TREE) {
  const refused = handWork({ docsNotes: notes, missing, manual });
  if (refused.length) fail(`--tree cannot land what needs a person:\n    ${refused.join("\n    ")}`);
}
summary(
  [
    `### Landing \`${from}\` → \`${to}\`${APPLY ? "" : " (dry run)"}`,
    "",
    ...entries.map((e) => `- §${e.n} ← \`${e.branch ?? e.source}\`: ${e.title}`),
    ...(notes.length ? ["", "**Text other documents need, by hand:**", ...notes.map((n) => `- ${n}`)] : []),
    ...(missing.length ? ["", "**Requirements not in SPECS.md:**", ...missing.map((m) => `- ${m}`)] : []),
    ...(manual.length ? ["", "**Decision placeholders to number by hand:**", ...manual.map((m) => `- \`${m}\``)] : []),
    "",
  ].join("\n"),
);

const dirty = [...files].filter(([, f]) => f.dirty);
if (!APPLY) {
  const gone = landedFiles.length ? `; ${landedFiles.length} ${ENTRY_DIR}/ entries would be deleted` : "";
  console.log(`\ndry run: ${dirty.length} files would change (${dirty.map(([p]) => p).join(", ")})${gone}. Add --apply.`);
  console.log(`release: ${from} → ${to} — ${title}`);
  process.exit(0);
}
for (const [path, f] of dirty) writeFileSync(path, f.eol === "\r\n" ? f.text.replace(/\n/g, "\r\n") : f.text);
for (const file of landedFiles) unlinkSync(file);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `from=${from}\nto=${to}\ntitle=${title.replace(/[\r\n]+/g, " ")}\n`);
}
const next = TREE ? "yarn docs:check, then commit" : "docs/QUEUE.md and the CLAUDE.md batch line, then yarn check";
console.log(`\napplied: ${dirty.length} files, ${landedFiles.length} ${ENTRY_DIR}/ entries deleted. Next: ${next}.`);
