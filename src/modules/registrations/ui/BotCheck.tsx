import { getTranslations } from "next-intl/server";
import TurnstileWidget, { type BotCheckWords } from "./TurnstileWidget";

/**
 * The anti-bot check as a form places it (§97, §185): Cloudflare's widget with the line under it
 * that says, in the reader's language, what the check is doing and what to do about it (§NNN).
 *
 * A Server Component around the client island so the words stay in the catalogue on the server
 * and cross the boundary as strings — the island carries no messages of its own. Every form that
 * runs the check places this one: the registration form, the contact form, the newsletter box
 * and the group-run declaration, so a stuck check reads and recovers the same everywhere.
 */
export default async function BotCheck({ siteKey, locale, attempt }: { siteKey: string; locale: string; attempt: string }) {
  const t = await getTranslations({ locale, namespace: "BotCheck" });
  const words: BotCheckWords = {
    loading: t("loading"),
    checking: t("checking"),
    interactive: t("interactive"),
    passed: t("passed"),
    expired: t("expired"),
    timeout: t("timeout"),
    error: t("error"),
    unsupported: t("unsupported"),
    blocked: t("blocked"),
    slow: t("slow"),
    retry: t("retry"),
  };
  return <TurnstileWidget siteKey={siteKey} locale={locale} attempt={attempt} words={words} />;
}
