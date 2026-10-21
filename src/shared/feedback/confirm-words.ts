import { getLocale, getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import { type EmailGroup, type EmailTransport, RECOMMENDED_ROAD } from "@/modules/notifications/domain/email-transport";
import { emailRoadsForThisRequest } from "./email-roads-request";
import type { ConfirmRoad } from "./notice";

/**
 * The words every confirmation dialog shares, translated once on the server (§384): the cancel
 * button, and the email sentences the owner asked for — "I need to know each time a participant
 * will be emailed!" — each counted with `countForm` from a number the page read with the same
 * query the send uses, never guessed on the client.
 *
 * `email(n)`: "Se va trimite un email către {n} participanți" — for a verb that writes to the
 * people registered. `queue(n)`: "Se trimit acum {n} emailuri din coadă" — for the outbox's
 * "Trimite acum", which sends messages, not participants. The bulk cancel's count is the ticks
 * in the browser, so it hands `Admin.confirm.email` raw to the button (`EmailCount`) instead.
 *
 * `road(group)` (§841): which road the announced email takes — the group's setting (§443), read
 * once per request however many dialogs a page words (`email-roads-request.ts`) — the road the platform recommends for the
 * group and why, and whether the reader may switch for this press (both roads configured). The
 * dialog draws it under the email line (`ConfirmDialog`), and the press carries the choice to the
 * action (`email-road.ts`).
 */
export async function confirmWords() {
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const roads = await emailRoadsForThisRequest();
  const names: Record<EmailTransport, string> = { mailgun: t("emails.transport.options.mailgun"), gmail: t("emails.transport.options.gmail") };
  return {
    cancel: t("confirm.cancel"),
    email: (count: number) => t(`confirm.email.${countForm(count, locale)}`, { count }),
    queue: (count: number) => t(`confirm.emailMessages.${countForm(count, locale)}`, { count }),
    road: (group: EmailGroup): ConfirmRoad => ({
      group,
      current: roads.gmail ? roads.groups[group] : "mailgun",
      recommended: RECOMMENDED_ROAD[group],
      switchable: roads.gmail,
      leaves: t.raw("confirm.road.leaves") as string,
      legend: t("confirm.road.legend"),
      recommendedMark: t("confirm.road.recommended"),
      why: t(`confirm.road.why.${group}`),
      names,
    }),
  };
}

export type ConfirmWords = Awaited<ReturnType<typeof confirmWords>>;

