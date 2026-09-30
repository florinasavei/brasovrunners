#!/usr/bin/env node
/**
 * What an environment consumed while nobody visited it (§NNN) — `yarn idle:measure`.
 *
 * Usage: yarn idle:measure [--hours 24] [--neon-project <id>] [--vercel-project <name>]
 *
 * The owner, 2026-09-29: «dacă site-ul stă în idle nu vreau să consum nimic!». The target is zero
 * outside the daily maintenance window (04:00 in Brașov, `jobs/schedule.ts`): no Neon wake, no
 * function invocation but the job pingers' own, which answer from the cache. This reads, read-only:
 *
 * - **Neon's operations log** (`GET /projects/{id}/operations`, the log §327 measured from; the
 *   consumption API is Scale-only): every `start_compute` in the window is a wake, paired with the
 *   `suspend_compute` after it for the time awake. Each wake is classed by the club's clock: inside
 *   the daily window, or outside it — at a pinger minute (:00–:03, :15, :30, :45) or any other.
 *   Needs `NEON_API_KEY` (and `NEON_PROJECT_ID` or `--neon-project`), from the environment or
 *   `.env.local`; nothing is printed of either.
 * - **Vercel's request log**, when `--vercel-project` names a project: `vercel logs --json` through
 *   the CLI you are logged in with. Hobby keeps an hour of it, so this window is the last hour at
 *   most. Requests are grouped by what they are — a job ping, the health check, a scanner's probe, a
 *   page (and whether the CDN answered it), the proxy — because an invocation count alone says
 *   nothing about where the Active CPU went (route-level CPU is Observability Plus, not Hobby).
 *
 * The before-and-after table and the procedure around it are in `docs/PLATFORM.md` § Idle cost.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const CLUB_TIME_ZONE = "Europe/Bucharest";
/** The daily window (`jobs/schedule.ts#DAILY_WINDOW_CLUB_MINUTE`) and how long its wake may last. */
export const WINDOW_START_MINUTE = 4 * 60;
export const WINDOW_LENGTH_MINUTES = 15;
/** Neon Launch, 2026: a compute sleeps five idle minutes after the last query, at 0.25 CU at least, $0.106 per CU-hour. */
const CU = 0.25;
const PRICE_PER_CU_HOUR = 0.106;

const clubClock = new Intl.DateTimeFormat("en-GB", { timeZone: CLUB_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Minutes after midnight on the club's clock. */
export function clubMinute(at) {
  let hour = 0;
  let minute = 0;
  for (const part of clubClock.formatToParts(at)) {
    if (part.type === "hour") hour = Number(part.value) % 24;
    if (part.type === "minute") minute = Number(part.value);
  }
  return hour * 60 + minute;
}

/** `window` inside the daily maintenance window; `pinger` at a monitor's minute; `other` any other. */
export function classifyWake(at) {
  const minute = clubMinute(at);
  if (minute >= WINDOW_START_MINUTE && minute < WINDOW_START_MINUTE + WINDOW_LENGTH_MINUTES) return "window";
  const inHour = minute % 60;
  return inHour % 15 <= 3 ? "pinger" : "other";
}

/**
 * Wakes and time awake from Neon's operations, oldest first, inside [from, to). A wake whose suspend
 * is not in the log yet counts as awake until `to`.
 */
export function neonWakes(operations, from, to) {
  const ops = operations
    .filter((op) => op.action === "start_compute" || op.action === "suspend_compute")
    .map((op) => ({ action: op.action, at: Date.parse(op.created_at) }))
    .sort((a, b) => a.at - b.at);
  const wakes = [];
  let open = null;
  for (const op of ops) {
    if (op.action === "start_compute") {
      if (open === null) open = op.at;
    } else if (open !== null) {
      wakes.push({ at: open, minutes: (op.at - open) / 60_000 });
      open = null;
    }
  }
  if (open !== null) wakes.push({ at: open, minutes: (to - open) / 60_000 });
  return wakes.filter((wake) => wake.at >= from && wake.at < to).map((wake) => ({ ...wake, kind: classifyWake(wake.at) }));
}

/** The Vercel log rows as a person reads them: what each request was. */
export function requestKind(row) {
  const path = row.requestPath ?? "";
  if (path.startsWith("/api/internal/jobs/")) return "job ping";
  if (path.startsWith("/api/health")) return path.includes("deep=") ? "health (deep)" : "health";
  if (path.startsWith("/api/webhooks/")) return "webhook";
  if (/\.(php|asp|aspx|jsp|cgi)(\?|$)|^\/(wp-|wordpress|xmlrpc|\.env|\.git|phpmyadmin|cgi-bin)/i.test(path)) return "scanner probe";
  if (path.startsWith("/api/")) return "api";
  if (row.source === "serverless-middleware") return `proxy (${row.cache || "no cache"})`;
  if (row.source === "static") return "static file";
  return `render (${row.cache || "no cache"})`;
}

/** Counts per kind, one row per unique request id (the CLI repeats pages of the same rows). */
export function summariseRequests(rows) {
  const seen = new Set();
  const counts = new Map();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const kind = requestKind(row);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return { total: seen.size, counts: [...counts.entries()].sort((a, b) => b[1] - a[1]) };
}

function readLocalEnv(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(".env.local")) return undefined;
  const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") || undefined;
}

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function readNeonOperations(key, project, from) {
  const operations = [];
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    const url = new URL(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(project)}/operations`);
    url.searchParams.set("limit", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { headers: { authorization: `Bearer ${key}`, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Neon answered ${response.status} for the operations log`);
    const body = await response.json();
    const batch = body.operations ?? [];
    operations.push(...batch);
    cursor = body.pagination?.cursor ?? "";
    if (!cursor || batch.length === 0 || batch.some((op) => Date.parse(op.created_at) < from)) break;
  }
  return operations;
}

function readVercelLog(project, hours) {
  const since = `${Math.min(hours, 1) * 60}m`;
  const out = execFileSync("npx", ["vercel", "logs", "-p", project, "--environment", "production", "--since", since, "--json", "-n", "1000"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
    maxBuffer: 256 * 1024 * 1024,
  });
  return out
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
}

async function main() {
  const hours = Number(flag("hours", "24"));
  const to = Date.now();
  const from = to - hours * 3_600_000;
  console.log(`\nIdle cost, the last ${hours} h (${new Date(from).toISOString()} → ${new Date(to).toISOString()})\n`);

  const key = readLocalEnv("NEON_API_KEY");
  const project = flag("neon-project", readLocalEnv("NEON_PROJECT_ID"));
  const operations = key && project ? await readNeonOperations(key, project, from).catch((error) => error) : null;
  if (operations instanceof Error) {
    // A key scoped to the other environment's project answers 404: say so and read the rest.
    console.log(`Neon: not read — ${operations.message} (is the key this project's?)`);
  } else if (operations) {
    const wakes = neonWakes(operations, from, to);
    const awake = wakes.reduce((sum, wake) => sum + wake.minutes, 0);
    const by = (kind) => wakes.filter((wake) => wake.kind === kind);
    console.log("Neon (operations log)");
    console.log(`  wakes                  ${wakes.length}`);
    console.log(`  inside the 04:00 window ${by("window").length}`);
    console.log(`  outside, at a pinger minute ${by("pinger").length}   ← a monitor or a job reached the database`);
    console.log(`  outside, any other minute  ${by("other").length}   ← a visitor, a crawler, staff, a deployment`);
    console.log(`  awake                  ${(awake / 60).toFixed(2)} h ≈ ${((awake / 60) * CU).toFixed(2)} CU-h ≈ $${((awake / 60) * CU * PRICE_PER_CU_HOUR).toFixed(2)}`);
    for (const wake of wakes.filter((w) => w.kind !== "window")) {
      console.log(`    ${clubClock.format(wake.at)}  ${wake.kind.padEnd(6)} ${wake.minutes.toFixed(1)} min`);
    }
  } else {
    console.log("Neon: skipped — NEON_API_KEY and NEON_PROJECT_ID (or --neon-project) are not set");
  }

  const vercelProject = flag("vercel-project", "");
  if (vercelProject) {
    const { total, counts } = summariseRequests(readVercelLog(vercelProject, hours));
    console.log(`\nVercel (request log, the last ${Math.min(hours, 1)} h — Hobby keeps one)`);
    console.log(`  requests ${total}`);
    for (const [kind, count] of counts) console.log(`  ${String(count).padStart(6)}  ${kind}`);
  } else {
    console.log("\nVercel: skipped — pass --vercel-project <name> to read the last hour of requests");
  }
  console.log("\nThe 30-day Active CPU and invocations are on Vercel → Usage; docs/PLATFORM.md § Idle cost says what to compare.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("\n  idle:measure failed:", error instanceof Error ? error.message : error, "\n");
    process.exit(1);
  });
}
