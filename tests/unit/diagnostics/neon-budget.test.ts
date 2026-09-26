import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOVERNOR_EFFECTS,
  governedCadence,
  NEON_BUDGET_LEVELS,
  neonBudget,
} from "@/modules/diagnostics/domain/neon-budget";
import { MAX_QUIET_MINUTES } from "@/modules/jobs/schedule";

/**
 * §NNN — the month's budget as one word, and what the platform does at each word. Pure: the
 * level is a function of the spend, the limit, the period and the instant, and the effects are a
 * table. The re-measure of 2026-09-26 is the case these are written against: production at 4.4
 * CU-hours a day reaches its 100 around the 23rd of a month, four weeks before the race.
 */
const OCTOBER = { periodStart: new Date("2026-10-01T00:00:00.000Z"), periodEnd: new Date("2026-11-01T00:00:00.000Z") };
const on = (day: number, hour = 12) => new Date(Date.UTC(2026, 9, day, hour));

describe("§NNN neonBudget — the level", () => {
  it("is normal while the pace fits: the quiet pace of 2.3 CU-hours a day ends October near 72 of 100", () => {
    const budget = neonBudget({ usedCuHours: 2.3 * 10.5, quotaCuHours: 100, ...OCTOBER, now: on(11) });
    expect(budget.level).toBe("normal");
    expect(budget.projectedCuHours).toBeCloseTo(71.3, 0);
    expect(budget.runsOutAt).toBeNull();
  });

  it("is ahead when this week's 4.4 a day would run out before the month ends — long before 80%, and says when", () => {
    const budget = neonBudget({ usedCuHours: 4.4 * 10.5, quotaCuHours: 100, ...OCTOBER, now: on(11) });
    expect(budget.ratio).toBeLessThan(0.8);
    expect(budget.level).toBe("ahead");
    expect(budget.cuHoursPerDay).toBeCloseTo(4.4, 5);
    // 100 / 4.4 = 22.7 days from the 1st: the 23rd, as the re-measure projected.
    expect(budget.runsOutAt?.toISOString().slice(0, 10)).toBe("2026-10-23");
  });

  it("measures the pace over a day at least, so the first busy hour of a period does not throttle a month", () => {
    // Two CU-hours in the first hour would be 48 a day; measured over a day, it fits.
    const budget = neonBudget({ usedCuHours: 2, quotaCuHours: 100, ...OCTOBER, now: new Date("2026-10-01T01:00:00.000Z") });
    expect(budget.level).toBe("normal");
    expect(budget.cuHoursPerDay).toBeCloseTo(2, 5);
  });

  it("is tight from 80%, critical from 95% and exhausted at 100%, whatever the pace", () => {
    const at = (used: number) => neonBudget({ usedCuHours: used, quotaCuHours: 100, ...OCTOBER, now: on(30) }).level;
    expect(at(79.9)).toBe("normal");
    expect(at(80)).toBe("tight");
    expect(at(94.9)).toBe("tight");
    expect(at(95)).toBe("critical");
    expect(at(99.99)).toBe("critical");
    expect(at(100)).toBe("exhausted");
    expect(at(130)).toBe("exhausted");
  });

  it("is unlimited without a quota — nothing to run into, nothing to slow down for", () => {
    const budget = neonBudget({ usedCuHours: 500, quotaCuHours: null, ...OCTOBER, now: on(11) });
    expect(budget).toMatchObject({ level: "unlimited", ratio: null, projectedCuHours: null, runsOutAt: null });
  });
});

describe("§NNN the governor's rulebook", () => {
  it("changes nothing when it knows nothing, when there is no limit, or while the pace fits", () => {
    for (const level of ["unknown", "unlimited", "normal"] as const) {
      expect(GOVERNOR_EFFECTS[level]).toEqual({ jobFloorMinutes: 0, jobsPaused: false, healthReuseMinutes: 0, restingCopies: false });
    }
  });

  it("slows the jobs as the month runs ahead, and never past the longest quiet a wake may assume", () => {
    expect(GOVERNOR_EFFECTS.ahead.jobFloorMinutes).toBe(60);
    expect(GOVERNOR_EFFECTS.tight.jobFloorMinutes).toBe(120);
    expect(GOVERNOR_EFFECTS.critical.jobFloorMinutes).toBe(120);
    for (const level of NEON_BUDGET_LEVELS) expect(GOVERNOR_EFFECTS[level].jobFloorMinutes).toBeLessThanOrEqual(MAX_QUIET_MINUTES);
  });

  it("reuses health answers only near the wall, and pauses the jobs and rests the site only at it", () => {
    for (const level of NEON_BUDGET_LEVELS) {
      expect(GOVERNOR_EFFECTS[level].healthReuseMinutes > 0).toBe(level === "tight" || level === "critical");
      expect(GOVERNOR_EFFECTS[level].jobsPaused).toBe(level === "exhausted");
      expect(GOVERNOR_EFFECTS[level].restingCopies).toBe(level === "exhausted");
    }
  });

  it("lets the longer of the Administrator's interval and the governor's floor win", () => {
    expect(governedCadence(0, 60)).toBe(60);
    expect(governedCadence(120, 60)).toBe(120);
    expect(governedCadence(30, 0)).toBe(30);
  });
});

describe("§NNN readNeonBudget — without the database, and never a storm on Neon", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("@/shared/config/env");
  });

  it("is unknown, with no effect and no request, without the two variables", async () => {
    vi.doMock("@/shared/config/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/shared/config/env")>();
      return { env: { ...actual.env, NEON_API_KEY: undefined, NEON_PROJECT_ID: undefined } };
    });
    const { readNeonBudget } = await import("@/modules/diagnostics/neon-budget");
    const fetchImpl = vi.fn();
    const reading = await readNeonBudget(on(11), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(reading.level).toBe("unknown");
    expect(reading.effects.jobFloorMinutes).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks Neon once a minute per instance at most, and reads a refusal as unknown", async () => {
    vi.doMock("@/shared/config/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/shared/config/env")>();
      return { env: { ...actual.env, NEON_API_KEY: "k", NEON_PROJECT_ID: "p" } };
    });
    const { readNeonBudget, forgetNeonBudget } = await import("@/modules/diagnostics/neon-budget");
    forgetNeonBudget();
    const fetchImpl = vi.fn(async () => new Response("", { status: 503 }));
    const first = await readNeonBudget(on(11), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const calls = fetchImpl.mock.calls.length;
    await readNeonBudget(new Date(on(11).getTime() + 30_000), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(first.level).toBe("unknown");
    expect(fetchImpl.mock.calls.length).toBe(calls);
    await readNeonBudget(new Date(on(11).getTime() + 61_000), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(calls);
  });

  it("reads the level off the meter: exhausted when the metered spend has reached the limit", async () => {
    vi.doMock("@/shared/config/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/shared/config/env")>();
      return { env: { ...actual.env, NEON_API_KEY: "k", NEON_PROJECT_ID: "p" } };
    });
    const { readNeonBudget, forgetNeonBudget } = await import("@/modules/diagnostics/neon-budget");
    forgetNeonBudget();
    const row = {
      project: {
        compute_time_seconds: 100 * 3600,
        consumption_period_start: "2026-10-01T00:00:00Z",
        consumption_period_end: "2026-11-01T00:00:00Z",
        settings: { quota: { compute_time_seconds: 100 * 3600 } },
      },
    };
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).endsWith("/projects/p") ? Response.json(row) : new Response("", { status: 404 }),
    );
    const reading = await readNeonBudget(on(23), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(reading.level).toBe("exhausted");
    expect(reading.effects).toMatchObject({ jobsPaused: true, restingCopies: true });
    expect(reading.meter?.periodEnd.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});
