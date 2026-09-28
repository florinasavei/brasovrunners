import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { legalDocumentNumbering, legalDocuments } from "@/db/schema/legal-documents";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { textToBody } from "@/modules/legal-documents/domain/body-text";
import { LEGAL_DOCUMENT_KEYS } from "@/modules/legal-documents/domain/keys";
import { findCurrentApprovedDocument, listVersionsForBackoffice } from "@/modules/legal-documents/repository";
import {
  approveDrafts,
  approvePlatformTemplates,
  approveVersion,
  createDraftVersion,
  deleteVersionsInBatch,
  planDraftApproval,
  planTemplateRegeneration,
  regenerateFromTemplates,
  updateDraftVersion,
} from "@/modules/legal-documents/service";
import { confirmationPhrase } from "@/modules/legal-documents/domain/confirmation";
import { LegalBatchVersionRefused } from "@/modules/legal-documents/domain/batch";
import { clubFactsFromEnv } from "@/modules/legal-documents/templates/club-facts";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-053-02 (§NNN) — every text at once on `/admin/legal`: drafts regenerated from the
 * platform's templates, the drafts approved in one press, the ticked versions deleted in one
 * press. Each is the one-version verb asked of several, under the same guards.
 */
const NOW = new Date("2026-09-28T09:00:00.000Z");
const LATER = new Date("2026-09-28T10:00:00.000Z");
const FACTS = clubFactsFromEnv({
  CLUB_LEGAL_NAME: "Asociația Exemplu",
  CLUB_REGISTRATION_NUMBER: "CIF 12345678",
  CLUB_REGISTERED_ADDRESS: "Str. Exemplu nr. 1, Brașov",
  EMAIL_REPLY_TO: "contact@example.test",
});
const NO_FACTS = clubFactsFromEnv({
  CLUB_LEGAL_NAME: undefined,
  CLUB_REGISTRATION_NUMBER: undefined,
  CLUB_REGISTERED_ADDRESS: undefined,
  EMAIL_REPLY_TO: undefined,
});

const translations = (suffix: string) => [
  { locale: "ro" as const, title: `Notă ${suffix}`, body: textToBody(`Clubul ${suffix}.`) },
  { locale: "en" as const, title: `Notice ${suffix}`, body: textToBody(`The club ${suffix}.`) },
];

async function codeOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "ok";
  } catch (error) {
    return isDomainError(error) ? error.code : `unexpected: ${String(error)}`;
  }
}

async function fieldsOf(operation: Promise<unknown>): Promise<readonly string[]> {
  try {
    await operation;
    return [];
  } catch (error) {
    return isDomainError(error) ? error.fields : ["unexpected"];
  }
}

describe("every legal text at once (§NNN)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
  });

  describe("regenerating from the templates", () => {
    it("makes one draft per text whose template says something new, and nothing in force", async () => {
      const plan = await planTemplateRegeneration(db, FACTS, NOW);
      expect(plan.map((item) => item.outcome)).toEqual(LEGAL_DOCUMENT_KEYS.map(() => "create"));

      const result = await regenerateFromTemplates(db, admin, FACTS, [...LEGAL_DOCUMENT_KEYS], NOW);
      expect(result).toEqual({ created: [...LEGAL_DOCUMENT_KEYS], skipped: [] });

      const rows = await db.select().from(legalDocuments);
      expect(rows).toHaveLength(LEGAL_DOCUMENT_KEYS.length);
      expect(rows.every((row) => !row.isApproved && row.createdByStaffUserId === admin.id)).toBe(true);
      for (const key of LEGAL_DOCUMENT_KEYS) expect(await findCurrentApprovedDocument(db, key, "ro", LATER)).toBeUndefined();
    });

    it("never doubles a draft that already has the template's words, nor re-drafts the text in force", async () => {
      await regenerateFromTemplates(db, admin, FACTS, ["PRIVACY_NOTICE", "TERMS"], NOW);
      // A second press, or a stale page naming the same keys: skipped, not doubled.
      expect(await regenerateFromTemplates(db, admin, FACTS, ["PRIVACY_NOTICE", "TERMS"], NOW)).toEqual({
        created: [],
        skipped: ["PRIVACY_NOTICE", "TERMS"],
      });
      const plan = await planTemplateRegeneration(db, FACTS, NOW);
      expect(plan.find((item) => item.key === "PRIVACY_NOTICE")?.outcome).toBe("draftExists");

      // The platform's texts approved from the same facts: every template is the text in force.
      await resetTables(db);
      [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
      await approvePlatformTemplates(db, admin, FACTS, NOW);
      expect((await planTemplateRegeneration(db, FACTS, LATER)).every((item) => item.outcome === "unchanged")).toBe(true);
      expect(await regenerateFromTemplates(db, admin, FACTS, [...LEGAL_DOCUMENT_KEYS], LATER)).toEqual({
        created: [],
        skipped: [...LEGAL_DOCUMENT_KEYS],
      });
    });

    it("drafts the text again when the club's facts changed, the version in force untouched", async () => {
      await approvePlatformTemplates(db, admin, FACTS, NOW);
      const moved = { ...FACTS, registeredAddress: "Str. Nouă nr. 2, Brașov" };
      const result = await regenerateFromTemplates(db, admin, moved, [...LEGAL_DOCUMENT_KEYS], LATER);
      // Only the texts that name the seat change.
      expect(result.created.length).toBeGreaterThan(0);
      for (const key of result.created) {
        expect((await findCurrentApprovedDocument(db, key, "ro", LATER))?.version).toBe(1);
      }
    });

    it("is one transaction: a failure at the fourth text leaves no draft of the first three", async () => {
      // A real database refusal on the fourth key of the catalogue, from inside the press.
      const fourth = LEGAL_DOCUMENT_KEYS[3];
      await db.execute(
        sql.raw(`CREATE FUNCTION refuse_fourth_legal_key() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'refused for the test'; END $$`),
      );
      await db.execute(
        sql.raw(`CREATE TRIGGER refuse_fourth_legal_key BEFORE INSERT ON legal_documents
          FOR EACH ROW WHEN (NEW.key = '${fourth}') EXECUTE FUNCTION refuse_fourth_legal_key()`),
      );
      try {
        await expect(regenerateFromTemplates(db, admin, FACTS, [...LEGAL_DOCUMENT_KEYS], NOW)).rejects.toThrow();
        expect(await db.select().from(legalDocuments)).toHaveLength(0);
      } finally {
        await db.execute(sql.raw("DROP TRIGGER refuse_fourth_legal_key ON legal_documents"));
        await db.execute(sql.raw("DROP FUNCTION refuse_fourth_legal_key()"));
      }
      // And the same press, unrefused, makes every draft.
      expect((await regenerateFromTemplates(db, admin, FACTS, [...LEGAL_DOCUMENT_KEYS], NOW)).created).toHaveLength(LEGAL_DOCUMENT_KEYS.length);
    });

    it("never offers a newer template draft over a waiting draft whose placeholder the club filled in", async () => {
      await regenerateFromTemplates(db, admin, NO_FACTS, ["PRIVACY_NOTICE"], NOW);
      const [waiting] = await listVersionsForBackoffice(db);
      await updateDraftVersion(db, admin, waiting.id, translations("filled in"), NOW);
      expect((await planTemplateRegeneration(db, NO_FACTS, NOW)).find((item) => item.key === "PRIVACY_NOTICE")?.outcome).toBe("draftExists");
      expect(await regenerateFromTemplates(db, admin, NO_FACTS, ["PRIVACY_NOTICE"], NOW)).toEqual({ created: [], skipped: ["PRIVACY_NOTICE"] });
    });

    it("keeps an unknown fact as its placeholder in the draft, and says so", async () => {
      const plan = await planTemplateRegeneration(db, NO_FACTS, NOW);
      expect(plan.find((item) => item.key === "PRIVACY_NOTICE")?.hasPlaceholders).toBe(true);
    });

    it("is the Administrator's, and names what it makes", async () => {
      expect(await codeOf(regenerateFromTemplates(db, organizer, FACTS, [...LEGAL_DOCUMENT_KEYS], NOW))).toBe("FORBIDDEN");
      expect(await codeOf(regenerateFromTemplates(db, admin, FACTS, [], NOW))).toBe("VALIDATION_ERROR");
      expect(await db.select().from(legalDocuments)).toHaveLength(0);
    });
  });

  describe("approving the drafts", () => {
    it("approves the ready drafts in one press, each in force from the press", async () => {
      await regenerateFromTemplates(db, admin, FACTS, [...LEGAL_DOCUMENT_KEYS], NOW);
      const plan = await planDraftApproval(db);
      expect(plan.every((item) => item.outcome === "ready")).toBe(true);

      const approved = await approveDrafts(db, admin, plan.map((item) => item.row.id), LATER);
      expect(approved).toBe(LEGAL_DOCUMENT_KEYS.length);
      for (const key of LEGAL_DOCUMENT_KEYS) {
        const inForce = await findCurrentApprovedDocument(db, key, "en", LATER);
        expect(inForce?.version, key).toBe(1);
      }
      const rows = await db.select().from(legalDocuments);
      expect(rows.every((row) => row.isApproved && row.approvedByStaffUserId === admin.id && row.effectiveAt.getTime() === LATER.getTime())).toBe(true);
    });

    it("holds back an older draft, a draft behind an approved version and a draft with a placeholder", async () => {
      const older = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("t1") }, NOW);
      const newer = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("t2") }, NOW);
      const behind = await createDraftVersion(db, admin, { key: "PRIVACY_NOTICE", translations: translations("p1") }, NOW);
      const ahead = await createDraftVersion(db, admin, { key: "PRIVACY_NOTICE", translations: translations("p2") }, NOW);
      await approveVersion(db, admin, ahead, NOW);
      await regenerateFromTemplates(db, admin, NO_FACTS, ["EVENT_DECLARATION"], NOW);

      const outcomes = Object.fromEntries((await planDraftApproval(db)).map((item) => [`${item.row.key} ${item.row.version}`, item.outcome]));
      expect(outcomes).toEqual({
        "TERMS 1": "superseded",
        "TERMS 2": "ready",
        "PRIVACY_NOTICE 1": "behind",
        // Without the club's facts the declaration still reads «<DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>».
        "EVENT_DECLARATION 1": "placeholders",
      });

      // A page that named a held draft refuses the whole press: nothing approved, not even the ready one.
      expect(await codeOf(approveDrafts(db, admin, [newer, older], LATER))).toBe("CONFLICT");
      expect(await codeOf(approveDrafts(db, admin, [newer, behind], LATER))).toBe("CONFLICT");
      const terms = (await listVersionsForBackoffice(db)).filter((row) => row.key === "TERMS");
      expect(terms.every((row) => !row.isApproved)).toBe(true);

      expect(await approveDrafts(db, admin, [newer], LATER)).toBe(1);
      expect((await findCurrentApprovedDocument(db, "TERMS", "ro", LATER))?.id).toBe(newer);
    });

    it("never approves a text that still reads a placeholder", async () => {
      await regenerateFromTemplates(db, admin, NO_FACTS, ["PRIVACY_NOTICE"], NOW);
      const [item] = await planDraftApproval(db);
      expect(item.outcome).toBe("placeholders");
      expect(await codeOf(approveDrafts(db, admin, [item.row.id], LATER))).toBe("CONFLICT");
      expect(await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", "ro", LATER)).toBeUndefined();
    });

    it("is the Administrator's", async () => {
      const id = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("t1") }, NOW);
      expect(await codeOf(approveDrafts(db, organizer, [id], LATER))).toBe("FORBIDDEN");
      expect(await codeOf(approveDrafts(db, admin, [], LATER))).toBe("VALIDATION_ERROR");
    });
  });

  describe("deleting the ticked versions", () => {
    async function threeNotices() {
      const ids: string[] = [];
      for (const suffix of ["v1", "v2", "v3"]) {
        const id = await createDraftVersion(db, admin, { key: "PRIVACY_NOTICE", translations: translations(suffix) }, NOW);
        await approveVersion(db, admin, id, NOW);
        ids.push(id);
      }
      return ids;
    }

    it("deletes drafts with no phrase and no reason, as one draft's delete does", async () => {
      const a = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("a") }, NOW);
      const b = await createDraftVersion(db, admin, { key: "PRIVACY_NOTICE", translations: translations("b") }, NOW);
      expect(await deleteVersionsInBatch(db, admin, { versionIds: [a, b], typedConfirmation: "", reason: "", now: LATER })).toEqual({
        drafts: 2,
        approved: 0,
      });
      expect(await db.select().from(legalDocuments)).toHaveLength(0);
      // A draft's number is not retired (§53).
      expect(await db.select().from(legalDocumentNumbering)).toHaveLength(0);
    });

    it("deletes approved versions with one reason and DELETE <n>: an audit row each, every number retired", async () => {
      const [v1, v2] = await threeNotices();
      const draft = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("d") }, NOW);

      const input = { versionIds: [v2, v1, draft], reason: "curățenie după teste", now: LATER };
      // The phrase counts the approved versions: two, not three.
      expect(await fieldsOf(deleteVersionsInBatch(db, admin, { ...input, typedConfirmation: "DELETE 3" }))).toEqual(["typedConfirmation"]);
      expect(await fieldsOf(deleteVersionsInBatch(db, admin, { ...input, typedConfirmation: "DELETE 2", reason: " " }))).toEqual(["reason"]);
      expect(await db.select().from(legalDocuments)).toHaveLength(4);

      expect(await deleteVersionsInBatch(db, admin, { ...input, typedConfirmation: " delete  2 " })).toEqual({ drafts: 1, approved: 2 });
      const left = await db.select().from(legalDocuments);
      expect(left.map((row) => row.version)).toEqual([3]);

      const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, "legal_document.deleted"));
      expect(audit.map((row) => row.entityId).sort()).toEqual([v1, v2].sort());
      expect(audit.every((row) => (row.metadataJson as Record<string, unknown>).reason === "curățenie după teste")).toBe(true);
      const [floor] = await db.select().from(legalDocumentNumbering).where(eq(legalDocumentNumbering.key, "PRIVACY_NOTICE"));
      expect(floor.highestRetiredVersion).toBe(2);
    });

    it("refuses the whole batch when one version may not go — the text in force — naming it, and deletes nothing", async () => {
      const [v1, , v3] = await threeNotices();
      const refusal = await deleteVersionsInBatch(db, admin, {
        versionIds: [v1, v3],
        typedConfirmation: "DELETE 2",
        reason: "curățenie",
        now: LATER,
      }).catch((error: unknown) => error);
      // All or none (the phrase and the reason were given for this list), and the refusal says
      // which version stopped it, for the batch screen's sentence.
      expect(refusal).toBeInstanceOf(LegalBatchVersionRefused);
      expect((refusal as LegalBatchVersionRefused).code).toBe("CONFLICT");
      expect((refusal as LegalBatchVersionRefused).version).toBe(confirmationPhrase("PRIVACY_NOTICE", 3));
      expect(await db.select().from(legalDocuments)).toHaveLength(3);
      expect(await db.select().from(auditLogs)).toHaveLength(0);
    });

    it("is the Administrator's, and needs something ticked", async () => {
      const a = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("a") }, NOW);
      expect(await codeOf(deleteVersionsInBatch(db, organizer, { versionIds: [a], typedConfirmation: "", reason: "", now: LATER }))).toBe("FORBIDDEN");
      expect(await codeOf(deleteVersionsInBatch(db, admin, { versionIds: [], typedConfirmation: "", reason: "", now: LATER }))).toBe("VALIDATION_ERROR");
      expect(await db.select().from(legalDocuments)).toHaveLength(1);
    });
  });
});
