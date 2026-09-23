import { constraintsOf, type HtmlConstraints } from "@/shared/forms/constraints";
import { pageFieldsSchema, pageTranslationSchema } from "./fields";

/**
 * The HTML constraints of the page editor's boxes, read off `fields.ts` (`DECISIONS.md` §315):
 * the title and the address required, the address's shape as a pattern, every ceiling, and
 * the navigation order's bounds — so the browser refuses first what `savePage` would.
 */
export function pageTranslationConstraints(field: keyof typeof pageTranslationSchema.shape): HtmlConstraints {
  return constraintsOf(pageTranslationSchema, field);
}

export function pageInputConstraints(field: Exclude<keyof typeof pageFieldsSchema.shape, "translations">): HtmlConstraints {
  return constraintsOf(pageFieldsSchema, field);
}
