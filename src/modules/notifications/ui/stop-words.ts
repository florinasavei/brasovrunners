import type { Locale } from "@/i18n/routing";
import { emailLeavesWords } from "@/modules/notifications/domain/email-wait";
import type { MailgunStopKind } from "@/modules/notifications/domain/mailgun-stop";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Until when Mailgun is stopped, in the words of the screen (§NNN): «Mailgun în pauză până la 10:15»
 * today, «… până joi, 2 oct. 2026, la 03:05» another day — the helper's date already carries its
 * «la» (§452), so another day is its own sentence (`…On`), never «la» before a date.
 */
export function stopWords(kind: MailgunStopKind, until: Date, now: Date, locale: Locale, t: Translate): string {
  const words = emailLeavesWords(until, now, locale);
  return words.key === "leavesToday"
    ? t(`emails.queue.stop.${kind}`, { hour: words.at })
    : t(`emails.queue.stop.${kind}On`, { until: words.at });
}

/** When Mailgun's road opens again, after a press it refused (§NNN): «Mailgun reia la 10:15.» */
export function resumesWords(until: Date, now: Date, locale: Locale, t: Translate): string {
  const words = emailLeavesWords(until, now, locale);
  return words.key === "leavesToday" ? t("outbox.stopResumes", { hour: words.at }) : t("outbox.stopResumesOn", { until: words.at });
}
