import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";

/** The label of every box on the page editor, by the `name` it posts, for the refusal summary (§315). */
export async function pageFormFieldLabels(): Promise<Record<string, string>> {
  const t = await getTranslations("Admin.pages");
  const labels: Record<string, string> = {};
  for (const locale of routing.locales) {
    const language = t(`language.${locale}`);
    for (const field of ["title", "slug", "body"] as const) {
      labels[`translations.${locale}.${field}`] = `${language}: ${t(`fields.${field}`)}`;
    }
    // Both or neither (§354): the refusal names the empty side, so the label says what it needs.
    for (const field of ["seoTitle", "seoDescription"] as const) {
      labels[`translations.${locale}.${field}`] = `${language}: ${t(`fields.${field}`)} — ${t("bothOrNeither")}`;
    }
  }
  return labels;
}
