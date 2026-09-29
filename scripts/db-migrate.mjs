#!/usr/bin/env node
/**
 * Apply the committed migrations to one named environment, deliberately.
 *
 * Usage: node scripts/db-migrate.mjs <local|qa|production> [--yes]
 *        yarn db:migrate:env qa
 *
 * Migrating is never done by a build or at startup (AGENTS.md §7.6, `DECISIONS.md` §31), so it is
 * this explicit step: the target is an argument, the database and pending migrations are printed
 * first, production needs `--yes`, and a failure exits non-zero to block the release. It does not
 * read `drizzle.config.ts`, which loads `.env.local` and would make the target depend on it.
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

/** `DATABASE_URL_<ENV>`; `local` alone falls back to `DATABASE_URL`, which `.env.local` holds. */
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
 * The applied head's `when` (Drizzle's `created_at` is the journal entry's `when`); null for a
 * database never migrated.
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

    // The same migrator as `yarn db:migrate` and the test database.
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
  // Non-zero, so the caller can block the deployment (§7.6).
  console.error("\n  Migration failed:", error instanceof Error ? error.message : error, "\n");
  process.exit(1);
});
