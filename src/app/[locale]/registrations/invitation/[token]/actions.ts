"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { clearFormDraft, stashFormDraft } from "@/modules/registrations/form-draft";
import { ERROR_SUMMARY_ID } from "@/modules/registrations/form-errors";
import { readRegistrationForm } from "@/modules/registrations/form-mapping";
import { acceptInvitation } from "@/modules/registrations/invitations";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import { isDomainError } from "@/shared/errors/domain-error";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * The invitation's form sent (§NNN): the token spent and the registration created and seated in the
 * invitation's place, in one transaction (`invitations.ts#acceptInvitation`). Lands on the same page:
 *
 * - `done=1` — the place is the person's and the declaration's email is queued;
 * - `error=<code>&fields=<names>` — the form refused (a field, the terms changed since the page was
 *   read, this runner on the address already), the spend rolled back with it, what was typed kept in
 *   the draft cookie (§142) and the same link still working;
 * - nothing — the link no longer accepts (spent, withdrawn, past its deadline, replaced): the page
 *   reads it again and says which.
 *
 * Markers and field names only, never a value (§14.5). The address is never read from the form: it is
 * the invitation's, as the token names it.
 */
export async function acceptInvitationAction(form: FormData): Promise<void> {
  const locale: Locale = form.get("locale") === "en" ? "en" : "ro";
  const token = text(form, "invitationToken");
  const path = getPathname({ locale, href: { pathname: "/registrations/invitation/[token]", params: { token } } });
  let accepted: Awaited<ReturnType<typeof acceptInvitation>>;
  try {
    accepted = await acceptInvitation(getDb(), token, readRegistrationForm(form, locale), new Date());
  } catch (error) {
    if (isDatabaseAwayError(error)) {
      await stashFormDraft(form, path);
      redirect(`${path}?error=DATABASE_AWAY&fields=databaseAway#${ERROR_SUMMARY_ID}`);
    }
    if (isDomainError(error)) {
      await stashFormDraft(form, path);
      const fields = error.fields.length > 0 ? `&fields=${error.fields.join(",")}` : "";
      redirect(`${path}?error=${error.code}${fields}#${ERROR_SUMMARY_ID}`);
    }
    throw error;
  }
  if (!accepted.ok) redirect(path);
  await clearFormDraft(path);
  redirect(`${path}?done=1`);
}
