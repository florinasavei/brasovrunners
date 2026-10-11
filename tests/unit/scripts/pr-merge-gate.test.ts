import { describe, expect, it } from "vitest";
import { HOUSE_CHECKS, gateLine, judgeMergeGate, waitForMergeGate } from "../../../scripts/pr-merge-gate.mjs";

/**
 * §NNN — `yarn ship` waits for what GitHub requires, not for every status on the PR. On 2026-10-10
 * it polled twenty minutes for «Vercel – <project>», which the merge never needed (UNSTABLE).
 */
const run = (name: string, conclusion: string | null, status = "COMPLETED") => ({ __typename: "CheckRun", name, status, conclusion });
const context = (name: string, state: string) => ({ __typename: "StatusContext", context: name, state });

describe("§NNN ship: the merge gate", () => {
  it("merges on UNSTABLE when only a status nobody requires is pending, and names it", () => {
    const pr = { mergeStateStatus: "UNSTABLE", statusCheckRollup: [run("docs-check", "SUCCESS"), context("Vercel – a-project", "PENDING")] };
    expect(judgeMergeGate(pr, ["docs-check"])).toEqual({ mergeable: true, waitingOn: [{ name: "Vercel – a-project", required: false }] });
  });

  it("merges on CLEAN and HAS_HOOKS; a skipped or neutral required context counts as green", () => {
    const rollup = [run("docs-check", "SKIPPED"), run("e2e", "NEUTRAL")];
    expect(judgeMergeGate({ mergeStateStatus: "CLEAN", statusCheckRollup: rollup }, ["docs-check", "e2e"]).mergeable).toBe(true);
    expect(judgeMergeGate({ mergeStateStatus: "HAS_HOOKS", statusCheckRollup: rollup }, ["docs-check"]).mergeable).toBe(true);
  });

  it("waits while a required context is pending, saying it is required, and while the state is UNKNOWN", () => {
    const pending = { mergeStateStatus: "BLOCKED", statusCheckRollup: [run("docs-check", null, "IN_PROGRESS"), context("Vercel – x", "PENDING")] };
    const judged = judgeMergeGate(pending, ["docs-check"]);
    expect(judged.mergeable).toBe(false);
    expect(judged.waitingOn).toEqual([
      { name: "docs-check", required: true },
      { name: "Vercel – x", required: false },
    ]);
    expect(gateLine(judged)).toBe("waiting on: docs-check (required), Vercel – x (not required)…");
    expect(judgeMergeGate({ mergeStateStatus: "UNKNOWN", statusCheckRollup: [run("docs-check", "SUCCESS")] }, ["docs-check"]).mergeable).toBe(false);
  });

  it("waits for a required context that has not registered while GitHub still blocks the merge", () => {
    const judged = judgeMergeGate({ mergeStateStatus: "BLOCKED", statusCheckRollup: [] }, ["docs-check"]);
    expect(judged).toEqual({ mergeable: false, waitingOn: [{ name: "docs-check", required: true }] });
  });

  it("stops on conflicts, on a branch behind, and on a failed required check — never on a failed Vercel status", () => {
    expect(judgeMergeGate({ mergeStateStatus: "DIRTY", statusCheckRollup: [] }, ["docs-check"]).stop).toMatch(/conflicts/);
    expect(judgeMergeGate({ mergeStateStatus: "BEHIND", statusCheckRollup: [] }, ["docs-check"]).stop).toMatch(/update the branch/);
    const failed = judgeMergeGate({ mergeStateStatus: "BLOCKED", statusCheckRollup: [run("docs-check", "FAILURE")] }, ["docs-check"]);
    expect(failed.stop).toBe("a required check failed: docs-check");
    const vercelRed = { mergeStateStatus: "UNSTABLE", statusCheckRollup: [run("docs-check", "SUCCESS"), context("Vercel – x", "FAILURE")] };
    expect(judgeMergeGate(vercelRed, ["docs-check"]).mergeable).toBe(true);
  });

  it("falls back to the house's checks when GitHub's list cannot be read, and never requires a Vercel status", () => {
    expect(HOUSE_CHECKS).toEqual(["tested-tree", "docs-check", "e2e", "migrate"]);
    const rollup = [run("tested-tree", "SUCCESS"), run("docs-check", "SUCCESS"), run("e2e", null, "IN_PROGRESS"), context("Vercel – x", "PENDING")];
    for (const unreadable of [null, undefined, []]) {
      const judged = judgeMergeGate({ mergeStateStatus: "UNSTABLE", statusCheckRollup: rollup }, unreadable as string[] | null);
      expect(judged.mergeable).toBe(false);
      expect(judged.waitingOn.filter((w) => w.required)).toEqual([{ name: "e2e", required: true }]);
    }
    const done = [...rollup.slice(0, 2), run("e2e", "SUCCESS"), rollup[3]];
    expect(judgeMergeGate({ mergeStateStatus: "UNSTABLE", statusCheckRollup: done }, null).mergeable).toBe(true);
    expect(judgeMergeGate({ mergeStateStatus: "BLOCKED", statusCheckRollup: [run("docs-check", "FAILURE")] }, null).stop).toMatch(/docs-check/);
  });

  it("polls until mergeable, printing each pending poll, and stops at the cap", async () => {
    const readings = [
      { mergeStateStatus: "BLOCKED", statusCheckRollup: [run("docs-check", null, "QUEUED")] },
      { mergeStateStatus: "UNSTABLE", statusCheckRollup: [run("docs-check", "SUCCESS"), context("Vercel – x", "PENDING")] },
    ];
    let i = 0;
    const slept: number[] = [];
    const lines: string[] = [];
    const waited = await waitForMergeGate(() => ({ pr: readings[Math.min(i++, 1)], required: ["docs-check"] }), {
      sleep: async (s: number) => void slept.push(s),
      onPoll: (judged: Parameters<typeof gateLine>[0]) => lines.push(gateLine(judged)),
    });
    expect(waited.status).toBe("mergeable");
    expect(slept).toEqual([30]);
    expect(lines).toEqual(["waiting on: docs-check (required)…"]);

    const stuck = await waitForMergeGate(() => ({ pr: readings[0], required: ["docs-check"] }), { sleep: async () => {}, polls: 3 });
    expect(stuck.status).toBe("timeout");
  });
});
