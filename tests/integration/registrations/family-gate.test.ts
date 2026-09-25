import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §389 — the family flow switches itself on with the schema (`family-gate.ts`).
 *
 * Migration `0072` added the new key beside the one-registration-per-address constraint; migration
 * `0073` is the contract release that drops the old constraint (AGENTS.md §7.6), and this database
 * — created fresh through every migration — carries it gone from the start: the flow is open by
 * default. The second `describe` below restores the legacy constraint for the length of each test,
 * the way it stood before `0073`, to prove the gate still reads the schema rather than a flag and
 * that the pre-family behaviour it guarded still works if that constraint were ever back.
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

describe("§NNN after the contract migration: the flow is open by default", () => {
  it("says the flow is open now that migration 0073 has dropped the constraint", async () => {
    expect(await familyRegistrationOpen(db)).toBe(true);
  });

  it("closes again if the legacy constraint is ever restored, and reopens once it is gone", async () => {
    await db.execute(sql`ALTER TABLE registrations ADD CONSTRAINT registrations_event_participant_unique UNIQUE (event_id, participant_id)`);
    try {
      expect(await familyRegistrationOpen(db)).toBe(false);
    } finally {
      await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
    }
    expect(await familyRegistrationOpen(db)).toBe(true);
  });
});

describe("§NNN if the legacy constraint were ever restored: one registration per address, as before 0073", () => {
  beforeEach(async () => {
    await db.execute(sql`ALTER TABLE registrations ADD CONSTRAINT registrations_event_participant_unique UNIQUE (event_id, participant_id)`);
  });

  afterEach(async () => {
    await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
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
});
