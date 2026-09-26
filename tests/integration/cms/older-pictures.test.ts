import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventTranslations, events } from "@/db/schema/events";
import { galleryAlbums, mediaAssets } from "@/db/schema/gallery";
import { pageTranslations } from "@/db/schema/pages";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createAlbum } from "@/modules/content/gallery/service";
import { createPage } from "@/modules/content/pages/service";
import {
  formerKeyPrefixOf,
  isLadderKeyPrefix,
  ladderKeyPrefixOf,
  ladderWidths,
  pictureSrcSet,
} from "@/modules/media/ladder";
import { countOlderPictures, giveOlderPicturesTheirLadder } from "@/modules/media/older-pictures";
import { deleteMediaAsset, listMediaAssetsForAdmin, sweepOrphanAssets } from "@/modules/media/references";
import { uploadBodyImage } from "@/modules/media/service";
import { bodyImageSrc, getStorage, objectKey, readLocalObject } from "@/modules/media/storage";
import { posterKeyPrefix } from "@/modules/media/video-poster";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-054-01 criterion 14, BR-REQ-090-05 criterion 14 (`DECISIONS.md` §NNN) — the one-off
 * button that gives the pictures stored before §414 their ladder.
 *
 * What is proven: a press converts the oldest pictures first, at most a batch; the master is kept
 * byte for byte under the new prefix with the thumbnail and every rung beside it; the address is
 * rewritten in every text the reference check reads, with each rewritten row's version bumped;
 * the old two files stay at the old address and go when the picture goes; a picture whose file
 * is missing is counted, left alone, and does not stop the batch; a film poster from YouTube and
 * a picture that already has its ladder are never touched; and only an Administrator may press.
 */
const T0 = new Date("2026-09-20T10:00:00.000Z");

const photo = (width = 2000, height = 1500) =>
  sharp({ create: { width, height, channels: 3, background: "#2255ee" } })
    .webp({ quality: 88 })
    .toBuffer();

/** A picture exactly as the site stored one before §414: a version-4 prefix, a master and a thumbnail. */
async function olderPicture(db: TestDatabase, name: string, createdAt: Date, options: { withFiles?: boolean; width?: number } = {}) {
  const keyPrefix = randomUUID();
  const width = options.width ?? 2000;
  const master = await photo(width, Math.round((width * 3) / 4));
  const thumb = await sharp(master).resize({ width: 480 }).webp({ quality: 78 }).toBuffer();
  if (options.withFiles !== false) {
    await getStorage().put(objectKey(keyPrefix, "web"), master, "image/webp");
    await getStorage().put(objectKey(keyPrefix, "thumb"), thumb, "image/webp");
  }
  const [row] = await db
    .insert(mediaAssets)
    .values({ keyPrefix, originalFilename: name, width, height: Math.round((width * 3) / 4), byteSize: master.byteLength, createdAt, lastReferencedAt: createdAt })
    .returning();
  return { row, master, src: bodyImageSrc(objectKey(keyPrefix, "web")) };
}

const bodyWith = (src: string, width: number) =>
  JSON.stringify({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Cine suntem" }] },
      { type: "image", attrs: { src, alt: "Echipa", width, height: Math.round((width * 3) / 4) } },
    ],
  });

describe("§NNN the pictures from before §414 get their ladder, a batch per press", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  });

  it("moves an older picture to its laddered prefix, keeps its master byte for byte, and rewrites every text it sits in", async () => {
    const older = await olderPicture(db, "echipa.jpg", T0);
    const oldPrefix = older.row.keyPrefix;

    // A standing page's body, an event's description and summary, and an album's cover.
    const page = await createPage(db, {
      actor: admin,
      fields: {
        navOrder: "10",
        translations: {
          ro: { slug: "despre", title: "Despre", body: bodyWith(older.src, 2000), seoTitle: "", seoDescription: "" },
          en: { slug: "about", title: "About", body: "", seoTitle: "", seoDescription: "" },
        },
      },
      now: T0,
    });
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-11T06:00:00.000Z"), timezone: "Europe/Bucharest", locationName: "Parcul Tractorul" })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: "alergare-ro", title: "Alergare", bodyJson: JSON.parse(bodyWith(older.src, 2000)), excerptJson: JSON.parse(bodyWith(older.src, 2000)) },
      { eventId: event.id, locale: "en", slug: "run-en", title: "Run", excerpt: "x" },
    ]);
    const album = await createAlbum(db, {
      actor: admin,
      fields: { takenOn: "2026-09-19", eventId: "", translations: { ro: { slug: "crosul", title: "Crosul", description: "" }, en: { slug: "cross", title: "Cross", description: "" } } },
    });
    await db.update(galleryAlbums).set({ coverMediaAssetId: older.row.id }).where(eq(galleryAlbums.id, album.id));
    const [pageBefore] = await db.select().from(pageTranslations).where(eq(pageTranslations.pageId, page.id));
    const [roBefore] = await db.select().from(eventTranslations).where(eq(eventTranslations.slug, "alergare-ro"));
    const [enBefore] = await db.select().from(eventTranslations).where(eq(eventTranslations.slug, "run-en"));

    expect(await countOlderPictures(db)).toBe(1);
    expect(await giveOlderPicturesTheirLadder(db, admin, { now: T0 })).toEqual({ converted: 1, failed: 0, left: 0 });
    expect(await countOlderPictures(db)).toBe(0);

    // The row: the same UUID with its version digit at 8, the one fact the renderer reads.
    const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, older.row.id));
    const next = ladderKeyPrefixOf(oldPrefix);
    expect(row.keyPrefix).toBe(next);
    expect(isLadderKeyPrefix(next)).toBe(true);
    expect(formerKeyPrefixOf(next)).toBe(oldPrefix);
    expect(row).toMatchObject({ width: 2000, height: 1500, byteSize: older.master.byteLength });

    // The files: the master untouched, a 640 thumbnail made again, and every rung.
    expect((await readLocalObject(objectKey(next, "web")))?.body.equals(older.master)).toBe(true);
    expect((await sharp((await readLocalObject(objectKey(next, "thumb")))!.body).metadata()).width).toBe(640);
    for (const width of ladderWidths(2000)) {
      const rung = await readLocalObject(objectKey(next, width));
      expect(rung, `${width}w`).not.toBeNull();
      expect((await sharp(rung!.body).metadata()).width).toBe(width);
    }
    // The old address still answers: an address copied out of the site does not break.
    expect(await readLocalObject(objectKey(oldPrefix, "web"))).not.toBeNull();
    expect(await readLocalObject(objectKey(oldPrefix, "thumb"))).not.toBeNull();

    // Every text: the new address, no trace of the old, and a version an open editor will not match.
    const newSrc = bodyImageSrc(objectKey(next, "web"));
    const [pageAfter] = await db.select().from(pageTranslations).where(eq(pageTranslations.pageId, page.id));
    expect(JSON.stringify(pageAfter.bodyJson)).toContain(newSrc);
    expect(JSON.stringify(pageAfter.bodyJson)).not.toContain(oldPrefix);
    expect(pageAfter.version).toBe(pageBefore.version + 1);
    const [roAfter] = await db.select().from(eventTranslations).where(eq(eventTranslations.slug, "alergare-ro"));
    expect(JSON.stringify([roAfter.bodyJson, roAfter.excerptJson])).not.toContain(oldPrefix);
    expect(JSON.stringify(roAfter.bodyJson)).toContain(newSrc);
    expect(roAfter.version).toBe(roBefore.version + 1);
    // The other language held no picture: untouched, its version too.
    const [enAfter] = await db.select().from(eventTranslations).where(eq(eventTranslations.slug, "run-en"));
    expect(enAfter.version).toBe(enBefore.version);
    expect(enAfter.bodyJson).toBeNull();

    // And the page now offers the smaller files.
    expect(pictureSrcSet(newSrc, 2000)).toContain(`${ladderWidths(2000)[0]}w`);

    // One audit row for the press, numbers only.
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "media.ladder_given"));
    expect(audit).toMatchObject({ actorStaffUserId: admin.id, entityType: "media_asset", entityId: null, metadataJson: { converted: 1, failed: 0, left: 0 } });

    // A second press finds nothing to do.
    expect(await giveOlderPicturesTheirLadder(db, admin, { now: T0 })).toEqual({ converted: 0, failed: 0, left: 0 });
  });

  it("takes the oldest first, at most a batch, and starts nothing once the time is spent", async () => {
    const first = await olderPicture(db, "1.jpg", T0, { width: 800 });
    const second = await olderPicture(db, "2.jpg", new Date(T0.getTime() + 60_000), { width: 800 });
    await olderPicture(db, "3.jpg", new Date(T0.getTime() + 120_000), { width: 800 });

    expect(await giveOlderPicturesTheirLadder(db, admin, { perPress: 2 })).toEqual({ converted: 2, failed: 0, left: 1 });
    const prefixes = new Map((await db.select().from(mediaAssets)).map((row) => [row.id, row.keyPrefix]));
    expect(isLadderKeyPrefix(prefixes.get(first.row.id)!)).toBe(true);
    expect(isLadderKeyPrefix(prefixes.get(second.row.id)!)).toBe(true);

    // A clock already past the budget: no picture is started.
    let now = 0;
    const clock = () => (now += 60_000);
    expect(await giveOlderPicturesTheirLadder(db, admin, { budgetMs: 30_000, clock })).toEqual({ converted: 0, failed: 0, left: 1 });
    expect(await giveOlderPicturesTheirLadder(db, admin)).toEqual({ converted: 1, failed: 0, left: 0 });
  });

  it("counts a picture whose file is missing, leaves it as it is, and goes on to the next", async () => {
    const missing = await olderPicture(db, "gone.jpg", T0, { withFiles: false, width: 800 });
    // A file that is not a picture at all, where the master should be.
    const broken = await olderPicture(db, "broken.jpg", new Date(T0.getTime() + 30_000), { withFiles: false, width: 800 });
    await getStorage().put(objectKey(broken.row.keyPrefix, "web"), Buffer.from("not a picture"), "image/webp");
    const fine = await olderPicture(db, "fine.jpg", new Date(T0.getTime() + 60_000), { width: 800 });

    expect(await giveOlderPicturesTheirLadder(db, admin, { perPress: 1 })).toEqual({ converted: 1, failed: 2, left: 2 });
    const rows = new Map((await db.select().from(mediaAssets)).map((row) => [row.id, row.keyPrefix]));
    expect(rows.get(missing.row.id)).toBe(missing.row.keyPrefix);
    expect(rows.get(broken.row.id)).toBe(broken.row.keyPrefix);
    expect(isLadderKeyPrefix(rows.get(fine.row.id)!)).toBe(true);
    // Nothing half-written under the failed pictures' new prefixes.
    expect(await readLocalObject(objectKey(ladderKeyPrefixOf(broken.row.keyPrefix), "web"))).toBeNull();
  });

  it("reads a failed picture once per press when its time has microseconds, as PostgreSQL stores it", async () => {
    // A millisecond cursor would sit just before these rows and read the first one again and again.
    const first = await olderPicture(db, "a.jpg", T0, { withFiles: false, width: 800 });
    const second = await olderPicture(db, "b.jpg", T0, { withFiles: false, width: 800 });
    const fine = await olderPicture(db, "fine.jpg", T0, { width: 800 });
    await db.update(mediaAssets).set({ createdAt: sql`'2026-09-20 10:00:00.000123+00'::timestamptz` }).where(eq(mediaAssets.id, first.row.id));
    await db.update(mediaAssets).set({ createdAt: sql`'2026-09-20 10:00:00.000456+00'::timestamptz` }).where(eq(mediaAssets.id, second.row.id));
    await db.update(mediaAssets).set({ createdAt: sql`'2026-09-20 10:00:00.000789+00'::timestamptz` }).where(eq(mediaAssets.id, fine.row.id));

    // Pages of one row each, and a clock that ends a press stuck on one picture well before the test would.
    let ticks = 0;
    const clock = () => (ticks += 1);
    expect(await giveOlderPicturesTheirLadder(db, admin, { perPress: 1, budgetMs: 50, clock })).toEqual({ converted: 1, failed: 2, left: 2 });
    const rows = new Map((await db.select().from(mediaAssets)).map((row) => [row.id, row.keyPrefix]));
    expect(isLadderKeyPrefix(rows.get(fine.row.id)!)).toBe(true);
  });

  it("counts a master whose header reads but whose body is cut short as failed, and the press goes on", async () => {
    // A WebP with the last tenth of its pixels cut off and its two chunk sizes made to agree, so
    // `metadata()` reads its size from the header and only the full decode fails. Lossless, whose
    // header libwebp reads without the image data. Oldest, so it is first in line on every press —
    // it must never stop the ones after it.
    const truncated = await olderPicture(db, "cut.jpg", T0, { withFiles: false, width: 800 });
    // Seeded noise, not sharp's own: with random pixels the cut landed where libwebp could not
    // read even the header about one run in three, and the test failed on its own setup.
    const pixels = Buffer.alloc(800 * 600 * 3);
    let seed = 414;
    for (let i = 0; i < pixels.length; i += 1) {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      pixels[i] = seed >>> 24;
    }
    const whole = await sharp(pixels, { raw: { width: 800, height: 600, channels: 3 } })
      .webp({ lossless: true })
      .toBuffer();
    const cut = Buffer.from(whole.subarray(0, Math.floor(whole.byteLength * 0.9)));
    cut.writeUInt32LE(cut.byteLength - 8, 4); // RIFF
    cut.writeUInt32LE(cut.byteLength - 20, 16); // VP8L
    expect((await sharp(cut).metadata()).width).toBe(800);
    await expect(sharp(cut, { failOn: "error" }).raw().toBuffer()).rejects.toThrow();
    await getStorage().put(objectKey(truncated.row.keyPrefix, "web"), cut, "image/webp");
    const fine = await olderPicture(db, "fine.jpg", new Date(T0.getTime() + 60_000), { width: 800 });

    expect(await giveOlderPicturesTheirLadder(db, admin, { now: T0 })).toEqual({ converted: 1, failed: 1, left: 1 });
    const rows = new Map((await db.select().from(mediaAssets)).map((row) => [row.id, row.keyPrefix]));
    expect(rows.get(truncated.row.id)).toBe(truncated.row.keyPrefix);
    expect(isLadderKeyPrefix(rows.get(fine.row.id)!)).toBe(true);
    expect(await readLocalObject(objectKey(ladderKeyPrefixOf(truncated.row.keyPrefix), "web"))).toBeNull();
    // The press was recorded, with the failure in its numbers.
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "media.ladder_given"));
    expect(audit?.metadataJson).toEqual({ converted: 1, failed: 1, left: 1 });

    // And the next press is not jammed on it: it fails the same picture again and says so.
    expect(await giveOlderPicturesTheirLadder(db, admin, { now: T0 })).toEqual({ converted: 0, failed: 1, left: 1 });
  });

  it("keeps a picture that a text names at its old address, saved after the move", async () => {
    const older = await olderPicture(db, "kept.jpg", T0, { width: 800 });
    expect((await giveOlderPicturesTheirLadder(db, admin)).converted).toBe(1);
    // A new page's form, open since before the press, saved with the old address: nothing
    // refuses it, and the picture — its old files kept for exactly this — must stay.
    const page = await createPage(db, {
      actor: admin,
      fields: {
        navOrder: "20",
        translations: {
          ro: { slug: "veche", title: "Veche", body: bodyWith(older.src, 800), seoTitle: "", seoDescription: "" },
          en: { slug: "old", title: "Old", body: "", seoTitle: "", seoDescription: "" },
        },
      },
      now: T0,
    });

    expect(await sweepOrphanAssets(db, new Date(T0.getTime() + 9 * 24 * 60 * 60_000))).toBe(0);
    const error = await deleteMediaAsset(db, { actor: admin, assetId: older.row.id }).catch((caught: unknown) => caught);
    expect(isDomainError(error) && error.code).toBe("VALIDATION_ERROR");
    expect(await readLocalObject(objectKey(older.row.keyPrefix, "web"))).not.toBeNull();
    // And the pictures page says where, as the refusal does: the page that names the old address.
    const listed = (await listMediaAssetsForAdmin(db, "ro")).find((asset) => asset.id === older.row.id);
    expect(listed?.references).toEqual([{ kind: "page", id: page.id, title: "Veche" }]);
  });

  it("never touches a YouTube poster or a picture that already has its ladder", async () => {
    const poster = posterKeyPrefix("dQw4w9WgXcQ");
    await db.insert(mediaAssets).values({ keyPrefix: poster, originalFilename: "yt.jpg", width: 480, height: 360, byteSize: 1000 });
    const laddered = await uploadBodyImage(db, { actorId: admin.id, file: await photo(800, 600), originalFilename: "new.jpg" });

    expect(await countOlderPictures(db)).toBe(0);
    expect(await giveOlderPicturesTheirLadder(db, admin)).toEqual({ converted: 0, failed: 0, left: 0 });
    const prefixes = (await db.select().from(mediaAssets)).map((row) => row.keyPrefix).sort();
    expect(prefixes).toContain(poster);
    expect(prefixes.some((prefix) => laddered.src.includes(prefix))).toBe(true);
  });

  it("takes the old files with the picture when it goes — deleted by hand or by the sweep", async () => {
    const byHand = await olderPicture(db, "hand.jpg", T0, { width: 800 });
    const swept = await olderPicture(db, "swept.jpg", new Date(T0.getTime() + 60_000), { width: 800 });
    expect((await giveOlderPicturesTheirLadder(db, admin)).converted).toBe(2);

    await deleteMediaAsset(db, { actor: admin, assetId: byHand.row.id });
    for (const prefix of [byHand.row.keyPrefix, ladderKeyPrefixOf(byHand.row.keyPrefix)]) {
      expect(await readLocalObject(objectKey(prefix, "web")), prefix).toBeNull();
      expect(await readLocalObject(objectKey(prefix, "thumb")), prefix).toBeNull();
    }

    expect(await sweepOrphanAssets(db, new Date(T0.getTime() + 9 * 24 * 60 * 60_000))).toBe(1);
    expect(await readLocalObject(objectKey(swept.row.keyPrefix, "web"))).toBeNull();
    expect(await readLocalObject(objectKey(ladderKeyPrefixOf(swept.row.keyPrefix), 480))).toBeNull();
  });

  it("is the Administrator's alone, and refuses every other role before touching anything", async () => {
    await olderPicture(db, "x.jpg", T0, { width: 800 });
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV"] as const) {
      const error = await giveOlderPicturesTheirLadder(db, { id: admin.id, role }).catch((caught: unknown) => caught);
      expect(isDomainError(error) && error.code, role).toBe("FORBIDDEN");
    }
    expect(await countOlderPictures(db)).toBe(1);
    expect((await giveOlderPicturesTheirLadder(db, { id: admin.id, role: "SUPERADMIN" })).converted).toBe(1);
  });
});
