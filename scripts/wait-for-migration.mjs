// Hold a deployment's build until its database has every migration the build expects, so new
// code never meets an old schema (AGENTS.md §7.6, DECISIONS.md §62). Runs first in `yarn build`
// on Vercel production builds only; it never applies anything. A migration that never arrives
// (production's waits for the reviewer's approval) fails the build after MIGRATION_WAIT_MINUTES,
// leaving the previous deployment serving.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const POLL_SECONDS = 15;
const WAIT_MINUTES = Number(process.env.MIGRATION_WAIT_MINUTES || 20);

function log(line) {
  console.log(`[wait-for-migration] ${line}`);
}

async function journalHead() {
  const file = path.join("src", "db", "migrations", "meta", "_journal.json");
  const journal = JSON.parse(await readFile(file, "utf8"));
  return journal.entries?.at(-1) ?? null;
}

/** Newest applied `when`, as a string; null when nothing has ever been applied. */
async function appliedHead(pool) {
  const present = await pool.query(
    `select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
  );
  if (!present.rows[0]?.present) return null;
  const applied = await pool.query(
    `select max(created_at)::text as applied_when from drizzle.__drizzle_migrations`,
  );
  return applied.rows[0]?.applied_when ?? null;
}

/** `ok` when the database is at or beyond the build's head; `behind` otherwise. */
export function compare(expectedWhen, appliedWhen) {
  if (!appliedWhen) return "behind";
  return BigInt(appliedWhen) >= BigInt(expectedWhen) ? "ok" : "behind";
}

async function main() {
  // VERCEL_ENV is `production` for each project's production branch: `qa` on QA, `main` on production.
  if (!process.env.VERCEL) {
    log("not a Vercel build; nothing to wait for");
    return;
  }
  if (process.env.VERCEL_ENV !== "production") {
    log(`${process.env.VERCEL_ENV} deployment; nothing to wait for`);
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Misconfigured; `env.ts` says so at runtime.
    log("DATABASE_URL is not set; nothing to compare against");
    return;
  }

  const head = await journalHead();
  if (!head) {
    log("empty journal; nothing to wait for");
    return;
  }

  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 15_000 });
  const deadline = Date.now() + WAIT_MINUTES * 60_000;
  try {
    for (;;) {
      const applied = await appliedHead(pool);
      if (compare(String(head.when), applied) === "ok") {
        log(`database is at ${head.tag}; building`);
        return;
      }
      if (Date.now() >= deadline) {
        console.error(
          `[wait-for-migration] gave up after ${WAIT_MINUTES} minutes: the database has not applied ` +
            `${head.tag}. The previous deployment keeps serving. Apply the migration (migrate.yml — ` +
            `production needs the reviewer's approval), then redeploy. docs/RUNBOOKS.md § Deploying.`,
        );
        process.exit(1);
      }
      log(`database is behind ${head.tag}; waiting ${POLL_SECONDS}s for migrate.yml`);
      await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1_000));
    }
  } finally {
    await pool.end();
  }
}

// Import-safe for the unit test of `compare`; runs only when invoked as a script.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[wait-for-migration] ${error.message}`);
    process.exit(1);
  });
}
