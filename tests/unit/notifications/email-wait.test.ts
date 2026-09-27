import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §513 — under the scheduled default the outbox job is the only sender, so the wait a page promises
 * and the tick `/api/health` and «Următoarele emailuri automate» (§383) name come from one formula:
 * the longest of the pinger's cadence at this hour, the Administrator's minimum interval (§334) and
 * the budget governor's floor (§447). Under `immediate` there is no wait to promise.
 */
const state = vi.hoisted(() => ({
  timing: "scheduled" as "scheduled" | "immediate",
  interval: 0,
  level: "green" as "unknown" | "green" | "amber" | "red",
  failing: false,
}));

vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/notifications/delivery-timing", () => ({
  readDeliveryTiming: async () => {
    if (state.failing) throw new Error("the database is away");
    return { timing: state.timing, updatedAt: null };
  },
}));
vi.mock("@/modules/jobs/cadence", () => ({ readJobCadence: async () => ({ minutes: state.interval, updatedAt: null }) }));
vi.mock("@/modules/diagnostics/neon-budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/diagnostics/neon-budget")>()),
  peekNeonBudgetLevel: () => state.level,
}));

const { emailWaitMinutes, nextOutboxTick } = await import("@/modules/notifications/domain/email-wait");
const { cachedEmailWaitMinutes } = await import("@/modules/public-cache/reads");

// 10:00 and 02:00 in Brașov (UTC+3 in October): day and quiet hours (`jobs/quiet-hours.ts`).
const DAY = new Date("2026-10-01T07:00:00.000Z");
const NIGHT = new Date("2026-10-01T23:00:00.000Z");

beforeEach(() => {
  state.timing = "scheduled";
  state.interval = 0;
  state.level = "green";
  state.failing = false;
});

describe("§513 emailWaitMinutes — the longest hold on the outbox job", () => {
  it("is null when the request itself sends", () => {
    expect(emailWaitMinutes({ timing: "immediate", pingerMinutes: 15, intervalMinutes: 120, governorFloorMinutes: 120 })).toBeNull();
  });

  it("is the pinger's cadence, unless the interval or the governor's floor is longer", () => {
    expect(emailWaitMinutes({ timing: "scheduled", pingerMinutes: 15, intervalMinutes: 0, governorFloorMinutes: 0 })).toBe(15);
    expect(emailWaitMinutes({ timing: "scheduled", pingerMinutes: 15, intervalMinutes: 60, governorFloorMinutes: 0 })).toBe(60);
    expect(emailWaitMinutes({ timing: "scheduled", pingerMinutes: 60, intervalMinutes: 30, governorFloorMinutes: 120 })).toBe(120);
  });
});

describe("§513 nextOutboxTick — the pinger call the outbox job is next expected at", () => {
  it("is the next quarter-hour by day, the next top of the hour at night", () => {
    expect(nextOutboxTick({ now: new Date("2026-10-01T07:04:00.000Z"), pingerMinutes: 15, intervalMinutes: 0, lastRunAt: null }).toISOString()).toBe(
      "2026-10-01T07:15:00.000Z",
    );
    expect(nextOutboxTick({ now: new Date("2026-10-01T23:04:00.000Z"), pingerMinutes: 60, intervalMinutes: 0, lastRunAt: null }).toISOString()).toBe(
      "2026-10-02T00:00:00.000Z",
    );
  });

  it("waits out a minimum interval measured from the last real run", () => {
    // A run at 10:00 club time with a sixty-minute interval: nothing before 11:00, whatever the pinger does.
    const tick = nextOutboxTick({
      now: new Date("2026-10-01T07:04:00.000Z"),
      pingerMinutes: 15,
      intervalMinutes: 60,
      lastRunAt: new Date("2026-10-01T07:00:30.000Z"),
    });
    expect(tick.toISOString()).toBe("2026-10-01T08:00:00.000Z");
  });

  it("is the next call when the interval has already run out", () => {
    const tick = nextOutboxTick({
      now: new Date("2026-10-01T09:04:00.000Z"),
      pingerMinutes: 15,
      intervalMinutes: 60,
      lastRunAt: new Date("2026-10-01T07:00:30.000Z"),
    });
    expect(tick.toISOString()).toBe("2026-10-01T09:15:00.000Z");
  });
});

describe("§513 cachedEmailWaitMinutes — what the public pages promise", () => {
  it("says the pinger's fifteen minutes by day and its hour at night", async () => {
    expect(await cachedEmailWaitMinutes(DAY)).toBe(15);
    expect(await cachedEmailWaitMinutes(NIGHT)).toBe(60);
  });

  it("says nothing when the club sends right after the request", async () => {
    state.timing = "immediate";
    expect(await cachedEmailWaitMinutes(DAY)).toBeNull();
    expect(await cachedEmailWaitMinutes(NIGHT)).toBeNull();
  });

  it("says the Administrator's minimum interval when it is longer than the pinger's", async () => {
    state.interval = 60;
    expect(await cachedEmailWaitMinutes(DAY)).toBe(60);
    state.interval = 120;
    expect(await cachedEmailWaitMinutes(NIGHT)).toBe(120);
  });

  it("says the budget governor's floor while the month runs ahead", async () => {
    state.level = "amber";
    expect(await cachedEmailWaitMinutes(DAY)).toBe(60);
    state.level = "red";
    expect(await cachedEmailWaitMinutes(DAY)).toBe(120);
  });

  it("falls back to this environment's default timing when the database cannot answer", async () => {
    state.failing = true;
    // Vitest runs under APP_ENV=test, whose default is immediate: no wait promised, the page still renders.
    expect(await cachedEmailWaitMinutes(DAY)).toBeNull();
  });
});
