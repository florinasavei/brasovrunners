import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { duplicateEvent, repeatEvent, saveEventAndTranslations, saveEventFields } from "@/modules/content/events/service";
import { createEvent } from "@/modules/content/events/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The club's discount on an external event's own fee travels the way its cost does
 * (`DECISIONS.md` §394): a series held at a discount is held at it every date, and a duplicate
 * carries it too — the same rule `night-override.test.ts` proves for `nightOverride`.
 *
 * The settings-only case below goes through the editor's real Server Action
 * (`saveEventAndTranslationsAction`) rather than `saveEventFields`, which nothing in `src/`
 * calls — the same session and navigation stand-ins `night-override.test.ts` uses, so what is proven
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
 * The editor's form as the settings panel alone posts it (`night-override.test.ts`'s `editorForm`):
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

describe("the discount note, on a series and a duplicate (§394)", () => {
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

  it("a settings-only save through the editor's real action clears the note too, once the mode no longer needs it (§394)", async () => {
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

  it("a settings-only series save with scope 'all' clears the note on every date in scope, not only the saved one", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBe(2); // plus the source: a three-date series

    // An Organizer without text rights posts `event.*` alone, scope `all`: no
    // `translations.*` box, so nothing but `clearDiscountNoteIfNotAllowed` on the saved date
    // could clear the note; `translationsAfter` has to see that write for `applyToSeries` to
    // carry it to the other two dates too (`DECISIONS.md` §394).
    const row = await reloadEvent(source.id);
    const form = settingsOnlyForm(source.id, row.version, { registrationMode: "NONE", externalProvider: "", externalRegistrationUrl: "" });
    form.set("scope", "all");
    await postSave(form);

    const sourceRows = await translationsOf(source.id);
    expect(sourceRows.find((r) => r.locale === "ro")?.discountNote).toBeNull();
    expect(sourceRows.find((r) => r.locale === "en")?.discountNote).toBeNull();
    for (const date of dates) {
      const rows = await translationsOf(date.id);
      expect(rows.find((r) => r.locale === "ro")?.discountNote).toBeNull();
      expect(rows.find((r) => r.locale === "en")?.discountNote).toBeNull();
    }
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

  it("a settings-only series save with scope 'all' still clears a sibling's note when the saved date's own note was already null (§394)", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);

    // The source's own note is already gone — out of sync with its sibling, as a stale row from
    // before this fix could be — so the diff `applyToSeries` builds from `translationsBefore` and
    // `translationsAfter` finds nothing to carry on `discountNote`. Only the unconditional clear
    // this round adds reaches the sibling, which still carries its note.
    await db.update(eventTranslations).set({ discountNote: null }).where(eq(eventTranslations.eventId, source.id));
    const untouchedSibling = dates[0]!;
    const siblingBefore = await translationsOf(untouchedSibling.id);
    expect(siblingBefore.find((r) => r.locale === "ro")?.discountNote).toBe("40 lei pentru membri BR");

    const row = await reloadEvent(source.id);
    const form = settingsOnlyForm(source.id, row.version, { costType: "FREE", costAmount: "" });
    form.set("scope", "all");
    await postSave(form);

    for (const date of dates) {
      const rows = await translationsOf(date.id);
      expect(rows.find((r) => r.locale === "ro")?.discountNote).toBeNull();
      expect(rows.find((r) => r.locale === "en")?.discountNote).toBeNull();
    }
  });

  it("a settings-only save on a FREE date does not wipe an EXTERNAL + PAID sibling's own note (`DECISIONS.md` §395)", async () => {
    // The source is FREE from the start — `clearDiscountNoteIfNotAllowed` returns true on
    // *every* save of it, whatever that save actually touches — while a sibling, diverged from
    // it after the series was made, is its own EXTERNAL + PAID date with its own note. Neither
    // `registrationMode` nor `costType` is among this save's changes, so the blanket clear this
    // round replaces must leave the sibling's note exactly as it was.
    const source = await createEvent(db, {
      actor: admin,
      fields: {
        ...FIELDS,
        registrationMode: "NONE",
        externalProvider: "",
        externalRegistrationUrl: "",
        costType: "FREE",
        costAmount: "",
        translations: TRANSLATIONS,
      },
      now: NOW,
    });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    const sibling = dates[0]!;
    await db
      .update(events)
      .set({ registrationMode: "EXTERNAL", externalProvider: "Alt club", externalRegistrationUrl: "https://alt-club.ro/inscriere", costType: "PAID", costAmount: "75 lei" })
      .where(eq(events.id, sibling.id));
    await db.update(eventTranslations).set({ discountNote: "40 lei pentru membri BR" }).where(eq(eventTranslations.eventId, sibling.id));

    // Capacity alone changes on the source, scope "following" — no `registrationMode` or
    // `costType` in this save at all.
    const row = await reloadEvent(source.id);
    const form = settingsOnlyForm(source.id, row.version, { registrationMode: "NONE", costType: "FREE", capacity: "50" });
    form.set("scope", "following");
    await postSave(form);

    const siblingRows = await translationsOf(sibling.id);
    expect(siblingRows.find((r) => r.locale === "ro")?.discountNote).toBe("40 lei pentru membri BR");
  });
});

/**
 * `costType` is optional on the parsed fields: absent means "this caller is not editing the cost",
 * never "free" — and `""` ("not stated") is an explicit `null`. The discount note's gate reads the
 * cost as the save leaves it, so an omission keeps the note and a real change still clears it.
 */
describe("the discount note when a save omits the cost type", () => {
  /** `FIELDS` with no `costType` key at all, as a caller that is not editing the cost posts them. */
  function withoutCostType(): Record<string, unknown> {
    const fields: Record<string, unknown> = { ...FIELDS };
    delete fields.costType;
    return fields;
  }

  it("a whole-event save that omits costType keeps the stored cost and the note on an EXTERNAL + PAID event", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const row = await reloadEvent(source.id);

    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...withoutCostType(), costAmount: "80 lei" },
      expectedVersion: row.version,
      translations: [],
      now: NOW,
    });

    const saved = await reloadEvent(source.id);
    expect(saved.costType).toBe("PAID");
    expect(saved.costAmount).toBe("80 lei");
    const after = await translationsOf(source.id);
    expect(after.find((r) => r.locale === "ro")?.discountNote).toBe("40 lei pentru membri BR");
    expect(after.find((r) => r.locale === "en")?.discountNote).toBe("40 lei for BR members");
  });

  it("the event-row save (saveEventFields) that omits costType keeps the note too", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const row = await reloadEvent(source.id);

    await saveEventFields(db, { actor: admin, eventId: source.id, expectedVersion: row.version, fields: withoutCostType(), now: NOW });

    expect((await reloadEvent(source.id)).costType).toBe("PAID");
    const after = await translationsOf(source.id);
    expect(after.find((r) => r.locale === "ro")?.discountNote).toBe("40 lei pentru membri BR");
    expect(after.find((r) => r.locale === "en")?.discountNote).toBe("40 lei for BR members");
  });

  it("a save that sets the cost to 'not stated' clears the note, even with both languages still posting it", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const row = await reloadEvent(source.id);
    const translations = await translationsOf(source.id);
    const ro = translations.find((t) => t.locale === "ro")!;
    const en = translations.find((t) => t.locale === "en")!;

    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS, costType: "", costAmount: "" },
      expectedVersion: row.version,
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro, { discountNote: "40 lei pentru membri BR" }) },
        { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en, { discountNote: "40 lei for BR members" }) },
      ],
      now: NOW,
    });

    expect((await reloadEvent(source.id)).costType).toBeNull();
    const after = await translationsOf(source.id);
    expect(after.find((r) => r.locale === "ro")?.discountNote).toBeNull();
    expect(after.find((r) => r.locale === "en")?.discountNote).toBeNull();
  });

  it("a create that omits costType stores FREE and so writes no note, whatever the form posted for it", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...withoutCostType(), costAmount: "", translations: TRANSLATIONS }, now: NOW });

    expect(created.costType).toBe("FREE");
    const rows = await translationsOf(created.id);
    expect(rows.find((r) => r.locale === "ro")?.discountNote).toBeNull();
    expect(rows.find((r) => r.locale === "en")?.discountNote).toBeNull();
  });
});
