import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type UnstableCache = (fn: () => Promise<unknown>, keyParts?: string[], options?: { revalidate?: number }) => () => Promise<unknown>;
const unstableCache = vi.fn<UnstableCache>((fn) => fn);
vi.mock("next/cache", () => ({ unstable_cache: (...args: Parameters<typeof unstableCache>) => unstableCache(...args) }));
/** The store Next's own `headers()` asks: what kind of render this call is part of. */
const workUnit = vi.hoisted(() => ({ store: undefined as undefined | { type: string }, throws: false }));
vi.mock("next/dist/server/app-render/work-unit-async-storage.external", () => ({
  workUnitAsyncStorage: {
    getStore: () => {
      if (workUnit.throws) throw new Error("no such store");
      return workUnit.store;
    },
  },
}));

const { DEGRADED_PAGE_SECONDS, holdPageFor, holdPageUntil, PUBLIC_PAGE_CEILING_SECONDS, renderKind, secondsUntilFirst } = await import("@/modules/public-cache/page-lifetime");

/**
 * §549 (amending §333) — a static public page is kept until the first instant it would read
 * differently, and never longer than a day. The lifetime is asked of Next through one tiny cached
 * entry, whose `revalidate` a prerender takes as the page's own.
 */
const NOW = new Date("2026-11-20T10:00:00.000Z");
const at = (iso: string) => new Date(iso);

afterEach(() => {
  vi.unstubAllEnvs();
  unstableCache.mockClear();
  workUnit.store = undefined;
  workUnit.throws = false;
});

describe("secondsUntilFirst", () => {
  it("is the seconds to the first instant still ahead, rounded up", () => {
    expect(secondsUntilFirst([at("2026-11-20T12:00:00.000Z"), at("2026-11-20T10:00:30.200Z")], NOW)).toBe(31);
  });

  it("ignores what is behind, exactly now, missing or invalid", () => {
    expect(secondsUntilFirst([at("2026-11-19T10:00:00.000Z"), NOW, null, undefined, new Date(Number.NaN), at("2026-11-20T11:00:00.000Z")], NOW)).toBe(3600);
  });

  it("is the ceiling — a day — when nothing is ahead, or the first instant is further", () => {
    expect(secondsUntilFirst([], NOW)).toBe(PUBLIC_PAGE_CEILING_SECONDS);
    expect(secondsUntilFirst([at("2026-12-20T10:00:00.000Z")], NOW)).toBe(PUBLIC_PAGE_CEILING_SECONDS);
    expect(PUBLIC_PAGE_CEILING_SECONDS).toBe(86_400);
  });

  it("is at least a second, so a page made a moment before its instant is made again just after it", () => {
    expect(secondsUntilFirst([at("2026-11-20T10:00:00.001Z")], NOW)).toBe(1);
  });
});

describe("holdPageUntil / holdPageFor", () => {
  const inProductionServer = () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "");
  };

  it("does nothing outside a production Next server — a test, a script, next dev", async () => {
    await holdPageUntil([at("2026-11-20T10:05:00.000Z")], NOW);
    expect(unstableCache).not.toHaveBeenCalled();
  });

  it("does nothing during next build, which prerenders no public page", async () => {
    inProductionServer();
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await holdPageFor(60);
    expect(unstableCache).not.toHaveBeenCalled();
  });

  it("asks Next for the lifetime as one cached entry's revalidate", async () => {
    inProductionServer();
    await holdPageUntil([at("2026-11-20T10:05:00.000Z")], NOW);
    expect(unstableCache).toHaveBeenCalledTimes(1);
    expect(unstableCache.mock.calls[0][1]).toEqual(["page-lifetime"]);
    expect(unstableCache.mock.calls[0][2]).toEqual({ revalidate: 300 });
  });

  it("asks nothing when the first instant is a day or more away: the segment's own ceiling holds", async () => {
    inProductionServer();
    await holdPageUntil([at("2026-11-22T10:00:00.000Z")], NOW);
    expect(unstableCache).not.toHaveBeenCalled();
  });

  it("keeps a degraded page a minute", async () => {
    inProductionServer();
    await holdPageFor(DEGRADED_PAGE_SECONDS);
    expect(unstableCache.mock.calls[0][2]).toEqual({ revalidate: 60 });
  });

  it("never throws: a lifetime is not worth a page", async () => {
    inProductionServer();
    unstableCache.mockImplementationOnce(() => () => Promise.reject(new Error("no incremental cache")));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(holdPageFor(120)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("§549 a hold is asked only where the page may be kept", () => {
  const inProductionServer = () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "");
  };

  it("asks for it in a static page's render (ISR's prerender-legacy)", async () => {
    inProductionServer();
    workUnit.store = { type: "prerender-legacy" };
    expect(renderKind()).toBe("kept");
    await holdPageFor(DEGRADED_PAGE_SECONDS);
    expect(unstableCache).toHaveBeenCalledTimes(1);
  });

  it("skips the Data Cache round trip in a render answered per request — a live twin, a form, a token page", async () => {
    inProductionServer();
    workUnit.store = { type: "request" };
    expect(renderKind()).toBe("request");
    await holdPageUntil([at("2026-11-20T10:05:00.000Z")], NOW);
    await holdPageFor(DEGRADED_PAGE_SECONDS);
    expect(unstableCache).not.toHaveBeenCalled();
  });

  it("still asks when it cannot tell — no store, a cached function's scope, a Next that answers differently", async () => {
    inProductionServer();
    for (const store of [undefined, { type: "unstable-cache" }, { type: "some-new-kind" }]) {
      workUnit.store = store;
      expect(renderKind()).toBe("unknown");
      await holdPageFor(120);
    }
    workUnit.throws = true;
    expect(renderKind()).toBe("unknown");
    await holdPageFor(120);
    expect(unstableCache).toHaveBeenCalledTimes(4);
  });

  /*
    `renderKind` reads a store Next does not document. These hold it to the installed Next: an
    upgrade that renames either type fails here, not silently in production (where the fallback is
    today's behaviour anyway: every hold asked, no header read).
  */
  it("reads the two store types the installed Next declares, and the one unstable_cache lowers a page's revalidate in", () => {
    const next = path.resolve(__dirname, "../../../node_modules/next/dist/server");
    const declared = readFileSync(path.join(next, "app-render/work-unit-async-storage.external.d.ts"), "utf8");
    expect(declared).toContain("readonly type: 'request';");
    expect(declared).toContain("readonly type: 'prerender-legacy';");
    const unstableCacheSource = readFileSync(path.join(next, "web/spec-extension/unstable-cache.js"), "utf8");
    expect(unstableCacheSource).toMatch(/case 'prerender-legacy':[\s\S]{0,800}workUnitStore\.revalidate = revalidate;/);
  });
});
