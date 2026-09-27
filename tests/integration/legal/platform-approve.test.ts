import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { legalDocuments } from "@/db/schema/legal-documents";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { LEGAL_DOCUMENT_KEYS } from "@/modules/legal-documents/domain/keys";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { approvePlatformTemplates } from "@/modules/legal-documents/service";
import { clubFactsFromEnv } from "@/modules/legal-documents/templates/club-facts";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-053-02 criterion 6 (`DECISIONS.md` §132) — the platform's texts a race rests on, with the
 * club's facts written in, approved in one act: since §NNN every text of the catalogue — the notice,
 * the terms, both race declarations, trail and road, and the group runs' two optional ones
 * (`PLATFORM_APPROVAL_KEYS`). The long way's rules, in one
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
    expect(result).toEqual({ approved: [...LEGAL_DOCUMENT_KEYS], alreadyApproved: [] });

    for (const key of LEGAL_DOCUMENT_KEYS) {
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
    expect(rows).toHaveLength(LEGAL_DOCUMENT_KEYS.length);
    expect(rows.every((row) => row.isApproved && row.approvedByStaffUserId === superadmin.id && row.effectiveAt.getTime() === NOW.getTime())).toBe(true);
  });

  it("leaves a text already in force alone, and approves only the missing ones", async () => {
    await approvePlatformTemplates(db, superadmin, FACTS, NOW);
    const again = await approvePlatformTemplates(db, superadmin, FACTS, new Date(NOW.getTime() + 60_000));
    expect(again).toEqual({ approved: [], alreadyApproved: [...LEGAL_DOCUMENT_KEYS] });
    expect(await db.select().from(legalDocuments)).toHaveLength(LEGAL_DOCUMENT_KEYS.length);
  });

  it("approves the road declaration alone for a club whose three texts were already in force (§NNN)", async () => {
    // A club that pressed the button before the road declaration existed: three in force, one missing.
    await approvePlatformTemplates(db, superadmin, FACTS, NOW);
    await db.delete(legalDocuments).where(eq(legalDocuments.key, "EVENT_DECLARATION_ROAD"));
    const later = new Date(NOW.getTime() + 60_000);
    const result = await approvePlatformTemplates(db, admin, FACTS, later);
    expect(result).toEqual({ approved: ["EVENT_DECLARATION_ROAD"], alreadyApproved: LEGAL_DOCUMENT_KEYS.filter((key) => key !== "EVENT_DECLARATION_ROAD") });
    expect((await findCurrentApprovedDocument(db, "EVENT_DECLARATION_ROAD", "ro", later))?.version).toBe(1);
  });

  it("refuses while a fact is unknown, naming the blank, and writes nothing", async () => {
    const partial = { ...FACTS, registeredAddress: null };
    const code = await codeOf(approvePlatformTemplates(db, superadmin, partial, NOW));
    expect(code).toBe("VALIDATION_ERROR");
    expect(await db.select().from(legalDocuments)).toHaveLength(0);
  });

  it("is an Administrator's act, and refused below it (§450)", async () => {
    const [organizer] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Organizer", role: "MODERATOR" }).returning();
    expect(await codeOf(approvePlatformTemplates(db, organizer, FACTS, NOW))).toBe("FORBIDDEN");
    expect(await db.select().from(legalDocuments)).toHaveLength(0);

    // The Administrator runs the club's legal texts since §450 — the one press included.
    const result = await approvePlatformTemplates(db, admin, FACTS, NOW);
    expect(result.approved.length).toBeGreaterThan(0);
  });
});
