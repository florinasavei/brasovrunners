import sharp from "sharp";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { galleryAlbums, galleryItems, mediaAssets } from "@/db/schema/gallery";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { eventTranslations, events } from "@/db/schema/events";
import {
  albumKind,
  findPublishedAlbumBySlug,
  findPublishedAlbumSiblingSlug,
  listAlbumsForAdmin,
  listPublishedAlbums,
} from "@/modules/content/gallery/repository";
import {
  addPhoto,
  createAlbum,
  deleteAlbum,
  deletePhoto,
  saveAlbum,
  setCover,
  transitionAlbum,
} from "@/modules/content/gallery/service";
import { getStorage, objectKey, readLocalObject } from "@/modules/media/storage";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-054-01 — albums and photos, against PGlite and the in-memory storage (`APP_ENV=test`
 * derives `STORAGE_MODE=fake`).
 *
 * What is protected: a photo is two objects and two rows and the first one is the cover; an
 * album with no photo cannot be published; a public query sees only published albums in its
 * own locale; removing a photo or an album removes its objects; and the roles.
 */
describe("BR-REQ-054-01 the photo gallery", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let editor: StaffUser;
  let author: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [editor] = await db.insert(staffUsers).values({ email: "mod@dev.test", displayName: "Mod", role: "ADMIN" }).returning();
    [author] = await db.insert(staffUsers).values({ email: "author@dev.test", displayName: "Author", role: "CONTRIBUTOR" }).returning();
  });

  const FIELDS = {
    takenOn: "2026-10-11",
    eventId: "",
    translations: {
      ro: { slug: "crosul-2026", title: "Crosul aniversar 2026", description: "Pozele de la start." },
      // The description in both languages or neither (§354, bilingual everywhere).
      en: { slug: "cross-2026", title: "Anniversary cross 2026", description: "Photos from the start." },
    },
  };

  const photo = (color = "#3355ff") =>
    sharp({ create: { width: 1200, height: 800, channels: 3, background: color } }).jpeg().toBuffer();

  it("creates an album, takes photos, makes the first the cover, and publishes", async () => {
    const album = await createAlbum(db, { actor: editor, fields: FIELDS });
    expect(album.editorialStatus).toBe("DRAFT");

    // No photo, no publication.
    const refused = await transitionAlbum(db, { actor: editor, albumId: album.id, expectedVersion: album.version, to: "IN_REVIEW" })
      .then((a) => transitionAlbum(db, { actor: editor, albumId: album.id, expectedVersion: a.version, to: "PUBLISHED" }))
      .catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("VALIDATION_ERROR");

    const first = await addPhoto(db, { actor: editor, albumId: album.id, file: await photo(), originalFilename: "IMG_0001.JPG" });
    const second = await addPhoto(db, { actor: editor, albumId: album.id, file: await photo("#ff3355"), originalFilename: "IMG_0002.JPG" });

    const [row] = await db.select().from(galleryAlbums).where(eq(galleryAlbums.id, album.id));
    expect(row.coverMediaAssetId).toBe(first.assetId);
    const items = await db.select().from(galleryItems).where(eq(galleryItems.albumId, album.id));
    expect(items.map((item) => item.position).sort()).toEqual([1, 2]);

    // Two objects per photo, in the fake bucket, WebP.
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, second.assetId));
    const web = await readLocalObject(objectKey(asset.keyPrefix, "web"));
    const thumb = await readLocalObject(objectKey(asset.keyPrefix, "thumb"));
    expect(web?.contentType).toBe("image/webp");
    expect(thumb?.body.byteLength).toBeGreaterThan(0);
    expect(asset.originalFilename).toBe("IMG_0002.JPG");
    expect(asset.width).toBe(1200);

    const current = (await db.select().from(galleryAlbums).where(eq(galleryAlbums.id, album.id)))[0];
    const published = await transitionAlbum(db, { actor: editor, albumId: album.id, expectedVersion: current.version, to: "PUBLISHED" });
    expect(published.editorialStatus).toBe("PUBLISHED");
    expect(published.publishedAt).not.toBeNull();
  });

  it("shows a published album only, in its own locale, with its photos in order", async () => {
    const draft = await createAlbum(db, { actor: editor, fields: FIELDS });
    await addPhoto(db, { actor: editor, albumId: draft.id, file: await photo(), originalFilename: "a.jpg" });
    expect(await listPublishedAlbums(db, "ro")).toEqual([]);
    expect(await findPublishedAlbumBySlug(db, "ro", "crosul-2026")).toBeUndefined();

    const reviewed = await transitionAlbum(db, { actor: editor, albumId: draft.id, expectedVersion: draft.version, to: "IN_REVIEW" });
    await transitionAlbum(db, { actor: editor, albumId: draft.id, expectedVersion: reviewed.version, to: "PUBLISHED" });

    const listed = await listPublishedAlbums(db, "ro");
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe("Crosul aniversar 2026");
    expect(listed[0].photoCount).toBe(1);
    expect(listed[0].coverThumbUrl).toMatch(/\/api\/media\/test\/.+\/thumb\.webp$/);

    const en = await findPublishedAlbumBySlug(db, "en", "cross-2026");
    expect(en?.title).toBe("Anniversary cross 2026");
    expect(en?.photos[0].webUrl).toMatch(/web\.webp$/);
    // The Romanian slug is not an English address (BR-REQ-040-02).
    expect(await findPublishedAlbumBySlug(db, "en", "crosul-2026")).toBeUndefined();
    expect(await findPublishedAlbumSiblingSlug(db, "ro", "crosul-2026", "en")).toBe("cross-2026");
  });

  it("§NNN lists a free album and an event's album together, newest first, naming only a published event", async () => {
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-10-11T06:00:00Z"), locationName: "Poiana" })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: "crosul", title: "Crosul Poienii" },
      { eventId: event.id, locale: "en", slug: "the-cross", title: "The Poiana cross" },
    ]);

    const publish = async (fields: typeof FIELDS) => {
      const album = await createAlbum(db, { actor: editor, fields });
      await addPhoto(db, { actor: editor, albumId: album.id, file: await photo(), originalFilename: "a.jpg" });
      const [current] = await db.select().from(galleryAlbums).where(eq(galleryAlbums.id, album.id));
      const reviewed = await transitionAlbum(db, { actor: editor, albumId: album.id, expectedVersion: current.version, to: "IN_REVIEW" });
      await transitionAlbum(db, { actor: editor, albumId: album.id, expectedVersion: reviewed.version, to: "PUBLISHED" });
      return album;
    };
    // The event's album is older; the free one — group photos, no event — newer.
    const eventAlbum = await publish({ ...FIELDS, eventId: event.id });
    const freeAlbum = await publish({
      takenOn: "2026-11-02",
      eventId: "",
      translations: {
        ro: { slug: "poze-de-grup", title: "Poze de grup", description: "" },
        en: { slug: "group-photos", title: "Group photos", description: "" },
      },
    });

    // The link is optional: a free album is stored with no event.
    const [freeRow] = await db.select().from(galleryAlbums).where(eq(galleryAlbums.id, freeAlbum.id));
    expect(freeRow.eventId).toBeNull();

    // A draft event is never named on the public list, only a published one.
    const draftListed = await listPublishedAlbums(db, "ro");
    expect(draftListed.map((album) => [album.title, album.eventTitle])).toEqual([
      ["Poze de grup", null],
      ["Crosul aniversar 2026", null],
    ]);

    await db.update(events).set({ editorialStatus: "PUBLISHED", publishedAt: new Date() }).where(eq(events.id, event.id));
    const listed = await listPublishedAlbums(db, "en");
    expect(listed.map((album) => [album.id, album.eventTitle])).toEqual([
      [freeAlbum.id, null],
      [eventAlbum.id, "The Poiana cross"],
    ]);

    // The backoffice sorts both into their groups, a draft event's album included.
    const admin = await listAlbumsForAdmin(db, "ro");
    expect(admin.map((row) => [row.title, albumKind(row), row.eventTitle])).toEqual([
      ["Poze de grup", "free", null],
      ["Crosul aniversar 2026", "event", "Crosul Poienii"],
    ]);
  });

  it("removes a photo's objects with its rows, moves the cover on, and removes an album's objects", async () => {
    const album = await createAlbum(db, { actor: editor, fields: FIELDS });
    const first = await addPhoto(db, { actor: editor, albumId: album.id, file: await photo(), originalFilename: "1.jpg" });
    const second = await addPhoto(db, { actor: editor, albumId: album.id, file: await photo(), originalFilename: "2.jpg" });
    const [firstAsset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, first.assetId));

    await deletePhoto(db, { actor: editor, itemId: first.itemId });
    expect(await readLocalObject(objectKey(firstAsset.keyPrefix, "web"))).toBeNull();
    expect(await readLocalObject(objectKey(firstAsset.keyPrefix, "thumb"))).toBeNull();
    const [afterDelete] = await db.select().from(galleryAlbums).where(eq(galleryAlbums.id, album.id));
    expect(afterDelete.coverMediaAssetId).toBe(second.assetId);

    const [secondAsset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, second.assetId));
    await deleteAlbum(db, { actor: editor, albumId: album.id });
    expect(await db.select().from(galleryAlbums)).toEqual([]);
    expect(await db.select().from(mediaAssets)).toEqual([]);
    expect(await readLocalObject(objectKey(secondAsset.keyPrefix, "web"))).toBeNull();
  });

  it("lets an organizer choose the cover, and saves with a version", async () => {
    const album = await createAlbum(db, { actor: editor, fields: FIELDS });
    await addPhoto(db, { actor: editor, albumId: album.id, file: await photo(), originalFilename: "1.jpg" });
    const second = await addPhoto(db, { actor: editor, albumId: album.id, file: await photo(), originalFilename: "2.jpg" });
    await setCover(db, { actor: editor, albumId: album.id, itemId: second.itemId });
    expect((await db.select().from(galleryAlbums).where(eq(galleryAlbums.id, album.id)))[0].coverMediaAssetId).toBe(second.assetId);

    const saved = await saveAlbum(db, {
      actor: editor,
      albumId: album.id,
      expectedVersion: album.version,
      fields: { ...FIELDS, translations: { ...FIELDS.translations, ro: { ...FIELDS.translations.ro, title: "Crosul 2026" } } },
    });
    expect(saved.version).toBe(album.version + 1);
    const stale = await saveAlbum(db, { actor: editor, albumId: album.id, expectedVersion: album.version, fields: FIELDS }).catch((e: unknown) => e);
    expect(isDomainError(stale) && stale.code).toBe("CONFLICT");
  });

  it("refuses a Contributor everything but reading", async () => {
    const album = await createAlbum(db, { actor: editor, fields: FIELDS });
    const file = await photo();
    for (const attempt of [
      () => createAlbum(db, { actor: author, fields: FIELDS }),
      () => addPhoto(db, { actor: author, albumId: album.id, file, originalFilename: "x.jpg" }),
      () => deleteAlbum(db, { actor: author, albumId: album.id }),
    ]) {
      const refused = await attempt().catch((e: unknown) => e);
      expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");
    }
  });

  it("uses one storage for the process, and the key carries the environment", () => {
    expect(getStorage()).toBe(getStorage());
    expect(objectKey("abc", "thumb")).toBe("test/abc/thumb.webp");
  });
});
