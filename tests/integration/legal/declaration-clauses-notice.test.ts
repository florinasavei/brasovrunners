import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { approveVersion, createDraftVersion, readLegalOverview, templateTranslations } from "@/modules/legal-documents/service";
import { type ClubFacts, clubFactsFromEnv } from "@/modules/legal-documents/templates/club-facts";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §639 on §NNN — five more clauses in the race declaration and the typed name's sentence (the owner, 2026-10-14) change
 * the declaration templates' words, so the template the club approved before them reads as «Șablon nou» and the
 * maintenance job's first run emails the Administrators once; the platform approves nothing, and the text in force
 * does not move. The existing pattern of `templates-notice.test.ts`, with the declaration as the text in force.
 */
const NOW = new Date("2026-10-14T08:00:00.000Z");

const FACTS: ClubFacts = clubFactsFromEnv({
  CLUB_LEGAL_NAME: "Asociația Exemplu",
  CLUB_REGISTRATION_NUMBER: "CIF 12345678",
  CLUB_REGISTERED_ADDRESS: "Str. Exemplu nr. 1, Brașov",
  EMAIL_REPLY_TO: "contact@example.test",
});

/** The six paragraphs §NNN added, in either language (the five clauses, then the signature sentence). */
const ADDED = [
  /asigurare medicală valabilă/,
  /Urmez numai traseul marcat/,
  /mă poate descalifica, fără drept de contestare/,
  /Nu las deșeuri în zona evenimentului/,
  /Nu folosesc și nu las niciun vehicul/,
  /semnătura mea electronică/,
  /valid medical insurance/,
  /I follow only the marked course/,
  /may disqualify me, without appeal/,
  /I leave no litter in the area/,
  /I use or leave no vehicle/,
  /is my electronic signature/,
];

/** The text as the club approved it before §NNN: the same paragraphs without the six. */
const before = (body: LegalDocumentBody): LegalDocumentBody => ({
  sections: body.sections.map((section) => ({ ...section, paragraphs: section.paragraphs.filter((paragraph) => !ADDED.some((pattern) => pattern.test(paragraph))) })),
});

describe("§639 on §NNN the Administrators are emailed when the declaration's template moves", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "John", role: "ADMIN", preferredLocale: "en" }).returning();
  });

  const notices = () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "LEGAL_TEMPLATES_CHANGED"));

  async function approveWithout(key: "EVENT_DECLARATION" | "EVENT_DECLARATION_ROAD") {
    const translations = templateTranslations(key, FACTS).map((translation) => ({ ...translation, body: before(translation.body) }));
    const draft = await createDraftVersion(db, admin, { key, translations }, NOW);
    await approveVersion(db, admin, draft, NOW);
  }

  it("the templates carry the six paragraphs and the approved text from before them does not", () => {
    for (const key of ["EVENT_DECLARATION", "EVENT_DECLARATION_ROAD"] as const) {
      for (const translation of templateTranslations(key, FACTS)) {
        const text = translation.body.sections.flatMap((section) => section.paragraphs).join("\n");
        expect(ADDED.filter((pattern) => pattern.test(text)), `${key} ${translation.locale}`).toHaveLength(6);
        const old = before(translation.body).sections.flatMap((section) => section.paragraphs).join("\n");
        expect(ADDED.filter((pattern) => pattern.test(old)), `${key} ${translation.locale} before`).toHaveLength(0);
      }
    }
  });

  it("marks each declaration «Șablon nou» against the text approved before the clauses, and the job emails the Administrators once", async () => {
    await approveWithout("EVENT_DECLARATION");
    await approveWithout("EVENT_DECLARATION_ROAD");
    const overview = await readLegalOverview(db, FACTS, NOW);
    expect(overview.EVENT_DECLARATION.templateNewer).toBe(true);
    expect(overview.EVENT_DECLARATION_ROAD.templateNewer).toBe(true);

    const run = await runRegistrationMaintenance(db, NOW);
    expect(run.legalTemplatesNoticesQueued).toBe(1);
    const [notice] = await notices();
    expect(notice.recipientEmail).toBe("admin@dev.test");
    expect((notice.payloadJson as { keys: string[] }).keys).toEqual(expect.arrayContaining(["EVENT_DECLARATION", "EVENT_DECLARATION_ROAD"]));
    // The platform approved nothing: the text in force is still the one the club approved, without the clauses.
    const after = await readLegalOverview(db, FACTS, NOW);
    expect(after.EVENT_DECLARATION.inForceId).toBe(overview.EVENT_DECLARATION.inForceId);
    expect(after.EVENT_DECLARATION.templateNewer).toBe(true);
  });

  it("stops being «Șablon nou» once the club approves the template's own words", async () => {
    await approveWithout("EVENT_DECLARATION");
    expect((await readLegalOverview(db, FACTS, NOW)).EVENT_DECLARATION.templateNewer).toBe(true);
    const draft = await createDraftVersion(db, admin, { key: "EVENT_DECLARATION", translations: templateTranslations("EVENT_DECLARATION", FACTS) }, NOW);
    await approveVersion(db, admin, draft, NOW);
    expect((await readLegalOverview(db, FACTS, NOW)).EVENT_DECLARATION.templateNewer).toBe(false);
  });
});
