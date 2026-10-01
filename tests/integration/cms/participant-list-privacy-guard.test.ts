import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, saveEventFields } from "@/modules/content/events/service";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `AGENTS.md` §10.10, `DECISIONS.md` §32, §346 — a public participant list MUST NOT be switched
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

describe("§346 the participant list is refused without an approved, effective privacy notice", () => {
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

/**
 * §NNN — «Lista de așteptare e publică» is stored true only beside a published list on an event that
 * takes registrations here: anything else stores false, whatever was posted, so the column never holds
 * a truth the list cannot act on and a list switched on later never finds the waiting list already public.
 */
describe("§NNN the waiting-list switch is stored only beside a published list", () => {
  beforeEach(async () => {
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
  });

  const stored = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
  /** The event row's fields as a save posts them — a save carries no translations. */
  const rowFields = (extra: Record<string, unknown> = {}) =>
    Object.fromEntries(Object.entries({ ...RACE_FIELDS(declarationId), ...extra }).filter(([key]) => key !== "translations"));

  it("keeps true beside NAMES on an internal event", async () => {
    const created = await createEvent(db, { actor: organizer, fields: { ...RACE_FIELDS(declarationId), waitlistPublic: true }, now: NOW });
    expect((await stored(created.id)).waitlistPublic).toBe(true);
  });

  it("stores false for a ticked switch beside a hidden list", async () => {
    const fields = { ...RACE_FIELDS(declarationId), participantListVisibility: "HIDDEN" as const, waitlistPublic: true };
    const created = await createEvent(db, { actor: organizer, fields, now: NOW });
    expect((await stored(created.id)).waitlistPublic).toBe(false);
  });

  it("is off by default, and a caller that does not post it changes nothing beside a published list", async () => {
    const created = await createEvent(db, { actor: organizer, fields: RACE_FIELDS(declarationId), now: NOW });
    expect((await stored(created.id)).waitlistPublic).toBe(false);
    const on = await saveEventFields(db, { actor: organizer, eventId: created.id, expectedVersion: created.version, fields: rowFields({ waitlistPublic: true }), now: NOW });
    expect(on.waitlistPublic).toBe(true);
    const untouched = await saveEventFields(db, { actor: organizer, eventId: created.id, expectedVersion: on.version, fields: rowFields({ capacity: "60" }), now: NOW });
    expect(untouched.waitlistPublic).toBe(true);
  });

  it("switching the list off switches the waiting list off with it, even if the box stayed ticked", async () => {
    const created = await createEvent(db, { actor: organizer, fields: { ...RACE_FIELDS(declarationId), waitlistPublic: true }, now: NOW });
    const hidden = await saveEventFields(db, {
      actor: organizer,
      eventId: created.id,
      expectedVersion: created.version,
      fields: rowFields({ participantListVisibility: "HIDDEN", waitlistPublic: true }),
      now: NOW,
    });
    expect(hidden.waitlistPublic).toBe(false);
    // Switched back on without the box: still off — nobody decided again.
    const again = await saveEventFields(db, { actor: organizer, eventId: created.id, expectedVersion: hidden.version, fields: rowFields(), now: NOW });
    expect(again.participantListVisibility).toBe("NAMES");
    expect(again.waitlistPublic).toBe(false);
  });
});
