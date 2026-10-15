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
  changeVolunteerCategory,
  changeVolunteerRole,
  ROLE_FORM_COLOUR_BOXES,
  setAcceptsVolunteers,
  setVolunteersShirts,
  setVolunteersShowCounts,
  type VolunteerCategoryRequest,
  type VolunteerRequest,
  type VolunteerRoleRequest,
} from "@/modules/volunteers/volunteers";
import { recordPaperVolunteerAgreement, requestVolunteerAgreement } from "@/modules/volunteers/agreement";
import { recordPaperVolunteerGuardian, requestVolunteerGuardian } from "@/modules/volunteers/guardian";
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
  // What the person would do (§761): every box ticked, one name, several values; and the role given, or "".
  roleIds: form.getAll("roleIds").filter((value): value is string => typeof value === "string"),
  assignedRoleId: field(form, "assignedRoleId"),
  name: field(form, "name"),
  email: field(form, "email"),
  phone: phoneOf(form),
  note: field(form, "note"),
  // What the person told the organizers (§765), all optional: the boxes as typed, the two ticks true only when posted. The date of
  // birth is what the card's box posts (§773, the registration form's own box); the service reads it as typed, day first, and derives the age.
  birthDate: field(form, "birthDate"),
  sex: field(form, "sex"),
  city: field(form, "city"),
  shirtSize: field(form, "shirtSize"),
  // The parent or guardian of a person under eighteen (§768): the name, and the address when the organizer has it.
  guardianName: field(form, "guardianName"),
  guardianEmail: field(form, "guardianEmail"),
  volunteeredBefore: form.get("volunteeredBefore") === "on",
  clubMember: form.get("clubMember") === "on",
});

const roleFields = (form: FormData) => ({
  // «Categoria» (§774): the id of the category chosen, "" for «Alte activități» — only when the form drew the choice, so a form without it leaves the role where it is.
  ...(form.has("categoryId") ? { categoryId: field(form, "categoryId") } : {}),
  nameRo: field(form, "nameRo"),
  nameEn: field(form, "nameEn"),
  needed: field(form, "needed"),
  // «Fără număr — oricâți oameni» (§NNN): the house tick posts `on`; the service decides by it, whatever the number box holds.
  unlimited: form.get("unlimited") === "on" ? "on" : "",
  descriptionRo: field(form, "descriptionRo"),
  descriptionEn: field(form, "descriptionEn"),
  // «Descrierea rolului» (§765): the editor's documents when the form drew the editor; absent otherwise, so a caller with the plain boxes is read as it always was.
  ...(form.has("descriptionRoBody") ? { descriptionRoBody: field(form, "descriptionRoBody") } : {}),
  ...(form.has("descriptionEnBody") ? { descriptionEnBody: field(form, "descriptionEnBody") } : {}),
  // The band's colour (§764): only when the form drew its boxes — a form without them leaves the colour as it is.
  ...(form.has(ROLE_FORM_COLOUR_BOXES.choice)
    ? {
        [ROLE_FORM_COLOUR_BOXES.choice]: field(form, ROLE_FORM_COLOUR_BOXES.choice),
        [ROLE_FORM_COLOUR_BOXES.typed]: field(form, ROLE_FORM_COLOUR_BOXES.typed),
      }
    : {}),
});

const categoryFields = (form: FormData) => ({ nameRo: field(form, "nameRo"), nameEn: field(form, "nameEn") });

/**
 * «Persoana de contact» of a category (§774): the three boxes as posted — the telephone read by the parser a staff member's box uses
 * (`typedPhone`: with the country code, or as a Romanian number; anything it cannot read stays as typed, for the schema's bound).
 */
const contactFields = (form: FormData) => ({
  contactName: field(form, "contactName"),
  contactPhone: typedPhone(field(form, "contactPhone").trim()),
  contactEmail: field(form, "contactEmail"),
});

async function runCategory(request: VolunteerCategoryRequest) {
  const actor = await requireStaff();
  return changeVolunteerCategory(getDb(), actor, request, new Date());
}

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

/**
 * «Oferim tricouri voluntarilor» (§765): the card's own tick, the event's `volunteers_shirts`. Its submit is drawn as the
 * checkbox and posts `on=1|0`, the state it wants, never a toggle.
 */
export async function switchVolunteersShirtsAction(form: FormData): Promise<void> {
  const on = field(form, "on") === "1";
  try {
    const actor = await requireStaff();
    const result = await setVolunteersShirts(getDb(), actor, { eventId: eventIdOf(form), on }, new Date());
    return backToCard(form, { saved: result.changed ? (on ? "volunteersShirtsOn" : "volunteersShirtsOff") : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/**
 * «Arată public câți voluntari mai sunt necesari» (§773): the card's third tick, the event's `volunteers_show_counts`, the same
 * submit drawn as the checkbox as the two above — it posts `on=1|0`, the state it wants, never a toggle.
 */
export async function switchVolunteersCountsAction(form: FormData): Promise<void> {
  const on = field(form, "on") === "1";
  try {
    const actor = await requireStaff();
    const result = await setVolunteersShowCounts(getDb(), actor, { eventId: eventIdOf(form), on }, new Date());
    return backToCard(form, { saved: result.changed ? (on ? "volunteersCountsOn" : "volunteersCountsOff") : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/** «Adaugă o categorie» (§774): both names. A refusal keeps what was typed (§315). */
export async function addVolunteerCategoryAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await runCategory({ kind: "add", eventId: eventIdOf(form), fields: categoryFields(form) });
  } catch (error) {
    if (isDomainError(error) && (error.code === "VALIDATION_ERROR" || error.code === "VOLUNTEER_NAME_TAKEN")) return refused(error, form);
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerCategoryAdded" });
}

/** «Salvează» under a category's «Modifică»: both names. */
export async function editVolunteerCategoryAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let changed: boolean;
  try {
    changed = (await runCategory({ kind: "edit", eventId: eventIdOf(form), id: field(form, "categoryId"), fields: categoryFields(form) })).changed;
  } catch (error) {
    if (isDomainError(error) && (error.code === "VALIDATION_ERROR" || error.code === "VOLUNTEER_NAME_TAKEN")) return refused(error, form);
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: changed ? "volunteerCategorySaved" : "volunteerUnchanged" });
}

/** «Salvează» under a category's «Persoana de contact»: its own form, its own press. */
export async function saveVolunteerCategoryContactAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let changed: boolean;
  try {
    changed = (await runCategory({ kind: "contact", eventId: eventIdOf(form), id: field(form, "categoryId"), fields: contactFields(form) })).changed;
  } catch (error) {
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") return refused(error, form);
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: changed ? "volunteerCategoryContactSaved" : "volunteerUnchanged" });
}

/** The arrows on a category: one step up or down in the club's order. */
export async function moveVolunteerCategoryAction(form: FormData): Promise<void> {
  const direction = field(form, "direction") === "up" ? "up" : "down";
  try {
    const result = await runCategory({ kind: "move", eventId: eventIdOf(form), id: field(form, "categoryId"), direction });
    return backToCard(form, { saved: result.changed ? "volunteerCategoryMoved" : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/** «Șterge categoria»: asks first (§384); a category with roles under it is refused, naming why (`VOLUNTEER_CATEGORY_HAS_ROLES`). */
export async function deleteVolunteerCategoryAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await runCategory({ kind: "delete", eventId: eventIdOf(form), id: field(form, "categoryId") });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerCategoryDeleted" });
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
    // A colour no word reads on is a box to correct, like a name left empty (§764).
    // …or a name already under that category (§774): the box to change.
    if (isDomainError(error) && (error.code === "VALIDATION_ERROR" || error.code === "BADGE_COLOUR_UNREADABLE" || error.code === "VOLUNTEER_NAME_TAKEN")) return refused(error, form);
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
 * «Dă-i rolul …» (§761): one press gives a volunteer one role of the event — one of those they ticked, or another from
 * the select beside them. The form posts the role it wants, never a toggle; the service checks the role is this
 * event's, refuses a cancelled person, audits the change and emails the person the role.
 */
export async function assignVolunteerAction(form: FormData): Promise<void> {
  try {
    const result = await runVolunteer({ kind: "assign", eventId: eventIdOf(form), id: field(form, "volunteerId"), roleId: field(form, "roleId") });
    return backToCard(form, { saved: result.changed ? "volunteerAssigned" : "volunteerUnchanged" });
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
        printed: { documentId: field(form, "agreementDocumentId"), roles: field(form, "agreementRoles") },
      },
      new Date(),
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerAgreementRecorded" });
}

/**
 * «Trimite linkul părintelui» (§768): one email with the volunteer agreement and a single-use link to accept it in the
 * guardian's name, to the guardian's address. The service refuses while the club may not take minors, for a volunteer
 * who is not under eighteen, was cancelled, has no guardian address or whose guardian has accepted — each said in the
 * card's banner.
 */
export async function requestVolunteerGuardianAction(form: FormData): Promise<void> {
  try {
    const actor = await requireStaff();
    await requestVolunteerGuardian(getDb(), actor, { eventId: eventIdOf(form), id: field(form, "volunteerId") }, new Date());
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerGuardianRequested" });
}

/**
 * «Acordul părintelui pe hârtie» (§768): asks first (§384), then records that the guardian signed the printed agreement at
 * the desk — the version in force, and who recorded it. A staff member records the guardian's signature, never gives one.
 */
export async function recordPaperVolunteerGuardianAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    const actor = await requireStaff();
    await recordPaperVolunteerGuardian(
      getDb(),
      actor,
      {
        eventId: eventIdOf(form),
        id: field(form, "volunteerId"),
        // What the card's «PDF de semnat de părinte» printed: the service refuses when either changed since.
        printed: { documentId: field(form, "agreementDocumentId"), roles: field(form, "agreementRoles") },
      },
      new Date(),
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerGuardianRecorded" });
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
