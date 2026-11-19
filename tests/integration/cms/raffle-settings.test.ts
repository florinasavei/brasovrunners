import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, duplicateEvent, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §984 — the raffle's settings beside «Avem tombolă» (the owner, 2026-11-18: «trebuie să bifez acolo cine se poate înscrie: doar
 * alergătorii și elitele și voluntarii», «Vreau să pot bifa asta: tombolă din oficiu vs tombolă cu înscriere separată»), BR-REQ-050-02
 * and BR-REQ-060-01: «Cine poate participa» (three ticks, all on by default), «Cum» (`raffle_sign_up`, «Din oficiu» by default) and
 * «Înscrierile la tombolă sunt deschise» (`raffle_sign_up_open`, shut by default), saved through the editor's real action by their
 * markers — a form without a box never changes it —, the Administrator's save alone (§542), one edition's own (no series edit, repeat
 * or copy carries them, nor the event's file), and never among the columns a public page reads. `has-raffle.test.ts`'s stand-ins.
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

/** What a raffle saved with every box changed from its default reads like. */
const CHANGED = { raffleRunners: false, raffleElites: false, raffleVolunteers: true, raffleSignUp: true, raffleSignUpOpen: true };
/** And the defaults: every group ticked, «Din oficiu», the sign-ups shut. */
const DEFAULTS = { raffleRunners: true, raffleElites: true, raffleVolunteers: true, raffleSignUp: false, raffleSignUpOpen: false };

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
const settingsOf = (row: typeof events.$inferSelect) => ({
  raffleRunners: row.raffleRunners,
  raffleElites: row.raffleElites,
  raffleVolunteers: row.raffleVolunteers,
  raffleSignUp: row.raffleSignUp,
  raffleSignUpOpen: row.raffleSignUpOpen,
});
const translationsOf = (id: string) => db.select().from(eventTranslations).where(eq(eventTranslations.eventId, id));
const wordsFor = (row: { slug: string; title: string; excerpt: string | null }) => ({ slug: row.slug, title: row.title, excerpt: row.excerpt ?? "", seoTitle: "", seoDescription: "" });

/**
 * The editor's settings panel as it posts: the raffle's box ticked, and its settings as the box draws them — each tick with its
 * marker, «Cum» a select of two answers. `boxes: "absent"` is a form that carried none of them.
 */
function settingsForm(eventId: string, expectedVersion: number, boxes: "absent" | { runners: boolean; elites: boolean; volunteers: boolean; how: string; open: boolean }): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(expectedVersion));
  for (const [name, value] of Object.entries(FIELDS)) {
    if (typeof value === "string") form.set(`event.${name}`, value);
  }
  form.set("event.hasRaffle.present", "1");
  form.set("event.hasRaffle", "on");
  if (boxes === "absent") return form;
  for (const [name, on] of [["raffleRunners", boxes.runners], ["raffleElites", boxes.elites], ["raffleVolunteers", boxes.volunteers], ["raffleSignUpOpen", boxes.open]] as const) {
    form.set(`event.${name}.present`, "1");
    if (on) form.set(`event.${name}`, "on");
  }
  form.set("event.raffleSignUp", boxes.how);
  return form;
}

async function postSave(form: FormData) {
  const outcome = await saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
}

describe("§984 BR-REQ-050-02 the raffle's settings in the event editor", () => {
  it("start as every group ticked, «Din oficiu» and the sign-ups shut, on every event", async () => {
    const plain = await createEvent(db, { actor: admin, fields: { ...FIELDS, hasRaffle: true, translations: TRANSLATIONS }, now: NOW });
    expect(settingsOf(await reloadEvent(plain.id))).toEqual(DEFAULTS);
  });

  it("are saved through the editor's action by their markers, and a form without them leaves them alone", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, hasRaffle: true, translations: TRANSLATIONS }, now: NOW });
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, { runners: false, elites: false, volunteers: true, how: "true", open: true }));
    expect(settingsOf(await reloadEvent(source.id))).toEqual(CHANGED);

    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "absent"));
    expect(settingsOf(await reloadEvent(source.id))).toEqual(CHANGED);

    // «Cum»: only its two answers are an answer; anything else a forged form posts is "not editing it".
    const form = settingsForm(source.id, (await reloadEvent(source.id)).version, { runners: true, elites: true, volunteers: true, how: "maybe", open: false });
    await postSave(form);
    expect(settingsOf(await reloadEvent(source.id))).toEqual({ ...DEFAULTS, raffleSignUp: true });

    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, { runners: true, elites: true, volunteers: true, how: "false", open: false }));
    expect(settingsOf(await reloadEvent(source.id))).toEqual(DEFAULTS);
  });

  it("are one edition's own: a series' later dates, a series edit «from this date» and a copy start with the defaults", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, hasRaffle: true, ...CHANGED, translations: TRANSLATIONS }, now: NOW });
    expect(settingsOf(await reloadEvent(source.id))).toEqual(CHANGED);
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(settingsOf(date), date.id).toEqual(DEFAULTS);

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect(settingsOf(await reloadEvent(copy.id))).toEqual(DEFAULTS);

    // Saved again «from this date» with another distance: the series' own column travels, the raffle's settings do not.
    const row = await reloadEvent(source.id);
    const translations = await translationsOf(source.id);
    const ro = translations.find((t) => t.locale === "ro")!;
    const en = translations.find((t) => t.locale === "en")!;
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS, distanceMeters: "12000", hasRaffle: true, ...CHANGED },
      expectedVersion: row.version,
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro) },
        { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en) },
      ],
      scope: "following",
      now: NOW,
    });
    for (const date of dates) {
      const later = await reloadEvent(date.id);
      expect(later.distanceMeters, date.id).toBe(12000);
      expect(settingsOf(later), date.id).toEqual(DEFAULTS);
    }
  });

  it("are saved by an Administrator alone: the Organizer's save of the event is refused, the settings with it (BR-REQ-060-01)", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, hasRaffle: true, translations: TRANSLATIONS }, now: NOW });
    const [organizer] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Organizer", role: "MODERATOR" }).returning();
    const row = await reloadEvent(source.id);
    const refused = await saveEventAndTranslations(db, { actor: organizer, eventId: source.id, fields: { ...FIELDS, hasRaffle: true, ...CHANGED }, expectedVersion: row.version, translations: [], scope: "this", now: NOW }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");
    expect(settingsOf(await reloadEvent(source.id))).toEqual(DEFAULTS);
  });

  it("are in no column a public query reads, nor in the event's file — the sign-up's gate reads them through the roster alone", () => {
    const repository = readFileSync("src/modules/events/repository.ts", "utf8");
    expect(repository).not.toMatch(/raffle/i);
    for (const file of ["file-format.ts", "export.ts", "fields-from-config.ts", "diff.ts"]) {
      expect(readFileSync(`src/modules/content/events/transfer/${file}`, "utf8"), file).not.toMatch(/raffle/i);
    }
    // The one public read: the gate's, through `readRaffleEvent`.
    const reads = readFileSync("src/modules/public-cache/reads.ts", "utf8");
    expect(reads).toMatch(/readRaffleEvent\(getDb\(\), eventId\)/);
    expect(reads).not.toMatch(/raffleRunners|raffleSignUpOpen/);
  });
});
