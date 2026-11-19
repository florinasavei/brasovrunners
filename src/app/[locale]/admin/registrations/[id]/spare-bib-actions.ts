"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { giveSpareBibByStaff, SPARE_BIB_FIELD, spareBibRefusalCode } from "@/modules/registrations/admin-service";
import { inEmailPress } from "@/modules/notifications/press";
import { requireStaff } from "@/modules/staff-identity/session";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";
import { mailSkippedOf, sendEmailOf } from "@/shared/forms/send-email";
import { wholeDigits } from "@/shared/forms/whole-digits";

/**
 * «Dă-i un BIB gol» on a registration's page (§NNN): the free desk spare chosen in the select becomes the runner's number,
 * printed or not, and the old number is retired (`giveSpareBibByStaff`). A desk verb as «Schimbă numărul» is: any staff
 * session reaches the service, which asserts the desk and, to replace a number, the Administrator (BR-REQ-060-01) — the
 * page offers the fold only where the press can succeed, a courtesy. The question's answer decides `BIB_ASSIGNED` (§976).
 *
 * A file of its own beside `note-actions.ts` and `partner-actions.ts`, as the page's other card presses are. A refusal
 * comes back as the form's own state, naming the select (§315); a blank bib somebody else took a moment ago is said in
 * its own words (`SPARE_BIB_TAKEN`). A press that worked comes back to the page with the toast «Număr salvat.».
 */
function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function giveSpareBibAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  // An email press (`notifications/press.ts`): the number given by hand, as «Schimbă numărul» is — the same cause.
  return inEmailPress("registrations.setBib", async (press) => {
    const locale = toLocale(form.get("uiLocale"));
    const registrationId = text(form, "registrationId");
    // The question's answer (§976): «… fără email», the blank bib is given and the runner is not emailed its number.
    const sendEmail = sendEmailOf(form);

    try {
      const actor = await requireStaff();
      press.by(actor.id);
      await giveSpareBibByStaff(getDb(), actor, registrationId, wholeDigits(text(form, SPARE_BIB_FIELD)), new Date(), { sendEmail });
    } catch (error) {
      const outcome = refused(error, form, { fieldNames: () => [SPARE_BIB_FIELD] });
      const taken = spareBibRefusalCode(error);
      return taken ? { ...outcome, error: taken } : outcome;
    }
    await flashOutcome({ saved: "bibSet", ...mailSkippedOf(sendEmail) });
    const path = getPathname({ locale, href: { pathname: "/admin/registrations/[id]", params: { id: registrationId } } });
    // `#admin-alert`: the page's alert region, where «Salvat» lands — as every press of the race-day card returns.
    redirect(`${path}?saved=bibSet#admin-alert`);
  });
}
