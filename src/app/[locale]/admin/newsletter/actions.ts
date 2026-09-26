"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { type NewsletterPreview, previewNewsletter } from "@/modules/newsletter/preview";
import { sendNewsletter, withdrawNewsletterAddress } from "@/modules/newsletter/service";
import { requireStaff, requireStaffRole } from "@/modules/staff-identity/session";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/** Which language to land back in: the form carries it, because an action has no request locale. */
function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

/**
 * "Trimite newsletterul" (§NNN): the composer on `/admin/newsletter`, the backoffice's own
 * «Newsletter» entry. The service asserts who may send (`canSendNewsletter`) whatever the page
 * showed, and checks the words again; a refusal comes back as the form's state with every box as
 * typed (§315). The form's own id makes a second press queue nothing, and the page's banner and
 * toast say which it was.
 */
export async function sendNewsletterAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/newsletter" });
  const posted = (name: string) => (typeof form.get(name) === "string" ? String(form.get(name)) : "");
  let outcome: string;
  try {
    const actor = await requireStaff();
    const result = await sendNewsletter(
      getDb(),
      actor,
      {
        topic: posted("topic"),
        subject: { ro: posted("subjectRo"), en: posted("subjectEn") },
        body: { ro: posted("bodyRo"), en: posted("bodyEn") },
        sendId: posted("sendId"),
      },
      new Date(),
    );
    if (result.kind === "nobody") return refused(new DomainError("VALIDATION_ERROR", "nobody is subscribed to this topic yet", ["topic"]), form);
    outcome = result.kind === "queued" ? `saved=newsletterSent&recipients=${result.recipients}` : "saved=newsletterDuplicate";
    await flashOutcome(result.kind === "queued" ? { saved: "newsletterSent", recipients: String(result.recipients) } : { saved: "newsletterDuplicate" });
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath(path);
  redirect(`${path}?${outcome}#admin-alert`);
}

/**
 * The composer's preview (§NNN): the four boxes as they stand, rendered for a subscriber of one
 * language. Asserted on the server like the send; every field read as a bounded string, whatever
 * the network sent. Null for anybody the service refuses — the island says "no preview".
 */
export async function previewNewsletterAction(input: {
  language: unknown;
  subjectRo: unknown;
  subjectEn: unknown;
  bodyRo: unknown;
  bodyEn: unknown;
}): Promise<NewsletterPreview | null> {
  const read = (value: unknown) => (typeof value === "string" ? value.slice(0, 20_000) : "");
  try {
    const actor = await requireStaff();
    return await previewNewsletter(
      getDb(),
      actor,
      {
        locale: input.language === "en" ? "en" : "ro",
        subject: { ro: read(input.subjectRo), en: read(input.subjectEn) },
        body: { ro: read(input.bodyRo), en: read(input.bodyEn) },
      },
      new Date(),
    );
  } catch (error) {
    if (isDomainError(error)) return null;
    throw error;
  }
}

/**
 * Remove one address from the newsletter at the person's written request (§NNN). Administrator
 * only — the service asserts it again — and it says whether the address was there, because the
 * person asking is staff.
 */
export async function withdrawNewsletterAddressAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/newsletter" });
  let removed: boolean;
  try {
    const actor = await requireStaffRole("ADMIN");
    removed = await withdrawNewsletterAddress(getDb(), actor, typeof form.get("email") === "string" ? String(form.get("email")) : "", new Date());
  } catch (error) {
    return refused(error, form);
  }
  const saved = removed ? "newsletterWithdrawn" : "newsletterNotFound";
  revalidatePath(path);
  await flashOutcome({ saved });
  redirect(`${path}?saved=${saved}#admin-alert`);
}
