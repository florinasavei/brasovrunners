import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-090-07 criterion 7 (§334) — the owner's throttle: `platform_settings.jobCadence`, the
 * minimum minutes between two real runs of each job. Built like the Neon plan beside it, and a
 * rung higher: the Superadministrator's since §NNN, asserted on the server, audited from and to, a value this code cannot read
 * falling back to the default — and on save every cached schedule is forgotten, so the next ping
 * of each job plans under the new interval.
 */
const NOW = new Date("2026-10-01T10:00:00.000Z");

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);

const { fakeNextCache } = await import("../../helpers/next-cache");
const { readJobCadence, updateJobCadence, JOB_CADENCE_SETTING_KEY } = await import("@/modules/jobs/cadence");
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

async function staff(role: "SUPERADMIN" | "ADMIN" | "MODERATOR" | "DEV") {
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

describe("BR-REQ-090-07 criterion 7 the minimum interval between two real runs", () => {
  it("is 'only when something is due' when nobody has set it, and when the value cannot be read", async () => {
    expect(await readJobCadence(db)).toEqual({ minutes: 0, updatedAt: null });
    await db.insert(platformSettings).values({ key: JOB_CADENCE_SETTING_KEY, value: { minutes: 45 }, updatedAt: NOW });
    expect((await readJobCadence(db)).minutes).toBe(0);
  });

  it("is set by a Superadministrator, audited from and to, and forgets every cached schedule", async () => {
    const admin = await staff("SUPERADMIN");
    const saved = await updateJobCadence(db, admin, { minutes: "30" }, NOW);
    expect(saved).toEqual({ minutes: 30, updatedAt: NOW });
    expect(await readJobCadence(db)).toEqual({ minutes: 30, updatedAt: NOW });

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "job_cadence.changed"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.metadataJson).toEqual({ from: 0, to: 30 });

    expect(fakeNextCache.invalidated).toEqual(
      expect.arrayContaining(["br-jobs:due:registration-maintenance", "br-jobs:due:email-outbox", "br-jobs:floor"]),
    );
  });

  it("is refused on the server for anybody but a Superadministrator, and leaves no trace (§NNN)", async () => {
    // The Administrator first — the platform's throttle is the one thing that tells the top two
    // roles apart (§NNN) — then Organizator and Tehnic.
    for (const role of ["ADMIN", "MODERATOR", "DEV"] as const) {
      expect(await refusal(updateJobCadence(db, await staff(role), { minutes: 15 }, NOW))).toBe("FORBIDDEN");
    }
    expect(await db.select().from(platformSettings)).toEqual([]);
    expect(await db.select().from(auditLogs)).toEqual([]);
    expect(fakeNextCache.invalidated).toEqual([]);
  });

  it("refuses a value outside the offered choices", async () => {
    const admin = await staff("SUPERADMIN");
    expect(await refusal(updateJobCadence(db, admin, { minutes: 45 }, NOW))).toBe("VALIDATION_ERROR");
    expect(await refusal(updateJobCadence(db, admin, { minutes: "soon" }, NOW))).toBe("VALIDATION_ERROR");
    expect(await db.select().from(platformSettings)).toEqual([]);
  });
});

/*
  BR-REQ-060-01 (§NNN) — the email delivery timing (§221) is the other platform setting beside the
  throttle: "scheduled" holds every message for the pinger. It rode on `canManageStaff`, which
  the Administrator now holds for the team, so it asks `canManagePlatform` of its own.
*/
describe("BR-REQ-060-01 the email delivery timing is a Superadministrator's (§NNN)", () => {
  it("refuses an Administrator and lets a Superadministrator set it", async () => {
    const { readDeliveryTiming, updateDeliveryTiming } = await import("@/modules/notifications/delivery-timing");
    expect(await refusal(updateDeliveryTiming(db, await staff("ADMIN"), { timing: "scheduled" }, NOW))).toBe("FORBIDDEN");
    expect((await readDeliveryTiming(db)).timing).toBe("immediate");

    await updateDeliveryTiming(db, await staff("SUPERADMIN"), { timing: "scheduled" }, NOW);
    expect((await readDeliveryTiming(db)).timing).toBe("scheduled");
  });
});
