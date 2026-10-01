import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailDelayFacts } from "@/modules/notifications/domain/email-delay";

/**
 * §623 — the email queue as a public page reads it (`cachedEmailDelay`): from the data cache under
 * its own tag, `public:email`, for a minute on a page rendered per request — so a page that waits for
 * an email costs one query a minute at most and none while the entry is warm — and at the day's
 * ceiling, under a key of its own, in a kept (static) render, so the event page is never held to a
 * minute for one line (§549). The outbox's expiry of the tag is `email-delay.test.ts`'s (integration).
 */
const cache = vi.hoisted(() => ({
  calls: [] as Array<{ keyParts: readonly string[]; tags: readonly string[]; revalidate: number | false | undefined }>,
  entries: new Map<string, { value: unknown; tags: readonly string[] }>(),
}));
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: () => Promise<unknown>, keyParts: readonly string[], options: { tags?: readonly string[]; revalidate?: number | false } = {}) =>
    async () => {
      cache.calls.push({ keyParts, tags: options.tags ?? [], revalidate: options.revalidate });
      const key = JSON.stringify(keyParts);
      const hit = cache.entries.get(key);
      if (hit) return hit.value;
      const value = await fn();
      cache.entries.set(key, { value, tags: options.tags ?? [] });
      return value;
    },
  revalidateTag: (tag: string) => {
    for (const [key, entry] of cache.entries) if (entry.tags.includes(tag)) cache.entries.delete(key);
  },
}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));

const read = vi.hoisted(() => ({ count: 0, fail: false, facts: null as unknown }));
vi.mock("@/modules/notifications/public-delay", () => ({
  readEmailDelayFacts: async () => {
    read.count += 1;
    if (read.fail) throw new Error("the database is away");
    return read.facts;
  },
}));
const render = vi.hoisted(() => ({ kind: "request" as "request" | "kept" | "unknown" }));
vi.mock("@/modules/public-cache/page-lifetime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/public-cache/page-lifetime")>()),
  renderKind: () => render.kind,
}));

const { cachedEmailDelay, EMAIL_DELAY_SECONDS } = await import("@/modules/public-cache/reads");
const { PUBLIC_CACHE_CEILING_SECONDS, revalidatePublicContent } = await import("@/modules/public-cache/cache");
const { forgetLastGood } = await import("@/modules/resilience/last-good");

const NOW = new Date("2026-10-01T09:30:00.000Z");
const FACTS: EmailDelayFacts = {
  queued: 12,
  queuedOnMailgun: 12,
  aheadOnMailgun: 12,
  oldestWaitingSince: new Date(NOW.getTime() - 3 * 60_000),
  hourFreesAt: null,
  deferredUntil: null,
  pausedUntil: new Date(NOW.getTime() + 20 * 60_000),
  hourlyAllowance: 100,
  hourlyRemaining: 40,
  paceBinding: false,
};
const delayCalls = () => cache.calls.filter((call) => call.keyParts.some((part) => part.startsWith("email.delay")));

beforeEach(() => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "production");
  cache.calls.length = 0;
  cache.entries.clear();
  forgetLastGood();
  read.count = 0;
  read.fail = false;
  read.facts = FACTS;
  render.kind = "request";
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("§623 cachedEmailDelay", () => {
  it("reads once a minute under its own tag on a page rendered per request, and judges the facts now", async () => {
    expect(EMAIL_DELAY_SECONDS).toBe(60);
    const delay = await cachedEmailDelay(NOW);
    expect(delay).toEqual({ late: true, reason: "paused", queued: 12, oldestWaitMinutes: 3, estimateMinutes: 20 });
    expect(delayCalls()).toEqual([{ keyParts: expect.arrayContaining(["email.delay"]), tags: ["public:email"], revalidate: 60 }]);

    // Warm: no second query.
    await cachedEmailDelay(new Date(NOW.getTime() + 30_000));
    expect(read.count).toBe(1);
  });

  it("is read again once the outbox expires the tag", async () => {
    await cachedEmailDelay(NOW);
    read.facts = { ...FACTS, queued: 0, queuedOnMailgun: 0, oldestWaitingSince: null, pausedUntil: null };
    revalidatePublicContent("email");
    expect(await cachedEmailDelay(NOW)).toMatchObject({ late: false, queued: 0 });
    expect(read.count).toBe(2);
  });

  it("in a kept render reads under a key of its own at the day's ceiling, never holding the page to a minute", async () => {
    for (const kind of ["kept", "unknown"] as const) {
      render.kind = kind;
      cache.calls.length = 0;
      await cachedEmailDelay(NOW);
      expect(delayCalls(), kind).toEqual([{ keyParts: expect.arrayContaining(["email.delay-page"]), tags: ["public:email"], revalidate: PUBLIC_CACHE_CEILING_SECONDS }]);
    }
  });

  it("says nothing — null — when the queue cannot be read, and keeps no copy to serve later", async () => {
    read.fail = true;
    expect(await cachedEmailDelay(NOW)).toBeNull();
  });
});
