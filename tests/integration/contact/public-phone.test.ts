import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { PUBLIC_PHONE_SETTING_KEY, readPublicPhone, updatePublicPhone } from "@/modules/contact/public-phone";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Telefon public» on «Pagini» → «Contact»: one `platform_settings` row (no migration), the
 * Administrator's, audited without the number, and none until one is typed. The number is made up.
 */
const NOW = new Date("2026-09-29T18:00:00.000Z");
const SAMPLE = "+40 123 456 789";

describe("§NNN the public phone setting", () => {
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
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
  });

  it("is no number until the Administrator types one, then that number, with an audit row that does not carry it", async () => {
    expect(await readPublicPhone(db)).toEqual({ phone: null, updatedAt: null });

    await updatePublicPhone(db, admin, { phone: ` ${SAMPLE} ` }, NOW);
    expect(await readPublicPhone(db)).toEqual({ phone: SAMPLE, updatedAt: NOW });

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "public_phone.changed"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.metadataJson).toEqual({ from: { set: false }, to: { set: true } });
    expect(JSON.stringify(audit.metadataJson)).not.toContain("123");
  });

  it("clears the number when the box is saved empty", async () => {
    await updatePublicPhone(db, admin, { phone: SAMPLE }, NOW);
    await updatePublicPhone(db, admin, { phone: "" }, NOW);
    expect((await readPublicPhone(db)).phone).toBeNull();
  });

  it("refuses anybody but the Administrator, and a value that is not a number", async () => {
    await expect(updatePublicPhone(db, organizer, { phone: SAMPLE }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updatePublicPhone(db, admin, { phone: "call us" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["phone"] });
    expect(await db.select().from(platformSettings).where(eq(platformSettings.key, PUBLIC_PHONE_SETTING_KEY))).toEqual([]);
  });

  it("reads a stored value this code can no longer read as no number", async () => {
    await db.insert(platformSettings).values({ key: PUBLIC_PHONE_SETTING_KEY, value: { phone: 42 }, updatedAt: NOW });
    expect((await readPublicPhone(db)).phone).toBeNull();
  });
});
