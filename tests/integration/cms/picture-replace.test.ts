import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { galleryAlbums, galleryItems, mediaAssets } from "@/db/schema/gallery";
import { pageTranslations } from "@/db/schema/pages";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { readRichText } from "@/modules/content/rich-text/domain/schema";
import { replacedPictureAttrs } from "@/modules/content/rich-text/domain/replace-picture";
import { processUploadedImage } from "@/modules/media/images";
import { assetObjectKeys, objectKey, readLocalObject } from "@/modules/media/storage";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Înlocuiește» (§NNN, amending §72 and §73; BR-REQ-054-01, BR-REQ-050-03, BR-REQ-060-01) —
 * against PGlite and the in-memory store (`APP_ENV=test`).
 *
 * The one verb, `replaceStoredPicture`: the new picture under a new key prefix, the references the
 * caller names moved to it, the old picture's row and objects deleted only when nothing else uses it,
 * one audit row, the caller's cache tags expired after the commit. The gallery's photo keeps its
 * place and its cover role; the route refuses whoever may not delete a photo. A picture in a text
 * is replaced in the document, and its old picture waits for the save and the sweep.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, expired: [] as string[][] }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("@/auth", () => ({ signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
// The public cache, watched: a replacement must expire what the place's own save expires (§333).
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: (...contents: string[]) => {
    state.expired.push(contents);
  },
}));

const { POST } = await import("@/app/api/admin/gallery/[id]/photos/route");
const { addPhoto, addStoredPhoto, createAlbum, replacePhoto, transitionAlbum } = await import("@/modules/content/gallery/service");
const { findPublishedAlbumBySlug } = await import("@/modules/content/gallery/repository");
const { createPage, savePage } = await import("@/modules/content/pages/service");
const { countMediaAssets, ORPHAN_ASSET_DAYS, sweepOrphanAssets } = await import("@/modules/media/references");
const { replaceStoredPicture, uploadBodyImage } = await import("@/modules/media/service");

const T0 = new Date("2026-10-08T10:00:00Z");
const daysLater = (days: number) => new Date(T0.getTime() + days * 24 * 60 * 60_000);

const photo = (color: string, width = 1200, height = 800) =>
  sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();

const ALBUM = {
  takenOn: "2026-10-04",
  eventId: "",
  translations: {
    ro: { slug: "crosul-toamnei", title: "Crosul toamnei", description: "" },
    en: { slug: "autumn-cross", title: "Autumn cross", description: "" },
  },
};

describe("§NNN «Înlocuiește» — a picture replaced in place", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let contributor: StaffUser;
  let member: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [contributor] = await db.insert(staffUsers).values({ email: "author@dev.test", displayName: "Author", role: "CONTRIBUTOR" }).returning();
    [member] = await db.insert(staffUsers).values({ email: "member@dev.test", displayName: "Member", role: "MEMBER" }).returning();
    state.actor = admin;
    state.expired.length = 0;
  });

  const prefixOf = async (assetId: string) =>
    (await db.select({ keyPrefix: mediaAssets.keyPrefix }).from(mediaAssets).where(eq(mediaAssets.id, assetId)))[0]?.keyPrefix;

  /** An album with three photos, the first the cover. */
  async function albumOfThree() {
    const album = await createAlbum(db, { actor: admin, fields: ALBUM });
    const first = await addPhoto(db, { actor: admin, albumId: album.id, file: await photo("#112233"), originalFilename: "a.jpg" });
    const second = await addPhoto(db, { actor: admin, albumId: album.id, file: await photo("#445566"), originalFilename: "b.jpg" });
    const third = await addPhoto(db, { actor: admin, albumId: album.id, file: await photo("#778899"), originalFilename: "c.jpg" });
    state.expired.length = 0;
    return { album, first, second, third };
  }

  it("stores the new picture under a new prefix, moves the photo, deletes the old picture and its objects, and audits", async () => {
    const { album, second } = await albumOfThree();
    const oldPrefix = (await prefixOf(second.assetId)) as string;

    const replaced = await replacePhoto(db, {
      actor: admin,
      albumId: album.id,
      itemId: second.itemId,
      file: await photo("#aa0000", 1600, 1200),
      originalFilename: "nou.jpg",
      quality: "high",
      now: T0,
    });

    expect(replaced.itemId).toBe(second.itemId);
    expect(replaced.assetId).not.toBe(second.assetId);
    expect(replaced.oldDeleted).toBe(true);
    expect(replaced.stored).toMatchObject({ width: 1600, height: 1200, quality: "high" });

    // A new prefix: a new address no cache has seen. Its objects exist; the old ones are gone.
    const newPrefix = (await prefixOf(replaced.assetId)) as string;
    expect(newPrefix).not.toBe(oldPrefix);
    expect(await readLocalObject(objectKey(newPrefix, "web"))).not.toBeNull();
    expect(await readLocalObject(objectKey(newPrefix, "thumb"))).not.toBeNull();
    for (const key of assetObjectKeys(oldPrefix)) expect(await readLocalObject(key)).toBeNull();
    expect(await db.select().from(mediaAssets).where(eq(mediaAssets.id, second.assetId))).toEqual([]);

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "media.picture_replaced"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("media_asset");
    expect(audit.entityId).toBe(replaced.assetId);
    expect(audit.metadataJson).toEqual({
      from: second.assetId,
      to: replaced.assetId,
      where: { kind: "album", albumId: album.id, itemId: second.itemId },
      oldDeleted: true,
    });

    // The gallery's cache, once, as an upload expires it.
    expect(state.expired).toEqual([["gallery"]]);
  });

  it("keeps the photo's order number and its cover role, and the public album shows the new picture in the same place", async () => {
    const { album, first, second, third } = await albumOfThree();

    const replacedCover = await replacePhoto(db, { actor: admin, albumId: album.id, itemId: first.itemId, file: await photo("#00aa00"), originalFilename: "copertă.jpg" });
    let [row] = await db.select().from(galleryAlbums).where(eq(galleryAlbums.id, album.id));
    expect(row.coverMediaAssetId).toBe(replacedCover.assetId);

    // A photo that is not the cover leaves the cover where it is.
    const replacedMiddle = await replacePhoto(db, { actor: admin, albumId: album.id, itemId: second.itemId, file: await photo("#0000aa"), originalFilename: "mijloc.jpg" });
    [row] = await db.select().from(galleryAlbums).where(eq(galleryAlbums.id, album.id));
    expect(row.coverMediaAssetId).toBe(replacedCover.assetId);

    const items = await db.select().from(galleryItems).where(eq(galleryItems.albumId, album.id)).orderBy(galleryItems.position);
    expect(items.map((item) => [item.id, item.position, item.mediaAssetId])).toEqual([
      [first.itemId, 1, replacedCover.assetId],
      [second.itemId, 2, replacedMiddle.assetId],
      [third.itemId, 3, third.assetId],
    ]);

    const reviewed = await transitionAlbum(db, { actor: admin, albumId: album.id, expectedVersion: row.version, to: "IN_REVIEW" });
    await transitionAlbum(db, { actor: admin, albumId: album.id, expectedVersion: reviewed.version, to: "PUBLISHED" });
    const shown = await findPublishedAlbumBySlug(db, "ro", "crosul-toamnei");
    const middlePrefix = (await prefixOf(replacedMiddle.assetId)) as string;
    expect(shown?.photos.map((p) => p.id)).toEqual([first.itemId, second.itemId, third.itemId]);
    expect(shown?.photos[1].webUrl).toContain(`/${middlePrefix}/web.webp`);
    expect(shown?.coverWebUrl).toContain(`/${(await prefixOf(replacedCover.assetId)) as string}/web.webp`);
  });

  it("keeps the old picture, row and objects, while a page's text or another album still uses it", async () => {
    const { album, second } = await albumOfThree();
    const oldPrefix = (await prefixOf(second.assetId)) as string;
    // The same stored picture in a draft page's text (§485: chosen «Din galerie») and in a second album.
    await createPage(db, {
      actor: admin,
      fields: {
        translations: {
          ro: {
            slug: "despre",
            title: "Despre",
            body: JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: `/api/media/test/${oldPrefix}/web.webp`, alt: "Start", width: 1200, height: 800 } }] }),
            seoTitle: "",
            seoDescription: "",
          },
          en: { slug: "about", title: "About", body: "", seoTitle: "", seoDescription: "" },
        },
      },
    });
    const other = await createAlbum(db, { actor: admin, fields: { ...ALBUM, translations: { ro: { ...ALBUM.translations.ro, slug: "alt-album" }, en: { ...ALBUM.translations.en, slug: "other-album" } } } });
    await addStoredPhoto(db, { actor: admin, albumId: other.id, assetId: second.assetId });

    const replaced = await replacePhoto(db, { actor: admin, albumId: album.id, itemId: second.itemId, file: await photo("#aa00aa"), originalFilename: "nou.jpg" });

    expect(replaced.oldDeleted).toBe(false);
    expect(await prefixOf(second.assetId)).toBe(oldPrefix);
    expect(await readLocalObject(objectKey(oldPrefix, "web"))).not.toBeNull();
    // The other album still shows the old picture; only this album's photo moved.
    const [kept] = await db.select().from(galleryItems).where(and(eq(galleryItems.albumId, other.id)));
    expect(kept.mediaAssetId).toBe(second.assetId);
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "media.picture_replaced"));
    expect(audit.metadataJson).toMatchObject({ from: second.assetId, to: replaced.assetId, oldDeleted: false });
  });

  it("refuses a role that may not delete a photo, before anything is stored, and expires nothing", async () => {
    const { album, second } = await albumOfThree();
    const before = await db.select({ id: mediaAssets.id }).from(mediaAssets);

    const refused = await replacePhoto(db, { actor: contributor, albumId: album.id, itemId: second.itemId, file: await photo("#ffffff"), originalFilename: "x.jpg" }).catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");

    // And through the route a browser posts to, for a volunteer's session.
    state.actor = member;
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(await photo("#ffffff"))], { type: "image/jpeg" }), "x.jpg");
    form.append("replaceItemId", second.itemId);
    const response = await POST(new Request(`http://localhost/api/admin/gallery/${album.id}/photos`, { method: "POST", body: form }), {
      params: Promise.resolve({ id: album.id }),
    });
    expect(response.status).toBe(403);

    expect(await db.select({ id: mediaAssets.id }).from(mediaAssets)).toEqual(before);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "media.picture_replaced"))).toEqual([]);
    expect(state.expired).toEqual([]);
  });

  it("replaces through the route for an editorial role, at the posted quality, and refuses a photo of another album", async () => {
    const { album, third } = await albumOfThree();
    const post = async (albumId: string, itemId: string) => {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(await photo("#123456", 2000, 1000))], { type: "image/jpeg" }), "nou.webp");
      form.append("originalFilename", "IMG_9.jpg");
      form.append("quality", "low");
      form.append("replaceItemId", itemId);
      return POST(new Request(`http://localhost/api/admin/gallery/${albumId}/photos`, { method: "POST", body: form }), { params: Promise.resolve({ id: albumId }) });
    };

    const response = await post(album.id, third.itemId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { itemId: string; assetId: string; stored: { width: number; quality: string } };
    expect(body.itemId).toBe(third.itemId);
    // «Minimă» keeps 1280 px on the long side (§437), as an upload at that choice does.
    expect(body.stored).toMatchObject({ width: 1280, quality: "low" });
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, body.assetId));
    expect(asset.originalFilename).toBe("IMG_9.jpg");

    const other = await createAlbum(db, { actor: admin, fields: { ...ALBUM, translations: { ro: { ...ALBUM.translations.ro, slug: "altul" }, en: { ...ALBUM.translations.en, slug: "another" } } } });
    expect((await post(other.id, third.itemId)).status).toBe(404);
  });

  it("undoes everything when the caller's references cannot move: no new row, no new objects, the old picture kept", async () => {
    const asset = await uploadBodyImage(db, { actorId: admin.id, file: await photo("#334455"), originalFilename: "vechi.jpg", now: T0 });
    const oldPrefix = (await prefixOf(asset.assetId)) as string;
    const processed = await processUploadedImage(await photo("#556677"));
    let newPrefix = "";

    const refused = await replaceStoredPicture(db, {
      actor: admin,
      oldAssetId: asset.assetId,
      processed,
      originalFilename: "nou.jpg",
      where: { kind: "album", albumId: asset.assetId, itemId: asset.assetId },
      repoint: async (tx, ids) => {
        const [row] = await tx.select({ keyPrefix: mediaAssets.keyPrefix }).from(mediaAssets).where(eq(mediaAssets.id, ids.newAssetId));
        newPrefix = row.keyPrefix;
        // The new objects were stored before the transaction began.
        expect(await readLocalObject(objectKey(newPrefix, "web"))).not.toBeNull();
        throw new Error("the reference moved meanwhile");
      },
      expire: () => state.expired.push(["gallery"]),
    }).catch((e: unknown) => e);

    expect(refused).toBeInstanceOf(Error);
    expect(newPrefix).not.toBe("");
    expect(newPrefix).not.toBe(oldPrefix);
    for (const key of assetObjectKeys(newPrefix)) expect(await readLocalObject(key)).toBeNull();
    expect((await db.select().from(mediaAssets)).map((row) => row.id)).toEqual([asset.assetId]);
    expect(await readLocalObject(objectKey(oldPrefix, "web"))).not.toBeNull();
    expect(state.expired).toEqual([]);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "media.picture_replaced"))).toEqual([]);
  });

  it("a picture in a text: the node keeps its words and place, the crop goes, and the old picture waits for the save and the sweep", async () => {
    const old = await uploadBodyImage(db, { actorId: admin.id, file: await photo("#101010"), originalFilename: "harta-veche.jpg", now: T0 });
    const crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    const doc = (image: Record<string, unknown>) =>
      JSON.stringify({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Înainte" }] },
          { type: "image", attrs: image },
          { type: "paragraph", content: [{ type: "text", text: "După" }] },
        ],
      });
    const oldImage = { src: old.src, alt: "Harta traseului", caption: "Bucla mare", width: old.width, height: old.height, widthPercent: 75, align: "block", crop, focus: { x: 0.3, y: 0.3 } };
    const fields = (body: string) => ({
      translations: {
        ro: { slug: "traseu", title: "Traseu", body, seoTitle: "", seoDescription: "" },
        en: { slug: "route", title: "Route", body: "", seoTitle: "", seoDescription: "" },
      },
    });
    const page = await createPage(db, { actor: admin, fields: fields(doc(oldImage)), now: T0 });

    // The editor's upload — no deletion at upload time: the old picture is still the saved text's.
    const fresh = await uploadBodyImage(db, { actorId: admin.id, file: await photo("#202020", 900, 1200), originalFilename: "harta-noua.jpg", now: T0 });
    expect(await prefixOf(old.assetId)).toBeDefined();

    const replaced = replacedPictureAttrs(oldImage, fresh);
    const saved = await savePage(db, { actor: admin, pageId: page.id, expectedVersion: page.version, fields: fields(doc(replaced)), now: T0 });
    const [stored] = await db.select().from(pageTranslations).where(and(eq(pageTranslations.pageId, saved.id), eq(pageTranslations.locale, "ro")));
    const read = readRichText(stored.bodyJson);
    expect(read.content?.map((block) => block.type)).toEqual(["paragraph", "image", "paragraph"]);
    const image = read.content?.[1];
    expect(image?.type === "image" && image.attrs).toMatchObject({
      src: fresh.src,
      alt: "Harta traseului",
      caption: "Bucla mare",
      width: 900,
      height: 1200,
      widthPercent: 75,
      align: "block",
      crop: null,
    });

    // The save made the old picture unused; the sweep takes it after its week, the new one stays.
    expect(await countMediaAssets(db, T0)).toEqual({ total: 2, unreferenced: 1, sweepable: 0 });
    expect(await sweepOrphanAssets(db, daysLater(ORPHAN_ASSET_DAYS + 1))).toBe(1);
    expect(await prefixOf(old.assetId)).toBeUndefined();
    expect(await prefixOf(fresh.assetId)).toBeDefined();
  });
});
