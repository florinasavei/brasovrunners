import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §333 — the public cache: what a public read does inside and outside a Next server, that dates
 * survive the round trip through the data cache, and that a write expires every answer of its
 * kind at once.
 *
 * `next/cache` is replaced by a small in-memory stand-in with the same contract the real one has
 * for this module: JSON in, JSON out, keyed by the key parts, tagged.
 */
const cacheState = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  options: [] as Array<{ keyParts: string[]; tags?: string[]; revalidate?: number | false }>,
}));

const budget = vi.hoisted(() => ({ level: "unknown" as "unknown" | "green" | "amber" | "red" }));
vi.mock("@/modules/diagnostics/neon-budget", () => ({ peekNeonBudgetLevel: () => budget.level }));

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn(
    (fn: () => Promise<unknown>, keyParts: string[], options: { tags?: string[]; revalidate?: number | false }) => {
      cacheState.options.push({ keyParts, ...options });
      return async () => {
        const key = keyParts.join("|");
        const hit = cacheState.entries.get(key);
        if (hit !== undefined) return JSON.parse(hit);
        const result = await fn();
        cacheState.entries.set(key, JSON.stringify(result));
        return result;
      };
    },
  ),
  revalidateTag: vi.fn(),
}));

const { revalidateTag, unstable_cache } = await import("next/cache");
const { publicRead, revalidatePublicContent, PUBLIC_CACHE_CEILING_SECONDS } = await import("@/modules/public-cache/cache");

beforeEach(() => {
  cacheState.entries.clear();
  cacheState.options.length = 0;
  vi.mocked(unstable_cache).mockClear();
  vi.mocked(revalidateTag).mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("§333 publicRead", () => {
  it("reads straight through outside a Next server: a test, a script, a seed", async () => {
    const load = vi.fn(async () => ["row"]);
    expect(await publicRead(["x"], ["events"], load)).toEqual(["row"]);
    expect(await publicRead(["x"], ["events"], load)).toEqual(["row"]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(unstable_cache).not.toHaveBeenCalled();
  });

  it("reads straight through under `next dev`, so an edited query is never answered from old rows", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "development");
    const load = vi.fn(async () => 1);
    await publicRead(["x"], ["events"], load);
    await publicRead(["x"], ["events"], load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(unstable_cache).not.toHaveBeenCalled();
  });

  it("reads straight through while `next build` prerenders, so no static route becomes a regenerated one", async () => {
    // A cached read in a prerender files the page under its tags and its ceiling: `/ro` and `/en`
    // (static redirects) became regenerated pages, and the router's prefetch of them hung.
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const load = vi.fn(async () => []);
    await publicRead(["pages.published", "ro"], ["pages"], load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(unstable_cache).not.toHaveBeenCalled();
  });

  describe("inside a production Next server", () => {
    beforeEach(() => {
      vi.stubEnv("NEXT_RUNTIME", "nodejs");
      vi.stubEnv("NODE_ENV", "production");
    });

    it("asks the database once, and hands back a Date — not a string — on the hit as on the miss", async () => {
      const startsAt = new Date("2026-11-21T08:00:00.000Z");
      const load = vi.fn(async () => [{ slug: "crosul", startsAt, nested: { at: startsAt }, none: null }]);

      const miss = await publicRead(["events.upcoming", "ro", "w1"], ["events"], load);
      const hit = await publicRead(["events.upcoming", "ro", "w1"], ["events"], load);

      expect(load).toHaveBeenCalledTimes(1);
      for (const read of [miss, hit]) {
        expect(read[0].startsAt).toBeInstanceOf(Date);
        expect(read[0].startsAt.getTime()).toBe(startsAt.getTime());
        expect(read[0].nested.at).toBeInstanceOf(Date);
        expect(read[0].none).toBeNull();
      }
    });

    it("keeps an absent answer absent, so a 404 stays a 404", async () => {
      const load = vi.fn(async () => undefined);
      expect(await publicRead(["events.by-slug", "ro", "nope"], ["events"], load)).toBeUndefined();
    });

    it("files the answer under its kinds of content, with the day's ceiling, in this server's keyspace", async () => {
      await publicRead(["places.available", "event-1", "after-last"], ["places", "events"], async () => 3);
      const [call] = cacheState.options;
      expect(call.tags).toEqual(["public:places", "public:events"]);
      expect(call.revalidate).toBe(PUBLIC_CACHE_CEILING_SECONDS);
      expect(PUBLIC_CACHE_CEILING_SECONDS).toBe(86_400);
      // Not on Vercel: one process, one keyspace — a restarted `next start` never reads the
      // previous seed's rows.
      expect(call.keyParts[0]).toMatch(/^process:/);
      expect(call.keyParts.slice(1)).toEqual(["places.available", "event-1", "after-last"]);
    });

    it("stretches the day's ceiling as the month's budget runs ahead (§NNN): twice at amber, four times at red", async () => {
      for (const [level, factor] of [["green", 1], ["amber", 2], ["red", 4]] as const) {
        budget.level = level;
        cacheState.options.length = 0;
        await publicRead(["events.upcoming", level], ["events"], async () => []);
        expect(cacheState.options[0].revalidate).toBe(PUBLIC_CACHE_CEILING_SECONDS * factor);
      }
      budget.level = "unknown";
    });

    it("tells two answers apart by their key alone", async () => {
      await publicRead(["events.upcoming", "ro", "w1"], ["events"], async () => "ro");
      expect(await publicRead(["events.upcoming", "en", "w1"], ["events"], async () => "en")).toBe("en");
      expect(await publicRead(["events.upcoming", "ro", "w2"], ["events"], async () => "later")).toBe("later");
    });

    it("caches no failure: the load's error reaches the caller, and the next read asks again", async () => {
      const load = vi.fn().mockRejectedValueOnce(new Error("neon is asleep")).mockResolvedValueOnce("rows");
      await expect(publicRead(["x"], ["events"], load)).rejects.toThrow("neon is asleep");
      expect(await publicRead(["x"], ["events"], load)).toBe("rows");
    });
  });
});

describe("§333 revalidatePublicContent", () => {
  it("is nothing to do outside a Next server", () => {
    revalidatePublicContent("events");
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("expires each kind once, at once — never 'max', which would serve a cancelled event as on", () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    revalidatePublicContent("events", "places", "events");
    expect(revalidateTag).toHaveBeenCalledTimes(2);
    expect(revalidateTag).toHaveBeenCalledWith("public:events", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("public:places", { expire: 0 });
  });

  it("never fails the write that called it", () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.mocked(revalidateTag).mockImplementation(() => {
      throw new Error("used during render");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => revalidatePublicContent("legal")).not.toThrow();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("§333 the public reads", () => {
  const reads = readFileSync("src/modules/public-cache/reads.ts", "utf8");

  it("give every answer a key of its own — one wrapper serves them all, so the key is all that tells them apart", () => {
    const names = [...reads.matchAll(/publicRead\(\s*\[\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(15);
    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * The point of the whole module: a public page that reads the database itself wakes it for
   * every visitor. These are the files a visitor's request renders; none may reach for the pool.
   */
  it.each([
    "src/shared/ui/SiteHeader.tsx",
    "src/app/[locale]/events/page.tsx",
    "src/app/[locale]/events/[slug]/page.tsx",
    "src/app/[locale]/events/[slug]/opengraph-image.tsx",
    "src/app/[locale]/events/[slug]/share-image/route.ts",
    "src/app/[locale]/events/[slug]/calendar.ics/route.ts",
    "src/app/[locale]/events/calendar.ics/route.ts",
    "src/app/[locale]/calendar/page.tsx",
    "src/app/[locale]/gallery/page.tsx",
    "src/app/[locale]/gallery/[slug]/page.tsx",
    "src/app/[locale]/pages/[slug]/page.tsx",
    "src/app/[locale]/legal/privacy/page.tsx",
    "src/app/[locale]/legal/terms/page.tsx",
    "src/app/[locale]/contact/page.tsx",
    "src/app/sitemap.ts",
    "src/app/api/locale/route.ts",
    "src/modules/events/ui/RegistrationCta.tsx",
    "src/modules/events/ui/StartList.tsx",
    // What the pages' metadata and the sitemap build their canonical and hreflang from (§342
    // canonical and hreflang): written before this cache, and first merged reading the pool.
    "src/modules/legal-documents/public-page.ts",
    "src/modules/seo/alternates.ts",
  ])("%s reads through the public cache, never the database", (file) => {
    // The import, not the name: a comment may explain `getDb()`, but nothing can call it unasked.
    expect(readFileSync(file, "utf8")).not.toMatch(/from "@\/db\/client"/);
  });
});
