import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import {
  findLatestPastEvent,
  findPublishedEventBySlug,
  findPublishedTranslations,
  listPublishedEvents,
  listUpcomingEvents,
} from "@/modules/events/repository";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-020-01 — publication and cancellation visibility.
 * BR-REQ-040-02 — no cross-locale content fallback.
 *
 * Publication is one state for the whole event (`DECISIONS.md` §28): both languages go live
 * together, and there is no half-published event any more. What BR-REQ-040-02 still forbids is
 * unchanged and is what these tests prove: a locale with no translation of a published event is
 * a 404 in that locale, never the other language's text under this language's URL.
 */
describe("BR-REQ-020-01 / BR-REQ-040-02 publication is per event", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  async function seedEvent(options: {
    editorialStatus?: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
    locales?: ReadonlyArray<"ro" | "en">;
    eventStatus?: "SCHEDULED" | "CANCELLED" | "COMPLETED";
    startsAt?: Date;
    slug?: string;
    kind?: "COMMUNITY_RUN" | "TRAIL_RUN" | "RACE";
  }) {
    const editorialStatus = options.editorialStatus ?? "PUBLISHED";
    const [event] = await db
      .insert(events)
      .values({
        kind: options.kind ?? "COMMUNITY_RUN",
        eventStatus: options.eventStatus ?? "SCHEDULED",
        startsAt: options.startsAt ?? new Date("2026-10-04T07:00:00Z"),
        editorialStatus,
        // The CHECK refuses a published event with no publication date, exactly as the
        // transition does.
        publishedAt: editorialStatus === "PUBLISHED" ? new Date("2026-09-01T00:00:00Z") : null,
      })
      .returning();

    const slug = options.slug ?? "alergare-de-duminica";
    const rows = {
      ro: {
        eventId: event.id,
        locale: "ro" as const,
        slug,
        title: "Alergare de duminică",
        excerpt: "Alergare relaxată prin parc.",
        locationName: "Parcul Tractorul",
      },
      en: {
        eventId: event.id,
        locale: "en" as const,
        slug: `${slug}-en`,
        title: "Sunday run",
        excerpt: "An easy run through the park.",
        locationName: "Tractorul Park",
      },
    };

    await db
      .insert(eventTranslations)
      .values((options.locales ?? ["ro", "en"]).map((locale) => rows[locale]));

    return event;
  }

  it("lists a published event in both languages", async () => {
    await seedEvent({});
    expect(await listPublishedEvents(db, "ro")).toHaveLength(1);
    expect(await listPublishedEvents(db, "en")).toHaveLength(1);
  });

  it("does not list the event in a locale it has no translation for", async () => {
    await seedEvent({ locales: ["ro"] });
    expect(await listPublishedEvents(db, "ro")).toHaveLength(1);
    expect(await listPublishedEvents(db, "en")).toHaveLength(0);
  });

  it("does not fall back to Romanian content for an English request", async () => {
    await seedEvent({ locales: ["ro"], slug: "alergare-de-duminica" });
    // The Romanian slug must not resolve under the English locale.
    expect(await findPublishedEventBySlug(db, "en", "alergare-de-duminica")).toBeUndefined();
  });

  it.each(["DRAFT", "IN_REVIEW", "ARCHIVED"] as const)(
    "returns nothing in either language for a %s event, so the page 404s",
    async (editorialStatus) => {
      await seedEvent({ editorialStatus });
      expect(await listPublishedEvents(db, "ro")).toHaveLength(0);
      expect(await listPublishedEvents(db, "en")).toHaveLength(0);
      expect(await findPublishedEventBySlug(db, "ro", "alergare-de-duminica")).toBeUndefined();
    },
  );

  it("still shows a cancelled event, which must render with its status rather than vanish", async () => {
    await seedEvent({ eventStatus: "CANCELLED" });
    const list = await listPublishedEvents(db, "ro");
    expect(list).toHaveLength(1);
    expect(list[0].eventStatus).toBe("CANCELLED");
  });

  it("orders events soonest first", async () => {
    await seedEvent({ slug: "a", startsAt: new Date("2026-12-01T07:00:00Z") });
    await seedEvent({ slug: "b", startsAt: new Date("2026-10-01T07:00:00Z") });
    await seedEvent({ slug: "c", startsAt: new Date("2026-11-01T07:00:00Z") });
    const list = await listPublishedEvents(db, "ro");
    expect(list.map((e) => e.slug)).toEqual(["b", "c", "a"]);
  });

  /**
   * BR-REQ-020-01 — what the listing leads with.
   *
   * The club's races are the reason the site exists, so they outrank a training session that
   * merely happens to fall sooner. The date decides only within a kind.
   */
  describe("the listing puts races first, then the soonest", () => {
    const NOW = new Date("2026-09-01T00:00:00Z");

    it("puts a distant race above an imminent community run", async () => {
      await seedEvent({ slug: "run-tomorrow", startsAt: new Date("2026-09-02T07:00:00Z") });
      await seedEvent({
        slug: "race-in-december",
        kind: "RACE",
        startsAt: new Date("2026-12-01T07:00:00Z"),
      });

      const list = await listUpcomingEvents(db, "ro", NOW);
      expect(list.map((e) => e.slug)).toEqual(["race-in-december", "run-tomorrow"]);
    });

    it("orders races among themselves by date", async () => {
      await seedEvent({ slug: "race-b", kind: "RACE", startsAt: new Date("2026-11-01T07:00:00Z") });
      await seedEvent({ slug: "race-a", kind: "RACE", startsAt: new Date("2026-10-01T07:00:00Z") });
      await seedEvent({ slug: "run", startsAt: new Date("2026-09-05T07:00:00Z") });

      const list = await listUpcomingEvents(db, "ro", NOW);
      expect(list.map((e) => e.slug)).toEqual(["race-a", "race-b", "run"]);
    });

    it("leaves out events that have already finished", async () => {
      await seedEvent({ slug: "past-race", kind: "RACE", startsAt: new Date("2026-08-01T07:00:00Z") });
      await seedEvent({ slug: "upcoming-run", startsAt: new Date("2026-09-05T07:00:00Z") });

      const list = await listUpcomingEvents(db, "ro", NOW);
      // A finished race must not be promoted to the top of the page forever.
      expect(list.map((e) => e.slug)).toEqual(["upcoming-run"]);
    });

    it("falls back to the most recent past event when nothing is upcoming", async () => {
      await seedEvent({ slug: "older", startsAt: new Date("2026-07-01T07:00:00Z") });
      await seedEvent({ slug: "newer", startsAt: new Date("2026-08-01T07:00:00Z") });

      expect(await listUpcomingEvents(db, "ro", NOW)).toHaveLength(0);
      const latest = await findLatestPastEvent(db, "ro", NOW);
      expect(latest?.slug).toBe("newer");
    });

    it("returns nothing to fall back to when the club has held no events", async () => {
      expect(await findLatestPastEvent(db, "ro", NOW)).toBeUndefined();
    });
  });
});

/** Slug uniqueness is scoped per locale, and one translation per event per locale. */
describe("BR-REQ-040-02 slug and translation uniqueness", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  async function newEvent() {
    const [event] = await db
      .insert(events)
      .values({ kind: "MEETUP", startsAt: new Date("2026-10-04T07:00:00Z") })
      .returning();
    return event;
  }

  const translation = (eventId: string, locale: "ro" | "en", slug: string) => ({
    eventId,
    locale,
    slug,
    title: "Titlu",
    locationName: "Centru",
  });

  it("allows the same slug in different locales", async () => {
    const a = await newEvent();
    await db.insert(eventTranslations).values(translation(a.id, "ro", "crosul-brasovului"));
    await expect(
      db.insert(eventTranslations).values(translation(a.id, "en", "crosul-brasovului")),
    ).resolves.toBeDefined();
  });

  it("rejects the same slug twice within one locale", async () => {
    const a = await newEvent();
    const b = await newEvent();
    await db.insert(eventTranslations).values(translation(a.id, "ro", "crosul-brasovului"));
    await expectViolation(
      db.insert(eventTranslations).values(translation(b.id, "ro", "crosul-brasovului")),
      { code: SQLSTATE.UNIQUE_VIOLATION, constraint: "event_translations_locale_slug_unique" },
    );
  });

  it("rejects two translations of one event in the same locale", async () => {
    const a = await newEvent();
    await db.insert(eventTranslations).values(translation(a.id, "ro", "unu"));
    await expectViolation(
      db.insert(eventTranslations).values(translation(a.id, "ro", "doi")),
      { code: SQLSTATE.UNIQUE_VIOLATION, constraint: "event_translations_event_locale_unique" },
    );
  });

  /**
   * The database's own half of "complete in both languages".
   *
   * The whole rule needs to read every locale's row at once and is asserted in
   * `transitionEvent`; this is the part one row can state honestly, and it is what stops a
   * blank string passing for a filled-in field.
   */
  it("rejects a translation whose required fields are blank rather than absent", async () => {
    const a = await newEvent();
    await expectViolation(
      db.insert(eventTranslations).values({ ...translation(a.id, "ro", "unu"), title: "   " }),
      {
        code: SQLSTATE.CHECK_VIOLATION,
        constraint: "event_translations_required_fields_present",
      },
    );
  });

  /** A published event without the date of its first publication cannot exist. */
  it("rejects a published event with no publication date", async () => {
    await expectViolation(
      db.insert(events).values({
        kind: "MEETUP",
        startsAt: new Date("2026-10-04T07:00:00Z"),
        editorialStatus: "PUBLISHED",
      }),
      { code: SQLSTATE.CHECK_VIOLATION, constraint: "events_published_has_a_publication_date" },
    );
  });
});

/**
 * BR-REQ-040-01 criterion 5 — an alternate-locale link points at the corresponding localized
 * slug, not at a concatenated URL.
 *
 * This is the failure the criterion is written to prevent: the Romanian slug is
 * "alergare-de-duminica" and the English one "sunday-run", so building /en/ + the Romanian
 * slug produces a page that does not exist. The lookup below is what makes that impossible.
 */
describe("BR-REQ-040-01 criterion 5 alternate locales", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  async function seed(options: {
    editorialStatus?: "DRAFT" | "PUBLISHED";
    locales?: ReadonlyArray<"ro" | "en">;
  }) {
    const editorialStatus = options.editorialStatus ?? "PUBLISHED";
    const [event] = await db
      .insert(events)
      .values({
        kind: "COMMUNITY_RUN",
        startsAt: new Date("2026-10-04T07:00:00Z"),
        editorialStatus,
        publishedAt: editorialStatus === "PUBLISHED" ? new Date("2026-09-01T00:00:00Z") : null,
      })
      .returning();

    const rows = {
      ro: {
        eventId: event.id,
        locale: "ro" as const,
        slug: "alergare-de-duminica",
        title: "Alergare de duminică",
        locationName: "Parcul Tractorul",
      },
      en: {
        eventId: event.id,
        locale: "en" as const,
        slug: "sunday-run",
        title: "Sunday run",
        locationName: "Tractorul Park",
      },
    };

    await db
      .insert(eventTranslations)
      .values((options.locales ?? ["ro", "en"]).map((locale) => rows[locale]));
    return event;
  }

  it("returns each locale with its own distinct slug", async () => {
    const event = await seed({});
    const translations = await findPublishedTranslations(db, event.id);

    const byLocale = Object.fromEntries(translations.map((t) => [t.locale, t.slug]));
    expect(byLocale).toEqual({ ro: "alergare-de-duminica", en: "sunday-run" });
    // The slugs must differ, or this test would pass even with concatenation.
    expect(byLocale.ro).not.toBe(byLocale.en);
  });

  it("omits a locale the event has no translation for", async () => {
    const event = await seed({ locales: ["ro"] });
    const translations = await findPublishedTranslations(db, event.id);

    expect(translations.map((t) => t.locale)).toEqual(["ro"]);
  });

  it("returns nothing for an event that is not published", async () => {
    const event = await seed({ editorialStatus: "DRAFT" });
    expect(await findPublishedTranslations(db, event.id)).toEqual([]);
  });

  it("returns nothing for an event that has no translation at all", async () => {
    const [event] = await db
      .insert(events)
      .values({ kind: "MEETUP", startsAt: new Date("2026-10-04T07:00:00Z") })
      .returning();
    expect(await findPublishedTranslations(db, event.id)).toEqual([]);
  });
});
