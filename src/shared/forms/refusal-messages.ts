import { getTranslations } from "next-intl/server";
import type { RefusalMessages } from "@/shared/forms/ActionForm";

/**
 * A refusal summary's words, translated on the server for the `ActionForm` island (`AGENTS.md`
 * §14.5, §315). `fields` maps each box's `name` to its label (§47). `confirmation`: the form has
 * a `NEVER_KEPT` box, which comes back empty, so the "still in the boxes" sentence says so.
 */
export async function refusalMessages(
  fields: Readonly<Record<string, string>> = {},
  options: { confirmation?: boolean } = {},
): Promise<RefusalMessages> {
  const t = await getTranslations("Admin");
  return {
    errors: t.raw("errors") as Record<string, string>,
    fields,
    fieldsIntro: t("forms.fieldsIntro"),
    fieldError: t("forms.fieldError"),
    kept: options.confirmation ? t("forms.keptExceptConfirmation") : t("forms.kept"),
    keptConflict: t("forms.keptConflict"),
  };
}
