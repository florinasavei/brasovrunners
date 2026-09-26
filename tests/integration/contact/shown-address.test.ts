import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  readShownContactAddress,
  shownContactAddresses,
  updateShownContactAddress,
} from "@/modules/contact/shown-address";
import { env } from "@/shared/config/env";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Adresa de contact afișată» on `/admin/emails`: one `platform_settings` row, the
 * Administrator's, audited, and the list every page and email reads from it.
 */
const NOW = new Date("2026-09-26T09:00:00.000Z");
const GMAIL = "club@gmail.example.test";

describe("the shown contact address setting", () => {
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

  it("is the environment's mailbox until the club chooses, then the choice, with an audit row", async () => {
    expect(await readShownContactAddress(db)).toEqual({ mode: "mailbox", gmail: null, updatedAt: null });
    const mailbox = env.EMAIL_REPLY_TO ? [env.EMAIL_REPLY_TO] : [];
    expect(await shownContactAddresses(db)).toEqual(mailbox);

    await updateShownContactAddress(db, admin, { mode: "both", gmail: GMAIL }, NOW);
    expect(await readShownContactAddress(db)).toMatchObject({ mode: "both", gmail: GMAIL });
    expect(await shownContactAddresses(db)).toEqual([GMAIL, ...mailbox.filter((address) => address !== GMAIL)]);

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "shown_contact_address.changed"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.metadataJson).toMatchObject({ from: { mode: "mailbox", gmail: null }, to: { mode: "both", gmail: GMAIL } });
  });

  it("is refused to anybody but an Administrator, and for a missing or malformed Gmail", async () => {
    await expect(updateShownContactAddress(db, organizer, { mode: "gmail", gmail: GMAIL }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateShownContactAddress(db, admin, { mode: "gmail", gmail: "" }, NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["gmail"],
    });
    await expect(updateShownContactAddress(db, admin, { mode: "both", gmail: "club at gmail" }, NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["gmail"],
    });
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });
});
