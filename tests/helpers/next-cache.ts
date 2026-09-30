/**
 * Next's data cache, in memory, for the tests of §334 — the jobs that answer "nothing due" from
 * `unstable_cache` without waking PostgreSQL.
 *
 * Outside a Next request the real `unstable_cache` has no incremental cache to use and throws,
 * which the code reads as "nothing cached" — correct, and useless for proving that a ping skips.
 * This keeps the two properties the design rests on and nothing more: an entry is keyed by its
 * key parts (and arguments), a miss runs the function and stores what it returns while a throw
 * stores nothing, and `revalidateTag` removes every entry carrying the tag.
 *
 * Removing, rather than marking, keeps Next's one rule about time too: an entry is expired only by
 * an expiry made after it was *stored* (`areTagsExpired`: `expiredAt > lastModified`, the moment of
 * the `set`). A miss whose store is held (`holdStore`) is a render that read its rows before a
 * write and is stored after the write's expiry, as on a real server (§NNN).
 *
 * One instance per test file, shared with the module under test through `vi.mock`:
 *
 *   vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
 */
type Entry = { value: string | undefined; tags: readonly string[] };

/** A miss whose store waits: `loaded` once its function has answered, stored once the gate opens. */
type Hold = { matches: (keyParts: readonly string[]) => boolean; loaded: () => void; gate: Promise<void> };

function createFakeNextCache() {
  const entries = new Map<string, Entry>();
  const invalidated: string[] = [];
  const counts = { reads: 0, writes: 0 };
  const holds: Hold[] = [];

  const exports = {
    unstable_cache<A extends unknown[], R>(
      callback: (...args: A) => Promise<R>,
      keyParts: readonly string[] = [],
      options: { tags?: readonly string[]; revalidate?: number | false } = {},
    ) {
      return async (...args: A): Promise<R> => {
        counts.reads += 1;
        const key = JSON.stringify([keyParts, args]);
        const hit = entries.get(key);
        // A stored `undefined` ("no such row") is a hit that answers `undefined`, as Next's own
        // `unstable_cache` answers it (`body !== undefined ? JSON.parse(body) : undefined`).
        if (hit) return (hit.value === undefined ? undefined : JSON.parse(hit.value)) as R;
        const result = await callback(...args);
        const held = holds.findIndex((hold) => hold.matches(keyParts));
        if (held >= 0) {
          const [hold] = holds.splice(held, 1);
          hold.loaded();
          await hold.gate;
        }
        counts.writes += 1;
        entries.set(key, { value: JSON.stringify(result), tags: options.tags ?? [] });
        return result;
      };
    },
    /** The profile (`{ expire: 0 }`) is accepted and ignored: an entry here is either there or gone. */
    revalidateTag(tag: string): void {
      invalidated.push(tag);
      for (const [key, entry] of entries) if (entry.tags.includes(tag)) entries.delete(key);
    },
    revalidatePath(): void {},
    updateTag(tag: string): void {
      exports.revalidateTag(tag);
    },
  };

  return {
    /** What `vi.mock("next/cache", …)` hands the code under test. */
    module: exports,
    entries,
    invalidated,
    counts,
    /**
     * Hold the store of the next miss whose key parts `matches`: `loaded` resolves once its function
     * has read its rows, and the entry is stored only after `release()` — a render in flight.
     */
    holdStore(matches: (keyParts: readonly string[]) => boolean): { loaded: Promise<void>; release: () => void } {
      let loaded = () => {};
      let release = () => {};
      const reached = new Promise<void>((resolve) => (loaded = resolve));
      const gate = new Promise<void>((resolve) => (release = resolve));
      holds.push({ matches, loaded, gate });
      return { loaded: reached, release };
    },
    reset(): void {
      holds.length = 0;
      entries.clear();
      invalidated.length = 0;
      counts.reads = 0;
      counts.writes = 0;
    },
  };
}

export const fakeNextCache = createFakeNextCache();
