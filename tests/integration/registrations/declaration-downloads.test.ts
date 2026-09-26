import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationEn, declarationRo } from "@/modules/legal-documents/templates/declaration";
import { confirmEmail, type EventForRegistration, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §324 (review finding on §322's "exports are audited") — the signed declarations leave the
 * application as PDFs too: the event's bundle, which names every runner and their identity
 * document, and one registration's copy. No erase reaches a downloaded file, so the trail says
 * it was made: who, when, which event or registration, how many — never a name or a number.
 * Called through the two route handlers, as the backoffice's links call them.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let organizer: StaffUser;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("@/modules/staff-identity/session", () => ({ requireStaff: async () => organizer }));

const { GET: eventBundle } = await import("@/app/api/admin/events/[id]/declarations/route");
const { GET: oneDeclaration } = await import("@/app/api/admin/registrations/[id]/declaration/route");

const DECLARATION: LegalDocumentTranslationInput[] = [
  { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationRo },
  { locale: "en", title: "Declaration", body: declarationEn },
];

async function approveTexts() {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const effectiveAt = new Date("2026-01-01T00:00:00Z");
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt, isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "TERMS", version: 1, effectiveAt, isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version: 1, effectiveAt, isApproved: true, contentSha256: computeContentHash(DECLARATION), translations: DECLARATION, now: NOW });
}

async function createEvent(): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-10-11T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity: 10,
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
    })
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

async function signedRegistration(event: EventForRegistration): Promise<string> {
  await submitRegistration(
    db,
    event,
    {
      firstName: "Ana",
      lastName: "Popescu",
      birthDate: "1990-05-17",
      sex: "UNSPECIFIED",
      phone: "+40711111111",
      emergencyContactName: "Ion Popescu",
      emergencyContactPhone: "+40722222222",
      nationality: "RO",
      email: "ana@example.ro",
      locale: "ro",
      privacyAcknowledged: true,
      fitnessDeclared: true,
      termsAccepted: true,
      rulesAcknowledged: true,
      listOptOut: true,
      honeypot: "",
      renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    },
    NOW,
  );
  const [pending] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
  await confirmEmail(db, event, pending.id, NOW);
  await signDeclaration(db, event, pending.id, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456" }, NOW);
  return pending.id;
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  [organizer] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Organizator", role: "MODERATOR" }).returning();
  await approveTexts();
});

describe("§324 a downloaded declaration PDF is recorded in the trail", () => {
  it("records the event's bundle with the event and the count, and no name or identity number", async () => {
    const event = await createEvent();
    await signedRegistration(event);

    const response = await eventBundle(new Request(`https://example.test/api/admin/events/${event.id}/declarations?locale=ro`), {
      params: Promise.resolve({ id: event.id }),
    });
    expect(response.status).toBe(200);

    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.declarations_downloaded"));
    expect(trail.map((row) => [row.actorStaffUserId, row.entityType, row.entityId, row.metadataJson])).toEqual([
      [organizer.id, "event", event.id, { format: "pdf", rowCount: 1 }],
    ]);
    expect(JSON.stringify(trail)).not.toMatch(/Ana|Popescu|123456/);
  });

  it("records one registration's copy on its own timeline, and no name or identity number", async () => {
    const event = await createEvent();
    const id = await signedRegistration(event);

    const response = await oneDeclaration(new Request(`https://example.test/api/admin/registrations/${id}/declaration`), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(200);

    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.declaration_downloaded"));
    expect(trail.map((row) => [row.actorStaffUserId, row.entityType, row.entityId, row.metadataJson])).toEqual([
      [organizer.id, "registration", id, { format: "pdf" }],
    ]);
    expect(JSON.stringify(trail)).not.toMatch(/Ana|Popescu|123456/);
  });

  it("records nothing when there is no signed declaration to download", async () => {
    const id = "00000000-0000-4000-8000-000000000000";

    const response = await oneDeclaration(new Request(`https://example.test/api/admin/registrations/${id}/declaration`), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(404);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.declaration_downloaded"))).toHaveLength(0);
  });
});
