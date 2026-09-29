import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, duplicateEvent, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Kit de participare» → «Tricou» (`events.kit_shirt`): saved through the editor's real
 * action by its marker (a form without the card never switches it off), carried to every date a
 * series makes and by a "following" edit, and kept by a duplicate — like the rest of the
 * registration block. The session and navigation stand-ins are `discount-note-series.test.ts`'s.
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

const NOW = new Date("2026-09-25T10:00:00.000Z");

const FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-10-07T19:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Piața Sfatului",
  locationNameEn: "Council Square",
  locationAddress: "",
  surface: "ASPHALT",
  difficulty: "MEDIUM",
  costType: "FREE",
  costAmount: "",
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "10000",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "EXTERNAL",
  externalProvider: "Alt club",
  externalRegistrationUrl: "https://alt-club.ro/inscriere",
  participantListVisibility: "HIDDEN" as const,
  capacity: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
};

const TRANSLATIONS = {
  ro: { slug: "crosul-cu-tricou", title: "Crosul cu tricou", excerpt: "Cu tricou." },
  en: { slug: "t-shirt-race", title: "The T-shirt race", excerpt: "With a T-shirt." },
};

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

/** The editor's settings panel as it posts (`discount-note-series.test.ts`'s `settingsOnlyForm`), plus the kit card's boxes. */
function settingsForm(eventId: string, expectedVersion: number, kit: "on" | "off" | "absent"): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(expectedVersion));
  for (const [name, value] of Object.entries(FIELDS)) {
    if (typeof value === "string") form.set(`event.${name}`, value);
  }
  if (kit !== "absent") form.set("event.kitShirt.present", "1");
  if (kit === "on") form.set("event.kitShirt", "on");
  return form;
}

async function postSave(form: FormData) {
  const outcome = await saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
}

const wordsFor = (row: { slug: string; title: string; excerpt: string | null }) => ({
  slug: row.slug,
  title: row.title,
  excerpt: row.excerpt ?? "",
  seoTitle: "",
  seoDescription: "",
});

describe("§NNN «Kit de participare» → «Tricou» on the event", () => {
  it("starts off, and is written on create when ticked", async () => {
    const plain = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect((await reloadEvent(plain.id)).kitShirt).toBe(false);
    const other = { ro: { ...TRANSLATIONS.ro, slug: "crosul-cu-tricou-2" }, en: { ...TRANSLATIONS.en, slug: "t-shirt-race-2" } };
    const ticked = await createEvent(db, { actor: admin, fields: { ...FIELDS, kitShirt: true, translations: other }, now: NOW });
    expect((await reloadEvent(ticked.id)).kitShirt).toBe(true);
  });

  it("is saved through the editor's action by its marker, and a form without the card leaves it alone", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "on"));
    expect((await reloadEvent(source.id)).kitShirt).toBe(true);

    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "absent"));
    expect((await reloadEvent(source.id)).kitShirt).toBe(true);

    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "off"));
    expect((await reloadEvent(source.id)).kitShirt).toBe(false);
  });

  it("is carried to every date a series makes and kept by a duplicate", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, kitShirt: true, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.kitShirt).toBe(true);

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect((await reloadEvent(copy.id)).kitShirt).toBe(true);
  });

  it("a series edit with the 'following' scope carries the tick to the later dates", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.kitShirt).toBe(false);

    const row = await reloadEvent(source.id);
    const translations = await translationsOf(source.id);
    const ro = translations.find((t) => t.locale === "ro")!;
    const en = translations.find((t) => t.locale === "en")!;
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS, kitShirt: true },
      expectedVersion: row.version,
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro) },
        { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en) },
      ],
      scope: "following",
      now: NOW,
    });

    expect((await reloadEvent(source.id)).kitShirt).toBe(true);
    for (const date of dates) expect((await reloadEvent(date.id)).kitShirt).toBe(true);
  });
});
