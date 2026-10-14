import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, groupRunDeclarationsNameMinor, groupRunMinorPathOffered, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { updateClubNotices } from "@/modules/notifications/club-notices";
import type { OutboxRow } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { findSignedGroupRunDeclaration, listGroupRunDeclarations } from "@/modules/group-run-declarations/repository";
import { type GroupRunSigningInput, signGroupRunDeclaration } from "@/modules/group-run-declarations/service";
import { renderGroupRunDeclarationPdf } from "@/modules/group-run-declarations/pdf";
import { staffUsers } from "@/db/schema/staff-users";
import type { DeclarationPdfInput } from "@/modules/registrations/declaration-pdf";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { drawnRuns } from "../../helpers/pdf-drawn";

/**
 * A minor signs a group run's declaration, with a parent (§769, amending §393, §523 and §330; the owner,
 * 2026-10-14: «pt alergările de grup trebuie să facem declarația să suporte și un minor, o bifă nouă și să
 * semneze minorul + părintele»).
 *
 * One row, §330's columns: `typed_name` the parent's, `minor_typed_name` the minor's — no second table, no
 * identity document. Offered only while the run takes minors and the text in force names `{{minor}}` in every
 * language; both names and the parent's tick required when ticked, none when not; the PDF draws both
 * signatures with the race's own block; the list and the emails name both.
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
const KEY: LegalDocumentKey = "GROUP_RUN_DECLARATION_TRAIL";

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

/** The platform's text of `key`, or — `withoutMinor` — the one a club approved before the minor's paragraph existed. */
function translationsOf(key: LegalDocumentKey, { withoutMinor = false }: { withoutMinor?: boolean } = {}): LegalDocumentTranslationInput[] {
  return (["ro", "en"] as const).map((locale) => {
    const template = LEGAL_TEMPLATES[key][locale];
    if (!withoutMinor) return { locale, ...template };
    return {
      locale,
      ...template,
      body: { sections: template.body.sections.map((section) => ({ ...section, paragraphs: section.paragraphs.filter((p) => !p.includes("{{minor}}") && !p.includes("{{signerAlone}}")) })) },
    };
  });
}

async function approve(key: LegalDocumentKey, translations: LegalDocumentTranslationInput[], version = 1) {
  await insertLegalDocumentVersion(db, {
    key,
    version,
    effectiveAt: new Date(`2026-01-0${version}T00:00:00Z`),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

/** The trail text and the privacy notice beside it: a signature takes an address, and nothing without a notice (BR-REQ-053-01). */
async function approveTexts({ withoutMinor = false }: { withoutMinor?: boolean } = {}) {
  await approve(KEY, translationsOf(KEY, { withoutMinor }));
  await approve("PRIVACY_NOTICE", translationsOf("PRIVACY_NOTICE"));
}

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
      // A run that takes minors: its own minimum is under eighteen (the column's default is fourteen).
      minAge: 14,
      ...overrides,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: title.ro, slug: `tura-${event.id.slice(0, 6)}` },
    { eventId: event.id, locale: "en", title: title.en, slug: `loop-${event.id.slice(0, 6)}` },
  ]);
  return event;
}

/** An adult's own press, as the action posts it. */
async function adult(eventId: string, overrides: Partial<GroupRunSigningInput> = {}): Promise<GroupRunSigningInput> {
  const document = await findCurrentApprovedDocument(db, KEY, overrides.locale ?? "ro", NOW);
  if (!document) throw new Error("no approved trail declaration");
  return { eventId, documentId: document.id, contentSha256: document.contentSha256, accepted: true, typedName: "Ana Popescu", email: "ana@example.ro", locale: "ro", ...overrides };
}

/** A parent's press for a child: the tick, both names, the parent's tick, the child's birth date (counted and dropped). */
async function forMinor(eventId: string, overrides: Partial<GroupRunSigningInput> = {}): Promise<GroupRunSigningInput> {
  return adult(eventId, { minor: true, minorTypedName: "Ion Popescu", guardianAgrees: true, birthDate: "2012-03-01", ...overrides });
}

const claimed = (row: OutboxRow): OutboxRow => ({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: NOW });

describe("§769 the minor's path is offered only while a text names it, and only on a run that takes minors", () => {
  it("is offered when the trail text in force names {{minor}} in every language and the row's check is green", async () => {
    await approveTexts();
    expect(await groupRunMinorPathOffered(db, KEY, NOW)).toBe(true);
    expect(await groupRunDeclarationsNameMinor(db, NOW)).toBe(true);
  });

  it("is not offered under a text approved before the paragraph, and /admin/tasks' row says so", async () => {
    await approveTexts({ withoutMinor: true });
    expect(await groupRunMinorPathOffered(db, KEY, NOW)).toBe(false);
    expect(await groupRunDeclarationsNameMinor(db, NOW)).toBe(false);
  });

  it("says nothing while no group-run text is in force at all", async () => {
    expect(await groupRunMinorPathOffered(db, KEY, NOW)).toBe(false);
    expect(await groupRunDeclarationsNameMinor(db, NOW)).toBeNull();
  });

  it("is not offered when only one language names it", async () => {
    const [ro, en] = translationsOf(KEY);
    const [, enOld] = translationsOf(KEY, { withoutMinor: true });
    await approve(KEY, [ro, enOld]);
    expect(en).toBeDefined();
    expect(await groupRunMinorPathOffered(db, KEY, NOW)).toBe(false);
  });

  it("refuses the tick under an older text, on the tick's own box, and writes nothing", async () => {
    await approveTexts({ withoutMinor: true });
    const event = await trailRun();
    await expect(signGroupRunDeclaration(db, await forMinor(event.id), NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["minor"] });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
  });

  it("refuses the tick on a run for adults — its minimum is eighteen — whatever the text says", async () => {
    await approveTexts();
    const event = await trailRun({ minAge: 18 });
    await expect(signGroupRunDeclaration(db, await forMinor(event.id), NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: expect.arrayContaining(["minor"]) });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
  });
});

describe("§769 the two names: required when ticked, none when not", () => {
  it("names both boxes of the minor's path when the tick is ticked and they are empty", async () => {
    await approveTexts();
    const event = await trailRun();
    await expect(
      signGroupRunDeclaration(db, await forMinor(event.id, { minorTypedName: "  ", guardianAgrees: false }), NOW),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["minorTypedName", "guardianAgrees"] });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
  });

  it("names the parent's own signature too when it is empty, and the minor's birth date when it is missing or under the minimum", async () => {
    await approveTexts();
    const event = await trailRun({ minAge: 16 });
    await expect(signGroupRunDeclaration(db, await forMinor(event.id, { typedName: "", birthDate: undefined }), NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["birthDate", "typedName"],
    });
    // Fifteen on the run's day, under the run's sixteen: the box and the marker the page says the number with.
    await expect(signGroupRunDeclaration(db, await forMinor(event.id, { birthDate: "2011-10-08" }), NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["birthDate", "tooYoung"],
    });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
  });

  it("refuses a minor's birth date of eighteen or more on the run's day — the tick says «sub 18 ani» — and writes nothing", async () => {
    await approveTexts();
    const event = await trailRun();
    // The run is on 7 October 2026: born 1986, or on the 18th birthday itself, is an adult.
    for (const birthDate of ["1986-01-01", "2008-10-07"]) {
      await expect(signGroupRunDeclaration(db, await forMinor(event.id, { birthDate }), NOW)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        fields: ["birthDate", "tooOld"],
      });
    }
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
    // The day after the 18th birthday's date is still seventeen: signed, and the date is not kept.
    await expect(signGroupRunDeclaration(db, await forMinor(event.id, { birthDate: "2008-10-08" }), NOW)).resolves.toMatchObject({ outcome: "signed" });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(1);
  });

  it("refuses a minor's name made only of invisible characters, which would fold to the adult's own signer key", async () => {
    await approveTexts();
    const event = await trailRun();
    await expect(signGroupRunDeclaration(db, await forMinor(event.id, { minorTypedName: "​​" }), NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["minorTypedName"],
    });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(0);
  });

  it("asks neither name of an adult, and refuses a minor's box filled while the tick is not ticked", async () => {
    await approveTexts();
    const event = await trailRun();
    // Nothing asked: an adult's own press is as it always was.
    await expect(signGroupRunDeclaration(db, await adult(event.id), NOW)).resolves.toMatchObject({ outcome: "signed" });
    // A name typed in the minor's box, the tick left: an adult's declaration over a child's name — refused on the tick.
    await expect(signGroupRunDeclaration(db, await adult(event.id, { minorTypedName: "Ion Popescu", email: "b@example.ro" }), NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["minor"],
    });
    await expect(signGroupRunDeclaration(db, await adult(event.id, { guardianAgrees: true, email: "c@example.ro" }), NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["minor"],
    });
    expect(await db.select().from(groupRunDeclarations)).toHaveLength(1);
  });
});

describe("§769 the storage: one row, §330's columns", () => {
  it("keeps the parent's name in typed_name and the minor's own signature in minor_typed_name, with no document", async () => {
    await approveTexts();
    const event = await trailRun();
    const outcome = await signGroupRunDeclaration(db, await forMinor(event.id), NOW);
    expect(outcome.outcome).toBe("signed");
    const rows = await db.select().from(groupRunDeclarations);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ typedName: "Ana Popescu", minorTypedName: "Ion Popescu", idDocument: null, email: "ana@example.ro", declarationVersion: 1 });
    // The minor's birth date was counted and dropped: no column keeps it.
    expect(JSON.stringify(rows[0])).not.toContain("2012");
    // An adult's own declaration has none.
    await signGroupRunDeclaration(db, await adult(event.id, { email: "x@example.ro", typedName: "Maria Ionescu" }), NOW);
    expect((await db.select().from(groupRunDeclarations).where(eq(groupRunDeclarations.typedName, "Maria Ionescu")))[0].minorTypedName).toBeNull();
  });

  it("keeps the signature in the series' evidence: the same child signs once, a second child is a second declaration, the parent's own is a third", async () => {
    await approveTexts();
    const event = await trailRun();
    const first = await signGroupRunDeclaration(db, await forMinor(event.id), NOW);
    // The same press again: the one kept is sent again, no second row (§523).
    const again = await signGroupRunDeclaration(db, await forMinor(event.id), NOW);
    expect(again).toMatchObject({ outcome: "signed", kept: true });
    expect(first.outcome === "signed" && again.outcome === "signed" && first.id === again.id).toBe(true);
    // Another child of the same parent, on the same address.
    await signGroupRunDeclaration(db, await forMinor(event.id, { minorTypedName: "Maria Popescu" }), NOW);
    // The parent's own declaration, on the same address and name.
    await signGroupRunDeclaration(db, await adult(event.id), NOW);
    const rows = await db.select().from(groupRunDeclarations);
    expect(rows.map((row) => row.minorTypedName ?? "").sort()).toEqual(["", "Ion Popescu", "Maria Popescu"]);
  });
});

describe("§769 the signed PDF carries both signatures, as the race's does (§330)", () => {
  it("fills the text for the minor and the parent, keeps the minor's paragraphs and drops the adult's sentence", async () => {
    await approveTexts();
    const event = await trailRun();
    await signGroupRunDeclaration(db, await forMinor(event.id), NOW);
    const [row] = await db.select().from(groupRunDeclarations);
    const signed = (await findSignedGroupRunDeclaration(db, row.id))!;
    expect(signed.minorTypedName).toBe("Ion Popescu");

    const runs = await drawnRuns(() => renderGroupRunDeclarationPdf(db, signed, "participant", NOW));
    // The fill-ins are drawn as runs of their own, in bold (§225): joined back, the text reads as it was merged.
    const all = runs.map((run) => run.text).join("");
    // Two signature lines under «DREPT PENTRU CARE SEMNĂM»: the minor's, then the parent's — the race's own block.
    expect(all).toContain("DREPT PENTRU CARE SEMNĂM,");
    expect(all).toContain("Semnătura minorului:");
    expect(all).toContain("Semnătura părintelui sau tutorelui:");
    expect(runs.some((run) => run.text === "Ion Popescu")).toBe(true);
    expect(runs.some((run) => run.text === "Ana Popescu")).toBe(true);
    // The minor's paragraph is kept with both names in it; the adult's own sentence and age sentence are gone.
    expect(all).toContain("declarația este semnată de minor, Ion Popescu, pentru sine");
    expect(all).toContain("care o semnează alături de el: Ana Popescu");
    expect(all).toContain("a împlinit vârsta minimă a alergării, 14 ani");
    expect(all).not.toContain("semnez această declarație personal, doar pentru mine");
    expect(all).not.toContain("Declar că am cel puțin");
    // The method line says two people signed.
    expect(all).toContain("de minor și de părintele sau tutorele legal, împreună");
    // The proof of signing is the row's own fingerprint, over the text this PDF prints.
    expect(row.textHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the adult's own sentence for an adult, and no minor's paragraph or signature", async () => {
    await approveTexts();
    const event = await trailRun();
    await signGroupRunDeclaration(db, await adult(event.id), NOW);
    const [row] = await db.select().from(groupRunDeclarations);
    const signed = (await findSignedGroupRunDeclaration(db, row.id))!;
    const runs = await drawnRuns(() => renderGroupRunDeclarationPdf(db, signed, "participant", NOW));
    const all = runs.map((run) => run.text).join("");
    expect(all).toContain("Eu, Ana Popescu, semnez această declarație personal, doar pentru mine.");
    expect(all).toContain("DREPT PENTRU CARE SEMNEZ,");
    expect(all).not.toContain("Semnătura minorului");
    expect(all).not.toContain("declarația este semnată de minor");
  });

  it("hands the race's block the minor's signature and no document, in the English text too", async () => {
    await approveTexts();
    const event = await trailRun();
    await signGroupRunDeclaration(db, await forMinor(event.id, { locale: "en" }), NOW);
    const [row] = await db.select().from(groupRunDeclarations);
    await renderGroupRunDeclarationPdf(db, (await findSignedGroupRunDeclaration(db, row.id))!, "club", NOW);
    const input = watched.pdfInputs.at(-1) as DeclarationPdfInput;
    expect(input.entries[0].signature?.minor).toEqual({ typedName: "Ion Popescu", idDocument: null });
    expect(input.entries[0].signature?.typedName).toBe("Ana Popescu");
    expect(JSON.stringify(input.entries[0].values)).toContain("parent/legal guardian of the minor Ion Popescu");
  });
});

describe("§769 the backoffice and the emails name both", () => {
  it("lists a minor's declaration under the minor's name, the parent beside it, and an adult's as before", async () => {
    await approveTexts();
    const event = await trailRun();
    await signGroupRunDeclaration(db, await forMinor(event.id), NOW);
    await signGroupRunDeclaration(db, await adult(event.id, { typedName: "Maria Ionescu", email: "m@example.ro" }), NOW);
    const rows = await listGroupRunDeclarations(db, event.id);
    expect(rows.map((row) => [row.typedName, row.minorTypedName])).toEqual([
      ["Ana Popescu", "Ion Popescu"],
      ["Maria Ionescu", null],
    ]);
  });

  it("says in the signer's copy and in the archive copy that the minor and the parent signed", async () => {
    await approveTexts();
    const event = await trailRun();
    const [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    await updateClubNotices(db, admin, { declarations: { to: "arhiva@example.test", cc: [], bcc: [] }, confirmations: { to: [] }, participants: { bcc: [] } }, NOW);
    await signGroupRunDeclaration(db, await forMinor(event.id), NOW);
    const [signed] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "GROUP_RUN_DECLARATION_SIGNED"));
    const [archive] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "GROUP_RUN_DECLARATION_ARCHIVE"));
    const toParent = await renderOutboxMessage(claimed(signed), db, NOW);
    expect(toParent.to).toBe("ana@example.ro");
    expect(toParent.text).toContain("Declarația este a minorului Ion Popescu: a semnat-o minorul, pentru el, și tu, ca părinte sau tutore legal.");
    const toClub = await renderOutboxMessage(claimed(archive), db, NOW);
    expect(toClub.subject).toContain("Ana Popescu (pentru minorul Ion Popescu)");
    expect(toClub.text).toContain("a semnat-o minorul, pentru el, și Ana Popescu, ca părinte sau tutore legal.");
    // Both carry the PDF.
    for (const message of [toParent, toClub]) expect(message.attachments?.map((file) => file.contentType)).toEqual(["application/pdf"]);
  });
});
