import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DATES, failuresOf, parseArguments, resolveDate } from "../../../scripts/test-clock.mjs";

/**
 * §NNN — the calendar-proof check (BR-REQ-090-02). On 2026-10-11 at 07:00Z a release's pre-commit
 * hook went red on a test that had passed that morning: its fixture race started at 07:00Z and the
 * link page it reached read the real clock. `yarn test:clock` runs the suite with the clock moved
 * forward so such a test fails before the day; these pin what it moves and what it reports.
 */
describe("BR-REQ-090-02 yarn test:clock — the suite with the real clock moved forward (§NNN)", () => {
  const from = new Date("2026-10-11T07:00:00.000Z");

  it("reads a date as an ISO instant or as days, months or years ahead", () => {
    expect(resolveDate("+3d", from).toISOString()).toBe("2026-10-14T07:00:00.000Z");
    expect(resolveDate("+1m", from).toISOString()).toBe("2026-11-11T07:00:00.000Z");
    expect(resolveDate("+10y", from).toISOString()).toBe("2036-10-11T07:00:00.000Z");
    expect(resolveDate("2031-06-01T00:00:00Z", from).toISOString()).toBe("2031-06-01T00:00:00.000Z");
    expect(() => resolveDate("next week", from)).toThrow(/Not a date/);
  });

  it("runs the three default dates on two workers unless told otherwise", () => {
    expect(parseArguments([])).toEqual({ dates: DEFAULT_DATES, workers: 2, filters: [] });
    expect(DEFAULT_DATES).toEqual(["+1m", "+1y", "+10y"]);
    expect(parseArguments(["--workers", "4", "+1y", "--", "tests/integration/registrations"])).toEqual({
      dates: ["+1y"],
      workers: 4,
      filters: ["tests/integration/registrations"],
    });
    expect(() => parseArguments(["--workers", "two"])).toThrow(/whole number/);
  });

  it("names every failed test, and a file that failed before any test ran", () => {
    const root = process.cwd();
    const report = {
      testResults: [
        { name: `${root}/tests/a.test.ts`, status: "passed", assertionResults: [{ status: "passed", fullName: "fine" }] },
        { name: `${root}/tests/b.test.ts`, status: "failed", assertionResults: [{ status: "failed", fullName: "the link opens" }, { status: "passed", fullName: "x" }] },
        { name: `${root}/tests/c.test.ts`, status: "failed", message: "Hook timed out\nstack", assertionResults: [] },
      ],
    };
    expect(failuresOf(report, root)).toEqual(["tests/b.test.ts › the link opens", "tests/c.test.ts › (the file itself: Hook timed out)"]);
  });
});

describe("§NNN tests/helpers/shifted-clock.ts — the real clock reads the date it is given", () => {
  const RealDate = Date;
  afterEach(() => {
    globalThis.Date = RealDate;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("moves every argument-less read and leaves a written date exactly as written", async () => {
    vi.stubEnv("TEST_CLOCK_AT", "2040-02-29T12:00:00.000Z");
    vi.resetModules();
    await import("../../helpers/shifted-clock");

    expect(new Date().getUTCFullYear()).toBe(2040);
    expect(Date.now() - RealDate.parse("2040-02-29T12:00:00.000Z")).toBeLessThan(60_000);
    expect(String(Date())).toContain("2040");
    expect(new Date("2026-10-11T07:00:00.000Z").toISOString()).toBe("2026-10-11T07:00:00.000Z");
    expect(new Date(0).getTime()).toBe(0);
    expect(new Date() instanceof RealDate).toBe(true);
    expect(Date.UTC(2030, 0, 1)).toBe(RealDate.UTC(2030, 0, 1));
  });

  it("refuses a value that is not a date rather than running the suite on today", async () => {
    vi.stubEnv("TEST_CLOCK_AT", "someday");
    vi.resetModules();
    await expect(import("../../helpers/shifted-clock")).rejects.toThrow(/not a date/);
  });
});
