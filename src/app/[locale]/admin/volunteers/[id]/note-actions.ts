"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { addVolunteerNote, deleteVolunteerNote } from "@/modules/volunteers/volunteer-notes";
import { flash } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";
// The «Voluntari» list's own validated way back (§839): only a path of that screen, never anywhere else.
import { backToCard } from "@/app/[locale]/admin/events/[id]/volunteer-return";

/**
 * The two presses of a volunteer's «Note interne» card: «Salvează nota» and «Șterge».
 *
 * Each starts with `requireStaffCapability(canManageVolunteers)` — the coarse gate, so the Tehnic role, the Redactor, the volunteer
 * and a member never reach the service — and the service asserts the role again, and for a delete, whose note it is (BR-REQ-060-01:
 * a hidden card is a courtesy, never the permission). A refusal comes back as the form's own state (`refused`, §315): the words
 * typed stay in the box, with JavaScript off too. A success flashes the registrations' toast («Nota a fost salvată» / «Nota a fost
 * ștearsă») and returns to the volunteer's page with the card open (`?saved=…#note-interne`). Nothing typed goes in the URL or the
 * flash. Not named `actions.ts`: these are the card's own presses, as the registration's `note-actions.ts` are.
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function personPath(locale: Locale, volunteerId: string): string {
  return getPathname({ locale, href: { pathname: "/admin/volunteers/[id]", params: { id: volunteerId } } });
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** «Salvează nota»: one note on the volunteer whose page the form is on. */
export async function addVolunteerNoteAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  let volunteerId: string;
  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    ({ volunteerId } = await addVolunteerNote(getDb(), actor, text(form, "volunteerId"), form.get("body"), new Date()));
  } catch (error) {
    return refused(error, form);
  }
  await flash({ kind: "success", key: "noteAdded" });
  redirect(`${personPath(locale, volunteerId)}?saved=noteAdded#note-interne`);
}

/**
 * «Salvează nota» from a row of the «Voluntari» list: one note on the volunteer of the row, written in the dialog over the list
 * (`RowNoteDialog`, the registrations list's own control). The coarse gate here, the service asks again. A refusal — empty, too
 * long, a volunteer deleted meanwhile — is said in the dialog with the words still in the box; a save comes back to the same list
 * address (filters, sort, page) through the volunteers' one validated return (`backToCard`, which accepts only a path of the
 * «Voluntari» screen, so a forged `returnTo` sends nobody anywhere else), with the toast «Nota a fost salvată».
 */
export async function addVolunteerNoteFromListAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    await addVolunteerNote(getDb(), actor, text(form, "volunteerId"), form.get("body"), new Date());
  } catch (error) {
    return refused(error, form);
  }
  return backToCard(form, { saved: "noteAdded" });
}

/** «Șterge» on one note: its author's, or any when the Administrator presses it (the service decides). */
export async function deleteVolunteerNoteAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  let volunteerId: string;
  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    ({ volunteerId } = await deleteVolunteerNote(getDb(), actor, text(form, "noteId"), new Date()));
  } catch (error) {
    return refused(error, form);
  }
  await flash({ kind: "success", key: "noteDeleted" });
  redirect(`${personPath(locale, volunteerId)}?saved=noteDeleted#note-interne`);
}
