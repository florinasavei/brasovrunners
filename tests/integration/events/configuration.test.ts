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
      .values({ kind: "RACE", startsAt: START, ...values })
      .returning();
    return row;
  }

  async function publish(eventId: string, slug: string) {
    await db.insert(eventTranslations).values({
      eventId,
      locale: "ro",
      slug,
      title: "Titlu",
      locationName: "Centru",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T00:00:00Z"),
    });
  }

  describe("criterion 1 the minimal event", () => {
    it("stores an event with only a kind, a start and a registration mode of NONE", async () => {
      const event = await insertEvent({ kind: "MEETUP", registrationMode: "NONE" });

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
        kind: "COMMUNITY_RUN",
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
});
