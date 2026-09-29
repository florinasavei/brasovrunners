import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetKnownBudget,
  KNOWN_LEVEL_MAX_AGE_MS,
  lastKnownBudget,
  noteBudgetReading,
  peekNeonBudgetLevel,
} from "@/modules/diagnostics/budget-level";

/**
 * §549 (amending §447), a review finding — the public cache read the governor's level inside a
 * static page's render, and a stale memo started a request to Neon's API there: the render's own,
 * which shortened the page to the shared reading's fifteen minutes. The render is now told the
 * level this instance last read, and asks nothing.
 */
const AT = new Date("2026-10-20T09:00:00.000Z");
const PERIOD_END = new Date("2026-11-01T00:00:00.000Z");
const later = (ms: number) => new Date(AT.getTime() + ms);

beforeEach(() => forgetKnownBudget());

describe("§549 the governor's level on a page is the last known one, never a request", () => {
  it("is unknown on an instance that has heard no reading", () => {
    expect(peekNeonBudgetLevel(AT)).toBe("unknown");
    expect(lastKnownBudget(AT)).toBeNull();
  });

  it("answers the last reading noted, with its spend and its period's end", () => {
    noteBudgetReading({ level: "red", budget: { spent: true }, meter: { periodEnd: PERIOD_END } }, AT);
    expect(peekNeonBudgetLevel(later(60_000))).toBe("red");
    expect(lastKnownBudget(later(60_000))).toEqual({ level: "red", spent: true, periodEnd: PERIOD_END, at: AT.getTime() });
  });

  it("believes a reading for three hours, then reads unknown until the next one", () => {
    noteBudgetReading({ level: "amber", budget: { spent: false }, meter: { periodEnd: PERIOD_END } }, AT);
    expect(peekNeonBudgetLevel(later(KNOWN_LEVEL_MAX_AGE_MS - 1))).toBe("amber");
    expect(peekNeonBudgetLevel(later(KNOWN_LEVEL_MAX_AGE_MS))).toBe("unknown");
  });

  it("never carries a red month into the next period", () => {
    const nearEnd = new Date(PERIOD_END.getTime() - 60_000);
    noteBudgetReading({ level: "red", budget: { spent: true }, meter: { periodEnd: PERIOD_END } }, nearEnd);
    expect(peekNeonBudgetLevel(nearEnd)).toBe("red");
    expect(peekNeonBudgetLevel(PERIOD_END)).toBe("unknown");
  });

  it("makes no request: peeking a stale or missing level asks nobody", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    peekNeonBudgetLevel(AT);
    noteBudgetReading({ level: "green", budget: null, meter: null }, AT);
    peekNeonBudgetLevel(later(KNOWN_LEVEL_MAX_AGE_MS * 2));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("§549 every governor reading tells the page's level", () => {
  afterEach(() => {
    vi.doUnmock("@/shared/config/env");
    vi.resetModules();
  });

  it("readNeonBudget — the job pinger's reading — notes its level for the renders on this instance", async () => {
    vi.resetModules();
    vi.doMock("@/shared/config/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/shared/config/env")>();
      return { env: { ...actual.env, NEON_API_KEY: "k", NEON_PROJECT_ID: "p" } };
    });
    const { readNeonBudget, forgetNeonBudget } = await import("@/modules/diagnostics/neon-budget");
    const level = await import("@/modules/diagnostics/budget-level");
    forgetNeonBudget();
    const row = {
      project: {
        compute_time_seconds: 100 * 3600,
        consumption_period_start: "2026-10-01T00:00:00Z",
        consumption_period_end: "2026-11-01T00:00:00Z",
        settings: { quota: { compute_time_seconds: 100 * 3600 } },
      },
    };
    const fetchImpl = vi.fn(async (url: string) => (String(url).endsWith("/projects/p") ? Response.json(row) : new Response("", { status: 404 })));
    await readNeonBudget(AT, { fetchImpl: fetchImpl as unknown as typeof fetch, thresholds: async () => ({ amberPercent: 70, redPercent: 85 }) });
    expect(level.peekNeonBudgetLevel(later(1_000))).toBe("red");
    expect(level.lastKnownBudget(later(1_000))).toMatchObject({ spent: true, periodEnd: PERIOD_END });
    // And forgetting the governor — a saved threshold — forgets the page's level too.
    forgetNeonBudget();
    expect(level.peekNeonBudgetLevel(later(1_000))).toBe("unknown");
  });
});
