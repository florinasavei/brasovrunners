import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §NNN — the deep health says whether the site's name resolves and whether the maintenance job holds
 * a window open; the shallow one asks nobody (§577). Reached by another address while the name is
 * gone, the answer is `degraded` (a 503), so a monitor that calls by that address hears it.
 */
const execute = vi.fn();
const probePublicName = vi.fn();
const readDoorWindows = vi.fn();

vi.mock("@/db/client", () => ({ getDb: () => ({ execute }) }));
vi.mock("@/db/schema-version", () => ({ EXPECTED_MIGRATION: { tag: null, when: null }, checkSchemaVersion: async () => ({ status: "ok", expected: "0128", applied: "0128" }) }));
vi.mock("@/modules/jobs/health", () => ({ checkJobHealth: async (_db: unknown, jobName: string) => ({ jobName, status: "ok", lastFinishedAt: null, lastPingAt: null }) }));
vi.mock("@/modules/notifications/health", () => ({ checkEmailHealth: async () => ({ status: "ok" }) }));
vi.mock("@/modules/diagnostics/neon", () => ({
  checkNeonQuotaHealth: async () => ({ status: "ok", quotaCuHours: null, usedCuHours: null, percent: null, level: "unknown", lineCuHours: null }),
  QUOTA_NOT_READ: { status: "ok", quotaCuHours: null, usedCuHours: null, percent: null, lineCuHours: null, level: "unknown" },
}));
vi.mock("@/modules/diagnostics/budget-thresholds", () => ({ cachedBudgetThresholds: async () => ({ amberPercent: 60, redPercent: 85 }) }));
vi.mock("@/modules/diagnostics/domain/domain-renewal", () => ({ domainRenewal: () => ({ status: "unknown" }) }));
vi.mock("@/modules/registrations/bot-check-signals", () => ({ countBotCheckSignals: async () => ({}), botCheckSignalLevels: () => null }));
vi.mock("@/modules/resilience/name-probe", () => ({ probePublicName: (...args: unknown[]) => probePublicName(...args) }));
vi.mock("@/modules/jobs/door-shut-windows", () => ({ readDoorWindows: (...args: unknown[]) => readDoorWindows(...args) }));

const healthRoute = await import("@/app/api/health/route");
const deep = () => healthRoute.GET(new Request("http://localhost/api/health?deep=1"));
const shallow = () => healthRoute.GET(new Request("http://localhost/api/health"));

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue(undefined);
  probePublicName.mockResolvedValue({ status: "resolves", checkedAt: "2026-10-03T16:00:00.000Z" });
  readDoorWindows.mockResolvedValue([]);
});

describe("§NNN the door in /api/health", () => {
  it("says the name resolves and nothing is held, and stays ok", async () => {
    const response = await deep();
    const body = await response.json();
    expect(body.door).toEqual({ name: "resolves", shutSince: null, lastWindow: null });
    expect(body.status).toBe("ok");
  });

  it("is degraded while the name does not resolve", async () => {
    probePublicName.mockResolvedValue({ status: "unresolved", checkedAt: "2026-10-03T16:00:00.000Z" });
    const response = await deep();
    expect(response.status).toBe(503);
    expect((await response.json()).door.name).toBe("unresolved");
  });

  it("is degraded while the job holds a window open, and names the latest one over by its instants alone", async () => {
    readDoorWindows.mockResolvedValue([
      { id: "a", startedAt: new Date("2026-10-03T14:00:00.000Z"), endedAt: null, movedCount: 4, outsideCount: 1 },
      { id: "b", startedAt: new Date("2026-10-01T07:00:00.000Z"), endedAt: new Date("2026-10-01T09:00:00.000Z"), movedCount: 2, outsideCount: 0 },
    ]);
    const response = await deep();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.door).toEqual({
      name: "resolves",
      shutSince: "2026-10-03T14:00:00.000Z",
      lastWindow: { startedAt: "2026-10-01T07:00:00.000Z", endedAt: "2026-10-01T09:00:00.000Z" },
    });
    // A public body: no counts of anybody's registrations.
    expect(JSON.stringify(body.door)).not.toContain("moved");
  });

  it("reads an unknown answer as nothing known, never as a shut door", async () => {
    probePublicName.mockResolvedValue({ status: "unknown", checkedAt: "" });
    const response = await deep();
    expect(response.status).toBe(200);
    expect((await response.json()).door.name).toBe("unknown");
  });

  it("never asks the name in the shallow answer", async () => {
    await shallow();
    expect(probePublicName).not.toHaveBeenCalled();
    expect(readDoorWindows).not.toHaveBeenCalled();
  });
});
