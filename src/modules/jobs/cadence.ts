import { eq } from "drizzle-orm";
import { z } from "zod";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { JOB_CADENCE_CHOICES, type JobCadenceMinutes } from "./schedule";
import { forgetJobSchedules } from "./schedule-cache";

/**
 * How often the platform may look at the database for its scheduled work, at most — the owner's
 * throttle (§334; 2026-09-23: "I want toggles in my admin area, so I can throttle myself when
 * needed"). Set on `/admin/tasks` → Costuri beside the Neon plan, and the same shape as it
 * (`diagnostics/neon-plan.ts`): one `platform_settings` row, a strict schema, the Administrator's
 * role asserted here and not only by the hidden button, and an audit row naming who changed it
 * from what to what.
 *
 * The value is the **minimum** number of minutes between two real runs of each job, whatever the
 * pinger does; zero — "la nevoie", the default — is the next-due rule alone (`schedule.ts`). A
 * ping inside the interval answers from the cache without waking the database, exactly like a
 * ping with nothing due: the interval travels in the cached floor slots a run leaves behind, so
 * the pings honour it without reading this row. This row is read by the runs themselves, by
 * `/api/health` — which widens what it calls stale to match, so the owner's own throttle never
 * pages him — and by the screens that show it.
 */

export const JOB_CADENCE_SETTING_KEY = "jobCadence";
/** One fixed id per setting for the audit row; `…e001`–`…e006` are taken (§100, §164, §244, §247, §254, §280). */
export const JOB_CADENCE_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e007";

export const jobCadenceSettingSchema = z
  .object({
    minutes: z.coerce
      .number()
      .int()
      .refine((value) => (JOB_CADENCE_CHOICES as readonly number[]).includes(value), {
        message: `one of ${JOB_CADENCE_CHOICES.join(", ")}`,
      }),
  })
  .strict();

export type JobCadenceState = { minutes: JobCadenceMinutes; updatedAt: Date | null };

/** "Only when something is due": the default, and what a value this code cannot read falls back to. */
export const DEFAULT_JOB_CADENCE: JobCadenceState = { minutes: 0, updatedAt: null };

export function readJobCadenceValue(value: unknown): JobCadenceMinutes {
  const parsed = jobCadenceSettingSchema.safeParse(value);
  return parsed.success ? (parsed.data.minutes as JobCadenceMinutes) : DEFAULT_JOB_CADENCE.minutes;
}

export async function readJobCadence<T extends Record<string, unknown>>(db: Database<T>): Promise<JobCadenceState> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, JOB_CADENCE_SETTING_KEY))
    .limit(1);
  if (!row) return { ...DEFAULT_JOB_CADENCE };
  return { minutes: readJobCadenceValue(row.value), updatedAt: row.updatedAt };
}

export async function updateJobCadence<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<JobCadenceState> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change how often the platform checks`);
  }
  const parsed = jobCadenceSettingSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
  }
  const next = { minutes: parsed.data.minutes as JobCadenceMinutes };

  const before = await readJobCadence(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: JOB_CADENCE_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "job_cadence.changed",
      entityType: "platform_setting",
      entityId: JOB_CADENCE_SETTING_ENTITY_ID,
      metadata: { from: before.minutes, to: next.minutes },
      now,
    });
  });
  // Every cached quiet and every floor was planned under the old interval: the next ping of each
  // job runs, reads this row, and plans under the new one.
  forgetJobSchedules();
  return { ...next, updatedAt: now };
}
