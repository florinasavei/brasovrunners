import type { RegistrationStatus } from "@/db/schema/registrations";
import type { EmailLocale } from "@/infrastructure/email/adapter";

/**
 * `{currentStatus}` in words, never the raw enum (§373, email follow-up review): the send path
 * used to write `registration.status` straight into the field, so a runner read "Starea
 * înscrierii tale: CONFIRMED" while the preview and the legend, reading `EMAIL_SAMPLE`, showed
 * "confirmată". One table, read by both — `render.ts` for the real send and
 * `domain/email-sample.ts` for the sample the previews and the guard share — so the words the
 * platform sends are exactly the words the club is shown.
 */
const WORDS: Record<EmailLocale, Record<RegistrationStatus, string>> = {
  ro: {
    PENDING_EMAIL_CONFIRMATION: "așteaptă confirmarea emailului",
    PENDING_DECLARATION: "așteaptă declarația",
    WAITLISTED: "pe lista de așteptare",
    WAITLIST_OFFERED: "loc oferit — semnează declarația",
    CONFIRMED: "confirmată",
    CANCELLED: "anulată",
    EXPIRED: "expirată",
  },
  en: {
    PENDING_EMAIL_CONFIRMATION: "waiting for the email to be confirmed",
    PENDING_DECLARATION: "waiting for the declaration",
    WAITLISTED: "on the waiting list",
    WAITLIST_OFFERED: "offered a place — sign the declaration",
    CONFIRMED: "confirmed",
    CANCELLED: "cancelled",
    EXPIRED: "expired",
  },
};

/** A registration's status in the reader's own words, in this half's language. */
export function registrationStatusWords(status: RegistrationStatus, locale: EmailLocale): string {
  return WORDS[locale][status];
}
