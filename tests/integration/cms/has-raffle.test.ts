import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { readFileSync } from "node:fs";
import { createEvent, duplicateEvent, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { eventHoldsRaffle } from "@/modules/registrations/raffle-mark";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §949 — «Avem tombolă» (`events.has_raffle`; the owner, 2026-11-16: «o setare per eveniment cum ar fi „avem tombolă" dar doar în
 * backoffice vizibil»): off on every event until an Administrator ticks it in the editor — the event's save is theirs (§542), so
 * the Organizer, who works the column it shows, does not switch it; saved through the editor's real action by its marker (a
 * form without the box never switches it off); one edition's own, so neither a series' later dates, a series edit «from this
 * date» (§953) nor a copy carry it; and never among the columns a public page reads. The session and navigation stand-ins are
 * `kit-shirt.test.ts`'s.
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
  ro: { slug: "crosul-cu-tombola", title: "Crosul cu tombolă", excerpt: "Cu tombolă." },
  en: { slug: "raffle-race", title: "The raffle race", excerpt: "With a raffle." },
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
/** A language's words as the editor posts them back unchanged (`kit-shirt.test.ts`'s). */
const wordsFor = (row: { slug: string; title: string; excerpt: string | null }) => ({ slug: row.slug, title: row.title, excerpt: row.excerpt ?? "", seoTitle: "", seoDescription: "" });

/** The editor's settings panel as it posts (`discount-note-series.test.ts`'s `settingsOnlyForm`), plus the raffle's box. */
function settingsForm(eventId: string, expectedVersion: number, raffle: "on" | "off" | "absent"): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(expectedVersion));
  for (const [name, value] of Object.entries(FIELDS)) {
    if (typeof value === "string") form.set(`event.${name}`, value);
  }
  if (raffle !== "absent") form.set("event.hasRaffle.present", "1");
  if (raffle === "on") form.set("event.hasRaffle", "on");
  return form;
}

async function postSave(form: FormData) {
  const outcome = await saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
}

describe("§949 «Avem tombolă» on the event", () => {
  it("starts off, and is written on create when ticked", async () => {
    const plain = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect((await reloadEvent(plain.id)).hasRaffle).toBe(false);
    expect(await eventHoldsRaffle(db, plain.id)).toBe(false);
    const other = { ro: { ...TRANSLATIONS.ro, slug: "crosul-cu-tombola-2" }, en: { ...TRANSLATIONS.en, slug: "raffle-race-2" } };
    const ticked = await createEvent(db, { actor: admin, fields: { ...FIELDS, hasRaffle: true, translations: other }, now: NOW });
    expect((await reloadEvent(ticked.id)).hasRaffle).toBe(true);
    expect(await eventHoldsRaffle(db, ticked.id)).toBe(true);
    // An event that is not there holds none, and neither does an address that is no id.
    expect(await eventHoldsRaffle(db, "11111111-1111-4111-8111-111111111111")).toBe(false);
    expect(await eventHoldsRaffle(db, "not-an-id")).toBe(false);
  });

  it("is saved through the editor's action by its marker, and a form without the box leaves it alone", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "on"));
    expect((await reloadEvent(source.id)).hasRaffle).toBe(true);

    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "absent"));
    expect((await reloadEvent(source.id)).hasRaffle).toBe(true);

    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "off"));
    expect((await reloadEvent(source.id)).hasRaffle).toBe(false);
  });

  it("is one edition's own: a series' later dates and a copy start without it", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, hasRaffle: true, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.hasRaffle).toBe(false);

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect((await reloadEvent(copy.id)).hasRaffle).toBe(false);
    expect((await reloadEvent(source.id)).hasRaffle).toBe(true);
  });

  /** The editor's whole save of one date of a series, the raffle's box ticked or cleared, reaching the dates `scope` says. */
  async function saveSeriesDate(eventId: string, hasRaffle: boolean, scope: "this" | "following" | "all", distanceMeters = FIELDS.distanceMeters) {
    const row = await reloadEvent(eventId);
    const translations = await translationsOf(eventId);
    const ro = translations.find((t) => t.locale === "ro")!;
    const en = translations.find((t) => t.locale === "en")!;
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId,
      fields: { ...FIELDS, distanceMeters, hasRaffle },
      expectedVersion: row.version,
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro) },
        { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en) },
      ],
      scope,
      now: NOW,
    });
  }

  it("a series edit with the 'following' scope does not carry the tick to the later dates (§953) — the mirror of the kit's, which does", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.hasRaffle).toBe(false);

    // Ticked on the first date, «from this date»: with a distance changed in the same save, so the save does reach the later dates.
    await saveSeriesDate(source.id, true, "following", "12000");

    expect((await reloadEvent(source.id)).hasRaffle).toBe(true);
    for (const date of dates) {
      const later = await reloadEvent(date.id);
      // The series' own column travelled; the raffle is the one edition's.
      expect(later.distanceMeters, date.id).toBe(12000);
      expect(later.hasRaffle, date.id).toBe(false);
    }

    // Nor the other way: a date that holds a raffle of its own keeps it when an earlier date is saved without one, for every date.
    await db.update(events).set({ hasRaffle: true }).where(eq(events.id, dates[0].id));
    await saveSeriesDate(source.id, false, "all", "13000");
    expect((await reloadEvent(source.id)).hasRaffle).toBe(false);
    expect((await reloadEvent(dates[0].id)).hasRaffle).toBe(true);
    for (const date of dates) expect((await reloadEvent(date.id)).distanceMeters, date.id).toBe(13000);
  });

  it("is ticked by an Administrator alone: the Organizer's save of the event is refused, the box with it (BR-REQ-060-01)", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const [organizer] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Organizer", role: "MODERATOR" }).returning();
    const row = await reloadEvent(source.id);
    const refused = await saveEventAndTranslations(db, { actor: organizer, eventId: source.id, fields: { ...FIELDS, hasRaffle: true }, expectedVersion: row.version, translations: [], scope: "this", now: NOW }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");
    expect((await reloadEvent(source.id)).hasRaffle).toBe(false);
  });

  it("is in no column a public page reads, nor in the event's file", () => {
    const repository = readFileSync("src/modules/events/repository.ts", "utf8");
    expect(repository).not.toMatch(/hasRaffle|has_raffle/);
    for (const file of ["file-format.ts", "export.ts", "fields-from-config.ts", "diff.ts"]) {
      expect(readFileSync(`src/modules/content/events/transfer/${file}`, "utf8"), file).not.toMatch(/hasRaffle/);
    }
  });
});
