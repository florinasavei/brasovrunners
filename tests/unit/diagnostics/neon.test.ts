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
