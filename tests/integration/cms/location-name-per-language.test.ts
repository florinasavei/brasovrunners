import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { listTranslationsForEvent } from "@/modules/content/events/repository";
import {
  createEvent,
  missingPublicEventFields,
  repeatEvent,
  saveEventAndTranslations,
  transitionEvent,
} from "@/modules/content/events/service";
import { toCalendarEvent } from "@/modules/events/calendar";
import { calendarLabels } from "@/modules/events/calendar-labels";
import { placeInBox, placeNameIn } from "@/modules/events/domain/place";
import { buildCalendar } from "@/modules/events/ical";
import { findEventNotificationDetails, findPublishedEventBySlug } from "@/modules/events/repository";
import { sportsEventJsonLd } from "@/modules/events/structured-data";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { eventMergeValues } from "@/modules/registrations/signed-declaration";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-011-01 criterion 29 (`DECISIONS.md` §NNN) — the meeting point, once per language.
 *
 * The owner, 2026-09-24, of the Locul box: "There is some redundance on this meeting spot
 * location". It asked for the place twice — a shared "Punct de întâlnire" and then, on each
 * language's tab, "Denumirea locului (în această limbă)", which in practice held the same text
 * again. Now it asks once per language, both required: the Romanian box is the event's own meeting
 * point (`events.location_name`) and the Romanian row's name, the English box the English row's
 * name — stored even when it says what the Romanian says, so no English page borrows the Romanian
 * words. No migration: both columns stay, and an event saved before opens with what its pages show.
 *
 * Every reader that knows its language reads that language's name: the page in each language,
 * the emails (each half of a bilingual message), the calendar file, the structured data and the
 * declaration's `{{eventLocation}}`.
 */
const NOW = new Date("2026-10-01T09:00:00.000Z");
const RO_PLACE = "Parcul Tractorul";
const EN_PLACE = "Tractorul Park";

const EVENT_FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-11-21T09:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: RO_PLACE,
  locationNameEn: EN_PLACE,
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

const TRANSLATIONS = {
  ro: { slug: "crosul", title: "Crosul", excerpt: "Zece kilometri." },
  en: { slug: "the-cross", title: "The cross", excerpt: "Ten kilometres." },
};

describe("BR-REQ-011-01 criterion 29 the meeting point, once per language (§NNN)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;
  let copywriter: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Amalia", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Dani", role: "MODERATOR" }).returning();
    [copywriter] = await db.insert(staffUsers).values({ email: "copy@dev.test", displayName: "Ioana", role: "COPYWRITER" }).returning();
  });

  const rowOf = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
  const namesOf = async (id: string) => {
    const rows = await listTranslationsForEvent(db, id);
    return Object.fromEntries(rows.map((row) => [row.locale, row.locationName]));
  };
  const refusalOf = async (operation: Promise<unknown>) => {
    try {
      await operation;
    } catch (error) {
      if (isDomainError(error)) return { code: error.code, fields: error.fields };
      throw error;
    }
    return null;
  };
  const create = (fields: Record<string, unknown> = {}) =>
    createEvent(db, { actor: admin, fields: { ...EVENT_FIELDS, ...fields, translations: TRANSLATIONS }, now: NOW });
  const publish = async (id: string) => {
    const reviewed = await transitionEvent(db, { actor: admin, eventId: id, expectedVersion: (await rowOf(id)).version, to: "IN_REVIEW", now: NOW });
    return transitionEvent(db, { actor: admin, eventId: id, expectedVersion: reviewed.version, to: "PUBLISHED", now: NOW });
  };
  /** The Organizer's save of the event's fields: no words, as the editor posts it for that role. */
  const saveAsOrganizer = async (id: string, fields: Record<string, unknown>, scope?: "all") =>
    saveEventAndTranslations(db, {
      actor: organizer,
      eventId: id,
      expectedVersion: (await rowOf(id)).version,
      fields: { ...EVENT_FIELDS, ...fields },
      translations: [],
      scope,
      now: NOW,
    });

  describe("the save", () => {
    it("stores the Romanian box as the event's meeting point and on the Romanian row, the English box on the English row", async () => {
      const created = await create();
      expect((await rowOf(created.id)).locationName).toBe(RO_PLACE);
      expect(await namesOf(created.id)).toEqual({ ro: RO_PLACE, en: EN_PLACE });
    });

    it("stores the English name even when it says what the Romanian says, so nothing falls back across languages", async () => {
      const created = await create({ locationNameEn: RO_PLACE });
      expect(await namesOf(created.id)).toEqual({ ro: RO_PLACE, en: RO_PLACE });
    });

    it("is the Organizer's: written with the event's fields under the event's version, leaving the words' versions alone", async () => {
      const created = await create();
      const before = await listTranslationsForEvent(db, created.id);
      await saveAsOrganizer(created.id, { locationName: "Stadionul Tineretului", locationNameEn: "Youth Stadium" });

      expect((await rowOf(created.id)).locationName).toBe("Stadionul Tineretului");
      expect((await rowOf(created.id)).version).toBe(created.version + 1);
      const after = await listTranslationsForEvent(db, created.id);
      expect(Object.fromEntries(after.map((row) => [row.locale, row.locationName]))).toEqual({ ro: "Stadionul Tineretului", en: "Youth Stadium" });
      expect(after.map((row) => row.version)).toEqual(before.map((row) => row.version));

      // A Redactor saving the words with the versions rendered before the place moved is not
      // refused over a place she never touched, and her save does not move it back.
      const en = before.find((row) => row.locale === "en")!;
      await saveEventAndTranslations(db, {
        actor: copywriter,
        eventId: created.id,
        translations: [{ translationId: en.id, expectedVersion: en.version, fields: { slug: en.slug, title: "The anniversary cross", excerpt: en.excerpt ?? "" } }],
        now: NOW,
      });
      expect(await namesOf(created.id)).toEqual({ ro: "Stadionul Tineretului", en: "Youth Stadium" });
    });

    it("refuses a blank name in either language, naming that language's box — unless the place is to be announced", async () => {
      const created = await create();
      expect(await refusalOf(saveAsOrganizer(created.id, { locationNameEn: "  " }))).toEqual({ code: "VALIDATION_ERROR", fields: ["locationNameEn"] });
      expect(await refusalOf(saveAsOrganizer(created.id, { locationName: "" }))).toEqual({ code: "VALIDATION_ERROR", fields: ["locationName"] });
      expect(await namesOf(created.id)).toEqual({ ro: RO_PLACE, en: EN_PLACE });

      await saveAsOrganizer(created.id, { locationToBeAnnounced: true, locationName: "", locationNameEn: "" });
      expect(await namesOf(created.id)).toEqual({ ro: null, en: null });
      expect((await rowOf(created.id)).locationName).toBeNull();
    });

    it("leaves the English row as it is for a caller that posts no English name", async () => {
      const created = await create();
      const withoutEnglish = Object.fromEntries(Object.entries(EVENT_FIELDS).filter(([key]) => key !== "locationNameEn"));
      await saveEventAndTranslations(db, {
        actor: organizer,
        eventId: created.id,
        expectedVersion: created.version,
        fields: { ...withoutEnglish, locationName: "Poiana Brașov" },
        translations: [],
        now: NOW,
      });
      expect(await namesOf(created.id)).toEqual({ ro: "Poiana Brașov", en: EN_PLACE });
    });
  });

  describe("an event saved before §NNN", () => {
    /** The shape every event had until now: the meeting point on the event row, no row names, an address. */
    async function legacy(extra: Partial<typeof events.$inferInsert> = {}) {
      const [event] = await db
        .insert(events)
        .values({ type: "RACE", startsAt: new Date("2026-11-21T07:00:00Z"), locationName: RO_PLACE, locationAddress: "Str. Turnului 5", editorialStatus: "IN_REVIEW", ...extra })
        .returning();
      await db.insert(eventTranslations).values([
        { eventId: event.id, locale: "ro", slug: "vechi", title: "Vechi", excerpt: "Rezumat." },
        { eventId: event.id, locale: "en", slug: "old", title: "Old", excerpt: "Summary." },
      ]);
      return event;
    }

    it("opens with what its pages show in both boxes, publishes as it always did, and one save stores both rows", async () => {
      const event = await legacy();
      const rows = await listTranslationsForEvent(db, event.id);
      const box = (locale: "ro" | "en") => placeInBox(event, rows.find((row) => row.locale === locale)?.locationName);
      expect([box("ro"), box("en")]).toEqual([`${RO_PLACE}, Str. Turnului 5`, `${RO_PLACE}, Str. Turnului 5`]);

      // Its English page has always shown the event's name: not a missing English place.
      expect(missingPublicEventFields(event, rows)).toEqual([]);
      const published = await transitionEvent(db, { actor: admin, eventId: event.id, expectedVersion: event.version, to: "PUBLISHED", now: NOW });
      expect((await findPublishedEventBySlug(db, "en", "old"))?.locationName).toBe(RO_PLACE);

      // The editor posts what the boxes showed; the save writes it to both rows.
      await saveEventAndTranslations(db, {
        actor: organizer,
        eventId: event.id,
        expectedVersion: published.version,
        fields: { ...EVENT_FIELDS, locationName: box("ro"), locationNameEn: box("en") },
        translations: [],
        now: NOW,
      });
      expect(await namesOf(event.id)).toEqual({ ro: `${RO_PLACE}, Str. Turnului 5`, en: `${RO_PLACE}, Str. Turnului 5` });
      expect(await rowOf(event.id)).toMatchObject({ locationName: `${RO_PLACE}, Str. Turnului 5`, locationAddress: null });
    });

    it("moves its English page with the Romanian box when only the Romanian moved (found by review)", async () => {
      const event = await legacy();
      const rows = await listTranslationsForEvent(db, event.id);
      const englishBox = placeInBox(event, rows.find((row) => row.locale === "en")?.locationName);
      // The organizer changes the Romanian box and leaves the English one as it opened: the old name.
      await saveEventAndTranslations(db, {
        actor: organizer,
        eventId: event.id,
        expectedVersion: event.version,
        fields: { ...EVENT_FIELDS, locationName: "Parcul Titulescu", locationNameEn: englishBox },
        translations: [],
        now: NOW,
      });
      // The English page followed the event's name before; it follows the Romanian now.
      expect(await namesOf(event.id)).toEqual({ ro: "Parcul Titulescu", en: "Parcul Titulescu" });
    });

    it("is refused publication without a place its English page could show, naming the English box", async () => {
      // The meeting point typed only as the Romanian row's own name: the English page would show nothing.
      const event = await legacy({ locationName: null, locationAddress: null });
      await db.update(eventTranslations).set({ locationName: RO_PLACE }).where(eq(eventTranslations.locale, "ro"));
      expect(missingPublicEventFields(event, await listTranslationsForEvent(db, event.id))).toEqual(["locationNameEn"]);
      const refused = await transitionEvent(db, { actor: admin, eventId: event.id, expectedVersion: event.version, to: "PUBLISHED", now: NOW }).catch((error: unknown) => error);
      expect(isDomainError(refused) && refused.code).toBe("VALIDATION_ERROR");
      expect(isDomainError(refused) && refused.message).toContain("locationNameEn");
    });
  });

  describe("every reader in a language reads that language's name", () => {
    async function publishedEvent() {
      const created = await create();
      await publish(created.id);
      return created.id;
    }

    it("the page and the email details in each language", async () => {
      const id = await publishedEvent();
      expect((await findPublishedEventBySlug(db, "ro", "crosul"))?.locationName).toBe(RO_PLACE);
      expect((await findPublishedEventBySlug(db, "en", "the-cross"))?.locationName).toBe(EN_PLACE);
      const details = await findEventNotificationDetails(db, id, "ro");
      expect(details?.locationName).toBe(RO_PLACE);
      expect(details?.locationNames).toEqual({ ro: RO_PLACE, en: EN_PLACE });
      expect((await findEventNotificationDetails(db, id, "en"))?.locationName).toBe(EN_PLACE);
    });

    it("the calendar file and the structured data of the English page", async () => {
      await publishedEvent();
      const en = (await findPublishedEventBySlug(db, "en", "the-cross"))!;
      const ics = buildCalendar({ events: [toCalendarEvent(en, "en", NOW)], baseUrl: "https://example.test", name: "x", labels: calendarLabels("en") }).replace(/\r\n /g, "");
      expect(ics).toContain(`LOCATION:${EN_PLACE}`);
      expect(ics).not.toContain(RO_PLACE);
      const jsonLd = sportsEventJsonLd(en, "https://example.test/en/events/the-cross", "Brașov Runners", [], "en");
      expect(jsonLd.location).toMatchObject({ "@type": "Place", name: EN_PLACE });
      const ro = (await findPublishedEventBySlug(db, "ro", "crosul"))!;
      expect(sportsEventJsonLd(ro, "https://example.test/ro/evenimente/crosul", "Brașov Runners", [], "ro").location).toMatchObject({ name: RO_PLACE });
    });

    it("the declaration's {{eventLocation}}, in the declaration's language", async () => {
      const id = await publishedEvent();
      expect((await eventMergeValues(db, id, "ro"))?.values.eventLocation).toBe(RO_PLACE);
      expect((await eventMergeValues(db, id, "en"))?.values.eventLocation).toBe(EN_PLACE);
    });

    it("each half of a bilingual email, in its own language", async () => {
      const id = await publishedEvent();
      const identity = canonicalizeEmail("ana@example.ro");
      const [participant] = await db.insert(participants).values({ ...identity, deliveryEmail: identity.deliveryEmail, defaultName: "Ana Pop" }).returning();
      const [registration] = await db
        .insert(registrations)
        .values({
          eventId: id,
          participantId: participant.id,
          status: "PENDING_EMAIL_CONFIRMATION",
          locale: "ro",
          registeredName: "Ana Pop",
          displayName: "Ana P.",
          privacyNoticeVersion: 1,
          privacyAcknowledgedAt: NOW,
          resultsNameConsent: false,
          listOptOut: false,
          resultsConsentVersion: 1,
        })
        .returning();
      const [row] = await db
        .insert(emailOutbox)
        .values({
          participantId: participant.id,
          registrationId: registration.id,
          messageType: "EVENT_REMINDER",
          locale: "ro",
          recipientEmail: "ana@example.ro",
          payloadJson: {},
          idempotencyKey: `reminder-${registration.id}`,
        })
        .returning();
      const message = await renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
      const [romanian, english] = message.text.split("— — —");
      expect(romanian).toContain(RO_PLACE);
      expect(romanian).not.toContain(EN_PLACE);
      expect(english).toContain(EN_PLACE);
      expect(english).not.toContain(RO_PLACE);
    });
  });

  describe("a series (§130, §350)", () => {
    /** A group run every Sunday, 11 Oct to 8 Nov, made the way the editor makes it. */
    async function series() {
      const created = await create({ type: "GROUP_RUN", startsAtWallTime: "2026-10-11T08:00" });
      await repeatEvent(db, { actor: admin, eventId: created.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-08", publish: false }, now: NOW });
      const dates = await db.select().from(events).where(eq(events.repeatOf, created.id)).orderBy(asc(events.startsAt));
      expect(dates.length).toBeGreaterThan(1);
      return { source: created, dates };
    }

    it("carries both languages' names to every date a save for all dates reaches", async () => {
      const { source, dates } = await series();
      // Every date is made with the source's names in both rows.
      for (const date of dates) expect(await namesOf(date.id)).toEqual({ ro: RO_PLACE, en: EN_PLACE });

      const result = await saveAsOrganizer(source.id, { type: "GROUP_RUN", startsAtWallTime: "2026-10-11T08:00", locationName: "Piața Sfatului", locationNameEn: "Council Square" }, "all");
      expect(result.appliedTo).toBe(dates.length);
      for (const date of dates) {
        expect((await rowOf(date.id)).locationName).toBe("Piața Sfatului");
        expect(await namesOf(date.id)).toEqual({ ro: "Piața Sfatului", en: "Council Square" });
      }
    });

    it("carries a name changed in English alone, and gives each date a new version", async () => {
      const { source, dates } = await series();
      const versions = dates.map((date) => date.version);
      await saveAsOrganizer(source.id, { type: "GROUP_RUN", startsAtWallTime: "2026-10-11T08:00", locationNameEn: "Tractorul Park, main gate" }, "all");
      for (const [index, date] of dates.entries()) {
        expect(await namesOf(date.id)).toEqual({ ro: RO_PLACE, en: "Tractorul Park, main gate" });
        expect((await rowOf(date.id)).version).toBe(versions[index] + 1);
      }
    });

    it("moves an older series' English pages with the Romanian box on every date, the edited one too (found by review)", async () => {
      const { source, dates } = await series();
      // An older series: no language has a name of its own; every English page shows the event's.
      const ids = [source.id, ...dates.map((date) => date.id)];
      await db.update(eventTranslations).set({ locationName: null });
      const rows = await listTranslationsForEvent(db, source.id);
      const englishBox = placeInBox(await rowOf(source.id), rows.find((row) => row.locale === "en")?.locationName);
      expect(englishBox).toBe(RO_PLACE);

      // Only the Romanian box changes; the English one is posted as it opened.
      const result = await saveAsOrganizer(
        source.id,
        { type: "GROUP_RUN", startsAtWallTime: "2026-10-11T08:00", locationName: "Parcul Titulescu", locationNameEn: englishBox },
        "all",
      );
      expect(result.appliedTo).toBe(dates.length);
      // Every date's English page names the same place, and it is the new one — no date left behind.
      for (const id of ids) {
        const names = await namesOf(id);
        expect(placeNameIn(await rowOf(id), names.en)).toBe("Parcul Titulescu");
        expect(names).toEqual({ ro: "Parcul Titulescu", en: "Parcul Titulescu" });
      }
    });

    it("moves no date's place on a save that changed no page's place", async () => {
      const { source, dates } = await series();
      const [first] = dates;
      // One date at another place, on its own.
      await saveAsOrganizer(first.id, { type: "GROUP_RUN", startsAtWallTime: "2026-10-18T08:00", locationName: "Poiana Brașov", locationNameEn: "Poiana Brașov" });
      // A save for all dates that changes only the distance reaches every date, and not its place.
      await saveAsOrganizer(source.id, { type: "GROUP_RUN", startsAtWallTime: "2026-10-11T08:00", distanceMeters: "8000" }, "all");
      expect((await rowOf(first.id)).distanceMeters).toBe(8000);
      expect(await namesOf(first.id)).toEqual({ ro: "Poiana Brașov", en: "Poiana Brașov" });
      expect((await rowOf(first.id)).locationName).toBe("Poiana Brașov");
    });
  });
});
