#!/usr/bin/env node
/**
 * Drop and rebuild the local development database.
 *
 * Why this is a script and not a one-line psql: dropping `public` is not enough. Drizzle
 * records which migrations it has applied in a table inside its own `drizzle` schema, which a
 * `DROP SCHEMA public CASCADE` leaves untouched. The next `db:migrate` then believes the
 * earlier migrations are already applied, tries only the newest one, and fails on an enum the
 * drop removed — leaving an empty database and a confusing error. Both schemas go, or neither.
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

// A second, independent guard. APP_ENV is a variable someone can set wrongly; the host in the
// connection string is what actually decides which database is destroyed.
const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
})();

if (!["localhost", "127.0.0.1", "::1", "db"].includes(host)) {
  console.error(
    `db:reset:local — refusing to drop a non-local database (host "${host}"). ` +
      "This command exists to reset a development container, never a hosted database.",
  );
  process.exit(1);
}

const sql = "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;";

console.log(`db:reset:local — dropping and recreating schemas on ${host}`);
const dropped = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: "inherit" });

if (dropped.error || dropped.status !== 0) {
  // psql is not always on PATH on Windows; the container always has it.
  console.log("db:reset:local — psql unavailable locally, using the docker container instead");
  const viaDocker = spawnSync(
    "docker",
    ["exec", "brasovrunners-db", "psql", "-U", "brasov_runners", "-d", "brasov_runners", "-v", "ON_ERROR_STOP=1", "-c", sql],
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
