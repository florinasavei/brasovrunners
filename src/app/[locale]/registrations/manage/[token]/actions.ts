"use server";

import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { checkInSelf, consumeAndCancel } from "@/modules/registrations/token-actions";
import { isDomainError } from "@/shared/errors/domain-error";

export async function cancelRegistrationAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const path = getPathname({ locale, href: { pathname: "/registrations/manage/[token]", params: { token } } });

  try {
    const result = await consumeAndCancel(token, new Date());
    redirect(result.ok ? `${path}?done=1` : `${path}?invalid=1`);
  } catch (error) {
    // "This event has already started" (§10.5 rule 9) — the only VALIDATION_ERROR unregister
    // can raise. Shown as a fixed fact, not folded into the generic invalid-token message.
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") redirect(`${path}?started=1`);
    throw error;
  }
}

/**
 * "I have arrived" from the participant's own link (BR-REQ-037-08). The token is read, not
 * spent — the same page must still be able to cancel — and the outcome comes back as a query
 * flag the page turns into a sentence.
 */
export async function selfCheckInAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const path = getPathname({ locale, href: { pathname: "/registrations/manage/[token]", params: { token } } });

  try {
    const result = await checkInSelf(token, new Date());
    redirect(result.ok ? `${path}?here=1` : `${path}?invalid=1`);
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?here=0`);
    throw error;
  }
}
