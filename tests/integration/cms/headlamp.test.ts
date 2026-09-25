import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-02 (`DECISIONS.md` §NNN) — "Necesită frontală", the editor's checkbox, end to end.
 *
 * The owner, 2026-09-25: "I need an extra checkmark on the event editor and a headlamp icon for
 * the events that require a headlamp (e.g. the Wednesday 'Running up that hill' event during
 * autumn, winter and spring, as it is already dark at 19:00 when it starts)."
 *
 * The editor's own Server Action is called with the form the "Traseul" box posts — the session,
 * the database handle and Next's `redirect` stood in for — so what is proven is that the tick
 * reaches the row and that an unticked box (which posts nothing) clears it. The series edit and
 * the copies go through the service, which the action calls.
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

const NOW = new Date("2026-09-25T10:00:00.000Z");
const ZONE = "Europe/Bucharest";

/** "Running up that hill": a Wednesday group run on the Tâmpa at 19:00, no registration. */
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

/** The editor's form as the boxes post it: `event.*`, with the "Traseul" checkbox only when ticked. */
function editorForm(row: typeof events.$inferSelect, headlamp: boolean): FormData {
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
  if (headlamp) put("event.headlampRequired", "on");
  return form;
}

async function postSave(form: FormData) {
  const outcome = await saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
}

describe("BR-REQ-050-02 the editor's action persists «Necesită frontală»", () => {
  it("ticked, the row carries it; unticked (nothing posted), it is cleared", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect(created.headlampRequired).toBe(false);

    await postSave(editorForm(await reload(created.id), true));
    expect((await reload(created.id)).headlampRequired).toBe(true);
    expect(state.redirected.at(-1)).toContain(`/admin/events/${created.id}`);

    await postSave(editorForm(await reload(created.id), false));
    expect((await reload(created.id)).headlampRequired).toBe(false);
  });

  it("a staff member who may not edit the settings posts no event row, and the mark stays as it was", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, headlampRequired: true, translations: TRANSLATIONS }, now: NOW });
    const form = editorForm(await reload(created.id), false);
    form.delete("event.expectedVersion");
    await postSave(form);
    expect((await reload(created.id)).headlampRequired).toBe(true);
  });

  it("the create page's action stores the tick on the new event", async () => {
    const form = new FormData();
    form.set("uiLocale", "ro");
    for (const [name, value] of Object.entries(FIELDS)) if (typeof value === "string") form.set(`event.${name}`, value);
    form.set("event.headlampRequired", "on");
    for (const locale of ["ro", "en"] as const) {
      for (const [name, value] of Object.entries(TRANSLATIONS[locale])) form.set(`translations.${locale}.${name}`, value);
    }
    const outcome = await createEventAction(null, form).catch((error: unknown) => {
      if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
      throw error;
    });
    expect(outcome, JSON.stringify(outcome)).toBe("redirected");
    const [row] = await db.select().from(events);
    expect(row.headlampRequired).toBe(true);
  });

  it("reaches the public read once published, and is gone from it once cleared", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, headlampRequired: true, translations: TRANSLATIONS }, now: NOW });
    await db.update(events).set({ editorialStatus: "PUBLISHED", publishedAt: NOW }).where(eq(events.id, created.id));
    expect((await findPublishedEventBySlug(db, "ro", "running-up-that-hill"))?.headlampRequired).toBe(true);
    await postSave(editorForm(await reload(created.id), false));
    expect((await findPublishedEventBySlug(db, "ro", "running-up-that-hill"))?.headlampRequired).toBe(false);
  });
});

describe("BR-REQ-050-02 a series carries it by the scope radio (§350), and a copy keeps it", () => {
  /** Wednesdays from 7 October to 4 November: the source and four dates. */
  async function seedSeries() {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-04", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id)).orderBy(asc(events.startsAt));
    expect(dates.map((row) => toWallTimeInput(row.startsAt, ZONE).slice(0, 10))).toEqual(["2026-10-14", "2026-10-21", "2026-10-28", "2026-11-04"]);
    return { source: await reload(source.id), dates };
  }

  async function save(row: typeof events.$inferSelect, scope: "this" | "following" | "all", headlampRequired: boolean) {
    const ro = (await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, row.id))).find((t) => t.locale === "ro")!;
    return saveEventAndTranslations(db, {
      actor: admin,
      eventId: row.id,
      fields: {
        ...FIELDS,
        startsAtWallTime: toWallTimeInput(row.startsAt, row.timezone),
        headlampRequired,
      },
      expectedVersion: row.version,
      translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: { slug: ro.slug, title: ro.title, excerpt: ro.excerpt ?? "" } }],
      scope,
      now: NOW,
    });
  }

  const marks = async (ids: string[]) => Promise.all(ids.map(async (id) => (await reload(id)).headlampRequired));

  it("«Această dată și următoarele» from the second date marks it and those after, never those before", async () => {
    const { source, dates } = await seedSeries();
    const all = [source.id, ...dates.map((row) => row.id)];
    const result = await save(dates[1], "following", true);
    expect(result.appliedTo).toBe(2);
    expect(await marks(all)).toEqual([false, false, true, true, true]);
  });

  it("«Toate datele» clears it everywhere in spring; «Doar această dată» touches one date", async () => {
    const { source, dates } = await seedSeries();
    const all = [source.id, ...dates.map((row) => row.id)];
    await save(source, "all", true);
    expect(await marks(all)).toEqual([true, true, true, true, true]);

    await save(await reload(dates[3].id), "all", false);
    expect(await marks(all)).toEqual([false, false, false, false, false]);

    await save(await reload(dates[2].id), "this", true);
    expect(await marks(all)).toEqual([false, false, false, true, false]);
  });

  it("the dates a marked series makes, and a duplicate, keep it", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, headlampRequired: true, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.every((row) => row.headlampRequired)).toBe(true);

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect(copy.headlampRequired).toBe(true);
  });
});
