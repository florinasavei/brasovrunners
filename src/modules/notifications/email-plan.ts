import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  DEFAULT_EMAIL_PLAN,
  type EmailPlanSetting,
  emailCeilings,
  emailPlanSettingSchema,
} from "./domain/email-plan";

/**
 * Which Mailgun plan the club is on (`DECISIONS.md` §100): read by every page that says how
 * much can still be sent, written by an Administrator on `/admin/emails`.
 *
 * The setting is a claim, not a measurement — Mailgun's API does not tell a domain sending
 * key what plan the account is on — so the page that sets it shows the day's and the month's
 * count next to it, and the audit row says who changed it and from what.
 */

export const EMAIL_PLAN_SETTING_KEY = "emailPlan";
/**
 * `audit_logs.entity_id` is a UUID and a setting has a key, so the audit row names the setting
 * by a fixed id of its own — one per key, never reused, as `send-now.ts` does for the outbox.
 */
export const EMAIL_PLAN_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e001";

export type EmailPlanState = EmailPlanSetting & {
  updatedAt: Date | null;
};

export async function readEmailPlan<T extends Record<string, unknown>>(db: Database<T>): Promise<EmailPlanState> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, EMAIL_PLAN_SETTING_KEY))
    .limit(1);
  if (!row) return { ...DEFAULT_EMAIL_PLAN, updatedAt: null };
  // A value this code once wrote and can no longer read (a plan id removed, say) falls back
  // to Free rather than to a crash on every page: the safe ceiling is the smallest one.
  const parsed = emailPlanSettingSchema.safeParse(row.value);
  return parsed.success ? { ...parsed.data, updatedAt: row.updatedAt } : { ...DEFAULT_EMAIL_PLAN, updatedAt: row.updatedAt };
}

export async function updateEmailPlan<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<EmailPlanState> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the email plan`);
  }
  const parsed = emailPlanSettingSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
  }
  const next = parsed.data;
  // `CUSTOM` with both ceilings empty is allowed — "no ceiling" is what a contract looks like —
  // and the form says so next to the fields. A catalogue plan carries no typed numbers.
  if (next.plan !== "CUSTOM") {
    next.dailyAllowance = null;
    next.monthlyAllowance = null;
  }

  const before = await readEmailPlan(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: EMAIL_PLAN_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "email_plan.changed",
      entityType: "platform_setting",
      entityId: EMAIL_PLAN_SETTING_ENTITY_ID,
      metadata: {
        from: { plan: before.plan, ...emailCeilings(before) },
        to: { plan: next.plan, ...emailCeilings(next) },
        note: next.note,
      },
      now,
    });
  });
  return { ...next, updatedAt: now };
}
