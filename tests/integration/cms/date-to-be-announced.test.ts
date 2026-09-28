import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { newsletterSends } from "@/db/schema/newsletter";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEventAndPublish, duplicateEvent, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { findSignableEvent } from "@/modules/group-run-declarations/service";
import { registrationState } from "@/modules/events/domain/registration-window";
import { findPublishedEventBySlug, listPastEvents, listPublishedEvents, listPublishedEventsBetween, listUndatedPublishedEvents, listUpcomingEvents } from "@/modules/events/repository";
import { datedOrNull } from "@/modules/events/domain/dated";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { queueNewEventAlerts } from "@/modules/newsletter/service";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §NNN — the date to be announced, end to end. The owner, 2026-09-28: "events with
 * no date specified, as I can already do without a location"; registration stays «în curând»
 * meanwhile (the owner's choice), and the date is entirely unknown to the public — no month.
 *
 * The provisional date the organizer typed is a sentinel far in the future, so "never shown" is
 * checked against the read's own values, and every list that places an event in time is asked.
 */
const NOW = new Date("2026-10-01T09:00:00.000Z");

const EVENT_FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2027-03-14T10:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Parcul Titulescu",
  locationNameEn: "Titulescu Park",
  locationAddress: "",
  surface: null,
  difficulty: null,
  costType: null,
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "INTERNAL",
  participantListVisibility: "HIDDEN" as const,
  capacity: "50",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
  externalProvider: "",
  externalRegistrationUrl: "",
};

const TRANSLATIONS = {
  ro: { slug: "semimaratonul", title: "Semimaratonul", excerpt: "21 de kilometri." },
  en: { slug: "half-marathon", title: "Half marathon", excerpt: "21 kilometres." },
};

/** A whole, valid entry, so a refusal can only be the one the test is about. */
const SUBMISSION = {
  firstName: "Ana",
  lastName: "Pop",
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
  nationality: "RO",
  country: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Contact Urgență",
  emergencyContactPhone: "+40722222222",
  email: "ana@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: true,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
};

describe("§NNN the date to be announced", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let declarationId: string;
  /** The race's fields, with the approved declaration an internal registration names. */
  const fields = () => ({ ...EVENT_FIELDS, declarationDocumentId: declarationId });

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    const notice: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    for (const key of ["PRIVACY_NOTICE", "TERMS"] as const) {
      await insertLegalDocumentVersion(db, {
        key,
        version: 1,
        effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
        isApproved: true,
        contentSha256: computeContentHash(notice),
        translations: notice,
        now: NOW,
      });
    }
    const declaration: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Declar."] }] } },
      { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I declare."] }] } },
    ];
    declarationId = await insertLegalDocumentVersion(db, {
      key: "EVENT_DECLARATION",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(declaration),
      translations: declaration,
      now: NOW,
    });
  });

  const rowOf = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
  const publishUndated = async (extra: Record<string, unknown> = {}) =>
    createEventAndPublish(db, {
      actor: admin,
      fields: { ...fields(), dateToBeAnnounced: true, ...extra, translations: TRANSLATIONS },
      publish: true,
      now: NOW,
    });

  describe("the save", () => {
    it("publishes with the date held back, keeps the provisional date for staff, and holds registration at «în curând»", async () => {
      const result = await publishUndated();
      expect(result.published).toBe(true);
      const row = await rowOf(result.event.id);
      expect(row.dateToBeAnnounced).toBe(true);
      expect(row.startsAt.toISOString()).toBe("2027-03-14T08:00:00.000Z");
      // The organizer did not tick «în curând»; the date held back ticks it for them (§451).
      expect(row.registrationOpensSoon).toBe(true);
    });

    it("refuses an opening date beside it, naming the box", async () => {
      await expect(publishUndated({ registrationOpensAtWallTime: "2026-12-01T10:00" })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        fields: ["registrationOpensAt"],
      });
    });

    it("is refused for an event people registered for, and allowed once the date is announced again", async () => {
      const created = await createEventAndPublish(db, { actor: admin, fields: { ...fields(), translations: TRANSLATIONS }, publish: true, now: NOW });
      const identity = canonicalizeEmail("ana@example.ro");
      const [participant] = await db
        .insert(participants)
        .values({ ...identity, deliveryEmail: identity.deliveryEmail, defaultName: "Ana Pop" })
        .returning();
      await db.insert(registrations).values({
        eventId: created.event.id,
        participantId: participant.id,
        status: "CONFIRMED",
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: "Ana P.",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
      });
      const row = await rowOf(created.event.id);
      await expect(
        saveEventAndTranslations(db, {
          actor: admin,
          eventId: row.id,
          fields: { ...fields(), dateToBeAnnounced: true },
          expectedVersion: row.version,
          translations: [],
          now: NOW,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["dateToBeAnnounced"] });
      expect((await rowOf(row.id)).dateToBeAnnounced).toBe(false);
    });

    it("cannot repeat, and a duplicate keeps it held back", async () => {
      const result = await publishUndated();
      await expect(
        repeatEvent(db, { actor: admin, eventId: result.event.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2027-06-01", publish: false }, now: NOW }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["repeat"] });
      const copy = await duplicateEvent(db, { actor: admin, eventId: result.event.id, now: NOW });
      expect((await rowOf(copy.id)).dateToBeAnnounced).toBe(true);
    });

    it("announcing the date publishes it and opens nothing by itself", async () => {
      const result = await publishUndated();
      const row = await rowOf(result.event.id);
      await saveEventAndTranslations(db, {
        actor: admin,
        eventId: row.id,
        fields: { ...fields(), dateToBeAnnounced: false, registrationOpensSoon: true },
        expectedVersion: row.version,
        translations: [],
        now: NOW,
      });
      const after = await rowOf(row.id);
      expect(after.dateToBeAnnounced).toBe(false);
      expect(after.registrationOpensSoon).toBe(true);
      const page = await findPublishedEventBySlug(db, "ro", "semimaratonul");
      expect(page?.startsAt?.toISOString()).toBe("2027-03-14T08:00:00.000Z");
      expect((await listPublishedEvents(db, "ro")).map((event) => event.slug)).toEqual(["semimaratonul"]);
    });
  });

  describe("the public reads", () => {
    it("put it on no list that places an event in time, and on the undated one with no date at all", async () => {
      await publishUndated();
      expect(await listPublishedEvents(db, "ro")).toEqual([]);
      expect(await listUpcomingEvents(db, "ro", NOW)).toEqual([]);
      expect(await listPastEvents(db, "ro", new Date("2028-01-01T00:00:00.000Z"), 60)).toEqual([]);
      expect(await listPublishedEventsBetween(db, "ro", new Date("2027-03-01T00:00:00.000Z"), new Date("2027-04-01T00:00:00.000Z"))).toEqual([]);

      const [undated] = await listUndatedPublishedEvents(db, "en");
      expect(undated).toMatchObject({ slug: "half-marathon", dateToBeAnnounced: true, startsAt: null, endsAt: null, raceStartsAt: null });
    });

    it("hands the page no date, which no dated surface accepts", async () => {
      await publishUndated({ endsAtWallTime: "2027-03-14T14:00", raceStartsAtWallTime: "2027-03-14T10:30" });
      const page = (await findPublishedEventBySlug(db, "ro", "semimaratonul"))!;
      expect(page).toMatchObject({ startsAt: null, endsAt: null, raceStartsAt: null, dateToBeAnnounced: true });
      expect(datedOrNull(page)).toBeNull();
      expect(JSON.stringify(page)).not.toContain("2027-03-14");
    });
  });

  describe("registration", () => {
    it("is «în curând» whatever the provisional date says, even once it has passed", async () => {
      const result = await publishUndated();
      const row = await rowOf(result.event.id);
      expect(registrationState(row, NOW)).toBe("NOT_YET_OPEN");
      expect(registrationState({ ...row, registrationOpensSoon: false }, new Date("2028-01-01T00:00:00.000Z"))).toBe("NOT_YET_OPEN");
      const page = (await findPublishedEventBySlug(db, "ro", "semimaratonul"))!;
      expect(registrationState(page, NOW)).toBe("NOT_YET_OPEN");
    });

    it("is refused at every door, the race-day desk's included", async () => {
      const result = await publishUndated();
      const row = await rowOf(result.event.id);
      await expect(submitRegistration(db, row, {}, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(submitRegistration(db, row, {}, NOW, "REAL", { source: "STAFF", atTheDesk: true } as never)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("date is to be announced"),
      });
    });
  });

  describe("what the review found (§NNN)", () => {
    it("withholds the programme's timed rows, which name the day as surely as the start", async () => {
      await publishUndated({
        scheduleRows: [{ date: "2027-03-13", time: "16:00", endTime: "", ro: "Ridicarea kitului", en: "Kit pickup", place: "" }],
      });
      const page = (await findPublishedEventBySlug(db, "ro", "semimaratonul"))!;
      expect(page.scheduleItems).toBeNull();
      expect(JSON.stringify(page)).not.toContain("2027-03-13");
    });

    it("holds an external registration at «în curând» too: no button to the organizer's form", async () => {
      await publishUndated({ registrationMode: "EXTERNAL", capacity: "", declarationDocumentId: "", externalRegistrationUrl: "https://example.test/form" });
      const page = (await findPublishedEventBySlug(db, "ro", "semimaratonul"))!;
      expect(registrationState(page, NOW)).toBe("NOT_YET_OPEN");
    });

    it("refuses the listing's lead mark while the date is held back", async () => {
      await expect(publishUndated({ featured: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["featured"] });
    });

    it("leaves a cancelled undated event off the section; its page stays", async () => {
      const result = await publishUndated();
      await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, result.event.id));
      expect(await listUndatedPublishedEvents(db, "ro")).toEqual([]);
      expect(await findPublishedEventBySlug(db, "ro", "semimaratonul")).toBeDefined();
    });

    it("refuses a submission under the lock when the date was held back after the caller read the row", async () => {
      const created = await createEventAndPublish(db, { actor: admin, fields: { ...fields(), translations: TRANSLATIONS }, publish: true, now: NOW });
      const stale = await rowOf(created.event.id);
      await db.update(events).set({ dateToBeAnnounced: true }).where(eq(events.id, stale.id));
      await expect(
        submitRegistration(db, { ...stale, dateToBeAnnounced: false }, SUBMISSION, NOW, "REAL", { source: "STAFF", atTheDesk: true } as never),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringContaining("date is to be announced") });
    });

    it("offers no group-run self-declaration to sign, the action's own read included", async () => {
      const result = await publishUndated({ type: "GROUP_RUN", registrationMode: "NONE", capacity: "", declarationDocumentId: "", surface: "TRAIL", offersGroupRunDeclaration: true });
      expect(await findSignableEvent(db, result.event.id)).toBeUndefined();
    });
  });

  describe("the new-event alert", () => {
    it("waits for the date: nothing is marked seen while it is held back, and the alert may go once it is announced", async () => {
      const result = await publishUndated();
      await queueNewEventAlerts(db, NOW);
      expect(await db.select().from(newsletterSends).where(eq(newsletterSends.eventId, result.event.id))).toEqual([]);
    });
  });
});
