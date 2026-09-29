"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { NEWSLETTER_BODY_JSON_MAX } from "@/modules/newsletter/domain/message";
import { parseSubscriberListQuery, subscriberListParams } from "@/modules/newsletter/domain/subscriber-list";
import { type NewsletterPreview, previewNewsletter } from "@/modules/newsletter/preview";
import { sendNewsletter, unsubscribeNewsletterSubscriber, withdrawNewsletterAddress } from "@/modules/newsletter/service";
import { requireStaff, requireStaffCapability } from "@/modules/staff-identity/session";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/** Which language to land back in: the form carries it, because an action has no request locale. */
function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

/**
 * "Trimite newsletterul" (§445): the composer on `/admin/newsletter`, the backoffice's own
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
        // The two rich editors' hidden boxes (§550): each language's document as JSON.
        body: { ro: posted("newsletterBodyRo"), en: posted("newsletterBodyEn") },
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
 * The composer's preview (§445): the four boxes as they stand, rendered for a subscriber of one
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
  // A body is the editor's document as JSON (§550): its own, larger ceiling; a subject stays short.
  const read = (value: unknown, max = 20_000) => (typeof value === "string" ? value.slice(0, max) : "");
  try {
    const actor = await requireStaff();
    return await previewNewsletter(
      getDb(),
      actor,
      {
        locale: input.language === "en" ? "en" : "ro",
        subject: { ro: read(input.subjectRo), en: read(input.subjectEn) },
        body: { ro: read(input.bodyRo, NEWSLETTER_BODY_JSON_MAX), en: read(input.bodyEn, NEWSLETTER_BODY_JSON_MAX) },
      },
      new Date(),
    );
  } catch (error) {
    if (isDomainError(error)) return null;
    throw error;
  }
}

/**
 * Remove one address from the newsletter at the person's written request (§445). Administrator
 * only — the service asserts it again — and it says whether the address was there, because the
 * person asking is staff.
 */
export async function withdrawNewsletterAddressAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/newsletter" });
  let removed: boolean;
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    removed = await withdrawNewsletterAddress(getDb(), actor, typeof form.get("email") === "string" ? String(form.get("email")) : "", new Date());
  } catch (error) {
    return refused(error, form);
  }
  const saved = removed ? "newsletterWithdrawn" : "newsletterNotFound";
  revalidatePath(path);
  await flashOutcome({ saved });
  redirect(`${path}?saved=${saved}#admin-alert`);
}

/**
 * «Dezabonează» on a row of the «Abonați» list (§550, amending §445). Administrator and
 * Superadministrator only — asserted at the door (`requireStaffCapability`) and again by the
 * service — after the one ConfirmDialog that names the address. Lands back on the list as it was
 * filtered (the form carries the list's own parameters, re-read through the parser, never passed
 * through as typed) and says what happened in the toast: removed, or already gone.
 */
export async function unsubscribeSubscriberAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/newsletter" });
  const posted = (name: string) => (typeof form.get(name) === "string" ? String(form.get(name)) : "");
  let removed: boolean;
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    removed = await unsubscribeNewsletterSubscriber(getDb(), actor, posted("subscriberId"), new Date());
  } catch (error) {
    return refused(error, form);
  }
  const saved = removed ? "newsletterUnsubscribed" : "newsletterUnsubscribedGone";
  const list = subscriberListParams(parseSubscriberListQuery({ q: posted("listQ"), topic: posted("listTopic"), state: posted("listState") }));
  list.set("saved", saved);
  revalidatePath(path);
  await flashOutcome({ saved });
  redirect(`${path}?${list.toString()}#newsletter-subscribers`);
}
