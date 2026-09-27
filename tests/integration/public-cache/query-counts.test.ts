import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { galleryAlbums, galleryAlbumTranslations } from "@/db/schema/gallery";
import { pages, pageTranslations } from "@/db/schema/pages";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — what each public read costs the database, pinned; and that one request asks for a read
 * once, however many parts of the page need it.
 *
 * §333 took the public pages' reads off the database for every visit but the first after a change.
 * That first visit still runs the queries, and on Neon it is the one that wakes the compute. So the
 * number of statements behind each read is part of the site's running cost, and this file is where
 * a change to it is seen: a read that grows a query, or one that starts asking once per event (an
 * "N + 1"), fails here with the new number beside the old.
 *
 * Each read is counted twice, over three published events and over nine: the count must be the
 * same, because nothing a public page reads may scale with the number of events.
 *
 * Then the request memo (`public-cache/request-memo.ts`). In a real render React scopes it to the
 * request; here the test plays the request, a map it empties between "requests".
 */
let db: TestDatabase;
let close: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/modules/diagnostics/neon-budget", () => ({ peekNeonBudgetLevel: () => "unknown" }));
const request = vi.hoisted(() => ({ reads: new Map<string, Promise<unknown>>() }));
vi.mock("@/modules/public-cache/request-memo", () => ({ thisRequestsReads: () => request.reads }));

const { fakeNextCache } = await import("../../helpers/next-cache");
const reads = await import("@/modules/public-cache/reads");
const { forgetLastGood } = await import("@/modules/resilience/last-good");
const { seedSampleLegalDocuments } = await import("@/db/seeds/sample-legal-documents");

const NOW = new Date("2026-09-24T10:00:00.000Z");
const DAY = 86_400_000;

/** Every statement the database is sent, in order. */
let statements: string[] = [];

function countStatements(): void {
  // Drizzle keeps the PGlite it was given on the database object; the helper's type leaves it out.
  const client = (db as TestDatabase & { $client: PGlite }).$client;
  const query = client.query.bind(client);
  client.query = (async (...args: Parameters<typeof query>) => {
    statements.push(String(args[0]));
    return query(...args);
  }) as typeof client.query;
}

/** How many statements `read` sends, with nothing cached and a fresh request. */
async function cost(read: () => Promise<unknown>): Promise<number> {
  fakeNextCache.reset();
  request.reads.clear();
  statements = [];
  await read();
  return statements.length;
}

async function publish(index: number, values: Partial<typeof events.$inferInsert> = {}) {
  const [event] = await db
    .insert(events)
    .values({
      type: "GROUP_RUN",
      startsAt: new Date(NOW.getTime() + (index + 1) * DAY),
      registrationMode: "NONE",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date(NOW.getTime() - 30 * DAY),
      locationName: "Parcul Tractorul",
      ...values,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `tura-${index}`, title: `Tura ${index}` },
    { eventId: event.id, locale: "en", slug: `run-${index}`, title: `Run ${index}` },
  ]);
  return event;
}

/** A race with places, and `runs` group runs — some ahead, one behind, so the past has a row too. */
async function calendar(runs: number) {
  await resetTables(db);
  const race = await publish(0, {
    type: "RACE",
    registrationMode: "INTERNAL",
    capacity: 50,
    registrationClosesAt: new Date(NOW.getTime() + 5 * DAY),
  });
  for (let index = 1; index <= runs; index += 1) await publish(index);
  await publish(99, { startsAt: new Date(NOW.getTime() - 3 * DAY) });
  await seedSampleLegalDocuments(new Date(NOW.getTime() - 10 * DAY));
  // A standing page and an album, so the navigation and the sitemap read rows, not an empty list.
  const [page] = await db.insert(pages).values({ editorialStatus: "PUBLISHED", publishedAt: NOW }).returning();
  await db.insert(pageTranslations).values([
    { pageId: page.id, locale: "ro", slug: "despre", title: "Despre" },
    { pageId: page.id, locale: "en", slug: "about", title: "About" },
  ]);
  const [album] = await db.insert(galleryAlbums).values({ editorialStatus: "PUBLISHED", publishedAt: NOW, takenOn: NOW }).returning();
  await db.insert(galleryAlbumTranslations).values([
    { albumId: album.id, locale: "ro", slug: "cros", title: "Crosul" },
    { albumId: album.id, locale: "en", slug: "cross", title: "The cross" },
  ]);
  return race;
}

/**
 * The statements behind each read a public page makes, on a cold cache. The page that makes it
 * is named beside it; every page also renders the header's four and the footer's one.
 */
function everyRead(raceId: string): Record<string, () => Promise<unknown>> {
  return {
    // The listing.
    upcomingEvents: () => reads.cachedUpcomingEvents("ro", NOW),
    pastEvents: () => reads.cachedPastEvents("ro", NOW, 60),
    latestPastEvent: () => reads.cachedLatestPastEvent("ro", NOW),
    // The race's door on the listing's card and on its page.
    publicAvailability: () => reads.cachedPublicAvailability(raceId, NOW),
    // The event page and its metadata.
    eventBySlug: () => reads.cachedPublishedEventBySlug("ro", "tura-1"),
    eventTranslations: () => reads.cachedPublishedTranslations(raceId),
    // The calendar: one month.
    eventsBetween: () => reads.cachedPublishedEventsBetween("ro", new Date("2026-09-01T00:00:00.000Z"), new Date("2026-10-01T00:00:00.000Z")),
    // The header and the footer, on every page.
    navigationPages: () => reads.cachedPublishedPages("ro"),
    albums: () => reads.cachedPublishedAlbums("ro"),
    teamPage: () => reads.cachedTeamPage("ro"),
    contactReaches: () => reads.cachedContactFormReaches(),
    shownContactAddresses: () => reads.cachedShownContactAddresses(),
    // The terms, the privacy notice, and what the event page and the contact page read of it.
    legalInForce: () => reads.cachedCurrentApprovedDocument("TERMS", "ro", NOW),
    newsletterOffered: () => reads.cachedNewsletterOffered(NOW),
    listStatesDisclosed: () => reads.cachedListStatesDisclosed(NOW),
    deadlines: () => reads.cachedDeadlines(),
    // The sitemap.
    sitemapEvents: () => reads.cachedSitemapEvents("ro"),
    sitemapPages: () => reads.cachedSitemapPages("ro"),
    sitemapAlbums: () => reads.cachedSitemapAlbums("ro"),
  };
}

/**
 * The pinned counts. A change here is a change to what a cold page costs: say why in the commit,
 * and keep every entry flat in the number of events.
 */
const STATEMENTS: Record<string, number> = {
  upcomingEvents: 2,
  pastEvents: 2,
  latestPastEvent: 2,
  publicAvailability: 4,
  eventBySlug: 1,
  eventTranslations: 1,
  eventsBetween: 1,
  navigationPages: 1,
  albums: 1,
  // The page's setting alone while «Echipa» is not published; published, one more for its cards.
  teamPage: 1,
  contactReaches: 1,
  shownContactAddresses: 1,
  legalInForce: 2,
  // Both languages' notices, which share one list of effective dates (below, one request).
  newsletterOffered: 3,
  listStatesDisclosed: 3,
  deadlines: 1,
  sitemapEvents: 2,
  sitemapPages: 2,
  sitemapAlbums: 2,
};

describe("§NNN what a public read costs the database", () => {
  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    countStatements();
  });
  afterAll(async () => close());
  beforeEach(() => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "log").mockImplementation(() => {});
    forgetLastGood();
  });

  it("is the pinned number of statements per read, the same over three events and over nine", async () => {
    const measured: Record<string, number>[] = [];
    for (const runs of [2, 8]) {
      const race = await calendar(runs);
      const counts: Record<string, number> = {};
      for (const [name, read] of Object.entries(everyRead(race.id))) {
        forgetLastGood();
        counts[name] = await cost(read);
      }
      measured.push(counts);
    }
    expect(measured[0]).toEqual(STATEMENTS);
    expect(measured[1]).toEqual(STATEMENTS);
  });

  it("costs nothing on a warm cache: the second request is answered without the database", async () => {
    const race = await calendar(2);
    const all = everyRead(race.id);
    fakeNextCache.reset();
    request.reads.clear();
    for (const read of Object.values(all)) await read();
    request.reads.clear();
    statements = [];
    for (const read of Object.values(all)) await read();
    expect(statements).toEqual([]);
  });
});

describe("§NNN one request asks for a read once", () => {
  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    countStatements();
  });
  afterAll(async () => close());
  beforeEach(() => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "log").mockImplementation(() => {});
    forgetLastGood();
  });

  /*
    Per page, one simulated request: every read the page's own body and metadata make, asked
    together as the render asks them, sharing `request.reads`. A page that starts making one read
    more, or stops sharing one through the memo, changes its total here. The header's four and the
    footer's one are the same on every page and are counted above, read by read.
  */
  it("the listing, with a race on it, costs eight statements in one request", async () => {
    const race = await calendar(2);
    expect(
      await cost(() =>
        Promise.all([
          reads.cachedUpcomingEvents("ro", NOW),
          reads.cachedPastEvents("ro", NOW, 60),
          reads.cachedDeadlines(),
          reads.cachedPublicAvailability(race.id, NOW),
        ]),
      ),
    ).toBe(8);
  });

  it("an event page with its metadata costs two statements in one request", async () => {
    await calendar(2);
    const tura = await reads.cachedPublishedEventBySlug("ro", "tura-1");
    if (!tura) throw new Error("the sample run is missing");
    expect(
      await cost(() =>
        Promise.all([
          // generateMetadata: the event, then its other language's address.
          reads.cachedPublishedEventBySlug("ro", "tura-1").then(() => reads.cachedPublishedTranslations(tura.id)),
          // The page: the same event, answered by the request's memo.
          reads.cachedPublishedEventBySlug("ro", "tura-1"),
        ]),
      ),
    ).toBe(2);
  });

  it("the listing's two sections share the endings that key them: three statements, not four", async () => {
    await calendar(2);
    expect(await cost(() => Promise.all([reads.cachedUpcomingEvents("ro", NOW), reads.cachedPastEvents("ro", NOW, 60)]))).toBe(3);
  });

  it("the event page and its metadata read the event once, and the data cache once", async () => {
    await calendar(2);
    const cold = await cost(() =>
      Promise.all([reads.cachedPublishedEventBySlug("ro", "tura-1"), reads.cachedPublishedEventBySlug("ro", "tura-1")]),
    );
    expect(cold).toBe(1);
    expect(fakeNextCache.counts.reads).toBe(1);
    // A warm request: both readers answered by one lookup of the data cache.
    request.reads.clear();
    const before = fakeNextCache.counts.reads;
    await Promise.all([reads.cachedPublishedEventBySlug("ro", "tura-1"), reads.cachedPublishedEventBySlug("ro", "tura-1")]);
    expect(fakeNextCache.counts.reads - before).toBe(1);
  });

  it("the header and the footer read the club's shown address once", async () => {
    await calendar(2);
    request.reads.clear();
    fakeNextCache.reset();
    await Promise.all([reads.cachedShownContactAddresses(), reads.cachedShownContactAddresses()]);
    expect(fakeNextCache.counts.reads).toBe(1);
  });

  it("hands each reader its own copy, so no part of a page can change what another one reads", async () => {
    await calendar(2);
    request.reads.clear();
    fakeNextCache.reset();
    const [first, second] = await Promise.all([reads.cachedUpcomingEvents("ro", NOW), reads.cachedUpcomingEvents("ro", NOW)]);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0].startsAt).toBeInstanceOf(Date);
  });

  it("forgets a failure, so a later reader in the same request asks again", async () => {
    const { publicRead } = await import("@/modules/public-cache/cache");
    request.reads.clear();
    fakeNextCache.reset();
    let calls = 0;
    const load = async () => {
      calls += 1;
      if (calls === 1) throw new Error("the database is away");
      return "answer";
    };
    await expect(publicRead(["test.memo-failure"], ["events"], load)).rejects.toThrow("the database is away");
    expect(await publicRead(["test.memo-failure"], ["events"], load)).toBe("answer");
    expect(calls).toBe(2);
  });

  it("starts every request empty: a read two requests make is asked of the data cache by each", async () => {
    await calendar(2);
    fakeNextCache.reset();
    request.reads.clear();
    await reads.cachedPublishedPages("ro");
    request.reads.clear();
    await reads.cachedPublishedPages("ro");
    expect(fakeNextCache.counts.reads).toBe(2);
    expect(fakeNextCache.counts.writes).toBe(1);
  });
});
