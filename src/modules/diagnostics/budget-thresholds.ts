import { eq } from "drizzle-orm";
import { revalidateTag, unstable_cache } from "next/cache";
import { z } from "zod";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { buildInfo } from "@/shared/config/build-info";
import { DomainError } from "@/shared/errors/domain-error";
import { type BudgetThresholds, DEFAULT_BUDGET_THRESHOLDS } from "./domain/neon-budget";
import { forgetNeonBudget } from "./neon-budget";

/**
 * The two shares of the Neon quota that turn the month's budget amber and red (§447) — the
 * Administrator's to move on `/admin/tasks` → Costuri, built like §334's interval beside it: one
 * `platform_settings` row, a strict schema, the role asserted here and not only by the hidden
 * form, and an audit row naming who changed them from what to what. No migration: a new key in
 * the existing table.
 *
 * **Read without the database, almost always.** The governor needs these on every job ping and
 * public read, and it must not wake the compute to learn how careful to be about waking the
 * compute. So the row is kept in Next's data cache under the deployment's build, with no time
 * limit: it is read once per deployment (a release has already woken the database) and again
 * after the Administrator saves, which expires it. When the read fails — the database is away —
 * the defaults answer and nothing is cached, so the next read tries again after the budget's
 * one-minute memo, never in a loop.
 */

export const BUDGET_THRESHOLDS_SETTING_KEY = "neonBudgetThresholds";
/** One fixed id per setting for the audit row; `…e001`–`…e009` are taken. */
export const BUDGET_THRESHOLDS_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e00b";

const TAG = "settings:neon-budget-thresholds";

export const budgetThresholdsSchema = z
  .object({
    amberPercent: z.coerce.number().int().min(10).max(95),
    redPercent: z.coerce.number().int().min(20).max(99),
  })
  .strict()
  .refine((value) => value.redPercent > value.amberPercent, { message: "red after amber", path: ["redPercent"] });

export type BudgetThresholdsState = BudgetThresholds & { updatedAt: Date | null };

export function readBudgetThresholdsValue(value: unknown): BudgetThresholds {
  const parsed = budgetThresholdsSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_BUDGET_THRESHOLDS };
}

export async function readBudgetThresholds<T extends Record<string, unknown>>(db: Database<T>): Promise<BudgetThresholdsState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, BUDGET_THRESHOLDS_SETTING_KEY)).limit(1);
  if (!row) return { ...DEFAULT_BUDGET_THRESHOLDS, updatedAt: null };
  return { ...readBudgetThresholdsValue(row.value), updatedAt: row.updatedAt };
}

/**
 * The thresholds in force, for the governor — from the data cache inside a production Next
 * server, straight from the database elsewhere (a test, `next dev`), the defaults on any failure.
 */
export async function cachedBudgetThresholds(): Promise<BudgetThresholds> {
  const load = async () => {
    const { getDb } = await import("@/db/client");
    const { amberPercent, redPercent } = await readBudgetThresholds(getDb());
    return { amberPercent, redPercent };
  };
  try {
    if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return await load();
    return await unstable_cache(load, ["br-budget-thresholds", buildInfo.id || buildInfo.commit || "local"], { tags: [TAG] })();
  } catch {
    return { ...DEFAULT_BUDGET_THRESHOLDS };
  }
}

export async function updateBudgetThresholds<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<BudgetThresholdsState> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the budget thresholds`);
  }
  const parsed = budgetThresholdsSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
  }
  const next = parsed.data;
  const before = await readBudgetThresholds(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: BUDGET_THRESHOLDS_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id } });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "neon_budget_thresholds.changed",
      entityType: "platform_setting",
      entityId: BUDGET_THRESHOLDS_SETTING_ENTITY_ID,
      metadata: {
        from: { amberPercent: before.amberPercent, redPercent: before.redPercent },
        to: next,
      },
      now,
    });
  });
  try {
    revalidateTag(TAG, { expire: 0 });
  } catch {
    // Outside a Next server there is no cache to expire.
  }
  forgetNeonBudget();
  return { ...next, updatedAt: now };
}
