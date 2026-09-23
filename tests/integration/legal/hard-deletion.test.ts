import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events } from "@/db/schema/events";
import {
  legalDocumentNumbering,
  legalDocumentTranslations,
  legalDocuments,
} from "@/db/schema/legal-documents";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { textToBody } from "@/modules/legal-documents/domain/body-text";
import { confirmationPhrase } from "@/modules/legal-documents/domain/confirmation";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import { deletionObstacle } from "@/modules/legal-documents/domain/deletability";
import {
  findCurrentApprovedDocument,
  insertLegalDocumentVersion,
  listVersionsForBackoffice,
} from "@/modules/legal-documents/repository";
import {
  approveVersion,
  createDraftVersion,
  deleteApprovedVersion,
  deleteDraftVersion,
  readDeletionFacts,
  withdrawApprovedVersion,
} from "@/modules/legal-documents/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-053-02 — deleting an approved legal document version outright (`DECISIONS.md` §151).
 *
 * The owner, looking at five approved versions he made while testing: "am zis ca vreau sa fac
 * curatenie in documente si sa le pot sterge". Withdrawal keeps the rows for ever, which is not
 * what he asked for; deletion used to be refused because of an arithmetic hazard rather than a
 * principle — `registrations.privacy_notice_version` is a plain integer with no foreign key and
 * the next version was `max(version) + 1`, so a freed number would be reissued to different
 * words and every consent recorded against it would silently become a consent to text nobody
 * was shown.
 *
 * So these tests come in two halves. The refusals — nothing that anybody relied on, and not the
 * text in force, ever goes — and **the number**, which is the hazard, and which is the thing
 * that had to be removed rather than accepted.
 */
const NOW = new Date("2026-09-06T12:00:00.000Z");
const LATER = new Date("2026-09-07T09:30:00.000Z");

const translations = (suffix: string) => [
  { locale: "ro" as const, title: `Notă ${suffix}`, body: textToBody(`Clubul ${suffix}.`) },
  { locale: "en" as const, title: `Notice ${suffix}`, body: textToBody(`The club ${suffix}.`) },
];

describe("BR-REQ-053-02 deleting an approved legal version", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let superadmin: StaffUser;
  let administrator: StaffUser;
  let editor: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [superadmin] = await db
      .insert(staffUsers)
      .values({ email: "superadmin@dev.test", displayName: "Admin", role: "SUPERADMIN" })
      .returning();
    [administrator] = await db
      .insert(staffUsers)
      .values({ email: "admin@dev.test", displayName: "Administrator", role: "ADMIN" })
      .returning();
    [editor] = await db
      .insert(staffUsers)
      .values({ email: "moderator@dev.test", displayName: "Editor", role: "ADMIN" })
      .returning();
  });

  /** Two approved versions of one key: the first is superseded, the second is in force. */
  /*
    The default key is the privacy notice since §203: TERMS is the one key a registration
    records nothing about, and whether one of its versions may go depends on the registrations
    submitted while it was in force (§316) — its own cases are at the bottom, with dates.
  */
  async function twoApproved(key: "TERMS" | "PRIVACY_NOTICE" | "EVENT_DECLARATION" = "PRIVACY_NOTICE") {
    const first = await createDraftVersion(db, superadmin, { key, translations: translations("v1") }, NOW);
    await approveVersion(db, superadmin, first, NOW);
    const second = await createDraftVersion(db, superadmin, { key, translations: translations("v2") }, NOW);
    await approveVersion(db, superadmin, second, NOW);
    return { first, second };
  }

  /** One registration against an event, for the two reliances that are not a foreign key. */
  async function registrationAcknowledging(privacyNoticeVersion: number) {
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
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId: event.id,
        participantId: participant.id,
        status: "CONFIRMED",
        locale: "ro",
        registeredName: "Ana",
        displayName: "Ana",
        privacyNoticeVersion,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        resultsConsentVersion: privacyNoticeVersion,
        submittedAt: NOW,
      })
      .returning();
    return { event, registration };
  }

  const erase = (versionId: string, phrase: string, reason = "curățenie în documentele de test") =>
    deleteApprovedVersion(db, superadmin, {
      versionId,
      typedConfirmation: phrase,
      reason,
      now: LATER,
    });

  it("deletes a superseded version nothing depends on, and its text with it", async () => {
    const { first, second } = await twoApproved("PRIVACY_NOTICE");

    const result = await erase(first, "GDPR 1");
    expect(result).toEqual({ key: "PRIVACY_NOTICE", version: 1 });

    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, first))).toHaveLength(0);
    // Both bodies go with it (`ON DELETE cascade`): a text means nothing apart from its version.
    expect(
      await db
        .select()
        .from(legalDocumentTranslations)
        .where(eq(legalDocumentTranslations.legalDocumentId, first)),
    ).toHaveLength(0);

    // And the one still in force is untouched, which is the whole point of the guard.
    expect((await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", "ro", LATER))?.id).toBe(second);
  });

  it("leaves one audit row carrying the key, the number, the date, the approver and the hashes", async () => {
    const { first } = await twoApproved("PRIVACY_NOTICE");
    const [before] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, first));

    await erase(first, "GDPR 1", "versiune făcută din greșeală la testare");

    const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, first));
    expect(entry.action).toBe("legal_document.deleted");
    expect(entry.entityType).toBe("legal_document");
    expect(entry.actorStaffUserId).toBe(superadmin.id);

    const metadata = entry.metadataJson as {
      documentKey: string;
      version: number;
      effectiveAt: string;
      approvedByStaffUserId: string;
      contentSha256: string;
      reason: string;
      versionNumberRetired: boolean;
      translations: Array<{ locale: string; title: string; contentSha256: string }>;
    };
    expect(metadata.documentKey).toBe("PRIVACY_NOTICE");
    expect(metadata.version).toBe(1);
    expect(metadata.effectiveAt).toBe(before.effectiveAt.toISOString());
    expect(metadata.approvedByStaffUserId).toBe(superadmin.id);
    expect(metadata.reason).toBe("versiune făcută din greșeală la testare");
    expect(metadata.versionNumberRetired).toBe(true);
    // The hash rather than the words (§12.12). After the row is gone this is the only record
    // the club ever published them, and it can be checked against a copy rather than read.
    expect(metadata.contentSha256).toBe(before.contentSha256);
    expect(metadata.translations.map((translation) => translation.locale).sort()).toEqual(["en", "ro"]);
    for (const translation of metadata.translations) {
      expect(translation.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // Not the text. The body would be the one thing §12.12 forbids copying here.
    expect(JSON.stringify(metadata)).not.toContain("Clubul v1.");
  });

  it("retires the number of the highest version, so the next draft gets the next one", async () => {
    /*
      The hazard, removed rather than accepted. Version 2 is the newest; delete it and
      `max(version) + 1` alone would hand the number 2 to the next draft, with different words —
      and every registration that recorded "privacy notice 2" would become a consent to text
      written afterwards, with no foreign key anywhere to notice.
    */
    await twoApproved("PRIVACY_NOTICE");
    /*
      A third version, approved ahead of its date — next season's notice, dated for October —
      which is the case where the *highest* number is not the one in force and can therefore be
      removed at all. `approveVersion` always dates a version from the moment of approval, so it
      is inserted directly, the way `withdrawal.test.ts` builds its effective-date cases.
    */
    const third = await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 3,
      effectiveAt: new Date("2026-10-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations("v3")),
      translations: translations("v3"),
      approvedByStaffUserId: superadmin.id,
      now: NOW,
    });

    await erase(third, "GDPR 3");

    // Without the floor the next draft would be version 3 again — `max(version)` over what is
    // left is 2 — and every registration that recorded "privacy notice 3" would be pointing at
    // words written afterwards.
    const next = await createDraftVersion(
      db,
      superadmin,
      { key: "PRIVACY_NOTICE", translations: translations("v4") },
      LATER,
    );
    const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, next));
    expect(row.version).toBe(4);

    // And the floor says so, once, for the key — not one row per destroyed version.
    const floors = await db.select().from(legalDocumentNumbering);
    expect(floors).toHaveLength(1);
    expect(floors[0].key).toBe("PRIVACY_NOTICE");
    expect(floors[0].highestRetiredVersion).toBe(3);
  });

  it("leaves numbering alone when a middle version is deleted", async () => {
    // v1, v2, v3 approved; v2 removed. The surviving maximum is still 3, so the next draft is 4
    // — the floor is not allowed to *lower* anything either.
    const { first, second } = await twoApproved("PRIVACY_NOTICE");
    const third = await createDraftVersion(db, superadmin, { key: "PRIVACY_NOTICE", translations: translations("v3") }, NOW);
    await approveVersion(db, superadmin, third, NOW);

    await erase(second, "GDPR 2");

    const next = await createDraftVersion(db, superadmin, { key: "PRIVACY_NOTICE", translations: translations("v4") }, LATER);
    const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, next));
    expect(row.version).toBe(4);

    const survivors = await db.select().from(legalDocuments).where(eq(legalDocuments.key, "PRIVACY_NOTICE"));
    expect(survivors.map((version) => version.version).sort()).toEqual([1, 3, 4]);
    expect(survivors.some((version) => version.id === first)).toBe(true);
  });

  it("does not retire a number across documents", async () => {
    // The floor is per key. Deleting DECLARATION 1 must not make the next GDPR draft skip a
    // number. (The declaration rather than the terms since §203: a terms version's deletion
    // turns on registrations submitted in its window, which this test is not about.)
    const { first } = await twoApproved("EVENT_DECLARATION");
    await erase(first, "DECLARATION 1");

    const notice = await createDraftVersion(
      db,
      superadmin,
      { key: "PRIVACY_NOTICE", translations: translations("v1") },
      LATER,
    );
    const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, notice));
    expect(row.version).toBe(1);
  });

  it("refuses a version a participant signed, and destroys nothing", async () => {
    const { first } = await twoApproved("EVENT_DECLARATION");
    const { registration } = await registrationAcknowledging(1);
    await db.insert(declarationAcceptances).values({
      registrationId: registration.id,
      legalDocumentId: first,
      declarationVersion: 1,
      contentSha256: "a".repeat(64),
      locale: "ro",
      typedName: "Ana Pop",
      acceptedAt: NOW,
    });

    await expect(erase(first, "DECLARATION 1")).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, first))).toHaveLength(1);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
    expect(await db.select().from(legalDocumentNumbering)).toHaveLength(0);
  });

  it("refuses a version an event has chosen", async () => {
    const { first } = await twoApproved("EVENT_DECLARATION");
    await db.insert(events).values({
      type: "GROUP_RUN",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      declarationDocumentId: first,
    });

    await expect(erase(first, "DECLARATION 1")).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, first))).toHaveLength(1);
  });

  it("refuses a notice somebody registered under, counted by version number alone", async () => {
    // The reliance the database cannot see: `privacy_notice_version` is an integer with no
    // foreign key, so nothing but this count stands between the row and the delete.
    const { first } = await twoApproved("PRIVACY_NOTICE");
    await registrationAcknowledging(1);

    await expect(erase(first, "GDPR 1")).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, first))).toHaveLength(1);
  });

  it("refuses the version currently in force, even with every count at zero", async () => {
    // Zero signatures is what a quiet week looks like, not an unused notice — and this is the
    // text /legal/privacy is serving, so removing it would also close registration.
    const { second } = await twoApproved("PRIVACY_NOTICE");

    await expect(erase(second, "GDPR 2")).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
    expect((await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", "ro", LATER))?.id).toBe(second);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("refuses a draft and points at the verb that applies, which still works", async () => {
    /*
      Aimed at a draft, this refuses rather than quietly doing the draft's delete. The two are
      not the same act: a draft needs no typed confirmation, because nothing could ever have
      relied on it, and it must not retire its number — a draft's number never left the
      backoffice, so freeing it costs nobody anything.
    */
    const draft = await createDraftVersion(db, superadmin, { key: "TERMS", translations: translations("v1") }, NOW);

    await expect(erase(draft, "GDPR 1")).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "CONFLICT",
    );
    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, draft))).toHaveLength(1);

    await deleteDraftVersion(db, superadmin, draft);
    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, draft))).toHaveLength(0);
    // No number retired, so the next draft is version 1 again.
    expect(await db.select().from(legalDocumentNumbering)).toHaveLength(0);
    const again = await createDraftVersion(db, superadmin, { key: "TERMS", translations: translations("v1") }, LATER);
    const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, again));
    expect(row.version).toBe(1);
  });

  it("destroys nothing when the typed confirmation is wrong", async () => {
    const { first } = await twoApproved("PRIVACY_NOTICE");

    for (const typed of ["", "GDPR", "GDPR 2", "TERMS 1", "Notă v1", "1"]) {
      await expect(erase(first, typed)).rejects.toSatisfy(
        (error: unknown) =>
          isDomainError(error) &&
          error.code === "VALIDATION_ERROR" &&
          error.fields.includes("typedConfirmation"),
      );
    }

    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, first))).toHaveLength(1);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
    expect(await db.select().from(legalDocumentNumbering)).toHaveLength(0);
  });

  it("accepts the phrase in either case, with stray spacing", async () => {
    // A code printed on the screen being read, not a title somebody half-remembers: folding
    // case cannot make this match a *different* version, and refusing "gdpr 1" would only teach
    // the club that the screen is broken.
    const { first } = await twoApproved("PRIVACY_NOTICE");

    await expect(erase(first, "  gdpr   1 ")).resolves.toEqual({ key: "PRIVACY_NOTICE", version: 1 });
  });

  it("refuses without a reason, which is the only thing that survives", async () => {
    const { first } = await twoApproved("PRIVACY_NOTICE");

    await expect(erase(first, "GDPR 1", "  ")).rejects.toSatisfy(
      (error: unknown) =>
        isDomainError(error) && error.code === "VALIDATION_ERROR" && error.fields.includes("reason"),
    );
    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, first))).toHaveLength(1);
  });

  it("refuses every role below the one that may write the club's legal text", async () => {
    /*
      Superadministrator, the same gate as `createDraftVersion`, and an Administrator is refused
      — which is the interesting boundary, because an Administrator may erase a registration and
      an entire event with everyone on it. Those are participant data, where the hierarchy's
      line is ADMIN. This is the club's own published word, and the role that publishes it is
      the role that unpublishes it.
    */
    const { first } = await twoApproved("PRIVACY_NOTICE");

    for (const actor of [administrator, editor]) {
      await expect(
        deleteApprovedVersion(db, actor, {
          versionId: first,
          typedConfirmation: "GDPR 1",
          reason: "curățenie",
          now: LATER,
        }),
      ).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "FORBIDDEN");
    }

    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, first))).toHaveLength(1);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("deletes a version that was withdrawn first, which is the row the fold is full of", async () => {
    // The judgement call: a withdrawn version has no dependants by construction — withdrawal
    // refused it otherwise — and it is by definition not in force. It is the natural second
    // step, and it is what stops the withdrawn fold being a pile rows go to stay in for ever.
    const { first } = await twoApproved("PRIVACY_NOTICE");
    await withdrawApprovedVersion(db, superadmin, first, LATER);

    await erase(first, "GDPR 1");

    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, first))).toHaveLength(0);
    // One withdrawal row, one deletion row: both acts are on the record, in order.
    const entries = await db.select().from(auditLogs).where(eq(auditLogs.entityId, first));
    expect(entries.map((entry) => entry.action).sort()).toEqual([
      "legal_document.deleted",
      "legal_document.withdrawn",
    ]);
  });

  it("reports a version that is not there rather than succeeding quietly", async () => {
    await expect(erase("00000000-0000-0000-0000-000000000000", "GDPR 1")).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "NOT_FOUND",
    );

    // And a second deletion of the same row says the same thing.
    const { first } = await twoApproved("PRIVACY_NOTICE");
    await erase(first, "GDPR 1");
    await expect(erase(first, "GDPR 1")).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "NOT_FOUND",
    );
  });

  /*
    §316 — a terms version is deletable when nobody submitted a registration, or signed a
    declaration, while it was in force.

    §203 found the three dependant counts vacuous for TERMS — a registration records
    `privacy_notice_version`, `results_consent_version` and `health_consent_version`, never a terms
    version — and refused every terms version that had ever been in force. The owner met that
    three times on two versions nobody had registered under ("Still can't delete these docs...").
    The evidence was there: the terms are accepted at the instant the form is submitted, and again
    when the declaration ("sunt de acord cu termenii...") is signed, so a version with neither
    inside its window was accepted by nobody.

    The history below is the owner's, compressed: version 1 in force from the 4th, version 2 from
    the 6th at ten, the deletion attempted on the 7th while version 2 is in force.
  */
  const TERMS_V1_AT = new Date("2026-09-04T08:00:00.000Z");
  const TERMS_V2_AT = new Date("2026-09-06T10:00:00.000Z");
  const IN_V1_WINDOW = new Date("2026-09-05T15:00:00.000Z");
  const BEFORE_V1 = new Date("2026-09-03T15:00:00.000Z");
  const UNDER_V2 = new Date("2026-09-06T11:00:00.000Z");

  async function termsHistory() {
    const first = await createDraftVersion(db, superadmin, { key: "TERMS", translations: translations("v1") }, TERMS_V1_AT);
    await approveVersion(db, superadmin, first, TERMS_V1_AT);
    const second = await createDraftVersion(db, superadmin, { key: "TERMS", translations: translations("v2") }, TERMS_V2_AT);
    await approveVersion(db, superadmin, second, TERMS_V2_AT);
    return { first, second };
  }

  let submitted = 0;
  /** A registration first submitted at `createdAt` and last (re)submitted at `acknowledgedAt`. */
  async function registrationSubmitted(input: {
    createdAt: Date;
    acknowledgedAt?: Date;
    kind?: "REAL" | "TEST";
    source?: "PUBLIC" | "STAFF";
    privacyNoticeVersion?: number;
  }) {
    submitted += 1;
    const email = `runner${submitted}@example.test`;
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-01T09:00:00.000Z"), registrationMode: "INTERNAL" })
      .returning();
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: email,
        normalizedEmail: email,
        canonicalEmail: email,
        canonicalizationVersion: 1,
        defaultName: "Ana",
      })
      .returning();
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId: event.id,
        participantId: participant.id,
        status: "CONFIRMED",
        locale: "ro",
        registeredName: "Ana",
        displayName: "Ana",
        kind: input.kind ?? "REAL",
        source: input.source ?? "PUBLIC",
        // A notice number no version here carries, unless a case asks for one: the acknowledgement
        // count stays at zero, and for the terms only the window can refuse.
        privacyNoticeVersion: input.privacyNoticeVersion ?? 99,
        privacyAcknowledgedAt: input.acknowledgedAt ?? input.createdAt,
        resultsNameConsent: false,
        resultsConsentVersion: input.privacyNoticeVersion ?? 99,
        submittedAt: input.createdAt,
        createdAt: input.createdAt,
      })
      .returning({ id: registrations.id });
    return registration.id;
  }

  /**
   * The registration's declaration, signed at `acceptedAt` — "Sunt de acord cu termenii,
   * condițiile și regulamentul evenimentului", the second instant the terms are agreed to.
   */
  async function declarationSigned(registrationId: string, acceptedAt: Date) {
    const declaration = await createDraftVersion(
      db,
      superadmin,
      { key: "EVENT_DECLARATION", translations: translations("d1") },
      BEFORE_V1,
    );
    await approveVersion(db, superadmin, declaration, BEFORE_V1);
    await db.insert(declarationAcceptances).values({
      registrationId,
      legalDocumentId: declaration,
      declarationVersion: 1,
      contentSha256: "a".repeat(64),
      locale: "ro",
      typedName: "Ana",
      acceptedAt,
    });
  }

  const refusedAsTermsAccepted = (count: number) => (error: unknown) =>
    isDomainError(error) &&
    error.code === "CONFLICT" &&
    error.fields.includes("termsAccepted") &&
    error.message.startsWith(
      `${count} registration(s) were submitted, or had their declaration signed, while this terms version was in force`,
    ) &&
    error.message.includes(TERMS_V1_AT.toISOString()) &&
    error.message.includes(TERMS_V2_AT.toISOString());

  it("deletes a withdrawn terms version nobody submitted a registration under — the owner's row", async () => {
    const { first } = await termsHistory();
    // Registrations exist, just not in version 1's window: one before any terms were in force,
    // and one under version 2.
    await registrationSubmitted({ createdAt: BEFORE_V1 });
    await registrationSubmitted({ createdAt: UNDER_V2 });
    await withdrawApprovedVersion(db, superadmin, first, LATER);

    await expect(erase(first, "TERMS 1")).resolves.toEqual({ key: "TERMS", version: 1 });
    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, first))).toHaveLength(0);
    // The rest of deletion is unchanged: the number is retired and the audit row keeps the hash.
    expect((await db.select().from(legalDocumentNumbering))[0]).toMatchObject({ key: "TERMS", highestRetiredVersion: 1 });
    const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.action, "legal_document.deleted"));
    expect((entry.metadataJson as { contentSha256: string }).contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a terms version with a registration submitted in its window, naming the count and the window", async () => {
    const { first } = await termsHistory();
    await registrationSubmitted({ createdAt: IN_V1_WINDOW });

    await expect(erase(first, "TERMS 1")).rejects.toSatisfy(refusedAsTermsAccepted(1));
    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, first))).toHaveLength(1);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
    expect(await db.select().from(legalDocumentNumbering)).toHaveLength(0);
  });

  it("refuses one whose window a restart fell in, though the row was first submitted before it", async () => {
    // A cancelled registration re-submitted on the 5th re-accepted the texts in force on the 5th:
    // `privacy_acknowledged_at` is rewritten on every submission.
    const { first } = await termsHistory();
    await registrationSubmitted({ createdAt: BEFORE_V1, acknowledgedAt: IN_V1_WINDOW });

    await expect(erase(first, "TERMS 1")).rejects.toSatisfy(refusedAsTermsAccepted(1));
  });

  it("refuses one a registration straddles, because a restart in between would have been overwritten", async () => {
    // First submitted before version 1, last re-submitted under version 2. Whether it was also
    // re-submitted on the 5th cannot be known — the column holds only the latest — so it counts.
    const { first } = await termsHistory();
    await registrationSubmitted({ createdAt: BEFORE_V1, acknowledgedAt: UNDER_V2 });

    await expect(erase(first, "TERMS 1")).rejects.toSatisfy(refusedAsTermsAccepted(1));
  });

  it("refuses one under which a declaration was signed, though the form was submitted before it", async () => {
    /*
      Registered on the 3rd, before any terms were in force; the declaration — "sunt de acord cu
      termenii, condițiile și regulamentul evenimentului" — signed on the 5th, under version 1.
      That is the usual shape since the participation window (§104): the declaration is asked
      days after the form. Whoever signed on the 5th agreed to "the terms" as they then stood.
    */
    const { first } = await termsHistory();
    const registration = await registrationSubmitted({ createdAt: BEFORE_V1 });
    await declarationSigned(registration, IN_V1_WINDOW);
    await withdrawApprovedVersion(db, superadmin, first, LATER);

    await expect(erase(first, "TERMS 1")).rejects.toSatisfy(refusedAsTermsAccepted(1));
    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, first))).toHaveLength(1);
    expect(await db.select().from(legalDocumentNumbering)).toHaveLength(0);
  });

  it("counts a registration once when both its form and its declaration fall in the window", async () => {
    const { first } = await termsHistory();
    const registration = await registrationSubmitted({ createdAt: IN_V1_WINDOW });
    await declarationSigned(registration, IN_V1_WINDOW);

    await expect(erase(first, "TERMS 1")).rejects.toSatisfy(refusedAsTermsAccepted(1));
  });

  it("deletes one whose only signature fell under a later version", async () => {
    // Registered before version 1, signed under version 2: neither instant is version 1's.
    const { first } = await termsHistory();
    const registration = await registrationSubmitted({ createdAt: BEFORE_V1 });
    await declarationSigned(registration, UNDER_V2);

    await expect(erase(first, "TERMS 1")).resolves.toEqual({ key: "TERMS", version: 1 });
  });

  it("counts a test registration and a staff-entered one too", async () => {
    // On QA a test registration ticked the same box, and a staff-entered one was entered under
    // the terms in force. Leaving either out would be the one way to be wrong.
    const { first } = await termsHistory();
    await registrationSubmitted({ createdAt: IN_V1_WINDOW, kind: "TEST" });
    await registrationSubmitted({ createdAt: IN_V1_WINDOW, source: "STAFF" });

    await expect(erase(first, "TERMS 1")).rejects.toSatisfy(refusedAsTermsAccepted(2));
  });

  it("refuses the terms version in force, before counting anything", async () => {
    const { second } = await termsHistory();

    await expect(erase(second, "TERMS 2")).rejects.toSatisfy(
      (error: unknown) =>
        isDomainError(error) && error.code === "CONFLICT" && !error.fields.includes("termsAccepted"),
    );
    expect(await db.select().from(legalDocuments).where(eq(legalDocuments.id, second))).toHaveLength(1);
  });

  it("deletes a terms version approved ahead of its date and superseded before it took effect", async () => {
    /*
      Next season's terms dated for October, then a correction approved on the 7th. On 1 October
      the higher number wins, so version 2 was never the text in force — and the registration
      submitted on 2 October accepted version 3. §203's rule looked at the date alone and refused
      this row; the window does not.
    */
    await termsHistory();
    const ahead = await insertLegalDocumentVersion(db, {
      key: "TERMS",
      version: 3,
      effectiveAt: new Date("2026-10-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations("v3")),
      translations: translations("v3"),
      approvedByStaffUserId: superadmin.id,
      now: NOW,
    });
    const correction = await createDraftVersion(db, superadmin, { key: "TERMS", translations: translations("v4") }, LATER);
    await approveVersion(db, superadmin, correction, LATER);
    await registrationSubmitted({ createdAt: new Date("2026-10-02T09:00:00.000Z") });

    await expect(
      deleteApprovedVersion(db, superadmin, {
        versionId: ahead,
        typedConfirmation: "TERMS 3",
        reason: "înlocuită înainte să intre în vigoare",
        now: new Date("2026-10-05T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ key: "TERMS", version: 3 });
  });

  /*
    §290 and §316 — one rule, every caller.

    The list offered "Șterge definitiv" on rows the service refused, because it carried its own
    copy of the obstacles. It now renders `deletionObstacle` over `readDeletionFacts`, the same two
    calls `assertDeletable` makes; this asserts that what those two say is what the service then
    does, row by row, across both keys and every kind of obstacle. The list asks for every row in
    one call and the service for its one row, so the two askings are compared as well.
  */
  it("gives the list the service's own verdict: a row offers deletion exactly when deletion succeeds", async () => {
    const NOON = new Date("2026-09-06T12:00:00.000Z");
    const { first, second } = await termsHistory();
    // A third terms version at noon, so version 2 is superseded with nobody in its two hours.
    const third = await createDraftVersion(db, superadmin, { key: "TERMS", translations: translations("v3") }, NOON);
    await approveVersion(db, superadmin, third, NOON);
    // Three notices on the same days: the first acknowledged, the second superseded unused.
    const notices: string[] = [];
    for (const [suffix, at] of [["n1", TERMS_V1_AT], ["n2", TERMS_V2_AT], ["n3", NOON]] as const) {
      const id = await createDraftVersion(db, superadmin, { key: "PRIVACY_NOTICE", translations: translations(suffix) }, at);
      await approveVersion(db, superadmin, id, at);
      notices.push(id);
    }
    // One registration under terms 1, and one under terms 3 that recorded notice 1.
    await registrationSubmitted({ createdAt: IN_V1_WINDOW });
    await registrationSubmitted({ createdAt: new Date("2026-09-07T08:00:00.000Z"), privacyNoticeVersion: 1 });

    const verdicts: Record<string, string | null> = {};
    for (const id of [first, second, third, ...notices]) {
      // Read fresh each time, as the list does when it renders after the previous deletion.
      const versions = await listVersionsForBackoffice(db);
      const index = versions.findIndex((candidate) => candidate.id === id);
      const row = versions[index];
      if (!row) throw new Error("the version under test is missing");
      const [facts] = await readDeletionFacts(db, [row], versions, LATER);
      // The list's asking — every row at once — says the same about this one.
      expect((await readDeletionFacts(db, versions, versions, LATER))[index]).toEqual(facts);
      const obstacle = deletionObstacle(facts);
      verdicts[`${row.key} ${row.version}`] = obstacle?.kind ?? null;

      const outcome = await erase(id, confirmationPhrase(row.key, row.version)).then(
        () => "deleted",
        (error: unknown) => (isDomainError(error) ? error.code : "thrown"),
      );
      expect(outcome, `${row.key} ${row.version}`).toBe(obstacle ? "CONFLICT" : "deleted");
    }

    // And the verdicts are the ones the owner should see: the accepted terms version refused, the
    // unaccepted one offered, the acknowledged notice refused, the unused notice offered, and the
    // two in force refused.
    expect(verdicts).toEqual({
      "TERMS 1": "termsAccepted",
      "TERMS 2": null,
      "TERMS 3": "inForce",
      "PRIVACY_NOTICE 1": "referenced",
      "PRIVACY_NOTICE 2": null,
      "PRIVACY_NOTICE 3": "inForce",
    });
  });

  it("both screens ask the shared rule, and neither keeps a copy of it", () => {
    // Source-level, like `theme/wordmark.test.ts`: the pages need a request and a database to
    // render, and the rule is about which functions they call.
    const read = (relative: string) => readFileSync(path.join(process.cwd(), "src", relative), "utf8");
    for (const page of ["app/[locale]/admin/legal/(list)/page.tsx", "app/[locale]/admin/legal/[id]/delete/page.tsx"]) {
      const source = read(page);
      expect(source, page).toContain("readDeletionFacts(");
      expect(source, page).toContain("deletionObstacle(");
      expect(source, page).not.toContain("findCurrentApprovedVersionId");
      expect(source, page).not.toContain("termsHasBeenInForce");
    }
  });

  it("never moves which version is in force", async () => {
    /*
      §53 refused *un-approving* because a declaration binds when the form is posted rather than
      when it is read, so moving the current version would let somebody sign text they never
      saw. Deleting cannot move it: the version in force is refused, and every other approved
      version is already superseded.
    */
    const { first, second } = await twoApproved("PRIVACY_NOTICE");
    const third = await createDraftVersion(db, superadmin, { key: "PRIVACY_NOTICE", translations: translations("v3") }, NOW);
    await approveVersion(db, superadmin, third, NOW);
    expect((await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", "ro", LATER))?.id).toBe(third);

    await erase(second, "GDPR 2");
    await erase(first, "GDPR 1");

    expect((await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", "ro", LATER))?.id).toBe(third);
  });
});
