import { afterEach, describe, expect, it, vi } from "vitest";

type UnstableCache = (fn: () => Promise<unknown>, keyParts?: string[], options?: { revalidate?: number }) => () => Promise<unknown>;
const unstableCache = vi.fn<UnstableCache>((fn) => fn);
vi.mock("next/cache", () => ({ unstable_cache: (...args: Parameters<typeof unstableCache>) => unstableCache(...args) }));

const { DEGRADED_PAGE_SECONDS, holdPageFor, holdPageUntil, PUBLIC_PAGE_CEILING_SECONDS, secondsUntilFirst } = await import("@/modules/public-cache/page-lifetime");

/**
 * §NNN (amending §333) — a static public page is kept until the first instant it would read
 * differently, and never longer than a day. The lifetime is asked of Next through one tiny cached
 * entry, whose `revalidate` a prerender takes as the page's own.
 */
const NOW = new Date("2026-11-20T10:00:00.000Z");
const at = (iso: string) => new Date(iso);

afterEach(() => {
  vi.unstubAllEnvs();
  unstableCache.mockClear();
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
