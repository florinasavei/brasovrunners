import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createClock, formatDuration, waitForRun } from "../../../scripts/ship-checks.mjs";

/**
 * §NNN — the release pipeline tests one tree once. `docs-check.yml` records a tree that passed
 * everything and skips the heavy jobs on a run of the same tree; a pull request runs the whole
 * suite on eight shards; `yarn ship` waits on a run by its status and times its own steps.
 *
 * GitHub cannot run here, so the workflow is held to the lines that make it safe: a skip only by a
 * job's condition (a skipped *workflow* stays "Pending" on a required check, a skipped *job*
 * reports "Success"), never a skip when the record is missing or the gate itself failed, and a
 * record trusted only from this workflow on this repository's own branches.
 */
const workflow = readFileSync(".github/workflows/docs-check.yml", "utf8").replace(/\r\n/g, "\n");

/** One job's block: from its `  name:` line to the next job's. */
function job(name: string): string {
  const jobs = workflow.slice(workflow.indexOf("\njobs:\n"));
  const start = jobs.indexOf(`\n  ${name}:\n`);
  expect(start, `job ${name}`).toBeGreaterThan(-1);
  const rest = jobs.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z0-9-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const SKIP_WHEN_TESTED = "if: ${{ !cancelled() && needs.tested-tree.outputs.tested != 'true' }}";

describe("§NNN docs-check: one tree, tested once", () => {
  it("always runs as a workflow — no path or branch filter on a pull request — and asks for no write", () => {
    expect(workflow).toMatch(/^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[qa, main\]\n/m);
    expect(workflow).not.toMatch(/paths(-ignore)?:|branches-ignore:/);
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n(?: {2}#.*\n)* {2}actions: read\n\n/m);
    expect(workflow).not.toMatch(/: write\b/);
  });

  it("keeps the two check names ship and branch protection read", () => {
    expect(job("docs-check")).toMatch(/run: yarn check\n/);
    expect(job("e2e")).toContain("needs: [tested-tree, e2e-shard]");
    expect(job("e2e")).toContain("if: always()");
    // A `name:` on either job would rename the required check.
    expect(job("docs-check")).not.toMatch(/^ {4}name:/m);
    expect(job("e2e")).not.toMatch(/^ {4}name:/m);
    // A failed lookup must not turn a green run red.
    expect(job("tested-tree")).toMatch(/^ {4}continue-on-error: true$/m);
  });

  it("names the tree it tested and trusts only this workflow's record from this repository", () => {
    const gate = job("tested-tree");
    expect(gate).toContain("tree=$(git rev-parse 'HEAD^{tree}')");
    expect(gate).toContain("actions/artifacts?name=tested-tree-$tree");
    expect(gate).toContain(".expired == false");
    // Trusted for 24 hours at most: the e2e seed builds its events relative to today.
    expect(gate).toContain("(.created_at | fromdateiso8601) > (now - 86400)");
    expect(gate).toContain(".workflow_run.head_repository_id == .workflow_run.repository_id");
    expect(gate).toContain("select(.head_repository.id == .repository.id) | .path");
    expect(gate).toMatch(/\.github\/workflows\/docs-check\.yml\|\.github\/workflows\/docs-check\.yml@\*\)/);
    // Any failure of the lookup is "not tested": the failure mode is a full run.
    expect(gate).toContain('2>/dev/null) || runs=""');
    expect(gate.match(/tested=true/g)).toHaveLength(1);
    // By hand, the whole run again.
    expect(gate).toContain('if [ "$FULL" = "true" ]');
  });

  it("skips the heavy jobs only by their own condition, and runs them if the gate failed", () => {
    for (const name of ["docs-check", "e2e-shard"]) {
      expect(job(name)).toContain("needs: tested-tree");
      expect(job(name)).toContain(SKIP_WHEN_TESTED);
    }
  });

  it("calls e2e green without shards only when the tree was already tested", () => {
    expect(job("e2e")).toContain(
      'test "${{ needs.tested-tree.outputs.tested }}" = "true" || test "${{ needs.e2e-shard.result }}" = "success"',
    );
  });

  it("records the tree only when yarn check and every shard passed, and a failed record fails nothing", () => {
    const record = job("record-tested-tree");
    expect(record).toContain("needs: [tested-tree, docs-check, e2e-shard]");
    expect(record).toContain("needs.docs-check.result == 'success'");
    expect(record).toContain("needs.e2e-shard.result == 'success'");
    expect(record).toContain("name: tested-tree-${{ needs.tested-tree.outputs.tree }}");
    expect(record).toMatch(/uses: actions\/upload-artifact@v4\n\s+continue-on-error: true\n/);
    // The record expires after a day, the shortest GitHub keeps one; never the old fortnight.
    expect(record).toMatch(/^\s+retention-days: 1$/m);
    expect(workflow.match(/retention-days: (\d+)/g)).toEqual(["retention-days: 7", "retention-days: 1"]);
  });

  it("runs the whole suite, both projects, on eight shards on every run — a pull request included", () => {
    const shards = job("e2e-shard");
    expect(shards).toContain("shard: [1, 2, 3, 4, 5, 6, 7, 8]");
    expect(shards).toContain("name: e2e ${{ matrix.shard }}/8");
    expect(shards).toContain("run: yarn test:e2e --shard=${{ matrix.shard }}/$SHARD_TOTAL");
    expect(shards).not.toContain("--project");
    expect(shards).not.toContain("github.event_name");
    expect(shards).toMatch(/- run: yarn test:concurrency\n\s+if: matrix\.shard == 1\n/);
  });
});

describe("§NNN ship: waiting on one run by its status", () => {
  const readings = (list: Array<{ status: string; conclusion?: string | null } | null>) => {
    let i = 0;
    const slept: number[] = [];
    return {
      read: () => list[Math.min(i++, list.length - 1)],
      sleep: async (seconds: number) => {
        slept.push(seconds);
      },
      reads: () => i,
      slept,
    };
  };

  it("waits for the run to appear and then to complete, whatever the conclusion reads meanwhile", async () => {
    // A rerun reads its previous conclusion while queued: only "completed" ends the wait.
    const r = readings([null, null, { status: "queued", conclusion: "failure" }, { status: "in_progress" }, { status: "completed", conclusion: "success" }]);
    expect(await waitForRun(r.read, { sleep: r.sleep, every: 15 })).toMatchObject({ status: "completed", conclusion: "success" });
    expect(r.reads()).toBe(5);
    expect(r.slept).toEqual([15, 15, 15, 15]);
  });

  it("reads gh's upper-case states too, and an empty conclusion is not success", async () => {
    const r = readings([{ status: "COMPLETED", conclusion: "FAILURE" }]);
    expect(await waitForRun(r.read, { sleep: r.sleep })).toMatchObject({ status: "completed", conclusion: "failure" });
    const blank = readings([{ status: "completed", conclusion: null }]);
    expect(await waitForRun(blank.read, { sleep: blank.sleep })).toMatchObject({ status: "completed", conclusion: "" });
  });

  it("gives up on a run that never appears, and on one that never completes", async () => {
    const none = readings([null]);
    expect(await waitForRun(none.read, { sleep: none.sleep, maxMissing: 3 })).toEqual({ status: "missing" });
    expect(none.reads()).toBe(3);

    const stuck = readings([{ status: "in_progress" }]);
    expect(await waitForRun(stuck.read, { sleep: stuck.sleep, polls: 4 })).toEqual({ status: "timeout", run: { status: "in_progress" } });
    expect(stuck.slept).toHaveLength(3);
  });

  it("lets the caller act on a waiting run — the migration's approval — before it completes", async () => {
    const seen: string[] = [];
    const r = readings([{ status: "waiting" }, { status: "in_progress" }, { status: "completed", conclusion: "success" }]);
    await waitForRun(r.read, { sleep: r.sleep, onRead: (run) => void seen.push(String(run.status)) });
    expect(seen).toEqual(["waiting", "in_progress"]);
  });
});

describe("§NNN ship: the clock it keeps of itself", () => {
  it("formats minutes and seconds without wrapping into hours", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_400)).toBe("1:05");
    expect(formatDuration(62 * 60_000 + 7_000)).toBe("62:07");
    expect(formatDuration(-5)).toBe("0:00");
  });

  it("times each step to the next one's start, and the whole", () => {
    let t = 1_000;
    const clock = createClock(() => t);
    clock.step("batch PR #1");
    t += 12 * 60_000;
    clock.step("qa run");
    t += 90_000;
    clock.end();
    t += 5_000;
    expect(clock.summary()).toEqual({
      steps: [
        { name: "batch PR #1", ms: 12 * 60_000 },
        { name: "qa run", ms: 90_000 },
      ],
      totalMs: 12 * 60_000 + 95_000,
    });
    expect(clock.report()).toEqual(["  batch PR #1   12:00", "  qa run         1:30", "  total         13:35"]);
  });

  it("says each step's time the moment it ends, not only at the end", () => {
    let t = 0;
    const said: string[] = [];
    const clock = createClock(() => t, (s) => said.push(`${s.name} ${formatDuration(s.ms)}`));
    clock.step("batch PR #1");
    t += 60_000;
    expect(said).toEqual([]);
    clock.step("qa run");
    expect(said).toEqual(["batch PR #1 1:00"]);
    t += 9 * 60_000 + 10_000;
    clock.end();
    expect(said).toEqual(["batch PR #1 1:00", "qa run 9:10"]);
    clock.end();
    expect(said).toHaveLength(2);
  });

  it("counts a step still open at a stop, and says it stopped there", () => {
    let t = 0;
    const clock = createClock(() => t);
    clock.step("release PR");
    t += 61_000;
    expect(clock.summary().steps).toEqual([{ name: "release PR", ms: 61_000, open: true }]);
    expect(clock.report()[0]).toBe("  release PR    1:01  (stopped here)");
  });
});
