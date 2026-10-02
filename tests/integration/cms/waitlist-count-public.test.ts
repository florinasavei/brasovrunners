import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, duplicateEvent, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §634 — «Arată public câți așteaptă» (`events.waitlist_count_public`), mirroring §628's switch and the
 * kit's discipline (§554): on for every event that exists and every new one; saved through the editor's
 * real action by its marker, so a form without the box never hides the count; every change written to
 * the trail with from and to; carried to every date a series makes, by a scoped series edit (each
 * date's trail naming it) and by a duplicate. The session and navigation stand-ins are
 * `ask-health-note.test.ts`'s.
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
  ro: { slug: "crosul-cu-lista", title: "Crosul cu lista", excerpt: "Cu listă de așteptare." },
  en: { slug: "waiting-list-race", title: "The waiting-list race", excerpt: "With a waiting list." },
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
const trail = (eventId: string) =>
  db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "event.waitlist_count_public_changed"), eq(auditLogs.entityId, eventId)))
    .orderBy(asc(auditLogs.createdAt));

/** The editor's settings panel as it posts, plus the start list card's count box. */
function settingsForm(eventId: string, expectedVersion: number, count: "on" | "off" | "absent"): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(expectedVersion));
  for (const [name, value] of Object.entries(FIELDS)) {
    if (typeof value === "string") form.set(`event.${name}`, value);
  }
  if (count !== "absent") form.set("event.waitlistCountPublic.present", "1");
  if (count === "on") form.set("event.waitlistCountPublic", "on");
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

describe("§634 «Arată public câți așteaptă» on the event", () => {
  it("is an expand-only migration with a default of on, so every existing event keeps its sentences", async () => {
    const sql = readFileSync(join(process.cwd(), "src/db/migrations/0120_waitlist_count_public.sql"), "utf8").trim();
    expect(sql).toBe('ALTER TABLE "events" ADD COLUMN "waitlist_count_public" boolean DEFAULT true NOT NULL;');
    // A row written by anything that does not name the column — a seed, an older caller — reads on.
    const [row] = await db.insert(events).values({ type: "RACE", startsAt: NOW, registrationMode: "INTERNAL" }).returning();
    expect(row.waitlistCountPublic).toBe(true);
  });

  it("starts on, is written on create when unticked, and the public read carries it", async () => {
    const plain = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect((await reloadEvent(plain.id)).waitlistCountPublic).toBe(true);
    const other = { ro: { ...TRANSLATIONS.ro, slug: "crosul-cu-lista-2" }, en: { ...TRANSLATIONS.en, slug: "waiting-list-race-2" } };
    const hidden = await createEvent(db, { actor: admin, fields: { ...FIELDS, waitlistCountPublic: false, translations: other }, now: NOW });
    expect((await reloadEvent(hidden.id)).waitlistCountPublic).toBe(false);
    await db.update(events).set({ editorialStatus: "PUBLISHED", publishedAt: NOW }).where(eq(events.id, hidden.id));
    expect((await findPublishedEventBySlug(db, "ro", "crosul-cu-lista-2"))?.waitlistCountPublic).toBe(false);
  });

  it("is saved through the editor's action by its marker, a form without the box leaves it alone, and the trail names each change", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "off"));
    expect((await reloadEvent(source.id)).waitlistCountPublic).toBe(false);
    const first = await trail(source.id);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ actorStaffUserId: admin.id, entityType: "event", metadataJson: { from: true, to: false } });

    // No marker: "not editing it" — never "hidden" — and no trail row.
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "absent"));
    expect((await reloadEvent(source.id)).waitlistCountPublic).toBe(false);
    expect(await trail(source.id)).toHaveLength(1);

    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "on"));
    expect((await reloadEvent(source.id)).waitlistCountPublic).toBe(true);
    expect((await trail(source.id)).map((entry) => entry.metadataJson)).toEqual([
      { from: true, to: false },
      { from: false, to: true },
    ]);
    // A save that does not move it writes nothing.
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "on"));
    expect(await trail(source.id)).toHaveLength(2);
  });

  it("does not depend on the names switch: stored off beside a hidden list, and «Lista de așteptare e publică» untouched", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "off"));
    const row = await reloadEvent(source.id);
    expect(row.participantListVisibility).toBe("HIDDEN");
    expect(row.waitlistPublic).toBe(false);
    expect(row.waitlistCountPublic).toBe(false);
  });

  it("is carried to every date a series makes and kept by a duplicate", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, waitlistCountPublic: false, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.waitlistCountPublic).toBe(false);

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect((await reloadEvent(copy.id)).waitlistCountPublic).toBe(false);
  });

  it("a series edit with the 'following' scope carries it to the later dates, each date's trail naming it", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.waitlistCountPublic).toBe(true);

    const row = await reloadEvent(source.id);
    const translations = await translationsOf(source.id);
    const ro = translations.find((t) => t.locale === "ro")!;
    const en = translations.find((t) => t.locale === "en")!;
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS, waitlistCountPublic: false },
      expectedVersion: row.version,
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro) },
        { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en) },
      ],
      scope: "following",
      now: NOW,
    });

    expect((await reloadEvent(source.id)).waitlistCountPublic).toBe(false);
    expect((await trail(source.id)).map((entry) => entry.metadataJson)).toEqual([{ from: true, to: false }]);
    for (const date of dates) {
      expect((await reloadEvent(date.id)).waitlistCountPublic, date.id).toBe(false);
      expect((await trail(date.id)).map((entry) => entry.metadataJson), date.id).toEqual([{ from: true, to: false }]);
    }
  });
});
