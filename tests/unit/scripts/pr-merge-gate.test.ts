import { describe, expect, it } from "vitest";
import { HOUSE_CHECKS, gateLine, judgeMergeGate, sourceLine, waitForMergeGate } from "../../../scripts/pr-merge-gate.mjs";

/**
 * §NNN — `yarn ship` waits for what GitHub requires, not for every status on the PR. On 2026-10-10
 * it polled twenty minutes for «Vercel – <project>», which the merge never needed (UNSTABLE).
 */
const run = (name: string, conclusion: string | null, status = "COMPLETED") => ({ __typename: "CheckRun", name, status, conclusion });
const house = [run("tested-tree", "SUCCESS"), run("e2e", "SUCCESS"), run("migrate", "SUCCESS")];
const houseAnd = (...more: object[]) => [...house, ...more];
const context = (name: string, state: string) => ({ __typename: "StatusContext", context: name, state });

describe("§NNN ship: the merge gate", () => {
  it("merges on UNSTABLE when only a status nobody requires is pending, and names it", () => {
    const pr = { mergeStateStatus: "UNSTABLE", statusCheckRollup: houseAnd(run("docs-check", "SUCCESS"), context("Vercel – a-project", "PENDING")) };
    expect(judgeMergeGate(pr, ["docs-check"])).toEqual({ mergeable: true, waitingOn: [{ name: "Vercel – a-project", required: false }] });
  });

  it("merges on CLEAN and HAS_HOOKS; a skipped or neutral required context counts as green", () => {
    const rollup = [run("docs-check", "SKIPPED"), run("e2e", "NEUTRAL"), run("tested-tree", "SUCCESS"), run("migrate", "SUCCESS")];
    expect(judgeMergeGate({ mergeStateStatus: "CLEAN", statusCheckRollup: rollup }, ["docs-check", "e2e"]).mergeable).toBe(true);
    expect(judgeMergeGate({ mergeStateStatus: "HAS_HOOKS", statusCheckRollup: rollup }, ["docs-check"]).mergeable).toBe(true);
  });

  it("waits while a required context is pending, saying it is required, and while the state is UNKNOWN", () => {
    const pending = { mergeStateStatus: "BLOCKED", statusCheckRollup: [...house, run("docs-check", null, "IN_PROGRESS"), context("Vercel – x", "PENDING")] };
    const judged = judgeMergeGate(pending, ["docs-check"]);
    expect(judged.mergeable).toBe(false);
    expect(judged.waitingOn).toEqual([
      { name: "docs-check", required: true },
      { name: "Vercel – x", required: false },
    ]);
    expect(gateLine(judged)).toBe("waiting on: docs-check (required), Vercel – x (not required)…");
    expect(judgeMergeGate({ mergeStateStatus: "UNKNOWN", statusCheckRollup: houseAnd(run("docs-check", "SUCCESS")) }, ["docs-check"]).mergeable).toBe(false);
  });

  it("waits for a required context that has not registered while GitHub still blocks the merge", () => {
    const judged = judgeMergeGate({ mergeStateStatus: "BLOCKED", statusCheckRollup: house }, ["docs-check"]);
    expect(judged).toEqual({ mergeable: false, waitingOn: [{ name: "docs-check", required: true }] });
  });

  it("stops on conflicts, on a branch behind, and on a failed required check — never on a failed Vercel status", () => {
    expect(judgeMergeGate({ mergeStateStatus: "DIRTY", statusCheckRollup: [] }, ["docs-check"]).stop).toMatch(/conflicts/);
    expect(judgeMergeGate({ mergeStateStatus: "BEHIND", statusCheckRollup: [] }, ["docs-check"]).stop).toMatch(/update the branch/);
    const failed = judgeMergeGate({ mergeStateStatus: "BLOCKED", statusCheckRollup: [run("docs-check", "FAILURE")] }, ["docs-check"]);
    expect(failed.stop).toBe("a required check failed: docs-check");
    const vercelRed = { mergeStateStatus: "UNSTABLE", statusCheckRollup: houseAnd(run("docs-check", "SUCCESS"), context("Vercel – x", "FAILURE")) };
    expect(judgeMergeGate(vercelRed, ["docs-check"]).mergeable).toBe(true);
  });

  it("falls back to the house's checks when GitHub's list cannot be read, and never requires a Vercel status", () => {
    expect(HOUSE_CHECKS).toEqual(["tested-tree", "docs-check", "e2e", "migrate"]);
    const rollup = [run("tested-tree", "SUCCESS"), run("docs-check", "SUCCESS"), run("migrate", "SUCCESS"), run("e2e", null, "IN_PROGRESS"), context("Vercel – x", "PENDING")];
    for (const unreadable of [null, undefined, []]) {
      const judged = judgeMergeGate({ mergeStateStatus: "UNSTABLE", statusCheckRollup: rollup }, unreadable as string[] | null);
      expect(judged.mergeable).toBe(false);
      expect(judged.waitingOn.filter((w) => w.required)).toEqual([{ name: "e2e", required: true }]);
    }
    const done = [...rollup.slice(0, 3), run("e2e", "SUCCESS"), rollup[4]];
    expect(judgeMergeGate({ mergeStateStatus: "UNSTABLE", statusCheckRollup: done }, null).mergeable).toBe(true);
    expect(judgeMergeGate({ mergeStateStatus: "BLOCKED", statusCheckRollup: [run("docs-check", "FAILURE")] }, null).stop).toMatch(/docs-check/);
  });

  it("requires the house's checks beside GitHub's list: a red or pending e2e on UNSTABLE stops or waits", () => {
    const base = [run("docs-check", "SUCCESS"), run("tested-tree", "SUCCESS"), run("migrate", "SUCCESS")];
    const red = judgeMergeGate({ mergeStateStatus: "UNSTABLE", statusCheckRollup: [...base, run("e2e", "FAILURE")] }, ["docs-check"]);
    expect(red.stop).toBe("a required check failed: e2e");
    const wait = judgeMergeGate({ mergeStateStatus: "UNSTABLE", statusCheckRollup: [...base, run("e2e", null, "IN_PROGRESS")] }, ["docs-check"]);
    expect(wait.mergeable).toBe(false);
    expect(wait.waitingOn).toEqual([{ name: "e2e", required: true }]);
    // a house check that has not registered is waited for on UNSTABLE; CLEAN alone may merge
    const partial = [run("docs-check", "SUCCESS")];
    const unstable = judgeMergeGate({ mergeStateStatus: "UNSTABLE", statusCheckRollup: partial }, ["docs-check"]);
    expect(unstable.mergeable).toBe(false);
    expect(unstable.waitingOn.map((w) => w.name)).toEqual(["tested-tree", "e2e", "migrate"]);
    expect(judgeMergeGate({ mergeStateStatus: "CLEAN", statusCheckRollup: partial }, ["docs-check"]).mergeable).toBe(true);
  });

  it("counts the e2e shards as the e2e aggregate, which registers only after the last shard", () => {
    const base = [run("docs-check", "SUCCESS"), run("tested-tree", "SUCCESS"), run("migrate", "SUCCESS")];
    const shards = (conclusions: (string | null)[]) => conclusions.map((c, i) => run(`e2e ${i + 1}/8`, c, c ? "COMPLETED" : "IN_PROGRESS"));
    const waiting = judgeMergeGate({ mergeStateStatus: "UNSTABLE", statusCheckRollup: [...base, ...shards(["SUCCESS", null, "SUCCESS"])] }, ["docs-check"]);
    expect(waiting.mergeable).toBe(false);
    expect(waiting.waitingOn).toEqual([{ name: "e2e 2/8", required: true }, { name: "e2e", required: true }]);
    const failed = judgeMergeGate({ mergeStateStatus: "UNSTABLE", statusCheckRollup: [...base, ...shards(["SUCCESS", "FAILURE", null])] }, ["docs-check"]);
    expect(failed.stop).toBe("a required check failed: e2e 2/8");
    const done = [...base, ...shards(Array(8).fill("SUCCESS")), run("e2e", "SUCCESS")];
    expect(judgeMergeGate({ mergeStateStatus: "UNSTABLE", statusCheckRollup: done }, ["docs-check"]).mergeable).toBe(true);
  });

  it("marks the fallback once: the line names the unreadable list, and is silent when GitHub answered", () => {
    expect(sourceLine(null)).toBe("required list unreadable — using the house's checks");
    expect(sourceLine([])).toBe("no check is required by GitHub — using the house's checks");
    expect(sourceLine(["docs-check"])).toBeNull();
  });

  it("polls until mergeable, printing each pending poll, and stops at the cap", async () => {
    const readings = [
      { mergeStateStatus: "BLOCKED", statusCheckRollup: [...house, run("docs-check", null, "QUEUED")] },
      { mergeStateStatus: "UNSTABLE", statusCheckRollup: houseAnd(run("docs-check", "SUCCESS"), context("Vercel – x", "PENDING")) },
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
