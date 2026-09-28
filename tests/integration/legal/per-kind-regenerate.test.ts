import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { legalDocuments } from "@/db/schema/legal-documents";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { textToBody } from "@/modules/legal-documents/domain/body-text";
import { LEGAL_DOCUMENT_KEYS } from "@/modules/legal-documents/domain/keys";
import {
  approveVersion,
  createDraftVersion,
  readLegalOverview,
  regenerateFromTemplates,
} from "@/modules/legal-documents/service";
import { clubFactsFromEnv } from "@/modules/legal-documents/templates/club-facts";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-053-02 (§NNN, amending §532) — «Regenerează din șablon» on one text's card: §532's own
 * press asked for one key. It makes one draft of that text and of no other, numbered next, with
 * an audit row saying who made it; and the
 * cards and «Versiune nouă» read each text's state, and «Șablon nou», from the same overview.
 */
const NOW = new Date("2026-09-28T09:00:00.000Z");
const LATER = new Date("2026-09-28T10:00:00.000Z");
const FACTS_ENV = {
  CLUB_LEGAL_NAME: "Asociația Exemplu",
  CLUB_REGISTRATION_NUMBER: "CIF 12345678",
  CLUB_REGISTERED_ADDRESS: "Str. Exemplu nr. 1, Brașov",
  EMAIL_REPLY_TO: "contact@example.test",
};
const FACTS = clubFactsFromEnv(FACTS_ENV);

const translations = (suffix: string) => [
  { locale: "ro" as const, title: `Termeni ${suffix}`, body: textToBody(`Clubul ${suffix}.`) },
  { locale: "en" as const, title: `Terms ${suffix}`, body: textToBody(`The club ${suffix}.`) },
];

async function codeOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "ok";
  } catch (error) {
    return isDomainError(error) ? error.code : `unexpected: ${String(error)}`;
  }
}

describe("one text regenerated from its template (§NNN)", () => {
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

  it("makes one draft of that text only, numbered next, with an audit row", async () => {
    // Two versions of the terms already, the second in force.
    const first = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("v1") }, NOW);
    await approveVersion(db, admin, first, NOW);
    const second = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("v2") }, NOW);
    await approveVersion(db, admin, second, NOW);

    const result = await regenerateFromTemplates(db, admin, FACTS, ["TERMS"], LATER);
    expect(result).toEqual({ created: ["TERMS"], skipped: [] });

    const rows = await db.select().from(legalDocuments);
    // Nothing of any other text: the card's press is that text's alone.
    expect(rows.filter((row) => row.key !== "TERMS")).toEqual([]);
    const draft = rows.find((row) => row.key === "TERMS" && row.version === 3);
    expect(draft).toBeDefined();
    expect(draft?.isApproved).toBe(false);
    expect(draft?.createdByStaffUserId).toBe(admin.id);

    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, "legal_document.regenerated"));
    expect(audit).toHaveLength(1);
    expect(audit[0].entityId).toBe(draft?.id);
    expect(audit[0].actorStaffUserId).toBe(admin.id);
    expect(audit[0].metadataJson).toEqual({ documentKey: "TERMS", version: 3 });
  });

  it("on an empty database makes version 1 of that one text, and a second press doubles nothing", async () => {
    expect(await regenerateFromTemplates(db, admin, FACTS, ["GROUP_RUN_DECLARATION_TRAIL"], NOW)).toEqual({
      created: ["GROUP_RUN_DECLARATION_TRAIL"],
      skipped: [],
    });
    const rows = await db.select().from(legalDocuments);
    expect(rows.map((row) => [row.key, row.version])).toEqual([["GROUP_RUN_DECLARATION_TRAIL", 1]]);

    expect(await regenerateFromTemplates(db, admin, FACTS, ["GROUP_RUN_DECLARATION_TRAIL"], LATER)).toEqual({
      created: [],
      skipped: ["GROUP_RUN_DECLARATION_TRAIL"],
    });
    expect(await db.select().from(legalDocuments)).toHaveLength(1);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "legal_document.regenerated"))).toHaveLength(1);
  });

  it("is the Administrator's, asserted in the service (§450)", async () => {
    expect(await codeOf(regenerateFromTemplates(db, organizer, FACTS, ["TERMS"], NOW))).not.toBe("ok");
    expect(await db.select().from(legalDocuments)).toHaveLength(0);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("reads each text's state for the cards and «Versiune nouă»: in force, waiting, the next number, «Șablon nou»", async () => {
    // Nothing yet: every text is «Nicio versiune în vigoare», due for a draft, numbered 1.
    const empty = await readLegalOverview(db, FACTS, NOW);
    for (const key of LEGAL_DOCUMENT_KEYS) {
      expect(empty[key].summary.inForce).toBeNull();
      expect(empty[key].regeneration).toBe("create");
      expect(empty[key].templateNewer).toBe(false);
      expect(empty[key].nextVersion).toBe(1);
    }

    // The privacy notice regenerated: a draft waits, and the card's press says so rather than doubling it.
    await regenerateFromTemplates(db, admin, FACTS, ["PRIVACY_NOTICE"], NOW);
    const waiting = await readLegalOverview(db, FACTS, NOW);
    expect(waiting.PRIVACY_NOTICE.summary.waitingDraft?.version).toBe(1);
    expect(waiting.PRIVACY_NOTICE.regeneration).toBe("draftExists");
    expect(waiting.PRIVACY_NOTICE.nextVersion).toBe(2);
    expect(waiting.TERMS.summary.waitingDraft).toBeNull();

    // Approved: in force, the template's own words — nothing newer, nothing to regenerate.
    const draftId = waiting.PRIVACY_NOTICE.summary.waitingDraft?.id ?? "";
    await approveVersion(db, admin, draftId, NOW);
    const approved = await readLegalOverview(db, FACTS, LATER);
    expect(approved.PRIVACY_NOTICE.summary.inForce?.version).toBe(1);
    expect(approved.PRIVACY_NOTICE.regeneration).toBe("unchanged");
    expect(approved.PRIVACY_NOTICE.templateNewer).toBe(false);

    // The same template with other facts written in (a new seat): the words in force differ, so newer.
    const moved = clubFactsFromEnv({ ...FACTS_ENV, CLUB_REGISTERED_ADDRESS: "Str. Alta nr. 2, Brașov" });
    expect((await readLegalOverview(db, moved, LATER)).PRIVACY_NOTICE.templateNewer).toBe(true);

    // A text written from nothing, in force: compared by its words, so newer.
    const own = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("own") }, NOW);
    await approveVersion(db, admin, own, NOW);
    expect((await readLegalOverview(db, FACTS, LATER)).TERMS.templateNewer).toBe(true);
  });
});
