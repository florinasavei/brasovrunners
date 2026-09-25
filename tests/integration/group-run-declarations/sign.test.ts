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
import { findCurrentApprovedDocument, insertLegalDocumentVersion, listVersionsForBackoffice } from "@/modules/legal-documents/repository";
import { deleteApprovedVersion, updateDraftVersion } from "@/modules/legal-documents/service";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { updateClubNotices } from "@/modules/notifications/club-notices";
import type { OutboxRow } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { findSignedGroupRunDeclaration } from "@/modules/group-run-declarations/repository";
import { eraseGroupRunDeclaration, type GroupRunSigningInput, signGroupRunDeclaration } from "@/modules/group-run-declarations/service";
import type { DeclarationPdfInput } from "@/modules/registrations/declaration-pdf";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * A group run's optional self-declaration, signed, sent, erased and swept (§393).
 *
 * The owner, 2026-09-25: "I might need a 'declarație pe propria răspundere' for group runs as well,
 * especially for the trail one; this is optional but people should be able to sign and email it to
 * us". One row, never a registration; two messages through the outbox — the signer's PDF, whole,
 * and the club's archive copy with the identity document masked (§320); bound to the version read
 * (§57); erased by an Administrator with an audit row that never names the signer (§67, §88); gone
 * seven days after the run.
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

async function approveOne(key: LegalDocumentKey, version = 1) {
  const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES[key][locale] }));
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
async function approveTemplate(key: LegalDocumentKey, { privacy = true }: { privacy?: boolean } = {}) {
  await approveOne(key);
  if (privacy) await approveOne("PRIVACY_NOTICE");
}

/** The Tâmpa trail run: a published group run on a trail, offering the declaration. */
async function trailRun(overrides: Partial<typeof events.$inferInsert> = {}) {
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
    { eventId: event.id, locale: "ro", title: "Tura pe munte", slug: `tura-${event.id.slice(0, 6)}` },
    { eventId: event.id, locale: "en", title: "The mountain loop", slug: `loop-${event.id.slice(0, 6)}` },
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
    expect(rows[0]).toMatchObject({ eventId: event.id, typedName: "Ana Popescu", idDocument: ID, email: "ana@example.ro", locale: "ro", declarationVersion: 1 });

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

  it("sends the signer the whole document and the club a masked one, both with the PDF attached", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
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
    expect(drawnFrom(watched.pdfInputs.at(-1))).toContain("BV 123456");

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
    await expect(
      signGroupRunDeclaration(db, await input(event.id, { accepted: false, typedName: "  ", idDocument: undefined, email: "not an address" }), NOW),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["idDocument", "typedName", "email", "accepted"] });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
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

  it("counts a signature as reliance on the version: it cannot be edited or deleted under it, and can once the sweep took the signature", async () => {
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

    // Seven days after the run the sweep takes the signature, and with it the only reliance.
    const counts = await pruneExpiredRows(db, later);
    expect(counts.groupRunDeclarations).toBe(1);
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
    const deleted = await trailRun();
    const erased = await trailRun();
    const kept = await trailRun();
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

describe("§393 retention: the declaration goes seven days after the run", () => {
  it("sweeps a declaration of a run eight days gone with its messages, and keeps one six days gone", async () => {
    await approveTemplate("GROUP_RUN_DECLARATION_TRAIL");
    const old = await trailRun({ startsAt: new Date("2026-09-01T16:00:00.000Z") });
    const recent = await trailRun({ startsAt: new Date("2026-09-03T16:00:00.000Z") });
    await signGroupRunDeclaration(db, await input(old.id), new Date("2026-09-01T10:00:00.000Z"));
    await signGroupRunDeclaration(db, await input(recent.id, { email: "ion@example.ro" }), new Date("2026-09-03T10:00:00.000Z"));
    expect(await db.select().from(emailOutbox)).toHaveLength(2);

    const counts = await pruneExpiredRows(db, new Date("2026-09-09T17:00:00.000Z"));
    expect(counts.failures).toEqual([]);
    expect(counts.groupRunDeclarations).toBe(1);
    const left = await db.select().from(groupRunDeclarations);
    expect(left.map((row) => row.eventId)).toEqual([recent.id]);
    const outbox = await db.select().from(emailOutbox);
    expect(outbox.map((row) => row.recipientEmail)).toEqual(["ion@example.ro"]);
  });
});
