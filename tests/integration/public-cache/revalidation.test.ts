import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { saveEventAndTranslations, saveEventFields, transitionEvent } from "@/modules/content/events/service";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { approveVersion, createDraftVersion } from "@/modules/legal-documents/service";
import { setListConsent } from "@/modules/registrations/list-consent";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { confirmEmail, type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §333 — the writes that change a public page expire the public cache they are read from.
 *
 * The public pages read their rows from Next's data cache so a visitor does not wake the
 * database; what keeps them right is every write saying what it changed. These are the paths that
 * matter most — an event saved and published, a place taken and released (by a click and by the
 * maintenance job), a legal text approved, a name taken off the start list — each asserted against
 * the one call the cache listens for, `revalidateTag("public:<kind>", { expire: 0 })`.
 *
 * `next/cache` is stubbed and the helper is told it runs in a Next server; everything else is the
 * real service on PGlite.
 */
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), unstable_cache: vi.fn() }));
const { revalidateTag } = await import("next/cache");

const NOW = new Date("2026-09-04T10:00:00.000Z");
const expired = (kind: string) => [`public:${kind}`, { expire: 0 }];

describe("§333 writes expire the public cache", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.mocked(revalidateTag).mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("events", () => {
    let admin: StaffUser;

    beforeEach(async () => {
      [admin] = await db
        .insert(staffUsers)
        .values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" })
        .returning();
    });

    /** A draft with a complete text in both languages — what publication requires. */
    async function seedDraft() {
      const [event] = await db
        .insert(events)
        .values({ type: "RACE", startsAt: new Date("2026-10-11T06:00:00Z"), locationName: "Parcul Tractorul" })
        .returning();
      await db.insert(eventTranslations).values([
        { eventId: event.id, locale: "ro", slug: "crosul", title: "Crosul", excerpt: "Cursa clubului." },
        { eventId: event.id, locale: "en", slug: "the-cross", title: "The cross", excerpt: "The club's race." },
      ]);
      return event;
    }

    /** The event row as the editor posts it. */
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

    it("publishing an event expires the cached events: the listing, the page, the calendar, the feeds", async () => {
      const draft = await seedDraft();
      const reviewed = await transitionEvent(db, { actor: admin, eventId: draft.id, expectedVersion: draft.version, to: "IN_REVIEW", now: NOW });
      vi.mocked(revalidateTag).mockClear();

      await transitionEvent(db, { actor: admin, eventId: draft.id, expectedVersion: reviewed.version, to: "PUBLISHED", now: NOW });

      expect(revalidateTag).toHaveBeenCalledWith(...expired("events"));
    });

    it("saving an event expires them too — cancelling is a save, and a cancelled event must never read as on (§28)", async () => {
      const event = await seedDraft();

      await saveEventFields(db, {
        actor: admin,
        eventId: event.id,
        expectedVersion: event.version,
        fields: { ...EVENT_FIELDS, eventStatus: "CANCELLED" },
        // Cancelling asks why since §331 (event notices); telling nobody keeps the test on the cache.
        cancellation: { reason: { ro: "Ploaie torențială.", en: "Torrential rain." }, notify: false },
        now: NOW,
      });

      expect(revalidateTag).toHaveBeenCalledWith(...expired("events"));
    });

    it("the whole save expires them — the place to be announced, the links, the minimum age, a notice to the participants (§328, §332, §329, §331)", async () => {
      const event = await seedDraft();

      await saveEventAndTranslations(db, {
        actor: admin,
        eventId: event.id,
        expectedVersion: event.version,
        fields: {
          ...EVENT_FIELDS,
          locationToBeAnnounced: true,
          minAge: "16",
          links: [{ kind: "GPX", url: ["https:/", "drive.example.test", "gpx"].join("/"), labelRo: "", labelEn: "" }],
        },
        translations: [],
        // Telling the participants writes the outbox and the audit trail, and no public row: the
        // save's own expiry is the only one, and it is the events'.
        notice: { notify: true, note: { ro: "Locul se anunță săptămâna viitoare.", en: "The place is announced next week." } },
        now: NOW,
      });

      const [saved] = await db.select().from(events).where(eq(events.id, event.id));
      expect(saved.locationToBeAnnounced).toBe(true);
      expect(saved.minAge).toBe(16);
      expect(Array.isArray(saved.links) && saved.links.length).toBe(1);
      expect(revalidateTag).toHaveBeenCalledWith(...expired("events"));
      expect(revalidateTag).not.toHaveBeenCalledWith(...expired("places"));
    });

    it("a save that is refused expires nothing: the call comes after the transaction, not before it", async () => {
      const event = await seedDraft();

      await expect(
        saveEventFields(db, { actor: admin, eventId: event.id, expectedVersion: event.version + 7, fields: EVENT_FIELDS, now: NOW }),
      ).rejects.toThrow(/saved by someone else/);

      expect(revalidateTag).not.toHaveBeenCalled();
    });
  });

  describe("places", () => {
    async function approve(key: "PRIVACY_NOTICE" | "EVENT_DECLARATION") {
      const translations: LegalDocumentTranslationInput[] = [
        { locale: "ro", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
        { locale: "en", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
      ];
      await insertLegalDocumentVersion(db, {
        key,
        version: 1,
        effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
        isApproved: true,
        contentSha256: computeContentHash(translations),
        translations,
        now: NOW,
      });
    }

    /** One place, so the second person waits and the first person's lapsed hold is wanted. */
    async function onePlaceEvent(): Promise<EventForRegistration> {
      const [event] = await db
        .insert(events)
        .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: 1 })
        .returning();
      return {
        id: event.id,
        eventStatus: event.eventStatus,
        registrationMode: "INTERNAL",
        startsAt: event.startsAt,
        registrationOpensAt: event.registrationOpensAt,
        registrationClosesAt: event.registrationClosesAt,
        capacity: 1,
        raceId: null,
        publishedAt: NOW,
      };
    }

    async function registerAndConfirm(event: EventForRegistration, email: string) {
      await submitRegistration(
        db,
        event,
        {
          firstName: "Ana",
          lastName: email.split("@")[0],
          birthDate: "1990-05-17",
          sex: "UNSPECIFIED",
          nationality: "RO",
          city: "Brașov",
          phone: "+40711111111",
          emergencyContactName: "Contact Urgență",
          emergencyContactPhone: "+40722222222",
          email,
          locale: "ro",
          privacyAcknowledged: true,
          fitnessDeclared: true,
          rulesAcknowledged: true,
          resultsNameConsent: true,
          listOptOut: false,
          honeypot: "",
          renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
        },
        NOW,
      );
      const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
      const pending = rows.find((row) => row.status === "PENDING_EMAIL_CONFIRMATION");
      if (!pending) throw new Error("the submission produced no registration");
      return confirmEmail(db, event, pending.id, NOW);
    }

    beforeEach(async () => {
      await approve("PRIVACY_NOTICE");
      await approve("EVENT_DECLARATION");
    });

    it("a hold expires the cached free places; a mere submission, which holds nothing, does not", async () => {
      const event = await onePlaceEvent();

      const held = await registerAndConfirm(event, "first@example.ro");

      expect(held.status).toBe("PENDING_DECLARATION");
      expect(revalidateTag).toHaveBeenCalledWith(...expired("places"));
      expect(revalidateTag).not.toHaveBeenCalledWith(...expired("events"));
    });

    it("the maintenance job releasing a lapsed hold expires them — and a run with nothing to do expires nothing", async () => {
      const event = await onePlaceEvent();
      const first = await registerAndConfirm(event, "first@example.ro");
      const second = await registerAndConfirm(event, "second@example.ro");
      expect(second.status).toBe("WAITLISTED");
      vi.mocked(revalidateTag).mockClear();

      // Nothing has lapsed yet: the job visits no event, changes no place, tells the cache nothing.
      await runRegistrationMaintenance(db, NOW);
      expect(revalidateTag).not.toHaveBeenCalled();

      // The thirty minutes pass with somebody waiting (§160): the hold goes, the place is offered.
      const later = new Date((first.holdExpiresAt as Date).getTime() + 60_000);
      await runRegistrationMaintenance(db, later);

      const [released] = await db.select().from(registrations).where(eq(registrations.id, first.id));
      expect(released.status).toBe("EXPIRED");
      expect(revalidateTag).toHaveBeenCalledWith(...expired("places"));
    });

    it("leaving the public start list expires it, so the name is gone for the next visitor", async () => {
      const event = await onePlaceEvent();
      const held = await registerAndConfirm(event, "first@example.ro");
      vi.mocked(revalidateTag).mockClear();

      await setListConsent(db, held.id, false, "MANAGE_LINK", NOW);

      expect(revalidateTag).toHaveBeenCalledWith(...expired("places"));
    });
  });

  describe("legal texts", () => {
    it("approving a version expires the cached terms and privacy notice", async () => {
      const [superadmin] = await db
        .insert(staffUsers)
        .values({ email: "superadmin@dev.test", displayName: "Superadmin", role: "SUPERADMIN" })
        .returning();
      const translations: LegalDocumentTranslationInput[] = [
        { locale: "ro", title: "Termeni", body: { sections: [{ paragraphs: ["RO"] }] } },
        { locale: "en", title: "Terms", body: { sections: [{ paragraphs: ["EN"] }] } },
      ];
      const draft = await createDraftVersion(db, superadmin, { key: "TERMS", translations }, NOW);
      // A draft shows nowhere, and saying so costs the cache nothing it should keep.
      expect(revalidateTag).not.toHaveBeenCalled();

      await approveVersion(db, superadmin, draft, NOW);

      expect(revalidateTag).toHaveBeenCalledWith(...expired("legal"));
    });
  });
});
