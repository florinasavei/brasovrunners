import { constraintsOf, type HtmlConstraints } from "@/shared/forms/constraints";
import { pageTranslationSchema } from "./fields";

/**
 * The page editor's HTML constraints, read off `fields.ts`, so the browser refuses first (§315).
 * Its one box outside the languages, «Ordinea în meniu», went with §NNN.
 */
export function pageTranslationConstraints(field: keyof typeof pageTranslationSchema.shape): HtmlConstraints {
  return constraintsOf(pageTranslationSchema, field);
}
