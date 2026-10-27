"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { addReserveEntry, deleteReserveEntry, saveReserveNote } from "@/modules/registrations/reserve-list";
import { canKeepRegistrationNotes } from "@/modules/staff-identity/domain/roles";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { flash } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/**
 * The three presses of «Lista internă de așteptare» (§854) on an event's registrations list: «Adaugă»,
 * «Salvează nota» and «Șterge». The coarse gate here (`canKeepRegistrationNotes`) and the service's own
 * (BR-REQ-060-01). A refusal keeps what was typed (§315); a success returns to the panel, open. Nothing
 * typed goes in the URL or the flash, and nothing is ever sent to the person.
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function backToPanel(locale: Locale, eventId: string, saved: string): Promise<never> {
  await flash({ kind: "success", key: saved });
  redirect(`${getPathname({ locale, href: "/admin/registrations" })}?eventId=${encodeURIComponent(eventId)}&saved=${saved}#registrations-reserve`);
}

export async function addReserveEntryAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  try {
    const actor = await requireStaffCapability(canKeepRegistrationNotes);
    await addReserveEntry(getDb(), actor, eventId, { firstName: form.get("firstName"), lastName: form.get("lastName"), email: form.get("email"), note: form.get("note") }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  return backToPanel(locale, eventId, "reserveAdded");
}

export async function saveReserveNoteAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  let eventId: string;
  try {
    const actor = await requireStaffCapability(canKeepRegistrationNotes);
    ({ eventId } = await saveReserveNote(getDb(), actor, text(form, "entryId"), form.get("note"), new Date()));
  } catch (error) {
    return refused(error, form);
  }
  return backToPanel(locale, eventId, "reserveNoteSaved");
}

export async function deleteReserveEntryAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  let eventId: string;
  try {
    const actor = await requireStaffCapability(canKeepRegistrationNotes);
    ({ eventId } = await deleteReserveEntry(getDb(), actor, text(form, "entryId"), new Date()));
  } catch (error) {
    return refused(error, form);
  }
  return backToPanel(locale, eventId, "reserveDeleted");
}
