import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { legalDocuments } from "@/db/schema/legal-documents";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { textToBody } from "@/modules/legal-documents/domain/body-text";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import {
  findCurrentApprovedDocument,
  insertLegalDocumentVersion,
  listApprovedVersions,
  listVersionsForBackoffice,
} from "@/modules/legal-documents/repository";
import {
  approveVersion,
  createDraftVersion,
  deleteDraftVersion,
  withdrawApprovedVersion,
} from "@/modules/legal-documents/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-053-02 — withdrawing an approved legal document version (`DECISIONS.md` §46, §53).
 *
 * The owner asked to be able to delete approved documents. An approved version is never
 * deleted, and the reason is arithmetic rather than ceremony: `registrations.privacy_notice_version`
 * is a plain integer with no foreign key and the next version is `max(version) + 1`, so a freed
 * number would be reissued to different words and every consent recorded against it would
 * silently become a consent to text written afterwards. Withdrawal keeps the row, the number
 * and the text, and removes only the offering.
 *
 * So most of these tests are about what withdrawal refuses, and the last one is about the
 * number — which is the whole reason this is not a delete.
 */
const NOW = new Date("2026-09-06T12:00:00.000Z");
const LATER = new Date("2026-09-07T09:30:00.000Z");

const translations = (suffix: string) => [
  { locale: "ro" as const, title: `Notă ${suffix}`, body: textToBody(`Clubul ${suffix}.`) },
  { locale: "en" as const, title: `Notice ${suffix}`, body: textToBody(`The club ${suffix}.`) },
];

describe("BR-REQ-053-02 legal document withdrawal", () => {
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

  /** Two approved versions of one key: the first is superseded, the second is in force. */
  async function twoApproved(key: "TERMS" | "PRIVACY_NOTICE" | "EVENT_DECLARATION" = "TERMS") {
    const first = await createDraftVersion(db, admin, { key, translations: translations("v1") }, NOW);
    await approveVersion(db, admin, first, NOW);
    const second = await createDraftVersion(db, admin, { key, translations: translations("v2") }, NOW);
    await approveVersion(db, admin, second, NOW);
    return { first, second };
  }

  it("withdraws an unused, superseded version: it leaves every list but not the table", async () => {
    const { first, second } = await twoApproved("EVENT_DECLARATION");

    await withdrawApprovedVersion(db, admin, first, LATER);

    // Gone from what the event editor offers — the selection §11.1 allows.
    const offered = await listApprovedVersions(db, "EVENT_DECLARATION", "ro");
    expect(offered.map((version) => version.id)).toEqual([second]);

    // And still here, with its words, which is the difference from a delete.
    const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, first));
    expect(row.isApproved).toBe(true);
    expect(row.withdrawnAt).toEqual(LATER);
    expect(row.withdrawnByStaffUserId).toBe(admin.id);
  });

  it("leaves an audit row carrying the key, the number and the hash of the text", async () => {
    const { first } = await twoApproved();
    const [before] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, first));

    await withdrawApprovedVersion(db, admin, first, LATER);

    const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, first));
    expect(entry.action).toBe("legal_document.withdrawn");
    expect(entry.entityType).toBe("legal_document");
    expect(entry.actorStaffUserId).toBe(admin.id);

    const metadata = entry.metadataJson as {
      documentKey: string;
      version: number;
      contentSha256: string;
      approvedByStaffUserId: string;
      translations: Array<{ locale: string; title: string; contentSha256: string }>;
    };
    expect(metadata.documentKey).toBe("TERMS");
    expect(metadata.version).toBe(1);
    expect(metadata.approvedByStaffUserId).toBe(admin.id);
    // The hash rather than the words (§12.12): the row can be checked against the text, never
    // read instead of it. This is the only place that still says the club published these.
    expect(metadata.contentSha256).toBe(before.contentSha256);
    expect(metadata.translations.map((translation) => translation.locale).sort()).toEqual([
      "en",
      "ro",
    ]);
    for (const translation of metadata.translations) {
      expect(translation.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("refuses the version currently in force, even with every count at zero", async () => {
    /*
      The refusal a count cannot express. Zero signatures is what a quiet week looks like, not
      an unused notice — and this is the text /legal/privacy is serving, so withdrawing it would
      also close registration (BR-REQ-053-01).
    */
    const { second } = await twoApproved("PRIVACY_NOTICE");

    const [row] = (await listVersionsForBackoffice(db)).filter((v) => v.id === second);
    expect(row.acceptanceCount).toBe(0);
    expect(row.eventCount).toBe(0);
    expect(row.privacyAcknowledgementCount).toBe(0);

    await expect(withdrawApprovedVersion(db, admin, second, LATER)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );

    // Still the public notice, and still no audit row for a change that did not happen.
    expect((await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", "ro", LATER))?.id).toBe(second);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("refuses a version an event has chosen", async () => {
    const { first } = await twoApproved("EVENT_DECLARATION");
    await db.insert(events).values({
      type: "GROUP_RUN",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      declarationDocumentId: first,
    });

    await expect(withdrawApprovedVersion(db, admin, first, LATER)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
  });

  it("refuses a notice somebody registered under, counted by version number", async () => {
    // `registrations.privacy_notice_version` has no foreign key, so this reliance is invisible
    // to the database. It is the reliance that matters most and the one nothing would catch.
    const { first } = await twoApproved("PRIVACY_NOTICE");

    const [event] = await db
      .insert(events)
      .values({
        type: "GROUP_RUN",
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
      // Version 1 — the superseded notice, the one this test tries to withdraw.
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      submittedAt: NOW,
    });

    await expect(withdrawApprovedVersion(db, admin, first, LATER)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
  });

  it("refuses a role that may not write legal text", async () => {
    const { first } = await twoApproved();

    await expect(withdrawApprovedVersion(db, editor, first, LATER)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "FORBIDDEN",
    );
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("refuses a draft, which is deleted rather than withdrawn", async () => {
    const draft = await createDraftVersion(
      db,
      admin,
      { key: "TERMS", translations: translations("v1") },
      NOW,
    );

    await expect(withdrawApprovedVersion(db, admin, draft, LATER)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
  });

  it("refuses a second withdrawal of the same version", async () => {
    const { first } = await twoApproved();
    await withdrawApprovedVersion(db, admin, first, LATER);

    await expect(withdrawApprovedVersion(db, admin, first, LATER)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
    // One withdrawal, one audit row.
    expect(await db.select().from(auditLogs)).toHaveLength(1);
  });

  it("reports a version that is not there rather than succeeding quietly", async () => {
    await expect(
      withdrawApprovedVersion(db, admin, "00000000-0000-0000-0000-000000000000", LATER),
    ).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "NOT_FOUND");
  });

  it("still refuses to delete a withdrawn version", async () => {
    // Withdrawal does not demote an approved version to a draft. §46 is untouched.
    const { first } = await twoApproved();
    await withdrawApprovedVersion(db, admin, first, LATER);

    await expect(deleteDraftVersion(db, admin, first)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, first))).toHaveLength(1);
  });

  it("keeps the withdrawn version's number taken, so the next one is max + 1", async () => {
    /*
      The whole reason this is not a delete. If withdrawing version 2 freed the number, the next
      draft would be version 2 again with different words — and every registration that recorded
      "privacy notice 2" would become a consent to text written afterwards, with no foreign key
      anywhere to notice.
    */
    const { second } = await twoApproved("PRIVACY_NOTICE");
    // v2 is in force, so approve a v3 first; then v2 is superseded and free to withdraw.
    const third = await createDraftVersion(
      db,
      admin,
      { key: "PRIVACY_NOTICE", translations: translations("v3") },
      NOW,
    );
    await approveVersion(db, admin, third, NOW);

    await withdrawApprovedVersion(db, admin, second, LATER);

    const next = await createDraftVersion(
      db,
      admin,
      { key: "PRIVACY_NOTICE", translations: translations("v4") },
      LATER,
    );
    const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, next));
    expect(row.version).toBe(4);
  });

  it("never changes which version is in force at the moment it happens", async () => {
    /*
      The property that keeps §53 intact. §53 refused *un-approving* because a declaration binds
      to the participant when the form is posted rather than when it is read, so moving the
      current version would let somebody sign text they never saw. Withdrawal cannot move it:
      the version in force is refused, and every other approved version is already superseded,
      so taking one away leaves the answer exactly where it was.
    */
    const { first, second } = await twoApproved();
    const third = await createDraftVersion(
      db,
      admin,
      { key: "TERMS", translations: translations("v3") },
      NOW,
    );
    await approveVersion(db, admin, third, NOW);
    expect((await findCurrentApprovedDocument(db, "TERMS", "ro", LATER))?.id).toBe(third);

    await withdrawApprovedVersion(db, admin, second, LATER);
    await withdrawApprovedVersion(db, admin, first, LATER);

    expect((await findCurrentApprovedDocument(db, "TERMS", "ro", LATER))?.id).toBe(third);

    // And the backoffice still sees all three, flagged rather than filtered — the one reader
    // that keeps them, so the club can find what it took out of circulation.
    const rows = (await listVersionsForBackoffice(db)).filter((row) => row.key === "TERMS");
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.id === second)?.withdrawnAt).toEqual(LATER);
    expect(rows.find((row) => row.id === third)?.withdrawnAt).toBeNull();
  });

  it("stops a version approved ahead of its date from ever taking effect", async () => {
    /*
      The case withdrawal is actually for: the club approved next season's terms, dated for
      October, and changed its mind in September. It is approved, it is not in force, and
      nothing relies on it — so it can go. Without the `withdrawn_at IS NULL` filter in
      `findCurrentApprovedDocument` it would quietly become the public text on its own date
      anyway, which is the failure this test exists to catch.
    */
    const october = new Date("2026-10-01T00:00:00.000Z");
    const current = await createDraftVersion(
      db,
      admin,
      { key: "TERMS", translations: translations("v1") },
      NOW,
    );
    await approveVersion(db, admin, current, NOW);

    // `approveVersion` always dates a version from the moment of approval, so a future one is
    // inserted directly — the same way `versions.test.ts` builds the effective-date cases.
    const future = await insertLegalDocumentVersion(db, {
      key: "TERMS",
      version: 2,
      effectiveAt: october,
      isApproved: true,
      contentSha256: computeContentHash(translations("v2")),
      translations: translations("v2"),
      approvedByStaffUserId: admin.id,
      now: NOW,
    });

    await withdrawApprovedVersion(db, admin, future, LATER);

    const afterOctober = new Date("2026-10-02T00:00:00.000Z");
    expect((await findCurrentApprovedDocument(db, "TERMS", "ro", afterOctober))?.id).toBe(current);
  });
});
