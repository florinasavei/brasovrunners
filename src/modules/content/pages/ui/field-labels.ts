import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";

/** The label of every box on the page editor, by the `name` it posts, for the refusal summary (§315). */
export async function pageFormFieldLabels(): Promise<Record<string, string>> {
  const t = await getTranslations("Admin.pages");
  const labels: Record<string, string> = { navOrder: t("navOrder") };
  for (const locale of routing.locales) {
    const language = t(`language.${locale}`);
    for (const field of ["title", "slug", "body", "seoTitle", "seoDescription"] as const) {
      labels[`translations.${locale}.${field}`] = `${language}: ${t(`fields.${field}`)}`;
    }
  }
  return labels;
}
