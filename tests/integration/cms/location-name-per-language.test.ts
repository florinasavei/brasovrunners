import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { listTranslationsForEvent } from "@/modules/content/events/repository";
import { createEvent, saveEventTranslation, transitionEvent } from "@/modules/content/events/service";
import { findEventNotificationDetails, findPublishedEventBySlug } from "@/modules/events/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The place's name in each language (migration `0058`) — the owner: "ar trebui să pot pune și
 * denumirea locației în română și în engleză".
 *
 * `DECISIONS.md` §36 moved the meeting point to the event row because it was the same answer
 * typed twice. It still is: the *place* is one fact, required once. What the owner took back is
 * its *name*, which the English page may well spell differently ("Tractorul Park"). So the
 * translation carries an optional name, the event row keeps the fact, and every reader that has
 * a translation at hand — the public page, the preview, the emails — shows the language's name
 * when there is one and the event's otherwise. Never the other language's: a blank English name
 * reads the event row, not the Romanian row (BR-REQ-040-02 is untouched).
 */
describe("the place's name in each language (migration 0058)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let editor: StaffUser;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
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
    // The fact, once (`DECISIONS.md` §36): the club's own words for its own place.
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

  const language = (slug: string, title: string, extra: Record<string, string> = {}) => ({
    slug,
    title,
    excerpt: "Rezumat.",
    ...extra,
  });

  async function publish(eventId: string, version: number) {
    const reviewed = await transitionEvent(db, { actor: editor, eventId, expectedVersion: version, to: "IN_REVIEW" });
    await transitionEvent(db, { actor: admin, eventId, expectedVersion: reviewed.version, to: "PUBLISHED" });
  }

  it("shows the language's name where the club gave one, and the event's where it did not", async () => {
    const created = await createEvent(db, {
      actor: admin,
      fields: {
        ...EVENT_FIELDS,
        translations: {
          ro: language("crosul", "Crosul"),
          en: language("the-cross", "The cross", { locationName: "Tractorul Park" }),
        },
      },
    });
    await publish(created.id, created.version);

    // The public page, in each language.
    expect((await findPublishedEventBySlug(db, "en", "the-cross"))?.locationName).toBe("Tractorul Park");
    expect((await findPublishedEventBySlug(db, "ro", "crosul"))?.locationName).toBe("Parcul Tractorul");
    // The emails, in the runner's language (`findEventNotificationDetails`).
    expect((await findEventNotificationDetails(db, created.id, "en"))?.locationName).toBe("Tractorul Park");
    expect((await findEventNotificationDetails(db, created.id, "ro"))?.locationName).toBe("Parcul Tractorul");
  });

  it("is left as it is by a save that does not mention it, and cleared by one that posts a blank", async () => {
    const created = await createEvent(db, {
      actor: admin,
      fields: {
        ...EVENT_FIELDS,
        translations: {
          ro: language("crosul", "Crosul"),
          en: language("the-cross", "The cross", { locationName: "Tractorul Park" }),
        },
      },
    });
    const [, en] = await listTranslationsForEvent(db, created.id);

    // An older caller that never heard of the field: a column nobody mentioned is a column
    // nobody may erase, the same discipline as `checklist`.
    await saveEventTranslation(db, {
      actor: admin,
      translationId: en.id,
      expectedVersion: en.version,
      fields: language(en.slug, en.title),
    });
    let [, saved] = await listTranslationsForEvent(db, created.id);
    expect(saved.locationName).toBe("Tractorul Park");

    // The form's own blank means "the event's name": stored as null, read as the fallback.
    await saveEventTranslation(db, {
      actor: admin,
      translationId: en.id,
      expectedVersion: saved.version,
      fields: language(en.slug, en.title, { locationName: "  " }),
    });
    [, saved] = await listTranslationsForEvent(db, created.id);
    expect(saved.locationName).toBeNull();

    await publish(created.id, created.version);
    // Blank never borrows the other language: the English page reads the event row.
    expect((await findPublishedEventBySlug(db, "en", "the-cross"))?.locationName).toBe("Parcul Tractorul");
  });
});
