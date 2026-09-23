import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationEn, declarationRo } from "@/modules/legal-documents/templates/declaration";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { messagesPerCompletedRegistration, MESSAGES_PER_COMPLETED_REGISTRATION } from "@/modules/notifications/volume";
import { confirmEmail, type EventForRegistration, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import { addTestRegistrations } from "@/modules/registrations/test-registrations";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §99 — the club's archive copy of every signed declaration.
 *
 * `env` is parsed once at import (`shared/config/env.ts`), so the archive address is mocked
 * for this file alone; the other files see it unset and prove the copy is *not* sent then.
 */
vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  return { ...actual, env: { ...actual.env, DECLARATIONS_ARCHIVE_TO: "arhiva@example.test" } };
});

const NOW = new Date("2026-09-04T10:00:00.000Z");
const ARCHIVE = "arhiva@example.test";

async function approve(db: TestDatabase) {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationRo },
    { locale: "en", title: "Declaration", body: declarationEn },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(declaration), translations: declaration, now: NOW });
}

async function createEvent(db: TestDatabase): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity: 10, locationName: "Parcul Tractorul" })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul aniversar", slug: "crosul-aniversar" },
    { eventId: event.id, locale: "en", title: "The anniversary cross", slug: "anniversary-cross" },
  ]);
  return {
    id: event.id,
    raceId: null,
    capacity: event.capacity,
    registrationMode: event.registrationMode,
    registrationOpensAt: null,
    registrationClosesAt: null,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
  };
}

const submission = {
  firstName: "Ana",
  lastName: "Popescu",
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
  nationality: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Popescu",
  emergencyContactPhone: "+40722222222",
  email: "ana@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
};

describe("the club's archive copy (§99)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  async function signed(db: TestDatabase, event: EventForRegistration) {
    await submitRegistration(db, event, submission, NOW);
    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, row.id, NOW);
    await signDeclaration(db, event, row.id, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456" }, NOW);
    return row;
  }

  it("queues the archive copy to the club's mailbox, with the PDF and no action link", async () => {
    await approve(db);
    const event = await createEvent(db);
    const row = await signed(db, event);

    const queued = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, row.id));
    const archive = queued.find((r) => r.messageType === "DECLARATION_ARCHIVE");
    expect(archive).toBeDefined();
    expect(archive!.recipientEmail).toBe(ARCHIVE);
    // The participant's own copy rides on their confirmation (§126), to the participant.
    expect(queued.find((r) => r.messageType === "REGISTRATION_CONFIRMED")?.recipientEmail).toBe("ana@example.ro");

    const message = await renderOutboxMessage({ ...archive!, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    expect(message.to).toBe(ARCHIVE);
    // Searchable by who and for what; both halves name the event as the row's language does (§96).
    expect(message.subject).toBe("Declarație semnată: Ana Popescu — Crosul aniversar / Signed declaration: Ana Popescu — Crosul aniversar");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments![0].data.toString("latin1").startsWith("%PDF-1.")).toBe(true);
    // No manage token, no PDF-by-token link: a secret in the club's mailbox would be a secret
    // handed to the wrong person (§12.8). The greeting is the club's, not the runner's.
    expect(message.html).not.toMatch(/\/registrations\/manage\//);
    expect(message.html).not.toMatch(/\/api\/registrations\/declaration\//);
    expect(message.text).not.toContain("Salut, Ana Popescu");
    expect(message.text).toContain("Salut,");
    // The attached copy masks the identity document (§NNN), and the message says where the whole one is.
    expect(message.text).toContain("fără seria și numărul actului de identitate");
    expect(message.text).toContain("până la șapte zile după eveniment");
    expect(message.text).toContain("without the identity document's series and number");
  });

  it("sends no archive copy for a test registration", async () => {
    await approve(db);
    const event = await createEvent(db);
    const [admin] = await db.insert(staffUsers).values({ email: "superadmin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    // A synthetic runner on its declaration hold (§30); the same signing act as a real one.
    await addTestRegistrations(db, admin, { eventId: event.id, count: 1, now: NOW });
    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(row.kind).toBe("TEST");
    await signDeclaration(db, event, row.id, { ...(await signingInput(db, NOW, row.registeredName)), idDocument: "BV 000000" }, NOW);

    const types = (await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, row.id))).map((r) => r.messageType);
    expect(types).toContain("REGISTRATION_CONFIRMED");
    expect(types).not.toContain("DECLARATION_ARCHIVE");
  });

  it("counts one more message per registration on the allowance while the archive is on", () => {
    expect(messagesPerCompletedRegistration({ archiveConfigured: true, participantBccCount: 0 })).toBe(MESSAGES_PER_COMPLETED_REGISTRATION + 1);
    expect(messagesPerCompletedRegistration({ archiveConfigured: false, participantBccCount: 0 })).toBe(MESSAGES_PER_COMPLETED_REGISTRATION);
  });
});
