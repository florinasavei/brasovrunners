import { z } from "zod";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { protectPlaceholders } from "./placeholders";
import { richTextSegments, segmentCharacters } from "./rich-text-html";

/**
 * The club's daily allowance of translated characters (`DECISIONS.md` §464, §497).
 *
 * The club's DeepL key carries a credit given once — 1 000 000 characters, never renewed — and
 * DeepL answers "quota exceeded" (HTTP 456) once it is spent (`domain/credit.ts`). Fifty thousand
 * a day by default keeps one enthusiastic afternoon — a dozen long descriptions translated three
 * times over — from spending a large share of it, and still covers every ordinary week: an
 * event's texts in full are five to fifteen thousand. The Administrator changes it on
 * `/admin/tasks` → Costuri; 0 turns the buttons' work off without touching a variable. The count
 * is the characters *sent*, tags included — stricter than DeepL's own, so the club's figure runs
 * out first.
 */
/**
 * The highest daily allowance the Administrator may type (§464, §497): a ceiling on the setting,
 * not a provider's figure — half of the club's one-time credit in a single day is already more
 * than any week needs.
 */
export const TRANSLATION_DAILY_CEILING_CHARACTERS = 500_000;

export const TRANSLATION_BUDGET_RULE = {
  min: 0,
  max: TRANSLATION_DAILY_CEILING_CHARACTERS,
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

/**
 * The characters a press sends, counted exactly as the service counts them against the budget
 * (§464): a rich text's lines as the HTML that travels, tags included; a plain box's words with
 * its `{placeholders}` as the numbered markers that travel; a blank box nothing. The service and
 * «Copiază și tradu tot» both read this one function (§482), so the figure the question names
 * before the press is the figure the budget is charged after it.
 */
export function charactersToSend(items: readonly ({ kind: "text"; text: string } | { kind: "rich"; doc: RichTextDoc })[]): number {
  let total = 0;
  for (const item of items) {
    if (item.kind === "rich") {
      for (const segment of richTextSegments(item.doc)) total += segmentCharacters(segment);
    } else if (item.text.trim() !== "") {
      total += protectPlaceholders(item.text).text.length;
    }
  }
  return total;
}

/**
 * Above this many characters «Copiază și tradu tot» always asks first, naming the figure (§482):
 * two fifths of the default day (50 000), so one press of a long race page never spends most of
 * the day's allowance without the person seeing the number.
 */
export const ASK_ABOVE_CHARACTERS = 20_000;
