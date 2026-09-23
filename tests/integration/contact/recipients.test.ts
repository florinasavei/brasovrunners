import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { readContactRecipients, updateContactRecipients } from "@/modules/contact/recipients";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §164 — the club sets who reads the contact form's messages, on
 * `/admin/emails`, in the shape the Mailgun plan already has (§100): one `platform_settings`
 * row, an Administrator's gate asserted by the service itself, an audit row naming who
 * changed it from what, and never an address the canonicalizer refuses.
 */
const NOW = new Date("2026-09-20T09:00:00.000Z");

describe("the contact recipients setting", () => {
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
    [editor] = await db.insert(staffUsers).values({ email: "editor@dev.test", displayName: "Editor", role: "MODERATOR" }).returning();
  });

  it("is nobody until the club says otherwise, and reads back all three lists", async () => {
    expect(await readContactRecipients(db)).toEqual({ to: [], cc: [], bcc: [], updatedAt: null });

    const saved = await updateContactRecipients(
      db,
      admin,
      { to: ["club@example.com"], cc: ["amalia@example.org"], bcc: ["arhiva@example.org"] },
      NOW,
    );
    expect(saved).toEqual({ to: ["club@example.com"], cc: ["amalia@example.org"], bcc: ["arhiva@example.org"], updatedAt: NOW });
    expect(await readContactRecipients(db)).toMatchObject({
      to: ["club@example.com"],
      cc: ["amalia@example.org"],
      bcc: ["arhiva@example.org"],
    });

    // Who, from what, to what — addresses are shown back on the screen that sets them, so
    // they may sit in the audit row; the Gmail app password never comes near this table. The
    // hidden copies are audited like the others: hidden from the message, never from the club.
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "contact_recipients.changed"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.metadataJson).toMatchObject({
      from: { to: [], cc: [], bcc: [] },
      to: { to: ["club@example.com"], cc: ["amalia@example.org"], bcc: ["arhiva@example.org"] },
    });

    // A second change overwrites the one row rather than adding another, and the plan's row
    // (if any) is a different key — this one is `contactRecipients`.
    await updateContactRecipients(db, admin, { to: ["club@example.com", "amalia@example.org"], cc: [] }, new Date(NOW.getTime() + 60_000));
    expect(await db.select().from(platformSettings)).toHaveLength(1);
    expect(await readContactRecipients(db)).toMatchObject({ to: ["club@example.com", "amalia@example.org"], cc: [] });
  });

  it("is refused to a Moderator and for anything that is not an address", async () => {
    await expect(updateContactRecipients(db, editor, { to: ["club@example.com"], cc: [] }, NOW)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(updateContactRecipients(db, admin, { to: ["nope"], cc: [] }, NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["to"],
    });
    await expect(updateContactRecipients(db, admin, { to: [], cc: ["amalia at example.org"] }, NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["cc"],
    });
    await expect(
      updateContactRecipients(db, admin, { to: ["club@example.com"], cc: [], bcc: ["arhiva at example.org"] }, NOW),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["bcc"],
    });
    // Nothing of a refused save reaches the table, so the deployment keeps the way out it had.
    expect(await db.select().from(platformSettings)).toHaveLength(0);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("reads a value it can no longer understand as nobody, which hands the answer to the environment", async () => {
    await db.insert(platformSettings).values({ key: "contactRecipients", value: { to: "club@example.com" }, updatedAt: NOW });
    expect(await readContactRecipients(db)).toEqual({ to: [], cc: [], bcc: [], updatedAt: NOW });
  });

  it("reads a row saved before the hidden copies existed as having none (2026-09-22)", async () => {
    // What §164 wrote: two lists. No migration rewrites a JSON setting; the schema reads it.
    await db.insert(platformSettings).values({
      key: "contactRecipients",
      value: { to: ["club@example.com"], cc: ["amalia@example.org"] },
      updatedAt: NOW,
    });
    expect(await readContactRecipients(db)).toEqual({ to: ["club@example.com"], cc: ["amalia@example.org"], bcc: [], updatedAt: NOW });
  });
});
