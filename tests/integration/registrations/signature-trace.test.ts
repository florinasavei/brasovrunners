import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { readSignatureTrace } from "@/modules/legal-documents/domain/signature-trace";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationTrailEn, declarationTrailRo } from "@/modules/legal-documents/templates/declaration";
import { deleteRegistrationByStaff } from "@/modules/registrations/admin-service";
import { declarationWords } from "@/modules/registrations/declaration-labels";
import { exportPersonData, viewPersonData } from "@/modules/registrations/person-data";
import * as repo from "@/modules/registrations/repository";
import { confirmByStaff, confirmEmail, type EventForRegistration, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import { findSignedDeclaration, renderSignedDeclarationPdf, signedDeclarationEntry } from "@/modules/registrations/signed-declaration";
import { signingInput } from "../../helpers/declaration-signing";
import { drawnRuns } from "../../helpers/pdf-drawn";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-033-02, BR-REQ-037-07 (§771, amending §418 and §330; the owner, 2026-10-14, after a SportID
 * «Consimțământ electronic» he received for a trail race) — the trace of the electronic signature on a
 * race declaration: the caller's IP address and browser, written on the acceptance at an email-link
 * signing and never on a paper one, read back for the PDF's small line under the signature and for
 * «Toate datele unei persoane», and deleted with the row.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");
const START = new Date("2026-10-11T07:00:00.000Z");
const IP = "203.0.113.9";
const BROWSER = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";

const CLUB_DECLARATION: LegalDocumentTranslationInput[] = [
  { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationTrailRo },
  { locale: "en", title: "Declaration", body: declarationTrailEn },
];

const submission = {
  firstName: "Ana",
  lastName: "Popescu",
  birthDate: "1990-05-17",
  sex: "FEMALE",
  nationality: "RO",
  country: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Popescu",
  emergencyContactPhone: "+40722222222",
  email: "ana@example.ro",
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

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => resetTables(db));

async function approve() {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const at = new Date("2026-01-01T00:00:00Z");
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: at, isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "TERMS", version: 1, effectiveAt: at, isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version: 1, effectiveAt: at, isApproved: true, contentSha256: computeContentHash(CLUB_DECLARATION), translations: CLUB_DECLARATION, now: NOW });
}

async function createEvent(): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: START, registrationMode: "INTERNAL", capacity: 10, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: NOW })
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

async function staff(role: StaffUser["role"]): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
  return row;
}

async function pending() {
  await approve();
  const event = await createEvent();
  await submitRegistration(db, event, submission, NOW);
  const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
  await confirmEmail(db, event, row.id, NOW);
  return { event, registrationId: row.id };
}

describe("the trace of the electronic signature on a race declaration (§771)", () => {
  it("writes the IP address and the browser of the press on an email-link acceptance", async () => {
    const { event, registrationId } = await pending();
    const trace = readSignatureTrace(new Headers({ "x-forwarded-for": `${IP}, 10.0.0.1`, "user-agent": BROWSER }));
    await signDeclaration(db, event, registrationId, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456", trace }, NOW);
    const [acceptance] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, registrationId));
    expect(acceptance.method).toBe("EMAIL_LINK");
    expect(acceptance.ip).toBe(IP);
    expect(acceptance.userAgent).toBe(BROWSER);
  });

  it("leaves both null when the request carried neither header, or no trace was passed", async () => {
    const { event, registrationId } = await pending();
    await signDeclaration(db, event, registrationId, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456", trace: readSignatureTrace(new Headers()) }, NOW);
    const [acceptance] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, registrationId));
    expect(acceptance.ip).toBeNull();
    expect(acceptance.userAgent).toBeNull();
  });

  it("never writes it on a paper acceptance, recorded at the desk by a member of staff", async () => {
    const { event, registrationId } = await pending();
    const volunteer = await staff("CONTRIBUTOR");
    await confirmByStaff(db, event, registrationId, volunteer, NOW);
    const [acceptance] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, registrationId));
    expect(acceptance.method).toBe("PAPER");
    expect(acceptance.ip).toBeNull();
    expect(acceptance.userAgent).toBeNull();
  });

  it("drops a trace handed to the writer beside a paper method — the rule is the writer's, not each caller's", async () => {
    const { event, registrationId } = await pending();
    const volunteer = await staff("CONTRIBUTOR");
    const [row] = await db.select().from(registrations).where(eq(registrations.id, registrationId));
    const document = (await db.query.legalDocuments.findFirst({ where: (t, { eq: is }) => is(t.key, "EVENT_DECLARATION") }))!;
    await repo.insertDeclarationAcceptance(db, {
      registrationId,
      legalDocumentId: document.id,
      declarationVersion: document.version,
      contentSha256: document.contentSha256,
      locale: row.locale,
      typedName: row.registeredName,
      acceptedAt: NOW,
      method: "PAPER",
      attestedByStaffUserId: volunteer.id,
      textHash: null,
      trace: { ip: IP, userAgent: BROWSER },
    });
    const [acceptance] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, registrationId));
    expect(event.id).toBe(row.eventId);
    expect(acceptance.method).toBe("PAPER");
    expect(acceptance.ip).toBeNull();
    expect(acceptance.userAgent).toBeNull();
  });

  it("hands the PDF the trace of an electronic signature, and nothing for a paper one; the line is drawn small under the signature", async () => {
    const { event, registrationId } = await pending();
    await signDeclaration(
      db,
      event,
      registrationId,
      { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456", trace: { ip: IP, userAgent: BROWSER } },
      NOW,
    );
    const signed = await findSignedDeclaration(db, registrationId);
    const labels = declarationWords("ro", NOW);
    const entry = await signedDeclarationEntry(db, signed!, event.id, labels, "participant");
    expect(entry!.signature?.trace).toEqual({ ip: IP, userAgent: BROWSER });

    const runs = await drawnRuns(() => renderSignedDeclarationPdf(db, signed!, event.id, labels, NOW, "participant"));
    const line = runs.find((run) => run.text.startsWith("Semnat electronic la "));
    expect(line?.text).toBe(`Semnat electronic la 04.09.2026, 13:00:00 (ora României) · IP ${IP} · ${BROWSER}`);
    // Small, under the signature: the page's body is 10.5 points, the trace line 8.
    expect(line?.size).toBe(8);
    // Then the version and the fingerprint, as before.
    expect(runs.some((run) => run.text.includes("sha256 "))).toBe(true);

    // The English copy says it in English.
    await db.update(registrations).set({ locale: "en" }).where(eq(registrations.id, registrationId));
    await db.update(declarationAcceptances).set({ locale: "en" }).where(eq(declarationAcceptances.registrationId, registrationId));
    const english = await findSignedDeclaration(db, registrationId);
    const enRuns = await drawnRuns(() => renderSignedDeclarationPdf(db, english!, event.id, declarationWords("en", NOW), NOW, "participant"));
    expect(enRuns.find((run) => run.text.startsWith("Signed electronically on "))?.text).toBe(`Signed electronically on 04.09.2026, 13:00:00 (Romania time) · IP ${IP} · ${BROWSER}`);
  });

  it("draws today's block for a paper acceptance, and for an electronic one from before the trace", async () => {
    const { event, registrationId } = await pending();
    const volunteer = await staff("CONTRIBUTOR");
    await confirmByStaff(db, event, registrationId, volunteer, NOW);
    const signed = await findSignedDeclaration(db, registrationId);
    const labels = declarationWords("ro", NOW);
    const paper = await drawnRuns(() => renderSignedDeclarationPdf(db, signed!, event.id, labels, NOW, "participant"));
    expect(paper.some((run) => run.text.startsWith("Semnat electronic la "))).toBe(false);
    expect(paper.some((run) => run.text.includes("Semnat pe hârtie"))).toBe(true);

    // The same row marked electronic, with no trace kept (a row from before it): the method line says how, no trace line.
    await db.update(declarationAcceptances).set({ method: "EMAIL_LINK", attestedByStaffUserId: null }).where(eq(declarationAcceptances.registrationId, registrationId));
    const before = await findSignedDeclaration(db, registrationId);
    const old = await drawnRuns(() => renderSignedDeclarationPdf(db, before!, event.id, labels, NOW, "participant"));
    expect(old.some((run) => run.text.startsWith("Semnat electronic la "))).toBe(false);
    expect(old.some((run) => run.text.startsWith("Semnat electronic "))).toBe(true);
  });

  it("lists the trace in «Toate datele unei persoane», on the page's read and in the JSON file", async () => {
    const { event, registrationId } = await pending();
    await signDeclaration(
      db,
      event,
      registrationId,
      { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456", trace: { ip: IP, userAgent: BROWSER } },
      NOW,
    );
    const admin = await staff("ADMIN");
    for (const read of [viewPersonData, exportPersonData]) {
      const data = await read(db, admin, "ana@example.ro", NOW);
      expect(data.declarationAcceptances).toHaveLength(1);
      expect(data.declarationAcceptances[0]).toMatchObject({ ip: IP, userAgent: BROWSER });
    }
  });

  it("deletes the trace with the row when an Administrator erases the registration", async () => {
    const { event, registrationId } = await pending();
    await signDeclaration(
      db,
      event,
      registrationId,
      { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456", trace: { ip: IP, userAgent: BROWSER } },
      NOW,
    );
    expect(await db.select().from(declarationAcceptances)).toHaveLength(1);
    const admin = await staff("ADMIN");
    await deleteRegistrationByStaff(db, admin, registrationId, "asked to be erased", NOW);
    // No row, so no address and no browser kept anywhere: they were columns of it.
    expect(await db.select().from(declarationAcceptances)).toHaveLength(0);
  });
});
