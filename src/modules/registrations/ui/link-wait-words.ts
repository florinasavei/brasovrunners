import { getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";

/**
 * Two sentences about an email that is on its way or already sent (§NNN), worded on the server in
 * the page's language. Words rather than components: each page draws its own MUI `Alert` with them
 * (no wrappers around MUI, AGENTS.md §1.3), and a plain string renders the same in every test.
 */

/**
 * "Can't find it? Look in Spam and Promotions and move us to your inbox…" — the one
 * visible box on every page that tells somebody to wait for an email from us: the screen after the
 * registration form, the two "send me the link again" forms once sent, the newsletter's. A box
 * rather than a grey line, because the person who needs it is the one whose email went to Spam or
 * Promotions — and that person never reads a hint printed inside the email itself. "Move us to your
 * inbox" is the part that saves the next message too: the declaration, the offer, the QR.
 */
export async function spamHintWords(): Promise<string> {
  const t = await getTranslations("Registrations");
  return t("spamHint.body");
}

/**
 * "This link has been replaced: we sent you a newer email with a working link (sent …). Open the
 * latest…" — what a link a newer link of the same purpose superseded says, in place of the generic
 * "no longer valid" (§NNN; `domain/link-status.ts` argues why it may). The sentence names Spam and
 * Promotions itself, so no second box goes under it. The time is the replacing email's, on Romania's
 * clock — a platform instant (`i18n/dates.ts`) — inside the sentence: «(trimis marți, 29 sept.
 * 2026, la 10:00)». Two keys rather than an ICU select, the second only when the time was read.
 */
export async function replacedLinkWords(locale: Locale, issuedAt: Date | null): Promise<string> {
  const t = await getTranslations("Registrations");
  return issuedAt
    ? t("replacedAt", { issuedAt: formatDay(issuedAt, { locale, timeZone: CLUB_TIME_ZONE, withTime: true, position: "inline" }) })
    : t("replaced");
}
