import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §377 — "Termene", the club's deadlines as a setting: the §100 shape. Unset reads today's
 * constants; an Administrator (and only an Administrator, asserted on the server) saves it; every
 * save is audited with what moved, from and to; a refused save leaves no row and no audit; a
 * value this code cannot read falls back field by field; and a save is seen at once on this
 * instance, and the maintenance job is told its work may be due sooner (§334).
 */
const NOW = new Date("2026-10-01T10:00:00.000Z");

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);

const { fakeNextCache } = await import("../../helpers/next-cache");
const { currentDeadlines, readDeadlines, readDeadlinesForRun, updateDeadlines, DEADLINES_SETTING_KEY } = await import("@/modules/deadlines/deadlines");
const { DEFAULT_DEADLINES } = await import("@/modules/deadlines/domain/deadlines");
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

type Role = "CONTRIBUTOR" | "COPYWRITER" | "MODERATOR" | "DEV" | "ADMIN" | "SUPERADMIN";
async function staff(role: Role) {
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

describe("§377 the club's deadlines as a setting", () => {
  it("reads today's constants when nobody has set them", async () => {
    expect(await readDeadlines(db)).toEqual({ deadlines: DEFAULT_DEADLINES, updatedAt: null });
    expect(await currentDeadlines(db)).toEqual(DEFAULT_DEADLINES);
  });

  it("reads what it can of a stored value, field by field, and today's constant for the rest", async () => {
    await db.insert(platformSettings).values({ key: DEADLINES_SETTING_KEY, value: { holdMinutes: 20, offerHours: 999, extra: true }, updatedAt: NOW });
    expect((await readDeadlines(db)).deadlines).toEqual({ ...DEFAULT_DEADLINES, holdMinutes: 20 });
  });

  it("is saved by an Administrator, audited with what moved from and to, and seen at once", async () => {
    // The memo holds today's constants before the save…
    expect(await currentDeadlines(db)).toEqual(DEFAULT_DEADLINES);
    const admin = await staff("ADMIN");
    const next = { ...DEFAULT_DEADLINES, holdMinutes: 15, reminderHours: 72, seriesHorizonDays: 84 };
    const saved = await updateDeadlines(db, admin, Object.fromEntries(Object.entries(next).map(([k, v]) => [k, String(v)])), NOW);
    expect(saved).toEqual({ deadlines: next, updatedAt: NOW });
    expect(await readDeadlines(db)).toEqual({ deadlines: next, updatedAt: NOW });
    // …and the save drops it: the next allocation on this instance gives fifteen minutes.
    expect(await currentDeadlines(db)).toEqual(next);

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "deadlines.changed"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.entityType).toBe("platform_setting");
    expect(audit.metadataJson).toEqual({
      changed: ["holdMinutes", "reminderHours", "seriesHorizonDays"],
      from: { holdMinutes: 30, reminderHours: 48, seriesHorizonDays: 56 },
      to: { holdMinutes: 15, reminderHours: 72, seriesHorizonDays: 84 },
    });
    // A longer reminder or horizon may make the job's work due sooner than it promised (§334).
    expect(fakeNextCache.invalidated).toContain("br-jobs:due:registration-maintenance");
  });

  it("a save that changes nothing writes nothing — no row, no audit, no cache expiry, no job woken", async () => {
    const admin = await staff("ADMIN");
    // Unset: saving today's numbers is no change.
    expect(await updateDeadlines(db, admin, { ...DEFAULT_DEADLINES }, NOW)).toEqual({ deadlines: DEFAULT_DEADLINES, updatedAt: null });
    expect(await db.select().from(platformSettings)).toEqual([]);
    // Set once, then saved again unchanged: the first save's row and audit stand alone.
    const next = { ...DEFAULT_DEADLINES, holdMinutes: 15 };
    await updateDeadlines(db, admin, next, NOW);
    fakeNextCache.reset();
    const later = new Date(NOW.getTime() + 60_000);
    expect(await updateDeadlines(db, admin, next, later)).toEqual({ deadlines: next, updatedAt: NOW });
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "deadlines.changed"))).toHaveLength(1);
    expect((await readDeadlines(db)).updatedAt).toEqual(NOW);
    expect(fakeNextCache.invalidated).toEqual([]);
  });

  it("is a Superadministrator's too, the role above", async () => {
    const saved = await updateDeadlines(db, await staff("SUPERADMIN"), { ...DEFAULT_DEADLINES, offerHours: 12 }, NOW);
    expect(saved.deadlines.offerHours).toBe(12);
  });

  it("is refused on the server for every role below the Administrator, and leaves no trace", async () => {
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV"] as const) {
      expect(await refusal(updateDeadlines(db, await staff(role), { ...DEFAULT_DEADLINES, holdMinutes: 15 }, NOW)), role).toBe("FORBIDDEN");
    }
    expect(await db.select().from(platformSettings)).toEqual([]);
    expect(await db.select().from(auditLogs)).toEqual([]);
    expect(fakeNextCache.invalidated).toEqual([]);
  });

  it("refuses a value outside its bounds, a blank box and a fraction, naming the box, and writes nothing", async () => {
    const admin = await staff("ADMIN");
    for (const input of [
      { ...DEFAULT_DEADLINES, holdMinutes: 5 },
      { ...DEFAULT_DEADLINES, confirmationHours: 200 },
      { ...DEFAULT_DEADLINES, reminderHours: "" },
      { ...DEFAULT_DEADLINES, offerHours: "12.5" },
    ]) {
      let fields: readonly string[] = [];
      try {
        await updateDeadlines(db, admin, input, NOW);
      } catch (error) {
        if (!isDomainError(error)) throw error;
        expect(error.code).toBe("VALIDATION_ERROR");
        fields = error.fields;
      }
      expect(fields).toHaveLength(1);
    }
    expect(await db.select().from(platformSettings)).toEqual([]);
    expect(await db.select().from(auditLogs)).toEqual([]);
  });

  it("is read fresh by a maintenance run and handed to the memo, so the run and its plan agree", async () => {
    // Somebody else's instance saved it: this one's memo still holds the old numbers…
    expect(await currentDeadlines(db)).toEqual(DEFAULT_DEADLINES);
    await db.insert(platformSettings).values({ key: DEADLINES_SETTING_KEY, value: { ...DEFAULT_DEADLINES, offerHours: 6 }, updatedAt: NOW });
    expect((await currentDeadlines(db)).offerHours).toBe(24);
    // …until a run reads it fresh, and everything after it in the run reads the same.
    expect((await readDeadlinesForRun(db)).offerHours).toBe(6);
    expect((await currentDeadlines(db)).offerHours).toBe(6);
  });
});
