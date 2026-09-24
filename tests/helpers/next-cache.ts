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
 * One instance per test file, shared with the module under test through `vi.mock`:
 *
 *   vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
 */
type Entry = { value: string; tags: readonly string[] };

function createFakeNextCache() {
  const entries = new Map<string, Entry>();
  const invalidated: string[] = [];
  const counts = { reads: 0, writes: 0 };

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
        if (hit) return JSON.parse(hit.value) as R;
        const result = await callback(...args);
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
    reset(): void {
      entries.clear();
      invalidated.length = 0;
      counts.reads = 0;
      counts.writes = 0;
    },
  };
}

export const fakeNextCache = createFakeNextCache();
