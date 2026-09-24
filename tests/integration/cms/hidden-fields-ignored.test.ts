import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-02 criterion 10, extended to the registration mode (§111, §NNN; found by review):
 * a box the chosen type or mode hides is ignored even when what it holds is **wrong**, not only
 * when it is blank.
 *
 * The editor keeps hidden boxes in the document, so a switch back finds what was typed. Before
 * this, the service ignored them only after its schema had read them: a link typed as
 * `www.club.ro` under "La organizator", then hidden by a switch to "Pe site", was refused by
 * `httpsUrl`, and the refusal named a box that was not on the screen. What every mode keeps — the
 * participation window's days, the minimum age, the bib band — is still checked as typed, because
 * it is stored as typed.
 */
const NOW = new Date("2026-09-24T10:00:00.000Z");

const FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
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
  registrationMode: "INTERNAL",
  participantListVisibility: "HIDDEN" as const,
  capacity: "50",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
  externalProvider: "",
  externalRegistrationUrl: "",
};

const TRANSLATIONS = {
  ro: { slug: "crosul", title: "Crosul", excerpt: "" },
  en: { slug: "the-cross", title: "The cross", excerpt: "" },
};

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
  // "Pe site" needs an approved declaration to name (§10.8); the tests are about the other boxes.
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

const create = (fields: Record<string, unknown>) =>
  createEvent(db, { actor: organizer, fields: { ...FIELDS, declarationDocumentId: declarationId, ...fields, translations: TRANSLATIONS }, now: NOW });
const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

describe("§NNN a box the chosen mode hides cannot refuse the save", () => {
  it("'Pe site' ignores a wrong link and an over-long organizer left under 'La organizator'", async () => {
    const created = await create({ externalRegistrationUrl: "www.club.ro", externalProvider: "x".repeat(200) });
    const saved = await reload(created.id);
    expect(saved.registrationMode).toBe("INTERNAL");
    expect(saved.capacity).toBe(50);
    expect(saved.externalRegistrationUrl).toBeNull();
    expect(saved.externalProvider).toBeNull();
  });

  it("'La organizator' ignores a zero capacity and a declaration that is not an identifier", async () => {
    const created = await create({
      registrationMode: "EXTERNAL",
      capacity: "0",
      declarationDocumentId: "not-an-id",
      externalProvider: "Asociația X",
      externalRegistrationUrl: "https://entries.example.test",
    });
    const saved = await reload(created.id);
    expect(saved.registrationMode).toBe("EXTERNAL");
    expect(saved.capacity).toBeNull();
    expect(saved.declarationDocumentId).toBeNull();
    expect(saved.externalRegistrationUrl).toBe("https://entries.example.test");
  });

  it("a group run ignores the whole block, still posting INTERNAL and a capacity nobody can see", async () => {
    const created = await create({ type: "GROUP_RUN", capacity: "lots", externalRegistrationUrl: "www.club.ro" });
    const saved = await reload(created.id);
    expect(saved.registrationMode).toBe("NONE");
    expect(saved.capacity).toBeNull();
  });

  it("the editor's own save: 'www.club.ro' under 'La organizator', then 'Pe site', then Salvează", async () => {
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-11-21T07:00:00.000Z"), locationName: "Parcul Tractorul" })
      .returning();
    const rows = await db
      .insert(eventTranslations)
      .values((["ro", "en"] as const).map((locale) => ({ eventId: event.id, locale, slug: `crosul-${locale}`, title: `Crosul ${locale}` })))
      .returning();
    await saveEventAndTranslations(db, {
      actor: organizer,
      eventId: event.id,
      expectedVersion: event.version,
      fields: { ...FIELDS, declarationDocumentId: declarationId, externalRegistrationUrl: "www.club.ro" },
      translations: rows.map((row) => ({ translationId: row.id, expectedVersion: row.version, fields: { slug: row.slug, title: row.title, excerpt: "" } })),
      now: NOW,
    });
    const saved = await reload(event.id);
    expect(saved.registrationMode).toBe("INTERNAL");
    expect(saved.externalRegistrationUrl).toBeNull();
  });
});

describe("§NNN the waiting list's length, the capacity's kin (the waiting-list cap)", () => {
  it("'La organizator' ignores a length nobody can see, even one below nought", async () => {
    const elsewhere = await create({
      registrationMode: "EXTERNAL",
      capacity: "",
      waitlistCapacity: "-4",
      externalProvider: "Asociația X",
      externalRegistrationUrl: "https://entries.example.test",
    });
    expect((await reload(elsewhere.id)).waitlistCapacity).toBeNull();
  });

  it("'Pe site' stores the length typed beside the places", async () => {
    const here = await create({ waitlistCapacity: "12" });
    expect((await reload(here.id)).waitlistCapacity).toBe(12);
  });
});

describe("§328, §NNN a map link the place switch hides cannot refuse the save", () => {
  it("saves a TBA event over a hidden 'www.harta.ro', as no link, keeping the venue it hides", async () => {
    const created = await create({ locationToBeAnnounced: true, locationName: "Sala secretă", mapUrl: "www.harta.ro" });
    const saved = await reload(created.id);
    expect(saved.locationToBeAnnounced).toBe(true);
    expect(saved.locationName).toBe("Sala secretă");
    expect(saved.mapUrl).toBeNull();
  });

  it("keeps a real map link behind the switch, as typed", async () => {
    const created = await create({ locationToBeAnnounced: true, mapUrl: "https://maps.example.test/sala" });
    expect((await reload(created.id)).mapUrl).toBe("https://maps.example.test/sala");
  });

  it("refuses the same link once the place is announced, naming the box that is on screen", async () => {
    await expect(create({ locationToBeAnnounced: false, mapUrl: "www.harta.ro" })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["mapUrl"] });
  });
});

describe("§NNN what the chosen mode shows, and what every mode keeps, is still checked", () => {
  it("refuses a zero capacity under 'Pe site', naming the box", async () => {
    await expect(create({ capacity: "0" })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["capacity"] });
  });

  it("refuses a participation window of 99 days under 'Fără', because it is kept for a switch back", async () => {
    await expect(create({ registrationMode: "NONE", confirmationOpensDaysBefore: "99" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["confirmationOpensDaysBefore"],
    });
  });
});
