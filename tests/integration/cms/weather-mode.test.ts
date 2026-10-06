import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-02 (§666) — «Vremea» in the editor: the forecast, the club's own text, or none, per
 * event, end to end through the service and the editor's own Server Action.
 *
 * What is proven: a new event starts on the forecast; the choice is saved and a form without the
 * radios leaves it alone; the club's text is written in both languages, cleared when emptied in
 * both, refused in one language alone (§352); the text is kept while the choice is switched away
 * and is there again when switched back; a series edit and a duplicate carry both; a fourth value
 * is refused.
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

/** A Wednesday group run on the Tâmpa, no registration. */
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

const ICY_RO = "Pe creastă e polei, veniți cu colțari.";
const ICY_EN = "The ridge is icy, bring microspikes.";

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
const noteIn = async (id: string, locale: "ro" | "en") => (await translationsOf(id)).find((row) => row.locale === locale)?.weatherNote ?? null;

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
      { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro, notes?.ro === undefined ? {} : { weatherNote: notes.ro }) },
      { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en, notes?.en === undefined ? {} : { weatherNote: notes.en }) },
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

describe("BR-REQ-050-02 «Vremea»: the forecast, the club's text, or none (§666)", () => {
  it("a new event starts on the forecast, with no text in either language", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect((await reloadEvent(created.id)).weatherMode).toBe("forecast");
    expect(await noteIn(created.id, "ro")).toBeNull();
    expect(await noteIn(created.id, "en")).toBeNull();
  });

  it("saves the choice and both texts, keeps the texts across a switch away and back, and clears them when both are emptied", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });

    await save(created.id, { weatherMode: "custom" }, { ro: `  ${ICY_RO}  `, en: ICY_EN });
    expect((await reloadEvent(created.id)).weatherMode).toBe("custom");
    // Trimmed like every short text (`optionalText`).
    expect(await noteIn(created.id, "ro")).toBe(ICY_RO);
    expect(await noteIn(created.id, "en")).toBe(ICY_EN);

    // «Fără vreme»: the words stay, unread, so switching back finds them.
    await save(created.id, { weatherMode: "off" }, { ro: ICY_RO, en: ICY_EN });
    expect((await reloadEvent(created.id)).weatherMode).toBe("off");
    expect(await noteIn(created.id, "ro")).toBe(ICY_RO);
    await save(created.id, { weatherMode: "forecast" });
    expect(await noteIn(created.id, "en")).toBe(ICY_EN);
    await save(created.id, { weatherMode: "custom" });
    expect((await reloadEvent(created.id)).weatherMode).toBe("custom");
    expect(await noteIn(created.id, "ro")).toBe(ICY_RO);

    // Emptied in both languages: the column is cleared.
    await save(created.id, {}, { ro: "", en: "   " });
    expect(await noteIn(created.id, "ro")).toBeNull();
    expect(await noteIn(created.id, "en")).toBeNull();
  });

  it("refuses the text in one language alone — both or neither (§352) — naming the empty side's box", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await expect(save(created.id, { weatherMode: "custom" }, { ro: ICY_RO, en: "" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: expect.arrayContaining(["translations.en.weatherNote"]),
    });
    expect(await noteIn(created.id, "ro")).toBeNull();
  });

  it("a text in one language does not block the save while its box is hidden (§350), and the switch back to the club's text asks for both", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    // «Text scris de club», Romanian typed, then a change of mind to «Fără vreme»: the hidden box saves.
    await save(created.id, { weatherMode: "off" }, { ro: ICY_RO, en: "" });
    expect((await reloadEvent(created.id)).weatherMode).toBe("off");
    expect(await noteIn(created.id, "ro")).toBe(ICY_RO);
    expect(await noteIn(created.id, "en")).toBeNull();
    // The same under the forecast.
    await save(created.id, { weatherMode: "forecast" });
    expect((await reloadEvent(created.id)).weatherMode).toBe("forecast");

    // Back to the club's text with English still empty: refused on the English box, nothing written.
    await expect(save(created.id, { weatherMode: "custom" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: expect.arrayContaining(["translations.en.weatherNote"]),
    });
    expect((await reloadEvent(created.id)).weatherMode).toBe("forecast");

    await save(created.id, { weatherMode: "custom" }, { en: ICY_EN });
    expect((await reloadEvent(created.id)).weatherMode).toBe("custom");
    expect(await noteIn(created.id, "en")).toBe(ICY_EN);
  });

  it("refuses a text longer than 200 characters and a fourth value of the choice", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await expect(save(created.id, {}, { ro: "x".repeat(201), en: "y".repeat(201) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(save(created.id, { weatherMode: "both" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await reloadEvent(created.id)).weatherMode).toBe("forecast");
  });

  it("through the editor's action: the radios' value is saved, and a form without them leaves the choice alone", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    let row = await reloadEvent(created.id);
    await postSave(settingsOnlyForm(created.id, row.version, { "event.weatherMode": "off" }));
    row = await reloadEvent(created.id);
    expect(row.weatherMode).toBe("off");

    await postSave(settingsOnlyForm(created.id, row.version));
    expect((await reloadEvent(created.id)).weatherMode).toBe("off");
  });

  it("a series edit carries the choice and the text to the following dates, and a duplicate keeps both", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);

    await save(source.id, { weatherMode: "custom" }, { ro: ICY_RO, en: ICY_EN }, "following");
    for (const date of dates) {
      expect((await reloadEvent(date.id)).weatherMode).toBe("custom");
      expect(await noteIn(date.id, "ro")).toBe(ICY_RO);
      expect(await noteIn(date.id, "en")).toBe(ICY_EN);
    }

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect((await reloadEvent(copy.id)).weatherMode).toBe("custom");
    expect(await noteIn(copy.id, "en")).toBe(ICY_EN);
  });
});
