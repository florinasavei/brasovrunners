import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { deleteEvent, hardDeleteEvent } from "@/modules/content/events/service";
import { pruneExpiredRows } from "@/modules/jobs/retention";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, groupRunDeclarationsSeriesCurrent, insertLegalDocumentVersion, listVersionsForBackoffice } from "@/modules/legal-documents/repository";
import { deleteApprovedVersion, updateDraftVersion } from "@/modules/legal-documents/service";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { updateClubNotices } from "@/modules/notifications/club-notices";
import type { OutboxRow } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { findSignatureByViewToken, findSignedGroupRunDeclaration, insertGroupRunDeclaration, listCoveringSignatures, listGroupRunDeclarations, listSeriesDatesOf } from "@/modules/group-run-declarations/repository";
import { groupRunMergeValues } from "@/modules/group-run-declarations/facts";
import { signedStateFor } from "@/modules/group-run-declarations/domain";
import { hashTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { mergeLegalBody } from "@/modules/legal-documents/domain/merge-fields";
import { eraseGroupRunDeclaration, type GroupRunSigningInput, signGroupRunDeclaration } from "@/modules/group-run-declarations/service";
import type { DeclarationPdfInput } from "@/modules/registrations/declaration-pdf";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { renderGroupRunDeclarationPdf } from "@/modules/group-run-declarations/pdf";
import { CLUB_NAME } from "@/theme/brand";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { DECLARATION_FOOTER_Y, drawnRuns } from "../../helpers/pdf-drawn";

/**
 * A group run's optional self-declaration, signed, sent, erased and swept (§393).
 *
 * The owner, 2026-09-25: "I might need a 'declarație pe propria răspundere' for group runs as well,
 * especially for the trail one; this is optional but people should be able to sign and email it to
 * us". One row, never a registration; two messages through the outbox — the signer's PDF, whole,
 * and the club's archive copy with the identity document masked (§320); bound to the version read
 * (§57); erased by an Administrator with an audit row that never names the signer (§67, §88); kept
 * until the signer asks for its deletion (§503), only an identity document cleared at seven days.
 *
 * The PDF's inputs are watched rather than the drawn page, as `club-copy.test.ts` does: pdfkit
 * writes an embedded font's text as glyph ids, so the page cannot be searched for a number.
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

const NOW = new Date("2026-10-01T08:00:00.000Z");
const ARCHIVE = "arhiva@example.test";
const ID = "Carte de identitate BV 123456";

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

/**
 * A group-run text that still names an identity document: an older or club-edited version (§418).
 * The platform's own templates no longer ask for one, but the signing code must keep serving a text
 * that does — asking for the document, keeping it, and masking it in the club's copy.
 */
function withIdDocument(key: LegalDocumentKey, locale: "ro" | "en") {
  const template = LEGAL_TEMPLATES[key][locale];
  const [first, ...rest] = template.body.sections;
  const opening = locale === "ro" ? "Subsemnatul/a {{participant}}, cu actul de identitate {{idDocument}}." : "I, {{participant}}, holder of identity document {{idDocument}}.";
  return { ...template, body: { sections: [{ ...first, paragraphs: [opening, ...first.paragraphs.slice(1)] }, ...rest] } };
}

async function approveOne(key: LegalDocumentKey, version = 1, { idDocument = false }: { idDocument?: boolean } = {}) {
  const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({
    locale,
    ...(idDocument ? withIdDocument(key, locale) : LEGAL_TEMPLATES[key][locale]),
  }));
  await insertLegalDocumentVersion(db, {
    key,
    version,
    effectiveAt: new Date("2026-01-01T00:00:00Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

/**
 * The declaration's text, and the privacy notice beside it: a signature takes an address and an
 * identity document, and without an approved notice in force nothing is taken (BR-REQ-053-01's
 * rule, the one a registration answers to). `{ privacy: false }` leaves the notice out.
 */
async function approveTemplate(key: LegalDocumentKey, { privacy = true, idDocument = false }: { privacy?: boolean; idDocument?: boolean } = {}) {
  await approveOne(key, 1, { idDocument });
  if (privacy) await approveOne("PRIVACY_NOTICE");
}

/**
 * The Tâmpa trail run: a published group run on a trail, offering the declaration. Every call with
 * the same title is another date of the same run (§113, §523); a title of its own makes another run.
 */
async function trailRun(overrides: Partial<typeof events.$inferInsert> = {}, title = { ro: "Tura pe munte", en: "The mountain loop" }) {
  const [event] = await db
    .insert(events)
    .values({
      type: "GROUP_RUN",
      surface: "TRAIL",
      offersGroupRunDeclaration: true,
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      startsAt: new Date("2026-10-07T16:00:00.000Z"),
      registrationMode: "NONE",
      locationName: "Stația de telecabină",
      ...overrides,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: title.ro, slug: `tura-${event.id.slice(0, 6)}` },
    { eventId: event.id, locale: "en", title: title.en, slug: `loop-${event.id.slice(0, 6)}` },
  ]);
  return event;
}

async function input(eventId: string, overrides: Partial<GroupRunSigningInput> = {}): Promise<GroupRunSigningInput> {
  const document = await findCurrentApprovedDocument(db, "GROUP_RUN_DECLARATION_TRAIL", overrides.locale ?? "ro", NOW);
  if (!document) throw new Error("no approved trail declaration");
  return {
    eventId,
    documentId: document.id,
    contentSha256: document.contentSha256,
    accepted: true,
    typedName: "Ana Popescu",
    idDocument: ID,
    // The run's minimum age is asked at the door since §440 (the column's default fourteen).
    birthDate: "1990-05-17",
    email: "ana@example.ro",
    locale: "ro",
    ...overrides,
  };
}

async function admin(role: StaffUser["role"] = "ADMIN"): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
  return row;
}

const claimed = (row: OutboxRow): OutboxRow => ({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: NOW });
const drawnFrom = (value: unknown) => JSON.stringify((value as DeclarationPdfInput).entries.map((entry) => ({ values: entry.values, signature: entry.signature })));

describe("§393 signing a group run's self-declaration", () => {
  it("writes one row — never a registration — and queues the signer's copy and the club's archive copy", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun();
    await updateClubNotices(db, await admin(), { declarations: { to: ARCHIVE, cc: [], bcc: [] }, confirmations: { to: [] }, participants: { bcc: [] } }, NOW);

    const outcome = await signGroupRunDeclaration(db, await input(event.id), NOW);
    expect(outcome.outcome).toBe("signed");

    const rows = await db.select().from(groupRunDeclarations);
    expect(rows).toHaveLength(1);
    // The platform's text names no identity document (§418): whatever was posted, none is kept.
    expect(rows[0]).toMatchObject({ eventId: event.id, typedName: "Ana Popescu", idDocument: null, email: "ana@example.ro", locale: "ro", declarationVersion: 1 });
    // The backoffice's list says which version each one signed (§499).
    expect(await listGroupRunDeclarations(db, event.id)).toMatchObject([{ typedName: "Ana Popescu", version: 1 }]);

    const outbox = await db.select().from(emailOutbox);
    expect(outbox.map((row) => [row.messageType, row.recipientEmail]).sort()).toEqual([
      ["GROUP_RUN_DECLARATION_ARCHIVE", ARCHIVE],
      ["GROUP_RUN_DECLARATION_SIGNED", "ana@example.ro"],
    ]);
    // About nobody's registration: no participant, no registration, no token to mint.
    for (const row of outbox) {
      expect(row.participantId).toBeNull();
      expect(row.registrationId).toBeNull();
    }
  });

  it("sends the signer and the club the document masked, both with the PDF attached, under a text that asks for it (§421)", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL", { idDocument: true });
    const event = await trailRun();
    await updateClubNotices(db, await admin(), { declarations: { to: ARCHIVE, cc: [], bcc: [] }, confirmations: { to: [] }, participants: { bcc: [] } }, NOW);
    await signGroupRunDeclaration(db, await input(event.id), NOW);

    const [signed] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "GROUP_RUN_DECLARATION_SIGNED"));
    const [archive] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "GROUP_RUN_DECLARATION_ARCHIVE"));

    const toSigner = await renderOutboxMessage(claimed(signed), db, NOW);
    expect(toSigner.to).toBe("ana@example.ro");
    expect(toSigner.attachments?.map((file) => file.contentType)).toEqual(["application/pdf"]);
    expect(toSigner.subject).toContain("Tura pe munte");
    // The English half reads the English title (§373).
    expect(toSigner.subject).toContain("The mountain loop");
    // Masked on the signer's copy too (§419): the address was never confirmed before sending.
    const signerPdf = drawnFrom(watched.pdfInputs.at(-1));
    expect(signerPdf).not.toContain("123456");
    expect(signerPdf).toContain("••••56");
    expect(toSigner.text).toContain("În copia ta, seria și numărul actului de identitate apar mascate");
    expect(toSigner.text).toContain("Dacă nu tu ai semnat această declarație, scrie-ne din pagina de contact (");

    const toClub = await renderOutboxMessage(claimed(archive), db, NOW);
    expect(toClub.to).toBe(ARCHIVE);
    expect(toClub.attachments?.map((file) => file.contentType)).toEqual(["application/pdf"]);
    expect(toClub.subject).toContain("Ana Popescu");
    const clubPdf = drawnFrom(watched.pdfInputs.at(-1));
    expect(clubPdf).not.toContain("123456");
    expect(clubPdf).toContain("••••56");
    // Neither message carries an action button: there is nothing to manage.
    for (const message of [toSigner, toClub]) expect(message.html).not.toMatch(/\/(inregistrari|registrations)\//);
  });

  /**
   * §499 — the group-run PDF names the version signed and the day it took effect, under the title
   * and in every page's footer, with when it was signed: what is drawn, caught at pdfkit's `text()`.
   */
  it("draws the version in force under the title and in every page's footer, with when it was signed", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun();
    await signGroupRunDeclaration(db, await input(event.id), NOW);
    const [row] = await db.select().from(groupRunDeclarations);
    const signed = (await findSignedGroupRunDeclaration(db, row.id))!;

    const runs = await drawnRuns(() => renderGroupRunDeclarationPdf(db, signed, "participant", NOW));
    // Approved from 2026-01-01T00:00Z: 02:00 on Thursday 1 January on the club's clock.
    const version = "Versiunea 1, în vigoare din joi, 1 ian. 2026";
    expect(runs.filter((run) => run.text.startsWith(`${version} · sha256 ${signed.contentSha256.slice(0, 16)}`))).toHaveLength(1);
    const pages = new Set(runs.map((run) => run.page));
    const footers = runs.filter((run) => run.y === DECLARATION_FOOTER_Y && run.text.startsWith(CLUB_NAME));
    // 08:00 UTC on 1 October is 11:00 in Brașov, a Thursday.
    expect(footers.map((run) => run.text)).toEqual([...pages].map(() => `${CLUB_NAME} · ${version} · semnată joi, 1 oct. 2026, la 11:00`));
  });

  it("queues no archive copy when the club has no declarations mailbox", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun();
    await signGroupRunDeclaration(db, await input(event.id), NOW);
    const types = (await db.select().from(emailOutbox)).map((row) => row.messageType);
    expect(types).toEqual(["GROUP_RUN_DECLARATION_SIGNED"]);
  });

  it("names every box that is wrong at once, and writes nothing", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun();
    // The platform's text asks for no identity document (§418), so none is missing.
    await expect(
      signGroupRunDeclaration(db, await input(event.id, { accepted: false, typedName: "  ", idDocument: undefined, email: "not an address" }), NOW),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["typedName", "email", "accepted"] });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it("under a text that names an identity document, asks for it among the wrong boxes", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL", { idDocument: true });
    const event = await trailRun();
    await expect(
      signGroupRunDeclaration(db, await input(event.id, { accepted: false, typedName: "  ", idDocument: undefined, email: "not an address" }), NOW),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["idDocument", "typedName", "email", "accepted"] });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
  });

  it("is bound to the text that was read (§57): a newer version in force refuses the press", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun();
    const read = await input(event.id);
    const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({
      locale,
      title: LEGAL_TEMPLATES.GROUP_RUN_DECLARATION_TRAIL[locale].title,
      body: { sections: [...LEGAL_TEMPLATES.GROUP_RUN_DECLARATION_TRAIL[locale].body.sections, { paragraphs: ["v2"] }] },
    }));
    await insertLegalDocumentVersion(db, { key: "GROUP_RUN_DECLARATION_TRAIL", version: 2, effectiveAt: new Date("2026-02-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
    await expect(signGroupRunDeclaration(db, read, NOW)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
  });

  it("signs the same version in the other language, and records that language for the PDF", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun();
    await signGroupRunDeclaration(db, await input(event.id, { locale: "en" }), NOW);
    const [row] = await db.select().from(groupRunDeclarations);
    expect(row.locale).toBe("en");
    const [message] = await db.select().from(emailOutbox);
    expect(message.locale).toBe("en");
  });

  it("offers nothing where nothing is offered: an unticked run, an asphalt run without its text, a race, a run long over", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    for (const overrides of [
      { offersGroupRunDeclaration: false },
      { type: "RACE" as const },
      { surface: "MIXED" as const },
      { startsAt: new Date("2026-09-30T08:00:00.000Z") },
      { eventStatus: "CANCELLED" as const },
      { editorialStatus: "DRAFT" as const },
    ]) {
      const event = await trailRun(overrides);
      await expect(signGroupRunDeclaration(db, await input(event.id), NOW), JSON.stringify(overrides)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    // Asphalt with no approved asphalt text: nothing to sign.
    const asphalt = await trailRun({ surface: "ASPHALT" });
    await expect(signGroupRunDeclaration(db, await input(asphalt.id), NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
  });

  it("answers a bot as it answers a person, and writes nothing (§19.4)", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun();
    expect((await signGroupRunDeclaration(db, await input(event.id, { honeypot: "http://spam.example" }), NOW)).outcome).toBe("ignored");
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
    // A password manager that filled the trap with the signer's own address is a person (§282).
    expect((await signGroupRunDeclaration(db, await input(event.id, { honeypot: "ana@example.ro" }), NOW)).outcome).toBe("signed");
  });

  it("throttles one address, and counts only the address (§322: hashed, never stored plainly)", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun();
    const { limit } = RATE_LIMITS["group-run-declaration"];
    for (let i = 0; i < limit; i += 1) expect((await signGroupRunDeclaration(db, await input(event.id), NOW)).outcome).toBe("signed");
    expect((await signGroupRunDeclaration(db, await input(event.id, { email: "Ana@Example.ro" }), NOW)).outcome).toBe("limited");
    expect((await signGroupRunDeclaration(db, await input(event.id, { email: "ion@example.ro" }), NOW)).outcome).toBe("signed");
  });

  it("refuses the signature while no approved privacy notice is in force, and writes nothing", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL", { privacy: false });
    const event = await trailRun();
    await expect(signGroupRunDeclaration(db, await input(event.id), NOW)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining("no approved privacy notice exists yet"),
    });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it("answers a posted id that is not a uuid with the form's refusal, before any query (§376)", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun();
    // An old `renderedAt`, so the timing check passes and the id is what is judged.
    const renderedAt = new Date(NOW.getTime() - 60_000).toISOString();
    await expect(signGroupRunDeclaration(db, await input(event.id, { eventId: "not-a-uuid", renderedAt }), NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(signGroupRunDeclaration(db, await input(event.id, { documentId: "1; drop", renderedAt }), NOW)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(eraseGroupRunDeclaration(db, await admin(), { id: "nope", reason: "asked" }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
  });

  it("counts a signature as reliance on the version: it cannot be edited or deleted under it, the sweep never frees it, and the erase does", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun();
    await signGroupRunDeclaration(db, await input(event.id), NOW);
    const [row] = (await listVersionsForBackoffice(db)).filter((version) => version.key === "GROUP_RUN_DECLARATION_TRAIL");
    expect(row.acceptanceCount).toBe(1);

    // A successor in force, so "in force" is no longer the obstacle — the signature is.
    const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({
      locale,
      title: LEGAL_TEMPLATES.GROUP_RUN_DECLARATION_TRAIL[locale].title,
      body: { sections: [...LEGAL_TEMPLATES.GROUP_RUN_DECLARATION_TRAIL[locale].body.sections, { paragraphs: ["v2"] }] },
    }));
    await insertLegalDocumentVersion(db, { key: "GROUP_RUN_DECLARATION_TRAIL", version: 2, effectiveAt: new Date("2026-02-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });

    const superadmin = await admin("SUPERADMIN");
    const later = new Date("2026-10-20T08:00:00.000Z");
    const remove = () => deleteApprovedVersion(db, superadmin, { versionId: row.id, typedConfirmation: "TRAIL 1", reason: "curățenie", now: later });
    await expect(remove()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("somebody has relied on this version") });
    // Edited: never — an approved version is history, and a signed one twice over.
    await expect(updateDraftVersion(db, superadmin, row.id, translations, later)).rejects.toMatchObject({ code: "CONFLICT" });

    // The sweep, long after the run, keeps the signature (§503), and with it the reliance.
    const counts = await pruneExpiredRows(db, later);
    expect(counts.failures).toEqual([]);
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(1);
    await expect(remove()).rejects.toMatchObject({ code: "CONFLICT" });
    // The signer asks; the Administrator erases; the version is unused again.
    const [signature] = await db.select().from(groupRunDeclarations);
    await eraseGroupRunDeclaration(db, await admin(), { id: signature.id, reason: "a cerut ștergerea" }, later);
    await expect(remove()).resolves.toEqual({ key: "GROUP_RUN_DECLARATION_TRAIL", version: 1 });
  });
});

describe("§393 erasing one (§67, §88)", () => {
  it("is the Administrator's; the Organizer, the Tehnic role and the volunteer are refused", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun();
    const signed = await signGroupRunDeclaration(db, await input(event.id), NOW);
    if (signed.outcome !== "signed") throw new Error("not signed");
    for (const role of ["MODERATOR", "DEV", "CONTRIBUTOR", "COPYWRITER"] as const) {
      await expect(eraseGroupRunDeclaration(db, await admin(role), { id: signed.id, reason: "asked" }, NOW), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(1);
  });

  it("asks why, writes the audit row first, and takes the row and its messages — the trail never names the signer", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun();
    const signed = await signGroupRunDeclaration(db, await input(event.id), NOW);
    if (signed.outcome !== "signed") throw new Error("not signed");
    const actor = await admin();
    await expect(eraseGroupRunDeclaration(db, actor, { id: signed.id, reason: "   " }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["reason"] });

    await eraseGroupRunDeclaration(db, actor, { id: signed.id, reason: "a cerut ștergerea" }, NOW);
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.group_run_declaration_erased"));
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ actorStaffUserId: actor.id, entityType: "event", entityId: event.id, participantId: null });
    expect(trail[0].metadataJson).toMatchObject({ reason: "a cerut ștergerea" });
    expect(JSON.stringify(trail[0].metadataJson)).not.toMatch(/Ana|Popescu|ana@example|123456/);
  });

  it("leaves a message about an erased declaration unrenderable rather than sent", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun();
    const signed = await signGroupRunDeclaration(db, await input(event.id), NOW);
    if (signed.outcome !== "signed") throw new Error("not signed");
    const [message] = await db.select().from(emailOutbox);
    await db.delete(groupRunDeclarations);
    await expect(renderOutboxMessage(claimed(message), db, NOW)).rejects.toThrow(/no longer exists/);
    expect(await findSignedGroupRunDeclaration(db, signed.id)).toBeUndefined();
  });

  it("takes the declarations' messages with the event when the event itself is deleted or erased, and no other message", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const actor = await admin();
    // Three runs of one date each: a run's declarations go with its only date (§523 keeps them
    // while the run has another — the test below).
    const deleted = await trailRun({}, { ro: "Tura A", en: "Loop A" });
    const erased = await trailRun({}, { ro: "Tura B", en: "Loop B" });
    const kept = await trailRun({}, { ro: "Tura C", en: "Loop C" });
    for (const [event, email] of [[deleted, "ana@example.ro"], [erased, "ion@example.ro"], [kept, "mara@example.ro"]] as const) {
      expect((await signGroupRunDeclaration(db, await input(event.id, { email }), NOW)).outcome).toBe("signed");
    }
    await db.insert(emailOutbox).values({
      messageType: "STAFF_INVITATION",
      recipientEmail: "club@example.ro",
      locale: "ro",
      payloadJson: { unrelated: true },
      idempotencyKey: "unrelated-message",
    });

    await deleteEvent(db, { actor, eventId: deleted.id });
    const [title] = await db.select({ title: eventTranslations.title }).from(eventTranslations).where(eq(eventTranslations.eventId, erased.id));
    await hardDeleteEvent(db, { actor, eventId: erased.id, typedTitle: title?.title ?? erased.id, reason: "creat din greșeală", now: NOW });

    expect((await db.select().from(groupRunDeclarations)).map((row) => row.eventId)).toEqual([kept.id]);
    const left = (await db.select().from(emailOutbox)).map((row) => row.recipientEmail).sort();
    expect(left).toEqual(["club@example.ro", "mara@example.ro"]);
  });
});

/*
  §523 — one self-declaration per person per series. The owner, 2026-09-27: "a returning runner
  signs once; it has no end date and is deleted only at their request". A series is §113's: the
  same type and the same title, so every `trailRun()` with the default title is another date of
  the same run.
*/
describe("§523 one declaration per person per series", () => {
  const OCT = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T16:00:00.000Z`);
  const archiveOn = async () =>
    updateClubNotices(db, await admin(), { declarations: { to: ARCHIVE, cc: [], bcc: [] }, confirmations: { to: [] }, participants: { bcc: [] } }, NOW);

  it("a returning runner signs once: another date of the run writes no second row, sends their copy again, and no second archive copy", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    await archiveOn();
    const first = await trailRun({ startsAt: OCT(7) });
    const second = await trailRun({ startsAt: OCT(14) });

    const signed = await signGroupRunDeclaration(db, await input(first.id), NOW);
    expect(signed).toMatchObject({ outcome: "signed", kept: false });
    if (signed.outcome !== "signed") throw new Error("not signed");
    // The same person, typed a little differently, on the next week's page.
    const again = await signGroupRunDeclaration(db, await input(second.id, { email: " ANA@example.ro ", typedName: "ana  popescu" }), new Date(NOW.getTime() + 60_000));
    expect(again).toEqual({ outcome: "signed", id: signed.id, kept: true });

    const rows = await db.select().from(groupRunDeclarations);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventId: first.id, typedName: "Ana Popescu", email: "ana@example.ro" });

    const outbox = await db.select().from(emailOutbox);
    expect(outbox.map((row) => [row.messageType, row.recipientEmail]).sort()).toEqual([
      ["GROUP_RUN_DECLARATION_ARCHIVE", ARCHIVE],
      ["GROUP_RUN_DECLARATION_SIGNED", "ana@example.ro"],
      ["GROUP_RUN_DECLARATION_SIGNED", "ana@example.ro"],
    ]);
    // The copy sent again is the kept declaration, rendered like the first, with its PDF.
    for (const message of outbox.filter((row) => row.messageType === "GROUP_RUN_DECLARATION_SIGNED")) {
      expect(message.payloadJson).toEqual({ groupRunDeclarationId: signed.id });
      const email = await renderOutboxMessage(claimed(message), db, NOW);
      expect(email.attachments?.map((file) => file.contentType)).toEqual(["application/pdf"]);
    }

    // Both dates' backoffice pages list the run's one signature, linked under the date it was signed on.
    for (const date of [first, second]) {
      expect(await listGroupRunDeclarations(db, date.id)).toMatchObject([{ id: signed.id, eventId: first.id, typedName: "Ana Popescu" }]);
    }
  });

  it("another person on the same address, or the same person on another run, is another declaration", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const first = await trailRun({ startsAt: OCT(7) });
    const second = await trailRun({ startsAt: OCT(14) });
    const otherRun = await trailRun({ startsAt: OCT(8) }, { ro: "Tura de joi", en: "The Thursday loop" });

    await signGroupRunDeclaration(db, await input(first.id), NOW);
    // A family on one address (§389): the parent's own declaration.
    expect(await signGroupRunDeclaration(db, await input(second.id, { typedName: "Ion Popescu" }), NOW)).toMatchObject({ kept: false });
    // Another run is another declaration: its own risks, its own name.
    expect(await signGroupRunDeclaration(db, await input(otherRun.id), NOW)).toMatchObject({ kept: false });

    expect(await db.select().from(groupRunDeclarations)).toHaveLength(3);
    expect((await listGroupRunDeclarations(db, second.id)).map((row) => row.typedName)).toEqual(["Ana Popescu", "Ion Popescu"]);
    expect((await listGroupRunDeclarations(db, otherRun.id)).map((row) => row.typedName)).toEqual(["Ana Popescu"]);
  });

  const approveV2 = async () => {
    const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({
      locale,
      title: LEGAL_TEMPLATES.GROUP_RUN_DECLARATION_TRAIL[locale].title,
      body: { sections: [...LEGAL_TEMPLATES.GROUP_RUN_DECLARATION_TRAIL[locale].body.sections, { paragraphs: ["v2"] }] },
    }));
    await insertLegalDocumentVersion(db, { key: "GROUP_RUN_DECLARATION_TRAIL", version: 2, effectiveAt: new Date("2026-02-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
  };

  it("a newer version is signed beside the older signature, which stays — nothing is deleted by a public press, and v1 stays relied upon", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const first = await trailRun({ startsAt: OCT(7) });
    const second = await trailRun({ startsAt: OCT(14) });
    const old = await signGroupRunDeclaration(db, await input(first.id), NOW);
    if (old.outcome !== "signed") throw new Error("not signed");
    await approveV2();

    const renewed = await signGroupRunDeclaration(db, await input(second.id), NOW);
    expect(renewed).toMatchObject({ outcome: "signed", kept: false });
    if (renewed.outcome !== "signed") throw new Error("not signed");
    expect(renewed.id).not.toBe(old.id);

    const rows = await db.select().from(groupRunDeclarations).orderBy(groupRunDeclarations.declarationVersion);
    expect(rows.map((row) => [row.id, row.declarationVersion, row.eventId])).toEqual([
      [old.id, 1, first.id],
      [renewed.id, 2, second.id],
    ]);
    // The old one's messages are still there, and so is the reliance on version 1 (§53, §151).
    const outbox = await db.select().from(emailOutbox);
    expect(outbox.some((row) => (row.payloadJson as { groupRunDeclarationId?: string }).groupRunDeclarationId === old.id)).toBe(true);
    const [v1] = (await listVersionsForBackoffice(db)).filter((version) => version.key === "GROUP_RUN_DECLARATION_TRAIL" && version.version === 1);
    expect(v1.acceptanceCount).toBe(1);
    // Pressed again under v2: the v2 signature is kept, no third row.
    expect(await signGroupRunDeclaration(db, await input(first.id), NOW)).toEqual({ outcome: "signed", id: renewed.id, kept: true });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(2);
  });

  it("records the series, the signer and the blanks on the row, and holds one row per version, series and signer in the index", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const first = await trailRun({ startsAt: OCT(7) });
    await trailRun({ startsAt: OCT(14) });
    const signed = await signGroupRunDeclaration(db, await input(first.id), NOW);
    if (signed.outcome !== "signed") throw new Error("not signed");
    const [row] = await db.select().from(groupRunDeclarations);
    expect(row.seriesKey).toBe("GROUP_RUN\ntura pe munte");
    expect(row.signerKey).toBe("ana@example.ro\nana popescu");
    expect(row.signedFacts).toMatchObject({ series: "Tura pe munte", seriesRhythm: "în fiecare miercuri, la 19:00", seriesPlace: "Stația de telecabină", event: "Tura pe munte" });
    // Nothing personal among the kept blanks.
    expect(JSON.stringify(row.signedFacts)).not.toMatch(/Ana|Popescu|ana@example/);

    // A second press that read nothing (the race the index is for): the insert writes nothing.
    const later = await trailRun({ startsAt: OCT(21) });
    const again = {
      eventId: later.id,
      legalDocumentId: row.legalDocumentId,
      declarationVersion: row.declarationVersion,
      contentSha256: row.contentSha256,
      locale: row.locale,
      typedName: row.typedName,
      email: row.email,
      acceptedAt: NOW,
      seriesKey: row.seriesKey,
      signerKey: row.signerKey,
    };
    expect(await insertGroupRunDeclaration(db, again)).toBeUndefined();
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(1);
  });

  it("a one-off run's declaration covers its own date: no series on the row, and the PDF keeps the one-off sentence", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const once = await trailRun({ startsAt: OCT(10) }, { ro: "Tura de toamnă", en: "The autumn loop" });
    const signed = await signGroupRunDeclaration(db, await input(once.id), NOW);
    if (signed.outcome !== "signed") throw new Error("not signed");
    const [row] = await db.select().from(groupRunDeclarations);
    expect(row.seriesKey).toBeNull();
    expect(row.signedFacts).toMatchObject({ series: "", seriesRhythm: "", seriesPlace: "", event: "Tura de toamnă" });

    const [message] = await db.select().from(emailOutbox);
    const email = await renderOutboxMessage(claimed(message), db, NOW);
    // The subject names the run, not a series.
    expect(email.subject).toContain("— Tura de toamnă");
    expect(email.subject).not.toContain("seria");
    const drawn = watched.pdfInputs.at(-1) as DeclarationPdfInput;
    const merged = JSON.stringify(mergeLegalBody(drawn.entries[0].body, drawn.entries[0].values ?? {}));
    expect(merged).toContain("Declarația este pentru alergarea de grup Tura de toamnă, sâmbătă, 10 oct. 2026, cu plecare din Stația de telecabină.");
    expect(merged).not.toContain("toate alergările seriei");
  });

  it("a series' PDF and both emails name the series and its rhythm, and keep the series sentence", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    await archiveOn();
    const first = await trailRun({ startsAt: OCT(7) });
    await trailRun({ startsAt: OCT(14) });
    await signGroupRunDeclaration(db, await input(first.id), NOW);

    const [signerMessage] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "GROUP_RUN_DECLARATION_SIGNED"));
    const toSigner = await renderOutboxMessage(claimed(signerMessage), db, NOW);
    expect(toSigner.subject).toContain("seria Tura pe munte");
    expect(toSigner.subject).toContain("The mountain loop (series)");
    expect(toSigner.text).toContain("pentru seria de alergări de grup Tura pe munte (în fiecare miercuri, la 19:00)");
    expect(toSigner.text).toContain("Declarația este valabilă pentru toate alergările seriei");
    expect(toSigner.text).toContain("for the group run series The mountain loop (every Wednesday at 19:00)");
    const drawn = watched.pdfInputs.at(-1) as DeclarationPdfInput;
    const merged = JSON.stringify(mergeLegalBody(drawn.entries[0].body, drawn.entries[0].values ?? {}));
    expect(merged).toContain("Declarația este valabilă pentru toate alergările seriei Tura pe munte — în fiecare miercuri, la 19:00, cu plecare de obicei din Stația de telecabină —");
    expect(merged).not.toContain("Declarația este pentru alergarea de grup");

    const [archiveMessage] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "GROUP_RUN_DECLARATION_ARCHIVE"));
    const toClub = await renderOutboxMessage(claimed(archiveMessage), db, NOW);
    expect(toClub.subject).toContain("seria Tura pe munte");
    expect(toClub.text).toContain("Este valabilă pentru toate alergările seriei.");
    expect(toClub.text).toContain("It is valid for every run of the series.");
  });

  it("deleting a date moves a series' declarations to the next date, or the latest before the last; its PDF says the same after the move", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const actor = await admin();
    const first = await trailRun({ startsAt: OCT(7) });
    const second = await trailRun({ startsAt: OCT(14) });
    const third = await trailRun({ startsAt: OCT(21) });
    const signed = await signGroupRunDeclaration(db, await input(second.id), NOW);
    if (signed.outcome !== "signed") throw new Error("not signed");
    const drawnValues = async () => {
      const found = (await findSignedGroupRunDeclaration(db, signed.id))!;
      await renderGroupRunDeclarationPdf(db, found, "participant", NOW);
      return (watched.pdfInputs.at(-1) as DeclarationPdfInput).entries[0].values;
    };
    const before = await drawnValues();

    await deleteEvent(db, { actor, eventId: second.id });
    // The next date after the one deleted, never an earlier one while a later exists.
    expect((await db.select().from(groupRunDeclarations)).map((row) => row.eventId)).toEqual([third.id]);
    expect(await db.select().from(emailOutbox)).toHaveLength(1);
    // What the text says is what it said at the signing (§57): the move changes nothing in the PDF.
    expect(await drawnValues()).toEqual(before);

    const titleOf = async (id: string) => (await db.select({ title: eventTranslations.title }).from(eventTranslations).where(eq(eventTranslations.eventId, id)))[0]?.title ?? id;
    // The run's last date deleted: to the latest before it, so the evidence stays while the run has a date.
    await hardDeleteEvent(db, { actor, eventId: third.id, typedTitle: await titleOf(third.id), reason: "dată greșită", now: NOW });
    expect((await db.select().from(groupRunDeclarations)).map((row) => row.eventId)).toEqual([first.id]);
    expect(await drawnValues()).toEqual(before);

    await hardDeleteEvent(db, { actor, eventId: first.id, typedTitle: await titleOf(first.id), reason: "sezon încheiat", now: NOW });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });
});

/*
  §523 — the «already signed» state, read from the signer's own link alone. The signer's copy carries
  a link to the run's next date with `?declaratie=<secret>`; the row keeps its SHA-256. The run's page
  reads it (`findSignatureByViewToken`) and says «Ai semnat deja…» for the version in force, and asks
  again once a newer one is.
*/
describe("§523 the signer's own link", () => {
  const OCT = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T16:00:00.000Z`);
  const secretIn = (html: string) => /[?&]declaratie=([A-Za-z0-9_-]{43})/.exec(html)?.[1];

  it("is minted when the signer's copy is sent, hashed on the row, and reads the declaration on every date of the series", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    await updateClubNotices(db, await admin(), { declarations: { to: ARCHIVE, cc: [], bcc: [] }, confirmations: { to: [] }, participants: { bcc: [] } }, NOW);
    const first = await trailRun({ startsAt: OCT(7) });
    const second = await trailRun({ startsAt: OCT(14) });
    const otherRun = await trailRun({ startsAt: OCT(8) }, { ro: "Tura de joi", en: "The Thursday loop" });
    await signGroupRunDeclaration(db, await input(first.id), NOW);

    const [signerMessage] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "GROUP_RUN_DECLARATION_SIGNED"));
    const email = await renderOutboxMessage(claimed(signerMessage), db, NOW);
    const secret = secretIn(email.html);
    expect(secret).toBeDefined();
    // To the run's next date, at the section.
    const [slugOfFirst] = await db.select({ slug: eventTranslations.slug }).from(eventTranslations).where(eq(eventTranslations.eventId, first.id));
    expect(email.html).toContain(`${slugOfFirst.slug}?declaratie=${secret}#declaratie`);
    const [row] = await db.select().from(groupRunDeclarations);
    // Only the hash is kept (§12.8).
    expect(row.viewTokenHash).toBe(hashTokenSecret(secret!));
    expect(JSON.stringify(row)).not.toContain(secret!);

    const inForce = (await findCurrentApprovedDocument(db, "GROUP_RUN_DECLARATION_TRAIL", "ro", NOW))!;
    for (const date of [first, second]) {
      const mine = await findSignatureByViewToken(db, hashTokenSecret(secret!), date.id, "GROUP_RUN_DECLARATION_TRAIL");
      expect(mine).toMatchObject({ version: 1, series: true });
      expect(signedStateFor(mine, inForce.id)).toMatchObject({ kind: "current", version: 1 });
    }
    // Another run, or another kind of text, is not what the link names.
    expect(await findSignatureByViewToken(db, hashTokenSecret(secret!), otherRun.id, "GROUP_RUN_DECLARATION_TRAIL")).toBeUndefined();
    expect(await findSignatureByViewToken(db, hashTokenSecret(secret!), second.id, "GROUP_RUN_DECLARATION_ASPHALT")).toBeUndefined();

    // The archive copy carries no link: it is the signer's.
    const [archiveMessage] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "GROUP_RUN_DECLARATION_ARCHIVE"));
    expect(secretIn((await renderOutboxMessage(claimed(archiveMessage), db, NOW)).html)).toBeUndefined();
  });

  it("asks again once a newer version is in force, and reads the new signature from its own link after", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const first = await trailRun({ startsAt: OCT(7) });
    const second = await trailRun({ startsAt: OCT(14) });
    await signGroupRunDeclaration(db, await input(first.id), NOW);
    const [message] = await db.select().from(emailOutbox);
    const secret = secretIn((await renderOutboxMessage(claimed(message), db, NOW)).html)!;

    const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({
      locale,
      title: LEGAL_TEMPLATES.GROUP_RUN_DECLARATION_TRAIL[locale].title,
      body: { sections: [...LEGAL_TEMPLATES.GROUP_RUN_DECLARATION_TRAIL[locale].body.sections, { paragraphs: ["v2"] }] },
    }));
    await insertLegalDocumentVersion(db, { key: "GROUP_RUN_DECLARATION_TRAIL", version: 2, effectiveAt: new Date("2026-02-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
    const v2 = (await findCurrentApprovedDocument(db, "GROUP_RUN_DECLARATION_TRAIL", "ro", NOW))!;
    const old = await findSignatureByViewToken(db, hashTokenSecret(secret), second.id, "GROUP_RUN_DECLARATION_TRAIL");
    expect(signedStateFor(old, v2.id)).toMatchObject({ kind: "renew", version: 1 });

    const renewed = await signGroupRunDeclaration(db, await input(second.id), NOW);
    if (renewed.outcome !== "signed") throw new Error("not signed");
    const [newMessage] = (await db.select().from(emailOutbox)).filter((row) => (row.payloadJson as { groupRunDeclarationId?: string }).groupRunDeclarationId === renewed.id);
    const newSecret = secretIn((await renderOutboxMessage(claimed(newMessage), db, NOW)).html)!;
    expect(signedStateFor(await findSignatureByViewToken(db, hashTokenSecret(newSecret), first.id, "GROUP_RUN_DECLARATION_TRAIL"), v2.id)).toMatchObject({ kind: "current", version: 2 });
  });

  it("a one-off run's link reads on its own date only, and a link that names nothing reads nothing", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const once = await trailRun({ startsAt: OCT(10) }, { ro: "Tura de toamnă", en: "The autumn loop" });
    const other = await trailRun({ startsAt: OCT(11) }, { ro: "Tura de iarnă", en: "The winter loop" });
    await signGroupRunDeclaration(db, await input(once.id), NOW);
    const [message] = await db.select().from(emailOutbox);
    const secret = secretIn((await renderOutboxMessage(claimed(message), db, NOW)).html)!;
    expect(await findSignatureByViewToken(db, hashTokenSecret(secret), once.id, "GROUP_RUN_DECLARATION_TRAIL")).toMatchObject({ version: 1, series: false });
    expect(await findSignatureByViewToken(db, hashTokenSecret(secret), other.id, "GROUP_RUN_DECLARATION_TRAIL")).toBeUndefined();
    expect(await findSignatureByViewToken(db, hashTokenSecret("A".repeat(43)), once.id, "GROUP_RUN_DECLARATION_TRAIL")).toBeUndefined();
  });
});

/*
  §523, the review of the series round — what the text in force decides, filled by one function.

  1. The signing page, the press and the PDF fill a group-run text from `groupRunMergeValues`: a series'
     values keep the series sentence and drop the one-off one; a one-off's the reverse.
  2. A signature covers the series only when the text it signs names {{series}}. Under the version
     approved on production before it — one run, {{eventDate}} — it covers the date it was signed on,
     one row per date, and the runner signs again on the next date.
  4. The Administrator's erase of a series signature clears it for every date of the series.
  5. A series whose place is not written keeps the series sentence without its place clause.
*/
describe("§523 what the text in force decides", () => {
  const OCT = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T16:00:00.000Z`);
  const secretIn = (html: string) => /[?&]declaratie=([A-Za-z0-9_-]{43})/.exec(html)?.[1];

  /** The trail text as approved before §523: the platform's, less the series sentences — one run, one date. */
  async function approveOlderTrailText() {
    const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => {
      const template = LEGAL_TEMPLATES.GROUP_RUN_DECLARATION_TRAIL[locale];
      return {
        locale,
        title: template.title,
        body: { sections: template.body.sections.map((section) => ({ ...section, paragraphs: section.paragraphs.filter((paragraph) => !paragraph.includes("{{series")) })) },
      };
    });
    await insertLegalDocumentVersion(db, { key: "GROUP_RUN_DECLARATION_TRAIL", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
    await approveOne("PRIVACY_NOTICE");
  }

  const rendered = async (eventId: string) => {
    const document = (await findCurrentApprovedDocument(db, "GROUP_RUN_DECLARATION_TRAIL", "ro", NOW))!;
    const facts = await groupRunMergeValues(db, eventId, "ro", document.body);
    return { facts, text: JSON.stringify(mergeLegalBody(document.body, facts?.values ?? {})) };
  };

  it("fills a series' text with the series sentence and a one-off's with the one-off sentence, from the one function the page and the press use", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const first = await trailRun({ startsAt: OCT(7) });
    await trailRun({ startsAt: OCT(14) });
    const once = await trailRun({ startsAt: OCT(10) }, { ro: "Tura de toamnă", en: "The autumn loop" });

    const series = await rendered(first.id);
    expect(series.facts?.seriesKey).toBe("GROUP_RUN\ntura pe munte");
    expect(series.text).toContain("Declarația este valabilă pentru toate alergările seriei Tura pe munte — în fiecare miercuri, la 19:00, cu plecare de obicei din Stația de telecabină —");
    expect(series.text).not.toContain("Declarația este pentru alergarea de grup");

    const oneOff = await rendered(once.id);
    expect(oneOff.facts?.seriesKey).toBeNull();
    expect(oneOff.text).toContain("Declarația este pentru alergarea de grup Tura de toamnă, sâmbătă, 10 oct. 2026, cu plecare din Stația de telecabină.");
    expect(oneOff.text).not.toContain("toate alergările seriei");
  });

  it("keeps the series sentence without its place when the run's place is not written, never dropping both", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const first = await trailRun({ startsAt: OCT(7), locationName: null });
    await trailRun({ startsAt: OCT(14), locationName: null });
    const { text } = await rendered(first.id);
    expect(text).toContain("Declarația este valabilă pentru toate alergările seriei Tura pe munte — în fiecare miercuri, la 19:00 — la care particip");
    expect(text).not.toContain("cu plecare de obicei din");
    expect(text).not.toContain("Declarația este pentru alergarea de grup");
  });

  it("under a text that names no series, a signature covers its own date: no series on the row, and the next date is signed again", async () => {
    await approveOlderTrailText();
    expect(await groupRunDeclarationsSeriesCurrent(db, NOW)).toBe(false);
    const first = await trailRun({ startsAt: OCT(7) });
    const second = await trailRun({ startsAt: OCT(14) });

    // What the signer reads: the one run and its date, no series sentence to keep.
    const { facts, text } = await rendered(first.id);
    expect(facts?.seriesKey).toBeNull();
    expect(text).toContain("Declarația este pentru alergarea de grup Tura pe munte, miercuri, 7 oct. 2026");
    expect(text).not.toContain("toate alergările seriei");

    const signed = await signGroupRunDeclaration(db, await input(first.id), NOW);
    if (signed.outcome !== "signed") throw new Error("not signed");
    const [row] = await db.select().from(groupRunDeclarations);
    expect(row.seriesKey).toBeNull();
    expect(row.signedFacts).not.toHaveProperty("series");

    // The next date is not covered: nothing there to keep, and the signer's link reads nothing on it.
    const dates = (await listSeriesDatesOf(db, second.id)).map((date) => date.id);
    expect(await listCoveringSignatures(db, second.id, dates, row.legalDocumentId)).toEqual([]);
    const [message] = await db.select().from(emailOutbox);
    const email = await renderOutboxMessage(claimed(message), db, NOW);
    expect(email.subject).not.toContain("seria");
    const secret = secretIn(email.html)!;
    // The link opens the date the signature covers, not the run's next one.
    const [slugOfFirst] = await db.select({ slug: eventTranslations.slug }).from(eventTranslations).where(eq(eventTranslations.eventId, first.id));
    expect(email.html).toContain(`${slugOfFirst.slug}?declaratie=${secret}#declaratie`);
    expect(await findSignatureByViewToken(db, hashTokenSecret(secret), first.id, "GROUP_RUN_DECLARATION_TRAIL")).toMatchObject({ series: false });
    expect(await findSignatureByViewToken(db, hashTokenSecret(secret), second.id, "GROUP_RUN_DECLARATION_TRAIL")).toBeUndefined();

    // So the second date takes its own signature, as the text in force says.
    expect(await signGroupRunDeclaration(db, await input(second.id), NOW)).toMatchObject({ outcome: "signed", kept: false });
    const rows = await db.select().from(groupRunDeclarations);
    expect(rows.map((declaration) => declaration.eventId).sort()).toEqual([first.id, second.id].sort());
    expect(rows.every((declaration) => declaration.seriesKey === null)).toBe(true);
    // And pressed again on the first date, the first date's is kept.
    expect(await signGroupRunDeclaration(db, await input(first.id), NOW)).toEqual({ outcome: "signed", id: signed.id, kept: true });
  });

  it("the Administrator's erase of a series signature clears it for every date of the series, with one audit row", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const dates = [await trailRun({ startsAt: OCT(7) }), await trailRun({ startsAt: OCT(14) }), await trailRun({ startsAt: OCT(21) })];
    const signed = await signGroupRunDeclaration(db, await input(dates[0].id), NOW);
    if (signed.outcome !== "signed") throw new Error("not signed");
    const [message] = await db.select().from(emailOutbox);
    const secret = secretIn((await renderOutboxMessage(claimed(message), db, NOW)).html)!;
    const [row] = await db.select().from(groupRunDeclarations);
    const ids = dates.map((date) => date.id);

    // Signed once: every date of the series reads it — the page from the link, the press, the backoffice.
    for (const date of dates) {
      expect(await findSignatureByViewToken(db, hashTokenSecret(secret), date.id, "GROUP_RUN_DECLARATION_TRAIL")).toMatchObject({ series: true });
      expect(await listCoveringSignatures(db, date.id, ids, row.legalDocumentId)).toHaveLength(1);
      expect(await listGroupRunDeclarations(db, date.id)).toHaveLength(1);
    }

    const actor = await admin();
    await eraseGroupRunDeclaration(db, actor, { id: signed.id, reason: "a cerut ștergerea" }, NOW);

    // Erased: no date reads it any more.
    for (const date of dates) {
      expect(await findSignatureByViewToken(db, hashTokenSecret(secret), date.id, "GROUP_RUN_DECLARATION_TRAIL")).toBeUndefined();
      expect(await listCoveringSignatures(db, date.id, ids, row.legalDocumentId)).toEqual([]);
      expect(await listGroupRunDeclarations(db, date.id)).toEqual([]);
    }
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.group_run_declaration_erased"));
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ actorStaffUserId: actor.id, entityId: dates[0].id });
    // The next press on any date is a new signature.
    expect(await signGroupRunDeclaration(db, await input(dates[2].id), NOW)).toMatchObject({ outcome: "signed", kept: false });
  });
});

/*
  §523 — `/admin/tasks` asks for the group-run declarations again until every one in force names
  `{{series}}`: the platform's text written for one signature per series.
*/
describe("§523 the group-run texts' row on /admin/tasks", () => {
  it("is null with none in force, true for the platform's texts, false while one in force is older", async () => {
    expect(await groupRunDeclarationsSeriesCurrent(db, NOW)).toBeNull();
    await approveOne("GROUP_RUN_DECLARATION_TRAIL");
    expect(await groupRunDeclarationsSeriesCurrent(db, NOW)).toBe(true);
    // An asphalt text approved before §523: one date, no series sentence.
    const older: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({
      locale,
      title: LEGAL_TEMPLATES.GROUP_RUN_DECLARATION_ASPHALT[locale].title,
      body: { sections: [{ paragraphs: ["Subsemnatul/a {{participant}}, particip la alergarea {{event}}, {{eventDate}}."] }] },
    }));
    await insertLegalDocumentVersion(db, { key: "GROUP_RUN_DECLARATION_ASPHALT", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(older), translations: older, now: NOW });
    expect(await groupRunDeclarationsSeriesCurrent(db, NOW)).toBe(false);
  });
});

describe("§503 retention: the declaration is kept until the signer asks", () => {
  it("keeps a declaration of a run a year gone, with its messages until their own window", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const old = await trailRun({ startsAt: new Date("2026-09-01T16:00:00.000Z") });
    await signGroupRunDeclaration(db, await input(old.id), new Date("2026-09-01T10:00:00.000Z"));
    // The signer's copy (no archive mailbox is set here).
    expect(await db.select().from(emailOutbox)).toHaveLength(1);

    // Eight days after the run — the old window: the row and its (unsent) message stay.
    const early = await pruneExpiredRows(db, new Date("2026-09-09T17:00:00.000Z"));
    expect(early.failures).toEqual([]);
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(1);
    expect(await db.select().from(emailOutbox)).toHaveLength(1);

    // A year on, the declaration is still there; the message, about no registration, went at its ninety days.
    const late = await pruneExpiredRows(db, new Date("2027-09-02T17:00:00.000Z"));
    expect(late.failures).toEqual([]);
    const left = await db.select().from(groupRunDeclarations);
    expect(left.map((row) => row.eventId)).toEqual([old.id]);
    expect(left[0].email).toBe("ana@example.ro");
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it("clears an identity document seven days after the run, and keeps the declaration", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const old = await trailRun({ startsAt: new Date("2026-09-01T16:00:00.000Z") });
    const recent = await trailRun({ startsAt: new Date("2026-09-03T16:00:00.000Z") });
    await signGroupRunDeclaration(db, await input(old.id), new Date("2026-09-01T10:00:00.000Z"));
    await signGroupRunDeclaration(db, await input(recent.id, { email: "ion@example.ro" }), new Date("2026-09-03T10:00:00.000Z"));
    // A text from before §418 asked for a document: set one on both, as such a signature would have.
    await db.update(groupRunDeclarations).set({ idDocument: "Carte de identitate BV 123456" });

    const counts = await pruneExpiredRows(db, new Date("2026-09-09T17:00:00.000Z"));
    expect(counts.failures).toEqual([]);
    expect(counts.groupRunIdDocuments).toBe(1);
    const rows = await db.select().from(groupRunDeclarations);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.eventId === old.id)?.idDocument).toBeNull();
    expect(rows.find((row) => row.eventId === recent.id)?.idDocument).toBe("Carte de identitate BV 123456");
  });
});

/**
 * §440 (amending §393) — the run's own minimum age: the event's `min_age` (§329), stated in the
 * declaration through `{{minimumAge}}` and asked at the signing page's door by the race's rule
 * (`isUnderMinimumAge`), on the run's day in the run's zone. The run starts on 7 October 2026.
 */
describe("§440 a group run's minimum age at the signing door", () => {
  it("refuses a signer who turns twenty-one the day after the run, naming the birth date and the age, and writes nothing", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun({ minAge: 21 });
    await expect(signGroupRunDeclaration(db, await input(event.id, { birthDate: "2005-10-08" }), NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["birthDate", "tooYoung"],
    });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it("names a missing birth date while the run has a minimum, with the other wrong boxes", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun({ minAge: 21 });
    await expect(signGroupRunDeclaration(db, await input(event.id, { birthDate: undefined, accepted: false }), NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["birthDate", "accepted"],
    });
  });

  it("takes a signer who turns twenty-one on the day of the run, and states the minimum in the PDF", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun({ minAge: 21 });
    expect((await signGroupRunDeclaration(db, await input(event.id, { birthDate: "2005-10-07" }), NOW)).outcome).toBe("signed");
    const [signed] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "GROUP_RUN_DECLARATION_SIGNED"));
    await renderOutboxMessage(claimed(signed), db, NOW);
    const drawn = watched.pdfInputs.at(-1) as DeclarationPdfInput;
    expect(drawn.entries[0].values?.minimumAge).toBe("21 de ani");
    expect(JSON.stringify(drawn.entries[0].body)).toContain("Declar că am cel puțin {{minimumAge}} împliniți la data fiecărei alergări la care particip.");
  });

  it("counts the day in the run's zone: a start at 01:30 in Brașov is the 7th, the 6th in UTC", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun({ minAge: 21, startsAt: new Date("2026-10-06T22:30:00.000Z"), timezone: "Europe/Bucharest" });
    expect((await signGroupRunDeclaration(db, await input(event.id, { birthDate: "2005-10-07" }), NOW)).outcome).toBe("signed");
  });

  // §515: the text states the run's age through {{minimumAge}} alone, never under eighteen — the
  // declaration covers no minor — and asks a birth date only above eighteen (§440).
  it("asks no birth date of a run whose minimum is eighteen or less, and states eighteen in the PDF", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun({ minAge: 14 });
    expect((await signGroupRunDeclaration(db, await input(event.id, { birthDate: undefined }), NOW)).outcome).toBe("signed");
    const [signed] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "GROUP_RUN_DECLARATION_SIGNED"));
    await renderOutboxMessage(claimed(signed), db, NOW);
    const drawn = watched.pdfInputs.at(-1) as DeclarationPdfInput;
    expect(drawn.entries[0].values?.minimumAge).toBe("18 ani");
  });

  it("reads a run saved with no minimum as eighteen: no birth date, eighteen in the PDF", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const event = await trailRun({ minAge: 0 });
    expect((await signGroupRunDeclaration(db, await input(event.id, { birthDate: undefined }), NOW)).outcome).toBe("signed");
    const [signed] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "GROUP_RUN_DECLARATION_SIGNED"));
    await renderOutboxMessage(claimed(signed), db, NOW);
    const drawn = watched.pdfInputs.at(-1) as DeclarationPdfInput;
    expect(drawn.entries[0].values?.minimumAge).toBe("18 ani");
  });
});
