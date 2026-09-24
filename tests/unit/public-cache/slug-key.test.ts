import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §333 (public pages from cache) — a slug from the address names a cache entry only when it could
 * be a real one.
 *
 * The three by-slug reads (event, standing page, album) key their answer on the visitor's slug,
 * and a miss is cached like a hit — "no such event" stands for the day's ceiling. A crawler
 * trying random addresses would otherwise leave one entry per address. A slug of the shape every
 * saved slug has is cached as before; anything longer than 200 characters, or not lowercase words
 * joined by hyphens, is read live and filed nowhere — the same guard `cachedLocaleSwitch` keeps.
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

type BySlug = (db: unknown, locale: string, slug: string) => Promise<null>;
const findPublishedEventBySlug = vi.fn<BySlug>(async () => null);
const findPublishedPageBySlug = vi.fn<BySlug>(async () => null);
const findPublishedAlbumBySlug = vi.fn<BySlug>(async () => null);
vi.mock("@/modules/events/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/events/repository")>()),
  findPublishedEventBySlug: (db: unknown, locale: string, slug: string) => findPublishedEventBySlug(db, locale, slug),
}));
vi.mock("@/modules/content/pages/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/content/pages/repository")>()),
  findPublishedPageBySlug: (db: unknown, locale: string, slug: string) => findPublishedPageBySlug(db, locale, slug),
}));
vi.mock("@/modules/content/gallery/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/content/gallery/repository")>()),
  findPublishedAlbumBySlug: (db: unknown, locale: string, slug: string) => findPublishedAlbumBySlug(db, locale, slug),
}));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));

const { cachedPublishedAlbumBySlug, cachedPublishedEventBySlug, cachedPublishedPageBySlug } = await import(
  "@/modules/public-cache/reads"
);

const READS = [
  { name: "event", read: cachedPublishedEventBySlug, load: findPublishedEventBySlug },
  { name: "standing page", read: cachedPublishedPageBySlug, load: findPublishedPageBySlug },
  { name: "album", read: cachedPublishedAlbumBySlug, load: findPublishedAlbumBySlug },
] as const;

beforeEach(() => {
  cacheState.entries.clear();
  cacheState.keys.length = 0;
  for (const { load } of READS) load.mockClear();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("§333 the by-slug reads", () => {
  for (const { name, read, load } of READS) {
    it(`caches the ${name} under a slug of the saved shape, a miss included`, async () => {
      await read("ro", "crosul-aniversar-2026");
      await read("ro", "crosul-aniversar-2026");

      expect(cacheState.keys).toHaveLength(2);
      expect(cacheState.keys[0]).toContain("crosul-aniversar-2026");
      expect(load).toHaveBeenCalledTimes(1);
    });

    it(`reads the ${name} live, and files nothing, for a slug no row can have`, async () => {
      for (const slug of ["x".repeat(201), "Crosul", "crosul--aniversar", "crosul_aniversar", "cros%C8%99", "-crosul", "wp-admin.php"]) {
        await read("ro", slug);
      }

      expect(cacheState.keys).toHaveLength(0);
      expect(load).toHaveBeenCalledTimes(7);
    });

    it(`still caches the ${name} at the longest slug it allows`, async () => {
      await read("en", "a".repeat(200));

      expect(cacheState.keys).toHaveLength(1);
    });
  }
});
