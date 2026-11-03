"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { ELITE_NAME_MAX } from "@/db/schema/event-elite-entries";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { addReserveEntry, deleteReserveEntry, moveReserveEntryToElite, saveReserveNote } from "@/modules/registrations/reserve-list";
import { canKeepRegistrationNotes, canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { flash } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/**
 * The three presses of «Lista internă de așteptare» (§854) on an event's registrations list: «Adaugă»,
 * «Salvează nota» and «Șterge». The coarse gate here (`canKeepRegistrationNotes`) and the service's own
 * (BR-REQ-060-01). A refusal keeps what was typed (§315); a success returns to the panel, open. Nothing
 * typed goes in the URL or the flash, and nothing is ever sent to the person. A fourth, the Administrator's
 * alone: «Mută pe lista de elită» (§NNN), below.
 */

/**
 * A line whose name cannot print on a bib (§NNN): its own sentence, since no box of the move's form holds the name.
 * Not exported: a "use server" file exports async functions only.
 */
const RESERVE_ELITE_NAME = "RESERVE_ELITE_NAME";

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

/**
 * «Mută pe lista de elită» on a line (§NNN): the line's name onto the race's elite list (§895) — printed on a bib,
 * nobody registered, emailed or seated — and the line gone, in one transaction (`moveReserveEntryToElite`). The
 * Administrator's alone: the coarse gate here, the service's own assertion again (BR-REQ-060-01); the Organizer
 * keeps the list's add, note and delete. Asked first on the line, naming the person. A name too long for a bib is
 * refused in its own sentence (`RESERVE_ELITE_NAME`, the limit named) — the form has no box for it.
 *
 * A success comes back to the list as it was — its filters, sort and page, from the form's `listQuery` (only the
 * query travels in a field and the path is rebuilt here, §180's shape) — with the internal list open, the line
 * gone and, on it, the link to the editor's elite card (`?saved=reserveMovedToElite`).
 */
export async function moveReserveEntryToEliteAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  let eventId: string;
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    ({ eventId } = await moveReserveEntryToElite(getDb(), actor, text(form, "entryId"), new Date()));
  } catch (error) {
    const refusal = refused(error, form);
    if (isDomainError(error) && error.fields.includes("name")) {
      return { ...refusal, error: RESERVE_ELITE_NAME, errorValues: { max: String(ELITE_NAME_MAX) }, fields: [] };
    }
    return refusal;
  }
  await flash({ kind: "success", key: "reserveMovedToElite" });
  const params = new URLSearchParams(text(form, "listQuery"));
  // An outcome an earlier press left in the query, never repeated; the event is the line's, whatever the query said.
  for (const key of ["saved", "error", "from", "count", "erase", "memberSweep"]) params.delete(key);
  params.set("eventId", eventId);
  params.set("saved", "reserveMovedToElite");
  redirect(`${getPathname({ locale, href: "/admin/registrations" })}?${params.toString()}#registrations-reserve`);
}
