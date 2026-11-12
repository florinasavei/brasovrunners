"use server";

import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { listReturnHref } from "@/modules/registrations/domain/list-row";
import { partnerMarkOf, partnerMarkOfRow, setRegistrationPartner } from "@/modules/registrations/partner-mark";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";
import { redirect } from "next/navigation";

/**
 * «E de la parteneri» on a registration's page (the decision «De la parteneri»): the tick and the box «Numele partenerului sau
 * sponsorului», set, changed or cleared — the organizers' own label, nothing else of the registration touched
 * (`partner-mark.ts`). The Administrator's: the coarse gate here, the service asserts it again (BR-REQ-060-01); the Organizer
 * sees the chip and is handed no form. A tick without a name is refused at the box, what was typed kept (§315); a save comes
 * back to the page with a toast, the name in neither the address nor the flash. It asks nothing (§384): it tells nobody.
 *
 * A file of its own beside `note-actions.ts`, as the registration page's other card presses are — and the list row's editor
 * of the same label beside it, so the label's two presses are one file.
 */
function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function setRegistrationPartnerAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const registrationId = text(form, "registrationId");
  let saved: string;
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    const written = await setRegistrationPartner(getDb(), actor, registrationId, partnerMarkOf(form), new Date());
    saved = !written.changed ? "partnerUnchanged" : written.partnerName === null ? "partnerCleared" : "partnerSaved";
  } catch (error) {
    return refused(error, form);
  }
  await flashOutcome({ saved });
  const path = getPathname({ locale, href: { pathname: "/admin/registrations/[id]", params: { id: registrationId } } });
  // `#registration-partner`: back on the card the press came from, the toast saying what changed.
  redirect(`${path}?saved=${saved}#registration-partner`);
}

/**
 * «Salvează partenerul» in a row's editor on the registrations list (the list's column «Partener»): the select of the event's
 * partners and the box for a new one — a name typed wins, «Fără partener» with an empty box clears (`partnerMarkOfRow`) — then
 * the same `setRegistrationPartner` as the page's card: the same parse, the same audit row, the same refusals. The
 * Administrator's: the coarse gate here and the service's own (BR-REQ-060-01); the press drawn only for that role is a
 * courtesy. A refusal comes back as the dialog's own state, what was typed kept; a save returns to the list as it was — its
 * event, filters, sort, page and page size, from `listQuery` alone (the path is rebuilt here, as `actions.ts#backToList`
 * does) — with `saved` and the toast, the name in neither. `from=row` keeps the internal list's panel shut on the way back.
 */
export async function setRegistrationPartnerFromListAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  let saved: string;
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    const written = await setRegistrationPartner(getDb(), actor, text(form, "registrationId"), partnerMarkOfRow(form), new Date());
    saved = !written.changed ? "partnerUnchanged" : written.partnerName === null ? "partnerCleared" : "partnerSaved";
  } catch (error) {
    return refused(error, form);
  }
  await flashOutcome({ saved });
  // Back on the row itself, the outcome in the toast (§NNN): the list no longer jumps to its top after a row's edit.
  redirect(listReturnHref(getPathname({ locale, href: "/admin/registrations" }), text(form, "listQuery"), { saved, from: "row" }, text(form, "registrationId")));
}
