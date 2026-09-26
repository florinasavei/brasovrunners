// Expand and contract may not share a migration — the discipline half of "a deployment never
// runs against the wrong schema" (AGENTS.md §7.6, DECISIONS.md §62). `yarn check` runs this.
//
// `wait-for-migration.mjs` makes a build wait until the database has the schema the build
// expects, so new code never meets an old schema. The other direction is not a script's to
// fix: while the migration runs and until the new build is live, the *old* code is serving,
// and a migration that drops a column it reads breaks it for exactly that long. That is what
// happened on 2026-09-17, and the only thing that prevents it is the shape of the migration:
//
//   - an **expand** migration only adds — a table, a type, a column, an index, a value, a
//     backfill. Old code does not know the new things exist and keeps working;
//   - a **contract** migration only removes or reshapes — drops (a column, a table, a type, an
//     index, a constraint), renames, type changes, NOT NULL on an existing column — and ships in the release *after* the code stopped using
//     what it removes, so neither the old code nor the new one needs it.
//
// A file that does both is refused. A contract file must also carry a `-- contract:` line
// saying which release removed the code's use of what it drops, so the person writing it has
// to answer that question before CI does. Migrations up to 0023 predate the rule and are left
// alone; 0023 is the one that taught it.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIGRATIONS = path.join("src", "db", "migrations");
/** The first migration the rule applies to. Everything before it is history. */
export const FIRST_CHECKED_INDEX = 24;

const CONTRACT = /\b(DROP\s+(COLUMN|TABLE|TYPE)|RENAME\s+(COLUMN|TO)|ALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE|SET\s+NOT\s+NULL)\b/i;
const EXPAND = /\b(CREATE\s+(TABLE|TYPE|UNIQUE\s+INDEX|INDEX)|ADD\s+(COLUMN|CONSTRAINT|VALUE)|INSERT\s+INTO|UPDATE\s+\S+\s+SET)\b/i;

/**
 * An index's or a constraint's name as SQL writes it: quoted or bare, optionally behind a schema
 * (`"public"."x"`). `nameOf` reduces it to the part that identifies the object.
 */
const NAME = String.raw`((?:"[^"]+"|\w+)(?:\s*\.\s*(?:"[^"]+"|\w+))?)`;
const nameOf = (raw) => raw.split(".").pop().trim().replace(/^"|"$/g, "").toLowerCase();

/**
 * `DROP INDEX` and `DROP CONSTRAINT` are contracts too (§NNN): migration 0073 dropped the unique
 * index that held one registration per address, which the serving code relied on, and passed as
 * neither expand nor contract because neither word was on the list above. A dropped uniqueness,
 * foreign key or index can break the code still serving — an `ON CONFLICT` whose target is gone,
 * a query that reads "one row" and now gets two, a cascade that no longer happens.
 *
 * Two drops are not contracts, because they cannot take anything from the serving code:
 *   - a drop of a name the same file creates again (`DROP INDEX x` … `CREATE UNIQUE INDEX x`,
 *     migration 0080): the object is replaced, and the creation is classified as what it is;
 *   - a drop of a CHECK constraint an earlier migration created (migration 0024): a CHECK only
 *     refuses rows, so dropping it lets the old code write everything it wrote before.
 */
const DROP_OBJECT = new RegExp(String.raw`\bDROP\s+(INDEX|CONSTRAINT)\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?${NAME}`, "gi");
const CREATE_INDEX = new RegExp(String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?${NAME}`, "gi");
const DEFINE_CONSTRAINT = new RegExp(String.raw`\bCONSTRAINT\s+${NAME}\s+(CHECK|UNIQUE|PRIMARY|FOREIGN|EXCLUDE)\b`, "gi");

/** SQL without its comments, so a comment quoting `DROP COLUMN` is not a drop. */
function withoutComments(sql) {
  return sql.replace(/--[^\n]*/g, "");
}

/**
 * The constraints a migration defines, name → kind (`CHECK`, `UNIQUE`, `PRIMARY`, `FOREIGN`,
 * `EXCLUDE`) — inline in a `CREATE TABLE` or through `ADD CONSTRAINT`. The check collects the
 * CHECK ones from the files before the one it audits.
 */
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
 * What a migration file does, as two booleans and the note a contract must carry.
 *
 * `checkConstraints` are the CHECK constraints earlier migrations created (`constraintKindsIn`),
 * so that dropping one reads as the loosening it is. Pure, so the rule is testable without a
 * filesystem.
 */
export function auditMigration(sql, checkConstraints = new Set()) {
  const code = withoutComments(sql);
  return {
    expands: EXPAND.test(code),
    contracts: CONTRACT.test(code) || contractingDrops(code, checkConstraints).length > 0,
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
  // Every file is read, the history too: a CHECK created in 0006 is what makes 0024's drop of it
  // a loosening rather than a contract.
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
