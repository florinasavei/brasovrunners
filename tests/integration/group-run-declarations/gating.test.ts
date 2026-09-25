import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events, eventTranslations } from "@/db/schema/events";
import { legalDocuments, type LegalDocumentKey } from "@/db/schema/legal-documents";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { confirmEmail, type EventForRegistration, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-053-01, §NNN — the group runs' two declarations gate nothing.
 *
 * A registration still rests on the three texts it always did: no approved privacy notice, no
 * registration; the race's declaration is what a registration signs and what confirms it. An
 * approved group-run declaration stands in for none of them, and its absence stops none of them.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

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

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
});

async function approve(key: LegalDocumentKey) {
  const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES[key][locale] }));
  await insertLegalDocumentVersion(db, {
    key,
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

async function race(): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity: 10, locationName: "Parcul" })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: "crosul" },
    { eventId: event.id, locale: "en", title: "The cross", slug: "the-cross" },
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

describe("BR-REQ-053-01 the group runs' declarations gate nothing (§NNN)", () => {
  it("do not stand in for the privacy notice: with only them approved, a registration is still refused", async () => {
    await approve("GROUP_RUN_DECLARATION_ASPHALT");
    await approve("GROUP_RUN_DECLARATION_TRAIL");
    const event = await race();
    await expect(submitRegistration(db, event, submission, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await db.select().from(registrations)).toHaveLength(0);
  });

  it("are not needed: without them a registration is taken, signed and confirmed as before", async () => {
    await approve("PRIVACY_NOTICE");
    await approve("TERMS");
    await approve("EVENT_DECLARATION");
    const event = await race();
    await submitRegistration(db, event, submission, NOW);
    const [row] = await db.select().from(registrations);
    await confirmEmail(db, event, row.id, NOW);
    const signed = await signDeclaration(db, event, row.id, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456" }, NOW);
    expect(signed.status).toBe("CONFIRMED");
  });

  it("are never what a registration signs: beside them, the acceptance still names the race's declaration", async () => {
    await approve("PRIVACY_NOTICE");
    await approve("EVENT_DECLARATION");
    await approve("GROUP_RUN_DECLARATION_TRAIL");
    const event = await race();
    await submitRegistration(db, event, submission, NOW);
    const [row] = await db.select().from(registrations);
    await confirmEmail(db, event, row.id, NOW);
    await signDeclaration(db, event, row.id, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456" }, NOW);
    const [acceptance] = await db.select().from(declarationAcceptances).orderBy(desc(declarationAcceptances.acceptedAt)).limit(1);
    const [document] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, acceptance.legalDocumentId));
    expect(document.key).toBe("EVENT_DECLARATION");
  });
});
