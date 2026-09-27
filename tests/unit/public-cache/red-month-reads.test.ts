import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §493 — the public reads that go around `publicRead` answer without the database while a red month
 * serves anonymous traffic from the cache alone (§447):
 *
 * - an address whose slug can name no row is "no such page" without a query, where below red the
 *   database is still asked, exactly as before;
 * - the language switch — a redirect, with no copy to show and no resting page to send anybody to —
 *   lands on the other language's listing when the database cannot answer for it, never a 500.
 *
 * The database handle is a trap: any query it is asked fails the test.
 */
const budget = vi.hoisted(() => ({ level: "unknown" as "unknown" | "green" | "amber" | "red" }));
vi.mock("@/modules/diagnostics/neon-budget", () => ({ peekNeonBudgetLevel: () => budget.level }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/server", () => ({ after: () => undefined }));

const database = vi.hoisted(() => ({ asked: 0 }));
vi.mock("@/db/client", () => ({
  getDb: () =>
    new Proxy(
      {},
      {
        get() {
          database.asked += 1;
          throw new Error("the database was asked");
        },
      },
    ),
}));

const switchLands = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/modules/events/locale-switch", () => ({
  resolveLocaleSwitch: async (_db: unknown, from: string) => {
    switchLands.calls.push(from);
    return "/en/resolved";
  },
}));

const { fakeNextCache } = await import("../../helpers/next-cache");
const reads = await import("@/modules/public-cache/reads");
const { forgetMissRefreshes } = await import("@/modules/public-cache/miss-refresh");
const { forgetLastGood } = await import("@/modules/resilience/last-good");

beforeEach(() => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "production");
  fakeNextCache.reset();
  forgetMissRefreshes();
  forgetLastGood();
  database.asked = 0;
  switchLands.calls.length = 0;
  budget.level = "red";
});
afterEach(() => {
  vi.unstubAllEnvs();
  budget.level = "unknown";
});

describe("§493 a red month's reads around the cache", () => {
  it("answers a slug that can name no row as 'no such page' without the database", async () => {
    for (const slug of ["Crosul-De-Toamna", "a--b", "x".repeat(201), "%20"]) {
      expect(await reads.cachedPublishedEventBySlug("ro", slug)).toBeUndefined();
      expect(await reads.cachedPublishedPageBySlug("ro", slug)).toBeUndefined();
      expect(await reads.cachedPublishedAlbumBySlug("ro", slug)).toBeUndefined();
    }
    expect(database.asked).toBe(0);
  });

  it("still asks the database for such a slug below red, as before", async () => {
    budget.level = "green";
    await expect(reads.cachedPublishedEventBySlug("ro", "Crosul-De-Toamna")).rejects.toThrow("the database was asked");
  });

  it("lands the language switch on the other language's listing when a red month's miss has nothing to answer with", async () => {
    const landed = await reads.cachedLocaleSwitch("/ro/evenimente/crosul-de-toamna", "en");
    expect(landed).toMatch(/^\/en\//);
    expect(landed).not.toBe("/en/resolved");
    expect(switchLands.calls).toEqual([]);
  });

  it("lands an odd or overlong switch address there too at red, without resolving it", async () => {
    expect(await reads.cachedLocaleSwitch("/ro/evenimente/Crosul", "en")).toMatch(/^\/en\//);
    expect(await reads.cachedLocaleSwitch(`/ro/evenimente/${"a".repeat(320)}`, "en")).toMatch(/^\/en\//);
    expect(switchLands.calls).toEqual([]);
  });

  it("resolves the switch as ever below red", async () => {
    budget.level = "green";
    expect(await reads.cachedLocaleSwitch("/ro/evenimente/crosul-de-toamna", "en")).toBe("/en/resolved");
    expect(switchLands.calls).toEqual(["/ro/evenimente/crosul-de-toamna"]);
  });
});
