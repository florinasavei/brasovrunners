import { createFormatter, createTranslator } from "next-intl";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { previewPageOf } from "@/modules/content/events/preview-view";
import { createEvent, duplicateEvent, repeatEvent } from "@/modules/content/events/service";
import { pageSectionStates } from "@/modules/events/domain/page-sections";
import { routePillParts } from "@/modules/events/ui/route-pills";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Estimativ» beside «Diferență de nivel (m)» (`events.elevation_gain_estimated`, migration
 * `0115`): saved through the editor's real action, dropped quietly when the number is empty,
 * carried by a copy and by every date a series makes, and read back by the page's own sources —
 * the preview's page row (§579) and the route pill — as «≈ 350 m D+». The session and navigation
 * stand-ins are `kit-shirt.test.ts`'s.
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
  startsAtWallTime: "2026-10-04T09:00",
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
  distanceMeters: "12000",
  elevationGainMeters: "350",
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
  ro: { slug: "crosul-estimat", title: "Crosul estimat", excerpt: "Urcă cam 350 m." },
  en: { slug: "the-estimated-race", title: "The estimated race", excerpt: "About 350 m up." },
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

/** The editor's settings panel as it posts, with the climb's box and its tick. */
function settingsForm(eventId: string, expectedVersion: number, climb: string, ticked: boolean): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(expectedVersion));
  for (const [name, value] of Object.entries({ ...FIELDS, elevationGainMeters: climb })) {
    if (typeof value === "string") form.set(`event.${name}`, value);
  }
  if (ticked) form.set("event.elevationGainEstimated", "on");
  return form;
}

async function postSave(form: FormData) {
  const outcome = await saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
}

describe("§NNN «Estimativ» on the event's climb", () => {
  it("migration 0115 adds the column, not null and false by default", async () => {
    const { rows } = await db.execute<{ is_nullable: string; column_default: string | null }>(
      sql`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'elevation_gain_estimated'`,
    );
    expect(rows).toEqual([{ is_nullable: "NO", column_default: "false" }]);
    const plain = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect((await reloadEvent(plain.id)).elevationGainEstimated).toBe(false);
  });

  it("is saved through the editor's action, and a tick without a number is saved false with no refusal", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "350", true));
    expect((await reloadEvent(source.id)).elevationGainEstimated).toBe(true);

    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "", true));
    const cleared = await reloadEvent(source.id);
    expect(cleared.elevationGainMeters).toBeNull();
    expect(cleared.elevationGainEstimated).toBe(false);

    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "350", true));
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "350", false));
    expect((await reloadEvent(source.id)).elevationGainEstimated).toBe(false);
  });

  it("reads back through the preview's page row and the route pill as «≈ 350 m D+», and the course section is drawn", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, elevationGainEstimated: true, translations: TRANSLATIONS }, now: NOW });
    const row = await reloadEvent(source.id);
    const translations = await translationsOf(source.id);
    const page = previewPageOf(row, translations.find((text) => text.locale === "ro")!);
    expect(page.elevationGainEstimated).toBe(true);

    const t = createTranslator({ locale: "ro", messages: ro, namespace: "Event" }) as unknown as (key: string, values?: Record<string, string | number>) => string;
    const format = createFormatter({ locale: "ro", timeZone: "Europe/Bucharest" });
    expect(routePillParts(page, t, format).elevation).toMatchObject({ label: "≈ 350 m D+", srLabel: "circa 350 m diferență de nivel (estimativ)" });

    const course = pageSectionStates({ event: row, texts: translations, night: false }).find((section) => section.id === "course");
    expect(course?.isDrawn).toBe(true);
  });

  it("is carried to every date a series makes and kept by a duplicate", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, elevationGainEstimated: true, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-25", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.elevationGainEstimated).toBe(true);

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect((await reloadEvent(copy.id)).elevationGainEstimated).toBe(true);
  });
});
