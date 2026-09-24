import { constraintsOf, type HtmlConstraints } from "@/shared/forms/constraints";
import { eventFieldsSchema, translationFieldsSchema } from "./fields";

/**
 * The HTML constraints of every box on the event form, read off `fields.ts` (`DECISIONS.md`
 * §315): one place per module, so the browser's rule and the server's rule are the same rule.
 *
 * The editor's boxes spread `eventInputConstraints("capacity")` into the box's `htmlInput`;
 * `TranslationFields.tsx` does the same with `translationInputConstraints("title")`. A field
 * that is not a box — a checkbox, a rich text, the wall-clock pair — never asks, and a caller
 * that wants `required` alone (the two boxes of a `WallTimeField`) reads it off the result.
 *
 * `tests/unit/shared/form-constraints.test.ts` walks both schemas and asserts every field the
 * schema requires renders `required`, every https rule renders `type="url"`, every bounded
 * number renders `min` and `max`.
 */

export type EventFieldName = keyof typeof eventFieldsSchema.shape;
export type TranslationFieldName = keyof typeof translationFieldsSchema.shape;

export function eventInputConstraints(field: EventFieldName): HtmlConstraints {
  return constraintsOf(eventFieldsSchema, field);
}

export function translationInputConstraints(field: TranslationFieldName): HtmlConstraints {
  return constraintsOf(translationFieldsSchema, field);
}
