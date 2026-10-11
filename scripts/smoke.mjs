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

/**
 * The site's root in each language (§NNN, amending §353): with «Pagina principală» off it is a static
 * page that redirects — a 307 to the listing — and with it on it is the home page, a 200. Never the
 * 308 §353 had, and never a 200 that is an error document (a redirect thrown from a page once
 * reached production that way). Asked twice, so the second answer shows whether the CDN holds it.
 */
async function checkRoots(baseUrl) {
  for (const locale of ["ro", "en"]) {
    const url = new URL(`/${locale}`, baseUrl);
    for (const attempt of [1, 2]) {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((error) =>
        fail(`Could not reach ${url.host}: ${error.message}`),
      );
      const location = response.headers.get("location") ?? "";
      const cache = response.headers.get("x-vercel-cache") ?? "none";
      const listing = new RegExp(`^(https?://[^/]+)?/${locale}/(evenimente|events)/?$`).test(location);
      if (response.status === 307 && listing) {
        console.log(`  /${locale} (${attempt}): 307 to ${location}, x-vercel-cache ${cache}`);
      } else if (response.status === 200) {
        console.log(`  /${locale} (${attempt}): 200, the home page, x-vercel-cache ${cache}`);
      } else {
        fail(`${url.host}/${locale} answered ${response.status}${location ? ` to ${location}` : ""}; expected a 307 to the listing or the home page's 200.`);
      }
      await response.arrayBuffer().catch(() => null);
    }
  }
  console.log("");
}

async function main() {
  const [baseUrl, ...flags] = process.argv.slice(2);
  const allowDegraded = flags.includes("--allow-degraded");

  if (!baseUrl) fail("Usage: node scripts/smoke.mjs <base-url> [--allow-degraded]");

  let url;
  try {
    // The full report (§577): the bare `/api/health` is the monitors' shallow answer, which asks
    // no database and so could not say that the schema is behind.
    url = new URL("/api/health?deep=1", baseUrl);
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
    await checkRoots(baseUrl);
    return;
  }

  if (body.status === "degraded" && allowDegraded) {
    console.log(`  ${url.host} is degraded, accepted by --allow-degraded.\n`);
    await checkRoots(baseUrl);
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
