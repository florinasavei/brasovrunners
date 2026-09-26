import { z } from "zod";

/**
 * The club's daily allowance of translated characters (`DECISIONS.md` §464).
 *
 * DeepL API Free gives 500 000 characters a month and then answers "quota exceeded" until the
 * month turns (HTTP 456). Fifty thousand a day by default keeps one enthusiastic afternoon —
 * a dozen long descriptions translated three times over — from spending a fortnight's allowance,
 * and still covers every ordinary week: an event's texts in full are five to fifteen thousand.
 * The Administrator changes it on `/admin/tasks` → Costuri; 0 turns the buttons' work off
 * without touching a variable. The count is the characters *sent*, tags included — stricter
 * than DeepL's own, so the club's figure runs out first.
 */
export const TRANSLATION_BUDGET_RULE = {
  min: 0,
  max: 500_000,
  default: 50_000,
} as const;

export type TranslationBudget = { dailyCharacters: number };

export const DEFAULT_TRANSLATION_BUDGET: TranslationBudget = Object.freeze({ dailyCharacters: TRANSLATION_BUDGET_RULE.default });

export const translationBudgetSchema = z
  .object({
    dailyCharacters: z.preprocess(
      (value) => (typeof value === "string" ? (/^\s*\d+\s*$/.test(value) ? Number(value) : Number.NaN) : value),
      z.number().int().min(TRANSLATION_BUDGET_RULE.min).max(TRANSLATION_BUDGET_RULE.max),
    ),
  })
  .strict();

/** A stored value read leniently: anything that is not a whole number in range reads as the default. */
export function readTranslationBudgetValue(value: unknown): TranslationBudget {
  const raw = value !== null && typeof value === "object" ? (value as Record<string, unknown>).dailyCharacters : undefined;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= TRANSLATION_BUDGET_RULE.min && raw <= TRANSLATION_BUDGET_RULE.max) {
    return { dailyCharacters: raw };
  }
  return { ...DEFAULT_TRANSLATION_BUDGET };
}

/** Whether a press of `asked` characters fits what is left of today's allowance, and what is left. */
export function budgetAllows(usedToday: number, asked: number, budget: TranslationBudget): { allowed: boolean; remaining: number } {
  const remaining = Math.max(0, budget.dailyCharacters - usedToday);
  return { allowed: asked <= remaining, remaining };
}
