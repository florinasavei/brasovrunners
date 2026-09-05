"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { resendRegistrationMessage } from "@/modules/registrations/admin-service";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

export async function resendRegistrationEmailAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const registrationId = String(form.get("registrationId") ?? "");
  const path = getPathname({
    locale,
    href: { pathname: "/admin/registrations/[id]", params: { id: registrationId } },
  });

  let outcome: "sent" | { error: string };
  try {
    const actor = await requireStaff();
    await resendRegistrationMessage(getDb(), actor, registrationId, new Date());
    outcome = "sent";
  } catch (error) {
    if (isDomainError(error)) {
      outcome = { error: error.code };
    } else {
      throw error;
    }
  }

  // `#admin-alert`, like every other backoffice redirect: land on the outcome.
  redirect(
    outcome === "sent"
      ? `${path}?resent=1#admin-alert`
      : `${path}?error=${outcome.error}#admin-alert`,
  );
}
