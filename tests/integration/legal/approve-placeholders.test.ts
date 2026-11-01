import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import en from "@/../messages/en.json";
import ro from "@/../messages/ro.json";
import { legalDocuments } from "@/db/schema/legal-documents";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { textToBody } from "@/modules/legal-documents/domain/body-text";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import {
  approveDrafts,
  approvePlatformTemplates,
  approveVersion,
  createDraftVersion,
  planDraftApproval,
  templateTranslations,
  updateDraftVersion,
} from "@/modules/legal-documents/service";
import { clubFactsFromEnv } from "@/modules/legal-documents/templates/club-facts";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-053-01 (§NNN, the owner's decision 7) — no text in effect that the club did not approve, and a
 * `<PLACEHOLDER>` is not approved text: `approveVersion` refuses a version that still holds one, in either
 * language — a club fact the environment did not know (`<ADRESA SEDIULUI>`) or a club choice
 * `club/legal.json` does not say (`<PREMIILE ÎN BANI>`) — on the server, whichever press reached it. The one
 * press over the missing texts approves complete texts as before and refuses an incomplete one as before.
 */
const NOW = new Date("2026-11-01T09:00:00.000Z");
const LATER = new Date("2026-11-01T10:00:00.000Z");
const FACTS = clubFactsFromEnv({
  CLUB_LEGAL_NAME: "Asociația Exemplu",
  CLUB_REGISTRATION_NUMBER: "CIF 12345678",
  CLUB_REGISTERED_ADDRESS: "Str. Exemplu nr. 1",
  EMAIL_REPLY_TO: "contact@example.test",
});

const translations = (ro: string, en: string) => [
  { locale: "ro" as const, title: "Termeni", body: textToBody(ro) },
  { locale: "en" as const, title: "Terms", body: textToBody(en) },
];

async function codeOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "ok";
  } catch (error) {
    return isDomainError(error) ? error.code : `unexpected: ${String(error)}`;
  }
}

describe("BR-REQ-053-01: a version that still holds a <PLACEHOLDER> is never approved (§NNN)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  });

  const isApproved = async (id: string) => (await db.select().from(legalDocuments).where(eq(legalDocuments.id, id)))[0]?.isApproved;

  it("refuses «Aprobă și publică» on a club choice left blank, in either language, and leaves the draft a draft", async () => {
    const english = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("Nu se acordă premii.", "<PRIZE MONEY>") }, NOW);
    expect(await codeOf(approveVersion(db, admin, english, NOW))).toBe("LEGAL_PLACEHOLDERS_LEFT");
    expect(await isApproved(english)).toBe(false);

    const romanian = await createDraftVersion(db, admin, { key: "PRIVACY_NOTICE", translations: translations("Sediul: <ADRESA SEDIULUI>.", "Seat: given.") }, NOW);
    expect(await codeOf(approveVersion(db, admin, romanian, NOW))).toBe("LEGAL_PLACEHOLDERS_LEFT");
    expect(await isApproved(romanian)).toBe(false);
    expect(await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", "ro", LATER)).toBeUndefined();
  });

  it("approves the same draft once the club typed its words in the blank", async () => {
    const id = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("<PREMIILE ÎN BANI>", "<PRIZE MONEY>") }, NOW);
    expect(await codeOf(approveVersion(db, admin, id, NOW))).toBe("LEGAL_PLACEHOLDERS_LEFT");
    await updateDraftVersion(db, admin, id, translations("Nu se acordă premii în bani.", "No prize money is awarded."), NOW);
    expect(await codeOf(approveVersion(db, admin, id, NOW))).toBe("ok");
    expect((await findCurrentApprovedDocument(db, "TERMS", "en", LATER))?.body).toEqual(textToBody("No prize money is awarded."));
  });

  it("refuses a template draft whose facts the deployment does not know, and approves it with them", async () => {
    const blank = clubFactsFromEnv({ CLUB_LEGAL_NAME: undefined, CLUB_REGISTRATION_NUMBER: undefined, CLUB_REGISTERED_ADDRESS: undefined, EMAIL_REPLY_TO: undefined });
    const withHoles = await createDraftVersion(db, admin, { key: "PRIVACY_NOTICE", translations: templateTranslations("PRIVACY_NOTICE", blank) }, NOW);
    expect(await codeOf(approveVersion(db, admin, withHoles, NOW))).toBe("LEGAL_PLACEHOLDERS_LEFT");
    const filled = await createDraftVersion(db, admin, { key: "TERMS", translations: templateTranslations("TERMS", FACTS) }, NOW);
    expect(await codeOf(approveVersion(db, admin, filled, NOW))).toBe("ok");
  });

  it("keeps «Aprobă ciornele» from approving it either: planned out, and refused if named", async () => {
    const id = await createDraftVersion(db, admin, { key: "TERMS", translations: translations("<PREMIILE ÎN BANI>", "<PRIZE MONEY>") }, NOW);
    expect((await planDraftApproval(db)).find((item) => item.row.id === id)?.outcome).toBe("placeholders");
    expect(await codeOf(approveDrafts(db, admin, [id], NOW))).not.toBe("ok");
    expect(await isApproved(id)).toBe(false);
  });

  it("leaves the one press as it was: complete texts approved, an incomplete one refused before any draft is made", async () => {
    expect(await codeOf(approvePlatformTemplates(db, admin, { ...FACTS, registeredAddress: null }, NOW))).toBe("VALIDATION_ERROR");
    expect(await db.select().from(legalDocuments)).toHaveLength(0);
    const result = await approvePlatformTemplates(db, admin, FACTS, NOW);
    expect(result.approved.length).toBeGreaterThan(0);
    expect(result.alreadyApproved).toEqual([]);
  });

  it("says why in both languages, without a literal angle bracket the catalogue would read as a tag", () => {
    for (const catalogue of [ro, en]) {
      const message = catalogue.Admin.errors.LEGAL_PLACEHOLDERS_LEFT;
      expect(message.length).toBeGreaterThan(40);
      expect(message).not.toMatch(/[<>]/);
    }
    expect(ro.Admin.errors.LEGAL_PLACEHOLDERS_LEFT).toMatch(/^Nu s-a aprobat nimic/);
    expect(en.Admin.errors.LEGAL_PLACEHOLDERS_LEFT).toMatch(/^Nothing was approved/);
  });
});
