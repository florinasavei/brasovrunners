import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { findTranslationById } from "@/modules/content/events/repository";
import {
  saveEventFields,
  saveEventTranslation,
  transitionEvent,
} from "@/modules/content/events/service";
import { listPublishedEvents } from "@/modules/events/repository";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-051-01 — editorial workflow and permissions, all five criteria.
 *
 * These call the service the Server Actions call, with an explicit actor, which is the point:
 * BR-REQ-060-01 criterion 4 asks that authorization be asserted at the server, and a test that
 * clicked a button would prove only that the button was hidden.
 *
 * Publication is one state for the whole event (`DECISIONS.md` §28), so the transitions below
 * act on the event and the saves act on one language's text.
 */
describe("BR-REQ-051-01 editorial workflow", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let author: StaffUser;
  let otherAuthor: StaffUser;
  let editor: StaffUser;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [author] = await db
      .insert(staffUsers)
      .values({ email: "author@dev.test", displayName: "Author", role: "AUTHOR" })
      .returning();
    [otherAuthor] = await db
      .insert(staffUsers)
      .values({ email: "other@dev.test", displayName: "Other author", role: "AUTHOR" })
      .returning();
    [editor] = await db
      .insert(staffUsers)
      .values({ email: "editor@dev.test", displayName: "Editor", role: "EDITOR" })
      .returning();
    [admin] = await db
      .insert(staffUsers)
      .values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" })
      .returning();
  });

  /** The fields a translation save must carry: the whole allowlisted set, as the form posts it. */
  const FIELDS = {
    slug: "crosul-aniversar",
    title: "Crosul aniversar",
    excerpt: "Cursa clubului.",
    seoTitle: "Crosul aniversar Brașov Runners",
    seoDescription: "Cursa aniversară a clubului.",
  };

  /** The meeting point is the event's now, not each language's (`DECISIONS.md` §36). */
  const MEETING_POINT = "Parcul Tractorul";

  /** The event row as the form posts it — every column an organizer owns. */
  const EVENT_FIELDS = {
    kind: "RACE",
    eventStatus: "SCHEDULED",
    timezone: "Europe/Bucharest",
    startsAtWallTime: "2026-10-11T09:00",
    endsAtWallTime: "",
    raceStartsAtWallTime: "",
    latitude: "",
    longitude: "",
    // One value for the whole event now (`DECISIONS.md` §36).
    locationName: "Parcul Tractorul",
    locationAddress: "",
    difficultyLabel: "",
    costText: "",
    mapUrl: "",
    distanceMeters: "",
    elevationGainMeters: "",
    featured: false,
    registrationMode: "NONE",
    participantListVisibility: "HIDDEN" as const,
    capacity: "",
    registrationOpensAtWallTime: "",
    registrationClosesAtWallTime: "",
    declarationDocumentId: "",
    externalProvider: "",
    externalRegistrationUrl: "",
  };

  /**
   * One event with a complete translation in each locale, unless a test asks for less.
   *
   * "Complete" is what publication requires, so the default has to satisfy it — a test that had
   * to remember to fill in the English excerpt before publishing would be testing the fixture.
   */
  async function seedEvent(
    options: {
      status?: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
      authorId?: string | null;
      publishedAt?: Date | null;
      slug?: string;
      /** Fields to blank out on the English translation, to make it incomplete. */
      englishMissing?: Partial<Record<"excerpt", null>>;
      withoutEnglish?: boolean;
    } = {},
  ) {
    const status = options.status ?? "DRAFT";
    const slug = options.slug ?? FIELDS.slug;

    const [event] = await db
      .insert(events)
      .values({
        kind: "RACE",
        startsAt: new Date("2026-10-11T06:00:00Z"),
        // The meeting point is the event's now, and publication requires it (`DECISIONS.md` §36).
        locationName: MEETING_POINT,
        editorialStatus: status,
        publishedAt:
          options.publishedAt ?? (status === "PUBLISHED" ? new Date("2026-09-01T00:00:00Z") : null),
      })
      .returning();

    const authorStaffUserId = options.authorId === undefined ? author.id : options.authorId;

    const [translation] = await db
      .insert(eventTranslations)
      .values({
        eventId: event.id,
        locale: "ro",
        slug,
        title: FIELDS.title,
        excerpt: FIELDS.excerpt,
        locationName: MEETING_POINT,
        authorStaffUserId,
      })
      .returning();

    let english: typeof translation | undefined;
    if (!options.withoutEnglish) {
      [english] = await db
        .insert(eventTranslations)
        .values({
          eventId: event.id,
          locale: "en",
          slug: `${slug}-en`,
          title: "Anniversary cross",
          excerpt: options.englishMissing?.excerpt === null ? null : "The club's own race.",
          locationName: MEETING_POINT,
          authorStaffUserId,
        })
        .returning();
    }

    return { event, translation, english };
  }

  /** The error code a call refuses with, or "no error" when it unexpectedly succeeded. */
  async function codeOf(operation: Promise<unknown>): Promise<string> {
    try {
      await operation;
      return "no error";
    } catch (error) {
      if (isDomainError(error)) return error.code;
      throw error;
    }
  }

  describe("criterion 1 an Author edits their own drafts and submits for review", () => {
    it("saves an Author's own draft", async () => {
      const { translation } = await seedEvent();

      const saved = await saveEventTranslation(db, {
        actor: author,
        translationId: translation.id,
        expectedVersion: translation.version,
        fields: { ...FIELDS, title: "Crosul aniversar, ediția a treia" },
      });

      expect(saved.title).toBe("Crosul aniversar, ediția a treia");
      expect(saved.version).toBe(translation.version + 1);
    });

    it("refuses an Author a colleague's draft", async () => {
      const { translation } = await seedEvent({ authorId: otherAuthor.id });

      expect(
        await codeOf(
          saveEventTranslation(db, {
            actor: author,
            translationId: translation.id,
            expectedVersion: translation.version,
            fields: FIELDS,
          }),
        ),
      ).toBe("FORBIDDEN");
    });

    it("lets an Author submit their own draft for review", async () => {
      const { event } = await seedEvent();

      const submitted = await transitionEvent(db, {
        actor: author,
        eventId: event.id,
        expectedVersion: event.version,
        to: "IN_REVIEW",
      });

      expect(submitted.editorialStatus).toBe("IN_REVIEW");
    });

    it("refuses an Author who tries to publish, whatever the interface showed", async () => {
      const { event } = await seedEvent({ status: "IN_REVIEW" });

      expect(
        await codeOf(
          transitionEvent(db, {
            actor: author,
            eventId: event.id,
            expectedVersion: event.version,
            to: "PUBLISHED",
          }),
        ),
      ).toBe("FORBIDDEN");

      const [current] = await db.select().from(events).where(eq(events.id, event.id));
      expect(current.editorialStatus, "nothing was written").toBe("IN_REVIEW");
      expect(current.version).toBe(event.version);
    });

    it("refuses an Author the event row — the times, the map link, the featured flag", async () => {
      const { event } = await seedEvent();

      expect(
        await codeOf(
          saveEventFields(db, {
            actor: author,
            eventId: event.id,
            expectedVersion: event.version,
            fields: { ...EVENT_FIELDS, featured: true },
          }),
        ),
      ).toBe("FORBIDDEN");
    });
  });

  describe("criterion 2 an Editor or Administrator publishes, unpublishes and archives", () => {
    it.each([
      ["editor", () => editor],
      ["administrator", () => admin],
    ])("lets an %s publish a reviewed draft", async (_name, actorOf) => {
      const { event } = await seedEvent({ status: "IN_REVIEW" });
      const now = new Date("2026-09-04T08:00:00Z");

      const published = await transitionEvent(db, {
        actor: actorOf(),
        eventId: event.id,
        expectedVersion: event.version,
        to: "PUBLISHED",
        now,
      });

      expect(published.editorialStatus).toBe("PUBLISHED");
      expect(published.publishedAt).toEqual(now);
      expect(published.updatedByStaffUserId).toBe(actorOf().id);
    });

    it("puts both languages live in the same moment", async () => {
      const { event } = await seedEvent({ status: "IN_REVIEW" });

      await transitionEvent(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version,
        to: "PUBLISHED",
      });

      expect(await listPublishedEvents(db, "ro")).toHaveLength(1);
      expect(await listPublishedEvents(db, "en")).toHaveLength(1);
    });

    it("refuses to publish while a language is missing a field the public page renders", async () => {
      const { event } = await seedEvent({ status: "IN_REVIEW", englishMissing: { excerpt: null } });

      expect(
        await codeOf(
          transitionEvent(db, {
            actor: editor,
            eventId: event.id,
            expectedVersion: event.version,
            to: "PUBLISHED",
          }),
        ),
      ).toBe("VALIDATION_ERROR");

      const [current] = await db.select().from(events).where(eq(events.id, event.id));
      expect(current.editorialStatus, "nothing went public").toBe("IN_REVIEW");
    });

    it("refuses to publish while a language has no translation at all", async () => {
      const { event } = await seedEvent({ status: "IN_REVIEW", withoutEnglish: true });

      expect(
        await codeOf(
          transitionEvent(db, {
            actor: editor,
            eventId: event.id,
            expectedVersion: event.version,
            to: "PUBLISHED",
          }),
        ),
      ).toBe("VALIDATION_ERROR");
    });

    it("unpublishes back to a draft, and the public queries stop returning it", async () => {
      const { event } = await seedEvent({ status: "PUBLISHED" });

      expect(await listPublishedEvents(db, "ro")).toHaveLength(1);

      await transitionEvent(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version,
        to: "DRAFT",
      });

      expect(await listPublishedEvents(db, "ro")).toHaveLength(0);
      expect(await listPublishedEvents(db, "en")).toHaveLength(0);
    });

    it("keeps the first publication date when an event is republished", async () => {
      const firstPublication = new Date("2026-09-01T00:00:00Z");
      const { event } = await seedEvent({ status: "PUBLISHED", publishedAt: firstPublication });

      const draft = await transitionEvent(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version,
        to: "DRAFT",
      });
      const reviewed = await transitionEvent(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: draft.version,
        to: "IN_REVIEW",
      });
      const finalState = await transitionEvent(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: reviewed.version,
        to: "PUBLISHED",
        now: new Date("2026-09-20T00:00:00Z"),
      });

      // The date the page first went public is what slug stability and the sitemap read.
      expect(finalState.publishedAt).toEqual(firstPublication);
    });

    it("archives a published event", async () => {
      const { event } = await seedEvent({ status: "PUBLISHED" });

      const archived = await transitionEvent(db, {
        actor: admin,
        eventId: event.id,
        expectedVersion: event.version,
        to: "ARCHIVED",
      });

      expect(archived.editorialStatus).toBe("ARCHIVED");
      expect(await listPublishedEvents(db, "ro")).toHaveLength(0);
    });
  });

  describe("criterion 3 an Author cannot edit published content", () => {
    it("refuses the save and writes nothing", async () => {
      const { translation } = await seedEvent({ status: "PUBLISHED" });

      expect(
        await codeOf(
          saveEventTranslation(db, {
            actor: author,
            translationId: translation.id,
            expectedVersion: translation.version,
            acknowledgeLiveEdit: true,
            fields: { ...FIELDS, title: "Titlu schimbat de autor" },
          }),
        ),
      ).toBe("FORBIDDEN");

      const current = await findTranslationById(db, translation.id);
      expect(current?.title).toBe(FIELDS.title);
      expect(current?.version).toBe(translation.version);
    });
  });

  describe("criterion 4 a save that affects live content is warned about first", () => {
    it("refuses a save on a published event when the warning was not answered", async () => {
      const { translation } = await seedEvent({ status: "PUBLISHED" });

      expect(
        await codeOf(
          saveEventTranslation(db, {
            actor: editor,
            translationId: translation.id,
            expectedVersion: translation.version,
            fields: { ...FIELDS, title: "Titlu nou" },
          }),
        ),
      ).toBe("VALIDATION_ERROR");

      const current = await findTranslationById(db, translation.id);
      expect(current?.title, "the live page was not changed").toBe(FIELDS.title);
    });

    it("accepts the same save once the warning is acknowledged", async () => {
      const { translation } = await seedEvent({ status: "PUBLISHED" });

      const saved = await saveEventTranslation(db, {
        actor: editor,
        translationId: translation.id,
        expectedVersion: translation.version,
        acknowledgeLiveEdit: true,
        fields: { ...FIELDS, title: "Titlu nou" },
      });

      expect(saved.title).toBe("Titlu nou");
    });

    it("needs no acknowledgement for a draft, which nobody can read yet", async () => {
      const { translation } = await seedEvent();

      await expect(
        saveEventTranslation(db, {
          actor: author,
          translationId: translation.id,
          expectedVersion: translation.version,
          fields: { ...FIELDS, title: "Ciornă" },
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("criterion 5 a stale save is a conflict", () => {
    it("rejects a second save that carries the version the first one replaced", async () => {
      const { translation } = await seedEvent();

      // Both organizers loaded version 1. The first save wins.
      await saveEventTranslation(db, {
        actor: author,
        translationId: translation.id,
        expectedVersion: 1,
        fields: { ...FIELDS, title: "Prima salvare" },
      });

      expect(
        await codeOf(
          saveEventTranslation(db, {
            actor: author,
            translationId: translation.id,
            expectedVersion: 1,
            fields: { ...FIELDS, title: "A doua salvare" },
          }),
        ),
      ).toBe("CONFLICT");

      const current = await findTranslationById(db, translation.id);
      expect(current?.title, "the first save survived intact").toBe("Prima salvare");
      expect(current?.version).toBe(2);
    });

    it("rejects a stale transition too, so publishing cannot skip a rewrite", async () => {
      const { event } = await seedEvent({ status: "IN_REVIEW" });

      // Somebody else changed the event row — its times, say — after this page was rendered.
      await saveEventFields(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version,
        fields: { ...EVENT_FIELDS, startsAtWallTime: "2026-10-11T10:00" },
      });

      expect(
        await codeOf(
          transitionEvent(db, {
            actor: editor,
            eventId: event.id,
            expectedVersion: event.version,
            to: "PUBLISHED",
          }),
        ),
      ).toBe("CONFLICT");

      const [current] = await db.select().from(events).where(eq(events.id, event.id));
      expect(current.editorialStatus).toBe("IN_REVIEW");
    });

    it("rejects a stale save of the event row", async () => {
      const { event } = await seedEvent();

      await saveEventFields(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version,
        fields: { ...EVENT_FIELDS, distanceMeters: "10000" },
      });

      expect(
        await codeOf(
          saveEventFields(db, {
            actor: editor,
            eventId: event.id,
            expectedVersion: event.version,
            fields: { ...EVENT_FIELDS, distanceMeters: "5000" },
          }),
        ),
      ).toBe("CONFLICT");

      const [current] = await db.select().from(events).where(eq(events.id, event.id));
      expect(current.distanceMeters, "the first save survived intact").toBe(10000);
    });

    it("tells a vanished record apart from a stale one", async () => {
      const { event, translation } = await seedEvent();
      await db.delete(events).where(eq(events.id, event.id));

      expect(
        await codeOf(
          saveEventTranslation(db, {
            actor: author,
            translationId: translation.id,
            expectedVersion: translation.version,
            fields: FIELDS,
          }),
        ),
      ).toBe("NOT_FOUND");
    });
  });

  describe("a slug is editable before publication and stable afterwards", () => {
    it("accepts a new slug while the event has never been published", async () => {
      const { translation } = await seedEvent();

      const saved = await saveEventTranslation(db, {
        actor: author,
        translationId: translation.id,
        expectedVersion: translation.version,
        fields: { ...FIELDS, slug: "crosul-aniversar-2026" },
      });

      expect(saved.slug).toBe("crosul-aniversar-2026");
    });

    it("refuses a new slug once the page has been public", async () => {
      const { translation } = await seedEvent({ status: "PUBLISHED" });

      expect(
        await codeOf(
          saveEventTranslation(db, {
            actor: editor,
            translationId: translation.id,
            expectedVersion: translation.version,
            acknowledgeLiveEdit: true,
            fields: { ...FIELDS, slug: "alta-adresa" },
          }),
        ),
      ).toBe("FORBIDDEN");
    });

    it("keeps refusing after the page is unpublished, because the URL was still public", async () => {
      const { event, translation } = await seedEvent({ status: "PUBLISHED" });

      await transitionEvent(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version,
        to: "DRAFT",
      });

      expect(
        await codeOf(
          saveEventTranslation(db, {
            actor: editor,
            translationId: translation.id,
            expectedVersion: translation.version,
            fields: { ...FIELDS, slug: "alta-adresa" },
          }),
        ),
      ).toBe("FORBIDDEN");
    });
  });

  describe("the event row: every column an organizer owns", () => {
    it("saves both times in the event timezone and the map link", async () => {
      const { event } = await seedEvent();
      const link = ["https:/", "maps.example.test", "brasov"].join("/");

      const saved = await saveEventFields(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version,
        fields: {
          ...EVENT_FIELDS,
          startsAtWallTime: "2026-10-11T09:00",
          raceStartsAtWallTime: "2026-10-11T10:00",
          mapUrl: link,
          featured: true,
        },
      });

      // 09:00 in Brașov in October is 06:00 UTC.
      expect(saved.startsAt.toISOString()).toBe("2026-10-11T06:00:00.000Z");
      expect(saved.raceStartsAt?.toISOString()).toBe("2026-10-11T07:00:00.000Z");
      expect(saved.mapUrl).toBe(link);
      expect(saved.featured).toBe(true);
      expect(saved.updatedByStaffUserId).toBe(editor.id);
    });

    it("saves the kind, the status, the distance and the climb", async () => {
      const { event } = await seedEvent();

      const saved = await saveEventFields(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version,
        fields: {
          ...EVENT_FIELDS,
          kind: "TRAIL_RUN",
          eventStatus: "CANCELLED",
          distanceMeters: "14000",
          elevationGainMeters: "600",
        },
      });

      expect(saved.kind).toBe("TRAIL_RUN");
      expect(saved.eventStatus).toBe("CANCELLED");
      expect(saved.distanceMeters).toBe(14000);
      expect(saved.elevationGainMeters).toBe(600);
    });

    it("saves the end time and refuses one before the start", async () => {
      const { event } = await seedEvent();

      const saved = await saveEventFields(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version,
        fields: { ...EVENT_FIELDS, endsAtWallTime: "2026-10-11T12:00" },
      });
      expect(saved.endsAt?.toISOString()).toBe("2026-10-11T09:00:00.000Z");

      expect(
        await codeOf(
          saveEventFields(db, {
            actor: editor,
            eventId: event.id,
            expectedVersion: saved.version,
            fields: { ...EVENT_FIELDS, endsAtWallTime: "2026-10-11T08:00" },
          }),
        ),
      ).toBe("VALIDATION_ERROR");
    });

    it("interprets the times in the timezone the same save sets", async () => {
      const { event } = await seedEvent();

      const saved = await saveEventFields(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version,
        fields: { ...EVENT_FIELDS, timezone: "UTC", startsAtWallTime: "2026-10-11T09:00" },
      });

      expect(saved.timezone).toBe("UTC");
      expect(saved.startsAt.toISOString()).toBe("2026-10-11T09:00:00.000Z");
    });

    it("refuses a timezone the platform does not know", async () => {
      const { event } = await seedEvent();

      expect(
        await codeOf(
          saveEventFields(db, {
            actor: editor,
            eventId: event.id,
            expectedVersion: event.version,
            fields: { ...EVENT_FIELDS, timezone: "Europe/Brasov" },
          }),
        ),
      ).toBe("VALIDATION_ERROR");
    });

    it("saves the meeting point coordinates", async () => {
      const { event } = await seedEvent();

      const saved = await saveEventFields(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version,
        fields: { ...EVENT_FIELDS, latitude: "45.6427", longitude: "25.5887" },
      });

      expect(Number(saved.latitude)).toBeCloseTo(45.6427, 4);
      expect(Number(saved.longitude)).toBeCloseTo(25.5887, 4);
    });

    it.each([
      ["only a latitude", { latitude: "45.6427", longitude: "" }],
      ["only a longitude", { latitude: "", longitude: "25.5887" }],
      ["a latitude past the pole", { latitude: "95", longitude: "25.5887" }],
      ["something that is not a number", { latitude: "nord", longitude: "25.5887" }],
    ])("refuses %s with a message rather than a constraint", async (_name, coordinates) => {
      const { event } = await seedEvent();

      expect(
        await codeOf(
          saveEventFields(db, {
            actor: editor,
            eventId: event.id,
            expectedVersion: event.version,
            fields: { ...EVENT_FIELDS, ...coordinates },
          }),
        ),
      ).toBe("VALIDATION_ERROR");
    });

    it("clears the race start and the map link when the fields are emptied", async () => {
      const { event } = await seedEvent();
      const first = await saveEventFields(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version,
        fields: { ...EVENT_FIELDS, raceStartsAtWallTime: "2026-10-11T10:00" },
      });

      const cleared = await saveEventFields(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: first.version,
        fields: EVENT_FIELDS,
      });

      expect(cleared.raceStartsAt).toBeNull();
      expect(cleared.mapUrl).toBeNull();
    });

    it("refuses a race start before the event begins, with a message rather than a constraint", async () => {
      const { event } = await seedEvent();

      expect(
        await codeOf(
          saveEventFields(db, {
            actor: editor,
            eventId: event.id,
            expectedVersion: event.version,
            fields: { ...EVENT_FIELDS, raceStartsAtWallTime: "2026-10-11T08:00" },
          }),
        ),
      ).toBe("VALIDATION_ERROR");
    });

    it.each(["javascript:alert(1)", "http://maps.example.test/brasov", "maps.example.test"])(
      "refuses %s as a map link",
      async (value) => {
        const { event } = await seedEvent();

        expect(
          await codeOf(
            saveEventFields(db, {
              actor: editor,
              eventId: event.id,
              expectedVersion: event.version,
              fields: { ...EVENT_FIELDS, mapUrl: value },
            }),
          ),
        ).toBe("VALIDATION_ERROR");
      },
    );

    it("moves the featured flag off the previous event rather than failing", async () => {
      const first = await seedEvent({ slug: "unu" });
      const second = await seedEvent({ slug: "doi" });

      await saveEventFields(db, {
        actor: editor,
        eventId: first.event.id,
        expectedVersion: first.event.version,
        fields: { ...EVENT_FIELDS, featured: true },
      });
      await saveEventFields(db, {
        actor: editor,
        eventId: second.event.id,
        expectedVersion: second.event.version,
        fields: { ...EVENT_FIELDS, featured: true },
      });

      const featured = await db.select().from(events).where(eq(events.featured, true));
      expect(featured.map((event) => event.id)).toEqual([second.event.id]);
    });
  });

  /**
   * The registration block, which the pilot's capacity guard used to make untestable and the
   * seed used to be the only way to set.
   */
  describe("the registration block", () => {
    it("refuses capacity and a declaration on an event that does not register here", async () => {
      const { event } = await seedEvent();

      expect(
        await codeOf(
          saveEventFields(db, {
            actor: editor,
            eventId: event.id,
            expectedVersion: event.version,
            fields: { ...EVENT_FIELDS, registrationMode: "NONE", capacity: "20" },
          }),
        ),
      ).toBe("VALIDATION_ERROR");
    });

    it("refuses an internal event with no declaration to sign", async () => {
      const { event } = await seedEvent();

      expect(
        await codeOf(
          saveEventFields(db, {
            actor: editor,
            eventId: event.id,
            expectedVersion: event.version,
            fields: { ...EVENT_FIELDS, registrationMode: "INTERNAL", capacity: "6" },
          }),
        ),
      ).toBe("VALIDATION_ERROR");
    });

    it("refuses an external event with no link, and a link on any other mode", async () => {
      const { event } = await seedEvent();
      const link = ["https:/", "entries.example.test", "race"].join("/");

      expect(
        await codeOf(
          saveEventFields(db, {
            actor: editor,
            eventId: event.id,
            expectedVersion: event.version,
            fields: { ...EVENT_FIELDS, registrationMode: "EXTERNAL" },
          }),
        ),
      ).toBe("VALIDATION_ERROR");

      expect(
        await codeOf(
          saveEventFields(db, {
            actor: editor,
            eventId: event.id,
            expectedVersion: event.version,
            fields: { ...EVENT_FIELDS, registrationMode: "NONE", externalRegistrationUrl: link },
          }),
        ),
      ).toBe("VALIDATION_ERROR");
    });

    it("saves an external event with its provider and link", async () => {
      const { event } = await seedEvent();
      const link = ["https:/", "entries.example.test", "race"].join("/");

      const saved = await saveEventFields(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version,
        fields: {
          ...EVENT_FIELDS,
          registrationMode: "EXTERNAL",
          externalProvider: "Example Entries",
          externalRegistrationUrl: link,
        },
      });

      expect(saved.registrationMode).toBe("EXTERNAL");
      expect(saved.externalRegistrationUrl).toBe(link);
      expect(saved.externalProvider).toBe("Example Entries");
    });

    it("refuses a registration window that closes before it opens", async () => {
      const { event } = await seedEvent();

      expect(
        await codeOf(
          saveEventFields(db, {
            actor: editor,
            eventId: event.id,
            expectedVersion: event.version,
            fields: {
              ...EVENT_FIELDS,
              registrationOpensAtWallTime: "2026-10-01T09:00",
              registrationClosesAtWallTime: "2026-09-01T09:00",
            },
          }),
        ),
      ).toBe("VALIDATION_ERROR");
    });

    it.each(["0", "-3", "kilometri"])("refuses %s as a capacity", async (value) => {
      const { event } = await seedEvent();

      expect(
        await codeOf(
          saveEventFields(db, {
            actor: editor,
            eventId: event.id,
            expectedVersion: event.version,
            fields: { ...EVENT_FIELDS, registrationMode: "INTERNAL", capacity: value },
          }),
        ),
      ).toBe("VALIDATION_ERROR");
    });
  });
});
