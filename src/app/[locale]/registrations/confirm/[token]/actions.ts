"use server";

import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { consumeAndConfirmEmail } from "@/modules/registrations/token-actions";

export async function confirmEmailAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const path = getPathname({ locale, href: { pathname: "/registrations/confirm/[token]", params: { token } } });

  const result = await consumeAndConfirmEmail(token, new Date());
  redirect(result.ok ? `${path}?done=1` : `${path}?invalid=1`);
}
