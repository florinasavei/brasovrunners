import { constraintsOf, type HtmlConstraints } from "@/shared/forms/constraints";
import { pageFieldsSchema, pageTranslationSchema } from "./fields";

/** The page editor's HTML constraints, read off `fields.ts`, so the browser refuses first (§315). */
export function pageTranslationConstraints(field: keyof typeof pageTranslationSchema.shape): HtmlConstraints {
  return constraintsOf(pageTranslationSchema, field);
}

export function pageInputConstraints(field: Exclude<keyof typeof pageFieldsSchema.shape, "translations">): HtmlConstraints {
  return constraintsOf(pageFieldsSchema, field);
}
