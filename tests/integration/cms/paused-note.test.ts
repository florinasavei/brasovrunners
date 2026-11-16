import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-02 (§948) — «Mesaj cât înscrierile pe site sunt oprite» in the editor (the owner, 2026-11-15, of the card's
 * «Înscrierile pe site sunt oprite de organizatori.»: «vreau să scrie mai frumos sau să pot customiza mesajul»), end to
 * end through the service and the editor's own Server Action.
 *
 * What is proven: a new event has no note; the note is written in both languages, trimmed, kept whatever «Înscrieri
 * publice deschise» says, cleared when emptied in both, refused in one language alone (§352) and past 200 characters;
 * the editor's form posts it from the strip's boxes and a form without them leaves it alone; a series edit and a
 * duplicate carry it with the door's switch.
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
  requireStaffCapability: async () => state.actor,
}));

const { saveEventAndTranslationsAction } = await import("@/app/[locale]/admin/actions");
const { createEvent, duplicateEvent, repeatEvent, saveEventAndTranslations } = await import("@/modules/content/events/service");

const NOW = new Date("2026-09-25T10:00:00.000Z");
const ZONE = "Europe/Bucharest";

/** A Wednesday group run on the Tâmpa; its registration settings are whatever each test saves. */
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
  difficulty: "MEDIUM",
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
  ro: { slug: "tampa-miercuri", title: "Tâmpa, miercuri", excerpt: "Urcăm pe Tâmpa." },
  en: { slug: "tampa-wednesday", title: "Tâmpa, Wednesday", excerpt: "Up the Tâmpa." },
};

const OWN_RO = "Înscrierile s-au încheiat. Ne vedem la start!";
const OWN_EN = "Registration has ended. See you at the start!";

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

const reloadEvent = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
const translationsOf = (id: string) => db.select().from(eventTranslations).where(eq(eventTranslations.eventId, id));
const noteIn = async (id: string, locale: "ro" | "en") => (await translationsOf(id)).find((row) => row.locale === locale)?.pausedNote ?? null;

const wordsFor = (row: { slug: string; title: string; excerpt: string | null }, changes: Record<string, unknown> = {}) => ({
  slug: row.slug,
  title: row.title,
  excerpt: row.excerpt ?? "",
  seoTitle: "",
  seoDescription: "",
  ...changes,
});

/** One save of the event and both languages, through the service the editor's action calls. */
async function save(eventId: string, fields: Record<string, unknown>, notes?: { ro?: string; en?: string }, scope?: "following") {
  const row = await reloadEvent(eventId);
  const rows = await translationsOf(eventId);
  const ro = rows.find((t) => t.locale === "ro")!;
  const en = rows.find((t) => t.locale === "en")!;
  return saveEventAndTranslations(db, {
    actor: admin,
    eventId,
    fields: { ...FIELDS, ...fields },
    expectedVersion: row.version,
    translations: [
      { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro, notes?.ro === undefined ? {} : { pausedNote: notes.ro }) },
      { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en, notes?.en === undefined ? {} : { pausedNote: notes.en }) },
    ],
    ...(scope ? { scope } : {}),
    now: NOW,
  });
}

/** The settings panel's form alone (`discount-note-series.test.ts`): `event.*` boxes, no words. */
function settingsOnlyForm(eventId: string, expectedVersion: number, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(expectedVersion));
  for (const [name, value] of Object.entries(FIELDS)) {
    if (typeof value === "string") form.set(`event.${name}`, value);
  }
  for (const [name, value] of Object.entries(extra)) form.set(name, value);
  return form;
}

async function postSave(form: FormData) {
  const outcome = await saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
}

/** The editor's whole form: the settings and both languages' words, with the strip's two boxes when given. */
async function fullForm(eventId: string, notes?: { ro: string; en: string }): Promise<FormData> {
  const row = await reloadEvent(eventId);
  const form = settingsOnlyForm(eventId, row.version);
  for (const words of await translationsOf(eventId)) {
    const name = (field: string) => `translations.${words.locale}.${field}`;
    form.set(name("translationId"), words.id);
    form.set(name("expectedVersion"), String(words.version));
    form.set(name("slug"), words.slug);
    form.set(name("title"), words.title);
    form.set(name("excerpt"), words.excerpt ?? "");
    if (notes) form.set(name("pausedNote"), notes[words.locale as "ro" | "en"]);
  }
  return form;
}

describe("BR-REQ-050-02 «Mesaj cât înscrierile pe site sunt oprite»: the club's own sentence, per language (§948)", () => {
  it("a new event has no note in either language", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect(await noteIn(created.id, "ro")).toBeNull();
    expect(await noteIn(created.id, "en")).toBeNull();
  });

  it("saves both notes, trimmed; keeps them whatever the door's tick says; clears them when both are emptied", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });

    await save(created.id, { publicRegistrationOpen: false }, { ro: `  ${OWN_RO}  `, en: OWN_EN });
    expect((await reloadEvent(created.id)).publicRegistrationOpen).toBe(false);
    expect(await noteIn(created.id, "ro")).toBe(OWN_RO);
    expect(await noteIn(created.id, "en")).toBe(OWN_EN);

    // The door opened again: the words stay, unread, so the next closing finds them.
    await save(created.id, { publicRegistrationOpen: true });
    expect((await reloadEvent(created.id)).publicRegistrationOpen).toBe(true);
    expect(await noteIn(created.id, "ro")).toBe(OWN_RO);
    expect(await noteIn(created.id, "en")).toBe(OWN_EN);

    // Emptied in both languages: the column is cleared, and the platform's sentence is said again.
    await save(created.id, {}, { ro: "", en: "   " });
    expect(await noteIn(created.id, "ro")).toBeNull();
    expect(await noteIn(created.id, "en")).toBeNull();
  });

  it.each([
    ["the door shut", false],
    ["the door open", true],
  ] as const)("refuses the note in one language alone — both or neither (§352) — naming the empty side's box, with %s", async (_door, open) => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await expect(save(created.id, { publicRegistrationOpen: open }, { ro: OWN_RO, en: "" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: expect.arrayContaining(["translations.en.pausedNote"]),
    });
    await expect(save(created.id, { publicRegistrationOpen: open }, { ro: "", en: OWN_EN })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: expect.arrayContaining(["translations.ro.pausedNote"]),
    });
    expect(await noteIn(created.id, "ro")).toBeNull();
    expect(await noteIn(created.id, "en")).toBeNull();
  });

  it("takes 200 characters and refuses one more", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await expect(save(created.id, {}, { ro: "x".repeat(201), en: "y".repeat(201) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await noteIn(created.id, "ro")).toBeNull();
    await save(created.id, {}, { ro: "x".repeat(200), en: "y".repeat(200) });
    expect(await noteIn(created.id, "ro")).toHaveLength(200);
  });

  it("a save that posts no note leaves it as stored", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await save(created.id, {}, { ro: OWN_RO, en: OWN_EN });
    await save(created.id, { distanceMeters: "9000" });
    expect(await noteIn(created.id, "ro")).toBe(OWN_RO);
    expect(await noteIn(created.id, "en")).toBe(OWN_EN);
  });

  it("through the editor's action: the strip's two boxes are saved, a form without them leaves the notes alone, and empty boxes clear them", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });

    await postSave(await fullForm(created.id, { ro: OWN_RO, en: OWN_EN }));
    expect(await noteIn(created.id, "ro")).toBe(OWN_RO);
    expect(await noteIn(created.id, "en")).toBe(OWN_EN);

    // The words' boxes without the strip — a reader whose form carries no such box: untouched.
    await postSave(await fullForm(created.id));
    expect(await noteIn(created.id, "ro")).toBe(OWN_RO);
    // The settings alone: untouched.
    await postSave(settingsOnlyForm(created.id, (await reloadEvent(created.id)).version));
    expect(await noteIn(created.id, "en")).toBe(OWN_EN);

    await postSave(await fullForm(created.id, { ro: "", en: "" }));
    expect(await noteIn(created.id, "ro")).toBeNull();
    expect(await noteIn(created.id, "en")).toBeNull();
  });

  it("a series edit carries the note to the following dates with the door's switch, and a duplicate keeps both", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);

    await save(source.id, { publicRegistrationOpen: false }, { ro: OWN_RO, en: OWN_EN }, "following");
    for (const date of dates) {
      expect((await reloadEvent(date.id)).publicRegistrationOpen).toBe(false);
      expect(await noteIn(date.id, "ro")).toBe(OWN_RO);
      expect(await noteIn(date.id, "en")).toBe(OWN_EN);
    }

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect((await reloadEvent(copy.id)).publicRegistrationOpen).toBe(false);
    expect(await noteIn(copy.id, "ro")).toBe(OWN_RO);
    expect(await noteIn(copy.id, "en")).toBe(OWN_EN);
  });
});
