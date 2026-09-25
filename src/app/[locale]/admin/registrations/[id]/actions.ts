"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { resendRegistrationMessage } from "@/modules/registrations/admin-service";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import type { FormOutcome } from "@/shared/forms/outcome";

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

export async function resendRegistrationEmailAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const registrationId = String(form.get("registrationId") ?? "");
  // "Trimite reminderul" asks for the reminder by name; anything else is the state's message.
  const wanted = form.get("messageType") === "EVENT_REMINDER" ? ("EVENT_REMINDER" as const) : undefined;
  const path = getPathname({
    locale,
    href: { pathname: "/admin/registrations/[id]", params: { id: registrationId } },
  });

  let outcome: "sent" | { error: string };
  try {
    const actor = await requireStaff();
    await resendRegistrationMessage(getDb(), actor, registrationId, new Date(), wanted);
    outcome = "sent";
  } catch (error) {
    if (isDomainError(error)) {
      outcome = { error: error.code };
    } else {
      throw error;
    }
  }

  // `#admin-alert`, like every other backoffice redirect: land on the outcome — and the toast
  // (§384) says which message went, from the same flag.
  if (outcome === "sent") await flashOutcome({ saved: wanted === "EVENT_REMINDER" ? "reminderSent" : "resent" });
  redirect(
    outcome === "sent"
      ? `${path}?resent=1#admin-alert`
      : `${path}?error=${outcome.error}#admin-alert`,
  );
}
