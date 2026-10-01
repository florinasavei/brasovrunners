import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { annualCostToday, monthlyCostToday, platformServices } from "@/modules/diagnostics/platform-plans";
import { readVercelPlan, updateVercelPlan, VERCEL_PLAN_SETTING_ENTITY_ID, VERCEL_PLAN_SETTING_KEY } from "@/modules/diagnostics/vercel-plan";
import { MESSAGES_PER_COMPLETED_REGISTRATION } from "@/modules/notifications/volume";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-090-05, §NNN — the Vercel plan is a setting an Administrator changes on «Costuri»,
 * audited like the Neon plan (§306) and the Mailgun plan (§100), and the cost table prices it.
 */
const NOW = new Date("2026-09-30T10:00:00.000Z");

describe("§NNN the Vercel plan setting", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;
  let tehnic: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Organizer", role: "MODERATOR" }).returning();
    [tehnic] = await db.insert(staffUsers).values({ email: "dev@dev.test", displayName: "Tehnic", role: "DEV" }).returning();
  });

  it("is Hobby until somebody says otherwise, and reads back what was written, with who wrote it", async () => {
    expect(await readVercelPlan(db)).toEqual({ plan: "HOBBY", seats: 1, note: "", updatedAt: null, updatedBy: null });

    const saved = await updateVercelPlan(db, admin, { plan: "PRO", seats: 2, note: "Pro for the race; Hobby after 21 November" }, NOW);
    expect(saved).toEqual({ plan: "PRO", seats: 2, note: "Pro for the race; Hobby after 21 November", updatedAt: NOW });
    expect(await readVercelPlan(db)).toEqual({ plan: "PRO", seats: 2, note: "Pro for the race; Hobby after 21 November", updatedAt: NOW, updatedBy: "Admin" });

    // Who, from what, to what — with the seats — and the note, so the day it is dropped has its reason.
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "vercel_plan.changed"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.entityId).toBe(VERCEL_PLAN_SETTING_ENTITY_ID);
    expect(audit.metadataJson).toEqual({
      from: { plan: "HOBBY", seats: 1 },
      to: { plan: "PRO", seats: 2 },
      note: "Pro for the race; Hobby after 21 November",
    });

    // The day Pro is dropped: one more save on the one row, and Hobby again.
    await updateVercelPlan(db, admin, { plan: "HOBBY", note: "back to Hobby after the race" }, new Date(NOW.getTime() + 60_000));
    expect(await db.select().from(platformSettings)).toHaveLength(1);
    expect(await readVercelPlan(db)).toMatchObject({ plan: "HOBBY", seats: 1 });
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "vercel_plan.changed"))).toHaveLength(2);
  });

  it("is the Administrator's: an Organizer and Tehnic are refused, and a shape the form cannot mean is refused", async () => {
    await expect(updateVercelPlan(db, organizer, { plan: "PRO", seats: 1 }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateVercelPlan(db, tehnic, { plan: "PRO", seats: 1 }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateVercelPlan(db, admin, { plan: "ENTERPRISE" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updateVercelPlan(db, admin, { plan: "PRO", seats: 0 }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updateVercelPlan(db, admin, { plan: "PRO", seats: Number.NaN }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await readVercelPlan(db)).plan).toBe("HOBBY");
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("reads a row this code can no longer understand as Hobby, with its date", async () => {
    await db.insert(platformSettings).values({ key: VERCEL_PLAN_SETTING_KEY, value: { plan: "ENTERPRISE", seats: 50 }, updatedAt: NOW });
    expect(await readVercelPlan(db)).toEqual({ plan: "HOBBY", seats: 1, note: "", updatedAt: NOW, updatedBy: null });
  });

  it("moves the cost table's Vercel row from free to the seats' monthly price, as the plan says", async () => {
    const base = {
      emailAllowance: 100,
      emailSentToday: 0,
      messagesPerRegistration: MESSAGES_PER_COMPLETED_REGISTRATION,
      hasPaidEvent: false,
      clubDomainBound: true,
      jobsHealthy: true,
    };
    const facts = async () => {
      const plan = await readVercelPlan(db);
      return { ...base, vercelPlan: plan.plan, vercelSeats: plan.seats };
    };
    const onHobby = platformServices(await facts());
    expect(onHobby.find((row) => row.id === "vercel")).toMatchObject({ planToday: "Hobby", costToday: { kind: "free" } });
    expect(monthlyCostToday(onHobby)).toEqual([{ currency: "USD", amount: 0.91, plusVat: true, estimated: false }]);

    await updateVercelPlan(db, admin, { plan: "PRO", seats: 1 }, NOW);
    const onPro = platformServices(await facts());
    expect(onPro.find((row) => row.id === "vercel")).toMatchObject({ planToday: "Pro", costToday: { kind: "paid", amount: 20, billed: "monthly" }, variant: "pro" });
    // The domain's twelfth and Pro's seat a month; the domain's fee and twelve seats a year.
    expect(monthlyCostToday(onPro)).toEqual([{ currency: "USD", amount: 20.91, plusVat: true, estimated: false }]);
    expect(annualCostToday(onPro)).toEqual([{ currency: "USD", amount: 250.97, plusVat: true, estimated: false }]);
  });
});
