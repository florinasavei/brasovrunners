import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { wakeJobs } from "@/modules/jobs/schedule-cache";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { env } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import { type DeliveryTimingSetting, defaultDeliveryTiming, deliveryTimingSettingSchema } from "./domain/delivery-timing";
import { drainOutboxAfterResponse } from "./drain";

/**
 * Whether the outbox drains after the request that filled it, or only on the scheduler
 * (`DECISIONS.md` §221, §513). Read by the drain, written by an Administrator in «Termene» on
 * `/admin/emails`.
 *
 * The same shape as the Mailgun plan and the deadlines beside it (§100, §377) — one
 * `platform_settings` row, a strict schema, the Administrator's club setting asserted here and not
 * only by the hidden form, an audit row naming who changed it and from what. It was the
 * Superadministrator's (§221, §450); since §513 it sits in «Termene», because what it changes is a
 * wait every participant is told about, not whether the platform runs — nothing is lost either way.
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
  // Unset: scheduled on QA and production, immediate where no pinger runs (§513).
  const fallback = defaultDeliveryTiming(env.APP_ENV);
  if (!row) return { ...fallback, updatedAt: null };
  // A value this code can no longer read falls back to the default rather than throwing on a
  // path that runs after every queued email — the same reasoning as the plan's fallback.
  const parsed = deliveryTimingSettingSchema.safeParse(row.value);
  return parsed.success
    ? { ...parsed.data, updatedAt: row.updatedAt }
    : { ...fallback, updatedAt: row.updatedAt };
}

export async function updateDeliveryTiming<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<DeliveryTimingState> {
  // A club setting in «Termene» (§513): the Administrator's, as every other number in that fold.
  if (!canManageClubSettings(actor.role)) {
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
  // A save that moves nothing writes nothing: no row, no audit, no cache expiry (as `updateDeadlines`).
  if (before.timing === next.timing && before.updatedAt !== null) return before;

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
  // The screen after the registration form and the newsletter's pop-up say how long the email
  // takes, from the public cache (§333): they must say the new wait, not the old one.
  revalidatePublicContent("settings");
  // Rows the drain was leaving to the pinger, or the pinger to the drain: the outbox job looks
  // again at its next ping rather than at the end of the quiet it last promised (§334).
  wakeJobs("email-outbox");
  /*
    Switched off (§NNN): what the scheduled round was holding leaves now, after this response, the
    way every email leaves from here on — not at the tick the queue panel had just named. One
    batch, the drain's own (§68); anything past it or deferred is the outbox job's, woken above.
  */
  if (next.timing === "immediate") drainOutboxAfterResponse();
  return { ...next, updatedAt: now };
}
