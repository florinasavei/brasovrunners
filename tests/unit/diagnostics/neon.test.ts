import { describe, expect, it } from "vitest";
import { readNeonConsumption } from "@/modules/diagnostics/neon";

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

  // §326: the project row names the owning account's plan, which a project-scoped key reads —
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
});
