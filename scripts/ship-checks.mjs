/**
 * How `yarn ship` reads a pull request's checks (§NNN) — kept apart from `ship.mjs`, which runs
 * `gh` on import, so the rule is testable without GitHub.
 *
 * The defect this answers: `ship` judged a pull request the moment `gh pr checks --watch`
 * returned, and `--watch` returns as soon as nothing it can see is running — before a workflow
 * has registered its checks at all ("no checks reported"), or between one job finishing and the
 * next one (the e2e job, a Vercel deployment) appearing. A batch PR could be stopped as "not
 * green" with nothing red on it, and the release PR could be merged with its checks still running.
 * Now nothing is judged until the same set of checks has been seen twice in a row with none of
 * them pending.
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
