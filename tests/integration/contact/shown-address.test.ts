import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { platformSettings } from "@/db/schema/platform-settings";
import {
  SHOWN_CONTACT_ADDRESS_SETTING_KEY,
  readShownContactAddress,
  shownContactAddresses,
  updateShownContactAddress,
} from "@/modules/contact/shown-address";
import { env } from "@/shared/config/env";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §442 — «Adresa de contact afișată» on `/admin/emails`: one `platform_settings` row, the
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

  it("is the environment's mailbox until the club chooses where no Gmail is configured, then the choice, with an audit row", async () => {
    expect(await readShownContactAddress(db, null)).toEqual({ mode: "mailbox", gmail: null, updatedAt: null });
    const mailbox = env.EMAIL_REPLY_TO ? [env.EMAIL_REPLY_TO] : [];
    expect(await shownContactAddresses(db, null)).toEqual(mailbox);

    await updateShownContactAddress(db, admin, { mode: "both" }, NOW, GMAIL);
    expect(await readShownContactAddress(db, GMAIL)).toMatchObject({ mode: "both", gmail: GMAIL });
    expect(await shownContactAddresses(db, GMAIL)).toEqual([GMAIL, ...mailbox.filter((address) => address !== GMAIL)]);

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "shown_contact_address.changed"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.metadataJson).toMatchObject({ from: { mode: "gmail", gmail: GMAIL }, to: { mode: "both", gmail: null } });
  });

  it("§442 as amended: replies go to the configured Gmail (CONTACT_SMTP_USER) until the club chooses otherwise", async () => {
    const configured = "configured@gmail.example.test";
    expect(await readShownContactAddress(db, configured)).toEqual({ mode: "gmail", gmail: configured, updatedAt: null });
    expect(await shownContactAddresses(db, configured)).toEqual([configured]);

    // Choosing the mailbox is a choice: the configured Gmail no longer applies.
    await updateShownContactAddress(db, admin, { mode: "mailbox" }, NOW, configured);
    expect(await readShownContactAddress(db, configured)).toMatchObject({ mode: "mailbox", gmail: null });
    const mailbox = env.EMAIL_REPLY_TO ? [env.EMAIL_REPLY_TO] : [];
    expect(await shownContactAddresses(db, configured)).toEqual(mailbox);
  });

  it("§442 as amended: a typed Gmail is ignored and a legacy typed row reads as the configured Gmail", async () => {
    await updateShownContactAddress(db, admin, { mode: "gmail", gmail: "typed@gmail.example.test" }, NOW, GMAIL);
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, SHOWN_CONTACT_ADDRESS_SETTING_KEY));
    expect(row.value).toEqual({ mode: "gmail", gmail: null });

    // A row saved while the Gmail was typed: the configured one wins, the mode stands.
    await db.update(platformSettings).set({ value: { mode: "both", gmail: GMAIL } }).where(eq(platformSettings.key, SHOWN_CONTACT_ADDRESS_SETTING_KEY));
    expect(await readShownContactAddress(db, GMAIL)).toMatchObject({ mode: "both", gmail: GMAIL });
    expect(await readShownContactAddress(db, "new@gmail.example.test")).toMatchObject({ mode: "both", gmail: "new@gmail.example.test" });
    // With nothing configured, the typed address it kept still reads.
    expect(await readShownContactAddress(db, null)).toMatchObject({ mode: "both", gmail: GMAIL });
  });

  it("is refused to anybody but an Administrator, and a Gmail mode where no Gmail is configured", async () => {
    await expect(updateShownContactAddress(db, organizer, { mode: "gmail" }, NOW, GMAIL)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateShownContactAddress(db, admin, { mode: "gmail" }, NOW, null)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["mode"],
    });
    await expect(updateShownContactAddress(db, admin, { mode: "everything" }, NOW, GMAIL)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["mode"],
    });
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });
});
