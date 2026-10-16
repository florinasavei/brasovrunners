import { describe, expect, it } from "vitest";
import { readVercelUsage, summariseVercelCharges } from "@/modules/diagnostics/vercel-usage";
import { readVercelMonth } from "@/modules/diagnostics/vercel";

/**
 * §NNN — Vercel's Usage page's lines, read from its billing charges API (`GET /v1/billing/charges`,
 * FOCUS, one JSON object per line). The lines are shaped like the ones the club's team answered on
 * 2026-10-16 — «Build CPU Minutes» per project, «Fluid Active CPU», an unmetered «Pro» line for the
 * seat — with invented numbers and no account id.
 */
const line = (service: string, unit: string | null, quantity: number, usd: number, project?: string, day = "2026-10-01", category = "Usage") =>
  JSON.stringify({
    ChargePeriodStart: `${day}T07:00:00.000Z`,
    ChargeCategory: category,
    EffectiveCost: usd,
    BilledCost: usd,
    ServiceName: service,
    ConsumedQuantity: quantity,
    ConsumedUnit: unit,
    Tags: project ? { ProjectName: project } : {},
  });

const BODY = [
  line("Build CPU Minutes", "minute", 100, 0.35, "site-production"),
  line("Build CPU Minutes", "minute", 60, 0.21, "site-qa"),
  line("Build CPU Minutes", "minute", 40, 0.14, "site-production", "2026-10-02"),
  line("Fluid Active CPU", "hour", 1.5, 0.2, "site-production"),
  line("Fluid Active CPU", "hour", 0.75, 0.1, "site-qa", "2026-10-02"),
  line("Observability Events", "Events", 50_000, 0.04, "site-production"),
  // A service that cost nothing, and a rounding of one: not lines.
  line("CDN Requests", "Requests", 12_000, 0),
  line("Image Optimization Cache Reads", "Reads", 3, 0.001),
  // The subscription: no unit, so no consumption — kept apart from the usage the credit is spent on.
  line("Pro", null, 1, 10.5, undefined, "2026-10-01", "Purchase"),
  "not json at all",
  "",
].join("\n");

const PERIOD_START = new Date("2026-10-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-10-17T00:00:00.000Z");

describe("Vercel's month, from its billing charges", () => {
  it("sums each service across days and projects, dearest first, and leaves out what cost nothing", () => {
    const usage = summariseVercelCharges(BODY, PERIOD_START, PERIOD_END);

    expect(usage.lines.map((entry) => entry.service)).toEqual(["Build CPU Minutes", "Fluid Active CPU", "Observability Events"]);
    expect(usage.lines[0]).toMatchObject({ unit: "minute", quantity: 200 });
    expect(usage.lines[0].usd).toBeCloseTo(0.7, 5);
    expect(usage.usageUsd).toBeCloseTo(0.7 + 0.3 + 0.04, 5);
    expect(usage.periodStart).toBe(PERIOD_START);
    expect(usage.periodEnd).toBe(PERIOD_END);
  });

  it("keeps the subscription apart, builds by project and the function CPU hours that decide Hobby", () => {
    const usage = summariseVercelCharges(BODY, PERIOD_START, PERIOD_END);

    expect(usage.subscriptionUsd).toBeCloseTo(10.5, 5);
    expect(usage.activeCpuHours).toBeCloseTo(2.25, 5);
    expect(usage.buildsByProject.map((entry) => [entry.project, entry.minutes])).toEqual([
      ["site-production", 140],
      ["site-qa", 60],
    ]);
  });

  it("counts only `Usage` rows: a credit, a tax or an adjustment never nets a service, the subscription or the CPU hours", () => {
    const noisy = [
      BODY,
      // A credit against the CPU line, with a unit, and a tax and an adjustment with none.
      line("Fluid Active CPU", "hour", -1, -0.5, "site-production", "2026-10-03", "Credit"),
      line("Build CPU Minutes", "minute", -30, -0.1, "site-production", "2026-10-03", "Credit"),
      line("Vercel Tax", null, 0, 2.2, undefined, "2026-10-03", "Tax"),
      line("Pro", null, 1, -3, undefined, "2026-10-03", "Adjustment"),
      // A row with no category at all is not consumption either.
      JSON.stringify({ ServiceName: "Observability Events", ConsumedQuantity: 9_999, ConsumedUnit: "Events", EffectiveCost: 9 }),
    ].join("\n");
    const clean = summariseVercelCharges(BODY, PERIOD_START, PERIOD_END);
    const usage = summariseVercelCharges(noisy, PERIOD_START, PERIOD_END);

    expect(usage.lines).toEqual(clean.lines);
    expect(usage.usageUsd).toBeCloseTo(clean.usageUsd, 5);
    expect(usage.subscriptionUsd).toBeCloseTo(10.5, 5);
    expect(usage.activeCpuHours).toBeCloseTo(2.25, 5);
    expect(usage.buildsByProject).toEqual(clean.buildsByProject);
  });

  it("turns Active CPU into hours from seconds or milliseconds, and compares nothing in a unit it does not know", () => {
    const seconds = summariseVercelCharges([line("Fluid Active CPU", "second", 7_200, 0.2), line("Fluid Active CPU", "Seconds", 3_600, 0.1)].join("\n"), PERIOD_START, PERIOD_END);
    expect(seconds.activeCpuHours).toBeCloseTo(3, 5);
    expect(seconds.activeCpuUnit).toBeNull();
    const millis = summariseVercelCharges(line("Fluid Active CPU", "millisecond", 5_400_000, 0.2), PERIOD_START, PERIOD_END);
    expect(millis.activeCpuHours).toBeCloseTo(1.5, 5);

    const odd = summariseVercelCharges([line("Fluid Active CPU", "hour", 1, 0.2), line("Fluid Active CPU", "GB-Hrs", 5, 0.1)].join("\n"), PERIOD_START, PERIOD_END);
    expect(odd.activeCpuHours).toBeNull();
    expect(odd.activeCpuUnit).toBe("GB-Hrs");
    // The line itself is still printed as Vercel wrote it.
    expect(odd.lines[0]).toMatchObject({ service: "Fluid Active CPU" });
  });

  it("asks for the calendar month so far and sends the token, the team and nothing else of either", async () => {
    const seen: { url: string; authorization: string | undefined }[] = [];
    const result = await readVercelUsage({ VERCEL_API_TOKEN: "t0ken", VERCEL_TEAM_ID: "team_x" }, new Date("2026-10-16T12:00:00.000Z"), async (input, init) => {
      seen.push({ url: String(input), authorization: (init?.headers as Record<string, string>).authorization });
      return new Response(BODY, { status: 200 });
    });

    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0].url);
    expect(url.origin + url.pathname).toBe("https://api.vercel.com/v1/billing/charges");
    expect(url.searchParams.get("from")).toBe("2026-10-01T00:00:00.000Z");
    expect(url.searchParams.get("to")).toBe("2026-10-17T00:00:00.000Z");
    expect(url.searchParams.get("teamId")).toBe("team_x");
    expect(seen[0].authorization).toBe("Bearer t0ken");
    if (result.ok) expect(result.usage.lines.length).toBe(3);
  });

  it("asks without a team when none is set (a personal account)", async () => {
    let asked = "";
    await readVercelUsage({ VERCEL_API_TOKEN: "t", VERCEL_TEAM_ID: undefined }, new Date("2026-10-16T12:00:00.000Z"), async (input) => {
      asked = String(input);
      return new Response("", { status: 200 });
    });
    expect(new URL(asked).searchParams.has("teamId")).toBe(false);
  });

  it("is unconfigured without a token and never calls out", async () => {
    let called = false;
    const result = await readVercelUsage({ VERCEL_API_TOKEN: undefined, VERCEL_TEAM_ID: "team_x" }, PERIOD_END, () => {
      called = true;
      throw new Error("must not be called");
    });
    expect(result).toEqual({ ok: false, reason: "unconfigured" });
    expect(called).toBe(false);
  });

  it("says why when Vercel refuses the token or does not answer — a reason, never a figure", async () => {
    const refused = await readVercelUsage({ VERCEL_API_TOKEN: "t", VERCEL_TEAM_ID: "team_x" }, PERIOD_END, async () => new Response("{}", { status: 403 }));
    expect(refused).toEqual({ ok: false, reason: "HTTP 403" });
    const down = await readVercelUsage({ VERCEL_API_TOKEN: "t", VERCEL_TEAM_ID: "team_x" }, PERIOD_END, async () => {
      throw new TypeError("fetch failed");
    });
    expect(down).toEqual({ ok: false, reason: "TypeError" });
  });
});

describe("builds this month, by the branch that caused them", () => {
  const minute = 60_000;
  const NOW = new Date("2026-10-16T10:00:00.000Z");
  const day = Date.UTC(2026, 9, 5, 8);
  const deployment = (uid: string, branch: string | undefined, built: boolean) => ({
    uid,
    createdAt: day,
    ...(built ? { buildingAt: day + 5_000, ready: day + 5_000 + 3 * minute } : {}),
    readyState: built ? "READY" : "CANCELED",
    ...(branch ? { meta: { githubCommitRef: branch } } : {}),
  });

  it("counts the deployments that reached the build, by branch, most first; a cancelled one costs nothing", async () => {
    const result = await readVercelMonth(
      { VERCEL_API_TOKEN: "t", VERCEL_PROJECT_ID: "prj_1", VERCEL_TEAM_ID: undefined },
      NOW,
      async () =>
        new Response(
          JSON.stringify({
            deployments: [
              deployment("a", "qa", true),
              deployment("b", "qa", true),
              deployment("c", "main", true),
              deployment("d", "feat/x", false),
              deployment("e", undefined, true),
            ],
            pagination: { next: null },
          }),
          { status: 200 },
        ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.month.deployments).toBe(5);
    expect(result.month.builds).toBe(4);
    expect(result.month.buildsByBranch).toEqual([
      { branch: "qa", count: 2 },
      { branch: "?", count: 1 },
      { branch: "main", count: 1 },
    ]);
  });
});
