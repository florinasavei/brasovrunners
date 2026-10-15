import { and, asc, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerCategories, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { mediaAssets } from "@/db/schema/gallery";
import { legalDocuments } from "@/db/schema/legal-documents";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, publishEvent, repeatEvent } from "@/modules/content/events/service";
import { comparable, diffConfigs } from "@/modules/content/events/transfer/diff";
import { exportEvent, readEventConfig } from "@/modules/content/events/transfer/export";
import { type EventFile, readEventFile } from "@/modules/content/events/transfer/file-format";
import { diffEventImport, importEventAsNew, importEventOver } from "@/modules/content/events/transfer/import";
import { readVolunteersFile } from "@/modules/content/events/transfer/volunteers";
import { storeKeyOfUrl } from "@/modules/content/events/transfer/media";
import { storeRouteGpx } from "@/modules/content/events/route-gpx";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { changeCheckpoints, listCheckpoints, SavedCheckpointsRefusal } from "@/modules/event-checkpoints/checkpoints";
import type { PostedCheckpoint } from "@/modules/event-checkpoints/domain/checkpoint";
import { DEFAULT_BIB_DESIGN } from "@/modules/registrations/bib-design";
import { badgeColourReadable, DEFAULT_BADGE_DESIGN, readBadgeDesign } from "@/modules/volunteers/badges/badge-design";
import { uploadBodyImage } from "@/modules/media/service";
import { getStorage } from "@/modules/media/storage";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * An event as a JSON file (§751): export, import as a new draft, import over an event after its diff —
 * through the editor's own service. Every name, address, id and token here is invented; the people on
 * the registrations are made up for the one test that walks the file for them.
 */

const NOW = new Date("2026-10-14T10:00:00.000Z");
const ZONE = "Europe/Bucharest";
const STRAVA_EMBED = `<div class="strava-embed-placeholder" data-embed-type="route" data-embed-id="1111222233334444555" data-style="hybrid" data-map-hash="11.66/45.6375/25.5935" data-from-embed="false" data-token="abc123def456abc123def456abc123def456abcd"></div>`;
const GARMIN_LINK = "https://connect.garmin.com/modern/course/987654321";

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let declarationId: string;
let pictureBytes: Buffer;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  pictureBytes = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#336699" } }).webp().toBuffer();
});
afterAll(async () => close());

async function approve(key: "PRIVACY_NOTICE" | "TERMS" | "EVENT_DECLARATION" | "EVENT_DECLARATION_ROAD") {
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Text", body: { sections: [{ paragraphs: ["Text."] }] } },
    { locale: "en", title: "Text", body: { sections: [{ paragraphs: ["Text."] }] } },
  ];
  return insertLegalDocumentVersion(db, {
    key,
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  await approve("PRIVACY_NOTICE");
  await approve("TERMS");
  declarationId = await approve("EVENT_DECLARATION");
});

// --- The seeded race --------------------------------------------------------------------------

/** A picture uploaded as the editor does, answering its address and its asset's id. */
async function uploadedPicture() {
  const stored = await uploadBodyImage(db, { actorId: admin.id, file: pictureBytes, originalFilename: "foto.webp", now: NOW });
  return { assetId: stored.assetId, src: stored.src };
}

const doc = (text: string, src?: string) =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }, ...(src ? [{ type: "image", attrs: { src, alt: "o fotografie" } }] : [])],
  });

function raceFields(pictures: { cover: string; body: string; bib: string } | null, overrides: Record<string, unknown> = {}, texts: { ro?: Record<string, unknown>; en?: Record<string, unknown> } = {}) {
  return {
    type: "RACE",
    surface: "TRAIL",
    eventStatus: "SCHEDULED",
    timezone: ZONE,
    startsAtWallTime: "2026-11-21T09:00",
    endsAtWallTime: "",
    durationMinutes: "150",
    raceStartsAtWallTime: "2026-11-21T10:00",
    scheduleRows: [{ date: "2026-11-21", time: "08:00", endTime: "09:30", ro: "Ridicare kit", en: "Kit pickup", place: "Cort" }],
    locationName: "Poiana Brașov",
    locationNameEn: "Poiana Brasov",
    locationAddress: "",
    locationToBeAnnounced: false,
    difficulty: "HARD",
    difficultyStep: 2,
    costType: "PAID",
    costAmount: "100 lei",
    costUrl: "https://pay.example.test/x",
    mapUrl: "https://maps.example.test/pin",
    coordinates: "45.6, 25.58",
    routeUrl: "https://routes.example.test/r",
    routeStrava: STRAVA_EMBED,
    routeGarmin: GARMIN_LINK,
    stravaEventUrl: "",
    facebookEventUrl: "",
    coHosts: [{ name: "Asociația Prietenii", descriptionRo: "Împreună.", descriptionEn: "Together.", links: [{ kind: "SITE", url: "https://partner.example.test", labelRo: "Site", labelEn: "Site" }] }],
    links: [{ kind: "DOCUMENT", url: "https://files.example.test/rules.pdf", labelRo: "Regulament", labelEn: "Rules" }],
    distanceMeters: "21000",
    distanceEstimated: true,
    elevationGainMeters: "900",
    elevationGainEstimated: false,
    nightOverride: null,
    weatherMode: "forecast",
    offersGroupRunDeclaration: false,
    featured: false,
    isSpecial: true,
    membersOnly: false,
    ...(pictures ? { coverAssetId: pictures.cover, coverCrop: "" } : {}),
    registrationMode: "INTERNAL",
    capacity: "100",
    waitlistMode: "LIMITED",
    waitlistCapacity: "20",
    kitShirt: true,
    waitlistAutoOffer: false,
    askHealthNote: true,
    bibStartNumber: "100",
    bibColour: "#1a73e8",
    bibDesign: { ...DEFAULT_BIB_DESIGN, showLogo: false, footerText: "Hai!", headerImageSrc: pictures?.bib ?? null },
    confirmationOpensDaysBefore: "14",
    confirmationDeadlineDaysBefore: "3",
    minAge: "16",
    reminderHoursBefore: "48",
    registrationOpensAtWallTime: "2026-10-01T10:00",
    registrationOpensSoon: false,
    registrationClosesAtWallTime: "2026-11-19T23:00",
    declarationDocumentId: declarationId,
    participantListVisibility: "NAMES",
    waitlistPublic: false,
    waitlistCountPublic: false,
    participantCountPublic: true,
    hiddenListEnabled: true,
    hiddenListBibStart: "900",
    hiddenListCounted: true,
    hiddenListPublic: false,
    externalProvider: "",
    externalRegistrationUrl: "",
    translations: {
      ro: {
        slug: "cursa-de-toamna",
        title: "Cursa de toamnă",
        excerpt: "Rapid.",
        body: doc("Bun venit la cursă.", pictures?.body),
        rules: doc("Regulament."),
        checklist: "Frontală",
        seoTitle: "Cursa",
        seoDescription: "O cursă.",
        ...texts.ro,
      },
      en: {
        slug: "autumn-race",
        title: "The autumn race",
        excerpt: "Fast.",
        body: doc("Welcome to the race.", pictures?.body),
        rules: doc("Rules."),
        checklist: "Headlamp",
        seoTitle: "The race",
        seoDescription: "A race.",
        ...texts.en,
      },
    },
    ...overrides,
  };
}

async function seedRace(overrides: Record<string, unknown> = {}, texts: { ro?: Record<string, unknown>; en?: Record<string, unknown> } = {}, withPictures = true) {
  const pictures = withPictures ? await seedPictures() : null;
  const event = await createEvent(db, { actor: admin, fields: raceFields(pictures, overrides, texts), now: NOW });
  return { event, pictures };
}

async function seedPictures() {
  const cover = await uploadedPicture();
  const body = await uploadedPicture();
  const bib = await uploadedPicture();
  return { cover: cover.assetId, body: body.src, bib: bib.src };
}

/** What the other environment serves: this store's bytes by address, with replacements for the tests that corrupt one. */
function serving(replace: Record<string, Buffer | null> = {}): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url in replace) {
      const bytes = replace[url];
      return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 });
    }
    const key = storeKeyOfUrl(url, url.endsWith(".gpx") ? "gpx" : "image");
    const bytes = key ? await getStorage().get(key) : null;
    return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 });
  }) as typeof fetch;
}

async function fileOf(eventId: string, actor: Pick<StaffUser, "id" | "role"> = admin): Promise<EventFile> {
  const { file } = await exportEvent(db, { actor, eventId, now: NOW });
  const read = readEventFile(JSON.stringify(file));
  if (!read.ok) throw new Error(`the export did not read back: ${read.refusal} ${read.detail ?? ""}`);
  return read.file;
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "none";
  } catch (error) {
    return isDomainError(error) ? error.code : `unexpected: ${String(error)}`;
  }
};

const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
const texts = (id: string) => db.select().from(eventTranslations).where(eq(eventTranslations.eventId, id)).orderBy(asc(eventTranslations.locale));

/** The registrations the people made up for the privacy test and for «the registrations stay» tests. */
async function registerPeople(eventId: string, entries: Array<{ name: string; email: string; status: "CONFIRMED" | "PENDING_DECLARATION"; bib?: number }>) {
  const people = await db
    .insert(participants)
    .values(entries.map(({ name, email }) => ({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name })))
    .returning();
  return db
    .insert(registrations)
    .values(
      entries.map(({ name, status, bib }, index) => ({
        eventId,
        participantId: people[index].id,
        status,
        locale: "ro" as const,
        registeredName: name,
        displayName: name,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        raceId: null,
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        confirmedAt: status === "CONFIRMED" ? NOW : null,
        bibNumber: bib ?? null,
      })),
    )
    .returning();
}

// --- Export -----------------------------------------------------------------------------------

describe("the file an event is exported as", () => {
  it("is a versioned, self-describing JSON file, audited, named after the slug and the day", async () => {
    const { event } = await seedRace();
    const { file, fileName } = await exportEvent(db, { actor: admin, eventId: event.id, now: NOW });

    expect(file.format).toBe("brasovrunners-event");
    expect(file.version).toBe(3);
    expect(file.exportedAt).toBe(NOW.toISOString());
    expect(file.exportedFrom.environment).toBe("test");
    expect(fileName).toBe("cursa-de-toamna-2026-10-14.json");
    expect(file.event.registration.declaration).toEqual({ key: "EVENT_DECLARATION" });
    expect(file.event.translations.en.title).toBe("The autumn race");
    expect(file.event.start).toEqual({ date: "2026-11-21", time: "09:00" });
    expect(file.event.durationMinutes).toBe(150);
    expect(file.event.registration.waitlist).toEqual({ choice: "LIMITED", limit: 20 });
    expect(file.event.route.maps.map((map) => map.provider)).toEqual(["strava", "garmin"]);

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.exported"));
    expect(rows).toHaveLength(1);
    expect(rows[0].actorStaffUserId).toBe(admin.id);
    expect(rows[0].entityId).toBe(event.id);
  });

  it("names every picture by its address, size and hash — each once, whatever the places that use it", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);

    // The one picture both languages' bodies carry is one medium, named for the first place that uses it.
    expect(file.media.map((entry) => entry.role)).toEqual(["cover", "bib.header", "text.ro.body"]);
    for (const entry of file.media) {
      expect(entry.contentType).toBe("image/webp");
      expect(entry.size).toBeGreaterThan(0);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.url).toMatch(/^http:\/\/localhost:\d+\/api\/media\/test\/[0-9a-f-]{36}\/web\.webp$/);
    }
    expect(new Set(file.media.map((entry) => entry.url)).size).toBe(file.media.length);
  });

  it("never carries a registration, a person, an address, a volunteer, an id or a secret", async () => {
    const { event } = await seedRace();
    await registerPeople(event.id, [
      { name: "Zoe Quartz", email: "zoe.quartz@example.test", status: "CONFIRMED", bib: 101 },
      { name: "Xavier Ostrich", email: "xavier.ostrich@example.test", status: "PENDING_DECLARATION" },
    ]);
    const { file } = await exportEvent(db, { actor: admin, eventId: event.id, now: NOW });
    const text = JSON.stringify(file);

    // Nobody who registered, nor the staff who made the event, is anywhere in the file.
    for (const needle of ["Zoe", "Quartz", "Xavier", "Ostrich", "zoe.quartz", "xavier.ostrich", "admin@dev.test", "Admin"]) {
      expect(text, needle).not.toContain(needle);
    }
    // No address of any person: the only `@` in the file would be one.
    expect(text).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    // No telephone number in a person's shape.
    expect(text).not.toMatch(/\+\d[\d ()-]{7,}\d|\b07\d{2}[ .-]?\d{3}[ .-]?\d{3}\b/);
    // No database id of this environment: not the event's, a translation's, the declaration's, the staff's.
    for (const id of [event.id, declarationId, admin.id, ...(await texts(event.id)).map((row) => row.id)]) expect(text).not.toContain(id);
    // The configuration's own top-level shape, and nothing about registrations in it.
    // …and, beside the event, the volunteers' categories and roles (§NNN) — words, never a person.
    expect(Object.keys(file).sort()).toEqual(["event", "exportedAt", "exportedFrom", "format", "media", "series", "version", "volunteers"]);
    expect(Object.keys(file.event)).not.toContain("registrations");
    expect(Object.keys(file.event)).not.toContain("volunteers");
    expect(Object.keys(file.event)).not.toContain("invitations");
    expect(Object.keys(file.event.registration)).not.toContain("participants");
  });

  it("is not made when this release could not read it back: too many pictures, or too large", async () => {
    const { event } = await seedRace({}, {}, false);
    const picture = (index: number) => ({ type: "image", attrs: { src: `/api/media/test/${(index + 10).toString(16).padStart(8, "0")}-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp` } });
    await db
      .update(eventTranslations)
      .set({ bodyJson: { type: "doc", content: Array.from({ length: 61 }, (_, index) => picture(index)) } })
      .where(and(eq(eventTranslations.eventId, event.id), eq(eventTranslations.locale, "ro")));
    expect(await codeOf(exportEvent(db, { actor: admin, eventId: event.id }))).toBe("VALIDATION_ERROR");

    await db
      .update(eventTranslations)
      .set({ bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(800_000) }] }] } })
      .where(and(eq(eventTranslations.eventId, event.id), eq(eventTranslations.locale, "ro")));
    expect(await codeOf(exportEvent(db, { actor: admin, eventId: event.id }))).toBe("VALIDATION_ERROR");
    // Nothing was recorded for a file that was not made.
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "event.exported"))).toHaveLength(0);
  });

  it("is refused for a role below Administrator, and for an event that does not exist", async () => {
    const { event } = await seedRace();
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV"] as const) {
      expect(await codeOf(exportEvent(db, { actor: { id: admin.id, role }, eventId: event.id })), role).toBe("FORBIDDEN");
    }
    expect(await codeOf(exportEvent(db, { actor: admin, eventId: "00000000-0000-4000-8000-000000000001" }))).toBe("NOT_FOUND");
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "event.exported"))).toHaveLength(0);
  });

  it("says a series' rule and never applies it: a date of a series imported is one date", async () => {
    const { event } = await seedRace({ type: "GROUP_RUN", registrationMode: "NONE", capacity: "", participantListVisibility: "HIDDEN", declarationDocumentId: "", hiddenListEnabled: false, hiddenListBibStart: "" }, {}, false);
    await repeatEvent(db, { actor: admin, eventId: event.id, rule: { cadence: "WEEKLY", weekdays: [1], until: null, publish: false }, now: NOW });
    const source = await fileOf(event.id);
    expect(source.series.partOfASeries).toBe(true);
    // The rule is said (the source's own weekday is added to the one asked for); it is information, not an instruction.
    expect(source.series.rule).toMatchObject({ cadence: "WEEKLY", until: null });
    expect(source.series.rule?.weekdays).toContain(1);

    const before = (await db.select().from(events)).length;
    const result = await importEventAsNew(db, { actor: admin, file: source, fetchImpl: serving(), now: NOW });
    expect((await db.select().from(events)).length).toBe(before + 1);
    const copy = await reload(result.eventId);
    expect(copy.repeatRule).toBeNull();
    expect(copy.repeatOf).toBeNull();
    expect(result.notes.map((note) => note.code)).toContain("seriesNotApplied");
  });
});

// --- Import as a new event --------------------------------------------------------------------

describe("import as a new event", () => {
  it("makes a draft whose configuration is the file's: export, import, export is the same configuration", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const assetsBefore = (await db.select().from(mediaAssets)).length;

    const result = await importEventAsNew(db, { actor: admin, file, fetchImpl: serving(), now: NOW });

    const created = await reload(result.eventId);
    expect(created.editorialStatus).toBe("DRAFT");
    expect(created.publishedAt).toBeNull();
    expect(created.featured).toBe(false);
    expect(created.createdByStaffUserId).toBe(admin.id);
    expect(created.id).not.toBe(event.id);

    // Both languages' slugs were taken by the source, so the copy's carry a suffix and the page says so.
    expect(result.slugs).toEqual({ ro: "cursa-de-toamna-2", en: "autumn-race-2" });
    expect(result.notes.filter((note) => note.code === "slugSuffixed")).toHaveLength(2);

    // The pictures are this environment's own copies: three new stored pictures, none the source's.
    expect(result.media).toEqual({ copied: 3, reused: 0, problems: [] });
    expect((await db.select().from(mediaAssets)).length).toBe(assetsBefore + 3);
    expect(created.coverMediaAssetId).not.toBe(event.coverMediaAssetId);

    // The configuration is the same, but for the two slugs: compared by the bytes of the pictures.
    const back = await exportEvent(db, { actor: admin, eventId: created.id, now: NOW });
    const digestsOf = (entries: EventFile["media"]) => new Map(entries.map((entry) => [entry.url, entry.sha256]));
    const original = digestsOf(file.media);
    const copy = digestsOf(back.file.media);
    const changes = diffConfigs(
      comparable(back.file.event, (url) => copy.get(url) ?? null),
      comparable(file.event, (url) => original.get(url) ?? null),
    );
    expect(changes.map((change) => change.key).sort()).toEqual(["translations.en.slug", "translations.ro.slug"]);
    expect(back.file.media.map((entry) => entry.sha256).sort()).toEqual(file.media.map((entry) => entry.sha256).sort());

    const rows = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "event.imported_as_new"), eq(auditLogs.entityId, created.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0].metadataJson).toMatchObject({ from: { environment: "test" }, copied: 3, missing: 0 });
  });

  /** What each kind of event makes of the round trip: only the slugs differ, whatever the shape of the event. */
  const SHAPES: Array<[string, Record<string, unknown>, { ro?: Record<string, unknown>; en?: Record<string, unknown> }]> = [
    ["a date still to be announced", { dateToBeAnnounced: true, startsAtWallTime: "", durationMinutes: "", raceStartsAtWallTime: "", registrationOpensAtWallTime: "", registrationOpensSoon: true, scheduleRows: [], participantListVisibility: "HIDDEN" }, {}],
    ["an hour still to be announced", { timeToBeAnnounced: true, startsAtWallTime: "2026-11-21", durationMinutes: "", raceStartsAtWallTime: "", registrationOpensAtWallTime: "", registrationOpensSoon: true, scheduleRows: [] }, {}],
    ["a place still to be announced", { locationToBeAnnounced: true, locationName: "", locationNameEn: "", mapUrl: "", coordinates: "" }, {}],
    ["a race registered elsewhere", { registrationMode: "EXTERNAL", capacity: "", waitlistMode: "UNLIMITED", waitlistCapacity: "", declarationDocumentId: "", participantListVisibility: "HIDDEN", hiddenListEnabled: false, hiddenListBibStart: "", registrationOpensAtWallTime: "", registrationClosesAtWallTime: "", externalProvider: "Altă platformă", externalRegistrationUrl: "https://reg.example.test/x", costType: "PAID", costAmount: "50 lei" }, { ro: { discountNote: "10% pentru membri" }, en: { discountNote: "10% for members" } }],
    ["a group run that offers its declaration", { type: "GROUP_RUN", surface: "ASPHALT", offersGroupRunDeclaration: true, registrationMode: "NONE", capacity: "", declarationDocumentId: "", participantListVisibility: "HIDDEN", hiddenListEnabled: false, hiddenListBibStart: "", nightOverride: true, membersOnly: true, isSpecial: false }, {}],
    ["an event with the club's own weather text and no difficulty", { weatherMode: "custom", difficulty: "", costType: "FREE", costAmount: "", costUrl: "", coHosts: [], links: [], routeStrava: "", routeGarmin: "", coordinates: "" }, { ro: { weatherNote: "Ploaie" }, en: { weatherNote: "Rain" } }],
  ];

  it.each(SHAPES)("round-trips %s", async (_name, overrides, extraTexts) => {
    const { event } = await seedRace(overrides, extraTexts, false);
    const file = await fileOf(event.id);
    const result = await importEventAsNew(db, { actor: admin, file, fetchImpl: serving(), now: NOW });
    const copy = await exportEvent(db, { actor: admin, eventId: result.eventId, now: NOW });
    const changes = diffConfigs(copy.file.event, file.event);
    expect(changes.map((change) => change.key).sort()).toEqual(["translations.en.slug", "translations.ro.slug"]);
    const created = await reload(result.eventId);
    expect(created.editorialStatus).toBe("DRAFT");
    expect(created.startsAt.toISOString()).toBe((await reload(event.id)).startsAt.toISOString());
    expect(created.dateToBeAnnounced).toBe((await reload(event.id)).dateToBeAnnounced);
  });

  it("§753 carries «Clubul pe lista publică» in the file (publicList.club); a file made before it existed imports with the default", async () => {
    const { event } = await seedRace({ publicListClub: "hidden" }, {}, false);
    expect((await reload(event.id)).publicListClub).toBe("hidden");
    const file = await fileOf(event.id);
    expect(file.event.publicList.club).toBe("hidden");

    const created = await importEventAsNew(db, { actor: admin, file, fetchImpl: serving(), now: NOW });
    expect((await reload(created.eventId)).publicListClub).toBe("hidden");

    // A file written before the setting existed has no `club`: it still reads, and takes the default.
    const old = JSON.parse(JSON.stringify(file)) as { event: { publicList: Record<string, unknown> } };
    delete old.event.publicList.club;
    const read = readEventFile(JSON.stringify(old));
    if (!read.ok) throw new Error(`an older file did not read: ${read.refusal} ${read.detail ?? ""}`);
    expect(read.file.event.publicList.club).toBe("members_only");
    const older = await importEventAsNew(db, { actor: admin, file: read.file, fetchImpl: serving(), now: NOW });
    expect((await reload(older.eventId)).publicListClub).toBe("members_only");

    // The diff names the setting when the two sides differ in it.
    expect(diffConfigs(read.file.event, file.event).map((change) => change.key)).toContain("publicList.club");
  });

  it("§764 carries the volunteer badges' design, never a role: as a new event, over one, and from a file made before it", async () => {
    const { event } = await seedRace({}, {}, false);
    const badge = { ...DEFAULT_BADGE_DESIGN, size: "strip100", titleRo: "Crosul", titleEn: "The cross", cutMarks: false };
    await db.update(events).set({ badgeDesign: badge }).where(eq(events.id, event.id));
    const file = await fileOf(event.id);
    expect(file.event.badges.design).toEqual(badge);

    const created = await importEventAsNew(db, { actor: admin, file, fetchImpl: serving(), now: NOW });
    expect(readBadgeDesign((await reload(created.eventId)).badgeDesign)).toEqual(badge);

    // Over another event: the diff names the badge's settings, and the import writes them.
    const { target } = await seedTarget();
    const diff = await diffEventImport(db, { actor: admin, file, eventId: target.id });
    expect(diff.changes.map((change) => change.key)).toEqual(expect.arrayContaining(["badges.design.size", "badges.design.titleRo", "badges.design.cutMarks"]));
    const over = await importEventOver(db, await overInput(file, target.id));
    expect(over.changed).toContain("badges.design.size");
    expect(readBadgeDesign((await reload(target.id)).badgeDesign)).toEqual(badge);

    // A file written before the badges existed reads, as the platform's own badge, and leaves a new event's column null.
    const old = JSON.parse(JSON.stringify(file)) as { event: Record<string, unknown> };
    delete old.event.badges;
    const read = readEventFile(JSON.stringify(old));
    if (!read.ok) throw new Error(`an older file did not read: ${read.refusal} ${read.detail ?? ""}`);
    expect(read.file.event.badges.design).toEqual(DEFAULT_BADGE_DESIGN);
    const older = await importEventAsNew(db, { actor: admin, file: read.file, fetchImpl: serving(), now: NOW });
    expect((await reload(older.eventId)).badgeDesign).toBeNull();
  });

  it("§764 reads an imported badge design forgivingly: an unreadable band colour and a key from a later release neither throw nor refuse", async () => {
    const { event } = await seedRace({}, {}, false);
    const file = await fileOf(event.id);
    // Hand-edited, or written by a later release: a grey no word reads on, and a setting this release has never heard of.
    const edited = JSON.parse(JSON.stringify(file)) as { event: { badges: { design: Record<string, unknown> } } };
    edited.event.badges.design = { ...DEFAULT_BADGE_DESIGN, size: "strip100", bandColour: "#777777", laterSetting: "x" };
    const read = readEventFile(JSON.stringify(edited));
    if (!read.ok) throw new Error(`a forgiving file did not read: ${read.refusal} ${read.detail ?? ""}`);

    const created = await importEventAsNew(db, { actor: admin, file: read.file, fetchImpl: serving(), now: NOW });
    const stored = readBadgeDesign((await reload(created.eventId)).badgeDesign);
    expect(stored).toMatchObject({ size: "strip100", bandColour: null });
    expect(JSON.stringify((await reload(created.eventId)).badgeDesign)).not.toContain("laterSetting");

    // Over another event: the diff names the settings it understands and nothing for the one it does not.
    const { target } = await seedTarget();
    const diff = await diffEventImport(db, { actor: admin, file: read.file, eventId: target.id });
    const keys = diff.changes.map((change) => change.key);
    expect(keys).toContain("badges.design.size");
    expect(keys).not.toContain("badges.design.bandColour");
    expect(keys.filter((key) => key.startsWith("badges.design.") && key.includes("later"))).toEqual([]);
    const over = await importEventOver(db, await overInput(read.file, target.id));
    expect(over.changed).toContain("badges.design.size");
    expect(readBadgeDesign((await reload(target.id)).badgeDesign)).toMatchObject({ size: "strip100", bandColour: null });
  });

  it("keeps a design saved as the platform's own as the platform's own (null), not as an explicit copy of it", async () => {
    const { event } = await seedRace({ bibDesign: undefined }, {}, false);
    expect((await reload(event.id)).bibDesign).toBeNull();
    const plain = await importEventAsNew(db, { actor: admin, file: await fileOf(event.id), fetchImpl: serving(), now: NOW });
    expect((await reload(plain.eventId)).bibDesign).toBeNull();
  });

  it("copies the GPX byte for byte under a key of its own, with its name", async () => {
    const track = Buffer.from(`<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg><trkpt lat="45.63" lon="25.59"/></trkseg></trk></gpx>`);
    const gpx = await storeRouteGpx(getStorage(), { bytes: track, name: "Traseu Tâmpa.gpx", environment: "test", now: NOW });
    const { event } = await seedRace({ routeGpx: JSON.stringify(gpx) }, {}, false);
    const file = await fileOf(event.id);

    expect(file.event.route.gpx).toMatchObject({ name: "Traseu Tâmpa.gpx" });
    const entry = file.media.find((candidate) => candidate.role === "route.gpx");
    expect(entry).toMatchObject({ contentType: "application/gpx+xml", size: track.byteLength });

    const result = await importEventAsNew(db, { actor: admin, file, fetchImpl: serving(), now: NOW });
    expect(result.media).toEqual({ copied: 1, reused: 0, problems: [] });
    const copy = (await reload(result.eventId)).routeGpx as { key: string; name: string; size: number };
    expect(copy.name).toBe("Traseu Tâmpa.gpx");
    expect(copy.key).not.toBe(gpx.key);
    expect(copy.key).toMatch(/^test\/route-gpx\/[0-9a-f-]{36}\/traseu-tampa\.gpx$/);
    expect((await getStorage().get(copy.key))?.equals(track)).toBe(true);
  });

  it("is always unpublished, whatever state the source was in", async () => {
    const { event } = await seedRace();
    await publishEvent(db, { actor: admin, eventId: event.id, expectedVersion: event.version, now: NOW });
    expect((await reload(event.id)).editorialStatus).toBe("PUBLISHED");
    const result = await importEventAsNew(db, { actor: admin, file: await fileOf(event.id), fetchImpl: serving(), now: NOW });
    const created = await reload(result.eventId);
    expect(created.editorialStatus).toBe("DRAFT");
    expect(created.publishedAt).toBeNull();
  });

  it("leaves a medium it cannot verify empty and lists it — a wrong hash, a wrong size, an unreachable address", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const [cover, header, body] = ["cover", "bib.header", "text.ro.body"].map((role) => file.media.find((entry) => entry.role.startsWith(role)) as EventFile["media"][number]);

    // The right size and the wrong bytes: the stored picture with its last byte changed.
    const stored = (await getStorage().get(storeKeyOfUrl(cover.url, "image") as string)) as Buffer;
    const wrongHash = Buffer.from(stored);
    wrongHash[wrongHash.length - 1] ^= 0xff;
    const result = await importEventAsNew(db, {
      actor: admin,
      file,
      fetchImpl: serving({ [cover.url]: wrongHash, [header.url]: null, [body.url]: Buffer.concat([pictureBytes, Buffer.from("x")]) }),
      now: NOW,
    });

    expect(result.media.copied).toBe(0);
    expect(result.media.problems.map((problem) => problem.reason).sort()).toEqual(["hashMismatch", "sizeMismatch", "unreachable"]);
    const created = await reload(result.eventId);
    expect(created.coverMediaAssetId).toBeNull();
    expect(JSON.stringify(created.bibDesign)).not.toContain("/web.webp");
    expect(JSON.stringify((await texts(result.eventId)).map((row) => row.bodyJson))).not.toContain("/web.webp");
    // The event itself is there, a draft, with everything else.
    expect(created.editorialStatus).toBe("DRAFT");
    expect(created.capacity).toBe(100);
  });

  it("copies nothing from an address that is not one of this site's own objects", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const cover = file.media.find((entry) => entry.role === "cover") as EventFile["media"][number];
    const hostile: EventFile = JSON.parse(JSON.stringify(file));
    hostile.media = hostile.media.map((entry) => (entry.url === cover.url ? { ...entry, url: "https://files.example.test/some/other/path.png" } : entry));
    hostile.event.cover = { url: "https://files.example.test/some/other/path.png", crop: null };
    const result = await importEventAsNew(db, { actor: admin, file: hostile, fetchImpl: serving({ "https://files.example.test/some/other/path.png": pictureBytes }), now: NOW });
    expect(result.media.problems).toContainEqual({ role: "cover", roleKey: "cover", reason: "refused" });
    expect((await reload(result.eventId)).coverMediaAssetId).toBeNull();
  });

  it("switches the public list off where the privacy notice that describes it is not in force, and says so", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    expect(file.event.publicList.names).toBe(true);
    // The notice is withdrawn here: the list is a disclosure and the notice must describe it first (BR-REQ-039-01).
    await db.update(legalDocuments).set({ withdrawnAt: NOW }).where(eq(legalDocuments.key, "PRIVACY_NOTICE"));
    const result = await importEventAsNew(db, { actor: admin, file, fetchImpl: serving(), now: NOW });
    expect(result.notes.map((note) => note.code)).toContain("publicListOff");
    expect((await reload(result.eventId)).participantListVisibility).toBe("HIDDEN");
  });

  it("is refused for a role below Administrator, and writes nothing", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const before = (await db.select().from(events)).length;
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV"] as const) {
      expect(await codeOf(importEventAsNew(db, { actor: { id: admin.id, role }, file, fetchImpl: serving() })), role).toBe("FORBIDDEN");
    }
    expect((await db.select().from(events)).length).toBe(before);
  });
});

// --- Import over an event ---------------------------------------------------------------------

/** A second race, unlike the first in a handful of fields, published, with people registered. */
async function seedTarget() {
  const { event } = await seedRace(
    { capacity: "50", locationName: "Alt loc", locationNameEn: "Another place", bibStartNumber: "200", hiddenListBibStart: "900", isSpecial: false },
    { ro: { slug: "alta-cursa", title: "Altă cursă", body: doc("Alt text."), rules: doc("Alt regulament.") }, en: { slug: "another-race", title: "Another race", body: doc("Other text."), rules: doc("Other rules.") } },
    false,
  );
  await publishEvent(db, { actor: admin, eventId: event.id, expectedVersion: event.version, now: NOW });
  const people = await registerPeople(event.id, [
    { name: "Ana Lemn", email: "ana.lemn@example.test", status: "CONFIRMED", bib: 201 },
    { name: "Bogdan Nuc", email: "bogdan.nuc@example.test", status: "CONFIRMED", bib: 202 },
    { name: "Carla Stejar", email: "carla.stejar@example.test", status: "PENDING_DECLARATION" },
  ]);
  return { target: await reload(event.id), people };
}

async function overInput(file: EventFile, targetId: string, extra: Partial<Parameters<typeof importEventOver>[1]> = {}) {
  const diff = await diffEventImport(db, { actor: admin, file, eventId: targetId });
  return {
    actor: admin,
    file,
    eventId: targetId,
    expectedVersion: diff.target.version,
    translationVersions: diff.target.translationVersions,
    fetchImpl: serving(),
    now: NOW,
    ...extra,
  } satisfies Parameters<typeof importEventOver>[1];
}

describe("import over an existing event", () => {
  it("shows every field that would change, both sides, and nothing that would not", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const { target } = await seedTarget();

    const diff = await diffEventImport(db, { actor: admin, file, eventId: target.id });
    const keys = diff.changes.map((change) => change.key);
    expect(keys).toContain("registration.capacity");
    expect(keys).toContain("translations.ro.title");
    expect(keys).toContain("translations.en.title");
    expect(keys).toContain("place.name.ro");
    expect(keys).toContain("place.name.en");
    expect(keys).toContain("bib.startNumber");
    expect(keys).toContain("isSpecial");
    expect(keys).toContain("cover.url");
    // What the two share is not in the diff.
    expect(keys).not.toContain("type");
    expect(keys).not.toContain("timezone");
    expect(keys).not.toContain("registration.minAge");
    const capacity = diff.changes.find((change) => change.key === "registration.capacity");
    expect(capacity?.from).toEqual({ type: "text", value: "50" });
    expect(capacity?.to).toEqual({ type: "text", value: "100" });
    const title = diff.changes.find((change) => change.key === "translations.ro.title");
    expect(title).toMatchObject({ label: "translations.title", locale: "ro", to: { type: "text", value: "Cursa de toamnă" } });
    expect(diff.target).toMatchObject({ published: true, registrations: 3 });
    expect(diff.media.every((entry) => entry.state === "copy")).toBe(true);
    expect(diff.refusal).toBeNull();
    // Reading it changed nothing.
    expect((await reload(target.id)).capacity).toBe(50);
  });

  it("changes only the fields the diff shows, through the editor's save, and touches nothing of the people", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const { target, people } = await seedTarget();
    const rowsBefore = await db.select().from(registrations).where(eq(registrations.eventId, target.id)).orderBy(asc(registrations.registeredName));
    const participantsBefore = await db.select().from(participants).orderBy(asc(participants.defaultName));

    const result = await importEventOver(db, await overInput(file, target.id));

    expect(result.changed).toContain("registration.capacity");
    const after = await reload(target.id);
    expect(after.capacity).toBe(100);
    expect(after.bibStartNumber).toBe(100);
    expect(after.isSpecial).toBe(true);
    expect(after.locationName).toBe("Poiana Brașov");
    // The event's state is not the file's to move.
    expect(after.editorialStatus).toBe("PUBLISHED");
    expect(after.publishedAt?.toISOString()).toBe(target.publishedAt?.toISOString());
    expect(after.eventStatus).toBe(target.eventStatus);
    expect(after.featured).toBe(target.featured);
    // The save is the editor's: the version moved once, and the cover was audited as a save does.
    expect(after.version).toBe(target.version + 1);
    const cover = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "event.cover_changed"), eq(auditLogs.entityId, target.id)));
    expect(cover).toHaveLength(1);
    // Its words are the file's; its published page addresses stay (a public address is never changed by a save).
    const rows = await texts(target.id);
    expect(rows.find((row) => row.locale === "ro")?.title).toBe("Cursa de toamnă");
    expect(rows.map((row) => row.slug).sort()).toEqual(["alta-cursa", "another-race"]);
    // The people: every registration, participant and number exactly as they were.
    const rowsAfter = await db.select().from(registrations).where(eq(registrations.eventId, target.id)).orderBy(asc(registrations.registeredName));
    expect(rowsAfter).toEqual(rowsBefore);
    expect(rowsAfter.map((row) => row.bibNumber)).toEqual([201, 202, null]);
    expect(await db.select().from(participants).orderBy(asc(participants.defaultName))).toEqual(participantsBefore);
    expect(people).toHaveLength(3);

    const trail = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "event.imported_over"), eq(auditLogs.entityId, target.id)));
    expect(trail).toHaveLength(1);
    expect(trail[0].metadataJson).toMatchObject({ registrations: 3, copied: 3 });
    // The trail names the fields and never a value or a person.
    expect(JSON.stringify(trail[0].metadataJson)).not.toContain("Ana");
    expect(JSON.stringify(trail[0].metadataJson)).not.toContain("Poiana");

    // Imported again, there is nothing left to change and nothing is written.
    const again = await importEventOver(db, await overInput(file, target.id));
    expect(again.changed).toEqual([]);
    expect((await reload(target.id)).version).toBe(after.version);
  });

  it("reuses a picture the event already holds, by the hash of its bytes, instead of copying it again", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const { target } = await seedTarget();
    await importEventOver(db, await overInput(file, target.id));
    const assets = (await db.select().from(mediaAssets)).length;

    // Change one word in the source and bring it over again: the three pictures are the same bytes.
    const edited: EventFile = JSON.parse(JSON.stringify(file));
    edited.event.translations.ro.title = "Cursa de toamnă 2026";
    const result = await importEventOver(db, await overInput(edited, target.id));
    expect(result.changed).toEqual(["translations.ro.title"]);
    expect(result.media).toEqual({ copied: 0, reused: 3, problems: [] });
    expect((await db.select().from(mediaAssets)).length).toBe(assets);
  });

  it("lowers nothing below the places already taken, and writes nothing when it refuses", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const { target } = await seedTarget();
    const small: EventFile = JSON.parse(JSON.stringify(file));
    small.event.registration.capacity = 1;
    small.event.hiddenList = { enabled: false, bibStart: null, counted: false, public: false };

    expect(await codeOf(importEventOver(db, await overInput(small, target.id)))).toBe("VALIDATION_ERROR");
    const after = await reload(target.id);
    expect(after.capacity).toBe(50);
    expect(after.version).toBe(target.version);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "event.imported_over"))).toHaveLength(0);
  });

  it("raises the places through the allocator, which reports the offers it makes to the waiting list", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const { target } = await seedTarget();
    const result = await importEventOver(db, await overInput(file, target.id));
    // Nobody waits here, so no offer was made; the number is the allocator's to report either way.
    expect(result.offered).toBe(0);
    expect((await reload(target.id)).capacity).toBe(100);
  });

  it("refuses a file that would leave a published event incomplete, naming what is missing, and changes nothing", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const { target } = await seedTarget();
    const broken: EventFile = JSON.parse(JSON.stringify(file));
    broken.event.translations.en.excerpt = null;
    broken.event.translations.en.excerptBody = null;

    const diff = await diffEventImport(db, { actor: admin, file: broken, eventId: target.id });
    expect(diff.refusal).toMatch(/en: excerpt/);
    expect(await codeOf(importEventOver(db, await overInput(broken, target.id)))).toBe("VALIDATION_ERROR");
    const after = await reload(target.id);
    expect(after.version).toBe(target.version);
    expect(after.capacity).toBe(50);
    expect(after.editorialStatus).toBe("PUBLISHED");
    expect((await texts(target.id)).find((row) => row.locale === "en")?.excerpt).toBe("Fast.");

    // The same file over a draft is fine: a draft is not a promise.
    await db.update(events).set({ editorialStatus: "DRAFT" }).where(eq(events.id, target.id));
    const fresh = await reload(target.id);
    expect(await codeOf(importEventOver(db, { ...(await overInput(broken, target.id)), expectedVersion: fresh.version }))).toBe("none");
  });

  it("is a conflict when the event or a language was saved since the diff was shown", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const { target } = await seedTarget();
    const input = await overInput(file, target.id);
    await db.update(events).set({ version: target.version + 1 }).where(eq(events.id, target.id));
    expect(await codeOf(importEventOver(db, input))).toBe("CONFLICT");
    expect((await reload(target.id)).capacity).toBe(50);
  });

  it("asks again where it is production: the title typed, and the registrations the diff was shown with", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const { target } = await seedTarget();
    const base = await overInput(file, target.id, { environment: "production" });

    expect(await codeOf(importEventOver(db, base))).toBe("VALIDATION_ERROR");
    expect(await codeOf(importEventOver(db, { ...base, confirmation: { typedTitle: "Altă cursă", registrations: 2 } }))).toBe("VALIDATION_ERROR");
    expect(await codeOf(importEventOver(db, { ...base, confirmation: { typedTitle: "altă cursă", registrations: 3 } }))).toBe("VALIDATION_ERROR");
    expect((await reload(target.id)).capacity).toBe(50);

    expect(await codeOf(importEventOver(db, { ...base, confirmation: { typedTitle: "Another race", registrations: 3 } }))).toBe("none");
    expect((await reload(target.id)).capacity).toBe(100);
  });

  it("is refused outright where a picture cannot be copied, so nothing the event holds is emptied", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const { target } = await seedTarget();
    const cover = file.media.find((entry) => entry.role === "cover") as EventFile["media"][number];
    const input = await overInput(file, target.id, { fetchImpl: serving({ [cover.url]: null }) });

    expect(await codeOf(importEventOver(db, input))).toBe("VALIDATION_ERROR");
    const after = await reload(target.id);
    expect(after.capacity).toBe(50);
    expect(after.version).toBe(target.version);
  });

  it("refuses a page address another event already has, and a role below Administrator", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const { target } = await seedTarget();
    // The target is a draft with room to take the file's page addresses, which the source already holds.
    await db.update(events).set({ editorialStatus: "DRAFT", publishedAt: null }).where(eq(events.id, target.id));
    expect(await codeOf(importEventOver(db, await overInput(file, target.id)))).toBe("VALIDATION_ERROR");

    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV"] as const) {
      expect(await codeOf(diffEventImport(db, { actor: { id: admin.id, role }, file, eventId: target.id })), role).toBe("FORBIDDEN");
      expect(await codeOf(importEventOver(db, { ...(await overInput(file, target.id)), actor: { id: admin.id, role } })), role).toBe("FORBIDDEN");
    }
  });

  it("reads the same configuration back from the target after an import over it", async () => {
    const { event } = await seedRace();
    const file = await fileOf(event.id);
    const { target } = await seedTarget();
    await importEventOver(db, await overInput(file, target.id));
    const read = await readEventConfig(db, target.id);
    expect(read?.config.registration.capacity).toBe(100);
    const after = await diffEventImport(db, { actor: admin, file, eventId: target.id });
    expect(after.changes).toEqual([]);
  });
});

// --- An event's volunteers are not the file's (§754) -------------------------------------------

/**
 * The volunteers' card (§754): the **people** are no part of the file — they are personal data — nor is the tick «Primește voluntari»,
 * which belongs to one date (a copy of an event starts with the tick off, like the to-dos, §749). The volunteers' **categories and
 * roles** are (§NNN, amending §751 and §754): their words, the contact person the club published for each category, never a person —
 * written to a new event by the card's own services, and never applied over an existing event.
 */
describe("an event's volunteers are not the file's — only their categories and roles are", () => {
  async function withVolunteers(eventId: string) {
    await db.update(events).set({ acceptsVolunteers: true, volunteersShirts: true, volunteersShowCounts: true }).where(eq(events.id, eventId));
    const [role] = await db
      .insert(eventVolunteerRoles)
      .values({ eventId, nameRo: "Punct de apă Zmeură", nameEn: "Water point Raspberry", needed: 3, descriptionRo: "Pahare la km 5", descriptionEn: "Cups at km 5" })
      .returning();
    await db.insert(eventVolunteers).values({
      eventId,
      roleId: role.id,
      name: "Vlad Voluntarescu",
      email: "vlad.voluntarescu@example.test",
      canonicalEmail: "vlad.voluntarescu@example.test",
      canonicalizationVersion: 1,
      phone: "+40712345678",
      source: "PUBLIC",
      message: "Am mai ajutat la cursă",
    });
    return role;
  }

  it("carries no person, no tick and no id — the role's own words are the file's", async () => {
    const { event } = await seedRace();
    const role = await withVolunteers(event.id);
    const file = await fileOf(event.id);
    const text = JSON.stringify(file);
    for (const needle of ["Voluntarescu", "vlad.voluntarescu", "+40712345678", "Am mai ajutat", role.id, "acceptsVolunteers", "showCounts", "show_counts", "volunteersShirts"]) {
      expect(text, needle).not.toContain(needle);
    }
    // The role's words are there — both names, how many it needs — and nothing else of it.
    expect(file.volunteers.roles).toEqual([{ name: { ro: "Punct de apă Zmeură", en: "Water point Raspberry" }, needed: 3, description: { ro: null, en: null }, colour: null, category: null }]);
    expect(file.volunteers.categories).toEqual([]);
  });

  it("starts an event imported as new with the roles and the tick off — no person —, and leaves the target's own alone on an import over it", async () => {
    const { event } = await seedRace();
    await withVolunteers(event.id);
    const file = await fileOf(event.id);

    const created = await importEventAsNew(db, { actor: admin, file, fetchImpl: serving(), now: NOW });
    expect((await reload(created.eventId)).acceptsVolunteers).toBe(false);
    expect((await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, created.eventId))).map((row) => [row.nameRo, row.needed])).toEqual([["Punct de apă Zmeură", 3]]);
    expect(await db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, created.eventId))).toEqual([]);

    const { target } = await seedTarget();
    const targetRole = await withVolunteers(target.id);
    const diff = await diffEventImport(db, { actor: admin, file, eventId: target.id });
    expect(diff.changes.map((change) => change.key).filter((key) => /volunteer/i.test(key))).toEqual([]);
    await importEventOver(db, await overInput(file, target.id));
    expect((await reload(target.id)).acceptsVolunteers).toBe(true);
    expect((await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, target.id))).map((row) => row.id)).toEqual([targetRole.id]);
    expect(await db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, target.id))).toHaveLength(1);
  });

  it("carries the tick «Arată public câți voluntari mai sunt necesari» in no direction (§NNN): a public number is the club's choice for one date, so the file has none, an import as new shows none and an import over leaves the target's own", async () => {
    const { event } = await seedRace();
    await withVolunteers(event.id);
    // The tick is on for the source event, and the file says nothing of it, nor of the volunteers' shirts or switch.
    expect((await reload(event.id)).volunteersShowCounts).toBe(true);
    const file = await fileOf(event.id);
    expect(JSON.stringify(file)).not.toMatch(/showCounts|show_counts|acceptsVolunteers|volunteersShirts/i);

    const created = await importEventAsNew(db, { actor: admin, file, fetchImpl: serving(), now: NOW });
    expect((await reload(created.eventId)).volunteersShowCounts).toBe(false);

    // Over a target whose club ticked it, and over one whose club did not: each keeps its own choice.
    const { target } = await seedTarget();
    await db.update(events).set({ volunteersShowCounts: true }).where(eq(events.id, target.id));
    await importEventOver(db, await overInput(file, target.id));
    expect((await reload(target.id)).volunteersShowCounts).toBe(true);
    await db.update(events).set({ volunteersShowCounts: false }).where(eq(events.id, target.id));
    await importEventOver(db, await overInput(file, target.id));
    expect((await reload(target.id)).volunteersShowCounts).toBe(false);
  });
});

/**
 * §NNN — the volunteers' categories and roles in the file: the words and the contact person the club published for each category, never a
 * person; a role names its category by its place in the list, never by an id; written to a new event through the card's own services and
 * read forgivingly; an import over an existing event leaves its roles as they are.
 */
describe("§NNN the volunteers' categories and roles in the file", () => {
  async function withCategories(eventId: string) {
    const [start, route] = await db
      .insert(eventVolunteerCategories)
      .values([
        { eventId, nameRo: "Start / Sosire", nameEn: "Start / Finish", sort: 0 },
        { eventId, nameRo: "Traseu", nameEn: "Route", sort: 1, contactName: "Ana Popescu", contactPhone: "+40712345678", contactEmail: "coordonator@club.test" },
      ])
      .returning();
    const paragraph = (text: string) => ({ type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }] });
    await db.insert(eventVolunteerRoles).values([
      { eventId, categoryId: start.id, nameRo: "Direcționare", nameEn: "Guidance", needed: 2, position: 0 },
      {
        eventId,
        categoryId: route.id,
        nameRo: "Direcționare",
        nameEn: "Guidance",
        needed: 4,
        position: 1,
        colour: "#c62828",
        descriptionRoJson: paragraph("Arăți drumul pe traseu"),
        descriptionEnJson: paragraph("Show the way on the route"),
        descriptionWordsRo: "Arăți drumul pe traseu",
        descriptionWordsEn: "Show the way on the route",
      },
      { eventId, categoryId: null, nameRo: "Foto/Video", nameEn: "Photo/Video", needed: 1, position: 2 },
    ]);
    return { start, route };
  }

  it("carries the categories in the club's order with their contact, and each role with its category by place — no id, no person", async () => {
    const { event } = await seedRace();
    const { start, route } = await withCategories(event.id);
    const file = await fileOf(event.id);
    expect(file.volunteers.categories).toEqual([
      { name: { ro: "Start / Sosire", en: "Start / Finish" }, contact: null },
      { name: { ro: "Traseu", en: "Route" }, contact: { name: "Ana Popescu", phone: "+40712345678", email: "coordonator@club.test" } },
    ]);
    expect(file.volunteers.roles.map((role) => [role.name.ro, role.needed, role.category])).toEqual([
      ["Direcționare", 2, 0],
      ["Direcționare", 4, 1],
      ["Foto/Video", 1, null],
    ]);
    expect(file.volunteers.roles[1]).toMatchObject({ colour: "#c62828", description: { ro: { type: "doc" }, en: { type: "doc" } } });
    const text = JSON.stringify(file.volunteers);
    for (const id of [start.id, route.id, event.id]) expect(text).not.toContain(id);
  });

  it("makes the same configuration after a round trip — export, import as new, export — with the roles under their categories, the tick off and nobody on them", async () => {
    const { event } = await seedRace();
    await withCategories(event.id);
    const file = await fileOf(event.id);
    const created = await importEventAsNew(db, { actor: admin, file, fetchImpl: serving(), now: NOW });
    expect((await reload(created.eventId)).acceptsVolunteers).toBe(false);
    const categories = await db.select().from(eventVolunteerCategories).where(eq(eventVolunteerCategories.eventId, created.eventId)).orderBy(asc(eventVolunteerCategories.sort));
    expect(categories.map((row) => [row.nameRo, row.contactName, row.contactPhone, row.contactEmail])).toEqual([
      ["Start / Sosire", null, null, null],
      ["Traseu", "Ana Popescu", "+40712345678", "coordonator@club.test"],
    ]);
    const roles = await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, created.eventId)).orderBy(asc(eventVolunteerRoles.position));
    expect(roles.map((row) => [row.nameRo, row.categoryId === null ? null : categories.find((category) => category.id === row.categoryId)?.nameRo])).toEqual([
      ["Direcționare", "Start / Sosire"],
      ["Direcționare", "Traseu"],
      ["Foto/Video", null],
    ]);
    // The description's plain words are written with its document, as the card writes them; the colour is kept.
    expect(roles[1]).toMatchObject({ colour: "#c62828", descriptionWordsRo: "Arăți drumul pe traseu", descriptionWordsEn: "Show the way on the route" });
    expect(await readVolunteersFile(db, created.eventId)).toEqual(file.volunteers);
    expect(await db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, created.eventId))).toEqual([]);
    // The trail says how many were written, never what.
    const [imported] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "event.imported_as_new"), eq(auditLogs.entityId, created.eventId)));
    expect(imported.metadataJson).toMatchObject({ volunteerCategories: 2, volunteerRoles: 3 });
    expect(JSON.stringify(imported.metadataJson)).not.toContain("Ana Popescu");
  });

  it("reads the file forgivingly: a category that is not in it is «Alte activități», a contact the card would refuse is left out, a colour no word reads on costs the colour", async () => {
    expect(badgeColourReadable("#808080")).toBe(false);
    const { event } = await seedRace();
    await withCategories(event.id);
    const file = await fileOf(event.id);
    const edited: EventFile = structuredClone(file);
    // The first two roles point at no category of the file; «Foto/Video» keeps none, and a colour that no word reads on.
    edited.volunteers.roles[0].category = 9;
    edited.volunteers.roles[1].category = -1;
    edited.volunteers.roles[1].name = { ro: "Alta", en: "Another" };
    edited.volunteers.roles[2].colour = "#808080";
    edited.volunteers.categories[1].contact = { name: "Ana Popescu", phone: "+40712345678", email: "not an address" };
    const created = await importEventAsNew(db, { actor: admin, file: edited, fetchImpl: serving(), now: NOW });
    const read = await readVolunteersFile(db, created.eventId);
    expect(read.roles.map((role) => [role.name.ro, role.category, role.colour])).toEqual([
      ["Direcționare", null, null],
      ["Alta", null, "#c62828"],
      ["Foto/Video", null, null],
    ]);
    expect(read.categories[1].contact).toBeNull();
    expect(read.categories.map((category) => category.name.ro)).toEqual(["Start / Sosire", "Traseu"]);
  });

  it("skips, without holding up the rest, an entry the card itself would refuse: a name twice under one category", async () => {
    const { event } = await seedRace();
    await withCategories(event.id);
    const file = await fileOf(event.id);
    const edited: EventFile = structuredClone(file);
    edited.volunteers.roles[0].category = 1;
    const created = await importEventAsNew(db, { actor: admin, file: edited, fetchImpl: serving(), now: NOW });
    const read = await readVolunteersFile(db, created.eventId);
    expect(read.roles.map((role) => [role.name.ro, role.category])).toEqual([
      ["Direcționare", 1],
      ["Foto/Video", null],
    ]);
  });

  it("is applied to a new event alone: an import over an existing event leaves its roles and categories exactly as they are", async () => {
    const { event } = await seedRace();
    await withCategories(event.id);
    const file = await fileOf(event.id);
    const { target } = await seedTarget();
    const [mine] = await db.insert(eventVolunteerCategories).values({ eventId: target.id, nameRo: "A mea", nameEn: "Mine", sort: 0 }).returning();
    const [role] = await db.insert(eventVolunteerRoles).values({ eventId: target.id, categoryId: mine.id, nameRo: "Rolul meu", nameEn: "My role", needed: 1 }).returning();
    const diff = await diffEventImport(db, { actor: admin, file, eventId: target.id });
    expect(diff.changes.map((change) => change.key).filter((key) => /volunteer|categor/i.test(key))).toEqual([]);
    await importEventOver(db, await overInput(file, target.id));
    expect((await db.select().from(eventVolunteerCategories).where(eq(eventVolunteerCategories.eventId, target.id))).map((row) => row.id)).toEqual([mine.id]);
    expect((await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, target.id))).map((row) => [row.id, row.categoryId])).toEqual([[role.id, mine.id]]);
  });

  it("reads a file made before the categories as an event with no volunteers to bring, and refuses one shaped wrong", async () => {
    const { event } = await seedRace();
    await withCategories(event.id);
    const file = await fileOf(event.id);
    const { volunteers, ...older } = file;
    expect(volunteers.roles).toHaveLength(3);
    const read = readEventFile(JSON.stringify(older));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.file.volunteers).toEqual({ categories: [], roles: [] });
    const created = await importEventAsNew(db, { actor: admin, file: read.file, fetchImpl: serving(), now: NOW });
    expect(await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, created.eventId))).toEqual([]);

    for (const bad of [
      { ...file, volunteers: { ...file.volunteers, roles: [{ ...file.volunteers.roles[0], needed: 0 }] } },
      { ...file, volunteers: { ...file.volunteers, categories: [{ name: { ro: "x".repeat(81), en: "y" }, contact: null }] } },
      { ...file, volunteers: { ...file.volunteers, extra: true } },
      { ...file, volunteers: { categories: Array.from({ length: 13 }, () => ({ name: { ro: "a", en: "b" }, contact: null })), roles: [] } },
    ]) {
      const refused = readEventFile(JSON.stringify(bad));
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused).toMatchObject({ refusal: "invalid" });
    }
  });
});

// --- The route's checkpoints (§757) ---------------------------------------------------------------

/** Two checkpoints on the seeded race (start 09:00, gun 10:00, «Timp limită» 2 h 30 min — the finish closes at 12:30, 21 km): the hut an hour after the gun, the timing two hours after it. */
async function seedCheckpoints(eventId: string) {
  const row = (index: number, over: Partial<PostedCheckpoint>): PostedCheckpoint => ({
    id: "",
    nameRo: "",
    nameEn: "",
    km: "",
    kinds: [],
    cutoffHours: "",
    cutoffMinutesPart: "",
    noteRo: "",
    noteEn: "",
    remove: false,
    index,
    ...over,
  });
  /** A time limit in minutes as the card's two boxes post it. */
  const limit = (minutes: number) => ({ cutoffHours: String(Math.floor(minutes / 60)), cutoffMinutesPart: String(minutes % 60) });
  await changeCheckpoints(
    db,
    admin,
    {
      kind: "save",
      eventId,
      rows: [
        row(0, { nameRo: "Cronometrare", nameEn: "Timing", km: "15", kinds: ["TIMING"], ...limit(120) }),
        row(1, { nameRo: "Apă la cabană", nameEn: "Water at the hut", km: "7,5", kinds: ["WATER", "FOOD"], ...limit(60), noteRo: "Și banane", noteEn: "Bananas too" }),
      ],
    },
    NOW,
  );
}

describe("§757 the route's checkpoints travel in the file", () => {
  it("are exported by distance with no id, imported as new as they were, and the round trip is the same", async () => {
    const { event } = await seedRace({}, {}, false);
    await seedCheckpoints(event.id);
    const file = await fileOf(event.id);
    expect(file.event.route.checkpoints).toEqual([
      { km: 7.5, name: { ro: "Apă la cabană", en: "Water at the hut" }, kinds: ["WATER", "FOOD"], cutoffMinutes: 60, note: { ro: "Și banane", en: "Bananas too" } },
      { km: 15, name: { ro: "Cronometrare", en: "Timing" }, kinds: ["TIMING"], cutoffMinutes: 120, note: { ro: null, en: null } },
    ]);
    // Minutes, never a time of the day (§770).
    expect(JSON.stringify(file.event.route.checkpoints)).not.toContain('"cutoff"');
    expect(JSON.stringify(file.event.route.checkpoints)).not.toMatch(/"id"/);

    const created = await importEventAsNew(db, { actor: admin, file, fetchImpl: serving(), now: NOW });
    const copied = await listCheckpoints(db, created.eventId);
    expect(copied.map((row) => [row.km, row.nameRo, row.nameEn, row.kinds, row.cutoffMinutes, row.noteRo, row.noteEn])).toEqual([
      [7.5, "Apă la cabană", "Water at the hut", ["WATER", "FOOD"], 60, "Și banane", "Bananas too"],
      [15, "Cronometrare", "Timing", ["TIMING"], 120, null, null],
    ]);
    // The clock follows the start the import wrote: the gun at 10:00, so an hour is 11:00 and two hours 12:00.
    expect(copied.map((row) => row.cutoffClock)).toEqual(["11:00", "12:00"]);
    const back = await fileOf(created.eventId);
    expect(diffConfigs(back.event, file.event).map((change) => change.key).sort()).toEqual(["translations.en.slug", "translations.ro.slug"]);
    // Written as the card writes them, and audited as an import.
    const trail = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "event_checkpoints.changed"), eq(auditLogs.entityId, created.eventId)));
    expect(trail).toHaveLength(1);
    expect(trail[0].metadataJson).toMatchObject({ source: "import", added: 2, removed: 0 });
  });

  it("carries the race's time limit, counted from the gun, and the two bib ticks", async () => {
    const { event } = await seedRace({ bibDesign: { ...DEFAULT_BIB_DESIGN, showProfile: true, showCheckpoints: false, showCheckpointTimes: true } }, {}, false);
    // The gun is at 10:00 and the box said 150 minutes: the finish closes at 12:30 (10:30 UTC).
    expect((await reload(event.id)).endsAt?.toISOString()).toBe("2026-11-21T10:30:00.000Z");
    const file = await fileOf(event.id);
    expect(file.event.durationMinutes).toBe(150);
    expect(file.event.bib.design).toMatchObject({ showCheckpoints: false, showCheckpointTimes: true });
    const created = await importEventAsNew(db, { actor: admin, file, fetchImpl: serving(), now: NOW });
    expect((await reload(created.eventId)).endsAt?.toISOString()).toBe("2026-11-21T10:30:00.000Z");
  });

  it("imports a version 1 file — production's, before this release — with the race's end it had (§757)", async () => {
    const { event } = await seedRace({}, {}, false);
    const file = await fileOf(event.id);
    // Version 1 counted from the 09:00 start: the same 12:30 finish was 210 minutes there, 150 from the 10:00 gun here.
    const old = { ...file, version: 1, event: { ...file.event, durationMinutes: 210 } };
    const read = readEventFile(JSON.stringify(old));
    if (!read.ok) throw new Error(`a version 1 file did not read: ${read.refusal} ${read.detail ?? ""}`);
    expect(read.file.event.durationMinutes).toBe(150);
    const created = await importEventAsNew(db, { actor: admin, file: read.file, fetchImpl: serving(), now: NOW });
    expect((await reload(created.eventId)).endsAt?.toISOString()).toBe("2026-11-21T10:30:00.000Z");
  });

  it("refuses an import over an event that would shorten «Timp limită» under a saved time limit while the file leaves the list as it is (§757, §770)", async () => {
    const { event } = await seedRace({}, {}, false);
    await seedCheckpoints(event.id);
    const { target } = await seedTarget();
    await seedCheckpoints(target.id);
    const file = await fileOf(event.id);
    // An hour and a half from the gun: the timing point's two hours would be longer than the race's.
    const moved = { ...file, event: { ...file.event, durationMinutes: 90 } };
    const diff = await diffEventImport(db, { actor: admin, file: moved, eventId: target.id });
    expect(diff.changes.map((change) => change.key)).not.toContain("route.checkpoints");
    const versionBefore = (await reload(target.id)).version;
    const refused = await importEventOver(db, await overInput(moved, target.id)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(SavedCheckpointsRefusal);
    expect((refused as InstanceType<typeof SavedCheckpointsRefusal>).refusal.reason).toBe("CHECKPOINT_CUTOFF_AFTER_END");
    expect((await reload(target.id)).version).toBe(versionBefore);
    // The same change with a list that fits the shorter limit is the file's own list, written in its place.
    const refitted = JSON.parse(JSON.stringify(moved)) as EventFile;
    refitted.event.route.checkpoints[1].cutoffMinutes = 85;
    await importEventOver(db, await overInput(refitted, target.id));
    expect((await listCheckpoints(db, target.id)).map((row) => row.cutoffMinutes)).toEqual([60, 85]);
  });

  it("lets an import over an event move the gun: the saved time limits stay and their clocks move (§770)", async () => {
    const { event } = await seedRace({}, {}, false);
    await seedCheckpoints(event.id);
    const { target } = await seedTarget();
    await seedCheckpoints(target.id);
    const file = await fileOf(event.id);
    // The gun a quarter of an hour later (10:15): the old rule would have refused a time of day before it.
    const moved = { ...file, event: { ...file.event, raceStartsAt: "2026-11-21T08:15:00.000Z" } };
    await importEventOver(db, await overInput(moved, target.id));
    expect((await listCheckpoints(db, target.id)).map((row) => [row.cutoffMinutes, row.cutoffClock])).toEqual([
      [60, "11:15"],
      [120, "12:15"],
    ]);
  });

  it("gives back the saved limits of an event whose start hour is to be announced: a duration needs no hour, so the round trip holds (§770)", async () => {
    const { event } = await seedRace({}, {}, false);
    await seedCheckpoints(event.id);
    const file = await fileOf(event.id);
    // The hour is «se anunță mai târziu» and there is no gun: the clocks cannot be said, the minutes are still true.
    const undecided = JSON.parse(JSON.stringify(file)) as EventFile;
    undecided.event.raceStartsAt = null;
    undecided.event.start.time = null;
    undecided.event.timeToBeAnnounced = true;
    undecided.event.durationMinutes = null;
    undecided.event.registration.opensAt = null;
    undecided.event.registration.closesAt = null;
    const created = await importEventAsNew(db, { actor: admin, file: undecided, fetchImpl: serving(), now: NOW });
    expect((await listCheckpoints(db, created.eventId)).map((row) => [row.km, row.cutoffMinutes, row.cutoffClock])).toEqual([
      [7.5, 60, null],
      [15, 120, null],
    ]);
  });

  it("refuses a point's time limit longer than the race's own even while the start hour is to be announced: minutes against minutes (§770)", async () => {
    const { event } = await seedRace({}, {}, false);
    await seedCheckpoints(event.id);
    const file = await fileOf(event.id);
    const undecided = JSON.parse(JSON.stringify(file)) as EventFile;
    undecided.event.raceStartsAt = null;
    undecided.event.start.time = null;
    undecided.event.timeToBeAnnounced = true;
    undecided.event.registration.opensAt = null;
    undecided.event.registration.closesAt = null;
    // The file's points close after one and after two hours; the race lasts one hour, with no hour to say a clock.
    undecided.event.durationMinutes = 60;
    const reason = await importEventAsNew(db, { actor: admin, file: undecided, fetchImpl: serving(), now: NOW }).then(
      () => "",
      (error: unknown) => String((error as Error).message),
    );
    expect(reason).toContain("CHECKPOINT_CUTOFF_AFTER_END");
    // Two hours of limit cover both points: accepted, the clocks still unsaid.
    undecided.event.durationMinutes = 120;
    const created = await importEventAsNew(db, { actor: admin, file: undecided, fetchImpl: serving(), now: NOW });
    expect((await listCheckpoints(db, created.eventId)).map((row) => [row.cutoffMinutes, row.cutoffClock])).toEqual([
      [60, null],
      [120, null],
    ]);
  });

  it("imports a version 2 file — a time of the day for each cut-off — as minutes from the gun, and leaves out what it cannot count, with the kinds it does not know (§770)", async () => {
    const { event } = await seedRace({}, {}, false);
    const file = await fileOf(event.id);
    const point = (km: number, over: Record<string, unknown>) => ({ km, name: { ro: `Punct ${km}`, en: `Point ${km}` }, kinds: ["WATER"], note: { ro: null, en: null }, ...over });
    // The gun is at 10:00: 11:00 is an hour later, 09:30 is before it, and the last point has a kind of a later release.
    const old = {
      ...file,
      version: 2,
      event: {
        ...file.event,
        route: { ...file.event.route, checkpoints: [point(5, { cutoff: "11:00" }), point(8, { cutoff: "09:30" }), point(12, { kinds: ["WATER", "DIRECTION", "TELEPORT"], cutoff: null })] },
      },
    };
    const read = readEventFile(JSON.stringify(old));
    if (!read.ok) throw new Error(`a version 2 file did not read: ${read.refusal} ${read.detail ?? ""}`);
    expect(read.notes).toEqual([
      { code: "checkpointKindsDropped", count: 1 },
      { code: "checkpointLimitsDropped", count: 1 },
    ]);
    const created = await importEventAsNew(db, { actor: admin, file: read.file, fetchImpl: serving(), now: NOW });
    expect((await listCheckpoints(db, created.eventId)).map((row) => [row.km, row.cutoffMinutes, row.cutoffClock, row.kinds])).toEqual([
      [5, 60, "11:00", ["WATER"]],
      [8, null, null, ["WATER"]],
      [12, null, null, ["WATER", "DIRECTION"]],
    ]);
  });

  it("imports a file made before checkpoints existed with none", async () => {
    const { event } = await seedRace({}, {}, false);
    await seedCheckpoints(event.id);
    const old = JSON.parse(JSON.stringify(await fileOf(event.id))) as { event: { route: Record<string, unknown> } };
    delete old.event.route.checkpoints;
    const read = readEventFile(JSON.stringify(old));
    if (!read.ok) throw new Error(`an older file did not read: ${read.refusal} ${read.detail ?? ""}`);
    expect(read.file.event.route.checkpoints).toEqual([]);
    const created = await importEventAsNew(db, { actor: admin, file: read.file, fetchImpl: serving(), now: NOW });
    expect(await listCheckpoints(db, created.eventId)).toEqual([]);
  });

  it("shows the list in the diff of an import over an event, and writes the file's list on confirmation", async () => {
    const { event } = await seedRace();
    await seedCheckpoints(event.id);
    const file = await fileOf(event.id);
    const { target } = await seedTarget();

    const diff = await diffEventImport(db, { actor: admin, file, eventId: target.id });
    const change = diff.changes.find((entry) => entry.key === "route.checkpoints");
    expect(change).toMatchObject({ label: "route.checkpoints", locale: null, from: { type: "text", value: "[]" } });
    expect(change?.to.type).toBe("text");

    await importEventOver(db, await overInput(file, target.id));
    expect((await listCheckpoints(db, target.id)).map((row) => [row.km, row.nameRo, row.cutoffMinutes])).toEqual([
      [7.5, "Apă la cabană", 60],
      [15, "Cronometrare", 120],
    ]);
    // Nothing left to change: the list is not in the diff any more.
    expect((await diffEventImport(db, { actor: admin, file, eventId: target.id })).changes).toEqual([]);
    const trail = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "event_checkpoints.changed"), eq(auditLogs.entityId, target.id)));
    expect(trail).toHaveLength(1);
    expect(trail[0].metadataJson).toMatchObject({ source: "import" });
  });

  it("empties the target's list for a file with none, as the diff says", async () => {
    const { event } = await seedRace({}, {}, false);
    const file = await fileOf(event.id);
    const { target } = await seedTarget();
    await seedCheckpoints(target.id);
    const diff = await diffEventImport(db, { actor: admin, file, eventId: target.id });
    expect(diff.changes.find((entry) => entry.key === "route.checkpoints")?.to).toEqual({ type: "text", value: "[]" });
    await importEventOver(db, await overInput(file, target.id));
    expect(await listCheckpoints(db, target.id)).toEqual([]);
  });

  it("refuses a file whose list the card would refuse — beyond the route, out of order, longer than the race — and writes nothing", async () => {
    const { event } = await seedRace({}, {}, false);
    await seedCheckpoints(event.id);
    const file = await fileOf(event.id);
    const eventsBefore = (await db.select().from(events)).length;
    const edited = (change: (list: EventFile["event"]["route"]["checkpoints"]) => void): EventFile => {
      const copy = JSON.parse(JSON.stringify(file)) as EventFile;
      change(copy.event.route.checkpoints);
      return copy;
    };
    const cases = [
      // 30 km on a 21 km route.
      edited((list) => {
        list[1].km = 30;
      }),
      // The nearer point closes after the farther one (a time limit longer than the farther's).
      edited((list) => {
        list[0].cutoffMinutes = 130;
      }),
      // Longer than the race's own two hours and a half.
      edited((list) => {
        list[1].cutoffMinutes = 151;
      }),
    ];
    for (const bad of cases) {
      expect(await codeOf(importEventAsNew(db, { actor: admin, file: bad, fetchImpl: serving(), now: NOW }))).toBe("VALIDATION_ERROR");
    }
    // Each is the card's own rule: the file is refused naming it.
    const reasons: string[] = [];
    for (const bad of cases) reasons.push(await importEventAsNew(db, { actor: admin, file: bad, fetchImpl: serving(), now: NOW }).then(() => "", (error: unknown) => String((error as Error).message)));
    expect(reasons[0]).toContain("CHECKPOINT_KM_BEYOND_ROUTE");
    expect(reasons[1]).toContain("CHECKPOINT_CUTOFF_AFTER_LATER");
    expect(reasons[2]).toContain("CHECKPOINT_CUTOFF_AFTER_END");
    expect((await db.select().from(events)).length).toBe(eventsBefore);

    const { target } = await seedTarget();
    expect(await codeOf(importEventOver(db, await overInput(cases[0], target.id)))).toBe("VALIDATION_ERROR");
    expect(await listCheckpoints(db, target.id)).toEqual([]);
    expect((await reload(target.id)).capacity).toBe(50);
  });
});
