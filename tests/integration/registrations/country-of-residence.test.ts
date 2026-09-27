import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { findRegistrationDetailForAdmin, listWorkbookDetails } from "@/modules/registrations/admin-repository";
import { type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the country the runner lives in, asked before the city: required on the public form,
 * stored on the registration, read by the spreadsheet and the backoffice page, never public.
 * And «Sex» with no answer is refused rather than recorded as «Prefer să nu spun».
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

async function approveLegalDocuments(db: TestDatabase) {
  const text: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS"] as const) {
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(text),
      translations: text,
      now: NOW,
    });
  }
}

async function createInternalEvent(db: TestDatabase): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: null })
    .returning();
  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    capacity: null,
    raceId: null,
    publishedAt: NOW,
  };
}

function submissionInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    firstName: "Anna",
    lastName: "Schmidt",
    birthDate: "1990-05-17",
    sex: "FEMALE",
    nationality: "RO",
    country: "DE",
    city: "München",
    phone: "+40711111111",
    emergencyContactName: "Contact Urgență",
    emergencyContactPhone: "+40722222222",
    email: "anna@example.org",
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    termsAccepted: true,
    rulesAcknowledged: true,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    ...overrides,
  };
}

describe("§NNN the country of residence and a chosen «Sex»", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    await approveLegalDocuments(db);
  });

  it("stores the country apart from the citizenship, and the spreadsheet and the backoffice read it", async () => {
    const event = await createInternalEvent(db);
    await submitRegistration(db, event, submissionInput(), NOW);

    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(row.country).toBe("DE");
    expect(row.nationality).toBe("RO");
    expect(row.sex).toBe("FEMALE");

    const sheet = await listWorkbookDetails(db, [row.id]);
    expect(sheet.get(row.id)?.country).toBe("DE");
    expect(sheet.get(row.id)?.city).toBe("München");

    const detail = await findRegistrationDetailForAdmin(db, row.id);
    expect(detail?.country).toBe("DE");
    expect(detail?.city).toBe("München");
  });

  it("refuses a public submission with no country, and one with no answer to «Sex»", async () => {
    const event = await createInternalEvent(db);
    await expect(submitRegistration(db, event, submissionInput({ country: undefined }), NOW)).rejects.toThrow();
    await expect(submitRegistration(db, event, submissionInput({ email: "b@example.org", sex: "" }), NOW)).rejects.toThrow();
    expect(await db.select().from(registrations).where(eq(registrations.eventId, event.id))).toHaveLength(0);
  });
});
