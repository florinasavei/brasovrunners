import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { readSiteTint, SITE_TINT_SETTING_ENTITY_ID, SITE_TINT_SETTING_KEY, updateSiteTint } from "@/modules/appearance/site-tint";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Fundalul site-ului» under Pagini → «Aspect»: one `platform_settings` row, the
 * Administrator's (§450), audited, one of the presets and nothing else.
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
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [editor] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
  });

  it("is the platform's paper until the club chooses, then the choice, with an audit row", async () => {
    expect(await readSiteTint(db)).toEqual({ tint: "paper", updatedAt: null });

    await updateSiteTint(db, admin, { tint: "sky" }, NOW);
    expect(await readSiteTint(db)).toEqual({ tint: "sky", updatedAt: NOW });

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "site_tint.changed"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.entityId).toBe(SITE_TINT_SETTING_ENTITY_ID);
    expect(audit.metadataJson).toEqual({ from: "paper", to: "sky" });
  });

  it("is refused to anybody but an Administrator, and anything but a preset", async () => {
    await expect(updateSiteTint(db, editor, { tint: "blue" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateSiteTint(db, admin, { tint: "#ff0000" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["tint"] });
    await expect(updateSiteTint(db, admin, {}, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await readSiteTint(db)).tint).toBe("paper");
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "site_tint.changed"))).toHaveLength(0);
  });

  it("reads a row it cannot understand as the default", async () => {
    await db.insert(platformSettings).values({ key: SITE_TINT_SETTING_KEY, value: { tint: "neon-green" }, updatedAt: NOW });
    expect(await readSiteTint(db)).toEqual({ tint: "paper", updatedAt: NOW });
  });
});
