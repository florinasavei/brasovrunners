/**
 * How `yarn ship` reads a pull request's checks, waits on a workflow run and times its steps
 * (§426, §504) — apart from `ship.mjs`, which runs `gh` on import, so it is testable offline.
 * `gh pr checks --watch` returns before late checks register, so nothing is judged until the
 * same checks are seen twice in a row with none pending.
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
 * The verdict on one reading: none (nothing registered yet), pending, green (passed or skipped),
 * or red. `tolerate` names checks whose red is reported but does not stop the release — Vercel's
 * deployment checks, red on Hobby's daily deploy limit rather than on the code.
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

/**
 * The checks without those of `workflow` (§535): the release workflow is itself a pending check
 * on the PRs it ships, so judging it would wait for ever.
 *
 * @param {Array<{ name: string, workflow?: string }>} checks
 * @param {string} workflow
 */
export function withoutWorkflow(checks, workflow) {
  if (!workflow) return checks;
  return checks.filter((c) => c.workflow !== workflow);
}

/** One reading as a comparable string: which checks exist and where each one stands. */
function fingerprint(checks) {
  return checks
    .map((c) => `${c.name}\u0000${bucketOf(c)}`)
    .sort()
    .join("\u0001");
}

/**
 * Reads the checks until they settle: none pending and the same checks in the same buckets on two
 * readings `every` seconds apart, so a late-registering check is not missed. `maxEmpty` caps the
 * readings in a row with no check at all.
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
 * Waits for one workflow run until its status reads "completed" (§504). Not `gh run watch`: it
 * returns on its own errors too, and a just-rerun run briefly shows its old conclusion.
 * `read()` returns null while the run has not appeared; `onRead` sees every reading (the
 * migration's approval).
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

/**
 * Merges one pull request and says whether it is merged (§520). `gh pr merge` may exit non-zero on
 * a merge that goes through («Merge already in progress»), so a failure is checked against the
 * PR's state: polled up to `capSeconds` for that message, read once for any other.
 *
 * Returns { status: "merged", waited } | { status: "failed", error }.
 *
 * @param {() => { status: number | null, stderr?: string }} merge
 * @param {() => string} state
 * @param {{ sleep: (seconds: number) => Promise<unknown>, every?: number, capSeconds?: number }} options
 */
export async function mergePullRequest(merge, state, { sleep, every = 5, capSeconds = 60 }) {
  const result = merge();
  if (result.status === 0) return { status: "merged", waited: 0 };
  const error = String(result.stderr ?? "").trim();
  const isMerged = () => String(state() ?? "").trim().toUpperCase() === "MERGED";
  if (!/merge already in progress/i.test(error)) {
    return isMerged() ? { status: "merged", waited: 0 } : { status: "failed", error };
  }
  let waited = 0;
  for (;;) {
    if (isMerged()) return { status: "merged", waited };
    if (waited >= capSeconds) return { status: "failed", error: `${error} — still not merged after ${capSeconds} s` };
    await sleep(every);
    waited += every;
  }
}

/** Where a person goes when production stops answering at all (§NNN). */
const NO_ANSWER_RUNBOOK = "docs/RUNBOOKS.md § The domain stops answering";

/** What one failed fetch means, by its cause's code — the words a phone reads in the log. */
function failureKind(code, name) {
  if (name === "TimeoutError" || name === "AbortError") return "no answer within the request's time";
  if (/^(ENOTFOUND|EAI_AGAIN)$/.test(code)) return "a name or network failure";
  if (/^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|UND_ERR_)/.test(code)) return "a network failure";
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_|DEPTH_ZERO/.test(code)) return "a certificate failure";
  return "no answer";
}

/**
 * One fetch error as a line: `TypeError fetch failed — ENOTFOUND host: a name or network failure`.
 * Node's fetch hides the reason in `cause` (code and host); a string passes through as it is.
 *
 * @param {unknown} error
 */
export function describeFetchError(error) {
  if (typeof error === "string") return error;
  const e = /** @type {{ name?: string, message?: string, code?: string, cause?: { code?: string, hostname?: string, host?: string, message?: string } }} */ (error ?? {});
  const head = `${e.name ?? "Error"} ${e.message ?? String(error)}`.trim();
  const cause = e.cause;
  const code = String(cause?.code ?? e.code ?? "");
  const where = cause ? [cause.code, cause.hostname ?? cause.host].filter(Boolean).join(" ") || cause.message : "";
  return `${head}${where ? ` — ${where}` : ""}: ${failureKind(code, e.name)}`;
}

/**
 * One reading of production's `/api/health`, judged (§NNN): it did not answer (`no-answer`: a
 * fetch error, the detail says which), it answers with the expected baseline (`expected`), with
 * another one (`other-build`: the detail is that baseline), or with a body that carries none
 * (`unreadable`: an empty body, a registrar's or a proxy's HTML page). `expected` is one baseline
 * or several, any of which will do; a body names one as `"BR-V…`, the same test `ship` always made.
 *
 * @param {{ body?: string | null, error?: unknown, status?: number }} reading
 * @param {string | string[]} expected
 * @returns {{ kind: "no-answer" | "other-build" | "expected" | "unreadable", detail: string }}
 */
export function judgeProductionReading({ body, error, status } = {}, expected) {
  const wanted = (Array.isArray(expected) ? expected : [expected]).filter(Boolean);
  const text = String(body ?? "");
  if (error && !text) return { kind: "no-answer", detail: describeFetchError(error) };
  const hit = wanted.find((b) => text.includes(`"${b}`));
  if (hit) return { kind: "expected", detail: text.match(new RegExp(`"(${hit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*)"`))?.[1] ?? hit };
  const other = text.match(/"baseline"\s*:\s*"([^"]+)"/)?.[1] ?? text.match(/"(BR-V\d+\.\d+-\d{4}-\d{2}-\d{2})"/)?.[1];
  if (other) return { kind: "other-build", detail: other };
  return { kind: "unreadable", detail: text.trim() ? `HTTP ${status ?? "?"}, no baseline in the body` : `HTTP ${status ?? "?"}, an empty body` };
}

/**
 * The line a production wait prints for one judged reading: what production says, not only that
 * the wait goes on. `silentMs` is how long production has not answered at all.
 *
 * @param {{ kind: string, detail: string }} judged
 * @param {{ waitingFor: string, silentMs?: number }} context
 */
export function productionLine(judged, { waitingFor, silentMs = 0 }) {
  switch (judged.kind) {
    case "no-answer": {
      const minutes = Math.floor(silentMs / 60_000);
      return `${minutes >= 1 ? `no answer for ${minutes} min` : "no answer"}: ${judged.detail}; ${NO_ANSWER_RUNBOOK}`;
    }
    case "other-build":
      return `production answers with ${judged.detail}; waiting for ${waitingFor}`;
    case "unreadable":
      return `production answers but its body carries no baseline (${judged.detail})`;
    default:
      return `production answers with ${judged.detail}`;
  }
}

/**
 * Reads production until it reports one of `expected` (§NNN), printing what it sees on the first
 * reading and then every `reportEvery` seconds — not on every poll. Returns
 * { status: "expected", body, judged } or { status: "timeout", judged, line }, the line naming the
 * last reading's case for the STOP.
 *
 * @param {() => Promise<{ body?: string | null, error?: unknown, status?: number }>} read
 * @param {string | string[]} expected  the first one is what the lines say is awaited
 * @param {{ sleep: (seconds: number) => Promise<unknown>, every: number, polls: number, now?: () => number,
 *           reportEvery?: number, onReport?: (line: string) => void }} options
 */
export async function waitForProduction(read, expected, { sleep, every, polls, now = Date.now, reportEvery = 120, onReport }) {
  const waitingFor = Array.isArray(expected) ? expected[0] : expected;
  let silentSince = null;
  let reportedAt = null;
  let judged = null;
  let line = "";
  for (let i = 0; i < polls; i++) {
    const reading = await read();
    judged = judgeProductionReading(reading, expected);
    if (judged.kind === "expected") return { status: "expected", body: String(reading.body ?? ""), judged };
    const at = now();
    if (judged.kind === "no-answer") silentSince ??= at;
    else silentSince = null;
    line = productionLine(judged, { waitingFor, silentMs: silentSince === null ? 0 : at - silentSince });
    if (reportedAt === null || at - reportedAt >= reportEvery * 1000) {
      onReport?.(line);
      reportedAt = at;
    }
    if (i < polls - 1) await sleep(every);
  }
  return { status: "timeout", judged, line };
}

/** A duration as `m:ss` — minutes are not wrapped into hours, a release is read in minutes. */
export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The last release in a `SHIP_TIMES_FILE` as a Markdown table for the run's summary page (§535).
 *
 * @param {string} jsonl  the times file's text: one JSON record per line, the newest last
 */
export function timesTable(jsonl) {
  const line = String(jsonl ?? "").trim().split("\n").filter(Boolean).at(-1);
  if (!line) return "";
  const record = JSON.parse(line);
  const cell = (text) => String(text).replace(/\|/g, "/").replace(/\r?\n/g, " ");
  return [
    "",
    `### Ship's steps, ${cell(record.release)} (m:ss)`,
    "",
    "| Step | m:ss |",
    "| --- | --- |",
    ...(record.steps ?? []).map((s) => `| ${cell(s.name)} | ${formatDuration(s.seconds * 1000)} |`),
    `| **Total** — ${cell(record.outcome)} | ${formatDuration(record.totalSeconds * 1000)} |`,
    "",
  ].join("\n");
}

/**
 * The clock `ship` keeps of its steps (§504). `report()` counts an open step up to now, so a stop
 * says where the time went.
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
    end() {
      close();
    },
    summary,
    report() {
      const { steps, totalMs } = summary();
      const width = Math.max(5, ...steps.map((s) => s.name.length));
      const lines = steps.map((s) => `  ${s.name.padEnd(width)}  ${formatDuration(s.ms).padStart(6)}${s.open ? "  (stopped here)" : ""}`);
      lines.push(`  ${"total".padEnd(width)}  ${formatDuration(totalMs).padStart(6)}`);
      return lines;
    },
  };
}
