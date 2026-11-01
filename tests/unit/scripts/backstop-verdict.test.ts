import { writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inNightlyGap, judge } from "../../../scripts/backstop-verdict.mjs";
import { gitEnv } from "../../helpers/git-env";

/**
 * BR-REQ-090-03 (the backstop criterion, §874): the GitHub backstop reads the deep health answer before it
 * pokes and fails at the end on a stalled outbox or a stale job, except maintenance in the
 * pinger's nightly gap. The health bodies are shaped as `src/app/api/health/route.ts` returns them.
 */
function health(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    depth: "deep",
    database: "ok",
    schema: { status: "current" },
    jobs: [
      { jobName: "registration-maintenance", status: "ok", lastFinishedAt: "2026-11-01T00:00:00.000Z", lastPingAt: "2026-11-01T01:10:00.000Z" },
      { jobName: "email-outbox", status: "ok", lastFinishedAt: "2026-11-01T01:00:00.000Z", lastPingAt: "2026-11-01T01:10:00.000Z" },
    ],
    email: { status: "ok" },
    neon: { status: "ok", percent: 12 },
    budget: { level: "green", meteredPercent: 12, linePercent: 20, note: null },
    ...overrides,
  };
}
const job = (jobName: string, status: string) => ({ jobName, status, lastFinishedAt: null, lastPingAt: null });
const WINTER_GAP = new Date("2026-12-01T01:17:00Z"); // 03:17 in Brașov (UTC+2)
const WINTER_AFTER = new Date("2026-12-01T02:05:00Z"); // 04:05
const WINTER_BEFORE = new Date("2026-12-01T01:04:00Z"); // 03:04
const SUMMER_RUN = new Date("2026-07-01T01:17:00Z"); // 04:17 (UTC+3)
const SUMMER_GAP = new Date("2026-07-01T00:30:00Z"); // 03:30

describe("BR-REQ-090-03 §874 the backstop's verdict", () => {
  it("is ok when everything is ok", () => {
    const verdict = judge(health(), WINTER_GAP, "production");
    expect(verdict.errors).toEqual([]);
    expect(verdict.warnings).toEqual([]);
  });

  it("fails on a stalled outbox", () => {
    const verdict = judge(health({ email: { status: "stalled" } }), SUMMER_RUN, "production");
    expect(verdict.errors).toHaveLength(1);
    expect(verdict.errors[0]).toContain("outbox is stalled");
    expect(verdict.errors[0]).toContain("docs/RUNBOOKS.md");
  });

  it("does not fail on a merely degraded outbox", () => {
    expect(judge(health({ email: { status: "degraded" } }), SUMMER_RUN, "production").errors).toEqual([]);
  });

  it("fails on a stale outbox job, at any hour", () => {
    const body = health({ jobs: [job("registration-maintenance", "ok"), job("email-outbox", "stale")] });
    for (const now of [WINTER_GAP, SUMMER_GAP, SUMMER_RUN]) {
      const verdict = judge(body, now, "production");
      expect(verdict.errors).toHaveLength(1);
      expect(verdict.errors[0]).toContain("email-outbox is stale");
    }
  });

  it("tolerates stale maintenance inside the nightly gap, in winter and in summer time", () => {
    const body = health({ jobs: [job("registration-maintenance", "stale"), job("email-outbox", "ok")] });
    expect(judge(body, WINTER_GAP, "production").errors).toEqual([]);
    expect(judge(body, SUMMER_GAP, "production").errors).toEqual([]);
  });

  it("fails on stale maintenance outside the gap, at its edges and in either season", () => {
    const body = health({ jobs: [job("registration-maintenance", "stale"), job("email-outbox", "ok")] });
    for (const now of [WINTER_AFTER, WINTER_BEFORE, SUMMER_RUN]) {
      const verdict = judge(body, now, "production");
      expect(verdict.errors).toHaveLength(1);
      expect(verdict.errors[0]).toContain("registration-maintenance is stale");
    }
  });

  it("draws the gap at 03:05 inclusive and 04:00 exclusive club time", () => {
    expect(inNightlyGap(new Date("2026-12-01T01:05:00Z"))).toBe(true);
    expect(inNightlyGap(new Date("2026-12-01T01:59:00Z"))).toBe(true);
    expect(inNightlyGap(new Date("2026-12-01T02:00:00Z"))).toBe(false);
    expect(inNightlyGap(new Date("2026-07-01T00:05:00Z"))).toBe(true);
    expect(inNightlyGap(new Date("2026-07-01T01:00:00Z"))).toBe(false);
  });

  it("never tolerates a failing or never-run maintenance, nor a stale outbox, inside the gap", () => {
    for (const status of ["failing", "never_run"]) {
      const body = health({ jobs: [job("registration-maintenance", status), job("email-outbox", "ok")] });
      expect(judge(body, WINTER_GAP, "production").errors).toHaveLength(1);
    }
  });

  it("fails when the database does not answer, and says nothing about jobs it could not read", () => {
    const verdict = judge(health({ database: "down", jobs: null, email: null }), SUMMER_RUN, "qa");
    expect(verdict.errors).toHaveLength(1);
    expect(verdict.errors[0]).toContain("database does not answer (down)");
    expect(judge(null, SUMMER_RUN, "qa").errors[0]).toContain("no answer");
  });

  it("fails on a red Neon budget and only warns on amber", () => {
    const red = judge(health({ budget: { level: "red", meteredPercent: 90 } }), SUMMER_RUN, "qa");
    expect(red.errors[0]).toContain("90 % of its monthly Neon compute quota");
    const amber = judge(health({ budget: { level: "amber", meteredPercent: 65 } }), SUMMER_RUN, "qa");
    expect(amber.errors).toEqual([]);
    expect(amber.warnings).toHaveLength(1);
  });

  it("the command line prints annotations and exits 1 on an error, 0 otherwise", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "backstop-"));
    const file = path.join(dir, "health.json");
    const script = path.resolve("scripts/backstop-verdict.mjs");
    writeFileSync(file, JSON.stringify(health({ email: { status: "stalled" } })));
    const bad = spawnSync("node", [script, "--name", "production", "--file", file, "--now", "2026-07-01T10:00:00Z"], { encoding: "utf8", env: gitEnv() });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("::error::production's email outbox is stalled");
    writeFileSync(file, JSON.stringify(health()));
    const good = spawnSync("node", [script, "--name", "production", "--file", file], { encoding: "utf8", env: gitEnv() });
    expect(good.status).toBe(0);
    expect(good.stdout).toContain("production: database ok");
    expect(good.stdout).not.toContain("::error::");
    const missing = spawnSync("node", [script, "--name", "production", "--file", path.join(dir, "absent.json")], { encoding: "utf8", env: gitEnv() });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain("no health answer was saved");
  });
});
