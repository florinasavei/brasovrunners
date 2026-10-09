#!/usr/bin/env node
/**
 * Ship one small batch to production, end to end — the release step of `docs/DISPATCHER.md`.
 *
 * Usage: yarn ship <batch PR> <new baseline> <previous baseline> "<release title>"
 *        yarn ship 163 BR-V2.82-2026-10-09 BR-V1.81-2026-09-24 "the listing cards and the partner marker"
 *
 *   1. waits until production reports the previous baseline: one release at a time;
 *   2. waits for the batch PR's checks to settle (§426), stops unless green, merges it into `qa`
 *      (an already-merged PR continues from step 3);
 *   3. waits for `qa`'s docs-check run on that merge to complete (§504);
 *   4. only then opens (or takes) the `qa → main` release PR, so its run finds the tree tested;
 *   5. waits for its checks — a Vercel deployment's red is reported, not stopped on — and merges it;
 *   6. if the release changes a migration, approves the gated `migrate.yml` run (`DECISIONS.md` §31)
 *      and waits for it;
 *   7. waits until production's `/api/health` reports the new baseline.
 *
 * Both production waits say every two minutes what production answers — nothing, another build,
 * or a body with no baseline — and a STOP says which (§658).
 *
 * Each step's time is printed and appended to `SHIP_TIMES_FILE` (§504). Needs `gh` with the right to
 * merge and approve the `production` environment. Production's origin is `SHIP_PRODUCTION_URL`, never
 * in this public file (the domain lives in `SETUP.md` §26 alone).
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  createClock,
  formatDuration,
  judgeChecks,
  mergePullRequest,
  waitForProduction,
  waitForRun,
  waitForSettledChecks,
  withoutWorkflow,
} from "./ship-checks.mjs";

const clock = createClock(Date.now, (s) => console.log(`-- ${s.name}: ${formatDuration(s.ms)}`));
const [PR, NEW, PREV, TITLE] = process.argv.slice(2);
if (!PR || !NEW || !PREV || !TITLE) {
  console.error('Usage: yarn ship <batch PR> <new baseline> <previous baseline> "<title>"');
  process.exit(1);
}

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** The clock's lines on the console and one JSON line in the times file; never fails the release. */
function measured(outcome) {
  const { steps, totalMs } = clock.summary();
  console.log(`\n== ${NEW}: ${outcome}, step by step (m:ss)`);
  for (const line of clock.report()) console.log(line);
  const file = process.env.SHIP_TIMES_FILE || join(tmpdir(), "brasovrunners-ship-times.jsonl");
  const record = {
    at: new Date().toISOString(),
    release: NEW,
    batchPr: Number(PR),
    outcome,
    totalSeconds: Math.round(totalMs / 1000),
    steps: steps.map((s) => ({ name: s.name, seconds: Math.round(s.ms / 1000) })),
  };
  try {
    appendFileSync(file, `${JSON.stringify(record)}\n`);
    console.log(`  (appended to ${file})`);
  } catch {
    // A times file that cannot be written is not a reason to fail a release.
  }
}

function stop(message) {
  console.error(`\n  STOP: ${message}\n`);
  measured(`stopped: ${message.split("\n")[0]}`);
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

/** `gh pr merge`, judged by the PR's state rather than the exit alone (§520). */
async function merge(pr) {
  const outcome = await mergePullRequest(
    () => {
      const result = spawnSync("gh", ["pr", "merge", pr, "--merge"], { encoding: "utf8" });
      if (result.error) stop(`gh could not start: ${result.error.message}`);
      return { status: result.status, stderr: result.stderr };
    },
    () => ghMayFail("pr", "view", pr, "--json", "state", "-q", ".state"),
    { sleep },
  );
  if (outcome.status !== "merged") stop(`gh pr merge ${pr} --merge\n  ${outcome.error}`);
  if (outcome.waited > 0) console.log(`  PR #${pr} merged after ${outcome.waited} s («Merge already in progress»)`);
}

function productionUrl() {
  if (process.env.SHIP_PRODUCTION_URL) return process.env.SHIP_PRODUCTION_URL;
  if (existsSync(".env.local")) {
    const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith("SHIP_PRODUCTION_URL="));
    const value = line?.slice("SHIP_PRODUCTION_URL=".length).trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  stop("set SHIP_PRODUCTION_URL (production's origin) in the environment or in .env.local");
}

/**
 * Production's `/api/health`. Shallow by default since §577 — the build and the configuration, no
 * database — so the polls below, every 20 to 30 seconds while a release is on its way, wake
 * nothing. `deep` asks for the full report once, after the flip, to say how the site is.
 * Returns the body, or the fetch error rather than an empty string, so a wait can say whether
 * production did not answer or answered with another build (§658).
 */
async function health(base, { deep = false } = {}) {
  try {
    const response = await fetch(new URL(deep ? "/api/health?deep=1" : "/api/health", base), { signal: AbortSignal.timeout(15_000) });
    return { body: await response.text(), error: null, status: response.status };
  } catch (error) {
    return { body: "", error };
  }
}

/** Waits for production to report one of `expected`, saying what it sees every two minutes (§658). */
function productionReports(expected, every, polls) {
  return waitForProduction(() => health(BASE), expected, { sleep, every, polls, onReport: (line) => console.log(`  ${line}`) });
}

/** Waits until the PR's checks settle, then judges them (§426); stops on a red `tolerate` does not name. */
async function settledChecks(pr, { tolerate } = {}) {
  // Under release.yml, the release's own job is a pending check on the PR it ships (§535).
  const skip = process.env.SHIP_SKIP_WORKFLOW || "";
  const fields = skip ? "name,state,bucket,workflow" : "name,state,bucket";
  const read = () => withoutWorkflow(JSON.parse(ghMayFail("pr", "checks", pr, "--json", fields) || "[]"), skip);
  const waited = await waitForSettledChecks(read, {
    sleep,
    every: 30,
    polls: 180,
    maxEmpty: 20,
    onPending: (pending, i) => {
      if (i % 4 === 0) console.log(`  waiting on ${pending.length} check(s): ${pending.join(", ")}`);
    },
  });
  if (waited.status === "no-checks") stop(`PR #${pr} reported no checks for ten minutes`);
  if (waited.status === "timeout") stop(`PR #${pr}: checks still pending after ninety minutes (${waited.pending.join(", ")})`);
  const judged = judgeChecks(waited.checks, { tolerate });
  console.log(`checks on #${pr}: ${judged.verdict} (${waited.checks.length})`);
  if (judged.tolerated.length) console.log(`  red but not the code's verdict, reported and not stopped on: ${judged.tolerated.join(", ")}`);
  if (judged.verdict !== "green") stop(`PR #${pr} is not green: ${judged.red.join(", ")}`);
}

/** The newest push run of `workflow` on exactly `sha`, or null while none has appeared. */
function pushRunOf(workflow, sha) {
  const runs = JSON.parse(
    ghMayFail("run", "list", "--workflow", workflow, "--commit", sha, "--event", "push", "--limit", "5", "--json", "databaseId,status,conclusion") ||
      "[]",
  );
  return runs.length ? runs.reduce((a, b) => (b.databaseId > a.databaseId ? b : a)) : null;
}

/**
 * Whether `main..qa` touches `src/db/migrations`, as `migrate.yml`'s `paths` filter asks. Null when
 * git cannot say; the migration run is then waited for anyway.
 */
function releaseChangesMigrations() {
  const fetched = spawnSync("git", ["fetch", "--quiet", "origin", "main", "qa"], { encoding: "utf8" });
  if (fetched.status !== 0) return null;
  const diff = spawnSync("git", ["diff", "--name-only", "origin/main", "origin/qa", "--", "src/db/migrations"], { encoding: "utf8" });
  if (diff.status !== 0) return null;
  return diff.stdout.trim().length > 0;
}

const BASE = productionUrl();
const REPO = gh("repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner");

clock.step(`${PREV} on production`);
console.log(`== waiting for ${PREV} on production`);
const onProduction = await productionReports([PREV, NEW], 30, 120);
if (onProduction.status !== "expected") stop(`production never reported ${PREV} — ${onProduction.line}`);

clock.step(`batch PR #${PR}`);
console.log(`== batch PR #${PR}`);
const batchInfo = JSON.parse(gh("pr", "view", PR, "--json", "state,baseRefName,mergeCommit"));
let batchMerge;
if (batchInfo.state === "MERGED" && batchInfo.baseRefName === "qa") {
  batchMerge = batchInfo.mergeCommit.oid;
  console.log(`PR #${PR} is already merged into qa (${batchMerge.slice(0, 8)}): continuing from step 3`);
} else if (batchInfo.state === "MERGED") {
  stop(`PR #${PR} is already merged, but into ${batchInfo.baseRefName}, not qa`);
} else {
  await settledChecks(PR);
  await merge(PR);
  batchMerge = gh("pr", "view", PR, "--json", "mergeCommit", "-q", ".mergeCommit.oid");
}

clock.step("qa run");
console.log(`== the qa run on ${batchMerge.slice(0, 8)}`);
const qaRun = await waitForRun(() => pushRunOf("docs-check.yml", batchMerge), {
  sleep,
  every: 15,
  polls: 360, // ninety minutes
  maxMissing: 40, // ten minutes without the run appearing
  onRead: (r, i) => {
    if (i % 8 === 0) console.log(`  qa run ${r.databaseId}: ${String(r.status).toLowerCase()}`);
  },
});
if (qaRun.status === "missing") stop(`no docs-check run appeared on qa for ${batchMerge.slice(0, 8)}`);
if (qaRun.status === "timeout") stop(`the qa run ${qaRun.run.databaseId} was still ${qaRun.run.status} after ninety minutes`);
console.log(`qa run ${qaRun.run.databaseId}: ${qaRun.conclusion}`);
if (qaRun.conclusion !== "success") stop(`the release is not opened: the qa run ${qaRun.run.databaseId} ended ${qaRun.conclusion || "without a conclusion"}`);

clock.step("release PR");
let release = ghMayFail("pr", "list", "--base", "main", "--head", "qa", "--json", "number", "-q", ".[0].number");
if (!release) {
  const body = join(tmpdir(), `ship-${PR}.md`);
  writeFileSync(body, `Release **${NEW}** — batch PR #${PR}: ${TITLE}\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n`);
  const url = gh("pr", "create", "--base", "main", "--head", "qa", "--title", `Release ${NEW}: ${TITLE}`, "--body-file", body);
  release = url.split("/").pop();
}
console.log(`== release PR #${release}`);

// A Vercel deployment check can be red for Hobby's daily deploy limit alone; the qa run judged the code.
await settledChecks(release, { tolerate: /^Vercel\b/i });
const migrationExpected = releaseChangesMigrations();
await merge(release);
// From here the release is in main: a STOP in this step or the next is never re-labelled, and
// release.yml's closing comment tells the two apart by this step's name in the times file (§658).
clock.step("migration");
const releaseMerge = gh("pr", "view", release, "--json", "mergeCommit", "-q", ".mergeCommit.oid");
if (migrationExpected === false) {
  console.log("== no migration in this release: migrate.yml does not run");
} else {
  console.log(`== the migration run on main${migrationExpected === null ? " (git could not say whether one is due)" : ""}`);
  let approved = false;
  const migration = await waitForRun(() => pushRunOf("migrate.yml", releaseMerge), {
    sleep,
    every: 15,
    polls: 240, // an hour
    maxMissing: migrationExpected ? 40 : 12, // ten minutes when one is due, three when unsure
    onRead: (r) => {
      if (approved || String(r.status).toLowerCase() !== "waiting") return;
      const id = String(r.databaseId);
      const env = gh("api", `repos/${REPO}/actions/runs/${id}/pending_deployments`, "-q", ".[0].environment.id");
      gh("api", "-X", "POST", `repos/${REPO}/actions/runs/${id}/pending_deployments`, "-F", `environment_ids[]=${env}`, "-f", "state=approved", "-f", `comment=Release ${NEW}`);
      approved = true;
      console.log(`approved migration run ${id}`);
    },
  });
  if (migration.status === "missing") {
    if (migrationExpected) stop(`the release changes a migration, but no migrate.yml run appeared on main for ${releaseMerge.slice(0, 8)} in ten minutes`);
    console.log("no migration run for this release");
  } else if (migration.status === "timeout") {
    stop(`the migration run ${migration.run.databaseId} was still ${migration.run.status} after an hour`);
  } else {
    console.log(`migration: ${migration.conclusion}`);
    if (migration.conclusion !== "success") stop(`the migration run ${migration.run.databaseId} ended ${migration.conclusion}; production still runs the previous build`);
  }
}

clock.step(`${NEW} on production`);
console.log(`== waiting for ${NEW} on production`);
const live = await productionReports(NEW, 20, 60);
if (live.status !== "expected") {
  const hint = live.judged?.kind === "other-build" ? " — check Vercel's production deployment" : "";
  stop(`production did not report ${NEW} in time — ${live.line}${hint}`);
}
// One deep call, now that the new build answers: the database, the schema and the jobs (§577).
const report = (await health(BASE, { deep: true })).body || live.body;
console.log(`production: ${report.match(/"status":"[a-z]+"/)?.[0] ?? "?"} ${NEW}`);
clock.end();
measured("released");
