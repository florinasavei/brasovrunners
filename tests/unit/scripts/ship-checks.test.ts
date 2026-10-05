import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bucketOf,
  describeFetchError,
  judgeChecks,
  judgeProductionReading,
  mergePullRequest,
  productionLine,
  waitForProduction,
  waitForSettledChecks,
} from "../../../scripts/ship-checks.mjs";

/**
 * §426 — `yarn ship` judges a pull request's checks only once none is pending and the same set
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

describe("§426 ship: the verdict on one reading", () => {
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

describe("§426 ship: waiting until the checks settle", () => {
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

/**
 * §520 — `gh pr merge` answered «Merge already in progress» on the V2.12 release while the merge
 * went through, and `ship` stopped on a merged PR. The exit is not the verdict: the PR's state is.
 */
describe("§520 ship: a merge judged by the PR's state", () => {
  function states(readings: string[]) {
    let i = 0;
    const slept: number[] = [];
    return {
      state: () => readings[Math.min(i++, readings.length - 1)],
      sleep: async (seconds: number) => {
        slept.push(seconds);
      },
      reads: () => i,
      slept,
    };
  }

  it("is merged on a clean exit, without reading the state", async () => {
    const s = states(["OPEN"]);
    expect(await mergePullRequest(() => ({ status: 0, stderr: "" }), s.state, { sleep: s.sleep })).toEqual({ status: "merged", waited: 0 });
    expect(s.reads()).toBe(0);
  });

  it("waits through «Merge already in progress» until the PR says MERGED, and continues", async () => {
    const s = states(["OPEN", "OPEN", "MERGED"]);
    const outcome = await mergePullRequest(
      () => ({ status: 1, stderr: "GraphQL: Merge already in progress (mergePullRequest)" }),
      s.state,
      { sleep: s.sleep, every: 5, capSeconds: 60 },
    );
    expect(outcome).toEqual({ status: "merged", waited: 10 });
    expect(s.slept).toEqual([5, 5]);
  });

  it("stops after the minute's cap when the PR never says MERGED", async () => {
    const s = states(["OPEN"]);
    const outcome = await mergePullRequest(() => ({ status: 1, stderr: "Merge already in progress" }), s.state, { sleep: s.sleep, every: 5, capSeconds: 60 });
    expect(outcome.status).toBe("failed");
    expect(s.slept.reduce((sum, seconds) => sum + seconds, 0)).toBe(60);
  });

  it("takes any other failure at its word, unless the PR is merged all the same", async () => {
    const refused = states(["OPEN"]);
    expect(await mergePullRequest(() => ({ status: 1, stderr: "Pull request is not mergeable" }), refused.state, { sleep: refused.sleep })).toEqual({
      status: "failed",
      error: "Pull request is not mergeable",
    });
    expect(refused.slept).toEqual([]);
    const mergedAnyway = states(["MERGED"]);
    expect(await mergePullRequest(() => ({ status: 1, stderr: "exit status 1" }), mergedAnyway.state, { sleep: mergedAnyway.sleep })).toEqual({ status: "merged", waited: 0 });
  });

  it("is what ship calls for both merges", () => {
    const ship = readFileSync(path.join(process.cwd(), "scripts/ship.mjs"), "utf8");
    expect(ship).toContain("await merge(PR);");
    expect(ship).toContain("await merge(release);");
    expect(ship).not.toMatch(/gh\("pr", "merge"/);
  });
});

/**
 * §658 — a production wait says what it sees. On 2026-10-03 the step waited an hour while the
 * domain did not resolve, and printed the same two lines it would have printed had production
 * answered with another build.
 */
describe("§658 ship: one production reading, judged", () => {
  const NEW = "BR-V9.41-2031-01-02";
  const OLD = "BR-V9.40-2031-01-01";
  const notFound = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND", hostname: "production.example.org" } });

  it("is no answer on a fetch error, naming the cause and the runbook", () => {
    const judged = judgeProductionReading({ body: "", error: notFound }, NEW);
    expect(judged).toEqual({ kind: "no-answer", detail: "TypeError fetch failed — ENOTFOUND production.example.org: a name or network failure" });
    expect(productionLine(judged, { waitingFor: NEW, silentMs: 12 * 60_000 + 5_000 })).toBe(
      "no answer for 12 min: TypeError fetch failed — ENOTFOUND production.example.org: a name or network failure; docs/RUNBOOKS.md § The domain stops answering",
    );
    expect(productionLine(judged, { waitingFor: NEW })).toMatch(/^no answer: TypeError/);
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    expect(describeFetchError(timeout)).toBe("TimeoutError The operation was aborted due to timeout: no answer within the request's time");
    const leaf = Object.assign(new TypeError("fetch failed"), { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE", message: "unable to verify the first certificate" } });
    expect(describeFetchError(leaf)).toBe("TypeError fetch failed — UNABLE_TO_VERIFY_LEAF_SIGNATURE: a certificate failure");
  });

  it("is another build when the body carries another baseline", () => {
    const judged = judgeProductionReading({ body: JSON.stringify({ status: "ok", baseline: OLD }), status: 200 }, NEW);
    expect(judged).toEqual({ kind: "other-build", detail: OLD });
    expect(productionLine(judged, { waitingFor: NEW })).toBe(`production answers with ${OLD}; waiting for ${NEW}`);
  });

  it("is expected on the awaited baseline, or on any of several", () => {
    const body = JSON.stringify({ status: "ok", baseline: NEW });
    expect(judgeProductionReading({ body, status: 200 }, NEW)).toEqual({ kind: "expected", detail: NEW });
    expect(judgeProductionReading({ body, status: 200 }, [OLD, NEW]).kind).toBe("expected");
  });

  it("is unreadable on an HTML page or an empty body", () => {
    const html = judgeProductionReading({ body: "<!doctype html><title>Domain on hold</title>", status: 200 }, NEW);
    expect(html).toEqual({ kind: "unreadable", detail: "HTTP 200, no baseline in the body" });
    expect(productionLine(html, { waitingFor: NEW })).toBe("production answers but its body carries no baseline (HTTP 200, no baseline in the body)");
    expect(judgeProductionReading({ body: "", status: 502 }, NEW)).toEqual({ kind: "unreadable", detail: "HTTP 502, an empty body" });
  });
});

describe("§658 ship: a production wait prints what it sees, every two minutes", () => {
  it("prints on the first reading and then every two minutes, not on every poll, and names the case at the end", async () => {
    let t = 0;
    const lines: string[] = [];
    const error = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND", hostname: "production.example.org" } });
    const waited = await waitForProduction(async () => ({ body: "", error }), "BR-V9.41-2031-01-02", {
      sleep: async (seconds: number) => {
        t += seconds * 1000;
      },
      now: () => t,
      every: 30,
      polls: 20, // ten minutes
      onReport: (line: string) => lines.push(line),
    });
    expect(waited.status).toBe("timeout");
    expect(lines).toHaveLength(5); // 0, 2, 4, 6 and 8 minutes
    expect(lines[0]).toMatch(/^no answer: /);
    expect(lines[1]).toMatch(/^no answer for 2 min: /);
    expect((waited as { line?: string }).line).toMatch(/^no answer for 9 min: .*ENOTFOUND.*§ The domain stops answering$/);
  });

  it("returns the body as soon as production reports the baseline, and says which build answered before", async () => {
    let t = 0;
    const readings = [
      { body: "", error: new TypeError("fetch failed") },
      { body: '{"baseline":"BR-V9.40-2031-01-01"}', status: 200 },
      { body: '{"status":"ok","baseline":"BR-V9.41-2031-01-02"}', status: 200 },
    ];
    let i = 0;
    const lines: string[] = [];
    const waited = await waitForProduction(async () => readings[i++], "BR-V9.41-2031-01-02", {
      sleep: async (seconds: number) => {
        t += seconds * 1000;
      },
      now: () => t,
      every: 60,
      polls: 10,
      reportEvery: 60,
      onReport: (line: string) => lines.push(line),
    });
    expect(waited).toMatchObject({ status: "expected", body: '{"status":"ok","baseline":"BR-V9.41-2031-01-02"}' });
    expect(lines).toEqual([expect.stringMatching(/^no answer: TypeError fetch failed: no answer;/), "production answers with BR-V9.40-2031-01-01; waiting for BR-V9.41-2031-01-02"]);
  });

  it("is what ship's both production waits use, with health returning the body or the error", () => {
    const ship = readFileSync(path.join(process.cwd(), "scripts/ship.mjs"), "utf8");
    expect(ship).toContain("productionReports([PREV, NEW], 30, 120)");
    expect(ship).toContain("productionReports(NEW, 20, 60)");
    expect(ship).toContain('return { body: "", error };');
    expect(ship).not.toMatch(/async function until\(/);
    expect(ship).toContain('console.log(`production: ${report.match(/"status":"[a-z]+"/)?.[0] ?? "?"} ${NEW}`);');
  });
});
