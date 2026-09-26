import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { readEmailCopyForSending } from "@/modules/notifications/email-copy";
import { renderBilingual, type TemplateData } from "@/modules/notifications/templates";
import { canSendNewsletter } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { NEWSLETTER_BODY_MAX, NEWSLETTER_SUBJECT_MAX } from "./domain/message";

export type NewsletterPreview = { subject: string; html: string };

/**
 * The newsletter as a subscriber in `locale` would receive it, from the composer's boxes as they
 * stand (§NNN) — the same template the outbox sends with (`renderBilingual`), the club's own
 * wording applied, over the made-up subscriber every `/admin/emails` preview is addressed to
 * (`emailSampleFor`, only the fields a newsletter carries: her topics, and a manage link with `EXAMPLE` where the token would be).
 * Nothing is queued and no token exists, so nothing in it can be acted on. Asserted on the server
 * like the send (`canSendNewsletter`, BR-REQ-060-01). An empty box previews as the platform's
 * fallback subject and an absent body — which is what the send would refuse.
 */
export async function previewNewsletter<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: { locale: Locale; subject: { ro: string; en: string }; body: { ro: string; en: string } },
  now: Date,
): Promise<NewsletterPreview> {
  if (!canSendNewsletter(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not write the newsletter`);
  const locale = input.locale;
  const other: Locale = locale === "ro" ? "en" : "ro";
  const line = (value: string) => value.replace(/\s*[\r\n]+\s*/g, " ").trim().slice(0, NEWSLETTER_SUBJECT_MAX);
  const text = (value: string) => value.replace(/\r\n?/g, "\n").trim().slice(0, NEWSLETTER_BODY_MAX);
  const sample = emailSampleFor("NEWSLETTER", locale);
  const data: TemplateData = {
    ...sample,
    participantName: "",
    newsletterSubject: line(input.subject[locale]) || undefined,
    newsletterSubjectOther: line(input.subject[other]) || undefined,
    newsletterBody: text(input.body[locale]) || undefined,
    newsletterBodyOther: text(input.body[other]) || undefined,
  };
  const email = renderBilingual("NEWSLETTER", locale, data, undefined, await readEmailCopyForSending(db, now));
  return { subject: email.subject, html: email.html };
}
