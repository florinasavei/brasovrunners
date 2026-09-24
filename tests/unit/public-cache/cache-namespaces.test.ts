import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §NNN — three branches of one batch put Next's data cache to work, and they must not step on
 * each other:
 *
 * - the public pages' rows (`public-cache/`, public pages from cache): `unstable_cache` keyed
 *   under the deployment's keyspace, tagged `public:<kind>`;
 * - the jobs' write-once slots (`jobs/schedule-cache.ts`, jobs sleep when nothing is due):
 *   `unstable_cache` keyed under `br-jobs`, tagged `br-jobs…`;
 * - `/api/health`'s reading of the Neon quota (`diagnostics/neon.ts`, Neon limits): `fetch`'s own
 *   cache with `next.revalidate`, no tag at all.
 *
 * `unstable_cache` keys an entry on its function's text plus the key parts, and a tag expires
 * every entry filed under it whoever wrote it — so the two things that could collide are a key
 * and a tag. These pin that neither can: the key's first part names the owner, the tags are
 * disjoint, and each module's expiry names only its own tags.
 */
const cacheState = vi.hoisted(() => ({
  calls: [] as Array<{ keyParts: string[]; tags: string[] }>,
}));

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: () => Promise<unknown>, keyParts: string[], options: { tags?: string[] }) => {
    cacheState.calls.push({ keyParts, tags: options.tags ?? [] });
    return async () => fn();
  }),
  revalidateTag: vi.fn(),
}));

const { revalidateTag } = await import("next/cache");
const { publicRead, publicTag, revalidatePublicContent } = await import("@/modules/public-cache/cache");
const { forgetJobSchedules, readPingVerdict, recordPing, wakeJobs } = await import("@/modules/jobs/schedule-cache");
const { checkNeonQuotaHealth } = await import("@/modules/diagnostics/neon");

const NOW = new Date("2026-09-24T10:02:00.000Z");
const PUBLIC_KINDS = ["events", "places", "pages", "gallery", "legal", "settings"] as const;

beforeEach(() => {
  cacheState.calls.length = 0;
  vi.mocked(revalidateTag).mockReset();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("§NNN the data cache's three tenants", () => {
  it("file their entries under keys that name their owner first", async () => {
    await publicRead(["events.upcoming", "ro", "after-last"], ["events"], async () => []);
    await recordPing("email-outbox", NOW, false);
    await readPingVerdict("registration-maintenance", NOW);

    const publicKeys = cacheState.calls.filter((call) => call.tags.some((tag) => tag.startsWith("public:")));
    const jobKeys = cacheState.calls.filter((call) => call.keyParts[0] === "br-jobs");
    expect(publicKeys).toHaveLength(1);
    expect(jobKeys.length).toBeGreaterThanOrEqual(2);
    expect(publicKeys.length + jobKeys.length).toBe(cacheState.calls.length);

    // The public cache's first key part is its keyspace — a deployment or a process — never a word
    // a job slot could start with; a job slot's first part is always `br-jobs`.
    expect(publicKeys[0].keyParts[0]).toMatch(/^(deployment|process):/);
    for (const call of jobKeys) expect(call.keyParts[0]).toBe("br-jobs");
  });

  it("use disjoint tags", async () => {
    await publicRead(["x"], [...PUBLIC_KINDS], async () => 1);
    await recordPing("email-outbox", NOW, true);
    await readPingVerdict("registration-maintenance", NOW);

    const publicTags = new Set(cacheState.calls.filter((call) => call.keyParts[0] !== "br-jobs").flatMap((call) => call.tags));
    const jobTags = new Set(cacheState.calls.filter((call) => call.keyParts[0] === "br-jobs").flatMap((call) => call.tags));
    expect([...publicTags].sort()).toEqual(PUBLIC_KINDS.map(publicTag).sort());
    for (const tag of jobTags) {
      expect(tag.startsWith("br-jobs")).toBe(true);
      expect(publicTags.has(tag)).toBe(false);
    }
  });

  it("expire only their own: a public write never forgets a job's quiet, and a wake never expires a page", () => {
    revalidatePublicContent(...PUBLIC_KINDS);
    const publicExpiries = vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);
    vi.mocked(revalidateTag).mockReset();

    wakeJobs(["registration-maintenance", "email-outbox"]);
    forgetJobSchedules();
    const jobExpiries = vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);

    expect(publicExpiries.every((tag) => tag.startsWith("public:"))).toBe(true);
    expect(jobExpiries.length).toBeGreaterThan(0);
    expect(jobExpiries.every((tag) => tag.startsWith("br-jobs"))).toBe(true);
  });

  it("leave the Neon quota to fetch's own cache — no key and no tag the other two could share", async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit & { next?: { revalidate?: number; tags?: string[] } }) => Promise<Response>>(
      async () => Response.json({ project: { compute_time_seconds: 3600, settings: { quota: { compute_time_seconds: 360000 } } } }),
    );

    await checkNeonQuotaHealth({ NEON_API_KEY: "key", NEON_PROJECT_ID: "project" }, fetchImpl as unknown as typeof fetch);

    expect(cacheState.calls).toHaveLength(0);
    const init = fetchImpl.mock.calls[0][1];
    expect(init?.next?.revalidate).toBe(900);
    expect(init?.next?.tags).toBeUndefined();
  });
});
