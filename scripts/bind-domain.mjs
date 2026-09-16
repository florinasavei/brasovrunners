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
 * `docs/RUNBOOKS.md` § Domain binding is the procedure; this is the half of it a machine can do.
 * The club will hold two domains over time (`DECISIONS.md` §55), so the same command also has to
 * make "which one is canonical" a switch: run it for the new canonical, then for the old one with
 * `--alias-of`, then redeploy. Nothing under `src/` changes either way (`AGENTS.md` §8).
 *
 * What it does, and only these three things:
 *
 *   1. adds the hostnames to the environment's own Vercel project — the apex and `www` for an
 *      apex, the one name for a subdomain. `www` redirects to the apex, and every hostname of an
 *      alias domain redirects to the canonical, permanently (308), set on the host: BR-REQ-101-02
 *      criteria 4 and 5 — exactly one canonical host serves the site;
 *   2. for a canonical domain, sets `APP_BASE_URL`, the single source of every absolute URL the
 *      application emits — the sitemap, the canonical tags and every email link follow from that
 *      one variable and nothing else needs editing. An alias touches no variable;
 *   3. prints the DNS records the registrar needs, and the consoles a machine must not touch on
 *      the club's behalf.
 *
 * **Dry run unless `--apply`.** The first time anybody runs this they are holding a domain they
 * have just paid for.
 *
 * It deliberately does NOT redeploy. `APP_BASE_URL` reaches a running application only on a new
 * deployment, and choosing when is the operator's call — the script says so at the end.
 *
 * Every Vercel call goes through `vercel api`, the CLI's authenticated passthrough, rather than
 * the token in the CLI's credentials file. That token is an OAuth access token with an expiry;
 * the CLI refreshes its copy in memory and never rewrites the file, and the REST API answers 403
 * to the stale one — which is how the first version of this script stopped working a day after
 * the login it relied on. The project is resolved by the environment's own name, never from
 * `.vercel/project.json`: that file links this checkout to the QA project, and the first version
 * would have bound the club's domain there for `production` too.
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
 * One authenticated call through the CLI. `--raw` keeps the body machine-readable; the CLI still
 * prints its banner first, so the JSON is taken from the first brace or bracket. With `tolerate`
 * a non-JSON answer (a 404, a 400) comes back as `null` for the caller to decide about; without
 * it, it is fatal and quoted.
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

/**
 * The team the two projects belong to. `.vercel/project.json` records it whichever project this
 * checkout is linked to; the signed-in user's default team is the fallback on a fresh clone.
 */
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

  // 1. The hostnames, each either serving or redirecting — decided here, once, on the host.
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

  // 2. The one variable every absolute URL comes from — canonical domains only.
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

  /**
   * The consoles this script must not touch on the club's behalf. Each holds a credential or a
   * policy in somebody else's system, and each fails silently from here: a redirect URI that does
   * not match refuses every sign-in, and an unverified sending domain drops mail without a bounce.
   */
  const baseUrl = `https://${domain}`;
  console.log("  Then, by hand — none of these can be scripted safely\n");
  console.log("    Zitadel  add the redirect URI, or every sign-in is refused:");
  console.log(`               ${baseUrl}/api/auth/callback/zitadel`);
  console.log(`             and the post-logout URI: ${baseUrl}`);
  console.log("             Keep the old entries until the new host is proven.\n");
  console.log("    Mailgun  add a sending domain and create its SPF and DKIM records — a subdomain");
  console.log("             such as mg.<domain> if the apex carries mailboxes (RUNBOOKS § Domain");
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
