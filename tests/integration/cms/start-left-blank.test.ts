import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { newsletterSends } from "@/db/schema/newsletter";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEventAndPublish, saveEventAndTranslations } from "@/modules/content/events/service";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { datedOrNull } from "@/modules/events/domain/dated";
import { blankStartParts, startBoxValues, UNDATED_DAY } from "@/modules/events/domain/provisional-start";
import { registrationState } from "@/modules/events/domain/registration-window";
import {
  findPublishedEventBySlug,
  listPublishedEventAddresses,
  listPublishedEvents,
  listPublishedEventsBetween,
  listUndatedPublishedEvents,
  listUpcomingEvents,
} from "@/modules/events/repository";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { queueNewEventAlerts } from "@/modules/newsletter/service";
import { queueEventReminders, queueParticipationConfirmations, sendEventThanks } from "@/modules/notifications/event-mail";
import { forecastAutomaticEmails } from "@/modules/notifications/forecast";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §545 (amending §533) — the start's boxes left empty while it is to be announced.
 * The owner, 2026-09-28: «în V2.23 trebuie să pot să nu pun data și ora evenimentului! momentan am
 * validare pe asta».
 *
 * What is protected: with «Data se anunță mai târziu» the date and the hour may both be empty, with
 * «Ora se anunță mai târziu» alone the hour; the platform stores a provisional start in their place
 * (`provisional-start.ts`) that no public read, no email and no job ever meets; unticked, the boxes
 * are required again and the refusal names «Începutul evenimentului».
 */
const NOW = new Date("2026-10-01T09:00:00.000Z");
const YEAR = 365 * 24 * 60 * 60_000;

const EVENT_FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "",
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

describe("§545 the start's boxes left empty while it is to be announced", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let declarationId: string;
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
  const publish = (extra: Record<string, unknown>) =>
    createEventAndPublish(db, { actor: admin, fields: { ...fields(), ...extra, translations: TRANSLATIONS }, publish: true, now: NOW });
  /** Every public read of the event, in both languages, as one text a provisional value could hide in. */
  const everyPublicRead = async () =>
    JSON.stringify([
      await findPublishedEventBySlug(db, "ro", "semimaratonul"),
      await findPublishedEventBySlug(db, "en", "half-marathon"),
      await listUndatedPublishedEvents(db, "ro"),
      await listUndatedPublishedEvents(db, "en"),
    ]);

  describe("«Data se anunță mai târziu» with both boxes empty", () => {
    it("saves and publishes, storing the provisional day the boxes read back as empty", async () => {
      const result = await publish({ dateToBeAnnounced: true, startsAtWallTime: "" });
      expect(result.published).toBe(true);
      const row = await rowOf(result.event.id);
      expect(blankStartParts(row.startsAt, row.timezone)).toEqual({ date: true, time: true });
      expect(startBoxValues(row.startsAt, row.timezone)).toEqual({ date: "", time: "" });
      expect(row.registrationOpensSoon).toBe(true);
      expect(registrationState(row, NOW)).toBe("NOT_YET_OPEN");
    });

    it("keeps an hour typed without a date, on the provisional day", async () => {
      const result = await publish({ dateToBeAnnounced: true, startsAtWallTime: "T09:30" });
      const row = await rowOf(result.event.id);
      expect(startBoxValues(row.startsAt, row.timezone)).toEqual({ date: "", time: "09:30" });
    });

    it("keeps a date typed without an hour", async () => {
      const result = await publish({ dateToBeAnnounced: true, startsAtWallTime: "2027-03-14" });
      const row = await rowOf(result.event.id);
      expect(startBoxValues(row.startsAt, row.timezone)).toEqual({ date: "2027-03-14", time: "" });
    });

    it("withholds it from every public read: no date, no provisional day, on no dated list, the sitemap still listing it", async () => {
      await publish({ dateToBeAnnounced: true, startsAtWallTime: "", durationMinutes: "90", scheduleRows: [] });
      const page = (await findPublishedEventBySlug(db, "ro", "semimaratonul"))!;
      expect(page).toMatchObject({ startsAt: null, endsAt: null, raceStartsAt: null, announcedDay: null, scheduleItems: null });
      // The gate every dated surface asks first — the structured data, the forecast, the night pill,
      // the countdown, the calendar entry and the `.ics` route (§533).
      expect(datedOrNull(page)).toBeNull();
      const reads = await everyPublicRead();
      expect(reads).not.toContain(UNDATED_DAY.slice(0, 4));
      expect(reads).not.toContain("12:00:01");
      // The calendar's months and the feed, even asked for the provisional day itself.
      expect(await listPublishedEventsBetween(db, "ro", new Date("9998-12-01T00:00:00.000Z"), new Date("9999-02-01T00:00:00.000Z"))).toEqual([]);
      expect(await listPublishedEvents(db, "ro")).toEqual([]);
      expect(await listUpcomingEvents(db, "ro", NOW)).toEqual([]);
      // The sitemap's rows: the page is found without a date.
      expect((await listPublishedEventAddresses(db, "ro")).map((row) => row.slug)).toEqual(["semimaratonul"]);
    });

    it("is met by no job, even with rows no door would have let in", async () => {
      const result = await publish({ dateToBeAnnounced: true, startsAtWallTime: "" });
      // The worst case, past every door (§533 refuses them all): a confirmed runner and one owing a signature.
      const seed = async (email: string, status: RegistrationStatus) => {
        const identity = canonicalizeEmail(email);
        const [participant] = await db.insert(participants).values({ ...identity, deliveryEmail: identity.deliveryEmail, defaultName: "Ana Pop" }).returning();
        await db.insert(registrations).values({
          eventId: result.event.id,
          participantId: participant.id,
          status,
          locale: "ro",
          registeredName: "Ana Pop",
          displayName: "Ana P.",
          privacyNoticeVersion: 1,
          privacyAcknowledgedAt: NOW,
          resultsNameConsent: false,
          listOptOut: false,
          resultsConsentVersion: 1,
          confirmedAt: status === "CONFIRMED" ? NOW : null,
          holdExpiresAt: status === "PENDING_DECLARATION" ? new Date(NOW.getTime() + YEAR) : null,
        });
      };
      await seed("ana@example.ro", "CONFIRMED");
      await seed("ion@example.ro", "PENDING_DECLARATION");

      for (const at of [NOW, new Date(NOW.getTime() + 5 * YEAR)]) {
        expect(await queueEventReminders(db, at, DEFAULT_DEADLINES)).toBe(0);
        expect(await queueParticipationConfirmations(db, at)).toBe(0);
        await queueNewEventAlerts(db, at);
        await runRegistrationMaintenance(db, at);
        const forecast = await forecastAutomaticEmails(db, { now: at, deadlines: DEFAULT_DEADLINES });
        expect(JSON.stringify(forecast)).not.toContain(result.event.id);
      }
      expect(await db.select().from(emailOutbox)).toEqual([]);
      expect(await db.select().from(newsletterSends).where(eq(newsletterSends.eventId, result.event.id))).toEqual([]);
      // The thank-you asks for a start behind it, which the provisional day never is.
      await expect(sendEventThanks(db, admin, { eventId: result.event.id }, new Date(NOW.getTime() + 5 * YEAR))).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("refuses the race's start typed beside a blank date or hour, naming its box", async () => {
      await expect(publish({ dateToBeAnnounced: true, startsAtWallTime: "", raceStartsAtWallTime: "2027-03-14T10:30" })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        fields: ["raceStartsAt"],
      });
      await expect(publish({ timeToBeAnnounced: true, startsAtWallTime: "2027-03-14", raceStartsAtWallTime: "2027-03-14T10:30" })).rejects.toMatchObject({
        fields: ["raceStartsAt"],
      });
    });

    it("refuses the provisional day typed as a date", async () => {
      await expect(publish({ dateToBeAnnounced: true, startsAtWallTime: `${UNDATED_DAY}T10:00` })).rejects.toMatchObject({ fields: ["startsAt"] });
    });
  });

  describe("the switch off again", () => {
    it("refuses empty boxes, naming «Începutul evenimentului» (the date box), and keeps the switch on", async () => {
      const result = await publish({ dateToBeAnnounced: true, startsAtWallTime: "" });
      const row = await rowOf(result.event.id);
      const save = (extra: Record<string, unknown>) =>
        saveEventAndTranslations(db, { actor: admin, eventId: row.id, fields: { ...fields(), ...extra }, expectedVersion: row.version, translations: [], now: NOW });
      await expect(save({ dateToBeAnnounced: false, startsAtWallTime: "" })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["startsAt"] });
      // A date without its hour names the hour's box.
      await expect(save({ dateToBeAnnounced: false, startsAtWallTime: "2027-03-14" })).rejects.toMatchObject({ fields: ["startsAtTime"] });
      expect((await rowOf(row.id)).dateToBeAnnounced).toBe(true);

      await save({ dateToBeAnnounced: false, startsAtWallTime: "2027-03-14T10:00" });
      const page = await findPublishedEventBySlug(db, "ro", "semimaratonul");
      expect(page?.startsAt?.toISOString()).toBe("2027-03-14T08:00:00.000Z");
    });

    it("a caller that does not post the switch keeps it, and with it the empty boxes it excuses", async () => {
      const result = await publish({ dateToBeAnnounced: true, startsAtWallTime: "" });
      const row = await rowOf(result.event.id);
      await saveEventAndTranslations(db, {
        actor: admin,
        eventId: row.id,
        fields: { ...fields(), startsAtWallTime: "" },
        expectedVersion: row.version,
        translations: [],
        now: NOW,
      });
      expect(blankStartParts((await rowOf(row.id)).startsAt, row.timezone).date).toBe(true);
    });

    it("an event with neither switch still needs its date and its hour, on create", async () => {
      await expect(publish({ startsAtWallTime: "" })).rejects.toMatchObject({ fields: ["startsAt"] });
      await expect(publish({ startsAtWallTime: "2027-03-14" })).rejects.toMatchObject({ fields: ["startsAtTime"] });
    });
  });

  describe("«Ora se anunță mai târziu» alone with the hour empty", () => {
    it("still needs the date", async () => {
      await expect(publish({ timeToBeAnnounced: true, startsAtWallTime: "" })).rejects.toMatchObject({ fields: ["startsAt"] });
    });

    it("shows the day and no hour anywhere", async () => {
      const result = await publish({ timeToBeAnnounced: true, startsAtWallTime: "2027-03-14", durationMinutes: "120" });
      const row = await rowOf(result.event.id);
      expect(startBoxValues(row.startsAt, row.timezone)).toEqual({ date: "2027-03-14", time: "" });
      const page = (await findPublishedEventBySlug(db, "ro", "semimaratonul"))!;
      expect(page).toMatchObject({ startsAt: null, endsAt: null, raceStartsAt: null, announcedDay: "2027-03-14", timeToBeAnnounced: true });
      expect(datedOrNull(page)).toBeNull();
      const reads = await everyPublicRead();
      // Noon and one second in Brașov is 10:00:01 UTC in March: neither clock is in any read.
      expect(reads).not.toContain("12:00");
      expect(reads).not.toContain("10:00:01");
      expect(await listPublishedEventsBetween(db, "ro", new Date("2027-03-01T00:00:00.000Z"), new Date("2027-04-01T00:00:00.000Z"))).toEqual([]);
      expect((await listPublishedEventAddresses(db, "en")).map((entry) => entry.slug)).toEqual(["half-marathon"]);
    });
  });
});
