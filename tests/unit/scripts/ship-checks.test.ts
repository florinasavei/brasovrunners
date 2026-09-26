import { describe, expect, it } from "vitest";
import { bucketOf, judgeChecks, waitForSettledChecks } from "../../../scripts/ship-checks.mjs";

/**
 * §NNN — `yarn ship` judges a pull request's checks only once none is pending and the same set
 * has been read twice in a row. Before, it judged the moment `gh pr checks --watch` returned,
 * which is also the moment before a late check (the next job, a deployment) has registered.
 */
type Check = { name: string; state?: string; bucket?: string };
const pass = (name: string): Check => ({ name, state: "SUCCESS", bucket: "pass" });
const pending = (name: string): Check => ({ name, state: "IN_PROGRESS", bucket: "pending" });
const fail = (name: string): Check => ({ name, state: "FAILURE", bucket: "fail" });

/** A reader that returns each reading in turn, then the last one for ever; and a sleep that counts. */
function script(readings: Check[][]) {
  let i = 0;
  const slept: number[] = [];
  return {
    read: () => readings[Math.min(i++, readings.length - 1)],
    sleep: async (seconds: number) => {
      slept.push(seconds);
    },
    reads: () => i,
    slept,
  };
}

describe("§NNN ship: the verdict on one reading", () => {
  it("is none with no check, pending while any runs, green when all pass or were skipped", () => {
    expect(judgeChecks([]).verdict).toBe("none");
    expect(judgeChecks([pass("docs-check"), pending("e2e")])).toMatchObject({ verdict: "pending", pending: ["e2e"] });
    expect(judgeChecks([pass("docs-check"), { name: "skipped job", state: "SKIPPED", bucket: "skipping" }]).verdict).toBe("green");
  });

  it("is red on a failure or a cancellation, naming them", () => {
    const judged = judgeChecks([pass("docs-check"), fail("e2e"), { name: "x", state: "CANCELLED", bucket: "cancel" }]);
    expect(judged).toMatchObject({ verdict: "red", red: ["e2e", "x"] });
  });

  it("reports a tolerated red without stopping on it, and only the names it tolerates", () => {
    const checks = [pass("docs-check"), fail("Vercel – qa")];
    expect(judgeChecks(checks, { tolerate: /^Vercel\b/i })).toMatchObject({ verdict: "green", tolerated: ["Vercel – qa"], red: [] });
    expect(judgeChecks([...checks, fail("e2e")], { tolerate: /^Vercel\b/i })).toMatchObject({ verdict: "red", red: ["e2e"] });
    expect(judgeChecks(checks).verdict).toBe("red");
  });

  it("derives the bucket from the state when gh gives none", () => {
    expect(bucketOf({ state: "QUEUED" })).toBe("pending");
    expect(bucketOf({ state: "SUCCESS" })).toBe("pass");
    expect(bucketOf({ state: "NEUTRAL" })).toBe("skipping");
    expect(bucketOf({ state: "TIMED_OUT" })).toBe("fail");
  });
});

describe("§NNN ship: waiting until the checks settle", () => {
  it("does not judge a green reading that a late check then joins", async () => {
    // docs-check passes before the e2e job's check registers: the old `--watch` returned here.
    const s = script([[pass("docs-check")], [pass("docs-check"), pending("e2e")], [pass("docs-check"), pass("e2e")], [pass("docs-check"), pass("e2e")]]);
    const waited = await waitForSettledChecks(s.read, { sleep: s.sleep, every: 30 });
    expect(waited).toEqual({ status: "settled", checks: [pass("docs-check"), pass("e2e")] });
    expect(s.reads()).toBe(4);
    expect(s.slept).toEqual([30, 30, 30]);
  });

  it("waits through the time before any check registers", async () => {
    const s = script([[], [], [pending("docs-check")], [fail("docs-check")], [fail("docs-check")]]);
    const waited = await waitForSettledChecks(s.read, { sleep: s.sleep });
    expect(waited.status).toBe("settled");
    expect(judgeChecks((waited as { checks: Check[] }).checks).verdict).toBe("red");
  });

  it("gives up when no check registers, or when one never finishes", async () => {
    const none = script([[]]);
    expect(await waitForSettledChecks(none.read, { sleep: none.sleep, maxEmpty: 3 })).toEqual({ status: "no-checks" });
    expect(none.reads()).toBe(3);

    const stuck = script([[pass("docs-check"), pending("e2e")]]);
    expect(await waitForSettledChecks(stuck.read, { sleep: stuck.sleep, polls: 5 })).toEqual({ status: "timeout", pending: ["e2e"] });
    expect(stuck.slept).toHaveLength(4);
  });

  it("says which checks it is waiting on", async () => {
    const seen: string[][] = [];
    const s = script([[pending("e2e")], [pass("e2e")], [pass("e2e")]]);
    await waitForSettledChecks(s.read, { sleep: s.sleep, onPending: (names: string[]) => seen.push(names) });
    expect(seen).toEqual([["e2e"]]);
  });
});
