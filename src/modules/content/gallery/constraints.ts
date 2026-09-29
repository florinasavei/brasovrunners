import { constraintsOf, type HtmlConstraints } from "@/shared/forms/constraints";
import { albumFieldsSchema, albumTranslationSchema } from "./fields";

/** An album's HTML constraints, read off `fields.ts` (§315). */
export function albumTranslationConstraints(field: keyof typeof albumTranslationSchema.shape): HtmlConstraints {
  return constraintsOf(albumTranslationSchema, field);
}

export function albumInputConstraints(field: Exclude<keyof typeof albumFieldsSchema.shape, "translations">): HtmlConstraints {
  return constraintsOf(albumFieldsSchema, field);
}
