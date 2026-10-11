import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventTranslations, events } from "@/db/schema/events";
import { mediaAssets } from "@/db/schema/gallery";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, duplicateEvent, repeatEvent, saveEventAndTranslations, stopRepeat } from "@/modules/content/events/service";
import { readPublicCover } from "@/modules/events/domain/cover";
import { eventKind } from "@/modules/events/domain/event-kind";
import { findPublishedEventBySlug, listUpcomingEvents } from "@/modules/events/repository";
import { ladderKeyPrefixOf } from "@/modules/media/ladder";
import { deleteMediaAsset, listMediaAssetsForAdmin, sweepOrphanAssets } from "@/modules/media/references";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the facelift's phase 2: a cover picture per event (`events.cover_media_asset_id` and
 * `cover_crop`, migration `0141`, expand only) and the event's kind derived from its series.
 *
 * The cover is chosen in the editor's «Copertă» box and saved through the editor's real action by its
 * hidden inputs — a form without the box never takes a cover off — with an audit row naming each
 * change; a series carries it by scope and a repeat or a duplicate copies it; the save refuses an id
 * that is no stored picture, a film's poster and a crop that is not one; the public read carries the
 * stored picture and the crop (and so the public cache does), and the cadence the kind is read from;
 * a picture used as a cover is kept by the sweep and refused by the pictures page's delete. The
 * session and navigation stand-ins are `waitlist-count-public.test.ts`'s.
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
  type: "GROUP_RUN",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-10-07T19:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Parcul Titulescu",
  locationNameEn: "Titulescu Park",
  locationAddress: "",
  surface: "ASPHALT",
  difficulty: "",
  costType: "FREE",
  costAmount: "",
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "8000",
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
  ro: { slug: "alergarea-de-miercuri", title: "Alergarea de miercuri", excerpt: "O oră ușoară." },
  en: { slug: "wednesday-run", title: "The Wednesday run", excerpt: "An easy hour." },
};

const CROP = { x: 0.1, y: 0.2, w: 0.8, h: 0.45 };

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

/** A stored picture of the gallery, as an upload leaves it (a ladder's version-8 prefix, §414). */
async function storedPicture(keyPrefix = ladderKeyPrefixOf(randomUUID())) {
  const [row] = await db.insert(mediaAssets).values({ keyPrefix, originalFilename: "cover.jpg", width: 2400, height: 1350, byteSize: 1000, createdAt: NOW, lastReferencedAt: NOW }).returning();
  return row;
}

const reloadEvent = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
const translationsOf = (id: string) => db.select().from(eventTranslations).where(eq(eventTranslations.eventId, id));
const trail = (eventId: string) =>
  db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "event.cover_changed"), eq(auditLogs.entityId, eventId)))
    .orderBy(asc(auditLogs.createdAt));
const publish = (ids: string[]) => db.update(events).set({ editorialStatus: "PUBLISHED", publishedAt: NOW }).where(inArray(events.id, ids));

/** The editor's settings panel as it posts, with or without «Copertă»'s two hidden inputs. */
function settingsForm(eventId: string, expectedVersion: number, cover: { id: string; crop: string } | "absent"): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(expectedVersion));
  for (const [name, value] of Object.entries(FIELDS)) {
    if (typeof value === "string") form.set(`event.${name}`, value);
  }
  if (cover !== "absent") {
    form.set("event.coverAssetId", cover.id);
    form.set("event.coverCrop", cover.crop);
  }
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

/** The service's save with the event's fields and both languages as they stand, over `scope`. */
async function saveWith(eventId: string, fields: Record<string, unknown>, scope: "this" | "following" | "all" = "this") {
  const row = await reloadEvent(eventId);
  const translations = await translationsOf(eventId);
  return saveEventAndTranslations(db, {
    actor: admin,
    eventId,
    fields: { ...FIELDS, ...fields },
    expectedVersion: row.version,
    translations: translations.map((translation) => ({ translationId: translation.id, expectedVersion: translation.version, fields: wordsFor(translation) })),
    scope,
    now: NOW,
  });
}

async function refusal(promise: Promise<unknown>): Promise<{ code: string; fields: readonly string[] }> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(isDomainError(error), String(error)).toBe(true);
  return isDomainError(error) ? { code: error.code, fields: error.fields } : { code: "", fields: [] };
}

describe("§NNN «Copertă»: the column, the save and the trail", () => {
  it("is an expand-only migration: two nullable columns and a CHECK that a crop has its picture", async () => {
    const sql = readFileSync(join(process.cwd(), "src/db/migrations/0141_event_cover.sql"), "utf8").replace(/\r\n/g, "\n").trim();
    expect(sql).toBe(
      [
        'ALTER TABLE "events" ADD COLUMN "cover_media_asset_id" uuid;--> statement-breakpoint',
        'ALTER TABLE "events" ADD COLUMN "cover_crop" jsonb;--> statement-breakpoint',
        'ALTER TABLE "events" ADD CONSTRAINT "events_cover_crop_needs_picture" CHECK ("events"."cover_crop" IS NULL OR "events"."cover_media_asset_id" IS NOT NULL);',
      ].join("\n"),
    );
    // Every event that exists has none; a crop without its picture cannot be written, even by hand.
    const [row] = await db.insert(events).values({ type: "GROUP_RUN", startsAt: NOW }).returning();
    expect(row.coverMediaAssetId).toBeNull();
    expect(row.coverCrop).toBeNull();
    await expect(db.update(events).set({ coverCrop: CROP }).where(eq(events.id, row.id))).rejects.toThrow();
  });

  it("is stored on create with its crop, and the trail names who chose it", async () => {
    const picture = await storedPicture();
    const event = await createEvent(db, { actor: admin, fields: { ...FIELDS, coverAssetId: picture.id, coverCrop: JSON.stringify(CROP), translations: TRANSLATIONS }, now: NOW });
    const row = await reloadEvent(event.id);
    expect(row.coverMediaAssetId).toBe(picture.id);
    expect(row.coverCrop).toEqual(CROP);
    expect((await trail(event.id)).map((entry) => [entry.actorStaffUserId, entry.metadataJson])).toEqual([[admin.id, { from: null, to: picture.id, cropped: true }]]);

    // Created without one: no cover, and no trail row.
    const other = { ro: { ...TRANSLATIONS.ro, slug: "alta" }, en: { ...TRANSLATIONS.en, slug: "other" } };
    const plain = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: other }, now: NOW });
    expect((await reloadEvent(plain.id)).coverMediaAssetId).toBeNull();
    expect(await trail(plain.id)).toHaveLength(0);
  });

  it("is saved through the editor's action by its inputs; a form without the box leaves it; an empty box clears both; each change is audited once", async () => {
    const [first, second] = [await storedPicture(), await storedPicture()];
    const event = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });

    await postSave(settingsForm(event.id, (await reloadEvent(event.id)).version, { id: first.id, crop: JSON.stringify(CROP) }));
    expect(await reloadEvent(event.id)).toMatchObject({ coverMediaAssetId: first.id, coverCrop: CROP });

    // No inputs: "not editing the cover" — never "no cover" — and no trail row.
    await postSave(settingsForm(event.id, (await reloadEvent(event.id)).version, "absent"));
    expect(await reloadEvent(event.id)).toMatchObject({ coverMediaAssetId: first.id, coverCrop: CROP });

    // The same cover again writes no trail; another picture, whole, does.
    await postSave(settingsForm(event.id, (await reloadEvent(event.id)).version, { id: first.id, crop: JSON.stringify(CROP) }));
    await postSave(settingsForm(event.id, (await reloadEvent(event.id)).version, { id: second.id, crop: "" }));
    expect(await reloadEvent(event.id)).toMatchObject({ coverMediaAssetId: second.id, coverCrop: null });

    // Removed: both columns empty.
    await postSave(settingsForm(event.id, (await reloadEvent(event.id)).version, { id: "", crop: JSON.stringify(CROP) }));
    expect(await reloadEvent(event.id)).toMatchObject({ coverMediaAssetId: null, coverCrop: null });

    expect((await trail(event.id)).map((entry) => entry.metadataJson)).toEqual([
      { from: null, to: first.id, cropped: true },
      { from: first.id, to: second.id, cropped: false },
      { from: second.id, to: null, cropped: false },
    ]);
  });

  it("refuses an id that is no stored picture, a film's poster and a crop that is not one, naming the picture's box", async () => {
    const event = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const picture = await storedPicture();
    const poster = await storedPicture("yt-abcdefghijk");

    for (const fields of [
      { coverAssetId: "not-an-id", coverCrop: "" },
      { coverAssetId: randomUUID(), coverCrop: "" },
      { coverAssetId: poster.id, coverCrop: "" },
      { coverAssetId: picture.id, coverCrop: "{not json" },
      { coverAssetId: picture.id, coverCrop: JSON.stringify({ x: 2, y: 0, w: 1, h: 1 }) },
    ]) {
      const refused = await refusal(saveWith(event.id, fields));
      expect(refused.code, JSON.stringify(fields)).toBe("VALIDATION_ERROR");
      expect(refused.fields, JSON.stringify(fields)).toEqual(["coverAssetId"]);
    }
    // Nothing was written.
    expect((await reloadEvent(event.id)).coverMediaAssetId).toBeNull();
    expect(await trail(event.id)).toHaveLength(0);
  });
});

describe("§NNN «Copertă» across a series", () => {
  it("is copied to every date a repeat makes, and kept by a duplicate", async () => {
    const picture = await storedPicture();
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, coverAssetId: picture.id, coverCrop: JSON.stringify(CROP), translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-28", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date, date.id).toMatchObject({ coverMediaAssetId: picture.id, coverCrop: CROP });

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect(await reloadEvent(copy.id)).toMatchObject({ coverMediaAssetId: picture.id, coverCrop: CROP });
  });

  it("a save with the 'following' scope carries the picture and its crop together, each date's trail naming it", async () => {
    const [first, second] = [await storedPicture(), await storedPicture()];
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-28", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    // One later date has a cover of its own, whole.
    await db.update(events).set({ coverMediaAssetId: second.id }).where(eq(events.id, dates[0].id));

    await saveWith(source.id, { coverAssetId: first.id, coverCrop: JSON.stringify(CROP) }, "following");
    for (const date of dates) {
      expect(await reloadEvent(date.id), date.id).toMatchObject({ coverMediaAssetId: first.id, coverCrop: CROP });
    }
    expect((await trail(dates[1].id)).map((entry) => entry.metadataJson)).toEqual([{ from: null, to: first.id, cropped: true }]);
    expect((await trail(dates[0].id)).map((entry) => entry.metadataJson)).toEqual([{ from: second.id, to: first.id, cropped: true }]);

    // Only the crop moved on the source: the picture travels with it, so no date is left with a
    // crop of another picture — and none with a crop and no picture, which the CHECK refuses.
    await db.update(events).set({ coverMediaAssetId: null, coverCrop: null }).where(eq(events.id, dates[1].id));
    const recrop = { x: 0, y: 0.1, w: 0.9, h: 0.5 };
    await saveWith(source.id, { coverAssetId: first.id, coverCrop: JSON.stringify(recrop) }, "following");
    for (const date of dates) {
      expect(await reloadEvent(date.id), date.id).toMatchObject({ coverMediaAssetId: first.id, coverCrop: recrop });
    }
  });

  it("stays on this date alone with the 'this' scope", async () => {
    const picture = await storedPicture();
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-28", publish: false }, now: NOW });
    await saveWith(source.id, { coverAssetId: picture.id, coverCrop: "" }, "this");
    expect((await reloadEvent(source.id)).coverMediaAssetId).toBe(picture.id);
    for (const date of await db.select().from(events).where(eq(events.repeatOf, source.id))) expect(date.coverMediaAssetId).toBeNull();
  });
});

describe("§NNN the public read: the cover and the kind travel with the row", () => {
  it("carries the stored picture and its crop on the page's read and the listing's, and none for an event without", async () => {
    const picture = await storedPicture();
    const event = await createEvent(db, { actor: admin, fields: { ...FIELDS, coverAssetId: picture.id, coverCrop: JSON.stringify(CROP), translations: TRANSLATIONS }, now: NOW });
    await publish([event.id]);
    const page = await findPublishedEventBySlug(db, "ro", TRANSLATIONS.ro.slug);
    expect(readPublicCover(page?.cover)).toEqual({ keyPrefix: picture.keyPrefix, width: 2400, height: 1350, crop: CROP });
    const [listed] = await listUpcomingEvents(db, "en", NOW);
    expect(readPublicCover(listed.cover)).toEqual({ keyPrefix: picture.keyPrefix, width: 2400, height: 1350, crop: CROP });

    await db.update(events).set({ coverMediaAssetId: null, coverCrop: null }).where(eq(events.id, event.id));
    expect((await findPublishedEventBySlug(db, "ro", TRANSLATIONS.ro.slug))?.cover).toBeNull();
  });

  it("reads a weekly series' dates as weekly, a one-off, a fortnightly series and a stopped one as special", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const other = { ro: { ...TRANSLATIONS.ro, slug: "crosul", title: "Crosul" }, en: { ...TRANSLATIONS.en, slug: "the-cross", title: "The cross" } };
    const oneOff = await createEvent(db, { actor: admin, fields: { ...FIELDS, type: "RACE", translations: other }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-28", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    await publish([source.id, oneOff.id, ...dates.map((date) => date.id)]);

    const kinds = async () => new Map((await listUpcomingEvents(db, "ro", NOW)).map((row) => [row.id, { cadence: row.seriesCadence, kind: eventKind(row) }]));
    const before = await kinds();
    expect(before.get(source.id)).toEqual({ cadence: "WEEKLY", kind: "weekly" });
    for (const date of dates) expect(before.get(date.id), date.id).toEqual({ cadence: "WEEKLY", kind: "weekly" });
    expect(before.get(oneOff.id)).toEqual({ cadence: null, kind: "special" });

    // Stopped (§275): the source is a one-off again, and so is every date it made.
    await stopRepeat(db, { actor: admin, eventId: source.id, now: NOW });
    const after = await kinds();
    for (const id of [source.id, ...dates.map((date) => date.id)]) expect(after.get(id), id).toEqual({ cadence: null, kind: "special" });

    // A series every two weeks is not a weekly run (decision 9).
    await repeatEvent(db, { actor: admin, eventId: oneOff.id, rule: { cadence: "FORTNIGHTLY", weekdays: [], until: "2026-10-28", publish: false }, now: NOW });
    expect((await kinds()).get(oneOff.id)).toEqual({ cadence: "FORTNIGHTLY", kind: "special" });
  });
});

describe("§NNN a picture used as a cover is the event's", () => {
  it("is never swept, is refused by the pictures page's delete, and is listed as used by the event", async () => {
    const picture = await storedPicture();
    const event = await createEvent(db, { actor: admin, fields: { ...FIELDS, coverAssetId: picture.id, coverCrop: "", translations: TRANSLATIONS }, now: NOW });

    const monthLater = new Date(NOW.getTime() + 30 * 24 * 60 * 60_000);
    expect(await sweepOrphanAssets(db, monthLater)).toBe(0);
    const refused = await refusal(deleteMediaAsset(db, { actor: { id: admin.id, role: "ADMIN" }, assetId: picture.id }));
    expect(refused.code).toBe("VALIDATION_ERROR");
    const listed = (await listMediaAssetsForAdmin(db, "ro")).find((row) => row.id === picture.id);
    expect(listed?.references).toEqual([{ kind: "event", id: event.id, title: TRANSLATIONS.ro.title }]);

    // Taken off the event, it is a picture used nowhere again: the delete goes through.
    await db.update(events).set({ coverMediaAssetId: null }).where(eq(events.id, event.id));
    await deleteMediaAsset(db, { actor: { id: admin.id, role: "ADMIN" }, assetId: picture.id });
    expect(await db.select().from(mediaAssets).where(eq(mediaAssets.id, picture.id))).toHaveLength(0);
  });
});
