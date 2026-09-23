import { getTranslations } from "next-intl/server";
import type { RefusalMessages } from "@/shared/forms/ActionForm";

/**
 * The words a backoffice form's refusal summary needs, translated once on the server and
 * handed to the `ActionForm` island as strings (`AGENTS.md` §14.5: the catalogue stays on the
 * server; `DECISIONS.md` §305).
 *
 * `fields` is the page's own map from a box's `name` to its label — the summary links each
 * named field to its box under that label (§47). The error messages are the whole of
 * `Admin.errors`, so a code the action returns tomorrow is already a sentence.
 */
export async function refusalMessages(fields: Readonly<Record<string, string>> = {}): Promise<RefusalMessages> {
  const t = await getTranslations("Admin");
  return {
    errors: t.raw("errors") as Record<string, string>,
    fields,
    fieldsIntro: t("forms.fieldsIntro"),
    fieldError: t("forms.fieldError"),
    kept: t("forms.kept"),
  };
}
