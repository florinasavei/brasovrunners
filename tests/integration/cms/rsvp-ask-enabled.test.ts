import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, duplicateEvent, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Acceptă răspunsuri „Vin!”» › «Trimite întrebarea „Vii?” înainte de acest eveniment» (`events.rsvp_ask_enabled`), the kit's pattern
 * (§554, §557, §802): on for every event until the club unticks it, saved through the editor's real action by its marker (a form without the
 * block never switches it off), carried to every date a series makes and by a "following" edit, kept by a duplicate, and the save leaves the
 * staff member who made it on the row. The session and navigation stand-ins are `show-route-profile.test.ts`'s.
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
  ro: { slug: "crosul-cu-intrebare", title: "Crosul cu întrebare", excerpt: "Cu întrebarea „Vii?”." },
  en: { slug: "question-race", title: "The question race", excerpt: "With the question." },
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

/** The editor's «Vin!» block as it posts: its marker, and the tick only when it is ticked — an unticked box posts nothing. */
function settingsForm(eventId: string, expectedVersion: number, tick: "on" | "off" | "absent"): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(expectedVersion));
  for (const [name, value] of Object.entries(FIELDS)) {
    if (typeof value === "string") form.set(`event.${name}`, value);
  }
  if (tick !== "absent") form.set("event.rsvpAskEnabled.present", "1");
  if (tick === "on") form.set("event.rsvpAskEnabled", "on");
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

describe("§NNN «Vin!» › «Trimite întrebarea „Vii?”» on the event", () => {
  it("starts on, for an event that says nothing of it, and is written off on create when the caller says so", async () => {
    const plain = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect((await reloadEvent(plain.id)).rsvpAskEnabled).toBe(true);
    const other = { ro: { ...TRANSLATIONS.ro, slug: "crosul-cu-intrebare-2" }, en: { ...TRANSLATIONS.en, slug: "question-race-2" } };
    const off = await createEvent(db, { actor: admin, fields: { ...FIELDS, rsvpAskEnabled: false, translations: other }, now: NOW });
    expect((await reloadEvent(off.id)).rsvpAskEnabled).toBe(false);
  });

  it("is saved through the editor's action by its marker, a form without the block leaves it alone, and the save names who made it", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect((await reloadEvent(source.id)).rsvpAskEnabled).toBe(true);

    // Unticked: the marker without the box.
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "off"));
    const unticked = await reloadEvent(source.id);
    expect(unticked.rsvpAskEnabled).toBe(false);
    // The trail: the version moved and the row names the staff member who saved it.
    expect(unticked.updatedByStaffUserId).toBe(admin.id);
    expect(unticked.version).toBeGreaterThan(1);

    // A form that carried no block (a reader who may not change the settings) is «not editing it», never «on».
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "absent"));
    expect((await reloadEvent(source.id)).rsvpAskEnabled).toBe(false);

    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "on"));
    expect((await reloadEvent(source.id)).rsvpAskEnabled).toBe(true);

    // And «absent» leaves an event that is on, on.
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "absent"));
    expect((await reloadEvent(source.id)).rsvpAskEnabled).toBe(true);
  });

  it("is carried to every date a series makes and kept by a duplicate", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, rsvpAskEnabled: false, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.rsvpAskEnabled).toBe(false);

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect((await reloadEvent(copy.id)).rsvpAskEnabled).toBe(false);

    // A source that is on is copied on.
    const shown = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: { ro: { ...TRANSLATIONS.ro, slug: "cu-intrebare" }, en: { ...TRANSLATIONS.en, slug: "with-question" } } }, now: NOW });
    const shownCopy = await duplicateEvent(db, { actor: admin, eventId: shown.id });
    expect((await reloadEvent(shownCopy.id)).rsvpAskEnabled).toBe(true);
  });

  it("a series edit with the 'following' scope carries the tick to the later dates", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.rsvpAskEnabled).toBe(true);

    const row = await reloadEvent(source.id);
    const translations = await translationsOf(source.id);
    const ro = translations.find((t) => t.locale === "ro")!;
    const en = translations.find((t) => t.locale === "en")!;
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS, rsvpAskEnabled: false },
      expectedVersion: row.version,
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro) },
        { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en) },
      ],
      scope: "following",
      now: NOW,
    });

    expect((await reloadEvent(source.id)).rsvpAskEnabled).toBe(false);
    for (const date of dates) expect((await reloadEvent(date.id)).rsvpAskEnabled).toBe(false);
  });

  it("a caller that says nothing of it does not switch it", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, rsvpAskEnabled: false, translations: TRANSLATIONS }, now: NOW });
    const row = await reloadEvent(source.id);
    const translations = await translationsOf(source.id);
    const ro = translations.find((t) => t.locale === "ro")!;
    const en = translations.find((t) => t.locale === "en")!;
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS },
      expectedVersion: row.version,
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro) },
        { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en) },
      ],
      scope: "this",
      now: NOW,
    });
    expect((await reloadEvent(source.id)).rsvpAskEnabled).toBe(false);
  });
});
