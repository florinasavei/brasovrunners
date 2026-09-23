import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { NEON_PLAN_SETTING_KEY, readNeonPlan, updateNeonPlan } from "@/modules/diagnostics/neon-plan";
import { freeTierVerdict, platformServices } from "@/modules/diagnostics/platform-plans";
import { MESSAGES_PER_COMPLETED_REGISTRATION } from "@/modules/notifications/volume";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-090-07 criterion 2, `DECISIONS.md` §280's follow-up — the Neon plan is a setting an
 * Administrator changes, audited like the Mailgun plan (§100), and the cost table follows it.
 */
const NOW = new Date("2026-09-23T10:00:00.000Z");

describe("the Neon plan setting", () => {
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

  it("is Free until somebody says otherwise, and reads back what was written", async () => {
    expect(await readNeonPlan(db)).toEqual({ plan: "FREE", note: "", updatedAt: null });

    const saved = await updateNeonPlan(db, admin, { plan: "LAUNCH", note: "Launch since 22 September; review in December" }, NOW);
    expect(saved).toEqual({ plan: "LAUNCH", note: "Launch since 22 September; review in December", updatedAt: NOW });
    expect((await readNeonPlan(db)).plan).toBe("LAUNCH");

    // Who, from what, to what — and the note, so December's reader knows why.
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "neon_plan.changed"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.metadataJson).toEqual({ from: { plan: "FREE" }, to: { plan: "LAUNCH" }, note: "Launch since 22 September; review in December" });

    // The December decision: one more save, on the one row, and Free again.
    await updateNeonPlan(db, admin, { plan: "FREE", note: "back to Free after the invoices" }, new Date(NOW.getTime() + 60_000));
    expect(await db.select().from(platformSettings)).toHaveLength(1);
    expect((await readNeonPlan(db)).plan).toBe("FREE");
  });

  it("is the Administrator's: an Organizer and Tehnic are refused, and a shape the form cannot mean is refused", async () => {
    await expect(updateNeonPlan(db, organizer, { plan: "LAUNCH" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateNeonPlan(db, tehnic, { plan: "LAUNCH" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateNeonPlan(db, admin, { plan: "SCALE" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await readNeonPlan(db)).plan).toBe("FREE");
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("reads a row this code can no longer understand as Free, with its date", async () => {
    // A value from a version that knew a plan this one does not: the pages keep rendering,
    // against the plan with the ceilings, and the panel still says when it was set.
    await db.insert(platformSettings).values({ key: NEON_PLAN_SETTING_KEY, value: { plan: "SCALE", note: "someday" }, updatedAt: NOW });
    expect(await readNeonPlan(db)).toEqual({ plan: "FREE", note: "", updatedAt: NOW });
  });

  it("moves the cost table's Neon row from a free ceiling to a usage estimate, as the plan says", async () => {
    const base = {
      emailAllowance: 100,
      emailSentToday: 0,
      messagesPerRegistration: MESSAGES_PER_COMPLETED_REGISTRATION,
      hasPaidEvent: false,
      clubDomainBound: true,
      jobsHealthy: true,
      databaseBytes: 11 * 1024 * 1024,
      neonCuHoursThisMonth: 1.8,
      neonHoursElapsed: 24,
    };
    const onFree = platformServices({ ...base, neonPlan: (await readNeonPlan(db)).plan }).find((row) => row.id === "neon");
    expect(onFree).toMatchObject({ planToday: "Free", costToday: { kind: "free" }, nextPlan: "Launch" });
    expect(onFree?.headroom).toEqual({ kind: "measured", used: 11, of: 512, state: "ok" });
    expect(freeTierVerdict({ ...base, neonPlan: "FREE" })).toBe("freeExceptDomain");

    await updateNeonPlan(db, admin, { plan: "LAUNCH" }, NOW);
    const onLaunch = platformServices({ ...base, neonPlan: (await readNeonPlan(db)).plan }).find((row) => row.id === "neon");
    // 1.8 CU-hours a day is 54 a month at $0.106 — §280's $5.72 — plus 11 MiB of storage.
    expect(onLaunch).toMatchObject({ planToday: "Launch", costToday: { kind: "usage", currency: "USD", estimatedPerMonth: 5.73 }, nextPlan: null, nextCost: null, variant: "launch", severity: "ok" });
    expect(onLaunch?.headroom).toEqual({ kind: "derived", reached: false });
    expect(freeTierVerdict({ ...base, neonPlan: "LAUNCH" })).toBe("paysForUsage");
  });
});
