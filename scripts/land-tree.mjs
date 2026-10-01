/**
 * Release facts that travel with the branch (§535) — the pure, testable half of
 * `yarn docs:land --tree`. One `.release/<branch>.json` per change carries the fields an
 * implementer returns; the landing numbers them and deletes them in the landing commit.
 */

import { PLACEHOLDER } from "./land-entry.mjs";

/** Where the pending entries live, one `<branch slug>.json` per change. */
export const ENTRY_DIR = ".release";

const REQUIREMENT = /^BR-REQ-\d{3}-\d{2}$/;
const BASELINE = /^BR-V(\d+)\.(\d+)-(\d{4}-\d{2}-\d{2})$/;

export function slugOf(branch) {
  return String(branch ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "");
}

export function entryPathOf(branch) {
  return `${ENTRY_DIR}/${slugOf(branch)}.json`;
}

const blank = (value) => typeof value !== "string" || !value.trim();

/**
 * What is wrong with one entry, as sentences naming `label`; empty when it can land. With
 * `requirements` (SPECS.md's ids, from `yarn docs:check`) an unknown requirement fails on the
 * pull request rather than at release time.
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
 * What an unattended landing (`--tree`) must refuse: `docsNotes`, requirements SPECS.md lacks and
 * placeholder lines no branch wrote. Empty means the landing needs nobody.
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

/** `BR-V2.18`, `V2.18`, `2.18` or a whole baseline, as a whole baseline dated `date` unless it has one. */
export function normalizeBaseline(input, date) {
  const raw = String(input ?? "").trim();
  if (parseBaseline(raw)) return raw;
  const m = raw.match(/^(?:BR-)?V?(\d+)\.(\d{1,2})$/i);
  if (!m) throw new Error(`not a baseline: "${raw}" — write it like BR-V2.18`);
  return format(Number(m[1]), Number(m[2]), date);
}

/** A typed baseline, normalized and refused unless it comes after `current` (a typo like `2.1`). */
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

/** Today's date in the club's zone, `YYYY-MM-DD`, not UTC's. */
export function todayIn(timeZone = "Europe/Bucharest", now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

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
 * The item number for a placeholder line: the item whose commits include the line's commit; with
 * one item, every line this batch wrote. Null when not this batch's — and null for a line a merge
 * commit wrote (a conflict a merge resolved), whatever the item count: nobody's branch wrote it,
 * so it is listed for a hand decision rather than given the one item's number (§NNN).
 */
export function numberForLine({ sha, numberOf, inBatch, uncommitted, onlyNumber, merges = new Set() }) {
  if (merges.has(sha)) return null;
  if (sha && numberOf.has(sha)) return numberOf.get(sha);
  const ours = sha === uncommitted || inBatch.has(sha);
  if (ours && onlyNumber != null) return onlyNumber;
  return null;
}
