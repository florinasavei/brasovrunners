import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BREAKER_FIRST_MS,
  BREAKER_MAX_MS,
  breakerOpen,
  DatabaseRestingError,
  resetBreaker,
  throughBreaker,
} from "@/modules/resilience/breaker";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";

/**
 * §NNN — no storms. Once a public read finds the database away, this instance serves copies for a
 * while instead of meeting a refused connection on every page view; a query that is merely wrong
 * never opens it.
 */
describe("§NNN which errors mean the database is away", () => {
  it("reads the driver's socket codes, PostgreSQL's connection states and Neon's refusals, through Drizzle's wrapping", () => {
    expect(isDatabaseAwayError(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isDatabaseAwayError(Object.assign(new Error("terminating connection"), { code: "57P01" }))).toBe(true);
    expect(isDatabaseAwayError(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isDatabaseAwayError(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isDatabaseAwayError(new Error("Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits."))).toBe(true);
    // Drizzle's own error carries the driver's as its cause.
    expect(isDatabaseAwayError(new Error("Failed query: select …", { cause: Object.assign(new Error("x"), { code: "ETIMEDOUT" }) }))).toBe(true);
    expect(isDatabaseAwayError(new DatabaseRestingError())).toBe(true);
  });

  it("does not read a wrong query, a missing column or a bug as the database being away", () => {
    expect(isDatabaseAwayError(Object.assign(new Error('column "x" does not exist'), { code: "42703" }))).toBe(false);
    expect(isDatabaseAwayError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isDatabaseAwayError("a string")).toBe(false);
    expect(isDatabaseAwayError(null)).toBe(false);
  });

  it("survives an error whose cause points back at itself", () => {
    const looped = new Error("loop") as Error & { cause?: unknown };
    looped.cause = looped;
    expect(isDatabaseAwayError(looped)).toBe(false);
  });
});

describe("§NNN the breaker", () => {
  const away = () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
  let clock = 1_000_000;
  const now = () => clock;

  beforeEach(() => {
    resetBreaker();
    clock = 1_000_000;
  });

  it("opens on the first away failure and skips the database until its time is up", async () => {
    const load = vi.fn(away);
    await expect(throughBreaker(load, now)).rejects.toThrow("ECONNREFUSED");
    expect(breakerOpen(clock)).toBe(true);

    // Every read in the meantime fails at once, without a connection.
    await expect(throughBreaker(load, now)).rejects.toBeInstanceOf(DatabaseRestingError);
    await expect(throughBreaker(load, now)).rejects.toBeInstanceOf(DatabaseRestingError);
    expect(load).toHaveBeenCalledTimes(1);

    // One read asks again when the time is up.
    clock += BREAKER_FIRST_MS;
    await expect(throughBreaker(load, now)).rejects.toThrow("ECONNREFUSED");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("waits twice as long after each retry that fails, up to five minutes", async () => {
    const waits: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await throughBreaker(away, now).catch(() => {});
      let wait = 0;
      while (breakerOpen(clock + wait)) wait += 1_000;
      waits.push(wait);
      clock += wait;
    }
    expect(waits.slice(0, 4)).toEqual([BREAKER_FIRST_MS, 2 * BREAKER_FIRST_MS, 4 * BREAKER_FIRST_MS, 8 * BREAKER_FIRST_MS]);
    expect(Math.max(...waits)).toBe(BREAKER_MAX_MS);
  });

  it("closes on the first read that reaches the database", async () => {
    await throughBreaker(away, now).catch(() => {});
    clock += BREAKER_FIRST_MS;
    expect(await throughBreaker(async () => "rows", now)).toBe("rows");
    expect(breakerOpen(clock)).toBe(false);
    // And the next failure starts from the first wait again.
    await throughBreaker(away, now).catch(() => {});
    expect(breakerOpen(clock + BREAKER_FIRST_MS - 1)).toBe(true);
    expect(breakerOpen(clock + BREAKER_FIRST_MS)).toBe(false);
  });

  it("stays closed for a query that is wrong rather than a database that is away", async () => {
    const wrong = vi.fn(() => Promise.reject(Object.assign(new Error('relation "x" does not exist'), { code: "42P01" })));
    await expect(throughBreaker(wrong, now)).rejects.toThrow("does not exist");
    await expect(throughBreaker(wrong, now)).rejects.toThrow("does not exist");
    expect(wrong).toHaveBeenCalledTimes(2);
    expect(breakerOpen(clock)).toBe(false);
  });
});
