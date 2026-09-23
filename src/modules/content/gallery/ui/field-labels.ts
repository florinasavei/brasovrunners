import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";

/** The label of every box on the album form, by the `name` it posts, for the refusal summary (§315). */
export async function albumFormFieldLabels(): Promise<Record<string, string>> {
  const t = await getTranslations("Admin.gallery");
  const labels: Record<string, string> = { takenOn: t("fields.takenOn"), eventId: t("fields.event") };
  for (const locale of routing.locales) {
    const language = t(`language.${locale}`);
    for (const field of ["title", "slug", "description"] as const) {
      labels[`translations.${locale}.${field}`] = `${language}: ${t(`fields.${field}`)}`;
    }
  }
  return labels;
}
