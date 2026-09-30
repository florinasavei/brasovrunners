import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN (amending §549), BR-REQ-020-01 — a publish is on the listing and the calendar for the next
 * visitor, even when a render that started before it is stored after it.
 *
 * The race, on a real server: a visitor's render reads the rows, the club's publish commits and
 * expires `public:events`, then the render is stored. Next treats an entry as expired only by an
 * expiry made after it was stored, so the render's copy — without the new event — is fresh
 * (`tags-manifest.external.js#areTagsExpired`), until the next write to any event. The in-memory
 * cache of `helpers/next-cache.ts` keeps the same rule, and `holdStore` is the render in flight:
 * its rows are read, and it is stored only when the test says so, after the publish. The fix is
 * the publish's own second expiry, in its `after()`, three seconds on (`cache.ts`), which this file
 * runs on a fake clock as Next runs it once the response is out.
 */
let db: TestDatabase;
let close: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/modules/diagnostics/budget-level", () => ({ peekNeonBudgetLevel: () => "unknown", lastKnownBudget: () => null }));
const request = vi.hoisted(() => ({ reads: new Map<string, Promise<unknown>>() }));
vi.mock("@/modules/public-cache/request-memo", () => ({ thisRequestsReads: () => request.reads }));
/** What `after()` was handed: the work Next runs once the response is out. */
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => void afterTasks.push(task),
}));

const { fakeNextCache } = await import("../../helpers/next-cache");
const { cachedPublishedEventsBetween, cachedUpcomingEvents } = await import("@/modules/public-cache/reads");
const { SECOND_EXPIRY_DELAY_MS } = await import("@/modules/public-cache/cache");
const { forgetLastGood } = await import("@/modules/resilience/last-good");
const { transitionEvent } = await import("@/modules/content/events/service");

const NOW = new Date("2026-09-04T10:00:00.000Z");
const NOVEMBER = [new Date("2026-11-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z")] as const;

/** A new request: its own memo starts empty, the data cache is kept. */
function freshRequest(): void {
  request.reads.clear();
}

async function calendarTitles(): Promise<string[]> {
  freshRequest();
  return (await cachedPublishedEventsBetween("ro", ...NOVEMBER)).map((row) => row.title);
}

async function listingTitles(): Promise<string[]> {
  freshRequest();
  return (await cachedUpcomingEvents("ro", NOW)).map((row) => row.title);
}

/** Run what the write's `after()` was handed, on a fake clock, as Next does once the response is out. */
async function afterTheResponse(): Promise<void> {
  const tasks = afterTasks.splice(0);
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  try {
    const done = Promise.all(tasks.map((task) => Promise.resolve(task())));
    await vi.advanceTimersByTimeAsync(SECOND_EXPIRY_DELAY_MS);
    await done;
  } finally {
    vi.useRealTimers();
  }
}

describe("§NNN BR-REQ-020-01 a publish is shown although a render in flight was stored after it", () => {
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
    afterTasks.length = 0;
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** A draft with both languages, ready to publish. */
  async function draft(title: string, slug: string, startsAt: Date) {
    const [row] = await db.insert(events).values({ type: "RACE", startsAt, locationName: "Parcul Tractorul" }).returning();
    await db.insert(eventTranslations).values([
      { eventId: row.id, locale: "ro", slug, title, excerpt: "Cursa clubului." },
      { eventId: row.id, locale: "en", slug: `${slug}-en`, title: `${title} (en)`, excerpt: "The club's race." },
    ]);
    return row;
  }

  async function publish(event: { id: string; version: number }): Promise<void> {
    const reviewed = await transitionEvent(db, { actor: admin, eventId: event.id, expectedVersion: event.version, to: "IN_REVIEW", now: NOW });
    await transitionEvent(db, { actor: admin, eventId: event.id, expectedVersion: reviewed.version, to: "PUBLISHED", now: NOW });
  }

  it("the calendar: the render stored after the publish is expired again by the publish's own after()", async () => {
    const crosul = await draft("Crosul", "crosul", new Date("2026-11-21T07:00:00Z"));

    // A visitor's render of November starts, and reads the month before the publish.
    const inFlight = fakeNextCache.holdStore((keyParts) => keyParts.includes("events.between"));
    const render = calendarTitles();
    await inFlight.loaded;

    // The publish commits and expires the events' tag while that render is still running.
    await publish(crosul);
    expect(fakeNextCache.invalidated).toContain("public:events");

    // The render is stored after the expiry, from the rows it read before it: an empty month.
    inFlight.release();
    expect(await render).toEqual([]);

    // Without a second expiry, that copy is fresh — the race, as Next keeps it.
    expect(await calendarTitles()).toEqual([]);

    // The publish's own after(): once the renders in flight have landed, the same tag again.
    await afterTheResponse();
    expect(await calendarTitles()).toEqual(["Crosul"]);
  });

  it("the listing: the same, with the clock window of the listing unchanged by the publish", async () => {
    // An event already on the listing that ends first, so the listing's clock window (§333) is the
    // same before and after the publish, and the stale copy sits under the key the next visit asks.
    const earlier = await draft("Alergarea de luni", "alergarea-de-luni", new Date("2026-09-07T15:30:00Z"));
    await publish(earlier);
    await afterTheResponse();
    const later = await draft("Crosul", "crosul", new Date("2026-11-21T07:00:00Z"));

    const inFlight = fakeNextCache.holdStore((keyParts) => keyParts.includes("events.upcoming"));
    const render = listingTitles();
    await inFlight.loaded;
    await publish(later);
    inFlight.release();
    expect(await render).toEqual(["Alergarea de luni"]);
    expect(await listingTitles()).toEqual(["Alergarea de luni"]);

    await afterTheResponse();
    expect(await listingTitles()).toEqual(expect.arrayContaining(["Alergarea de luni", "Crosul"]));
  });
});
