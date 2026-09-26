import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §447 — `/api/health` under the month's budget. The level comes with the quota reading; what the
 * route does with it is asserted here, with Next's data cache kept in memory
 * (`helpers/next-cache.ts`) so that "answered from a recent answer" is something a test can see.
 *
 * - The governor's floor reaches both health checks, so the platform's own throttle never reads
 *   as a stalled scheduler (the Administrator's interval has had the same treatment since §334).
 * - At `red`, a call inside the same ten minutes gets the database half the first call got —
 *   one probe, not one per stray caller — and a failure is never kept: the next call asks again.
 * - Below `red`, every call asks, as §98 and §340 require.
 */
const checkSchemaVersion = vi.fn();
const checkJobHealth = vi.fn();
const checkEmailHealth = vi.fn();
const checkNeonQuotaHealth = vi.fn();
const execute = vi.fn();

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/db/client", () => ({ getDb: () => ({ execute }) }));
vi.mock("@/db/schema-version", () => ({ checkSchemaVersion: (...args: unknown[]) => checkSchemaVersion(...args) }));
vi.mock("@/modules/jobs/health", () => ({ checkJobHealth: (...args: unknown[]) => checkJobHealth(...args) }));
vi.mock("@/modules/notifications/health", () => ({ checkEmailHealth: (...args: unknown[]) => checkEmailHealth(...args) }));
vi.mock("@/modules/diagnostics/neon", () => ({
  checkNeonQuotaHealth: (...args: unknown[]) => checkNeonQuotaHealth(...args),
  QUOTA_NOT_READ: { status: "ok", quotaCuHours: null, usedCuHours: null, percent: null, lineCuHours: null, level: "unknown" },
}));
vi.mock("@/modules/diagnostics/budget-thresholds", () => ({ cachedBudgetThresholds: async () => ({ amberPercent: 60, redPercent: 85 }) }));
vi.mock("@/modules/registrations/turnstile", () => ({ probeTurnstileSecret: async () => "not_configured" }));
vi.mock("@/shared/config/build-info", () => ({
  buildInfo: { baseline: "BR-V2.00-2026-09-25", commit: "abc1234", committedAt: "2026-09-26T08:00:00.000Z", id: "build-1" },
}));

const { fakeNextCache } = await import("../../helpers/next-cache");
const { GET } = await import("@/app/api/health/route");

const T0 = new Date("2026-10-20T10:01:00.000Z");
const MINUTE = 60_000;

function answering(level: string, status: "ok" | "near-limit" = "ok"): void {
  checkNeonQuotaHealth.mockResolvedValue({ status, quotaCuHours: 100, usedCuHours: 50, percent: 50, lineCuHours: 30, level });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeNextCache.reset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  execute.mockResolvedValue(undefined);
  checkSchemaVersion.mockResolvedValue({ status: "ok", expected: "0077", applied: "0077" });
  checkJobHealth.mockImplementation(async (_db: unknown, jobName: string) => ({ jobName, status: "ok", lastFinishedAt: T0.toISOString(), lastPingAt: null }));
  checkEmailHealth.mockResolvedValue({ status: "ok" });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("§447 /api/health reads the month's budget", () => {
  it("says the level, and hands the governor's floor to both health checks", async () => {
    answering("amber");
    const response = await GET();
    const body = await response.json();

    // Amber is `ok` with a note: the monitor stays quiet while the platform slows itself down.
    expect(response.status).toBe(200);
    expect(body.neon).toEqual({ status: "ok", percent: 50 });
    expect(body.budget).toMatchObject({ level: "amber", meteredPercent: 50, linePercent: 30 });
    expect(body.budget.note).toMatch(/hourly/);
    // `amber` holds real runs to one an hour: the checks must allow that much, or the platform's
    // own throttle would page the owner.
    expect(checkJobHealth).toHaveBeenCalledWith(expect.anything(), "registration-maintenance", expect.any(Date), 60);
    expect(checkJobHealth).toHaveBeenCalledWith(expect.anything(), "email-outbox", expect.any(Date), 60);
    expect(checkEmailHealth).toHaveBeenCalledWith(expect.anything(), expect.any(Date), 60);
  });

  it("asks the database on every call while the pace fits", async () => {
    answering("green");
    await GET();
    await GET();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(checkSchemaVersion).toHaveBeenCalledTimes(2);
    expect(fakeNextCache.counts.reads).toBe(0);
  });

  it("at `red`, answers a second call in the same ten minutes from the first one's database half", async () => {
    answering("red", "near-limit");
    const first = await (await GET()).json();
    vi.setSystemTime(new Date(T0.getTime() + 4 * MINUTE));
    const second = await (await GET()).json();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(checkSchemaVersion).toHaveBeenCalledTimes(1);
    expect(second.database).toBe("ok");
    expect(second.databaseCheckedAt).toBe(first.databaseCheckedAt);
    // The status is still today's: a red budget degrades, whatever half was reused.
    expect(second.status).toBe("degraded");
    expect(second.checkedAt).not.toBe(first.checkedAt);

    // The next window asks again.
    vi.setSystemTime(new Date(T0.getTime() + 11 * MINUTE));
    const third = await (await GET()).json();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(third.databaseCheckedAt).toBe(third.checkedAt);
  });

  it("never keeps a failure: a database that is down is asked again on the next call, and reads down both times", async () => {
    answering("red", "near-limit");
    execute.mockRejectedValue(new Error("connect ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const first = await GET();
    const second = await GET();

    expect(first.status).toBe(503);
    expect((await first.json()).database).toBe("down");
    expect((await second.json()).database).toBe("down");
    expect(execute).toHaveBeenCalledTimes(2);

    // And the first answer after it comes back is a fresh one, not a kept "down".
    execute.mockResolvedValue(undefined);
    expect((await (await GET()).json()).database).toBe("ok");
  });

  it("says `suspended` when Neon refuses on its quota, even while the governor still reads under 100%", async () => {
    answering("red", "near-limit");
    execute.mockRejectedValue(
      Object.assign(new Error("Failed query: select 1"), {
        cause: new Error("Your project has exceeded the compute time quota. Upgrade your plan to increase limits."),
      }),
    );
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.database).toBe("suspended");
    expect(body.status).toBe("degraded");
    expect(body.jobs).toBeNull();
  });

  it("says `suspended` for any refusal once the quota reads spent, and `down` for an ordinary outage below it", async () => {
    execute.mockRejectedValue(new Error("connect ECONNREFUSED"));
    checkNeonQuotaHealth.mockResolvedValue({ status: "near-limit", quotaCuHours: 100, usedCuHours: 100, percent: 100, lineCuHours: 70, level: "red" });
    expect((await (await GET()).json()).database).toBe("suspended");
    answering("green");
    const down = await (await GET()).json();
    expect(down.database).toBe("down");
    expect(down.status).toBe("down");
  });

  it("probes without the budget when Neon is slow, rather than keeping the monitor waiting", async () => {
    checkNeonQuotaHealth.mockReturnValue(new Promise(() => {}));
    const body = await (await GET()).json();
    expect(body.database).toBe("ok");
    expect(body.neon).toEqual({ status: "ok", percent: null });
    expect(body.budget).toEqual({ level: "unknown", meteredPercent: null, linePercent: null, note: null });
    expect(execute).toHaveBeenCalledTimes(1);
  }, 10_000);
});
