import { z } from "zod";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { protectPlaceholders } from "./placeholders";
import { richTextSegments, segmentCharacters } from "./rich-text-html";

/**
 * The club's daily allowance of translated characters (`DECISIONS.md` §464, §497), guarding the
 * key's one-time credit (`domain/credit.ts`). The default 50 000 covers an ordinary week (an
 * event's texts are 5–15 thousand); 0 turns translation off. It counts characters *sent*, tags
 * included — stricter than DeepL's count, so the club's figure runs out first.
 */
/** The highest allowance the setting accepts (§464, §497); not a provider figure. */
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

export function budgetAllows(usedToday: number, asked: number, budget: TranslationBudget): { allowed: boolean; remaining: number } {
  const remaining = Math.max(0, budget.dailyCharacters - usedToday);
  return { allowed: asked <= remaining, remaining };
}

/**
 * The characters a press sends, as they travel (rich text as tagged HTML, placeholders as
 * markers). The service and «Copiază și tradu tot» share it, so the figure asked about before
 * the press is the one charged after it (§464, §482).
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

/** Above this, «Copiază și tradu tot» asks first, naming the figure (§482): two fifths of the default day. */
export const ASK_ABOVE_CHARACTERS = 20_000;
