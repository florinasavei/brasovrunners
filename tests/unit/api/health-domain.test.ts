import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §657 — the deep health says whether the site's name resolves (`domain.host`, `domain.resolves`,
 * `domain.checkedAt`) and whether the maintenance job holds an unreachable window open; the shallow
 * one asks nobody (§577). Reached by another address while the name is gone, the answer is `degraded`
 * (a 503), so a monitor that calls by that address hears it.
 */
const execute = vi.fn();
const probePublicName = vi.fn();
const readUnreachableWindows = vi.fn();

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
vi.mock("@/modules/jobs/unreachable-windows", () => ({ readUnreachableWindows: (...args: unknown[]) => readUnreachableWindows(...args) }));

const healthRoute = await import("@/app/api/health/route");
const deep = () => healthRoute.GET(new Request("http://localhost/api/health?deep=1"));
const shallow = () => healthRoute.GET(new Request("http://localhost/api/health"));
const CHECKED = "2026-10-03T16:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue(undefined);
  probePublicName.mockResolvedValue({ status: "resolves", host: "club.example.com", checkedAt: CHECKED });
  readUnreachableWindows.mockResolvedValue([]);
});

describe("§657 the domain block of /api/health", () => {
  it("says the name resolves and nothing is held, and stays ok", async () => {
    const response = await deep();
    const body = await response.json();
    expect(body.domain).toEqual({
      status: "unknown",
      host: "club.example.com",
      resolves: true,
      checkedAt: CHECKED,
      unreachableSince: null,
      lastUnreachable: null,
    });
    expect(body.status).toBe("ok");
  });

  it("is degraded while the name does not resolve", async () => {
    probePublicName.mockResolvedValue({ status: "unresolved", host: "club.example.com", checkedAt: CHECKED });
    const response = await deep();
    expect(response.status).toBe(503);
    expect((await response.json()).domain.resolves).toBe(false);
  });

  it("is degraded while the job holds a window open, and names the latest one over by its instants alone", async () => {
    readUnreachableWindows.mockResolvedValue([
      { id: "a", source: "dns", startedAt: new Date("2026-10-03T14:00:00.000Z"), endedAt: null, rowsMoved: 4, claimsNotRevived: 1 },
      { id: "b", source: "pings", startedAt: new Date("2026-10-01T07:00:00.000Z"), endedAt: new Date("2026-10-01T09:00:00.000Z"), rowsMoved: 2, claimsNotRevived: 0 },
    ]);
    const response = await deep();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.domain).toMatchObject({
      resolves: true,
      unreachableSince: "2026-10-03T14:00:00.000Z",
      lastUnreachable: { startedAt: "2026-10-01T07:00:00.000Z", endedAt: "2026-10-01T09:00:00.000Z" },
    });
    // A public body: no counts of anybody's registrations.
    expect(JSON.stringify(body.domain)).not.toMatch(/rowsMoved|claimsNotRevived|moved|Revived/);
  });

  it("reads an unknown answer as nothing known, never as a shut door", async () => {
    probePublicName.mockResolvedValue({ status: "unknown", host: "club.example.com", checkedAt: CHECKED });
    const response = await deep();
    expect(response.status).toBe(200);
    expect((await response.json()).domain.resolves).toBeNull();
  });

  it("says nothing was asked where nothing is (a laptop, a test)", async () => {
    probePublicName.mockResolvedValue({ status: "skipped", host: null, checkedAt: CHECKED });
    const body = await (await deep()).json();
    expect(body.domain).toMatchObject({ host: null, resolves: null });
    expect(body.status).toBe("ok");
  });

  it("never asks the name in the shallow answer", async () => {
    await shallow();
    expect(probePublicName).not.toHaveBeenCalled();
    expect(readUnreachableWindows).not.toHaveBeenCalled();
  });
});
