import { describe, expect, it } from "vitest";
import { checkNeonQuotaHealth, readNeonConsumption } from "@/modules/diagnostics/neon";

/** BR-REQ-090-07: the month's CU-hours from Neon's project row, or a sentence. */
describe("BR-REQ-090-07 the database's consumption", () => {
  it("says it is unconfigured without the two variables, and calls nothing", async () => {
    const result = await readNeonConsumption({ NEON_API_KEY: undefined, NEON_PROJECT_ID: "p" }, () => {
      throw new Error("must not be called");
    });
    expect(result).toEqual({ ok: false, reason: "unconfigured" });
  });

  it("turns compute seconds into CU-hours and reads the period", async () => {
    const result = await readNeonConsumption({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, async (url, init) => {
      expect(String(url)).toContain("/projects/p");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer k");
      return new Response(
        JSON.stringify({
          project: {
            compute_time_seconds: 266_950,
            active_time_seconds: 1_013_004,
            consumption_period_start: "2026-09-04T11:18:44Z",
            consumption_period_end: "2026-10-01T00:00:00Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consumption.cuHours).toBeCloseTo(74.15, 1);
    expect(result.consumption.activeHours).toBeCloseTo(281.4, 0);
    expect(result.consumption.periodEnd.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    // No owner on the row: no plan reported, and the stated setting decides.
    expect(result.consumption.reportedPlan).toBeNull();
  });

  // §NNN: the project row names the owning account's plan, which a project-scoped key reads —
  // "launch_v3" for the club on 2026-09-23, while /admin/tasks still printed the default Free.
  it("reads the account's plan from the project's owner", async () => {
    const answer = (subscription_type: string) => async () =>
      new Response(
        JSON.stringify({
          project: {
            compute_time_seconds: 21_600,
            consumption_period_start: "2026-09-22T00:00:00Z",
            consumption_period_end: "2026-10-01T00:00:00Z",
            owner: { email: "someone@example.org", subscription_type },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const launch = await readNeonConsumption({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, answer("launch_v3"));
    expect(launch.ok && launch.consumption.reportedPlan).toBe("LAUNCH");
    const free = await readNeonConsumption({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, answer("free_v3"));
    expect(free.ok && free.consumption.reportedPlan).toBe("FREE");
    const scale = await readNeonConsumption({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, answer("scale"));
    expect(scale.ok && scale.consumption.reportedPlan).toBeNull();
  });

  it("answers with a reason, never a throw, when Neon does not", async () => {
    const refused = await readNeonConsumption({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, async () => new Response("", { status: 401 }));
    expect(refused).toEqual({ ok: false, reason: "HTTP 401" });
    const down = await readNeonConsumption({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, async () => {
      throw new TypeError("fetch failed");
    });
    expect(down).toEqual({ ok: false, reason: "TypeError" });
  });

  // §NNN: the same project row the quota card reads carries the monthly limit too, so
  // `/api/health`'s early warning and the Costuri panel never see two different numbers.
  it("reads the project's own compute-time quota, in CU-hours, or null without one", async () => {
    const withQuota = await readNeonConsumption({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, async () =>
      new Response(
        JSON.stringify({
          project: {
            compute_time_seconds: 21_600,
            consumption_period_start: "2026-09-22T00:00:00Z",
            consumption_period_end: "2026-10-01T00:00:00Z",
            settings: { quota: { compute_time_seconds: 360_000 } },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    expect(withQuota.ok && withQuota.consumption.quotaCuHours).toBe(100);

    const withoutQuota = await readNeonConsumption({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, async () =>
      new Response(
        JSON.stringify({
          project: {
            compute_time_seconds: 21_600,
            consumption_period_start: "2026-09-22T00:00:00Z",
            consumption_period_end: "2026-10-01T00:00:00Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    expect(withoutQuota.ok && withoutQuota.consumption.quotaCuHours).toBeNull();
  });
});

/**
 * `/api/health`'s early warning for the monthly compute quota (§NNN): once this period's spend
 * reaches 80% of it, health degrades before Neon suspends the database at 100% — a suspension
 * that is total, and the one thing the club cannot be emailed about once it has happened.
 *
 * This supersedes BR-REQ-090-07 criterion 5's "`/api/health` reads no Neon figure" for the
 * quota case only (`DECISIONS.md` §NNN); the plan half of that criterion is unchanged.
 */
describe("§NNN /api/health's early warning for the monthly compute quota", () => {
  it("reads ok with no figures without the two variables, and calls nothing", async () => {
    const result = await checkNeonQuotaHealth({ NEON_API_KEY: undefined, NEON_PROJECT_ID: "p" }, () => {
      throw new Error("must not be called");
    });
    expect(result).toEqual({ status: "ok", quotaCuHours: null, usedCuHours: null, percent: null });
  });

  it("asks Neon's Data Cache to keep the answer for fifteen minutes, never no-store", async () => {
    let seenInit: RequestInit | undefined;
    await checkNeonQuotaHealth({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, async (_url, init) => {
      seenInit = init;
      return new Response(JSON.stringify({ project: { compute_time_seconds: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    expect((seenInit as { next?: { revalidate?: number } } | undefined)?.next?.revalidate).toBe(900);
    expect((seenInit as { cache?: string } | undefined)?.cache).toBeUndefined();
  });

  it("reads ok under 80% of the quota, and near-limit at or past it", async () => {
    const answer = (usedSeconds: number, quotaSeconds: number) => async () =>
      new Response(
        JSON.stringify({
          project: { compute_time_seconds: usedSeconds, settings: { quota: { compute_time_seconds: quotaSeconds } } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const under = await checkNeonQuotaHealth({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, answer(70 * 3600, 100 * 3600));
    expect(under).toEqual({ status: "ok", quotaCuHours: 100, usedCuHours: 70, percent: 70 });

    // 80% exactly is already "near", the same boundary `isNeonQuotaNearLimit` uses.
    const atLine = await checkNeonQuotaHealth({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, answer(80 * 3600, 100 * 3600));
    expect(atLine).toEqual({ status: "near-limit", quotaCuHours: 100, usedCuHours: 80, percent: 80 });

    const past = await checkNeonQuotaHealth({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, answer(82 * 3600, 100 * 3600));
    expect(past.status).toBe("near-limit");
    expect(past.percent).toBe(82);
  });

  it("reads ok with no figures when there is no quota to spend against", async () => {
    const result = await checkNeonQuotaHealth({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, async () =>
      new Response(JSON.stringify({ project: { compute_time_seconds: 12_000 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(result).toEqual({ status: "ok", quotaCuHours: null, usedCuHours: 12_000 / 3600, percent: null });
  });

  it("never fails this endpoint on its own account: a refusal, a bad answer or a network error all read ok with no figures", async () => {
    const refused = await checkNeonQuotaHealth({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, async () => new Response("", { status: 403 }));
    expect(refused).toEqual({ status: "ok", quotaCuHours: null, usedCuHours: null, percent: null });

    const threw = await checkNeonQuotaHealth({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, async () => {
      throw new TypeError("fetch failed");
    });
    expect(threw).toEqual({ status: "ok", quotaCuHours: null, usedCuHours: null, percent: null });

    const empty = await checkNeonQuotaHealth({ NEON_API_KEY: "k", NEON_PROJECT_ID: "p" }, async () =>
      new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }),
    );
    expect(empty).toEqual({ status: "ok", quotaCuHours: null, usedCuHours: null, percent: null });
  });
});
