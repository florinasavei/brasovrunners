"use server";

import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { consumeAndCancel } from "@/modules/registrations/token-actions";
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
