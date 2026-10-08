import { getTranslations } from "next-intl/server";
import TurnstileWidget, { type BotCheckWords } from "./TurnstileWidget";

/**
 * The anti-bot check as a form places it (§97, §185): Cloudflare's widget with the line under it
 * that says, in the reader's language, what the check is doing and what to do about it (§518).
 *
 * A Server Component around the client island so the words stay in the catalogue on the server
 * and cross the boundary as strings — the island carries no messages of its own. Every form that
 * runs the check places this one: the registration form, the contact form, the newsletter box,
 * the group-run declaration and the two link forms (§675), so a stuck check reads and recovers
 * the same everywhere.
 *
 * `heldPress` says whether the form's send button holds a press for the check and sends it by the
 * eight-second valve (`SubmitButton`'s `awaitsBotCheck`) — only the registration form does. There
 * a check that gave up or is slow says «trimitem oricum, iar clubul confirmă» and «pleacă și fără
 * ea în câteva secunde»; on every other form those would be false, and the plain sentences
 * (`BotCheck.plain.*`) say only that the form can be sent anyway, which each of their actions
 * accepts (§216).
 *
 * `notice` adds the sentence that names Cloudflare and what it sees (§323, `Legal.botCheckNotice`)
 * under the check — drawn by the island with the widget, once a person starts on the form, and not
 * before (§593): the registration form, the contact form, the interest box and the two link forms
 * carry it. The form wraps this in a box with `BOT_CHECK_SLOT_SX`, so an unarmed check leaves no
 * gap either.
 */
export default async function BotCheck({
  siteKey,
  locale,
  attempt,
  heldPress = false,
  notice = false,
}: {
  siteKey: string;
  locale: string;
  attempt: string;
  heldPress?: boolean;
  notice?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "BotCheck" });
  const legal = notice ? await getTranslations({ locale, namespace: "Legal" }) : null;
  const words: BotCheckWords = {
    loading: t("loading"),
    checking: t("checking"),
    interactive: t("interactive"),
    passed: t("passed"),
    expired: t("expired"),
    timeout: t("timeout"),
    error: t("error"),
    unsupported: heldPress ? t("unsupported") : t("plain.unsupported"),
    blocked: heldPress ? t("blocked") : t("plain.blocked"),
    slow: heldPress ? t("slow") : t("plain.slow"),
    retry: t("retry"),
    failed: heldPress ? t("failed") : t("plain.failed"),
    ...(legal ? { notice: legal("botCheckNotice") } : {}),
  };
  return <TurnstileWidget siteKey={siteKey} locale={locale} attempt={attempt} words={words} />;
}
