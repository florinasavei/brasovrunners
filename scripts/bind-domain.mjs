#!/usr/bin/env node
/**
 * Bind the club's own domain to a deployed environment.
 *
 * Usage: node scripts/bind-domain.mjs <qa|production> <domain> [--apply]
 *        yarn domain:bind qa qa.example.ro
 *        yarn domain:bind production example.ro --apply
 *
 * `docs/RUNBOOKS.md` § Domain binding is the procedure; this is the half of it a machine can do.
 * Registering the domain is deliberately the last thing the club pays for, so the day it finally
 * happens should be a command and a paste of DNS records — not an afternoon of remembering which
 * of five consoles holds which hostname.
 *
 * What it does, and it is only ever these three things:
 *
 *   1. adds the hostname (and `www`, for an apex) to the Vercel project;
 *   2. sets `APP_BASE_URL` for that environment, which is the single source of every absolute
 *      URL the application emits (`AGENTS.md` §8) — so the sitemap, the canonical tags and every
 *      email link follow from this one variable and nothing else needs editing;
 *   3. prints the DNS records the registrar needs, and the two consoles a machine must not touch
 *      on the club's behalf.
 *
 * **Dry run unless `--apply`.** It prints exactly what it would change and exits, because the
 * first time anybody runs this they are holding a domain they have just paid for.
 *
 * It deliberately does NOT redeploy. `APP_BASE_URL` reaches a running application only on a new
 * deployment, and choosing when that happens is the operator's call — the script says so at the
 * end rather than deciding for them.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const ENVIRONMENTS = {
  qa: { target: "preview-or-production", vercelTarget: "production", project: "brasov-runners-qa" },
  production: { target: "production", vercelTarget: "production", project: "brasov-runners-production" },
};

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/**
 * The token the Vercel CLI already holds, rather than a second credential in `.env.local`.
 *
 * `vercel login` is the supported way to authorise a machine, and reading its store means there
 * is nothing extra to rotate, leak or forget. If it is absent the answer is one command, which
 * is what the error says.
 */
function vercelToken() {
  const candidates = [
    path.join(process.env.APPDATA ?? "", "xdg.data", "com.vercel.cli", "auth.json"),
    path.join(process.env.APPDATA ?? "", "com.vercel.cli", "auth.json"),
    path.join(homedir(), ".local", "share", "com.vercel.cli", "auth.json"),
    path.join(homedir(), "Library", "Application Support", "com.vercel.cli", "auth.json"),
  ];

  for (const file of candidates) {
    try {
      const token = JSON.parse(readFileSync(file, "utf8")).token;
      if (token) return token;
    } catch {
      // Try the next location; a missing file here is the ordinary case on every other platform.
    }
  }

  return fail("Not signed in to Vercel. Run `npx vercel login`, then try again.");
}

function projectLink() {
  try {
    return JSON.parse(readFileSync(".vercel/project.json", "utf8"));
  } catch {
    return fail("This repository is not linked to a Vercel project. Run `npx vercel link`.");
  }
}

async function api(token, method, url, body) {
  const response = await fetch(`https://api.vercel.com${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

/** An apex needs `www` too, and the redirect between them is set in the Vercel dashboard. */
function hostnamesFor(domain) {
  const isApex = domain.split(".").length === 2;
  return isApex ? [domain, `www.${domain}`] : [domain];
}

function printDnsRecords(results) {
  console.log("  DNS records to create at the registrar\n");
  for (const { hostname, verification } of results) {
    if (!verification?.length) {
      console.log(`    ${hostname}: already verified, nothing to add`);
      continue;
    }
    for (const record of verification) {
      console.log(`    ${hostname}`);
      console.log(`      type  ${record.type}`);
      console.log(`      name  ${record.domain}`);
      console.log(`      value ${record.value}\n`);
    }
  }
}

async function main() {
  const [environment, domain, ...flags] = process.argv.slice(2);
  const apply = flags.includes("--apply");

  if (!environment || !domain) {
    fail("Usage: node scripts/bind-domain.mjs <qa|production> <domain> [--apply]");
  }
  if (!ENVIRONMENTS[environment]) {
    fail(`Unknown environment ${environment}. Expected qa or production.`);
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    fail(`Not a hostname: ${domain}`);
  }

  const token = vercelToken();
  const link = projectLink();
  const query = `?teamId=${link.orgId}`;
  const hostnames = hostnamesFor(domain);
  const baseUrl = `https://${domain}`;

  console.log(`\n  Project      ${link.projectName}`);
  console.log(`  Environment  ${environment}`);
  console.log(`  Hostnames    ${hostnames.join(", ")}`);
  console.log(`  APP_BASE_URL ${baseUrl}`);

  if (!apply) {
    console.log("\n  Dry run. Nothing was changed. Re-run with --apply to make it so.\n");
    return;
  }

  // 1. The hostnames.
  const results = [];
  for (const hostname of hostnames) {
    const added = await api(token, "POST", `/v10/projects/${link.projectId}/domains${query}`, {
      name: hostname,
    });
    if (!added.ok && added.payload?.error?.code !== "domain_already_in_use") {
      fail(`Could not add ${hostname}: ${added.payload?.error?.message ?? added.status}`);
    }
    const config = await api(token, "GET", `/v6/domains/${hostname}/config${query}`);
    results.push({ hostname, verification: added.payload?.verification ?? config.payload?.misconfigured ? added.payload?.verification : [] });
  }
  console.log("\n  ✓ Hostnames added to the project\n");

  // 2. The one variable every absolute URL comes from.
  const existing = await api(token, "GET", `/v9/projects/${link.projectId}/env${query}`);
  const current = (existing.payload?.envs ?? []).find(
    (entry) => entry.key === "APP_BASE_URL" && entry.target.includes("production"),
  );
  if (current) {
    await api(token, "PATCH", `/v9/projects/${link.projectId}/env/${current.id}${query}`, {
      value: baseUrl,
    });
  } else {
    await api(token, "POST", `/v10/projects/${link.projectId}/env${query}`, {
      key: "APP_BASE_URL",
      value: baseUrl,
      type: "plain",
      target: ["production"],
    });
  }
  console.log(`  ✓ APP_BASE_URL set to ${baseUrl}\n`);

  printDnsRecords(results);

  /**
   * The three things this script must not do on the club's behalf.
   *
   * Each one is a credential or a policy in somebody else's console, and each has a failure mode
   * that is silent from here: a redirect URI that does not match refuses every sign-in, and a
   * sending domain that is not verified drops mail without a bounce.
   */
  console.log("  Then, by hand — none of these can be scripted safely\n");
  console.log("    Zitadel  add the redirect URI, or every sign-in is refused:");
  console.log(`               ${baseUrl}/api/auth/callback/zitadel`);
  console.log(`             and the post-logout URI: ${baseUrl}`);
  console.log("             Keep the old entries until the new host is proven.\n");
  console.log("    Mailgun  add this domain as a sending domain and create its SPF and DKIM");
  console.log("             records. Until it verifies, mail is capped at the sandbox's five");
  console.log("             authorised recipients. Then repoint the webhook:");
  console.log(`               ${baseUrl}/api/webhooks/mailgun\n`);
  console.log("    Vercel   set the www → apex redirect, so exactly one canonical host exists.\n");

  console.log("  Finally\n");
  console.log("    APP_BASE_URL reaches the running application only on a new deployment.");
  console.log("    Redeploy, then prove it:\n");
  console.log(`      yarn smoke ${baseUrl}`);
  console.log(`      curl -s ${baseUrl}/sitemap.xml | head -5   # every URL must be the new host\n`);
}

main().catch((error) => fail(error.message));
