"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { confirmNewsletter } from "@/modules/newsletter/service";

/**
 * The newsletter's confirmation (§NNN): spends the link (single use, AGENTS.md §12.8) and turns the
 * subscription on. Lands on the same page saying so, or saying the link was not live — never
 * another page, so a second press of a button already pressed reads as what it is.
 */
export async function confirmNewsletterAction(form: FormData): Promise<void> {
  const locale: Locale = form.get("locale") === "en" ? "en" : "ro";
  const token = String(form.get("token") ?? "");
  const path = getPathname({ locale, href: { pathname: "/newsletter/confirm/[token]", params: { token } } });
  const confirmed = await confirmNewsletter(getDb(), token, new Date());
  redirect(`${path}?${confirmed ? "done" : "invalid"}=1`);
}
