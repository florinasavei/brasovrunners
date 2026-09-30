import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

/**
 * §583 — the second expiry a write schedules in its own `after()` reaches the cache, against the
 * installed Next (16.3.4), not a stand-in.
 *
 * Next keeps a request's revalidated tags in one list (`workStore.pendingRevalidatedTags`) and,
 * once the `after()` callbacks are done, executes only the entries that are new to that list,
 * compared by tag and profile (`revalidation-utils.js`, `withExecuteRevalidates` →
 * `diffRevalidationState`). A second `revalidateTag` of a tag already expired in the request, with
 * the same profile, updates the entry already there, and the diff drops it. So the second expiry
 * is written under another profile with the same effect (`{ stale: 0, expire: 0 }`; Next hands the
 * handler only `expire`). This file pins both halves: the trap, and that the profile the code uses
 * gets through it with `expire: 0`. If an upgrade changes the trap's half, the distinct profile is
 * still correct; read `cache.ts#SECOND_EXPIRY` before deleting anything.
 *
 * Next's own modules, loaded as Next loads them (CommonJS from `node_modules`), so the work store
 * `revalidateTag` reads is the one this test enters. Next's server puts `AsyncLocalStorage` on the
 * global before it loads them (`node-environment`); so does this file.
 */
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;
const nodeRequire = createRequire(import.meta.url);
const { SECOND_EXPIRY } = await import("@/modules/public-cache/cache");
const { workAsyncStorage } = nodeRequire("next/dist/server/app-render/work-async-storage.external") as {
  workAsyncStorage: { run<R>(store: unknown, callback: () => R): R };
};
const { withExecuteRevalidates } = nodeRequire("next/dist/server/revalidation-utils") as {
  withExecuteRevalidates<R>(store: unknown, callback: () => Promise<R>): Promise<R>;
};
const { revalidateTag } = nodeRequire("next/dist/server/web/spec-extension/revalidate") as {
  revalidateTag(tag: string, profile: object): void;
};

/** The parts of a request's work store that `revalidateTag` and the after-phase execution read. */
function requestStore() {
  const handed: Array<{ tags: string[]; durations: unknown }> = [];
  const store = {
    route: "/[locale]/admin/events/[id]",
    page: "/[locale]/admin/events/[id]/page",
    cacheLifeProfiles: {},
    pendingRevalidatedTags: undefined as unknown,
    incrementalCache: {
      revalidateTag: vi.fn(async (tags: string[], durations: unknown) => {
        handed.push({ tags, durations });
      }),
    },
  };
  return { store, handed };
}

describe("§583 the second expiry, through Next's own after-phase execution", () => {
  it("drops a second expiry written with the write's own profile — the trap", async () => {
    const { store, handed } = requestStore();
    await workAsyncStorage.run(store, async () => {
      // The write, in the Server Action: queued in the request's list.
      revalidateTag("public:events", { expire: 0 });
      // The `after()` phase: what it adds is executed when its callbacks are done.
      await withExecuteRevalidates(store, async () => {
        revalidateTag("public:events", { expire: 0 });
      });
    });
    expect(handed).toEqual([]);
  });

  it("executes the second expiry written with SECOND_EXPIRY, at once (`expire: 0`)", async () => {
    const { store, handed } = requestStore();
    await workAsyncStorage.run(store, async () => {
      revalidateTag("public:events", { expire: 0 });
      await withExecuteRevalidates(store, async () => {
        revalidateTag("public:events", SECOND_EXPIRY);
      });
    });
    expect(handed).toEqual([{ tags: ["public:events"], durations: { expire: 0 } }]);
  });
});
