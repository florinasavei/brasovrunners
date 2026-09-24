import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  createEvent,
  createEventAndPublish,
  duplicateEvent,
  saveEventAndTranslations,
  transitionEvent,
} from "@/modules/content/events/service";
import { toCalendarEvent } from "@/modules/events/calendar";
import { calendarLabels } from "@/modules/events/calendar-labels";
import { buildCalendar, googleCalendarUrl } from "@/modules/events/ical";
import {
  findEventNotificationDetails,
  findPublishedEventBySlug,
  listPublishedEvents,
  listUpcomingEvents,
} from "@/modules/events/repository";
import { readScheduleItems } from "@/modules/events/domain/schedule";
import { sportsEventJsonLd } from "@/modules/events/structured-data";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { eventMergeValues } from "@/modules/registrations/signed-declaration";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-011-01 criterion 19 (`DECISIONS.md` §328) — the place to be announced, end to end.
 *
 * The owner, 2026-09-23: "I want to be able to set the location as TBD, and to not announce it
 * yet". Publication accepts an event whose place is to be announced and refuses a blank place
 * otherwise; the public queries hand no reader the place the organizer typed meanwhile — its
 * name in either language, its address, its map, the programme rows' places — and every surface
 * built from them says "Locația se anunță în curând"; turning the switch off publishes the place
 * everywhere at once and writes to nobody.
 *
 * The typed place is a sentinel ("Sala Sporturilor Dumitru Popescu") searched for in every
 * rendering, so "never leaks" is checked against the words themselves, not against a field name.
 */
const NOW = new Date("2026-10-01T09:00:00.000Z");
const SECRET_NAME = "Sala Sporturilor Dumitru Popescu";
const SECRET_EN_NAME = "Dumitru Popescu Sports Hall";
const SECRET_MAP = "https://maps.example/sala-secreta";
const SECRET_ROW_PLACE = "Intrarea B a sălii";
const SENTENCE_RO = "Locația se anunță în curând";
const SENTENCE_EN = "Location to be announced soon";

const EVENT_FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-11-21T09:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "",
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
  ro: { slug: "crosul-de-iarna", title: "Crosul de iarnă", excerpt: "Zece kilometri." },
  en: { slug: "winter-cross", title: "Winter cross", excerpt: "Ten kilometres.", locationName: SECRET_EN_NAME },
};

/** The race with its place typed and not announced: the name, the map, a programme row's place. */
const TYPED_EVENT_HALF = {
  ...EVENT_FIELDS,
  locationToBeAnnounced: true,
  locationName: SECRET_NAME,
  mapUrl: SECRET_MAP,
  scheduleRows: [{ date: "2026-11-21", time: "08:00", endTime: "", ro: "Ridicarea kitului", en: "Kit pickup", place: SECRET_ROW_PLACE }],
};
const TYPED_NOT_ANNOUNCED = { ...TYPED_EVENT_HALF, translations: TRANSLATIONS };

/** Whether any of the typed place's words appear anywhere in a rendering. */
const leaks = (text: string) => [SECRET_NAME, SECRET_EN_NAME, SECRET_MAP, SECRET_ROW_PLACE, "sala-secreta"].filter((word) => text.includes(word));

describe("BR-REQ-011-01 criterion 19 the place to be announced (§328)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Amalia", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Dani", role: "MODERATOR" }).returning();
  });

  const rowOf = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

  describe("publication", () => {
    it("publishes with the switch on and no place at all", async () => {
      const result = await createEventAndPublish(db, {
        actor: admin,
        fields: { ...EVENT_FIELDS, locationToBeAnnounced: true, translations: TRANSLATIONS },
        publish: true,
        now: NOW,
      });
      expect(result.published).toBe(true);
      expect(result.refusal).toBeNull();
      const row = await rowOf(result.event.id);
      expect(row).toMatchObject({ editorialStatus: "PUBLISHED", locationName: null, locationToBeAnnounced: true });
    });

    it("refuses a blank place with the switch off, at the save and at the transition", async () => {
      // The create itself: nothing is written, and the refusal names the box.
      const refused = await createEvent(db, { actor: admin, fields: { ...EVENT_FIELDS, translations: TRANSLATIONS }, now: NOW }).catch((error: unknown) => error);
      expect(isDomainError(refused) && refused.code).toBe("VALIDATION_ERROR");
      expect(isDomainError(refused) && refused.fields).toEqual(["locationName"]);
      expect(await db.select().from(events)).toHaveLength(0);

      // A row written before the switch existed, with no place: publication refuses it, as it always has.
      const [legacy] = await db.insert(events).values({ type: "RACE", startsAt: new Date("2026-11-21T07:00:00Z"), editorialStatus: "IN_REVIEW" }).returning();
      await db.insert(eventTranslations).values([
        { eventId: legacy.id, locale: "ro", slug: "vechi", title: "Vechi", excerpt: "Rezumat." },
        { eventId: legacy.id, locale: "en", slug: "old", title: "Old", excerpt: "Summary." },
      ]);
      expect(legacy.locationToBeAnnounced).toBe(false);
      const transition = await transitionEvent(db, { actor: admin, eventId: legacy.id, expectedVersion: legacy.version, to: "PUBLISHED", now: NOW }).catch((error: unknown) => error);
      expect(isDomainError(transition) && transition.code).toBe("VALIDATION_ERROR");
      expect(isDomainError(transition) && transition.message).toContain("locationName");

      // The same row with the place to be announced goes live.
      await db.update(events).set({ locationToBeAnnounced: true }).where(eq(events.id, legacy.id));
      const published = await transitionEvent(db, { actor: admin, eventId: legacy.id, expectedVersion: legacy.version, to: "PUBLISHED", now: NOW });
      expect(published.editorialStatus).toBe("PUBLISHED");
    });

    it("reads every row from before the column as announced (the migration's default)", async () => {
      const [row] = await db.insert(events).values({ type: "GROUP_RUN", startsAt: NOW, locationName: "Parcul Tractorul" }).returning();
      expect(row.locationToBeAnnounced).toBe(false);
    });
  });

  describe("what the public is handed", () => {
    async function published() {
      const result = await createEventAndPublish(db, { actor: admin, fields: TYPED_NOT_ANNOUNCED, publish: true, now: NOW });
      expect(result.published).toBe(true);
      return result.event.id;
    }

    it("keeps the typed place on the row, for staff and for later", async () => {
      const row = await rowOf(await published());
      expect(row).toMatchObject({ locationName: SECRET_NAME, mapUrl: SECRET_MAP, locationToBeAnnounced: true });
      expect(readScheduleItems(row.scheduleItems)[0]?.place).toBe(SECRET_ROW_PLACE);
    });

    it("withholds the place, its English name, the map and the programme's places from every public query", async () => {
      const id = await published();
      for (const locale of ["ro", "en"] as const) {
        const slug = locale === "ro" ? "crosul-de-iarna" : "winter-cross";
        const rows = [
          await findPublishedEventBySlug(db, locale, slug),
          ...(await listPublishedEvents(db, locale)),
          ...(await listUpcomingEvents(db, locale, NOW)),
        ];
        for (const row of rows) {
          expect(row).toMatchObject({ locationName: null, locationAddress: null, mapUrl: null, locationToBeAnnounced: true });
          // The programme's row stays, time and label; only its place is gone.
          const [item] = readScheduleItems(row?.scheduleItems);
          expect(item).toMatchObject({ label: { ro: "Ridicarea kitului", en: "Kit pickup" }, place: null });
          expect(leaks(JSON.stringify(row))).toEqual([]);
        }
        const details = await findEventNotificationDetails(db, id, locale);
        expect(details).toMatchObject({ locationName: null, mapUrl: null, locationToBeAnnounced: true });
        expect(leaks(JSON.stringify(details))).toEqual([]);
      }
    });

    it("says it in the calendar file, in Google's link and in the structured data, and names nothing else", async () => {
      await published();
      const row = (await findPublishedEventBySlug(db, "ro", "crosul-de-iarna"))!;
      const event = toCalendarEvent(row, "ro", NOW);

      const ics = buildCalendar({ events: [event], baseUrl: "https://example.test", name: "x", labels: calendarLabels("ro") });
      expect(ics).toContain(SENTENCE_RO);
      // No LOCATION on the event, nor on its programme row: a calendar geocodes it and offers directions.
      expect(ics).not.toContain("LOCATION:");
      expect(leaks(ics.replace(/\r\n /g, ""))).toEqual([]);

      const google = googleCalendarUrl(event, calendarLabels("ro"));
      expect(new URL(google).searchParams.has("location")).toBe(false);
      expect(new URL(google).searchParams.get("details")).toContain(SENTENCE_RO);
      expect(leaks(decodeURIComponent(google))).toEqual([]);

      const jsonLd = JSON.parse(JSON.stringify(sportsEventJsonLd(row, "https://example.test/ro/evenimente/crosul-de-iarna", "Brașov Runners")));
      expect(jsonLd.location).toEqual({
        "@type": "Place",
        name: "Brașov",
        address: { "@type": "PostalAddress", addressLocality: "Brașov", addressCountry: "RO" },
      });
      expect(leaks(JSON.stringify(jsonLd))).toEqual([]);

      // The English calendar in its own words.
      const en = (await findPublishedEventBySlug(db, "en", "winter-cross"))!;
      expect(buildCalendar({ events: [toCalendarEvent(en, "en", NOW)], baseUrl: "https://example.test", name: "x", labels: calendarLabels("en") })).toContain(SENTENCE_EN);
    });

    it("says it in the emails' facts line, in both halves, with no map and a calendar file without a place", async () => {
      const id = await published();
      const identity = canonicalizeEmail("ana@example.ro");
      const [participant] = await db
        .insert(participants)
        .values({ ...identity, deliveryEmail: identity.deliveryEmail, defaultName: "Ana Pop" })
        .returning();
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
      for (const body of [message.text, message.html]) {
        expect(body).toContain(SENTENCE_RO);
        expect(body).toContain(SENTENCE_EN);
        expect(leaks(body)).toEqual([]);
      }
      // The reminder's calendar file is built from the public row, and names no place either.
      const ics = message.attachments?.find((attachment) => attachment.filename.endsWith(".ics"));
      expect(ics).toBeDefined();
      const icsText = Buffer.from(ics!.data).toString("utf8");
      expect(icsText).not.toContain("LOCATION:");
      expect(leaks(icsText.replace(/\r\n /g, ""))).toEqual([]);
    });

    it("fills the declaration's place with the city, never the typed place", async () => {
      const id = await published();
      expect((await eventMergeValues(db, id, "ro"))?.values.eventLocation).toBe("Brașov");
      expect((await eventMergeValues(db, id, "en"))?.values.eventLocation).toBe("Brașov");
    });
  });

  describe("announcing later", () => {
    it("publishes the place everywhere at once on the save that turns the switch off, and says so", async () => {
      const created = await createEventAndPublish(db, { actor: admin, fields: TYPED_NOT_ANNOUNCED, publish: true, now: NOW });
      // The event half of the same form: `saveEventAndTranslations` takes the languages as rows.
      const fields = TYPED_EVENT_HALF;

      // A save that keeps the place hidden announces nothing.
      const kept = await saveEventAndTranslations(db, { actor: organizer, eventId: created.event.id, expectedVersion: (await rowOf(created.event.id)).version, fields, translations: [], now: NOW });
      expect(kept.placeAnnounced).toBe(false);
      expect((await findPublishedEventBySlug(db, "ro", "crosul-de-iarna"))?.locationName).toBeNull();

      const announced = await saveEventAndTranslations(db, {
        actor: organizer,
        eventId: created.event.id,
        expectedVersion: (await rowOf(created.event.id)).version,
        fields: { ...fields, locationToBeAnnounced: false },
        translations: [],
        now: NOW,
      });
      expect(announced.placeAnnounced).toBe(true);

      const ro = (await findPublishedEventBySlug(db, "ro", "crosul-de-iarna"))!;
      expect(ro).toMatchObject({ locationName: SECRET_NAME, mapUrl: SECRET_MAP, locationToBeAnnounced: false });
      expect(readScheduleItems(ro.scheduleItems)[0]?.place).toBe(SECRET_ROW_PLACE);
      expect((await findPublishedEventBySlug(db, "en", "winter-cross"))?.locationName).toBe(SECRET_EN_NAME);
      expect((await findEventNotificationDetails(db, created.event.id, "ro"))?.locationName).toBe(SECRET_NAME);
      const ics = buildCalendar({ events: [toCalendarEvent(ro, "ro", NOW)], baseUrl: "https://example.test", name: "x", labels: calendarLabels("ro") });
      expect(ics).toContain(`LOCATION:${SECRET_MAP}`);
      expect(ics).not.toContain(SENTENCE_RO);

      // Nobody was written to: the save queues no email.
      expect(await db.select().from(emailOutbox)).toHaveLength(0);
    });

    it("carries the state onto a copy, which keeps the place hidden", async () => {
      const created = await createEventAndPublish(db, { actor: admin, fields: TYPED_NOT_ANNOUNCED, publish: true, now: NOW });
      const copy = await duplicateEvent(db, { actor: admin, eventId: created.event.id, now: NOW });
      expect(copy).toMatchObject({ locationToBeAnnounced: true, locationName: SECRET_NAME, editorialStatus: "DRAFT" });
    });
  });
});
