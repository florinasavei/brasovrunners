"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { unsubscribeNewsletter, updateNewsletterTopics } from "@/modules/newsletter/service";
import { isDomainError } from "@/shared/errors/domain-error";

function pagePath(locale: Locale, token: string): string {
  return getPathname({ locale, href: { pathname: "/newsletter/manage/[token]", params: { token } } });
}

/** The topics as ticked (§NNN). The link stays valid; none ticked is refused — that is the other button. */
export async function updateNewsletterTopicsAction(form: FormData): Promise<void> {
  const locale: Locale = form.get("locale") === "en" ? "en" : "ro";
  const token = String(form.get("token") ?? "");
  const path = pagePath(locale, token);
  let updated: boolean;
  try {
    updated = await updateNewsletterTopics(getDb(), token, form.getAll("topics"), new Date());
  } catch (error) {
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") redirect(`${path}?topics=none`);
    throw error;
  }
  redirect(updated ? `${path}?saved=1` : `${path}?invalid=1`);
}

/** "Unsubscribe from everything" (§NNN): the subscription and the address deleted, at once. */
export async function unsubscribeNewsletterAction(form: FormData): Promise<void> {
  const locale: Locale = form.get("locale") === "en" ? "en" : "ro";
  const token = String(form.get("token") ?? "");
  const path = pagePath(locale, token);
  const gone = await unsubscribeNewsletter(getDb(), token, new Date());
  redirect(gone ? `${path}?gone=1` : `${path}?invalid=1`);
}
