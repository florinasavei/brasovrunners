import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { hasProgramme, takesRegistrations } from "@/modules/events/domain/event-type";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-02 criterion 10 (`DECISIONS.md` §111) — a group run is simply turned up to.
 *
 * The owner, 2026-09-19: "group runs don't have registrations or participants, and they don't
 * have an event schedule; races are the most complex ones." The editor hides the registration
 * block and the programme on a group run, but hidden fields still post — a run that was once a
 * race posts INTERNAL and its old programme — so the rule has to hold in the service, and this
 * is where it is proven.
 */
const NOW = new Date("2026-09-19T10:00:00.000Z");

const RACE_FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-10-11T09:00",
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
  registrationMode: "INTERNAL",
  participantListVisibility: "NAMES" as const,
  capacity: "50",
  registrationOpensAtWallTime: "2026-10-01T09:00",
  registrationClosesAtWallTime: "2026-10-10T09:00",
  declarationDocumentId: "",
  externalProvider: "",
  externalRegistrationUrl: "",
};

const PROGRAMME = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "09:00 start" }] }],
});

const translationFields = (title: string) => ({
  slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  title,
  excerpt: "",
  schedule: PROGRAMME,
  seoTitle: "",
  seoDescription: "",
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
  const translations = [
    { locale: "ro" as const, title: "Declarație", body: { sections: [{ paragraphs: ["Declar."] }] } },
    { locale: "en" as const, title: "Declaration", body: { sections: [{ paragraphs: ["I declare."] }] } },
  ];
  declarationId = await insertLegalDocumentVersion(db, {
    key: "EVENT_DECLARATION",
    version: 1,
    effectiveAt: NOW,
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
});

async function createDraft(type: "RACE" | "GROUP_RUN") {
  const [event] = await db
    .insert(events)
    .values({ type, startsAt: new Date("2026-10-11T06:00:00.000Z"), locationName: "Parcul Tractorul" })
    .returning();
  const rows = await db
    .insert(eventTranslations)
    .values(
      (["ro", "en"] as const).map((locale) => ({
        eventId: event.id,
        locale,
        slug: `evenimentul-${locale}`,
        title: `Titlu ${locale}`,
      })),
    )
    .returning();
  return { event, ro: rows.find((r) => r.locale === "ro")!, en: rows.find((r) => r.locale === "en")! };
}

const reloadEvent = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
const reloadTranslation = async (id: string) =>
  (await db.select().from(eventTranslations).where(eq(eventTranslations.id, id)))[0];

describe("the rule", () => {
  it("names the group run as the one type turned up to; a race has everything", () => {
    expect(takesRegistrations("GROUP_RUN")).toBe(false);
    expect(hasProgramme("GROUP_RUN")).toBe(false);
    for (const type of ["RACE", "HIKE", "COFFEE", "MEETUP"] as const) {
      expect(takesRegistrations(type), type).toBe(true);
      expect(hasProgramme(type), type).toBe(true);
    }
  });
});

describe("BR-REQ-050-02 criterion 10 — a group run takes no registrations and has no programme", () => {
  it("creates a group run as NONE whatever registration block the form posted", async () => {
    const created = await createEvent(db, {
      actor: organizer,
      fields: {
        ...RACE_FIELDS,
        type: "GROUP_RUN",
        declarationDocumentId: declarationId,
        translations: {
          ro: { slug: "alergare", title: "Alergare", excerpt: "" },
          en: { slug: "run", title: "Run", excerpt: "" },
        },
      },
      now: NOW,
    });
    const saved = await reloadEvent(created.id);
    expect(saved.registrationMode).toBe("NONE");
    expect(saved.capacity).toBeNull();
    expect(saved.declarationDocumentId).toBeNull();
    expect(saved.registrationOpensAt).toBeNull();
    expect(saved.registrationClosesAt).toBeNull();
    expect(saved.participantListVisibility).toBe("HIDDEN");
  });

  it("keeps the whole block on a race, and stores its programme", async () => {
    const { event, ro, en } = await createDraft("RACE");
    await saveEventAndTranslations(db, {
      actor: organizer,
      eventId: event.id,
      expectedVersion: event.version,
      fields: { ...RACE_FIELDS, declarationDocumentId: declarationId },
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: translationFields("Crosul") },
        { translationId: en.id, expectedVersion: en.version, fields: translationFields("The cross") },
      ],
      now: NOW,
    });
    const saved = await reloadEvent(event.id);
    expect(saved.registrationMode).toBe("INTERNAL");
    expect(saved.capacity).toBe(50);
    expect(saved.participantListVisibility).toBe("NAMES");
    expect((await reloadTranslation(ro.id)).scheduleJson).not.toBeNull();
  });

  it("turning a race into a group run drops the block and the programme in the same save", async () => {
    const { event, ro, en } = await createDraft("RACE");
    await saveEventAndTranslations(db, {
      actor: organizer,
      eventId: event.id,
      expectedVersion: event.version,
      fields: { ...RACE_FIELDS, declarationDocumentId: declarationId },
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: translationFields("Crosul") },
        { translationId: en.id, expectedVersion: en.version, fields: translationFields("The cross") },
      ],
      now: NOW,
    });
    const asRace = await reloadEvent(event.id);
    const roAsRace = await reloadTranslation(ro.id);

    // The hidden fields post exactly what they held: INTERNAL, the capacity, the programme.
    await saveEventAndTranslations(db, {
      actor: organizer,
      eventId: event.id,
      expectedVersion: asRace.version,
      fields: { ...RACE_FIELDS, type: "GROUP_RUN", declarationDocumentId: declarationId },
      translations: [
        { translationId: ro.id, expectedVersion: roAsRace.version, fields: translationFields("Crosul") },
        { translationId: en.id, expectedVersion: (await reloadTranslation(en.id)).version, fields: translationFields("The cross") },
      ],
      now: NOW,
    });
    const saved = await reloadEvent(event.id);
    expect(saved.type).toBe("GROUP_RUN");
    expect(saved.registrationMode).toBe("NONE");
    expect(saved.capacity).toBeNull();
    expect(saved.declarationDocumentId).toBeNull();
    expect(saved.participantListVisibility).toBe("HIDDEN");
    expect((await reloadTranslation(ro.id)).scheduleJson).toBeNull();
    expect((await reloadTranslation(en.id)).scheduleJson).toBeNull();
  });

  it("a copywriter's text-only save on a group run stores no programme either", async () => {
    const { event, ro } = await createDraft("GROUP_RUN");
    const [copywriter] = await db
      .insert(staffUsers)
      .values({ email: "copy@dev.test", displayName: "Copy", role: "COPYWRITER" })
      .returning();
    await saveEventAndTranslations(db, {
      actor: copywriter,
      eventId: event.id,
      translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: translationFields("Alergare") }],
      now: NOW,
    });
    expect((await reloadTranslation(ro.id)).title).toBe("Alergare");
    expect((await reloadTranslation(ro.id)).scheduleJson).toBeNull();
  });
});
