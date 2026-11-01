#!/usr/bin/env node
/**
 * The verdict of the GitHub backstop (`.github/workflows/scheduled-jobs.yml`, §874).
 *
 * The workflow reads `/api/health?deep=1` BEFORE it pokes the two job endpoints (a poke records a
 * ping, and a recent ping reads as «ok», so a health read after the pokes hides a dead pinger),
 * pokes anyway, and then asks this script what the early answer said. No dependency; the decision is
 * a pure function of the health JSON and the clock so a test can feed it both.
 *
 *   node scripts/backstop-verdict.mjs --name production --file health.json [--now 2026-11-01T01:17:00Z]
 *
 * Prints the summary and GitHub annotations (`::error::`, `::warning::`) and exits 1 when there is
 * an error. The one tolerance: `registration-maintenance` reads `stale` between 03:05 and 04:00 in
 * Brașov, the pinger's known nightly gap (it skips 02:00 and 03:00, `src/modules/jobs/quiet-hours.ts`,
 * SETUP.md §40); the 01:17 UTC run lands inside it in winter.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { readClub } from "./club-files.mjs";

const CLUB = readClub();
const CLUB_TIME_ZONE = CLUB.place.timeZone;
/** The gap, in minutes after local midnight: from 03:05 (inclusive) up to 04:00 (exclusive). */
export const NIGHTLY_GAP = { from: 3 * 60 + 5, to: 4 * 60 };
export const TOLERATED_JOB = "registration-maintenance";

const HELP =
  "docs/RUNBOOKS.md § A red backstop run (scheduled-jobs)";
const NEON_HELP =
  "raise the quota in Neon (SETUP.md §40); a project already suspended needs the quota set to 0, the compute started and the quota set back (docs/RUNBOOKS.md § Neon suspended a project)";

/** Minutes after midnight in Brașov, daylight saving included, by the zone's name. */
export function clubMinuteOfDay(now) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CLUB_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}

export function inNightlyGap(now) {
  const minute = clubMinuteOfDay(now);
  return minute >= NIGHTLY_GAP.from && minute < NIGHTLY_GAP.to;
}

/**
 * @param {unknown} health the parsed `/api/health?deep=1` body, or null when it did not parse
 * @param {Date} now
 * @param {string} name the environment's name, for the messages
 * @returns {{ errors: string[], warnings: string[], lines: string[] }}
 */
export function judge(health, now, name) {
  const errors = [];
  const warnings = [];
  const lines = [];
  const body = health && typeof health === "object" ? health : {};

  const database = typeof body.database === "string" ? body.database : "no answer";
  const level = typeof body.budget?.level === "string" ? body.budget.level : "unknown";
  const percent = body.budget?.meteredPercent ?? "?";
  lines.push(`${name}: database ${database}, Neon budget ${level} (${percent} % of the month's compute quota)`);

  if (database !== "ok") {
    errors.push(
      `${name}'s database does not answer (${database}) — if Neon suspended the project for its quota, ${NEON_HELP}`,
    );
  }
  if (level === "red") {
    errors.push(`${name} has used ${percent} % of its monthly Neon compute quota — ${NEON_HELP}, before it stops`);
  }
  if (level === "amber") warnings.push(`${name} has used ${percent} % of its monthly Neon compute quota`);

  // Jobs and email are only meaningful when the database answered; otherwise the line above is the news.
  if (database === "ok") {
    const gap = inNightlyGap(now);
    const jobs = Array.isArray(body.jobs) ? body.jobs : [];
    for (const job of jobs) {
      if (!job || job.status === "ok") continue;
      const jobName = String(job.jobName);
      if (jobName === TOLERATED_JOB && job.status === "stale" && gap) {
        lines.push(`${name}: ${jobName} is stale inside the nightly gap (03:05–04:00 in ${CLUB.place.locality}); tolerated`);
        continue;
      }
      errors.push(
        `${name}'s job ${jobName} is ${job.status} (last finished ${job.lastFinishedAt ?? "never"}, last ping ${job.lastPingAt ?? "never"}) — the pinger may be dead; ${HELP}`,
      );
    }
    if (body.email?.status === "stalled") {
      errors.push(`${name}'s email outbox is stalled — a deferral, an overdue row or a failure needs a person; ${HELP}`);
    }
  }

  return { errors, warnings, lines };
}

function option(args, flag) {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}

function main(args) {
  const name = option(args, "--name") ?? "environment";
  const file = option(args, "--file");
  const nowText = option(args, "--now");
  const now = nowText ? new Date(nowText) : new Date();
  let health = null;
  let text;
  try {
    text = readFileSync(file ?? "", "utf8");
  } catch {
    console.log(`::error::no health answer was saved for ${name} (the early read did not run, e.g. the checkout failed); ${HELP}`);
    return 1;
  }
  try {
    health = JSON.parse(text);
  } catch {
    health = null;
  }
  const { errors, warnings, lines } = judge(health, now, name);
  for (const line of lines) console.log(line);
  for (const warning of warnings) console.log(`::warning::${warning}`);
  for (const error of errors) console.log(`::error::${error}`);
  return errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
