import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { listTranslationsForEvent } from "@/modules/content/events/repository";
import {
  createEvent,
  duplicateEvent,
  publishEvent,
  repeatEvent,
  saveEventAndTranslations,
  saveEventFields,
  transitionEvent,
} from "@/modules/content/events/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-060-01, §NNN — the Organizer reads the events and changes none of them (the owner,
 * 2026-09-28: «Organizatorul nu ar trebui să poată edita evenimentele»).
 *
 * Each of the event's writes is refused with FORBIDDEN for an Organizer, and the row is exactly as
 * it was — refused before anything is written — while the same call by an Administrator is
 * accepted. The Organizer's reads and registration verbs are the business of §289's tests.
 */
describe("BR-REQ-060-01 §NNN the Organizer changes no event", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let organizer: StaffUser;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [organizer] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Organizer", role: "MODERATOR" }).returning();
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  });

  const EVENT_FIELDS = {
    type: "RACE",
    eventStatus: "SCHEDULED",
    timezone: "Europe/Bucharest",
    startsAtWallTime: "2026-10-11T09:00",
    endsAtWallTime: "",
    raceStartsAtWallTime: "",
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
      ro: { slug: "crosul-aniversar", title: "Crosul aniversar", excerpt: "Cursa clubului." },
      en: { slug: "anniversary-cross", title: "Anniversary cross", excerpt: "The club's own race." },
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

  const rowOf = async (id: string) => (await db.select().from(events).where(eq(events.id, id)).limit(1))[0];
  const countEvents = async () => (await db.select({ id: events.id }).from(events)).length;

  it("refuses the Organizer a new event, and makes none", async () => {
    expect(await codeOf(createEvent(db, { actor: organizer, fields: NEW_EVENT }))).toBe("FORBIDDEN");
    expect(await countEvents()).toBe(0);
  });

  it("refuses the Organizer a save of the settings, writing nothing; the Administrator's is accepted", async () => {
    const created = await createEvent(db, { actor: admin, fields: NEW_EVENT });
    const before = await rowOf(created.id);
    const moved = { ...EVENT_FIELDS, locationName: "Poiana Brașov", capacity: "" };

    expect(await codeOf(saveEventFields(db, { actor: organizer, eventId: created.id, expectedVersion: before.version, fields: moved }))).toBe("FORBIDDEN");
    expect(
      await codeOf(saveEventAndTranslations(db, { actor: organizer, eventId: created.id, expectedVersion: before.version, fields: moved, translations: [] })),
    ).toBe("FORBIDDEN");
    expect(await rowOf(created.id)).toEqual(before);

    const saved = await saveEventFields(db, { actor: admin, eventId: created.id, expectedVersion: before.version, fields: moved });
    expect(saved.version).toBe(before.version + 1);
  });

  it("refuses the Organizer the words of an event too — they were never the Organizer's (§207)", async () => {
    const created = await createEvent(db, { actor: admin, fields: NEW_EVENT });
    const [ro] = await listTranslationsForEvent(db, created.id);
    expect(
      await codeOf(
        saveEventAndTranslations(db, {
          actor: organizer,
          eventId: created.id,
          translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: { slug: ro.slug, title: "Alt titlu", excerpt: "Alt rezumat." } }],
        }),
      ),
    ).toBe("FORBIDDEN");
    expect((await listTranslationsForEvent(db, created.id))[0].title).toBe("Crosul aniversar");
  });

  it("refuses the Organizer the cancellation and the update notice, writing nothing", async () => {
    const created = await createEvent(db, { actor: admin, fields: NEW_EVENT });
    const before = await rowOf(created.id);
    const cancelled = { ...EVENT_FIELDS, eventStatus: "CANCELLED" };
    const reason = { ro: "Ploaie torențială.", en: "Torrential rain." };

    expect(
      await codeOf(
        saveEventFields(db, { actor: organizer, eventId: created.id, expectedVersion: before.version, fields: cancelled, cancellation: { reason, notify: true } }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await codeOf(
        saveEventFields(db, {
          actor: organizer,
          eventId: created.id,
          expectedVersion: before.version,
          fields: EVENT_FIELDS,
          notice: { notify: true, note: { ro: "Startul se mută.", en: "The start moves." } },
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(await rowOf(created.id)).toEqual(before);

    const saved = await saveEventFields(db, { actor: admin, eventId: created.id, expectedVersion: before.version, fields: cancelled, cancellation: { reason, notify: false } });
    expect(saved.eventStatus).toBe("CANCELLED");
  });

  it("refuses the Organizer every move of the workflow, writing nothing; the Administrator publishes", async () => {
    const created = await createEvent(db, { actor: admin, fields: NEW_EVENT });
    const before = await rowOf(created.id);

    expect(await codeOf(publishEvent(db, { actor: organizer, eventId: created.id, expectedVersion: before.version }))).toBe("FORBIDDEN");
    for (const to of ["IN_REVIEW", "ARCHIVED", "PUBLISHED"] as const) {
      expect(await codeOf(transitionEvent(db, { actor: organizer, eventId: created.id, expectedVersion: before.version, to })), to).toBe("FORBIDDEN");
    }
    expect(await rowOf(created.id)).toEqual(before);

    const published = await publishEvent(db, { actor: admin, eventId: created.id, expectedVersion: before.version });
    expect(published.editorialStatus).toBe("PUBLISHED");
    // Nor may the Organizer take it down again.
    expect(await codeOf(transitionEvent(db, { actor: organizer, eventId: created.id, expectedVersion: published.version, to: "DRAFT" }))).toBe("FORBIDDEN");
    expect((await rowOf(created.id)).editorialStatus).toBe("PUBLISHED");
  });

  it("refuses the Organizer a copy and a series, making no event", async () => {
    const created = await createEvent(db, { actor: admin, fields: NEW_EVENT });

    expect(await codeOf(duplicateEvent(db, { actor: organizer, eventId: created.id }))).toBe("FORBIDDEN");
    expect(
      await codeOf(repeatEvent(db, { actor: organizer, eventId: created.id, rule: { cadence: "WEEKLY", until: null, publish: false } })),
    ).toBe("FORBIDDEN");
    expect(await countEvents()).toBe(1);

    await duplicateEvent(db, { actor: admin, eventId: created.id });
    expect(await countEvents()).toBe(2);
  });
});
