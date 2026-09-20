import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { listUpcomingEvents } from "@/modules/events/repository";
import { registrationState } from "@/modules/events/domain/registration-window";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-011-01 — minimal and full event configurations.
 *
 * The columns added for the backoffice are part of the event's configuration, so their rules
 * are asserted here, against the database rather than against the form: a seed, a migration
 * and a hand-written UPDATE all reach these columns, and only a constraint holds for all
 * three.
 */
describe("BR-REQ-011-01 event configuration", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  const START = new Date("2026-10-11T06:00:00Z");

  async function insertEvent(values: Partial<typeof events.$inferInsert> = {}) {
    const [row] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: START, ...values })
      .returning();
    return row;
  }

  async function publish(eventId: string, slug: string) {
    // Publication lives on the event now (`DECISIONS.md` §28), so publishing is a change to
    // the event row and the translation is simply the language it is readable in.
    await db
      .update(events)
      .set({ editorialStatus: "PUBLISHED", publishedAt: new Date("2026-09-01T00:00:00Z") })
      .where(eq(events.id, eventId));
    await db.insert(eventTranslations).values({
      eventId,
      locale: "ro",
      slug,
      title: "Titlu",
    });
  }

  describe("criterion 1 the minimal event", () => {
    it("stores an event with only a kind, a start and a registration mode of NONE", async () => {
      const event = await insertEvent({ type: "MEETUP", registrationMode: "NONE" });

      expect(event.capacity).toBeNull();
      expect(event.raceStartsAt).toBeNull();
      expect(event.mapUrl).toBeNull();
      expect(event.featured).toBe(false);
      // Nothing on the page can offer registration for it.
      expect(
        registrationState(
          {
            registrationMode: "NONE",
            eventStatus: "SCHEDULED",
            startsAt: START,
            registrationOpensAt: null,
            registrationClosesAt: null,
            publishedAt: new Date("2026-09-01T00:00:00Z"),
          },
          new Date("2026-09-02T00:00:00Z"),
        ),
      ).toBe("NOT_APPLICABLE");
    });
  });

  describe("the race start is a second time inside the event", () => {
    it("accepts a gun time after the gathering", async () => {
      const event = await insertEvent({ raceStartsAt: new Date("2026-10-11T07:00:00Z") });
      expect(event.raceStartsAt?.toISOString()).toBe("2026-10-11T07:00:00.000Z");
    });

    it("accepts a race that starts exactly when the event begins", async () => {
      const event = await insertEvent({ raceStartsAt: START });
      expect(event.raceStartsAt).toEqual(START);
    });

    it("refuses a race that starts before the event begins", async () => {
      await expectViolation(insertEvent({ raceStartsAt: new Date("2026-10-11T05:00:00Z") }), {
        code: SQLSTATE.CHECK_VIOLATION,
        constraint: "events_race_start_within_event",
      });
    });

    it("refuses a race that starts after the event ends", async () => {
      await expectViolation(
        insertEvent({
          endsAt: new Date("2026-10-11T09:00:00Z"),
          raceStartsAt: new Date("2026-10-11T10:00:00Z"),
        }),
        { code: SQLSTATE.CHECK_VIOLATION, constraint: "events_race_start_within_event" },
      );
    });
  });

  describe("the map link is stored, and only ever https", () => {
    it("accepts an https link", async () => {
      // Built from parts so no hostname literal appears in the repository (AGENTS.md §8).
      const link = ["https:/", "maps.example.test", "brasov"].join("/");
      const event = await insertEvent({ mapUrl: link });
      expect(event.mapUrl).toBe(link);
    });

    it.each([
      ["javascript", "javascript:alert(1)"],
      ["data", "data:text/html,<script>alert(1)</script>"],
      ["plain http", "http://maps.example.test/brasov"],
      ["a bare word", "maps.example.test"],
    ])("refuses %s", async (_name, value) => {
      await expectViolation(insertEvent({ mapUrl: value }), {
        code: SQLSTATE.CHECK_VIOLATION,
        constraint: "events_map_url_is_https",
      });
    });
  });

  /**
   * BR-REQ-011-01 criterion 8. The same guard as the map link, and for the same reason: this
   * URL is pasted by an organizer and clicked by a visitor, and the form is not the last line
   * of defence — a seed, a migration or a hand-written UPDATE all reach the column.
   */
  describe("the route link is stored, and only ever https", () => {
    it("accepts an https link", async () => {
      const link = ["https:/", "routes.example.test", "tampa"].join("/");
      const event = await insertEvent({ routeUrl: link });
      expect(event.routeUrl).toBe(link);
    });

    it("is null when the club has not drawn one", async () => {
      expect((await insertEvent({})).routeUrl).toBeNull();
    });

    it("is a different column from the map link, so an event can carry both", async () => {
      const map = ["https:/", "maps.example.test", "brasov"].join("/");
      const route = ["https:/", "routes.example.test", "tampa"].join("/");
      const event = await insertEvent({ mapUrl: map, routeUrl: route });

      // Where to meet and where it goes are two questions (`DECISIONS.md` §49); before this
      // column they shared one field and answering both meant choosing which to lose.
      expect(event.mapUrl).toBe(map);
      expect(event.routeUrl).toBe(route);
    });

    it.each([
      ["javascript", "javascript:alert(1)"],
      ["data", "data:text/html,<script>alert(1)</script>"],
      ["plain http", "http://routes.example.test/tampa"],
      ["a bare word", "routes.example.test"],
    ])("refuses %s", async (_name, value) => {
      await expectViolation(insertEvent({ routeUrl: value }), {
        code: SQLSTATE.CHECK_VIOLATION,
        constraint: "events_route_url_is_https",
      });
    });
  });

  describe("the type is one of three and the surface is one of three or none", () => {
    // BR-REQ-010-01: two closed sets where there was one (`DECISIONS.md` §61). The surface is
    // stored beside the type and read back as stated, and null is a legitimate answer.
    it("stores a type with a surface", async () => {
      const event = await insertEvent({ type: "GROUP_RUN", surface: "TRAIL" });
      expect(event.type).toBe("GROUP_RUN");
      expect(event.surface).toBe("TRAIL");
    });

    it("stores a meetup with no surface", async () => {
      const event = await insertEvent({ type: "MEETUP" });
      expect(event.surface).toBeNull();
    });

    it("ties a race grouping to the RACE type, not to any other", async () => {
      // AGENTS.md §12.3: when `race_id` is set, the event's type is RACE. The M2 footprint
      // moved from `kind` to `type` with the split and must still hold.
      await expectViolation(
        insertEvent({ type: "GROUP_RUN", raceId: "00000000-0000-4000-8000-000000000001" }),
        { code: SQLSTATE.CHECK_VIOLATION, constraint: "events_race_id_implies_race_type" },
      );
    });
  });

  describe("at most one event is featured, and the database is what says so", () => {
    it("accepts a single featured event", async () => {
      const event = await insertEvent({ featured: true });
      expect(event.featured).toBe(true);
    });

    it("refuses a second featured event", async () => {
      await insertEvent({ featured: true });
      await expectViolation(insertEvent({ featured: true }), {
        code: SQLSTATE.UNIQUE_VIOLATION,
        constraint: "events_only_one_featured",
      });
    });

    it("puts no limit on how many events are not featured", async () => {
      await insertEvent({ featured: false });
      await insertEvent({ featured: false });
      await expect(insertEvent({ featured: false })).resolves.toBeDefined();
    });

    it("leads the listing with the featured event, ahead of a sooner race", async () => {
      const soonerRace = await insertEvent({ startsAt: new Date("2026-09-20T06:00:00Z") });
      const featured = await insertEvent({
        startsAt: new Date("2026-12-01T06:00:00Z"),
        featured: true,
      });
      const run = await insertEvent({
        type: "GROUP_RUN",
        startsAt: new Date("2026-09-15T06:00:00Z"),
      });

      await publish(soonerRace.id, "cursa-devreme");
      await publish(featured.id, "crosul-aniversar");
      await publish(run.id, "alergare");

      const list = await listUpcomingEvents(db, "ro", new Date("2026-09-01T00:00:00Z"));
      // featured -> race -> soonest, in that order.
      expect(list.map((event) => event.slug)).toEqual([
        "crosul-aniversar",
        "cursa-devreme",
        "alergare",
      ]);
    });
  });

  describe("criterion 15 a special edition, any number of them (`DECISIONS.md` §168)", () => {
    it("puts no limit on how many events are special, unlike the featured flag", async () => {
      await insertEvent({ isSpecial: true });
      await insertEvent({ isSpecial: true });
      await expect(insertEvent({ isSpecial: true })).resolves.toBeDefined();
    });

    it("lifts a special edition above the ordinary ones in its own band, and never above the lead", async () => {
      const featured = await insertEvent({ startsAt: new Date("2026-12-01T06:00:00Z"), featured: true });
      const race = await insertEvent({ startsAt: new Date("2026-09-20T06:00:00Z") });
      const ordinaryRun = await insertEvent({ type: "GROUP_RUN", startsAt: new Date("2026-09-15T06:00:00Z") });
      const specialRun = await insertEvent({ type: "GROUP_RUN", startsAt: new Date("2026-09-16T06:00:00Z"), isSpecial: true });

      await publish(featured.id, "crosul-aniversar");
      await publish(race.id, "cursa-devreme");
      await publish(ordinaryRun.id, "alergare");
      await publish(specialRun.id, "alergare-cu-maratonul");

      const list = await listUpcomingEvents(db, "ro", new Date("2026-09-01T00:00:00Z"));
      // The lead is still the lead and the race is still ahead of the runs; among the runs,
      // the special Wednesday comes first although it is a day later.
      expect(list.map((event) => event.slug)).toEqual([
        "crosul-aniversar",
        "cursa-devreme",
        "alergare-cu-maratonul",
        "alergare",
      ]);
    });
  });
});
