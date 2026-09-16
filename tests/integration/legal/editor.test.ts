import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events } from "@/db/schema/events";
import { legalDocuments } from "@/db/schema/legal-documents";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { bodyToText, textToBody } from "@/modules/legal-documents/domain/body-text";
import {
  findCurrentApprovedDocument,
  findVersionWithTranslations,
} from "@/modules/legal-documents/repository";
import {
  approveVersion,
  createDraftVersion,
  updateDraftVersion,
} from "@/modules/legal-documents/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-053-02 — the club writes its own legal text, without a developer.
 *
 * The rule this must never break is the one `declaration_acceptances` depends on: a participant
 * signed a specific version, so that version's words can never change afterwards. Every test
 * below is about where the line falls — a draft may be rewritten freely, and the moment it is
 * approved or referenced it is history.
 */
const NOW = new Date("2026-09-06T12:00:00.000Z");

const translations = (suffix: string) => [
  {
    locale: "ro" as const,
    title: `Notă de confidențialitate ${suffix}`,
    body: textToBody(`## Cine suntem\n\nClubul ${suffix}.`),
  },
  {
    locale: "en" as const,
    title: `Privacy notice ${suffix}`,
    body: textToBody(`## Who we are\n\nThe club ${suffix}.`),
  },
];

describe("BR-REQ-053-02 legal document editing", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let editor: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db
      .insert(staffUsers)
      .values({ email: "superadmin@dev.test", displayName: "Admin", role: "SUPERADMIN" })
      .returning();
    [editor] = await db
      .insert(staffUsers)
      .values({ email: "moderator@dev.test", displayName: "Editor", role: "MODERATOR" })
      .returning();
  });

  it("creates the first version as an unapproved draft, numbered 1", async () => {
    const id = await createDraftVersion(db, admin, { key: "PRIVACY_NOTICE", translations: translations("v1") }, NOW);

    const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, id));
    expect(row.version).toBe(1);
    expect(row.isApproved).toBe(false);
    expect(row.createdByStaffUserId).toBe(admin.id);
    // Not live until approved, which is what keeps a half-written notice off the public page.
    expect(await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", "ro", NOW)).toBeUndefined();
  });

  it("numbers each new version after the highest, without anybody typing a number", async () => {
    await createDraftVersion(db, admin, { key: "PRIVACY_NOTICE", translations: translations("v1") }, NOW);
    const second = await createDraftVersion(db, admin, { key: "PRIVACY_NOTICE", translations: translations("v2") }, NOW);

    const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, second));
    expect(row.version).toBe(2);
  });

  it("rewrites a draft and recomputes its hash, so the two can never disagree", async () => {
    const id = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("first") }, NOW);
    const [before] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, id));

    await updateDraftVersion(db, admin, id, translations("second"), NOW);

    const [after] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, id));
    expect(after.contentSha256).not.toBe(before.contentSha256);

    const document = await findVersionWithTranslations(db, id);
    expect(document?.translations.find((t) => t.locale === "ro")?.title).toContain("second");
    // One row per locale, not two: a rewrite replaces the text rather than appending to it.
    expect(document?.translations).toHaveLength(2);
  });

  it("refuses to edit a version once it is approved", async () => {
    const id = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("v1") }, NOW);
    await approveVersion(db, admin, id, NOW);

    await expect(updateDraftVersion(db, admin, id, translations("edited"), NOW)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
  });

  it("refuses to edit a version a participant has accepted", async () => {
    const id = await createDraftVersion(db, admin, { key: "EVENT_DECLARATION", translations: translations("v1") }, NOW);

    const identity = canonicalizeEmail("ana@example.ro");
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: "Ana Pop",
      })
      .returning();
    const [event] = await db
      .insert(events)
      .values({ kind: "RACE", startsAt: new Date("2026-10-01T09:00:00.000Z"), registrationMode: "INTERNAL" })
      .returning();
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId: event.id,
        participantId: participant.id,
        status: "CONFIRMED",
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: "Ana P.",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
      })
      .returning();
    await db.insert(declarationAcceptances).values({
      registrationId: registration.id,
      legalDocumentId: id,
      declarationVersion: 1,
      contentSha256: "a".repeat(64),
      locale: "ro",
      typedName: "Ana Pop",
      acceptedAt: NOW,
    });

    // The whole reason the rule exists: her signature points at these words.
    await expect(updateDraftVersion(db, admin, id, translations("edited"), NOW)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
  });

  it("makes an approved version live, dated when it was approved", async () => {
    const id = await createDraftVersion(db, admin, { key: "PRIVACY_NOTICE", translations: translations("v1") }, NOW);
    const approvedAt = new Date(NOW.getTime() + 60 * 60_000);

    await approveVersion(db, admin, id, approvedAt);

    const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, id));
    expect(row.isApproved).toBe(true);
    expect(row.approvedByStaffUserId).toBe(admin.id);
    // In force from when somebody took responsibility, not from when it was typed.
    expect(row.effectiveAt).toEqual(approvedAt);

    const live = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", "ro", new Date(approvedAt.getTime() + 1000));
    expect(live?.title).toContain("v1");
  });

  it("refuses to approve the same version twice", async () => {
    const id = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("v1") }, NOW);
    await approveVersion(db, admin, id, NOW);

    await expect(approveVersion(db, admin, id, NOW)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
  });

  it("refuses a document that exists in only one language", async () => {
    await expect(
      createDraftVersion(db, admin, { key: "TERMS", translations: [translations("v1")[0]] }, NOW),
    ).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR");
  });

  it("refuses an empty body, which would render as a blank public page", async () => {
    await expect(
      createDraftVersion(
        db,
        admin,
        {
          key: "TERMS",
          translations: [
            { locale: "ro", title: "Termeni", body: textToBody("   ") },
            { locale: "en", title: "Terms", body: textToBody("   ") },
          ],
        },
        NOW,
      ),
    ).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR");
  });

  it("refuses any role below the one that administers staff", async () => {
    await expect(
      createDraftVersion(db, editor, { key: "TERMS", translations: translations("v1") }, NOW),
    ).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "FORBIDDEN");
  });
});

describe("the plain-text body format", () => {
  it("round-trips a document without changing it", () => {
    const text = "An opening sentence.\n\n## A heading\n\nOne paragraph.\n\nAnother paragraph.";
    expect(bodyToText(textToBody(text))).toBe(text);
  });

  it("keeps text written before the first heading", () => {
    const body = textToBody("Opening line.\n\n## Later\n\nMore.");
    expect(body.sections[0].heading).toBeUndefined();
    expect(body.sections[0].paragraphs).toEqual(["Opening line."]);
  });

  it("keeps a heading that has nothing under it yet", () => {
    // Half-written is the ordinary state of a draft; dropping the heading would delete work.
    const body = textToBody("## Just a heading");
    expect(body.sections).toEqual([{ heading: "Just a heading", paragraphs: [] }]);
  });

  it("treats a single newline as a line break inside one paragraph", () => {
    const body = textToBody("Strada Nicolae Labiș 1\nBrașov");
    expect(body.sections[0].paragraphs).toEqual(["Strada Nicolae Labiș 1\nBrașov"]);
  });
});
