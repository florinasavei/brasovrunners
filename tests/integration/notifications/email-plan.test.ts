import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { readEmailPlan, updateEmailPlan } from "@/modules/notifications/email-plan";
import { sendOutboxNow } from "@/modules/notifications/send-now";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §100 — the Mailgun plan is a setting an Administrator changes, and every
 * figure that says "how much can we still send" follows it: the counter on the outbox
 * panel, `/devs`, the task board, and the "send now" loop's stop.
 */
const NOW = new Date("2026-10-08T10:00:00.000Z");

describe("the email plan setting", () => {
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

  const sentRows = (n: number, when: Date) =>
    Array.from({ length: n }, (_, i) => ({
      participantId: null,
      registrationId: null,
      messageType: "REGISTRATION_CONFIRMED" as const,
      locale: "ro" as const,
      recipientEmail: `r${i}@example.com`,
      payloadJson: {},
      idempotencyKey: `sent:${when.toISOString()}:${i}`,
      status: "SENT" as const,
      sentAt: when,
      createdAt: when,
    }));

  it("is Free until somebody says otherwise, and reads back what was written", async () => {
    expect((await readEmailPlan(db)).plan).toBe("FREE");
    expect((await readEmailPlan(db)).updatedAt).toBeNull();

    const saved = await updateEmailPlan(db, admin, { plan: "BASIC", note: "October's race" }, NOW);
    expect(saved).toMatchObject({ plan: "BASIC", dailyAllowance: null, monthlyAllowance: null, note: "October's race", updatedAt: NOW });
    expect((await readEmailPlan(db)).plan).toBe("BASIC");

    // Who, from what, to what — and never anything but the plan's shape.
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "email_plan.changed"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.metadataJson).toMatchObject({ from: { plan: "FREE" }, to: { plan: "BASIC", monthlyAllowance: 10_000 }, note: "October's race" });

    // A second change overwrites the one row rather than adding another.
    await updateEmailPlan(db, admin, { plan: "FREE" }, new Date(NOW.getTime() + 60_000));
    expect(await db.select().from(platformSettings)).toHaveLength(1);
    expect((await readEmailPlan(db)).plan).toBe("FREE");
  });

  it("is refused to a Moderator and for a shape the form cannot mean", async () => {
    await expect(updateEmailPlan(db, editor, { plan: "BASIC" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateEmailPlan(db, admin, { plan: "GOLD" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updateEmailPlan(db, admin, { plan: "CUSTOM", dailyAllowance: -1 }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await readEmailPlan(db)).plan).toBe("FREE");
  });

  it("drops typed ceilings on a catalogue plan and keeps them on a custom one", async () => {
    await updateEmailPlan(db, admin, { plan: "FOUNDATION", dailyAllowance: 7, monthlyAllowance: 8 }, NOW);
    expect(await readEmailPlan(db)).toMatchObject({ plan: "FOUNDATION", dailyAllowance: null, monthlyAllowance: null });
    await updateEmailPlan(db, admin, { plan: "CUSTOM", dailyAllowance: 250, monthlyAllowance: null }, NOW);
    expect(await readEmailPlan(db)).toMatchObject({ plan: "CUSTOM", dailyAllowance: 250, monthlyAllowance: null });
  });

  it("moves the counter from the day to the month, and to nothing, as the plan says", async () => {
    // Forty sent today, and nine hundred more earlier this month.
    await db.insert(emailOutbox).values([...sentRows(40, NOW), ...sentRows(900, new Date("2026-10-02T10:00:00.000Z"))]);

    const free = await readEmailVolumeToday(db, NOW);
    expect(free).toMatchObject({ plan: "FREE", period: "day", allowance: 100, sentMessages: 40, sentThisMonth: 940, remaining: 60 });

    await updateEmailPlan(db, admin, { plan: "BASIC" }, NOW);
    const basic = await readEmailVolumeToday(db, NOW);
    expect(basic).toMatchObject({ plan: "BASIC", planName: "Basic", period: "month", allowance: 10_000, remaining: 9_060 });

    await updateEmailPlan(db, admin, { plan: "CUSTOM", dailyAllowance: null, monthlyAllowance: null }, NOW);
    const custom = await readEmailVolumeToday(db, NOW);
    expect(custom).toMatchObject({ plan: "CUSTOM", period: "none", allowance: null, remaining: null });
  });

  it("lets 'send now' run past a hundred on a plan with no daily ceiling", async () => {
    // A hundred already sent today would stop the Free loop before its first batch.
    await db.insert(emailOutbox).values(sentRows(100, NOW));
    const pending = Array.from({ length: 3 }, (_, i) => ({
      participantId: null,
      registrationId: null,
      messageType: "REGISTRATION_STATE_NOTICE" as const,
      locale: "ro" as const,
      recipientEmail: `p${i}@example.com`,
      payloadJson: {},
      idempotencyKey: `pending:${i}`,
      createdAt: NOW,
    }));
    await db.insert(emailOutbox).values(pending);

    const onFree = await sendOutboxNow(db, admin, NOW);
    expect(onFree.sent).toBe(0);
    expect(onFree.remaining).toBe(0);

    await updateEmailPlan(db, admin, { plan: "BASIC" }, NOW);
    const onBasic = await sendOutboxNow(db, admin, new Date(NOW.getTime() + 120_000));
    expect(onBasic.sent).toBe(3);
    expect(onBasic.allowance).toBe(10_000);
  });
});
