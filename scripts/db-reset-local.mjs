#!/usr/bin/env node
/**
 * Drop and rebuild the local development database.
 *
 * Both `public` and `drizzle` go: Drizzle's bookkeeping lives in its own schema, and keeping it
 * makes the next `db:migrate` skip everything but the newest migration.
 *
 * Refuses to run against anything but a local database. Usage: yarn db:reset:local
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

const url = process.env.DATABASE_URL;
const appEnv = process.env.APP_ENV ?? "local";

if (!url) {
  console.error("db:reset:local — DATABASE_URL is not set. See docs/DEVELOPMENT.md.");
  process.exit(1);
}

if (appEnv !== "local" && appEnv !== "test") {
  console.error(`db:reset:local — refusing to run with APP_ENV=${appEnv}. Local and test only.`);
  process.exit(1);
}

// A second guard: the host decides which database is destroyed, whatever APP_ENV says.
const parsed = (() => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
})();
const host = parsed?.hostname ?? "";
// The database and role the URL names (a worktree may have its own); the docker fallback must
// reset exactly this one, never a hardcoded name.
const database = parsed ? decodeURIComponent(parsed.pathname.replace(/^\//, "")) : "";
const role = parsed ? decodeURIComponent(parsed.username) : "";

if (!database || !role) {
  console.error("db:reset:local — DATABASE_URL names no database or no user; refusing to guess which one to drop.");
  process.exit(1);
}

if (!["localhost", "127.0.0.1", "::1", "db"].includes(host)) {
  console.error(
    `db:reset:local — refusing to drop a non-local database (host "${host}"). ` +
      "This command exists to reset a development container, never a hosted database.",
  );
  process.exit(1);
}

const sql = "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;";

console.log(`db:reset:local — dropping and recreating schemas in "${database}" on ${host}`);
const dropped = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: "inherit" });

if (dropped.error || dropped.status !== 0) {
  // psql is not always on PATH on Windows; the container always has it.
  console.log(`db:reset:local — psql unavailable locally, using the docker container instead (database "${database}")`);
  const viaDocker = spawnSync(
    "docker",
    ["exec", "brasovrunners-db", "psql", "-U", role, "-d", database, "-v", "ON_ERROR_STOP=1", "-c", sql],
    { stdio: "inherit" },
  );
  if (viaDocker.status !== 0) {
    console.error("db:reset:local — could not reset. Is `docker compose up -d db` running?");
    process.exit(1);
  }
}

for (const [label, args] of [
  ["migrate", ["drizzle-kit", "migrate"]],
  ["seed", ["node", "--import", "tsx", "--env-file-if-exists=.env.local", "src/db/seeds/pilot.ts"]],
]) {
  const step = spawnSync(args[0] === "node" ? "node" : "npx", args[0] === "node" ? args.slice(1) : args, {
    stdio: "inherit",
    shell: true,
  });
  if (step.status !== 0) {
    console.error(`db:reset:local — ${label} failed`);
    process.exit(1);
  }
}

console.log("db:reset:local — done");
