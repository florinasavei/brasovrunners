import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { NEON_LIMITS_ENTITY_ID, NeonLimitsRefusal, updateNeonLimits } from "@/modules/diagnostics/neon-limits";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { fakeNeon, instantSleep, NEON_ENV, productionLikeState } from "../../helpers/fake-neon";

/**
 * BR-REQ-090-07 criterion 9 (§NNN) — the database's brakes are the Administrator's, asserted in
 * the service; checked against a fresh read of Neon; audited from and to as Neon states them
 * before and after, never as requested. Neon is the in-memory fake: nothing here reaches it.
 */
const NOW = new Date("2026-09-23T21:00:00.000Z");
const QA = { ...NEON_ENV, APP_ENV: "qa" as const };
const PRODUCTION = { ...NEON_ENV, APP_ENV: "production" as const };

describe("BR-REQ-090-07 updateNeonLimits", () => {
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

  const audits = () => db.select().from(auditLogs).where(eq(auditLogs.action, "neon_limits.changed"));

  it("sets the ceiling and the limit, and audits what Neon says after, from what it said before", async () => {
    const neon = fakeNeon(productionLikeState());
    const outcome = await updateNeonLimits(
      db,
      admin,
      { maxCu: "0.5", quotaMode: "limit", quotaCuHours: "50", confirmSuspension: false },
      { env: QA, now: NOW, fetchImpl: neon.fetch },
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.after).toMatchObject({ computes: [{ id: "ep-rw-main", minCu: 0.25, maxCu: 0.5 }], defaults: { minCu: 0.25, maxCu: 0.5 }, quotaCuHours: 50 });
    // Read, write the project, write the compute, read back.
    expect(neon.calls.filter((call) => call.method === "PATCH")).toHaveLength(2);
    expect(neon.calls.filter((call) => call.method === "GET")).toHaveLength(4);

    const [row] = await audits();
    expect(row.actorStaffUserId).toBe(admin.id);
    expect(row.entityType).toBe("platform_setting");
    expect(row.entityId).toBe(NEON_LIMITS_ENTITY_ID);
    expect(row.metadataJson).toEqual({
      from: { maxCu: 1, quotaCuHours: null },
      to: { maxCu: 0.5, quotaCuHours: 50 },
      requested: { maxCu: 0.5, quotaCuHours: 50 },
      environment: "qa",
      complete: true,
    });
  });

  it("records what Neon holds after the change, even when it differs from the request", async () => {
    // A Neon that takes the ceiling and quietly keeps its own: the row says what it kept.
    const neon = fakeNeon(productionLikeState(), (call) => {
      if (call.method !== "PATCH" || !call.path.includes("/endpoints/")) return undefined;
      return new Response(JSON.stringify({ endpoint: {} }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await updateNeonLimits(db, admin, { maxCu: "4", quotaMode: "none" }, { env: QA, now: NOW, fetchImpl: neon.fetch });
    const [row] = await audits();
    expect(row.metadataJson).toMatchObject({ from: { maxCu: 1 }, to: { maxCu: 1 }, requested: { maxCu: 4 } });
  });

  it("is the Administrator's: an Organizer and Tehnic are refused before Neon is asked anything", async () => {
    const neon = fakeNeon(productionLikeState());
    for (const actor of [organizer, tehnic]) {
      await expect(
        updateNeonLimits(db, actor, { maxCu: "0.25", quotaMode: "none" }, { env: QA, now: NOW, fetchImpl: neon.fetch }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(neon.calls).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });

  it("refuses a limit that would suspend the database on saving, naming the box, and writes nothing", async () => {
    const neon = fakeNeon(productionLikeState({ usedCuHours: 48 }));
    const refusal = await updateNeonLimits(db, admin, { maxCu: "1", quotaMode: "limit", quotaCuHours: "50" }, { env: QA, now: NOW, fetchImpl: neon.fetch }).catch(
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(NeonLimitsRefusal);
    expect(refusal).toMatchObject({ reason: "NEON_QUOTA_BELOW_USAGE", fields: ["quotaCuHours"] });
    expect(neon.calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });

  it("asks production for the confirmation before a limit, and takes the limit once it is ticked", async () => {
    const neon = fakeNeon(productionLikeState());
    await expect(
      updateNeonLimits(db, admin, { maxCu: "1", quotaMode: "limit", quotaCuHours: "200" }, { env: PRODUCTION, now: NOW, fetchImpl: neon.fetch }),
    ).rejects.toMatchObject({ reason: "NEON_QUOTA_UNCONFIRMED", fields: ["confirmSuspension"] });
    expect(neon.calls.filter((call) => call.method === "PATCH")).toHaveLength(0);

    const outcome = await updateNeonLimits(
      db,
      admin,
      { maxCu: "1", quotaMode: "limit", quotaCuHours: "200", confirmSuspension: true },
      { env: PRODUCTION, now: NOW, fetchImpl: neon.fetch },
    );
    expect(outcome.after?.quotaCuHours).toBe(200);
    expect((await audits())[0].metadataJson).toMatchObject({ environment: "production", to: { quotaCuHours: 200 } });

    // Throttling the size alone on production needs no confirmation: the quota box comes back
    // with the limit Neon holds, which is not a new limit — and no quota is sent at all.
    neon.calls.length = 0;
    await expect(
      updateNeonLimits(db, admin, { maxCu: "0.5", quotaMode: "limit", quotaCuHours: "200", confirmSuspension: false }, { env: PRODUCTION, now: NOW, fetchImpl: neon.fetch }),
    ).resolves.toMatchObject({ changed: true, after: { quotaCuHours: 200, computes: [{ maxCu: 0.5 }] } });
    const patches = neon.calls.filter((call) => call.method === "PATCH");
    expect(patches.length).toBeGreaterThan(0);
    expect(patches.some((call) => JSON.stringify(call.body).includes("compute_time_seconds"))).toBe(false);

    // Removing the limit needs none either: it can only keep the site up.
    await expect(
      updateNeonLimits(db, admin, { maxCu: "0.25", quotaMode: "none" }, { env: PRODUCTION, now: NOW, fetchImpl: neon.fetch }),
    ).resolves.toMatchObject({ changed: true });
  });

  it("keeps a quota Neon holds in odd seconds exactly, when the box comes back as the card filled it", async () => {
    // 100000 seconds: 27.777… CU-hours, shown by the card as 27.7778 (`quotaBoxValue`).
    const state = productionLikeState();
    state.project.settings = { quota: { compute_time_seconds: 100_000 } };
    const neon = fakeNeon(state);
    await updateNeonLimits(db, admin, { maxCu: "0.5", quotaMode: "limit", quotaCuHours: "27.7778" }, { env: PRODUCTION, now: NOW, fetchImpl: neon.fetch });
    expect(neon.state.project.settings?.quota).toEqual({ compute_time_seconds: 100_000 });
    expect(neon.calls.some((call) => call.method === "PATCH" && JSON.stringify(call.body).includes("compute_time_seconds"))).toBe(false);
  });

  it("refuses a shape the form cannot mean, before asking Neon", async () => {
    const neon = fakeNeon(productionLikeState());
    await expect(updateNeonLimits(db, admin, { maxCu: "3", quotaMode: "none" }, { env: QA, now: NOW, fetchImpl: neon.fetch })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["maxCu"],
    });
    expect(neon.calls).toHaveLength(0);
  });

  it("says nothing changed, and audits nothing, when Neon already holds the values", async () => {
    const neon = fakeNeon(productionLikeState());
    const outcome = await updateNeonLimits(db, admin, { maxCu: "1", quotaMode: "none" }, { env: QA, now: NOW, fetchImpl: neon.fetch });
    expect(outcome.changed).toBe(false);
    expect(neon.calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });

  it("names a key that may read and not write, and audits the half that was applied", async () => {
    // Nothing applied: the project write itself is refused.
    const refusedAtOnce = fakeNeon(productionLikeState(), (call) => (call.method === "PATCH" ? new Response("", { status: 403 }) : undefined));
    await expect(
      updateNeonLimits(db, admin, { maxCu: "2", quotaMode: "none" }, { env: QA, now: NOW, fetchImpl: refusedAtOnce.fetch }),
    ).rejects.toMatchObject({ reason: "NEON_KEY_FORBIDDEN", code: "FORBIDDEN" });
    expect(await audits()).toHaveLength(0);

    // Half applied: the project took the default, the compute refused — the row says so.
    const half = fakeNeon(productionLikeState(), (call) =>
      call.method === "PATCH" && call.path.includes("/endpoints/") ? new Response("", { status: 403 }) : undefined,
    );
    await expect(updateNeonLimits(db, admin, { maxCu: "2", quotaMode: "none" }, { env: QA, now: NOW, fetchImpl: half.fetch })).rejects.toMatchObject({
      reason: "NEON_KEY_FORBIDDEN",
    });
    const [row] = await audits();
    expect(row.metadataJson).toMatchObject({ from: { maxCu: 1 }, to: { maxCu: 1 }, requested: { maxCu: 2 }, complete: false });
  });

  it("answers a Neon that is busy, down or missing with its own refusal", async () => {
    const busy = fakeNeon(productionLikeState(), (call) => (call.method === "PATCH" ? new Response("", { status: 423 }) : undefined));
    await expect(
      updateNeonLimits(db, admin, { maxCu: "2", quotaMode: "none" }, { env: QA, now: NOW, fetchImpl: busy.fetch, sleep: instantSleep().sleep }),
    ).rejects.toMatchObject({ reason: "NEON_BUSY" });

    const down = fakeNeon(productionLikeState(), () => new Response("", { status: 502 }));
    await expect(updateNeonLimits(db, admin, { maxCu: "2", quotaMode: "none" }, { env: QA, now: NOW, fetchImpl: down.fetch })).rejects.toMatchObject({
      reason: "NEON_UNREACHABLE",
    });

    await expect(
      updateNeonLimits(db, admin, { maxCu: "2", quotaMode: "none" }, { env: { NEON_API_KEY: undefined, NEON_PROJECT_ID: undefined, APP_ENV: "qa" }, now: NOW }),
    ).rejects.toMatchObject({ reason: "NEON_UNCONFIGURED" });
    expect(await audits()).toHaveLength(0);
  });
});
