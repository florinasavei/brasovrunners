#!/usr/bin/env node
/**
 * Ask a deployment whether it is actually working.
 *
 * Usage: node scripts/smoke.mjs <base-url> [--allow-degraded]
 *        yarn smoke https://<host>
 *
 * The last step of every deployment (AGENTS.md §6.4 step 7, `docs/RUNBOOKS.md` § Deploy). It
 * exists because "the deploy went green" and "the site works" are different statements, and the
 * gap between them is where the schema-drift incident lived: Vercel reported a successful build
 * for a deployment whose every public page returned 500 (`DECISIONS.md` §31).
 *
 * `/api/health` already knows the answer — the database, the schema version against this build,
 * and each scheduled job's liveness. This turns it into an exit code, so a person running it by
 * hand and a workflow running it after a migration get the same verdict.
 *
 * `--allow-degraded` accepts a degraded answer, which is the honest setting immediately after a
 * deployment: the scheduled jobs run every five minutes, so a fresh environment reports them as
 * never-run until the first tick, and that is not a reason to fail a release.
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
    // A protected preview deployment answers with Vercel's SSO page rather than JSON, and an
    // unhelpful "unexpected token <" is worth translating.
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

  // Name the schema case explicitly: it is the one whose remedy is a command rather than an
  // investigation, and it is the one that looks like a working deployment from the outside.
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
