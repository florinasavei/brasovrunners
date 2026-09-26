"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { isSelfServiceField, withdrawFromManageLink } from "@/modules/registrations/consent-withdrawal";
import { setListConsentFromManageLink } from "@/modules/registrations/list-consent";
import { checkInSelf, consumeAndCancel } from "@/modules/registrations/token-actions";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashPublic } from "@/shared/feedback/flash";

export async function cancelRegistrationAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const path = getPathname({ locale, href: { pathname: "/registrations/manage/[token]", params: { token } } });

  try {
    const result = await consumeAndCancel(token, new Date());
    // The toast on the page it lands on (§427); a refused link says so on the page, never in a toast.
    if (result.ok) await flashPublic("unregistered");
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

/**
 * The public participant list, from the participant's own link (BR-REQ-039-01; `DECISIONS.md`
 * §143). Read, not spent, for the same reason as "I am here": the page must still be able to
 * cancel, and the choice is reversible. `listed` is the answer the button carried, so a double
 * submission lands on the state the person pressed for.
 */
export async function setListConsentFromManageAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const listed = form.get("listed") === "1";
  const path = getPathname({ locale, href: { pathname: "/registrations/manage/[token]", params: { token } } });

  try {
    const result = await setListConsentFromManageLink(getDb(), token, listed, new Date());
    redirect(result.ok ? `${path}?list=1#list` : `${path}?invalid=1`);
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?list=0#list`);
    throw error;
  }
}

/**
 * "Delete my health note" / "Delete my Strava and Instagram" from the participant's own link
 * (§322). Read, not spent, as the public-list switch above: the page must still be able to
 * cancel. The field group is the only thing taken from the form, and only one of two words.
 */
export async function withdrawFromManageAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const field = form.get("field");
  const path = getPathname({ locale, href: { pathname: "/registrations/manage/[token]", params: { token } } });
  if (!isSelfServiceField(field)) redirect(`${path}?withdrawn=0#consent`);

  try {
    const result = await withdrawFromManageLink(getDb(), token, field, new Date());
    redirect(result.ok ? `${path}?withdrawn=${field}#consent` : `${path}?invalid=1`);
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?withdrawn=0#consent`);
    throw error;
  }
}
