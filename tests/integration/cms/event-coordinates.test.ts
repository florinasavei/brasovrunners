import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, createEventAndPublish, saveEventAndTranslations } from "@/modules/content/events/service";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN (amending §402) — «Coordonate», the pair the forecast reads when the map link carries no pin:
 * saved from the editor's one box as two columns, cleared by an empty box, left alone by a caller that
 * does not post it, refused when it is not a pair in range, withheld from the public with the place
 * while it is to be announced (§328), and refused by the database itself when half a pair or a pair
 * out of range is written some other way.
 */
const NOW = new Date("2026-10-01T09:00:00.000Z");

const EVENT_FIELDS = {
  type: "GROUP_RUN",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-10-03T08:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Stația de telecabină Tâmpa",
  locationAddress: "",
  surface: null,
  difficulty: null,
  costType: null,
  mapUrl: "https://maps.app.goo.gl/AbCdEf123",
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

const TRANSLATIONS = {
  ro: { slug: "tura-pe-tampa", title: "Tură pe Tâmpa", excerpt: "Urcare pe Tâmpa." },
  en: { slug: "tampa-trail", title: "Tâmpa trail run", excerpt: "Up Tâmpa." },
};

describe("§NNN the event's «Coordonate»", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Amalia", role: "ADMIN" }).returning();
  });

  const rowOf = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
  const save = async (id: string, fields: Record<string, unknown>) =>
    saveEventAndTranslations(db, { actor: admin, eventId: id, expectedVersion: (await rowOf(id)).version, fields, translations: [], now: NOW });

  it("saves the box as two columns, keeps them when a save does not post it, and clears them on an empty box", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...EVENT_FIELDS, coordinates: "45.6384, 25.5921", translations: TRANSLATIONS }, now: NOW });
    expect(await rowOf(created.id)).toMatchObject({ latitude: 45.6384, longitude: 25.5921 });

    // A caller that does not edit the place (a fixture, an older form) leaves the pair alone.
    await save(created.id, { ...EVENT_FIELDS });
    expect(await rowOf(created.id)).toMatchObject({ latitude: 45.6384, longitude: 25.5921 });

    // The Romanian keyboard's decimal comma is read too.
    await save(created.id, { ...EVENT_FIELDS, coordinates: "45,61; 25,6" });
    expect(await rowOf(created.id)).toMatchObject({ latitude: 45.61, longitude: 25.6 });

    await save(created.id, { ...EVENT_FIELDS, coordinates: "" });
    expect(await rowOf(created.id)).toMatchObject({ latitude: null, longitude: null });
  });

  it("refuses a box that is not a pair in range, naming it, and writes nothing", async () => {
    for (const bad of ["45.6384", "Brașov", "95, 25"]) {
      const refused = await createEvent(db, { actor: admin, fields: { ...EVENT_FIELDS, coordinates: bad, translations: TRANSLATIONS }, now: NOW }).catch(
        (error: unknown) => error,
      );
      expect(isDomainError(refused) && refused.code, bad).toBe("VALIDATION_ERROR");
      expect(isDomainError(refused) && refused.fields, bad).toEqual(["coordinates"]);
    }
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it("hands the public reader the pair, and withholds it with the place while it is to be announced (§328)", async () => {
    const shown = await createEventAndPublish(db, {
      actor: admin,
      fields: { ...EVENT_FIELDS, coordinates: "45.6384, 25.5921", translations: TRANSLATIONS },
      publish: true,
      now: NOW,
    });
    expect(shown.published).toBe(true);
    expect(await findPublishedEventBySlug(db, "ro", "tura-pe-tampa")).toMatchObject({ latitude: 45.6384, longitude: 25.5921 });

    await db.update(events).set({ locationToBeAnnounced: true }).where(eq(events.id, shown.event.id));
    const hidden = await findPublishedEventBySlug(db, "ro", "tura-pe-tampa");
    expect(hidden?.latitude ?? null).toBeNull();
    expect(hidden?.longitude ?? null).toBeNull();
  });

  it("is refused by the database as half a pair or out of range", async () => {
    const base = { type: "GROUP_RUN" as const, startsAt: NOW, locationName: "Parcul Tractorul" };
    await expect(db.insert(events).values({ ...base, latitude: 45.6 })).rejects.toThrow();
    await expect(db.insert(events).values({ ...base, latitude: 91, longitude: 25 })).rejects.toThrow();
    await expect(db.insert(events).values({ ...base, latitude: 45.6, longitude: 181 })).rejects.toThrow();
    const [fine] = await db.insert(events).values({ ...base, latitude: -45.6, longitude: -25.5 }).returning();
    expect(fine).toMatchObject({ latitude: -45.6, longitude: -25.5 });
  });
});
