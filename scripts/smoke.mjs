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
import { pathToFileURL } from "node:url";

const TIMEOUT_MS = 15_000;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/**
 * The site's root in each language (§714, amending §353): with «Pagina principală» off it is a static
 * page that redirects — a 307 to the listing — and with it on it is the home page, a 200. Never the
 * 308 §353 had, and never a 200 that is an error document (a redirect thrown from a page once
 * reached production that way): a 200 must carry the home page's own marker and no Next error
 * marker. A 307 to the listing passes while the setting is off, which is the default. A 308 to the
 * listing passes too (§NNN): `migrate.yml` smokes the deployment while it still serves the PREVIOUS
 * build, and the builds before §717 answered 308 — refusing it failed two migrations, each cured only
 * by a re-run. The smoke tests the site's health, not which build answers in that window. Asked
 * twice, so the second answer shows whether the CDN holds it.
 */
export function judgeRoot(locale, status, location, body) {
  const listing = new RegExp(`^(https?://[^/]+)?/${locale}/(evenimente|events)/?$`).test(location);
  if ((status === 307 || status === 308) && listing) return { ok: true, what: `${status} to ${location}` };
  if (status === 200) {
    if (body.includes("__next_error__")) return { ok: false, reason: "answered 200 but the page is Next's error document (__next_error__)" };
    if (!body.includes('data-testid="home-page"')) return { ok: false, reason: 'answered 200 but the body is not the home page (no data-testid="home-page")' };
    return { ok: true, what: "200, the home page" };
  }
  return { ok: false, reason: `answered ${status}${location ? ` to ${location}` : ""}; expected a 307 or 308 to the listing or the home page's 200` };
}

async function checkRoots(baseUrl) {
  for (const locale of ["ro", "en"]) {
    const url = new URL(`/${locale}`, baseUrl);
    for (const attempt of [1, 2]) {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((error) =>
        fail(`Could not reach ${url.host}: ${error.message}`),
      );
      const location = response.headers.get("location") ?? "";
      const cache = response.headers.get("x-vercel-cache") ?? "none";
      const body = response.status === 200 ? await response.text().catch(() => "") : "";
      if (response.status !== 200) await response.arrayBuffer().catch(() => null);
      const verdict = judgeRoot(locale, response.status, location, body);
      if (!verdict.ok) fail(`${url.host}/${locale} ${verdict.reason}.`);
      console.log(`  /${locale} (${attempt}): ${verdict.what}, x-vercel-cache ${cache}`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("\n  Smoke check failed:", error instanceof Error ? error.message : error, "\n");
    process.exit(1);
  });
}
