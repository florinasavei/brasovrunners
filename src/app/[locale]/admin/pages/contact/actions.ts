"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { addressListRefusal, CONTACT_RECIPIENTS_MAX, parseAddressList } from "@/modules/contact/domain/recipients";
import { updateContactRecipients } from "@/modules/contact/recipients";
import { updatePublicPhone } from "@/modules/contact/public-phone";
import { updateFeedbackSettings } from "@/modules/feedback/settings";
import { updateShownContactAddress } from "@/modules/contact/shown-address";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/*
  «Pagini» → «Contact»: where the club is written to — who reads «Scrie-ne» (§164) and the address
  the site shows and every email answers to (§442). Both actions moved here unchanged, from
  `/admin/emails` (§516) and then from «Setări» → «Contact» (the owner, 2026-09-28: «ar trebui să
  rămân în același loc»); they land back on this page, so the «Pagini» row stays under the reader.
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
  const path = getPathname({ locale, href: "/admin/pages/contact" });
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
  const path = getPathname({ locale, href: "/admin/pages/contact" });

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

/**
 * «Telefon public» (§565): the one number the footer's «Contact» shows, or none when the box is
 * left empty. Administrator at the door, the service asserting it again.
 */
export async function updatePublicPhoneAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/pages/contact" });

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    const phone = form.get("phone");
    await updatePublicPhone(getDb(), actor, { phone: typeof phone === "string" ? phone : "" }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath(path);
  await flashOutcome({ saved: "publicPhone" });
  redirect(`${path}?saved=publicPhone#admin-alert`);
}

/**
 * «Spune-ne ceva» (§676): per branch a switch and the address that receives it, and the safety
 * branch's first name. Administrator at the door, the service asserting it again and validating
 * each address; a refused save comes back as typed, the boxes it names marked.
 */
export async function updateFeedbackFormsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/pages/contact" });
  const value = (name: string) => (typeof form.get(name) === "string" ? String(form.get(name)) : "");
  const branch = (name: string) => ({ on: form.get(`${name}On`) === "on", to: value(`${name}To`) });

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    await updateFeedbackSettings(
      getDb(),
      actor,
      {
        howItWent: branch("howItWent"),
        suggestion: branch("suggestion"),
        complaint: branch("complaint"),
        safety: { ...branch("safety"), name: value("safetyName") },
      },
      new Date(),
    );
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath(path);
  await flashOutcome({ saved: "feedbackForms" });
  redirect(`${path}?saved=feedbackForms#admin-alert`);
}
