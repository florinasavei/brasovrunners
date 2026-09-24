import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  DEFAULT_NEON_PLAN,
  type NeonPlanSetting,
  neonPlanSettingSchema,
  readNeonPlanValue,
} from "./domain/neon-plan";

/**
 * Which Neon plan the club is on: read by `/devs` and `/admin/tasks`, which print the
 * database's month against it, written by an Administrator on `/admin/tasks` → Costuri.
 *
 * The setting is the fallback, not the answer (§326): Neon's project row names the owning
 * account's plan, and the pages read that first (`effectiveNeonPlan`). The setting decides only
 * when the key is not set or Neon does not answer — so the panel that sets it shows the month's
 * hours and the estimate next to it, and the audit row says who changed it and from what. The same
 * shape as the Mailgun plan (`notifications/email-plan.ts`, §100), for the same reason: the
 * owner bought Launch on 2026-09-22 and every page went on saying Free until a deploy; the
 * December review (§280) may take the account back, and that must be one select, not a release.
 */

export const NEON_PLAN_SETTING_KEY = "neonPlan";
/** One fixed id per setting for the audit row; `…e001`–`…e005` are taken (§100, §164, §244, §247, §254). */
export const NEON_PLAN_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e006";

export type NeonPlanState = NeonPlanSetting & {
  updatedAt: Date | null;
};

export async function readNeonPlan<T extends Record<string, unknown>>(db: Database<T>): Promise<NeonPlanState> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, NEON_PLAN_SETTING_KEY))
    .limit(1);
  if (!row) return { ...DEFAULT_NEON_PLAN, updatedAt: null };
  // A value this code once wrote and can no longer read falls back to Free rather than to a
  // crash on every page: the plan with the ceilings is the safe one to be wrong about.
  return { ...readNeonPlanValue(row.value), updatedAt: row.updatedAt };
}

export async function updateNeonPlan<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<NeonPlanState> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the Neon plan`);
  }
  const parsed = neonPlanSettingSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
  }
  const next = parsed.data;

  const before = await readNeonPlan(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: NEON_PLAN_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "neon_plan.changed",
      entityType: "platform_setting",
      entityId: NEON_PLAN_SETTING_ENTITY_ID,
      metadata: { from: { plan: before.plan }, to: { plan: next.plan }, note: next.note },
      now,
    });
  });
  return { ...next, updatedAt: now };
}
