import sharp from "sharp";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mediaAssets } from "@/db/schema/gallery";
import { pageTranslations } from "@/db/schema/pages";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { addPhoto, createAlbum } from "@/modules/content/gallery/service";
import { createPage } from "@/modules/content/pages/service";
import {
  countMediaAssets,
  deleteMediaAsset,
  listMediaAssetsForAdmin,
  ORPHAN_ASSET_DAYS,
  sweepOrphanAssets,
  totalMediaBytes,
} from "@/modules/media/references";
import { uploadBodyImage } from "@/modules/media/service";
import { objectKey, readLocalObject } from "@/modules/media/storage";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * AGENTS.md §17 "reference check before delete"; BR-REQ-050-03 criterion 13; `DECISIONS.md`
 * §73 — a stored picture used nowhere for a week is swept, one used anywhere (a draft body
 * included) never is, and the pictures page knows where each one is used.
 */
describe("§17 the orphan picture sweep and the pictures list", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let editor: StaffUser;

  const T0 = new Date("2026-09-18T10:00:00Z");
  const daysLater = (days: number) => new Date(T0.getTime() + days * 24 * 60 * 60_000);

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [editor] = await db
      .insert(staffUsers)
      .values({ email: "mod@dev.test", displayName: "Mod", role: "ADMIN" })
      .returning();
  });

  const picture = () =>
    sharp({ create: { width: 800, height: 600, channels: 3, background: "#3355ff" } }).jpeg().toBuffer();

  const upload = async (name: string, now = T0) =>
    uploadBodyImage(db, { actorId: editor.id, file: await picture(), originalFilename: name, now });

  const pageWith = (src: string) => ({
    navOrder: "10",
    translations: {
      ro: {
        slug: "despre",
        title: "Despre",
        body: JSON.stringify({
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Cine suntem" }] },
            { type: "image", attrs: { src, alt: "Echipa", width: 800, height: 600 } },
          ],
        }),
        seoTitle: "",
        seoDescription: "",
      },
      en: { slug: "about", title: "About", body: "", seoTitle: "", seoDescription: "" },
    },
  });

  it("sweeps a picture nothing has referenced for seven days, objects and row, and no sooner", async () => {
    const orphan = await upload("orphan.jpg");
    const inDraft = await upload("in-draft.jpg");
    await createPage(db, { actor: editor, fields: pageWith(inDraft.src), now: T0 });

    // Day 3: too soon for either.
    expect(await sweepOrphanAssets(db, daysLater(3))).toBe(0);
    expect(await countMediaAssets(db, daysLater(3))).toEqual({ total: 2, unreferenced: 1, sweepable: 0 });

    // Day 8: the orphan goes — the row and both objects; the one in a *draft* page stays.
    expect(await countMediaAssets(db, daysLater(8))).toEqual({ total: 2, unreferenced: 1, sweepable: 1 });
    const [orphanRow] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, orphan.assetId));
    expect(await sweepOrphanAssets(db, daysLater(8))).toBe(1);
    expect(await db.select().from(mediaAssets).where(eq(mediaAssets.id, orphan.assetId))).toEqual([]);
    expect(await readLocalObject(objectKey(orphanRow.keyPrefix, "web"))).toBeNull();
    expect(await readLocalObject(objectKey(orphanRow.keyPrefix, "thumb"))).toBeNull();

    const [kept] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, inDraft.assetId));
    expect(kept).toBeDefined();
    // Seen referenced on day 8, so a removal from the body afterwards starts its own week.
    expect(kept.lastReferencedAt.getTime()).toBe(daysLater(8).getTime());
    expect(await countMediaAssets(db, daysLater(8))).toEqual({ total: 1, unreferenced: 0, sweepable: 0 });
  });

  it("gives a picture removed from a body a fresh week, counted from when the sweep last saw it", async () => {
    const asset = await upload("was-used.jpg");
    const page = await createPage(db, { actor: editor, fields: pageWith(asset.src), now: T0 });
    await sweepOrphanAssets(db, daysLater(30)); // seen, still referenced

    // The body loses the picture on day 30 (a save, simplified to the column it writes).
    await db
      .update(pageTranslations)
      .set({ bodyJson: { type: "doc", content: [] } })
      .where(eq(pageTranslations.pageId, page.id));

    expect(await sweepOrphanAssets(db, daysLater(30 + ORPHAN_ASSET_DAYS - 1))).toBe(0);
    expect(await sweepOrphanAssets(db, daysLater(30 + ORPHAN_ASSET_DAYS + 1))).toBe(1);
  });

  it("rides on the maintenance job, last, and reports its count", async () => {
    await upload("old.jpg");
    const result = await runRegistrationMaintenance(db, daysLater(10));
    expect(result.orphanPicturesDeleted).toBe(1);
    expect(result.errorCount).toBe(0);
  });

  it("lists every picture with where it is used, and refuses to delete one in use", async () => {
    const inPage = await upload("page.jpg");
    const loose = await upload("loose.jpg");
    await createPage(db, { actor: editor, fields: pageWith(inPage.src), now: T0 });
    const album = await createAlbum(db, {
      actor: editor,
      fields: {
        takenOn: "2026-10-11",
        eventId: "",
        translations: {
          ro: { slug: "crosul", title: "Crosul", description: "" },
          en: { slug: "cross", title: "Cross", description: "" },
        },
      },
    });
    const photo = await addPhoto(db, { actor: editor, albumId: album.id, file: await picture(), originalFilename: "IMG_1.JPG" });

    const rows = await listMediaAssetsForAdmin(db, "ro");
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(inPage.assetId)?.references).toEqual([{ kind: "page", id: expect.any(String), title: "Despre" }]);
    expect(byId.get(photo.assetId)?.references).toEqual([{ kind: "album", id: album.id, title: "Crosul" }]);
    expect(byId.get(loose.assetId)?.references).toEqual([]);
    expect(byId.get(loose.assetId)?.thumbUrl).toMatch(/\/thumb\.webp$/);

    // In use: refused, with the sentence the page shows. Loose: gone, objects included.
    const refused = await deleteMediaAsset(db, { actor: editor, assetId: inPage.assetId }).catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("VALIDATION_ERROR");
    const [looseRow] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, loose.assetId));
    await deleteMediaAsset(db, { actor: editor, assetId: loose.assetId });
    expect(await db.select().from(mediaAssets).where(eq(mediaAssets.id, loose.assetId))).toEqual([]);
    expect(await readLocalObject(objectKey(looseRow.keyPrefix, "web"))).toBeNull();

    // A Contributor may not delete a picture, as they may not remove a gallery photo.
    const [author] = await db
      .insert(staffUsers)
      .values({ email: "author@dev.test", displayName: "Author", role: "CONTRIBUTOR" })
      .returning();
    const forbidden = await deleteMediaAsset(db, { actor: author, assetId: photo.assetId }).catch((e: unknown) => e);
    expect(isDomainError(forbidden) && forbidden.code).toBe("FORBIDDEN");
  });

  it("gives the page an address to copy and the total the bucket holds", async () => {
    const first = await upload("first.jpg");
    await upload("second.jpg");

    const rows = await listMediaAssetsForAdmin(db, "ro");
    const [row] = rows.filter((candidate) => candidate.id === first.assetId);
    expect(row).toBeDefined();

    // The two addresses are deliberately different shapes: a body stores a site-relative path
    // so it survives a change of hostname (§8), and the page shows the whole address, which is
    // what somebody pasting the picture into a newsletter needs.
    expect(row.webUrl).toMatch(/^\/api\/media\/.+\/web\.webp$/);
    expect(row.publicWebUrl).toMatch(/^https?:\/\/.+\/web\.webp$/);
    expect(row.publicWebUrl.endsWith(row.webUrl)).toBe(true);

    // The figure at the top of the page: every picture, not the page of them the table shows.
    expect(rows).toHaveLength(2);
    expect(totalMediaBytes(rows)).toBe(rows[0].byteSize + rows[1].byteSize);
    expect(totalMediaBytes(rows)).toBeGreaterThan(0);
    expect(totalMediaBytes([])).toBe(0);

    // And it follows a deletion, because it is summed from the rows rather than remembered.
    await deleteMediaAsset(db, { actor: editor, assetId: first.assetId });
    expect(totalMediaBytes(await listMediaAssetsForAdmin(db, "ro"))).toBe(
      totalMediaBytes(rows) - row.byteSize,
    );
  });
});
