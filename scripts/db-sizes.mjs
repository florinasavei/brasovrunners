#!/usr/bin/env node
/**
 * How big a database is and where it grows (§NNN) — `yarn db:sizes`.
 *
 * Usage: yarn db:sizes [--env local|qa|production]
 *
 * The owner, 2026-10-16: «cumva mă interesează să țin baza de date light long term». This prints what
 * `/devs` → «Baza de date» shows — the database's size, the eight largest tables, what each table
 * that grows gained in thirty days and the registrations by state and age of their event — from the
 * very same queries (`src/modules/diagnostics/domain/db-sizes.ts`, loaded through `tsx`), so the
 * script and the page cannot disagree. Read-only twice over: nothing here writes, and every query
 * runs inside one `BEGIN READ ONLY` transaction, so even a mistake cannot.
 *
 * The target is `DATABASE_URL_<ENV>` as `db:migrate:env` resolves it (`scripts/db-migrate.mjs`);
 * `local`, the default, falls back to `DATABASE_URL`. A deployed environment is a Neon project: asking
 * it wakes its compute, about five minutes of 0.25 CU, which the script says before it asks.
 * `docs/PLATFORM.md` § Keeping Neon and Vercel light, long term says what the numbers are for.
 */

import process from "node:process";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { GROWTH_DAYS, PAST_EVENT_MONTHS, readDatabaseSizes, sizeMegabytes, tableRows } from "../src/modules/diagnostics/domain/db-sizes.ts";

export const ENVIRONMENTS = ["local", "qa", "production"];

/** `--env x`, `--env=x`; local when absent; null for a value that is not an environment. */
export function parseEnvironment(args) {
  const index = args.findIndex((arg) => arg === "--env" || arg.startsWith("--env="));
  if (index === -1) return "local";
  const value = args[index].includes("=") ? args[index].split("=")[1] : args[index + 1];
  return ENVIRONMENTS.includes(value) ? value : null;
}

/**
 * `DATABASE_URL_<ENV>`; `local` alone falls back to `DATABASE_URL`, as `db:migrate:env` does.
 * @param {string} environment
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveUrl(environment, env = process.env) {
  const named = env[`DATABASE_URL_${environment.toUpperCase()}`];
  if (named) return named;
  if (environment === "local" && env.DATABASE_URL) return env.DATABASE_URL;
  return null;
}

/** Never print a connection string: it carries the password. */
export function describeTarget(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "an unparseable connection string";
  }
}

const mb = (bytes) => sizeMegabytes(bytes).toFixed(1);
const count = (value) => new Intl.NumberFormat("en-GB").format(value);
const pad = (text, width) => String(text).padEnd(width);
const padLeft = (text, width) => String(text).padStart(width);

/** The report as lines of text: the database, the largest tables, the growth, the registrations. */
export function formatSizes(sizes) {
  const lines = [];
  lines.push(`  size        ${mb(sizes.databaseBytes)} MB`);

  lines.push("", "  The largest tables", `  ${pad("table", 26)}${padLeft("total MB", 10)}${padLeft("data MB", 10)}${padLeft("index MB", 10)}${padLeft("rows", 14)}${padLeft(`+${GROWTH_DAYS} days`, 11)}`);
  for (const table of sizes.tables) {
    const rows = tableRows(table);
    const grown = sizes.growth.find((entry) => entry.table === table.name);
    const rowsText = rows === null ? "?" : `${rows.exact ? "" : "~"}${count(rows.value)}`;
    lines.push(
      `  ${pad(table.name, 26)}${padLeft(mb(table.totalBytes), 10)}${padLeft(mb(table.tableBytes), 10)}${padLeft(mb(table.indexBytes), 10)}${padLeft(rowsText, 14)}${padLeft(grown ? count(grown.last30Days) : "", 11)}`,
    );
  }

  lines.push("", `  Growth in the last ${GROWTH_DAYS} days`, `  ${pad("table", 26)}${padLeft("rows", 12)}${padLeft(`new in ${GROWTH_DAYS} d`, 14)}${padLeft("settled", 10)}`);
  for (const entry of sizes.growth) {
    lines.push(`  ${pad(entry.table, 26)}${padLeft(count(entry.total), 12)}${padLeft(count(entry.last30Days), 14)}${padLeft(entry.settled === null ? "" : count(entry.settled), 10)}`);
  }

  lines.push(
    "",
    "  Registrations by state (test rows included)",
    `  ${pad("state", 28)}${padLeft("total", 8)}${padLeft(`> ${PAST_EVENT_MONTHS[0]} months`, 12)}${padLeft(`> ${PAST_EVENT_MONTHS[1]} months`, 12)}`,
  );
  if (sizes.registrations.length === 0) lines.push("  (none)");
  for (const entry of sizes.registrations) {
    lines.push(`  ${pad(entry.status, 28)}${padLeft(count(entry.total), 8)}${padLeft(count(entry.pastSixMonths), 12)}${padLeft(count(entry.pastTwelveMonths), 12)}`);
  }
  lines.push(
    "",
    "  'settled': tokens spent, withdrawn or expired; family holds expired.",
    "  '> N months': the registration's event started more than N months ago.",
  );
  return lines;
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const environment = parseEnvironment(args);
  if (environment === null) fail(`Usage: yarn db:sizes [--env ${ENVIRONMENTS.join("|")}]`);

  const url = resolveUrl(environment);
  if (!url) {
    fail(
      `No connection string for "${environment}". Set DATABASE_URL_${environment.toUpperCase()}` +
        `${environment === "local" ? " (or DATABASE_URL)" : ""} in .env.local, as yarn db:migrate:env expects.`,
    );
  }

  console.log(`\n  target      ${environment}`);
  console.log(`  database    ${describeTarget(url)}`);
  if (environment !== "local") console.log("  Asking wakes the Neon compute: about five minutes at 0.25 CU. Nothing is written.");

  // One read-only transaction on one connection: a mistake in a query cannot write, on any environment —
  // and it works through Neon's pooler, which refuses a read-only setting sent at connection time.
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    // Each statement in a savepoint: the reading tolerates one count failing (a table that vanished between the
    // catalogue and the count), and in one transaction a failed statement would otherwise fail every later one (25P02).
    const run = async (text) => {
      await client.query("SAVEPOINT one");
      try {
        const rows = (await client.query(text)).rows;
        await client.query("RELEASE SAVEPOINT one");
        return rows;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT one");
        throw error;
      }
    };
    const sizes = await readDatabaseSizes(run, new Date());
    console.log("");
    for (const line of formatSizes(sizes)) console.log(line);
    console.log("");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("\n  db:sizes failed:", error instanceof Error ? error.message : error, "\n");
    process.exit(1);
  });
}
