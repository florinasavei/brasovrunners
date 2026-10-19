"use server";

import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { canonicalLookupOf, eraseRsvpsOfPerson, eraseVolunteerInvitationsOfPerson, openPersonLookup, sealPersonLookup } from "@/modules/registrations/person-data";
import { getDb } from "@/db/client";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * The lookup's form (§322): the address arrives in the body of a POST, is canonicalized here, and
 * leaves only sealed — the page's URL carries ciphertext, never the address (`person-data.ts`).
 * `requireStaffCapability(canManageRegistrations)` first, so an Organizer's replayed POST learns nothing; the page and
 * the service assert the same role again.
 */
export async function lookUpPersonAction(form: FormData): Promise<void> {
  const locale: Locale = form.get("uiLocale") === "en" ? "en" : "ro";
  const path = getPathname({ locale, href: "/admin/registrations/person" });
  const typed = typeof form.get("email") === "string" ? String(form.get("email")) : "";

  let sealed: string | null = null;
  try {
    await requireStaffCapability(canManageRegistrations);
    sealed = sealPersonLookup(canonicalLookupOf(typed), new Date());
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?error=${error.code}#admin-alert`);
    throw error;
  }
  redirect(sealed ? `${path}?q=${encodeURIComponent(sealed)}` : `${path}?error=VALIDATION_ERROR#admin-alert`);
}

/**
 * «Șterge răspunsurile „Vin!”» (§811, art. 17 GDPR): the answers and the remembered browsers of the address the page was opened for.
 * The address comes back through the same sealed lookup the page was opened with — never typed again, never in the URL in the clear —
 * and goes no further than the Administrator who pressed (`requireStaffCapability`, asserted again in the service).
 */
export async function eraseRsvpsAction(form: FormData): Promise<void> {
  const locale: Locale = form.get("uiLocale") === "en" ? "en" : "ro";
  const path = getPathname({ locale, href: "/admin/registrations/person" });
  const sealed = typeof form.get("q") === "string" ? String(form.get("q")) : "";
  let erased = false;
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    const now = new Date();
    const canonicalEmail = openPersonLookup(sealed, now);
    if (!canonicalEmail) redirect(path);
    await eraseRsvpsOfPerson(getDb(), actor, canonicalEmail, now);
    erased = true;
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?error=${error.code}#admin-alert`);
    throw error;
  }
  redirect(`${path}?q=${encodeURIComponent(sealed)}${erased ? "&erased=1" : ""}`);
}

/**
 * «Șterge invitațiile de voluntariat» (§NNN, art. 17 GDPR): the club's invitations to volunteer sent to the address the page was opened
 * for — an address and the club's line, which an unused or withdrawn invitation keeps until retention reaches it. The address comes back
 * through the same sealed lookup, never typed again, and goes no further than the Administrator who pressed (asserted again in the service).
 */
export async function eraseVolunteerInvitationsAction(form: FormData): Promise<void> {
  const locale: Locale = form.get("uiLocale") === "en" ? "en" : "ro";
  const path = getPathname({ locale, href: "/admin/registrations/person" });
  const sealed = typeof form.get("q") === "string" ? String(form.get("q")) : "";
  let erased = false;
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    const now = new Date();
    const canonicalEmail = openPersonLookup(sealed, now);
    if (!canonicalEmail) redirect(path);
    await eraseVolunteerInvitationsOfPerson(getDb(), actor, canonicalEmail, now);
    erased = true;
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?error=${error.code}#admin-alert`);
    throw error;
  }
  redirect(`${path}?q=${encodeURIComponent(sealed)}${erased ? "&erased=invitations" : ""}`);
}
