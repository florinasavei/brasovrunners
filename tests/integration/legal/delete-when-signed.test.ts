import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events, eventTranslations } from "@/db/schema/events";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import { legalDocumentNumbering, legalDocumentTranslations, legalDocuments } from "@/db/schema/legal-documents";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { textToBody } from "@/modules/legal-documents/domain/body-text";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import { removalPlan } from "@/modules/legal-documents/domain/deletability";
import { regenerationOutcome } from "@/modules/legal-documents/domain/batch";
import { kindSummary } from "@/modules/legal-documents/domain/overview";
import {
  findCurrentApprovedDocument,
  findVersionWithTranslations,
  insertLegalDocumentVersion,
  listApprovedVersions,
  listEffectiveDates,
  listVersionsForBackoffice,
} from "@/modules/legal-documents/repository";
import {
  approveVersion,
  createDraftVersion,
  deleteApprovedVersion,
  deleteReliedOnVersion,
  deleteVersionsInBatch,
  readDeletionFacts,
  withdrawApprovedVersion,
} from "@/modules/legal-documents/service";
import { findSignedGroupRunDeclaration } from "@/modules/group-run-declarations/repository";
import { findSignedDeclaration, renderSignedDeclarationPdf } from "@/modules/registrations/signed-declaration";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-053-02 — «Șterge» on a version somebody signed (`DECISIONS.md` §567, amending §203 and
 * §556). The owner, 2026-09-29, of a group-run declaration whose version 1 read «1 semnături · 0
 * evenimente · 0 înscrieri» and «Nu se poate nici retrage, nici șterge»: «aș vrea să pot șterge
 * (cu dublă confirmare) chiar și documentele care sunt deja semnate».
 *
 * The rule that binds: a signed version is the club's proof of what a person accepted, so its text
 * is never destroyed while anything depends on it. «Șterge» on it is retire-and-hide — off the
 * list, never in force again, the row and the text kept — and a version nothing depends on keeps
 * §203's real delete.
 */
const NOW = new Date("2026-09-06T12:00:00.000Z");
const LATER = new Date("2026-09-07T09:30:00.000Z");

const translations = (suffix: string) => [
  { locale: "ro" as const, title: `Declarație ${suffix}`, body: textToBody(`Particip pe propria răspundere, ${suffix}.`) },
  { locale: "en" as const, title: `Declaration ${suffix}`, body: textToBody(`I take part at my own risk, ${suffix}.`) },
];

const LABELS = {
  organization: "Brașov Runners",
  whereupon: "DREPT PENTRU CARE SEMNEZ,",
  whereuponTogether: "DREPT PENTRU CARE SEMNĂM,",
  signature: "Semnătura",
  minorSignature: "Semnătura minorului",
  guardianSignature: "Semnătura părintelui sau tutorelui",
  date: "Data",
  idDocument: "Act de identitate",
  version: "Versiunea",
  versionInForce: (version: number, effectiveAt: Date) => `Versiunea ${version}, în vigoare din ${effectiveAt.toISOString().slice(0, 10)}`,
  signedWhen: (when: string) => `semnată ${when}`,
  generatedOn: "Generat",
  page: (n: number, total: number) => `Pagina ${n} din ${total}`,
  signedByLink: (when: string) => `Semnat electronic pe ${when}`,
  signedOnPaper: (who: string, when: string) => `Semnat pe hârtie; înregistrat de ${who} pe ${when}`,
  attesterRemoved: "un membru al echipei",
  proofLine: (version: number, when: string, hash: string | null) => `Versiunea ${version} · Semnat la ${when}${hash ? ` · SHA-256 ${hash}` : ""}`,
};

describe("BR-REQ-053-02 «Șterge» on a version somebody relied on (§567)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let administrator: StaffUser;
  let superadmin: StaffUser;
  let organizer: StaffUser;
  let tehnic: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [superadmin] = await db.insert(staffUsers).values({ email: "superadmin@dev.test", displayName: "Admin", role: "SUPERADMIN" }).returning();
    [administrator] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Administrator", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Organizator", role: "MODERATOR" }).returning();
    [tehnic] = await db.insert(staffUsers).values({ email: "dev@dev.test", displayName: "Tehnic", role: "DEV" }).returning();
  });

  /** Version 1 superseded by version 2, which is in force. */
  async function twoApproved(key: "EVENT_DECLARATION" | "PRIVACY_NOTICE" | "GROUP_RUN_DECLARATION_TRAIL" = "EVENT_DECLARATION") {
    const first = await createDraftVersion(db, administrator, { key, translations: translations("v1") }, NOW);
    await approveVersion(db, administrator, first, NOW);
    const second = await createDraftVersion(db, administrator, { key, translations: translations("v2") }, NOW);
    await approveVersion(db, administrator, second, NOW);
    return { first, second };
  }

  let people = 0;
  /** A registration on a race with its title, and one signature of `legalDocumentId`. */
  async function signed(legalDocumentId: string, version: number) {
    people += 1;
    const email = `runner${people}@example.test`;
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", locationName: "Parcul Tractorul" })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${people}` },
      { eventId: event.id, locale: "en", title: "The cross", slug: `the-cross-${people}` },
    ]);
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: "Ana" })
      .returning();
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId: event.id,
        participantId: participant.id,
        status: "CONFIRMED",
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: "Ana",
        privacyNoticeVersion: 99,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        resultsConsentVersion: 99,
        submittedAt: NOW,
      })
      .returning();
    const [document] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, legalDocumentId));
    await db.insert(declarationAcceptances).values({
      registrationId: registration.id,
      legalDocumentId,
      declarationVersion: version,
      contentSha256: document.contentSha256,
      locale: "ro",
      typedName: "Ana Pop",
      acceptedAt: NOW,
    });
    return { eventId: event.id, registrationId: registration.id };
  }

  const retire = (versionId: string, typedNumber: string, reason = "text înlocuit; semnăturile rămân", actor: StaffUser = administrator) =>
    deleteReliedOnVersion(db, actor, { versionId, reason, typedNumber, now: LATER });

  const rowOf = async (id: string) => (await listVersionsForBackoffice(db)).find((row) => row.id === id);

  it("takes a signed version off the list and keeps its row, its text and every signature on it", async () => {
    const { first, second } = await twoApproved();
    const { eventId, registrationId } = await signed(first, 1);

    await expect(retire(first, "1")).resolves.toEqual({ key: "EVENT_DECLARATION", version: 1 });

    const row = await rowOf(first);
    expect(row?.deletedAt).toEqual(LATER);
    expect(row?.deletedReason).toBe("text înlocuit; semnăturile rămân");
    expect(row?.deletedByName).toBe("Administrator");
    // Withdrawn in the same statement, so every reader of the text in force already skips it.
    expect(row?.withdrawnAt).toEqual(LATER);

    // The text is all still there, in both languages, and the signature still points at it.
    expect(await db.select().from(legalDocumentTranslations).where(eq(legalDocumentTranslations.legalDocumentId, first))).toHaveLength(2);
    const [acceptance] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, registrationId));
    expect(acceptance.legalDocumentId).toBe(first);
    const text = await findVersionWithTranslations(db, first);
    expect(text?.translations.map((translation) => translation.title).sort()).toEqual(["Declaration v1", "Declarație v1"]);
    expect(text?.deletedAt).toEqual(LATER);

    // The signed declaration still reads that text, and its PDF still renders.
    const signedDeclaration = await findSignedDeclaration(db, registrationId);
    expect(signedDeclaration?.title).toBe("Declarație v1");
    expect(signedDeclaration?.version).toBe(1);
    const pdf = await renderSignedDeclarationPdf(db, signedDeclaration!, eventId, LABELS, LATER, "club");
    expect(pdf?.toString("latin1").startsWith("%PDF-1.")).toBe(true);

    // And the text in force is unchanged.
    expect((await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", LATER))?.id).toBe(second);
  });

  it("writes one audit row with who, the reason and the counts that stood on it — never the text", async () => {
    const { first } = await twoApproved();
    await signed(first, 1);

    await retire(first, "1", "o declarație veche, făcută la testare");

    const entries = await db.select().from(auditLogs).where(eq(auditLogs.entityId, first));
    expect(entries.map((entry) => entry.action)).toEqual(["legal_document_version.deleted"]);
    const [entry] = entries;
    expect(entry.actorStaffUserId).toBe(administrator.id);
    expect(entry.entityType).toBe("legal_document");
    expect(entry.metadataJson).toMatchObject({
      documentKey: "EVENT_DECLARATION",
      version: 1,
      reason: "o declarație veche, făcută la testare",
      signatures: 1,
      events: 0,
      acknowledgements: 0,
      termsRegistrations: 0,
      textKept: true,
    });
    expect(JSON.stringify(entry.metadataJson)).not.toContain("Particip pe propria răspundere");
  });

  it("deletes a group-run declaration with one signature — the owner's own case — and its signature still reads v1", async () => {
    const { first, second } = await twoApproved("GROUP_RUN_DECLARATION_TRAIL");
    const [run] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-13T15:30:00.000Z"), registrationMode: "INTERNAL", locationName: "Poiana Brașov" })
      .returning();
    const [document] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, first));
    const [signature] = await db
      .insert(groupRunDeclarations)
      .values({
        eventId: run.id,
        legalDocumentId: first,
        declarationVersion: 1,
        contentSha256: document.contentSha256,
        locale: "ro",
        typedName: "Ana Pop",
        email: "ana@example.test",
        acceptedAt: NOW,
      })
      .returning();

    await expect(retire(first, "1")).resolves.toEqual({ key: "GROUP_RUN_DECLARATION_TRAIL", version: 1 });

    const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, first));
    expect(entry.action).toBe("legal_document_version.deleted");
    expect(entry.metadataJson).toMatchObject({ documentKey: "GROUP_RUN_DECLARATION_TRAIL", version: 1, signatures: 1, textKept: true });

    // The signature is read by id, withdrawn or not: its PDF still has version 1's words.
    const signedRun = await findSignedGroupRunDeclaration(db, signature.id);
    expect(signedRun?.title).toBe("Declarație v1");
    expect(signedRun?.version).toBe(1);
    expect((await findCurrentApprovedDocument(db, "GROUP_RUN_DECLARATION_TRAIL", "ro", LATER))?.id).toBe(second);
  });

  it("never lists, offers or counts a deleted version, and never lets it be put in force", async () => {
    const { first, second } = await twoApproved("GROUP_RUN_DECLARATION_TRAIL");
    await signed(first, 1);
    /*
      Version 3, approved ahead of its date — next season's text — and chosen by an event: the one
      shape in which a version that is not in force today *would* come into force by itself. Deleted
      from the list, it must never do so.
    */
    const third = await insertLegalDocumentVersion(db, {
      key: "GROUP_RUN_DECLARATION_TRAIL",
      version: 3,
      effectiveAt: new Date("2026-10-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations("v3")),
      translations: translations("v3"),
      approvedByStaffUserId: administrator.id,
      now: NOW,
    });
    await db.insert(events).values({ type: "RACE", startsAt: new Date("2026-11-21T07:00:00.000Z"), registrationMode: "INTERNAL", declarationDocumentId: third });

    await retire(first, "1");
    await retire(third, "3");

    // On the first of October, and after it, the text in force is still version 2.
    const october = new Date("2026-10-02T00:00:00.000Z");
    expect((await findCurrentApprovedDocument(db, "GROUP_RUN_DECLARATION_TRAIL", "ro", october))?.id).toBe(second);
    // Not a date the public cache waits for, not a choice in the event editor.
    expect((await listEffectiveDates(db, "GROUP_RUN_DECLARATION_TRAIL")).map((date) => date.toISOString())).toEqual([
      (await rowOf(second))!.effectiveAt.toISOString(),
    ]);
    expect((await listApprovedVersions(db, "GROUP_RUN_DECLARATION_TRAIL", "ro")).map((row) => row.version)).toEqual([2]);

    // The card's summary and «Regenerează» ignore them: v2 is in force, nothing waits.
    const versions = await listVersionsForBackoffice(db);
    const summary = kindSummary("GROUP_RUN_DECLARATION_TRAIL", versions, second);
    expect(summary.inForce?.version).toBe(2);
    expect(summary.waitingDraft).toBeNull();
    // Version 3's words are the "template" here: a deleted version's hash is never "already in force".
    expect(regenerationOutcome("GROUP_RUN_DECLARATION_TRAIL", computeContentHash(translations("v3")), versions, second)).toBe("create");

    // No verb reaches it again: not withdrawal, not approval, not either delete, not a second «Șterge».
    const conflict = (error: unknown) => isDomainError(error) && error.code === "CONFLICT";
    await expect(withdrawApprovedVersion(db, administrator, first, LATER)).rejects.toSatisfy(conflict);
    await expect(approveVersion(db, administrator, first, LATER)).rejects.toSatisfy(conflict);
    await expect(deleteApprovedVersion(db, administrator, { versionId: first, typedConfirmation: "TRAIL 1", reason: "curățenie", now: LATER })).rejects.toSatisfy(conflict);
    await expect(deleteVersionsInBatch(db, administrator, { versionIds: [first], typedConfirmation: "DELETE 1", reason: "curățenie", now: LATER })).rejects.toSatisfy(conflict);
    await expect(retire(first, "1")).rejects.toSatisfy((error: unknown) => conflict(error) && isDomainError(error) && error.fields.includes("alreadyDeleted"));
    const [facts] = await readDeletionFacts(db, [versions.find((row) => row.id === first)!], versions, LATER);
    expect(removalPlan(facts)).toEqual({ kind: "refused", reason: "alreadyDeleted" });
  });

  it("continues the numbering after a deleted version, never reusing its number", async () => {
    await twoApproved();
    const third = await insertLegalDocumentVersion(db, {
      key: "EVENT_DECLARATION",
      version: 3,
      effectiveAt: new Date("2026-10-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations("v3")),
      translations: translations("v3"),
      approvedByStaffUserId: administrator.id,
      now: NOW,
    });
    await signed(third, 3);
    await retire(third, "3");

    const next = await createDraftVersion(db, administrator, { key: "EVENT_DECLARATION", translations: translations("v4") }, LATER);
    const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, next));
    expect(row.version).toBe(4);
    // The row is kept, so nothing needed retiring: the floor table stays empty.
    expect(await db.select().from(legalDocumentNumbering)).toHaveLength(0);
  });

  it("keeps §203's real delete for a version nothing depends on, and refuses to hide it instead", async () => {
    const { first } = await twoApproved();

    await expect(retire(first, "1")).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT" && error.fields.includes("nothingDepends"),
    );
    expect((await rowOf(first))?.deletedAt).toBeNull();

    await deleteApprovedVersion(db, administrator, { versionId: first, typedConfirmation: "DECLARATION 1", reason: "curățenie", now: LATER });
    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, first))).toHaveLength(0);
  });

  it("refuses the version in force, even with a signature on it", async () => {
    const { second } = await twoApproved();
    await signed(second, 2);

    await expect(retire(second, "2")).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT" && error.fields.includes("inForce"),
    );
    expect((await rowOf(second))?.deletedAt).toBeNull();
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("refuses the Organizer and the Tehnic role, and lets the Administrator and the Superadministrator", async () => {
    const { first } = await twoApproved();
    await signed(first, 1);

    for (const actor of [organizer, tehnic]) {
      await expect(retire(first, "1", "motiv", actor)).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "FORBIDDEN");
    }
    expect((await rowOf(first))?.deletedAt).toBeNull();
    expect(await db.select().from(auditLogs)).toHaveLength(0);

    await expect(retire(first, "1", "motiv", superadmin)).resolves.toEqual({ key: "EVENT_DECLARATION", version: 1 });
  });

  it("refuses a number that is not the version's, and changes nothing", async () => {
    const { first } = await twoApproved();
    await signed(first, 1);

    for (const typed of ["", "2", "DECLARATION 1", "01", "one", "1 1"]) {
      await expect(retire(first, typed)).rejects.toSatisfy(
        (error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR" && error.fields.includes("typedNumber"),
      );
    }
    expect((await rowOf(first))?.deletedAt).toBeNull();
    expect(await db.select().from(auditLogs)).toHaveLength(0);

    // The number with space around it, or written «v1», is the number.
    await expect(retire(first, " v1 ")).resolves.toEqual({ key: "EVENT_DECLARATION", version: 1 });
  });

  it("refuses without a reason, or with one longer than 200 characters, naming the box", async () => {
    const { first } = await twoApproved();
    await signed(first, 1);

    for (const reason of ["", "  ", "ok", "a".repeat(201)]) {
      await expect(retire(first, "1", reason)).rejects.toSatisfy(
        (error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR" && error.fields.includes("reason"),
      );
    }
    expect((await rowOf(first))?.deletedAt).toBeNull();
    await expect(retire(first, "1", "a".repeat(200))).resolves.toBeDefined();
  });

  it("hides a privacy notice registrations acknowledged by number, which no foreign key sees", async () => {
    const { first, second } = await twoApproved("PRIVACY_NOTICE");
    const { registrationId } = await signed(second, 2);
    await db.update(registrations).set({ privacyNoticeVersion: 1, resultsConsentVersion: 1 }).where(eq(registrations.id, registrationId));

    await retire(first, "1");
    expect((await rowOf(first))?.deletedAt).toEqual(LATER);
    const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, first));
    expect(entry.metadataJson).toMatchObject({ acknowledgements: 1, signatures: 0 });
    // The registration still records notice 1, and notice 1's words are still here to read.
    expect((await findVersionWithTranslations(db, first))?.translations).toHaveLength(2);
  });
});
