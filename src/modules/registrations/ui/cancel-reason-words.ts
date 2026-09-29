import { getTranslations } from "next-intl/server";
import { CANCEL_REASON_KINDS, type CancelReasonProblem } from "@/modules/registrations/domain/cancel-reason";

/**
 * The words of the cancel's reason (§NNN), worded on the server in the page's language for the
 * `CancelReasonFields` island — plain strings only, since a Server Component hands a client one no
 * function or element (§370). One place for the three doors: the manage page, «Înscrierile mele» and
 * the family wizard.
 */
export async function cancelReasonWords() {
  const t = await getTranslations("Registrations");
  return {
    fields: {
      label: t("cancelReason.label"),
      choose: t("cancelReason.choose"),
      options: CANCEL_REASON_KINDS.map((kind) => ({ value: kind, label: t(`cancelReason.kinds.${kind}`) })),
      textLabel: t("cancelReason.textLabel"),
      textHelp: t("cancelReason.textHelp"),
    },
    problemText: {
      kind: t("cancelReason.problem.kind"),
      text: t("cancelReason.problem.text"),
      long: t("cancelReason.problem.long"),
    } satisfies Record<CancelReasonProblem, string>,
  };
}
