"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requestMyRegistrationsLink } from "@/modules/registrations/my-registrations";

/**
 * One outcome, always: "if that address has registrations, we have sent the link" — whether
 * the address is known, unknown, malformed or throttled (BR-REQ-036-04; the oracle rule of
 * `registrations/resend`).
 */
export async function requestMyRegistrationsLinkAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const email = String(form.get("email") ?? "");

  await requestMyRegistrationsLink(getDb(), { email, locale }, new Date());

  redirect(`${getPathname({ locale, href: "/registrations/mine" })}?sent=1`);
}
