import { constraintsOf, type HtmlConstraints } from "@/shared/forms/constraints";
import { albumFieldsSchema, albumTranslationSchema } from "./fields";

/**
 * The HTML constraints of an album's boxes, read off `fields.ts` (`DECISIONS.md` §306): the
 * date, the title and the address required, the address's shape, every ceiling.
 */
export function albumTranslationConstraints(field: keyof typeof albumTranslationSchema.shape): HtmlConstraints {
  return constraintsOf(albumTranslationSchema, field);
}

export function albumInputConstraints(field: Exclude<keyof typeof albumFieldsSchema.shape, "translations">): HtmlConstraints {
  return constraintsOf(albumFieldsSchema, field);
}
