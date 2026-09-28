import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * §549, a review finding (nit) — the fresh request a stale forecast asks for is a data-cache entry
 * keyed by the hour, which nothing reads after its hour; with an hour's `revalidate` of its own, an
 * entry written late in the hour outlived it, one per place per hour. Its lifetime is now what is
 * left of its hour.
 */
const calls = vi.hoisted(() => ({ entries: [] as { keyParts: string[]; revalidate?: number; args: unknown[] }[] }));

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => Promise<unknown>, keyParts: string[], options?: { revalidate?: number }) =>
    async (...args: unknown[]) => {
      calls.entries.push({ keyParts, revalidate: options?.revalidate, args });
      // The place's hourly entry answers stale (a quiet spell), so the hour's own entry is asked.
      if (!keyParts.includes("hour")) {
        const { stubForecast } = await import("@/modules/weather/source");
        return { ...stubForecast(NOW), fetchedAt: NOW - 3 * HOUR };
      }
      const { stubForecast } = await import("@/modules/weather/source");
      void fn;
      return stubForecast(NOW);
    },
  revalidateTag: () => {},
}));

const HOUR = 60 * 60 * 1000;
// 09:45:00 UTC: a quarter of an hour left.
const NOW = Date.UTC(2026, 8, 24, 9, 45);

const { readForecast, secondsLeftInHour, forecastHour, WEATHER_CACHE_SECONDS } = await import("@/modules/weather/source");

afterEach(() => {
  vi.unstubAllEnvs();
  calls.entries.length = 0;
});

describe("§549 the hour's own forecast entry ends with its hour", () => {
  it("counts what is left of the hour, at least a second, never more than the hour", () => {
    const top = Date.UTC(2026, 8, 24, 9);
    expect(secondsLeftInHour(top)).toBe(WEATHER_CACHE_SECONDS);
    expect(secondsLeftInHour(top + 45 * 60 * 1000)).toBe(15 * 60);
    expect(secondsLeftInHour(top + HOUR - 1)).toBe(1);
    expect(secondsLeftInHour(top + HOUR - 400)).toBe(1);
  });

  it("files the fresh request under the hour, standing only for the rest of it", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "");
    const read = await readForecast({ latitude: 45.643, longitude: 25.589 }, { source: "open-meteo", now: NOW });
    expect(read.ok).toBe(true);
    const hourEntry = calls.entries.find((entry) => entry.keyParts.includes("hour"));
    expect(hourEntry?.revalidate).toBe(15 * 60);
    expect(hourEntry?.args).toEqual([45.643, 25.589, forecastHour(NOW)]);
    // The place's own entry keeps the forecast's hour.
    expect(calls.entries.find((entry) => !entry.keyParts.includes("hour"))?.revalidate).toBe(WEATHER_CACHE_SECONDS);
  });
});
