#!/usr/bin/env node
/**
 * Apply the committed migrations to one named environment, deliberately.
 *
 * Usage: node scripts/db-migrate.mjs <local|qa|production> [--yes]
 *        yarn db:migrate:env qa
 *
 * Why this exists rather than `yarn db:migrate` with an environment variable pasted in front of
 * it: nothing applies migrations to a deployed database. AGENTS.md §7.6 forbids migrating from a
 * build or from application startup — a destructive migration must never run because a page was
 * requested — so the step is a deliberate one, and a deliberate step that lives only in
 * somebody's shell history is a step that gets skipped. It was, once, and the QA landing page
 * returned 500 until somebody noticed (`DECISIONS.md` §31).
 *
 * What it adds over the raw drizzle-kit command:
 *
 *   - the target environment is an argument, so the connection string cannot be the one that
 *     happened to be exported in this shell;
 *   - it prints which database it is about to touch, credentials masked, and exactly which
 *     migrations are pending, before it applies anything;
 *   - production needs `--yes`, so the gated step §7.6 asks for is the default rather than a
 *     convention;
 *   - it exits non-zero on failure, which is what lets the workflow that calls it block a
 *     release.
 *
 * It does not read `drizzle.config.ts`, on purpose: that file loads `.env.local`, and a
 * migration tool whose target depends on which dotenv file happens to be present is exactly the
 * accident this is preventing.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const ROOT = process.cwd();
const MIGRATIONS_FOLDER = path.join(ROOT, "src", "db", "migrations");
const ENVIRONMENTS = ["local", "qa", "production"];

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/** Never print a connection string: it carries the password. */
function describe(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "an unparseable connection string";
  }
}

/**
 * One environment, one variable. `local` alone falls back to `DATABASE_URL`, because that is
 * what every developer's `.env.local` already holds and asking them to duplicate it would be
 * the kind of ceremony people route around.
 */
function resolveUrl(environment) {
  const named = process.env[`DATABASE_URL_${environment.toUpperCase()}`];
  if (named) return named;
  if (environment === "local" && process.env.DATABASE_URL) return process.env.DATABASE_URL;

  fail(
    `No connection string for "${environment}". Set DATABASE_URL_${environment.toUpperCase()} — ` +
      `in .env.local for a one-off, or as that environment's secret in CI.`,
  );
}

async function readJournal() {
  const raw = await readFile(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8");
  const journal = JSON.parse(raw);
  return journal.entries ?? [];
}

/**
 * What has been applied, from Drizzle's own bookkeeping table.
 *
 * `created_at` there is the `when` of the journal entry that produced the row, so the newest
 * one identifies the applied head exactly. A database nobody has migrated has no table at all,
 * which is a state to report rather than an error.
 */
async function readApplied(db) {
  const present = await db.execute(
    `select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
  );
  if (!present.rows[0]?.present) return null;

  const applied = await db.execute(
    `select max(created_at)::text as applied_when from drizzle.__drizzle_migrations`,
  );
  return applied.rows[0]?.applied_when ?? null;
}

async function main() {
  const [environment, ...flags] = process.argv.slice(2);
  const confirmed = flags.includes("--yes");

  if (!ENVIRONMENTS.includes(environment)) {
    fail(`Usage: node scripts/db-migrate.mjs <${ENVIRONMENTS.join("|")}> [--yes]`);
  }
  if (environment === "production" && !confirmed) {
    fail(
      "Refusing to migrate production without --yes. AGENTS.md §7.6: a production migration is " +
        "explicit, gated and observable. Read the pending list on qa first.",
    );
  }

  const url = resolveUrl(environment);
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  try {
    console.log(`\n  target      ${environment}`);
    console.log(`  database    ${describe(url)}`);

    const entries = await readJournal();
    const appliedWhen = await readApplied(db);
    const pending = entries.filter((entry) => !appliedWhen || BigInt(entry.when) > BigInt(appliedWhen));

    console.log(`  head here   ${entries.at(-1)?.tag ?? "(none)"}`);
    console.log(`  head there  ${appliedWhen ? entries.find((e) => String(e.when) === appliedWhen)?.tag ?? appliedWhen : "(never migrated)"}`);

    if (pending.length === 0) {
      console.log(`\n  Already up to date. Nothing to apply.\n`);
      return;
    }

    console.log(`\n  ${pending.length} migration(s) to apply:`);
    for (const entry of pending) console.log(`    - ${entry.tag}`);

    // Drizzle's migrator is what runs the SQL: same code path as `yarn db:migrate` and the
    // in-process test database, so a migration cannot pass here and fail there.
    console.log("");
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const nowApplied = await readApplied(db);
    console.log(
      `  Applied. ${environment} is now on ${entries.find((e) => String(e.when) === nowApplied)?.tag ?? nowApplied}.\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  // Non-zero, loudly: "failed migration blocks deployment" (§7.6) is only true if the caller
  // can tell.
  console.error("\n  Migration failed:", error instanceof Error ? error.message : error, "\n");
  process.exit(1);
});
