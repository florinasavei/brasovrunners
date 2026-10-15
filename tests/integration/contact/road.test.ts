import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { contactViaFor } from "@/modules/contact/domain/recipients";
import { CONTACT_RECIPIENTS_SETTING_KEY, readContactRecipients, updateContactRecipients } from "@/modules/contact/recipients";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-070-04, `DECISIONS.md` §782 (amending §149, §164) — «Prin ce trimitem» for «Scrie-ne»: the road the form leaves by is a
 * setting of the same row as its recipients, Mailgun by default where it transmits and the club's Gmail where it does not, a
 * road the club chose is never replaced, and a save that does not post one (a greyed radio) leaves it as it was.
 */
const NOW = new Date("2026-10-15T09:00:00.000Z");
const BOTH = { gmail: true, mailgun: true };
const GMAIL_ONLY = { gmail: true, mailgun: false };
const MAILGUN_ONLY = { gmail: false, mailgun: true };

describe("the road «Scrie-ne» leaves by", () => {
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

  it("is no road at all until the club chooses, and the default follows what the deployment transmits through", async () => {
    const empty = await readContactRecipients(db);
    expect(empty.via).toBeUndefined();
    expect(contactViaFor(empty, BOTH)).toBe("mailgun");
    expect(contactViaFor(empty, MAILGUN_ONLY)).toBe("mailgun");
    // Where Mailgun does not transmit, the form is on the club's Gmail: what it always did.
    expect(contactViaFor(empty, GMAIL_ONLY)).toBe("gmail");
    expect(contactViaFor(null, GMAIL_ONLY)).toBe("gmail");
  });

  it("keeps a road the club saved, whatever the deployment transmits through since", async () => {
    await updateContactRecipients(db, admin, { to: ["club@example.com"], via: "gmail" }, NOW, BOTH);
    const saved = await readContactRecipients(db);
    expect(saved.via).toBe("gmail");
    expect(contactViaFor(saved, BOTH)).toBe("gmail");
    expect(contactViaFor(saved, GMAIL_ONLY)).toBe("gmail");

    await updateContactRecipients(db, admin, { to: ["club@example.com"], via: "mailgun" }, NOW, BOTH);
    expect(contactViaFor(await readContactRecipients(db), GMAIL_ONLY)).toBe("mailgun");
  });

  it("leaves a row saved before the road existed exactly as it was, and reads it as the default", async () => {
    await db.insert(platformSettings).values({ key: CONTACT_RECIPIENTS_SETTING_KEY, value: { to: ["club@example.com"], cc: [], bcc: [], holdBackSuspected: true }, updatedAt: NOW });
    const read = await readContactRecipients(db);
    expect(read).toEqual({ to: ["club@example.com"], cc: [], bcc: [], holdBackSuspected: true, updatedAt: NOW });
    expect(contactViaFor(read, BOTH)).toBe("mailgun");
    expect(contactViaFor(read, GMAIL_ONLY)).toBe("gmail");
  });

  it("keeps the saved road when a save does not post one — a greyed radio is never posted — and posts none for a road never saved", async () => {
    await updateContactRecipients(db, admin, { to: ["club@example.com"], via: "gmail" }, NOW, BOTH);
    await updateContactRecipients(db, admin, { to: ["other@example.com"] }, NOW, BOTH);
    expect((await readContactRecipients(db)).via).toBe("gmail");
    await updateContactRecipients(db, admin, { to: ["other@example.com"], via: "" }, NOW, BOTH);
    expect((await readContactRecipients(db)).via).toBe("gmail");

    await db.delete(platformSettings).where(eq(platformSettings.key, CONTACT_RECIPIENTS_SETTING_KEY));
    await updateContactRecipients(db, admin, { to: ["club@example.com"], via: "" }, NOW, BOTH);
    expect((await readContactRecipients(db)).via).toBeUndefined();
  });

  it("refuses to newly choose a road the deployment lacks, on the box, but lets one stay where it was", async () => {
    await expect(updateContactRecipients(db, admin, { to: ["club@example.com"], via: "gmail" }, NOW, MAILGUN_ONLY)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["via"] });
    await expect(updateContactRecipients(db, admin, { to: ["club@example.com"], via: "mailgun" }, NOW, GMAIL_ONLY)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["via"] });
    expect((await readContactRecipients(db)).via).toBeUndefined();
    await updateContactRecipients(db, admin, { to: ["club@example.com"], via: "gmail" }, NOW, BOTH);
    // Saved Gmail, Gmail gone: saving the card with it unchanged is not choosing it.
    await expect(updateContactRecipients(db, admin, { to: ["other@example.com"], via: "gmail" }, NOW, MAILGUN_ONLY)).resolves.toMatchObject({ via: "gmail" });
    // A word that is not a road is refused too.
    await expect(updateContactRecipients(db, admin, { to: ["club@example.com"], via: "carrier-pigeon" }, NOW, BOTH)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["via"] });
  });

  it("audits the road as a word, and only the Administrator may change it", async () => {
    await updateContactRecipients(db, admin, { to: ["club@example.com"], via: "mailgun" }, NOW, BOTH);
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "contact_recipients.changed"));
    expect(audit.metadataJson).toMatchObject({ to: { via: "mailgun" } });
    expect(JSON.stringify((audit.metadataJson as { from: unknown }).from)).not.toContain("via");
    await expect(updateContactRecipients(db, editor, { to: ["club@example.com"], via: "gmail" }, NOW, BOTH)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
