// Hold a deployment's build until the database it will serve has every migration the build
// expects — the ordering half of "a deployment never runs against the wrong schema"
// (AGENTS.md §7.6, DECISIONS.md §62).
//
// The failure this closes: a push to `qa` starts the Vercel build and the migrate workflow at
// the same moment, and whichever finishes second decides what the site does in between. On
// 2026-09-17 the migration finished first, the old code selected a column that no longer
// existed, and the QA landing page answered 500 for the length of a build. The other order is
// no better: new code live against an old schema until the migration lands.
//
// This script runs first in `yarn build`, on Vercel, and does one thing: it compares the
// journal head this build was compiled against with Drizzle's bookkeeping table in the
// environment's own database, and waits — polling — until they agree. It never applies
// anything: §7.6's "no migration from a build" still holds, and the runbook's "must never
// happen" list is untouched. A migration that never arrives fails the build, and a failed build
// leaves the previous deployment serving, which is the safe state.
//
// Where it does nothing: locally (`yarn build` on a laptop has no `VERCEL`), on preview
// deployments (they build a branch against no database of their own), and when the database
// is already there — the common case, a build with no migration in it, costs one query.
//
// Production needs the required reviewer to approve the migrate run (`migrate.yml`), so its
// build waits for that click; MIGRATION_WAIT_MINUTES bounds it and the runbook says what to do
// when the wait runs out.

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
  // Vercel sets VERCEL=1 on every build and VERCEL_ENV to `production` for the project's
  // production branch — `qa` on the QA project, `main` on the production project.
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
    // A production deployment with no database is misconfigured, and `env.ts` will say so at
    // runtime. This script's job is ordering, not configuration.
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
