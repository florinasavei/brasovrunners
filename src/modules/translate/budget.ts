import { and, eq, gte, sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { recordAuditEvent } from "@/modules/audit/repository";
import { fromWallTimeInput, toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  DEFAULT_TRANSLATION_BUDGET,
  readTranslationBudgetValue,
  type TranslationBudget,
  translationBudgetSchema,
} from "./domain/budget";

/**
 * The daily translation allowance setting and today's spend (`DECISIONS.md` §464). The setting is
 * a `platform_settings` row like every club setting (§377, §450).
 *
 * The meter is the audit trail: each press's `content.translated` row carries its characters, so
 * no counter exists that anyone could reset.
 */

export const TRANSLATION_BUDGET_SETTING_KEY = "translation-budget";
/**
 * Audit row id. Older rows carry `…e00a` (shared with another setting until §483), told apart by
 * `action`; `tests/unit/settings/entity-ids.test.ts` holds every id unique.
 */
export const TRANSLATION_BUDGET_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e010";

export type TranslationBudgetState = { budget: TranslationBudget; updatedAt: Date | null };

export async function readTranslationBudget<T extends Record<string, unknown>>(db: Database<T>): Promise<TranslationBudgetState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, TRANSLATION_BUDGET_SETTING_KEY)).limit(1);
  if (!row) return { budget: { ...DEFAULT_TRANSLATION_BUDGET }, updatedAt: null };
  return { budget: readTranslationBudgetValue(row.value), updatedAt: row.updatedAt };
}

/** Midnight in the club's time zone: the day the allowance counts. */
export function startOfClubDay(now: Date): Date {
  const today = toWallTimeInput(now, CLUB_TIME_ZONE).slice(0, 10);
  return fromWallTimeInput(`${today}T00:00`, CLUB_TIME_ZONE) ?? now;
}

export async function charactersTranslatedToday<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  return charactersTranslatedSince(db, startOfClubDay(now));
}

/** By everybody; also Costuri's month line (§479). */
export async function charactersTranslatedSince<T extends Record<string, unknown>>(db: Database<T>, since: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`coalesce(sum((${auditLogs.metadataJson}->>'characters')::integer), 0)` })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "content.translated"), gte(auditLogs.createdAt, since)));
  return Number(row?.total ?? 0);
}

export async function updateTranslationBudget<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<TranslationBudgetState> {
  if (!canManageClubSettings(actor.role)) {
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
