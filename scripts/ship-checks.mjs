/**
 * How `yarn ship` reads a pull request's checks (§426) — kept apart from `ship.mjs`, which runs
 * `gh` on import, so the rule is testable without GitHub.
 *
 * The defect this answers: `ship` judged a pull request the moment `gh pr checks --watch`
 * returned, and `--watch` returns as soon as nothing it can see is running — before a workflow
 * has registered its checks at all ("no checks reported"), or between one job finishing and the
 * next one (the e2e job, a Vercel deployment) appearing. A batch PR could be stopped as "not
 * green" with nothing red on it, and the release PR could be merged with its checks still running.
 * Now nothing is judged until the same set of checks has been seen twice in a row with none of
 * them pending.
 *
 * Since §NNN it also holds how `ship` waits on one workflow run — by reading the run's status
 * until it says "completed", never by `gh run watch`, whose exit says nothing about the run —
 * and the clock `ship` keeps of its own steps.
 */

/** `gh pr checks --json bucket` sorts every state into one of these five. */
const BUCKET_OF_STATE = {
  SUCCESS: "pass",
  SKIPPED: "skipping",
  NEUTRAL: "skipping",
  PENDING: "pending",
  QUEUED: "pending",
  IN_PROGRESS: "pending",
  WAITING: "pending",
  REQUESTED: "pending",
  EXPECTED: "pending",
  CANCELLED: "cancel",
};

/** A check's bucket: gh's own when it gives one, else derived from the state (an older gh). */
export function bucketOf(check) {
  if (check.bucket) return check.bucket;
  return BUCKET_OF_STATE[String(check.state ?? "").toUpperCase()] ?? "fail";
}

/**
 * The verdict on one reading of the checks.
 *
 *   none     — no check registered yet; not a verdict, a reason to wait;
 *   pending  — at least one check has not finished;
 *   green    — every check passed or was skipped (a job whose `if:` was false);
 *   red      — at least one failed or was cancelled, other than those `tolerate` names.
 *
 * `tolerate` is a RegExp of check names whose red is reported but does not stop the release —
 * the release PR's Vercel deployment checks, which go red on Hobby's daily deploy limit rather
 * than on the code (the qa run has already judged the code by then).
 */
export function judgeChecks(checks, { tolerate } = {}) {
  const verdict = (v, rest = {}) => ({ verdict: v, pending: [], red: [], tolerated: [], ...rest });
  if (checks.length === 0) return verdict("none");
  const pending = checks.filter((c) => bucketOf(c) === "pending").map((c) => c.name);
  if (pending.length > 0) return verdict("pending", { pending });
  const notGreen = checks.filter((c) => !["pass", "skipping"].includes(bucketOf(c)));
  const isTolerated = (c) => Boolean(tolerate?.test(c.name));
  const red = notGreen.filter((c) => !isTolerated(c)).map((c) => c.name);
  const tolerated = notGreen.filter(isTolerated).map((c) => c.name);
  return verdict(red.length > 0 ? "red" : "green", { red, tolerated });
}

/** One reading as a comparable string: which checks exist and where each one stands. */
function fingerprint(checks) {
  return checks
    .map((c) => `${c.name}\u0000${bucketOf(c)}`)
    .sort()
    .join("\u0001");
}

/**
 * Reads the checks until they settle: none pending, and the same checks in the same buckets on two
 * readings `every` seconds apart — so a check that registers late (the next job, a deployment) is
 * waited for rather than missed.
 *
 *   read()  → the checks now, as `gh pr checks --json name,state,bucket` gives them ([] for none);
 *   sleep(seconds) → a promise;
 *   polls   → the most readings before giving up;
 *   maxEmpty → the most readings in a row with no check at all before giving up.
 *
 * Returns { status: "settled", checks } | { status: "no-checks" } | { status: "timeout", pending }.
 *
 * @param {() => Array<{ name: string, state?: string, bucket?: string }>} read
 * @param {{ sleep: (seconds: number) => Promise<unknown>, every?: number, polls?: number, maxEmpty?: number,
 *           onPending?: (pending: string[], reading: number) => void }} options
 */
export async function waitForSettledChecks(read, { sleep, every = 30, polls = 180, maxEmpty = 20, onPending }) {
  let previous = null;
  let last = [];
  let empty = 0;
  let pending = [];
  for (let i = 0; i < polls; i++) {
    const checks = read();
    const { verdict, pending: stillPending } = judgeChecks(checks);
    if (verdict === "none") {
      previous = null;
      if (++empty >= maxEmpty) return { status: "no-checks" };
    } else if (verdict === "pending") {
      empty = 0;
      previous = null;
      pending = stillPending;
      onPending?.(stillPending, i);
    } else {
      empty = 0;
      const now = fingerprint(checks);
      if (now === previous) return { status: "settled", checks };
      previous = now;
      last = checks;
    }
    if (i < polls - 1) await sleep(every);
  }
  // The last reading had nothing pending but no second look to confirm it: take it.
  if (previous !== null) return { status: "settled", checks: last };
  return { status: "timeout", pending };
}

/**
 * Waits for one workflow run to complete, reading its status every `every` seconds (§NNN).
 *
 * `ship` used `gh run watch`, then read the conclusion once. `watch` returns on its own errors (a
 * dropped connection, a rate limit) as readily as on the run's end, and a run just rerun reads
 * its old conclusion for a moment — so a run still going could be judged by an empty or a stale
 * conclusion. Now only a reading whose status is "completed" ends the wait.
 *
 *   read()  → the run now, `{ status, conclusion }` as `gh run view/list --json` gives it, or null
 *             while it has not appeared;
 *   onRead(run, reading) → called on every reading of a run that exists (the migration's approval);
 *   maxMissing → the most readings in a row without the run before giving up.
 *
 * Returns { status: "completed", conclusion, run } | { status: "missing" } | { status: "timeout", run }.
 *
 * @param {() => ({ status?: string, conclusion?: string | null } | null | undefined)} read
 * @param {{ sleep: (seconds: number) => Promise<unknown>, every?: number, polls?: number, maxMissing?: number,
 *           onRead?: (run: { status?: string, conclusion?: string | null }, reading: number) => unknown }} options
 */
export async function waitForRun(read, { sleep, every = 15, polls = 240, maxMissing = 40, onRead }) {
  let missing = 0;
  let last = null;
  for (let i = 0; i < polls; i++) {
    const run = read();
    if (!run) {
      if (++missing >= maxMissing) return { status: "missing" };
    } else {
      missing = 0;
      last = run;
      if (String(run.status ?? "").toLowerCase() === "completed") {
        return { status: "completed", conclusion: String(run.conclusion ?? "").toLowerCase(), run };
      }
      await onRead?.(run, i);
    }
    if (i < polls - 1) await sleep(every);
  }
  return last ? { status: "timeout", run: last } : { status: "missing" };
}

/** A duration as `m:ss` — minutes are not wrapped into hours, a release is read in minutes. */
export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The clock `ship` keeps of itself (§NNN): each step from its start to the next one's, and the
 * whole. `report()` counts a step still open up to now, so a stop says where the time went too;
 * `onStepEnd` hears each step the moment it ends, so a long release shows its times as it goes.
 *
 * @param {() => number} [now]
 * @param {(step: { name: string, ms: number }) => void} [onStepEnd]
 */
export function createClock(now = Date.now, onStepEnd) {
  const started = now();
  const done = [];
  let open = null;
  const close = () => {
    if (open) {
      const step = { name: open.name, ms: now() - open.at };
      done.push(step);
      onStepEnd?.(step);
    }
    open = null;
  };
  const summary = () => {
    const steps = open ? [...done, { name: open.name, ms: now() - open.at, open: true }] : [...done];
    return { steps, totalMs: now() - started };
  };
  return {
    /** Ends the step running, if any, and starts `name`. */
    step(name) {
      close();
      open = { name, at: now() };
    },
    /** Ends the step running. */
    end() {
      close();
    },
    summary,
    /** The steps and the total as aligned lines; an open step is marked where it stopped. */
    report() {
      const { steps, totalMs } = summary();
      const width = Math.max(5, ...steps.map((s) => s.name.length));
      const lines = steps.map((s) => `  ${s.name.padEnd(width)}  ${formatDuration(s.ms).padStart(6)}${s.open ? "  (stopped here)" : ""}`);
      lines.push(`  ${"total".padEnd(width)}  ${formatDuration(totalMs).padStart(6)}`);
      return lines;
    },
  };
}
