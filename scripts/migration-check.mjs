// Expand and contract may not share a migration (AGENTS.md §7.6, DECISIONS.md §62): old code keeps
// serving while a migration runs, so a drop must ship in the release after the code stopped using
// it. An expand only adds; a contract drops, renames, retypes or sets NOT NULL, and must carry a
// `-- contract:` line naming that release. A leading `-- expand:` / `-- contract:` line overrides
// the classification. Migrations before 0024 predate the rule.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIGRATIONS = path.join("src", "db", "migrations");
/** The first migration the rule applies to. */
export const FIRST_CHECKED_INDEX = 24;

const CONTRACT = /\b(DROP\s+(COLUMN|TABLE|TYPE)|RENAME\s+(COLUMN|TO)|ALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE|SET\s+NOT\s+NULL)\b/i;
const EXPAND = /\b(CREATE\s+(TABLE|TYPE|UNIQUE\s+INDEX|INDEX)|ADD\s+(COLUMN|CONSTRAINT|VALUE)|INSERT\s+INTO|UPDATE\s+\S+\s+SET)\b/i;

/** An index's or constraint's name, quoted or bare, optionally schema-qualified. */
const NAME = String.raw`((?:"[^"]+"|\w+)(?:\s*\.\s*(?:"[^"]+"|\w+))?)`;
const nameOf = (raw) => raw.split(".").pop().trim().replace(/^"|"$/g, "").toLowerCase();

/**
 * `DROP INDEX` and `DROP CONSTRAINT` are contracts too (§426): the serving code may rely on a
 * uniqueness or a foreign key. Not a contract: dropping a name the same file creates again, or a
 * CHECK constraint (it only refuses rows).
 */
const DROP_OBJECT = new RegExp(String.raw`\bDROP\s+(INDEX|CONSTRAINT)\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?${NAME}`, "gi");
const CREATE_INDEX = new RegExp(String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?${NAME}`, "gi");
const DEFINE_CONSTRAINT = new RegExp(String.raw`\bCONSTRAINT\s+${NAME}\s+(CHECK|UNIQUE|PRIMARY|FOREIGN|EXCLUDE)\b`, "gi");

/** SQL without its comments, so a comment quoting `DROP COLUMN` is not a drop. */
function withoutComments(sql) {
  return sql.replace(/--[^\n]*/g, "");
}

/** The constraints a migration defines, name → kind (`CHECK`, `UNIQUE`, …). */
export function constraintKindsIn(sql) {
  const kinds = new Map();
  for (const match of withoutComments(sql).matchAll(DEFINE_CONSTRAINT)) kinds.set(nameOf(match[1]), match[2].toUpperCase());
  return kinds;
}

/** The names a file drops with `DROP INDEX` or `DROP CONSTRAINT` that take something away. */
function contractingDrops(code, checkConstraints) {
  const created = new Set([...code.matchAll(CREATE_INDEX), ...code.matchAll(DEFINE_CONSTRAINT)].map((m) => nameOf(m[1])));
  const drops = [];
  for (const match of code.matchAll(DROP_OBJECT)) {
    const name = nameOf(match[2]);
    if (created.has(name)) continue;
    if (match[1].toUpperCase() === "CONSTRAINT" && checkConstraints.has(name)) continue;
    drops.push(name);
  }
  return drops;
}

/**
 * What a migration does, as two booleans and whether it carries the contract note.
 * `checkConstraints` are the CHECK constraints earlier migrations created.
 */
export function auditMigration(sql, checkConstraints = new Set()) {
  const code = withoutComments(sql);
  const override = sql.match(/^--\s*(expand|contract):\s*\S/m)?.[1]?.toLowerCase();
  let expands = EXPAND.test(code);
  let contracts = CONTRACT.test(code) || contractingDrops(code, checkConstraints).length > 0;
  if (override === "expand") contracts = false;
  if (override === "contract") expands = false;
  return {
    expands,
    contracts,
    hasContractNote: /^--\s*contract:\s*\S/m.test(sql),
  };
}

export function problemsFor(name, sql, checkConstraints = new Set()) {
  const audit = auditMigration(sql, checkConstraints);
  const problems = [];
  if (audit.expands && audit.contracts) {
    problems.push(
      `${name}: expands and contracts in one file. Split it: add and backfill now, drop in the ` +
        `release after the code stopped reading what it drops (AGENTS.md §7.6).`,
    );
  }
  if (audit.contracts && !audit.hasContractNote) {
    problems.push(
      `${name}: a contract migration needs a "-- contract: <which release stopped using this>" ` +
        `line, so the drop is provably later than the code change.`,
    );
  }
  return problems;
}

async function main() {
  const files = (await readdir(MIGRATIONS)).filter((file) => /^\d{4}_.*\.sql$/.test(file)).sort();
  const problems = [];
  // The history is read too: an earlier CHECK makes a later drop of it a loosening.
  const checkConstraints = new Set();
  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS, file), "utf8");
    if (Number(file.slice(0, 4)) >= FIRST_CHECKED_INDEX) problems.push(...problemsFor(file, sql, checkConstraints));
    for (const [name, kind] of constraintKindsIn(sql)) {
      if (kind === "CHECK") checkConstraints.add(name);
      else checkConstraints.delete(name);
    }
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`migrations:check: ${problem}`);
    process.exit(1);
  }
  const checked = files.filter((file) => Number(file.slice(0, 4)) >= FIRST_CHECKED_INDEX).length;
  console.log(`migrations:check passed (${checked} migration${checked === 1 ? "" : "s"} checked).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`migrations:check: ${error.message}`);
    process.exit(1);
  });
}
