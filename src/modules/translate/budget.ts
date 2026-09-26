import { and, eq, gte, sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { recordAuditEvent } from "@/modules/audit/repository";
import { fromWallTimeInput, toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  DEFAULT_TRANSLATION_BUDGET,
  readTranslationBudgetValue,
  type TranslationBudget,
  translationBudgetSchema,
} from "./domain/budget";

/**
 * Where the club's daily translation allowance is kept, and how much of today's is spent
 * (`DECISIONS.md` §NNN).
 *
 * The setting is one `platform_settings` row in the shape of every other club setting (§377,
 * §389): a strict schema, the Administrator's role asserted here and not only by the hidden form,
 * an audit row naming who changed it from what to what, and a save that changes nothing writes
 * nothing.
 *
 * **The meter is the audit trail itself**, not a counter of its own: every press writes one
 * `content.translated` row carrying the characters it sent, so today's spend is the sum of those
 * rows since the club's midnight. No table, no migration, and a figure nobody can reset by hand.
 */

export const TRANSLATION_BUDGET_SETTING_KEY = "translation-budget";
/** One fixed id per setting for the audit row; `…e001`–`…e009` are taken (§100 … §389). */
export const TRANSLATION_BUDGET_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e00a";

export type TranslationBudgetState = { budget: TranslationBudget; updatedAt: Date | null };

export async function readTranslationBudget<T extends Record<string, unknown>>(db: Database<T>): Promise<TranslationBudgetState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, TRANSLATION_BUDGET_SETTING_KEY)).limit(1);
  if (!row) return { budget: { ...DEFAULT_TRANSLATION_BUDGET }, updatedAt: null };
  return { budget: readTranslationBudgetValue(row.value), updatedAt: row.updatedAt };
}

/** The club's midnight today, as an instant: the day the allowance counts. */
export function startOfClubDay(now: Date): Date {
  const today = toWallTimeInput(now, CLUB_TIME_ZONE).slice(0, 10);
  return fromWallTimeInput(`${today}T00:00`, CLUB_TIME_ZONE) ?? now;
}

/** The characters sent for translation since the club's midnight, by everybody. */
export async function charactersTranslatedToday<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`coalesce(sum((${auditLogs.metadataJson}->>'characters')::integer), 0)` })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "content.translated"), gte(auditLogs.createdAt, startOfClubDay(now))));
  return Number(row?.total ?? 0);
}

export async function updateTranslationBudget<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<TranslationBudgetState> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the translation budget`);
  }
  const parsed = translationBudgetSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
  }
  const next: TranslationBudget = parsed.data;
  const before = await readTranslationBudget(db);
  if (before.budget.dailyCharacters === next.dailyCharacters) return before;

  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: TRANSLATION_BUDGET_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "translationBudget.changed",
      entityType: "platform_setting",
      entityId: TRANSLATION_BUDGET_SETTING_ENTITY_ID,
      metadata: { from: before.budget.dailyCharacters, to: next.dailyCharacters },
      now,
    });
  });
  return { budget: next, updatedAt: now };
}
