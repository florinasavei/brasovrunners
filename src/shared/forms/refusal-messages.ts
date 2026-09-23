import { getTranslations } from "next-intl/server";
import type { RefusalMessages } from "@/shared/forms/ActionForm";

/**
 * The words a backoffice form's refusal summary needs, translated once on the server and
 * handed to the `ActionForm` island as strings (`AGENTS.md` §14.5: the catalogue stays on the
 * server; `DECISIONS.md` §315).
 *
 * `fields` is the page's own map from a box's `name` to its label — the summary links each
 * named field to its box under that label (§47). The error messages are the whole of
 * `Admin.errors`, so a code the action returns tomorrow is already a sentence.
 *
 * `confirmation` is for a form guarded by something typed or ticked on purpose (`NEVER_KEPT`:
 * an erase's title, a legal version's phrase, a registration's name, "I understand"). That box
 * comes back empty by design, so "what you typed is still in the boxes" would be untrue about
 * the one box the reader is looking at; the sentence says the confirmation is asked again.
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
