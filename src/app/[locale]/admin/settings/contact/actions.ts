"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { addressListRefusal, CONTACT_RECIPIENTS_MAX, parseAddressList } from "@/modules/contact/domain/recipients";
import { updateContactRecipients } from "@/modules/contact/recipients";
import { updateShownContactAddress } from "@/modules/contact/shown-address";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/*
  «Setări» → «Contact» (§NNN): where the club is written to — who reads «Scrie-ne» (§164) and the
  address the site shows and every email answers to (§442). Both actions moved here, unchanged,
  from `/admin/emails`; they land back on this tab.
*/

/** Which language to land back in: the form carries it, because an action has no request locale. */
function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

/**
 * "Who receives the contact form's messages" (`DECISIONS.md` §164). The same gate and the same
 * shape as the email plan's (§100): Administrator at the door, the service asserting the role again,
 * each address validated there, and the outcome in the query. Two typed lines come in; the
 * service is what decides whether they are addresses.
 */
export async function updateContactRecipientsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/contact" });
  const list = (name: string): string[] => parseAddressList(typeof form.get(name) === "string" ? String(form.get(name)) : "");

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    await updateContactRecipients(getDb(), actor, { to: list("to"), cc: list("cc"), bcc: list("bcc") }, new Date());
  } catch (error) {
    // Which entry is not an address, or which list is too long, in the sentence (§457).
    const outcome = refused(error, form);
    if (outcome.error !== "VALIDATION_ERROR") return outcome;
    return { ...outcome, ...addressListRefusal([list("to"), list("cc"), list("bcc")], CONTACT_RECIPIENTS_MAX) };
  }
  // The action and the render that follows are one request, and the router keeps the payload
  // it already has for this path: without this the page comes back saying what it said before
  // the press (found on 2026-09-20 — a saved plan and a cleared recipient list both).
  revalidatePath(path);
  await flashOutcome({ saved: "contactRecipients" });
  redirect(`${path}?saved=contactRecipients#admin-alert`);
}

/**
 * «Adresa de contact afișată» (§442): the mailbox, the club's Gmail, or both — shown on the site
 * and set as every email's Reply-To. Administrator at the door, the service asserting it again.
 */
export async function updateShownContactAddressAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/contact" });

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    // The mode alone: the Gmail is the configuration's, never typed (§442 as amended).
    await updateShownContactAddress(getDb(), actor, { mode: form.get("mode") }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath(path);
  await flashOutcome({ saved: "shownContactAddress" });
  redirect(`${path}?saved=shownContactAddress#admin-alert`);
}
