import { constraintsOf, type HtmlConstraints } from "@/shared/forms/constraints";
import { eventFieldsSchema, translationFieldsSchema } from "./fields";

/**
 * The HTML constraints of every box on the event form, read off `fields.ts`, so the browser's
 * rule and the server's are the same rule (§315). Checked by
 * `tests/unit/shared/form-constraints.test.ts`.
 */

export type EventFieldName = keyof typeof eventFieldsSchema.shape;
export type TranslationFieldName = keyof typeof translationFieldsSchema.shape;

export function eventInputConstraints(field: EventFieldName): HtmlConstraints {
  return constraintsOf(eventFieldsSchema, field);
}

export function translationInputConstraints(field: TranslationFieldName): HtmlConstraints {
  return constraintsOf(translationFieldsSchema, field);
}
