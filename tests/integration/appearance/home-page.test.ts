import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { mediaAssets } from "@/db/schema/gallery";
import { pages } from "@/db/schema/pages";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { DEFAULT_HOME_PAGE_SETTING } from "@/modules/appearance/domain/home-page";
import { changeStripPicture, HOME_PAGE_SETTING_ENTITY_ID, HOME_PAGE_SETTING_KEY, readHomePage, updateHomePage } from "@/modules/appearance/home-page";
import { MAX_STRIP_PICTURES } from "@/modules/home/domain/photo-strip";
import { listMediaAssetsForAdmin } from "@/modules/media/references";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/** The public cache's expiry, watched: a save must expire what the root and every header read (§333, §549). */
const cache = vi.hoisted(() => ({ revalidatePublicContent: vi.fn() }));
vi.mock("@/modules/public-cache/cache", () => cache);

/**
 * §714 — «Pagina principală» under «Setări» → «Aspect»: one `platform_settings` row, the
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
    expect(await readHomePage(db)).toEqual({ setting: DEFAULT_HOME_PAGE_SETTING, updatedAt: null });
  });

  it("saves on, the picture with its facts and crop, and both lines, with an audit row and the pages expired", async () => {
    const crop = { x: 0, y: 0.1, w: 1, h: 0.8 };
    await updateHomePage(db, admin, { page: "on", heroAssetId: pictureId, heroCrop: JSON.stringify(crop), ...words }, NOW);
    const { setting, updatedAt } = await readHomePage(db);
    expect(updatedAt).toEqual(NOW);
    expect(setting).toEqual({
      ...DEFAULT_HOME_PAGE_SETTING,
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
    expect(audit.metadataJson).toEqual({ from: "off", to: "on", heroFrom: null, heroTo: pictureId, heroCropped: true, wordsChanged: true, sectionsChanged: false, contentChanged: false });
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
    expect((await readHomePage(db)).setting).toEqual(DEFAULT_HOME_PAGE_SETTING);
  });

  it("saves the hero's buttons and the sections' switches, and keeps both when a save does not carry them", async () => {
    const [{ id: pageId }] = await db.insert(pages).values({ navOrder: 1, createdAt: NOW }).returning({ id: pages.id });
    await updateHomePage(
      db,
      admin,
      {
        page: "on",
        buttonJoinRo: "Hai cu noi",
        buttonJoinEn: "Come along",
        buttonHowRo: "Cum funcționează",
        buttonHowEn: "How it works",
        buttonHowPageId: ` ${pageId} `,
        sections: { weekly: false, steps: true },
      },
      NOW,
    );
    const saved = (await readHomePage(db)).setting;
    expect(saved.buttons).toEqual({
      join: { ro: "Hai cu noi", en: "Come along" },
      calendar: null,
      how: { label: { ro: "Cum funcționează", en: "How it works" }, pageId },
    });
    expect(saved.sections).toEqual({ hero: true, nextRun: true, weekly: false, special: true, steps: true, why: false, strip: false, numbers: false });
    const [audit] = await auditRows();
    expect(audit.metadataJson).toMatchObject({ wordsChanged: true, sectionsChanged: true });

    // A save that carries neither (an older form) keeps both as they were.
    await updateHomePage(db, admin, { page: "off" }, NOW);
    expect((await readHomePage(db)).setting).toMatchObject({ on: false, buttons: saved.buttons, sections: saved.sections });
  });

  it("saves the special-events-first switch only when the save carries it, and keeps a later release's keys", async () => {
    expect((await readHomePage(db)).setting.specialFirst).toBe(false);
    await updateHomePage(db, admin, { page: "on", specialFirst: true }, NOW);
    expect((await readHomePage(db)).setting.specialFirst).toBe(true);
    const [audit] = await auditRows();
    expect(audit.metadataJson).toMatchObject({ sectionsChanged: true });
    // A save from a form without the sections' card never resets it.
    await updateHomePage(db, admin, { page: "on" }, NOW);
    expect((await readHomePage(db)).setting.specialFirst).toBe(true);
    await updateHomePage(db, admin, { page: "on", specialFirst: false }, NOW);
    expect((await readHomePage(db)).setting.specialFirst).toBe(false);
  });

  it("refuses a third button with words and no page, a page that is not the club's, and a label in one language only", async () => {
    await expect(updateHomePage(db, admin, { page: "on", buttonHowRo: "Cum", buttonHowEn: "How", buttonHowPageId: "" }, NOW)).rejects.toMatchObject({ fields: ["buttonHowPageId"] });
    await expect(updateHomePage(db, admin, { page: "on", buttonHowPageId: "../admin" }, NOW)).rejects.toMatchObject({ fields: ["buttonHowPageId"] });
    await expect(updateHomePage(db, admin, { page: "on", buttonHowPageId: "00000000-0000-4000-8000-000000000999" }, NOW)).rejects.toMatchObject({
      fields: ["buttonHowPageId"],
    });
    await expect(updateHomePage(db, admin, { page: "on", buttonJoinRo: "Hai", buttonJoinEn: "" }, NOW)).rejects.toMatchObject({ fields: ["buttonJoinEn"] });
    expect(await auditRows()).toHaveLength(0);
  });

  it("takes a page with no words for the third button: the platform's «Cum funcționează» stands in", async () => {
    const [{ id: pageId }] = await db.insert(pages).values({ navOrder: 1, createdAt: NOW }).returning({ id: pages.id });
    await updateHomePage(db, admin, { page: "on", buttonHowRo: "", buttonHowEn: "", buttonHowPageId: pageId }, NOW);
    expect((await readHomePage(db)).setting.buttons.how).toEqual({ label: null, pageId });
  });

  /** The posted form, read by name, as the action hands it over. */
  const form = (fields: Record<string, string>) => (name: string) => fields[name];

  it("saves the four lower sections' words and figures, both languages or neither, and keeps a section a save does not carry", async () => {
    const [{ id: pageId }] = await db.insert(pages).values({ navOrder: 1, createdAt: NOW }).returning({ id: pages.id });
    await updateHomePage(
      db,
      admin,
      {
        page: "on",
        steps: form({ stepsTitleRo: "Prima oară?", stepsTitleEn: "First time?", step3TitleRo: "Salută", step3TitleEn: "Say hello", stepsPageId: pageId }),
        why: form({ why2BodyRo: "Munții sunt aproape.", why2BodyEn: "The mountains are close.", quoteRo: "Vorbe", quoteEn: "Words", quoteByRo: "Membru A", quoteByEn: "Member A" }),
        strip: form({ stripTitleRo: "Poze", stripTitleEn: "Photos" }),
        numbers: form({ foundedOn: "2015-04-01", activeRunners: " 120 " }),
      },
      NOW,
    );
    const saved = (await readHomePage(db)).setting;
    expect(saved.steps.title).toEqual({ ro: "Prima oară?", en: "First time?" });
    expect(saved.steps.lead).toBeNull();
    expect(saved.steps.steps.map((step) => step.title)).toEqual([null, null, { ro: "Salută", en: "Say hello" }, null, null]);
    expect(saved.steps.steps.every((step) => step.body === null)).toBe(true);
    expect(saved.steps.targetPageId).toBe(pageId);
    expect(saved.why.items[1]).toEqual({ title: null, body: { ro: "Munții sunt aproape.", en: "The mountains are close." } });
    expect(saved.why.quote).toEqual({ ro: "Vorbe", en: "Words" });
    expect(saved.strip).toEqual({ title: { ro: "Poze", en: "Photos" }, pictures: [] });
    expect(saved.numbers).toEqual({ foundedOn: "2015-04-01", activeRunners: 120 });
    const [audit] = await auditRows();
    expect(audit.metadataJson).toMatchObject({ contentChanged: true, wordsChanged: false });
    // Never the words or the figures in the audit row.
    expect(JSON.stringify(audit.metadataJson)).not.toMatch(/Prima|120|2015/);

    // A save that does not carry the folds (an older form) keeps every section as it was.
    await updateHomePage(db, admin, { page: "off" }, NOW);
    expect((await readHomePage(db)).setting).toMatchObject({ on: false, steps: saved.steps, why: saved.why, strip: saved.strip, numbers: saved.numbers });
    // Emptied boxes are the platform's words again; empty figures, no figure.
    await updateHomePage(db, admin, { page: "off", steps: form({}), numbers: form({ foundedOn: "", activeRunners: "" }) }, NOW);
    expect((await readHomePage(db)).setting).toMatchObject({ steps: { title: null, targetPageId: null }, numbers: { foundedOn: null, activeRunners: null } });
  });

  it("refuses a lower section's box in one language only, one over its length, a page not the club's and a figure that is not one, naming the box", async () => {
    const refusal = (input: Parameters<typeof updateHomePage>[2]) => updateHomePage(db, admin, { page: "on", ...input }, NOW);
    await expect(refusal({ steps: form({ step5TitleRo: "Cafea", step5TitleEn: " " }) })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["step5TitleEn"] });
    await expect(refusal({ steps: form({ stepsTitleRo: "", stepsTitleEn: "Only English" }) })).rejects.toMatchObject({ fields: ["stepsTitleRo"] });
    await expect(refusal({ steps: form({ stepsPageId: "00000000-0000-4000-8000-000000000999" }) })).rejects.toMatchObject({ fields: ["stepsPageId"] });
    await expect(refusal({ steps: form({ stepsPageId: "not-a-page" }) })).rejects.toMatchObject({ fields: ["stepsPageId"] });
    await expect(refusal({ why: form({ why4TitleRo: "a".repeat(61), why4TitleEn: "b" }) })).rejects.toMatchObject({ fields: ["why4TitleRo"] });
    await expect(refusal({ why: form({ quoteRo: "Vorbe", quoteEn: "" }) })).rejects.toMatchObject({ fields: ["quoteEn"] });
    await expect(refusal({ strip: form({ stripTitleRo: "Poze", stripTitleEn: "" }) })).rejects.toMatchObject({ fields: ["stripTitleEn"] });
    await expect(refusal({ numbers: form({ foundedOn: "2019-02-30" }) })).rejects.toMatchObject({ fields: ["foundedOn"] });
    await expect(refusal({ numbers: form({ activeRunners: "12.5" }) })).rejects.toMatchObject({ fields: ["activeRunners"] });
    await expect(refusal({ numbers: form({ activeRunners: "mulți" }) })).rejects.toMatchObject({ fields: ["activeRunners"] });
    expect(await auditRows()).toHaveLength(0);
  });

  it("adds the strip's pictures with their facts, moves them, takes them out, and keeps them from the sweep", async () => {
    const [{ id: second }] = await db
      .insert(mediaAssets)
      .values({ keyPrefix: "3c2b1a09-8f7e-4d6c-9b5a-4a3b2c1d0e9f", originalFilename: "finish.jpg", width: 1600, height: 1600, byteSize: 300_000 })
      .returning({ id: mediaAssets.id });
    await changeStripPicture(db, admin, "add", { assetId: pictureId }, NOW);
    await changeStripPicture(db, admin, "add", { assetId: second }, NOW);
    const ids = async () => (await readHomePage(db)).setting.strip.pictures.map((picture) => picture.assetId);
    expect((await readHomePage(db)).setting.strip.pictures[0]).toEqual({ assetId: pictureId, keyPrefix: PREFIX, width: 2400, height: 1350 });
    expect(await ids()).toEqual([pictureId, second]);
    await changeStripPicture(db, admin, "move", { assetId: second, direction: "up" }, NOW);
    expect(await ids()).toEqual([second, pictureId]);

    // Used by the page while in the strip, the page off and the strip not shown.
    const rows = await listMediaAssetsForAdmin(db, "ro");
    expect(rows.find((row) => row.id === second)?.references).toEqual([{ kind: "homePage", id: HOME_PAGE_SETTING_KEY, title: null }]);

    // A second press of «Scoate» or of an arrow that has nothing to move writes nothing.
    await changeStripPicture(db, admin, "remove", { assetId: second }, NOW);
    await changeStripPicture(db, admin, "remove", { assetId: second }, NOW);
    await changeStripPicture(db, admin, "move", { assetId: pictureId, direction: "up" }, NOW);
    expect(await ids()).toEqual([pictureId]);
    const audits = await auditRows();
    expect(audits).toHaveLength(4);
    expect(audits.map((row) => (row.metadataJson as { strip: string }).strip).sort()).toEqual(["add", "add", "move", "remove"]);
    expect((await listMediaAssetsForAdmin(db, "ro")).find((row) => row.id === second)?.references).toEqual([]);
    // The page's own save keeps the pictures: the form carries the strip's heading, never its pictures.
    await updateHomePage(db, admin, { page: "on", strip: form({ stripTitleRo: "", stripTitleEn: "" }) }, NOW);
    expect(await ids()).toEqual([pictureId]);
  });

  it("refuses a strip picture not in the store, a poster, one already there, a thirteenth, a bad direction and anybody but an Administrator", async () => {
    await expect(changeStripPicture(db, organizer, "add", { assetId: pictureId }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(changeStripPicture(db, admin, "add", { assetId: "nope" }, NOW)).rejects.toMatchObject({ fields: ["stripAssetId"] });
    await expect(changeStripPicture(db, admin, "add", { assetId: "00000000-0000-4000-8000-000000000999" }, NOW)).rejects.toMatchObject({ fields: ["stripAssetId"] });
    await expect(changeStripPicture(db, admin, "add", { assetId: posterId }, NOW)).rejects.toMatchObject({ fields: ["stripAssetId"] });
    await changeStripPicture(db, admin, "add", { assetId: pictureId }, NOW);
    await expect(changeStripPicture(db, admin, "add", { assetId: pictureId }, NOW)).rejects.toMatchObject({ fields: ["stripAssetId"] });
    await expect(changeStripPicture(db, admin, "move", { assetId: pictureId, direction: "left" }, NOW)).rejects.toMatchObject({ fields: ["stripAssetId"] });

    const more = await db
      .insert(mediaAssets)
      .values(Array.from({ length: MAX_STRIP_PICTURES }, (_, index) => ({ keyPrefix: `5d4c3b2a-1f0e-4d9c-8b7a-${String(index).padStart(12, "0")}`, originalFilename: `p${index}.jpg`, width: 800, height: 800, byteSize: 9_000 })))
      .returning({ id: mediaAssets.id });
    for (const { id } of more.slice(0, MAX_STRIP_PICTURES - 1)) await changeStripPicture(db, admin, "add", { assetId: id }, NOW);
    await expect(changeStripPicture(db, admin, "add", { assetId: more[MAX_STRIP_PICTURES - 1].id }, NOW)).rejects.toMatchObject({ fields: ["stripAssetId"] });
    expect((await readHomePage(db)).setting.strip.pictures).toHaveLength(MAX_STRIP_PICTURES);
  });

  it("carries a field a later release wrote, on read and through this save", async () => {
    await db.insert(platformSettings).values({ key: HOME_PAGE_SETTING_KEY, value: { on: true, later: { title: "later" } }, updatedAt: NOW });
    expect((await readHomePage(db)).setting.on).toBe(true);
    await updateHomePage(db, admin, { page: "on" }, NOW);
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, HOME_PAGE_SETTING_KEY));
    expect(row.value).toMatchObject({ on: true, later: { title: "later" } });
  });

  it("reads a lower section it cannot understand as empty, and an older third button as none, never the page off", async () => {
    await db.insert(platformSettings).values({
      key: HOME_PAGE_SETTING_KEY,
      value: { on: true, buttons: { how: { label: { ro: "Cum", en: "How" }, slug: "cum" } }, steps: { title: "only one side" }, numbers: { activeRunners: -3 } },
      updatedAt: NOW,
    });
    const { setting } = await readHomePage(db);
    expect(setting.on).toBe(true);
    expect(setting.buttons.how).toBeNull();
    expect(setting.steps).toEqual(DEFAULT_HOME_PAGE_SETTING.steps);
    expect(setting.numbers).toEqual({ foundedOn: null, activeRunners: null });
  });
});
