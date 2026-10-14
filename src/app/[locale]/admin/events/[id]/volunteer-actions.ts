"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { requireStaff } from "@/modules/staff-identity/session";
import { typedPhone } from "@/modules/registrations/answers";
import {
  changeVolunteer,
  changeVolunteerRole,
  setAcceptsVolunteers,
  type VolunteerRequest,
  type VolunteerRoleRequest,
} from "@/modules/volunteers/volunteers";
import { recordPaperVolunteerAgreement, requestVolunteerAgreement } from "@/modules/volunteers/agreement";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";
import { isUuid } from "@/shared/ids";

/*
  An event's volunteers (§754): the Server Actions behind the editor's «Voluntari» card. Each is a plain
  form that works with scripts off; every one asks the service, which asserts the role again (the
  Organizer and the Administrators read and write, nobody else sees the card — BR-REQ-060-01), so the
  buttons the card draws are a courtesy.
*/

function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The event the form is about — a malformed id is passed on and the service refuses it (NOT_FOUND). */
function eventIdOf(form: FormData): string {
  const id = field(form, "eventId");
  return isUuid(id) ? id : "";
}

/**
 * Back to the card, with the toast's word in the flash cookie (§384) or, for a one-button form that has
 * no boxes to keep, the refusal's code in the address for the card's banner.
 */
async function backToCard(form: FormData, outcome: { saved?: string; error?: string }): Promise<never> {
  const locale = localeOf(form);
  const id = eventIdOf(form);
  if (outcome.saved) await flashOutcome({ saved: outcome.saved });
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id } } });
  revalidatePath(path);
  const query = outcome.error ? `?volunteerError=${encodeURIComponent(outcome.error)}` : "";
  redirect(`${path}${query}#box-volunteers`);
}

/**
 * The telephone as the staff box posts it, read by the parser an Administrator's correction of a registration
 * uses (`typedPhone`): typed with the country code, or as a Romanian number — one E.164, or what was typed for
 * the schema to refuse on `phone`.
 */
function phoneOf(form: FormData): string {
  return typedPhone(field(form, "phone").trim());
}

const staffFields = (form: FormData) => ({
  roleId: field(form, "roleId"),
  name: field(form, "name"),
  email: field(form, "email"),
  phone: phoneOf(form),
  note: field(form, "note"),
});

const roleFields = (form: FormData) => ({
  nameRo: field(form, "nameRo"),
  nameEn: field(form, "nameEn"),
  needed: field(form, "needed"),
  descriptionRo: field(form, "descriptionRo"),
  descriptionEn: field(form, "descriptionEn"),
});

async function runRole(request: VolunteerRoleRequest) {
  const actor = await requireStaff();
  return changeVolunteerRole(getDb(), actor, request, new Date());
}

async function runVolunteer(request: VolunteerRequest) {
  const actor = await requireStaff();
  return changeVolunteer(getDb(), actor, request, new Date());
}

/** «Pornește formularul public» / «Oprește formularul public»: the form posts the state it wants, never a toggle. */
export async function switchVolunteersAction(form: FormData): Promise<void> {
  const on = field(form, "on") === "1";
  try {
    const actor = await requireStaff();
    const result = await setAcceptsVolunteers(getDb(), actor, { eventId: eventIdOf(form), on }, new Date());
    return backToCard(form, { saved: result.changed ? (on ? "volunteersOn" : "volunteersOff") : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/** «Adaugă rolul»: both names, how many it needs, and what the person would do. A refusal keeps what was typed (§315). */
export async function addVolunteerRoleAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await runRole({ kind: "add", eventId: eventIdOf(form), fields: roleFields(form) });
  } catch (error) {
    return refused(error, form);
  }
  return backToCard(form, { saved: "volunteerRoleAdded" });
}

/** «Salvează» under a role's «Modifică». */
export async function editVolunteerRoleAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let changed: boolean;
  try {
    changed = (await runRole({ kind: "edit", eventId: eventIdOf(form), id: field(form, "roleId"), fields: roleFields(form) })).changed;
  } catch (error) {
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") return refused(error, form);
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: changed ? "volunteerRoleSaved" : "volunteerUnchanged" });
}

/** The arrows: one step up or down in the club's order. */
export async function moveVolunteerRoleAction(form: FormData): Promise<void> {
  const direction = field(form, "direction") === "up" ? "up" : "down";
  try {
    const result = await runRole({ kind: "move", eventId: eventIdOf(form), id: field(form, "roleId"), direction });
    return backToCard(form, { saved: result.changed ? "volunteerRoleMoved" : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/** «Șterge rolul»: asks first (§384); a role with people on it is refused, naming why (`VOLUNTEER_ROLE_HAS_PEOPLE`). */
export async function deleteVolunteerRoleAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await runRole({ kind: "delete", eventId: eventIdOf(form), id: field(form, "roleId") });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerRoleDeleted" });
}

/** «Adaugă voluntarul»: a person the club enters by hand. */
export async function addVolunteerAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await runVolunteer({ kind: "add", eventId: eventIdOf(form), fields: staffFields(form) });
  } catch (error) {
    return refused(error, form);
  }
  return backToCard(form, { saved: "volunteerAdded" });
}

/** «Salvează» under a volunteer's «Modifică»: every box, the role included. */
export async function editVolunteerAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let changed: boolean;
  try {
    changed = (await runVolunteer({ kind: "edit", eventId: eventIdOf(form), id: field(form, "volunteerId"), fields: staffFields(form) })).changed;
  } catch (error) {
    if (isDomainError(error) && (error.code === "VALIDATION_ERROR" || error.code === "VOLUNTEER_ALREADY_LISTED")) return refused(error, form);
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: changed ? "volunteerSaved" : "volunteerUnchanged" });
}

/** «Confirmă», «Anulează» and «Reactivează»: the form posts the state it wants, never a toggle, so two presses end where the second aimed. */
export async function setVolunteerStateAction(form: FormData): Promise<void> {
  const state = field(form, "state");
  try {
    const result = await runVolunteer({ kind: "setState", eventId: eventIdOf(form), id: field(form, "volunteerId"), state });
    const saved = state === "CONFIRMED" ? "volunteerConfirmed" : state === "CANCELLED" ? "volunteerCancelled" : "volunteerReopened";
    return backToCard(form, { saved: result.changed ? saved : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/**
 * «Trimite linkul contractului» (§758): one email with the volunteer agreement and a single-use link to accept it,
 * for a person entered by hand. The service refuses while no agreement is in force, and for a person who has
 * accepted or was cancelled — each said in the card's banner.
 */
export async function requestVolunteerAgreementAction(form: FormData): Promise<void> {
  try {
    const actor = await requireStaff();
    await requestVolunteerAgreement(getDb(), actor, { eventId: eventIdOf(form), id: field(form, "volunteerId") }, new Date());
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerAgreementRequested" });
}

/**
 * «Semnat pe hârtie» (§758): asks first (§384), then records that the person signed the printed agreement at the
 * desk — the version in force, and who recorded it. A staff member records the person's signature, never gives one.
 */
export async function recordPaperVolunteerAgreementAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    const actor = await requireStaff();
    await recordPaperVolunteerAgreement(
      getDb(),
      actor,
      {
        eventId: eventIdOf(form),
        id: field(form, "volunteerId"),
        // What the card's «PDF de semnat» printed: the service refuses when either changed since (§758).
        printed: { documentId: field(form, "agreementDocumentId"), roleId: field(form, "roleId") },
      },
      new Date(),
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerAgreementRecorded" });
}

/** «Șterge»: asks first (§384) — a deleted volunteer is gone, and the audit row keeps no name. */
export async function deleteVolunteerAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await runVolunteer({ kind: "delete", eventId: eventIdOf(form), id: field(form, "volunteerId") });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerDeleted" });
}
