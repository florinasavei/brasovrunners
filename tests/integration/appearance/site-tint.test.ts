import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  readSiteTint,
  SITE_TINT_REFUSAL,
  SITE_TINT_SETTING_ENTITY_ID,
  SITE_TINT_SETTING_KEY,
  updateSiteTint,
} from "@/modules/appearance/site-tint";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/** The public cache's expiry, watched: a save must expire the settings the layout reads (§333). */
const cache = vi.hoisted(() => ({ revalidatePublicContent: vi.fn() }));
vi.mock("@/modules/public-cache/cache", () => cache);

/**
 * §NNN — «Aspectul site-ului» under Pagini → «Aspect»: one `platform_settings` row, the
 * Administrator's (§450), audited, a preset or a «Personalizat» colour that keeps text readable
 * and stays light, and nothing else.
 */
const NOW = new Date("2026-09-27T09:00:00.000Z");

describe("the site background tint setting", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let editor: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    cache.revalidatePublicContent.mockClear();
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [editor] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
  });

  const auditRows = () => db.select().from(auditLogs).where(eq(auditLogs.action, "site_tint.changed"));

  it("is the platform's paper until the club chooses, then the choice, with an audit row and the cache expired", async () => {
    expect(await readSiteTint(db)).toEqual({ setting: { tint: "paper" }, updatedAt: null });

    await updateSiteTint(db, admin, { tint: "lightBlue" }, NOW);
    expect(await readSiteTint(db)).toEqual({ setting: { tint: "lightBlue" }, updatedAt: NOW });
    expect(cache.revalidatePublicContent).toHaveBeenCalledTimes(1);
    expect(cache.revalidatePublicContent).toHaveBeenCalledWith("settings");

    const [audit] = await auditRows();
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.entityId).toBe(SITE_TINT_SETTING_ENTITY_ID);
    expect(audit.metadataJson).toEqual({ from: "paper", to: "lightBlue" });
  });

  it("stores a «Personalizat» colour that keeps both rules, lower-cased, a missing # forgiven", async () => {
    await updateSiteTint(db, admin, { tint: "custom", hex: " F0F4FF " }, NOW);
    expect((await readSiteTint(db)).setting).toEqual({ tint: "custom", hex: "#f0f4ff" });
    const [audit] = await auditRows();
    expect(audit.metadataJson).toEqual({ from: "paper", to: "custom #f0f4ff" });
    expect(cache.revalidatePublicContent).toHaveBeenCalledWith("settings");
  });

  it("ignores a typed colour when a preset is chosen", async () => {
    await updateSiteTint(db, admin, { tint: "blueGrey", hex: "#000000" }, NOW);
    expect((await readSiteTint(db)).setting).toEqual({ tint: "blueGrey" });
  });

  it("is refused to anybody but an Administrator, and anything but a choice, with nothing written or expired", async () => {
    await expect(updateSiteTint(db, editor, { tint: "faintBlue" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateSiteTint(db, admin, { tint: "sand" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["tint"] });
    await expect(updateSiteTint(db, admin, {}, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["tint"] });
    expect((await readSiteTint(db)).setting).toEqual({ tint: "paper" });
    expect(await auditRows()).toHaveLength(0);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });

  it("refuses a «Personalizat» colour that is not #rrggbb, unreadable, or too dark — naming the rule", async () => {
    await expect(updateSiteTint(db, admin, { tint: "custom", hex: "red" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["hex"] });
    await expect(updateSiteTint(db, admin, { tint: "custom" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["hex"] });
    await expect(updateSiteTint(db, admin, { tint: "custom", hex: "#fff}</style>" }, NOW)).rejects.toMatchObject({ fields: ["hex"] });
    await expect(updateSiteTint(db, admin, { tint: "custom", hex: "#999999" }, NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["hex", SITE_TINT_REFUSAL.unreadable],
    });
    await expect(updateSiteTint(db, admin, { tint: "custom", hex: "#dcdcdc" }, NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["hex", SITE_TINT_REFUSAL.tooDark],
    });
    expect((await readSiteTint(db)).setting).toEqual({ tint: "paper" });
    expect(await auditRows()).toHaveLength(0);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });

  it("reads a row it cannot understand, or a custom colour it would refuse, as the default", async () => {
    await db.insert(platformSettings).values({ key: SITE_TINT_SETTING_KEY, value: { tint: "neon-green" }, updatedAt: NOW });
    expect(await readSiteTint(db)).toEqual({ setting: { tint: "paper" }, updatedAt: NOW });
    await db.update(platformSettings).set({ value: { tint: "custom", hex: "#222222" } }).where(eq(platformSettings.key, SITE_TINT_SETTING_KEY));
    expect((await readSiteTint(db)).setting).toEqual({ tint: "paper" });
  });
});
