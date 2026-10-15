"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { addRegistrationNote, deleteRegistrationNote } from "@/modules/registrations/notes";
import { canKeepRegistrationNotes } from "@/modules/staff-identity/domain/roles";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { flash } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/**
 * The two presses of «Note interne» (§777): «Salvează nota» and «Șterge».
 *
 * Each starts with `requireStaffCapability(canKeepRegistrationNotes)` — the coarse gate, so the Tehnic role,
 * the volunteer and a member never reach the service — and the service asserts the role again, and for a
 * delete, whose note it is (BR-REQ-060-01: a hidden card is a courtesy, never the permission). A refusal comes
 * back as the form's own state (`refused`, §315): the words typed stay in the box, with JavaScript off too.
 * A success flashes a toast and returns to the card, open (`#note-interne`). Nothing typed goes in the URL or
 * the flash — the toast says «Notă adăugată», never the note.
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function detailPath(locale: Locale, registrationId: string): string {
  return getPathname({ locale, href: { pathname: "/admin/registrations/[id]", params: { id: registrationId } } });
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** «Salvează nota»: one note on the registration whose page the form is on. */
export async function addRegistrationNoteAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const registrationId = text(form, "registrationId");
  try {
    const actor = await requireStaffCapability(canKeepRegistrationNotes);
    await addRegistrationNote(getDb(), actor, registrationId, form.get("body"), new Date());
  } catch (error) {
    return refused(error, form);
  }
  await flash({ kind: "success", key: "noteAdded" });
  redirect(`${detailPath(locale, registrationId)}?saved=noteAdded#note-interne`);
}

/** «Șterge» on one note: its author's, or any when the Administrator presses it (the service decides). */
export async function deleteRegistrationNoteAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  let registrationId: string;
  try {
    const actor = await requireStaffCapability(canKeepRegistrationNotes);
    ({ registrationId } = await deleteRegistrationNote(getDb(), actor, text(form, "noteId"), new Date()));
  } catch (error) {
    return refused(error, form);
  }
  await flash({ kind: "success", key: "noteDeleted" });
  redirect(`${detailPath(locale, registrationId)}?saved=noteDeleted#note-interne`);
}
