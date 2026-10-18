import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventRsvps } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, duplicateEvent, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §811 («Vin!» part 1) — the editor's tick «Acceptă răspunsuri „Vin!” din pagină, calendar și email» (`events.rsvp_enabled`), the
 * kit's pattern (§554, §557, §802): off for every event until the club ticks it, saved through the editor's real action by its marker (a
 * form without the card never switches it off), written off by any registration mode but «Fără înscrieri», carried to every date a
 * series makes and by a "following" edit, kept by a duplicate — while the answers themselves are never carried. The session and
 * navigation stand-ins are `show-route-profile.test.ts`'s.
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

/** A hike one simply turns up to: no registration, the shape the tick belongs to. */
const FIELDS = {
  type: "HIKE",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-10-07T19:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Piața Sfatului",
  locationNameEn: "Council Square",
  locationAddress: "",
  surface: "TRAIL",
  difficulty: "MEDIUM",
  costType: "FREE",
  costAmount: "",
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "10000",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "NONE",
  externalProvider: "",
  externalRegistrationUrl: "",
  participantListVisibility: "HIDDEN" as const,
  capacity: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
};

const TRANSLATIONS = {
  ro: { slug: "tura-vin", title: "Tura cu „Vin!”", excerpt: "Venim cu toții." },
  en: { slug: "coming-hike", title: "The hike with “I'm coming!”", excerpt: "All of us." },
};
const other = (n: number) => ({ ro: { ...TRANSLATIONS.ro, slug: `tura-vin-${n}` }, en: { ...TRANSLATIONS.en, slug: `coming-hike-${n}` } });

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

/** The editor's card as it posts: its marker, and the tick only when it is ticked — an unticked box posts nothing. */
function settingsForm(eventId: string, expectedVersion: number, tick: "on" | "off" | "absent", over: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(expectedVersion));
  for (const [name, value] of Object.entries({ ...FIELDS, ...over })) {
    if (typeof value === "string") form.set(`event.${name}`, value);
  }
  if (tick !== "absent") form.set("event.rsvpEnabled.present", "1");
  if (tick === "on") form.set("event.rsvpEnabled", "on");
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

describe("§811 «Acceptă răspunsuri „Vin!”» on the event", () => {
  it("starts off, for an event that says nothing of it, and is written when the caller says so", async () => {
    const plain = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect((await reloadEvent(plain.id)).rsvpEnabled).toBe(false);
    const on = await createEvent(db, { actor: admin, fields: { ...FIELDS, rsvpEnabled: true, translations: other(2) }, now: NOW });
    expect((await reloadEvent(on.id)).rsvpEnabled).toBe(true);
  });

  it("is written off by any registration mode but «Fără înscrieri» — on create, and when the mode is changed later", async () => {
    const race = await createEvent(db, {
      actor: admin,
      fields: { ...FIELDS, type: "RACE", registrationMode: "EXTERNAL", externalProvider: "Alt club", externalRegistrationUrl: "https://alt-club.ro/inscriere", rsvpEnabled: true, translations: other(3) },
      now: NOW,
    });
    expect((await reloadEvent(race.id)).rsvpEnabled).toBe(false);

    const hike = await createEvent(db, { actor: admin, fields: { ...FIELDS, rsvpEnabled: true, translations: other(4) }, now: NOW });
    expect((await reloadEvent(hike.id)).rsvpEnabled).toBe(true);
    // The club moves the hike to a registration on another site: the tick, which cannot be seen there, is not kept.
    await postSave(settingsForm(hike.id, (await reloadEvent(hike.id)).version, "on", { registrationMode: "EXTERNAL", externalProvider: "Alt club", externalRegistrationUrl: "https://alt-club.ro/inscriere" }));
    const moved = await reloadEvent(hike.id);
    expect(moved.registrationMode).toBe("EXTERNAL");
    expect(moved.rsvpEnabled).toBe(false);
  });

  it("is kept on a type that is only ever turned up to, whatever the hidden registration fields still post", async () => {
    const run = await createEvent(db, { actor: admin, fields: { ...FIELDS, type: "GROUP_RUN", registrationMode: "INTERNAL", capacity: "30", rsvpEnabled: true, translations: other(5) }, now: NOW });
    const stored = await reloadEvent(run.id);
    expect(stored.registrationMode).toBe("NONE");
    expect(stored.rsvpEnabled).toBe(true);
  });

  it("is saved through the editor's action by its marker, a form without the card leaves it alone, and the save names who made it", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect((await reloadEvent(source.id)).rsvpEnabled).toBe(false);

    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "on"));
    const ticked = await reloadEvent(source.id);
    expect(ticked.rsvpEnabled).toBe(true);
    expect(ticked.updatedByStaffUserId).toBe(admin.id);
    expect(ticked.version).toBeGreaterThan(1);

    // A form that carried no card (a reader who may not change the settings) is «not editing it», never «off».
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "absent"));
    expect((await reloadEvent(source.id)).rsvpEnabled).toBe(true);

    // Unticked: the marker without the box.
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "off"));
    expect((await reloadEvent(source.id)).rsvpEnabled).toBe(false);

    // And «absent» leaves an event that is off, off.
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "absent"));
    expect((await reloadEvent(source.id)).rsvpEnabled).toBe(false);
  });

  it("is carried to every date a series makes and kept by a duplicate — and the answers are carried by neither", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, rsvpEnabled: true, translations: TRANSLATIONS }, now: NOW });
    await db.insert(eventRsvps).values({
      eventId: source.id,
      deliveryEmail: "ana@example.test",
      canonicalEmail: "ana@example.test",
      canonicalizationVersion: 2,
      locale: "ro",
      privacyNoticeVersion: 1,
      confirmedAt: NOW,
    });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) {
      expect(date.rsvpEnabled).toBe(true);
      expect(await db.select().from(eventRsvps).where(eq(eventRsvps.eventId, date.id))).toHaveLength(0);
    }

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect((await reloadEvent(copy.id)).rsvpEnabled).toBe(true);
    expect(await db.select().from(eventRsvps).where(eq(eventRsvps.eventId, copy.id))).toHaveLength(0);

    // A source that is off is copied off.
    const off = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: other(6) }, now: NOW });
    const offCopy = await duplicateEvent(db, { actor: admin, eventId: off.id });
    expect((await reloadEvent(offCopy.id)).rsvpEnabled).toBe(false);
  });

  it("a series edit with the 'following' scope carries the tick to the later dates", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.rsvpEnabled).toBe(false);

    const row = await reloadEvent(source.id);
    const translations = await translationsOf(source.id);
    const ro = translations.find((t) => t.locale === "ro")!;
    const en = translations.find((t) => t.locale === "en")!;
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS, rsvpEnabled: true },
      expectedVersion: row.version,
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro) },
        { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en) },
      ],
      scope: "following",
      now: NOW,
    });

    expect((await reloadEvent(source.id)).rsvpEnabled).toBe(true);
    for (const date of dates) expect((await reloadEvent(date.id)).rsvpEnabled).toBe(true);
  });

  it("a caller that says nothing of it does not switch it", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, rsvpEnabled: true, translations: TRANSLATIONS }, now: NOW });
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
    expect((await reloadEvent(source.id)).rsvpEnabled).toBe(true);
  });
});
