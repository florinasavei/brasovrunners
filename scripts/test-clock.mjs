// `yarn test:clock` — the calendar-proof check (§NNN, `docs/DEVELOPMENT.md` § Tests that the
// calendar breaks).
//
// Runs the unit and database suite with the real clock moved forward — once per date — and prints
// every test that fails there. A test that fails only with the clock moved is a bomb: its fixture
// pins a date, something on its path reads `new Date()`, and the day the real clock passes that
// date the test goes red in somebody's pre-commit hook. Run `yarn test` first: a test that already
// fails today is broken, not a bomb.
//
//   yarn test:clock                          the three default dates: +1 month, +1 year, +10 years
//   yarn test:clock +3d 2031-06-01           any dates: ISO, or +N with d (days), m (months), y (years)
//   yarn test:clock --workers 4 +1y -- tests/integration/registrations
//                                            the worker count (2 by default: the machine is shared),
//                                            and, after `--`, the files or folders to run
//
// Exit code 1 when any date has a failure. The shift itself is `tests/helpers/shifted-clock.mjs`,
// loaded by `vitest.config.mts` only while `TEST_CLOCK_AT` is set.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_DATES = ["+1m", "+1y", "+10y"];

/** `+12d`, `+1m`, `+10y` from `from`, or an ISO date as written. */
export function resolveDate(spec, from = new Date()) {
  const relative = /^\+(\d+)([dmy])$/.exec(spec);
  if (!relative) {
    const at = new Date(spec);
    if (Number.isNaN(at.getTime())) throw new Error(`Not a date: ${spec} (ISO, or +N with d, m or y)`);
    return at;
  }
  const amount = Number(relative[1]);
  const at = new Date(from.getTime());
  if (relative[2] === "d") at.setUTCDate(at.getUTCDate() + amount);
  if (relative[2] === "m") at.setUTCMonth(at.getUTCMonth() + amount);
  if (relative[2] === "y") at.setUTCFullYear(at.getUTCFullYear() + amount);
  return at;
}

/** The arguments: dates, `--workers N`, and the vitest filters after `--`. */
export function parseArguments(argv) {
  const dashes = argv.indexOf("--");
  const own = dashes === -1 ? argv : argv.slice(0, dashes);
  const filters = dashes === -1 ? [] : argv.slice(dashes + 1);
  let workers = 2;
  const dates = [];
  for (let index = 0; index < own.length; index += 1) {
    if (own[index] === "--workers") {
      workers = Number(own[index + 1]);
      index += 1;
      if (!Number.isInteger(workers) || workers < 1) throw new Error("--workers takes a whole number");
    } else dates.push(own[index]);
  }
  return { dates: dates.length > 0 ? dates : DEFAULT_DATES, workers, filters };
}

/** The failed tests of a vitest JSON report, as `file › name`. */
export function failuresOf(report, root) {
  const failed = [];
  for (const file of report.testResults ?? []) {
    const name = path.relative(root, file.name).split(path.sep).join("/");
    const tests = (file.assertionResults ?? []).filter((test) => test.status === "failed");
    if (tests.length === 0 && file.status === "failed") failed.push(`${name} › (the file itself: ${String(file.message ?? "").split("\n")[0]})`);
    for (const test of tests) failed.push(`${name} › ${test.fullName}`);
  }
  return failed;
}

function main() {
  const { dates, workers, filters } = parseArguments(process.argv.slice(2));
  const root = process.cwd();
  const vitest = path.join(path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
  const scratch = mkdtempSync(path.join(tmpdir(), "test-clock-"));
  let bombs = 0;
  try {
    for (const spec of dates) {
      const at = resolveDate(spec).toISOString();
      const output = path.join(scratch, `${at.replace(/[:.]/g, "-")}.json`);
      console.log(`\n▶ the clock at ${at} (${spec}), ${workers} worker(s)…`);
      const run = spawnSync(
        process.execPath,
        [vitest, "run", `--maxWorkers=${workers}`, "--reporter=dot", "--reporter=json", `--outputFile.json=${output}`, ...filters],
        // One offset for every process of the run, so a script a test spawns minutes in reads the
        // same moved clock as the test (`tests/helpers/shifted-clock.mjs`).
        { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, TEST_CLOCK_AT: at, TEST_CLOCK_OFFSET_MS: String(Date.parse(at) - Date.now()) } },
      );
      let report;
      try {
        report = JSON.parse(readFileSync(output, "utf8"));
      } catch {
        console.log(`  ✗ vitest wrote no report (exit ${run.status}) — rerun when the machine is quieter`);
        bombs += 1;
        continue;
      }
      const failed = failuresOf(report, root);
      console.log(`  ${report.numPassedTests} passed, ${failed.length} failed of ${report.numTotalTests}`);
      for (const line of failed) console.log(`  ✗ ${line}`);
      bombs += failed.length;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(bombs === 0 ? "\nNo test reads a calendar it cannot keep." : `\n${bombs} failure(s) with the clock moved — fixtures the calendar will reach.`);
  process.exitCode = bombs === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
