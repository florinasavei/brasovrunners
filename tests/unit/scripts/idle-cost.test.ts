import { describe, expect, it } from "vitest";
import { classifyWake, neonWakes, requestKind, summariseRequests } from "../../../scripts/idle-cost.mjs";

/**
 * §577 — `yarn idle:measure`: what an environment consumed while nobody visited it. The target is
 * zero wakes outside the daily maintenance window (04:00 in Brașov); these hold the arithmetic
 * that says so from Neon's operations log and Vercel's request log.
 */
const op = (action: string, at: string) => ({ action, created_at: at });

describe("§577 reading Neon's operations log", () => {
  it("pairs each start with the suspend after it, and classes the wake by the club's clock", () => {
    const wakes = neonWakes(
      [
        op("suspend_compute", "2026-10-01T01:07:00Z"),
        op("start_compute", "2026-10-01T01:00:40Z"), // 04:00:40 in Brașov: the window
        op("start_compute", "2026-10-01T09:00:45Z"), // 12:00: a monitor's minute
        op("suspend_compute", "2026-10-01T09:06:00Z"),
        op("start_compute", "2026-10-01T10:23:00Z"), // 13:23: somebody
        op("suspend_compute", "2026-10-01T10:28:30Z"),
        op("apply_config", "2026-10-01T10:30:00Z"),
      ],
      Date.parse("2026-10-01T00:00:00Z"),
      Date.parse("2026-10-02T00:00:00Z"),
    );
    expect(wakes.map((wake: { kind: string }) => wake.kind)).toEqual(["window", "pinger", "other"]);
    expect(wakes.map((wake: { minutes: number }) => Math.round(wake.minutes * 10) / 10)).toEqual([6.3, 5.3, 5.5]);
  });

  it("counts a wake still open at the end of the window as awake until then, and leaves out wakes before it", () => {
    const wakes = neonWakes(
      [op("start_compute", "2026-09-30T23:00:00Z"), op("suspend_compute", "2026-09-30T23:06:00Z"), op("start_compute", "2026-10-01T11:58:00Z")],
      Date.parse("2026-10-01T00:00:00Z"),
      Date.parse("2026-10-01T12:00:00Z"),
    );
    expect(wakes).toHaveLength(1);
    expect(wakes[0].minutes).toBe(2);
  });

  it("knows the window on both sides of daylight saving", () => {
    expect(classifyWake(Date.parse("2026-07-01T01:05:00Z"))).toBe("window"); // 04:05 EEST
    expect(classifyWake(Date.parse("2026-12-01T02:05:00Z"))).toBe("window"); // 04:05 EET
    expect(classifyWake(Date.parse("2026-12-01T01:05:00Z"))).toBe("other"); // 03:05 EET
  });
});

describe("§577 reading Vercel's request log", () => {
  it("names each request by what it is, never by its count alone", () => {
    expect(requestKind({ requestPath: "/api/internal/jobs/email-outbox" })).toBe("job ping");
    expect(requestKind({ requestPath: "/api/health" })).toBe("health");
    expect(requestKind({ requestPath: "/api/health?deep=1" })).toBe("health (deep)");
    expect(requestKind({ requestPath: "/wp-admin/install.php" })).toBe("scanner probe");
    expect(requestKind({ requestPath: "/.env" })).toBe("scanner probe");
    expect(requestKind({ requestPath: "/ro/evenimente", source: "serverless-middleware", cache: "HIT" })).toBe("proxy (HIT)");
    expect(requestKind({ requestPath: "/ro/contact", source: "serverless", cache: "MISS" })).toBe("render (MISS)");
  });

  it("counts a row once however often the CLI repeats it", () => {
    const row = { id: "a", requestPath: "/api/health" };
    expect(summariseRequests([row, row, { id: "b", requestPath: "/api/health" }])).toEqual({ total: 2, counts: [["health", 2]] });
  });
});
