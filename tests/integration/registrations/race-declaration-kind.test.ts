import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import {
  declarationAsksMinorToSign,
  findEventDeclaration,
  insertLegalDocumentVersion,
  listApprovedRaceDeclarations,
  raceDeclarationsCurrent,
} from "@/modules/legal-documents/repository";
import { declarationRoadEn, declarationRoadRo, declarationTrailEn, declarationTrailRo } from "@/modules/legal-documents/templates/declaration";
import { confirmEmail, type EventForRegistration, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the race's declaration is two texts, trail (`EVENT_DECLARATION`) and road or park
 * (`EVENT_DECLARATION_ROAD`). The event's own declaration is the organizer's chosen kind, else its
 * course's; a road race signs the trail text while no road text is approved. The signature binds to
 * the text the event resolves to, and nothing else.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");
const EFFECTIVE = new Date("2026-01-01T00:00:00Z");

let db: TestDatabase;
let close: () => Promise<void>;

const translations = (ro: LegalDocumentBody, en: LegalDocumentBody, title: string): LegalDocumentTranslationInput[] => [
  { locale: "ro", title, body: ro },
  { locale: "en", title, body: en },
];

async function approve(key: "PRIVACY_NOTICE" | "TERMS" | "EVENT_DECLARATION" | "EVENT_DECLARATION_ROAD", texts: LegalDocumentTranslationInput[], version = 1) {
  const contentSha256 = computeContentHash(texts);
  const id = await insertLegalDocumentVersion(db, { key, version, effectiveAt: EFFECTIVE, isApproved: true, contentSha256, translations: texts, now: NOW });
  return { id, contentSha256 };
}

async function approveBasics() {
  const plain = translations({ sections: [{ paragraphs: ["p"] }] }, { sections: [{ paragraphs: ["p"] }] }, "Text");
  await approve("PRIVACY_NOTICE", plain);
  await approve("TERMS", plain);
  return approve("EVENT_DECLARATION", translations(declarationTrailRo, declarationTrailEn, "Trail"));
}

async function createRace(surface: "ASPHALT" | "TRAIL" | null, declarationDocumentId: string | null = null): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", surface, startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity: 10, declarationDocumentId, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul aniversar", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The anniversary cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: event.registrationMode, registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

const submission = {
  firstName: "Florin",
  lastName: "Munca",
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
  nationality: "RO",
  country: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Popescu",
  emergencyContactPhone: "+40722222222",
  email: "florin@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
};

describe("§NNN the event's own declaration: trail or road", () => {
  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  it("gives an asphalt race the trail text while no road text is approved, and the road text once one is", async () => {
    const trail = await approveBasics();
    const road = await createRace("ASPHALT");
    const mountain = await createRace("TRAIL");
    expect((await findEventDeclaration(db, road.id, "ro", NOW))?.id).toBe(trail.id);
    expect(await raceDeclarationsCurrent(db, NOW)).toBe(false);

    const roadText = await approve("EVENT_DECLARATION_ROAD", translations(declarationRoadRo, declarationRoadEn, "Road"));
    expect((await findEventDeclaration(db, road.id, "ro", NOW))?.id).toBe(roadText.id);
    expect((await findEventDeclaration(db, road.id, "en", NOW))?.key).toBe("EVENT_DECLARATION_ROAD");
    // A trail race never reads the road text.
    expect((await findEventDeclaration(db, mountain.id, "ro", NOW))?.id).toBe(trail.id);
    // Both kinds are in force from the platform's shared body.
    expect(await raceDeclarationsCurrent(db, NOW)).toBe(true);
  });

  it("follows the organizer's chosen kind over the course", async () => {
    const trail = await approveBasics();
    const roadText = await approve("EVENT_DECLARATION_ROAD", translations(declarationRoadRo, declarationRoadEn, "Road"));
    // A mixed-surface park race whose organizer picked the road text; an asphalt race picked trail.
    const park = await createRace(null, roadText.id);
    const asphaltTrail = await createRace("ASPHALT", trail.id);
    expect((await findEventDeclaration(db, park.id, "ro", NOW))?.id).toBe(roadText.id);
    expect((await findEventDeclaration(db, asphaltTrail.id, "ro", NOW))?.id).toBe(trail.id);
    // The editor lists both kinds, trail first, each with its key.
    expect((await listApprovedRaceDeclarations(db, "ro")).map((row) => [row.key, row.version])).toEqual([
      ["EVENT_DECLARATION", 1],
      ["EVENT_DECLARATION_ROAD", 1],
    ]);
    // Both platform texts ask a minor of 14–17 to sign beside the parent.
    expect(await declarationAsksMinorToSign(db, "ro", NOW, park.id)).toBe(true);
  });

  it("binds the signature to the event's own text: an asphalt race signs the road text, and the trail text's id is refused", async () => {
    const trail = await approveBasics();
    const roadText = await approve("EVENT_DECLARATION_ROAD", translations(declarationRoadRo, declarationRoadEn, "Road"));
    const event = await createRace("ASPHALT");
    await submitRegistration(db, event, submission, NOW);
    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, row.id, NOW);

    const signing = { accepted: true, typedName: "Florin Munca", idDocument: "BV 123456" };
    // The trail text is not what this event's page shows: the version check refuses it (§57).
    await expect(
      signDeclaration(db, event, row.id, { ...signing, documentId: trail.id, contentSha256: trail.contentSha256 }, NOW),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const signed = await signDeclaration(db, event, row.id, { ...signing, documentId: roadText.id, contentSha256: roadText.contentSha256 }, NOW);
    expect(signed.status).toBe("CONFIRMED");
    const [acceptance] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, row.id));
    expect(acceptance.legalDocumentId).toBe(roadText.id);
  });
});
