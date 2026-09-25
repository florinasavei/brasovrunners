import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §393 — "Declarație opțională pe propria răspundere", the route card's checkbox, end to end.
 *
 * The editor's own Server Action is called with the form "Traseul" posts, as `headlamp.test.ts`
 * does: the tick reaches the row, an unticked box (which posts nothing) clears it, and the service
 * keeps it only on a group run on asphalt or trail — a race, a mixed surface or none is written as
 * not offering one, whatever was posted (as §111 normalizes a turn-up type). A series carries it by
 * the scope radio (§350), and a copy and every date a series makes keep it.
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
const { createEvent, duplicateEvent, repeatEvent, saveEventAndTranslations } = await import("@/modules/content/events/service");
const { findPublishedEventBySlug } = await import("@/modules/events/repository");

const NOW = new Date("2026-09-25T10:00:00.000Z");
const ZONE = "Europe/Bucharest";

/** The Tâmpa trail run, a group run with no registration. */
const FIELDS = {
  type: "GROUP_RUN",
  eventStatus: "SCHEDULED",
  timezone: ZONE,
  startsAtWallTime: "2026-10-07T19:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Stația de telecabină",
  locationNameEn: "The cable car station",
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
  ro: { slug: "tura-pe-munte", title: "Tura pe munte", excerpt: "Urcăm." },
  en: { slug: "mountain-loop", title: "The mountain loop", excerpt: "Up we go." },
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

const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

function editorForm(row: typeof events.$inferSelect, offered: boolean, overrides: Record<string, string> = {}): FormData {
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
  if (offered) put("event.offersGroupRunDeclaration", "on");
  for (const [name, value] of Object.entries(overrides)) put(name, value);
  return form;
}

async function postSave(form: FormData) {
  const outcome = await saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
}

describe("§393 the editor's action persists «Declarație opțională pe propria răspundere»", () => {
  it("ticked on a trail group run, the row carries it; unticked (nothing posted), it is cleared", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect(created.offersGroupRunDeclaration).toBe(false);
    await postSave(editorForm(await reload(created.id), true));
    expect((await reload(created.id)).offersGroupRunDeclaration).toBe(true);
    await postSave(editorForm(await reload(created.id), false));
    expect((await reload(created.id)).offersGroupRunDeclaration).toBe(false);
  });

  it("is kept on asphalt too, and written as not offered on a mixed surface, none, or a race", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await postSave(editorForm(await reload(created.id), true, { "event.surface": "ASPHALT" }));
    expect((await reload(created.id)).offersGroupRunDeclaration).toBe(true);
    for (const surface of ["MIXED", ""]) {
      await postSave(editorForm(await reload(created.id), true, { "event.surface": surface }));
      expect((await reload(created.id)).offersGroupRunDeclaration, surface || "none").toBe(false);
    }
    const race = await createEvent(db, {
      actor: admin,
      fields: { ...FIELDS, type: "HIKE", offersGroupRunDeclaration: true, translations: { ro: { ...TRANSLATIONS.ro, slug: "drumetie" }, en: { ...TRANSLATIONS.en, slug: "hike" } } },
      now: NOW,
    });
    expect(race.offersGroupRunDeclaration).toBe(false);
  });

  it("reaches the public read once published", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, offersGroupRunDeclaration: true, translations: TRANSLATIONS }, now: NOW });
    await db.update(events).set({ editorialStatus: "PUBLISHED", publishedAt: NOW }).where(eq(events.id, created.id));
    expect((await findPublishedEventBySlug(db, "ro", "tura-pe-munte"))?.offersGroupRunDeclaration).toBe(true);
  });
});

describe("§393 a series carries it by the scope radio (§350), and a copy keeps it", () => {
  async function seedSeries() {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-04", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id)).orderBy(asc(events.startsAt));
    return { source: await reload(source.id), dates };
  }

  async function save(row: typeof events.$inferSelect, scope: "this" | "following" | "all", offersGroupRunDeclaration: boolean) {
    const ro = (await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, row.id))).find((t) => t.locale === "ro")!;
    return saveEventAndTranslations(db, {
      actor: admin,
      eventId: row.id,
      fields: { ...FIELDS, startsAtWallTime: toWallTimeInput(row.startsAt, row.timezone), offersGroupRunDeclaration },
      expectedVersion: row.version,
      translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: { slug: ro.slug, title: ro.title, excerpt: ro.excerpt ?? "" } }],
      scope,
      now: NOW,
    });
  }

  const marks = async (ids: string[]) => Promise.all(ids.map(async (id) => (await reload(id)).offersGroupRunDeclaration));

  it("«Această dată și următoarele» from the second date marks it and those after", async () => {
    const { source, dates } = await seedSeries();
    const all = [source.id, ...dates.map((row) => row.id)];
    await save(dates[1], "following", true);
    expect(await marks(all)).toEqual([false, false, true, true, true]);
  });

  it("the dates a marked series makes, and a duplicate, keep it", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, offersGroupRunDeclaration: true, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.every((row) => row.offersGroupRunDeclaration)).toBe(true);
    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect(copy.offersGroupRunDeclaration).toBe(true);
  });
});
