import { getTranslations } from "next-intl/server";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { readJobCadence } from "@/modules/jobs/cadence";
import { pingerCadenceMinutes } from "@/modules/jobs/quiet-hours";
import { readDeliveryTiming } from "./delivery-timing";
import { emailWaitMinutes } from "./domain/email-wait";
import { DELIVERY_CHOICE_FIELD, type SendNowWords } from "./domain/send-at-once";

/**
 * A resend's two answers (§540), worded on the server for the press's `ConfirmDialog`: «Trimite acum,
 * fără să aștepte trecerea programată», the primary one, and «Pune la coadă pentru trecerea
 * programată», the quiet one — with one sentence for the body naming the scheduled pass's wait now.
 *
 * Offered only under the scheduled timing (§513). Under «imediat» every email already leaves after
 * the request, so there is nothing to choose: `null`, and the press is the one it always was. The
 * form carries the hidden field (`DELIVERY_CHOICE_FIELD`) only with the choice, set to «now» — the
 * answer a press without JavaScript gets.
 */
export type SendNowChoice = SendNowWords & { field: string; value: "now" };

export async function sendNowChoiceFor<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
  now: Date = new Date(),
): Promise<SendNowChoice | null> {
  const [{ timing }, { minutes: intervalMinutes }] = await Promise.all([readDeliveryTiming(db), readJobCadence(db)]);
  // The pinger and the Administrator's interval (§334); the governor's floor is the queue panel's to say.
  const wait = emailWaitMinutes({ timing, pingerMinutes: pingerCadenceMinutes(now), intervalMinutes, governorFloorMinutes: 0 });
  if (timing !== "scheduled" || wait === null) return null;
  const t = await getTranslations("Admin");
  return {
    choice: {
      field: DELIVERY_CHOICE_FIELD,
      confirmValue: "now",
      alternativeValue: "queue",
      alternativeLabel: t("confirm.sendNowChoice.queue"),
    },
    note: t("confirm.sendNowChoice.note", { wait: minutesPhrase(locale, wait) }),
    confirmLabel: t("confirm.sendNowChoice.now"),
    field: DELIVERY_CHOICE_FIELD,
    value: "now",
  };
}
