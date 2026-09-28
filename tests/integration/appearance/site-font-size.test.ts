import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  readSiteFontSize,
  SITE_FONT_SIZE_SETTING_ENTITY_ID,
  SITE_FONT_SIZE_SETTING_KEY,
  updateSiteFontSize,
} from "@/modules/appearance/site-font-size";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/** The public cache's expiry, watched: a save must expire the settings the layout reads (§333). */
const cache = vi.hoisted(() => ({ revalidatePublicContent: vi.fn() }));
vi.mock("@/modules/public-cache/cache", () => cache);

/**
 * §NNN — «Mărimea textului» under «Setări» → «Aspect»: one `platform_settings` row, the
 * Administrator's (§450), audited, one of four steps and nothing else.
 */
const NOW = new Date("2026-09-28T09:00:00.000Z");

describe("the site text size setting", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    cache.revalidatePublicContent.mockClear();
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
  });

  const auditRows = () => db.select().from(auditLogs).where(eq(auditLogs.action, "site_font_size.changed"));

  it("is «Normal» until the club chooses, then the choice, with an audit row and the cache expired", async () => {
    expect(await readSiteFontSize(db)).toEqual({ setting: { size: "normal" }, updatedAt: null });

    await updateSiteFontSize(db, admin, { size: "large" }, NOW);
    expect(await readSiteFontSize(db)).toEqual({ setting: { size: "large" }, updatedAt: NOW });
    expect(cache.revalidatePublicContent).toHaveBeenCalledTimes(1);
    expect(cache.revalidatePublicContent).toHaveBeenCalledWith("settings");

    const [audit] = await auditRows();
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.entityId).toBe(SITE_FONT_SIZE_SETTING_ENTITY_ID);
    expect(audit.metadataJson).toEqual({ from: "normal", to: "large" });
  });

  it("changes the one row on a second save, the audit saying from what", async () => {
    await updateSiteFontSize(db, admin, { size: "xlarge" }, NOW);
    await updateSiteFontSize(db, admin, { size: "small" }, NOW);
    expect((await readSiteFontSize(db)).setting).toEqual({ size: "small" });
    expect(await db.select().from(platformSettings).where(eq(platformSettings.key, SITE_FONT_SIZE_SETTING_KEY))).toHaveLength(1);
    expect((await auditRows()).map((row) => row.metadataJson)).toEqual(
      expect.arrayContaining([
        { from: "normal", to: "xlarge" },
        { from: "xlarge", to: "small" },
      ]),
    );
  });

  it("is refused to anybody but an Administrator, and anything but a step, with nothing written or expired", async () => {
    await expect(updateSiteFontSize(db, organizer, { size: "large" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateSiteFontSize(db, admin, { size: "huge" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["size"] });
    await expect(updateSiteFontSize(db, admin, { size: "120%" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["size"] });
    await expect(updateSiteFontSize(db, admin, {}, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["size"] });
    expect((await readSiteFontSize(db)).setting).toEqual({ size: "normal" });
    expect(await auditRows()).toHaveLength(0);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });

  it("reads a row it cannot understand as the default", async () => {
    await db.insert(platformSettings).values({ key: SITE_FONT_SIZE_SETTING_KEY, value: { size: "gigantic" }, updatedAt: NOW });
    expect(await readSiteFontSize(db)).toEqual({ setting: { size: "normal" }, updatedAt: NOW });
  });
});
