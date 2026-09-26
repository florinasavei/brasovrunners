import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  budgetLevel,
  GOVERNOR_EFFECTS,
  governedCadence,
  NEON_BUDGET_LEVELS,
  neonBudget,
} from "@/modules/diagnostics/domain/neon-budget";
import { MAX_QUIET_MINUTES } from "@/modules/jobs/schedule";

/**
 * §447 — the month's budget as green, amber or red, and what the platform does at each. Pure: the
 * level is a function of the spend, the limit, the period and the instant, and the effects are a
 * table. The re-measure of 2026-09-26 is the case these are written against: production at 4.4
 * CU-hours a day reaches its 100 around the 23rd of a month, four weeks before the race.
 */
const OCTOBER = { periodStart: new Date("2026-10-01T00:00:00.000Z"), periodEnd: new Date("2026-11-01T00:00:00.000Z") };
const on = (day: number, hour = 12) => new Date(Date.UTC(2026, 9, day, hour));
const DEFAULTS = async () => ({ amberPercent: 60, redPercent: 85 });

describe("§447 budgetLevel — green, amber, red against the month's line", () => {
  const level = (used: number, day: number, thresholds?: { amberPercent: number; redPercent: number }) =>
    budgetLevel(used, 100, OCTOBER.periodStart, OCTOBER.periodEnd, on(day), thresholds);

  it("is green on or under the line, and within a quarter past it", () => {
    // Noon on the 11th: 10.5 of 31 days gone, the line at 33.9.
    expect(level(20, 11)).toBe("green");
    expect(level(33.9, 11)).toBe("green");
    expect(level(42, 11)).toBe("green"); // 24% past the line
  });

  it("is amber more than a quarter past the line — this week's 4.4 a day, long before 60%", () => {
    const budget = neonBudget({ usedCuHours: 4.4 * 10.5, quotaCuHours: 100, ...OCTOBER, now: on(11) });
    expect(budget.ratio).toBeLessThan(0.6);
    expect(budget.level).toBe("amber");
    expect(budget.lineCuHours).toBeCloseTo((100 * 10.5) / 31, 5);
    // 100 / 4.4 = 22.7 days from the 1st: the 23rd, as the re-measure projected.
    expect(budget.runsOutAt?.toISOString().slice(0, 10)).toBe("2026-10-23");
  });

  it("is amber from 60% and red from 85% of the quota, whatever the line", () => {
    expect(level(59.9, 30)).toBe("green");
    expect(level(60, 30)).toBe("amber");
    expect(level(84.9, 30)).toBe("amber");
    expect(level(85, 30)).toBe("red");
    expect(level(130, 30)).toBe("red");
  });

  it("follows the Administrator's thresholds", () => {
    expect(level(55, 30, { amberPercent: 50, redPercent: 70 })).toBe("amber");
    expect(level(70, 30, { amberPercent: 50, redPercent: 70 })).toBe("red");
    expect(level(80, 30, { amberPercent: 70, redPercent: 90 })).toBe("amber");
  });

  it("measures the line over a day at least, so the first busy hour of a period is not a month of it", () => {
    // Two CU-hours in the first hour: 0.13% of the period gone, but the line is read at a day's 3.2.
    expect(budgetLevel(2, 100, OCTOBER.periodStart, OCTOBER.periodEnd, new Date("2026-10-01T01:00:00.000Z"))).toBe("green");
    expect(budgetLevel(5, 100, OCTOBER.periodStart, OCTOBER.periodEnd, new Date("2026-10-01T01:00:00.000Z"))).toBe("amber");
  });

  it("is green without a quota — nothing to run into", () => {
    const budget = neonBudget({ usedCuHours: 500, quotaCuHours: null, ...OCTOBER, now: on(11) });
    expect(budget).toMatchObject({ level: "green", ratio: null, lineCuHours: null, projectedCuHours: null, runsOutAt: null, spent: false });
  });

  it("says when the quota is spent", () => {
    expect(neonBudget({ usedCuHours: 100, quotaCuHours: 100, ...OCTOBER, now: on(23) }).spent).toBe(true);
    expect(neonBudget({ usedCuHours: 99.9, quotaCuHours: 100, ...OCTOBER, now: on(23) }).spent).toBe(false);
  });
});

describe("§447 the governor's rulebook", () => {
  it("changes nothing when it knows nothing or while the month is green", () => {
    for (const level of ["unknown", "green"] as const) {
      expect(GOVERNOR_EFFECTS[level]).toEqual({ jobFloorMinutes: 0, healthReuseMinutes: 0, cacheCeilingFactor: 1, publicMissRefreshMinutes: 0 });
    }
  });

  it("amber: jobs hourly, the public cache twice as long; red: every two hours, four times, health reused, cache only", () => {
    expect(GOVERNOR_EFFECTS.amber).toEqual({ jobFloorMinutes: 60, healthReuseMinutes: 0, cacheCeilingFactor: 2, publicMissRefreshMinutes: 0 });
    expect(GOVERNOR_EFFECTS.red).toEqual({ jobFloorMinutes: 120, healthReuseMinutes: 10, cacheCeilingFactor: 4, publicMissRefreshMinutes: 10 });
    for (const level of NEON_BUDGET_LEVELS) expect(GOVERNOR_EFFECTS[level].jobFloorMinutes).toBeLessThanOrEqual(MAX_QUIET_MINUTES);
  });

  it("lets the longer of the Administrator's interval and the governor's floor win", () => {
    expect(governedCadence(0, 60)).toBe(60);
    expect(governedCadence(120, 60)).toBe(120);
    expect(governedCadence(30, 0)).toBe(30);
  });
});

describe("§447 readNeonBudget — without the database, and never a storm on Neon", () => {
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
    const reading = await readNeonBudget(on(11), { fetchImpl: fetchImpl as unknown as typeof fetch, thresholds: DEFAULTS });
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
    const first = await readNeonBudget(on(11), { fetchImpl: fetchImpl as unknown as typeof fetch, thresholds: DEFAULTS });
    const calls = fetchImpl.mock.calls.length;
    await readNeonBudget(new Date(on(11).getTime() + 30_000), { fetchImpl: fetchImpl as unknown as typeof fetch, thresholds: DEFAULTS });
    expect(first.level).toBe("unknown");
    expect(fetchImpl.mock.calls.length).toBe(calls);
    await readNeonBudget(new Date(on(11).getTime() + 61_000), { fetchImpl: fetchImpl as unknown as typeof fetch, thresholds: DEFAULTS });
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(calls);
  });

  it("reads the level off the meter: red and spent when the metered spend has reached the limit", async () => {
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
    const reading = await readNeonBudget(on(23), { fetchImpl: fetchImpl as unknown as typeof fetch, thresholds: DEFAULTS });
    expect(reading.level).toBe("red");
    expect(reading.budget?.spent).toBe(true);
    expect(reading.effects.jobFloorMinutes).toBe(120);
    expect(reading.meter?.periodEnd.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("§447 readNeonBudget — the Administrator's thresholds", () => {
  it("reads the level by the thresholds in force", async () => {
    vi.resetModules();
    vi.doMock("@/shared/config/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/shared/config/env")>();
      return { env: { ...actual.env, NEON_API_KEY: "k", NEON_PROJECT_ID: "p" } };
    });
    const { readNeonBudget, forgetNeonBudget } = await import("@/modules/diagnostics/neon-budget");
    forgetNeonBudget();
    const row = {
      project: {
        compute_time_seconds: 70 * 3600,
        consumption_period_start: "2026-10-01T00:00:00Z",
        consumption_period_end: "2026-11-01T00:00:00Z",
        settings: { quota: { compute_time_seconds: 100 * 3600 } },
      },
    };
    const fetchImpl = vi.fn(async (url: string) => (String(url).endsWith("/projects/p") ? Response.json(row) : new Response("", { status: 404 })));
    const reading = await readNeonBudget(on(30), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      thresholds: async () => ({ amberPercent: 50, redPercent: 65 }),
    });
    expect(reading.level).toBe("red");
    expect(reading.thresholds).toEqual({ amberPercent: 50, redPercent: 65 });
    vi.doUnmock("@/shared/config/env");
  });
});

/*
  Finding (5) of the fix round (§447): `/devs` read the meter itself and coloured it with the
  defaults, so with the Administrator's own thresholds saved it could show another level than
  Costuri and `/api/health`. It now asks `budgetOfInForce`, which reads the thresholds through the
  governor's own cached reader.
*/
describe("§447 budgetOfInForce — a meter in hand, against the saved thresholds", () => {
  it("reads the thresholds through the governor's cached reader, not the defaults", async () => {
    vi.resetModules();
    vi.doMock("@/modules/diagnostics/budget-thresholds", () => ({ cachedBudgetThresholds: async () => ({ amberPercent: 50, redPercent: 65 }) }));
    const { budgetOf, budgetOfInForce } = await import("@/modules/diagnostics/neon-budget");
    const meter = {
      usedCuHours: 70,
      source: "operations",
      meteredCuHours: null,
      operationsCuHours: 70,
      legacyCuHours: 0,
      awakeHours: 280,
      floorCu: 0.25,
      ...OCTOBER,
      quotaCuHours: 100,
      reportedPlan: null,
    } as unknown as Parameters<typeof budgetOf>[0];
    // The defaults (60/85) read 70% as amber; the Administrator's 50/65 read it red, as Costuri does.
    expect(budgetOf(meter, on(30)).level).toBe("amber");
    expect((await budgetOfInForce(meter, on(30))).level).toBe("red");
    vi.doUnmock("@/modules/diagnostics/budget-thresholds");
  });
});
