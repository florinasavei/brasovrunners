"use server";

import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { NO_WAITLIST, waitlistRefusalOf } from "@/modules/registrations/domain/waitlist";
import { consumeAndConfirmEmail } from "@/modules/registrations/token-actions";

export async function confirmEmailAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const path = getPathname({ locale, href: { pathname: "/registrations/confirm/[token]", params: { token } } });

  let result: Awaited<ReturnType<typeof consumeAndConfirmEmail>>;
  try {
    result = await consumeAndConfirmEmail(token, new Date());
  } catch (error) {
    /*
      No place, and the waiting list full (§NNN): the allocator refused, and the refusal took the
      whole transaction back with it — the token spend included — so nothing was confirmed,
      nothing held and nothing sent, and the same link can be opened again. The page says so,
      and says which of the two sentences: a full line, or an event with no line at all.
    */
    const refusal = waitlistRefusalOf(error);
    if (refusal) redirect(`${path}?full=${refusal === NO_WAITLIST ? "closed" : "1"}`);
    throw error;
  }
  if (!result.ok) redirect(`${path}?invalid=1`);
  /*
    The link was good and the registration is still unconfirmed: the event was cancelled or is
    over, so `confirmEmail` allocated nothing and sent nothing (§331). "Confirmed — now sign the
    declaration" would be a promise about a race that will not run; the page says so instead.
  */
  redirect(result.registration.status === "PENDING_EMAIL_CONFIRMATION" ? `${path}?eventOff=1` : `${path}?done=1`);
}
