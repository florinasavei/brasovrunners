import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §513 — emails leave on the scheduler's tick, not right after the request: the §221 delivery
 * timing now defaults to `scheduled` wherever a pinger runs, and it is a «Termene» setting, the Administrator's
 * (`canManageClubSettings`) at the page, the action and the service (BR-REQ-060-01).
 */
const NOW = new Date("2026-10-01T10:00:00.000Z");

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
// Switched off, the queue leaves after the response (§NNN): the drain is counted, never run here.
const drained = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => void drained.calls++ }));

const { fakeNextCache } = await import("../../helpers/next-cache");
const { readDeliveryTiming, updateDeliveryTiming, DELIVERY_TIMING_SETTING_KEY } = await import("@/modules/notifications/delivery-timing");
const { defaultDeliveryTiming } = await import("@/modules/notifications/domain/delivery-timing");
const { isDomainError } = await import("@/shared/errors/domain-error");

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  fakeNextCache.reset();
});

async function staff(role: "SUPERADMIN" | "ADMIN" | "MODERATOR" | "DEV" | "COPYWRITER" | "CONTRIBUTOR") {
  const [row] = await db
    .insert(staffUsers)
    .values({ email: `${role.toLowerCase()}@example.ro`, displayName: role, role })
    .returning();
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

describe("§513 emails leave on the scheduler's tick by default", () => {
  it("defaults to scheduled where a pinger runs, and to immediate where none does", () => {
    expect(defaultDeliveryTiming("production")).toEqual({ timing: "scheduled" });
    expect(defaultDeliveryTiming("qa")).toEqual({ timing: "scheduled" });
    // A laptop and the end-to-end suite's server have no pinger: "on the tick" would be "never".
    expect(defaultDeliveryTiming("local")).toEqual({ timing: "immediate" });
    expect(defaultDeliveryTiming("test")).toEqual({ timing: "immediate" });
  });

  it("reads this environment's default when nobody has set it, and when the stored value cannot be read", async () => {
    // Vitest runs under APP_ENV=test.
    expect(await readDeliveryTiming(db)).toEqual({ timing: "immediate", updatedAt: null });
    await db.insert(platformSettings).values({ key: DELIVERY_TIMING_SETTING_KEY, value: { timing: "soon" }, updatedAt: NOW });
    expect((await readDeliveryTiming(db)).timing).toBe("immediate");
  });

  it("keeps a stored choice whatever the environment's default", async () => {
    await db.insert(platformSettings).values({ key: DELIVERY_TIMING_SETTING_KEY, value: { timing: "scheduled" }, updatedAt: NOW });
    expect(await readDeliveryTiming(db)).toEqual({ timing: "scheduled", updatedAt: NOW });
  });
});

describe("BR-REQ-060-01 the delivery timing is a «Termene» setting, the Administrator's (§513)", () => {
  it("is set by an Administrator, audited from and to, and wakes the outbox job", async () => {
    const admin = await staff("ADMIN");
    const saved = await updateDeliveryTiming(db, admin, { timing: "scheduled" }, NOW);
    expect(saved).toEqual({ timing: "scheduled", updatedAt: NOW });
    expect(await readDeliveryTiming(db)).toEqual({ timing: "scheduled", updatedAt: NOW });

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "delivery_timing.changed"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.metadataJson).toEqual({ from: "immediate", to: "scheduled" });
    expect(fakeNextCache.invalidated).toContain("br-jobs:due:email-outbox");
  });

  it("is the Superadministrator's too", async () => {
    await updateDeliveryTiming(db, await staff("SUPERADMIN"), { timing: "scheduled" }, NOW);
    expect((await readDeliveryTiming(db)).timing).toBe("scheduled");
  });

  it("is refused on the server for every role below the Administrator, and leaves no trace", async () => {
    for (const role of ["MODERATOR", "DEV", "COPYWRITER", "CONTRIBUTOR"] as const) {
      expect(await refusal(updateDeliveryTiming(db, await staff(role), { timing: "immediate" }, NOW)), role).toBe("FORBIDDEN");
    }
    expect(await db.select().from(platformSettings)).toEqual([]);
    expect(await db.select().from(auditLogs)).toEqual([]);
  });

  it("refuses a value outside the two choices", async () => {
    const admin = await staff("ADMIN");
    expect(await refusal(updateDeliveryTiming(db, admin, { timing: "hourly" }, NOW))).toBe("VALIDATION_ERROR");
    expect(await refusal(updateDeliveryTiming(db, admin, { timing: "scheduled", extra: 1 }, NOW))).toBe("VALIDATION_ERROR");
    expect(await db.select().from(platformSettings)).toEqual([]);
  });

  it("writes nothing when the stored choice is already the one saved", async () => {
    const admin = await staff("ADMIN");
    await updateDeliveryTiming(db, admin, { timing: "immediate" }, NOW);
    const later = new Date(NOW.getTime() + 60_000);
    const again = await updateDeliveryTiming(db, admin, { timing: "immediate" }, later);
    expect(again.updatedAt).toEqual(NOW);
    expect(await db.select().from(auditLogs)).toHaveLength(1);
  });

  it("§NNN sends what the round was holding when switched off, and only then", async () => {
    const admin = await staff("ADMIN");
    drained.calls = 0;
    await updateDeliveryTiming(db, admin, { timing: "scheduled" }, NOW);
    expect(drained.calls).toBe(0);
    await updateDeliveryTiming(db, admin, { timing: "immediate" }, new Date(NOW.getTime() + 60_000));
    expect(drained.calls).toBe(1);
    // A save that changes nothing drains nothing either.
    await updateDeliveryTiming(db, admin, { timing: "immediate" }, new Date(NOW.getTime() + 120_000));
    expect(drained.calls).toBe(1);
  });
});
