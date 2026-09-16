import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { legalDocuments, legalDocumentTranslations } from "@/db/schema/legal-documents";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { textToBody } from "@/modules/legal-documents/domain/body-text";
import { listVersionsForBackoffice } from "@/modules/legal-documents/repository";
import {
  approveVersion,
  createDraftVersion,
  deleteDraftVersion,
} from "@/modules/legal-documents/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-053-02 — deleting a legal document version (`DECISIONS.md` §53).
 *
 * The rule is narrow and the tests are mostly about the refusals, because those are what
 * protect a signature. A version that was ever approved is never deleted, whatever the counts
 * say; a draft nobody has relied on may go.
 */
const NOW = new Date("2026-09-06T12:00:00.000Z");

const translations = (suffix: string) => [
  { locale: "ro" as const, title: `Notă ${suffix}`, body: textToBody(`Clubul ${suffix}.`) },
  { locale: "en" as const, title: `Notice ${suffix}`, body: textToBody(`The club ${suffix}.`) },
];

describe("BR-REQ-053-02 legal document deletion", () => {
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

  it("deletes a draft nobody has relied on, and its text with it", async () => {
    const id = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("v1") }, NOW);

    await deleteDraftVersion(db, admin, id);

    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, id))).toHaveLength(0);
    // The body belongs to the version and has no meaning apart from it (`ON DELETE cascade`).
    expect(
      await db
        .select()
        .from(legalDocumentTranslations)
        .where(eq(legalDocumentTranslations.legalDocumentId, id)),
    ).toHaveLength(0);
  });

  it("refuses to delete an approved version, even when nothing references it", async () => {
    // The point of the rule: approval is the club publishing words as its own, and the record
    // of what it published outlives whether anybody happened to act on it. Reliance is a
    // separate test below.
    const id = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("v1") }, NOW);
    await approveVersion(db, admin, id, NOW);

    await expect(deleteDraftVersion(db, admin, id)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, id))).toHaveLength(1);
  });

  it("refuses a role that may not write legal text", async () => {
    const id = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("v1") }, NOW);

    await expect(deleteDraftVersion(db, editor, id)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "FORBIDDEN",
    );
  });

  it("reports a version that is not there rather than succeeding quietly", async () => {
    await expect(
      deleteDraftVersion(db, admin, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "NOT_FOUND");
  });

  it("refuses to delete a draft an event points at", async () => {
    // `events.declaration_document_id` accepts any version id, approved or not, so a draft can
    // be referenced. The count is what catches it — the foreign key would too, but as a raw
    // SQL error, which §14.3 forbids surfacing.
    const id = await createDraftVersion(
      db,
      admin,
      { key: "EVENT_DECLARATION", translations: translations("v1") },
      NOW,
    );
    await db.insert(events).values({
      kind: "COMMUNITY_RUN",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      declarationDocumentId: id,
    });

    await expect(deleteDraftVersion(db, admin, id)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
  });

  it("counts registrations that acknowledged a privacy notice by version number", async () => {
    /*
      The reliance the database cannot see. `registrations.privacy_notice_version` is a plain
      integer with no foreign key, so before this count a notice hundreds of people had
      acknowledged looked exactly like one nobody had ever touched.
    */
    const id = await createDraftVersion(
      db,
      admin,
      { key: "PRIVACY_NOTICE", translations: translations("v1") },
      NOW,
    );

    const [event] = await db
      .insert(events)
      .values({
        kind: "COMMUNITY_RUN",
        startsAt: new Date("2026-10-01T09:00:00.000Z"),
        registrationMode: "INTERNAL",
      })
      .returning();
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: "ana@example.test",
        normalizedEmail: "ana@example.test",
        canonicalEmail: "ana@example.test",
        canonicalizationVersion: 1,
        defaultName: "Ana",
      })
      .returning();
    await db.insert(registrations).values({
      eventId: event.id,
      participantId: participant.id,
      status: "CONFIRMED",
      locale: "ro",
      registeredName: "Ana",
      displayName: "Ana",
      // Version 1 — the same number as the version under test.
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      submittedAt: NOW,
    });

    const [row] = (await listVersionsForBackoffice(db)).filter((version) => version.id === id);
    expect(row.acceptanceCount).toBe(0);
    expect(row.eventCount).toBe(0);
    // The count that makes the other two honest.
    expect(row.privacyAcknowledgementCount).toBe(1);

    await expect(deleteDraftVersion(db, admin, id)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
  });

  it("does not attribute a registration's acknowledgement to a version of another key", async () => {
    // The count is matched on a version *number*, so it must be scoped to PRIVACY_NOTICE or
    // every TERMS and EVENT_DECLARATION version sharing that number would look relied upon.
    const terms = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("v1") }, NOW);

    const [event] = await db
      .insert(events)
      .values({
        kind: "COMMUNITY_RUN",
        startsAt: new Date("2026-10-01T09:00:00.000Z"),
        registrationMode: "INTERNAL",
      })
      .returning();
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: "mihai@example.test",
        normalizedEmail: "mihai@example.test",
        canonicalEmail: "mihai@example.test",
        canonicalizationVersion: 1,
        defaultName: "Mihai",
      })
      .returning();
    await db.insert(registrations).values({
      eventId: event.id,
      participantId: participant.id,
      status: "CONFIRMED",
      locale: "ro",
      registeredName: "Mihai",
      displayName: "Mihai",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      submittedAt: NOW,
    });

    const [row] = (await listVersionsForBackoffice(db)).filter((version) => version.id === terms);
    expect(row.privacyAcknowledgementCount).toBe(0);

    // So the TERMS draft is still deletable, which is the whole point of scoping the count.
    await expect(deleteDraftVersion(db, admin, terms)).resolves.toBeUndefined();
  });

  it("frees the version number, so the next draft reuses it", async () => {
    // `UNIQUE(key, version)` is what makes this safe: the number was never approved, never
    // public, and never recorded anywhere, so nothing can be pointing at the old meaning of it.
    const first = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("v1") }, NOW);
    await deleteDraftVersion(db, admin, first);

    const second = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("v2") }, NOW);
    const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, second));
    expect(row.version).toBe(1);
  });

  it("leaves an approved predecessor alone when a later draft is deleted", async () => {
    const approved = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("v1") }, NOW);
    await approveVersion(db, admin, approved, NOW);
    const draft = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("v2") }, NOW);

    await deleteDraftVersion(db, admin, draft);

    const remaining = await db.select().from(legalDocuments).where(eq(legalDocuments.key, "TERMS"));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(approved);
    expect(remaining[0].isApproved).toBe(true);
  });
});

describe("approving reports what it actually did", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;

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
  });

  it("refuses to approve a version that is no longer there", async () => {
    /*
      Until drafts could be deleted this could not happen, so `approveVersion` ignored its row
      count. Now a draft removed in another tab would leave the update matching nothing and the
      screen reporting "approved" about a row that does not exist.
    */
    const id = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("v1") }, NOW);
    await deleteDraftVersion(db, admin, id);

    await expect(approveVersion(db, admin, id, NOW)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "NOT_FOUND",
    );
  });

  it("refuses to approve a version that is already approved", async () => {
    const id = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("v1") }, NOW);
    await approveVersion(db, admin, id, NOW);

    await expect(approveVersion(db, admin, id, NOW)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
  });
});
