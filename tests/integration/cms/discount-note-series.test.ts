import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { duplicateEvent, repeatEvent } from "@/modules/content/events/service";
import { createEvent } from "@/modules/content/events/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The club's discount on an external event's own fee travels the way its cost does
 * (`DECISIONS.md` §NNN): a series held at a discount is held at it every date, and a duplicate
 * carries it too — the same rule `headlamp.test.ts` proves for `headlampRequired`.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const ZONE = "Europe/Bucharest";

const FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: ZONE,
  startsAtWallTime: "2026-10-07T19:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Piața Sfatului",
  locationNameEn: "Council Square",
  locationAddress: "",
  surface: "ASPHALT",
  difficulty: "MODERATE",
  costType: "PAID",
  costAmount: "75 lei",
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "10000",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "EXTERNAL",
  externalProvider: "Alt club",
  externalRegistrationUrl: "https://alt-club.ro/inscriere",
  participantListVisibility: "HIDDEN" as const,
  capacity: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
};

const TRANSLATIONS = {
  ro: { slug: "cros-partener", title: "Crosul partenerului", excerpt: "Alergăm cu alt club.", discountNote: "40 lei pentru membri BR" },
  en: { slug: "partner-race", title: "The partner's race", excerpt: "We run with another club.", discountNote: "40 lei for BR members" },
};

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
});

const translationsOf = (id: string) => db.select().from(eventTranslations).where(eq(eventTranslations.eventId, id));

describe("the discount note, on a series and a duplicate (§NNN)", () => {
  it("is written on create, for an EXTERNAL + PAID event, in both languages", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const rows = await translationsOf(source.id);
    expect(rows.find((row) => row.locale === "ro")?.discountNote).toBe("40 lei pentru membri BR");
    expect(rows.find((row) => row.locale === "en")?.discountNote).toBe("40 lei for BR members");
  });

  it("every date a series makes from it carries the note, and a duplicate keeps it too", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) {
      const rows = await translationsOf(date.id);
      expect(rows.find((row) => row.locale === "ro")?.discountNote).toBe("40 lei pentru membri BR");
      expect(rows.find((row) => row.locale === "en")?.discountNote).toBe("40 lei for BR members");
    }

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    const copyRows = await translationsOf(copy.id);
    expect(copyRows.find((row) => row.locale === "ro")?.discountNote).toBe("40 lei pentru membri BR");
  });
});
