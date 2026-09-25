import { asc, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { readRichText, richTextToPlainText } from "@/modules/content/rich-text/domain/schema";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-02 (`DECISIONS.md` §387) — "Descriere traseu / antrenament", the route / training
 * description, end to end through the editor's own Server Actions, the series edit and the copies.
 *
 * The owner, 2026-09-25: "I should be able to put 'descriere traseu/antrenament' with pit stops and
 * all, basically a free text, might also attach a map there; you can move the GPX and Strava link
 * there." The map is a picture in the text (§72–§73), so what is proven here is that a document
 * carrying one is stored per language, read back by the public query, and that the stored picture
 * counts as used — the orphan sweep must never take a route's map (§17).
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, redirected: [] as string[] }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("@/auth", () => ({ signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffRole: async () => state.actor,
}));

const { saveEventAndTranslationsAction, createEventAction } = await import("@/app/[locale]/admin/actions");
const { createEvent, duplicateEvent, repeatEvent, saveEventAndTranslations } = await import("@/modules/content/events/service");
const { findPublishedEventBySlug } = await import("@/modules/events/repository");
const { countMediaAssets, listMediaAssetsForAdmin, sweepOrphanAssets } = await import("@/modules/media/references");
const { uploadBodyImage } = await import("@/modules/media/service");

const NOW = new Date("2026-09-25T10:00:00.000Z");
const ZONE = "Europe/Bucharest";
const daysLater = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60_000);

/** The Wednesday hill run: a group run, no registration. */
const FIELDS = {
  type: "GROUP_RUN",
  eventStatus: "SCHEDULED",
  timezone: ZONE,
  startsAtWallTime: "2026-10-07T19:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Stația de telecabină Tâmpa",
  locationNameEn: "Tâmpa cable car station",
  locationAddress: "",
  surface: "TRAIL",
  difficulty: "MODERATE",
  costType: "FREE",
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "8000",
  elevationGainMeters: "250",
  featured: false,
  registrationMode: "NONE",
  participantListVisibility: "HIDDEN" as const,
  capacity: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
  externalProvider: "",
  externalRegistrationUrl: "",
};

const TRANSLATIONS = {
  ro: { slug: "running-up-that-hill", title: "Running up that hill", excerpt: "Urcăm pe Tâmpa." },
  en: { slug: "running-up-that-hill-en", title: "Running up that hill", excerpt: "Up the Tâmpa." },
};

/** A route description as the editor posts it: a paragraph and, when given, the map as a picture. */
const routeDoc = (text: string, mapSrc?: string) =>
  JSON.stringify({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text }] },
      ...(mapSrc ? [{ type: "image", attrs: { src: mapSrc, alt: "Harta", width: 800, height: 600 } }] : []),
    ],
  });

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  state.actor = admin;
  state.redirected.length = 0;
});

const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
const translationsOf = (id: string) => db.select().from(eventTranslations).where(eq(eventTranslations.eventId, id));
/** The words of a stored route description, one string, or null. */
const wordsOf = (json: unknown) => (json === null || json === undefined ? null : richTextToPlainText(readRichText(json)).trim());

const uploadMap = async () =>
  uploadBodyImage(db, {
    actorId: admin.id,
    file: await sharp({ create: { width: 800, height: 600, channels: 3, background: "#3355ff" } }).jpeg().toBuffer(),
    originalFilename: "harta.jpg",
    now: NOW,
  });

/** The editor's form as its boxes post it: the event's settings, and each language's texts from its tabs. */
async function editorForm(eventId: string, texts: Record<"ro" | "en", Record<string, string>>): Promise<FormData> {
  const row = await reload(eventId);
  const form = new FormData();
  const put = (name: string, value: string) => form.set(name, value);
  put("uiLocale", "ro");
  put("eventId", row.id);
  put("event.expectedVersion", String(row.version));
  put("event.type", row.type);
  put("event.eventStatus", row.eventStatus);
  put("event.timezone", row.timezone);
  put("event.startsAtWallTime", toWallTimeInput(row.startsAt, row.timezone));
  put("event.locationName", row.locationName ?? "");
  put("event.surface", row.surface ?? "");
  put("event.difficulty", row.difficulty ?? "");
  put("event.costType", row.costType ?? "");
  put("event.distanceMeters", row.distanceMeters === null ? "" : String(row.distanceMeters));
  put("event.elevationGainMeters", row.elevationGainMeters === null ? "" : String(row.elevationGainMeters));
  put("event.registrationMode", row.registrationMode);
  put("event.minAge", String(row.minAge));
  for (const translation of await translationsOf(eventId)) {
    const locale = translation.locale as "ro" | "en";
    const name = (field: string) => `translations.${locale}.${field}`;
    put(name("translationId"), translation.id);
    put(name("expectedVersion"), String(translation.version));
    put(name("slug"), translation.slug);
    put(name("title"), translation.title);
    put(name("excerpt"), translation.excerpt ?? "");
    for (const [field, value] of Object.entries(texts[locale])) put(name(field), value);
  }
  return form;
}

async function posted(action: Promise<unknown>) {
  const outcome = await action.catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
}

describe("BR-REQ-050-02 the editor's action persists the route description in both languages (§387)", () => {
  it("stores each language's own text with the map picture, and the public page reads each in its own language", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const map = await uploadMap();

    await posted(
      saveEventAndTranslationsAction(
        null,
        await editorForm(created.id, {
          ro: { routeDescription: routeDoc("Oprire cu apă la km 4, apoi urcarea pe serpentine.", map.src) },
          en: { routeDescription: routeDoc("Water stop at km 4, then the climb up the switchbacks.", map.src) },
        }),
      ),
    );
    expect(state.redirected.at(-1)).toContain(`/admin/events/${created.id}`);

    const rows = await translationsOf(created.id);
    const ro = rows.find((row) => row.locale === "ro")!;
    const en = rows.find((row) => row.locale === "en")!;
    // The words first; the picture's alt follows them in the plain text.
    expect(wordsOf(ro.routeDescriptionJson)).toMatch(/^Oprire cu apă la km 4, apoi urcarea pe serpentine\./);
    expect(wordsOf(en.routeDescriptionJson)).toMatch(/^Water stop at km 4, then the climb up the switchbacks\./);
    // The map is a picture in the text, at the club's own store's address (§72).
    const image = (json: unknown) => readRichText(json).content?.find((block) => block.type === "image");
    expect(image(ro.routeDescriptionJson)?.attrs).toMatchObject({ src: map.src, alt: "Harta" });
    expect(image(en.routeDescriptionJson)?.attrs).toMatchObject({ src: map.src });

    await db.update(events).set({ editorialStatus: "PUBLISHED", publishedAt: NOW }).where(eq(events.id, created.id));
    expect(wordsOf((await findPublishedEventBySlug(db, "ro", "running-up-that-hill"))?.routeDescriptionJson)).toContain("Oprire cu apă");
    expect(wordsOf((await findPublishedEventBySlug(db, "en", "running-up-that-hill-en"))?.routeDescriptionJson)).toContain("Water stop");
  });

  it("the create page's action stores it on the new event", async () => {
    const form = new FormData();
    form.set("uiLocale", "ro");
    for (const [name, value] of Object.entries(FIELDS)) if (typeof value === "string") form.set(`event.${name}`, value);
    for (const locale of ["ro", "en"] as const) {
      for (const [name, value] of Object.entries(TRANSLATIONS[locale])) form.set(`translations.${locale}.${name}`, value);
    }
    form.set("translations.ro.routeDescription", routeDoc("Pe creastă, fără apă pe traseu."));
    form.set("translations.en.routeDescription", routeDoc("Along the ridge, no water on the course."));
    await posted(createEventAction(null, form));
    const [row] = await db.select().from(events);
    const rows = await translationsOf(row.id);
    expect(wordsOf(rows.find((translation) => translation.locale === "en")?.routeDescriptionJson)).toBe("Along the ridge, no water on the course.");
  });

  it("an empty editor in both languages stores no description", async () => {
    const created = await createEvent(db, {
      actor: admin,
      fields: { ...FIELDS, translations: { ro: { ...TRANSLATIONS.ro, routeDescription: routeDoc("Ceva.") }, en: { ...TRANSLATIONS.en, routeDescription: routeDoc("Something.") } } },
      now: NOW,
    });
    await posted(saveEventAndTranslationsAction(null, await editorForm(created.id, { ro: { routeDescription: "" }, en: { routeDescription: "" } })));
    expect((await translationsOf(created.id)).every((row) => row.routeDescriptionJson === null)).toBe(true);
  });

  it("refuses one language alone through the action, naming the other language's box, and writes nothing", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const before = await translationsOf(created.id);
    const outcome = await saveEventAndTranslationsAction(
      null,
      await editorForm(created.id, { ro: { routeDescription: routeDoc("Doar în română.") }, en: { routeDescription: "" } }),
    );
    expect(JSON.stringify(outcome)).toContain("translations.en.routeDescription");
    const after = await translationsOf(created.id);
    expect(after.map((row) => row.version).sort()).toEqual(before.map((row) => row.version).sort());
    expect(after.every((row) => row.routeDescriptionJson === null)).toBe(true);
  });
});

describe("§17 a route's map is a picture in use", () => {
  it("is listed under its event and never swept while the description carries it", async () => {
    const map = await uploadMap();
    const created = await createEvent(db, {
      actor: admin,
      fields: {
        ...FIELDS,
        translations: {
          ro: { ...TRANSLATIONS.ro, routeDescription: routeDoc("Harta traseului.", map.src) },
          en: { ...TRANSLATIONS.en, routeDescription: routeDoc("The route's map.", map.src) },
        },
      },
      now: NOW,
    });
    expect(await sweepOrphanAssets(db, daysLater(30))).toBe(0);
    expect(await countMediaAssets(db, daysLater(30))).toEqual({ total: 1, unreferenced: 0, sweepable: 0 });
    const [listed] = await listMediaAssetsForAdmin(db, "ro");
    expect(listed.references).toEqual([{ kind: "event", id: created.id, title: "Running up that hill" }]);
  });

  it("counts a picture in the rules or the programme's notes as used too — both were missed before §387", async () => {
    const inRules = await uploadMap();
    const inSchedule = await uploadMap();
    const race = { ...FIELDS, type: "RACE" };
    await createEvent(db, {
      actor: admin,
      fields: {
        ...race,
        translations: {
          ro: { ...TRANSLATIONS.ro, rules: routeDoc("Regulament.", inRules.src), schedule: routeDoc("Program.", inSchedule.src) },
          en: { ...TRANSLATIONS.en, rules: routeDoc("Rules.", inRules.src), schedule: routeDoc("Programme.", inSchedule.src) },
        },
      },
      now: NOW,
    });
    expect(await countMediaAssets(db, daysLater(30))).toEqual({ total: 2, unreferenced: 0, sweepable: 0 });
    expect(await sweepOrphanAssets(db, daysLater(30))).toBe(0);
  });
});

describe("BR-REQ-050-02 a series carries the route description by the scope radio (§350), and a copy keeps it", () => {
  /** Wednesdays from 7 October to 4 November: the source and four dates. */
  async function seedSeries() {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-04", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id)).orderBy(asc(events.startsAt));
    expect(dates).toHaveLength(4);
    return { source: await reload(source.id), dates };
  }

  async function save(row: typeof events.$inferSelect, scope: "this" | "following" | "all", ro: string, en: string) {
    const rows = await translationsOf(row.id);
    return saveEventAndTranslations(db, {
      actor: admin,
      eventId: row.id,
      fields: { ...FIELDS, startsAtWallTime: toWallTimeInput(row.startsAt, row.timezone) },
      expectedVersion: row.version,
      translations: rows.map((translation) => ({
        translationId: translation.id,
        expectedVersion: translation.version,
        fields: {
          slug: translation.slug,
          title: translation.title,
          excerpt: translation.excerpt ?? "",
          routeDescription: translation.locale === "ro" ? ro : en,
        },
      })),
      scope,
      now: NOW,
    });
  }

  /** Each date's English route description, in date order. */
  const englishWords = async (ids: string[]) =>
    Promise.all(ids.map(async (id) => wordsOf((await translationsOf(id)).find((row) => row.locale === "en")?.routeDescriptionJson)));

  it("«Această dată și următoarele» from the second date writes it there and after, never before", async () => {
    const { source, dates } = await seedSeries();
    const all = [source.id, ...dates.map((row) => row.id)];
    const result = await save(dates[1], "following", routeDoc("Pe la Pietrele lui Solomon."), routeDoc("By Solomon's Rocks."));
    expect(result.appliedTo).toBe(2);
    expect(await englishWords(all)).toEqual([null, null, "By Solomon's Rocks.", "By Solomon's Rocks.", "By Solomon's Rocks."]);
  });

  it("«Toate datele» writes it everywhere; «Doar această dată» touches one date", async () => {
    const { source, dates } = await seedSeries();
    const all = [source.id, ...dates.map((row) => row.id)];
    await save(source, "all", routeDoc("Pe creastă."), routeDoc("Along the ridge."));
    expect(await englishWords(all)).toEqual(Array(5).fill("Along the ridge."));

    await save(await reload(dates[2].id), "this", routeDoc("Pe ploaie, prin pădure."), routeDoc("In the rain, through the forest."));
    expect(await englishWords(all)).toEqual(["Along the ridge.", "Along the ridge.", "Along the ridge.", "In the rain, through the forest.", "Along the ridge."]);
  });

  it("the dates a described series makes, and a duplicate, keep it", async () => {
    const source = await createEvent(db, {
      actor: admin,
      fields: {
        ...FIELDS,
        translations: { ro: { ...TRANSLATIONS.ro, routeDescription: routeDoc("Pe creastă.") }, en: { ...TRANSLATIONS.en, routeDescription: routeDoc("Along the ridge.") } },
      },
      now: NOW,
    });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    expect(await englishWords(dates.map((row) => row.id))).toEqual(Array(dates.length).fill("Along the ridge."));

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    const copied = await translationsOf(copy.id);
    expect(wordsOf(copied.find((row) => row.locale === "ro")?.routeDescriptionJson)).toBe("Pe creastă.");
    expect(wordsOf(copied.find((row) => row.locale === "en")?.routeDescriptionJson)).toBe("Along the ridge.");
  });
});
