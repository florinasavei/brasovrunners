"use server";

import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { consumeAndSignDeclaration } from "@/modules/registrations/token-actions";
import { isDomainError } from "@/shared/errors/domain-error";

export async function signDeclarationAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const path = getPathname({ locale, href: { pathname: "/registrations/declare/[token]", params: { token } } });

  try {
    const result = await consumeAndSignDeclaration(
      token,
      { accepted: form.get("accepted") === "on", typedName: String(form.get("typedName") ?? "") },
      new Date(),
    );

    if (!result.ok) redirect(`${path}?invalid=1`);
    redirect(`${path}?done=${result.registration.status === "WAITLISTED" ? "waitlisted" : "confirmed"}`);
  } catch (error) {
    // The checkbox is HTML-required, so this is only a client that bypassed it — treated the
    // same as an invalid token rather than as a server error, since nothing was consumed (the
    // whole transaction, including the token spend, rolled back with the validation failure).
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") redirect(`${path}?invalid=1`);
    throw error;
  }
}
