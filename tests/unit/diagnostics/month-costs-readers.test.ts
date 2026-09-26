import { beforeEach, describe, expect, it, vi } from "vitest";
import { previousPeriodCuSeconds } from "@/modules/diagnostics/domain/neon-meter";
import { FAKE_PROJECT_ID, fakeNeon, NEON_ENV, productionLikeState } from "../../helpers/fake-neon";

/**
 * BR-REQ-090-07 criterion 19 (§479) — the two provider readers only «Luna aceasta» uses: Vercel's
 * month for Costuri, from Next's data cache for an hour and never a failure kept; and Neon's
 * previous billing period, from its consumption history, which a project-scoped key is refused.
 */
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);

const { fakeNextCache } = await import("../../helpers/next-cache");
const { readVercelMonthForCosts } = await import("@/modules/diagnostics/vercel");
const { forgetNeonConsumptionRefusals, readNeonPreviousPeriod } = await import("@/modules/diagnostics/neon");

const NOW = new Date("2026-09-19T10:00:00.000Z");
const VERCEL = { VERCEL_API_TOKEN: "t", VERCEL_PROJECT_ID: "prj_1", VERCEL_TEAM_ID: undefined };

function vercelAnswering(status = 200) {
  const calls: string[] = [];
  const fetchImpl = (async (url: URL | string) => {
    calls.push(String(url));
    if (status !== 200) return new Response("{}", { status });
    const at = Date.UTC(2026, 8, 18, 8);
    return Response.json({
      deployments: [{ uid: "a", createdAt: at, buildingAt: at, ready: at + 3 * 60_000, readyState: "READY" }],
      pagination: { next: null },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

beforeEach(() => {
  fakeNextCache.reset();
  forgetNeonConsumptionRefusals();
});

describe("Vercel's month on Costuri, cached an hour", () => {
  it("reads once, then answers from the cache — the token never in the key", async () => {
    const vercel = vercelAnswering();
    expect(await readVercelMonthForCosts(VERCEL, NOW, vercel.fetchImpl)).toEqual({ ok: true, month: { deployments: 1, buildMinutes: 3 } });
    expect(await readVercelMonthForCosts(VERCEL, NOW, vercel.fetchImpl)).toEqual({ ok: true, month: { deployments: 1, buildMinutes: 3 } });
    expect(vercel.calls).toHaveLength(1);
    const keys = [...fakeNextCache.entries.keys()].join(" ");
    expect(keys).toContain("prj_1");
    expect(keys).not.toContain('"t"');
  });

  it("keeps no failure: a refusal says why and the next open asks again", async () => {
    const refused = vercelAnswering(403);
    expect(await readVercelMonthForCosts(VERCEL, NOW, refused.fetchImpl)).toEqual({ ok: false, reason: "HTTP 403" });
    expect(fakeNextCache.entries.size).toBe(0);
    const fine = vercelAnswering();
    expect((await readVercelMonthForCosts(VERCEL, NOW, fine.fetchImpl)).ok).toBe(true);
    expect(fine.calls).toHaveLength(1);
  });

  it("is unconfigured without a token, and asks nothing", async () => {
    const vercel = vercelAnswering();
    expect(await readVercelMonthForCosts({ ...VERCEL, VERCEL_API_TOKEN: undefined }, NOW, vercel.fetchImpl)).toEqual({ ok: false, reason: "unconfigured" });
    expect(vercel.calls).toHaveLength(0);
  });
});

describe("Neon's previous billing period", () => {
  const PERIOD_START = new Date("2026-10-01T00:00:00.000Z");

  it("reads the month before from the consumption history, for an organisation's key", async () => {
    const state = productionLikeState();
    (state.project as Record<string, unknown>).org_id = "org-club";
    state.consumption = {
      projects: [
        {
          project_id: FAKE_PROJECT_ID,
          periods: [
            {
              period_start: "2026-09-01T00:00:00Z",
              consumption: [
                { metrics: [{ metric_name: "compute_unit_seconds", value: 36_000 }] },
                { metrics: [{ metric_name: "compute_unit_seconds", value: 36_000 }] },
              ],
            },
          ],
        },
      ],
    };
    const neon = fakeNeon(state);
    const urls: URL[] = [];
    const recording = ((input: string | URL | Request, init?: RequestInit) => {
      urls.push(new URL(String(input)));
      return neon.fetch(input, init);
    }) as typeof fetch;
    const read = await readNeonPreviousPeriod(NEON_ENV, PERIOD_START, { fetchImpl: recording });
    expect(read).toEqual({ ok: true, cuHours: 20, start: new Date("2026-09-01T00:00:00.000Z"), end: PERIOD_START });
    const history = urls.find((url) => url.pathname.endsWith("/consumption_history/v2/projects"));
    expect(history?.searchParams.get("from")).toBe("2026-09-01T00:00:00.000Z");
    expect(history?.searchParams.get("to")).toBe("2026-10-01T00:00:00.000Z");
    expect(history?.searchParams.get("org_id")).toBe("org-club");
  });

  it("takes the previous period's start from Neon's answer, not the first of the month", async () => {
    // Periods that turn on the 16th: current from 16 October, previous from 16 September. The
    // answer, asked from 1 September, also carries the tail of the period before (from 16 August).
    const start = new Date("2026-10-16T00:00:00.000Z");
    const state = productionLikeState();
    (state.project as Record<string, unknown>).org_id = "org-club";
    state.consumption = {
      projects: [
        {
          project_id: FAKE_PROJECT_ID,
          periods: [
            { period_start: "2026-08-16T00:00:00Z", consumption: [{ metrics: [{ metric_name: "compute_unit_seconds", value: 360_000 }] }] },
            { period_start: "2026-09-16T00:00:00Z", consumption: [{ metrics: [{ metric_name: "compute_unit_seconds", value: 54_000 }] }] },
          ],
        },
      ],
    };
    const read = await readNeonPreviousPeriod(NEON_ENV, start, { fetchImpl: fakeNeon(state).fetch });
    expect(read).toEqual({ ok: true, cuHours: 15, start: new Date("2026-09-16T00:00:00.000Z"), end: start });
  });

  it("falls back to the first of the month before when the answer names no period start", () => {
    const body = { projects: [{ project_id: "p", periods: [{ consumption: [{ metrics: [{ metric_name: "compute_unit_seconds", value: 7_200 }] }] }] }] };
    const fallback = new Date("2026-09-01T00:00:00.000Z");
    expect(previousPeriodCuSeconds(body, "p", new Date("2026-10-01T00:00:00.000Z"), fallback)).toEqual({ seconds: 7_200, start: fallback });
    expect(previousPeriodCuSeconds({ projects: [] }, "p", new Date("2026-10-01T00:00:00.000Z"), fallback)).toBeNull();
  });

  it("says why for a project-scoped key, which Neon refuses the history", async () => {
    const state = productionLikeState();
    (state.project as Record<string, unknown>).org_id = "org-club";
    const neon = fakeNeon(state);
    const read = await readNeonPreviousPeriod(NEON_ENV, PERIOD_START, { fetchImpl: neon.fetch });
    expect(read).toEqual({ ok: false, reason: "HTTP 404" });
    // The refusal is remembered, as the meter remembers it: the next open asks Neon's history nothing.
    neon.calls.length = 0;
    expect(await readNeonPreviousPeriod(NEON_ENV, PERIOD_START, { fetchImpl: neon.fetch })).toEqual({ ok: false, reason: "HTTP 403/404, remembered" });
    expect(neon.calls.some((call) => call.path === "/consumption_history/v2/projects")).toBe(false);
  });

  it("says why without an organisation on the row, and without the variables", async () => {
    expect(await readNeonPreviousPeriod(NEON_ENV, PERIOD_START, { fetchImpl: fakeNeon(productionLikeState()).fetch })).toEqual({
      ok: false,
      reason: "no organisation",
    });
    expect(await readNeonPreviousPeriod({ NEON_API_KEY: undefined, NEON_PROJECT_ID: undefined }, PERIOD_START)).toEqual({ ok: false, reason: "unconfigured" });
  });
});
