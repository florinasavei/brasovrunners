"use server";

import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  canonicalLookupOf,
  eraseEventInvitationsOfPerson,
  eraseReserveEntriesOfPerson,
  eraseRsvpsOfPerson,
  eraseVolunteerInvitationsOfPerson,
  openPersonLookup,
  sealPersonLookup,
} from "@/modules/registrations/person-data";
import { getDb } from "@/db/client";
import { type EmailPressHandle, inEmailPress } from "@/modules/notifications/press";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";

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
 * «Șterge invitațiile de voluntariat» (§820, art. 17 GDPR): the club's invitations to volunteer sent to the address the page was opened
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

/**
 * «Șterge de pe lista internă» (§854, §876, art. 17 GDPR): the lines of «Lista internă de așteptare» written down with the address the
 * page was opened for. The address comes back through the same sealed lookup, never typed again, and goes no further than the
 * Administrator who pressed (`requireStaffCapability`, asserted again in the service).
 */
export async function eraseReserveEntriesAction(form: FormData): Promise<void> {
  await erasePersonPart(form, "reserve", eraseReserveEntriesOfPerson);
}

/**
 * «Retrage și șterge invitațiile» (§647, §876, art. 17 GDPR): the personal invitations to an event sent to the address the page was
 * opened for — each open one withdrawn first through «Retrage», its place back through the allocator, then the ended ones deleted; an
 * accepted one stays with its registration. Same sealed lookup, same Administrator, asserted again in the service.
 */
export async function eraseEventInvitationsAction(form: FormData): Promise<void> {
  // An email press (`notifications/press.ts`): a withdrawn invitation's place may go to the next in line, with its email.
  return inEmailPress("registrations.invitationsErase", (press) => erasePersonPart(form, "eventInvitations", eraseEventInvitationsOfPerson, press));
}

/**
 * The two presses above: the role first, the sealed lookup opened, the erase, and back to the page with the result's alert.
 * `press`, for the one that can queue an email: told who pressed once the role is asserted.
 */
async function erasePersonPart(
  form: FormData,
  erased: "reserve" | "eventInvitations",
  erase: (db: ReturnType<typeof getDb>, actor: Awaited<ReturnType<typeof requireStaffCapability>>, canonicalEmail: string, now: Date) => Promise<unknown>,
  press?: EmailPressHandle,
): Promise<void> {
  const locale: Locale = form.get("uiLocale") === "en" ? "en" : "ro";
  const path = getPathname({ locale, href: "/admin/registrations/person" });
  const sealed = typeof form.get("q") === "string" ? String(form.get("q")) : "";
  let done = false;
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    press?.by(actor.id);
    const now = new Date();
    const canonicalEmail = openPersonLookup(sealed, now);
    if (!canonicalEmail) redirect(path);
    await erase(getDb(), actor, canonicalEmail, now);
    done = true;
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?error=${error.code}#admin-alert`);
    throw error;
  }
  // The emailing one says so in a toast (§384): a withdrawn invitation's place may have gone to the next in line,
  // and the toast's mail line says what that sent and when (the design «telling the owner about every email a staff
  // press sends»). Its key only, never the address the page was opened for.
  if (done && press) await flashOutcome({ saved: "eventInvitationsErased" });
  redirect(`${path}?q=${encodeURIComponent(sealed)}${done ? `&erased=${erased}` : ""}`);
}
