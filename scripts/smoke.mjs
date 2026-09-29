#!/usr/bin/env node
/**
 * Ask a deployment whether it is actually working.
 *
 * Usage: node scripts/smoke.mjs <base-url> [--allow-degraded]
 *        yarn smoke https://<host>
 *
 * The last step of every deployment (AGENTS.md §6.4 step 7, `DECISIONS.md` §31): a green build is
 * not a working site. Turns `/api/health` into an exit code. `--allow-degraded` suits the minutes
 * right after a deployment, before the scheduled jobs' first tick.
 */

import process from "node:process";

const TIMEOUT_MS = 15_000;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const [baseUrl, ...flags] = process.argv.slice(2);
  const allowDegraded = flags.includes("--allow-degraded");

  if (!baseUrl) fail("Usage: node scripts/smoke.mjs <base-url> [--allow-degraded]");

  let url;
  try {
    url = new URL("/api/health", baseUrl);
  } catch {
    fail(`Not a URL: ${baseUrl}`);
  }

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((error) => fail(`Could not reach ${url.host}: ${error.message}`));

  const body = await response.json().catch(() => null);
  if (!body) {
    // A protected preview answers with Vercel's SSO page rather than JSON.
    fail(
      `${url.host} did not return JSON (HTTP ${response.status}). If this is a protected preview ` +
        "deployment, smoke the environment's own hostname instead.",
    );
  }

  console.log(`\n${JSON.stringify(body, null, 2)}\n`);

  if (body.status === "ok") {
    console.log(`  ${url.host} is ok.\n`);
    return;
  }

  if (body.status === "degraded" && allowDegraded) {
    console.log(`  ${url.host} is degraded, accepted by --allow-degraded.\n`);
    return;
  }

  // The schema case is named: its remedy is a command, not an investigation.
  if (body.schema?.status === "behind") {
    fail(
      `${url.host} is running code newer than its database. It expects ` +
        `${body.schema.expectedTag}; the database has not applied it. ` +
        "Run the migrate workflow for that environment, then smoke again.",
    );
  }

  fail(`${url.host} reports "${body.status}". See the report above.`);
}

main().catch((error) => {
  console.error("\n  Smoke check failed:", error instanceof Error ? error.message : error, "\n");
  process.exit(1);
});
