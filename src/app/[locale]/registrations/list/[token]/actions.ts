"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { consumeAndSetListConsent } from "@/modules/registrations/list-consent";
import { isDomainError } from "@/shared/errors/domain-error";

function pagePath(locale: Locale, token: string): string {
  return getPathname({ locale, href: { pathname: "/registrations/list/[token]", params: { token } } });
}

/**
 * Set the participant's answer to the public list from their own link (BR-REQ-039-01; §143).
 *
 * Spends the link (§12.8: an action link is used once) and lands on the same page under the
 * fresh link the service minted, so the person sees the new state and the way back. `listed`
 * is the answer the button carried — the page rendered the opposite of the row — so a double
 * submission lands on the state the person pressed for rather than flipping twice.
 */
export async function setListConsentAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const listed = form.get("listed") === "1";

  try {
    const result = await consumeAndSetListConsent(getDb(), token, listed, new Date());
    redirect(result.ok ? `${pagePath(locale, result.nextSecret)}?changed=1` : `${pagePath(locale, token)}?invalid=1`);
  } catch (error) {
    // The registration is gone (erased under §67): the token was not spent, and the generic
    // notice is the honest answer.
    if (isDomainError(error)) redirect(`${pagePath(locale, token)}?invalid=1`);
    throw error;
  }
}
