import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import { staffUsers, type StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  DEFAULT_VERCEL_PLAN,
  readVercelPlanValue,
  type VercelPlanSetting,
  vercelPlanSettingSchema,
} from "./domain/vercel-plan";

/**
 * Which Vercel plan the club is on, and with how many seats: read by «Setări» → «Costuri», whose
 * cost table, month card and yearly sentence price it, written there by an Administrator (§NNN).
 *
 * Copied from the Neon plan (`neon-plan.ts`, §306) and the Mailgun plan before it (§100): one
 * `platform_settings` row, a strict schema, the role asserted here as well as at the action, and an
 * audit row saying who changed it, from what and why. Unlike Neon's, nothing reads Vercel's own
 * answer first — the setting is the plan until that follow-up exists (§326's shape).
 */

export const VERCEL_PLAN_SETTING_KEY = "vercelPlan";
/** One fixed id per setting for the audit row, never reused (`…e013` is the menu order, §483). */
export const VERCEL_PLAN_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e014";

export type VercelPlanState = VercelPlanSetting & {
  updatedAt: Date | null;
  /** Who saved it last, by the name the team knows them by; null before anybody did, or once they are gone. */
  updatedBy: string | null;
};

export async function readVercelPlan<T extends Record<string, unknown>>(db: Database<T>): Promise<VercelPlanState> {
  const [row] = await db
    .select({ value: platformSettings.value, updatedAt: platformSettings.updatedAt, updatedBy: staffUsers.displayName })
    .from(platformSettings)
    .leftJoin(staffUsers, eq(staffUsers.id, platformSettings.updatedByStaffUserId))
    .where(eq(platformSettings.key, VERCEL_PLAN_SETTING_KEY))
    .limit(1);
  if (!row) return { ...DEFAULT_VERCEL_PLAN, updatedAt: null, updatedBy: null };
  // A value this code once wrote and can no longer read falls back to Hobby rather than to a crash
  // on every page: the page then reads as it did before the setting existed.
  return { ...readVercelPlanValue(row.value), updatedAt: row.updatedAt, updatedBy: row.updatedBy ?? null };
}

export async function updateVercelPlan<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<VercelPlanSetting & { updatedAt: Date }> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the Vercel plan`);
  }
  const parsed = vercelPlanSettingSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
  }
  const next = parsed.data;

  const before = await readVercelPlan(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: VERCEL_PLAN_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "vercel_plan.changed",
      entityType: "platform_setting",
      entityId: VERCEL_PLAN_SETTING_ENTITY_ID,
      metadata: { from: { plan: before.plan, seats: before.seats }, to: { plan: next.plan, seats: next.seats }, note: next.note },
      now,
    });
  });
  return { ...next, updatedAt: now };
}
