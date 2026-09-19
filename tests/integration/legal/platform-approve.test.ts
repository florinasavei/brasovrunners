import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { legalDocuments } from "@/db/schema/legal-documents";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { approvePlatformTemplates } from "@/modules/legal-documents/service";
import { clubFactsFromEnv } from "@/modules/legal-documents/templates/club-facts";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-053-02 criterion 6 (`DECISIONS.md` §132) — the platform's three texts, with the club's
 * facts written in, approved in one act by a Superadministrator. The long way's rules, in one
 * call: a placeholder left is a refusal, a text in force is never replaced, and the approver
 * is on the row.
 */
const NOW = new Date("2026-09-19T12:00:00.000Z");
const FACTS = clubFactsFromEnv({
  CLUB_LEGAL_NAME: "Asociația Exemplu",
  CLUB_REGISTRATION_NUMBER: "CIF 12345678",
  CLUB_REGISTERED_ADDRESS: "Str. Exemplu nr. 1, Brașov",
  EMAIL_REPLY_TO: "contact@example.test",
});

async function codeOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "ok";
  } catch (error) {
    return isDomainError(error) ? error.code : "unexpected";
  }
}

describe("the platform's texts approved in one act", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let superadmin: StaffUser;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [superadmin] = await db.insert(staffUsers).values({ email: "superadmin@dev.test", displayName: "Owner", role: "SUPERADMIN" }).returning();
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  });

  it("creates and approves version 1 of each text with the facts in, in the approver's name", async () => {
    const result = await approvePlatformTemplates(db, superadmin, FACTS, NOW);
    expect(result).toEqual({ approved: ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"], alreadyApproved: [] });

    for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
      for (const locale of ["ro", "en"] as const) {
        const inForce = await findCurrentApprovedDocument(db, key, locale, NOW);
        expect(inForce, `${key} ${locale}`).toBeDefined();
        expect(inForce!.version).toBe(1);
        const text = JSON.stringify(inForce!.body);
        expect(text).toContain("Asociația Exemplu");
        expect(text).not.toMatch(/<[A-ZĂÂÎȘȚ'’][^<>]{3,}>/);
      }
    }
    const rows = await db.select().from(legalDocuments);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.isApproved && row.approvedByStaffUserId === superadmin.id && row.effectiveAt.getTime() === NOW.getTime())).toBe(true);
  });

  it("leaves a text already in force alone, and approves only the missing ones", async () => {
    await approvePlatformTemplates(db, superadmin, FACTS, NOW);
    const again = await approvePlatformTemplates(db, superadmin, FACTS, new Date(NOW.getTime() + 60_000));
    expect(again).toEqual({ approved: [], alreadyApproved: ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] });
    expect(await db.select().from(legalDocuments)).toHaveLength(3);
  });

  it("refuses while a fact is unknown, naming the blank, and writes nothing", async () => {
    const partial = { ...FACTS, registeredAddress: null };
    const code = await codeOf(approvePlatformTemplates(db, superadmin, partial, NOW));
    expect(code).toBe("VALIDATION_ERROR");
    expect(await db.select().from(legalDocuments)).toHaveLength(0);
  });

  it("is a Superadministrator's act", async () => {
    expect(await codeOf(approvePlatformTemplates(db, admin, FACTS, NOW))).toBe("FORBIDDEN");
    expect(await db.select().from(legalDocuments)).toHaveLength(0);
  });
});
