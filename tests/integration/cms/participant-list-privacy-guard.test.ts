import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent } from "@/modules/content/events/service";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `AGENTS.md` §10.10, `DECISIONS.md` §32, §NNN — a public participant list MUST NOT be switched
 * on before the approved privacy notice describes the disclosure.
 *
 * §32 recorded the rule in 2026-09-05 and left it unenforced on purpose: "no environment has an
 * approved notice at all, so nothing is blocked today." That stopped being true on 2026-09-22,
 * when production approved one — from that day, a checkbox with no code behind it is the rule
 * CLAUDE.md's table calls unbreakable, broken. This is where it is now enforced, in the same
 * place every other coherence rule of the registration block lives
 * (`content/events/service.ts#assertCoherentRegistrationBlock`), and where it is proven both
 * ways: refused with no approved notice, allowed once one is in force.
 */
const NOW = new Date("2026-09-24T10:00:00.000Z");

const DECLARATION_TRANSLATIONS = [
  { locale: "ro" as const, title: "Declarație", body: { sections: [{ paragraphs: ["Declar."] }] } },
  { locale: "en" as const, title: "Declaration", body: { sections: [{ paragraphs: ["I declare."] }] } },
];

const RACE_FIELDS = (declarationDocumentId: string) => ({
  type: "RACE" as const,
  eventStatus: "SCHEDULED" as const,
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-11-21T09:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Parcul Tractorul",
  locationAddress: "",
  surface: null,
  difficulty: null,
  costType: null,
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "INTERNAL" as const,
  participantListVisibility: "NAMES" as const,
  capacity: "50",
  registrationOpensAtWallTime: "2026-10-01T09:00",
  registrationClosesAtWallTime: "2026-11-20T09:00",
  declarationDocumentId,
  externalProvider: "",
  externalRegistrationUrl: "",
  translations: {
    ro: { slug: "cros-de-toamna", title: "Cros de toamnă", excerpt: "" },
    en: { slug: "autumn-cross", title: "Autumn cross", excerpt: "" },
  },
});

let db: TestDatabase;
let close: () => Promise<void>;
let organizer: StaffUser;
let declarationId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetTables(db);
  [organizer] = await db
    .insert(staffUsers)
    .values({ email: "organizer@dev.test", displayName: "Organizer", role: "ADMIN" })
    .returning();
  declarationId = await insertLegalDocumentVersion(db, {
    key: "EVENT_DECLARATION",
    version: 1,
    effectiveAt: NOW,
    isApproved: true,
    contentSha256: computeContentHash(DECLARATION_TRANSLATIONS),
    translations: DECLARATION_TRANSLATIONS,
    now: NOW,
  });
});

describe("§NNN the participant list is refused without an approved, effective privacy notice", () => {
  it("refuses NAMES when no privacy notice has ever been written", async () => {
    await expect(
      createEvent(db, { actor: organizer, fields: RACE_FIELDS(declarationId), now: NOW }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isDomainError(error) && error.code === "VALIDATION_ERROR" && error.fields.includes("participantListVisibility"),
    );

    // Refused before any row is written — not saved as HIDDEN, not saved at all.
    expect(await db.select().from(events)).toEqual([]);
  });

  it("refuses NAMES when a privacy notice exists but is not approved", async () => {
    const translations = [
      { locale: "ro" as const, title: "Confidențialitate", body: { sections: [{ paragraphs: ["Text."] }] } },
      { locale: "en" as const, title: "Privacy", body: { sections: [{ paragraphs: ["Text."] }] } },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: NOW,
      isApproved: false,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });

    await expect(
      createEvent(db, { actor: organizer, fields: RACE_FIELDS(declarationId), now: NOW }),
    ).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR");
  });

  it("refuses NAMES when the only approved privacy notice is not yet in force", async () => {
    const translations = [
      { locale: "ro" as const, title: "Confidențialitate", body: { sections: [{ paragraphs: ["Text."] }] } },
      { locale: "en" as const, title: "Privacy", body: { sections: [{ paragraphs: ["Text."] }] } },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000), // tomorrow
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });

    await expect(
      createEvent(db, { actor: organizer, fields: RACE_FIELDS(declarationId), now: NOW }),
    ).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR");
  });

  it("allows NAMES once an approved, effective privacy notice exists", async () => {
    const translations = [
      { locale: "ro" as const, title: "Confidențialitate", body: { sections: [{ paragraphs: ["Text."] }] } },
      { locale: "en" as const, title: "Privacy", body: { sections: [{ paragraphs: ["Text."] }] } },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: NOW,
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });

    const created = await createEvent(db, { actor: organizer, fields: RACE_FIELDS(declarationId), now: NOW });
    const [saved] = await db.select().from(events).where(eq(events.id, created.id));
    expect(saved.participantListVisibility).toBe("NAMES");
  });

  it("never refuses HIDDEN, notice or no notice — the guard is about the disclosure, not the event", async () => {
    const hidden = { ...RACE_FIELDS(declarationId), participantListVisibility: "HIDDEN" as const };
    const created = await createEvent(db, { actor: organizer, fields: hidden, now: NOW });
    const [saved] = await db.select().from(events).where(eq(events.id, created.id));
    expect(saved.participantListVisibility).toBe("HIDDEN");
  });
});
