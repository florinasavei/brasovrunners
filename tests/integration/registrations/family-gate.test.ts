import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the family flow switches itself on with the schema (`family-gate.ts`).
 *
 * Migration `0073` adds the new key beside the one-registration-per-address constraint; the old
 * constraint is dropped by a contract migration of its own in a later release (AGENTS.md §7.6).
 * Until then a second row on an address would be refused by the database, so the flow must behave
 * exactly as before and never offer a link it cannot honour. These tests run on today's schema.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const EMAIL = "familia.pop@example.ro";

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));

const { submitRegistration } = await import("@/modules/registrations/service");
const { consumeAndRegisterAnotherPerson, readAnotherPersonLink } = await import("@/modules/registrations/token-actions");
const { familyRegistrationOpen } = await import("@/modules/registrations/family-gate");
const { issueActionToken } = await import("@/modules/action-tokens/repository");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
});

async function createEvent() {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity: 20, editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul familiei", slug: "crosul-familiei" },
    { eventId: event.id, locale: "en", title: "The family cross", slug: "family-cross" },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL" as const, registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

const submission = (firstName: string, at: Date = NOW) => ({
  firstName,
  lastName: "Pop",
  birthDate: "1985-03-02",
  sex: "UNSPECIFIED",
  phone: "+40711111111",
  emergencyContactName: "Ion Vecinul",
  emergencyContactPhone: "+40722222222",
  email: EMAIL,
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(at.getTime() - 30_000).toISOString(),
});

describe("§NNN before the contract release: one registration per address, as before", () => {
  it("says the flow is closed while the old constraint stands", async () => {
    expect(await familyRegistrationOpen(db)).toBe(false);
  });

  it("another name on a registered address is today's re-send of the one registration, and no link is offered", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    const later = new Date(NOW.getTime() + 5 * 60_000);
    await submitRegistration(db, event, submission("Maria", later), later);

    expect(await db.select().from(registrations)).toHaveLength(1);
    const types = (await db.select().from(emailOutbox)).map((row) => row.messageType);
    expect(types).toEqual(["VERIFY_REGISTRATION_EMAIL", "VERIFY_REGISTRATION_EMAIL"]);
  });

  it("a link for another person — however it was minted — opens nothing and creates nothing, and stays unspent", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    const [ana] = await db.select().from(registrations);
    const { secret } = await issueActionToken(db, {
      participantId: ana.participantId,
      registrationId: ana.id,
      purpose: "REGISTER_ANOTHER_PERSON",
      expiresAt: new Date(NOW.getTime() + 48 * 3_600_000),
      now: NOW,
    });

    expect(await readAnotherPersonLink(secret, event.id, NOW)).toEqual({ ok: false });
    let fields: string[] = [];
    try {
      await consumeAndRegisterAnotherPerson(secret, event, { ...submission("Maria"), email: undefined }, {}, NOW);
    } catch (error) {
      if (!isDomainError(error)) throw error;
      fields = [...error.fields];
    }
    expect(fields).toEqual(["anotherLink"]);
    expect(await db.select().from(registrations)).toHaveLength(1);
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"));
    expect(token.usedAt).toBeNull();
  });

  it("opens by itself once the contract migration has dropped the constraint", async () => {
    await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT registrations_event_participant_unique`);
    try {
      expect(await familyRegistrationOpen(db)).toBe(true);
    } finally {
      // The next test file on this worker gets its own database; this one is left as it was found.
      await db.execute(sql`ALTER TABLE registrations ADD CONSTRAINT registrations_event_participant_unique UNIQUE (event_id, participant_id)`);
    }
    expect(await familyRegistrationOpen(db)).toBe(false);
  });
});
