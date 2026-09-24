import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { wakeJobs } from "@/modules/jobs/schedule-cache";
import { canManageStaff } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  DEFAULT_DELIVERY_TIMING,
  type DeliveryTimingSetting,
  deliveryTimingSettingSchema,
} from "./domain/delivery-timing";

/**
 * Whether the outbox drains after the request that filled it, or only on the scheduler
 * (`DECISIONS.md` §221). Read by the drain, written by a Superadministrator on `/admin/emails`.
 *
 * The same shape as the Mailgun plan beside it (§100) — one `platform_settings` row, a strict
 * schema, an audit row naming who changed it and from what — and one deliberate difference:
 * the role. The plan is the Administrator's because it is a fact about the club's account;
 * this makes every message on the platform arrive later and is the Superadministrator's.
 */

export const DELIVERY_TIMING_SETTING_KEY = "deliveryTiming";
/** One fixed id per setting key, never reused, as `email-plan.ts` and `send-now.ts` do. */
export const DELIVERY_TIMING_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e003";

export type DeliveryTimingState = DeliveryTimingSetting & { updatedAt: Date | null };

export async function readDeliveryTiming<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<DeliveryTimingState> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, DELIVERY_TIMING_SETTING_KEY))
    .limit(1);
  if (!row) return { ...DEFAULT_DELIVERY_TIMING, updatedAt: null };
  // A value this code can no longer read falls back to the default rather than throwing on a
  // path that runs after every queued email — the same reasoning as the plan's fallback.
  const parsed = deliveryTimingSettingSchema.safeParse(row.value);
  return parsed.success
    ? { ...parsed.data, updatedAt: row.updatedAt }
    : { ...DEFAULT_DELIVERY_TIMING, updatedAt: row.updatedAt };
}

export async function updateDeliveryTiming<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<DeliveryTimingState> {
  if (!canManageStaff(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change when email is sent`);
  }
  const parsed = deliveryTimingSettingSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
  }
  const next = parsed.data;
  const before = await readDeliveryTiming(db);

  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: DELIVERY_TIMING_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "delivery_timing.changed",
      entityType: "platform_setting",
      entityId: DELIVERY_TIMING_SETTING_ENTITY_ID,
      metadata: { from: before.timing, to: next.timing },
      now,
    });
  });
  // Rows the drain was leaving to the pinger, or the pinger to the drain: the outbox job looks
  // again at its next ping rather than at the end of the quiet it last promised (§334).
  wakeJobs("email-outbox");
  return { ...next, updatedAt: now };
}
