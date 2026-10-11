import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { readSiteLook, SITE_LOOK_SETTING_ENTITY_ID, SITE_LOOK_SETTING_KEY, updateSiteLook } from "@/modules/appearance/site-look";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/** The public cache's expiry, watched: a flip must expire the settings every public page reads (§333, §549). */
const cache = vi.hoisted(() => ({ revalidatePublicContent: vi.fn() }));
vi.mock("@/modules/public-cache/cache", () => cache);

/**
 * §708 — «Aspectul nou» under «Setări» → «Aspect»: one `platform_settings` row, the
 * Administrator's (§450), audited, on or off and nothing else; off with no row.
 */
const NOW = new Date("2026-10-11T09:00:00.000Z");

describe("the site look setting", () => {
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

  const auditRows = () => db.select().from(auditLogs).where(eq(auditLogs.action, "site_look.changed"));

  it("is off until the club switches it on, then on, with an audit row and the public pages expired", async () => {
    expect(await readSiteLook(db)).toEqual({ setting: { on: false }, updatedAt: null });

    await updateSiteLook(db, admin, { look: "on" }, NOW);
    expect(await readSiteLook(db)).toEqual({ setting: { on: true }, updatedAt: NOW });
    expect(cache.revalidatePublicContent).toHaveBeenCalledTimes(1);
    expect(cache.revalidatePublicContent).toHaveBeenCalledWith("settings");

    const [audit] = await auditRows();
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.entityId).toBe(SITE_LOOK_SETTING_ENTITY_ID);
    expect(audit.metadataJson).toEqual({ from: "off", to: "on" });
  });

  it("is the one-press way back: off again on one row, the audit saying from what", async () => {
    await updateSiteLook(db, admin, { look: "on" }, NOW);
    await updateSiteLook(db, admin, { look: "off" }, NOW);
    expect((await readSiteLook(db)).setting).toEqual({ on: false });
    expect(await db.select().from(platformSettings).where(eq(platformSettings.key, SITE_LOOK_SETTING_KEY))).toHaveLength(1);
    expect((await auditRows()).map((row) => row.metadataJson)).toEqual(
      expect.arrayContaining([
        { from: "off", to: "on" },
        { from: "on", to: "off" },
      ]),
    );
  });

  it("is refused to anybody but an Administrator, and anything but on or off, with nothing written or expired", async () => {
    await expect(updateSiteLook(db, organizer, { look: "on" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateSiteLook(db, admin, { look: "2026" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["look"] });
    await expect(updateSiteLook(db, admin, { look: "toString" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["look"] });
    await expect(updateSiteLook(db, admin, {}, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["look"] });
    expect((await readSiteLook(db)).setting).toEqual({ on: false });
    expect(await auditRows()).toHaveLength(0);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });

  it("§723 saves a preset accent beside the switch, and names it in the audit only when it changed", async () => {
    await updateSiteLook(db, admin, { look: "on", accent: "blue" }, NOW);
    expect((await readSiteLook(db)).setting).toEqual({ on: true, accent: "blue" });
    // A flip of the switch alone keeps the accent and audits as it always did.
    await updateSiteLook(db, admin, { look: "off" }, NOW);
    expect((await readSiteLook(db)).setting).toEqual({ on: false, accent: "blue" });
    await updateSiteLook(db, admin, { look: "off", accent: "blue" }, NOW);
    expect((await auditRows()).map((row) => row.metadataJson)).toEqual(
      expect.arrayContaining([
        { from: "off", to: "on", accentFrom: "pink", accentTo: "blue" },
        { from: "on", to: "off" },
        { from: "off", to: "off" },
      ]),
    );
    expect(cache.revalidatePublicContent).toHaveBeenCalledTimes(3);
  });

  it("§723 saves a typed accent lower-cased, a missing # and spaces forgiven, and goes back to a preset", async () => {
    await updateSiteLook(db, admin, { look: "on", accent: "custom", hex: "  1F6FEB " }, NOW);
    expect((await readSiteLook(db)).setting).toEqual({ on: true, accent: "custom", hex: "#1f6feb" });
    await updateSiteLook(db, admin, { look: "on", accent: "pink", hex: "#1f6feb" }, NOW);
    expect((await readSiteLook(db)).setting).toEqual({ on: true, accent: "pink" });
    expect((await auditRows()).map((row) => row.metadataJson)).toEqual(
      expect.arrayContaining([
        { from: "off", to: "on", accentFrom: "pink", accentTo: "custom #1f6feb" },
        { from: "on", to: "on", accentFrom: "custom #1f6feb", accentTo: "pink" },
      ]),
    );
  });

  it("§723 refuses a grey, a value that is no colour and an accent that is no choice, with nothing written", async () => {
    await expect(updateSiteLook(db, admin, { look: "on", accent: "custom", hex: "#808080" }, NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["hex", "accentTooGrey"],
    });
    await expect(updateSiteLook(db, admin, { look: "on", accent: "custom", hex: "pink" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["hex"] });
    await expect(updateSiteLook(db, admin, { look: "on", accent: "custom" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["hex"] });
    await expect(updateSiteLook(db, admin, { look: "on", accent: "green" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["accent"] });
    await expect(updateSiteLook(db, admin, { look: "on", accent: "toString" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["accent"] });
    await expect(updateSiteLook(db, organizer, { look: "on", accent: "blue" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await readSiteLook(db)).toEqual({ setting: { on: false }, updatedAt: null });
    expect(await auditRows()).toHaveLength(0);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });

  it("reads a row it cannot understand as off", async () => {
    await db.insert(platformSettings).values({ key: SITE_LOOK_SETTING_KEY, value: { on: "yes" }, updatedAt: NOW });
    expect(await readSiteLook(db)).toEqual({ setting: { on: false }, updatedAt: NOW });
  });
});
