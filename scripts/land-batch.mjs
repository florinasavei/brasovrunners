#!/usr/bin/env node
/**
 * Land one batch's documentation from the chains' structured results — the docs step of `docs/DISPATCHER.md`.
 *
 * Usage: yarn docs:land <manifest.json> [--apply]      (from the batch branch's checkout; a dry run without --apply)
 *
 * The implementers are told not to touch DECISIONS.md, CHANGELOG.md, SPECS.md or a baseline marker, and to
 * cite their decision in code as `§NNN`: several branches cannot share one tail of DECISIONS.md, one open
 * CHANGELOG section and one next number. This does, once per batch, in five steps:
 *
 *   1. bumps the baseline `from` → `to` in every file that carries it, except the two that keep history:
 *      DECISIONS.md moves only its marker and its title line (each shipped section keeps its own
 *      "Baseline `…`." footer) and CHANGELOG.md gets a new section above the old one;
 *   2. numbers the items in the manifest's order from the first free `§` in DECISIONS.md — first rewriting,
 *      in every landed field, a literal `§N` above that first free number to `§NNN`, since it can only be a
 *      guess at a number nobody assigned yet, never a citation of a decision already in the file
 *      (`land-entry.mjs`'s `rewriteFreeSectionRefs`), and printing each one it rewrites;
 *   3. replaces every `§NNN` in tracked files with its item's number, by the commit that wrote the line
 *      (git blame against the commits `base..branch`); a line written by a merge is listed for a hand decision;
 *   4. appends each item's section to DECISIONS.md — the fixer's text if a fix round rewrote it, plus every
 *      later round's addendum, less any fixer's housekeeping — and its CHANGELOG bullet: the implementer's,
 *      or the item's own `changelog`, never a fixer's (`land-entry.mjs` says why);
 *   5. adds or amends the SPECS.md acceptance criteria, the latest stage winning per requirement.
 *
 * It stops, before writing anything, on a blank fix report (a round with no result or no summary), a blank
 * `decisionsTitle` and a blank bullet; a manifest item's `title` and `changelog` override the results'.
 *
 * manifest.json (it lives outside the repository, beside the saved results; it names local paths):
 *   {
 *     "baseline": { "from": "BR-V1.81-2026-09-24", "to": "BR-V2.00-2026-09-25" },
 *     "date": "2026-09-24",                      // the date in the SPECS criteria
 *     "base": "origin/qa",                       // optional; where the branches forked
 *     "items": [
 *       { "branch": "feat/x", "chain": "<br-chain result>.json", "rounds": ["<br-fix-round result>.json"] },
 *       { "branch": "feat/y", "chain": "…", "title": "optional: the § title", "changelog": "optional: the bullet" },
 *       { "chain": "<the orchestrator's own entry, { impl: { decisionsTitle, decisionsSection, … } }>.json" }
 *     ]
 *   }
 * A result file is the Workflow's return value as saved: `{ impl, review, fixed, rereview }` from br-chain,
 * `{ fixed, rereview }` from br-fix-round; text before the first `{` and a `{ result: … }` wrapper are ignored.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { entryFromResults, requirementOf, rewriteFreeSectionRefs } from "./land-entry.mjs";

const [manifestPath, flag] = process.argv.slice(2);
const APPLY = flag === "--apply";
if (!manifestPath) fail("Usage: yarn docs:land <manifest.json> [--apply]");

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
const BASELINE = /^BR-V\d+\.\d+-\d{4}-\d{2}-\d{2}$/;

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const here = dirname(resolve(manifestPath));
const { from, to } = manifest.baseline ?? {};
if (!BASELINE.test(from ?? "") || !BASELINE.test(to ?? "")) fail("manifest.baseline needs from and to, like BR-V1.81-2026-09-24");
if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.date ?? "")) fail("manifest.date needs YYYY-MM-DD");
if (!Array.isArray(manifest.items) || manifest.items.length === 0) fail("manifest.items is empty");
const BASE = manifest.base ?? "origin/qa";

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
 * One item's title, body, bullet and criteria, by the rules in `land-entry.mjs`: a blank fix
 * report, a blank title or a blank bullet stops the landing; a fixer's bullet and its housekeeping
 * ("carried forward", "no DECISIONS.md edit was made") never land, and the dry run says so.
 */
function itemEntry(item) {
  const label = item.branch ?? item.chain;
  try {
    const entry = entryFromResults(loadResult(item.chain), (item.rounds ?? []).map(loadResult), item, label);
    for (const note of entry.notes) console.log(`  ${label}: ${note}`);
    return { branch: item.branch, ...entry };
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
const entries = manifest.items.map((item, i) => ({ n: last + 1 + i, ...itemEntry(item) }));
// A literal §N above `last` is a guess, not a citation of an existing decision — §NNN before it is numbered.
for (const e of entries) {
  for (const rewrite of rewriteFreeSectionRefs(e, last)) console.log(`  ${e.branch}: rewrote a free ${rewrite}`);
}
for (const e of entries) console.log(`§${e.n} ← ${e.branch}: ${e.title}`);

// 3. §NNN in the code, by the commit that wrote each line.
const numberOf = new Map();
for (const e of entries) {
  if (!e.branch) continue; // an entry written by the orchestrator itself cites its number directly
  let list = "";
  try {
    list = git("rev-list", `${BASE}..${e.branch}`);
  } catch {
    console.log(`(no branch ${e.branch}: its §NNN lines will be listed for a hand decision)`);
  }
  for (const sha of list.trim().split("\n").filter(Boolean)) if (!numberOf.has(sha)) numberOf.set(sha, e.n);
}
// The files that explain the placeholder mention it on purpose.
const MENTIONS = new Set(["scripts/land-batch.mjs", "docs/DISPATCHER.md", ".claude/workflows/br-chain.js", ".claude/workflows/br-fix-round.js"]);
// A line already on the base mentions the placeholder on purpose too; only this batch's lines are numbered.
const inBatch = new Set(git("rev-list", `${BASE}..HEAD`).trim().split("\n").filter(Boolean));
const UNCOMMITTED = "0".repeat(40);
const manual = [];
let grep = "";
try {
  grep = git("grep", "-l", "-F", "§NNN");
} catch {
  // git grep exits 1 when nothing matches
}
for (const file of grep.trim().split("\n").filter((f) => f && !MENTIONS.has(f))) {
  const shas = [];
  for (const line of git("blame", "--line-porcelain", "--", file).split("\n")) {
    const m = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (m) shas[Number(m[2]) - 1] = m[1];
  }
  const lines = read(file).text.split("\n");
  lines.forEach((line, i) => {
    if (!line.includes("§NNN")) return;
    const sha = shas[i];
    const n = sha && numberOf.get(sha);
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

if (manual.length) console.log(`\n§NNN lines no branch wrote (a merge resolved them) — number these by hand:\n  ${manual.join("\n  ")}`);
if (missing.length) console.log(`\nrequirements not found in SPECS.md — add their criteria by hand:\n  ${missing.join("\n  ")}`);

const dirty = [...files].filter(([, f]) => f.dirty);
if (!APPLY) {
  console.log(`\ndry run: ${dirty.length} files would change (${dirty.map(([p]) => p).join(", ")}). Add --apply.`);
  process.exit(0);
}
for (const [path, f] of dirty) writeFileSync(path, f.eol === "\r\n" ? f.text.replace(/\n/g, "\r\n") : f.text);
console.log(`\napplied: ${dirty.length} files. Next: docs/QUEUE.md and the CLAUDE.md batch line, then yarn check.`);
