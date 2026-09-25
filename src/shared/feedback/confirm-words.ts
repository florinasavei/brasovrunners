import { getLocale, getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";

/**
 * The words every confirmation dialog shares, translated once on the server (§NNN): the cancel
 * button, and the email sentences the owner asked for — "I need to know each time a participant
 * will be emailed!" — each counted with `countForm` from a number the page read with the same
 * query the send uses, never guessed on the client.
 *
 * `email(n)`: "Se va trimite un email către {n} participanți" — for a verb that writes to the
 * people registered. `queue(n)`: "Se trimit acum {n} emailuri din coadă" — for the outbox's
 * "Trimite acum", which sends messages, not participants. `each`: for the bulk cancel, whose
 * count is the ticks in the browser and is therefore not a number the server can state.
 */
export async function confirmWords() {
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  return {
    cancel: t("confirm.cancel"),
    email: (count: number) => t(`confirm.email.${countForm(count, locale)}`, { count }),
    queue: (count: number) => t(`confirm.emailMessages.${countForm(count, locale)}`, { count }),
    each: t("confirm.emailEach"),
  };
}

export type ConfirmWords = Awaited<ReturnType<typeof confirmWords>>;
