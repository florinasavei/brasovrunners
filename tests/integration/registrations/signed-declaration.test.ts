import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationEn, declarationRo } from "@/modules/legal-documents/templates/declaration";
import { renderDeclarationPdf } from "@/modules/registrations/declaration-pdf";
import { confirmEmail, type EventForRegistration, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import {
  findSignedDeclaration,
  listSignedDeclarations,
  renderBlankDeclarationPdf,
  renderEventDeclarationsPdf,
  renderSignedDeclarationPdf,
  signedDeclarationEntry,
} from "@/modules/registrations/signed-declaration";
import { emailOutbox } from "@/db/schema/email-outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §95 — the club's declaration: its blanks are fields, the identity document is
 * asked when the text names it, and the signed declaration is reproducible as a PDF for the
 * runner and for the club's archive.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

const LABELS = {
  organization: "Brașov Runners",
  whereupon: "DREPT PENTRU CARE SEMNEZ,",
  signature: "Semnătura",
  date: "Data",
  idDocument: "Act de identitate",
  version: "Versiunea",
  generatedOn: "Generat la 4 septembrie 2026",
  page: (n: number, total: number) => `Pagina ${n} din ${total}`,
  signedByLink: (when: string) => `Semnat electronic la ${when}`,
  signedOnPaper: (who: string, when: string) => `Semnat pe hârtie; înregistrat de ${who} la ${when}`,
  attesterRemoved: "un membru al echipei",
};

async function approve(db: TestDatabase, declaration: LegalDocumentTranslationInput[]) {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(declaration), translations: declaration, now: NOW });
}

const CLUB_DECLARATION: LegalDocumentTranslationInput[] = [
  { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationRo },
  { locale: "en", title: "Declaration", body: declarationEn },
];
const PLAIN_DECLARATION: LegalDocumentTranslationInput[] = [
  { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Particip pe proprie răspundere."] }] } },
  { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I take part at my own risk."] }] } },
];

async function createEvent(db: TestDatabase): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    // Published, which is what an event taking registrations is — and what the confirmation's
    // calendar attachment requires (§174): an `.ics` for a draft would put an unpublished
    // page's details into somebody's calendar.
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
    publishedAt: NOW, // registration opens at publication when unset
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
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
};

describe("the club's declaration (§95)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  async function pendingRegistration(event: EventForRegistration) {
    await submitRegistration(db, event, submission, NOW);
    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, row.id, NOW);
    return row;
  }

  it("asks for the identity document when the text names it, records it, and prints it", async () => {
    await approve(db, CLUB_DECLARATION);
    const event = await createEvent(db);
    const pending = await pendingRegistration(event);
    const read = await signingInput(db, NOW, "Ana Popescu");

    await expect(signDeclaration(db, event, pending.id, read, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(signDeclaration(db, event, pending.id, { ...read, idDocument: "!!" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const confirmed = await signDeclaration(db, event, pending.id, { ...read, idDocument: "bv 123456" }, NOW);
    expect(confirmed.status).toBe("CONFIRMED");
    const [acceptance] = await db.select().from(declarationAcceptances);
    expect(acceptance.idDocument).toBe("bv 123456");

    const signed = await findSignedDeclaration(db, pending.id);
    expect(signed?.typedName).toBe("Ana Popescu");
    expect(signed?.idDocument).toBe("bv 123456");
    const entry = await signedDeclarationEntry(db, signed!, event.id, LABELS);
    const text = entry!.body.sections.flatMap((s) => s.paragraphs).join(" ");
    // The blanks are filled: the person, the document, the event, its date and its place.
    expect(text).toContain("Subsemnatul/a Ana Popescu, posesor/posesoare al actului de identitate bv 123456");
    expect(text).toContain("la evenimentul Crosul aniversar, care va avea loc în data de 11 octombrie 2026, în locația Parcul Tractorul");
    expect(text).not.toContain("{{");

    const pdf = await renderSignedDeclarationPdf(db, signed!, event.id, LABELS, NOW);
    const raw = pdf!.toString("latin1");
    expect(raw.startsWith("%PDF-1.")).toBe(true);
    expect(raw).toMatch(/Caveat/); // the signature in the hand the page showed it in
    expect(raw).toMatch(/Roboto/);
  });

  it("does not ask for a document the text never names, and prints the blank form for the desk", async () => {
    await approve(db, PLAIN_DECLARATION);
    const event = await createEvent(db);
    const pending = await pendingRegistration(event);
    const confirmed = await signDeclaration(db, event, pending.id, await signingInput(db, NOW), NOW);
    expect(confirmed.status).toBe("CONFIRMED");
    expect((await db.select().from(declarationAcceptances))[0].idDocument).toBeNull();

    const blank = await renderBlankDeclarationPdf(db, event.id, "ro", LABELS, NOW);
    expect(blank!.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(1);
  });

  it("bundles every signed declaration of an event, oldest first, one per page at least", async () => {
    await approve(db, CLUB_DECLARATION);
    const event = await createEvent(db);
    const first = await pendingRegistration(event);
    await signDeclaration(db, event, first.id, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 111111" }, NOW);
    await submitRegistration(db, event, { ...submission, email: "ion@example.ro", firstName: "Ion", lastName: "Ionescu" }, NOW);
    const [second] = await db.select().from(registrations).where(eq(registrations.eventId, event.id)).then((rows) => rows.filter((r) => r.id !== first.id));
    await confirmEmail(db, event, second.id, NOW);
    await signDeclaration(db, event, second.id, { ...(await signingInput(db, NOW, "Ion Ionescu")), idDocument: "BV 222222" }, new Date(NOW.getTime() + 60_000));

    const all = await listSignedDeclarations(db, event.id);
    expect(all.map((s) => s.typedName)).toEqual(["Ana Popescu", "Ion Ionescu"]);
    const pdf = await renderEventDeclarationsPdf(db, event.id, "ro", LABELS, NOW);
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBeGreaterThanOrEqual(2);
    // Nothing signed is still a valid file.
    const empty = await renderDeclarationPdf({ entries: [], locale: "ro", generatedAt: NOW, labels: LABELS });
    expect(empty.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(1);
  });

  it("sends the signed declaration back by email, attached to the confirmation (§126)", async () => {
    await approve(db, CLUB_DECLARATION);
    const event = await createEvent(db);
    const pending = await pendingRegistration(event);
    await signDeclaration(db, event, pending.id, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456" }, NOW);

    const queued = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, pending.id));
    const types = queued.map((row) => row.messageType);
    expect(types).toContain("REGISTRATION_CONFIRMED");
    // Since §126 the participant's copy rides on the confirmation, not as a message of its own.
    expect(types).not.toContain("DECLARATION_SIGNED");

    const row = queued.find((r) => r.messageType === "REGISTRATION_CONFIRMED")!;
    const message = await renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    expect(message.subject).toBe("Înscrierea este confirmată / Your registration is confirmed"); // bilingual, the registration's language first (§96)
    /**
     * Two attachments since §174: the event for the runner's calendar, and the declaration they
     * signed. The calendar file rides on the confirmation because that is the message somebody
     * acts on, and every phone opens an `.ics` with one tap — including the clients that will
     * not follow a link out to the site.
     */
    const byName = new Map((message.attachments ?? []).map((one) => [one.filename, one]));
    expect([...byName.keys()].sort()).toEqual(["crosul-aniversar.ics", "declaratie-semnata.pdf"]);
    expect(byName.get("declaratie-semnata.pdf")!.data.toString("latin1").startsWith("%PDF-1.")).toBe(true);

    const ics = byName.get("crosul-aniversar.ics")!;
    expect(ics.contentType).toContain("text/calendar");
    const calendar = ics.data.toString("utf8");
    expect(calendar).toContain("BEGIN:VCALENDAR");
    expect(calendar).toContain("BEGIN:VEVENT");
    // The event's own details, not a stub: the same file the page offers (§107, §159).
    expect(calendar).toContain("Crosul aniversar");
    // The same manage token serves the link to the PDF, for a client that strips attachments.
    expect(message.html).toMatch(/\/api\/registrations\/declaration\/[A-Za-z0-9_-]+/);
    expect(message.text).toContain("Declarația pe care ai semnat-o (PDF)");
  });
});
