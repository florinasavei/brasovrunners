import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { listTranslationsForEvent } from "@/modules/content/events/repository";
import { countRegistrationsForEvent } from "@/modules/registrations/repository";
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
  /** Since §201 only an Administrator may put something in front of the public. */
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [author] = await db
      .insert(staffUsers)
      .values({ email: "contributor@dev.test", displayName: "Author", role: "CONTRIBUTOR" })
      .returning();
    [editor] = await db
      .insert(staffUsers)
      .values({ email: "moderator@dev.test", displayName: "Editor", role: "MODERATOR" })
      .returning();
    [admin] = await db
      .insert(staffUsers)
      .values({ email: "superadmin@dev.test", displayName: "Admin", role: "ADMIN" })
      .returning();
  });

  const EVENT_FIELDS = {
    type: "RACE",
    eventStatus: "SCHEDULED",
    timezone: "Europe/Bucharest",
    startsAtWallTime: "2026-10-11T09:00",
    endsAtWallTime: "",
    raceStartsAtWallTime: "",
    // One value for the whole event now (`DECISIONS.md` §36).
    locationName: "Parcul Tractorul",
    locationAddress: "",
    surface: null,
    difficulty: null,
    costType: null,
    mapUrl: "",
    routeUrl: "",
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
      const created = await createEvent(db, { actor: admin, fields: NEW_EVENT });

      expect(created.editorialStatus).toBe("DRAFT");
      expect(created.publishedAt).toBeNull();
      expect(created.createdByStaffUserId).toBe(admin.id);

      const translations = await listTranslationsForEvent(db, created.id);
      // `locale` is a database enum, so ascending is the enum's own order: ro, then en.
      expect(translations.map((t) => t.locale)).toEqual(["ro", "en"]);
      expect(translations.every((t) => t.authorStaffUserId === admin.id)).toBe(true);
    });

    it("stores the rich summary and the description for both languages, the excerpt being the summary's words", async () => {
      // The create form renders the editor's own language panel now, so what it posts is what a
      // save posts — the rich summary, the description, the place's name in that language — and
      // the service writes it through the same function the save uses (`translationColumnsFrom`):
      // the plain `excerpt` the card and the publish check read is derived from the summary from
      // the first insert, not from the first save.
      const paragraph = (text: string) =>
        JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
      const created = await createEvent(db, {
        actor: admin,
        fields: {
          ...EVENT_FIELDS,
          translations: {
            ro: {
              slug: "crosul-aniversar",
              title: "Crosul aniversar",
              excerpt: "",
              excerptBody: paragraph("Cursa clubului,  în parc."),
              body: paragraph("Descrierea întreagă."),
              locationName: "",
            },
            en: {
              slug: "anniversary-cross",
              title: "Anniversary cross",
              excerpt: "",
              excerptBody: paragraph("The club's own race."),
              body: paragraph("The whole description."),
              locationName: "Tractorul Park",
            },
          },
        },
      });

      const [ro, en] = await listTranslationsForEvent(db, created.id);
      // The summary's words, whitespace collapsed, as the save derives them (`DECISIONS.md` §73).
      expect(ro.excerpt).toBe("Cursa clubului, în parc.");
      expect(en.excerpt).toBe("The club's own race.");
      expect(ro.excerptJson).not.toBeNull();
      expect(JSON.stringify(ro.bodyJson)).toContain("Descrierea întreagă.");
      expect(JSON.stringify(en.bodyJson)).toContain("The whole description.");
      // The place's name in this language (migration `0058`): typed for English, blank for
      // Romanian — which means the event's own name, never the other language's.
      expect(en.locationName).toBe("Tractorul Park");
      expect(ro.locationName).toBeNull();
    });

    it("is publishable straight away, because both languages were required", async () => {
      const created = await createEvent(db, { actor: admin, fields: NEW_EVENT });

      const reviewed = await transitionEvent(db, {
        actor: editor,
        eventId: created.id,
        expectedVersion: created.version,
        to: "IN_REVIEW",
      });
      const published = await transitionEvent(db, {
        actor: admin,
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
        actor: admin,
        fields: { ...NEW_EVENT, featured: true },
      });
      const second = await createEvent(db, {
        actor: admin,
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

  /*
    §329 — the owner: "actually this min age must be set at event level!". A box in the
    registration panel, fourteen unless the organizer says otherwise, zero for no minimum; the
    database's CHECK and the schema say the same bounds.
  */
  describe("the minimum age (§329)", () => {
    const withMinAge = (minAge: string | undefined, slug: string) => ({
      ...NEW_EVENT,
      ...(minAge === undefined ? {} : { minAge }),
      translations: {
        ro: { ...NEW_EVENT.translations.ro, slug: `${slug}-ro` },
        en: { ...NEW_EVENT.translations.en, slug: `${slug}-en` },
      },
    });

    it("stores the organizer's number, zero for no minimum, and fourteen when the box is empty or absent", async () => {
      expect((await createEvent(db, { actor: admin, fields: withMinAge("16", "saisprezece") })).minAge).toBe(16);
      expect((await createEvent(db, { actor: admin, fields: withMinAge("0", "fara-minim") })).minAge).toBe(0);
      expect((await createEvent(db, { actor: admin, fields: withMinAge("", "gol") })).minAge).toBe(14);
      expect((await createEvent(db, { actor: admin, fields: withMinAge(undefined, "absent") })).minAge).toBe(14);
    });

    it("refuses a number no person has, or a fraction, naming the box, and writes nothing", async () => {
      for (const minAge of ["100", "-1", "14.5", "paisprezece"]) {
        let fields: readonly string[] = [];
        try {
          await createEvent(db, { actor: admin, fields: withMinAge(minAge, `refuzat-${fields.length}`) });
        } catch (error) {
          if (!isDomainError(error)) throw error;
          expect(error.code, minAge).toBe("VALIDATION_ERROR");
          fields = error.fields;
        }
        expect(fields, minAge).toContain("minAge");
      }
      expect(await db.select().from(events)).toHaveLength(0);
    });

    it("travels with a copy, like the capacity: who may enter is the race's, not one edition's", async () => {
      const source = await createEvent(db, { actor: admin, fields: withMinAge("18", "optsprezece") });
      expect((await duplicateEvent(db, { actor: admin, eventId: source.id })).minAge).toBe(18);
    });
  });

  describe("duplicating", () => {
    it("copies the configuration but never the publication, the date or the flag", async () => {
      const source = await createEvent(db, {
        actor: admin,
        fields: {
          ...NEW_EVENT,
          featured: true,
          distanceMeters: "10000",
          routeUrl: ["https:/", "routes.example.test", "tampa"].join("/"),
        },
      });
      const reviewed = await transitionEvent(db, {
        actor: editor,
        eventId: source.id,
        expectedVersion: source.version,
        to: "IN_REVIEW",
      });
      await transitionEvent(db, {
        actor: admin,
        eventId: source.id,
        expectedVersion: reviewed.version,
        to: "PUBLISHED",
      });

      const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });

      expect(copy.distanceMeters).toBe(10000);
      // BR-REQ-011-01 criterion 8: last year's race is run on last year's route, which is the
      // usual reason for duplicating an event at all.
      expect(copy.routeUrl).toBe(["https:/", "routes.example.test", "tampa"].join("/"));
      expect(copy.editorialStatus, "a copy is a draft").toBe("DRAFT");
      expect(copy.publishedAt, "a copy has never been public").toBeNull();
      expect(copy.featured, "a copy does not take over the landing page").toBe(false);
    });

    it("gives each language a free slug of its own rather than failing on the unique index", async () => {
      const source = await createEvent(db, { actor: admin, fields: NEW_EVENT });

      const first = await duplicateEvent(db, { actor: admin, eventId: source.id });
      const second = await duplicateEvent(db, { actor: admin, eventId: source.id });

      const slugsOf = async (eventId: string) =>
        (await listTranslationsForEvent(db, eventId)).map((t) => t.slug).sort();

      expect(await slugsOf(first.id)).toEqual(["anniversary-cross-2", "crosul-aniversar-2"]);
      expect(await slugsOf(second.id)).toEqual(["anniversary-cross-3", "crosul-aniversar-3"]);
    });

    it("refuses an Author", async () => {
      const source = await createEvent(db, { actor: admin, fields: NEW_EVENT });
      expect(await codeOf(duplicateEvent(db, { actor: author, eventId: source.id }))).toBe(
        "FORBIDDEN",
      );
    });
  });

  describe("deleting", () => {
    it("removes an event nobody has registered for, and its translations with it", async () => {
      const created = await createEvent(db, { actor: admin, fields: NEW_EVENT });

      await deleteEvent(db, { actor: admin, eventId: created.id });

      expect(await db.select().from(events).where(eq(events.id, created.id))).toHaveLength(0);
      expect(await listTranslationsForEvent(db, created.id)).toHaveLength(0);
    });

    it.each([
      ["an author", () => author],
      ["an editor", () => editor],
    ])("refuses %s: deletion is the Administrator's alone", async (_name, actorOf) => {
      const created = await createEvent(db, { actor: admin, fields: NEW_EVENT });

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
      const created = await createEvent(db, { actor: admin, fields: NEW_EVENT });

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

    /**
     * §176 — an event whose only registrations are **test** rows is deleted with them.
     *
     * The refusal was right and its advice was a dead end: "archive it instead", said to
     * somebody looking at an event that was already archived, about rows he had created himself
     * to rehearse with. Nothing new is permitted — clearing test rows is already an
     * Administrator's verb on the event page and already refused in production; this is the two
     * presses in one. A single real registration still blocks it, which is the rule that matters
     * (`AGENTS.md` §10.8).
     *
     * The rows are inserted directly rather than through `addTestRegistrations`, which would
     * need an event that takes registrations and an approved declaration: what is under test
     * here is what `deleteEvent` does about `kind`, and nothing else.
     */
    it("takes its own test registrations with it, and still refuses for a real one", async () => {
      const enter = async (eventId: string, kind: "REAL" | "TEST", email: string) => {
        const [participant] = await db
          .insert(participants)
          .values({
            deliveryEmail: email,
            normalizedEmail: email,
            canonicalEmail: email,
            canonicalizationVersion: 1,
            defaultName: "Cineva",
          })
          .returning();
        await db.insert(registrations).values({
          eventId,
          participantId: participant.id,
          kind,
          status: "CONFIRMED",
          locale: "ro",
          registeredName: "Cineva",
          displayName: "Cineva",
          privacyNoticeVersion: 1,
          privacyAcknowledgedAt: new Date(),
          raceId: null,
          resultsNameConsent: false,
          listOptOut: false,
          resultsConsentVersion: 1,
        });
      };

      const onlyTests = await createEvent(db, { actor: admin, fields: NEW_EVENT });
      await enter(onlyTests.id, "TEST", "t1@test.invalid");
      await enter(onlyTests.id, "TEST", "t2@test.invalid");
      expect(await countRegistrationsForEvent(db, onlyTests.id)).toBe(2);

      await deleteEvent(db, { actor: admin, eventId: onlyTests.id });
      expect(await db.select().from(events).where(eq(events.id, onlyTests.id))).toHaveLength(0);
      // The synthetic rows went with it rather than being left orphaned.
      expect(await countRegistrationsForEvent(db, onlyTests.id)).toBe(0);

      // One real registration beside the test ones, and the whole delete is refused.
      const mixed = await createEvent(db, {
        actor: admin,
        fields: {
          ...NEW_EVENT,
          translations: {
            ro: { ...NEW_EVENT.translations.ro, slug: "cros-mixt" },
            en: { ...NEW_EVENT.translations.en, slug: "mixed-cross" },
          },
        },
      });
      await enter(mixed.id, "TEST", "t3@test.invalid");
      await enter(mixed.id, "REAL", "ana@example.test");

      expect(await codeOf(deleteEvent(db, { actor: admin, eventId: mixed.id }))).toBe("VALIDATION_ERROR");
      expect(await db.select().from(events).where(eq(events.id, mixed.id))).toHaveLength(1);
      // And nothing was cleared on the way to being refused.
      expect(await countRegistrationsForEvent(db, mixed.id)).toBe(2);
    });
  });
});
