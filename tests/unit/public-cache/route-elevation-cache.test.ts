import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elevationGpx } from "../../helpers/elevation-gpx";

/**
 * §NNN (amending §333, §718) — `cachedRouteElevation(eventId, gpxKey)`: the route's elevation profile kept by the event and
 * **the GPX's own storage key**, under the `events` tag the event page's other reads are expired with; read from the store
 * and never the database; a file that was read is kept (with or without a profile), a failed read is not — and a page made
 * without its chart for a failed read is kept a minute, not a day, and the store read stays out of the database's breaker.
 */
const cacheState = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  calls: [] as Array<{ keyParts: string[]; tags?: string[] }>,
}));

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: () => Promise<unknown>, keyParts: string[], options: { tags?: string[] }) => {
    cacheState.calls.push({ keyParts, tags: options.tags });
    return async () => {
      const key = keyParts.join("|");
      const hit = cacheState.entries.get(key);
      if (hit !== undefined) return JSON.parse(hit);
      const result = await fn();
      cacheState.entries.set(key, JSON.stringify(result));
      return result;
    };
  }),
  revalidateTag: vi.fn(),
}));

/** The lifetimes the page was asked to be held to (`holdPageFor`, §549): a static page made with a part left out is kept a minute. */
const lifetime = vi.hoisted(() => ({ holds: [] as number[] }));
vi.mock("@/modules/public-cache/page-lifetime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/public-cache/page-lifetime")>()),
  holdPageFor: async (seconds: number) => {
    lifetime.holds.push(seconds);
  },
}));

const store = vi.hoisted(() => ({ get: vi.fn<(key: string) => Promise<Buffer | null>>(), configured: true }));
vi.mock("@/modules/media/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/media/storage")>()),
  // `put` is the last-good snapshot the cache keeps beside every public read (§281).
  getStorage: () => ({ get: store.get, put: async () => undefined }),
  isStorageConfigured: () => store.configured,
}));

/** The database is never asked: a visitor must not wake it for a chart. */
const database = vi.hoisted(() => ({ asked: 0 }));
vi.mock("@/db/client", () => ({
  getDb: () => {
    database.asked += 1;
    return {};
  },
}));

const { cachedRouteElevation } = await import("@/modules/public-cache/reads");
const { publicTag } = await import("@/modules/public-cache/cache");
const { clearElevationCache } = await import("@/modules/routes/elevation/read");
const { breakerOpen, noteReadFailure, resetBreaker } = await import("@/modules/resilience/breaker");
const { DEGRADED_PAGE_SECONDS } = await import("@/modules/public-cache/page-lifetime");

/** What the driver says when no database answers (`isDatabaseAwayError` reads the code). */
const databaseAway = () => Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

const EVENT = "11111111-1111-4111-8111-111111111111";
const OTHER_EVENT = "22222222-2222-4222-8222-222222222222";
const KEY = "test/route-gpx/00000000-0000-4000-8000-000000000001/traseu.gpx";
const NEW_KEY = "test/route-gpx/00000000-0000-4000-8000-000000000002/traseu.gpx";

beforeEach(() => {
  cacheState.entries.clear();
  cacheState.calls.length = 0;
  store.get.mockReset();
  store.get.mockResolvedValue(Buffer.from(elevationGpx()));
  store.configured = true;
  database.asked = 0;
  lifetime.holds.length = 0;
  resetBreaker();
  clearElevationCache();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("§NNN the cached elevation profile", () => {
  it("is keyed by the event and the GPX's storage key, under the tag the event page's reads are expired with", async () => {
    await cachedRouteElevation(EVENT, KEY);
    expect(cacheState.calls).toHaveLength(1);
    expect(cacheState.calls[0].keyParts).toEqual(expect.arrayContaining(["events.elevation", EVENT, KEY]));
    expect(cacheState.calls[0].tags).toEqual([publicTag("events")]);
  });

  it("reads the store once for the same event and file, and answers the next visitor from the cache", async () => {
    const first = await cachedRouteElevation(EVENT, KEY);
    clearElevationCache();
    const second = await cachedRouteElevation(EVENT, KEY);
    expect(first?.points.length).toBeGreaterThan(60);
    expect(second).toEqual(first);
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("is a new entry for a new upload — the key changes — and for another event", async () => {
    await cachedRouteElevation(EVENT, KEY);
    clearElevationCache();
    await cachedRouteElevation(EVENT, NEW_KEY);
    clearElevationCache();
    await cachedRouteElevation(OTHER_EVENT, KEY);
    expect(store.get).toHaveBeenCalledTimes(3);
    expect(new Set(cacheState.calls.map((call) => call.keyParts.join("|"))).size).toBe(3);
  });

  it("never asks the database", async () => {
    await cachedRouteElevation(EVENT, KEY);
    expect(database.asked).toBe(0);
  });

  it("keeps the answer for a file that has no profile: it is the file's fact", async () => {
    store.get.mockResolvedValue(Buffer.from(elevationGpx({ withoutElevation: true })));
    expect(await cachedRouteElevation(EVENT, KEY)).toBeNull();
    clearElevationCache();
    expect(await cachedRouteElevation(EVENT, KEY)).toBeNull();
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failed read: the chart is left out of that view and the next visitor asks the store again", async () => {
    store.get.mockRejectedValueOnce(new Error("the store is away"));
    expect(await cachedRouteElevation(EVENT, KEY)).toBeNull();
    expect(await cachedRouteElevation(EVENT, KEY)).not.toBeNull();
    expect(store.get).toHaveBeenCalledTimes(2);
  });

  it("keeps the static page made without its chart to a minute, never the day: a failed read holds the page, a good one does not", async () => {
    await cachedRouteElevation(EVENT, KEY);
    expect(lifetime.holds).toEqual([]);
    store.get.mockRejectedValueOnce(new Error("the store is away"));
    expect(await cachedRouteElevation(EVENT, NEW_KEY)).toBeNull();
    expect(lifetime.holds).toEqual([DEGRADED_PAGE_SECONDS]);
    expect(DEGRADED_PAGE_SECONDS).toBe(60);
  });

  it("holds the page for a missing object too, and not for a file that has no profile (that is the file's fact, kept)", async () => {
    store.get.mockResolvedValueOnce(null);
    expect(await cachedRouteElevation(EVENT, KEY)).toBeNull();
    expect(lifetime.holds).toEqual([DEGRADED_PAGE_SECONDS]);
    lifetime.holds.length = 0;
    store.get.mockResolvedValue(Buffer.from(elevationGpx({ withoutElevation: true })));
    expect(await cachedRouteElevation(EVENT, NEW_KEY)).toBeNull();
    expect(lifetime.holds).toEqual([]);
  });

  it("asks the store while the database's breaker is open, and a store read does not close or reset it", async () => {
    noteReadFailure(databaseAway());
    expect(breakerOpen()).toBe(true);
    expect(await cachedRouteElevation(EVENT, KEY)).not.toBeNull();
    expect(store.get).toHaveBeenCalledTimes(1);
    // The database is still away: a successful read of the store is no news about it.
    expect(breakerOpen()).toBe(true);
    expect(lifetime.holds).toEqual([]);
  });

  it("does not let a store failure with a network error under it open the database's breaker", async () => {
    store.get.mockRejectedValueOnce(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
    expect(await cachedRouteElevation(EVENT, KEY)).toBeNull();
    expect(breakerOpen()).toBe(false);
    expect(lifetime.holds).toEqual([DEGRADED_PAGE_SECONDS]);
  });

  it("does not keep a missing object either", async () => {
    store.get.mockResolvedValueOnce(null);
    expect(await cachedRouteElevation(EVENT, KEY)).toBeNull();
    expect(await cachedRouteElevation(EVENT, KEY)).not.toBeNull();
    expect(store.get).toHaveBeenCalledTimes(2);
  });

  it("is null, and asks nothing, where the site has no store", async () => {
    store.configured = false;
    expect(await cachedRouteElevation(EVENT, KEY)).toBeNull();
    expect(store.get).not.toHaveBeenCalled();
  });
});
