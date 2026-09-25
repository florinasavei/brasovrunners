import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { duplicateEvent, repeatEvent, saveEventAndTranslations, saveEventFields } from "@/modules/content/events/service";
import { createEvent } from "@/modules/content/events/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The club's discount on an external event's own fee travels the way its cost does
 * (`DECISIONS.md` §390): a series held at a discount is held at it every date, and a duplicate
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
const reloadEvent = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

/** One language's posted words, the required fields plus whatever the case changes (`series-edit.test.ts`'s `wordsFor`). */
const wordsFor = (row: { slug: string; title: string; excerpt: string | null }, changes: Record<string, unknown> = {}) => ({
  slug: row.slug,
  title: row.title,
  excerpt: row.excerpt ?? "",
  seoTitle: "",
  seoDescription: "",
  ...changes,
});

describe("the discount note, on a series and a duplicate (§390)", () => {
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

  it("a series edit with the 'following' scope carries a new note to the sibling dates, and switching the cost off it the same way clears it there too", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);

    // The discount changes on the source date, posted for both languages, "following" reaching
    // every sibling date (`applyToSeries`'s `SERIES_TRANSLATION_COLUMNS`).
    let row = await reloadEvent(source.id);
    let translations = await translationsOf(source.id);
    let ro = translations.find((t) => t.locale === "ro")!;
    let en = translations.find((t) => t.locale === "en")!;
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS },
      expectedVersion: row.version,
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro, { discountNote: "60 lei pentru membri BR" }) },
        { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en, { discountNote: "60 lei for BR members" }) },
      ],
      scope: "following",
      now: NOW,
    });

    for (const date of dates) {
      const rows = await translationsOf(date.id);
      expect(rows.find((r) => r.locale === "ro")?.discountNote).toBe("60 lei pentru membri BR");
      expect(rows.find((r) => r.locale === "en")?.discountNote).toBe("60 lei for BR members");
    }

    // The cost switches to FREE on the source date, with the same scope: `applyTranslationSave`
    // clears `discountNote` outside EXTERNAL + PAID whatever this save still posted for it
    // (`translationColumnsFrom`), and the series edit carries that cleared column along too.
    row = await reloadEvent(source.id);
    translations = await translationsOf(source.id);
    ro = translations.find((t) => t.locale === "ro")!;
    en = translations.find((t) => t.locale === "en")!;
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS, costType: "FREE", costAmount: "" },
      expectedVersion: row.version,
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro, { discountNote: "60 lei pentru membri BR" }) },
        { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en, { discountNote: "60 lei for BR members" }) },
      ],
      scope: "following",
      now: NOW,
    });

    const sourceRows = await translationsOf(source.id);
    expect(sourceRows.find((r) => r.locale === "ro")?.discountNote).toBeNull();
    expect(sourceRows.find((r) => r.locale === "en")?.discountNote).toBeNull();
    for (const date of dates) {
      const rows = await translationsOf(date.id);
      expect(rows.find((r) => r.locale === "ro")?.discountNote).toBeNull();
      expect(rows.find((r) => r.locale === "en")?.discountNote).toBeNull();
    }
  });

  it("a settings-only save (no text posted) clears the note too, once the mode no longer needs it (§390)", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const before = await translationsOf(source.id);
    expect(before.find((r) => r.locale === "ro")?.discountNote).toBe("40 lei pentru membri BR");

    // `saveEventFields` is what an Organizer with settings rights but no text rights calls: it
    // never posts a translation, so `applyTranslationSave` never runs — the note has to be
    // cleared from the saved event fields themselves, not from posted words.
    const row = await reloadEvent(source.id);
    await saveEventFields(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS, registrationMode: "NONE", externalProvider: "", externalRegistrationUrl: "" },
      expectedVersion: row.version,
      now: NOW,
    });

    const after = await translationsOf(source.id);
    expect(after.find((r) => r.locale === "ro")?.discountNote).toBeNull();
    expect(after.find((r) => r.locale === "en")?.discountNote).toBeNull();
  });
});
