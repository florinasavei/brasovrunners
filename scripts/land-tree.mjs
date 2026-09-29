/**
 * Release facts that travel with the branch (§535) — the pure half of `yarn docs:land --tree`.
 *
 * Until now a change's DECISIONS section, CHANGELOG bullet and SPECS criteria lived in the
 * dispatcher's scratchpad as a workflow's saved result, and only the machine that ran the chain
 * could land them. A branch now carries them itself: one JSON file per change in `.release/`,
 * the same fields an implementer returns (`.claude/workflows/br-chain.js`), committed with the
 * code. Whoever lands the branch — the dispatcher on the PC, or `.github/workflows/release.yml`
 * started from a phone — reads them from the tree, numbers them, and deletes them in the landing
 * commit, so no file is landed twice.
 *
 * Kept apart from `land-batch.mjs`, which writes files on import, so these rules are testable.
 */

import { PLACEHOLDER } from "./land-entry.mjs";

/** Where the pending entries live, one `<branch slug>.json` per change. */
export const ENTRY_DIR = ".release";

const REQUIREMENT = /^BR-REQ-\d{3}-\d{2}$/;
const BASELINE = /^BR-V(\d+)\.(\d+)-(\d{4}-\d{2}-\d{2})$/;

/** A branch name as a file name: `feat/x` → `feat-x`. */
export function slugOf(branch) {
  return String(branch ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "");
}

/** The entry file a branch writes: `.release/feat-x.json`. */
export function entryPathOf(branch) {
  return `${ENTRY_DIR}/${slugOf(branch)}.json`;
}

const blank = (value) => typeof value !== "string" || !value.trim();

/**
 * What is wrong with one entry, as sentences naming `label` — empty when it can land. An entry
 * holds `branch`, `decisionsTitle`, `decisionsSection` and `changelogLine`, and may hold
 * `specsCriteria` (each a full `BR-REQ-NNN-NN` id and a text), `docsNotes` and `batchLine` —
 * the short clause for the queue's Released row.
 *
 * With `requirements` (the ids SPECS.md defines), a criterion naming one SPECS.md does not have
 * is a problem too — `yarn docs:check` passes them, so a bad entry fails on its pull request,
 * not at release time. `docsNotes` is allowed here (a PC landing prints it for a person);
 * `handWork` says whether an unattended landing can take the entry.
 */
export function validateEntry(entry, label = "entry", { requirements } = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [`${label}: not a JSON object`];
  const problems = [];
  for (const field of ["branch", "decisionsTitle", "decisionsSection", "changelogLine"]) {
    if (blank(entry[field])) problems.push(`${label}: "${field}" is missing or blank`);
  }
  if (entry.specsCriteria !== undefined) {
    if (!Array.isArray(entry.specsCriteria)) problems.push(`${label}: "specsCriteria" must be a list`);
    else {
      entry.specsCriteria.forEach((c, i) => {
        if (!c || typeof c !== "object") return problems.push(`${label}: specsCriteria[${i}] is not an object`);
        if (!REQUIREMENT.test(String(c.requirement ?? ""))) problems.push(`${label}: specsCriteria[${i}].requirement must be a full BR-REQ-NNN-NN id, got "${c.requirement}"`);
        else if (requirements && !requirements.has(c.requirement)) problems.push(`${label}: specsCriteria[${i}].requirement ${c.requirement} is not a requirement in SPECS.md`);
        if (blank(c.text)) problems.push(`${label}: specsCriteria[${i}].text is blank`);
      });
    }
  }
  for (const field of ["docsNotes", "batchLine"]) {
    if (entry[field] !== undefined && typeof entry[field] !== "string") problems.push(`${label}: "${field}" must be text`);
  }
  if (!blank(entry.branch) && !blank(label) && label.endsWith(".json") && !label.endsWith(`/${slugOf(entry.branch)}.json`)) {
    problems.push(`${label}: the file is named for another branch — "${entry.branch}" writes ${entryPathOf(entry.branch)}`);
  }
  return problems;
}

/**
 * What an unattended landing (`--tree`, on GitHub Actions) cannot do and must refuse: text an
 * entry leaves for a person in `docsNotes`, requirements SPECS.md lacks, and decision-placeholder
 * lines no branch wrote. Each is a sentence; empty means the landing needs nobody. A branch writes the
 * README, SETUP and docs text itself (`.release/README.md`), so `docsNotes` stays empty.
 *
 * @param {{ docsNotes?: string[], missing?: string[], manual?: string[] }} work
 * @returns {string[]}
 */
export function handWork({ docsNotes = [], missing = [], manual = [] }) {
  const problems = [];
  for (const note of docsNotes) problems.push(`docsNotes left for a person — write it on the branch and empty the field: ${note}`);
  for (const m of missing) problems.push(`a criterion for a requirement SPECS.md does not have: ${m}`);
  for (const m of manual) problems.push(`a ${PLACEHOLDER} line no branch wrote, to number by hand: ${m}`);
  return problems;
}

/** Two entries for one branch cannot both land: the sentences naming them, or none. */
export function duplicateBranches(entries) {
  const seen = new Map();
  const problems = [];
  for (const { file, entry } of entries) {
    const branch = String(entry?.branch ?? "").trim();
    if (!branch) continue;
    if (seen.has(branch)) problems.push(`${seen.get(branch)} and ${file} are both for ${branch}`);
    else seen.set(branch, file);
  }
  return problems;
}

/** Entries in the order they were added to the branch — the order their numbers are handed out. */
export function orderEntries(entries) {
  return [...entries].sort((a, b) => (a.addedAt ?? Infinity) - (b.addedAt ?? Infinity) || a.file.localeCompare(b.file));
}

/** `BR-V2.16-2026-09-27` → { major: 2, minor: 16, date }; null for anything else. */
export function parseBaseline(value) {
  const m = String(value ?? "").match(BASELINE);
  return m ? { major: Number(m[1]), minor: Number(m[2]), date: m[3] } : null;
}

const format = (major, minor, date) => `BR-V${major}.${String(minor).padStart(2, "0")}-${date}`;

/** The baseline after `current`, dated `date`: two digits after the dot, always (`BR-V2.NN`). */
export function nextBaseline(current, date) {
  const b = parseBaseline(current);
  if (!b) throw new Error(`not a baseline: ${current}`);
  return b.minor >= 99 ? format(b.major + 1, 0, date) : format(b.major, b.minor + 1, date);
}

/**
 * A baseline typed by a person — `BR-V2.18`, `V2.18`, `2.18` or the whole `BR-V2.18-<date>` —
 * as the whole baseline, dated `date` unless it carries its own date. Throws on anything else.
 */
export function normalizeBaseline(input, date) {
  const raw = String(input ?? "").trim();
  if (parseBaseline(raw)) return raw;
  const m = raw.match(/^(?:BR-)?V?(\d+)\.(\d{1,2})$/i);
  if (!m) throw new Error(`not a baseline: "${raw}" — write it like BR-V2.18`);
  return format(Number(m[1]), Number(m[2]), date);
}

/**
 * The baseline a person typed (`--to`, the release workflow's `baseline` input), normalized, and
 * refused unless it comes after `current` — a typo on a phone such as `2.1` would otherwise land a
 * baseline that goes backwards. Throws with a sentence to show.
 */
export function typedBaseline(input, current, date) {
  const to = normalizeBaseline(input, date);
  const a = parseBaseline(to);
  const b = parseBaseline(current);
  if (!b) throw new Error(`not a baseline: ${current}`);
  if (a.major < b.major || (a.major === b.major && a.minor <= b.minor)) {
    throw new Error(`${shortBaseline(to)} does not come after the current ${shortBaseline(current)} — give a higher number, or leave it empty for the next one`);
  }
  return to;
}

/** The baseline without its date, as the queue writes it: `BR-V2.17`. */
export const shortBaseline = (baseline) => String(baseline).replace(/-\d{4}-\d{2}-\d{2}$/, "");

/** Today's date where the club is, `YYYY-MM-DD` — a landing at 01:00 in Brașov is dated that day, not UTC's. */
export function todayIn(timeZone = "Europe/Bucharest", now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The baseline CLAUDE.md shows, from its `**Baseline `…`**` line. */
export function currentBaseline(claudeText) {
  const m = String(claudeText ?? "").match(/\*\*Baseline `(BR-V\d+\.\d+-\d{4}-\d{2}-\d{2})`\*\*/);
  if (!m) throw new Error("CLAUDE.md shows no **Baseline `BR-V…`** line");
  return m[1];
}

/** One entry's clause for the queue: its `batchLine`, else its title, as written, and its number. */
export function clauseOf(entry, n) {
  const words = (blank(entry.batchLine) ? entry.decisionsTitle : entry.batchLine).trim().replace(/\.$/, "");
  return `${words.replaceAll(PLACEHOLDER, `§${n}`)} (§${n})`;
}

/** The release's title for the PR and `yarn ship`: the clauses without their numbers, at most `max` characters. */
export function releaseTitle(clauses, max = 180) {
  const joined = clauses.map((c) => c.replace(/ \(§\d+\)$/, "")).join(" · ");
  const counted = clauses.length > 1 ? `${joined}: ${clauses.length} changes` : joined;
  return counted.length <= max ? counted : `${counted.slice(0, max - 1).trimEnd()}…`;
}

/** docs/QUEUE.md with the release as the newest row of its Released table. Throws when that table is gone. */
export function withReleasedRow(text, { to, clauses }) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const section = lines.findIndex((l) => l === "## Released");
  const rule = section < 0 ? -1 : lines.findIndex((l, i) => i > section && l.startsWith("| --- |"));
  if (rule < 0) throw new Error("docs/QUEUE.md: no ## Released table");
  lines.splice(rule + 1, 0, `| \`${shortBaseline(to)}\` | ${clauses.join(" · ")} |`);
  return lines.join(eol);
}

/**
 * Which item numbers a line holding the placeholder: the item whose commits include the line's
 * commit; when the batch holds one item, every line this batch wrote is that item's — the phone's
 * release of one branch, whose merge with `qa` is a commit no branch list names. Null when the
 * line is not this batch's (it mentions the placeholder on purpose) or cannot be told apart.
 */
export function numberForLine({ sha, numberOf, inBatch, uncommitted, onlyNumber }) {
  if (sha && numberOf.has(sha)) return numberOf.get(sha);
  const ours = sha === uncommitted || inBatch.has(sha);
  if (ours && onlyNumber != null) return onlyNumber;
  return null;
}
