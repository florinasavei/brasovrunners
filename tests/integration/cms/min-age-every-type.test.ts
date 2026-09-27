import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §505 — the minimum age is one box, `event.minAge`, in the editor's «Regulamentul», for every
 * event type. The editor's own Server Action is called with the form the editor posts (the
 * pattern of `group-run-declaration-flag.test.ts`), so the reader (`actions.ts#eventFieldsFrom`)
 * and the service are both on the path: a group run with no registration and a race registered
 * at another organizer's each store the number typed, and a later save changes it — neither is
 * dropped for not registering on the site.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: () => {
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
const { createEvent } = await import("@/modules/content/events/service");

const NOW = new Date("2026-09-27T10:00:00.000Z");
const ZONE = "Europe/Bucharest";

const GROUP_RUN = {
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

const EXTERNAL_RACE = {
  ...GROUP_RUN,
  type: "RACE",
  surface: "ASPHALT",
  registrationMode: "EXTERNAL",
  externalProvider: "Asociația X",
  externalRegistrationUrl: "https://registration.example.test/cros",
};

const translations = (slug: string) => ({
  ro: { slug, title: `Eveniment ${slug}`, excerpt: "Scurt." },
  en: { slug: `${slug}-en`, title: `Event ${slug}`, excerpt: "Short." },
});

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
});

const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

function editorForm(row: typeof events.$inferSelect, minAge: string): FormData {
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
  put("event.externalProvider", row.externalProvider ?? "");
  put("event.externalRegistrationUrl", row.externalRegistrationUrl ?? "");
  put("event.minAge", minAge);
  return form;
}

async function postSave(form: FormData) {
  const outcome = await saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
}

describe("§505 the minimum age is saved for every type, through the editor's one box", () => {
  it("a group run with no registration stores the number typed, and a later save changes it", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...GROUP_RUN, translations: translations("tura") }, now: NOW });
    await postSave(editorForm(await reload(created.id), "16"));
    expect((await reload(created.id)).minAge).toBe(16);
    await postSave(editorForm(await reload(created.id), "0"));
    expect((await reload(created.id)).minAge).toBe(0);
  });

  it("a race registered at another organizer's stores it too", async () => {
    const created = await createEvent(db, { actor: admin, fields: { ...EXTERNAL_RACE, translations: translations("cros") }, now: NOW });
    expect((await reload(created.id)).registrationMode).toBe("EXTERNAL");
    await postSave(editorForm(await reload(created.id), "16"));
    const row = await reload(created.id);
    expect(row.minAge).toBe(16);
    expect(row.registrationMode).toBe("EXTERNAL");
  });
});
