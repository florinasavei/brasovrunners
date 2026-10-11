/**
 * Whether a pull request may be merged, judged only on what GitHub requires (§NNN, amends §426).
 *
 * `yarn ship` once polled twenty minutes for «Vercel – <project>» on a release PR whose merge GitHub
 * did not need it for: `mergeStateStatus` said `UNSTABLE` (mergeable, a status that is not required
 * is not green). The decision is pure so a test can pin it: the PR's `mergeStateStatus`, its
 * `statusCheckRollup` as `gh pr view --json` returns it, and the required contexts.
 */

/** The house's own checks: always required beside whatever GitHub lists (Vercel is in neither). */
export const HOUSE_CHECKS = ["tested-tree", "docs-check", "e2e", "migrate"];

const MERGEABLE_STATES = new Set(["CLEAN", "UNSTABLE", "HAS_HOOKS"]);
const GOOD = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
const BAD = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED", "STALE"]);

/** `gh pr view --json statusCheckRollup` mixes CheckRun (`name`, `conclusion`, `status`) and StatusContext (`context`, `state`). */
function readEntry(entry) {
  const name = entry.name ?? entry.context ?? "";
  const raw = entry.__typename === "StatusContext" || (entry.conclusion === undefined && entry.state !== undefined) ? entry.state : entry.conclusion;
  const concluded = String(raw ?? "").toUpperCase();
  if (GOOD.has(concluded)) return { name, verdict: "good" };
  if (BAD.has(concluded)) return { name, verdict: "bad" };
  return { name, verdict: "pending" };
}

/** The required contexts: GitHub's list (when readable) joined with the house's checks. */
export function requiredContexts(listed) {
  const github = Array.isArray(listed) ? listed : [];
  return [...new Set([...github, ...HOUSE_CHECKS])];
}

/** The one line to print when GitHub's required list could not be read; null when it was. */
export function sourceLine(listed) {
  return Array.isArray(listed) && listed.length > 0 ? null : "required list unreadable — using the house's checks";
}

/**
 * @param {{ mergeStateStatus?: string, statusCheckRollup?: object[] }} pr
 * @param {string[] | null | undefined} requiredList what branch protection requires; null when unreadable
 * @returns {{ mergeable: boolean, waitingOn: { name: string, required: boolean }[], stop?: string }}
 */
export function judgeMergeGate(pr, requiredList) {
  const required = requiredContexts(requiredList);
  const state = String(pr.mergeStateStatus ?? "UNKNOWN").toUpperCase();
  const entries = (pr.statusCheckRollup ?? []).map(readEntry);
  const isRequired = (name) => required.includes(name);

  if (state === "DIRTY") return { mergeable: false, waitingOn: [], stop: "the pull request has conflicts with its base" };
  if (state === "BEHIND") return { mergeable: false, waitingOn: [], stop: "the pull request is behind its base: update the branch" };

  const failed = entries.filter((e) => e.verdict === "bad" && isRequired(e.name)).map((e) => e.name);
  if (failed.length) return { mergeable: false, waitingOn: [], stop: `a required check failed: ${failed.join(", ")}` };

  const pending = entries.filter((e) => e.verdict === "pending");
  const waitingOn = pending.map((e) => ({ name: e.name, required: isRequired(e.name) }));
  const requiredPending = waitingOn.filter((w) => w.required);
  // A required context that has not registered yet is waited for only while GitHub itself blocks the merge.
  const seen = new Set(entries.map((e) => e.name));
  const absent = state === "CLEAN" || state === "UNSTABLE" || state === "HAS_HOOKS" ? [] : required.filter((name) => !seen.has(name));
  for (const name of absent) waitingOn.push({ name, required: true });

  if (requiredPending.length || absent.length || !MERGEABLE_STATES.has(state)) {
    return { mergeable: false, waitingOn: waitingOn.sort((a, b) => Number(b.required) - Number(a.required)) };
  }
  return { mergeable: true, waitingOn: waitingOn.filter((w) => !w.required) };
}

/** One poll's line: `waiting on: <name> (required|not required)…`. */
export function gateLine(judged, state = "") {
  if (!judged.waitingOn.length) return `waiting on: GitHub's merge state${state ? ` (${state})` : ""}…`;
  return `waiting on: ${judged.waitingOn.map((w) => `${w.name} (${w.required ? "required" : "not required"})`).join(", ")}…`;
}

/**
 * Polls `read()` (returning `{ pr, required }`) until the PR is mergeable or the gate stops, or the polls run out.
 * Returns `{ status: "mergeable" | "stopped" | "timeout", judged }`.
 * @param {() => { pr: object, required: string[] | null }} read
 * @param {{ sleep: (seconds: number) => Promise<unknown>, every?: number, polls?: number, onPoll?: (judged: ReturnType<typeof judgeMergeGate>, i: number, state: string) => void }} options
 */
export async function waitForMergeGate(read, { sleep, every = 30, polls = 180, onPoll = () => {} }) {
  let judged = { mergeable: false, waitingOn: [] };
  for (let i = 0; i < polls; i++) {
    const { pr, required } = read();
    judged = judgeMergeGate(pr, required);
    if (judged.stop) return { status: "stopped", judged };
    if (judged.mergeable) return { status: "mergeable", judged };
    onPoll(judged, i, String(pr.mergeStateStatus ?? ""));
    if (i < polls - 1) await sleep(every);
  }
  return { status: "timeout", judged };
}
