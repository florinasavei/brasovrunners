import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §333 (public pages from cache) — the language switch is cached per *path*, never per query.
 *
 * `resolveLocaleSwitch` ignores the query string (`parseLocalizedPath` drops it and the answer
 * never carries it), so keying the cached answer on the whole `from` made one entry per
 * `?interest=ok`, `?lista=2` or campaign tag on the same event page — a cache anybody could fill
 * with variants of one answer. The key is the path; the database is asked once for all of them.
 */
const cacheState = vi.hoisted(() => ({ entries: new Map<string, string>(), keys: [] as string[][] }));

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: () => Promise<unknown>, keyParts: string[]) => {
    cacheState.keys.push(keyParts);
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

const resolveLocaleSwitch = vi.fn<(db: unknown, from: string, target: string) => Promise<string>>(async () => "/en/events/the-cross");
vi.mock("@/modules/events/locale-switch", () => ({
  resolveLocaleSwitch: (db: unknown, from: string, target: string) => resolveLocaleSwitch(db, from, target),
}));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));

const { cachedLocaleSwitch } = await import("@/modules/public-cache/reads");

beforeEach(() => {
  cacheState.entries.clear();
  cacheState.keys.length = 0;
  resolveLocaleSwitch.mockClear();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("§333 cachedLocaleSwitch", () => {
  it("answers every query variant of one event page from one entry, keyed by the path", async () => {
    const answers: string[] = [];
    for (const from of [
      "/ro/evenimente/crosul",
      "/ro/evenimente/crosul?interest=ok",
      "/ro/evenimente/crosul?lista=2&utm_source=x",
      "/ro/evenimente/crosul?lista=3",
    ]) {
      answers.push(await cachedLocaleSwitch(from, "en"));
    }

    expect(new Set(answers)).toEqual(new Set(["/en/events/the-cross"]));
    for (const keyParts of cacheState.keys) {
      expect(keyParts.join("|")).not.toContain("?");
      expect(keyParts).toContain("/ro/evenimente/crosul");
    }
    // One entry for the path: every later call is a hit, and the database is asked once, with the path.
    expect(new Set(cacheState.keys.map((parts) => parts.join("|"))).size).toBe(1);
    expect(resolveLocaleSwitch).toHaveBeenCalledTimes(1);
    expect(resolveLocaleSwitch.mock.calls[0][1]).toBe("/ro/evenimente/crosul");
  });

  it("keeps the two target languages apart", async () => {
    await cachedLocaleSwitch("/ro/evenimente/crosul?x=1", "en");
    await cachedLocaleSwitch("/ro/evenimente/crosul?x=1", "ro");

    expect(new Set(cacheState.keys.map((parts) => parts.join("|"))).size).toBe(2);
  });

  it("never caches an address without a slug — an email link's path is a secret", async () => {
    await cachedLocaleSwitch("/ro/inscrieri/gestioneaza/abc123secret?x=1", "en");

    expect(cacheState.keys).toHaveLength(0);
    expect(resolveLocaleSwitch).toHaveBeenCalledTimes(1);
  });
});
