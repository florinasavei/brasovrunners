import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §549, BR-REQ-040-02 — a locale with no published event answers 404 from its static route, and the
 * publish expires that cached 404 through the tags.
 *
 * The static event page is filed under the tags of the reads made while it is prerendered (§333's
 * `public:<kind>`), a 404 included: the read that found no published event is what the page is
 * made from. So what has to hold is that this read — the one that answered "no such event" — sits
 * under the tag the publish expires, and that the next read after the publish is the event. The
 * in-memory cache of `helpers/next-cache.ts` stands in for Next's, so the entry, its tag, its expiry
 * and the fresh read are all observable. `tests/e2e/event-route.spec.ts` asks the same of a
 * production build: an anonymous 404 before the publish, kept by the cache, and the page after it.
 */
let db: TestDatabase;
let close: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/modules/diagnostics/budget-level", () => ({ peekNeonBudgetLevel: () => "unknown", lastKnownBudget: () => null }));
const request = vi.hoisted(() => ({ reads: new Map<string, Promise<unknown>>() }));
vi.mock("@/modules/public-cache/request-memo", () => ({ thisRequestsReads: () => request.reads }));

const { fakeNextCache } = await import("../../helpers/next-cache");
const { cachedPublishedEventBySlug } = await import("@/modules/public-cache/reads");
const { forgetLastGood } = await import("@/modules/resilience/last-good");
const { transitionEvent } = await import("@/modules/content/events/service");

const NOW = new Date("2026-09-04T10:00:00.000Z");

/** A new request for the event page: the request's own memo starts empty, the data cache is kept. */
async function visit(slug: string) {
  request.reads.clear();
  return cachedPublishedEventBySlug("ro", slug);
}

describe("§549 BR-REQ-040-02 the publish expires the cached 404 of the static event page", () => {
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "log").mockImplementation(() => {});
    forgetLastGood();
    fakeNextCache.reset();
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("files the 'no such event' answer under the events' tag, and the publish expires it", async () => {
    const [draft] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-10-11T06:00:00Z"), locationName: "Parcul Tractorul" })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: draft.id, locale: "ro", slug: "crosul", title: "Crosul", excerpt: "Cursa clubului." },
      { eventId: draft.id, locale: "en", slug: "the-cross", title: "The cross", excerpt: "The club's race." },
    ]);

    // A draft: the anonymous visit is a 404, and the answer is cached — a second visit asks nothing.
    expect(await visit("crosul")).toBeUndefined();
    const writes = fakeNextCache.counts.writes;
    expect(await visit("crosul")).toBeUndefined();
    expect(fakeNextCache.counts.writes).toBe(writes);
    const notFoundEntries = [...fakeNextCache.entries.values()].filter((entry) => entry.tags.includes("public:events"));
    expect(notFoundEntries.length).toBeGreaterThan(0);

    const reviewed = await transitionEvent(db, { actor: admin, eventId: draft.id, expectedVersion: draft.version, to: "IN_REVIEW", now: NOW });
    await transitionEvent(db, { actor: admin, eventId: draft.id, expectedVersion: reviewed.version, to: "PUBLISHED", now: NOW });

    // The publish expired the tag, and every entry the 404 was made from with it…
    expect(fakeNextCache.invalidated).toContain("public:events");
    expect([...fakeNextCache.entries.values()].filter((entry) => entry.tags.includes("public:events"))).toEqual([]);
    // …so the next visit is the page, never the cached 404.
    expect(await visit("crosul")).toMatchObject({ slug: "crosul", title: "Crosul" });
  });
});
