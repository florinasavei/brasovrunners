import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { platformSettings } from "@/db/schema/platform-settings";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { forgetCachedAddressCap } from "@/modules/registrations/address-cap-memo";
import { ADDRESS_CAP_SETTING_KEY } from "@/modules/registrations/address-cap";
import { familyRegistrationOpen } from "@/modules/registrations/family-gate";
import { type EventForRegistration, submitRegistration } from "@/modules/registrations/service";

/**
 * §NNN × BR-REQ-034-02 — a family on one address under real concurrency.
 *
 * Which runners an address holds at an event is read under the event's lock since §NNN, so two
 * members of one family pressing at once cannot both find the address empty, and the club's limit
 * per address cannot be passed by pressing the emailed links together. PGlite cannot express either
 * race (`tests/helpers/db.ts`); this runs against the real server `yarn test:concurrency` uses.
 *
 * The first case holds on either schema — with the one-registration-per-address constraint of
 * today, and without it after the contract release. The second needs the contract release (the
 * family flow is closed until then, `family-gate.ts`) and says so when it is skipped.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("§NNN BR-REQ-034-02 a family on one address, under real concurrency", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
  const db = drizzle(pool);
  const NOW = new Date("2026-09-25T10:00:00.000Z");
  const createdEventIds: string[] = [];
  let familyOpen = false;
  let previousCap: unknown = undefined;

  beforeAll(async () => {
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: new Date("2020-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    }).catch(() => undefined);
    familyOpen = await familyRegistrationOpen(db);
    const [kept] = await db.select().from(platformSettings).where(eq(platformSettings.key, ADDRESS_CAP_SETTING_KEY));
    previousCap = kept?.value;
  });

  afterAll(async () => {
    const rows = createdEventIds.length > 0 ? await db.select({ id: registrations.id, participantId: registrations.participantId }).from(registrations).where(inArray(registrations.eventId, createdEventIds)) : [];
    const registrationIds = rows.map((row) => row.id);
    const participantIds = [...new Set(rows.map((row) => row.participantId))];
    if (registrationIds.length > 0) {
      await db.delete(emailOutbox).where(inArray(emailOutbox.registrationId, registrationIds));
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, registrationIds));
    }
    if (createdEventIds.length > 0) {
      await db.delete(registrations).where(inArray(registrations.eventId, createdEventIds));
      await db.delete(events).where(inArray(events.id, createdEventIds));
    }
    if (participantIds.length > 0) {
      await db.delete(emailOutbox).where(inArray(emailOutbox.participantId, participantIds));
      await db.delete(participants).where(inArray(participants.id, participantIds));
    }
    // The club's limit as this suite found it.
    await db.delete(platformSettings).where(eq(platformSettings.key, ADDRESS_CAP_SETTING_KEY));
    if (previousCap !== undefined) await db.insert(platformSettings).values({ key: ADDRESS_CAP_SETTING_KEY, value: previousCap, updatedAt: NOW });
    forgetCachedAddressCap();
    await pool.end();
  });

  async function createEvent(): Promise<EventForRegistration> {
    const [event] = await db
      .insert(events)
      .values({ type: "MEETUP", startsAt: new Date("2026-12-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: 50 })
      .returning();
    createdEventIds.push(event.id);
    return { id: event.id, eventStatus: event.eventStatus, registrationMode: "INTERNAL", startsAt: event.startsAt, registrationOpensAt: null, registrationClosesAt: null, capacity: event.capacity, raceId: null, publishedAt: NOW };
  }

  const submission = (email: string, firstName: string) => ({
    firstName,
    lastName: "Pop",
    birthDate: "1985-03-02",
    sex: "UNSPECIFIED",
    phone: "+40711111111",
    emergencyContactName: "Ion Vecinul",
    emergencyContactPhone: "+40722222222",
    email,
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    rulesAcknowledged: true,
    resultsNameConsent: false,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(NOW.getTime() - 30_000).toISOString(),
  });

  it("two members of one family pressing the public form at once: one registration, no error, on either schema", async () => {
    const event = await createEvent();
    const email = `family.race.${Date.now()}@example.ro`;
    const results = await Promise.allSettled([
      submitRegistration(db, event, submission(email, "Ana"), NOW),
      submitRegistration(db, event, submission(email, "Maria"), NOW),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(rows).toHaveLength(1);
  });

  it("the emailed links pressed together cannot pass the club's limit per address", async (context) => {
    if (!familyOpen) {
      context.skip("the family flow is closed until the contract release drops registrations_event_participant_unique");
      return;
    }
    await db
      .insert(platformSettings)
      .values({ key: ADDRESS_CAP_SETTING_KEY, value: { registrationsPerAddress: 2 }, updatedAt: NOW })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: { registrationsPerAddress: 2 }, updatedAt: NOW } });
    forgetCachedAddressCap();

    const event = await createEvent();
    const email = `family.cap.${Date.now()}@example.ro`;
    await submitRegistration(db, event, submission(email, "Ana"), NOW);
    const [ana] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));

    // Five people through five links at once, one slot left on the address.
    const results = await Promise.allSettled(
      ["Maria", "Ion", "Dan", "Eva", "Radu"].map((name) =>
        submitRegistration(db, event, { ...submission(email, name), phone: undefined }, NOW, "REAL", {
          source: "PUBLIC",
          createdByStaffUserId: null,
          anotherPerson: { participantId: ana.participantId },
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(refused).toHaveLength(4);
    for (const failure of refused) expect((failure.reason as { fields?: string[] }).fields).toEqual(["addressAtCap"]);

    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(rows).toHaveLength(2);
  });
});
