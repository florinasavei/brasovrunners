import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { listTranslationsForEvent } from "@/modules/content/events/repository";
import {
  createEvent,
  deleteEvent,
  duplicateEvent,
  transitionEvent,
} from "@/modules/content/events/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-01 — creating, duplicating and removing an event.
 *
 * Until this existed, changing an event meant editing `src/db/seeds/pilot.ts` and re-running a
 * seed: a developer, a laptop and a deploy for a sentence about a start time. These are the
 * three operations that finish the job the editor started (`DECISIONS.md` §28).
 */
describe("BR-REQ-050-01 event creation, duplication and deletion", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let author: StaffUser;
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
    [editor] = await db
      .insert(staffUsers)
      .values({ email: "editor@dev.test", displayName: "Editor", role: "EDITOR" })
      .returning();
    [admin] = await db
      .insert(staffUsers)
      .values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" })
      .returning();
  });

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

  const NEW_EVENT = {
    ...EVENT_FIELDS,
    translations: {
      ro: {
        slug: "crosul-aniversar",
        title: "Crosul aniversar",
        excerpt: "Cursa clubului.",
      },
      en: {
        slug: "anniversary-cross",
        title: "Anniversary cross",
        excerpt: "The club's own race.",
      },
    },
  };

  async function codeOf(operation: Promise<unknown>): Promise<string> {
    try {
      await operation;
      return "no error";
    } catch (error) {
      if (isDomainError(error)) return error.code;
      throw error;
    }
  }

  describe("creating", () => {
    it("creates the event with a translation in every locale, as a draft", async () => {
      const created = await createEvent(db, { actor: editor, fields: NEW_EVENT });

      expect(created.editorialStatus).toBe("DRAFT");
      expect(created.publishedAt).toBeNull();
      expect(created.createdByStaffUserId).toBe(editor.id);

      const translations = await listTranslationsForEvent(db, created.id);
      // `locale` is a database enum, so ascending is the enum's own order: ro, then en.
      expect(translations.map((t) => t.locale)).toEqual(["ro", "en"]);
      expect(translations.every((t) => t.authorStaffUserId === editor.id)).toBe(true);
    });

    it("is publishable straight away, because both languages were required", async () => {
      const created = await createEvent(db, { actor: editor, fields: NEW_EVENT });

      const reviewed = await transitionEvent(db, {
        actor: editor,
        eventId: created.id,
        expectedVersion: created.version,
        to: "IN_REVIEW",
      });
      const published = await transitionEvent(db, {
        actor: editor,
        eventId: created.id,
        expectedVersion: reviewed.version,
        to: "PUBLISHED",
      });

      expect(published.editorialStatus).toBe("PUBLISHED");
    });

    it("refuses an Author, who has drafts and nothing else", async () => {
      expect(await codeOf(createEvent(db, { actor: author, fields: NEW_EVENT }))).toBe("FORBIDDEN");
    });

    it("clears the previously featured event rather than colliding with the index", async () => {
      const first = await createEvent(db, {
        actor: editor,
        fields: { ...NEW_EVENT, featured: true },
      });
      const second = await createEvent(db, {
        actor: editor,
        fields: {
          ...NEW_EVENT,
          featured: true,
          translations: {
            ro: { ...NEW_EVENT.translations.ro, slug: "alt-cros" },
            en: { ...NEW_EVENT.translations.en, slug: "another-cross" },
          },
        },
      });

      const featured = await db.select().from(events).where(eq(events.featured, true));
      expect(featured.map((event) => event.id)).toEqual([second.id]);
      const [previous] = await db.select().from(events).where(eq(events.id, first.id));
      expect(previous.featured).toBe(false);
    });
  });

  describe("duplicating", () => {
    it("copies the configuration but never the publication, the date or the flag", async () => {
      const source = await createEvent(db, {
        actor: editor,
        fields: { ...NEW_EVENT, featured: true, distanceMeters: "10000" },
      });
      const reviewed = await transitionEvent(db, {
        actor: editor,
        eventId: source.id,
        expectedVersion: source.version,
        to: "IN_REVIEW",
      });
      await transitionEvent(db, {
        actor: editor,
        eventId: source.id,
        expectedVersion: reviewed.version,
        to: "PUBLISHED",
      });

      const copy = await duplicateEvent(db, { actor: editor, eventId: source.id });

      expect(copy.distanceMeters).toBe(10000);
      expect(copy.editorialStatus, "a copy is a draft").toBe("DRAFT");
      expect(copy.publishedAt, "a copy has never been public").toBeNull();
      expect(copy.featured, "a copy does not take over the landing page").toBe(false);
    });

    it("gives each language a free slug of its own rather than failing on the unique index", async () => {
      const source = await createEvent(db, { actor: editor, fields: NEW_EVENT });

      const first = await duplicateEvent(db, { actor: editor, eventId: source.id });
      const second = await duplicateEvent(db, { actor: editor, eventId: source.id });

      const slugsOf = async (eventId: string) =>
        (await listTranslationsForEvent(db, eventId)).map((t) => t.slug).sort();

      expect(await slugsOf(first.id)).toEqual(["anniversary-cross-2", "crosul-aniversar-2"]);
      expect(await slugsOf(second.id)).toEqual(["anniversary-cross-3", "crosul-aniversar-3"]);
    });

    it("refuses an Author", async () => {
      const source = await createEvent(db, { actor: editor, fields: NEW_EVENT });
      expect(await codeOf(duplicateEvent(db, { actor: author, eventId: source.id }))).toBe(
        "FORBIDDEN",
      );
    });
  });

  describe("deleting", () => {
    it("removes an event nobody has registered for, and its translations with it", async () => {
      const created = await createEvent(db, { actor: editor, fields: NEW_EVENT });

      await deleteEvent(db, { actor: admin, eventId: created.id });

      expect(await db.select().from(events).where(eq(events.id, created.id))).toHaveLength(0);
      expect(await listTranslationsForEvent(db, created.id)).toHaveLength(0);
    });

    it.each([
      ["an author", () => author],
      ["an editor", () => editor],
    ])("refuses %s: deletion is the Administrator's alone", async (_name, actorOf) => {
      const created = await createEvent(db, { actor: editor, fields: NEW_EVENT });

      expect(await codeOf(deleteEvent(db, { actor: actorOf(), eventId: created.id }))).toBe(
        "FORBIDDEN",
      );
      expect(await db.select().from(events).where(eq(events.id, created.id))).toHaveLength(1);
    });

    /**
     * The rule that matters: a participant's registration is not tidy-up. It carries the
     * privacy-notice version they acknowledged, and cascading it away to remove a duplicate
     * would destroy evidence AGENTS.md §10.8 exists to keep.
     */
    it("refuses an event that has a registration, whoever asks", async () => {
      const created = await createEvent(db, { actor: editor, fields: NEW_EVENT });

      const [participant] = await db
        .insert(participants)
        .values({
          deliveryEmail: "ana@example.test",
          normalizedEmail: "ana@example.test",
          canonicalEmail: "ana@example.test",
          canonicalizationVersion: 1,
          defaultName: "Ana",
        })
        .returning();
      await db.insert(registrations).values({
        eventId: created.id,
        participantId: participant.id,
        status: "CANCELLED",
        locale: "ro",
        registeredName: "Ana",
        displayName: "Ana",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: new Date(),
        raceId: null,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
        cancelledAt: new Date(),
        cancellationSource: "PARTICIPANT",
      });

      expect(await codeOf(deleteEvent(db, { actor: admin, eventId: created.id }))).toBe(
        "VALIDATION_ERROR",
      );
      expect(await db.select().from(events).where(eq(events.id, created.id))).toHaveLength(1);
    });
  });
});
