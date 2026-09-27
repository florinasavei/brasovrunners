import { z } from "zod";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { protectPlaceholders } from "./placeholders";
import { richTextSegments, segmentCharacters } from "./rich-text-html";

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
/**
 * DeepL API Free's monthly allowance, from deepl.com/pro-api on 2026-09-26 (§464): the one figure
 * the daily allowance's ceiling and Costuri's «Luna aceasta» line (§479) both read.
 */
export const DEEPL_FREE_CHARACTERS_PER_MONTH = 500_000;
export const DEEPL_FREE_CHECKED_ON = "2026-09-26";

export const TRANSLATION_BUDGET_RULE = {
  min: 0,
  max: DEEPL_FREE_CHARACTERS_PER_MONTH,
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
 * «Copiază și tradu tot» both read this one function (§NNN), so the figure the question names
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
 * Above this many characters «Copiază și tradu tot» always asks first, naming the figure (§NNN):
 * two fifths of the default day (50 000), so one press of a long race page never spends most of
 * the day's allowance without the person seeing the number.
 */
export const ASK_ABOVE_CHARACTERS = 20_000;
