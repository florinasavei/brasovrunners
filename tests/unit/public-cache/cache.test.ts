import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §333 — the public cache: what a public read does inside and outside a Next server, that dates
 * survive the round trip through the data cache, and that a write expires every answer of its
 * kind at once.
 *
 * `next/cache` is replaced by a small in-memory stand-in with the same contract the real one has
 * for this module: JSON in, JSON out, keyed as Next keys it — the callback's source text and the
 * key parts (`unstable-cache.js`: `${cb.toString()}-${keyParts}`), so a lookup made with another
 * function than the one that filled the entry misses here as it does in Next — tagged.
 */
const cacheState = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  options: [] as Array<{ keyParts: string[]; tags?: string[]; revalidate?: number | false }>,
}));

const budget = vi.hoisted(() => ({ level: "unknown" as "unknown" | "green" | "amber" | "red" }));
vi.mock("@/modules/diagnostics/budget-level", () => ({ peekNeonBudgetLevel: () => budget.level, lastKnownBudget: () => null }));

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn(
    (fn: () => Promise<unknown>, keyParts: string[], options: { tags?: string[]; revalidate?: number | false }) => {
      cacheState.options.push({ keyParts, ...options });
      return async () => {
        const key = `${fn.toString()}-${keyParts.join(",")}`;
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

/** What `after()` was handed: the work that runs once the response is sent. */
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
/** `after()` outside a request scope throws, as Next's does; a test sets this for one call. */
const afterFails = vi.hoisted(() => ({ now: false }));
vi.mock("next/server", () => ({
  after: (task: () => unknown) => {
    if (afterFails.now) throw new Error("`after` was called outside a request scope.");
    afterTasks.push(task);
  },
}));

const { revalidateTag, unstable_cache } = await import("next/cache");
const { publicRead, revalidatePublicContent, PUBLIC_CACHE_CEILING_SECONDS, SECOND_EXPIRY, SECOND_EXPIRY_DELAY_MS } = await import("@/modules/public-cache/cache");
const { forgetLastGood, readWithLastGood } = await import("@/modules/resilience/last-good");
const { forgetMissRefreshes, pendingMissRefreshes, READ_AFTER_WRITE_MS } = await import("@/modules/public-cache/miss-refresh");
const { ColdMissError } = await import("@/modules/resilience/breaker");

/**
 * Run what `after()` was handed, as Next does once the response is out — on a fake clock, so a
 * write's second expiry (§NNN, three seconds after the response) does not make the test wait.
 */
async function afterTheResponse(): Promise<void> {
  const tasks = afterTasks.splice(0);
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  try {
    for (const task of tasks) {
      const done = Promise.resolve(task());
      await vi.runAllTimersAsync();
      await done;
    }
  } finally {
    vi.useRealTimers();
  }
}

beforeEach(() => {
  afterTasks.length = 0;
  afterFails.now = false;
  forgetLastGood();
  forgetMissRefreshes();
  budget.level = "unknown";
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

    it("stretches the day's ceiling as the month's budget runs ahead (§447): twice at amber, four times at red", async () => {
      for (const [level, factor] of [["green", 1], ["amber", 2], ["red", 4]] as const) {
        budget.level = level;
        cacheState.options.length = 0;
        // At red a miss is not read in the request (below); the entry its background refresh files carries the ceiling all the same.
        await publicRead(["events.upcoming", level], ["events"], async () => []).catch(() => undefined);
        await afterTheResponse();
        expect(cacheState.options.at(-1)?.revalidate).toBe(PUBLIC_CACHE_CEILING_SECONDS * factor);
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

/*
  Finding (4) of the fix round (§447): at red, anonymous traffic is served from the cache only. A
  miss never asks the database in the request — it is answered from the read's last good copy, or
  throws `ColdMissError` for the page to send its reader to the resting page — and the read is
  refreshed in the background at the next allowed moment.
*/
describe("§447 publicRead while the month's budget is red", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
  });

  it("performs zero database reads on a miss, and refreshes it after the response instead", async () => {
    budget.level = "red";
    const load = vi.fn(async () => ["crosul"]);

    await expect(publicRead(["events.upcoming", "ro", "w1"], ["events"], load)).rejects.toBeInstanceOf(ColdMissError);
    expect(load).not.toHaveBeenCalled();

    // Once the response is out, the queued refresh reads it — one wave — and fills the cache.
    await afterTheResponse();
    expect(load).toHaveBeenCalledTimes(1);
    expect(await publicRead(["events.upcoming", "ro", "w1"], ["events"], load)).toEqual(["crosul"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("answers a miss from the read's last good copy, with no database read", async () => {
    const startsAt = new Date("2026-11-21T08:00:00.000Z");
    const load = vi.fn(async () => [{ slug: "crosul", startsAt }]);
    await publicRead(["events.upcoming", "ro", "w1"], ["events"], load);
    // A new deployment's keyspace: the data cache is empty, the copy is not.
    cacheState.entries.clear();

    budget.level = "red";
    const read = await publicRead(["events.upcoming", "ro", "w1"], ["events"], load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(read[0].startsAt).toBeInstanceOf(Date);
    expect(read[0].startsAt.getTime()).toBe(startsAt.getTime());
  });

  it("never answers free places or the start list from a copy: they miss honestly", async () => {
    const load = vi.fn(async () => 3);
    await publicRead(["places.available", "event-1"], ["places", "events"], load);
    cacheState.entries.clear();

    budget.level = "red";
    await expect(publicRead(["places.available", "event-1"], ["places", "events"], load)).rejects.toBeInstanceOf(ColdMissError);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("runs one wave per interval, and a write lets the next one run at once", async () => {
    budget.level = "red";
    const first = vi.fn(async () => 1);
    const second = vi.fn(async () => 2);
    await expect(publicRead(["a"], ["events"], first)).rejects.toThrow();
    await afterTheResponse();
    expect(first).toHaveBeenCalledTimes(1);

    // Inside the interval: queued, not run.
    await expect(publicRead(["b"], ["events"], second)).rejects.toThrow();
    await afterTheResponse();
    expect(second).not.toHaveBeenCalled();
    expect(pendingMissRefreshes()).toBe(1);

    // A write woke the compute already (§493): the next miss is read in the request, and the queued read rides the same wake.
    revalidatePublicContent("events");
    const third = vi.fn(async () => 3);
    expect(await publicRead(["c"], ["events"], third)).toBe(3);
    expect(third).toHaveBeenCalledTimes(1);
    await afterTheResponse();
    expect(second).toHaveBeenCalledTimes(1);
  });

  /*
    §493 — the red month's nits: the organizer's own page after a save, a saved copy that says so,
    and a stale hit that no longer "revalidates" by throwing.
  */
  it("reads a miss in the request for a moment after a write on this instance, then goes back to the cache alone", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-20T10:00:00.000Z"), toFake: ["Date"] });
    try {
      budget.level = "red";
      revalidatePublicContent("events");
      const cancelled = vi.fn(async () => ({ status: "CANCELLED" }));
      // The organizer opens the page they just saved: the database answers, never the copy from before the save.
      expect(await publicRead(["events.by-slug", "ro", "crosul"], ["events"], cancelled)).toEqual({ status: "CANCELLED" });
      expect(cancelled).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date(Date.now() + READ_AFTER_WRITE_MS + 1));
      const later = vi.fn(async () => "rows");
      await expect(publicRead(["events.upcoming", "ro", "w9"], ["events"], later)).rejects.toBeInstanceOf(ColdMissError);
      expect(later).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells the page it shows a saved copy, and from when, when a miss is answered from one", async () => {
    const takenAt = new Date("2026-10-20T08:00:00.000Z");
    vi.useFakeTimers({ now: takenAt, toFake: ["Date"] });
    try {
      await publicRead(["events.by-slug", "ro", "crosul"], ["events"], async () => ({ status: "SCHEDULED" }));
      cacheState.entries.clear();
      vi.setSystemTime(new Date(takenAt.getTime() + 60 * 60_000));
      budget.level = "red";

      const read = await readWithLastGood("event:ro:crosul", () => publicRead(["events.by-slug", "ro", "crosul"], ["events"], async () => ({ status: "CANCELLED" })));
      expect(read.value).toEqual({ status: "SCHEDULED" });
      expect(read.freshness).toBe("saved");
      expect(read.takenAt.getTime()).toBe(takenAt.getTime());

      // Once the background refresh has filed the row, the cache answers: live, and the page says nothing.
      await afterTheResponse();
      const hit = await readWithLastGood("event:ro:crosul", () => publicRead(["events.by-slug", "ro", "crosul"], ["events"], async () => ({ status: "CANCELLED" })));
      expect(hit.value).toEqual({ status: "CANCELLED" });
      expect(hit.freshness).toBe("live");
    } finally {
      vi.useRealTimers();
    }
  });

  it("looks a key up as never stale by age, so a stale hit starts no background revalidation that could only throw", async () => {
    budget.level = "red";
    await expect(publicRead(["events.upcoming", "ro", "w1"], ["events"], async () => [])).rejects.toBeInstanceOf(ColdMissError);
    const [lookup] = cacheState.options;
    expect(lookup.revalidate).toBe(365 * 24 * 60 * 60);
  });

  it("finds at red the entry a read below red filed: one callback on every path, as Next keys by its text (§447)", async () => {
    const load = vi.fn(async () => ({ status: "SCHEDULED" }));
    await publicRead(["events.by-slug", "ro", "crosul"], ["events"], load);
    expect(load).toHaveBeenCalledTimes(1);

    budget.level = "red";
    const read = await readWithLastGood("event:ro:crosul", () => publicRead(["events.by-slug", "ro", "crosul"], ["events"], load));
    expect(read.value).toEqual({ status: "SCHEDULED" });
    // A hit: live, no saved-copy notice, nothing queued, the database not asked.
    expect(read.freshness).toBe("live");
    expect(pendingMissRefreshes()).toBe(0);
    await afterTheResponse();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("finds at red the entry the background refresh filed", async () => {
    budget.level = "red";
    const load = vi.fn(async () => ["crosul"]);
    await expect(publicRead(["events.upcoming", "ro", "w2"], ["events"], load)).rejects.toBeInstanceOf(ColdMissError);
    await afterTheResponse();
    expect(await publicRead(["events.upcoming", "ro", "w2"], ["events"], load)).toEqual(["crosul"]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(new Set(vi.mocked(unstable_cache).mock.calls.map(([fn]) => fn.toString())).size).toBe(1);
  });

  it("reads through as ever below red", async () => {
    budget.level = "amber";
    const load = vi.fn(async () => "rows");
    expect(await publicRead(["x"], ["events"], load)).toBe("rows");
    expect(load).toHaveBeenCalledTimes(1);
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

  it("expires the same kinds once more after the response, three seconds on, for the renders in flight (§NNN)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    revalidatePublicContent("events", "places");
    expect(afterTasks).toHaveLength(1);
    vi.mocked(revalidateTag).mockClear();

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const done = Promise.resolve(afterTasks.splice(0)[0]());
      await vi.advanceTimersByTimeAsync(SECOND_EXPIRY_DELAY_MS - 1);
      expect(revalidateTag).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await done;
    } finally {
      vi.useRealTimers();
    }
    expect(revalidateTag).toHaveBeenCalledTimes(2);
    expect(revalidateTag).toHaveBeenCalledWith("public:events", SECOND_EXPIRY);
    expect(revalidateTag).toHaveBeenCalledWith("public:places", SECOND_EXPIRY);
  });

  it("schedules no second expiry for a kind Next refused the first time, nor outside a request", () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(revalidateTag).mockImplementation(() => {
      throw new Error("used during render");
    });
    revalidatePublicContent("events");
    expect(afterTasks).toHaveLength(0);
    logged.mockRestore();

    vi.mocked(revalidateTag).mockReset();
    afterFails.now = true;
    expect(() => revalidatePublicContent("events")).not.toThrow();
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(afterTasks).toHaveLength(0);
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
    "src/app/[locale]/calendar/[...period]/page.tsx",
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
