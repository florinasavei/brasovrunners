import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { hardDeleteEvent } from "@/modules/content/events/service";
import { pruneExpiredRows } from "@/modules/jobs/retention";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { signedTextHash } from "@/modules/legal-documents/domain/signed-text";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationTrailEn, declarationTrailRo } from "@/modules/legal-documents/templates/declaration";
import { deleteRegistrationByStaff } from "@/modules/registrations/admin-service";
import { holdDeclarationAcceptance, releaseDeclarationAcceptance } from "@/modules/registrations/declaration-hold";
import { declarationWords } from "@/modules/registrations/declaration-labels";
import type { DeclarationPdfInput } from "@/modules/registrations/declaration-pdf";
import { confirmByStaff, confirmEmail, type EventForRegistration, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import { findSignedDeclaration, renderSignedDeclarationPdf, signedDeclarationEntry } from "@/modules/registrations/signed-declaration";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-033-02 (§556, amending §85 and §499; the second review of 2026-09-29) — the proof of signing
 * on a race declaration: the row keeps the SHA-256 of the exact text signed, computed in the signing's
 * transaction from the same fill-ins the PDF prints; the PDF's proof line prints the version, the
 * instant and that hash from the row, and the club's archive copy prints the same line. And the hold:
 * «Păstrează: reclamație / litigiu în curs» keeps the registration and its declaration past the
 * three-year sweep until an Administrator clears it, refuses every erase meanwhile, and writes an audit
 * row naming who, why and the row — never the person.
 */
const watched = vi.hoisted(() => ({ pdfInputs: [] as unknown[] }));
vi.mock("@/modules/registrations/declaration-pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/registrations/declaration-pdf")>();
  return {
    ...actual,
    renderDeclarationPdf: async (input: Parameters<typeof actual.renderDeclarationPdf>[0]) => {
      watched.pdfInputs.push(input);
      return actual.renderDeclarationPdf(input);
    },
  };
});

const NOW = new Date("2026-09-04T10:00:00.000Z");
const START = new Date("2026-10-11T07:00:00.000Z");
// Three years and a day after the race: the sweep's period is over.
const LATER = new Date("2029-10-12T07:00:00.000Z");

const CLUB_DECLARATION: LegalDocumentTranslationInput[] = [
  { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationTrailRo },
  { locale: "en", title: "Declaration", body: declarationTrailEn },
];

const submission = {
  firstName: "Ana",
  lastName: "Popescu",
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
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
beforeEach(async () => {
  await resetTables(db);
  watched.pdfInputs.length = 0;
});

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

/** One signed race declaration: the event, the registration, the acceptance row. */
async function signed() {
  await approve();
  const event = await createEvent();
  await submitRegistration(db, event, submission, NOW);
  const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
  await confirmEmail(db, event, row.id, NOW);
  await signDeclaration(db, event, row.id, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456" }, NOW);
  const [acceptance] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, row.id));
  return { event, registrationId: row.id, acceptance };
}

describe("the proof of signing on a race declaration (§556)", () => {
  it("keeps the SHA-256 of the exact text signed — the text the signer's PDF prints — on the row", async () => {
    const { event, registrationId, acceptance } = await signed();
    expect(acceptance.textHash).toMatch(/^[0-9a-f]{64}$/);
    // Not the version's hash: the filled text's.
    expect(acceptance.textHash).not.toBe(acceptance.contentSha256);
    const declaration = await findSignedDeclaration(db, registrationId);
    const entry = await signedDeclarationEntry(db, declaration!, event.id, declarationWords("ro", NOW), "participant");
    expect(signedTextHash({ title: entry!.title, body: entry!.body, values: entry!.values ?? {} })).toBe(acceptance.textHash);
    expect(entry!.textHash).toBe(acceptance.textHash);
  });

  it("keeps the hash of the paper's text for a declaration confirmed on paper at the desk — its documents dotted blanks", async () => {
    await approve();
    const event = await createEvent();
    await submitRegistration(db, event, submission, NOW);
    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, row.id, NOW);
    const volunteer = await staff("CONTRIBUTOR");
    await confirmByStaff(db, event, row.id, volunteer, NOW);
    const [acceptance] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, row.id));
    expect(acceptance.textHash).toMatch(/^[0-9a-f]{64}$/);
    const declaration = await findSignedDeclaration(db, row.id);
    const entry = await signedDeclarationEntry(db, declaration!, event.id, declarationWords("ro", NOW), "participant");
    expect(signedTextHash({ title: entry!.title, body: entry!.body, values: entry!.values ?? {} })).toBe(acceptance.textHash);
    expect(entry!.textHash).toBe(acceptance.textHash);
  });

  it("prints the proof line from the row on the signer's copy and on the club's archive copy alike", async () => {
    const { event, registrationId, acceptance } = await signed();
    const declaration = await findSignedDeclaration(db, registrationId);
    const labels = declarationWords("ro", NOW);
    for (const audience of ["participant", "club"] as const) {
      await renderSignedDeclarationPdf(db, declaration!, event.id, labels, NOW, audience);
    }
    const lines = (watched.pdfInputs as DeclarationPdfInput[]).map((input) => {
      const [entry] = input.entries;
      return input.labels.proofLine(entry.version, "…", entry.textHash ?? null);
    });
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toBe(`Versiunea 1 · Semnat la … (ora României) · Amprenta documentului (SHA-256): ${acceptance.textHash}`);
    // The instant the line prints is the row's own.
    expect((watched.pdfInputs as DeclarationPdfInput[])[0].entries[0].signature?.acceptedAt.getTime()).toBe(NOW.getTime());
  });

  it("prints no hash for a row from before it, never one computed now", async () => {
    const { event, registrationId } = await signed();
    await db.update(declarationAcceptances).set({ textHash: null }).where(eq(declarationAcceptances.registrationId, registrationId));
    const declaration = await findSignedDeclaration(db, registrationId);
    const entry = await signedDeclarationEntry(db, declaration!, event.id, declarationWords("ro", NOW), "participant");
    expect(entry!.textHash).toBeNull();
  });
});

describe("«Păstrează: reclamație / litigiu în curs» on a race declaration (§556)", () => {
  it("keeps a held registration past the three-year sweep, and lets the sweep take it once cleared", async () => {
    const { registrationId, acceptance } = await signed();
    const administrator = await staff("ADMIN");
    await holdDeclarationAcceptance(db, administrator, { registrationId, acceptanceId: acceptance.id, reason: "Reclamație la ANSPDCP, dosar deschis" }, NOW);

    await pruneExpiredRows(db, LATER);
    expect(await db.select().from(registrations).where(eq(registrations.id, registrationId))).toHaveLength(1);
    const [held] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.id, acceptance.id));
    expect(held).toMatchObject({ retentionHold: true, retentionHoldReason: "Reclamație la ANSPDCP, dosar deschis", retentionHoldByStaffUserId: administrator.id });
    expect(held.retentionHoldAt?.getTime()).toBe(NOW.getTime());

    await releaseDeclarationAcceptance(db, administrator, { registrationId, acceptanceId: acceptance.id, reason: "Dosar închis" }, LATER);
    const [released] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.id, acceptance.id));
    expect(released).toMatchObject({ retentionHold: false, retentionHoldReason: null, retentionHoldAt: null, retentionHoldByStaffUserId: null });

    await pruneExpiredRows(db, LATER);
    expect(await db.select().from(registrations).where(eq(registrations.id, registrationId))).toHaveLength(0);
    expect(await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.id, acceptance.id))).toHaveLength(0);
  });

  it("refuses the erase while held, and writes an audit row naming who, why and the row — never the person", async () => {
    const { registrationId, acceptance } = await signed();
    const administrator = await staff("ADMIN");
    await holdDeclarationAcceptance(db, administrator, { registrationId, acceptanceId: acceptance.id, reason: "Litigiu în curs" }, NOW);
    await expect(deleteRegistrationByStaff(db, administrator, registrationId, "cerere de ștergere", NOW)).rejects.toMatchObject({ code: "DECLARATION_HELD" });
    expect(await db.select().from(registrations).where(eq(registrations.id, registrationId))).toHaveLength(1);

    const [row] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "registration.declaration_hold_set"), eq(auditLogs.entityId, registrationId)));
    expect(row).toMatchObject({ actorStaffUserId: administrator.id, participantId: null, entityType: "registration" });
    expect(row.metadataJson).toEqual({ declarationAcceptanceId: acceptance.id, reason: "Litigiu în curs" });
    expect(JSON.stringify(row.metadataJson)).not.toMatch(/Ana|Popescu|ana@example/);
  });

  it("refuses the erase of the whole event while one of its declarations is held, with its own code, and erases nothing", async () => {
    const { event, registrationId, acceptance } = await signed();
    const administrator = await staff("ADMIN");
    await holdDeclarationAcceptance(db, administrator, { registrationId, acceptanceId: acceptance.id, reason: "Litigiu în curs" }, NOW);
    await expect(
      hardDeleteEvent(db, { actor: administrator, eventId: event.id, typedTitle: "Crosul aniversar", reason: "curățenie de sezon", now: NOW }),
    ).rejects.toMatchObject({ code: "DECLARATION_HELD" });
    expect(await db.select().from(events).where(eq(events.id, event.id))).toHaveLength(1);
    expect(await db.select().from(registrations).where(eq(registrations.id, registrationId))).toHaveLength(1);
    expect(await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.id, acceptance.id))).toHaveLength(1);
  });

  it("is the Administrator's alone: an Organizer is refused, and an empty reason names its box", async () => {
    const { registrationId, acceptance } = await signed();
    const organizer = await staff("MODERATOR");
    await expect(holdDeclarationAcceptance(db, organizer, { registrationId, acceptanceId: acceptance.id, reason: "x" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const administrator = await staff("ADMIN");
    await expect(holdDeclarationAcceptance(db, administrator, { registrationId, acceptanceId: acceptance.id, reason: "  " }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["reason"] });
    // Another registration's row is no row of this one.
    await expect(holdDeclarationAcceptance(db, administrator, { registrationId: acceptance.id, acceptanceId: acceptance.id, reason: "x" }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [row] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.id, acceptance.id));
    expect(row.retentionHold).toBe(false);
  });
});
