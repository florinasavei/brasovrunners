import sharp from "sharp";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { galleryAlbums, galleryItems, mediaAssets } from "@/db/schema/gallery";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { teamMembers } from "@/db/schema/team";
import { addPhoto, addStoredPhoto, createAlbum, deleteAlbum, deletePhoto } from "@/modules/content/gallery/service";
import { createPage } from "@/modules/content/pages/service";
import { createTeamMember } from "@/modules/content/team/service";
import { deleteAssetsNoLongerReferenced, listMediaAssetsForAdmin } from "@/modules/media/references";
import { uploadBodyImage } from "@/modules/media/service";
import { objectKey, readLocalObject } from "@/modules/media/storage";
import { ensureYoutubePoster } from "@/modules/media/video-poster";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-054-01, BR-REQ-050-03, `DECISIONS.md` §485 — a picture the club already stored, chosen
 * from the gallery into an album (and, through the same id, onto a card of «Echipa»), is one
 * picture used in several places: taking it out of one place never takes it from another, and the
 * last place to let go of it deletes it, objects and row, as before.
 */
describe("§485 pictures from the gallery", () => {
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

  const FIELDS = (slug: string) => ({
    takenOn: "2026-10-11",
    eventId: "",
    translations: {
      ro: { slug: `${slug}-ro`, title: `Album ${slug}`, description: "Poze." },
      en: { slug: `${slug}-en`, title: `Album ${slug}`, description: "Photos." },
    },
  });

  const photo = (color = "#3355ff") => sharp({ create: { width: 1200, height: 800, channels: 3, background: color } }).jpeg().toBuffer();

  const pageWith = (src: string) => ({
    navOrder: "10",
    translations: {
      ro: {
        slug: "despre",
        title: "Despre",
        body: JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src, alt: "Echipa", width: 1200, height: 800 } }] }),
        seoTitle: "",
        seoDescription: "",
      },
      en: { slug: "about", title: "About", body: "", seoTitle: "", seoDescription: "" },
    },
  });

  it("adds a picture stored for a text to an album, as its cover, without a second copy", async () => {
    const stored = await uploadBodyImage(db, { actorId: editor.id, file: await photo(), originalFilename: "harta.jpg" });
    const album = await createAlbum(db, { actor: editor, fields: FIELDS("a") });

    const added = await addStoredPhoto(db, { actor: editor, albumId: album.id, assetId: stored.assetId });
    expect(added).toMatchObject({ assetId: stored.assetId, added: true });
    expect(await db.select().from(mediaAssets)).toHaveLength(1);
    const [row] = await db.select().from(galleryAlbums).where(eq(galleryAlbums.id, album.id));
    expect(row.coverMediaAssetId).toBe(stored.assetId);

    // Pressed twice: still one photo, said rather than refused.
    const again = await addStoredPhoto(db, { actor: editor, albumId: album.id, assetId: stored.assetId });
    expect(again).toEqual({ itemId: null, assetId: stored.assetId, added: false });
    expect(await db.select().from(galleryItems).where(eq(galleryItems.albumId, album.id))).toHaveLength(1);

    // The pictures page names the album as one more place it is used.
    const [listed] = await listMediaAssetsForAdmin(db, "ro");
    expect(listed.references.map((reference) => reference.kind)).toEqual(["album"]);
  });

  it("puts one album's photo into another album, after the photos already there", async () => {
    const first = await createAlbum(db, { actor: editor, fields: FIELDS("a") });
    const second = await createAlbum(db, { actor: editor, fields: FIELDS("b") });
    const own = await addPhoto(db, { actor: editor, albumId: second.id, file: await photo("#ff0000"), originalFilename: "own.jpg" });
    const shared = await addPhoto(db, { actor: editor, albumId: first.id, file: await photo(), originalFilename: "shared.jpg" });

    await addStoredPhoto(db, { actor: editor, albumId: second.id, assetId: shared.assetId });
    const items = await db.select().from(galleryItems).where(eq(galleryItems.albumId, second.id)).orderBy(galleryItems.position);
    expect(items.map((item) => item.mediaAssetId)).toEqual([own.assetId, shared.assetId]);
    // The second album already had a cover; a photo from the gallery does not take it.
    const [row] = await db.select().from(galleryAlbums).where(eq(galleryAlbums.id, second.id));
    expect(row.coverMediaAssetId).toBe(own.assetId);
  });

  it("keeps a picture another place uses when it leaves an album, and moves the cover on", async () => {
    const stored = await uploadBodyImage(db, { actorId: editor.id, file: await photo(), originalFilename: "harta.jpg" });
    await createPage(db, { actor: editor, fields: pageWith(stored.src) });
    const album = await createAlbum(db, { actor: editor, fields: FIELDS("a") });
    const added = await addStoredPhoto(db, { actor: editor, albumId: album.id, assetId: stored.assetId });
    const other = await addPhoto(db, { actor: editor, albumId: album.id, file: await photo("#00ff00"), originalFilename: "2.jpg" });
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, stored.assetId));

    await deletePhoto(db, { actor: editor, itemId: added.itemId! });
    // Out of the album; still the page's, objects and all.
    expect(await db.select().from(galleryItems).where(eq(galleryItems.mediaAssetId, stored.assetId))).toEqual([]);
    expect(await db.select().from(mediaAssets).where(eq(mediaAssets.id, stored.assetId))).toHaveLength(1);
    expect(await readLocalObject(objectKey(asset.keyPrefix, "web"))).not.toBeNull();
    const [row] = await db.select().from(galleryAlbums).where(eq(galleryAlbums.id, album.id));
    expect(row.coverMediaAssetId).toBe(other.assetId);
  });

  it("keeps a team card's photo and another album's photo when an album goes, and deletes the rest", async () => {
    const onCard = await uploadBodyImage(db, { actorId: editor.id, file: await photo(), originalFilename: "portret.jpg" });
    await db.insert(teamMembers).values({ name: "Ioana", roleRo: "Antrenoare", roleEn: "Coach", photoMediaAssetId: onCard.assetId, position: 1 });
    const going = await createAlbum(db, { actor: editor, fields: FIELDS("a") });
    const staying = await createAlbum(db, { actor: editor, fields: FIELDS("b") });
    const own = await addPhoto(db, { actor: editor, albumId: going.id, file: await photo("#123456"), originalFilename: "own.jpg" });
    const alsoElsewhere = await addPhoto(db, { actor: editor, albumId: going.id, file: await photo("#654321"), originalFilename: "both.jpg" });
    await addStoredPhoto(db, { actor: editor, albumId: going.id, assetId: onCard.assetId });
    await addStoredPhoto(db, { actor: editor, albumId: staying.id, assetId: alsoElsewhere.assetId });
    const [ownAsset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, own.assetId));

    await deleteAlbum(db, { actor: editor, albumId: going.id });
    const left = (await db.select({ id: mediaAssets.id }).from(mediaAssets)).map((row) => row.id).sort();
    expect(left).toEqual([onCard.assetId, alsoElsewhere.assetId].sort());
    // The album's own photo, used nowhere else, went with its objects — as it always did.
    expect(await readLocalObject(objectKey(ownAsset.keyPrefix, "web"))).toBeNull();
  });

  it("deletes a picture the album was the last place of, objects and row, as before", async () => {
    const stored = await uploadBodyImage(db, { actorId: editor.id, file: await photo(), originalFilename: "x.jpg" });
    const album = await createAlbum(db, { actor: editor, fields: FIELDS("a") });
    const added = await addStoredPhoto(db, { actor: editor, albumId: album.id, assetId: stored.assetId });
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, stored.assetId));

    await deletePhoto(db, { actor: editor, itemId: added.itemId! });
    expect(await db.select().from(mediaAssets)).toEqual([]);
    expect(await readLocalObject(objectKey(asset.keyPrefix, "web"))).toBeNull();
    expect((await db.select().from(galleryAlbums).where(eq(galleryAlbums.id, album.id)))[0].coverMediaAssetId).toBeNull();
  });

  it("still gives an album with no cover its first photo when any photo leaves it", async () => {
    const album = await createAlbum(db, { actor: editor, fields: FIELDS("a") });
    const first = await addPhoto(db, { actor: editor, albumId: album.id, file: await photo("#111111"), originalFilename: "1.jpg" });
    const second = await addPhoto(db, { actor: editor, albumId: album.id, file: await photo("#222222"), originalFilename: "2.jpg" });
    await db.update(galleryAlbums).set({ coverMediaAssetId: null }).where(eq(galleryAlbums.id, album.id));

    await deletePhoto(db, { actor: editor, itemId: second.itemId });
    const [row] = await db.select().from(galleryAlbums).where(eq(galleryAlbums.id, album.id));
    expect(row.coverMediaAssetId).toBe(first.assetId);
  });

  it("refuses a film's automatic poster as a card's photo on the server, not only in the picker", async () => {
    const fixture = await sharp({ create: { width: 480, height: 360, channels: 3, background: "#224488" } }).jpeg().toBuffer();
    await ensureYoutubePoster(db, "dQw4w9WgXcQ", { fetchImpl: (async () => new Response(new Uint8Array(fixture), { status: 200 })) as typeof fetch });
    const [poster] = await db.select().from(mediaAssets).where(eq(mediaAssets.keyPrefix, "yt-dQw4w9WgXcQ"));
    const card = { name: "Ana", roleRo: "Antrenoare", roleEn: "Coach", bioRo: "", bioEn: "", photoAssetId: poster.id };

    const refused = await createTeamMember(db, { actor: editor, fields: card }).catch((error: unknown) => error);
    expect(isDomainError(refused) && { code: refused.code, fields: refused.fields }).toEqual({ code: "VALIDATION_ERROR", fields: ["photoAssetId"] });
    expect(await db.select().from(teamMembers)).toEqual([]);

    const stored = await uploadBodyImage(db, { actorId: editor.id, file: await photo(), originalFilename: "ana.jpg" });
    await createTeamMember(db, { actor: editor, fields: { ...card, photoAssetId: stored.assetId } });
    expect(await db.select().from(teamMembers)).toHaveLength(1);
  });

  it("answers the prefixes it deleted, and deletes nothing still used", async () => {
    const used = await uploadBodyImage(db, { actorId: editor.id, file: await photo(), originalFilename: "used.jpg" });
    const unused = await uploadBodyImage(db, { actorId: editor.id, file: await photo(), originalFilename: "unused.jpg" });
    await createPage(db, { actor: editor, fields: pageWith(used.src) });
    const [unusedRow] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, unused.assetId));
    expect(await deleteAssetsNoLongerReferenced(db, [used.assetId, unused.assetId])).toEqual([unusedRow.keyPrefix]);
    expect(await deleteAssetsNoLongerReferenced(db, [])).toEqual([]);
    expect((await db.select().from(mediaAssets)).map((row) => row.id)).toEqual([used.assetId]);
  });

  it("refuses a film's automatic poster, an unknown picture, an unknown album, and a Contributor", async () => {
    const album = await createAlbum(db, { actor: editor, fields: FIELDS("a") });
    const stored = await uploadBodyImage(db, { actorId: editor.id, file: await photo(), originalFilename: "x.jpg" });
    const fixture = await sharp({ create: { width: 480, height: 360, channels: 3, background: "#224488" } }).jpeg().toBuffer();
    await ensureYoutubePoster(db, "dQw4w9WgXcQ", { fetchImpl: (async () => new Response(new Uint8Array(fixture), { status: 200 })) as typeof fetch });
    const [poster] = await db.select().from(mediaAssets).where(eq(mediaAssets.keyPrefix, "yt-dQw4w9WgXcQ"));

    const code = async (attempt: Promise<unknown>) => {
      const refused = await attempt.catch((error: unknown) => error);
      return isDomainError(refused) ? refused.code : "accepted";
    };
    expect(await code(addStoredPhoto(db, { actor: editor, albumId: album.id, assetId: poster.id }))).toBe("VALIDATION_ERROR");
    expect(await code(addStoredPhoto(db, { actor: editor, albumId: album.id, assetId: "00000000-0000-4000-8000-000000000000" }))).toBe("NOT_FOUND");
    expect(await code(addStoredPhoto(db, { actor: editor, albumId: "00000000-0000-4000-8000-000000000000", assetId: stored.assetId }))).toBe("NOT_FOUND");
    expect(await code(addStoredPhoto(db, { actor: author, albumId: album.id, assetId: stored.assetId }))).toBe("FORBIDDEN");
    expect(await db.select().from(galleryItems)).toEqual([]);
  });
});
