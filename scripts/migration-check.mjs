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
//   - a **contract** migration only removes or reshapes — drops, renames, type changes,
//     NOT NULL on an existing column — and ships in the release *after* the code stopped using
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

/** SQL without its comments, so a comment quoting `DROP COLUMN` is not a drop. */
function withoutComments(sql) {
  return sql.replace(/--[^\n]*/g, "");
}

/**
 * What a migration file does, as two booleans and the note a contract must carry.
 *
 * Pure, so the rule is testable without a filesystem.
 */
export function auditMigration(sql) {
  const code = withoutComments(sql);
  return {
    expands: EXPAND.test(code),
    contracts: CONTRACT.test(code),
    hasContractNote: /^--\s*contract:\s*\S/m.test(sql),
  };
}

export function problemsFor(name, sql) {
  const audit = auditMigration(sql);
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
  for (const file of files) {
    if (Number(file.slice(0, 4)) < FIRST_CHECKED_INDEX) continue;
    const sql = await readFile(path.join(MIGRATIONS, file), "utf8");
    problems.push(...problemsFor(file, sql));
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
