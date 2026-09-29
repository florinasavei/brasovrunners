#!/usr/bin/env node
/**
 * Bind the club's own domain to a deployed environment, and keep every other domain the club
 * holds redirecting to it.
 *
 * Usage: node scripts/bind-domain.mjs <qa|production> <domain> [--alias-of <canonical>] [--apply]
 *
 *   yarn domain:bind production example.com                  dry run: prints what it would change
 *   yarn domain:bind production example.com --apply          the canonical domain: hostnames,
 *                                                            www → apex, APP_BASE_URL
 *   yarn domain:bind production example.ro --alias-of example.com --apply
 *                                                            a second domain: its apex and www
 *                                                            both redirect to the canonical
 *   yarn domain:bind qa qa.example.com --apply
 *
 * The machine half of `docs/RUNBOOKS.md` § Domain binding (`DECISIONS.md` §55, `AGENTS.md` §8):
 *   1. adds the hostnames to the environment's Vercel project, `www` and alias domains redirecting
 *      308 to the one canonical host (BR-REQ-101-02 criteria 4 and 5);
 *   2. for a canonical domain, sets `APP_BASE_URL`; an alias touches no variable;
 *   3. prints the DNS records and the consoles a machine must not touch.
 * Dry run unless `--apply`. It does not redeploy; `APP_BASE_URL` takes effect on the next one.
 *
 * Calls go through `vercel api`, not the token in the CLI's credentials file, which the CLI never
 * refreshes on disk (403 a day after login). The project is chosen by environment name, never from
 * `.vercel/project.json`, which links this checkout to QA.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const PROJECTS = { qa: "brasov-runners-qa", production: "brasov-runners-production" };
const REDIRECT_STATUS = 308;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/**
 * One authenticated call through the CLI; the JSON starts at the first brace or bracket, after the
 * CLI's banner. With `tolerate` a non-JSON answer returns null; without it, it is fatal.
 */
function vercel(method, path, body, { tolerate = false } = {}) {
  const command = [
    "npx vercel api",
    JSON.stringify(path),
    "-X",
    method,
    "--raw",
    body === undefined ? "" : "--input -",
  ].join(" ");
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    input: body === undefined ? undefined : JSON.stringify(body),
    // Git Bash rewrites a leading "/" into a Windows path; the API path must arrive intact.
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
  });
  const out = result.stdout ?? "";
  const starts = ["{", "["].map((c) => out.indexOf(c)).filter((i) => i >= 0);
  if (starts.length === 0) {
    if (tolerate) return null;
    const detail = `${out}${result.stderr ?? ""}`.trim().split("\n").slice(-2).join(" ");
    return fail(
      `vercel api ${method} ${path} answered without JSON: ${detail || "no output"}. ` +
        "Run `npx vercel login` once and try again.",
    );
  }
  try {
    return JSON.parse(out.slice(Math.min(...starts)));
  } catch {
    if (tolerate) return null;
    return fail(`vercel api ${method} ${path}: could not parse the response.`);
  }
}

/** The team, from `.vercel/project.json`, else the signed-in user's default team. */
function teamId() {
  try {
    const { orgId } = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
    if (orgId) return orgId;
  } catch {
    // Not linked here; the API knows.
  }
  const me = vercel("GET", "/v2/user");
  return me?.user?.defaultTeamId ?? fail("Could not determine the Vercel team. Run `npx vercel link` once.");
}

/** An apex needs `www` too; a subdomain is itself and nothing else. */
function hostnamesFor(domain) {
  return domain.split(".").length === 2 ? [domain, `www.${domain}`] : [domain];
}

function printDnsRecords(records) {
  console.log("  DNS records to create at the registrar\n");
  for (const { hostname, config } of records) {
    if (!config) {
      console.log(`    ${hostname}: read the record from the project's Domains screen`);
      continue;
    }
    if (config.misconfigured === false) {
      console.log(`    ${hostname}: already resolving to Vercel, nothing to add`);
      continue;
    }
    const isApex = hostname.split(".").length === 2;
    const a = config.recommendedIPv4?.find((r) => r.rank === 1) ?? config.recommendedIPv4?.[0];
    const cname = config.recommendedCNAME?.find((r) => r.rank === 1) ?? config.recommendedCNAME?.[0];
    if (isApex && a?.value?.length) {
      console.log(`    ${hostname}`);
      console.log("      type  A");
      console.log("      name  @");
      console.log(`      value ${a.value.join(" or ")}\n`);
    } else if (cname) {
      console.log(`    ${hostname}`);
      console.log("      type  CNAME");
      console.log(`      name  ${hostname.split(".")[0]}`);
      console.log(`      value ${cname.value ?? JSON.stringify(cname)}\n`);
    } else {
      console.log(`    ${hostname}: ${JSON.stringify(config)}\n`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const aliasIndex = args.indexOf("--alias-of");
  const aliasOf = aliasIndex >= 0 ? args[aliasIndex + 1] : null;
  const positional = args.filter((a, i) => !a.startsWith("--") && (aliasIndex < 0 || i !== aliasIndex + 1));
  const [environment, domain] = positional;

  if (!environment || !domain) {
    fail("Usage: node scripts/bind-domain.mjs <qa|production> <domain> [--alias-of <canonical>] [--apply]");
  }
  if (!PROJECTS[environment]) fail(`Unknown environment ${environment}. Expected qa or production.`);
  const hostnameShape = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
  if (!hostnameShape.test(domain)) fail(`Not a hostname: ${domain}`);
  if (aliasIndex >= 0 && (!aliasOf || !hostnameShape.test(aliasOf))) fail("--alias-of needs the canonical hostname after it.");
  if (aliasOf && aliasOf === domain) fail("A domain cannot be an alias of itself.");

  const team = teamId();
  const query = `?teamId=${team}`;
  const project = vercel("GET", `/v9/projects/${PROJECTS[environment]}${query}`);
  if (!project?.id) fail(`Project ${PROJECTS[environment]} not found. Create it first (SETUP.md §26).`);

  const canonical = aliasOf ?? domain;
  const hostnames = hostnamesFor(domain);
  const plan = hostnames.map((hostname) => ({
    hostname,
    redirect: hostname === canonical ? null : canonical,
  }));

  console.log(`\n  Project      ${project.name}`);
  console.log(`  Environment  ${environment}`);
  console.log(`  Role         ${aliasOf ? `alias of ${aliasOf}` : "canonical"}`);
  for (const { hostname, redirect } of plan) {
    console.log(`  Hostname     ${hostname}${redirect ? `  → 308 → ${redirect}` : "  (serves the site)"}`);
  }
  console.log(`  APP_BASE_URL ${aliasOf ? "unchanged" : `https://${domain}`}`);

  if (!apply) {
    console.log("\n  Dry run. Nothing was changed. Re-run with --apply to make it so.\n");
    return;
  }

  // 1. The hostnames, each serving or redirecting.
  const records = [];
  for (const { hostname, redirect } of plan) {
    const body = redirect ? { name: hostname, redirect, redirectStatusCode: REDIRECT_STATUS } : { name: hostname };
    const domainPath = `/v9/projects/${project.id}/domains/${hostname}${query}`;
    const existing = vercel("GET", domainPath, undefined, { tolerate: true });
    if (existing?.name) {
      const patched = vercel(
        "PATCH",
        domainPath,
        redirect ? { redirect, redirectStatusCode: REDIRECT_STATUS } : { redirect: null, redirectStatusCode: null },
        { tolerate: true },
      );
      if (!patched?.name) fail(`Could not update ${hostname}. Read the project's Domains screen.`);
    } else {
      const added = vercel("POST", `/v10/projects/${project.id}/domains${query}`, body, { tolerate: true });
      if (!added?.name) {
        fail(
          `Could not add ${hostname}. The commonest cause: the project has no successful production ` +
            "deployment yet, or the domain is held by another Vercel account. Deploy once, then re-run.",
        );
      }
    }
    const config = vercel("GET", `/v6/domains/${hostname}/config?projectIdOrName=${project.id}&teamId=${team}`, undefined, {
      tolerate: true,
    });
    records.push({ hostname, config });
  }
  console.log("\n  ✓ Hostnames on the project, redirects set\n");

  // 2. APP_BASE_URL — canonical domains only.
  if (!aliasOf) {
    const baseUrl = `https://${domain}`;
    const envs = vercel("GET", `/v9/projects/${project.id}/env${query}`);
    const current = (envs?.envs ?? []).find(
      (entry) => entry.key === "APP_BASE_URL" && (entry.target ?? []).includes("production"),
    );
    if (current) {
      vercel("PATCH", `/v9/projects/${project.id}/env/${current.id}${query}`, { value: baseUrl });
    } else {
      vercel("POST", `/v10/projects/${project.id}/env${query}`, {
        key: "APP_BASE_URL",
        value: baseUrl,
        type: "plain",
        target: ["production"],
      });
    }
    console.log(`  ✓ APP_BASE_URL set to ${baseUrl}\n`);
  }

  printDnsRecords(records);

  if (aliasOf) {
    console.log("  Nothing else: an alias only redirects, so no callback URI and no sender changes.\n");
    return;
  }

  // The consoles a script must not touch; each fails silently when wrong.
  const baseUrl = `https://${domain}`;
  console.log("  Then, by hand — none of these can be scripted safely\n");
  console.log("    Zitadel  add the redirect URI, or every sign-in is refused:");
  console.log(`               ${baseUrl}/api/auth/callback/zitadel`);
  console.log(`             and the post-logout URI: ${baseUrl}`);
  console.log("             Keep the old entries until the new host is proven.\n");
  console.log("    Mailgun  add a sending domain and create its SPF and DKIM records — a subdomain");
  console.log("             such as mail.<domain> if the apex carries mailboxes (RUNBOOKS § Domain");
  console.log("             binding, step 2). Until it verifies, mail stays capped at the sandbox's");
  console.log("             five authorised recipients. Then repoint the webhook:");
  console.log(`               ${baseUrl}/api/webhooks/mailgun\n`);

  console.log("  Finally\n");
  console.log("    APP_BASE_URL reaches the running application only on a new deployment.");
  console.log("    Redeploy, then prove it:\n");
  console.log(`      yarn smoke ${baseUrl}`);
  console.log(`      curl -sI https://www.${domain} | head -3        # 308 to the apex`);
  console.log(`      curl -s ${baseUrl}/sitemap.xml | head -5        # every URL must be the new host\n`);
}

main();
