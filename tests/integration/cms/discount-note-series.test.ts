import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { duplicateEvent, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { createEvent } from "@/modules/content/events/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The club's discount on an external event's own fee travels the way its cost does
 * (`DECISIONS.md` §NNN): a series held at a discount is held at it every date, and a duplicate
 * carries it too — the same rule `headlamp.test.ts` proves for `headlampRequired`.
 *
 * The settings-only case below goes through the editor's real Server Action
 * (`saveEventAndTranslationsAction`) rather than `saveEventFields`, which nothing in `src/`
 * calls — the same session and navigation stand-ins `headlamp.test.ts` uses, so what is proven
 * is the path an Organizer without text rights actually posts through.
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

const { saveEventAndTranslationsAction } = await import("@/app/[locale]/admin/actions");

const NOW = new Date("2026-09-25T10:00:00.000Z");
const ZONE = "Europe/Bucharest";

const FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: ZONE,
  startsAtWallTime: "2026-10-07T19:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Piața Sfatului",
  locationNameEn: "Council Square",
  locationAddress: "",
  surface: "ASPHALT",
  difficulty: "MODERATE",
  costType: "PAID",
  costAmount: "75 lei",
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
  ro: { slug: "cros-partener", title: "Crosul partenerului", excerpt: "Alergăm cu alt club.", discountNote: "40 lei pentru membri BR" },
  en: { slug: "partner-race", title: "The partner's race", excerpt: "We run with another club.", discountNote: "40 lei for BR members" },
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

const translationsOf = (id: string) => db.select().from(eventTranslations).where(eq(eventTranslations.eventId, id));
const reloadEvent = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

/**
 * The editor's form as the settings panel alone posts it (`headlamp.test.ts`'s `editorForm`):
 * every `event.*` box, `expectedVersion` so the save touches the event row, and no
 * `translations.*` box at all — an Organizer without text rights never renders that panel, so
 * `translationFieldsFrom` finds no `translationId` and posts nothing for either language.
 */
function settingsOnlyForm(eventId: string, expectedVersion: number, fields: Partial<typeof FIELDS> = {}): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(expectedVersion));
  for (const [name, value] of Object.entries({ ...FIELDS, ...fields })) {
    if (typeof value === "string") form.set(`event.${name}`, value);
  }
  return form;
}

async function postSave(form: FormData) {
  const outcome = await saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
}

/** One language's posted words, the required fields plus whatever the case changes (`series-edit.test.ts`'s `wordsFor`). */
const wordsFor = (row: { slug: string; title: string; excerpt: string | null }, changes: Record<string, unknown> = {}) => ({
  slug: row.slug,
  title: row.title,
  excerpt: row.excerpt ?? "",
  seoTitle: "",
  seoDescription: "",
  ...changes,
});

describe("the discount note, on a series and a duplicate (§NNN)", () => {
  it("is written on create, for an EXTERNAL + PAID event, in both languages", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const rows = await translationsOf(source.id);
    expect(rows.find((row) => row.locale === "ro")?.discountNote).toBe("40 lei pentru membri BR");
    expect(rows.find((row) => row.locale === "en")?.discountNote).toBe("40 lei for BR members");
  });

  it("every date a series makes from it carries the note, and a duplicate keeps it too", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) {
      const rows = await translationsOf(date.id);
      expect(rows.find((row) => row.locale === "ro")?.discountNote).toBe("40 lei pentru membri BR");
      expect(rows.find((row) => row.locale === "en")?.discountNote).toBe("40 lei for BR members");
    }

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    const copyRows = await translationsOf(copy.id);
    expect(copyRows.find((row) => row.locale === "ro")?.discountNote).toBe("40 lei pentru membri BR");
  });

  it("a series edit with the 'following' scope carries a new note to the sibling dates, and switching the cost off it the same way clears it there too", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);

    // The discount changes on the source date, posted for both languages, "following" reaching
    // every sibling date (`applyToSeries`'s `SERIES_TRANSLATION_COLUMNS`).
    let row = await reloadEvent(source.id);
    let translations = await translationsOf(source.id);
    let ro = translations.find((t) => t.locale === "ro")!;
    let en = translations.find((t) => t.locale === "en")!;
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS },
      expectedVersion: row.version,
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro, { discountNote: "60 lei pentru membri BR" }) },
        { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en, { discountNote: "60 lei for BR members" }) },
      ],
      scope: "following",
      now: NOW,
    });

    for (const date of dates) {
      const rows = await translationsOf(date.id);
      expect(rows.find((r) => r.locale === "ro")?.discountNote).toBe("60 lei pentru membri BR");
      expect(rows.find((r) => r.locale === "en")?.discountNote).toBe("60 lei for BR members");
    }

    // The cost switches to FREE on the source date, with the same scope: `applyTranslationSave`
    // clears `discountNote` outside EXTERNAL + PAID whatever this save still posted for it
    // (`translationColumnsFrom`), and the series edit carries that cleared column along too.
    row = await reloadEvent(source.id);
    translations = await translationsOf(source.id);
    ro = translations.find((t) => t.locale === "ro")!;
    en = translations.find((t) => t.locale === "en")!;
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS, costType: "FREE", costAmount: "" },
      expectedVersion: row.version,
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro, { discountNote: "60 lei pentru membri BR" }) },
        { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en, { discountNote: "60 lei for BR members" }) },
      ],
      scope: "following",
      now: NOW,
    });

    const sourceRows = await translationsOf(source.id);
    expect(sourceRows.find((r) => r.locale === "ro")?.discountNote).toBeNull();
    expect(sourceRows.find((r) => r.locale === "en")?.discountNote).toBeNull();
    for (const date of dates) {
      const rows = await translationsOf(date.id);
      expect(rows.find((r) => r.locale === "ro")?.discountNote).toBeNull();
      expect(rows.find((r) => r.locale === "en")?.discountNote).toBeNull();
    }
  });

  it("a settings-only save through the editor's real action clears the note too, once the mode no longer needs it (§NNN)", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const before = await translationsOf(source.id);
    expect(before.find((r) => r.locale === "ro")?.discountNote).toBe("40 lei pentru membri BR");

    // An Organizer without text rights posts `event.*` alone — no `translations.*` box at all,
    // so `applyTranslationSave` never runs for either language and the note has to be cleared
    // from the settings-only save itself (`saveEventAndTranslationsAction` →
    // `saveEventAndTranslations`), never from `saveEventFields`, which nothing in `src/` calls.
    const row = await reloadEvent(source.id);
    await postSave(settingsOnlyForm(source.id, row.version, { registrationMode: "NONE", externalProvider: "", externalRegistrationUrl: "" }));

    const after = await translationsOf(source.id);
    expect(after.find((r) => r.locale === "ro")?.discountNote).toBeNull();
    expect(after.find((r) => r.locale === "en")?.discountNote).toBeNull();
  });

  it("a settings-only save that still allows the note leaves it exactly as posted before, whatever a stale form still carries", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const row = await reloadEvent(source.id);

    // EXTERNAL + PAID, unchanged: the settings-only save posts no words for either language, and
    // the note the create wrote stays exactly as it was — `clearDiscountNoteIfNotAllowed` is a
    // no-op while the mode still allows one.
    await postSave(settingsOnlyForm(source.id, row.version, { costAmount: "80 lei" }));

    const after = await translationsOf(source.id);
    expect(after.find((r) => r.locale === "ro")?.discountNote).toBe("40 lei pentru membri BR");
    expect(after.find((r) => r.locale === "en")?.discountNote).toBe("40 lei for BR members");
  });

  it("a settings-only save also clears the note at the service function the action calls, with no translations posted at all", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const row = await reloadEvent(source.id);

    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS, registrationMode: "NONE", externalProvider: "", externalRegistrationUrl: "" },
      expectedVersion: row.version,
      translations: [],
      now: NOW,
    });

    const after = await translationsOf(source.id);
    expect(after.find((r) => r.locale === "ro")?.discountNote).toBeNull();
    expect(after.find((r) => r.locale === "en")?.discountNote).toBeNull();
  });
});
