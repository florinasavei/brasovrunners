#!/usr/bin/env node
/**
 * Ship one small batch to production, end to end — the release step of `docs/DISPATCHER.md`.
 *
 * Usage: yarn ship <batch PR> <new baseline> <previous baseline> "<release title>"
 *        yarn ship 163 BR-V1.98-2026-09-25 BR-V1.81-2026-09-24 "the listing cards and the partner marker"
 *
 *   1. waits until production reports the previous baseline (or already the new one): one release at a time;
 *   2. waits for the batch PR's checks, stops unless every one is green, and merges it into `qa`
 *      — an already-merged batch PR is taken as done, and the run continues from step 3;
 *   3. opens the `qa → main` release PR, or takes the one already open;
 *   4. waits for `qa`'s docs-check run on that merge, rerunning it once when the only failure is the
 *      Google Fonts download the build makes (a flake, not the code);
 *   5. merges the release PR;
 *   6. approves the gated `migrate.yml` run on `main` if one is waiting (`DECISIONS.md` §31) and waits for it;
 *   7. waits until production's `/api/health` reports the new baseline — the same answer `yarn smoke` reads.
 *
 * The owner authorised every one of these steps (merging into qa, the release PR, approving the production
 * migration); a person runs the same command. It needs `gh` signed in with the right to merge and to approve
 * the `production` environment.
 *
 * Production's origin is `SHIP_PRODUCTION_URL`, from the environment or the git-ignored `.env.local`, never
 * from this file: the repository is public and the club's domain lives in `SETUP.md` §26 alone.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const [PR, NEW, PREV, TITLE] = process.argv.slice(2);
if (!PR || !NEW || !PREV || !TITLE) stop('Usage: yarn ship <batch PR> <new baseline> <previous baseline> "<title>"');

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

function stop(message) {
  console.error(`\n  STOP: ${message}\n`);
  process.exit(1);
}

function run(command, args, { allowFail = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) stop(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0 && !allowFail) stop(`${command} ${args.join(" ")}\n  ${(result.stderr || "").trim()}`);
  return (result.stdout || "").trim();
}
const gh = (...args) => run("gh", args);
const ghMayFail = (...args) => run("gh", args, { allowFail: true });

function productionUrl() {
  if (process.env.SHIP_PRODUCTION_URL) return process.env.SHIP_PRODUCTION_URL;
  if (existsSync(".env.local")) {
    const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith("SHIP_PRODUCTION_URL="));
    const value = line?.slice("SHIP_PRODUCTION_URL=".length).trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  stop("set SHIP_PRODUCTION_URL (production's origin) in the environment or in .env.local");
}

async function health(base) {
  try {
    const response = await fetch(new URL("/api/health", base), { signal: AbortSignal.timeout(15_000) });
    return await response.text();
  } catch {
    return "";
  }
}

/** Polls until `test` returns something truthy, every `every` seconds, at most `times` times. */
async function until(test, every, times) {
  for (let i = 0; i < times; i++) {
    const value = await test();
    if (value) return value;
    await sleep(every);
  }
  return null;
}

function checksState(pr) {
  const states = JSON.parse(ghMayFail("pr", "checks", pr, "--json", "state") || "[]").map((c) => c.state);
  return [...new Set(states)].join(",");
}

const BASE = productionUrl();
const REPO = gh("repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner");

console.log(`== waiting for ${PREV} on production`);
const onProduction = await until(async () => {
  const body = await health(BASE);
  return body.includes(`"${PREV}`) || body.includes(`"${NEW}`);
}, 30, 120);
if (!onProduction) stop(`production never reported ${PREV}`);

console.log(`== batch PR #${PR}`);
const batchInfo = JSON.parse(gh("pr", "view", PR, "--json", "state,baseRefName,mergeCommit"));
let batchMerge;
if (batchInfo.state === "MERGED" && batchInfo.baseRefName === "qa") {
  batchMerge = batchInfo.mergeCommit.oid;
  console.log(`PR #${PR} is already merged into qa (${batchMerge.slice(0, 8)}): continuing from step 3`);
} else if (batchInfo.state === "MERGED") {
  stop(`PR #${PR} is already merged, but into ${batchInfo.baseRefName}, not qa`);
} else {
  ghMayFail("pr", "checks", PR, "--watch", "--interval", "30");
  const batchState = checksState(PR);
  console.log(`checks: ${batchState}`);
  if (batchState !== "SUCCESS") stop(`PR #${PR} is not green`);
  gh("pr", "merge", PR, "--merge");
  batchMerge = gh("pr", "view", PR, "--json", "mergeCommit", "-q", ".mergeCommit.oid");
}

console.log("== the qa run on that merge");
const qaRun = await until(() => {
  const runs = JSON.parse(ghMayFail("run", "list", "--branch", "qa", "--limit", "10", "--json", "databaseId,name,headSha") || "[]");
  return runs.find((r) => r.name === "docs-check" && r.headSha === batchMerge)?.databaseId;
}, 15, 40);
if (!qaRun) stop(`no docs-check run appeared on qa for ${batchMerge.slice(0, 8)}`);
console.log(`qa run: ${qaRun}`);

let release = ghMayFail("pr", "list", "--base", "main", "--head", "qa", "--json", "number", "-q", ".[0].number");
if (!release) {
  const body = join(tmpdir(), `ship-${PR}.md`);
  writeFileSync(body, `Release **${NEW}** — batch PR #${PR}: ${TITLE}\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n`);
  const url = gh("pr", "create", "--base", "main", "--head", "qa", "--title", `Release ${NEW}: ${TITLE}`, "--body-file", body);
  release = url.split("/").pop();
}
console.log(`release PR: #${release}`);

let conclusion = "";
for (let attempt = 1; attempt <= 2; attempt++) {
  ghMayFail("run", "watch", String(qaRun), "--interval", "30");
  conclusion = gh("run", "view", String(qaRun), "--json", "conclusion", "-q", ".conclusion");
  console.log(`qa run attempt ${attempt}: ${conclusion}`);
  if (conclusion === "success" || attempt === 2) break;
  if (!ghMayFail("run", "view", String(qaRun), "--log-failed").includes("font/google")) break;
  console.log("the Google Fonts flake: rerunning once");
  ghMayFail("run", "rerun", String(qaRun), "--failed");
  await sleep(30);
}
if (conclusion !== "success") stop(`the release is not merged: the qa run ended ${conclusion}`);

ghMayFail("pr", "checks", release, "--watch", "--interval", "30");
console.log(`release PR checks: ${checksState(release)}`);
gh("pr", "merge", release, "--merge");
const releaseMerge = gh("pr", "view", release, "--json", "mergeCommit", "-q", ".mergeCommit.oid");

console.log("== the migration run on main, if any");
const migration = await until(() => {
  const runs = JSON.parse(ghMayFail("run", "list", "--branch", "main", "--workflow", "migrate.yml", "--limit", "5", "--json", "databaseId,status,headSha") || "[]");
  return runs.find((r) => r.headSha === releaseMerge);
}, 15, 12);
if (!migration) console.log("no migration run for this release");
else {
  const id = String(migration.databaseId);
  const waiting = await until(() => {
    const status = gh("run", "view", id, "--json", "status", "-q", ".status");
    return status === "waiting" || status === "completed" ? status : null;
  }, 15, 40);
  if (waiting === "waiting") {
    const env = gh("api", `repos/${REPO}/actions/runs/${id}/pending_deployments`, "-q", ".[0].environment.id");
    gh("api", "-X", "POST", `repos/${REPO}/actions/runs/${id}/pending_deployments`, "-F", `environment_ids[]=${env}`, "-f", "state=approved", "-f", `comment=Release ${NEW}`);
    console.log(`approved migration run ${id}`);
  }
  ghMayFail("run", "watch", id, "--interval", "15");
  const migrated = gh("run", "view", id, "--json", "conclusion", "-q", ".conclusion");
  console.log(`migration: ${migrated}`);
  if (migrated !== "success") stop(`the migration run ${id} ended ${migrated}; production still runs the previous build`);
}

console.log(`== waiting for ${NEW} on production`);
const live = await until(async () => {
  const body = await health(BASE);
  return body.includes(`"${NEW}`) ? body : null;
}, 20, 60);
if (!live) stop(`production did not report ${NEW} in time — check the Vercel deployment`);
console.log(`production: ${live.match(/"status":"[a-z]+"/)?.[0] ?? "?"} ${NEW}`);
