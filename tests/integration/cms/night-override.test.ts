import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-02 (`DECISIONS.md` §394, replacing §382's checkbox) — "Eveniment de noapte", the
 * editor's three choices, end to end.
 *
 * The owner, 2026-09-25: "«Necesită frontală» ar trebui să fie cumva «eveniment de noapte» setat
 * automat în funcție de ora de start și când apune soarele."
 *
 * The editor's own Server Action is called with the form the "Traseul" box posts — the session,
 * the database handle and Next's `redirect` stood in for — so what is proven is that "Automat",
 * "Da" and "Nu" reach the column as null, true and false, and that a form without the radio (a
 * role that may not edit the settings) changes nothing. The series edit and the copies go through
 * the service, which the action calls; and a series left on "Automat" answers per date, by its own
 * sunset — the October Wednesdays at 19:00 are not night events yet, the November ones are.
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
const { clubNightEvent } = await import("@/modules/events/night-event");

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

/** The editor's form as the boxes post it: `event.*`, with the "Traseul" radio's value when given. */
function editorForm(row: typeof events.$inferSelect, night: "auto" | "yes" | "no" | null): FormData {
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
  if (night) put("event.nightOverride", night);
  return form;
}

async function postSave(form: FormData) {
  const outcome = await saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
}

describe("BR-REQ-050-02 the editor's action persists «Eveniment de noapte»", () => {
  it("«Automat» is null — the default of a new event — «Da» true and «Nu» false, each read back", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect(created.nightOverride).toBeNull();

    await postSave(editorForm(await reload(created.id), "yes"));
    expect((await reload(created.id)).nightOverride).toBe(true);
    expect(state.redirected.at(-1)).toContain(`/admin/events/${created.id}`);

    await postSave(editorForm(await reload(created.id), "no"));
    expect((await reload(created.id)).nightOverride).toBe(false);

    await postSave(editorForm(await reload(created.id), "auto"));
    expect((await reload(created.id)).nightOverride).toBeNull();
  });

  it("a staff member who may not edit the settings posts no event row, and the choice stays as it was", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, nightOverride: true, translations: TRANSLATIONS }, now: NOW });
    const form = editorForm(await reload(created.id), null);
    form.delete("event.expectedVersion");
    await postSave(form);
    expect((await reload(created.id)).nightOverride).toBe(true);
  });

  it("the create page's action stores the choice on the new event", async () => {
    const form = new FormData();
    form.set("uiLocale", "ro");
    for (const [name, value] of Object.entries(FIELDS)) if (typeof value === "string") form.set(`event.${name}`, value);
    form.set("event.nightOverride", "no");
    for (const locale of ["ro", "en"] as const) {
      for (const [name, value] of Object.entries(TRANSLATIONS[locale])) form.set(`translations.${locale}.${name}`, value);
    }
    const outcome = await createEventAction(null, form).catch((error: unknown) => {
      if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
      throw error;
    });
    expect(outcome, JSON.stringify(outcome)).toBe("redirected");
    const [row] = await db.select().from(events);
    expect(row.nightOverride).toBe(false);
  });

  it("reaches the public read once published, and the answer follows the choice", async () => {
    const created = await createEvent(
      db,
      { actor: admin, fields: { ...FIELDS, startsAtWallTime: "2027-06-16T19:00", nightOverride: true, translations: TRANSLATIONS }, now: NOW },
    );
    await db.update(events).set({ editorialStatus: "PUBLISHED", publishedAt: NOW }).where(eq(events.id, created.id));
    const read = async () => (await findPublishedEventBySlug(db, "ro", "running-up-that-hill"))!;
    // "Da" in June: a night event whatever the sun does.
    expect((await read()).nightOverride).toBe(true);
    expect(clubNightEvent(await read()).night).toBe(true);
    // "Automat" in June: 19:00 is broad daylight in Brașov.
    await postSave(editorForm(await reload(created.id), "auto"));
    expect((await read()).nightOverride).toBeNull();
    expect(clubNightEvent(await read())).toMatchObject({ night: false, source: "automatic" });
  });
});

describe("BR-REQ-050-02 a series: the scope radio carries the choice (§350), «Automat» answers per date", () => {
  /** Wednesdays from 7 October to 4 November: the source and four dates. */
  async function seedSeries(extra: { nightOverride?: boolean | null } = {}) {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, ...extra, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-04", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id)).orderBy(asc(events.startsAt));
    expect(dates.map((row) => toWallTimeInput(row.startsAt, ZONE).slice(0, 10))).toEqual(["2026-10-14", "2026-10-21", "2026-10-28", "2026-11-04"]);
    return { source: await reload(source.id), dates };
  }

  async function save(row: typeof events.$inferSelect, scope: "this" | "following" | "all", nightOverride: boolean | null) {
    const ro = (await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, row.id))).find((t) => t.locale === "ro")!;
    return saveEventAndTranslations(db, {
      actor: admin,
      eventId: row.id,
      fields: {
        ...FIELDS,
        startsAtWallTime: toWallTimeInput(row.startsAt, row.timezone),
        nightOverride,
      },
      expectedVersion: row.version,
      translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: { slug: ro.slug, title: ro.title, excerpt: ro.excerpt ?? "" } }],
      scope,
      now: NOW,
    });
  }

  const overrides = async (ids: string[]) => Promise.all(ids.map(async (id) => (await reload(id)).nightOverride));
  const answers = async (ids: string[]) => Promise.all(ids.map(async (id) => clubNightEvent(await reload(id)).night));

  it("left on «Automat», every date answers by its own sunset: October's 19:00 before dusk, from 21 October after it", async () => {
    const { source, dates } = await seedSeries();
    const all = [source.id, ...dates.map((row) => row.id)];
    expect(await overrides(all)).toEqual([null, null, null, null, null]);
    // Civil dusk in Brașov: 19:16 on 7 Oct, 19:05 on 14 Oct, 18:55 on 21 Oct, then the clocks go back.
    expect(await answers(all)).toEqual([false, false, true, true, true]);
  });

  it("«Această dată și următoarele» with «Da» from the second date marks it and those after, never those before", async () => {
    const { source, dates } = await seedSeries();
    const all = [source.id, ...dates.map((row) => row.id)];
    const result = await save(dates[0], "following", true);
    expect(result.appliedTo).toBe(3);
    expect(await overrides(all)).toEqual([null, true, true, true, true]);
    expect(await answers(all)).toEqual([false, true, true, true, true]);
  });

  it("«Toate datele» carries «Nu» and then «Automat» everywhere; «Doar această dată» touches one date", async () => {
    const { source, dates } = await seedSeries();
    const all = [source.id, ...dates.map((row) => row.id)];
    await save(source, "all", false);
    expect(await overrides(all)).toEqual([false, false, false, false, false]);
    expect(await answers(all)).toEqual([false, false, false, false, false]);

    await save(await reload(dates[3].id), "all", null);
    expect(await overrides(all)).toEqual([null, null, null, null, null]);

    await save(await reload(dates[0].id), "this", true);
    expect(await overrides(all)).toEqual([null, true, null, null, null]);
  });

  it("the dates a series makes, and a duplicate, keep the source's choice — «Da» stays «Da», «Automat» stays automatic", async () => {
    const marked = await seedSeries({ nightOverride: true });
    expect(marked.dates.every((row) => row.nightOverride === true)).toBe(true);
    const copy = await duplicateEvent(db, { actor: admin, eventId: marked.source.id });
    expect(copy.nightOverride).toBe(true);

    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    state.actor = admin;
    const automatic = await seedSeries();
    expect(automatic.dates.every((row) => row.nightOverride === null)).toBe(true);
    expect((await duplicateEvent(db, { actor: admin, eventId: automatic.source.id })).nightOverride).toBeNull();
  });
});
