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
 * §NNN — «Aproximativ» beside «Distanță (m)» (`events.distance_estimated`, migration `0116`), the
 * twin of §585's climb: saved through the editor's real action, dropped quietly when the distance
 * is empty, carried by a copy and by every date a series makes, and read back by the page's own
 * sources — the preview's page row (§579) and the route pill — as «≈ 12 km». The session and
 * navigation stand-ins are `elevation-estimated.test.ts`'s.
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
  ro: { slug: "crosul-aproximativ", title: "Crosul aproximativ", excerpt: "Cam 12 km." },
  en: { slug: "the-approximate-race", title: "The approximate race", excerpt: "About 12 km." },
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

/** The editor's settings panel as it posts, with the distance's box and its tick. */
function settingsForm(eventId: string, expectedVersion: number, distance: string, ticked: boolean): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(expectedVersion));
  for (const [name, value] of Object.entries({ ...FIELDS, distanceMeters: distance })) {
    if (typeof value === "string") form.set(`event.${name}`, value);
  }
  if (ticked) form.set("event.distanceEstimated", "on");
  return form;
}

async function postSave(form: FormData) {
  const outcome = await saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
}

describe("§NNN «Aproximativ» on the event's distance", () => {
  it("migration 0116 adds the column, not null and false by default", async () => {
    const { rows } = await db.execute<{ is_nullable: string; column_default: string | null }>(
      sql`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'distance_estimated'`,
    );
    expect(rows).toEqual([{ is_nullable: "NO", column_default: "false" }]);
    const plain = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect((await reloadEvent(plain.id)).distanceEstimated).toBe(false);
  });

  it("is saved through the editor's action, and a tick without a distance is saved false with no refusal", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "12000", true));
    expect((await reloadEvent(source.id)).distanceEstimated).toBe(true);

    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "", true));
    const cleared = await reloadEvent(source.id);
    expect(cleared.distanceMeters).toBeNull();
    expect(cleared.distanceEstimated).toBe(false);

    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "12000", true));
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "12000", false));
    expect((await reloadEvent(source.id)).distanceEstimated).toBe(false);
  });

  it("reads back through the preview's page row and the route pill as «≈ 12 km», and the course section is drawn", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, distanceEstimated: true, translations: TRANSLATIONS }, now: NOW });
    const row = await reloadEvent(source.id);
    const translations = await translationsOf(source.id);
    const page = previewPageOf(row, translations.find((text) => text.locale === "ro")!);
    expect(page.distanceEstimated).toBe(true);

    const t = createTranslator({ locale: "ro", messages: ro, namespace: "Event" }) as unknown as (key: string, values?: Record<string, string | number>) => string;
    const format = createFormatter({ locale: "ro", timeZone: "Europe/Bucharest" });
    expect(routePillParts(page, t, format).distance).toMatchObject({ label: "≈ 12 km", srLabel: "circa 12 km (aproximativ)" });

    const course = pageSectionStates({ event: row, texts: translations, night: false }).find((section) => section.id === "course");
    expect(course?.isDrawn).toBe(true);
  });

  it("is carried to every date a series makes and kept by a duplicate", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, distanceEstimated: true, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-25", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.distanceEstimated).toBe(true);

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect((await reloadEvent(copy.id)).distanceEstimated).toBe(true);
  });
});
