import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { findTranslationById } from "@/modules/content/events/repository";
import {
  saveEventFields,
  saveEventTranslation,
  transitionTranslation,
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

  /** The fields a save must carry: the whole allowlisted set, as the form posts it. */
  const FIELDS = {
    slug: "crosul-aniversar",
    title: "Crosul aniversar",
    excerpt: "Cursa clubului.",
    locationName: "Parcul Tractorul",
    locationAddress: "Strada Nicolae Labiș",
    difficultyLabel: "Mediu",
    costText: "Gratuit",
    seoTitle: "Crosul aniversar Brașov Runners",
    seoDescription: "Cursa aniversară a clubului.",
  };

  async function seedTranslation(options: {
    status?: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
    authorId?: string | null;
    publishedAt?: Date | null;
    locale?: "ro" | "en";
  } = {}) {
    const [event] = await db
      .insert(events)
      .values({ kind: "RACE", startsAt: new Date("2026-10-11T06:00:00Z") })
      .returning();

    const [translation] = await db
      .insert(eventTranslations)
      .values({
        eventId: event.id,
        locale: options.locale ?? "ro",
        slug: FIELDS.slug,
        title: FIELDS.title,
        locationName: FIELDS.locationName,
        editorialStatus: options.status ?? "DRAFT",
        authorStaffUserId: options.authorId === undefined ? author.id : options.authorId,
        publishedAt: options.publishedAt ?? null,
      })
      .returning();

    return { event, translation };
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
      const { translation } = await seedTranslation();

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
      const { translation } = await seedTranslation({ authorId: otherAuthor.id });

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
      const { translation } = await seedTranslation();

      const submitted = await transitionTranslation(db, {
        actor: author,
        translationId: translation.id,
        expectedVersion: translation.version,
        to: "IN_REVIEW",
      });

      expect(submitted.editorialStatus).toBe("IN_REVIEW");
    });

    it("refuses an Author who tries to publish, whatever the interface showed", async () => {
      const { translation } = await seedTranslation({ status: "IN_REVIEW" });

      expect(
        await codeOf(
          transitionTranslation(db, {
            actor: author,
            translationId: translation.id,
            expectedVersion: translation.version,
            to: "PUBLISHED",
          }),
        ),
      ).toBe("FORBIDDEN");

      const current = await findTranslationById(db, translation.id);
      expect(current?.editorialStatus, "nothing was written").toBe("IN_REVIEW");
      expect(current?.version).toBe(translation.version);
    });

    it("refuses an Author the event row — the times, the map link, the featured flag", async () => {
      const { event } = await seedTranslation();

      expect(
        await codeOf(
          saveEventFields(db, {
            actor: author,
            eventId: event.id,
            fields: {
              startsAtWallTime: "2026-10-11T09:00",
              raceStartsAtWallTime: "2026-10-11T10:00",
              mapUrl: "",
              featured: true,
            },
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
      const { translation } = await seedTranslation({ status: "IN_REVIEW" });
      const now = new Date("2026-09-04T08:00:00Z");

      const published = await transitionTranslation(db, {
        actor: actorOf(),
        translationId: translation.id,
        expectedVersion: translation.version,
        to: "PUBLISHED",
        now,
      });

      expect(published.editorialStatus).toBe("PUBLISHED");
      expect(published.publishedAt).toEqual(now);
      expect(published.reviewedByStaffUserId).toBe(actorOf().id);
    });

    it("unpublishes back to a draft, and the public queries stop returning it", async () => {
      const { translation } = await seedTranslation({
        status: "PUBLISHED",
        publishedAt: new Date("2026-09-01T00:00:00Z"),
      });

      expect(await listPublishedEvents(db, "ro")).toHaveLength(1);

      await transitionTranslation(db, {
        actor: editor,
        translationId: translation.id,
        expectedVersion: translation.version,
        to: "DRAFT",
      });

      expect(await listPublishedEvents(db, "ro")).toHaveLength(0);
    });

    it("keeps the first publication date when a translation is republished", async () => {
      const firstPublication = new Date("2026-09-01T00:00:00Z");
      const { translation } = await seedTranslation({
        status: "PUBLISHED",
        publishedAt: firstPublication,
      });

      const draft = await transitionTranslation(db, {
        actor: editor,
        translationId: translation.id,
        expectedVersion: translation.version,
        to: "DRAFT",
      });
      const republished = await transitionTranslation(db, {
        actor: editor,
        translationId: translation.id,
        expectedVersion: draft.version,
        to: "IN_REVIEW",
      });
      const finalState = await transitionTranslation(db, {
        actor: editor,
        translationId: translation.id,
        expectedVersion: republished.version,
        to: "PUBLISHED",
        now: new Date("2026-09-20T00:00:00Z"),
      });

      // The date the page first went public is what slug stability and the sitemap read.
      expect(finalState.publishedAt).toEqual(firstPublication);
    });

    it("archives a published translation", async () => {
      const { translation } = await seedTranslation({
        status: "PUBLISHED",
        publishedAt: new Date("2026-09-01T00:00:00Z"),
      });

      const archived = await transitionTranslation(db, {
        actor: admin,
        translationId: translation.id,
        expectedVersion: translation.version,
        to: "ARCHIVED",
      });

      expect(archived.editorialStatus).toBe("ARCHIVED");
      expect(await listPublishedEvents(db, "ro")).toHaveLength(0);
    });

    it("publishes one locale without touching the other", async () => {
      const { event, translation } = await seedTranslation({ status: "IN_REVIEW" });
      const [english] = await db
        .insert(eventTranslations)
        .values({
          eventId: event.id,
          locale: "en",
          slug: "anniversary-cross",
          title: "Anniversary cross",
          locationName: "Tractorul Park",
          editorialStatus: "DRAFT",
        })
        .returning();

      await transitionTranslation(db, {
        actor: editor,
        translationId: translation.id,
        expectedVersion: translation.version,
        to: "PUBLISHED",
      });

      expect(await listPublishedEvents(db, "ro")).toHaveLength(1);
      // BR-REQ-040-02: the English page is a 404 until English is published in its own right.
      expect(await listPublishedEvents(db, "en")).toHaveLength(0);
      const untouched = await findTranslationById(db, english.id);
      expect(untouched?.editorialStatus).toBe("DRAFT");
    });
  });

  describe("criterion 3 an Author cannot edit published content", () => {
    it("refuses the save and writes nothing", async () => {
      const { translation } = await seedTranslation({
        status: "PUBLISHED",
        publishedAt: new Date("2026-09-01T00:00:00Z"),
      });

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
    it("refuses a save on published content when the warning was not answered", async () => {
      const { translation } = await seedTranslation({
        status: "PUBLISHED",
        publishedAt: new Date("2026-09-01T00:00:00Z"),
      });

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
      const { translation } = await seedTranslation({
        status: "PUBLISHED",
        publishedAt: new Date("2026-09-01T00:00:00Z"),
      });

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
      const { translation } = await seedTranslation();

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
      const { translation } = await seedTranslation();

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
      const { translation } = await seedTranslation({ status: "IN_REVIEW" });

      await saveEventTranslation(db, {
        actor: editor,
        translationId: translation.id,
        expectedVersion: translation.version,
        fields: { ...FIELDS, title: "Rescris de editor" },
      });

      expect(
        await codeOf(
          transitionTranslation(db, {
            actor: editor,
            translationId: translation.id,
            expectedVersion: translation.version,
            to: "PUBLISHED",
          }),
        ),
      ).toBe("CONFLICT");

      const current = await findTranslationById(db, translation.id);
      expect(current?.editorialStatus).toBe("IN_REVIEW");
    });

    it("tells a vanished record apart from a stale one", async () => {
      const { event, translation } = await seedTranslation();
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
    it("accepts a new slug while the translation has never been published", async () => {
      const { translation } = await seedTranslation();

      const saved = await saveEventTranslation(db, {
        actor: author,
        translationId: translation.id,
        expectedVersion: translation.version,
        fields: { ...FIELDS, slug: "crosul-aniversar-2026" },
      });

      expect(saved.slug).toBe("crosul-aniversar-2026");
    });

    it("refuses a new slug once the page has been public", async () => {
      const { translation } = await seedTranslation({
        status: "PUBLISHED",
        publishedAt: new Date("2026-09-01T00:00:00Z"),
      });

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
      const { translation } = await seedTranslation({
        status: "PUBLISHED",
        publishedAt: new Date("2026-09-01T00:00:00Z"),
      });

      const unpublished = await transitionTranslation(db, {
        actor: editor,
        translationId: translation.id,
        expectedVersion: translation.version,
        to: "DRAFT",
      });

      expect(
        await codeOf(
          saveEventTranslation(db, {
            actor: editor,
            translationId: translation.id,
            expectedVersion: unpublished.version,
            fields: { ...FIELDS, slug: "alta-adresa" },
          }),
        ),
      ).toBe("FORBIDDEN");
    });
  });

  describe("the event row: two times, a map link and the featured flag", () => {
    it("saves both times in the event timezone and the map link", async () => {
      const { event } = await seedTranslation();
      const link = ["https:/", "maps.example.test", "brasov"].join("/");

      const saved = await saveEventFields(db, {
        actor: editor,
        eventId: event.id,
        fields: {
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

    it("clears the race start when the field is emptied", async () => {
      const { event } = await seedTranslation();
      await saveEventFields(db, {
        actor: editor,
        eventId: event.id,
        fields: {
          startsAtWallTime: "2026-10-11T09:00",
          raceStartsAtWallTime: "2026-10-11T10:00",
          mapUrl: "",
          featured: false,
        },
      });

      const cleared = await saveEventFields(db, {
        actor: editor,
        eventId: event.id,
        fields: {
          startsAtWallTime: "2026-10-11T09:00",
          raceStartsAtWallTime: "",
          mapUrl: "",
          featured: false,
        },
      });

      expect(cleared.raceStartsAt).toBeNull();
      expect(cleared.mapUrl).toBeNull();
    });

    it("refuses a race start before the event begins, with a message rather than a constraint", async () => {
      const { event } = await seedTranslation();

      expect(
        await codeOf(
          saveEventFields(db, {
            actor: editor,
            eventId: event.id,
            fields: {
              startsAtWallTime: "2026-10-11T09:00",
              raceStartsAtWallTime: "2026-10-11T08:00",
              mapUrl: "",
              featured: false,
            },
          }),
        ),
      ).toBe("VALIDATION_ERROR");
    });

    it.each(["javascript:alert(1)", "http://maps.example.test/brasov", "maps.example.test"])(
      "refuses %s as a map link",
      async (value) => {
        const { event } = await seedTranslation();

        expect(
          await codeOf(
            saveEventFields(db, {
              actor: editor,
              eventId: event.id,
              fields: {
                startsAtWallTime: "2026-10-11T09:00",
                raceStartsAtWallTime: "",
                mapUrl: value,
                featured: false,
              },
            }),
          ),
        ).toBe("VALIDATION_ERROR");
      },
    );

    it("moves the featured flag off the previous event rather than failing", async () => {
      const first = await seedTranslation();
      const second = await seedTranslation({ locale: "en" });

      await saveEventFields(db, {
        actor: editor,
        eventId: first.event.id,
        fields: {
          startsAtWallTime: "2026-10-11T09:00",
          raceStartsAtWallTime: "",
          mapUrl: "",
          featured: true,
        },
      });
      await saveEventFields(db, {
        actor: editor,
        eventId: second.event.id,
        fields: {
          startsAtWallTime: "2026-11-11T09:00",
          raceStartsAtWallTime: "",
          mapUrl: "",
          featured: true,
        },
      });

      const featured = await db.select().from(events).where(eq(events.featured, true));
      expect(featured.map((event) => event.id)).toEqual([second.event.id]);
    });
  });
});
