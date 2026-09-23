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
  if (!result.ok) redirect(`${path}?invalid=1`);
  /*
    The link was good and the registration is still unconfirmed: the event was cancelled or is
    over, so `confirmEmail` allocated nothing and sent nothing (§NNN). "Confirmed — now sign the
    declaration" would be a promise about a race that will not run; the page says so instead.
  */
  redirect(result.registration.status === "PENDING_EMAIL_CONFIRMATION" ? `${path}?eventOff=1` : `${path}?done=1`);
}
