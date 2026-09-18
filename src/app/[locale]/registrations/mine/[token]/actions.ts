"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  checkInSelfFromMyRegistrations,
  consumeAndCancelFromMyRegistrations,
} from "@/modules/registrations/my-registrations";
import { isDomainError } from "@/shared/errors/domain-error";

function pagePath(locale: Locale, token: string): string {
  return getPathname({ locale, href: { pathname: "/registrations/mine/[token]", params: { token } } });
}

/** Cancel one registration from the list. Consumes the link; the page then says so. */
export async function cancelFromMyRegistrationsAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const registrationId = String(form.get("registrationId") ?? "");
  const path = pagePath(locale, token);

  try {
    const result = await consumeAndCancelFromMyRegistrations(getDb(), token, registrationId, new Date());
    redirect(result.ok ? `${path}?done=1` : `${path}?invalid=1`);
  } catch (error) {
    // "This event has already started" — the one VALIDATION_ERROR unregister raises.
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") redirect(`${path}?started=1`);
    if (isDomainError(error)) redirect(`${path}?invalid=1`);
    throw error;
  }
}

/** "I am here" for one registration. The link stays valid. */
export async function selfCheckInFromMyRegistrationsAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const registrationId = String(form.get("registrationId") ?? "");
  const path = pagePath(locale, token);

  try {
    const result = await checkInSelfFromMyRegistrations(getDb(), token, registrationId, locale, new Date());
    redirect(result.ok ? `${path}?here=${registrationId}` : `${path}?invalid=1`);
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?hereFailed=${registrationId}`);
    throw error;
  }
}
