import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { mediaAssets } from "@/db/schema/gallery";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { HOME_PAGE_SETTING_ENTITY_ID, HOME_PAGE_SETTING_KEY, readHomePage, updateHomePage } from "@/modules/appearance/home-page";
import { listMediaAssetsForAdmin } from "@/modules/media/references";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/** The public cache's expiry, watched: a save must expire what the root and every header read (§333, §549). */
const cache = vi.hoisted(() => ({ revalidatePublicContent: vi.fn() }));
vi.mock("@/modules/public-cache/cache", () => cache);

/**
 * §NNN — «Pagina principală» under «Setări» → «Aspect»: one `platform_settings` row, the
 * Administrator's (§450), audited; off with no row; the hero's picture a stored one of the club's,
 * its crop four fractions; the two lines both languages or neither (§352).
 */
const NOW = new Date("2026-10-11T09:00:00.000Z");
const PREFIX = "8f1c2d3e-4b5a-8c7d-9e0f-1a2b3c4d5e6f";

describe("the home page setting", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;
  let pictureId: string;
  let posterId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    cache.revalidatePublicContent.mockClear();
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
    [{ id: pictureId }] = await db
      .insert(mediaAssets)
      .values({ keyPrefix: PREFIX, originalFilename: "start.jpg", width: 2400, height: 1350, byteSize: 400_000 })
      .returning({ id: mediaAssets.id });
    [{ id: posterId }] = await db
      .insert(mediaAssets)
      .values({ keyPrefix: "yt-abc", originalFilename: "poster.jpg", width: 1280, height: 720, byteSize: 90_000 })
      .returning({ id: mediaAssets.id });
  });

  const auditRows = () => db.select().from(auditLogs).where(eq(auditLogs.action, "home_page.changed"));
  const words = { headlineRo: "Alergăm împreună", headlineEn: "We run together", sublineRo: "", sublineEn: "" };

  it("is off with an empty slot and the platform's lines until the club saves it", async () => {
    expect(await readHomePage(db)).toEqual({ setting: { on: false, hero: null, headline: null, subline: null }, updatedAt: null });
  });

  it("saves on, the picture with its facts and crop, and both lines, with an audit row and the pages expired", async () => {
    const crop = { x: 0, y: 0.1, w: 1, h: 0.8 };
    await updateHomePage(db, admin, { page: "on", heroAssetId: pictureId, heroCrop: JSON.stringify(crop), ...words }, NOW);
    const { setting, updatedAt } = await readHomePage(db);
    expect(updatedAt).toEqual(NOW);
    expect(setting).toEqual({
      on: true,
      hero: { assetId: pictureId, keyPrefix: PREFIX, width: 2400, height: 1350, crop },
      headline: { ro: "Alergăm împreună", en: "We run together" },
      subline: null,
    });
    expect(cache.revalidatePublicContent).toHaveBeenCalledTimes(1);
    expect(cache.revalidatePublicContent).toHaveBeenCalledWith("settings");

    const [audit] = await auditRows();
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.entityId).toBe(HOME_PAGE_SETTING_ENTITY_ID);
    expect(audit.metadataJson).toEqual({ from: "off", to: "on", heroFrom: null, heroTo: pictureId, heroCropped: true, wordsChanged: true });
  });

  it("keeps the picture when the form did not carry its box, and takes it off when the box is emptied", async () => {
    await updateHomePage(db, admin, { page: "on", heroAssetId: pictureId, heroCrop: "" }, NOW);
    await updateHomePage(db, admin, { page: "off" }, NOW);
    expect((await readHomePage(db)).setting).toMatchObject({ on: false, hero: { assetId: pictureId, crop: null } });
    await updateHomePage(db, admin, { page: "off", heroAssetId: "" }, NOW);
    expect((await readHomePage(db)).setting.hero).toBeNull();
    expect(await db.select().from(platformSettings).where(eq(platformSettings.key, HOME_PAGE_SETTING_KEY))).toHaveLength(1);
  });

  it("keeps the picture it holds from the sweep and from a delete, and the pictures page names the home page", async () => {
    await updateHomePage(db, admin, { page: "off", heroAssetId: pictureId }, NOW);
    const rows = await listMediaAssetsForAdmin(db, "ro");
    expect(rows.find((row) => row.id === pictureId)?.references).toEqual([{ kind: "homePage", id: HOME_PAGE_SETTING_KEY, title: null }]);
    expect(rows.find((row) => row.id === posterId)?.references).toEqual([]);
  });

  it("refuses anybody but an Administrator, a choice that is not on or off, a picture not in the store, a poster and a bad crop", async () => {
    await expect(updateHomePage(db, organizer, { page: "on" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateHomePage(db, admin, { page: "yes" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["page"] });
    await expect(updateHomePage(db, admin, {}, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["page"] });
    await expect(updateHomePage(db, admin, { page: "on", heroAssetId: "not-a-uuid" }, NOW)).rejects.toMatchObject({ fields: ["heroAssetId"] });
    await expect(updateHomePage(db, admin, { page: "on", heroAssetId: "00000000-0000-4000-8000-000000000999" }, NOW)).rejects.toMatchObject({
      fields: ["heroAssetId"],
    });
    await expect(updateHomePage(db, admin, { page: "on", heroAssetId: posterId }, NOW)).rejects.toMatchObject({ fields: ["heroAssetId"] });
    await expect(updateHomePage(db, admin, { page: "on", heroAssetId: pictureId, heroCrop: "{\"x\":2}" }, NOW)).rejects.toMatchObject({ fields: ["heroAssetId"] });
    expect((await readHomePage(db)).updatedAt).toBeNull();
    expect(await auditRows()).toHaveLength(0);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });

  it("refuses a line in one language only, naming the empty box, and one over its length", async () => {
    await expect(updateHomePage(db, admin, { page: "on", headlineRo: "Doar română", headlineEn: " " }, NOW)).rejects.toMatchObject({ fields: ["headlineEn"] });
    await expect(updateHomePage(db, admin, { page: "on", sublineRo: "", sublineEn: "English only" }, NOW)).rejects.toMatchObject({ fields: ["sublineRo"] });
    await expect(updateHomePage(db, admin, { page: "on", headlineRo: "a".repeat(81), headlineEn: "b" }, NOW)).rejects.toMatchObject({ fields: ["headlineRo"] });
    expect(await auditRows()).toHaveLength(0);
  });

  it("reads a row it cannot understand as off", async () => {
    await db.insert(platformSettings).values({ key: HOME_PAGE_SETTING_KEY, value: { on: "yes" }, updatedAt: NOW });
    expect((await readHomePage(db)).setting).toEqual({ on: false, hero: null, headline: null, subline: null });
  });
});
