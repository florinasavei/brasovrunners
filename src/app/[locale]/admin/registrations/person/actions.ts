"use server";

import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { canonicalLookupOf, sealPersonLookup } from "@/modules/registrations/person-data";
import { requireStaffRole } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * The lookup's form (§NNN): the address arrives in the body of a POST, is canonicalized here, and
 * leaves only sealed — the page's URL carries ciphertext, never the address (`person-data.ts`).
 * `requireStaffRole("ADMIN")` first, so an Organizer's replayed POST learns nothing; the page and
 * the service assert the same role again.
 */
export async function lookUpPersonAction(form: FormData): Promise<void> {
  const locale: Locale = form.get("uiLocale") === "en" ? "en" : "ro";
  const path = getPathname({ locale, href: "/admin/registrations/person" });
  const typed = typeof form.get("email") === "string" ? String(form.get("email")) : "";

  let sealed: string | null = null;
  try {
    await requireStaffRole("ADMIN");
    sealed = sealPersonLookup(canonicalLookupOf(typed), new Date());
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?error=${error.code}#admin-alert`);
    throw error;
  }
  redirect(sealed ? `${path}?q=${encodeURIComponent(sealed)}` : `${path}?error=VALIDATION_ERROR#admin-alert`);
}
