import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §447 — the two shares of the Neon quota that turn the month's budget amber and red: the
 * Administrator's, asserted on the server, audited from and to, a value this code cannot read
 * falling back to the defaults (60 and 85), and red always after amber.
 */
const NOW = new Date("2026-10-01T10:00:00.000Z");

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);

const { readBudgetThresholds, updateBudgetThresholds, BUDGET_THRESHOLDS_SETTING_KEY } = await import("@/modules/diagnostics/budget-thresholds");
const { isDomainError } = await import("@/shared/errors/domain-error");

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
});

async function staff(role: "ADMIN" | "MODERATOR" | "DEV") {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.ro`, displayName: role, role }).returning();
  return row;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("§447 the budget thresholds", () => {
  it("are 60 and 85 when nobody has set them, and when the value cannot be read", async () => {
    expect(await readBudgetThresholds(db)).toEqual({ amberPercent: 60, redPercent: 85, updatedAt: null });
    await db.insert(platformSettings).values({ key: BUDGET_THRESHOLDS_SETTING_KEY, value: { amberPercent: 90, redPercent: 50 }, updatedAt: NOW });
    expect(await readBudgetThresholds(db)).toMatchObject({ amberPercent: 60, redPercent: 85 });
  });

  it("are set by an Administrator and audited from and to", async () => {
    const admin = await staff("ADMIN");
    expect(await updateBudgetThresholds(db, admin, { amberPercent: "50", redPercent: "80" }, NOW)).toEqual({
      amberPercent: 50,
      redPercent: 80,
      updatedAt: NOW,
    });
    expect(await readBudgetThresholds(db)).toEqual({ amberPercent: 50, redPercent: 80, updatedAt: NOW });
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "neon_budget_thresholds.changed"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.metadataJson).toEqual({ from: { amberPercent: 60, redPercent: 85 }, to: { amberPercent: 50, redPercent: 80 } });
  });

  it("refuse anybody but an Administrator, and red at or before amber", async () => {
    for (const role of ["MODERATOR", "DEV"] as const) {
      expect(await refusal(updateBudgetThresholds(db, await staff(role), { amberPercent: 50, redPercent: 80 }, NOW))).toBe("FORBIDDEN");
    }
    const admin = await staff("ADMIN");
    expect(await refusal(updateBudgetThresholds(db, admin, { amberPercent: 80, redPercent: 80 }, NOW))).toBe("VALIDATION_ERROR");
    expect(await refusal(updateBudgetThresholds(db, admin, { amberPercent: 5, redPercent: 80 }, NOW))).toBe("VALIDATION_ERROR");
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });
});
