import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { aRaceHasRun, readRaceDaySettings } from "@/modules/diagnostics/race-day-settings";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-090-05, §NNN — «Sarcini» reminds the club to set «Startul cursei» and «Categorii de vârstă» for a coming
 * race that takes results, read from the live system: the reader says per race whether each column holds a value
 * (open while it does not, done once it does), and returns nothing when no such race is coming. The rows made from
 * it are `owner-tasks.test.ts`'s.
 */
const NOW = new Date("2026-11-01T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;

describe("BR-REQ-090-05 the race-day settings a coming race still owes", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let counter = 0;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
  });

  async function event(over: Partial<typeof events.$inferInsert>, title = "Crosul") {
    counter += 1;
    const [row] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date(NOW.getTime() + 10 * DAY), registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW, ...over })
      .returning();
    await db.insert(eventTranslations).values({ eventId: row.id, locale: "ro", slug: `cros-${counter}`, title });
    return row;
  }

  const read = () => readRaceDaySettings(db, "ro", NOW);

  it("is open for a race ten days off with neither set, and names it", async () => {
    const race = await event({});
    expect(await read()).toEqual([{ eventId: race.id, title: "Crosul", hasGunTime: false, hasAgeBands: false }]);
  });

  it("is done for each setting once its column holds a value, independently", async () => {
    await event({ raceStartsAt: new Date(NOW.getTime() + 10 * DAY + 3_600_000) });
    expect(await read()).toMatchObject([{ hasGunTime: true, hasAgeBands: false }]);
    await resetTables(db);
    await event({ resultAgeBands: [18, 35, 45] });
    expect(await read()).toMatchObject([{ hasGunTime: false, hasAgeBands: true }]);
    await resetTables(db);
    await event({ raceStartsAt: new Date(NOW.getTime() + 10 * DAY + 3_600_000), resultAgeBands: [18, 30] });
    expect(await read()).toMatchObject([{ hasGunTime: true, hasAgeBands: true }]);
  });

  it("draws no row when no published, dated race that takes results starts within the window", async () => {
    expect(await read()).toEqual([]);
    await event({ startsAt: new Date(NOW.getTime() + 40 * DAY) }, "Too far");
    await event({ startsAt: new Date(NOW.getTime() - 3 * DAY) }, "Already run");
    await event({ editorialStatus: "DRAFT", publishedAt: null }, "Draft");
    await event({ type: "GROUP_RUN" }, "Group run: no results");
    await event({ dateToBeAnnounced: true }, "Date to be announced");
    expect(await read()).toEqual([]);
  });

  it("draws no row for a cancelled race in the window", async () => {
    await event({ eventStatus: "CANCELLED" }, "Cancelled");
    expect(await read()).toEqual([]);
  });

  it("keeps a race whose gun went off a few hours ago, and orders the races by their start", async () => {
    const later = await event({ startsAt: new Date(NOW.getTime() + 15 * DAY) }, "Later");
    const today = await event({ startsAt: new Date(NOW.getTime() - 2 * 3_600_000) }, "Today");
    expect((await read()).map((race) => race.eventId)).toEqual([today.id, later.id]);
  });

  it("knows whether a published race has already started, for the Mailgun question", async () => {
    expect(await aRaceHasRun(db, NOW)).toBe(false);
    await event({ startsAt: new Date(NOW.getTime() + 5 * DAY) });
    await event({ editorialStatus: "DRAFT", publishedAt: null, startsAt: new Date(NOW.getTime() - 5 * DAY) }, "Draft in the past");
    expect(await aRaceHasRun(db, NOW)).toBe(false);
    await event({ startsAt: new Date(NOW.getTime() - 5 * DAY) }, "Run");
    expect(await aRaceHasRun(db, NOW)).toBe(true);
  });

  it("does not count a cancelled past race, nor a date-to-be-announced one, as run", async () => {
    await event({ eventStatus: "CANCELLED", startsAt: new Date(NOW.getTime() - 5 * DAY) }, "Cancelled");
    await event({ dateToBeAnnounced: true, startsAt: new Date(NOW.getTime() - 5 * DAY) }, "TBA");
    expect(await aRaceHasRun(db, NOW)).toBe(false);
  });
});
