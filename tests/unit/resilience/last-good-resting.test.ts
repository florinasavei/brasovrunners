import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §NNN — when Neon has suspended the project for the rest of its billing period, a public page
 * serves its last good copy however old (up to a period), and says until when. For any other
 * outage §281's twelve hours still stand, and a query that is merely wrong never asks Neon.
 */
const budget = vi.hoisted(() => ({
  reading: { level: "unknown", effects: { restingCopies: false }, meter: null as null | { periodEnd: Date } },
  calls: 0,
}));

vi.mock("@/shared/config/env", () => ({ env: { APP_ENV: "test", STORAGE_MODE: "fake", APP_BASE_URL: "https://example.test" } }));
vi.mock("@/modules/diagnostics/neon-budget", () => ({
  readNeonBudget: async () => {
    budget.calls += 1;
    return budget.reading;
  },
}));

const { readWithLastGood, forgetLastGood } = await import("@/modules/resilience/last-good");
const { SNAPSHOT_MAX_AGE_HOURS, SNAPSHOT_MAX_AGE_WHILE_RESTING_HOURS } = await import("@/modules/resilience/domain/envelope");

const TAKEN = new Date("2026-10-23T09:00:00.000Z");
const PERIOD_END = new Date("2026-11-01T00:00:00.000Z");
const SUSPENDED = new Error("Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits.");
const hoursLater = (hours: number) => new Date(TAKEN.getTime() + hours * 3_600_000);

beforeEach(() => {
  forgetLastGood();
  budget.calls = 0;
  budget.reading = { level: "unknown", effects: { restingCopies: false }, meter: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("§NNN the last good copy while the database rests for the month", () => {
  it("serves a copy days old, and names the period's end, while Neon has suspended the project", async () => {
    budget.reading = { level: "exhausted", effects: { restingCopies: true }, meter: { periodEnd: PERIOD_END } };
    await readWithLastGood("events:ro", async () => ["Crosul de toamnă"], TAKEN);

    const read = await readWithLastGood<string[]>("events:ro", () => Promise.reject(SUSPENDED), hoursLater(3 * 24));
    expect(read.freshness).toBe("stale");
    expect(read.value).toEqual(["Crosul de toamnă"]);
    expect(read.takenAt).toEqual(TAKEN);
    expect(read.restingUntil).toEqual(PERIOD_END);
  });

  it("still refuses a copy older than a whole period", async () => {
    budget.reading = { level: "exhausted", effects: { restingCopies: true }, meter: { periodEnd: PERIOD_END } };
    await readWithLastGood("events:ro", async () => ["old"], TAKEN);
    await expect(
      readWithLastGood("events:ro", () => Promise.reject(SUSPENDED), hoursLater(SNAPSHOT_MAX_AGE_WHILE_RESTING_HOURS + 1)),
    ).rejects.toThrow(SUSPENDED);
  });

  it("keeps §281's twelve hours for an outage that is not the month's limit, and says no end", async () => {
    await readWithLastGood("events:ro", async () => ["x"], TAKEN);
    const away = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

    const within = await readWithLastGood("events:ro", () => Promise.reject(away), hoursLater(SNAPSHOT_MAX_AGE_HOURS - 1));
    expect(within.restingUntil).toBeNull();
    await expect(readWithLastGood("events:ro", () => Promise.reject(away), hoursLater(SNAPSHOT_MAX_AGE_HOURS + 1))).rejects.toThrow(away);
  });

  it("does not ask Neon about a query that is wrong — only about a database that is away", async () => {
    await readWithLastGood("events:ro", async () => ["x"], TAKEN);
    const wrong = Object.assign(new Error('column "y" does not exist'), { code: "42703" });
    const read = await readWithLastGood("events:ro", () => Promise.reject(wrong), hoursLater(1));
    expect(read.freshness).toBe("stale");
    expect(budget.calls).toBe(0);
  });

  it("is live and not resting while the database answers", async () => {
    budget.reading = { level: "exhausted", effects: { restingCopies: true }, meter: { periodEnd: PERIOD_END } };
    const read = await readWithLastGood("events:ro", async () => ["x"], TAKEN);
    expect(read).toMatchObject({ freshness: "live", restingUntil: null });
    expect(budget.calls).toBe(0);
  });

  /*
    The realistic case (the review of §NNN): a project-scoped key reads the level off the
    operations log, which stops growing once Neon suspends the project — so it may read `critical`
    while every query is refused. The refusal itself is what says the database rests.
  */
  it("rests on Neon's quota refusal while the governor still reads `critical`, until the meter's period end", async () => {
    budget.reading = { level: "critical", effects: { restingCopies: false }, meter: { periodEnd: PERIOD_END } };
    await readWithLastGood("events:ro", async () => ["Crosul de toamnă"], TAKEN);
    const wrapped = Object.assign(new Error("Failed query: select …"), { cause: SUSPENDED });
    const read = await readWithLastGood<string[]>("events:ro", () => Promise.reject(wrapped), hoursLater(3 * 24));
    expect(read).toMatchObject({ freshness: "stale", value: ["Crosul de toamnă"], restingUntil: PERIOD_END });
  });

  it("rests on the quota refusal with no meter at all, until the start of the next month", async () => {
    await readWithLastGood("events:ro", async () => ["x"], TAKEN);
    const read = await readWithLastGood("events:ro", () => Promise.reject(SUSPENDED), hoursLater(2 * 24));
    expect(read.restingUntil).toEqual(new Date("2026-11-01T00:00:00.000Z"));
  });

  it("keeps resting on the skipped reads the breaker answers after a quota refusal", async () => {
    const { throughBreaker, resetBreaker } = await import("@/modules/resilience/breaker");
    resetBreaker();
    await readWithLastGood("events:ro", async () => ["x"], TAKEN);
    const at = hoursLater(20);
    await readWithLastGood("events:ro", () => throughBreaker(() => Promise.reject(SUSPENDED), () => at.getTime()), at);
    // The breaker is open now: the next read never reaches the database, and still rests.
    const skipped = await readWithLastGood("events:ro", () => throughBreaker(() => Promise.resolve(["fresh"]), () => at.getTime() + 1), at);
    expect(skipped).toMatchObject({ freshness: "stale", restingUntil: new Date("2026-11-01T00:00:00.000Z") });
    resetBreaker();
  });
});
