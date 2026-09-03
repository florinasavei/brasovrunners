import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { findPublishedEventBySlug, listPublishedEvents } from "@/modules/events/repository";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-020-01 — publication and cancellation visibility.
 * BR-REQ-040-02 — no cross-locale content fallback.
 *
 * The pilot ships Romanian only, with English left in Draft. That is not a shortcut: it is
 * the state the requirement prescribes, and these tests are what prove `/en` genuinely 404s
 * rather than quietly serving Romanian text under an English URL.
 */
describe("BR-REQ-020-01 / BR-REQ-040-02 publication per locale", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  async function seedEvent(options: {
    roStatus?: "DRAFT" | "IN_REVIEW" | "PUBLISHED";
    enStatus?: "DRAFT" | "IN_REVIEW" | "PUBLISHED";
    eventStatus?: "SCHEDULED" | "CANCELLED" | "COMPLETED";
    startsAt?: Date;
    slug?: string;
  }) {
    const [event] = await db
      .insert(events)
      .values({
        kind: "COMMUNITY_RUN",
        eventStatus: options.eventStatus ?? "SCHEDULED",
        startsAt: options.startsAt ?? new Date("2026-10-04T07:00:00Z"),
      })
      .returning();

    const slug = options.slug ?? "alergare-de-duminica";
    await db.insert(eventTranslations).values([
      {
        eventId: event.id,
        locale: "ro",
        slug,
        title: "Alergare de duminică",
        locationName: "Parcul Tractorul",
        editorialStatus: options.roStatus ?? "PUBLISHED",
      },
      {
        eventId: event.id,
        locale: "en",
        slug: `${slug}-en`,
        title: "Sunday run",
        locationName: "Tractorul Park",
        editorialStatus: options.enStatus ?? "DRAFT",
      },
    ]);

    return event;
  }

  it("lists a published Romanian translation", async () => {
    await seedEvent({});
    const list = await listPublishedEvents(db, "ro");
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Alergare de duminică");
  });

  it("does not list the event in English while its English translation is a draft", async () => {
    await seedEvent({});
    expect(await listPublishedEvents(db, "en")).toHaveLength(0);
  });

  it("does not fall back to Romanian content for an English request", async () => {
    await seedEvent({ slug: "alergare-de-duminica" });
    // The Romanian slug must not resolve under the English locale.
    expect(await findPublishedEventBySlug(db, "en", "alergare-de-duminica")).toBeUndefined();
  });

  it.each(["DRAFT", "IN_REVIEW"] as const)(
    "returns nothing for a %s translation, so the page 404s",
    async (status) => {
      await seedEvent({ roStatus: status });
      expect(await listPublishedEvents(db, "ro")).toHaveLength(0);
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
});
