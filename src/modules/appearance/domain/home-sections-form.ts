import type { z } from "zod";
import { numbersContentSchema, type NumbersContent } from "@/modules/home/domain/numbers";
import { stripContentSchema, type StripContent } from "@/modules/home/domain/photo-strip";
import { STEP_COUNT, stepsContentSchema, type StepsContent } from "@/modules/home/domain/steps";
import { WHY_COUNT, whyContentSchema, type WhyContent } from "@/modules/home/domain/why";

/**
 * «Pagina principală»'s four lower sections as the setting's form posts them (§714): «Prima dată»,
 * «De ce» and the quote, the photo strip's heading, and the numbers. Each box is a pair the form
 * posts as `<stem>Ro` and `<stem>En`, read through the sections' own schemas (`modules/home/domain/`,
 * both languages or neither, §352), and a refusal names the box the club must fix — the empty side of
 * a pair, or the box over its length — never a path inside the stored value.
 *
 * Pure: the action hands it a reader of the posted form, the service turns a refusal into the house's
 * `VALIDATION_ERROR` naming that box, and the panel draws its boxes from the same tables, so a name the
 * form posts and a name the save reads are never two spellings.
 */

/** One pair of boxes: the stem of its two names, where it sits in the section's value, and its length. */
export type HomeTextBox = Readonly<{ stem: string; path: readonly (string | number)[]; max: number }>;

/** «Prima dată»: the heading, the sentence, the five steps (a title and a sentence each) and the button's words. */
export const STEPS_BOXES: readonly HomeTextBox[] = [
  { stem: "stepsTitle", path: ["title"], max: 80 },
  { stem: "stepsLead", path: ["lead"], max: 200 },
  ...Array.from({ length: STEP_COUNT }, (_, index) => [
    { stem: `step${index + 1}Title`, path: ["steps", index, "title"], max: 60 },
    { stem: `step${index + 1}Body`, path: ["steps", index, "body"], max: 120 },
  ]).flat(),
  { stem: "stepsLink", path: ["linkLabel"], max: 40 },
];

/** «De ce»: the heading, the four reasons (a title and a sentence each), the quote and who said it. */
export const WHY_BOXES: readonly HomeTextBox[] = [
  { stem: "whyTitle", path: ["title"], max: 80 },
  ...Array.from({ length: WHY_COUNT }, (_, index) => [
    { stem: `why${index + 1}Title`, path: ["items", index, "title"], max: 60 },
    { stem: `why${index + 1}Body`, path: ["items", index, "body"], max: 200 },
  ]).flat(),
  { stem: "quote", path: ["quote"], max: 280 },
  { stem: "quoteBy", path: ["quoteBy"], max: 80 },
];

/** The photo strip: its heading. The pictures are chosen one at a time, by their own forms. */
export const STRIP_BOXES: readonly HomeTextBox[] = [{ stem: "stripTitle", path: ["title"], max: 80 }];

/** The boxes that are not pairs, by the name the form posts. */
export const STEPS_PAGE_FIELD = "stepsPageId";
export const FOUNDED_ON_FIELD = "foundedOn";
export const ACTIVE_RUNNERS_FIELD = "activeRunners";

/** Every pair of the four sections: the translate allowlist and its test read these. */
export const HOME_SECTION_BOXES: readonly HomeTextBox[] = [...STEPS_BOXES, ...WHY_BOXES, ...STRIP_BOXES];

/** A posted form, read by name: `undefined` for a box the form did not carry. */
export type PostedField = (name: string) => unknown;

export type SectionRead<T> = { ok: true; value: T } | { ok: false; field: string };

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** A value with every box's pair set at its path, over `base` (the fields that are not pairs). */
function withPairs(boxes: readonly HomeTextBox[], read: PostedField, base: Record<string, unknown>): Record<string, unknown> {
  const value: Record<string, unknown> = { ...base };
  for (const box of boxes) {
    let node: Record<string | number, unknown> = value;
    box.path.forEach((segment, index) => {
      if (index === box.path.length - 1) {
        node[segment] = { ro: text(read(`${box.stem}Ro`)), en: text(read(`${box.stem}En`)) };
        return;
      }
      const nextIsIndex = typeof box.path[index + 1] === "number";
      node[segment] ??= nextIsIndex ? [] : {};
      node = node[segment] as Record<string | number, unknown>;
    });
  }
  return value;
}

/** The box a refusal names: the pair whose path the issue sits under, on the side it names; else the plain field. */
function fieldOf(issue: z.core.$ZodIssue, boxes: readonly HomeTextBox[], plain: Readonly<Record<string, string>>, fallback: string): string {
  const path = issue.path;
  const box = boxes.find((candidate) => candidate.path.every((segment, index) => path[index] === segment));
  if (box) return `${box.stem}${path[box.path.length] === "en" ? "En" : "Ro"}`;
  const first = path[0];
  return typeof first === "string" && plain[first] ? plain[first] : fallback;
}

function readWith<T>(schema: z.ZodType<T>, value: unknown, boxes: readonly HomeTextBox[], plain: Readonly<Record<string, string>>): SectionRead<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const fallback = boxes[0] ? `${boxes[0].stem}Ro` : (Object.values(plain)[0] ?? "page");
  return { ok: false, field: fieldOf(parsed.error.issues[0], boxes, plain, fallback) };
}

/** «Prima dată» as posted. The page «Cum funcționează» opens is a club page's id, or none. */
export function postedSteps(read: PostedField): SectionRead<StepsContent> {
  const page = text(read(STEPS_PAGE_FIELD)).trim();
  return readWith(stepsContentSchema, withPairs(STEPS_BOXES, read, { targetPageId: page || null }), STEPS_BOXES, { targetPageId: STEPS_PAGE_FIELD });
}

/** «De ce» and the quote as posted. */
export function postedWhy(read: PostedField): SectionRead<WhyContent> {
  return readWith(whyContentSchema, withPairs(WHY_BOXES, read, {}), WHY_BOXES, {});
}

/** The strip's heading as posted, over the pictures it holds (those change by their own forms). */
export function postedStripTitle(read: PostedField, before: StripContent): SectionRead<StripContent> {
  const title = readWith(stripContentSchema, withPairs(STRIP_BOXES, read, {}), STRIP_BOXES, {});
  return title.ok ? { ok: true, value: { ...before, title: title.value.title } } : title;
}

/** The numbers as posted: the founding day (`YYYY-MM-DD`, a date box) and the runners, a whole number; empty is none. */
export function postedNumbers(read: PostedField): SectionRead<NumbersContent> {
  const founded = text(read(FOUNDED_ON_FIELD)).trim();
  const runners = text(read(ACTIVE_RUNNERS_FIELD)).trim();
  return readWith(
    numbersContentSchema,
    { foundedOn: founded || null, activeRunners: runners ? Number(runners) : null },
    [],
    { foundedOn: FOUNDED_ON_FIELD, activeRunners: ACTIVE_RUNNERS_FIELD },
  );
}
