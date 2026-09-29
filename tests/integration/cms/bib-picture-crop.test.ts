import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { mediaAssets } from "@/db/schema/gallery";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, duplicateEvent, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { deleteMediaAsset, listMediaAssetsForAdmin, sweepOrphanAssets } from "@/modules/media/references";
import { uploadBodyImage } from "@/modules/media/service";
import { readLocalObject } from "@/modules/media/storage";
import { type BibDesign, DEFAULT_BIB_DESIGN } from "@/modules/registrations/bib-design";
import { bibPreviewUrl } from "@/modules/registrations/bib-design-query";
import { readBibPictureFacts } from "@/modules/registrations/bib-pictures";
import { findEventForBibs } from "@/modules/registrations/bibs";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-038-01, §NNN (amending §249 and §485) — the bib designer's two pictures with a crop each:
 * saved with the event's design through the editor's own action, drawn by the preview route with
 * the crop and the picture read as a PNG with its size, counted as in use by the pictures' references (so the
 * sweep never takes one and a delete is refused), carried by a series and kept by a duplicate.
 *
 * The renderer itself is `tests/unit/registrations/bib-picture-crop.test.ts`'s (the pixels); here
 * it is replaced by a recorder, so what is asserted is what the route hands it.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  redirected: [] as string[],
  drawn: [] as Array<Record<string, unknown>>,
}));

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
vi.mock("@/modules/registrations/bib-image", () => ({
  renderBibImage: async (input: Record<string, unknown>) => {
    state.drawn.push(input);
    return new Response("png", { headers: { "content-type": "image/png" } });
  },
}));

const { saveEventAndTranslationsAction } = await import("@/app/[locale]/admin/actions");
const { GET: preview } = await import("@/app/api/admin/events/[id]/bibs/preview/route");

const NOW = new Date("2026-09-29T10:00:00.000Z");

const FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-10-11T09:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Parcul Tractorul",
  locationNameEn: "Tractorul Park",
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
  ro: { slug: "crosul-cu-sponsori", title: "Crosul cu sponsori", excerpt: "Cu sponsori." },
  en: { slug: "sponsors-race", title: "The sponsors' race", excerpt: "With sponsors." },
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
  state.drawn.length = 0;
});

const reloadEvent = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

/** A stored picture of the given size, through the one upload every picture takes (§414). */
async function stored(width: number, height: number, now = NOW) {
  const file = await sharp({ create: { width, height, channels: 3, background: "#3355ff" } }).jpeg().toBuffer();
  return uploadBodyImage(db, { actorId: admin.id, file, originalFilename: `sponsori-${width}x${height}.jpg`, now });
}

const HEADER_CROP = { x: 0, y: 0.3891, w: 1, h: 0.2217 };
const SPONSOR_CROP = { x: 0, y: 0.477, w: 1, h: 0.0459 };

/** The editor's form as the design panel posts it: the marker, the switches, the pictures' hidden fields. */
function designForm(eventId: string, expectedVersion: number, design: { header: string; sponsors: string }): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(expectedVersion));
  for (const [name, value] of Object.entries(FIELDS)) {
    if (typeof value === "string") form.set(`event.${name}`, value);
  }
  form.set("event.bibDesign.present", "1");
  for (const on of ["showName", "showEventTitle", "showDate", "showLogo", "showEmail", "showPartners"]) form.set(`event.bibDesign.${on}`, "on");
  form.set("event.bibDesign.numberScale", "medium");
  form.set("event.bibDesign.namePosition", "below");
  form.set("event.bibDesign.footerText", "");
  form.set("event.bibDesign.headerImageSrc", design.header);
  form.set("event.bibDesign.headerImageCrop", JSON.stringify(HEADER_CROP));
  form.set("event.bibDesign.sponsorImageSrc", design.sponsors);
  form.set("event.bibDesign.sponsorImageCrop", JSON.stringify(SPONSOR_CROP));
  return form;
}

async function postSave(form: FormData) {
  const outcome = await saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
}

describe("§NNN a crop per picture place, saved with the bib's design", () => {
  it("is saved by the editor's action with the rest of the design, and read back by what both renderers call", async () => {
    const header = await stored(2000, 1000);
    const sponsors = await stored(2000, 200);
    const event = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await postSave(designForm(event.id, (await reloadEvent(event.id)).version, { header: header.src, sponsors: sponsors.src }));

    const design = (await findEventForBibs(db, event.id, "ro"))?.design;
    expect(design?.headerImageSrc).toBe(header.src);
    expect(design?.headerImageCrop).toEqual(HEADER_CROP);
    expect(design?.sponsorImageSrc).toBe(sponsors.src);
    expect(design?.sponsorImageCrop).toEqual(SPONSOR_CROP);

    // The editor finds each picture's facts again from the address alone: the asset and its size.
    const facts = await readBibPictureFacts(db, [design!.headerImageSrc, design!.sponsorImageSrc]);
    expect(facts.get(header.src)).toMatchObject({ id: header.assetId, width: 2000, height: 1000 });
    expect(facts.get(sponsors.src)).toMatchObject({ id: sponsors.assetId, width: 2000, height: 200 });
  });

  it("drops a crop that came without its picture", async () => {
    const event = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const form = designForm(event.id, (await reloadEvent(event.id)).version, { header: "", sponsors: "" });
    await postSave(form);
    const design = (await findEventForBibs(db, event.id, "ro"))?.design;
    expect(design?.headerImageSrc).toBeNull();
    expect(design?.headerImageCrop).toBeNull();
    expect(design?.sponsorImageCrop).toBeNull();
  });
});

describe("§NNN a deleted gallery picture drops out of the design", () => {
  /**
   * A design that names a picture no longer in the gallery: deleted from «Poze» while nothing
   * counted the race numbers as a reference (before §NNN), so the design still names its address.
   */
  async function designNamingADeletedPicture() {
    const gone = await stored(1600, 400);
    await deleteMediaAsset(db, { actor: admin, assetId: gone.assetId });
    const sponsors = await stored(2000, 200);
    const event = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await db
      .update(events)
      .set({
        bibDesign: {
          ...DEFAULT_BIB_DESIGN,
          headerImageSrc: gone.src,
          headerImageCrop: HEADER_CROP,
          sponsorImageSrc: sponsors.src,
          sponsorImageCrop: SPONSOR_CROP,
        },
      })
      .where(eq(events.id, event.id));
    return { gone, sponsors, event };
  }

  it("has no facts, so the editor shows its place empty, and the other place keeps its picture", async () => {
    const { gone, sponsors } = await designNamingADeletedPicture();
    const facts = await readBibPictureFacts(db, [gone.src, sponsors.src]);
    expect(facts.has(gone.src)).toBe(false);
    expect(facts.get(sponsors.src)).toMatchObject({ id: sponsors.assetId, src: sponsors.src, width: 2000, height: 200 });
    expect(facts.size).toBe(1);
  });

  it("is dropped, with its crop, by the next save, and the other place's picture and crop are kept", async () => {
    const { gone, sponsors, event } = await designNamingADeletedPicture();
    const before = (await findEventForBibs(db, event.id, "ro"))?.design;
    expect(before?.headerImageSrc).toBe(gone.src);

    // What the panel posts: a place whose picture has no facts is rendered empty — no address, no
    // crop (`BibDesignPanel`, `BibPictureField`) — and the other place posts what it holds.
    const facts = await readBibPictureFacts(db, [before!.headerImageSrc, before!.sponsorImageSrc]);
    const form = designForm(event.id, (await reloadEvent(event.id)).version, {
      header: facts.get(gone.src)?.src ?? "",
      sponsors: facts.get(sponsors.src)?.src ?? "",
    });
    form.set("event.bibDesign.headerImageCrop", "");
    await postSave(form);

    const after = (await findEventForBibs(db, event.id, "ro"))?.design;
    expect(after?.headerImageSrc).toBeNull();
    expect(after?.headerImageCrop).toBeNull();
    expect(after?.sponsorImageSrc).toBe(sponsors.src);
    expect(after?.sponsorImageCrop).toEqual(SPONSOR_CROP);
  });
});

describe("§NNN the preview route draws the unsaved crop", () => {
  it("hands the renderer the crop from the address and each picture, read and made a PNG", async () => {
    const header = await stored(2000, 1000);
    const sponsors = await stored(2000, 200);
    const event = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    // The address the panel's preview builds from the form's boxes, the hidden crop fields included.
    const design = {
      ...DEFAULT_BIB_DESIGN,
      headerImageSrc: header.src,
      headerImageCrop: JSON.stringify(HEADER_CROP),
      sponsorImageSrc: sponsors.src,
      sponsorImageCrop: JSON.stringify(SPONSOR_CROP),
    };
    const address = bibPreviewUrl({ eventId: event.id, locale: "ro", number: "7", colour: "", design });
    // The route reads each picture from the store over HTTP, as it does deployed: here from the
    // local store's own files, which is what `/api/media/<key>` serves.
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const key = new URL(String(input)).pathname.replace(/^\/api\/media\//, "");
      const object = await readLocalObject(key);
      return object ? new Response(new Uint8Array(object.body), { headers: { "content-type": object.contentType } }) : new Response(null, { status: 404 });
    });
    try {
      const response = await preview(new Request(`http://localhost${address}`), { params: Promise.resolve({ id: event.id }) });
      expect(response.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }

    const [drawn] = state.drawn;
    const drawnDesign = drawn.design as BibDesign;
    expect(drawnDesign.headerImageCrop).toEqual(HEADER_CROP);
    expect(drawnDesign.sponsorImageCrop).toEqual(SPONSOR_CROP);
    // Each stored WebP handed over as a PNG `next/og` can draw, with its size — the proportion the
    // crop was drawn over (2 : 1 and 10 : 1).
    const pictures = drawn.pictures as Record<"header" | "sponsors", { src: string; width: number; height: number } | null>;
    expect(pictures.header?.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(pictures.sponsors?.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(pictures.header!.width / pictures.header!.height).toBeCloseTo(2, 1);
    expect(pictures.sponsors!.width / pictures.sponsors!.height).toBeCloseTo(10, 0);
  });

  it("reads a stored crop for the renderers of a real bib and of the sheet", async () => {
    const sponsors = await stored(2000, 200);
    const event = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await db
      .update(events)
      .set({ bibDesign: { ...DEFAULT_BIB_DESIGN, sponsorImageSrc: sponsors.src, sponsorImageCrop: SPONSOR_CROP } })
      .where(eq(events.id, event.id));
    // `findEventForBibs` is what the sheet route and the real-bib preview both draw from.
    const loaded = await findEventForBibs(db, event.id, "ro");
    expect(loaded?.design.sponsorImageCrop).toEqual(SPONSOR_CROP);
  });
});

describe("§NNN a picture on the race numbers is in use", () => {
  const later = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60_000);

  it("is never swept, is refused a delete, and the pictures page names the event", async () => {
    const sponsors = await stored(2000, 200);
    const unused = await stored(800, 600);
    const event = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await db
      .update(events)
      .set({ bibDesign: { ...DEFAULT_BIB_DESIGN, sponsorImageSrc: sponsors.src, sponsorImageCrop: SPONSOR_CROP } })
      .where(eq(events.id, event.id));

    // A fortnight on: the unused picture goes, the bib's stays.
    expect(await sweepOrphanAssets(db, later(14))).toBe(1);
    const left = await db.select({ id: mediaAssets.id }).from(mediaAssets);
    expect(left.map((row) => row.id)).toEqual([sponsors.assetId]);
    expect(unused.assetId).not.toBe(sponsors.assetId);

    let code = "no error";
    try {
      await deleteMediaAsset(db, { actor: admin, assetId: sponsors.assetId });
    } catch (error) {
      if (!isDomainError(error)) throw error;
      code = error.code;
    }
    expect(code).toBe("VALIDATION_ERROR");

    const [row] = (await listMediaAssetsForAdmin(db, "ro")).filter((asset) => asset.id === sponsors.assetId);
    expect(row.references).toEqual([{ kind: "event", id: event.id, title: TRANSLATIONS.ro.title }]);
  });

  it("is free again once the design no longer names it", async () => {
    const sponsors = await stored(2000, 200);
    const event = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await db.update(events).set({ bibDesign: { ...DEFAULT_BIB_DESIGN, sponsorImageSrc: sponsors.src } }).where(eq(events.id, event.id));
    await db.update(events).set({ bibDesign: DEFAULT_BIB_DESIGN }).where(eq(events.id, event.id));
    await deleteMediaAsset(db, { actor: admin, assetId: sponsors.assetId });
    expect(await db.select().from(mediaAssets).where(eq(mediaAssets.id, sponsors.assetId))).toEqual([]);
  });
});

describe("§NNN the design, crops included, goes with the race", () => {
  const cropped = (src: string): BibDesign => ({ ...DEFAULT_BIB_DESIGN, sponsorImageSrc: src, sponsorImageCrop: SPONSOR_CROP });

  it("is carried to every date a series makes and kept by a duplicate", async () => {
    const sponsors = await stored(2000, 200);
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await db.update(events).set({ bibDesign: cropped(sponsors.src), bibColour: "#1b7f3b" }).where(eq(events.id, source.id));

    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-25", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect((await findEventForBibs(db, date.id, "ro"))?.design).toEqual(cropped(sponsors.src));

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    const copied = await reloadEvent(copy.id);
    expect(copied.bibColour).toBe("#1b7f3b");
    expect((await findEventForBibs(db, copy.id, "ro"))?.design).toEqual(cropped(sponsors.src));
  });

  it("a series edit with the 'following' scope carries a new crop to the later dates", async () => {
    const sponsors = await stored(2000, 200);
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-25", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);

    const row = await reloadEvent(source.id);
    const translations = await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, source.id));
    const words = (locale: "ro" | "en") => {
      const translation = translations.find((t) => t.locale === locale)!;
      return {
        translationId: translation.id,
        expectedVersion: translation.version,
        fields: { slug: translation.slug, title: translation.title, excerpt: translation.excerpt ?? "", seoTitle: "", seoDescription: "" },
      };
    };
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS, bibDesign: cropped(sponsors.src) },
      expectedVersion: row.version,
      translations: [words("ro"), words("en")],
      scope: "following",
      now: NOW,
    });

    expect((await findEventForBibs(db, source.id, "ro"))?.design).toEqual(cropped(sponsors.src));
    for (const date of dates) expect((await findEventForBibs(db, date.id, "ro"))?.design).toEqual(cropped(sponsors.src));
  });
});
